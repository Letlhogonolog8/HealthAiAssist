import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSchema, insertScanSchema, insertTermSchema } from "@shared/schema";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import multer from "multer";
import { hashPassword, verifyPassword, loginLimiter } from "./auth-middleware";
import {
  getPatientProfile,
  getAvailableDermatologists,
  getAvailableAppointmentSlots,
  getClinicianSlotsForDate,
} from './services';
import { medicalChatbotService } from "./chatbot-service";
import { modelVersionFor } from "./model-fingerprint";
import { infer, isInferenceServerConfigured, warnIfFallingBack, InferenceBusyError } from "./inference-client";
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
  requireAppointmentOwnership,
  requireScanOwnership,
  sensitiveOperationLimit,
  authLimit,
  validateInput,
  auditLog
} from "./security-middleware";
import advancedRoutes from "./advanced-routes";
import genomicsRoutes from "./genomics-routes";
import { enhancedWsManager } from "./websocket";

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
  analysis: Record<string, any>;
  malignancyIndicators: any[];
  advancedMetrics: Record<string, any>;
}

// Real-time analysis function using Python models
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { randomUUID } from 'crypto';
import { uploadToGoogleCloudStorage, getSignedScanUrl, isScanObjectStoreAvailable } from './google-cloud-service';
import { ModelUnavailableError, InputRejectedError, assertModelEnabled, MODEL_REGISTRY } from './model-availability';
import { summarise, type ProductionPerformance } from './production-performance';
import { deliverInBackground } from './notification-delivery';
import { OUTCOME_METHODS, OUTCOME_VALUES } from '@shared/schema';
import {
  DISCLOSURE_TEXT,
  DISCLOSURE_VERSION,
  hasExternalAiConsent,
  recordExternalAiConsent,
} from './privacy/external-processing';

/** Extensions accepted for a stored scan, keyed by the MIME type multer reported. */
const SCAN_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tif',
  'image/tif': 'tif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Stores the uploaded image and returns a reference for medical_scans.imagePath.
 *
 * Uploads were analysed and then discarded: the buffer went to the model, the
 * verdict went to the database, and `imagePath` was never set on the row. A
 * radiologist opening a scan flagged "high risk" therefore saw a confidence
 * figure with no image behind it, which makes the human-review step — the one
 * the model cards insist on — impossible to perform.
 *
 * Cloud Storage when it is configured, the local uploads directory otherwise.
 * Neither location is web-accessible: reads go through
 * GET /api/scans/:id/image, which checks who is asking.
 *
 * A storage failure is logged and yields null rather than throwing. Losing the
 * image is bad; losing the finding as well, after the model has already flagged
 * something, is worse.
 */
async function persistScanImage(
  imageBuffer: Buffer,
  file: Express.Multer.File,
  patientId: number,
  scanType: string
): Promise<string | null> {
  const extension = SCAN_IMAGE_EXTENSIONS[file.mimetype] ?? 'bin';
  // Never the client's filename: it is attacker-controlled and has traversal
  // sequences in it often enough to matter.
  const objectName = `scans/${patientId}/${scanType}-${Date.now()}-${randomUUID()}.${extension}`;

  // Cloud Storage first when it is configured, local disk when it is not — and
  // local disk *also* when Cloud Storage is configured but fails.
  //
  // That last case is not hypothetical: credentials were present on the machine
  // this was tested on, the default bucket was not, and every upload threw. The
  // first version of this function treated a configured-but-failing object store
  // as final and returned null, so a misconfigured bucket name silently
  // discarded medical images while every other part of the request succeeded.
  // A wrong storage location is a deployment mistake; losing the image is a
  // clinical one.
  if (isScanObjectStoreAvailable()) {
    try {
      return await uploadToGoogleCloudStorage(imageBuffer, objectName, file.mimetype);
    } catch (error) {
      console.error(
        'Cloud Storage upload failed; falling back to local disk. Check ' +
          'GOOGLE_CLOUD_SCAN_BUCKET and the service account permissions:',
        error
      );
    }
  }

  try {
    const destination = path.join(process.cwd(), 'uploads', objectName);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, imageBuffer);
    return `file://${objectName}`;
  } catch (error) {
    console.error('Failed to store scan image; the result is kept without it:', error);
    return null;
  }
}

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

/**
 * The fallback lung transport: stage a file, spawn the CLI, parse its stdout.
 *
 * Extracted from performLungCancerAnalysis so the two transports sit side by
 * side and neither is the "normal" one buried in the other's control flow.
 * Retained because the CLI has to keep working regardless — it is what
 * scripts/evaluate-model.py and the model-card reproduction commands invoke.
 *
 * spawn(), not exec(). exec() hands the whole string to a shell, so every
 * argument in it is shell syntax until proven otherwise. Both arguments here
 * happen to be safe — PYTHON_BIN is operator-set and the path ends in a
 * generated UUID — but "happens to be safe" is a property of today's callers,
 * not of the code, and the quoting that protected it (`"${tempImagePath}"`) is
 * exactly the pattern that fails the moment a path contains a quote.
 *
 * PYTHON_BIN overrides the interpreter; otherwise the one on PATH is used. This
 * previously preferred `venv/Scripts/python.exe` as a bare relative path, which
 * the Windows shell does not resolve — every lung request failed with "'venv' is
 * not recognized", and it went unnoticed because the model was not loading
 * either, so the failure looked like an unavailable model rather than a wrong
 * command.
 */
