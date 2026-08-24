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

// Load environment variables first

import { GoogleCalendarService } from '../server/google-calendar-service';

async function testCalendarIntegration() {
  console.log('🗓️  Testing Google Calendar Integration\n');
  
  // Create fresh service instance
  const googleCalendarService = new GoogleCalendarService();
  
  // Check service status
  const status = googleCalendarService.getServiceStatus();
  console.log(`Status: ${status.configured ? '✅' : '❌'} ${status.message}\n`);
  
  if (!status.configured) {
    console.log('To configure Google Calendar:');
    console.log('1. Run: npx tsx scripts/setup-google-calendar-interactive.ts');
    console.log('2. Or manually add GOOGLE_CALENDAR_CREDENTIALS and GOOGLE_CALENDAR_ID to .env');
    return;
  }

  // Test time slot checking
  console.log('Testing time slot availability...');
  const testDate = new Date();
  testDate.setDate(testDate.getDate() + 1); // Tomorrow
  const dateString = testDate.toISOString().split('T')[0];
  
  try {
    const availability = await googleCalendarService.checkTimeSlotAvailability(dateString, '10:00 AM');
    console.log(`✅ Time slot check successful:`);
    console.log(`   Date: ${availability.date}`);
    console.log(`   Time: ${availability.time}`);
    console.log(`   Available: ${availability.isAvailable ? 'Yes' : 'No'}`);
    
    if (availability.conflictingEvent) {
      console.log(`   Conflict: ${availability.conflictingEvent.summary}`);
    }
  } catch (error) {
    console.log(`❌ Time slot check failed: ${error}`);
  }

  // Test getting available slots
  console.log('\nTesting available time slots...');
  try {
    const availableSlots = await googleCalendarService.getAvailableTimeSlotsForDate(dateString);
    console.log(`✅ Found ${availableSlots.length} available slots for ${dateString}:`);
    availableSlots.slice(0, 5).forEach(slot => console.log(`   - ${slot}`));
    if (availableSlots.length > 5) {
      console.log(`   ... and ${availableSlots.length - 5} more`);
    }
  } catch (error) {
    console.log(`❌ Available slots check failed: ${error}`);
  }
}

testCalendarIntegration().catch(console.error);