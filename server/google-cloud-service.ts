import { ImageAnnotatorClient } from '@google-cloud/vision';
import { Storage } from '@google-cloud/storage';

// Initialize Google Cloud clients using environment variables
let visionClient: ImageAnnotatorClient | null = null;
let storageClient: Storage | null = null;

try {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;
  
  if (projectId && clientEmail && privateKey) {
    // Clean and format the private key properly
    const cleanPrivateKey = privateKey
      .replace(/\\n/g, '\n')
      .replace(/"/g, '')
      .trim();
    
    const credentials = {
      type: 'service_account',
      project_id: projectId,
      client_email: clientEmail,
      private_key: cleanPrivateKey,
    };
    
    // Test credentials format before initializing clients
    if (cleanPrivateKey.includes('BEGIN PRIVATE KEY') && cleanPrivateKey.includes('END PRIVATE KEY')) {
      visionClient = new ImageAnnotatorClient({ credentials });
      storageClient = new Storage({ 
        projectId: projectId,
        credentials 
      });
      console.log('Google Cloud services initialized successfully');
    } else {
      console.log('Invalid private key format, using fallback analysis');
    }
  } else {
    console.log('Google Cloud credentials not found, using fallback analysis');
  }
} catch (error) {
  console.error('Failed to initialize Google Cloud services:', error);
  console.log('Using fallback analysis instead');
}

export interface GoogleCloudAnalysisResult {
  labels: Array<{ description: string; score: number }>;
  text?: string;
  faces?: Array<{ confidence: number }>;
  objects?: Array<{ name: string; score: number }>;
  medicalFindings?: Array<{ finding: string; confidence: number }>;
  riskAssessment?: {
    level: 'low' | 'medium' | 'high';
    confidence: number;
    reasoning: string[];
  };
}

export async function analyzeImageWithGoogleCloud(imageBuffer: Buffer): Promise<GoogleCloudAnalysisResult> {
  if (!visionClient) {
    throw new Error('Google Cloud Vision client not initialized');
  }

  try {
    // Perform label detection only to avoid authentication issues
    const [labelResult] = await visionClient.labelDetection({
      image: { content: imageBuffer }
    });

    const labels = labelResult.labelAnnotations?.map(label => ({
      description: label.description || '',
      score: label.score || 0
    })) || [];

    // Medical analysis based on detected labels
    const medicalFindings = analyzeMedicalContent(labels, []);
    const riskAssessment = assessMedicalRisk(labels, [], medicalFindings);

    return {
      labels,
      text: '',
      objects: [],
      medicalFindings,
      riskAssessment
    };
  } catch (error) {
    console.error('Google Cloud Vision API error:', error);
    // Don't throw error, let fallback handle it
    throw new Error('Failed to analyze image with Google Cloud Vision');
  }
}

function analyzeMedicalContent(
  labels: Array<{ description: string; score: number }>,
  objects: Array<{ name: string; score: number }>
): Array<{ finding: string; confidence: number }> {
  const medicalFindings: Array<{ finding: string; confidence: number }> = [];
  
  // Medical keywords to look for
  const medicalKeywords = {
    'abnormal': ['tumor', 'mass', 'lesion', 'growth', 'abnormal', 'irregular'],
    'normal': ['healthy', 'normal', 'clear', 'regular'],
    'anatomical': ['lung', 'breast', 'skin', 'tissue', 'organ', 'bone', 'muscle']
  };

  // Analyze labels for medical content
  labels.forEach(label => {
    const desc = label.description.toLowerCase();
    
    if (medicalKeywords.abnormal.some(keyword => desc.includes(keyword))) {
      medicalFindings.push({
        finding: `Potential abnormality detected: ${label.description}`,
        confidence: label.score
      });
    }
    
    if (medicalKeywords.anatomical.some(keyword => desc.includes(keyword))) {
      medicalFindings.push({
        finding: `Anatomical structure identified: ${label.description}`,
        confidence: label.score
      });
    }
  });

  return medicalFindings;
}

function assessMedicalRisk(
  labels: Array<{ description: string; score: number }>,
  objects: Array<{ name: string; score: number }>,
  findings: Array<{ finding: string; confidence: number }>
): { level: 'low' | 'medium' | 'high'; confidence: number; reasoning: string[] } {
  let riskScore = 0;
  const reasoning: string[] = [];

  // Check for high-risk indicators
  const highRiskTerms = ['tumor', 'mass', 'lesion', 'abnormal', 'irregular', 'suspicious'];
  const mediumRiskTerms = ['density', 'shadow', 'opacity', 'calcification'];
  
  labels.forEach(label => {
    const desc = label.description.toLowerCase();
    
    if (highRiskTerms.some(term => desc.includes(term))) {
      riskScore += label.score * 3;
      reasoning.push(`High-risk indicator detected: ${label.description}`);
    } else if (mediumRiskTerms.some(term => desc.includes(term))) {
      riskScore += label.score * 2;
      reasoning.push(`Medium-risk indicator detected: ${label.description}`);
    }
  });

  // Assess overall risk level
  let level: 'low' | 'medium' | 'high' = 'low';
  if (riskScore > 0.7) {
    level = 'high';
  } else if (riskScore > 0.3) {
    level = 'medium';
  }

  if (reasoning.length === 0) {
    reasoning.push('No significant abnormalities detected in initial analysis');
  }

  return {
    level,
    confidence: Math.min(riskScore, 1.0),
    reasoning
  };
}

/**
 * Stores a medical image in Cloud Storage and returns its gs:// object URI.
 *
 * The object is private. This function used to call file.makePublic() and hand
 * back a https://storage.googleapis.com/... URL, which would have published every
 * scan in the bucket to the open internet at a guessable address, readable
 * without any credential — patient imaging, indexable. The comment on that call
 * read "(optional)". It was never wired to a caller, which is the only reason
 * nothing leaked; it is corrected here before anything starts using it.
 *
 * Access goes through getSignedScanUrl(), which mints a short-lived URL for a
 * request that has already passed the application's authorisation checks.
 */
export async function uploadToGoogleCloudStorage(
  imageBuffer: Buffer,
  fileName: string,
  contentType: string = 'image/jpeg',
  bucketName: string = process.env.GOOGLE_CLOUD_SCAN_BUCKET || 'healthai-medical-scans'
): Promise<string> {
  if (!storageClient) {
    throw new Error('Google Cloud Storage client not initialized');
  }

  try {
    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(fileName);

    await file.save(imageBuffer, {
      resumable: false,
      metadata: {
        contentType,
        // Objects hold patient imaging: never served from a CDN edge, never
        // cached by an intermediary.
        cacheControl: 'private, max-age=0, no-store',
        metadata: {
          uploadedAt: new Date().toISOString(),
          source: 'healthai-platform'
        }
      }
    });

    return `gs://${bucketName}/${fileName}`;
  } catch (error) {
    console.error('Google Cloud Storage upload error:', error);
    throw new Error('Failed to upload image to Google Cloud Storage');
  }
}

/**
 * A time-limited read URL for a gs:// object.
 *
 * Callers must have authorised the request first: this grants access to whoever
 * holds the link for as long as it lives, so the window is deliberately short.
 */
export async function getSignedScanUrl(objectUri: string, ttlMinutes = 10): Promise<string> {
  if (!storageClient) {
    throw new Error('Google Cloud Storage client not initialized');
  }

  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(objectUri);
  if (!match) {
    throw new Error(`Not a Cloud Storage object URI: ${objectUri}`);
  }

  const [, bucketName, objectName] = match;
  const [url] = await storageClient
    .bucket(bucketName)
    .file(objectName)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlMinutes * 60 * 1000,
    });

  return url;
}

export function isGoogleCloudAvailable(): boolean {
  return visionClient !== null && storageClient !== null;
}