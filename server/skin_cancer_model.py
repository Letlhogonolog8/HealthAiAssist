import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras.applications import ResNet50V2
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.preprocessing.image import ImageDataGenerator
import os
import sys
import json

class SkinCancerDetector:
    def __init__(self, model_path=None):
        self.img_size = (224, 224)
        self.class_names = ['benign', 'malignant']
        self.confidence_threshold = 70.0
        self.model = None
        
        if model_path and os.path.exists(model_path):
            self.load_model(model_path)
        else:
            self.create_model()
    
    def create_model(self):
        """Create ResNet50V2 model for skin cancer detection"""
        base_model = ResNet50V2(
            weights='imagenet',
            include_top=False,
            input_shape=(224, 224, 3)
        )
        
        # Freeze base model layers
        base_model.trainable = False
        
        # Add custom classification head
        x = base_model.output
        x = GlobalAveragePooling2D()(x)
        x = Dense(128, activation='relu')(x)
        x = Dropout(0.5)(x)
        predictions = Dense(2, activation='softmax')(x)
        
        self.model = Model(inputs=base_model.input, outputs=predictions)
        
        self.model.compile(
            optimizer=Adam(learning_rate=0.001),
            loss='categorical_crossentropy',
            metrics=['accuracy']
        )
    
    def load_model(self, model_path):
        """Load pre-trained model"""
        try:
            self.model = tf.keras.models.load_model(model_path)
        except Exception as e:
            print(f"Error loading model: {e}")
            self.create_model()
    
    def preprocess_image(self, image_path_or_array):
        """Preprocess image for prediction"""
        if isinstance(image_path_or_array, str):
            image = cv2.imread(image_path_or_array)
            if image is None:
                raise ValueError("Could not load image from path")
        else:
            image = image_path_or_array
        
        # Convert BGR to RGB
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # Resize to model input size
        image_resized = cv2.resize(image_rgb, self.img_size)
        
        # Normalize pixel values
        image_array = image_resized.astype(np.float32) / 255.0
        
        # Add batch dimension
        image_array = np.expand_dims(image_array, axis=0)
        
        return image_array
    
    def predict(self, image_path_or_array):
        """Make prediction on image"""
        try:
            if self.model is None:
                return {
                    'prediction': 'Error',
                    'confidence': 0.0,
                    'error': 'Model not loaded'
                }
            
            # Preprocess image
            processed_image = self.preprocess_image(image_path_or_array)
            
            # Make prediction
            predictions = self.model.predict(processed_image, verbose=0)
            
            # Get predicted class and confidence
            predicted_index = int(np.argmax(predictions))
            confidence = float(np.max(predictions)) * 100
            
            # Apply confidence threshold
            if confidence >= self.confidence_threshold:
                prediction = self.class_names[predicted_index]
            else:
                prediction = 'uncertain'
            
            return {
                'prediction': prediction,
                'confidence': round(confidence, 2),
                'probabilities': {
                    'benign': round(float(predictions[0][0]) * 100, 2),
                    'malignant': round(float(predictions[0][1]) * 100, 2)
                }
            }
            
        except Exception as e:
            return {
                'prediction': 'Error',
                'confidence': 0.0,
                'error': str(e)
            }
    
    def train_model(self, data_dir, epochs=10, batch_size=32):
        """Train the model on skin cancer dataset"""
        train_dir = os.path.join(data_dir, 'train')
        test_dir = os.path.join(data_dir, 'test')
        
        if not os.path.exists(train_dir) or not os.path.exists(test_dir):
            raise ValueError("Training or test directory not found")
        
        # Data generators
        train_datagen = ImageDataGenerator(
            rescale=1./255,
            rotation_range=20,
            width_shift_range=0.2,
            height_shift_range=0.2,
            horizontal_flip=True,
            zoom_range=0.2,
            validation_split=0.2
        )
        
        test_datagen = ImageDataGenerator(rescale=1./255)
        
        # Training generator
        train_generator = train_datagen.flow_from_directory(
            train_dir,
            target_size=self.img_size,
            batch_size=batch_size,
            class_mode='categorical',
            subset='training'
        )
        
        # Validation generator
        validation_generator = train_datagen.flow_from_directory(
            train_dir,
            target_size=self.img_size,
            batch_size=batch_size,
            class_mode='categorical',
            subset='validation'
        )
        
        # Test generator
        test_generator = test_datagen.flow_from_directory(
            test_dir,
            target_size=self.img_size,
            batch_size=batch_size,
            class_mode='categorical'
        )
        
        # Train model
        history = self.model.fit(
            train_generator,
            epochs=epochs,
            validation_data=validation_generator,
            verbose=1
        )
        
        # Evaluate on test set
        test_loss, test_accuracy = self.model.evaluate(test_generator, verbose=0)
        
        return {
            'history': history.history,
            'test_accuracy': test_accuracy,
            'test_loss': test_loss
        }
    
    def save_model(self, model_path):
        """Save trained model"""
        if self.model:
            self.model.save(model_path)
            return True
        return False

def main():
    """Main function for command line usage"""
    if len(sys.argv) < 2:
        print("Usage: python skin-cancer-model.py <image_path> [model_path]")
        return
    
    image_path = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    # Initialize detector
    detector = SkinCancerDetector(model_path)
    
    # Make prediction
    result = detector.predict(image_path)
    
    # Output result as JSON
    print(json.dumps(result))

if __name__ == "__main__":
    main()