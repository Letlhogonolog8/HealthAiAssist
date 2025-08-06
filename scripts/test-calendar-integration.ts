#!/usr/bin/env tsx

/**
 * Test script for Google Calendar integration
 * Run with: npx tsx scripts/test-calendar-integration.ts
 */

import { googleCalendarService } from '../server/google-calendar-service';

async function testCalendarIntegration() {
  console.log('🗓️  Testing Google Calendar Integration...\n');

  // Check service status
  const status = googleCalendarService.getServiceStatus();
  console.log('📊 Service Status:', status.message);
  console.log('✅ Configured:', status.configured ? 'Yes' : 'No');
  console.log('');

  if (!status.configured) {
    console.log('ℹ️  Google Calendar is not configured. The system will work in fallback mode.');
    console.log('📖 See docs/google-calendar-setup.md for setup instructions.');
    return;
  }

  // Test time slot availability checking
  console.log('🔍 Testing time slot availability...');
  
  const testSlots = [
    { date: '2025-08-01', time: '09:00 AM' },
    { date: '2025-08-01', time: '10:00 AM' },
    { date: '2025-08-01', time: '02:00 PM' },
    { date: '2025-08-02', time: '09:00 AM' }
  ];

  for (const slot of testSlots) {
    try {
      const availability = await googleCalendarService.checkTimeSlotAvailability(slot.date, slot.time);
      
      console.log(`📅 ${slot.date} at ${slot.time}:`);
      console.log(`   Available: ${availability.isAvailable ? '✅ Yes' : '❌ No'}`);
      
      if (!availability.isAvailable && availability.conflictingEvent) {
        console.log(`   Conflict: ${availability.conflictingEvent.summary}`);
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Error checking ${slot.date} at ${slot.time}:`, error.message);
    }
  }

  // Test getting available slots for a specific date
  console.log('📋 Testing available slots for August 1st, 2025...');
  try {
    const availableSlots = await googleCalendarService.getAvailableTimeSlotsForDate('2025-08-01');
    console.log(`✅ Available slots: ${availableSlots.length > 0 ? availableSlots.join(', ') : 'None'}`);
  } catch (error) {
    console.error('❌ Error getting available slots:', error.message);
  }

  console.log('\n🎉 Calendar integration test completed!');
}

// Run the test
testCalendarIntegration().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});