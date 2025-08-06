// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

// Test Twilio configuration
console.log('Testing Twilio configuration...');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'Set ✓' : 'Missing ✗');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'Set ✓' : 'Missing ✗');
console.log('TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER ? 'Set ✓' : 'Missing ✗');

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = await import('twilio');
    const client = twilio.default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    // Test connection by fetching account info
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log('✅ Twilio connection successful!');
    console.log('Account Status:', account.status);
    console.log('Account Name:', account.friendlyName);
  } catch (error) {
    console.error('❌ Twilio connection failed:', error.message);
  }
} else {
  console.log('❌ Twilio environment variables not set');
}