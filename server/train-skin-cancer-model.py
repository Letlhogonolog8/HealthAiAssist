#!/usr/bin/env python3
"""
Training script for skin cancer detection model using ResNet50V2
"""

import os
import sys
import json
from skin_cancer_model import SkinCancerDetector

def train_model():
    """Train the skin cancer detection model"""
    
    # Dataset path
    data_dir = r"C:\Users\mudau\Videos\HealthAiAssist\dataset\data"
    model_save_path = os.path.join(data_dir, "resnet50v2_skin_cancer_model.h5")
    
    print("Initializing skin cancer detector...")
    detector = SkinCancerDetector()
    
    print("Starting training...")
    try:
        results = detector.train_model(
            data_dir=data_dir,
            epochs=20,
            batch_size=32
        )
        
        print(f"Training completed!")
        print(f"Test Accuracy: {results['test_accuracy']:.4f}")
        print(f"Test Loss: {results['test_loss']:.4f}")
        
        # Save the trained model
        if detector.save_model(model_save_path):
            print(f"Model saved to: {model_save_path}")
        else:
            print("Failed to save model")
            
        # Save training results
        results_path = os.path.join(data_dir, "training_results.json")
        with open(results_path, 'w') as f:
            json.dump({
                'test_accuracy': float(results['test_accuracy']),
                'test_loss': float(results['test_loss']),
                'final_epoch_accuracy': float(results['history']['accuracy'][-1]),
                'final_epoch_val_accuracy': float(results['history']['val_accuracy'][-1])
            }, f, indent=2)
        
        print(f"Training results saved to: {results_path}")
        
    except Exception as e:
        print(f"Training failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    train_model()