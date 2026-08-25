/**
 * Reports whether scan images will be written to durable object storage.
 *
 * This script previously ended by printing, whenever credentials happened to be
 * present:
 *
 *   - Breast cancer scans will use Google Cloud Vision API
 *   - Lung cancer scans will use Google Cloud Vision API
 *   - Colon cancer scans will use Google Cloud Vision API
 *   - Prostate cancer scans will use Google Cloud Vision API
 *
 * None of that was ever true. Breast, colon and prostate have no classifier at
 * all and return 503; lung uses the local ResNet50V2; and the Vision code path
 * was never wired to a caller before it was deleted. Google Cloud's only role
 * here is holding scan images.
 */
import '../server/load-env';
import { isScanObjectStoreAvailable } from '../server/google-cloud-service';

async function testScanStorageSetup() {
  console.log('Checking scan image storage...');

  const requiredVars = [
    'GOOGLE_CLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_CLIENT_EMAIL',
    'GOOGLE_CLOUD_PRIVATE_KEY',
  ];

  console.log('\n=== Environment Variables ===');
  requiredVars.forEach((varName) => {
    const value = process.env[varName];
    if (value) {
      console.log(
        `✓ ${varName}: ${varName === 'GOOGLE_CLOUD_PRIVATE_KEY' ? '[PRIVATE KEY SET]' : value}`
      );
    } else {
      console.log(`✗ ${varName}: NOT SET`);
    }
  });

  const bucket = process.env.GOOGLE_CLOUD_SCAN_BUCKET;
  console.log(
    bucket
      ? `✓ GOOGLE_CLOUD_SCAN_BUCKET: ${bucket}`
      : '✗ GOOGLE_CLOUD_SCAN_BUCKET: NOT SET (defaults to healthai-medical-scans)'
  );

  console.log('\n=== Summary ===');
  if (isScanObjectStoreAvailable()) {
    console.log('✓ Cloud Storage is configured. Scan images persist to gs:// objects.');
    console.log('  Objects are private; reads go through GET /api/scans/:id/image,');
    console.log('  which authorises the caller and mints a short-lived signed URL.');
  } else {
    console.log('⚠️  Cloud Storage is NOT configured.');
    console.log('   Scan images will be written to the local uploads/ directory,');
    console.log('   which is ephemeral on Render, Railway and Cloud Run — images are');
    console.log('   lost on the next deploy. Acceptable in development only.');
  }
}

testScanStorageSetup().catch(console.error);