async function analyseLungBySpawningPython(imageBuffer: Buffer): Promise<any> {
  warnIfFallingBack('lung');

  const uploadsDir = path.join(process.cwd(), 'uploads');
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const tempImagePath = path.join(uploadsDir, `temp_lung_${randomUUID()}.jpg`);
  await fs.promises.writeFile(tempImagePath, imageBuffer);

  const pythonCmd = process.env.PYTHON_BIN || 'python';

  try {
    return await new Promise<any>((resolve, reject) => {
      const child = spawn(pythonCmd, ['server/lung-cancer-service.py', tempImagePath]);

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (error) => {
        reject(new ModelUnavailableError('lung', `Model process failed to start: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new ModelUnavailableError('lung', `Model process failed: ${stderr.trim() || `exit ${code}`}`));
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
    try {
      await fs.promises.unlink(tempImagePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }
  }
}

// ResNet50V2 model analysis for lung cancer
async function performLungCancerAnalysis(imageBuffer: Buffer): Promise<AnalysisResult> {
  const startedAt = Date.now();
  try {
    let result: any;

    if (isInferenceServerConfigured()) {
      // Straight over the wire. No temporary file, no process, no TensorFlow
      // import: the model is already resident in the inference service.
      result = await infer('lung', imageBuffer, 'scan.jpg');
    } else {
      result = await analyseLungBySpawningPython(imageBuffer);
    }

    // The image failed a quality or domain check. The model is fine; the input is
    // not a chest image it can assess, so nothing is classified.
    if (result.status === 'rejected_input') {
      throw new InputRejectedError('lung', Array.isArray(result.reasons) && result.reasons.length
        ? result.reasons
        : ['This image could not be assessed.']);
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
        // Derived from a hash of the artifact, not a hand-maintained literal.
        // This read 'resnet50v2-lung-v2' with a comment saying the threshold was
        // 0.28; the deployed threshold is 0.30. Both the label and the comment
        // beside it had drifted from the model they described, which is the
        // failure mode server/model-fingerprint.ts exists to remove.
        modelVersion: await modelVersionFor('lung'),
        inputResolution: '224x224'
      }
    };

    return analysisResult;
  } catch (error) {
    if (error instanceof ModelUnavailableError || error instanceof InputRejectedError) throw error;

    // Saturation is still ModelUnavailableError, and deliberately so: the
    // caller answers 503 and records the scan as pending_manual_review, which
    // is the correct outcome for "no model produced an opinion" whatever the
    // reason. Only the message differs, so an operator reading the logs can
    // tell a queue that is full from a model that is broken — those need
    // different responses, and one of them is "add capacity".
    if (error instanceof InferenceBusyError) {
      throw new ModelUnavailableError(
        'lung',
        'Inference service is at capacity; the scan was queued for manual review rather than delayed.'
      );
    }

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
    // The staging and cleanup that used to sit here has moved into the service,
    // which now takes the buffer. With an inference service configured the bytes
    // never touch the filesystem at all; without one it writes and removes the
    // same temporary file this did.
    const result = await skinCancerService.analyzeImage(imageBuffer);

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
        // Derived from a hash of the artifact. See server/model-fingerprint.ts.
        modelVersion: await modelVersionFor('skin'),
        inputResolution: '224x224'
      }
    };

    return analysisResult;
  } catch (error) {
    if (error instanceof ModelUnavailableError || error instanceof InputRejectedError) throw error;

    // Saturation is still ModelUnavailableError, and deliberately so: the
    // caller answers 503 and records the scan as pending_manual_review, which
    // is the correct outcome for "no model produced an opinion" whatever the
    // reason. Only the message differs, so an operator reading the logs can
    // tell a queue that is full from a model that is broken — those need
    // different responses, and one of them is "add capacity".
    if (error instanceof InferenceBusyError) {
      throw new ModelUnavailableError(
        'skin',
        'Inference service is at capacity; the scan was queued for manual review rather than delayed.'
      );
    }

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

/**
 * A real connectivity check, for dashboards that want to report database health.
 *
 * Replaces the constant 98 that /api/admin/stats used to return under the name
 * "databaseHealth". A percentage that never changes is not a health signal.
 */
async function probeDatabase(): Promise<{ reachable: boolean; latencyMs: number | null }> {
  try {
    const { pool } = await import('./db');
    const started = Date.now();
    await pool.query('SELECT 1');
    return { reachable: true, latencyMs: Date.now() - started };
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // The second global limiter that stood here has been removed.
  //
  // applySecurityMiddleware already installs a general /api limiter, plus
  // tighter ones for /api/auth, the medical routes and chat. This added a third
  // — 100 requests per minute per IP, with no development skip and no
  // exemption — registered halfway down the route table, so it covered the
  // routes below it and not the ones above. Two overlapping global limiters make
  // the effective budget the minimum of the two and neither one obvious from
  // reading either file.

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
      reproduce: 'python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>',
      // These figures describe a held-out dataset, not this deployment. How the
      // models behave on the patients actually seen here is a separate
      // measurement, taken from confirmed outcomes.
      productionPerformance: '/api/models/performance'
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

      // Regenerate the session on privilege change, then populate it.
      //
      // This previously assigned onto the existing session "to avoid issues",
      // which meant the anonymous pre-login session ID carried straight through
      // to the authenticated session — textbook session fixation. Anyone who
      // learned a visitor's pre-auth session ID held a valid authenticated
      // handle the moment that visitor logged in.
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error('Session regeneration error:', regenErr);
          return res.status(500).json({ error: 'Session error' });
        }

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
          res.json({
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            email: user.email
          });
        });
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * The assistant.
   *
   * `userId` came from the request body, on an endpoint that took no
   * authentication. The consent gate inside generateResponse() trusts that id —
   * it looks up whether *that patient* agreed to have their messages sent to
   * OpenAI — so anyone on the internet could pass the id of a patient who had
   * consented and get the external model, billed to this platform. Worse, the
   * transfer is then recorded against that patient in `audit_events`, so the
   * POPIA record of who sent what abroad would name someone who did not send it.
   * A consent check keyed on an attacker-supplied identifier is not a consent
   * check.
   *
   * The id now comes from the session and nothing else. Anonymous callers are no
   * longer refused outright — the local fallback needs no consent and sends
   * nothing abroad, so the assistant still answers general questions on the
   * public pages — but only a signed-in patient who has agreed can reach OpenAI,
   * and only ever as themselves.
   *
   * Rate limited alongside the other chat routes: this is an unauthenticated
   * path to a metered third-party API, which is the shape of an expensive
   * afternoon.
   */
  app.post("/api/chatbot/chat", async (req: AuthenticatedRequest, res) => {
    try {
      const { messages, message } = req.body ?? {};

      // Handle both message formats
      let chatMessages: any[] = [];
      if (messages && Array.isArray(messages)) {
        chatMessages = messages;
      } else if (message) {
        chatMessages = [{ role: 'user', content: message }];
      } else {
        return res.status(400).json({ error: "Message or messages array is required" });
      }

      // Bounded before it reaches a paid API. An unbounded array from an
      // unauthenticated caller is billed per token.
      if (chatMessages.length > 40) {
        return res.status(400).json({ error: 'Too many messages in one request' });
      }
      if (chatMessages.some((entry) => typeof entry?.content !== 'string' || entry.content.length > 4000)) {
        return res.status(400).json({ error: 'Each message must be text under 4000 characters' });
      }

      // From the session, never from the body.
      const sessionUserId = (req.session as any)?.user?.id;
      const sessionRole = (req.session as any)?.user?.role;

      const chatbotResponse = await medicalChatbotService.generateResponse(
        chatMessages,
        sessionUserId,
        sessionRole
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

  // What the assistant sends abroad, and to whom. Public: someone deciding
  // whether to consent has to be able to read this first.
  app.get("/api/chatbot/disclosure", (_req, res) => {
    res.json({
      version: DISCLOSURE_VERSION,
      recipient: 'OpenAI',
      recipientCountry: 'United States',
      crossBorderTransfer: true,
      disclosure: DISCLOSURE_TEXT,
      revocable: true,
      note:
        'Consent is checked on every message, so withdrawing it stops the ' +
        'transfer immediately.',
    });
  });

  app.get("/api/chatbot/consent", requireAuth, async (req: AuthenticatedRequest, res) => {
    const patientId = (req.session as any)?.user?.id;
    res.json({
      scope: 'external_ai_assistant',
      version: DISCLOSURE_VERSION,
      granted: await hasExternalAiConsent(patientId),
    });
  });

  app.post("/api/chatbot/consent", requireAuth, async (req: AuthenticatedRequest, res) => {
    const patientId = (req.session as any)?.user?.id;
    const { granted } = req.body ?? {};
    if (typeof granted !== 'boolean') {
      return res.status(400).json({ error: 'granted must be a boolean' });
    }
    await recordExternalAiConsent(patientId, granted);
    res.json({ scope: 'external_ai_assistant', version: DISCLOSURE_VERSION, granted });
  });

  // Chatbot symptom analysis.
  //
  // Symptoms are health information and this forwards them to a processor in
  // the United States. It was previously unauthenticated with no consent check,
  // so anyone could push health data across the border through it. Now requires
  // both.
  app.post("/api/chatbot/analyze", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { symptoms, age, gender } = req.body || {};
      if (!symptoms || typeof symptoms !== 'string') {
        return res.status(400).json({ error: 'symptoms is required' });
      }

      const patientId = (req.session as any)?.user?.id;
      if (!(await hasExternalAiConsent(patientId))) {
        return res.status(403).json({
          error: 'Consent required',
          scope: 'external_ai_assistant',
          message:
            'This feature sends what you type to OpenAI in the United States. ' +
            'Read the disclosure and agree before using it.',
          disclosureEndpoint: '/api/chatbot/disclosure',
        });
      }

      const result = await medicalChatbotService.analyzeHealthConcern(
        symptoms, age, gender, patientId
      );
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

      // Public registration always creates a patient.
      //
      // `role` was previously taken from the request body and passed to
      // createUser unchanged, so a single unauthenticated POST with
      // {"role":"admin"} produced a working admin account — and every
      // requireAdmin / requireMedicalAccess check in this file trusts
      // session.user.role, so that one request granted the whole patient
      // database. Clinical credentials are stripped for the same reason: a
      // self-registered account must not be able to assert a specialization or
      // a licence number. Staff accounts are created through
      // POST /api/admin/staff and /api/admin/doctors, which are behind
      // requireAuth + requireAdmin.
      const { role: _ignoredRole, specialization: _spec, licenseNumber: _lic, ...safeFields } = result.data;
      const userData = {
        ...safeFields,
        role: 'patient' as const,
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
      if (!req.session?.userId && !req.session?.user) {
        // A 401 here is normal: the browser probes this on every page load to
        // decide whether to show the public page or the dashboard.
        //
        // This response used to carry a debug block containing req.sessionID and
        // the raw Cookie header, ungated by environment. The session cookie is
        // set httpOnly precisely so that page JavaScript cannot read it —
        // returning it in a JSON body handed it straight back, defeating that
        // protection for any XSS or any browser extension able to read fetch
        // responses. It also echoed every other cookie the browser sent.
        return res.status(401).json({ error: "Not authenticated" });
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

  // Reading the glossary is public; writing to it is not. Unauthenticated, this
  // let anyone insert arbitrary text into reference material that clinicians
  // read alongside results.
  app.post("/api/medical-terms", requireAuth, requireMedicalAccess, async (req, res) => {
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
  app.get("/api/scans", auditLog('READ_SCANS'), requireAuth, async (req: AuthenticatedRequest, res) => {
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
      
      // One indexed lookup by primary key. This used to load every scan in
      // the database and run .find() over the array to reach one row.
      const existingScan = await storage.getScanById(id);
      
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

  app.delete("/api/scans/:id", auditLog('DELETE_SCAN'), requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid scan ID" });
      }
      
      // One indexed lookup by primary key. This used to load every scan in
      // the database and run .find() over the array to reach one row.
      const scan = await storage.getScanById(id);
      
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
      // Counted in the database. This handler used to load every user row and
      // every scan row into memory on each poll of the admin dashboard.
      const [scanStats, totalUsers, criticalAlerts, dbProbe] = await Promise.all([
        storage.getScanStats(),
        storage.countAllUsers(),
        storage.countCriticalScans(),
        probeDatabase(),
      ]);

      res.json({
        totalUsers,
        activeScans: scanStats.processing,
        dailyScans: scanStats.today,
        criticalAlerts,

        // `systemUptime: 99.8` and `databaseHealth: 98` were literals. They were
        // rendered as "99.8% / Last 30 days" and "98% / Optimal performance",
        // which is a monitoring claim this process cannot make: it knows how long
        // *it* has been running and nothing about the previous thirty days.
        //
        // Availability over a window is what an external uptime monitor is for.
        // What is reported instead is what is actually knowable here.
        systemUptime: null,
        uptimeSec: Math.round(process.uptime()),
        databaseHealth: null,
        database: dbProbe,

        // Mean self-reported confidence. Named so it cannot be read as accuracy;
        // accuracy needs adjudicated outcomes, which nothing here records.
        aiAccuracy: scanStats.averageConfidencePct,

        // `securityStatus` is gone from this response. It was
        // `dbProbe.reachable ? 'secure' : 'degraded'` — a database ping
        // reported under a name that claims far more than it checked, and the
        // admin dashboard rendered it as "Secure / All security protocols
        // active". Reachability is already reported by `database` and
        // `databaseLatencyMs` above, under their own names.
      });
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ error: "Failed to fetch admin statistics" });
    }
  });

  // New endpoint to create doctor or radiologist
  app.post("/api/admin/doctors", auditLog('CREATE_MEDICAL_STAFF'), requireAuth, requireAdmin, sensitiveOperationLimit, validateInput, async (req, res) => {
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
      // GROUP BY in the database, plus a live count from the session table.
      const [roleCounts, signedIn] = await Promise.all([
        storage.getUserRoleCounts(),
        storage.countSignedInUsers(),
      ]);

      const countFor = (role: string) =>
        roleCounts.find((row) => row.role === role)?.count ?? 0;

      res.json({
        totalUsers: roleCounts.reduce((sum, row) => sum + row.count, 0),
        admins: countFor('admin'),
        radiologists: countFor('radiologist'),
        doctors: countFor('doctor'),
        patients: countFor('patient'),

        // Users holding an unexpired session, counted. This was
        // `Math.floor(totalUsers * 0.3)`: a fixed 30% of the account table,
        // reported as "active users" whether anyone was signed in or not.
        activeUsers: signedIn,
        newUsersToday: roleCounts.reduce((sum, row) => sum + row.newToday, 0),

        // `loginRate: 85` and `avgSessionTime: 24` were literals under a comment
        // saying real metrics were to be integrated later. Neither is derivable
        // from anything this system records: successful logins are not written to
        // the audit trail, and the session table stores a cookie lifetime rather
        // than time spent. Null rather than a plausible-looking number.
        loginRate: null,
        avgSessionTime: null,
        instrumented: false,
      });
    } catch (error) {
      console.error("Error fetching user metrics:", error);
      res.status(500).json({ error: "Failed to fetch user metrics" });
    }
  });

  app.get("/api/admin/scans/metrics", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Aggregated in the database. This handler used to pull every scan row
      // into memory and count them with .filter().length, on an endpoint the
      // admin dashboard polls.
      const stats = await storage.getScanStats();

      res.json({
        totalScans: stats.total,
        pendingScans: stats.processing,
        completedToday: stats.completedToday,
        cancerDetections: stats.cancerDetections,
        // Was the constant 2.4, while processing_time_ms sat recorded on every
        // row. Null when nothing has been measured yet, rather than a number.
        averageProcessingTimeMs: stats.averageProcessingTimeMs,
        aiConfidenceAverage: stats.averageConfidencePct,
      });
    } catch (error) {
      console.error("Error fetching scan metrics:", error);
      res.status(500).json({ error: "Failed to fetch scan metrics" });
    }
  });

  // New endpoint for scan type distribution
  /**
   * Real time series for the admin charts.
   *
   * The two charts on that dashboard used to be generated in the browser from a
   * single number: the scan trend subtracted a fixed step per day from today's
   * count, and the user-growth bars multiplied the current user total by seven
   * hardcoded ratios. Both drew a confident upward curve on any dataset,
   * including an empty one.
   */
  app.get("/api/admin/trends", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [scansPerDay, usersByMonth] = await Promise.all([
        storage.getScansPerDay(14),
        storage.getCumulativeUsersByMonth(7),
      ]);
      res.json({ scansPerDay, usersByMonth });
    } catch (error) {
      console.error("Error fetching admin trends:", error);
      res.status(500).json({ error: "Failed to fetch trends" });
    }
  });

  app.get("/api/admin/scans/type-distribution", requireAuth, requireAdmin, async (req, res) => {
    try {
      // GROUP BY in the database rather than a full table read plus a manual
      // tally.
      const stats = await storage.getScanStats();

      res.json(
        stats.byType.map(({ scanType, count }) => ({
          type: scanType || 'Unknown',
          count,
          percentage: stats.total > 0 ? (count / stats.total) * 100 : 0,
        }))
      );
    } catch (error) {
      console.error("Error fetching scan type distribution:", error);
      res.status(500).json({ error: "Failed to fetch scan type distribution" });
    }
  });

  app.get("/api/admin/activities/recent", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Ten newest, ordered and limited by the database. This read every scan
      // row on each poll of the admin dashboard and then took the last ten.
      const recentScans = await storage.listScansWithPatient({ limit: 10 });
      const recentActivities = recentScans.map(scan => ({
        // Was "Medical scan completed" for every row regardless of state, so a
        // scan still being processed was announced as completed.
        message: `${scan.scanType ?? 'Medical'} scan ${scan.status === 'completed' ? 'completed' : 'received'}`,
        // ISO, not toLocaleTimeString() on the server. The old value was
        // formatted in the server process's timezone and locale and sent as an
        // opaque string, so every viewer saw the server's clock rather than
        // their own, and a scan from last week read as a time today.
        timestamp: scan.createdAt,
        type: 'scan'
      }));

      res.json(recentActivities);
    } catch (error) {
      console.error("Error fetching recent activities:", error);
      res.status(500).json({ error: "Failed to fetch recent activities" });
    }
  });

  /**
   * The notification centre.
   *
   * These four routes were never registered, which left the whole notification
   * surface non-functional: `notifications` is a real table, storage has
   * getNotifications / countUnreadNotifications / markNotificationRead /
   * markAllNotificationsRead, the routes that matter already write rows to it
   * (a confirmed outcome, a scan sent for review), and notification-center.tsx
   * polls /api/notifications every thirty seconds — which answered 404, threw,
   * and rendered an empty bell.
   *
   * The consequence is worth stating plainly: a patient whose result had been
   * confirmed by a clinician had a row written announcing it, and no way to see
   * that row. Off-platform delivery is best-effort and email is unconfigured in
   * most deployments, so the in-app centre is the only channel that always
   * exists — and it was not connected.
   *
   * Every route below is scoped to the session's own user. Notifications name
   * clinical events, so reading someone else's is reading their record.
   */
  app.get("/api/notifications", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const recipientId = req.session!.user!.id;
      const limit = Math.min(
        Math.max(1, Number.parseInt(req.query.limit as string, 10) || 50),
        200
      );

      const rows = await storage.getNotifications(recipientId, limit);

      // Filtered here rather than in the query because the client asks for one
      // of three fixed views and the page is already bounded above.
      const unreadOnly = req.query.unread === 'true';
      const filtered = unreadOnly ? rows.filter((n) => !n.readAt) : rows;

      res.json(
        filtered.map((notification) => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.body,
          link: notification.link,
          read: Boolean(notification.readAt),
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        }))
      );
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      res.json({ unread: await storage.countUnreadNotifications(req.session!.user!.id) });
    } catch (error) {
      console.error("Error counting notifications:", error);
      res.status(500).json({ error: "Failed to count notifications" });
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid notification id' });
      }

      // The recipient id is part of the UPDATE's WHERE clause, not a check
      // performed before it, so one user cannot mark another user's notification
      // read by guessing a small integer.
      //
      // Idempotent on purpose. storage.markNotificationRead also requires
      // read_at IS NULL, so it returns false both for "no such notification" and
      // for "already read" — indistinguishable from here. Answering 404 would
      // therefore fail an ordinary double-click, and distinguishing them would
      // confirm which notification ids exist to anyone enumerating. Marking a
      // thing read that is already read is not an error.
      await storage.markNotificationRead(id, req.session!.user!.id);
      res.json({ id, read: true });
    } catch (error) {
      console.error("Error marking notification read:", error);
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  });

  app.delete("/api/notifications/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid notification id' });
      }

      // 404 on a miss is safe here, unlike on the mark-read route: a delete that
      // matched nothing is genuinely indistinguishable from a delete of
      // someone else's row, so the response is the same either way.
      const removed = await storage.deleteNotification(id, req.session!.user!.id);
      if (!removed) return res.status(404).json({ error: 'Notification not found' });

      res.json({ id, deleted: true });
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ error: "Failed to delete notification" });
    }
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const marked = await storage.markAllNotificationsRead(req.session!.user!.id);
      res.json({ marked });
    } catch (error) {
      console.error("Error marking notifications read:", error);
      res.status(500).json({ error: "Failed to mark notifications read" });
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
      // Counted in the database. This read every scan in the system on each
      // dashboard poll and ran four .filter() passes plus a .reduce() over the
      // copy in memory.
      const workload = await storage.getRadiologistWorkload();

      res.json({
        pendingReviews: workload.pendingReviews,
        completedToday: workload.completedToday,
        totalScansReviewed: workload.totalScansReviewed,
        criticalCases: workload.criticalCases,

        // Deliberately NOT called `aiAccuracy`. This is the mean of the model's
        // self-reported confidence, which says how sure it was, not how often it
        // was right; a model can be confidently wrong. Null when no scan has
        // recorded a confidence, so the tile can show a dash rather than 0%.
        meanAiConfidencePct: workload.meanAiConfidencePct,

        // Measured from reviewed_at, as a median, with the number of reviews it
        // was computed from. The field it replaces was `avgReviewTime: 3.2` — a
        // literal, unchanged since it was typed.
        medianReviewHours: workload.medianReviewHours,
        reviewsMeasured: workload.reviewsMeasured,

        /**
         * There is deliberately no accuracy figure in this response.
         *
         * `accuracyRate: 96` used to be returned here and the dashboard rendered
         * it four times, including as a progress bar filled to 96 and the
         * caption "96% accuracy". Nothing measured it. Accuracy is a comparison
         * between what the model predicted and what the case turned out to be,
         * so it cannot be computed from the scans table alone — it needs the
         * confirmed outcomes in `scan_outcomes`. /api/models/performance answers
         * it properly, with a denominator and a confidence interval, and says so
         * when the sample is too small to be worth quoting.
         */
        accuracy: {
          available: false,
          reason: 'Accuracy requires confirmed outcomes, not scan counts.',
          endpoint: '/api/models/performance',
        },
      });
    } catch (error) {
      console.error("Error fetching radiologist stats:", error);
      res.status(500).json({ error: "Failed to fetch radiologist statistics" });
    }
  });

  app.get("/api/radiologist/pending-reviews", auditLog('READ_PENDING_REVIEWS'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      /**
       * Everything waiting on a radiologist.
       *
       * This collected two sets: rows whose status was 'pending_manual_review',
       * and rows whose result was still the literal string 'Processing'. It
       * never asked for status = 'pending' -- which is the status of a scan the
       * analysis pipeline has finished with, because handleScanAnalysis writes a
       * result and a risk level and leaves status at the schema default.
       *
       * That is the normal end state of every successful scan. So the review
       * queue could see scans no model could run on, and scans still mid-flight,
       * and could not see a single one of the analysed scans that are the actual
       * work: a lung scan reading "Lung Cancer detected - high risk" sat in the
       * database while the radiologist's queue showed "Pending Reviews (0)".
       *
       * Meanwhile getRadiologistWorkload() counts status <> 'completed' for the
       * stat card above the queue, so the same page reported 2 pending and then
       * listed none of them.
       *
       * Asking for the complement of 'completed' fixes both halves at once: the
       * list is now defined by the same predicate as the counter, so they cannot
       * disagree, and a status added later joins the queue instead of vanishing
       * from it.
       */
      const pendingScans = await storage.listScansWithPatient({
        statusNot: 'completed',
        limit: 200,
        order: 'oldest',
      });

      const reviews = pendingScans.map(scan => {
        const patient = scan.patientName ? { fullName: scan.patientName } : null;
        const awaitingManualReview = scan.status === 'pending_manual_review';
        return {
          id: scan.id,
          patientName: patient ? patient.fullName : `Patient ${scan.patientId}`,
          scanType: scan.scanType,
          /**
           * Triage priority, derived from the recorded clinical risk.
           *
           * This read the `priority` column, which defaults to 'medium' and
           * which nothing in the codebase ever writes. So every row in the
           * queue carried a MEDIUM badge, the "All priorities" filter had
           * nothing to separate, and "Sort: Priority" was a no-op ordering a
           * list by a constant -- including for a scan whose risk_level was
           * 'high'. A radiologist reading this queue top-down had no signal
           * telling them which patient to open first.
           *
           * risk_level is what the analysis actually wrote. The same mapping is
           * used by /api/doctor/reports, so the two portals rank a given scan
           * the same way.
           */
          priority: (() => {
            const risk = (scan.riskLevel ?? '').toLowerCase();
            if (risk === 'critical') return 'urgent';
            if (risk === 'high') return 'high';
            if (risk === 'medium') return 'medium';
            if (risk === 'low') return 'low';
            return scan.priority || 'medium';
          })(),
          // Whether GET /api/scans/:id/image has anything to serve. The review
          // dialog is opened by a button labelled "Open Viewer" and needs to
          // know whether there is an image before offering one.
          hasImage: Boolean(scan.imagePath),
          awaitingManualReview,
          submittedAt: scan.createdAt,
          riskLevel: scan.riskLevel ?? null,
          /**
           * What the model actually said.
           *
           * Every row that was not awaiting manual review reported "Analysis in
           * progress", because the only rows that reached this list were ones
           * still processing. Now that analysed scans appear, the stored result
           * is the honest answer -- and a radiologist triaging a queue needs to
           * see which rows are flagged before opening them.
           */
          aiPrediction: awaitingManualReview
            ? 'No AI result - automated analysis unavailable'
            : (scan.result && scan.result !== 'Processing'
                ? scan.result
                : 'Analysis in progress'),
          // Null, not 0. A scan no model has scored has no confidence; drawing
          // that as "0%" states the model was certain the finding was absent.
          aiConfidence: (typeof scan.aiConfidence === 'string' && scan.aiConfidence.trim() !== '')
            ? (Number.parseFloat(scan.aiConfidence.replace('%', '')) || null)
            : (typeof scan.aiConfidence === 'number' ? scan.aiConfidence : null),
          // `bodyPart` is gone. It was scanType.split(' ')[0] -- and the only
          // scan types this platform has are single words ('lung', 'skin'), so
          // it was always exactly equal to scanType. The queue rendered the two
          // side by side and every row read "lung - lung"; the review dialog
          // listed "Scan Type: lung" above "Body Part: lung". A derived field
          // that can never differ from its source is not a second fact.
          //
          // A real anatomical site would need a column and something writing to
          // it. There is neither.
          // Was the literal 'Johnson' on every row. There is no referring-doctor
          // field on a scan, so the honest answer is that it is not recorded.
          referringDoctor: null,
          notes: scan.notes
        };
      });

      res.json(reviews);
    } catch (error) {
      console.error("Error fetching pending reviews:", error);
      res.status(500).json({ error: "Failed to fetch pending reviews" });
    }
  });

  app.get("/api/radiologist/completed-today", auditLog('READ_COMPLETED_SCANS'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      // Today's rows, filtered by the database on an indexed column, with the
      // patient joined on. This read every scan and every user, then compared
      // date strings in JavaScript to find the ones from today.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      /**
       * Signed off today -- the same predicate the "Completed Today" counter uses.
       *
       * Two things were wrong. It filtered on `since`, which is created_at, so
       * it asked "which scans were uploaded today"; and it kept every row whose
       * result was not the literal 'Processing', which is true of any analysed
       * scan whether or not a radiologist has looked at it. A skin scan uploaded
       * this morning and still sitting unreviewed in the queue was therefore
       * listed under Completed, with its AI result presented as the findings.
       *
       * A scan is completed when a radiologist completed it: status 'completed',
       * reviewed_at today. getRadiologistWorkload() already counts exactly that.
       */
      const scans = await storage.listScansWithPatient({
        status: 'completed',
        reviewedSince: startOfToday,
        limit: 200,
      });

      const completed = scans
        .map(scan => ({
          id: scan.id,
          patientName: scan.patientName,
          scanType: scan.scanType,
          // When it was signed off, not when it was uploaded.
          completedAt: scan.reviewedAt ?? scan.createdAt,
          // The radiologist's findings if they wrote any, falling back to the
          // result line. This read scan.result unconditionally, so a report that
          // had been written out in full was displayed as the one-line AI
          // verdict it was meant to supersede.
          findings: scan.findings || scan.result,
          // Was `|| 'Follow-up as needed'`, which put a clinical instruction on
          // every scan whose notes happened to be empty.
          recommendation: scan.recommendations ?? scan.notes ?? null,
          // Named for what it is. This was called aiAccuracy while holding the
          // model's self-reported confidence, and fell back to 0 — which reads
          // as "0% accurate" rather than "not recorded".
          aiConfidencePct: (typeof scan.aiConfidence === 'string' && scan.aiConfidence.trim() !== '')
            ? (Number.parseFloat(scan.aiConfidence.replace('%', '')) || null)
            : null
        }));

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
  /**
   * This clinician's own counters.
   *
   * Three of the nine fields this returned were not measurements.
   * `appointmentsCompleted` was `Math.floor(Math.random() * 5) + 3`, so the tile
   * showed a different number on every fifteen-second poll. `avgConsultationTime`
   * was the string '18m' and `patientSatisfaction` was the number 94, both
   * rendered as large figures on the dashboard. This platform has no
   * consultation timer and no satisfaction survey, so there is nothing behind
   * either, and they are removed rather than given a plausible-looking formula.
   *
   * The remaining counters were real arithmetic over the wrong set: they loaded
   * every user and every scan in the database and counted all of them, so a
   * doctor with four patients saw the whole register under "Active Patients" and
   * every flagged scan on the platform under "Critical Cases". They are now
   * counted in the database and scoped to the clinician asking.
   */
  app.get("/api/doctor/stats", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const doctorId = (req.session as any).user.id;
      res.json(await storage.getClinicianWorkload(doctorId));
    } catch (error) {
      console.error("Error fetching doctor stats:", error);
      res.status(500).json({ error: "Failed to fetch doctor stats" });
    }
  });

  /**
   * The clinician's own patient panel.
   *
   * This was the most misleading response in the application, on the screen
   * where being misled matters most. Six of its eleven fields were string
   * literals written identically for every patient:
   *
   *   status: 'stable'          → rendered as a green STABLE badge
   *   riskLevel: 'low'          → rendered as a LOW RISK badge, and counted into
   *                               the "high / medium / low risk" summary tiles
   *   condition: 'Regular checkup'
   *   lastVisit: new Date()     → every patient appeared to have been seen today
   *   recentScans: 0
   *   age: patient.age || 30    → an unrecorded age became 30
   *
   * A doctor loading this page was told that every patient was stable and low
   * risk — including one whose most recent scan had just been flagged for
   * malignancy — and the risk tiles at the bottom read "0 high risk"
   * unconditionally. That is a clinical screen asserting a reassuring fact about
   * a patient that nothing checked.
   *
   * `status` and `condition` are gone entirely: this platform records neither,
   * and there is no honest value to put there. What it does record is returned —
   * appointment history with this clinician, scan counts, and the highest risk
   * band any of the patient's scans carries, which the UI labels as a scan
   * finding rather than as a description of the patient.
   *
   * It also returned every patient in the database to any doctor or radiologist,
   * which is a bulk disclosure of the patient register rather than a care
   * relationship. It is now scoped to patients this clinician has an appointment
   * or a scan with.
   */
  app.get("/api/doctor/patients", auditLog('READ_PATIENT_LIST'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const doctorId = (req.session as any).user.id;
      const patients = await storage.listDoctorPatients(doctorId);
      res.json(patients);
    } catch (error) {
      console.error("Error in patients endpoint:", error);
      res.status(500).json({ error: "Failed to fetch patients" });
    }
  });

  app.get("/api/doctor/appointments/today", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      // requireAuth guarantees the session. The fallback that stood here — a
      // literal 15, commented "Default to Dr. Kenosi for testing" — would have
      // attributed another clinician's schedule to a named real doctor.
      const doctorId = (req.session as any).user.id;
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
  app.get("/api/doctor/appointments/upcoming", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const doctorId = (req.session as any).user.id;

      // The patient's name comes from an indexed join, not from reading every
      // user in the database and running .find() once per appointment.
      const appointments = await storage.listDoctorAppointmentsWithPatient(doctorId);

      /**
       * Actually upcoming.
       *
       * This route is named `/upcoming` and the panel that consumes it is headed
       * "Upcoming Appointments (n)", but it returned every appointment the
       * clinician had ever had — so a visit completed nine days ago sat in the
       * upcoming list with a "completed" badge, and the count above it was the
       * lifetime total rather than what is still to come.
       *
       * Cancelled ones are dropped for the same reason: an appointment that is
       * not going to happen is not upcoming.
       *
       * Today counts as upcoming — a 2pm slot is still ahead of a clinician
       * reading this at 9am — so the comparison is against the start of today,
       * not against now.
       */
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const upcoming = appointments.filter((appointment) => {
        if (!appointment.appointmentDate) return false;
        if (appointment.status === 'cancelled' || appointment.status === 'completed') return false;
        return new Date(appointment.appointmentDate) >= startOfToday;
      });

      const formattedAppointments = upcoming.map(appointment => ({
        id: appointment.id,
        patientName: appointment.patientName,
        patientEmail: appointment.patientEmail,
        // Null rather than today's date and '09:00 AM'. Both columns are NOT
        // NULL in the schema, so a missing value means the row is malformed, and
        // substituting a plausible time for a malformed appointment puts a slot
        // on a clinician's calendar that nobody booked.
        date: appointment.appointmentDate
          ? new Date(appointment.appointmentDate).toISOString().split('T')[0]
          : null,
        time: appointment.appointmentTime ?? null,
        reason: appointment.reason || appointment.type || null,
        status: appointment.status || 'pending',
        notes: appointment.notes || '',
        priority: appointment.priority || 'medium'
      }));

      res.json(formattedAppointments);
    } catch (error) {
      console.error("Error fetching upcoming appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  /**
   * Scans waiting on a report.
   *
   * Two fields here were invented. `radiologist: 'Dr. Smith'` named a person who
   * does not work here on every row — the scan's actual radiologist_id was
   * available and unused — and `aiConfidence: scan.aiConfidence || '85%'`
   * supplied a confidence figure for scans that had never recorded one, which is
   * the same defect that was removed from the radiologist queue and missed here.
   *
   * `priority` also came from string-matching the prose in `result` for "urgent"
   * and "abnormal", which makes queue ordering depend on how a finding happened
   * to be worded. It now reads risk_level and priority, which are columns.
   */
  app.get("/api/doctor/reports/pending", auditLog('READ_PENDING_REPORTS'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      // One indexed query with the patient joined on, bounded, instead of every
      // scan and every user read into the process on each eight-second poll.
      const scans = await storage.listScansWithPatient({ limit: 200 });
      const pending = scans.filter(
        scan => scan.result && scan.result !== 'Processing' && scan.status !== 'completed'
      );

      const radiologistIds = Array.from(
        new Set(pending.map(scan => scan.radiologistId).filter((id): id is number => !!id))
      );
      const radiologists = new Map<number, string>();
      for (const id of radiologistIds) {
        const clinician = await storage.getUser(id);
        if (clinician) radiologists.set(id, clinician.fullName || clinician.username);
      }

      const reports = pending.map(scan => {
        const risk = (scan.riskLevel ?? '').toLowerCase();
        return {
          id: scan.id,
          patientName: scan.patientName,
          scanType: scan.scanType || null,
          submittedAt: scan.createdAt,
          priority:
            risk === 'critical' ? 'urgent' : risk === 'high' ? 'high' : scan.priority ?? 'medium',
          // The clinician who actually holds this scan, or null. Never a name.
          radiologist: scan.radiologistId ? radiologists.get(scan.radiologistId) ?? null : null,
          findings: scan.result,
          riskLevel: scan.riskLevel ?? null,
          status: scan.status || 'pending',
          // Null when the scan recorded no confidence, so the UI can say so.
          aiConfidence: scan.aiConfidence || null,
          modelVersion: scan.modelVersion ?? null,
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
  app.get("/api/doctor/notifications", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      // Five newest scans, ordered and limited by the database. This read every
      // scan and every user in the system and then took the last five of them.
      const recentScans = await storage.listScansWithPatient({ limit: 5 });

      const notifications = recentScans.map(scan => ({
        id: scan.id,
        message: `New scan result available for ${scan.patientName ?? 'a patient'}`,
        timestamp: scan.createdAt,
        type: 'scan_result',
        // Read from the risk_level column rather than by searching the prose in
        // `result` for the word "abnormal" — a finding worded "malignancy
        // detected" does not contain it and was being marked normal.
        priority: ['high', 'critical'].includes((scan.riskLevel ?? '').toLowerCase())
          ? 'high'
          : 'normal'
      }));

      res.json(notifications);
    } catch (error) {
      console.error("Error fetching doctor notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Approve report endpoint
  app.post("/api/doctor/reports/:id/approve", requireAuth, requireMedicalAccess, async (req, res) => {
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
  app.get("/api/doctor/reports/:id", auditLog('READ_REPORT'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const reportId = parseInt(req.params.id);
      
      if (isNaN(reportId)) {
        return res.status(400).json({ error: "Invalid report ID" });
      }
      
      // A primary-key lookup with the patient joined on. This read every scan
      // and every user in order to find one row.
      const scan = await storage.getScanWithPatient(reportId);

      if (!scan) {
        return res.status(404).json({ error: "Report not found" });
      }
      
      const reportDetails = {
        id: scan.id,
        // Joined on by the query. The fallback that stood here rendered
        // "Patient 47" as if it were a name.
        patientName: scan.patientName,
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
  app.post("/api/doctor/appointments/:id/accept", requireAuth, requireMedicalAccess, async (req, res) => {
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

  app.post("/api/doctor/appointments/:id/decline", requireAuth, requireMedicalAccess, async (req, res) => {
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

  app.delete("/api/doctor/appointments/:id", requireAuth, requireMedicalAccess, async (req, res) => {
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
  app.get("/api/patient/profile/:id", auditLog('READ_PATIENT_PROFILE'), requireAuth, requirePatientDataAccess, async (req, res) => {
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

  app.get("/api/patient/scans/:id", auditLog('READ_PATIENT_SCANS'), requireAuth, requirePatientAccess, async (req, res) => {
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


  // `:id` here is a *patient* id, not an appointment id, so the caller was able
  // to read any patient's appointment list by changing the number.
  app.get("/api/patient/appointments/:id", auditLog('READ_PATIENT_APPOINTMENTS'), requireAuth, requirePatientDataAccess, async (req, res) => {
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
  app.get("/api/patient/appointments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Was `|| 4` — a hardcoded "default to test patient" fallback that would
      // have served patient 4's appointments to anyone whose session lacked an
      // id. requireAuth makes that unreachable now; the fallback is removed so
      // it cannot become reachable again.
      const patientId = req.session!.user!.id;
      const appointments = await storage.getPatientAppointments(patientId);
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching patient appointments:", error);
      res.status(500).json({ error: "Failed to fetch patient appointments" });
    }
  });

  // Delete patient appointment endpoint
  app.delete("/api/patient/appointments/:id", auditLog('DELETE_APPOINTMENT'), requireAuth, requireAppointmentOwnership, async (req, res) => {
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
  app.post("/api/patient/appointments", auditLog('CREATE_APPOINTMENT'), requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { appointmentDate, appointmentTime, type, doctorName, status, reason } = req.body;

      // `patientId` used to be taken from the body, which let one patient book
      // — and thereby write a record — against another patient's account. A
      // patient may only book for themselves; staff may book on behalf of
      // someone else, which is a normal front-desk action.
      const sessionUserId = req.session!.user!.id;
      const sessionRole = req.session!.user!.role;
      const patientId = ['admin', 'doctor', 'radiologist'].includes(sessionRole)
        ? (req.body.patientId ?? sessionUserId)
        : sessionUserId;

      const requestedDoctorId = parseInt(req.body.doctorId, 10);

      if (!patientId || !appointmentDate || !appointmentTime || !type ||
          (!doctorName && !Number.isInteger(requestedDoctorId))) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Patient ID, date, time, type, and a clinician are required'
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

      // Resolve the clinician by id when the caller supplied one.
      //
      // Matching on fullName alone is ambiguous the moment two clinicians share
      // a name, and it silently books the wrong one. The name is still accepted
      // so older clients keep working, but the id wins.
      let medicalProfessional;
      if (Number.isInteger(requestedDoctorId)) {
        const candidate = await storage.getUser(requestedDoctorId);
        if (candidate && ['doctor', 'radiologist'].includes(candidate.role)) {
          medicalProfessional = candidate;
        }
      } else if (doctorName) {
        // Filtered and projected in the database. This read every user row —
        // password hashes and live reset tokens included — to match one name.
        const directory = await storage.listDirectory(['doctor', 'radiologist']);
        const match = directory.find(user => user.fullName === doctorName);
        if (match) medicalProfessional = await storage.getUser(match.id);
      }

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

      // Tell the clinician, now.
      //
      // Nothing was pushed anywhere when an appointment was created: the doctor
      // portal found out on its next poll, and the notification bell never
      // mentioned it at all.
      const patient = await storage.getUser(Number(patientId));
      const patientName = patient?.fullName || patient?.username || 'A patient';

      await storage
        .createNotification({
          recipientId: medicalProfessional.id,
          actorId: Number(patientId),
          type: 'appointment',
          title: `New appointment with ${patientName}`,
          body: `${type} on ${appointmentDate} at ${appointmentTime}`,
          link: '/',
        })
        .catch((error) => console.error('Failed to record appointment notification:', error));

      enhancedWsManager?.sendToUser(medicalProfessional.id, {
        type: 'appointment_update',
        data: {
          appointmentId: newAppointment.id,
          action: 'created',
          patientId: Number(patientId),
          appointmentDate,
          appointmentTime,
        },
      });

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
  // PATCH /api/appointments/:appointmentId/reschedule was removed.
  //
  // It took no authentication, wrote nothing, and replied "Appointment
  // rescheduled successfully" to anyone who called it — the comment in its body
  // read "In a real implementation, you would update the appointment in
  // database". Nothing referenced it: the calendar UI calls
  // PATCH /api/patient/appointments/:appointmentId/reschedule, which does
  // persist and is now behind requireAppointmentOwnership. An endpoint that
  // confirms a clinical action it did not perform is deleted rather than left
  // reachable.

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
  app.patch("/api/patient/appointments/:appointmentId/reschedule", auditLog('RESCHEDULE_APPOINTMENT'), requireAuth, requireAppointmentOwnership, async (req, res) => {
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
  /**
   * The clinician picker for the booking form.
   *
   * Public because a visitor has to choose someone before they can register, but
   * it returns only what a picker needs. It used to include every clinician's
   * email address, which made an unauthenticated GET a staff mailing list.
   *
   * `available` is gone rather than hardcoded to true: it claimed to describe
   * availability and described nothing. Whether a given clinician has a free slot
   * is answered by /api/appointments/available-slots, which actually looks.
   */
  app.get("/api/doctors/available", async (_req, res) => {
    try {
      // Filtered and projected in the database. This read every user row —
      // password hashes included — and filtered in JavaScript, on a public
      // endpoint the booking form calls on every render.
      const medicalStaff = await storage.listDirectory(['doctor', 'radiologist']);
      const availableProfessionals = medicalStaff.map(professional => ({
        id: professional.id,
        name: professional.fullName,
        role: professional.role,
        specialty: professional.specialization || (professional.role === 'radiologist' ? 'Medical Imaging' : 'General Practice')
      }));

      res.json(availableProfessionals);
    } catch (error) {
      console.error("Error fetching available medical professionals:", error);
      res.status(500).json({ error: "Failed to fetch available medical professionals" });
    }
  });

  // Get available radiologists for specialized imaging appointments
  // Same shape and the same reasoning as /api/doctors/available: no email
  // address, and no hardcoded `available: true`.
  app.get("/api/radiologists/available", async (_req, res) => {
    try {
      const availableRadiologists = (await storage.listDirectory(['radiologist'])).map(radiologist => ({
        id: radiologist.id,
        name: radiologist.fullName,
        role: 'radiologist',
        specialty: radiologist.specialization || 'Medical Imaging'
      }));

      res.json(availableRadiologists);
    } catch (error) {
      console.error("Error fetching available radiologists:", error);
      res.status(500).json({ error: "Failed to fetch available radiologists" });
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

      // Reject absurd ranges before doing any work: year and month come straight
      // from the query string.
      if (year < 2000 || year > 2100 || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid year or month' });
      }

      const slots = await getAvailableAppointmentSlots(year, month);

      // One calendar round trip for the whole month.
      //
      // This used to call checkTimeSlotAvailability once per slot, inside a
      // nested loop over days and clinicians, and await each one. A month with a
      // handful of clinicians is several hundred sequential Google API calls per
      // request, on an endpoint that needs no authentication.
      const { googleCalendarService } = await import('./google-calendar-service');

      const flattened = Object.entries(slots).flatMap(([dateStr, timeSlots]) =>
        (timeSlots as any[]).map((timeSlot) => ({ dateStr, timeSlot }))
      );
      const checks = await googleCalendarService.checkMultipleTimeSlots(
        flattened.map(({ dateStr, timeSlot }) => ({ date: dateStr, time: timeSlot.time }))
      );

      const enhancedSlots: Record<string, any[]> = {};
      for (const dateStr of Object.keys(slots)) enhancedSlots[dateStr] = [];

      flattened.forEach(({ dateStr, timeSlot }, index) => {
        if (checks[index]?.isAvailable) {
          enhancedSlots[dateStr].push({ ...timeSlot, available: true, source: 'system' });
        }
      });

      res.json(enhancedSlots);
    } catch (error) {
      console.error("Error fetching available appointment slots:", error);
      res.status(500).json({ error: "Failed to fetch available appointment slots" });
    }
  });

  // Homepage Statistics API endpoint
  /**
   * Public homepage counters.
   *
   * Every figure is either a row count or comes from MODEL_REGISTRY, whose
   * numbers are the output of scripts/evaluate-model.py on a held-out split.
   *
   * The previous version published four claims the system could not support.
   * "Accuracy Rate" counted scans whose *self-reported confidence* exceeded 90%
   * and called the proportion accuracy — confidence is not correctness, and a
   * model that is confidently wrong scored 100% on it. "Earlier Detection: 30%"
   * and "Workflow Efficiency" were a constant and an arbitrary formula
   * (scans/users*10) with no measurement behind either. All three fell back to
   * hardcoded 97%/30%/60% strings whenever the database threw, so a failed query
   * published marketing numbers instead of an error. The hero section was cleaned
   * up for exactly this reason; this endpoint was missed.
   *
   * Sensitivity is labelled as such and attributed to a modality rather than
   * being averaged into a single headline "accuracy".
   */
  app.get("/api/homepage/statistics", async (_req, res) => {
    try {
      const enabledModels = Object.entries(MODEL_REGISTRY).filter(([, m]) => m.enabled);
      const [scanCount, clinicianCount] = await Promise.all([
        storage.countScans(),
        storage.countUsersByRoles(['doctor', 'radiologist']),
      ]);

      const best = enabledModels
        .map(([scanType, m]) => ({ scanType, sensitivity: m.evaluation?.sensitivity ?? 0 }))
        .sort((a, b) => b.sensitivity - a.sensitivity)[0];

      res.json([
        { value: String(enabledModels.length), label: "Modalities Live" },
        {
          value: best ? `${Math.round(best.sensitivity * 100)}%` : "—",
          label: best ? `${best.scanType} sensitivity` : "Sensitivity",
        },
        { value: scanCount.toLocaleString("en"), label: "Scans Analysed" },
        { value: clinicianCount.toLocaleString("en"), label: "Clinicians On Platform" },
      ]);
    } catch (error) {
      console.error("Error fetching homepage statistics:", error);
      // No fallback figures. An unavailable counter is reported as unavailable;
      // it is not replaced with a number nobody measured.
      res.status(503).json({ error: "Statistics temporarily unavailable" });
    }
  });

  /**
   * Clinicians who can take a dermatology referral.
   *
   * This endpoint was called "nearby" and did not know where anyone was. It took
   * no authentication, and for every real clinician it returned:
   *
   *   rating: 4.5 + Math.random() * 0.5      an invented rating, attached to a
   *                                          named real person
   *   distance: (0.5 + Math.random() * 2)    an invented distance in miles; the
   *                                          submitted coordinates were never used
   *   coordinates: latitude  + jitter        the clinician\'s "position", derived
   *                                          from the patient\'s own location
   *   experience: "5+ years experience"      a literal
   *   location / address / hospitalAffiliation  literals
   *   nextAvailable: "Today 2:30 PM"         a literal; nothing checked a calendar
   *   email, phone                           real staff contact details, on an
   *                                          unauthenticated endpoint
   *
   * When the query matched nobody it invented a clinician outright — id 999,
   * "Dr. Available Dermatologist" — and for urgent cases it returned two
   * fictional hospitals whose phone numbers were +1 (555) 100-2000 and
   * +1 (555) 911-0000. The dialog rendered those under "Emergency Options" with
   * a Call button wired to `tel:`, so a patient who had just been told their
   * scan looked urgent was offered a one-tap call to a number in a range
   * reserved for fiction.
   *
   * What this platform actually knows is which clinicians work here and what
   * their recorded specialisation is. That is what it returns. It holds no
   * clinician addresses, so proximity is reported as unavailable rather than
   * generated, and emergency guidance points to local emergency services without
   * inventing a number to dial.
   *
   * Now authenticated: it receives the patient\'s precise coordinates and returns
   * a staff directory, and neither belongs on an open endpoint.
   */
  app.post("/api/dermatologists/nearby", requireAuth, async (req, res) => {
    try {
      const { urgency = 'routine' } = req.body ?? {};

      const dermatologists = await getAvailableDermatologists(urgency);

      // The next date each clinician actually has a free slot, looked up rather
      // than asserted. Bounded to the next two working weeks so an empty diary
      // does not turn into an unbounded scan.
      const withAvailability = await Promise.all(
        dermatologists.map(async (doctor) => {
          let nextAvailable: { date: string; time: string } | null = null;
          for (let offset = 0; offset < 14 && !nextAvailable; offset++) {
            const day = new Date();
            day.setDate(day.getDate() + offset);
            const dateString = day.toISOString().split('T')[0];
            const slots = await getClinicianSlotsForDate(doctor.id, dateString);
            if (slots.length) nextAvailable = { date: dateString, time: slots[0] };
          }
          return { ...doctor, nextAvailable };
        })
      );

      res.json({
        success: true,
        dermatologists: withAvailability,
        /**
         * Why there are no distances here.
         *
         * Ranking clinicians by proximity needs a recorded practice address for
         * each of them and a geocoder. This platform stores neither, so the
         * honest answer is that it cannot sort by distance — not a plausible
         * number of miles.
         */
        proximity: {
          available: false,
          reason:
            'No practice addresses are recorded for clinicians on this platform, ' +
            'so results cannot be ranked by distance.',
        },
        emergencyGuidance:
          urgency === 'urgent'
            ? {
                message:
                  'If this is a medical emergency, contact your local emergency ' +
                  'services or go to the nearest emergency department now. Do not ' +
                  'wait for an appointment through this platform.',
                // Deliberately no phone number. The correct emergency number
                // depends on the country the patient is in, and this system does
                // not know it. A wrong number here is worse than none.
                note: 'This platform cannot place emergency calls or dispatch care.',
              }
            : null,
        recommendation:
          urgency === 'urgent'
            ? 'A clinician should review this result promptly.'
            : 'Book a consultation for a clinical assessment.',
      });
    } catch (error) {
      console.error("Error listing dermatology clinicians:", error);
      res.status(500).json({ error: "Failed to list dermatology clinicians" });
    }
  });

  // Get available appointment slots for dermatologist
  /**
   * The same question as the query-string form above, addressed by path.
   *
   * It used to answer from a fixed list of sixteen times minus three literals
   * commented "Example booked slots" — so 9:00 AM, 2:00 PM and 3:30 PM were
   * reported as taken for every clinician on every date in the system, and every
   * other slot as free regardless of what was actually booked.
   */
  app.get("/api/appointments/dermatologist-slots/:doctorId/:date", requireAuth, async (req, res) => {
    try {
      const doctorId = Number.parseInt(req.params.doctorId, 10);
      const { date } = req.params;

      if (!Number.isInteger(doctorId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid clinician id or date' });
      }

      const clinician = await storage.getUser(doctorId);
      if (!clinician || !['doctor', 'radiologist'].includes(clinician.role)) {
        return res.status(404).json({ error: 'Unknown clinician' });
      }

      res.json(await getClinicianSlotsForDate(doctorId, date));
    } catch (error) {
      console.error("Error fetching appointment slots:", error);
      res.status(500).json({ error: "Failed to fetch available slots" });
    }
  });

  // Schedule dermatologist appointment
  /**
   * Book a dermatology consultation for the caller.
   *
   * Took no authentication and defaulted the patient to id 4 when there was no
   * session, so an anonymous POST created a real appointment against a real
   * patient's record. It also named the clinician by mapping the id through a
   * hardcoded list — "Dr. Sarah Mitchell", "Dr. Michael Chen", "Dr. Emily
   * Rodriguez" — and put that invented name in the confirmation message, so a
   * patient could be told they had an appointment with someone who does not
   * work here. The name now comes from the doctor's own record.
   */
  app.post("/api/appointments/dermatologist", auditLog('BOOK_DERMATOLOGY_APPOINTMENT'), requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { dermatologistId, date, time, reason, notes, urgency } = req.body;
      const patientId = req.session!.user!.id;

      const dermatologist = await storage.getUser(dermatologistId);
      if (!dermatologist || !['doctor', 'radiologist'].includes(dermatologist.role)) {
        return res.status(400).json({ error: 'Unknown dermatologist' });
      }
      const dermatologistName = dermatologist.fullName || dermatologist.username;

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
  /**
   * Analyses an uploaded scan, stores the image, and records the result.
   *
   * Mounted at two paths because both are in use by different parts of the
   * client. The two used to be separate route registrations with byte-identical
   * hundred-line bodies, so every fix had to be made twice and, in practice,
   * was not.
   *
   * Three defects are fixed here beyond the duplication:
   *
   *  1. `patientId` came from the request body with no check on who was asking.
   *     Any logged-in patient could post `patientId=<someone else>` and write a
   *     scan result — "Lung Cancer detected - high risk" — into another
   *     patient's chart. /api/patient/appointments had the same hole and was
   *     already fixed; this pair was missed. A patient may now only submit scans
   *     for themselves; clinical staff may submit on a patient's behalf.
   *
   *  2. The image was thrown away. `imagePath` was never set, so a radiologist
   *     opening a flagged scan had a verdict and a confidence with no image
   *     behind them, which makes the review step meaningless. The bytes are now
   *     stored and the row points at them.
   *
   *  3. Nothing was announced. A high-risk result sat in the table until someone
   *     happened to refresh; radiologists are now notified as it lands.
   */
  const handleScanAnalysis = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const { scanType } = req.body;
      const imageBuffer = file.buffer;

      const sessionUserId = req.session!.user!.id;
      const sessionRole = req.session!.user!.role;
      const isStaff = ['admin', 'doctor', 'radiologist'].includes(sessionRole);

      let patientId = sessionUserId;
      if (req.body.patientId !== undefined && req.body.patientId !== '') {
        const requested = parseInt(req.body.patientId, 10);
        if (!Number.isInteger(requested)) {
          return res.status(400).json({ error: "Invalid patient ID" });
        }
        if (requested !== sessionUserId && !isStaff) {
          return res.status(403).json({ error: "You may only submit scans for yourself" });
        }
        patientId = requested;
      }

      const user = await storage.getUser(patientId);
      if (!user) {
        return res.status(400).json({ error: "Invalid patient ID" });
      }

      console.log(`Performing real-time analysis for ${scanType} scan...`);
      const analysisResult = await performRealTimeAnalysis(imageBuffer, scanType);

      const imagePath = await persistScanImage(imageBuffer, file, patientId, scanType);

      const scanData = {
        patientId: patientId,
        scanType: scanType,
        imagePath,
        imageSize: file.size ?? imageBuffer.length,
        result: analysisResult.hasCancer ?
          `${analysisResult.cancerType || 'Abnormal findings'} detected - ${analysisResult.riskLevel} risk` :
          "No abnormal findings detected",
        aiConfidence: `${Math.round(analysisResult.confidence)}%`,
        // Pin the model that produced this. Models get retrained and thresholds
        // move, so without it a stored result cannot be explained or reproduced
        // later.
        modelVersion: analysisResult.advancedMetrics?.modelVersion ?? null,
        processingTime: analysisResult.advancedMetrics?.processingTimeMs ?? null,
        riskLevel: analysisResult.riskLevel ?? null,
        // The model's call, recorded as a boolean at the moment it was made.
        // Production performance is a comparison between this and the confirmed
        // outcome, and recovering it later by searching `result` for the word
        // "cancer" would make the confusion matrix depend on copy-editing.
        predictedPositive: analysisResult.hasCancer,
        notes: analysisResult.findings ? analysisResult.findings.join('. ') : 'Analysis completed'
      };

      const savedScan = await storage.createScan(scanData);

      // Every automated result needs a human; a high-risk one needs one sooner.
      enhancedWsManager?.sendToRole('radiologist', {
        type: 'scan_completed',
        data: {
          scanId: savedScan.id,
          scanType,
          riskLevel: analysisResult.riskLevel ?? null,
          requiresReview: true,
        },
      });

      // Tell the patient their scan is being reviewed. Deliberately the same
      // message whether or not the model flagged it: a notification that only
      // arrives for flagged scans announces the finding by its own existence.
      deliverInBackground(
        user,
        'Your scan has been received',
        'Your scan has been analysed and is queued for clinician review.',
        '/'
      );

      res.json({
        success: true,
        scan: savedScan,
        analysis: {
          // Primary Results
          type: scanType.charAt(0).toUpperCase() + scanType.slice(1),
          confidence: Math.round(analysisResult.confidence),
          /**
           * `accuracyLevel` used to sit here, and was assigned
           * `Math.round(confidence)` — byte for byte the value on the line
           * above, under a name that means something else entirely.
           *
           * Confidence is this model's probability for this one image.
           * Accuracy is how often the model is right across a labelled set.
           * A 99% confident wrong answer is ordinary; reporting it as "99%
           * accuracy" is the precise claim MODEL_CARDS.md exists to prevent,
           * and it was being made on every single scan response.
           *
           * The measured figures live at GET /api/models/cards, and what this
           * deployment has actually achieved against confirmed outcomes lives
           * at GET /api/models/performance. Neither is a per-scan property.
           */
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
  };

  /**
   * Serves the image behind a scan, to people entitled to see it.
   *
   * The stored object is private in both backends, so this is the only way to
   * read one. Patients may see their own; clinical staff may see any, which is
   * what reviewing requires. Every read is audited.
   */
  app.get("/api/scans/:id/image", auditLog('READ_SCAN_IMAGE'), requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const scanId = parseInt(req.params.id, 10);
      if (!Number.isInteger(scanId)) {
        return res.status(400).json({ error: 'Invalid scan id' });
      }

      const scan = await storage.getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      const { id: userId, role } = req.session!.user!;
      const isStaff = ['admin', 'doctor', 'radiologist'].includes(role);
      if (!isStaff && scan.patientId !== userId) {
        return res.status(403).json({ error: 'Not your scan' });
      }

      if (!scan.imagePath) {
        return res.status(404).json({ error: 'No image stored for this scan' });
      }

      if (scan.imagePath.startsWith('gs://')) {
        // Redirect to a short-lived signed URL rather than proxying the bytes.
        const url = await getSignedScanUrl(scan.imagePath, 10);
        return res.redirect(302, url);
      }

      if (scan.imagePath.startsWith('file://')) {
        const objectName = scan.imagePath.slice('file://'.length);
        const uploadsRoot = path.resolve(process.cwd(), 'uploads');
        const absolute = path.resolve(uploadsRoot, objectName);

        // The stored value is generated server-side, but resolving it and
        // checking containment costs nothing and closes the path-traversal case
        // if a row is ever written by something else.
        if (!absolute.startsWith(uploadsRoot + path.sep)) {
          return res.status(400).json({ error: 'Invalid image reference' });
        }
        if (!fs.existsSync(absolute)) {
          return res.status(404).json({ error: 'Stored image is missing' });
        }

        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(absolute);
      }

      return res.status(500).json({ error: 'Unrecognised image reference' });
    } catch (error) {
      console.error('Failed to serve scan image:', error);
      res.status(500).json({ error: 'Failed to serve scan image' });
    }
  });

  /**
   * Records what a scan turned out to be.
   *
   * The single change that makes production accuracy measurable at all. Before
   * this existed, every endpoint asked how well the models perform on real
   * patients correctly answered null — not because nobody had computed it, but
   * because the comparison had no second operand.
   *
   * Clinical staff only, and append-only: a revised adjudication is a new row,
   * never an update, so a diagnosis that changed is distinguishable from one that
   * was always this. Recording an outcome does not alter the scan's stored
   * result; the model's prediction is evidence about the model and must not be
   * retconned once the answer is known.
   */
  app.post("/api/scans/:id/outcome", auditLog('RECORD_SCAN_OUTCOME'), requireAuth, requireMedicalAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const scanId = parseInt(req.params.id, 10);
      if (!Number.isInteger(scanId)) {
        return res.status(400).json({ error: 'Invalid scan id' });
      }

      const { outcome, method, notes } = req.body ?? {};

      if (!OUTCOME_VALUES.includes(outcome)) {
        return res.status(400).json({
          error: 'Invalid outcome',
          allowed: OUTCOME_VALUES,
        });
      }
      if (!OUTCOME_METHODS.includes(method)) {
        return res.status(400).json({
          error: 'Invalid method',
          allowed: OUTCOME_METHODS,
          hint: 'How the outcome was established. Histopathology and a second look are not equivalent evidence.',
        });
      }

      const scan = await storage.getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      const recorded = await storage.recordScanOutcome({
        scanId,
        outcome,
        method,
        recordedBy: req.session!.user!.id,
        notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
      });

      // Tell the patient their result was confirmed, and by what.
      await storage
        .createNotification({
          recipientId: scan.patientId,
          actorId: req.session!.user!.id,
          type: 'scan_result',
          title: 'A clinician confirmed your scan result',
          body: `Your ${scan.scanType} scan was reviewed and confirmed by ${method.replace(/_/g, ' ')}.`,
          link: '/',
        })
        .catch((error) => console.error('Failed to record outcome notification:', error));

      enhancedWsManager?.sendToUser(scan.patientId, {
        type: 'scan_completed',
        data: { scanId, adjudicated: true },
      });

      // Reach them off-platform too. A patient who closed the tab a week ago
      // learns nothing from an in-app notification, and a confirmed result is
      // exactly the case where that matters.
      //
      // The message says a result is ready and nothing about what it says: email
      // and SMS are not confidential channels, and a lock-screen preview naming
      // a diagnosis discloses it to whoever is holding the phone.
      const patient = await storage.getUser(scan.patientId);
      if (patient) {
        deliverInBackground(
          patient,
          'A result is ready in your HealthAI account',
          'A clinician has confirmed the result of a recent scan.',
          '/'
        );
      }

      res.status(201).json({
        success: true,
        outcome: recorded,
        // Whether the model was right about this one. Stated plainly, because
        // the point of collecting these is to find out.
        modelWasCorrect:
          scan.predictedPositive === null || outcome === 'indeterminate'
            ? null
            : scan.predictedPositive === (outcome === 'malignant'),
      });
    } catch (error) {
      console.error('Failed to record scan outcome:', error);
      res.status(500).json({ error: 'Failed to record outcome' });
    }
  });

  /** The current adjudication for a scan, plus the full history behind it. */
  app.get("/api/scans/:id/outcome", auditLog('READ_SCAN_OUTCOME'), requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const scanId = parseInt(req.params.id, 10);
      if (!Number.isInteger(scanId)) {
        return res.status(400).json({ error: 'Invalid scan id' });
      }

      const scan = await storage.getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      const { id: userId, role } = req.session!.user!;
      const isStaff = ['admin', 'doctor', 'radiologist'].includes(role);
      if (!isStaff && scan.patientId !== userId) {
        return res.status(403).json({ error: 'Not your scan' });
      }

      const [current, history] = await Promise.all([
        storage.getCurrentOutcome(scanId),
        storage.getOutcomeHistory(scanId),
      ]);

      res.json({
        scanId,
        predictedPositive: scan.predictedPositive,
        current: current ?? null,
        // More than one row means the adjudication was revised. Staff see that;
        // patients see only where it stands now.
        history: isStaff ? history : [],
        awaitingAdjudication: !current && scan.predictedPositive !== null,
      });
    } catch (error) {
      console.error('Failed to read scan outcome:', error);
      res.status(500).json({ error: 'Failed to read outcome' });
    }
  });

  /**
   * The measurement backlog: predictions with no confirmed answer yet.
   *
   * Flagged scans sort first. A missed cancer costs more than a false alarm, so
   * confirming the positives is what surfaces the failures worth knowing about.
   */
  app.get("/api/radiologist/awaiting-outcome", auditLog('READ_OUTCOME_QUEUE'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      /**
       * The name arrives joined now, so this no longer issues a getUser() per
       * distinct patient in a loop. It also no longer returns null for all of
       * them: the query behind this used SELECT s.* through raw pg, whose rows
       * are keyed patient_id, so scan.patientId was undefined, the Map lookup
       * was a lookup on undefined, and JSON.stringify then dropped every other
       * undefined field -- leaving the Outcomes tab a list of rows with an id
       * and a result and nothing to identify them by.
       */
      const scans = await storage.getScansAwaitingOutcome(limit);

      res.json(
        scans.map((scan) => ({
          id: scan.id,
          patientId: scan.patientId,
          patientName: scan.patientName ?? null,
          scanType: scan.scanType,
          predictedPositive: scan.predictedPositive,
          result: scan.result,
          aiConfidence: scan.aiConfidence,
          modelVersion: scan.modelVersion,
          createdAt: scan.createdAt,
          hasImage: Boolean(scan.imagePath),
        }))
      );
    } catch (error) {
      console.error('Failed to fetch outcome queue:', error);
      res.status(500).json({ error: 'Failed to fetch outcome queue' });
    }
  });

  /**
   * Measured performance on this deployment's own patients.
   *
   * Not the same question as /api/models/cards, and deliberately a separate
   * endpoint. A model card reports a held-out evaluation — reproducible, fixed,
   * and about a dataset. This reports what the model has actually done here,
   * against confirmed outcomes, with the denominators and confidence intervals
   * attached so a small sample cannot masquerade as a result.
   *
   * `?evidence=biopsy` restricts the calculation to biopsy or histopathology
   * confirmations. Agreement with a radiologist and confirmation by tissue are
   * different claims, and a caller should be able to ask for either.
   */
  app.get("/api/models/performance", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      const evidence = typeof req.query.evidence === 'string' ? req.query.evidence : undefined;
      if (evidence && !OUTCOME_METHODS.includes(evidence as any)) {
        return res.status(400).json({ error: 'Unknown evidence level', allowed: OUTCOME_METHODS });
      }

      const matrix = await storage.getOutcomeMatrix(evidence);
      const performance: ProductionPerformance[] = matrix.map((row) =>
        summarise(row, evidence ?? 'any')
      );

      res.json({
        models: performance,
        measuredAt: new Date().toISOString(),
        explanation:
          'Computed from confirmed outcomes recorded against this deployment. ' +
          'Held-out evaluation figures, which describe a different question, are ' +
          'at /api/models/cards.',
      });
    } catch (error) {
      console.error('Failed to compute production performance:', error);
      res.status(500).json({ error: 'Failed to compute production performance' });
    }
  });

  app.post("/api/scan/upload", requireAuth, upload.single('image'), handleScanAnalysis);
  app.post("/api/scans/analyze", requireAuth, upload.single('image'), handleScanAnalysis);


  // New route for /api/scans/analyze to fix client-server mismatch


  // Patient dashboard stats API endpoint
  /**
   * The four tiles on a patient's own dashboard.
   *
   * Two of the four were fabricated, and the more dangerous one was labelled
   * "Health Score".
   *
   * It was computed as the proportion of the patient's scans whose `result`
   * string did not contain the substring "abnormal", bucketed into Good / Fair /
   * Needs Attention, and defaulting to 85 — "Good" — for a patient with no scans
   * at all. The analysis pipeline writes results in the form
   * "Lung Cancer detected - high risk", which contains no such substring, so a
   * patient whose scan had just been flagged for malignancy scored 100% and was
   * shown a green "Good". That is the worst possible failure mode for this
   * screen: a reassuring summary generated by a string search, contradicting the
   * finding it was derived from.
   *
   * There is no health score here now. Scoring a person's health is a clinical
   * act, this platform holds nothing like the information it would need, and a
   * screening triage tool has no business attempting it. What the tiles show
   * instead is what the database knows: how many scans are done, how many are
   * still being read, whether anything has been flagged for review, and when the
   * next appointment actually is.
   *
   * `nextAppointment` was the literal string "7 days", printed regardless of
   * whether the patient had an appointment. It is now the real one, or null.
   */
  app.get("/api/patient/stats", requireAuth, async (req, res) => {
    try {
      // requireAuth guarantees the session; the previous `|| 2` would have
      // served the admin account's statistics to a patient.
      const patientId = (req.session as any).user.id;

      const [patientScans, patientAppointments] = await Promise.all([
        storage.getScans(patientId),
        storage.getAppointments(patientId),
      ]);

      const completedScans = patientScans.filter(scan => scan.status === 'completed').length;
      const pendingResults = patientScans.filter(scan => scan.status !== 'completed').length;

      // Read from the risk_level column, not by searching the prose in `result`.
      const flaggedForReview = patientScans.filter(scan =>
        ['high', 'critical'].includes((scan.riskLevel ?? '').toLowerCase())
      ).length;

      const now = Date.now();
      const upcoming = patientAppointments
        .filter(appointment =>
          appointment.appointmentDate &&
          appointment.status !== 'cancelled' &&
          new Date(appointment.appointmentDate).getTime() >= now
        )
        .sort(
          (a, b) =>
            new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime()
        )[0];

      res.json({
        completedScans,
        pendingResults,
        /**
         * How many of this patient's scans a clinician has flagged for review.
         *
         * Deliberately a count and not a verdict. It says what the queue holds;
         * it does not tell the patient what it means, which is the clinician's
         * job and is why every result in this system requires sign-off.
         */
        flaggedForReview,
        nextAppointment: upcoming
          ? {
              date: new Date(upcoming.appointmentDate).toISOString(),
              time: upcoming.appointmentTime ?? null,
              type: upcoming.type ?? null,
              status: upcoming.status ?? 'scheduled',
            }
          : null,
        // No health score. See the note above this handler.
        healthScore: null,
        healthScoreNote:
          'This platform does not compute a health score. Screening results are ' +
          'interpreted by a clinician, and each scan carries its own finding.',
      });
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
  // This deletes a medical scan. It had no ownership check, so any authenticated
  // patient could destroy any other patient's scan record by id.
  app.delete("/api/patient/activities/:id", auditLog('DELETE_SCAN_VIA_ACTIVITY'), requireAuth, requireScanOwnership, async (req, res) => {
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
  app.get("/api/doctor/reports", auditLog('READ_REPORT_LIST'), requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      /**
       * This clinician's reports.
       *
       * The query was unscoped — every scan in the database, for any patient,
       * returned to any doctor or radiologist who opened the Reports tab. The
       * patient panel had the same defect and was fixed; this endpoint was
       * missed, and it carries the finding text as well as the name.
       */
      const doctorId = (req.session as any).user.id;
      const scans = await storage.listScansWithPatient({ doctorId, limit: 200 });

      const reports = scans.map(scan => {
        /**
         * Clinical risk, not the workflow column.
         *
         * `priority` defaults to 'medium' in the schema and nothing sets it, so
         * every report displayed MEDIUM and the "High Priority" counter above
         * the list read 0 — including for a scan whose risk_level was 'high'.
         * The pending-reports endpoint was already reading risk_level; this one
         * still trusted a column nobody writes.
         */
        const risk = (scan.riskLevel ?? '').toLowerCase();
        const priority =
          risk === 'critical' ? 'urgent'
          : risk === 'high' ? 'high'
          : risk === 'medium' ? 'medium'
          : scan.priority ?? 'low';

        return {
          id: scan.id,
          patientName: scan.patientName,
          scanType: scan.scanType || null,
          submittedAt: scan.createdAt,
          // The stored workflow status, verbatim. This compared `status` against
          // 'Processing' — a value that only ever appears in `result` — so the
          // branch never matched and every report was labelled 'completed'.
          status: scan.status ?? 'pending',
          priority,
          riskLevel: scan.riskLevel ?? null,
          findings: scan.result,
          // Was the literal 'Dr. Johnson' on every row.
          radiologistId: scan.radiologistId,
          // Was `|| '85%'`, which invented a confidence for any scan that had
          // none, including ones no model ever ran on.
          aiConfidence: scan.aiConfidence ?? null
        };
      });

      res.json(reports);
    } catch (error) {
      console.error("Error fetching doctor reports:", error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  // Doctor recent activities API endpoint
  app.get("/api/doctor/activities/recent", requireAuth, requireMedicalAccess, async (req, res) => {
    try {
      // Five rows, ordered and limited by the database rather than by reading
      // every scan and slicing the tail of the array.
      const allScans = await storage.listScansWithPatient({ limit: 5 });

      const recentActivities = allScans.map(scan => ({
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

  /**
   * Free slots for a clinician on a date, for the dermatology dialog.
   *
   * This returned `timeSlots.filter(() => Math.random() > 0.3)` — a fresh random
   * subset of twelve fixed times on every request, with no clinician, no date
   * and no query of any kind. A patient reloading the page saw different
   * availability each time and could book a slot the clinician was busy for,
   * because nothing downstream re-checked it either.
   *
   * It now takes ?doctorId and ?date and answers from the appointments table and
   * the clinician's calendar.
   */
  app.get("/api/appointments/dermatologist-slots", requireAuth, async (req, res) => {
    try {
      const doctorId = Number.parseInt(req.query.doctorId as string, 10);
      const date = (req.query.date as string) || '';

      if (!Number.isInteger(doctorId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: 'doctorId and date (YYYY-MM-DD) are required',
        });
      }

      const clinician = await storage.getUser(doctorId);
      if (!clinician || !['doctor', 'radiologist'].includes(clinician.role)) {
        return res.status(404).json({ error: 'Unknown clinician' });
      }

      res.json(await getClinicianSlotsForDate(doctorId, date));
    } catch (error) {
      console.error("Error fetching dermatologist slots:", error);
      res.status(500).json({ error: "Failed to fetch available slots" });
    }
  });

  // A second POST /api/appointments/dermatologist was registered here. Express
  // matches the first registration, so it never ran — but it took no
  // authentication and defaulted the patient to id 2, the admin account, which
  // would have filed a dermatology appointment against an administrator's
  // record. It is deleted rather than left dormant: the guarded copy above is
  // one file reorder away from losing to it.
  //
  // The only behaviour unique to it was writing a scan row when `shareAnalysis`
  // was set. That is not carried over — it created a scan with the result field
  // stuffed with client-supplied JSON and no model involvement, which is the
  // same shape as the fabricated results removed elsewhere.

  // Admin staff creation endpoint
  app.post("/api/admin/staff", auditLog('CREATE_STAFF'), requireAuth, requireAdmin, sensitiveOperationLimit, validateInput, async (req, res) => {
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
      // Filtered in the database. Reading every user to keep the clinicians
      // also read every password hash and reset token into this process.
      const staff = await storage.getStaffDirectory(['doctor', 'radiologist']);

      res.json({
        data: staff.map(member => ({
          ...member,
          isActive: member.isActive !== false,
        }))
      });
    } catch (error) {
      console.error('Error fetching staff members:', error);
      res.status(500).json({ 
        error: 'Failed to fetch staff members',
        message: 'Please try again or contact support'
      });
    }
  });

  // Admin staff deletion endpoint
  app.delete("/api/admin/staff/:id", auditLog('DELETE_STAFF'), requireAuth, requireAdmin, sensitiveOperationLimit, async (req, res) => {
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
      // Revoke immediately. Removing the account without ending its sessions
      // left the holder authenticated until their cookie expired.
      if (deleted) {
        const revoked = await storage.revokeSessionsForUser(staffId);
        if (revoked) console.log(`Revoked ${revoked} session(s) for deleted staff ${staffId}`);
      }
      
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
  app.delete("/api/admin/staff/:id/permanent", auditLog('PERMANENT_DELETE_STAFF'), requireAuth, requireAdmin, sensitiveOperationLimit, async (req, res) => {
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
        const revoked = await storage.revokeSessionsForUser(staffId);
        if (revoked) console.log(`Revoked ${revoked} session(s) for purged staff ${staffId}`);
      }
      
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
  app.put("/api/admin/staff/:id", auditLog('UPDATE_STAFF'), requireAuth, requireAdmin, validateInput, async (req, res) => {
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

  // Admin user management.
  //
  // These four routes spent time inside a block comment that opened above the
  // duplicate, unauthenticated copies of /api/admin/stats and friends and did not
  // close until after them. The duplicates deserved to go; these did not, and they
  // went silently: the admin dashboard Edit, Delete and Reset-password buttons
  // called endpoints that answered 404, and the user list quietly fell back to
  // /api/admin/staff, which omits patients. The duplicates are deleted rather than
  // commented out, so nothing can be swallowed by a comment again.
  // Get all users for admin management
  app.get("/api/admin/users", auditLog('READ_USER_LIST'), requireAuth, requireAdmin, async (req, res) => {
    try {
      // Paged, and projected in the database.
      //
      // This is the one listing that legitimately wants every role, but it never
      // wanted every column: getAllUsers() selects `*`, so each render read every
      // password hash and every live password-reset token into this process in
      // order to display a name and an email. The columns below are the ones the
      // response actually contains.
      //
      // ?page= and ?pageSize= because an unbounded user list is fine on a
      // developer's database and is what falls over first in production.
      const page = Math.max(1, Number.parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.min(
        Math.max(1, Number.parseInt(req.query.pageSize as string, 10) || 100),
        500
      );

      const { users: rows, total } = await storage.listUsersPage({ page, pageSize });

      res.json(
        Object.assign(
          rows.map(user => ({
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            specialization: user.specialization,
            isActive: user.isActive !== false,
            createdAt: user.createdAt
          })),
          // Attached to the array so the existing client, which treats the body
          // as a list, keeps working unchanged.
          { page, pageSize, total }
        )
      );
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });
  
  // Update user
  app.put("/api/admin/users/:id", auditLog('UPDATE_USER'), requireAuth, requireAdmin, validateInput, async (req, res) => {
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
      
      // The logged line here carried the username and email. The request
      // logger in this project deliberately writes no identifiers to stdout;
      // this went around it.
      const updatedUser = await storage.updateUser(userId, updateData);
      if (!updatedUser) {
        // updateUser returns undefined when the row vanished between the
        // existence check above and the write — a concurrent delete. Previously
        // this fell through and the response spread `undefined`.
        return res.status(404).json({ error: 'User not found' });
      }

      // A change of role or a deactivation has to take effect now, not when the
      // cookie expires. requireAdmin and requireMedicalAccess read the role out
      // of the session, so a demoted admin kept administrative access for the
      // life of their session, and a deactivated account stayed usable.
      const roleChanged = existingUser.role !== updateData.role;
      const deactivated = existingUser.isActive !== false && updateData.isActive === false;
      if (roleChanged || deactivated) {
        const revoked = await storage.revokeSessionsForUser(userId);
        console.log(
          `Revoked ${revoked} session(s) for user ${userId} (` +
            `${roleChanged ? 'role change' : ''}${roleChanged && deactivated ? ', ' : ''}` +
            `${deactivated ? 'deactivated' : ''})`
        );
      }

      /**
       * Projected, because `updatedUser` is the raw row.
       *
       * .returning() gives every column, so this handler was sending the
       * account's bcrypt hash — and its password-reset token, when one was
       * live — back to the browser on every edit. From there it lands in the
       * React Query cache, in devtools, and in anything that captures response
       * bodies. Bcrypt is expensive to attack, but a hash that never leaves the
       * database cannot be attacked at all, and the reset token is a live
       * credential.
       *
       * Same column list the staff endpoint above already uses.
       */
      res.json({
        success: true,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          fullName: updatedUser.fullName,
          email: updatedUser.email,
          role: updatedUser.role,
          specialization: updatedUser.specialization,
          isActive: updatedUser.isActive,
        },
        sessionsRevoked: roleChanged || deactivated
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });
  
  // Delete user
  app.delete("/api/admin/users/:id", auditLog('DELETE_USER'), requireAuth, requireAdmin, sensitiveOperationLimit, async (req, res) => {
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
        const revoked = await storage.revokeSessionsForUser(userId);
        if (revoked) console.log(`Revoked ${revoked} session(s) for deleted user ${userId}`);
      }
      
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
  app.post("/api/admin/users/:id/reset-password", auditLog('RESET_PASSWORD'), requireAuth, requireAdmin, sensitiveOperationLimit, validateInput, async (req, res) => {
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

      // Ending the old sessions is the point of an administrative reset: it is
      // done when an account may be compromised, and leaving the attacker's
      // existing session alive defeats it.
      const revoked = await storage.revokeSessionsForUser(userId);

      res.json({
        success: true,
        message: 'Password reset successfully',
        sessionsRevoked: revoked
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });


  // The mock radiologist endpoints that stood here have been removed.
  //
  // They re-registered /api/radiologist/stats, /pending-reviews and
  // /completed-today with hardcoded patients — "John Smith, CT Chest,
  // Possible pulmonary nodule detected in right upper lobe, aiConfidence 92"
  // and four more. Express matches the first registration, so the guarded
  // handlers at ~1061-1134 always won and this block was unreachable; the
  // invented findings never reached a radiologist. It is deleted rather than
  // left dormant because reordering the file would have silently published
  // fabricated scan findings into a clinical review queue.

  /**
   * File a radiologist's report against a scan.
   *
   * This endpoint had no authentication and did not save anything. It built a
   * report object, discarded it, and answered "Report submitted successfully" —
   * and two components in the radiologist UI call it, so reports written by
   * clinicians were being acknowledged and lost. A false confirmation is worse
   * than an error here: the radiologist has no reason to write the report twice.
   *
   * It now persists through the same `updateScan` path the doctor approval flow
   * uses, and reports a failure when the scan does not exist.
   */
  app.post("/api/radiologist/scans/:id/report", auditLog('SUBMIT_RADIOLOGY_REPORT'), requireAuth, requireMedicalAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const scanId = parseInt(req.params.id);
      if (isNaN(scanId)) {
        return res.status(400).json({ error: 'Invalid scan ID' });
      }

      const { findings, recommendation } = req.body;
      if (!findings || !recommendation) {
        return res.status(400).json({ error: 'Findings and recommendation are required' });
      }

      const updated = await storage.updateScan(scanId, {
        findings,
        recommendations: recommendation,
        radiologistId: req.session!.user!.id,
        status: 'completed',
        reviewedAt: new Date(),
      });

      if (!updated) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      res.json({
        success: true,
        message: 'Report submitted successfully',
        report: updated
      });
    } catch (error) {
      console.error('Error submitting report:', error);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  });

  // Handle critical case actions
  app.post("/api/doctor/patients/:id/critical-action", requireAuth, requireMedicalAccess, async (req, res) => {
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
              doctorId: (req.session as any).user.id,
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
  app.get("/api/doctor/appointments/available-slots", requireAuth, requireMedicalAccess, async (req, res) => {
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
  // Creating a patient record is a clinical staff action. This was open to
  // anonymous callers, which both allowed unbounded record creation and made
  // the resulting rows unattributable.
  app.post("/api/patients", auditLog('CREATE_PATIENT'), requireAuth, requireMedicalAccess, async (req, res) => {
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
  app.post("/api/admin/train-skin-model", auditLog('TRAIN_AI_MODEL'), requireAuth, requireAdmin, sensitiveOperationLimit, async (req, res) => {
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
  app.post("/api/patient/questionnaire", requireAuth, async (req, res) => {
    try {
      const { responses, patientId } = req.body;

      if (!responses || !patientId) {
        return res.status(400).json({ error: "Missing questionnaire responses or patient ID" });
      }

      /*
       * An additive tally over self-reported answers.
       *
       * It is labelled honestly in the response below and is NOT a validated
       * risk model. It is not Gail, Tyrer-Cuzick, PLCOm2012 or any other
       * instrument with published discrimination and calibration; the weights
       * below were chosen by hand and have never been fitted to or evaluated
       * against outcome data. Two people with the same score have no established
       * relationship to each other's actual risk.
       *
       * The comment here previously read "Simple mock risk assessment logic",
       * while the response called the output a `riskAssessment` with a `level` of
       * low/moderate/high and drove an appointment urgency from it. Whatever the
       * source called it, the patient was shown a cancer risk level. The
       * calculation is unchanged; what it claims about itself is not.
       */
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

      const appointmentSuggestion = {
        recommended: riskLevel !== 'low',
        urgency: riskLevel === 'high' ? 'urgent' : 'routine',
        message: riskLevel === 'high' ? 
          "Based on your responses, an urgent appointment is recommended." : 
          "A routine appointment is suggested for further evaluation.",
        specialization: "Oncology"
      };

      // The maximum reachable score, so a bare number has a scale attached.
      const MAX_SCORE = 18;

      res.json({
        riskAssessment: {
          score: riskScore,
          maxScore: MAX_SCORE,
          level: riskLevel,
          recommendations,

          // Travels with the result so no consumer can present it as a clinical
          // risk estimate by accident.
          method: 'unvalidated_additive_questionnaire',
          validated: false,
          disclaimer:
            'This is a simple tally of self-reported answers, not a validated ' +
            'cancer risk model. It has not been fitted to or evaluated against ' +
            'outcome data, and it does not estimate your probability of having ' +
            'or developing cancer. Discuss screening with a clinician.',
        },
        appointmentSuggestion
      });

    } catch (error) {
      console.error("Error processing questionnaire:", error);
      res.status(500).json({ error: "Failed to process questionnaire" });
    }
  });

  /**
   * Who a given role is allowed to exchange messages with.
   *
   * One definition, consulted by both the participant list and the send guard.
   * They used to disagree: the list offered patients only clinicians, while
   * /api/chat/send accepted any receiverId at all, so any authenticated account
   * could message any other account by guessing its id — patient to patient
   * included — and the recipient's UI rendered it as a normal message.
   */
  const CHAT_MATRIX: Record<string, string[]> = {
    patient: ['doctor', 'radiologist'],
    doctor: ['patient'],
    radiologist: ['patient'],
  };

  const canChat = (senderRole: string, recipientRole: string): boolean =>
    (CHAT_MATRIX[senderRole] ?? []).includes(recipientRole);

  // Chat API endpoints
  app.get("/api/chat/participants", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // The role is the session's, not the query string's. Reading it from
      // ?role= let a caller ask for another role's address book.
      const userRole = req.session!.user!.role;
      const allowedRoles = CHAT_MATRIX[userRole] ?? [];

      // The chat address book is polled; it has no business reading the whole
      // user table, still less the password column, to build itself.
      const participants = (await storage.listDirectory(allowedRoles)).filter(
        user => user.fullName && user.fullName.trim() !== ''
      );
      
      // Online status comes from the WebSocket manager, which already tracks
      // exactly this. It was hardcoded to false with a comment saying real status
      // "would require WebSocket tracking" — the tracking existed; nothing asked
      // it. Every participant therefore rendered as offline, permanently.
      const online = new Map(
        (enhancedWsManager?.getOnlineUsers() ?? []).map((u) => [u.id, u.lastSeen])
      );

      const chatParticipants = participants.map(user => ({
        id: user.id,
        name: user.fullName || user.username,
        role: user.role,
        isOnline: online.has(user.id),
        lastSeen: online.get(user.id) ?? null
      }));
      
      // Removed excessive logging
      res.json(chatParticipants);
    } catch (error) {
      console.error('Failed to fetch chat participants:', error);
      res.status(500).json({ error: 'Failed to fetch participants' });
    }
  });

  app.get("/api/chat/messages", auditLog('READ_CHAT_MESSAGES'), requireAuth, async (req, res) => {
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

  app.post("/api/chat/send", requireAuth, validateInput, async (req: AuthenticatedRequest, res) => {
    try {
      const { receiverId, message } = req.body;
      const currentUserId = req.session!.user!.id;

      const parsedReceiverId = parseInt(receiverId, 10);
      if (!Number.isInteger(parsedReceiverId) || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // A message addressed to an id that does not exist used to reach the
      // insert and fail on the foreign key as a 500. It is a bad request.
      const [currentUser, recipient] = await Promise.all([
        storage.getUser(currentUserId),
        storage.getUser(parsedReceiverId),
      ]);
      if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found' });
      }

      // Same matrix the participant list is built from, so the two cannot drift.
      if (!currentUser || !canChat(currentUser.role, recipient.role)) {
        return res.status(403).json({ error: 'You may not message this user' });
      }

      const savedMessage = await storage.createChatMessage({
        senderId: currentUserId,
        receiverId: parsedReceiverId,
        message: message.trim(),
        messageType: 'text',
        status: 'sent',
      });

      const senderName = currentUser?.fullName || currentUser?.username || 'Unknown';
      const responseMessage = {
        ...savedMessage,
        senderName,
        timestamp: savedMessage.createdAt,
      };

      // Delivery and the notification are the server's job, not the sender's.
      //
      // The client used to POST /api/chat/notify itself after sending, on an
      // endpoint with no authentication that accepted any recipient id, sender
      // name and body: anyone could push a notification claiming to be from any
      // clinician to any patient. And nothing was ever delivered over the
      // WebSocket, so "real-time chat" only updated when the receiver refetched.
      // Both now happen here, where the sender's identity is already known.
      await storage
        .createNotification({
          recipientId: parsedReceiverId,
          actorId: currentUserId,
          type: 'chat_message',
          title: `New message from ${senderName}`,
          body: message.trim().slice(0, 140),
          link: '/chat',
        })
        .catch((error) => console.error('Failed to record chat notification:', error));

      enhancedWsManager?.sendToUser(parsedReceiverId, {
        type: 'new_chat_message',
        data: responseMessage,
      });

      res.json(responseMessage);
    } catch (error) {
      console.error('Failed to send message:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  /**
   * Marks a conversation read.
   *
   * The previous body was `res.json({ success: true })` with no authentication
   * and no database call: it reported success without doing anything, so unread
   * counts never cleared and chat_messages.read_at stayed null forever. The
   * reader is the session user — you can only mark messages addressed to you.
   */
  app.post("/api/chat/mark-read", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const receiverId = req.session!.user!.id;
      const senderId = parseInt(req.body?.senderId ?? req.body?.participantId, 10);

      if (!Number.isInteger(senderId)) {
        return res.status(400).json({ error: 'senderId is required' });
      }

      const marked = await storage.markMessagesAsRead(senderId, receiverId);

      // Let the sender's open tabs update their read receipts.
      if (marked > 0) {
        enhancedWsManager?.sendToUser(senderId, {
          type: 'messages_read',
          data: { readerId: receiverId, count: marked, at: new Date() },
        });
      }

      res.json({ success: true, marked });
    } catch (error) {
      console.error('Failed to mark messages as read:', error);
      res.status(500).json({ error: 'Failed to mark as read' });
    }
  });

  // POST /api/chat/notify has been removed, and the module-scoped
  // `const notifications: any[] = []` that backed it with it.
  //
  // The endpoint had no authentication and took recipientId, senderId,
  // senderName and the message body straight from the request, so anyone who
  // could reach the server could push a notification to any patient attributed
  // to any clinician — in an app whose notifications carry names and scan
  // outcomes. It also had no reason to exist: the only caller was the chat UI,
  // immediately after POST /api/chat/send, which already knows the sender from
  // the session and now writes the notification itself.
  //
  // The array behind it lost every notification on restart, was per-process
  // (so behind two instances a notification existed only for whichever one
  // received it), and was capped at 50 rows globally rather than per user, so a
  // busy conversation silently evicted everyone else's. Notifications are rows
  // in the `notifications` table now.

  // The recipient is the caller, taken from the session.
  //
  // This read the recipient id from `req.query.userId` with no authentication,
  // so incrementing a number in the URL returned somebody else's notifications —
  // which here carry patient names and scan outcomes. The companion mark-read
  // route took the same id from the body and would clear another user's
  // notifications. Neither needs a caller-supplied id: the only notifications a
  // user may see are their own.
  app.get("/api/chat/notifications", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.session!.user!.id;
      const [rows, unread] = await Promise.all([
        storage.getNotifications(userId, 20),
        storage.countUnreadNotifications(userId),
      ]);

      // Shape kept compatible with the previous in-memory objects so the client
      // needs no change: `read` is derived from readAt, `message` from body.
      res.json(
        rows.map((n) => ({
          id: n.id,
          recipientId: n.recipientId,
          senderId: n.actorId,
          senderName: n.title,
          message: n.body,
          type: n.type,
          link: n.link,
          timestamp: n.createdAt,
          read: n.readAt !== null,
          unreadTotal: unread,
        }))
      );
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.post("/api/chat/notifications/mark-read", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.session!.user!.id;
      const { notificationId } = req.body ?? {};

      // Ownership is part of the WHERE clause, so a notification belonging to
      // someone else is never matched. Omitting the id marks the whole feed read,
      // which is what the bell's "mark all" affordance needs.
      if (notificationId === undefined || notificationId === null) {
        const marked = await storage.markAllNotificationsRead(userId);
        return res.json({ success: true, marked });
      }

      const id = parseInt(notificationId, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid notification id' });
      }

      const marked = await storage.markNotificationRead(id, userId);
      res.json({ success: true, marked: marked ? 1 : 0 });
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
  app.post("/api/voice/token", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const currentUser = await storage.getUser(req.session!.user!.id);

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

  /**
   * Places a real phone call, so it is guarded like one.
   *
   * Previously it had no requireAuth, no rate limit and no relationship check:
   * any caller could POST a recipientId and the platform would dial that
   * person's number. Walking the id space turned this into an auto-dialler
   * pointed at the patient list, billed to the account's Twilio balance. It is
   * now restricted to pairs who are allowed to talk to each other at all, and to
   * the sensitive-operation rate limit.
   */
  app.post("/api/voice/call", auditLog('INITIATE_VOICE_CALL'), requireAuth, sensitiveOperationLimit, async (req: AuthenticatedRequest, res) => {
    try {
      const recipientId = parseInt(req.body?.recipientId, 10);
      if (!Number.isInteger(recipientId)) {
        return res.status(400).json({ error: 'Invalid recipient' });
      }

      const [currentUser, recipient] = await Promise.all([
        storage.getUser(req.session!.user!.id),
        storage.getUser(recipientId),
      ]);

      if (!currentUser || !recipient) {
        return res.status(400).json({ error: 'Invalid users' });
      }

      if (!canChat(currentUser.role, recipient.role)) {
        return res.status(403).json({ error: 'You may not call this user' });
      }

      const { TwilioService } = await import('./twilio-service');
      const phoneNumber = (recipient.phone ?? '').trim();

      if (!phoneNumber) {
        return res.status(400).json({ error: 'Recipient does not have a phone number configured' });
      }
      if (!TwilioService.isValidPhoneNumber(phoneNumber)) {
        return res.status(400).json({ error: 'Recipient phone number is not in E.164 format' });
      }

      // The number itself is not logged: it is personal information, and this
      // line previously printed it on every attempt.
      console.log(`Placing call to user ${recipient.id} on behalf of user ${currentUser.id}`);

      const result = await TwilioService.makeCall(phoneNumber, currentUser.fullName || currentUser.username);
      res.json(result);
    } catch (error) {
      console.error('Call initiation error:', error);
      // The upstream message can name the account and the number; it is logged
      // above, not returned.
      res.status(502).json({ error: 'Failed to initiate call' });
    }
  });

  // ===============================
  // ADVANCED FEATURES INTEGRATION
  // ===============================
  
  // Performance middleware is NOT registered here.
  //
  // It used to be, at the bottom of this function, after every route above had
  // already been mounted. Express runs middleware in registration order and a
  // route handler that sends a response never calls next(), so compression, the
  // response-time header and the performance monitor never ran for any of them.
  // They now live in server/index.ts ahead of the router, which is the only
  // position from which they can wrap a response.

  // Mount advanced routes
  app.use('/api/advanced', advancedRoutes);

  // Genomics: consent, genotype upload, polygenic scoring, fused risk.
  // Every data-touching route inside enforces consent and writes an audit entry.
  app.use('/api/genomics', genomicsRoutes);

  // Usage tracking is registered in server/index.ts, ahead of these routes, for
  // the same reason: mounted here it sat behind every handler and recorded
  // nothing.

  console.log('🚀 Advanced features integrated successfully');

  // The WebSocket server is deliberately NOT started here.
  //
  // It used to be, and server/index.ts started one too, against this same HTTP
  // server. Both managers registered an 'upgrade' listener, so the first client
  // to open /ws was handed to handleUpgrade twice and ws threw
  // "server.handleUpgrade() was called more than once with the same socket"
  // out of an event handler — an uncaught exception that killed the process.
  // The app's own frontend opens that socket on load, so the server died on the
  // first page view. Ownership of the socket now sits with the entry point.
  return createServer(app);
}
