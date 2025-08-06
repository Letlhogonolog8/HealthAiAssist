#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

console.log('🗓️  Google Calendar Integration Setup\n');

console.log('To integrate Google Calendar, you need to:');
console.log('1. Create a Google Cloud Project');
console.log('2. Enable Google Calendar API');
console.log('3. Create a Service Account');
console.log('4. Download the service account key');
console.log('5. Share your calendar with the service account\n');

console.log('📋 Step-by-step instructions:');
console.log('1. Go to: https://console.cloud.google.com/');
console.log('2. Create a new project or select existing one');
console.log('3. Enable Google Calendar API:');
console.log('   - Go to "APIs & Services" > "Library"');
console.log('   - Search for "Google Calendar API"');
console.log('   - Click "Enable"');
console.log('4. Create Service Account:');
console.log('   - Go to "APIs & Services" > "Credentials"');
console.log('   - Click "Create Credentials" > "Service Account"');
console.log('   - Fill in details and create');
console.log('5. Generate Key:');
console.log('   - Click on service account');
console.log('   - Go to "Keys" tab');
console.log('   - Click "Add Key" > "Create new key" > "JSON"');
console.log('   - Download the JSON file');
console.log('6. Share Calendar:');
console.log('   - Open Google Calendar');
console.log('   - Settings > Share with specific people');
console.log('   - Add service account email');
console.log('   - Give "See all event details" permission');
console.log('   - Copy Calendar ID from "Integrate calendar" section\n');

console.log('📝 After completing the above steps, add to your .env file:');
console.log('GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account",...}');
console.log('GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com\n');

console.log('💡 For detailed instructions, see: docs/google-calendar-setup.md');
console.log('🧪 Test the integration by running: npm run test-calendar');