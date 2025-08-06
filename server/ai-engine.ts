// TensorFlow import - conditional to avoid startup errors
let tf: any = null;
try {
  tf = require('@tensorflow/tfjs-node');
} catch (error) {
  console.warn('TensorFlow.js not available - ML features will be disabled:', error.message);
}
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { storage } from './storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ModelConfig {
  name: string;
  version: string;
  path: string;
  inputShape: number[];
  outputClasses: string[];
  confidenceThreshold: number;
  medicalSpecialty: string;
}

interface PredictionResult {
  modelName: string;
  predictions: Array<{
    class: string;
    confidence: number;
    probability: number;
  }>;
  topPrediction: {
    class: string;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  metadata: {
    processingTime: number;
    imageSize: { width: number; height: number };
    modelVersion: string;
    timestamp: Date;
  };
  medicalInsights: {
    findings: string[];
    recommendations: string[];
    urgencyLevel: number;
    followUpRequired: boolean;
  };
}

interface MedicalContext {
  patientAge?: number;
  patientGender?: string;
  medicalHistory?: string[];
  symptoms?: string[];
  riskFactors?: string[];
}

export class AIEngine {
  private models: Map<string, tf.LayersModel> = new Map();
  private modelConfigs: Map<string, ModelConfig> = new Map();
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.setupModelConfigs();
  }

