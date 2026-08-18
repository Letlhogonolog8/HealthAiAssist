import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSchema, insertScanSchema, insertTermSchema } from "@shared/schema";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import multer from "multer";
import { hashPassword, verifyPassword, loginLimiter, apiLimiter } from "./auth-middleware";
import { getPatientProfile, getAvailableDermatologists, getAvailableAppointmentSlots } from './services';
import { medicalChatbotService } from "./chatbot-service";
import { 
  requireAuth, 
  requireRole,
  requireMedicalAccess,
  requirePatientDataAccess,
  AuthenticatedRequest
} from "./security-config";
import { 
  requireAdmin, 
  requireMedicalStaff, 
  requirePatientAccess,
  sensitiveOperationLimit,
  authLimit,
  validateInput,
  auditLog
} from "./security-middleware";
import advancedRoutes from "./advanced-routes";
import genomicsRoutes from "./genomics-routes";
import { createCompressionMiddleware, ResponseOptimizer, PerformanceMonitor } from "./performance-optimizer";
import { analyticsEngine } from "./analytics-engine";
import { enhancedWsManager } from "./websocket";

// Basic health endpoint (defined here to ensure it isn't shadowed by static middleware)
export function registerHealthRoute(app: Express) {
  app.get('/api/health', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify({ status: 'ok' }));
  });
}

// Extend Express Request to include multer file
interface MulterRequest extends Request {
  file: Express.Multer.File;
}

// Add TypeScript interface for analysis result
interface AnalysisResult {
  hasCancer: boolean;
  cancerType: string;
  confidence: number;
  riskLevel: string;
  findings: string[];
  recommendations: string[];
  clinicalGrade: string;
  accuracyLevel: number;
  analysis: Record<string, any>;
  malignancyIndicators: any[];
  advancedMetrics: Record<string, any>;
}

// Real-time analysis function using Python models
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { randomUUID } from 'crypto';
import { uploadToGoogleCloudStorage } from './google-cloud-service';
import { ModelUnavailableError, InputRejectedError, assertModelEnabled, MODEL_REGISTRY } from './model-availability';

async function performRealTimeAnalysis(imageBuffer: Buffer, scanType: string, patientData?: any): Promise<AnalysisResult> {
  // Throws for modalities with no model (breast, colon, prostate) and for models
  // that exist but failed evaluation (skin). Previously all of these fell through
  // to randomised output; they now fail loudly so the scan reaches a human.
  const resolved = assertModelEnabled(scanType);

  switch (resolved) {
    case 'skin':
      return performSkinCancerAnalysis(imageBuffer);
    case 'lung':
      return performLungCancerAnalysis(imageBuffer);
    default:
      throw new ModelUnavailableError(scanType, 'No analysis pipeline wired for this modality.');
  }
}

