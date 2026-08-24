#!/usr/bin/env tsx

/**
 * `../server/load-env` rather than `dotenv/config`.
 *
 * dotenv's default is that an already-set variable wins, so on a machine
 * carrying a Machine- or User-scope DATABASE_URL from another project this
 * script silently talked to that database instead of the one in .env — or, when
 * the credentials did not match, failed with "received invalid response: 4a"
 * from the SCRAM handshake. load-env overrides from the file in development,
 * which is what every other entry point in this project uses.
 */
import '../server/load-env';

// Load environment variables

console.log('🔍 Debugging Google Calendar Environment Variables\n');

// Check if variables exist
const credentials = process.env.GOOGLE_CALENDAR_CREDENTIALS;
const calendarId = process.env.GOOGLE_CALENDAR_ID;

console.log('Environment Variables:');
console.log(`GOOGLE_CALENDAR_CREDENTIALS exists: ${!!credentials}`);
console.log(`GOOGLE_CALENDAR_ID exists: ${!!calendarId}`);
console.log(`GOOGLE_CALENDAR_ID value: ${calendarId}\n`);

if (credentials) {
  console.log('Credentials length:', credentials.length);
  console.log('First 50 chars:', credentials.substring(0, 50));
  
  try {
    const parsed = JSON.parse(credentials);
    console.log('✅ JSON parsing successful');
    console.log('Service account email:', parsed.client_email);
    console.log('Project ID:', parsed.project_id);
  } catch (error) {
    console.log('❌ JSON parsing failed:', error.message);
  }
} else {
  console.log('❌ GOOGLE_CALENDAR_CREDENTIALS not found');
}

// Test the service initialization
console.log('\n🧪 Testing Service Initialization...');
try {
  const { GoogleCalendarService } = await import('../server/google-calendar-service.js');
  const service = new GoogleCalendarService();
  const status = service.getServiceStatus();
  console.log('Service status:', status);
} catch (error) {
  console.log('❌ Service initialization failed:', error.message);
}