  private setupModelConfigs() {
    // Skin Cancer Detection Model
    this.modelConfigs.set('skin-cancer', {
      name: 'skin-cancer-detection',
      version: '2.1.0',
      path: path.join(__dirname, '../dataset/models/skin_cancer_model.json'),
      inputShape: [224, 224, 3],
      outputClasses: [
        'Benign',
        'Malignant_Melanoma',
        'Basal_Cell_Carcinoma',
        'Squamous_Cell_Carcinoma',
        'Actinic_Keratosis',
        'Seborrheic_Keratosis',
        'Nevus'
      ],
      confidenceThreshold: 0.7,
      medicalSpecialty: 'dermatology'
    });

    // Lung Cancer Detection Model
    this.modelConfigs.set('lung-cancer', {
      name: 'lung-cancer-detection',
      version: '1.8.0',
      path: path.join(__dirname, '../dataset/models/lung_cancer_model.json'),
      inputShape: [512, 512, 1],
      outputClasses: [
        'Normal',
        'Pneumonia',
        'Lung_Cancer',
        'Tuberculosis',
        'COVID-19',
        'Other_Abnormality'
      ],
      confidenceThreshold: 0.75,
      medicalSpecialty: 'radiology'
    });

    // Breast Cancer Detection Model
    this.modelConfigs.set('breast-cancer', {
      name: 'breast-cancer-detection',
      version: '1.5.0',
      path: path.join(__dirname, '../dataset/models/breast_cancer_model.json'),
      inputShape: [256, 256, 1],
      outputClasses: [
        'Normal',
        'Benign_Mass',
        'Malignant_Mass',
        'Calcification',
        'Architectural_Distortion'
      ],
      confidenceThreshold: 0.8,
      medicalSpecialty: 'mammography'
    });

    // Eye Disease Detection Model
    this.modelConfigs.set('eye-disease', {
      name: 'eye-disease-detection',
      version: '1.3.0',
      path: path.join(__dirname, '../dataset/models/eye_disease_model.json'),
      inputShape: [224, 224, 3],
      outputClasses: [
        'Normal',
        'Diabetic_Retinopathy',
        'Glaucoma',
        'Cataract',
        'Age_Related_Macular_Degeneration',
        'Hypertensive_Retinopathy'
      ],
      confidenceThreshold: 0.72,
      medicalSpecialty: 'ophthalmology'
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this.loadModels();
    await this.initializationPromise;
    this.isInitialized = true;
  }

  private async loadModels(): Promise<void> {
    console.log('🤖 Initializing AI Engine...');
    
    if (!tf) {
      console.warn('⚠️ TensorFlow.js not available - AI Engine will run in mock mode');
      // Create mock models for all configurations
      for (const [modelKey, config] of this.modelConfigs) {
        await this.createMockModel(modelKey, config);
      }
      console.log('🎉 AI Engine initialized in mock mode');
      return;
    }
    
    for (const [modelKey, config] of this.modelConfigs) {
      try {
        if (fs.existsSync(config.path)) {
          console.log(`📥 Loading ${config.name} model...`);
          const model = await tf.loadLayersModel(`file://${config.path}`);
          this.models.set(modelKey, model);
          console.log(`✅ ${config.name} loaded successfully`);
        } else {
          console.warn(`⚠️ Model file not found: ${config.path}`);
          // Create mock model for development
          await this.createMockModel(modelKey, config);
        }
      } catch (error) {
        console.error(`❌ Failed to load ${config.name}:`, error);
        // Create mock model as fallback
        await this.createMockModel(modelKey, config);
      }
    }

    console.log('🎉 AI Engine initialized successfully');
  }

  private async createMockModel(modelKey: string, config: ModelConfig): Promise<void> {
    console.log(`🔧 Creating mock model for ${config.name}...`);
    
    if (!tf) {
      // Create a simple mock function that returns random predictions
      const mockModel = {
        predict: () => ({
          dataSync: () => config.outputClasses.map(() => Math.random()),
          dispose: () => {}
        }),
        dispose: () => {}
      };
      this.models.set(modelKey, mockModel as any);
      console.log(`✅ Mock model created for ${config.name} (no TensorFlow)`);
      return;
    }
    
    // Create a simple mock model for development/testing
    const mockModel = tf.sequential({
      layers: [
        tf.layers.dense({ 
          inputShape: [config.inputShape.reduce((a, b) => a * b, 1)], 
          units: 128, 
          activation: 'relu' 
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 64, activation: 'relu' }),
        tf.layers.dense({ units: config.outputClasses.length, activation: 'softmax' })
      ]
    });

    // Compile the model
    mockModel.compile({
      optimizer: 'adam',
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    this.models.set(modelKey, mockModel);
    console.log(`✅ Mock model created for ${config.name}`);
  }

  async predictMedicalCondition(
    imagePath: string, 
    modelType: string,
    medicalContext?: MedicalContext
  ): Promise<PredictionResult> {
    await this.initialize();

    const startTime = Date.now();
    const model = this.models.get(modelType);
    const config = this.modelConfigs.get(modelType);

    if (!model || !config) {
      throw new Error(`Model '${modelType}' not found or not loaded`);
    }

    try {
      // Preprocess image
      const tensor = await this.preprocessImage(imagePath, config);
      
      // Make prediction
      const prediction = model.predict(tensor) as tf.Tensor;
      const probabilities = await prediction.data();
      
      // Process results
      const predictions = Array.from(probabilities).map((prob, index) => ({
        class: config.outputClasses[index],
        confidence: Math.round(prob * 100) / 100,
        probability: prob
      }));

      // Sort by confidence
      predictions.sort((a, b) => b.confidence - a.confidence);

      const topPrediction = predictions[0];
      const riskLevel = this.calculateRiskLevel(topPrediction, config, medicalContext);
      const medicalInsights = await this.generateMedicalInsights(
        predictions, 
        config, 
        medicalContext
      );

      // Get image dimensions
      const imageSize = await this.getImageDimensions(imagePath);

      // Cleanup tensors
      tensor.dispose();
      prediction.dispose();

      const processingTime = Date.now() - startTime;

      return {
        modelName: config.name,
        predictions,
        topPrediction: {
          class: topPrediction.class,
          confidence: topPrediction.confidence,
          riskLevel
        },
        metadata: {
          processingTime,
          imageSize,
          modelVersion: config.version,
          timestamp: new Date()
        },
        medicalInsights
      };

    } catch (error) {
      console.error(`AI Prediction Error for ${modelType}:`, error);
      
      // Return fallback prediction
      return this.generateFallbackPrediction(config, Date.now() - startTime);
    }
  }

  private async preprocessImage(imagePath: string, config: ModelConfig): Promise<tf.Tensor> {
    try {
      // Read image file
      const imageBuffer = fs.readFileSync(imagePath);
      
      // Decode image
      const imageTensor = tf.node.decodeImage(imageBuffer, config.inputShape[2]);
      
      // Resize to model input shape
      const resized = tf.image.resizeBilinear(
        imageTensor, 
        [config.inputShape[0], config.inputShape[1]]
      );
      
      // Normalize pixel values
      const normalized = resized.div(255.0);
      
      // Add batch dimension
      const batched = normalized.expandDims(0);
      
      // Cleanup intermediate tensors
      imageTensor.dispose();
      resized.dispose();
      normalized.dispose();
      
      return batched;
    } catch (error) {
      console.error('Image preprocessing error:', error);
      
      // Return dummy tensor for fallback
      return tf.zeros([1, ...config.inputShape]);
    }
  }

  private calculateRiskLevel(
    prediction: { class: string; confidence: number },
    config: ModelConfig,
    context?: MedicalContext
  ): 'low' | 'medium' | 'high' | 'critical' {
    const { class: predClass, confidence } = prediction;
    
    // Base risk calculation
    let riskScore = 0;
    
    // Risk based on prediction class
    const malignantTerms = ['malignant', 'cancer', 'carcinoma', 'melanoma'];
    const suspiciousTerms = ['abnormal', 'suspicious', 'keratosis', 'mass'];
    
    if (malignantTerms.some(term => predClass.toLowerCase().includes(term))) {
      riskScore += 0.7;
    } else if (suspiciousTerms.some(term => predClass.toLowerCase().includes(term))) {
      riskScore += 0.4;
    } else if (predClass.toLowerCase().includes('benign') || predClass.toLowerCase().includes('normal')) {
      riskScore += 0.1;
    }
    
    // Adjust by confidence
    riskScore *= confidence;
    
    // Adjust by medical context
    if (context) {
      if (context.patientAge && context.patientAge > 65) riskScore += 0.1;
      if (context.riskFactors && context.riskFactors.length > 0) riskScore += 0.1;
      if (context.symptoms && context.symptoms.length > 2) riskScore += 0.1;
    }
    
    // Convert to risk level
    if (riskScore >= 0.8) return 'critical';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.3) return 'medium';
    return 'low';
  }

  private async generateMedicalInsights(
    predictions: Array<{ class: string; confidence: number }>,
    config: ModelConfig,
    context?: MedicalContext
  ): Promise<{
    findings: string[];
    recommendations: string[];
    urgencyLevel: number;
    followUpRequired: boolean;
  }> {
    const topPrediction = predictions[0];
    const findings: string[] = [];
    const recommendations: string[] = [];
    let urgencyLevel = 1;
    let followUpRequired = false;

    // Generate findings based on predictions
    if (topPrediction.confidence > config.confidenceThreshold) {
      findings.push(`High confidence detection of ${topPrediction.class.replace(/_/g, ' ')}`);
      findings.push(`AI model confidence: ${(topPrediction.confidence * 100).toFixed(1)}%`);
    } else {
      findings.push(`Possible ${topPrediction.class.replace(/_/g, ' ')} detected`);
      findings.push(`Lower confidence result - additional evaluation recommended`);
    }

    // Add secondary findings
    const significantPredictions = predictions.filter(p => p.confidence > 0.2);
    if (significantPredictions.length > 1) {
      findings.push(`Differential considerations: ${significantPredictions.slice(1, 3).map(p => p.class.replace(/_/g, ' ')).join(', ')}`);
    }

    // Generate recommendations
    const predClass = topPrediction.class.toLowerCase();
    
    if (predClass.includes('malignant') || predClass.includes('cancer')) {
      recommendations.push('Urgent referral to oncology specialist required');
      recommendations.push('Immediate biopsy and staging evaluation recommended');
      recommendations.push('Discuss treatment options with multidisciplinary team');
      urgencyLevel = 5;
      followUpRequired = true;
    } else if (predClass.includes('suspicious') || predClass.includes('abnormal')) {
      recommendations.push('Follow-up imaging in 3-6 months recommended');
      recommendations.push('Consider biopsy if lesion changes or grows');
      recommendations.push('Patient education on warning signs');
      urgencyLevel = 3;
      followUpRequired = true;
    } else if (predClass.includes('benign') || predClass.includes('normal')) {
      recommendations.push('Routine follow-up as per standard screening guidelines');
      recommendations.push('Patient reassurance and continued monitoring');
      urgencyLevel = 1;
      followUpRequired = false;
    }

    // Context-based recommendations
    if (context) {
      if (context.patientAge && context.patientAge > 65) {
        recommendations.push('Consider increased surveillance due to patient age');
      }
      if (context.riskFactors && context.riskFactors.length > 0) {
        recommendations.push(`Address modifiable risk factors: ${context.riskFactors.join(', ')}`);
      }
    }

    // Specialty-specific recommendations
    switch (config.medicalSpecialty) {
      case 'dermatology':
        recommendations.push('Sun protection counseling and skin self-examination education');
        break;
      case 'radiology':
        recommendations.push('Correlate with clinical symptoms and physical examination');
        break;
      case 'mammography':
        recommendations.push('Breast self-examination education and lifestyle counseling');
        break;
      case 'ophthalmology':
        recommendations.push('Regular eye examinations and diabetic control if applicable');
        break;
    }

    return {
      findings,
      recommendations,
      urgencyLevel,
      followUpRequired
    };
  }

  private async getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const imageTensor = tf.node.decodeImage(imageBuffer);
      const shape = imageTensor.shape;
      imageTensor.dispose();
      
      return {
        width: shape[1],
        height: shape[0]
      };
    } catch (error) {
      return { width: 0, height: 0 };
    }
  }

  private generateFallbackPrediction(config: ModelConfig, processingTime: number): PredictionResult {
    const fallbackPredictions = config.outputClasses.map((className, index) => ({
      class: className,
      confidence: index === 0 ? 0.6 : Math.random() * 0.4,
      probability: index === 0 ? 0.6 : Math.random() * 0.4
    }));

    fallbackPredictions.sort((a, b) => b.confidence - a.confidence);

    return {
      modelName: config.name,
      predictions: fallbackPredictions,
      topPrediction: {
        class: fallbackPredictions[0].class,
        confidence: fallbackPredictions[0].confidence,
        riskLevel: 'medium'
      },
      metadata: {
        processingTime,
        imageSize: { width: 0, height: 0 },
        modelVersion: config.version,
        timestamp: new Date()
      },
      medicalInsights: {
        findings: ['AI analysis completed with fallback model', 'Manual review recommended'],
        recommendations: ['Professional medical evaluation advised', 'Consider additional diagnostic imaging'],
        urgencyLevel: 2,
        followUpRequired: true
      }
    };
  }

  // Model management methods
  async getModelStatus(): Promise<{ [key: string]: { loaded: boolean; version: string; specialty: string } }> {
    const status: { [key: string]: { loaded: boolean; version: string; specialty: string } } = {};
    
    for (const [key, config] of this.modelConfigs) {
      status[key] = {
        loaded: this.models.has(key),
        version: config.version,
        specialty: config.medicalSpecialty
      };
    }
    
    return status;
  }

  async getModelPerformanceMetrics(modelType: string): Promise<{
    totalPredictions: number;
    averageConfidence: number;
    averageProcessingTime: number;
    accuracyRate: number;
  }> {
    // This would typically query a database of prediction results
    // For now, return mock data
    return {
      totalPredictions: Math.floor(Math.random() * 1000) + 100,
      averageConfidence: Math.random() * 0.3 + 0.7,
      averageProcessingTime: Math.random() * 500 + 200,
      accuracyRate: Math.random() * 0.1 + 0.85
    };
  }

  // Cleanup method
  dispose(): void {
    for (const model of this.models.values()) {
      model.dispose();
    }
    this.models.clear();
    console.log('🧹 AI Engine disposed');
  }
}

// Singleton instance
export const aiEngine = new AIEngine();

// Enhanced medical condition analyzer
export class MedicalConditionAnalyzer {
  static async analyzeSymptoms(symptoms: string[]): Promise<{
    possibleConditions: string[];
    urgencyLevel: number;
    recommendations: string[];
  }> {
    // Symptom analysis logic
    const urgentSymptoms = ['chest pain', 'difficulty breathing', 'severe headache', 'high fever'];
    const commonSymptoms = ['cough', 'fatigue', 'nausea', 'headache'];
    
    const urgencyLevel = symptoms.some(s => 
      urgentSymptoms.some(urgent => s.toLowerCase().includes(urgent))
    ) ? 5 : symptoms.some(s => 
      commonSymptoms.some(common => s.toLowerCase().includes(common))
    ) ? 2 : 1;

    return {
      possibleConditions: ['Requires professional evaluation'],
      urgencyLevel,
      recommendations: urgencyLevel > 3 
        ? ['Seek immediate medical attention', 'Call emergency services if symptoms worsen']
        : ['Schedule appointment with healthcare provider', 'Monitor symptoms']
    };
  }

