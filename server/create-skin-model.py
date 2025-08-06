import tensorflow as tf
import numpy as np
import os
from tensorflow.keras.applications import ResNet50V2
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam

def create_skin_cancer_model():
    """Create a simple skin cancer detection model"""
    
    # Base model
    base_model = ResNet50V2(
        weights='imagenet',
        include_top=False,
        input_shape=(224, 224, 3)
    )
    
    # Freeze base model layers
    base_model.trainable = False
    
    # Add custom layers
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    x = Dense(128, activation='relu')(x)
    x = Dropout(0.5)(x)
    predictions = Dense(2, activation='softmax')(x)  # benign, malignant
    
    model = Model(inputs=base_model.input, outputs=predictions)
    
    # Compile model
    model.compile(
        optimizer=Adam(learning_rate=0.001),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    
    return model

def create_mock_training_data():
    """Create mock training data for demonstration"""
    # Generate random data for demonstration
    X_train = np.random.random((100, 224, 224, 3))
    y_train = tf.keras.utils.to_categorical(np.random.randint(0, 2, 100), 2)
    
    X_val = np.random.random((20, 224, 224, 3))
    y_val = tf.keras.utils.to_categorical(np.random.randint(0, 2, 20), 2)
    
    return X_train, y_train, X_val, y_val

def train_and_save_model():
    """Train and save the skin cancer model"""
    print("Creating skin cancer detection model...")
    
    model = create_skin_cancer_model()
    
    print("Generating mock training data...")
    X_train, y_train, X_val, y_val = create_mock_training_data()
    
    print("Training model...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=3,  # Quick training for demo
        batch_size=16,
        verbose=1
    )
    
    # Save model
    model_path = os.path.join('dataset', 'data', 'resnet50v2_skin_cancer_model.h5')
    model.save(model_path)
    print(f"Model saved to {model_path}")
    
    # Save training results
    results = {
        'accuracy': float(history.history['accuracy'][-1]),
        'val_accuracy': float(history.history['val_accuracy'][-1]),
        'loss': float(history.history['loss'][-1]),
        'val_loss': float(history.history['val_loss'][-1]),
        'epochs': len(history.history['accuracy'])
    }
    
    import json
    results_path = os.path.join('dataset', 'data', 'training_results.json')
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"Training results saved to {results_path}")
    print("Model training completed successfully!")
    
    return model, history

if __name__ == "__main__":
    train_and_save_model()