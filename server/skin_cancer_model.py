import sys
import json
import numpy as np
import os
from PIL import Image
import tensorflow as tf

def preprocess_image(image_path):
    """Load an image as raw RGB 0-255, resized to the model's input size.

    Deliberately NO normalisation here. The served model begins with a Rescaling
    layer that applies resnet_v2's x/127.5-1 inside the graph, so training and
    inference cannot drift apart on normalisation. Dividing by 255 here would
    silently double-scale the input.

    See scripts/train-skin-cancer-model.py and MODEL_CARDS.md.
    """
    try:
        img = Image.open(image_path).convert('RGB').resize((224, 224))
        img_array = np.array(img, dtype=np.float32)
        return np.expand_dims(img_array, axis=0)
    except Exception:
        return None

def predict_skin_cancer(image_path, model_path=None):
    """Predict skin cancer from image.

    Returns a prediction ONLY when the trained model actually ran. When the model
    is missing, the caller gets prediction='unavailable' — never a default 'benign'.
    A fabricated benign result is a false negative a clinician cannot tell apart
    from a real one.
    """
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
            
            # Class index order is fixed by training: 0=benign, 1=malignant.
            # Recorded in dataset/data/skin_model_training.json.
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
            return {
                'prediction': 'unavailable',
                'confidence': None,
                'probabilities': None,
                'error': (
                    f'Skin cancer model not found at {model_path}'
                    if model_path else 'No model path supplied to skin cancer model'
                )
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