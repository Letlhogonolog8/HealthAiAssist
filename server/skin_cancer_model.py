import sys
import json
import numpy as np
import os
from PIL import Image
import tensorflow as tf

IMG_SIZE = (224, 224)


def preprocess_image(image_path):
    """Load an image as raw RGB 0-255, resized to the model's input size.

    Deliberately NO normalisation here. The served model begins with a Rescaling
    layer that applies resnet_v2's x/127.5-1 inside the graph, so training and
    inference cannot drift apart on normalisation. Dividing by 255 here would
    silently double-scale the input.

    See scripts/train-skin-cancer-model.py and MODEL_CARDS.md.
    """
    try:
        img = Image.open(image_path).convert('RGB').resize(IMG_SIZE)
        img_array = np.array(img, dtype=np.float32)
        return np.expand_dims(img_array, axis=0)
    except Exception:
        return None


def check_image_quality(img_array):
    """Pixel-level checks for images no classifier should be asked about.

    These catch degenerate inputs the feature-space detector misses. A blank
    frame sits close to the mean in feature space and reconstructs cleanly, so
    PCA scores it as in-distribution — measured at a 0% flag rate. Pixel
    statistics catch it immediately.

    Returns a list of failure reasons; empty means the image looks usable.
    """
    reasons = []
    pixels = img_array[0]
    grey = pixels.mean(axis=2)

    # A featureless frame — blank, uniform, or a lens cap.
    if float(grey.std()) < 8.0:
        reasons.append('Image is nearly uniform; there is no visible subject to assess.')

    # Almost entirely black or blown out.
    mean_level = float(grey.mean())
    if mean_level < 15.0:
        reasons.append('Image is almost entirely black.')
    elif mean_level > 240.0:
        reasons.append('Image is over-exposed to near-white.')

    # Severe blur, via the variance of a Laplacian convolution. A sharp image has
    # strong high-frequency content; a smeared one does not.
    laplacian = (
        -4.0 * grey[1:-1, 1:-1]
        + grey[:-2, 1:-1] + grey[2:, 1:-1]
        + grey[1:-1, :-2] + grey[1:-1, 2:]
    )
    if float(laplacian.var()) < 8.0:
        reasons.append('Image is too blurred for the model to assess.')

    return reasons


def _feature_extractor(model):
    """Raw 0-255 RGB to the 2048-d ResNet feature vector.

    The trunk is nested and applied to the rescaling output, so its `.output`
    belongs to a separate graph; the layers are re-applied to the outer input.
    """
    inputs = model.input
    x = model.get_layer('resnet_v2_preprocess')(inputs)
    return tf.keras.Model(inputs, model.get_layer('resnet50v2')(x))


def check_out_of_distribution(model, img_array, model_dir):
    """Reject images unlike anything the model was trained on.

    A classifier answers whatever it is given: fed a chest X-ray, this model
    returns a confident melanoma verdict. Softmax confidence does not detect
    that — networks are often most confident on inputs unlike their training
    data. Reconstruction error against principal components of the training
    features does: chest images flag at 100%, held-out lesions at 0.8%.

    Built by scripts/build-ood-reference.py. Absent reference file means the
    check is skipped and said so, never silently passed.
    """
    reference_path = os.path.join(model_dir, 'skin_ood_reference.npz')
    if not os.path.exists(reference_path):
        return None, None, 'No OOD reference installed; domain check skipped.'

    try:
        reference = np.load(reference_path)
        mean = reference['mean'].astype(np.float64)
        components = reference['components'].astype(np.float64)
        threshold = float(reference['threshold'])

        features = _feature_extractor(model).predict(img_array, verbose=0).astype(np.float64)
        centred = features - mean
        reconstructed = (centred @ components.T) @ components
        error = float(np.linalg.norm(centred - reconstructed, axis=1)[0])

        return error > threshold, {'score': round(error, 3), 'threshold': round(threshold, 3)}, None
    except Exception as exc:
        return None, None, f'OOD check failed to run: {exc}'


def load_calibration(model_dir):
    """Temperature for the softmax output, if a fitted correction was deployed."""
    path = os.path.join(model_dir, 'skin_model_calibration.json')
    if not os.path.exists(path):
        return 1.0
    try:
        with open(path) as f:
            return float(json.load(f).get('temperature', 1.0)) or 1.0
    except Exception:
        return 1.0


def apply_temperature(probs, temperature):
    if temperature == 1.0:
        return probs
    logits = np.log(np.clip(probs, 1e-12, 1.0)) / temperature
    logits -= logits.max()
    exp = np.exp(logits)
    return exp / exp.sum()


def predict_skin_cancer(image_path, model_path=None):
    """Predict skin cancer from image.

    Returns a prediction ONLY when the trained model actually ran on an image it
    is competent to assess. Missing model, unusable image, or an input unlike the
    training distribution each produce a non-diagnostic status — never a default
    'benign', which is a false negative a clinician cannot tell from a real one.
    """
    try:
        img_array = preprocess_image(image_path)
        if img_array is None:
            return {
                'prediction': 'Error',
                'confidence': 0,
                'error': 'Failed to preprocess image'
            }

        if not (model_path and os.path.exists(model_path)):
            return {
                'prediction': 'unavailable',
                'confidence': None,
                'probabilities': None,
                'error': (
                    f'Skin cancer model not found at {model_path}'
                    if model_path else 'No model path supplied to skin cancer model'
                )
            }

        # Cheap pixel checks first — no need to load the model for a blank frame.
        quality_failures = check_image_quality(img_array)
        if quality_failures:
            return {
                'prediction': 'rejected_input',
                'confidence': None,
                'probabilities': None,
                'reasons': quality_failures,
                'error': 'Image failed quality checks and was not classified.'
            }

        model_dir = os.path.dirname(model_path)
        model = tf.keras.models.load_model(model_path)

        is_ood, ood_detail, ood_note = check_out_of_distribution(model, img_array, model_dir)
        if is_ood:
            return {
                'prediction': 'rejected_input',
                'confidence': None,
                'probabilities': None,
                'reasons': [
                    'This image does not resemble the dermoscopic images the model was '
                    'trained on, so no classification was produced.'
                ],
                'oodScore': ood_detail,
                'error': 'Input is outside the model\'s training distribution.'
            }

        predictions = model.predict(img_array, verbose=0)
        probs = apply_temperature(predictions[0], load_calibration(model_dir))

        # Class index order is fixed by training: 0=benign, 1=malignant.
        # Recorded in dataset/data/skin_model_training.json.
        benign_prob = float(probs[0])
        malignant_prob = float(probs[1])

        if malignant_prob > 0.7:
            prediction = 'malignant'
            confidence = malignant_prob * 100
        elif malignant_prob > 0.3:
            prediction = 'uncertain'
            confidence = max(benign_prob, malignant_prob) * 100
        else:
            prediction = 'benign'
            confidence = benign_prob * 100

        result = {
            'prediction': prediction,
            'confidence': confidence,
            'probabilities': {
                'benign': benign_prob,
                'malignant': malignant_prob
            }
        }
        if ood_detail:
            result['oodScore'] = ood_detail
        if ood_note:
            result['oodNote'] = ood_note
        return result

    except Exception as e:
        return {
            'prediction': 'Error',
            'confidence': 0,
            'error': str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            'prediction': 'Error',
            'confidence': 0,
            'error': 'No image path provided'
        }))
        sys.exit(1)

    image_path = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = predict_skin_cancer(image_path, model_path)
    print(json.dumps(result))
