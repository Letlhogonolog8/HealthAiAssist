"""
Where the classifier was looking.

A probability with nothing behind it is not something a clinician can act on.
Asked to justify a 0.94, the model has nothing to say, and the reasonable
response to that from anyone who has watched clinical AI overclaim is to ignore
it. Grad-CAM at least answers "which part of the image moved the number", which
is checkable against what the clinician can see.

── What a heatmap is, and what it is not ──────────────────────────────────

It is the gradient of the predicted class score with respect to the last
convolutional feature map, pooled per channel and used to weight that map. High
regions are regions whose activation, if increased, would increase the score.

It is **not** a lesion boundary, a segmentation, a margin, or a measurement.
It is not evidence that the model reasoned about the region the way a clinician
would, and a plausible-looking heatmap over the right anatomy is not
confirmation that the prediction is right — models attend to the correct region
for the wrong reason routinely, and Grad-CAM is exactly as capable of making a
spurious correlation look convincing as a real one.

That caveat travels with the image to the client, because a heatmap is the kind
of output that becomes evidence in someone's memory if it is shown without one.

── Resolution ─────────────────────────────────────────────────────────────

The final ResNet50V2 block is 7x7 for a 224x224 input, so the underlying map is
49 values upsampled to 224x224. The smooth blobs that produces are a property of
the method, not detail the model actually resolved, and reading fine structure
into them is reading interpolation.
"""
from __future__ import annotations

import io
from typing import Any

import numpy as np


def _last_conv_layer(trunk: Any) -> Any:
    """The deepest layer with a 4-D output — the last spatial feature map.

    Found by inspection rather than by name. The trunk is a nested ResNet50V2
    whose internal layer names are Keras-generated and differ between the two
    artifacts here, so hardcoding one produces a module that works for skin and
    silently fails for lung.
    """
    for layer in reversed(trunk.layers):
        try:
            shape = layer.output.shape
        except AttributeError:
            continue
        if len(shape) == 4:
            return layer
    raise ValueError("No convolutional feature map found in the model trunk")


def heatmap_png(model: Any, img_array: np.ndarray, class_index: int) -> bytes:
    """A Grad-CAM overlay for one image, as PNG bytes.

    `img_array` is the same raw 0-255 batch the classifier receives, so the
    explanation describes the input that produced the prediction rather than a
    separately preprocessed one — a difference that would make the overlay
    quietly wrong.
    """
    import tensorflow as tf
    from PIL import Image

    # The trunk is nested inside the served model and applied to the rescaling
    # output, so its own `.output` belongs to a different graph. Same
    # re-application the OOD feature extractor does.
    rescale = model.get_layer("resnet_v2_preprocess")
    trunk = model.get_layer("resnet50v2")
    conv_layer = _last_conv_layer(trunk)

    feature_model = tf.keras.Model(trunk.inputs, [conv_layer.output, trunk.output])

    inputs = tf.convert_to_tensor(img_array, dtype=tf.float32)

    with tf.GradientTape() as tape:
        scaled = rescale(inputs)
        conv_output, trunk_output = feature_model(scaled)
        tape.watch(conv_output)

        # Replay the head on the trunk's output to reach the class score. The
        # head is whatever follows the trunk in the served model.
        x = trunk_output
        started = False
        for layer in model.layers:
            if layer.name == trunk.name:
                started = True
                continue
            if started:
                x = layer(x)
        score = x[:, class_index]

    grads = tape.gradient(score, conv_output)
    if grads is None:
        raise ValueError("Gradient did not reach the feature map")

    # Channel importance is the spatially averaged gradient; the map is the
    # importance-weighted sum of channels.
    weights = tf.reduce_mean(grads, axis=(1, 2))
    cam = tf.reduce_sum(conv_output * weights[:, tf.newaxis, tf.newaxis, :], axis=-1)

    # Negative regions argue against the class. Only the positive evidence is
    # shown, which is the convention and avoids implying a symmetric reading.
    cam = tf.nn.relu(cam)[0].numpy()

    peak = float(cam.max())
    cam = cam / peak if peak > 0 else np.zeros_like(cam)

    # Upsample 7x7 to the input size. Bilinear, and see the docstring: the
    # smoothness is interpolation, not resolved detail.
    cam_image = Image.fromarray(np.uint8(cam * 255)).resize((224, 224), Image.BILINEAR)
    cam_array = np.asarray(cam_image).astype(np.float32) / 255.0

    base = np.uint8(np.clip(img_array[0], 0, 255))
    if base.ndim == 2:
        base = np.stack([base] * 3, axis=-1)

    # Red where the score came from, over a desaturated original so the anatomy
    # stays readable underneath rather than being buried by the overlay.
    grey = base.mean(axis=2, keepdims=True).repeat(3, axis=2)
    tint = np.zeros_like(grey)
    tint[..., 0] = 255.0

    alpha = (cam_array ** 1.5)[..., np.newaxis] * 0.65
    blended = np.uint8(np.clip(grey * (1 - alpha) + tint * alpha, 0, 255))

    buffer = io.BytesIO()
    Image.fromarray(blended).save(buffer, format="PNG")
    return buffer.getvalue()


CAVEAT = (
    "Shows which regions of the image most influenced the model's score. It is "
    "not a lesion boundary, not a segmentation and not a measurement, and a "
    "heatmap over plausible anatomy is not confirmation that the prediction is "
    "correct."
)
