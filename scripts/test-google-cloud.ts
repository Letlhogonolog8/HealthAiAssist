import { isGoogleCloudAvailable } from '../server/google-cloud-service';

async function testGoogleCloudSetup() {
  console.log('Testing Google Cloud setup...');
  
  // Check environment variables
  const requiredVars = [
    'GOOGLE_CLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_CLIENT_EMAIL', 
    'GOOGLE_CLOUD_PRIVATE_KEY'
  ];
  
  console.log('\n=== Environment Variables ===');
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✓ ${varName}: ${varName === 'GOOGLE_CLOUD_PRIVATE_KEY' ? '[PRIVATE KEY SET]' : value}`);
    } else {
      console.log(`✗ ${varName}: NOT SET`);
    }
  });
  
  // Test Google Cloud availability
  console.log('\n=== Google Cloud Services ===');
  try {
    const isAvailable = isGoogleCloudAvailable();
    if (isAvailable) {
      console.log('✓ Google Cloud Vision API: INITIALIZED');
      console.log('✓ Google Cloud Storage: INITIALIZED');
      console.log('✓ Medical imaging analysis will use Google Cloud');
    } else {
      console.log('✗ Google Cloud services: NOT AVAILABLE');
      console.log('  Medical imaging analysis will use fallback');
    }
  } catch (error) {
    console.log('✗ Google Cloud initialization error:', error);
  }
  
  console.log('\n=== Summary ===');
  if (isGoogleCloudAvailable()) {
    console.log('🎉 Google Cloud integration is ready!');
    console.log('   - Breast cancer scans will use Google Cloud Vision API');
    console.log('   - Lung cancer scans will use Google Cloud Vision API'); 
    console.log('   - Colon cancer scans will use Google Cloud Vision API');
    console.log('   - Prostate cancer scans will use Google Cloud Vision API');
    console.log('   - Skin cancer scans will use TensorFlow model');
  } else {
    console.log('⚠️  Google Cloud not available, using fallback analysis');
  }
}

testGoogleCloudSetup().catch(console.error);