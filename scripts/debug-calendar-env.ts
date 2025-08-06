#!/usr/bin/env tsx

import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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