import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`🔄 Running: ${command} ${args.join(' ')}`);
        const process = spawn(command, args, { stdio: 'inherit', shell: true, ...options });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve(code);
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });
        
        process.on('error', (error) => {
            reject(error);
        });
    });
}

async function setupSkinCancerDetection() {
    console.log('🚀 Setting up Skin Cancer Detection with ResNet50V2...\n');
    
    try {
        // Step 1: Install Python dependencies
        console.log('📦 Installing Python dependencies...');
        try {
            await runCommand('pip', ['install', '-r', 'requirements.txt']);
            console.log('✅ Python dependencies installed successfully\n');
        } catch (error) {
            console.log('⚠️  pip failed, trying pip3...');
            await runCommand('pip3', ['install', '-r', 'requirements.txt']);
            console.log('✅ Python dependencies installed successfully\n');
        }
        
        // Step 2: Verify dataset structure
        console.log('📁 Verifying dataset structure...');
        const datasetPath = path.join(process.cwd(), 'dataset', 'data');
        
        if (!fs.existsSync(datasetPath)) {
            console.log('❌ Dataset directory not found. Creating structure...');
            fs.mkdirSync(path.join(datasetPath, 'train', 'benign'), { recursive: true });
            fs.mkdirSync(path.join(datasetPath, 'train', 'malignant'), { recursive: true });
            fs.mkdirSync(path.join(datasetPath, 'test', 'benign'), { recursive: true });
            fs.mkdirSync(path.join(datasetPath, 'test', 'malignant'), { recursive: true });
            console.log('✅ Dataset structure created');
        } else {
            console.log('✅ Dataset structure verified');
        }
        
        // Step 3: Check if uploads directory exists
        const uploadsPath = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsPath)) {
            fs.mkdirSync(uploadsPath, { recursive: true });
            console.log('✅ Uploads directory created');
        }
        
        // Step 4: Test Python environment
        console.log('🐍 Testing Python environment...');
        try {
            await runCommand('python', ['--version']);
        } catch (error) {
            console.log('⚠️  python not found, trying python3...');
            await runCommand('python3', ['--version']);
        }
        
        // Step 5: Test required packages
        console.log('🧪 Testing required packages...');
        const packages = ['tensorflow', 'opencv-python', 'numpy'];
        
        for (const pkg of packages) {
            try {
                const importName = pkg.replace('-', '_');
                await runCommand('python', ['-c', `import ${importName}; print('${pkg} OK')`]);
            } catch (error) {
                console.log(`❌ ${pkg} not available, attempting to install...`);
                await runCommand('pip', ['install', pkg]);
            }
        }
        
        // Step 6: Run integration test
        console.log('🧪 Running integration test...');
        await runCommand('npm', ['run', 'test-skin-integration']);
        
        console.log('\n🎉 Setup completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('1. Add your skin cancer images to dataset/data/train/ and dataset/data/test/');
        console.log('2. Run: npm run train-skin-model');
        console.log('3. Start the application: npm run dev');
        
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        console.log('\n🔧 Manual steps:');
        console.log('1. Install Python 3.8+');
        console.log('2. Run: pip install tensorflow opencv-python numpy');
        console.log('3. Ensure dataset structure exists');
        process.exit(1);
    }
}

setupSkinCancerDetection();