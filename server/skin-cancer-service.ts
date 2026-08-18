import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface SkinCancerPrediction {
  // 'unavailable' means the model could not run; 'rejected_input' means it could
  // but the image is not something it is competent to assess. Neither is a
  // clinical finding and neither may be rendered to a user as one.
  prediction: 'benign' | 'malignant' | 'uncertain' | 'unavailable' | 'rejected_input' | 'Error';
  confidence: number | null;
  probabilities?: {
    benign: number;
    malignant: number;
  } | null;
  error?: string;
  /** Present when prediction is 'rejected_input': why the image was refused. */
  reasons?: string[];
  /** Distance from the training distribution, when the domain check ran. */
  oodScore?: { score: number; threshold: number };
}

export class SkinCancerService {
  private modelPath: string;
  private pythonScript: string;

  constructor() {
    this.modelPath =
      process.env.SKIN_CANCER_MODEL_PATH ||
      path.join(process.cwd(), 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5');
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

      // Always pass the model path. If it is missing the Python side reports
      // 'unavailable' with the path it looked in, rather than silently
      // falling back to a default prediction.
      const args = [this.pythonScript, imagePath, this.modelPath];

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
      // No accuracy is reported until the model is scored on a held-out set and
      // the result recorded in a model card. Do not hardcode a figure here.
      accuracy: null,
      confidenceThreshold: 70.0
    };
  }
}

export const skinCancerService = new SkinCancerService();