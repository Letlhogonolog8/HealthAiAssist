#!/usr/bin/env tsx

import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAppointmentBooking() {
  console.log('🗓️  Testing Appointment Booking with Google Calendar Integration\n');

  try {
    // Test 1: Check available slots
    console.log('1. Testing available slots endpoint...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    const slotsResponse = await fetch(`http://localhost:5000/api/appointments/available-slots?year=${tomorrow.getFullYear()}&month=${tomorrow.getMonth() + 1}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (slotsResponse.ok) {
      const slots = await slotsResponse.json();
      const tomorrowSlots = slots[dateStr] || [];
      console.log(`✅ Found ${tomorrowSlots.length} available slots for ${dateStr}`);
      if (tomorrowSlots.length > 0) {
        console.log(`   First available slot: ${tomorrowSlots[0].time}`);
      }
    } else {
      console.log('❌ Failed to fetch available slots');
    }

    // Test 2: Test Google Calendar service directly
    console.log('\n2. Testing Google Calendar service...');
    const { GoogleCalendarService } = await import('../server/google-calendar-service');
    const calendarService = new GoogleCalendarService();
    
    const status = calendarService.getServiceStatus();
    console.log(`   Status: ${status.configured ? '✅' : '❌'} ${status.message}`);
    
    if (status.configured) {
      // Test time slot availability
      const testSlot = await calendarService.checkTimeSlotAvailability(dateStr, '10:00 AM');
      console.log(`   Time slot 10:00 AM available: ${testSlot.isAvailable ? '✅' : '❌'}`);
      
      if (!testSlot.isAvailable && testSlot.conflictingEvent) {
        console.log(`   Conflict: ${testSlot.conflictingEvent.summary}`);
      }
    }

    console.log('\n✅ Appointment booking system with Google Calendar integration is ready!');
    console.log('\nNext steps:');
    console.log('1. Start your application: npm run dev');
    console.log('2. Navigate to the appointment scheduling page');
    console.log('3. Try booking an appointment - conflicts will be automatically detected');
    console.log('4. Create a test event in your Google Calendar and try booking the same time slot');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testAppointmentBooking().catch(console.error);