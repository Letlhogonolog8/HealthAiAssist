"""
The nodule crop — one implementation, imported by training and serving.

The lung nodule characteriser was trained on 64 px squares cut from CT slices
rendered at the lung window, centred on the nodule a radiologist marked, then
resized to 224×224. Serving must produce exactly that from exactly the same
inputs, or the model meets a distribution it never saw and every published
figure stops describing it. That is the defect that made the previous lung
model unusable, one level down: not the wrong image, but the right image
prepared differently.

So the crop is defined here and nowhere else. `scripts/lidc_extract_patches.py`
imports it to build the training set; `inference/lung_nodule_service.py`
imports it to serve. A change to one is a change to both, and
`inference/tests/test_windowing_parity.py` checks that the two paths produce
byte-identical patches from the same object and the same centre.
"""
from __future__ import annotations

import numpy as np

PATCH_PX = 64
MODEL_INPUT_PX = 224


def crop(frame: np.ndarray, cx: float, cy: float, size: int = PATCH_PX) -> np.ndarray:
    """A square crop centred on (cx, cy), zero-padded at the edges.

    Padding rather than shifting the centre: a nodule near the chest wall is
    exactly the case where moving the crop would put the lesion off-centre and
    teach the model that malignancy lives at the edge of the frame.

    `cx` is the column (x) and `cy` the row (y), in pixels of the rendered
    frame — the same convention as the LIDC annotation coordinates the labels
    were built from.
    """
    half = size // 2
    padded = np.pad(frame, half, mode="constant", constant_values=0)
    cx, cy = int(round(cx)) + half, int(round(cy)) + half
    return padded[cy - half:cy + half, cx - half:cx + half]


def patch_to_model_input(patch: np.ndarray) -> np.ndarray:
    """A 64 px uint8 crop to the (1, 224, 224, 3) float32 batch the model takes.

    Grayscale to RGB, then bicubic resize — the order the extractor used when
    it wrote the training PNGs (`Image.fromarray(patch).convert("RGB").resize(
    (224, 224), Image.BICUBIC)`). PNG is lossless, so going through a file and
    not going through one give the same bytes; the parity test holds this path
    to the file path to prove it.

    No normalisation: the saved model begins with a Rescaling layer.
    """
    from PIL import Image

    image = Image.fromarray(np.asarray(patch, dtype=np.uint8)).convert("RGB")
    image = image.resize((MODEL_INPUT_PX, MODEL_INPUT_PX), Image.BICUBIC)
    return np.expand_dims(np.asarray(image, dtype=np.float32), axis=0)
