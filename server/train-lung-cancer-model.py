import tensorflow as tf
from tensorflow.keras.applications import ResNet50V2
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint, ReduceLROnPlateau
import os
import json
import numpy as np
from datetime import datetime

# Configuration
DATASET_PATH = r"C:\Users\mudau\Videos\HealthAiAssist\dataset\lung_cancer_MRI_dataset"
MODEL_SAVE_PATH = r"C:\Users\mudau\Videos\HealthAiAssist\dataset\lung_cancer_MRI_dataset\resnet50v2_lung_cancer_model.h5"
RESULTS_SAVE_PATH = r"C:\Users\mudau\Videos\HealthAiAssist\dataset\lung_cancer_MRI_dataset\lung_cancer_training_results.json"

IMG_SIZE = (224, 224)
BATCH_SIZE = 32
EPOCHS = 50
LEARNING_RATE = 0.0001

def create_model():
    """Create ResNet50V2 model for lung cancer detection"""
    base_model = ResNet50V2(
        weights='imagenet',
        include_top=False,
        input_shape=(*IMG_SIZE, 3)
    )
    
    # Freeze base model layers
    base_model.trainable = False
    
    # Add custom classification head
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    x = Dense(512, activation='relu')(x)
    x = Dropout(0.5)(x)
    x = Dense(256, activation='relu')(x)
    x = Dropout(0.3)(x)
    predictions = Dense(2, activation='softmax', name='predictions')(x)
    
    model = Model(inputs=base_model.input, outputs=predictions)
    return model

def prepare_data():
    """Prepare data generators"""
    train_datagen = ImageDataGenerator(
        rescale=1./255,
        rotation_range=20,
        width_shift_range=0.2,
        height_shift_range=0.2,
        horizontal_flip=True,
        zoom_range=0.2,
        shear_range=0.2,
        fill_mode='nearest'
    )
    
    val_datagen = ImageDataGenerator(rescale=1./255)
    
    train_generator = train_datagen.flow_from_directory(
        os.path.join(DATASET_PATH, 'train'),
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        classes=['cancer', 'no_cancer']
    )
    
    val_generator = val_datagen.flow_from_directory(
        os.path.join(DATASET_PATH, 'validate'),
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        classes=['cancer', 'no_cancer']
    )
    
    return train_generator, val_generator

def train_model():
    """Train the lung cancer detection model"""
    print("Starting lung cancer model training...")
    
    # Create model
    model = create_model()
    
    # Compile model
    model.compile(
        optimizer=Adam(learning_rate=LEARNING_RATE),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    
    # Prepare data
    train_gen, val_gen = prepare_data()
    
    # Callbacks
    callbacks = [
        EarlyStopping(
            monitor='val_accuracy',
            patience=10,
            restore_best_weights=True
        ),
        ModelCheckpoint(
            MODEL_SAVE_PATH,
            monitor='val_accuracy',
            save_best_only=True,
            verbose=1
        ),
        ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            min_lr=1e-7
        )
    ]
    
    # Train model
    history = model.fit(
        train_gen,
        epochs=EPOCHS,
        validation_data=val_gen,
        callbacks=callbacks,
        verbose=1
    )
    
    # Fine-tuning phase
    print("Starting fine-tuning...")
    model.layers[0].trainable = True
    
    # Freeze early layers
    for layer in model.layers[0].layers[:-20]:
        layer.trainable = False
    
    # Recompile with lower learning rate
    model.compile(
        optimizer=Adam(learning_rate=LEARNING_RATE/10),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    
    # Continue training
    fine_tune_history = model.fit(
        train_gen,
        epochs=20,
        validation_data=val_gen,
        callbacks=callbacks,
        verbose=1
    )
    
    # Combine histories
    for key in history.history:
        history.history[key].extend(fine_tune_history.history[key])
    
    # Save training results
    results = {
        'model_type': 'ResNet50V2',
        'dataset': 'Lung Cancer MRI',
        'training_date': datetime.now().isoformat(),
        'final_accuracy': float(max(history.history['val_accuracy'])),
        'final_loss': float(min(history.history['val_loss'])),
        'epochs_trained': len(history.history['accuracy']),
        'class_labels': ['cancer', 'no_cancer'],
        'history': {k: [float(x) for x in v] for k, v in history.history.items()}
    }
    
    with open(RESULTS_SAVE_PATH, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"Model saved to: {MODEL_SAVE_PATH}")
    print(f"Results saved to: {RESULTS_SAVE_PATH}")
    print(f"Final validation accuracy: {results['final_accuracy']:.4f}")
    
    return model, results

if __name__ == "__main__":
    try:
        model, results = train_model()
        print("Training completed successfully!")
    except Exception as e:
        print(f"Training failed: {str(e)}")