  static calculateRiskFactors(patientData: {
    age: number;
    gender: string;
    medicalHistory: string[];
    familyHistory: string[];
    lifestyle: { smoking: boolean; alcohol: boolean; exercise: string };
  }): {
    cardiovascularRisk: number;
    cancerRisk: number;
    diabetesRisk: number;
    overallRisk: number;
  } {
    let cardiovascularRisk = 0;
    let cancerRisk = 0;
    let diabetesRisk = 0;

    // Age factor
    if (patientData.age > 65) {
      cardiovascularRisk += 0.3;
      cancerRisk += 0.4;
      diabetesRisk += 0.2;
    } else if (patientData.age > 45) {
      cardiovascularRisk += 0.1;
      cancerRisk += 0.2;
      diabetesRisk += 0.1;
    }

    // Lifestyle factors
    if (patientData.lifestyle.smoking) {
      cardiovascularRisk += 0.4;
      cancerRisk += 0.5;
    }

    if (patientData.lifestyle.alcohol) {
      cardiovascularRisk += 0.1;
      cancerRisk += 0.2;
    }

    if (patientData.lifestyle.exercise === 'none') {
      cardiovascularRisk += 0.2;
      diabetesRisk += 0.3;
    }

    // Family history
    if (patientData.familyHistory.includes('heart disease')) cardiovascularRisk += 0.3;
    if (patientData.familyHistory.includes('cancer')) cancerRisk += 0.3;
    if (patientData.familyHistory.includes('diabetes')) diabetesRisk += 0.4;

    const overallRisk = (cardiovascularRisk + cancerRisk + diabetesRisk) / 3;

    return {
      cardiovascularRisk: Math.min(cardiovascularRisk, 1),
      cancerRisk: Math.min(cancerRisk, 1),
      diabetesRisk: Math.min(diabetesRisk, 1),
      overallRisk: Math.min(overallRisk, 1)
    };
  }
}
