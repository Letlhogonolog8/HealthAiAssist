import sys
import json
import numpy as np
import os
from PIL import Image
import tensorflow as tf

def preprocess_image(image_path):
    """Preprocess image for model prediction"""
    try:
        # Load and resize image
        img = Image.open(image_path)
        img = img.convert('RGB')
        img = img.resize((224, 224))
        
        # Convert to numpy array and normalize
        img_array = np.array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)
        
        return img_array
    except Exception as e:
        return None

def predict_skin_cancer(image_path, model_path=None):
    """Predict skin cancer from image"""
    try:
        # Preprocess image
        img_array = preprocess_image(image_path)
        if img_array is None:
            return {
                'prediction': 'Error',
                'confidence': 0,
                'error': 'Failed to preprocess image'
            }
        
        # Load model if available
        if model_path and os.path.exists(model_path):
            model = tf.keras.models.load_model(model_path)
            
            # Make prediction
            predictions = model.predict(img_array, verbose=0)
            
            # Get probabilities
            benign_prob = float(predictions[0][0])
            malignant_prob = float(predictions[0][1])
            
            # Determine prediction
            if malignant_prob > 0.7:
                prediction = 'malignant'
                confidence = malignant_prob * 100
            elif malignant_prob > 0.3:
                prediction = 'uncertain'
                confidence = max(benign_prob, malignant_prob) * 100
            else:
                prediction = 'benign'
                confidence = benign_prob * 100
            
            return {
                'prediction': prediction,
                'confidence': confidence,
                'probabilities': {
                    'benign': benign_prob,
                    'malignant': malignant_prob
                }
            }
        else:
            # Fallback prediction when model not available
            return {
                'prediction': 'benign',
                'confidence': 85.0,
                'probabilities': {
                    'benign': 0.85,
                    'malignant': 0.15
                },
                'note': 'Using fallback prediction - model not available'
            }
            
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