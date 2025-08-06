import tensorflow as tf
import numpy as np
from PIL import Image
import io
import json
import os
from datetime import datetime

class LungCancerDetector:
    def __init__(self):
        self.model_path = r"C:\Users\mudau\Videos\HealthAiAssist\dataset\lung_cancer_MRI_dataset\resnet50v2_lung_cancer_model.h5"
        self.model = None
        self.class_labels = ['cancer', 'no_cancer']
        self.img_size = (224, 224)
        self.load_model()
    
    def load_model(self):
        """Load the trained lung cancer detection model"""
        try:
            if os.path.exists(self.model_path):
                self.model = tf.keras.models.load_model(self.model_path)
                print("Lung cancer model loaded successfully")
            else:
                print(f"Model not found at {self.model_path}")
                self.model = None
        except Exception as e:
            print(f"Error loading lung cancer model: {str(e)}")
            self.model = None
    
    def preprocess_image(self, image_data):
        """Preprocess image for prediction"""
        try:
            # Open image
            image = Image.open(io.BytesIO(image_data))
            
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Resize image
            image = image.resize(self.img_size)
            
            # Convert to array and normalize
            img_array = np.array(image) / 255.0
            img_array = np.expand_dims(img_array, axis=0)
            
            return img_array
        except Exception as e:
            raise Exception(f"Error preprocessing image: {str(e)}")
    
    def predict(self, image_data):
        """Predict lung cancer from MRI image"""
        try:
            if self.model is None:
                return {
                    'prediction': 'no_cancer',
                    'confidence': 0.5,
                    'probabilities': {'cancer': 0.3, 'no_cancer': 0.7},
                    'status': 'model_unavailable',
                    'message': 'Model not loaded - using fallback prediction'
                }
            
            # Preprocess image
            processed_image = self.preprocess_image(image_data)
            
            # Make prediction
            predictions = self.model.predict(processed_image, verbose=0)
            probabilities = predictions[0]
            
            # Get predicted class
            predicted_class_idx = np.argmax(probabilities)
            predicted_class = self.class_labels[predicted_class_idx]
            confidence = float(probabilities[predicted_class_idx])
            
            # Create probability dictionary
            prob_dict = {
                label: float(prob) for label, prob in zip(self.class_labels, probabilities)
            }
            
            return {
                'prediction': predicted_class,
                'confidence': confidence,
                'probabilities': prob_dict,
                'status': 'success',
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                'prediction': 'no_cancer',
                'confidence': 0.5,
                'probabilities': {'cancer': 0.3, 'no_cancer': 0.7},
                'status': 'error',
                'message': f'Prediction error: {str(e)}'
            }

# Global instance
lung_cancer_detector = LungCancerDetector()

def predict_lung_cancer(image_data):
    """Main function to predict lung cancer"""
    return lung_cancer_detector.predict(image_data)

if __name__ == "__main__":
    import sys
    import json
    
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
                'prediction': 'no_cancer',
                'confidence': 0.5,
                'probabilities': {'cancer': 0.3, 'no_cancer': 0.7},
                'status': 'error',
                'message': f'Error processing image: {str(e)}'
            }))
    else:
        # Test the service
        print("Lung Cancer Detection Service initialized")
        print(f"Model loaded: {lung_cancer_detector.model is not None}")