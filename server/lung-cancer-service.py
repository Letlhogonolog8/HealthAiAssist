import tensorflow as tf
import numpy as np
from PIL import Image
import io
import json
import os
import sys
from datetime import datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MODEL_PATH = os.path.join(
    REPO_ROOT, "dataset", "lung_cancer_MRI_dataset", "resnet50v2_lung_cancer_model.h5"
)


class LungCancerDetector:
    def __init__(self):
        # Resolve relative to the repository so the service works on any machine.
        # LUNG_CANCER_MODEL_PATH overrides for deployments that mount the model elsewhere.
        self.model_path = os.environ.get("LUNG_CANCER_MODEL_PATH", DEFAULT_MODEL_PATH)
        self.model = None
        self.load_error = None
        self.class_labels = ['cancer', 'no_cancer']
        self.img_size = (224, 224)
        # Decision threshold on P(cancer). NOT argmax: argmax implicitly weights a
        # missed cancer the same as a false alarm, which is wrong for screening.
        # Selected on the validation split, recorded in lung_model_training.json.
        self.cancer_threshold = self._load_threshold()
        # Applied BEFORE thresholding, matching how the threshold was selected.
        # Temperature scaling is monotonic so it cannot change the ranking, but it
        # does move where a given numeric cut point sits.
        self.temperature = self._load_temperature()
        self._trunk = None
        self.load_model()

    def _load_threshold(self):
        override = os.environ.get("LUNG_CANCER_THRESHOLD")
        if override:
            try:
                return float(override)
            except ValueError:
                pass
        meta_path = os.path.join(os.path.dirname(self.model_path), "lung_model_training.json")
        try:
            with open(meta_path) as f:
                return float(json.load(f)["operatingPoint"]["cancerThreshold"])
        except Exception:
            # Falls back to argmax. Higher specificity, more missed cancers.
            return 0.5

    def _quality_failures(self, img_array):
        """Pixel-level checks for images no classifier should be asked about.

        These catch what the feature-space detector misses. A blank frame sits
        near the mean in feature space and reconstructs cleanly, so PCA scores it
        as in-distribution — measured at a 0% flag rate. Pixel statistics catch it
        immediately.
        """
        reasons = []
        grey = img_array[0].mean(axis=2)

        if float(grey.std()) < 8.0:
            reasons.append('Image is nearly uniform; there is no visible subject to assess.')

        level = float(grey.mean())
        if level < 15.0:
            reasons.append('Image is almost entirely black.')
        elif level > 240.0:
            reasons.append('Image is over-exposed to near-white.')

        laplacian = (
            -4.0 * grey[1:-1, 1:-1]
            + grey[:-2, 1:-1] + grey[2:, 1:-1]
            + grey[1:-1, :-2] + grey[1:-1, 2:]
        )
        if float(laplacian.var()) < 8.0:
            reasons.append('Image is too blurred for the model to assess.')

        return reasons

    def _feature_extractor(self):
        """Raw 0-255 RGB to the 2048-d feature vector. The trunk is nested and
        applied to the rescaling output, so its `.output` sits in a separate
        graph; the layers are re-applied to the outer input."""
        if self._trunk is None:
            inputs = self.model.input
            x = self.model.get_layer('resnet_v2_preprocess')(inputs)
            self._trunk = tf.keras.Model(inputs, self.model.get_layer('resnet50v2')(x))
        return self._trunk

    def _out_of_distribution(self, img_array):
        """Reject images unlike the training data.

        Fed a skin lesion, this model would otherwise return a confident lung
        verdict: measured, skin images flag at 100% against 0.8% for held-out
        chest images. Built by scripts/build-ood-reference.py; a missing
        reference file skips the check and says so rather than passing silently.
        """
        reference_path = os.path.join(
            os.path.dirname(self.model_path), 'lung_ood_reference.npz')
        if not os.path.exists(reference_path):
            return None, None, 'No OOD reference installed; domain check skipped.'

        try:
            reference = np.load(reference_path)
            mean = reference['mean'].astype(np.float64)
            components = reference['components'].astype(np.float64)
            threshold = float(reference['threshold'])

            features = self._feature_extractor().predict(
                img_array, verbose=0).astype(np.float64)
            centred = features - mean
            reconstructed = (centred @ components.T) @ components
            error = float(np.linalg.norm(centred - reconstructed, axis=1)[0])

            return (error > threshold,
                    {'score': round(error, 3), 'threshold': round(threshold, 3)},
                    None)
        except Exception as exc:
            return None, None, f'OOD check failed to run: {exc}'

    def _load_temperature(self):
        """Calibration temperature, if one was fitted and accepted for deployment."""
        path = os.path.join(os.path.dirname(self.model_path), "lung_model_calibration.json")
        try:
            with open(path) as f:
                return float(json.load(f).get("temperature", 1.0)) or 1.0
        except Exception:
            return 1.0

    def _apply_temperature(self, probabilities):
        if self.temperature == 1.0:
            return probabilities
        logits = np.log(np.clip(probabilities, 1e-12, 1.0)) / self.temperature
        logits -= logits.max()
        exp = np.exp(logits)
        return exp / exp.sum()

    def load_model(self):
        """Load the trained lung cancer detection model"""
        try:
            if os.path.exists(self.model_path):
                self.model = tf.keras.models.load_model(self.model_path)
                # stderr, so it never contaminates the JSON written to stdout
                print("Lung cancer model loaded successfully", file=sys.stderr)
            else:
                self.model = None
                self.load_error = f"Model file not found at {self.model_path}"
                print(self.load_error, file=sys.stderr)
        except Exception as e:
            self.model = None
            self.load_error = f"Error loading lung cancer model: {str(e)}"
            print(self.load_error, file=sys.stderr)
    
    def preprocess_image(self, image_data):
        """Load as raw RGB 0-255 at the model's input size.

        No normalisation here: the retrained model begins with a Rescaling layer
        that applies resnet_v2's x/127.5-1 inside the graph. Dividing by 255 here
        would double-scale the input — the same class of bug that made the
        previous skin artifact unusable.
        """
        try:
            image = Image.open(io.BytesIO(image_data))
            if image.mode != 'RGB':
                image = image.convert('RGB')
            image = image.resize(self.img_size)
            img_array = np.array(image, dtype=np.float32)
            return np.expand_dims(img_array, axis=0)
        except Exception as e:
            raise Exception(f"Error preprocessing image: {str(e)}")
    
    def predict(self, image_data):
        """Predict lung cancer from MRI image.

        Returns a prediction ONLY when the trained model actually ran. If the model
        is missing or inference fails, the result carries prediction=None and a
        non-success status. Never substitute a default diagnosis here: a fabricated
        'no_cancer' is a false negative that a clinician cannot distinguish from a
        real one.
        """
        try:
            if self.model is None:
                return {
                    'prediction': None,
                    'confidence': None,
                    'probabilities': None,
                    'status': 'model_unavailable',
                    'message': self.load_error or 'Lung cancer model is not loaded'
                }

            processed_image = self.preprocess_image(image_data)

            # Screen the input before classifying it. A classifier answers
            # whatever it is given; these two layers decide whether the question
            # is one this model can answer at all.
            quality_failures = self._quality_failures(processed_image)
            if quality_failures:
                return {
                    'prediction': 'rejected_input',
                    'confidence': None,
                    'probabilities': None,
                    'reasons': quality_failures,
                    'status': 'rejected_input',
                    'message': 'Image failed quality checks and was not classified.'
                }

            is_ood, ood_detail, ood_note = self._out_of_distribution(processed_image)
            if is_ood:
                return {
                    'prediction': 'rejected_input',
                    'confidence': None,
                    'probabilities': None,
                    'reasons': [
                        'This image does not resemble the chest images the model was '
                        'trained on, so no classification was produced.'
                    ],
                    'oodScore': ood_detail,
                    'status': 'rejected_input',
                    'message': "Input is outside the model's training distribution."
                }

            # Make prediction
            predictions = self.model.predict(processed_image, verbose=0)
            probabilities = self._apply_temperature(predictions[0])
            
            # Threshold on P(cancer) rather than argmax. On the held-out test set
            # argmax misses 86 of 282 cancers; the selected threshold misses 53,
            # at the cost of more false alarms.
            cancer_prob = float(probabilities[0])
            is_cancer = cancer_prob >= self.cancer_threshold
            predicted_class = 'cancer' if is_cancer else 'no_cancer'
            confidence = cancer_prob if is_cancer else float(probabilities[1])
            
            # Create probability dictionary
            prob_dict = {
                label: float(prob) for label, prob in zip(self.class_labels, probabilities)
            }
            
            return {
                'prediction': predicted_class,
                'confidence': confidence,
                'probabilities': prob_dict,
                'threshold': self.cancer_threshold,
                'temperature': self.temperature,
                'oodScore': ood_detail,
                'oodNote': ood_note,
                'status': 'success',
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                'prediction': None,
                'confidence': None,
                'probabilities': None,
                'status': 'error',
                'message': f'Prediction error: {str(e)}'
            }

# Global instance
lung_cancer_detector = LungCancerDetector()

def predict_lung_cancer(image_data):
    """Main function to predict lung cancer"""
    return lung_cancer_detector.predict(image_data)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Command line usage for image analysis
        image_path = sys.argv[1]
        try:
            with open(image_path, 'rb') as f:
                image_data = f.read()

            result = predict_lung_cancer(image_data)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({
                'prediction': None,
                'confidence': None,
                'probabilities': None,
                'status': 'error',
                'message': f'Error processing image: {str(e)}'
            }))
    else:
        # Self-check: report model availability without producing a diagnosis
        print(json.dumps({
            'status': 'ready' if lung_cancer_detector.model is not None else 'model_unavailable',
            'modelPath': lung_cancer_detector.model_path,
            'cancerThreshold': lung_cancer_detector.cancer_threshold,
            'calibrationTemperature': lung_cancer_detector.temperature,
            'message': lung_cancer_detector.load_error or 'Lung cancer model loaded'
        }))