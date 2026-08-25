/**
 * Cloud Storage for scan images. Nothing else.
 *
 * This module used to carry a second, unrelated job: a Vision API client and
 * `analyzeImageWithGoogleCloud`, which ran generic label detection over a
 * medical image, keyword-matched the returned labels against lists like
 * `['tumor', 'mass', 'lesion', 'abnormal']`, and assembled `medicalFindings`
 * and a low/medium/high `riskAssessment` from the matches.
 *
 * Nothing called it. That is the only reason it never reached a patient — it is
 * exactly the pattern the rest of this codebase was cleaned of: a clinical
 * verdict produced by a formula nobody measured, in this case string matching
 * over a general-purpose image labeller that has no medical training whatsoever.
 * It is deleted rather than left dormant, because dormant code gets called.
 *
 * The deletion also fixes a live bug. Scan image storage is gated on the
 * availability check at the bottom of this file, which required BOTH the Vision
 * client and the Storage client to have initialised:
 *
 *     return visionClient !== null && storageClient !== null;   // was
 *
 * The two clients are constructed from the same credentials, so they usually
 * failed together — but not always, and any Vision-specific failure (API not
 * enabled on the project, Vision quota, a scope the service account lacks) made
 * this function return false while Cloud Storage was perfectly healthy.
 * `persistScanImage` then fell through to writing patient imaging into the
 * container's local `uploads/` directory, which is ephemeral on Render, Railway
 * and Cloud Run alike. A correctly configured bucket did not save you; the
 * images were quietly discarded on the next deploy.
 *
 * The check is now about the object store, and is named for what it gates.
 */
import { Storage } from '@google-cloud/storage';

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

    // Test credentials format before initializing the client
    if (cleanPrivateKey.includes('BEGIN PRIVATE KEY') && cleanPrivateKey.includes('END PRIVATE KEY')) {
      storageClient = new Storage({
        projectId: projectId,
        credentials
      });
      console.log('Google Cloud Storage initialized successfully');
    } else {
      console.warn(
        'GOOGLE_CLOUD_PRIVATE_KEY is not in PEM format; Cloud Storage is disabled ' +
        'and scan images will be written to local disk.'
      );
    }
  } else {
    console.log('Google Cloud credentials not set; scan images will be written to local disk.');
  }
} catch (error) {
  console.error('Failed to initialize Google Cloud Storage:', error);
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

/**
 * Whether scan images can be written to durable object storage.
 *
 * Named for what it gates. The previous name — `isGoogleCloudAvailable` —
 * described a vendor rather than a capability, which is how it came to be
 * ANDed with an unrelated client and silently disabled image persistence.
 */
export function isScanObjectStoreAvailable(): boolean {
  return storageClient !== null;
}
