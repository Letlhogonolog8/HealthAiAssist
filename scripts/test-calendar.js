#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

async function testGoogleCalendar() {
  console.log('🧪 Testing Google Calendar Integration\n');

  // Check environment variables
  const credentials = process.env.GOOGLE_CALENDAR_CREDENTIALS;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!credentials) {
    console.log('❌ GOOGLE_CALENDAR_CREDENTIALS not found in .env');
    console.log('   Add your service account JSON credentials');
    return;
  }

  if (!calendarId) {
    console.log('❌ GOOGLE_CALENDAR_ID not found in .env');
    console.log('   Add your Google Calendar ID');
    return;
  }

  console.log('✅ Environment variables found');

  try {
    // Test credentials parsing
    const parsedCredentials = JSON.parse(credentials);
    console.log('✅ Credentials JSON is valid');
    console.log(`   Service Account: ${parsedCredentials.client_email}`);
  } catch (error) {
    console.log('❌ Invalid credentials JSON format');
    console.log('   Make sure the JSON is properly formatted');
    return;
  }

  // Test the service
  try {
    const { googleCalendarService } = require('../server/google-calendar-service.ts');
    
    const status = googleCalendarService.getServiceStatus();
    console.log(`📊 Service Status: ${status.message}`);

    if (status.configured) {
      console.log('✅ Google Calendar integration is working!');
      
      // Test availability check
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      
      console.log(`🔍 Testing availability for ${dateStr}...`);
      const availability = await googleCalendarService.checkTimeSlotAvailability(dateStr, '10:00 AM');
      
      if (availability.isAvailable) {
        console.log('✅ Time slot is available');
      } else {
        console.log('⚠️  Time slot has conflict:', availability.conflictingEvent?.summary);
      }
    }
  } catch (error) {
    console.log('❌ Error testing service:', error.message);
  }
}

testGoogleCalendar().catch(console.error);