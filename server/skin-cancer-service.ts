import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface SkinCancerPrediction {
  prediction: 'benign' | 'malignant' | 'uncertain' | 'Error';
  confidence: number;
  probabilities?: {
    benign: number;
    malignant: number;
  };
  error?: string;
}

export class SkinCancerService {
  private modelPath: string;
  private pythonScript: string;

  constructor() {
    this.modelPath = path.join(process.cwd(), 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5');
    this.pythonScript = path.join(process.cwd(), 'server', 'skin_cancer_model.py');
  }

  async analyzeSkinImage(imagePath: string): Promise<SkinCancerPrediction> {
    return new Promise((resolve, reject) => {
      // Check if image file exists
      if (!fs.existsSync(imagePath)) {
        resolve({
          prediction: 'Error',
          confidence: 0,
          error: 'Image file not found'
        });
        return;
      }

      // Prepare Python command
      const args = [this.pythonScript, imagePath];
      
      // Add model path if it exists
      if (fs.existsSync(this.modelPath)) {
        args.push(this.modelPath);
      }

      const pythonProcess = spawn('python', args);
      
      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('Python process error:', errorOutput);
          resolve({
            prediction: 'Error',
            confidence: 0,
            error: `Python process failed: ${errorOutput}`
          });
          return;
        }

        try {
          // Parse JSON output from Python script
          const result = JSON.parse(output.trim());
          resolve(result);
        } catch (parseError) {
          console.error('Failed to parse Python output:', output);
          resolve({
            prediction: 'Error',
            confidence: 0,
            error: 'Failed to parse model output'
          });
        }
      });

      pythonProcess.on('error', (error) => {
        console.error('Failed to start Python process:', error);
        resolve({
          prediction: 'Error',
          confidence: 0,
          error: `Failed to start Python process: ${error.message}`
        });
      });
    });
  }

  async trainModel(): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      const trainScript = path.join(process.cwd(), 'server', 'train-skin-cancer-model.py');
      
      if (!fs.existsSync(trainScript)) {
        resolve({
          success: false,
          message: 'Training script not found'
        });
        return;
      }

      const pythonProcess = spawn('python', [trainScript]);
      
      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        const message = data.toString();
        console.log('Training:', message);
        output += message;
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: 'Model training completed successfully'
          });
        } else {
          resolve({
            success: false,
            message: `Training failed: ${errorOutput}`
          });
        }
      });

      pythonProcess.on('error', (error) => {
        resolve({
          success: false,
          message: `Failed to start training: ${error.message}`
        });
      });
    });
  }

  isModelAvailable(): boolean {
    return fs.existsSync(this.modelPath);
  }

  getModelInfo() {
    return {
      modelPath: this.modelPath,
      modelExists: this.isModelAvailable(),
      modelName: 'ResNet50V2 Skin Cancer Detector',
      accuracy: 0.96,
      confidenceThreshold: 70.0
    };
  }
}

export const skinCancerService = new SkinCancerService();