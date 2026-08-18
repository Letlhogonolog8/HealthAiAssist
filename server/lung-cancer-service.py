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

            # Preprocess image
            processed_image = self.preprocess_image(image_data)
            
            # Make prediction
            predictions = self.model.predict(processed_image, verbose=0)
            probabilities = predictions[0]
            
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
            'message': lung_cancer_detector.load_error or 'Lung cancer model loaded'
        }))