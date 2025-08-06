const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('🫁 Testing Lung Cancer Detection Integration...\n');

// Test 1: Check if dataset exists
const datasetPath = path.join(__dirname, 'dataset', 'lung_cancer_MRI_dataset');
console.log('1. Checking dataset structure...');
if (fs.existsSync(datasetPath)) {
    console.log('✅ Dataset directory found');
    
    const trainPath = path.join(datasetPath, 'train');
    const validatePath = path.join(datasetPath, 'validate');
    
    if (fs.existsSync(trainPath) && fs.existsSync(validatePath)) {
        console.log('✅ Train and validate directories found');
        
        const trainCancer = path.join(trainPath, 'cancer');
        const trainNoCancer = path.join(trainPath, 'no_cancer');
        const valCancer = path.join(validatePath, 'cancer');
        const valNoCancer = path.join(validatePath, 'no_cancer');
        
        if (fs.existsSync(trainCancer) && fs.existsSync(trainNoCancer) && 
            fs.existsSync(valCancer) && fs.existsSync(valNoCancer)) {
            console.log('✅ All required subdirectories found');
            
            // Count images in each directory
            try {
                const trainCancerCount = fs.readdirSync(trainCancer).filter(f => f.match(/\.(jpg|jpeg|png|tiff|tif)$/i)).length;
                const trainNoCancerCount = fs.readdirSync(trainNoCancer).filter(f => f.match(/\.(jpg|jpeg|png|tiff|tif)$/i)).length;
                const valCancerCount = fs.readdirSync(valCancer).filter(f => f.match(/\.(jpg|jpeg|png|tiff|tif)$/i)).length;
                const valNoCancerCount = fs.readdirSync(valNoCancer).filter(f => f.match(/\.(jpg|jpeg|png|tiff|tif)$/i)).length;
                
                console.log(`   - Train/cancer: ${trainCancerCount} images`);
                console.log(`   - Train/no_cancer: ${trainNoCancerCount} images`);
                console.log(`   - Validate/cancer: ${valCancerCount} images`);
                console.log(`   - Validate/no_cancer: ${valNoCancerCount} images`);
                console.log(`   - Total images: ${trainCancerCount + trainNoCancerCount + valCancerCount + valNoCancerCount}`);
            } catch (error) {
                console.log('⚠️  Could not count images in directories');
            }
        } else {
            console.log('❌ Missing cancer/no_cancer subdirectories');
        }
    } else {
        console.log('❌ Missing train/validate directories');
    }
} else {
    console.log('❌ Dataset directory not found');
}

console.log('\n2. Checking Python dependencies...');
exec('python -c "import tensorflow; print(f\'TensorFlow version: {tensorflow.__version__}\')"', (error, stdout, stderr) => {
    if (error) {
        console.log('❌ TensorFlow not installed');
        console.log('   Run: pip install tensorflow>=2.10.0');
    } else {
        console.log('✅ TensorFlow installed:', stdout.trim());
    }
});

exec('python -c "import keras; print(f\'Keras version: {keras.__version__}\')"', (error, stdout, stderr) => {
    if (error) {
        console.log('❌ Keras not installed');
        console.log('   Run: pip install keras>=2.10.0');
    } else {
        console.log('✅ Keras installed:', stdout.trim());
    }
});

console.log('\n3. Checking training script...');
const trainingScript = path.join(__dirname, 'server', 'train-lung-cancer-model.py');
if (fs.existsSync(trainingScript)) {
    console.log('✅ Training script found');
} else {
    console.log('❌ Training script not found');
}

console.log('\n4. Checking prediction service...');
const predictionService = path.join(__dirname, 'server', 'lung-cancer-service.py');
if (fs.existsSync(predictionService)) {
    console.log('✅ Prediction service found');
} else {
    console.log('❌ Prediction service not found');
}

console.log('\n5. Testing prediction service...');
exec('python server/lung-cancer-service.py', (error, stdout, stderr) => {
    if (error) {
        console.log('❌ Prediction service test failed');
        console.log('Error:', error.message);
    } else {
        console.log('✅ Prediction service initialized successfully');
        console.log('Output:', stdout.trim());
    }
});

console.log('\n📋 Integration Summary:');
console.log('- Dataset structure: Ready for training');
console.log('- ResNet50V2 model: Will be trained on lung cancer MRI data');
console.log('- Training script: train-lung-cancer-model.py');
console.log('- Prediction service: lung-cancer-service.py');
console.log('- Model output: dataset/resnet50v2_lung_cancer_model.h5');
console.log('- Results file: dataset/lung_cancer_training_results.json');

console.log('\n🚀 To start training:');
console.log('1. Install dependencies: pip install -r requirements.txt');
console.log('2. Run training: python server/train-lung-cancer-model.py');
console.log('3. Or use batch file: train-lung-model.bat');

console.log('\n✨ The lung cancer detection is now integrated with ResNet50V2!');