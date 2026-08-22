import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { aiEngine, MedicalConditionAnalyzer } from './ai-engine';
import { ModelUnavailableError } from './model-availability';
import { requireAuth, requireMedicalAccess, AuthenticatedRequest } from './security-config';
import { storage } from './storage';

const router = express.Router();

// Configure multer for AI image uploads
const aiUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), 'uploads', 'ai-analysis');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `ai-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for AI analysis'));
    }
  }
});

// Advanced AI scan analysis endpoint
router.post('/analyze-scan', requireAuth, aiUpload.single('image'), async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { modelType, patientAge, patientGender, medicalHistory, symptoms, riskFactors } = req.body;
    
    if (!modelType) {
      return res.status(400).json({ error: 'Model type is required' });
    }

    // Parse medical context
    const medicalContext = {
      patientAge: patientAge ? parseInt(patientAge) : undefined,
      patientGender,
      medicalHistory: medicalHistory ? JSON.parse(medicalHistory) : [],
      symptoms: symptoms ? JSON.parse(symptoms) : [],
      riskFactors: riskFactors ? JSON.parse(riskFactors) : []
    };

    console.log(`🤖 Starting AI analysis: ${modelType} for user ${req.session.user?.id}`);

    // Perform AI prediction
    const prediction = await aiEngine.predictMedicalCondition(
      req.file.path,
      modelType,
      medicalContext
    );

    // Save analysis to database
    const scanData = {
      patientId: req.session.user?.id,
      scanType: modelType,
      imagePath: req.file.path,
      aiConfidence: `${(prediction.topPrediction.confidence * 100).toFixed(1)}%`,
      result: prediction.topPrediction.class,
      findings: prediction.medicalInsights.findings.join('; '),
      recommendations: prediction.medicalInsights.recommendations.join('; '),
      riskLevel: prediction.topPrediction.riskLevel,
      processingTime: prediction.metadata.processingTime,
      imageSize: JSON.stringify(prediction.metadata.imageSize),
      status: prediction.topPrediction.riskLevel === 'critical' ? 'urgent' : 'pending',
      priority: prediction.medicalInsights.urgencyLevel > 3 ? 'high' : 'medium',
      notes: `AI Model: ${prediction.modelName} v${prediction.metadata.modelVersion}`
    };

    const savedScan = await storage.createScan(scanData);

    // Enhanced response with detailed AI insights
    const response = {
      scanId: savedScan.id,
      prediction: {
        topResult: {
          condition: prediction.topPrediction.class.replace(/_/g, ' '),
          confidence: prediction.topPrediction.confidence,
          riskLevel: prediction.topPrediction.riskLevel
        },
        allPredictions: prediction.predictions.map(p => ({
          condition: p.class.replace(/_/g, ' '),
          confidence: p.confidence,
          probability: Math.round(p.probability * 100)
        })),
        medicalInsights: {
          keyFindings: prediction.medicalInsights.findings,
          recommendations: prediction.medicalInsights.recommendations,
          urgencyLevel: prediction.medicalInsights.urgencyLevel,
          followUpRequired: prediction.medicalInsights.followUpRequired
        }
      },
      analysis: {
        modelUsed: prediction.modelName,
        modelVersion: prediction.metadata.modelVersion,
        processingTime: `${prediction.metadata.processingTime}ms`,
        imageQuality: {
          dimensions: prediction.metadata.imageSize,
          sizeBytes: req.file.size
        },
        timestamp: prediction.metadata.timestamp
      },
      nextSteps: {
        requiresUrgentAttention: prediction.topPrediction.riskLevel === 'critical',
        recommendedSpecialist: getRecommendedSpecialist(modelType),
        estimatedFollowUpTime: getFollowUpTimeframe(prediction.topPrediction.riskLevel),
        additionalTests: getRecommendedTests(prediction.topPrediction.class, modelType)
      }
    };

    // Log AI usage for analytics
    console.log(`✅ AI Analysis completed: ${prediction.topPrediction.class} (${(prediction.topPrediction.confidence * 100).toFixed(1)}% confidence)`);

    res.json(response);

  } catch (error) {
    console.error('AI Analysis Error:', error);

    // Cleanup uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (error instanceof ModelUnavailableError) {
      return res.status(503).json({
        error: 'Automated analysis unavailable',
        reason: error.reason,
        scanType: error.scanType,
        message:
          'No trained model could analyse this image, so no result was produced. ' +
          'This is NOT a negative finding. Manual review is required.'
      });
    }

    res.status(500).json({
      error: 'AI analysis failed',
      details: error.message,
      fallback: 'Manual review recommended'
    });
  }
});

// AI model status and capabilities
router.get('/models/status', requireMedicalAccess, async (req, res) => {
  try {
    const modelStatus = await aiEngine.getModelStatus();
    // `accuracy` is null for every model: none has a recorded held-out evaluation.
    // These fields previously carried hardcoded figures (94.2%, 91.8%, 96.1%, 92.7%)
    // that were not measured from anything. Populate them from a model card only.
    const capabilities = {
      'skin-cancer': {
        name: 'Skin Cancer Detection',
        description: 'Advanced dermatological analysis for skin lesion classification',
        conditions: ['Melanoma', 'Basal Cell Carcinoma', 'Squamous Cell Carcinoma', 'Benign Lesions'],
        accuracy: null,
        specialty: 'Dermatology'
      },
      'lung-cancer': {
        name: 'Lung Cancer Detection',
        description: 'Chest X-ray and CT scan analysis for pulmonary conditions',
        conditions: ['Lung Cancer', 'Pneumonia', 'Tuberculosis', 'COVID-19'],
        accuracy: null,
        specialty: 'Radiology'
      },
      'breast-cancer': {
        name: 'Breast Cancer Detection',
        description: 'Mammography analysis for breast cancer screening',
        conditions: ['Malignant Mass', 'Benign Mass', 'Calcifications'],
        accuracy: null,
        specialty: 'Mammography'
      },
      'eye-disease': {
        name: 'Eye Disease Detection',
        description: 'Retinal imaging analysis for ocular conditions',
        conditions: ['Diabetic Retinopathy', 'Glaucoma', 'Macular Degeneration'],
        accuracy: null,
        specialty: 'Ophthalmology'
      }
    };

    const response = Object.keys(modelStatus).map(key => ({
      modelKey: key,
      status: modelStatus[key],
      capabilities: capabilities[key as keyof typeof capabilities]
    }));

    res.json(response);
  } catch (error) {
    console.error('Error fetching model status:', error);
    res.status(500).json({ error: 'Failed to fetch AI model status' });
  }
});

// AI performance metrics
router.get('/models/:modelType/metrics', requireMedicalAccess, async (req, res) => {
  try {
    const { modelType } = req.params;
    const metrics = await aiEngine.getModelPerformanceMetrics(modelType);
    
    // The `benchmarks` block that used to sit here published targetAccuracy 0.90
    // next to a null accuracy, which reads as a claim about this model. Targets
    // nobody set are not benchmarks.
    res.json({
      modelType,
      performance: metrics,
      insights: {
        performanceGrade: getPerformanceGrade(metrics),
        recommendations: getPerformanceRecommendations(metrics)
      }
    });
  } catch (error) {
    console.error('Error fetching model metrics:', error);
    res.status(500).json({ error: 'Failed to fetch model metrics' });
  }
});

// Symptom analysis endpoint
router.post('/analyze-symptoms', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { symptoms, duration, severity, patientAge, patientGender } = req.body;
    
    if (!symptoms || !Array.isArray(symptoms) || symptoms.length === 0) {
      return res.status(400).json({ error: 'Symptoms array is required' });
    }

    const analysis = await MedicalConditionAnalyzer.analyzeSymptoms(symptoms);
    
    res.json({
      patientId: req.session.user?.id,
      analysis: {
        symptoms: symptoms,
        duration,
        severity,
        possibleConditions: analysis.possibleConditions,
        urgencyLevel: analysis.urgencyLevel,
        recommendations: analysis.recommendations
      },
      riskAssessment: {
        level: analysis.urgencyLevel > 3 ? 'high' : analysis.urgencyLevel > 1 ? 'medium' : 'low',
        requiresImmediateAttention: analysis.urgencyLevel >= 4,
        suggestedActions: getSuggestedActions(analysis.urgencyLevel)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Symptom analysis error:', error);
    res.status(500).json({ error: 'Symptom analysis failed' });
  }
});

// Risk factor calculation
router.post('/calculate-risk', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const patientData = req.body;
    
    if (!patientData.age || !patientData.gender) {
      return res.status(400).json({ error: 'Age and gender are required' });
    }

    const riskFactors = MedicalConditionAnalyzer.calculateRiskFactors(patientData);
    
    res.json({
      patientId: req.session.user?.id,
      riskAssessment: riskFactors,
      recommendations: {
        cardiovascular: getCardiovascularRecommendations(riskFactors.cardiovascularRisk),
        cancer: getCancerRecommendations(riskFactors.cancerRisk),
        diabetes: getDiabetesRecommendations(riskFactors.diabetesRisk)
      },
      screeningSchedule: generateScreeningSchedule(patientData.age, patientData.gender, riskFactors),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Risk calculation error:', error);
    res.status(500).json({ error: 'Risk calculation failed' });
  }
});

// AI insights for existing scans
router.get('/scan/:scanId/insights', requireMedicalAccess, async (req, res) => {
  try {
    const { scanId } = req.params;
    
    // One indexed lookup. This read every scan in the database and then ran
    // Array.find() over the copy to reach a single row by its primary key.
    const id = Number.parseInt(scanId, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid scan id' });
    }

    const scan = await storage.getScanById(id);
    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // Generate enhanced insights
    const insights = {
      scanInfo: {
        id: scan.id,
        type: scan.scanType,
        status: scan.status,
        created: scan.createdAt
      },
      aiAnalysis: {
        result: scan.result,
        confidence: scan.aiConfidence,
        riskLevel: scan.riskLevel,
        findings: scan.findings?.split('; ') || [],
        recommendations: scan.recommendations?.split('; ') || []
      },
      clinicalContext: {
        requiresUrgentAttention: scan.priority === 'high',
        followUpRequired: scan.status !== 'completed',
        estimatedReviewTime: getEstimatedReviewTime(scan.priority || 'medium')
      },
      comparativeAnalysis: {
        similarCases: await findSimilarCases(scan),
        populationData: getPopulationData(scan.scanType)
      }
    };

    res.json(insights);

  } catch (error) {
    console.error('Error generating scan insights:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// Helper functions
function getRecommendedSpecialist(modelType: string): string {
  const specialistMap: { [key: string]: string } = {
    'skin-cancer': 'Dermatologist',
    'lung-cancer': 'Oncologist / Pulmonologist',
    'breast-cancer': 'Oncologist / Breast Surgeon',
    'eye-disease': 'Ophthalmologist'
  };
  return specialistMap[modelType] || 'General Physician';
}

function getFollowUpTimeframe(riskLevel: string): string {
  switch (riskLevel) {
    case 'critical': return 'Within 24-48 hours';
    case 'high': return 'Within 1-2 weeks';
    case 'medium': return 'Within 1-2 months';
    default: return 'Routine follow-up (3-6 months)';
  }
}

function getRecommendedTests(condition: string, modelType: string): string[] {
  const testMap: { [key: string]: string[] } = {
    'skin-cancer': ['Dermoscopy', 'Biopsy', 'Lymph node examination'],
    'lung-cancer': ['CT scan', 'PET scan', 'Bronchoscopy', 'Biopsy'],
    'breast-cancer': ['MRI', 'Ultrasound', 'Biopsy', 'Genetic testing'],
    'eye-disease': ['OCT', 'Fluorescein angiography', 'Visual field test']
  };
  return testMap[modelType] || ['Clinical correlation', 'Additional imaging'];
}

/**
 * A letter grade, or null when there is nothing to grade.
 *
 * This used to average averageConfidence and accuracyRate. accuracyRate is
 * always null and null coerces to 0 in arithmetic, so the score was
 * `confidence / 2` at best and 0 at worst — every model was graded "C",
 * including ones with no predictions at all. Grading a model on the confidence
 * it assigns itself is also circular: a model that is confidently wrong scores
 * highest.
 */
function getPerformanceGrade(metrics: any): string | null {
  if (!metrics?.instrumented || metrics.accuracyRate === null) return null;

  const score = (metrics.averageConfidence + metrics.accuracyRate) / 2;
  if (score >= 0.95) return 'A+';
  if (score >= 0.90) return 'A';
  if (score >= 0.85) return 'B+';
  if (score >= 0.80) return 'B';
  return 'C';
}

/**
 * Advice only where a number exists to justify it.
 *
 * Each comparison here was previously made against a null, which is < any
 * threshold, so every model was permanently advised to retrain and to improve
 * its dataset regardless of how it was doing.
 */
function getPerformanceRecommendations(metrics: any): string[] {
  const recommendations: string[] = [];
  if (!metrics) return recommendations;

  if (typeof metrics.averageConfidence === 'number' && metrics.averageConfidence < 0.8) {
    recommendations.push('Mean confidence in production is below 0.80; review inputs and thresholds');
  }
  if (typeof metrics.averageProcessingTime === 'number' && metrics.averageProcessingTime > 2000) {
    recommendations.push('Mean inference time exceeds 2s; optimise the model or the host');
  }
  if (metrics.accuracyRate === null) {
    recommendations.push(
      'No scan of this type has a confirmed outcome yet. Record outcomes via ' +
        'POST /api/scans/:id/outcome to make production accuracy measurable'
    );
  } else if ((metrics.adjudicatedCount ?? 0) < 40) {
    recommendations.push(
      `Accuracy is based on ${metrics.adjudicatedCount} adjudicated scan(s) — too few to act on. ` +
        'See /api/models/performance for the confidence intervals'
    );
  }
  return recommendations;
}

function getSuggestedActions(urgencyLevel: number): string[] {
  if (urgencyLevel >= 4) {
    return ['Seek immediate medical attention', 'Call emergency services if worsening'];
  } else if (urgencyLevel >= 2) {
    return ['Schedule appointment with healthcare provider', 'Monitor symptoms closely'];
  } else {
    return ['Continue self-monitoring', 'Routine medical check-up'];
  }
}

function getCardiovascularRecommendations(risk: number): string[] {
  if (risk >= 0.7) {
    return ['Regular cardiology consultation', 'Stress testing', 'Aggressive risk factor modification'];
  } else if (risk >= 0.4) {
    return ['Annual cardiovascular screening', 'Lifestyle modifications', 'Blood pressure monitoring'];
  } else {
    return ['Maintain healthy lifestyle', 'Regular exercise', 'Routine screening'];
  }
}

function getCancerRecommendations(risk: number): string[] {
  if (risk >= 0.7) {
    return ['Enhanced screening protocols', 'Genetic counseling', 'Specialist consultation'];
  } else if (risk >= 0.4) {
    return ['Follow standard screening guidelines', 'Lifestyle risk reduction', 'Annual health assessments'];
  } else {
    return ['Standard screening per age guidelines', 'Healthy lifestyle maintenance'];
  }
}

function getDiabetesRecommendations(risk: number): string[] {
  if (risk >= 0.7) {
    return ['Regular glucose monitoring', 'Endocrinology consultation', 'Intensive lifestyle intervention'];
  } else if (risk >= 0.4) {
    return ['Annual diabetes screening', 'Dietary counseling', 'Weight management'];
  } else {
    return ['Maintain healthy weight', 'Regular physical activity', 'Balanced nutrition'];
  }
}

function generateScreeningSchedule(age: number, gender: string, risks: any): any {
  const schedule: any = {};
  
  // Age-based screening
  if (age >= 50) {
    schedule.colonoscopy = 'Every 10 years';
    schedule.mammography = gender === 'female' ? 'Annual' : 'N/A';
  }
  if (age >= 40) {
    schedule.cardiovascular = 'Every 3-5 years';
  }
  
  // Risk-based modifications
  if (risks.cancerRisk > 0.6) {
    schedule.enhanced_cancer_screening = 'Every 6-12 months';
  }
  if (risks.cardiovascularRisk > 0.6) {
    schedule.cardiology_consultation = 'Every 6 months';
  }
  
  return schedule;
}

function getEstimatedReviewTime(priority: string): string {
  switch (priority) {
    case 'high': return '2-4 hours';
    case 'medium': return '24-48 hours';
    default: return '2-5 business days';
  }
}

async function findSimilarCases(scan: any): Promise<any[]> {
  // No case-similarity index exists. Returning invented "similar cases" with
  // outcomes attached would imply evidence this system does not have.
  return [];
}

function getPopulationData(scanType: string): any {
  // Prevalence must come from a cited epidemiological source (e.g. GLOBOCAN or a
  // national cancer registry) and be specific to the population being served.
  // It was previously randomised.
  return {
    prevalence: null,
    source: null,
    note: 'No epidemiological reference data configured for this scan type.'
  };
}

export default router;
