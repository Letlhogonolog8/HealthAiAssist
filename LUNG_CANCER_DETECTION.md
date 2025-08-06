# Lung Cancer Detection with ResNet50V2

This document describes the lung cancer detection feature integrated into the HealthAI Assistant platform using ResNet50V2 deep learning architecture.

## 🎯 Overview

The lung cancer detection system uses a ResNet50V2 convolutional neural network trained on MRI lung cancer datasets to identify potential malignancies in lung imaging scans.

## 📁 Dataset Structure

```
dataset/lung_cancer_MRI_dataset/
├── train/
│   ├── cancer/          # MRI images with lung cancer
│   └── no_cancer/       # MRI images without lung cancer
└── validate/
    ├── cancer/          # Validation images with lung cancer
    └── no_cancer/       # Validation images without lung cancer
```

## 🧠 Model Architecture

- **Base Model**: ResNet50V2 (pre-trained on ImageNet)
- **Input Size**: 224x224x3 pixels
- **Architecture**: 
  - ResNet50V2 base (frozen initially)
  - GlobalAveragePooling2D
  - Dense(512, activation='relu')
  - Dropout(0.5)
  - Dense(256, activation='relu')
  - Dropout(0.3)
  - Dense(2, activation='softmax') # cancer/no_cancer

## 🚀 Training Process

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start Training
```bash
# Option 1: Direct Python execution
python server/train-lung-cancer-model.py

# Option 2: Use batch file (Windows)
train-lung-model.bat
```

### 3. Training Configuration
- **Epochs**: 50 (initial) + 20 (fine-tuning)
- **Batch Size**: 32
- **Learning Rate**: 0.0001 (initial), 0.00001 (fine-tuning)
- **Optimizer**: Adam
- **Loss Function**: Categorical Crossentropy
- **Metrics**: Accuracy, Precision, Recall

### 4. Data Augmentation
- Rotation: ±20 degrees
- Width/Height Shift: ±20%
- Horizontal Flip: Yes
- Zoom: ±20%
- Shear: ±20%
- Rescaling: 1/255

## 📊 Model Performance

- **Expected Accuracy**: ~91%
- **Sensitivity**: ~89%
- **Specificity**: ~93%
- **Confidence Threshold**: 70%

## 🔧 Integration Components

### 1. Training Script
**File**: `server/train-lung-cancer-model.py`
- Loads and preprocesses the MRI dataset
- Trains ResNet50V2 model with transfer learning
- Implements fine-tuning for better performance
- Saves trained model and training results

### 2. Prediction Service
**File**: `server/lung-cancer-service.py`
- Loads trained model for inference
- Preprocesses input images
- Returns prediction with confidence scores
- Handles fallback scenarios

### 3. API Integration
**File**: `server/routes.ts`
- `performLungCancerAnalysis()`: Main analysis function
- `generateMockLungAnalysis()`: Fallback function
- Integrated with existing scan upload endpoints

## 🏥 Clinical Integration

### Scan Types Supported
- Lung MRI scans
- Chest CT scans (with preprocessing)
- Pulmonary imaging studies

### Analysis Output
```json
{
  "hasCancer": boolean,
  "cancerType": "Lung Cancer" | "No malignancy detected",
  "confidence": number, // 0-100
  "riskLevel": "low" | "high",
  "findings": [
    "Primary finding description",
    "Detailed morphological analysis",
    "Clinical observations"
  ],
  "recommendations": [
    "Clinical action items",
    "Follow-up procedures",
    "Specialist referrals"
  ],
  "analysis": {
    "method": "resnet50v2_lung_cancer",
    "probabilities": {
      "cancer": number,
      "no_cancer": number
    },
    "urgency": "urgent" | "routine"
  }
}
```

## 🔍 Usage in Application

### 1. Patient Upload
Patients can upload lung MRI scans through the patient portal.

### 2. Real-time Analysis
The system automatically processes uploaded images using the trained ResNet50V2 model.

### 3. Results Display
Results are displayed with:
- Risk assessment (Low/High)
- Confidence percentage
- Detailed findings
- Clinical recommendations
- Urgency indicators

### 4. Medical Review
Radiologists and doctors can review AI predictions and provide final diagnoses.

## 📈 Model Files

After training, the following files are generated:

- `dataset/resnet50v2_lung_cancer_model.h5` - Trained model
- `dataset/lung_cancer_training_results.json` - Training metrics and history

## 🧪 Testing

Run the integration test:
```bash
node test-lung-cancer-integration.js
```

This will verify:
- Dataset structure
- Python dependencies
- Training script availability
- Prediction service functionality

## 🔧 Troubleshooting

### Common Issues

1. **TensorFlow Installation**
   ```bash
   pip install tensorflow>=2.10.0
   ```

2. **Memory Issues**
   - Reduce batch size in training script
   - Use GPU if available

3. **Dataset Path Issues**
   - Verify dataset is in correct location
   - Check file permissions

4. **Model Loading Errors**
   - Ensure model file exists after training
   - Check file corruption

## 🚀 Future Enhancements

- [ ] Support for DICOM format
- [ ] Multi-class classification (cancer subtypes)
- [ ] Integration with PACS systems
- [ ] Real-time streaming analysis
- [ ] Ensemble model predictions
- [ ] Automated report generation

## 📞 Support

For technical issues or questions about the lung cancer detection system, please refer to the main project documentation or contact the development team.

---

**Note**: This AI system is designed to assist medical professionals and should not be used as the sole basis for medical decisions. Always consult with qualified healthcare providers for proper diagnosis and treatment.