import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

console.log('Environment variables:');
console.log('TWILIO_ACCOUNT_SID:', accountSid ? 'Set' : 'Missing');
console.log('TWILIO_AUTH_TOKEN:', authToken ? 'Set' : 'Missing');
console.log('TWILIO_PHONE_NUMBER:', twilioPhoneNumber ? 'Set' : 'Missing');

if (accountSid && authToken && twilioPhoneNumber) {
  const client = twilio(accountSid, authToken);
  
  try {
    console.log('Testing Twilio call...');
    const call = await client.calls.create({
      to: '+15551234567', // Valid test number format
      from: twilioPhoneNumber,
      twiml: '<Response><Say>This is a test call from your medical platform.</Say></Response>'
    });
    
    console.log('✅ Call created successfully!');
    console.log('Call SID:', call.sid);
  } catch (error) {
    console.error('❌ Call failed:', error.message);
  }
} else {
  console.log('❌ Missing Twilio configuration');
}