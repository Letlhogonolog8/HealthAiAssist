// Advanced medical AI models for different cancer types
export const medicalModels = {
  breast: {
    name: 'BreastNet-v2',
    accuracy: 0.94,
    sensitivity: 0.92,
    specificity: 0.96,
    features: ['mass_detection', 'calcification_analysis', 'architectural_distortion'],
    preprocessing: ['contrast_enhancement', 'noise_reduction', 'roi_extraction']
  },
  
  lung: {
    name: 'ResNet50V2-LungCancer',
    accuracy: 0.91,
    sensitivity: 0.89,
    specificity: 0.93,
    features: ['deep_feature_extraction', 'nodule_detection', 'texture_analysis', 'shape_characterization'],
    preprocessing: ['resnet_preprocessing', 'normalization', 'augmentation'],
    modelPath: 'dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5',
    confidenceThreshold: 70.0
  },
  
  colon: {
    name: 'ColonScope-AI',
    accuracy: 0.88,
    sensitivity: 0.85,
    specificity: 0.91,
    features: ['polyp_detection', 'surface_pattern_analysis', 'vascular_assessment'],
    preprocessing: ['color_enhancement', 'motion_correction', 'illumination_normalization']
  },
  
  prostate: {
    name: 'ProstateVision',
    accuracy: 0.87,
    sensitivity: 0.84,
    specificity: 0.90,
    features: ['lesion_detection', 'pi_rads_scoring', 'zonal_anatomy'],
    preprocessing: ['bias_field_correction', 'registration', 'intensity_standardization']
  },
  
  skin: {
    name: 'ResNet50V2-SkinCancer',
    accuracy: 0.96,
    sensitivity: 0.94,
    specificity: 0.98,
    features: ['deep_feature_extraction', 'asymmetry_analysis', 'border_irregularity', 'color_variation', 'texture_patterns'],
    preprocessing: ['resnet_preprocessing', 'normalization', 'augmentation'],
    modelPath: 'dataset/data/resnet50v2_skin_cancer_model.h5',
    confidenceThreshold: 70.0
  }
};

// Risk stratification based on multiple factors
export function calculateRiskScore(
  scanType: string,
  aiPrediction: number,
  patientAge: number,
  familyHistory: boolean,
  symptoms: string[]
): { score: number; level: 'low' | 'medium' | 'high'; factors: string[] } {
  
  let score = aiPrediction * 40; // Base AI score (0-40 points)
  const factors: string[] = [];
  
  // Age factor
  if (patientAge > 65) {
    score += 15;
    factors.push('Advanced age (>65)');
  } else if (patientAge > 50) {
    score += 10;
    factors.push('Increased age risk (50-65)');
  }
  
  // Family history
  if (familyHistory) {
    score += 20;
    factors.push('Positive family history');
  }
  
  // Symptoms
  const highRiskSymptoms = ['pain', 'bleeding', 'mass', 'weight_loss'];
  const symptomMatches = symptoms.filter(s => 
    highRiskSymptoms.some(hrs => s.toLowerCase().includes(hrs))
  );
  
  if (symptomMatches.length > 0) {
    score += symptomMatches.length * 5;
    factors.push(`High-risk symptoms: ${symptomMatches.join(', ')}`);
  }
  
  // Scan-specific adjustments
  const model = getModelForScanType(scanType);
  if (model) {
    // Adjust based on model sensitivity/specificity
    score *= (model.sensitivity + model.specificity) / 2;
  }
  
  // Determine risk level
  let level: 'low' | 'medium' | 'high' = 'low';
  if (score >= 70) level = 'high';
  else if (score >= 40) level = 'medium';
  
  return {
    score: Math.min(Math.round(score), 100),
    level,
    factors
  };
}

function getModelForScanType(scanType: string) {
  const type = scanType.toLowerCase();
  if (type.includes('breast')) return medicalModels.breast;
  if (type.includes('lung')) return medicalModels.lung;
  if (type.includes('colon')) return medicalModels.colon;
  if (type.includes('prostate')) return medicalModels.prostate;
  if (type.includes('skin')) return medicalModels.skin;
  return null;
}

// Quality assurance metrics
export function validateAnalysisQuality(
  confidence: number,
  imageQuality: number,
  modelAccuracy: number
): { isReliable: boolean; qualityScore: number; warnings: string[] } {
  
  const warnings: string[] = [];
  let qualityScore = 100;
  
  // Check confidence threshold
  if (confidence < 70) {
    qualityScore -= 20;
    warnings.push('Low AI confidence - consider repeat imaging');
  }
  
  // Check image quality
  if (imageQuality < 80) {
    qualityScore -= 15;
    warnings.push('Suboptimal image quality detected');
  }
  
  // Check model reliability
  if (modelAccuracy < 0.85) {
    qualityScore -= 10;
    warnings.push('Model accuracy below optimal threshold');
  }
  
  const isReliable = qualityScore >= 70 && warnings.length <= 1;
  
  return {
    isReliable,
    qualityScore: Math.max(qualityScore, 0),
    warnings
  };
}