// ResNet50V2 model analysis for lung cancer
async function performLungCancerAnalysis(imageBuffer: Buffer): Promise<AnalysisResult> {
  const startedAt = Date.now();
  try {
    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    // Save image temporarily for analysis
    const tempImagePath = path.join(uploadsDir, `temp_lung_${randomUUID()}.jpg`);
    fs.writeFileSync(tempImagePath, imageBuffer);
    
    // Analyze with Python lung cancer model (use venv if available)
    const pythonCmd = fs.existsSync('venv/Scripts/python.exe') ? 'venv/Scripts/python.exe' : 'python';
    let result: any;
    try {
      result = await new Promise<any>((resolve, reject) => {
        exec(`${pythonCmd} server/lung-cancer-service.py "${tempImagePath}"`, (error, stdout) => {
          if (error) {
            reject(new ModelUnavailableError('lung', `Model process failed: ${error.message}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new ModelUnavailableError('lung', 'Model returned unparseable output'));
          }
        });
      });
    } finally {
      // Clean up temp file whether or not inference succeeded
      try {
        fs.unlinkSync(tempImagePath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError);
      }
    }

    if (result.status !== 'success' || !result.prediction) {
      throw new ModelUnavailableError('lung', result.message || 'Lung cancer model did not return a prediction');
    }

    const hasCancer = result.prediction === 'cancer';
    const confidence = result.confidence * 100;
    const riskLevel = hasCancer ? 'high' : 'low';

    // The classifier emits a binary label and a probability — nothing more. Findings
    // are limited to what it actually produced. Radiological descriptors
    // ("spiculated margins", "ground-glass opacity") are NOT model outputs and must
    // not be synthesised here; they belong to the reviewing radiologist.
    const findings = [
      hasCancer
        ? 'Model flagged this image as suspicious for lung malignancy'
        : 'Model did not flag this image as suspicious for lung malignancy',
      `Classifier probability: ${confidence.toFixed(1)}% for "${result.prediction}"`,
      'Screening triage only — not a diagnosis. Radiologist review required.'
    ];

    const analysisResult: AnalysisResult = {
      hasCancer,
      cancerType: hasCancer ? 'Lung Cancer' : 'No malignancy detected',
      confidence,
      riskLevel,
      findings,
      recommendations: hasCancer ? [
        'Priority radiologist review of this scan',
        'Pulmonologist consultation for clinical correlation',
        'Diagnostic imaging and tissue biopsy as clinically indicated',
        'Smoking cessation counselling if applicable'
      ] : [
        'Routine radiologist review of this scan',
        'Continue screening at the interval recommended by the treating clinician',
        'Report any new or worsening respiratory symptoms promptly'
      ],
      // "screening" not "diagnostic": this model has not been clinically validated
      // or regulator-cleared, and no held-out accuracy has been recorded for it.
      clinicalGrade: 'screening',
      accuracyLevel: Math.round(confidence),
      analysis: {
        method: 'resnet50v2_lung_cancer',
        probabilities: result.probabilities,
        modelAccuracy: null,
        urgency: hasCancer ? 'urgent' : 'routine',
        requiresHumanReview: true
      },
      malignancyIndicators: [],
      advancedMetrics: {
        processingTimeMs: Date.now() - startedAt,
        analysisDepth: 'ResNet50V2 binary classifier',
        confidenceThreshold: 70.0,
        modelVersion: 'resnet50v2-lung-v1',
        inputResolution: '224x224'
      }
    };

    return analysisResult;
  } catch (error) {
    if (error instanceof ModelUnavailableError) throw error;
    console.error('ResNet50V2 lung cancer analysis failed:', error);
    throw new ModelUnavailableError(
      'lung',
      error instanceof Error ? error.message : String(error)
    );
  }
}

// TensorFlow model analysis for skin cancer using ResNet50V2
async function performSkinCancerAnalysis(imageBuffer: Buffer): Promise<AnalysisResult> {
  const { skinCancerService } = await import('./skin-cancer-service');
  const startedAt = Date.now();

  try {
    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Save image temporarily for analysis
    const tempImagePath = path.join(uploadsDir, `temp_skin_${randomUUID()}.jpg`);
    fs.writeFileSync(tempImagePath, imageBuffer);

    let result;
    try {
      result = await skinCancerService.analyzeSkinImage(tempImagePath);
    } finally {
      try {
        fs.unlinkSync(tempImagePath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError);
      }
    }

    // The image failed a quality or domain check. The model is fine; the input is
    // not something it is competent to assess, so nothing is classified.
    if (result.prediction === 'rejected_input') {
      throw new InputRejectedError('skin', result.reasons?.length
        ? result.reasons
        : ['This image could not be assessed.']);
    }

    if (result.prediction === 'Error' || result.prediction === 'unavailable' || result.confidence == null) {
      throw new ModelUnavailableError('skin', result.error || 'Skin cancer model did not return a prediction');
    }

    const hasCancer = result.prediction === 'malignant';
    const isUncertain = result.prediction === 'uncertain';
    const confidence = result.confidence;
    const riskLevel = hasCancer ? 'high' : isUncertain ? 'medium' : 'low';

    // Only what the classifier produced. ABCDE criteria and morphological
    // descriptors were previously invented from the binary label — the model does
    // not measure asymmetry, border, colour or diameter, so it cannot report them.
    const findings = [
      hasCancer
        ? 'Model flagged this lesion as suspicious for malignancy'
        : isUncertain
          ? 'Model result is indeterminate for this lesion'
          : 'Model did not flag this lesion as suspicious for malignancy',
      `Classifier probability: ${confidence.toFixed(1)}% for "${result.prediction}"`,
      'Screening triage only — not a diagnosis. Clinician review required.'
    ];

    const analysisResult: AnalysisResult = {
      hasCancer,
      cancerType: hasCancer ? 'Melanoma/Skin Cancer' : 'No malignancy detected',
      confidence,
      riskLevel,
      findings,
      recommendations: hasCancer ? [
        'Priority dermatologist consultation',
        'Dermoscopy and biopsy as clinically indicated',
        'Photograph the lesion to document any change'
      ] : isUncertain ? [
        'Dermatologist consultation — the model could not classify this lesion',
        'Monitor for changes in size, colour or shape',
        'Follow ABCDE criteria for self-examination'
      ] : [
        'Continue routine skin self-examinations',
        'Screening interval as advised by the treating clinician',
        'Use sun protection (SPF 30+)',
        'Report new or changing lesions'
      ],
      // "screening" not "diagnostic": no clinical validation or regulatory
      // clearance, and no held-out accuracy has been recorded for this model.
      clinicalGrade: 'screening',
      accuracyLevel: Math.round(confidence),
      analysis: {
        method: 'resnet50v2_deep_learning',
        probabilities: result.probabilities,
        modelAccuracy: null,
        urgency: hasCancer ? 'urgent' : isUncertain ? 'routine_followup' : 'routine',
        requiresHumanReview: true
      },
      malignancyIndicators: [],
      advancedMetrics: {
        processingTimeMs: Date.now() - startedAt,
        analysisDepth: 'ResNet50V2 binary classifier',
        confidenceThreshold: 70.0,
        modelVersion: 'resnet50v2-skin-v1',
        inputResolution: '224x224'
      }
    };

    return analysisResult;
  } catch (error) {
    if (error instanceof ModelUnavailableError || error instanceof InputRejectedError) throw error;
    console.error('ResNet50V2 skin cancer analysis failed:', error);
    throw new ModelUnavailableError(
      'skin',
      error instanceof Error ? error.message : String(error)
    );
  }
}


/**
 * Handles the case where no validated model could analyse an uploaded scan.
 *
 * The scan is still recorded — with an explicit "awaiting manual review" result —
 * so it enters the radiologist queue rather than vanishing. The response is 503
 * and carries no diagnostic content, because there is none to report.
 */
/**
 * The submitted image was not assessable. 422 rather than 503: nothing is wrong
 * with the service, and retrying the same image will fail identically. No scan
 * record is created, because no analysis was attempted.
 */
function respondInputRejected(error: InputRejectedError, res: any): void {
  res.status(422).json({
    success: false,
    error: 'Image rejected',
    scanType: error.scanType,
    reasons: error.reasons,
    message:
      'This image was not analysed because it is not something the model can ' +
      'assess. This is NOT a negative result. Submit a clear, correctly framed ' +
      'image of the intended type.',
  });
}

async function respondModelUnavailable(
  error: ModelUnavailableError,
  req: Request,
  res: any
): Promise<void> {
  console.error(`Model unavailable for ${error.scanType}: ${error.reason}`);

  let scanId: number | undefined;
  try {
    const patientIdStr = (req.body as any)?.patientId;
    const patientId = patientIdStr ? parseInt(patientIdStr) : ((req.session as any)?.user?.id);

    if (patientId && !isNaN(patientId)) {
      const saved = await storage.createScan({
        patientId,
        scanType: error.scanType,
        result: 'Awaiting manual review - automated analysis unavailable',
        aiConfidence: 'N/A',
        status: 'pending_manual_review',
        notes: `Automated analysis did not run: ${error.reason}`
      } as any);
      scanId = (saved as any)?.id;
    }
  } catch (persistError) {
    console.error('Failed to queue scan for manual review:', persistError);
  }

  res.status(503).json({
    success: false,
    error: 'Automated analysis unavailable',
    reason: error.reason,
    scanType: error.scanType,
    // Stated plainly so no client can mistake this for a negative result.
    message:
      'No validated model could analyse this scan, so no result was produced. ' +
      'This is NOT a negative finding. The scan has been queued for manual review.',
    queuedForManualReview: scanId !== undefined,
    scanId
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Global API rate limiting (100 req/min per IP) to blunt abuse/scraping.
  app.use("/api", apiLimiter);

  // Model cards: what each model is, how it was measured, and what it cannot do.
  // Public by design — anyone relying on a result should be able to see the
  // evidence behind it, including that the skin model is currently disabled.
  app.get("/api/models/cards", (_req, res) => {
    res.json({
      models: Object.entries(MODEL_REGISTRY).map(([scanType, entry]) => ({
        scanType,
        enabled: entry.enabled,
        disabledReason: entry.disabledReason ?? null,
        evaluation: entry.evaluation,
        intendedUse: 'Screening triage to prioritise human review. Not a diagnosis.',
        humanReviewRequired: true
      })),
      reproduce: 'python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>'
    });
  });

  // Configure multer for image uploads
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
      const allowedTypes = [
        'image/jpeg', 
        'image/jpg', 
        'image/png', 
        'image/tiff', 
        'image/tif',
        'image/webp',
        'image/avif'
      ];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, JPG, PNG, TIFF, TIF, WEBP, and AVIF images are allowed.'));
      }
    }
  });
  // Authentication routes
  app.post("/api/auth/login", loginLimiter, validateInput, async (req: AuthenticatedRequest, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValidPassword = await verifyPassword(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Set session data directly without regeneration to avoid issues
      req.session.userId = user.id;
      req.session.user = {
        id: user.id,
        role: user.role,
        username: user.username,
        fullName: user.fullName,
        email: user.email
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.status(500).json({ error: 'Session save error' });
        }
        console.log('Session saved successfully:', { userId: req.session.userId, user: req.session.user });
        res.json({ id: user.id, username: user.username, fullName: user.fullName, role: user.role, email: user.email });
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add chatbot chat route
  app.post("/api/chatbot/chat", async (req, res) => {
    try {
      const { messages, message, userId } = req.body;
      
      // Handle both message formats
      let chatMessages: any[] = [];
      if (messages && Array.isArray(messages)) {
        chatMessages = messages;
      } else if (message) {
        chatMessages = [{ role: 'user', content: message }];
      } else {
        return res.status(400).json({ error: "Message or messages array is required" });
      }

      const chatbotResponse = await medicalChatbotService.generateResponse(
        chatMessages,
        userId
      );

      res.json(chatbotResponse);
    } catch (error) {
      console.error("Chatbot chat error:", error);
      res.status(500).json({ error: "Failed to process chat message" });
    }
  });

  // Chatbot quick responses based on role
  app.get("/api/chatbot/quick", async (req, res) => {
    try {
      const role = (req.session as any)?.user?.role || (req.query.role as string) || 'patient';
      const quick = await medicalChatbotService.getQuickResponses(role);
      res.json({ role, quick });
    } catch (error) {
      console.error("Chatbot quick error:", error);
      res.status(500).json({ quick: [] });
    }
  });

  // Chatbot symptom analysis
  app.post("/api/chatbot/analyze", async (req, res) => {
    try {
      const { symptoms, age, gender } = req.body || {};
      if (!symptoms || typeof symptoms !== 'string') {
        return res.status(400).json({ error: 'symptoms is required' });
      }
      const result = await medicalChatbotService.analyzeHealthConcern(symptoms, age, gender);
      res.json(result);
    } catch (error) {
      console.error("Chatbot analyze error:", error);
      res.status(500).json({ error: 'Failed to analyze symptoms' });
    }
  });

  app.post("/api/auth/register", validateInput, async (req: AuthenticatedRequest, res) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid input" });
      }

      const existingUser = await storage.getUserByUsername(result.data.username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(result.data.email);
      if (existingEmail) {
        return res.status(400).json({ error: "Email already exists" });
      }

      // Hash the password before storing
      const hashedPassword = await hashPassword(result.data.password);
      const userData = {
        ...result.data,
        password: hashedPassword
      };

      const user = await storage.createUser(userData);

      req.session.userId = user.id;
      req.session.user = {
        id: user.id,
        role: user.role,
        username: user.username,
        fullName: user.fullName,
        email: user.email
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.status(500).json({ error: 'Session save error' });
        }
        res.json({ id: user.id, username: user.username, fullName: user.fullName, role: user.role, email: user.email });
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/auth/me", async (req: AuthenticatedRequest, res) => {
    try {
      console.log('Auth check - Session exists:', !!req.session);
      console.log('Auth check - User in session:', !!req.session?.user);
      console.log('Auth check - UserId in session:', req.session?.userId);
      
      if (!req.session?.userId && !req.session?.user) {
        return res.status(401).json({ 
          error: "Not authenticated",
          debug: {
            hasSession: !!req.session,
            sessionId: req.sessionID,
            cookies: req.headers.cookie
          }
        });
      }

      const userId = req.session.userId || req.session.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "No user ID in session" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      res.json({ id: user.id, username: user.username, fullName: user.fullName, role: user.role, email: user.email });
    } catch (error) {
      console.error('Auth me error:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      req.session.destroy!();
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Patient profile endpoint (handled later with comprehensive data shape)

  // Medical terms routes
  app.get("/api/medical-terms", async (req, res) => {
    try {
      const terms = await storage.getTerms();
      res.json(terms);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/medical-terms/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json([]);
      }
      
      const terms = await storage.searchTerms(query);
      res.json(terms);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/medical-terms", async (req, res) => {
    try {
      const result = insertTermSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid input" });
      }

      const term = await storage.createTerm(result.data);
      res.json(term);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Medical scans routes
  app.get("/api/scans", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const patientId = req.query.patientId ? parseInt(req.query.patientId as string) : undefined;
      if (patientId !== undefined && isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }
      
      const currentUser = req.session?.user;
      
      // If user is a patient, only show their own scans
      let scansPatientId = patientId;
      if (currentUser?.role === 'patient') {
        scansPatientId = currentUser.id;
      }
      
      const scans = await storage.getScans(scansPatientId);
      res.json(scans);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/scans", requireAuth, validateInput, async (req, res) => {
    try {
      const result = insertScanSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid input" });
      }

      const scan = await storage.createScan(result.data);
      res.json(scan);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/scans/:id", requireAuth, validateInput, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid scan ID" });
      }
      
      // Get the scan to check ownership
      const allScans = await storage.getScans();
      const existingScan = allScans.find(s => s.id === id);
      
      if (!existingScan) {
        return res.status(404).json({ error: "Scan not found" });
      }
      
      const currentUser = req.session?.user;
      
      // Allow updates if user is medical staff or owns the scan
      const canUpdate = ['doctor', 'radiologist'].includes(currentUser?.role) || 
                       (currentUser?.role === 'patient' && existingScan.patientId === currentUser.id);
      
      if (!canUpdate) {
        return res.status(403).json({ error: "Not authorized to update this scan" });
      }
      
      const scan = await storage.updateScan(id, req.body);
      if (!scan) {
        return res.status(404).json({ error: "Scan not found" });
      }
      res.json(scan);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/scans/:id", requireAuth, auditLog('DELETE_SCAN'), async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid scan ID" });
      }
      
      // Get the scan to check ownership
      const allScans = await storage.getScans();
      const scan = allScans.find(s => s.id === id);
      
      if (!scan) {
        return res.status(404).json({ error: "Scan not found" });
      }
      
      const currentUser = req.session?.user;
      
      // Allow deletion if:
      // 1. User is medical staff (doctor/radiologist)
      // 2. User is the patient who owns the scan
      const canDelete = ['doctor', 'radiologist'].includes(currentUser?.role) || 
                       (currentUser?.role === 'patient' && scan.patientId === currentUser.id);
      
      if (!canDelete) {
        return res.status(403).json({ error: "Not authorized to delete this scan" });
      }
      
      const deleted = await storage.deleteScan(id);
      if (!deleted) {
        return res.status(404).json({ error: "Scan not found" });
      }
      res.json({ success: true, message: "Scan deleted successfully" });
    } catch (error) {
      console.error('Error deleting scan:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Google Medical AI image analysis route

  // Administrator dashboard API endpoints
  app.get("/api/admin/stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allScans = await storage.getScans();
      const todayScans = allScans.filter(scan => {
        if (!scan.createdAt) return false;
        const scanDate = new Date(scan.createdAt);
        const today = new Date();
        return scanDate.toDateString() === today.toDateString();
      });

      const stats = {
        totalUsers: allUsers.length,
        activeScans: allScans.filter(scan => scan.result === 'Processing').length,
        systemUptime: 99.8,
        aiAccuracy: allScans.length > 0 ? Math.round(allScans.reduce((sum, scan) => {
          const aiConf = (typeof (scan as any).aiConfidence === 'string')
            ? (parseFloat((scan as any).aiConfidence.replace('%', '')) || 0)
            : (typeof (scan as any).aiConfidence === 'number' ? (scan as any).aiConfidence : 0);
          return sum + aiConf;
        }, 0) / allScans.length) : 0,
        dailyScans: todayScans.length,
        criticalAlerts: allScans.filter(scan => 
          scan.result && (scan.result.includes('urgent') || scan.result.includes('critical'))
        ).length,
        databaseHealth: 98,
        securityStatus: 'secure'
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ error: "Failed to fetch admin statistics" });
    }
  });

  // New endpoint to create doctor or radiologist
  app.post("/api/admin/doctors", requireAuth, requireAdmin, sensitiveOperationLimit, validateInput, auditLog('CREATE_MEDICAL_STAFF'), async (req, res) => {
    try {
      const { username, password, fullName, email, specialization, licenseNumber, role } = req.body;

      // Validate required fields
      if (!username || !password || !fullName || !email || !role) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!['doctor', 'radiologist'].includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be 'doctor' or 'radiologist'." });
      }

      // Check if username or email already exists
      const existingUserByUsername = await storage.getUserByUsername(username);
      if (existingUserByUsername) {
        return res.status(409).json({ error: "Username already exists" });
      }

      const existingUserByEmail = await storage.getUserByEmail(email);
      if (existingUserByEmail) {
        return res.status(409).json({ error: "Email already exists" });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user
      const newUser = await storage.createUser({
        username,
        password: hashedPassword,
        fullName,
        email,
        specialization: specialization || null,
        licenseNumber: licenseNumber || null,
        role
      });

      res.status(201).json({
        id: newUser.id,
        username: newUser.username,
        fullName: newUser.fullName,
        email: newUser.email,
        specialization: newUser.specialization,
        licenseNumber: newUser.licenseNumber,
        role: newUser.role
      });
    } catch (error) {
      console.error("Error creating doctor/radiologist:", error);
      res.status(500).json({ error: "Failed to create doctor or radiologist" });
    }
  });

  app.get("/api/admin/users/metrics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const today = new Date();
      const todayUsers = allUsers.filter(user => {
        const userDate = new Date(user.createdAt || new Date());
        return userDate.toDateString() === today.toDateString();
      });

      // Placeholder values for login rate and average session time
      // TODO: Integrate real login/session metrics from user activity logs or session store
      const loginRate = 85; // percentage
      const avgSessionTime = 24; // minutes

      const metrics = {
        totalUsers: allUsers.length,
        admins: allUsers.filter(user => user.role === 'admin').length,
        radiologists: allUsers.filter(user => user.role === 'radiologist').length,
        doctors: allUsers.filter(user => user.role === 'doctor').length,
        patients: allUsers.filter(user => user.role === 'patient').length,
        activeUsers: Math.floor(allUsers.length * 0.3),
        newUsersToday: todayUsers.length,
        loginRate,
        avgSessionTime
      };

      res.json(metrics);
    } catch (error) {
      console.error("Error fetching user metrics:", error);
      res.status(500).json({ error: "Failed to fetch user metrics" });
    }
  });

  app.get("/api/admin/scans/metrics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const todayScans = allScans.filter(scan => {
        if (!scan.createdAt) return false;
        const scanDate = new Date(scan.createdAt);
        const today = new Date();
        return scanDate.toDateString() === today.toDateString();
      });

      const metrics = {
        totalScans: allScans.length,
        pendingScans: allScans.filter(scan => scan.result === 'Processing').length,
        completedToday: todayScans.filter(scan => scan.result !== 'Processing').length,
        cancerDetections: allScans.filter(scan => 
          scan.result && (scan.result.toLowerCase().includes('cancer') || scan.result.toLowerCase().includes('malignant'))
        ).length,
        averageProcessingTime: 2.4,
        aiConfidenceAverage: allScans.length > 0 ? Math.round(allScans.reduce((sum, scan) => {
          const aiConf = (typeof (scan as any).aiConfidence === 'string')
            ? (parseFloat((scan as any).aiConfidence.replace('%', '')) || 0)
            : (typeof (scan as any).aiConfidence === 'number' ? (scan as any).aiConfidence : 0);
          return sum + aiConf;
        }, 0) / allScans.length) : 0
      };

      res.json(metrics);
    } catch (error) {
      console.error("Error fetching scan metrics:", error);
      res.status(500).json({ error: "Failed to fetch scan metrics" });
    }
  });

  // New endpoint for scan type distribution
  app.get("/api/admin/scans/type-distribution", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const totalScans = allScans.length;

      // Count scans by type
      const scanTypeCounts: Record<string, number> = {};
      allScans.forEach(scan => {
        const type = scan.scanType || 'Unknown';
        scanTypeCounts[type] = (scanTypeCounts[type] || 0) + 1;
      });

      // Calculate percentages
      const scanTypeDistribution = Object.entries(scanTypeCounts).map(([type, count]) => ({
        type,
        percentage: totalScans > 0 ? (count / totalScans) * 100 : 0
      }));

      res.json(scanTypeDistribution);
    } catch (error) {
      console.error("Error fetching scan type distribution:", error);
      res.status(500).json({ error: "Failed to fetch scan type distribution" });
    }
  });

  app.get("/api/admin/activities/recent", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const recentActivities = allScans.slice(-10).map(scan => ({
        message: `Medical scan completed - ${scan.scanType}`,
        timestamp: scan.createdAt ? new Date(scan.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString(),
        type: 'scan'
      }));

      res.json(recentActivities);
    } catch (error) {
      console.error("Error fetching recent activities:", error);
      res.status(500).json({ error: "Failed to fetch recent activities" });
    }
  });

  // System/WebSocket stats for admin
  app.get("/api/system/ws-stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const stats = enhancedWsManager?.getStats?.() || { connections: 0, messages: 0, onlineUsers: 0, roles: {} };
      res.json(stats);
    } catch (error) {
      res.json({ connections: 0, messages: 0, onlineUsers: 0, roles: {} });
    }
  });

  // Radiologist dashboard API endpoints
  app.get("/api/radiologist/stats", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const pendingScans = allScans.filter(scan => scan.result === 'Processing');
      const todayScans = allScans.filter(scan => {
        const scanDate = new Date(scan.createdAt);
        const today = new Date();
        return scanDate.toDateString() === today.toDateString() && scan.result !== 'Processing';
      });

      const stats = {
        pendingReviews: pendingScans.length,
        completedToday: todayScans.length,
        aiConfidence: allScans.length > 0 ? Math.round(allScans.reduce((sum, scan) => {
          const confidence = scan.aiConfidence ? parseFloat(scan.aiConfidence.replace('%', '')) : 0;
          return sum + confidence;
        }, 0) / allScans.length) : 0,
        avgReviewTime: 3.2,
        totalScansReviewed: allScans.filter(scan => scan.result !== 'Processing').length,
        criticalCases: allScans.filter(scan => scan.result && (scan.result.includes('urgent') || scan.result.includes('critical'))).length,
        accuracyRate: 96,
        workloadHours: Math.round(todayScans.length * 0.2)
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching radiologist stats:", error);
      res.status(500).json({ error: "Failed to fetch radiologist statistics" });
    }
  });

  app.get("/api/radiologist/pending-reviews", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      // Scans awaiting a human: still processing, or queued because automated
      // analysis could not run at all. The second case must not be dropped —
      // those scans have no AI result and depend entirely on this queue.
      const pendingScans = allScans.filter(
        scan => scan.result === 'Processing' || scan.status === 'pending_manual_review'
      );

      const reviews = pendingScans.map(scan => {
        const patient = allUsers.find(user => user.id === scan.patientId);
        const awaitingManualReview = scan.status === 'pending_manual_review';
        return {
          id: scan.id,
          patientName: patient ? patient.fullName : `Patient ${scan.patientId}`,
          scanType: scan.scanType,
          // Read the stored triage priority. This was previously randomised,
          // which shuffled the order radiologists review patients in.
          priority: scan.priority || 'medium',
          awaitingManualReview,
          submittedAt: scan.createdAt,
          aiPrediction: awaitingManualReview
            ? 'No AI result - automated analysis unavailable'
            : 'Analysis in progress',
          aiConfidence: (typeof scan.aiConfidence === 'string')
            ? (parseFloat(scan.aiConfidence.replace('%', '')) || 0)
            : (typeof scan.aiConfidence === 'number' ? scan.aiConfidence : 0),
          bodyPart: (scan.scanType || '').split(' ')[0] || 'Unknown',
          referringDoctor: 'Johnson',
          notes: scan.notes
        };
      });

      res.json(reviews);
    } catch (error) {
      console.error("Error fetching pending reviews:", error);
      res.status(500).json({ error: "Failed to fetch pending reviews" });
    }
  });

  app.get("/api/radiologist/completed-today", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      const todayScans = allScans.filter(scan => {
        const scanDate = new Date(scan.createdAt);
        const today = new Date();
        return scanDate.toDateString() === today.toDateString() && scan.result !== 'Processing';
      });

      const completed = todayScans.map(scan => {
        const patient = allUsers.find(user => user.id === scan.patientId);
        return {
          id: scan.id,
          patientName: patient ? patient.fullName : `Patient ${scan.patientId}`,
          scanType: scan.scanType,
          completedAt: scan.createdAt,
          findings: scan.result,
          recommendation: scan.notes || 'Follow-up as needed',
          aiAccuracy: (typeof scan.aiConfidence === 'string')
            ? (parseFloat(scan.aiConfidence.replace('%', '')) || 0)
            : (typeof scan.aiConfidence === 'number' ? scan.aiConfidence : 0)
        };
      });

      res.json(completed);
    } catch (error) {
      console.error("Error fetching completed scans:", error);
      res.status(500).json({ error: "Failed to fetch completed scans" });
    }
  });

  // Diagnostic session endpoint — never exposed in production.
  // Reveals only the caller's own session; the user-enumeration,
  // test-login backdoor, and set-session privilege-escalation endpoints
  // that used to live here have been removed.
  if (process.env.NODE_ENV !== 'production') {
    app.get("/api/debug/session", (req, res) => {
      res.json({
        hasSession: !!req.session,
        sessionId: req.sessionID,
        user: req.session?.user || null,
        userId: req.session?.userId || null
      });
    });
  }

  // Doctor dashboard API endpoints
  app.get("/api/doctor/stats", async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allScans = await storage.getScans();
      const patients = allUsers.filter(user => user.role === 'patient');
      const doctorId = (req.session as any)?.user?.id;
      
      // Get doctor's appointments for today with error handling
      let todayAppointments: any[] = [];
      try {
        const doctorAppointments = doctorId ? await storage.getDoctorAppointments(doctorId) : [];
        todayAppointments = doctorAppointments.filter(apt => {
          if (!apt.appointmentDate) return false;
          try {
            const aptDate = new Date(apt.appointmentDate);
            const today = new Date();
            return aptDate.toDateString() === today.toDateString();
          } catch {
            return false;
          }
        });
      } catch (error) {
        console.error('Error fetching doctor appointments:', error);
      }

      const stats = {
        activePatients: patients.length || 0,
        todaysAppointments: todayAppointments.length || 0,
        pendingReports: allScans.filter(scan => 
          scan.result && scan.result !== 'Processing' && !scan.notes
        ).length || 0,
        criticalCases: allScans.filter(scan => 
          scan.result && (
            scan.result.includes('urgent') || 
            scan.result.includes('critical') || 
            scan.result.toLowerCase().includes('abnormal')
          )
        ).length || 0,
        totalPatients: patients.length || 0,
        appointmentsCompleted: Math.floor(Math.random() * 5) + 3,
        avgConsultationTime: '18m',
        patientSatisfaction: 94
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching doctor stats:", error);
      res.status(500).json({ error: "Failed to fetch doctor stats" });
    }
  });

  app.get("/api/doctor/patients", async (req, res) => {
    try {
      // Use same approach as stats endpoint
      const allUsers = await storage.getAllUsers();
      const patients = allUsers.filter(user => user.role === 'patient');



      const patientData = patients.map(patient => ({
        id: patient.id,
        name: patient.fullName || patient.username,
        email: patient.email,
        phone: patient.phone || 'Not provided',
        age: patient.age || 30,
        gender: patient.gender || 'Not specified',
        lastVisit: new Date().toISOString(),
        condition: 'Regular checkup',
        status: 'stable',
        recentScans: 0,
        riskLevel: 'low'
      }));

      res.json(patientData);
    } catch (error) {
      console.error("Error in patients endpoint:", error);
      res.status(500).json({ error: "Failed to fetch patients" });
    }
  });

  app.get("/api/doctor/appointments/today", async (req, res) => {
    try {
      const doctorId = (req.session as any)?.user?.id || 15; // Default to Dr. Kenosi for testing
      console.log(`[Doctor Appointments] Fetching for doctor ID: ${doctorId}`);
      
      const appointments = await storage.getDoctorAppointments(doctorId);
      console.log(`[Doctor Appointments] Retrieved ${appointments.length} appointments:`, appointments);
      
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  // New endpoint for upcoming appointments
  app.get("/api/doctor/appointments/upcoming", async (req, res) => {
    try {
      const doctorId = (req.session as any)?.user?.id;
      
      const appointments = await storage.getDoctorAppointments(doctorId);
      const allUsers = await storage.getAllUsers();
      
      // Format appointments with patient information
      const formattedAppointments = appointments.map(appointment => {
        const patient = allUsers.find(user => user.id === appointment.patientId);
        return {
          id: appointment.id,
          patientName: patient ? patient.fullName : `Patient ${appointment.patientId}`,
          patientEmail: patient ? patient.email : '',
          date: appointment.appointmentDate ? new Date(appointment.appointmentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          time: appointment.appointmentTime || '09:00 AM',
          reason: appointment.reason || appointment.type || 'Consultation',
          status: appointment.status || 'pending',
          notes: appointment.notes || '',
          priority: appointment.priority || 'medium'
        };
      });
      
      res.json(formattedAppointments);
    } catch (error) {
      console.error("Error fetching upcoming appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  app.get("/api/doctor/reports/pending", async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      const pendingReports = allScans.filter(scan => 
        scan.result && 
        scan.result !== 'Processing' && 
        scan.status !== 'completed'
      );

      const reports = pendingReports.map(scan => {
        const patient = allUsers.find(user => user.id === scan.patientId);
        const isAbnormal = scan.result && scan.result.toLowerCase().includes('abnormal');
        const isCritical = scan.result && (scan.result.toLowerCase().includes('urgent') || scan.result.toLowerCase().includes('critical'));
        
        return {
          id: scan.id,
          patientName: patient ? patient.fullName : `Patient ${scan.patientId}`,
          scanType: scan.scanType || 'Medical Scan',
          submittedAt: scan.createdAt || new Date().toISOString(),
          priority: isCritical ? 'urgent' : isAbnormal ? 'high' : 'medium',
          radiologist: 'Dr. Smith',
          findings: scan.result,
          status: scan.status || 'pending',
          aiConfidence: scan.aiConfidence || '85%',
          requiresReview: true
        };
      });

      res.json(reports);
    } catch (error) {
      console.error("Error fetching pending reports:", error);
      res.status(500).json({ error: "Failed to fetch pending reports" });
    }
  });

  // Doctor notifications endpoint
  app.get("/api/doctor/notifications", async (req, res) => {
    try {
      const doctorId = (req.session as any)?.user?.id;
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      
      // Generate notifications based on recent activities
      const recentScans = allScans.slice(-5);
      const notifications = recentScans.map(scan => {
        const patient = allUsers.find(user => user.id === scan.patientId);
        return {
          id: scan.id,
          message: `New scan result available for ${patient ? patient.fullName : 'Patient'}`,
          timestamp: scan.createdAt || new Date().toISOString(),
          type: 'scan_result',
          priority: scan.result && scan.result.toLowerCase().includes('abnormal') ? 'high' : 'normal'
        };
      });
      
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching doctor notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Approve report endpoint
  app.post("/api/doctor/reports/:id/approve", async (req, res) => {
    try {
      const reportId = parseInt(req.params.id);
      const { notes } = req.body;
      
      if (isNaN(reportId)) {
        return res.status(400).json({ error: "Invalid report ID" });
      }
      
      // Update scan status to completed
      const updatedScan = await storage.updateScan(reportId, {
        status: 'completed',
        notes: notes || 'Report approved by doctor',
        reviewedAt: new Date()
      });
      
      if (!updatedScan) {
        return res.status(404).json({ error: "Report not found" });
      }
      
      res.json({
        success: true,
        message: "Report approved successfully",
        report: updatedScan
      });
    } catch (error) {
      console.error("Error approving report:", error);
      res.status(500).json({ error: "Failed to approve report" });
    }
  });

  // Review report endpoint
  app.get("/api/doctor/reports/:id", async (req, res) => {
    try {
      const reportId = parseInt(req.params.id);
      
      if (isNaN(reportId)) {
        return res.status(400).json({ error: "Invalid report ID" });
      }
      
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      const scan = allScans.find(s => s.id === reportId);
      
      if (!scan) {
        return res.status(404).json({ error: "Report not found" });
      }
      
      const patient = allUsers.find(user => user.id === scan.patientId);
      
      const reportDetails = {
        id: scan.id,
        patientName: patient ? patient.fullName : `Patient ${scan.patientId}`,
        patientId: scan.patientId,
        scanType: scan.scanType,
        submittedAt: scan.createdAt,
        findings: scan.result,
        aiConfidence: scan.aiConfidence,
        status: scan.status,
        notes: scan.notes,
        reviewedAt: scan.reviewedAt
      };
      
      res.json(reportDetails);
    } catch (error) {
      console.error("Error fetching report details:", error);
      res.status(500).json({ error: "Failed to fetch report details" });
    }
  });

  // Appointment management endpoints
  app.post("/api/doctor/appointments/:id/accept", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      if (isNaN(appointmentId)) {
        return res.status(400).json({ error: "Invalid appointment ID" });
      }
      const updatedAppointment = await storage.updateAppointmentStatus(appointmentId, 'accepted', 'Appointment confirmed by doctor');
      
      if (updatedAppointment) {
        res.json({ success: true, message: "Appointment accepted", appointment: updatedAppointment });
      } else {
        res.status(404).json({ error: "Appointment not found" });
      }
    } catch (error) {
      console.error("Error accepting appointment:", error);
      res.status(500).json({ error: "Failed to accept appointment" });
    }
  });

  app.post("/api/doctor/appointments/:id/decline", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      if (isNaN(appointmentId)) {
        return res.status(400).json({ error: "Invalid appointment ID" });
      }
      const { reason } = req.body;
      const updatedAppointment = await storage.updateAppointmentStatus(appointmentId, 'declined', reason || 'Declined by doctor');
      
      if (updatedAppointment) {
        res.json({ success: true, message: "Appointment declined", appointment: updatedAppointment });
      } else {
        res.status(404).json({ error: "Appointment not found" });
      }
    } catch (error) {
      console.error("Error declining appointment:", error);
      res.status(500).json({ error: "Failed to decline appointment" });
    }
  });

  app.delete("/api/doctor/appointments/:id", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      if (isNaN(appointmentId)) {
        return res.status(400).json({ error: "Invalid appointment ID" });
      }
      const deleted = await storage.deleteAppointment(appointmentId);
      
      if (deleted) {
        res.json({ success: true, message: "Appointment deleted" });
      } else {
        res.status(404).json({ error: "Appointment not found" });
      }
    } catch (error) {
      console.error("Error deleting appointment:", error);
      res.status(500).json({ error: "Failed to delete appointment" });
    }
  });

  // Patient dashboard API endpoints
  // Unified, authenticated patient profile route with comprehensive response shape
  app.get("/api/patient/profile/:id", requireAuth, requirePatientDataAccess, async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }
      const profile = await getPatientProfile(patientId);
      res.json(profile);
    } catch (error) {
      console.error("Error fetching patient profile:", error);
      res.status(500).json({ error: "Failed to fetch patient profile" });
    }
  });

  app.get("/api/patient/scans/:id", requireAuth, requirePatientAccess, async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }
      const scans = await storage.getScans(patientId);
      
      const scanHistory = scans.map(scan => ({
        id: scan.id,
        type: scan.scanType,
        date: scan.createdAt,
        result: scan.result,
        confidence: scan.aiConfidence,
        status: scan.result === 'Processing' ? 'pending' : 'completed',
        notes: scan.notes,
        aiAnalysis: {
          processed: scan.result !== 'Processing',
          findings: scan.result !== 'Processing' ? [scan.result] : ['Analysis in progress'],
          riskLevel: (scan.result || '').toLowerCase().includes('normal') ? 'low' : 'medium'
        }
      }));

      res.json(scanHistory);
    } catch (error) {
      console.error("Error fetching patient scans:", error);
      res.status(500).json({ error: "Failed to fetch patient scans" });
    }
  });

  // Remove duplicate unauthenticated variant; keep logs inside the authenticated handler if needed
  /*
  app.get("/api/patient/profile/:id", async (req, res) => {
    try {
      console.log('Patient profile request - Session:', !!req.session);
      console.log('Patient profile request - User in session:', req.session?.user);
      console.log('Patient profile request - Requested ID:', req.params.id);
      
      const patientId = parseInt(req.params.id);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }
      
      const user = await storage.getUser(patientId);
      console.log('Patient profile - Found user:', !!user, user?.role);
      
      if (!user || user.role !== 'patient') {
        return res.status(404).json({ error: "Patient not found" });
      }

      const patientScans = await storage.getScans(patientId);
      
      // Generate comprehensive patient data from database
      const patientData = {
        id: user.id,
        personalInfo: {
          name: user.fullName || 'Not provided',
          age: user.age || 34,
          gender: user.gender || "Female",
          bloodType: user.bloodType || "O+",
          height: "5'6\"",
          weight: "135 lbs",
          phone: user.phone || "012-342-7901",
          email: user.email || user.username,
          address: user.address || "103 Main St, Healthcare City, HC 12541",
          emergencyContact: user.emergencyContact || "Jacob Moalusi - 082-763-5702"
        },
        medicalHistory: {
          allergies: ["Penicillin", "Shellfish"],
          conditions: ["Hypertension", "Type 2 Diabetes"],
          medications: ["Metformin 500mg twice daily", "Lisinopril 10mg daily"],
          surgeries: ["Appendectomy (2019)", "Wisdom teeth removal (2020)"]
        },
        recentScans: patientScans.map(scan => ({
          id: scan.id,
          type: scan.scanType,
          date: scan.createdAt ? new Date(scan.createdAt).toISOString() : new Date().toISOString(),
          result: scan.result || "Normal findings",
          confidence: scan.aiConfidence || "92%",
          status: scan.result === 'Processing' ? 'pending' : 'normal',
          doctor: "Dr. Sarah Johnson"
        })),
        appointments: [
          {
            id: 1,
            date: "2025-06-20",
            time: "10:00 AM",
            doctor: "Dr. Sarah Johnson",
            type: "Follow-up Consultation",
            status: "scheduled"
          },
          {
            id: 2,
            date: "2025-06-15",
            time: "2:30 PM",
            doctor: "Dr. Michael Chen",
            type: "Annual Physical",
            status: "completed"
          }
        ],
        vitals: {
          bloodPressure: "120/80",
          heartRate: 72,
          temperature: 98.6,
          weight: 135,
          bmi: 21.8,
          lastUpdated: new Date().toISOString()
        },
        healthScore: {
          overall: 85,
          cardiovascular: 88,
          respiratory: 92,
          metabolic: 78
        }
      };

      res.json(patientData);
    } catch (error) {
      console.error("Error fetching patient profile:", error);
      res.status(500).json({ error: "Failed to fetch patient profile" });
    }
  });
  */

  app.get("/api/patient/appointments/:id", async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }
      const appointments = await storage.getPatientAppointments(patientId);
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching patient appointments:", error);
      res.status(500).json({ error: "Failed to fetch patient appointments" });
    }
  });

  // General patient appointments endpoint
  app.get("/api/patient/appointments", async (req: AuthenticatedRequest, res) => {
    try {
      const patientId = req.session?.user?.id || 4; // Default to test patient
      const appointments = await storage.getPatientAppointments(patientId);
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching patient appointments:", error);
      res.status(500).json({ error: "Failed to fetch patient appointments" });
    }
  });

  // Delete patient appointment endpoint
  app.delete("/api/patient/appointments/:id", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      if (isNaN(appointmentId)) {
        return res.status(400).json({ error: "Invalid appointment ID" });
      }
      const deleted = await storage.deleteAppointment(appointmentId);

      if (deleted) {
        res.json({ success: true, message: "Appointment deleted" });
      } else {
        res.status(404).json({ error: "Appointment not found" });
      }
    } catch (error) {
      console.error("Error deleting appointment:", error);
      res.status(500).json({ error: "Failed to delete appointment" });
    }
  });

  // Patient appointment booking endpoint
  app.post("/api/patient/appointments", async (req, res) => {
    try {
      const { patientId, appointmentDate, appointmentTime, type, doctorName, status, reason } = req.body;
      
      if (!patientId || !appointmentDate || !appointmentTime || !type || !doctorName) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          message: 'Patient ID, date, time, type, and doctor are required'
        });
      }

      // Check Google Calendar availability first
      const { googleCalendarService } = await import('./google-calendar-service');
      const timeSlotCheck = await googleCalendarService.checkTimeSlotAvailability(
        appointmentDate, 
        appointmentTime
      );

      if (!timeSlotCheck.isAvailable) {
        return res.status(409).json({
          error: 'Time slot not available',
          message: `The selected time slot is already booked. ${timeSlotCheck.conflictingEvent ? `Conflict: ${timeSlotCheck.conflictingEvent.summary}` : ''}`,
          conflictingEvent: timeSlotCheck.conflictingEvent
        });
      }

      // Find the medical professional (doctor or radiologist) by name
      const allUsers = await storage.getAllUsers();
      const medicalProfessional = allUsers.find(user => 
        ['doctor', 'radiologist'].includes(user.role) && user.fullName === doctorName
      );

      if (!medicalProfessional) {
        return res.status(404).json({ 
          error: 'Medical professional not found',
          message: 'The selected medical professional is not available'
        });
      }

      // Check for existing appointments at the same time
      const existingAppointments = await storage.getDoctorAppointments(medicalProfessional.id);
      const conflictingAppointment = existingAppointments.find(apt => {
        const aptDate = new Date(apt.appointmentDate).toISOString().split('T')[0];
        return aptDate === appointmentDate && apt.appointmentTime === appointmentTime;
      });

      if (conflictingAppointment) {
        return res.status(409).json({
          error: 'Time slot already booked',
          message: 'This time slot is already booked with another patient'
        });
      }

      // Create appointment in database
      const appointmentData = {
        patientId: parseInt(patientId),
        doctorId: medicalProfessional.id,
        appointmentDate: new Date(appointmentDate),
        appointmentTime: appointmentTime,
        type: type,
        status: status || 'scheduled',
        reason: reason || 'Patient appointment',
        notes: '',
        priority: 'medium'
      };

      const newAppointment = await storage.createAppointment(appointmentData);
      
      res.status(200).json({
        success: true,
        message: 'Appointment booked successfully',
        appointment: {
          id: newAppointment.id,
          patientId: newAppointment.patientId,
          doctorId: newAppointment.doctorId,
          doctorName: medicalProfessional.fullName,
          professionalRole: medicalProfessional.role,
          specialty: medicalProfessional.specialization,
          date: newAppointment.appointmentDate,
          time: newAppointment.appointmentTime,
          type: newAppointment.type,
          status: newAppointment.status,
          reason: newAppointment.reason
        }
      });
      return res.end();
    } catch (error) {
      console.error('Error booking appointment:', error);
      res.status(500).json({ 
        error: 'Failed to book appointment',
        message: 'Please try again or contact support'
      });
      return res.end();
    }
  });

  // Appointment reschedule endpoint
  app.patch("/api/appointments/:appointmentId/reschedule", async (req, res) => {
    try {
      const { appointmentId } = req.params;
      const { newDate, newTime } = req.body;
      
      // In a real implementation, you would update the appointment in database
      res.json({ 
        success: true, 
        message: "Appointment rescheduled successfully",
        appointmentId,
        newDate,
        newTime
      });
    } catch (error) {
      console.error("Error rescheduling appointment:", error);
      res.status(500).json({ error: "Failed to reschedule appointment" });
    }
  });

  // Patient profile update endpoint (update to allow partial personalInfo updates)
  app.patch("/api/patient/profile/:id", requireAuth, requirePatientAccess, validateInput, async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }
      const updates = req.body;

      // Validate required fields
      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
      }

      // Check if patient exists
      const existingUser = await storage.getUser(patientId);
      if (!existingUser || existingUser.role !== 'patient') {
        return res.status(404).json({ error: "Patient not found" });
      }

      // Map frontend fields to database fields
      const dbUpdates: any = {};
      if (updates.name) dbUpdates.fullName = updates.name;
      if (updates.email) dbUpdates.email = updates.email;
      if (updates.phone) dbUpdates.phone = updates.phone;
      if (updates.address) dbUpdates.address = updates.address;
      if (updates.age) dbUpdates.age = parseInt(updates.age) || null;
      if (updates.gender) dbUpdates.gender = updates.gender;
      if (updates.bloodType) dbUpdates.bloodType = updates.bloodType;
      if (updates.emergencyContact) dbUpdates.emergencyContact = updates.emergencyContact;

      // Persist the update to the DB
      const persistedUser = await storage.updateUserProfile(patientId, dbUpdates);
      if (!persistedUser) {
        return res.status(500).json({ error: "Failed to persist profile updates" });
      }

      // Get updated profile data
      const updatedProfile = await getPatientProfile(patientId);

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: updatedProfile
      });
    } catch (error) {
      console.error("Error updating patient profile:", error);
      res.status(500).json({ error: "Failed to update patient profile" });
    }
  });

  // Appointment reschedule endpoint
  app.patch("/api/patient/appointments/:appointmentId/reschedule", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.appointmentId);
      if (isNaN(appointmentId)) {
        return res.status(400).json({ error: "Invalid appointment ID" });
      }
      const { newDate, newTime } = req.body;
      
      // Validate input as needed (optional)

      // Update appointment in database
      const updatedAppointment = await storage.updateAppointment(appointmentId, {
        appointmentDate: new Date(newDate),
        appointmentTime: newTime,
        status: 'rescheduled',
        updatedAt: new Date()
      });

      if (!updatedAppointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      res.json({
        success: true,
        message: "Appointment rescheduled successfully",
        data: updatedAppointment
      });
    } catch (error) {
      console.error("Error rescheduling appointment:", error);
      res.status(500).json({ error: "Failed to reschedule appointment" });
    }
  });

  // Get available medical professionals (doctors and radiologists) for appointment booking
  app.get("/api/doctors/available", async (req, res) => {
    try {
      const medicalStaff = await storage.getAllUsers();
      const availableProfessionals = medicalStaff
        .filter(user => ['doctor', 'radiologist'].includes(user.role))
        .map(professional => ({
          id: professional.id,
          name: professional.fullName,
          role: professional.role,
          specialty: professional.specialization || (professional.role === 'radiologist' ? 'Medical Imaging' : 'General Practice'),
          available: true,
          email: professional.email
        }));

      res.status(200).json(availableProfessionals);
      return res.end();
    } catch (error) {
      console.error("Error fetching available medical professionals:", error);
      res.status(500).json({ error: "Failed to fetch available medical professionals" });
      return res.end();
    }
  });

  // Get available radiologists for specialized imaging appointments
  app.get("/api/radiologists/available", async (req, res) => {
    try {
      const medicalStaff = await storage.getAllUsers();
      const availableRadiologists = medicalStaff
        .filter(user => user.role === 'radiologist')
        .map(radiologist => ({
          id: radiologist.id,
          name: radiologist.fullName,
          role: 'radiologist',
          specialty: radiologist.specialization || 'Medical Imaging',
          available: true,
          email: radiologist.email
        }));

      res.status(200).json(availableRadiologists);
      return res.end();
    } catch (error) {
      console.error("Error fetching available radiologists:", error);
      res.status(500).json({ error: "Failed to fetch available radiologists" });
      return res.end();
    }
  });

  // Available appointment slots endpoint for calendar integration
  app.get("/api/appointments/available-slots", async (req, res) => {
    try {
      let year = parseInt(req.query.year as string);
      if (isNaN(year)) {
        year = new Date().getFullYear();
      }
      let month = parseInt(req.query.month as string);
      if (isNaN(month)) {
        month = new Date().getMonth() + 1;
      }

      // Get base available slots
      const slots = await getAvailableAppointmentSlots(year, month);
      
      // Check Google Calendar availability for each slot
      const { googleCalendarService } = await import('./google-calendar-service');
      const enhancedSlots: any = {};
      
      for (const [dateStr, timeSlots] of Object.entries(slots)) {
        const availableTimesForDate: any[] = [];
        
        for (const timeSlot of timeSlots as any[]) {
          const availability = await googleCalendarService.checkTimeSlotAvailability(dateStr, timeSlot.time);
          
          if (availability.isAvailable) {
            availableTimesForDate.push({
              ...timeSlot,
              available: true,
              source: 'system'
            });
          } else {
            // Skip unavailable slots - don't show them in the UI
            console.log(`Time slot ${timeSlot.time} on ${dateStr} unavailable due to: ${availability.conflictingEvent?.summary || 'External calendar conflict'}`);
          }
        }
        
        enhancedSlots[dateStr] = availableTimesForDate;
      }
      
      res.json(enhancedSlots);
    } catch (error) {
      console.error("Error fetching available appointment slots:", error);
      res.status(500).json({ error: "Failed to fetch available appointment slots" });
    }
  });

  // Homepage Statistics API endpoint
  app.get("/api/homepage/statistics", async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      
      // Calculate real-time statistics from database
      const totalScans = allScans.length;
      const completedScans = allScans.filter(scan => scan.result !== 'Processing').length;
      const accurateScans = allScans.filter(scan => 
        scan.aiConfidence && parseFloat(scan.aiConfidence.replace('%', '')) > 90
      ).length;
      
      const statistics = [
        { 
          value: "5", 
          label: "Cancer Types" 
        },
        { 
          value: completedScans > 0 ? `${Math.round((accurateScans / completedScans) * 100)}%` : "97%", 
          label: "Accuracy Rate" 
        },
        { 
          value: "30%", 
          label: "Earlier Detection" 
        },
        { 
          value: totalScans > 0 ? `${Math.min(Math.round((totalScans / allUsers.length) * 10), 100)}%` : "60%", 
          label: "Workflow Efficiency" 
        },
      ];

      res.json(statistics);
    } catch (error) {
      console.error("Error fetching homepage statistics:", error);
      
      // Return fallback statistics if database fails
      const fallbackStats = [
        { value: "5", label: "Cancer Types" },
        { value: "97%", label: "Accuracy Rate" },
        { value: "30%", label: "Earlier Detection" },
        { value: "60%", label: "Workflow Efficiency" },
      ];
      
      res.json(fallbackStats);
    }
  });

  // Real-time location-based dermatologist finder
  app.post("/api/dermatologists/nearby", async (req, res) => {
    try {
      const { latitude, longitude, urgency = 'routine', scanResult } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ error: "Location coordinates required" });
      }

      // Get actual dermatologists from database
      const allUsers = await storage.getAllUsers();
      let dermatologists = allUsers
        .filter(user => user.role === 'doctor' && 
          (user.specialization?.toLowerCase().includes('dermatology') || 
           user.specialization?.toLowerCase().includes('skin')))
        .map((doctor, index) => ({
          id: doctor.id,
          name: doctor.fullName,
          specialty: doctor.specialization || "Dermatology",
          experience: "5+ years experience",
          rating: 4.5 + Math.random() * 0.5,
          location: "Medical Center",
          address: "Healthcare District",
          distance: `${(0.5 + Math.random() * 2).toFixed(1)} miles`,
          phone: doctor.phone || "Contact via platform",
          email: doctor.email,
          isUrgentCare: urgency === 'urgent' && index === 0,
          nextAvailable: urgency === 'urgent' ? 'Today 2:30 PM' : 'Next Monday',
          availableSlots: urgency === 'urgent' ? 
            ['2:30 PM', '3:15 PM', '4:00 PM'] : 
            ['9:00 AM', '10:30 AM', '2:00 PM', '3:30 PM'],
          hospitalAffiliation: "Medical Center",
          coordinates: { lat: latitude + (Math.random() - 0.5) * 0.01, lng: longitude + (Math.random() - 0.5) * 0.01 }
        }));

      // If no dermatologists in database, provide fallback
      if (dermatologists.length === 0) {
        dermatologists = [{
          id: 999,
          name: "Dr. Available Dermatologist",
          specialty: "General Dermatology",
          experience: "Available for consultation",
          rating: 4.5,
          location: "Nearby Medical Center",
          address: "Contact for location details",
          distance: "Contact for details",
          phone: "Contact via platform",
          email: "contact@platform.com",
          isUrgentCare: urgency === 'urgent',
          nextAvailable: urgency === 'urgent' ? 'Available today' : 'Available this week',
          availableSlots: ['Contact for availability'],
          hospitalAffiliation: "Partner Network",
          coordinates: { lat: latitude, lng: longitude }
        }];
      }

      // Sort by urgency and distance
      const sortedDermatologists = dermatologists.sort((a, b) => {
        if (urgency === 'urgent' && a.isUrgentCare !== b.isUrgentCare) {
          return b.isUrgentCare ? 1 : -1;
        }
        return parseFloat(a.distance) - parseFloat(b.distance);
      });

      // Add nearby hospitals for emergency cases
      const nearbyHospitals = [
        {
          name: "Main Medical Center",
          type: "Full Service Hospital",
          distance: "0.8 miles",
          emergencyDermatology: true,
          phone: "+1 (555) 100-2000",
          address: "123 Healthcare Drive, Medical District"
        },
        {
          name: "Regional Emergency Hospital",
          type: "Emergency & Trauma Center",
          distance: "1.5 miles",
          emergencyDermatology: urgency === 'urgent',
          phone: "+1 (555) 911-0000",
          address: "999 Emergency Way, Hospital District"
        }
      ];

      res.json({
        success: true,
        location: { latitude, longitude },
        urgency,
        dermatologists: sortedDermatologists,
        nearbyHospitals: urgency === 'urgent' ? nearbyHospitals : [],
        recommendations: {
          urgentCare: urgency === 'urgent' ? 
            "Based on your scan results, we recommend seeking immediate dermatological evaluation." :
            "Schedule a routine consultation for thorough evaluation.",
          timeframe: urgency === 'urgent' ? "Within 24-48 hours" : "Within 1-3 months"
        }
      });

    } catch (error) {
      console.error("Error finding nearby dermatologists:", error);
      res.status(500).json({ error: "Failed to find nearby specialists" });
    }
  });

  // Get available appointment slots for dermatologist
  app.get("/api/appointments/dermatologist-slots/:doctorId/:date", async (req, res) => {
    try {
      const { doctorId, date } = req.params;
      
      // Generate available time slots based on dermatologist and date
      const baseSlots = [
        '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
        '11:00 AM', '11:30 AM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
        '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM'
      ];

      // Filter out booked slots (simulate existing appointments)
      const bookedSlots = ['9:00 AM', '2:00 PM', '3:30 PM']; // Example booked slots
      const availableSlots = baseSlots.filter(slot => !bookedSlots.includes(slot));

      res.json(availableSlots);
    } catch (error) {
      console.error("Error fetching appointment slots:", error);
      res.status(500).json({ error: "Failed to fetch available slots" });
    }
  });

  // Schedule dermatologist appointment
  app.post("/api/appointments/dermatologist", async (req, res) => {
    try {
      const { dermatologistId, date, time, reason, notes, urgency, shareAnalysis, scanResult } = req.body;
      const patientId = (req.session as any)?.user?.id || 4; // Use valid patient ID

      // Find dermatologist info
      const dermatologistName = dermatologistId === 1 ? 'Dr. Sarah Mitchell' : 
                               dermatologistId === 2 ? 'Dr. Michael Chen' : 
                               'Dr. Emily Rodriguez';

      const appointmentData = {
        patientId,
        doctorId: dermatologistId,
        appointmentDate: new Date(date),
        appointmentTime: time,
        type: 'Dermatology Consultation',
        notes: notes || 'Dermatologist consultation following AI scan analysis',
        priority: urgency === 'urgent' ? 'high' : 'medium',
        reason: reason || 'Skin lesion evaluation'
      };

      const savedAppointment = await storage.createAppointment(appointmentData);

      res.json({
        success: true,
        appointment: savedAppointment,
        message: `Dermatologist appointment scheduled with ${dermatologistName}`
      });

    } catch (error) {
      console.error("Error scheduling dermatologist appointment:", error);
      res.status(500).json({ error: "Failed to schedule appointment" });
    }
  });

  // Image Upload and Analysis API endpoint
  app.post("/api/scan/upload", requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const { scanType, patientId: patientIdStr } = req.body;
      const imageBuffer = req.file.buffer;

      // Parse patientId from request body or session
      const patientId = patientIdStr ? parseInt(patientIdStr) : ((req.session as any)?.user?.id);
      if (patientIdStr && isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }

      if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" });
      }

      // Validate patientId exists in users table
      const user = await storage.getUser(patientId);
      if (!user) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }

      // Perform real-time AI analysis using unified cancer detection
      console.log(`Performing real-time analysis for ${scanType} scan...`);
      const analysisResult = await performRealTimeAnalysis(imageBuffer, scanType);

      // Save scan to database
      const scanData = {
        patientId: patientId,
        scanType: scanType,
        result: analysisResult.hasCancer ? 
          `${analysisResult.cancerType || 'Abnormal findings'} detected - ${analysisResult.riskLevel} risk` : 
          "No abnormal findings detected",
        aiConfidence: `${Math.round(analysisResult.confidence)}%`,
        notes: analysisResult.findings ? analysisResult.findings.join('. ') : 'Analysis completed'
      };

      const savedScan = await storage.createScan(scanData);

      // Return enhanced analysis results
      res.json({
        success: true,
        scan: savedScan,
        analysis: {
          // Primary Results
          type: scanType.charAt(0).toUpperCase() + scanType.slice(1),
          confidence: Math.round(analysisResult.confidence),
          accuracyLevel: Math.round(analysisResult.accuracyLevel),
          clinicalGrade: analysisResult.clinicalGrade,
          status: analysisResult.hasCancer ? "abnormal" : "normal",

          // Detailed Findings
          primaryFinding: analysisResult.findings?.[0] || 'Analysis completed',
          findings: analysisResult.findings || [],
          recommendations: analysisResult.recommendations || [],

          // Cancer Assessment
          cancerType: analysisResult.cancerType,
          riskLevel: analysisResult.riskLevel?.toUpperCase() || 'LOW',
          riskAssessment: (analysisResult.riskLevel?.charAt(0).toUpperCase() + analysisResult.riskLevel?.slice(1) + ' Risk') || 'Low Risk',

          // Clinical Details
          urgency: analysisResult.analysis?.urgency,
          requiresHumanReview: analysisResult.analysis?.requiresHumanReview ?? true,

          // Malignancy Indicators
          malignancyIndicators: analysisResult.malignancyIndicators || [],

          // Technical Metrics. No `||` defaults: an absent measurement is reported
          // as absent, not backfilled with a plausible-looking constant.
          processingTimeMs: analysisResult.advancedMetrics?.processingTimeMs ?? null,
          modelVersion: analysisResult.advancedMetrics?.modelVersion ?? null,
          inputResolution: analysisResult.advancedMetrics?.inputResolution ?? null,
          
          // Summary for UI Display
          summary: {
            aiConfidence: `${Math.round(analysisResult.confidence)}%`,
            riskAssessment: (analysisResult.riskLevel?.toUpperCase() || 'LOW') + ' RISK',
            primaryFinding: analysisResult.hasCancer ? 'Abnormal' : 'Normal',
            cancerType: analysisResult.cancerType + (analysisResult.hasCancer ? ' Cancer' : ''),
            urgentAction: analysisResult.riskLevel === 'high'
          }
        }
      });

    } catch (error) {
      if (error instanceof InputRejectedError) {
        return respondInputRejected(error, res);
      }
      if (error instanceof ModelUnavailableError) {
        return respondModelUnavailable(error, req, res);
      }
      console.error("Error processing image upload:", error);
      res.status(500).json({
        error: "Failed to process image analysis",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // New route for /api/scans/analyze to fix client-server mismatch
  app.post("/api/scans/analyze", requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const { scanType, patientId: patientIdStr } = req.body;
      const imageBuffer = req.file.buffer;

      // Parse patientId from request body or session
      const patientId = patientIdStr ? parseInt(patientIdStr) : ((req.session as any)?.user?.id);
      if (patientIdStr && isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }

      if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" });
      }

      // Validate patientId exists in users table
      const user = await storage.getUser(patientId);
      if (!user) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }

      // Perform real-time AI analysis using unified cancer detection
      console.log(`Performing real-time analysis for ${scanType} scan...`);
      const analysisResult = await performRealTimeAnalysis(imageBuffer, scanType);

      // Save scan to database
      const scanData = {
        patientId: patientId,
        scanType: scanType,
        result: analysisResult.hasCancer ? 
          `${analysisResult.cancerType || 'Abnormal findings'} detected - ${analysisResult.riskLevel} risk` : 
          "No abnormal findings detected",
        aiConfidence: `${Math.round(analysisResult.confidence)}%`,
        notes: analysisResult.findings ? analysisResult.findings.join('. ') : 'Analysis completed'
      };

      const savedScan = await storage.createScan(scanData);

      // Return enhanced analysis results
      res.json({
        success: true,
        scan: savedScan,
        analysis: {
          // Primary Results
          type: scanType.charAt(0).toUpperCase() + scanType.slice(1),
          confidence: Math.round(analysisResult.confidence),
          accuracyLevel: Math.round(analysisResult.accuracyLevel),
          clinicalGrade: analysisResult.clinicalGrade,
          status: analysisResult.hasCancer ? "abnormal" : "normal",

          // Detailed Findings
          primaryFinding: analysisResult.findings?.[0] || 'Analysis completed',
          findings: analysisResult.findings || [],
          recommendations: analysisResult.recommendations || [],

          // Cancer Assessment
          cancerType: analysisResult.cancerType,
          riskLevel: analysisResult.riskLevel?.toUpperCase() || 'LOW',
          riskAssessment: (analysisResult.riskLevel?.charAt(0).toUpperCase() + analysisResult.riskLevel?.slice(1) + ' Risk') || 'Low Risk',

          // Clinical Details
          urgency: analysisResult.analysis?.urgency,
          requiresHumanReview: analysisResult.analysis?.requiresHumanReview ?? true,

          // Malignancy Indicators
          malignancyIndicators: analysisResult.malignancyIndicators || [],

          // Technical Metrics. No `||` defaults: an absent measurement is reported
          // as absent, not backfilled with a plausible-looking constant.
          processingTimeMs: analysisResult.advancedMetrics?.processingTimeMs ?? null,
          modelVersion: analysisResult.advancedMetrics?.modelVersion ?? null,
          inputResolution: analysisResult.advancedMetrics?.inputResolution ?? null,
          
          // Summary for UI Display
          summary: {
            aiConfidence: `${Math.round(analysisResult.confidence)}%`,
            riskAssessment: (analysisResult.riskLevel?.toUpperCase() || 'LOW') + ' RISK',
            primaryFinding: analysisResult.hasCancer ? 'Abnormal' : 'Normal',
            cancerType: analysisResult.cancerType + (analysisResult.hasCancer ? ' Cancer' : ''),
            urgentAction: analysisResult.riskLevel === 'high'
          }
        }
      });

    } catch (error) {
      if (error instanceof InputRejectedError) {
        return respondInputRejected(error, res);
      }
      if (error instanceof ModelUnavailableError) {
        return respondModelUnavailable(error, req, res);
      }
      console.error("Error processing image analysis:", error);
      res.status(500).json({
        error: "Failed to process image analysis",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Patient dashboard stats API endpoint
  app.get("/api/patient/stats", async (req, res) => {
    try {
      const patientId = (req.session as any)?.user?.id || 2;
      const patientScans = await storage.getScans(patientId);
      
      const completedScans = patientScans.filter(scan => scan.result !== 'Processing').length;
      const pendingResults = patientScans.filter(scan => scan.result === 'Processing').length;
      
      // Calculate next appointment
      const nextAppointmentDays = 7;
      
      // Calculate health score based on scan results
      const normalScans = patientScans.filter(scan => 
        scan.result && !scan.result.toLowerCase().includes('abnormal')
      ).length;
      const healthScore = patientScans.length > 0 ? 
        Math.round((normalScans / patientScans.length) * 100) : 85;
      
      const stats = {
        completedScans: completedScans,
        pendingResults: pendingResults,
        nextAppointment: `${nextAppointmentDays} days`,
        healthScore: healthScore > 80 ? 'Good' : healthScore > 60 ? 'Fair' : 'Needs Attention'
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching patient stats:", error);
      res.status(500).json({ error: "Failed to fetch patient stats" });
    }
  });

  // Patient recent activities API endpoint (DB-backed)
  app.get("/api/patient/activities/recent", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const patientId = (req.session as any)?.user?.id;
      if (!patientId) return res.status(401).json({ error: 'Authentication required' });

      const activities = await storage.getPatientActivities(patientId);
      res.json(activities);
    } catch (error) {
      console.error("Error fetching patient activities:", error);
      res.status(500).json({ error: "Failed to fetch patient activities" });
    }
  });

  // Delete patient activity endpoint
  app.delete("/api/patient/activities/:id", async (req, res) => {
    try {
      const activityId = parseInt(req.params.id);
      if (isNaN(activityId)) {
        return res.status(400).json({ error: "Invalid activity ID" });
      }

      // Assuming activities correspond to scans, delete scan by ID
      const deleted = await storage.deleteScan(activityId);
      if (deleted) {
        res.json({ success: true, message: "Activity deleted successfully" });
      } else {
        res.status(404).json({ error: "Activity not found" });
      }
    } catch (error) {
      console.error("Error deleting patient activity:", error);
      res.status(500).json({ error: "Failed to delete patient activity" });
    }
  });



  // Doctor reports endpoint
  app.get("/api/doctor/reports", async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const allUsers = await storage.getAllUsers();
      
      const reports = allScans.map(scan => {
        const patient = allUsers.find(user => user.id === scan.patientId);
        return {
          id: scan.id,
          patientName: patient ? patient.fullName : `Patient ${scan.patientId}`,
          scanType: scan.scanType || 'Medical Scan',
          submittedAt: scan.createdAt || new Date().toISOString(),
          status: scan.status === 'Processing' ? 'pending' : 'completed',
          priority: scan.result && scan.result.toLowerCase().includes('urgent') ? 'urgent' : 'medium',
          findings: scan.result || 'Analysis completed',
          radiologist: 'Dr. Johnson',
          aiConfidence: scan.aiConfidence || '85%'
        };
      });

      res.json(reports);
    } catch (error) {
      console.error("Error fetching doctor reports:", error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  // Doctor recent activities API endpoint
  app.get("/api/doctor/activities/recent", async (req, res) => {
    try {
      const allScans = await storage.getScans();
      
      const recentActivities = allScans.slice(-5).map(scan => ({
        message: `Patient scan ${scan.scanType} completed`,
        timestamp: scan.createdAt ? new Date(scan.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString(),
        type: 'scan'
      }));

      res.json(recentActivities);
    } catch (error) {
      console.error("Error fetching doctor activities:", error);
      res.status(500).json({ error: "Failed to fetch doctor activities" });
    }
  });

  // Dermatologist scheduling endpoints
  app.get("/api/dermatologists/available", async (req, res) => {
    try {
      const urgency = req.query.urgency as string || 'routine';
      const dermatologists = await getAvailableDermatologists(urgency);
      res.json(dermatologists);
    } catch (error) {
      console.error("Error fetching available dermatologists:", error);
      res.status(500).json({ error: "Failed to fetch available dermatologists" });
    }
  });

  app.get("/api/appointments/dermatologist-slots", (req, res) => {
    const timeSlots = [
      "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
      "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM"
    ];

    const availableSlots = timeSlots.filter((_, index) => Math.random() > 0.3);
    res.json(availableSlots);
  });

  app.post("/api/appointments/dermatologist", async (req, res) => {
    try {
      const { 
        dermatologistId, 
        date, 
        time, 
        reason, 
        notes, 
        urgency, 
        shareAnalysis, 
        scanResult 
      } = req.body;

      const patientId = (req.session as any)?.user?.id || 2;

      const appointment = await storage.createAppointment({
        type: 'dermatology',
        patientId: patientId,
        doctorId: dermatologistId,
        appointmentDate: new Date(date),
        appointmentTime: time,
        notes: `${reason || 'Dermatologist consultation'}. ${notes || ''}`
      });

      if (shareAnalysis && scanResult) {
        await storage.createScan({
          patientId: patientId,
          scanType: 'skin-cancer',
          result: JSON.stringify(scanResult)
        });
      }

      res.json({
        success: true,
        appointment,
        message: 'Dermatologist appointment scheduled successfully'
      });
    } catch (error) {
      console.error('Error scheduling dermatologist appointment:', error);
      res.status(500).json({ 
        error: 'Failed to schedule appointment',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin staff creation endpoint
  app.post("/api/admin/staff", requireAuth, requireAdmin, sensitiveOperationLimit, validateInput, auditLog('CREATE_STAFF'), async (req, res) => {
    try {
      const { username, password, fullName, email, phone, role, specialization, licenseNumber } = req.body;
      
      // Validate required fields
      if (!username || !password || !fullName || !email || !role) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          message: 'Username, password, full name, email, and role are required'
        });
      }

      // Validate role
      if (!['doctor', 'radiologist'].includes(role)) {
        return res.status(400).json({ 
          error: 'Invalid role',
          message: 'Role must be either doctor or radiologist'
        });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ 
          error: 'Username already exists',
          message: 'Please choose a different username'
        });
      }

      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ 
          error: 'Email already exists',
          message: 'Please use a different email address'
        });
      }

      // Create new staff member
      const hashedPassword = await hashPassword(password);
      const staffData = {
        username,
        password: hashedPassword,
        fullName,
        email,
        phone: phone || null,
        role,
        specialization: specialization || null,
        licenseNumber: licenseNumber || null,
        age: null,
        gender: null
      };

      const newStaff = await storage.createUser(staffData);
      
      res.json({
        success: true,
        staff: {
          id: newStaff.id,
          username: newStaff.username,
          fullName: newStaff.fullName,
          email: newStaff.email,
          phone: newStaff.phone,
          role: newStaff.role,
          specialization: newStaff.specialization,
          licenseNumber: newStaff.licenseNumber
        },
        message: `${role === 'doctor' ? 'Doctor' : 'Radiologist'} created successfully`
      });
    } catch (error) {
      console.error('Error creating staff member:', error);
      res.status(500).json({ 
        error: 'Failed to create staff member',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin staff listing endpoint
  app.get("/api/admin/staff", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const staffMembers = allUsers
        .filter(user => ['doctor', 'radiologist'].includes(user.role))
        .map(staff => ({
          id: staff.id,
          username: staff.username,
          fullName: staff.fullName,
          email: staff.email,
          phone: staff.phone,
          role: staff.role,
          specialization: staff.specialization,
          licenseNumber: staff.licenseNumber,
          isActive: staff.isActive !== undefined ? staff.isActive : true,
          createdAt: staff.createdAt || new Date().toISOString()
        }));

      res.json({ data: staffMembers });
    } catch (error) {
      console.error('Error fetching staff members:', error);
      res.status(500).json({ 
        error: 'Failed to fetch staff members',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin staff deletion endpoint
  app.delete("/api/admin/staff/:id", requireAuth, requireAdmin, sensitiveOperationLimit, auditLog('DELETE_STAFF'), async (req, res) => {
    try {
      const staffId = parseInt(req.params.id);
      
      if (isNaN(staffId)) {
        return res.status(400).json({ 
          error: 'Invalid staff ID',
          message: 'Please provide a valid staff member ID'
        });
      }

      // Check if staff member exists
      const staffMember = await storage.getUser(staffId);
      if (!staffMember) {
        return res.status(404).json({ 
          error: 'Staff member not found',
          message: 'The specified staff member does not exist'
        });
      }

      // Verify it's a doctor or radiologist
      if (!['doctor', 'radiologist'].includes(staffMember.role)) {
        return res.status(400).json({ 
          error: 'Invalid staff member',
          message: 'Can only delete doctors and radiologists'
        });
      }

      // Delete the staff member
      const deleted = await storage.deleteUser(staffId);
      
      if (deleted) {
        res.status(200).json({
          success: true,
          message: `${staffMember.role === 'doctor' ? 'Doctor' : 'Radiologist'} deleted successfully`,
          deletedStaff: {
            id: staffMember.id,
            fullName: staffMember.fullName,
            role: staffMember.role
          }
        });
        return res.end();
      } else {
        res.status(500).json({ 
          error: 'Failed to delete staff member',
          message: 'Database operation failed'
        });
        return res.end();
      }
    } catch (error) {
      console.error('Error deleting staff member:', error);
      res.status(500).json({ 
        error: 'Failed to delete staff member',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin staff permanent deletion endpoint
  app.delete("/api/admin/staff/:id/permanent", requireAuth, requireAdmin, sensitiveOperationLimit, auditLog('PERMANENT_DELETE_STAFF'), async (req, res) => {
    try {
      const staffId = parseInt(req.params.id);
      
      if (isNaN(staffId)) {
        return res.status(400).json({ 
          error: 'Invalid staff ID',
          message: 'Please provide a valid staff member ID'
        });
      }

      // Check if staff member exists
      const staffMember = await storage.getUser(staffId);
      if (!staffMember) {
        return res.status(404).json({ 
          error: 'Staff member not found',
          message: 'The specified staff member does not exist'
        });
      }

      // Permanently delete the staff member
      const deleted = await storage.permanentlyDeleteUser(staffId);
      
      if (deleted) {
        res.status(200).json({
          success: true,
          message: `${staffMember.role === 'doctor' ? 'Doctor' : 'Radiologist'} permanently deleted`,
          deletedStaff: {
            id: staffMember.id,
            fullName: staffMember.fullName,
            role: staffMember.role
          }
        });
        return res.end();
      } else {
        res.status(500).json({ 
          error: 'Failed to permanently delete staff member',
          message: 'Database operation failed'
        });
        return res.end();
      }
    } catch (error) {
      console.error('Error permanently deleting staff member:', error);
      res.status(500).json({ 
        error: 'Failed to permanently delete staff member',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin staff update endpoint
  app.put("/api/admin/staff/:id", requireAuth, requireAdmin, validateInput, auditLog('UPDATE_STAFF'), async (req, res) => {
    try {
      const staffId = parseInt(req.params.id);
      if (isNaN(staffId)) {
        return res.status(400).json({
          error: 'Invalid staff ID',
          message: 'Please provide a valid staff member ID'
        });
      }

      const { username, fullName, email, role, specialization, licenseNumber, isActive } = req.body;

      if (!username || !fullName || !email || !role) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Username, full name, email, and role are required'
        });
      }

      if (!['doctor', 'radiologist'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role',
          message: 'Role must be either doctor or radiologist'
        });
      }

      const staffMember = await storage.getUser(staffId);
      if (!staffMember) {
        return res.status(404).json({
          error: 'Staff member not found',
          message: 'The specified staff member does not exist'
        });
      }

      // Check if username or email is being changed to one that already exists
      if (username !== staffMember.username) {
        const existingUser = await storage.getUserByUsername(username);
        if (existingUser && existingUser.id !== staffId) {
          return res.status(409).json({
            error: 'Username already exists',
            message: 'Please choose a different username'
          });
        }
      }

      if (email !== staffMember.email) {
        const existingEmail = await storage.getUserByEmail(email);
        if (existingEmail && existingEmail.id !== staffId) {
          return res.status(409).json({
            error: 'Email already exists',
            message: 'Please use a different email address'
          });
        }
      }

      // Prepare update data - explicitly handle specialization
      const updateData: any = {
        username,
        fullName,
        email,
        role,
        specialization: specialization || '',
        licenseNumber: licenseNumber || '',
        isActive: isActive !== undefined ? isActive : true
      };

      console.log('Updating staff with data:', updateData);

      const updatedStaff = await storage.updateUser(staffId, updateData);

      if (!updatedStaff) {
        return res.status(500).json({
          error: 'Failed to update staff member',
          message: 'Database operation failed'
        });
      }

      res.json({
        success: true,
        staff: {
          id: updatedStaff.id,
          username: updatedStaff.username,
          fullName: updatedStaff.fullName,
          email: updatedStaff.email,
          role: updatedStaff.role,
          specialization: updatedStaff.specialization,
          licenseNumber: updatedStaff.licenseNumber,
          isActive: updatedStaff.isActive
        },
        message: 'Staff member updated successfully'
      });
    } catch (error) {
      console.error('Error updating staff member:', error);
      res.status(500).json({
        error: 'Failed to update staff member',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin dashboard endpoints
  // Duplicate admin endpoints below will be removed to avoid conflicts; keep only authenticated variants above
  /*
  app.get("/api/admin/stats", async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allScans = await storage.getScans();
      const todayScans = allScans.filter(scan => {
        if (!scan.createdAt) return false;
        const scanDate = new Date(scan.createdAt);
        const today = new Date();
        return scanDate.toDateString() === today.toDateString();
      });

      const stats = {
        totalUsers: allUsers.length,
        activeScans: allScans.filter(scan => scan.result === 'Processing').length,
        systemUptime: 99.8,
        aiAccuracy: allScans.length > 0 ? Math.round(allScans.reduce((sum, scan) => {
          const confidence = scan.aiConfidence ? parseFloat(scan.aiConfidence.replace('%', '')) : 0;
          return sum + confidence;
        }, 0) / allScans.length) : 0,
        dailyScans: todayScans.length,
        criticalAlerts: allScans.filter(scan => 
          scan.result && (scan.result.includes('urgent') || scan.result.includes('critical'))
        ).length,
        databaseHealth: 98,
        securityStatus: 'secure'
      };
      res.json(stats);
    } catch (error) {
      console.error('Error fetching admin stats:', error);
      res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
  });

  app.get("/api/admin/users/metrics", async (req, res) => {
    try {
      // Get all users from database
      const allUsers = await storage.getAllUsers();
      
      // Count users by role
      const adminCount = allUsers.filter(user => user.role === 'admin').length;
      const radiologistCount = allUsers.filter(user => user.role === 'radiologist').length;
      const doctorCount = allUsers.filter(user => user.role === 'doctor').length;
      const patientCount = allUsers.filter(user => user.role === 'patient').length;
      
      // Calculate active users (approximately 70% of total users)
      const activeUsers = Math.floor((adminCount + radiologistCount + doctorCount + patientCount) * 0.7);
      
      // Get today's date to filter new users created today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Count users created today
      const newUsersToday = allUsers.filter(user => {
        if (!user.createdAt) return false;
        const createdDate = new Date(user.createdAt);
        return createdDate >= today;
      }).length;

      const metrics = {
        admins: adminCount,
        radiologists: radiologistCount,
        doctors: doctorCount,
        patients: patientCount,
        activeUsers: activeUsers,
        newUsersToday: newUsersToday
      };
      
      console.log('User metrics:', metrics);
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching user metrics:', error);
      res.status(500).json({ error: 'Failed to fetch user metrics' });
    }
  });
  
  // Get all users for admin management
  app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      
      // Map users to a consistent format
      const formattedUsers = allUsers.map(user => ({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        specialization: user.specialization,
        isActive: user.isActive !== undefined ? user.isActive : true,
        createdAt: user.createdAt || new Date().toISOString()
      }));
      
      res.json(formattedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });
  
  // Update user
  app.put("/api/admin/users/:id", requireAuth, requireAdmin, validateInput, auditLog('UPDATE_USER'), async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      const { username, fullName, email, role, specialization, isActive } = req.body;
      
      // Validate required fields
      if (!username || !fullName || !email || !role) {
        return res.status(400).json({ error: 'Username, full name, email, and role are required' });
      }
      
      // Check if user exists
      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Check if username is already in use by another user
      if (username !== existingUser.username) {
        const userWithUsername = await storage.getUserByUsername(username);
        if (userWithUsername && userWithUsername.id !== userId) {
          return res.status(409).json({ error: 'Username already in use' });
        }
      }
      
      // Check if email is already in use by another user
      if (email !== existingUser.email) {
        const userWithEmail = await storage.getUserByEmail(email);
        if (userWithEmail && userWithEmail.id !== userId) {
          return res.status(409).json({ error: 'Email already in use' });
        }
      }
      
      // Update user with specialization handling
      const updateData = {
        username,
        fullName,
        email,
        role,
        specialization: specialization || '',
        isActive: isActive !== undefined ? isActive : true
      };
      
      console.log('Updating user with data:', updateData);
      
      const updatedUser = await storage.updateUser(userId, updateData);
      
      res.json({
        success: true,
        user: updatedUser
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });
  
  // Delete user
  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, sensitiveOperationLimit, auditLog('DELETE_USER'), async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      // Check if user exists
      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Prevent deletion of admin users
      if (existingUser.role === 'admin') {
        return res.status(403).json({ error: 'Cannot delete admin users' });
      }
      
      // Delete user
      const deleted = await storage.deleteUser(userId);
      
      if (deleted) {
        res.json({
          success: true,
          message: 'User deleted successfully'
        });
      } else {
        res.status(500).json({ error: 'Failed to delete user' });
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });
  
  // Reset user password
  app.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, sensitiveOperationLimit, validateInput, auditLog('RESET_PASSWORD'), async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }
      
      // Check if user exists
      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Hash the new password
      const hashedPassword = await hashPassword(password);
      
      // Update user password
      await storage.updateUserPassword(userId, hashedPassword);
      
      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  app.get("/api/admin/scans/metrics", async (req, res) => {
    try {
      const metrics = {
        totalScans: 1247,
        pendingScans: 12,
        completedToday: 8,
        cancerDetections: 23,
        averageProcessingTime: 2.3,
        aiConfidenceAverage: 94
      };
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching scan metrics:', error);
      res.status(500).json({ error: 'Failed to fetch scan metrics' });
    }
  });

  app.get("/api/admin/activities/recent", async (req, res) => {
    try {
      const activities = [
        {
          message: "New doctor account created",
          timestamp: "2 hours ago",
          type: "user_creation"
        },
        {
          message: "System backup completed successfully",
          timestamp: "4 hours ago",
          type: "system"
        },
        {
          message: "AI model updated to v2.1.4",
          timestamp: "6 hours ago",
          type: "ai_update"
        },
        {
          message: "Security scan completed - no issues found",
          timestamp: "8 hours ago",
          type: "security"
        },
        {
          message: "Database optimization completed",
          timestamp: "12 hours ago",
          type: "database"
        }
      ];
      res.json(activities);
    } catch (error) {
      console.error('Error fetching activities:', error);
      res.status(500).json({ error: 'Failed to fetch activities' });
    }
  });



  app.post("/api/admin/doctors", async (req, res) => {
    try {
      const { username, password, fullName, email, specialization, licenseNumber, role } = req.body;
      
      if (!username || !password || !fullName || !email) {
        return res.status(400).json({ error: 'Username, password, full name, and email are required' });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      // Create the doctor/radiologist
      const hashedPassword = await hashPassword(password);
      const userData = {
        username,
        password: hashedPassword,
        fullName,
        email,
        role: role || 'doctor',
        specialization: specialization || 'General Practice',
        licenseNumber: licenseNumber || '',
        isActive: true
      };

      const newUser = await storage.createUser(userData);
      
      res.json({
        success: true,
        user: {
          id: newUser.id,
          username: newUser.username,
          fullName: newUser.fullName,
          email: newUser.email,
          role: newUser.role,
          specialization: newUser.specialization
        },
        message: `${role === 'radiologist' ? 'Radiologist' : 'Doctor'} created successfully`
      });
    } catch (error) {
      console.error('Error creating doctor/radiologist:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });
  */

  // Radiologist endpoints
  app.get("/api/radiologist/stats", async (req, res) => {
    try {
      const allScans = await storage.getScans();
      const pendingScans = allScans.filter(scan => scan.result === 'Processing');
      const todayScans = allScans.filter(scan => {
        const scanDate = new Date(scan.createdAt);
        const today = new Date();
        return scanDate.toDateString() === today.toDateString() && scan.result !== 'Processing';
      });

      const stats = {
        pendingReviews: pendingScans.length,
        completedToday: todayScans.length,
        aiConfidence: allScans.length > 0 ? Math.round(allScans.reduce((sum, scan) => {
          const confidence = scan.aiConfidence ? parseFloat(scan.aiConfidence.replace('%', '')) : 0;
          return sum + confidence;
        }, 0) / allScans.length) : 0,
        avgReviewTime: 3.2,
        totalScansReviewed: allScans.filter(scan => scan.result !== 'Processing').length,
        criticalCases: allScans.filter(scan => scan.result && (scan.result.includes('urgent') || scan.result.includes('critical'))).length,
        accuracyRate: 96,
        workloadHours: Math.round(todayScans.length * 0.2)
      };
      res.json(stats);
    } catch (error) {
      console.error('Error fetching radiologist stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  app.get("/api/radiologist/pending-reviews", async (req, res) => {
    try {
      // Mock pending scan reviews
      const pendingScans = [
        {
          id: 1,
          patientName: "John Smith",
          scanType: "CT Chest",
          priority: "urgent",
          submittedAt: new Date().toISOString(),
          aiPrediction: "Possible pulmonary nodule detected in right upper lobe",
          aiConfidence: 92,
          bodyPart: "Chest",
          referringDoctor: "Johnson",
          notes: "Patient has history of smoking"
        },
        {
          id: 2,
          patientName: "Sarah Wilson",
          scanType: "MRI Brain",
          priority: "high",
          submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          aiPrediction: "No acute abnormalities detected",
          aiConfidence: 89,
          bodyPart: "Brain",
          referringDoctor: "Davis",
          notes: "Headache evaluation"
        },
        {
          id: 3,
          patientName: "Michael Brown",
          scanType: "X-Ray Abdomen",
          priority: "medium",
          submittedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          aiPrediction: "Normal abdominal structures",
          aiConfidence: 85,
          bodyPart: "Abdomen",
          referringDoctor: "Miller",
          notes: "Abdominal pain"
        }
      ];
      res.json(pendingScans);
    } catch (error) {
      console.error('Error fetching pending reviews:', error);
      res.status(500).json({ error: 'Failed to fetch pending reviews' });
    }
  });

  app.get("/api/radiologist/completed-today", async (req, res) => {
    try {
      // Mock completed scans
      const completedScans = [
        {
          id: 1,
          patientName: "Emma Davis",
          scanType: "CT Abdomen",
          completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          findings: "Normal abdominal organs. No evidence of acute pathology.",
          recommendation: "No further imaging required at this time.",
          aiAccuracy: 96
        },
        {
          id: 2,
          patientName: "Robert Taylor",
          scanType: "X-Ray Chest",
          completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          findings: "Clear lung fields. Heart size within normal limits.",
          recommendation: "Routine follow-up as clinically indicated.",
          aiAccuracy: 94
        }
      ];
      res.json(completedScans);
    } catch (error) {
      console.error('Error fetching completed scans:', error);
      res.status(500).json({ error: 'Failed to fetch completed scans' });
    }
  });

  app.post("/api/radiologist/scans/:id/report", async (req, res) => {
    try {
      const scanId = parseInt(req.params.id);
      const { findings, recommendation } = req.body;
      
      if (!findings || !recommendation) {
        return res.status(400).json({ error: 'Findings and recommendation are required' });
      }

      // In a real app, this would save to database
      const report = {
        scanId,
        findings,
        recommendation,
        radiologistId: (req.session as any)?.user?.id,
        completedAt: new Date().toISOString(),
        status: 'completed'
      };

      res.json({
        success: true,
        message: 'Report submitted successfully',
        report
      });
    } catch (error) {
      console.error('Error submitting report:', error);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  });

  // Handle critical case actions
  app.post("/api/doctor/patients/:id/critical-action", async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const { action } = req.body;
      
      if (isNaN(patientId)) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }

      // Get patient info
      const patient = await storage.getUser(patientId);
      if (!patient) {
        return res.status(404).json({ error: "Patient not found" });
      }

      let message = '';
      let result = null;
      
      switch (action) {
        case 'schedule_urgent':
          try {
            // Create urgent appointment
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const appointmentData = {
              patientId: patientId,
              doctorId: (req.session as any)?.user?.id || 15,
              date: tomorrow.toISOString().split('T')[0],
              time: '09:00 AM',
              type: 'Urgent Consultation',
              status: 'scheduled',
              reason: 'Critical case requiring immediate attention',
              priority: 'urgent'
            };
            
            // Insert appointment directly into database
            const query = `
              INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, type, status, reason)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            
            await new Promise((resolve, reject) => {
              (storage as any).db.run(query, [
                appointmentData.patientId,
                appointmentData.doctorId,
                appointmentData.date,
                appointmentData.time,
                appointmentData.type,
                appointmentData.status,
                appointmentData.reason
              ], function(this: any, err: any) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
              });
            });
            
            message = `Urgent appointment scheduled for ${tomorrow.toLocaleDateString()} at 09:00 AM`;
          } catch (appointmentError) {
            console.error('Error creating appointment:', appointmentError);
            message = 'Urgent appointment request logged - manual scheduling required';
          }
          break;
          
        case 'contact_patient':
          message = `Contact initiated for ${patient.fullName} - Follow up within 2 hours`;
          break;
          
        case 'refer_specialist':
          message = `Specialist referral created for ${patient.fullName} - Oncology consultation recommended`;
          break;
          
        default:
          message = 'Action processed successfully';
      }

      res.json({
        success: true,
        message,
        action,
        patientId,
        patientName: patient.fullName,
        result
      });
    } catch (error) {
      console.error('Error handling critical case:', error);
      res.status(500).json({ 
        error: 'Failed to handle critical case',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Check available time slots endpoint
  app.get("/api/doctor/appointments/available-slots", async (req, res) => {
    try {
      const { date } = req.query;
      const doctorId = (req.session as any)?.user?.id;
      
      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      // Get existing appointments for the date
      const existingAppointments = await storage.getDoctorAppointments(doctorId);
      const dateAppointments = existingAppointments.filter(apt => {
        const aptDate = new Date(apt.appointmentDate).toISOString().split('T')[0];
        return aptDate === date;
      });

      // Define all possible time slots
      const allSlots = [
        '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
        '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
      ];

      // Filter out booked slots from local database
      const bookedSlots = dateAppointments.map(apt => apt.appointmentTime);
      let availableSlots = allSlots.filter(slot => !bookedSlots.includes(slot));

      // Check Google Calendar availability for remaining slots
      const { googleCalendarService } = await import('./google-calendar-service');
      const finalAvailableSlots: string[] = [];
      
      for (const slot of availableSlots) {
        const availability = await googleCalendarService.checkTimeSlotAvailability(date as string, slot);
        if (availability.isAvailable) {
          finalAvailableSlots.push(slot);
        }
      }

      res.json(finalAvailableSlots);
    } catch (error) {
      console.error('Error fetching available slots:', error);
      res.status(500).json({ error: 'Failed to fetch available slots' });
    }
  });

  // Doctor appointment scheduling endpoint
  app.post("/api/doctor/appointments/schedule", requireAuth, requireMedicalStaff, async (req, res) => {
    try {
      const { patientId, appointmentDate, appointmentTime, type, reason, priority } = req.body;
      const doctorId = (req.session as any)?.user?.id;
      
      if (!patientId || !appointmentDate || !appointmentTime || !type) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Check if time slot is available
      const existingAppointments = await storage.getDoctorAppointments(doctorId);
      const conflictingAppointment = existingAppointments.find(apt => {
        const aptDate = new Date(apt.appointmentDate).toISOString().split('T')[0];
        return aptDate === appointmentDate && apt.appointmentTime === appointmentTime;
      });

      if (conflictingAppointment) {
        return res.status(409).json({ error: "Time slot is already booked" });
      }

      const appointmentData = {
        patientId: parseInt(patientId),
        doctorId,
        appointmentDate: new Date(appointmentDate),
        appointmentTime,
        type,
        reason: reason || 'Doctor scheduled appointment',
        status: 'scheduled',
        priority: priority || 'medium'
      };

      const newAppointment = await storage.createAppointment(appointmentData);
      
      res.json({
        success: true,
        message: 'Appointment scheduled successfully',
        appointment: newAppointment
      });
    } catch (error) {
      console.error('Error scheduling appointment:', error);
      res.status(500).json({ error: 'Failed to schedule appointment' });
    }
  });

  // Create new patient endpoint
  app.post("/api/patients", async (req, res) => {
    try {
      const { name, email, phone, age, gender } = req.body;
      
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: "Email already exists" });
      }

      // Create patient user
      const patientData = {
        username: email,
        password: await hashPassword('defaultPassword123'), // Default password
        fullName: name,
        email,
        phone: phone || null,
        age: age || null,
        gender: gender || null,
        role: 'patient'
      };

      const newPatient = await storage.createUser(patientData);
      
      res.json({
        success: true,
        patient: {
          id: newPatient.id,
          name: newPatient.fullName,
          email: newPatient.email,
          phone: newPatient.phone,
          age: newPatient.age,
          gender: newPatient.gender
        },
        message: 'Patient created successfully'
      });
    } catch (error) {
      console.error('Error creating patient:', error);
      res.status(500).json({ error: 'Failed to create patient' });
    }
  });

  // Skin cancer model training endpoint (admin only)
  app.post("/api/admin/train-skin-model", requireAuth, requireAdmin, sensitiveOperationLimit, auditLog('TRAIN_AI_MODEL'), async (req, res) => {
    try {
      const { skinCancerService } = await import('./skin-cancer-service');
      
      console.log('Starting ResNet50V2 skin cancer model training...');
      const result = await skinCancerService.trainModel();
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          modelInfo: skinCancerService.getModelInfo()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message
        });
      }
    } catch (error) {
      console.error('Error training skin cancer model:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start model training'
      });
    }
  });

  // Get skin cancer model info endpoint
  app.get("/api/admin/skin-model-info", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { skinCancerService } = await import('./skin-cancer-service');
      const modelInfo = skinCancerService.getModelInfo();
      res.json(modelInfo);
    } catch (error) {
      console.error('Error getting model info:', error);
      res.status(500).json({ error: 'Failed to get model information' });
    }
  });

  // Google Calendar service status endpoint
  app.get("/api/admin/calendar-status", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { googleCalendarService } = await import('./google-calendar-service');
      const status = googleCalendarService.getServiceStatus();
      res.json(status);
    } catch (error) {
      console.error('Error getting calendar status:', error);
      res.status(500).json({ error: 'Failed to get calendar service status' });
    }
  });

  // Patient cancer risk questionnaire endpoint
  app.post("/api/patient/questionnaire", async (req, res) => {
    try {
      const { responses, patientId } = req.body;

      if (!responses || !patientId) {
        return res.status(400).json({ error: "Missing questionnaire responses or patient ID" });
      }

      // Simple mock risk assessment logic based on responses
      let riskScore = 0;

      // Age factor
      if (responses.age >= 50) riskScore += 3;
      else if (responses.age >= 40) riskScore += 2;
      else if (responses.age >= 30) riskScore += 1;

      // Family history
      if (responses.familyHistory === 'yes') riskScore += 3;
      else if (responses.familyHistory === 'unknown') riskScore += 1;

      // Smoking
      if (responses.smoking === 'current') riskScore += 3;
      else if (responses.smoking === 'former') riskScore += 2;

      // Symptoms count
      if (responses.symptoms && Array.isArray(responses.symptoms)) {
        riskScore += Math.min(responses.symptoms.length, 3);
      }

      // Exercise factor
      if (responses.exercise === 'rarely') riskScore += 2;
      else if (responses.exercise === 'occasionally') riskScore += 1;

      // Diet factor
      if (responses.diet === 'poor') riskScore += 2;
      else if (responses.diet === 'fair') riskScore += 1;

      // Alcohol consumption
      if (responses.alcohol === 'heavy') riskScore += 2;
      else if (responses.alcohol === 'moderate') riskScore += 1;

      // Medical history count
      if (responses.medicalHistory && Array.isArray(responses.medicalHistory)) {
        riskScore += Math.min(responses.medicalHistory.length, 3);
      }

      // Determine risk level
      let riskLevel = 'low';
      if (riskScore >= 10) riskLevel = 'high';
      else if (riskScore >= 5) riskLevel = 'moderate';

      // Mock recommendations
      const recommendations: string[] = [];
      if (riskLevel === 'high') {
        recommendations.push("Consult a specialist immediately.");
        recommendations.push("Schedule regular screenings.");
      } else if (riskLevel === 'moderate') {
        recommendations.push("Maintain a healthy lifestyle.");
        recommendations.push("Consider periodic checkups.");
      } else {
        recommendations.push("Continue regular health monitoring.");
      }

      // Mock appointment suggestion
      const appointmentSuggestion = {
        recommended: riskLevel !== 'low',
        urgency: riskLevel === 'high' ? 'urgent' : 'routine',
        message: riskLevel === 'high' ? 
          "Based on your responses, an urgent appointment is recommended." : 
          "A routine appointment is suggested for further evaluation.",
        specialization: "Oncology"
      };

      const riskAssessment = {
        score: riskScore,
        level: riskLevel,
        recommendations
      };

      res.json({
        riskAssessment,
        appointmentSuggestion
      });

    } catch (error) {
      console.error("Error processing questionnaire:", error);
      res.status(500).json({ error: "Failed to process questionnaire" });
    }
  });

  // Chat API endpoints
  app.get("/api/chat/participants", requireAuth, async (req, res) => {
    try {
      const userRole = req.query.role as string;
      const allUsers = await storage.getAllUsers();
      
      let participants: any[] = [];
      if (userRole === 'patient') {
        // Patients can chat with doctors and radiologists
        participants = allUsers.filter(user => 
          ['doctor', 'radiologist'].includes(user.role) && 
          user.fullName && 
          user.fullName.trim() !== ''
        );
      } else if (['doctor', 'radiologist'].includes(userRole)) {
        // Medical staff can chat with patients
        participants = allUsers.filter(user => 
          user.role === 'patient' && 
          user.fullName && 
          user.fullName.trim() !== ''
        );
      }
      
      const chatParticipants = participants.map(user => ({
        id: user.id,
        name: user.fullName || user.username,
        role: user.role,
        isOnline: false, // Real online status would require WebSocket tracking
        lastSeen: null
      }));
      
      // Removed excessive logging
      res.json(chatParticipants);
    } catch (error) {
      console.error('Failed to fetch chat participants:', error);
      res.status(500).json({ error: 'Failed to fetch participants' });
    }
  });

  app.get("/api/chat/messages", requireAuth, async (req, res) => {
    try {
      const participantId = parseInt(req.query.participantId as string);
      const currentUserId = (req.session as any)?.user?.id;
      
      if (!currentUserId || !participantId) {
        return res.json([]);
      }
      
      // Get messages from database
      const messages = await storage.getChatMessages(currentUserId, participantId);
      res.json(messages);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post("/api/chat/send", requireAuth, validateInput, async (req, res) => {
    try {
      const { receiverId, message } = req.body;
      const currentUserId = (req.session as any)?.user?.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUserId || !receiverId || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      // Create message object
      const messageData = {
        senderId: currentUserId,
        receiverId: parseInt(receiverId),
        message: message.trim(),
        messageType: 'text',
        status: 'sent'
      };
      
      // Store in database
      const savedMessage = await storage.createChatMessage(messageData);
      
      // Return message with sender info
      const responseMessage = {
        ...savedMessage,
        senderName: currentUser?.fullName || currentUser?.username || 'Unknown',
        timestamp: savedMessage.createdAt
      };
      
      console.log(`💬 Message sent from ${responseMessage.senderName} to user ${receiverId}`);
      
      res.json(responseMessage);
    } catch (error) {
      console.error('Failed to send message:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.post("/api/chat/mark-read", async (req, res) => {
    try {
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to mark as read' });
    }
  });

  // In-memory notification storage (replace with database in production)
  const notifications: any[] = [];

  app.post("/api/chat/notify", async (req, res) => {
    try {
      const { recipientId, senderId, senderName, message, timestamp } = req.body;
      
      // Store notification in memory
      const notification = {
        id: Date.now(),
        recipientId: parseInt(recipientId),
        senderId: parseInt(senderId),
        senderName,
        message: `${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
        timestamp,
        type: 'chat_message',
        read: false
      };
      
      notifications.unshift(notification); // Add to beginning
      
      // Keep only last 50 notifications
      if (notifications.length > 50) {
        notifications.splice(50);
      }
      
      console.log(`📧 Notification sent to user ${recipientId}: ${senderName} sent a message`);
      
      res.json({ success: true, notificationId: notification.id });
    } catch (error) {
      console.error('Notification error:', error);
      res.status(500).json({ error: 'Failed to send notification' });
    }
  });

  app.get("/api/chat/notifications", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      
      // Get notifications for this user
      const userNotifications = notifications
        .filter(n => n.recipientId === userId)
        .slice(0, 10); // Return only last 10 notifications
      
      res.json(userNotifications);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.post("/api/chat/notifications/mark-read", async (req, res) => {
    try {
      const { notificationId, userId } = req.body;
      
      // Mark notification as read
      const notification = notifications.find(n => 
        n.id === parseInt(notificationId) && n.recipientId === parseInt(userId)
      );
      
      if (notification) {
        notification.read = true;
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      res.status(500).json({ error: 'Failed to mark as read' });
    }
  });

  // Teams meeting endpoints
  app.post('/api/teams/create-meeting', requireAuth, async (req, res) => {
    try {
      const { participantId, participantName, subject } = req.body;
      const userId = (req.session as any)?.user?.id;

      if (!participantId || !participantName) {
        return res.status(400).json({ error: 'Participant information required' });
      }

      // Import Teams service with error handling
      let TeamsService;
      try {
        const teamsModule = await import('./teams-service');
        TeamsService = teamsModule.TeamsService;
      } catch (importError) {
        console.error('Teams service import failed:', importError);
        return res.status(500).json({ error: 'Teams service unavailable' });
      }

      const teamsService = new TeamsService(process.env.TEAMS_ACCESS_TOKEN);
      
      const meeting = await teamsService.createMeeting(
        subject || `Medical Consultation`,
        [`user${userId}@healthai.local`, `user${participantId}@healthai.local`]
      );

      // Ensure we return valid JSON
      res.setHeader('Content-Type', 'application/json');
      res.json({
        success: true,
        meetingId: meeting.meetingId,
        joinUrl: meeting.joinUrl,
        subject: meeting.subject,
        startTime: meeting.startTime,
        fallback: (meeting as any).fallback || false
      });
    } catch (error) {
      console.error('Teams meeting creation error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ 
        success: false,
        error: 'Failed to create Teams meeting',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post('/api/teams/end-meeting', requireAuth, async (req, res) => {
    try {
      const { meetingId } = req.body;

      if (!meetingId) {
        return res.status(400).json({ error: 'Meeting ID required' });
      }

      const { TeamsService } = await import('./teams-service');
      const teamsService = new TeamsService(process.env.TEAMS_ACCESS_TOKEN);
      const result = await teamsService.endMeeting(meetingId);

      res.json(result);
    } catch (error) {
      console.error('Teams meeting end error:', error);
      res.status(500).json({ error: 'Failed to end Teams meeting' });
    }
  });

  // Twilio voice calling endpoints
  app.post("/api/voice/token", async (req, res) => {
    try {
      const currentUserId = (req.session as any)?.user?.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { TwilioService } = await import('./twilio-service');
      const token = TwilioService.generateAccessToken(currentUser.username);
      
      if (!token) {
        return res.status(500).json({ error: 'Twilio not configured' });
      }
      
      res.json({ token });
    } catch (error) {
      console.error('Token generation error:', error);
      res.status(500).json({ error: 'Failed to generate token' });
    }
  });

  app.post("/api/voice/call", async (req, res) => {
    try {
      const { recipientId } = req.body;
      const currentUserId = (req.session as any)?.user?.id;
      const currentUser = await storage.getUser(currentUserId);
      const recipient = await storage.getUser(recipientId);
      
      if (!currentUser || !recipient) {
        return res.status(400).json({ error: 'Invalid users' });
      }

      // Check if recipient has a valid phone number
      if (!recipient.phone || recipient.phone.trim() === '') {
        return res.status(400).json({ error: 'Recipient does not have a phone number configured' });
      }

      const { TwilioService } = await import('./twilio-service');
      
      // Use recipient's phone number from database
      const phoneNumber = recipient.phone;
      
      console.log(`Attempting to call ${phoneNumber} from ${currentUser.fullName}`);
      
      const result = await TwilioService.makeCall(phoneNumber, currentUser.fullName || currentUser.username);
      
      console.log('Call result:', result);
      res.json(result);
    } catch (error) {
      console.error('Call initiation error:', error);
      res.status(500).json({ error: (error as Error).message || 'Failed to initiate call' });
    }
  });

  // ===============================
  // ADVANCED FEATURES INTEGRATION
  // ===============================
  
  // Apply performance optimization middleware
  app.use(createCompressionMiddleware());
  app.use(ResponseOptimizer.createETagMiddleware());
  app.use(ResponseOptimizer.createResponseTimeMiddleware());
  app.use(PerformanceMonitor.createPerformanceMiddleware());

  // Mount advanced routes
  app.use('/api/advanced', advancedRoutes);

  // Genomics: consent, genotype upload, polygenic scoring, fused risk.
  // Every data-touching route inside enforces consent and writes an audit entry.
  app.use('/api/genomics', genomicsRoutes);

  // Track application usage for analytics
  app.use('/api/*', async (req: AuthenticatedRequest, res, next) => {
    if (req.session?.user) {
      await analyticsEngine.trackUserActivity({
        userId: req.session.user.id,
        action: `${req.method}_${req.path}`,
        resource: req.path,
        timestamp: new Date(),
        metadata: {
          userAgent: req.headers['user-agent'],
          ip: req.ip
        }
      });
    }
    next();
  });

  console.log('🚀 Advanced features integrated successfully');

  const httpServer = createServer(app);
  
  // Initialize enhanced WebSocket server
  const { initializeEnhancedWebSocket } = await import("./websocket");
  const wsManager = initializeEnhancedWebSocket(httpServer);
  
  console.log("✅ Enhanced WebSocket server initialized");
  
  return httpServer;
}
