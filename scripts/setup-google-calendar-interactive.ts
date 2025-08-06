#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupGoogleCalendar() {
  console.log('🗓️  Google Calendar Integration Setup\n');
  
  console.log('Before proceeding, make sure you have:');
  console.log('1. Created a Google Cloud Project');
  console.log('2. Enabled Google Calendar API');
  console.log('3. Created a Service Account');
  console.log('4. Downloaded the service account JSON key');
  console.log('5. Shared your calendar with the service account email\n');
  
  const proceed = await question('Have you completed the above steps? (y/n): ');
  if (proceed.toLowerCase() !== 'y') {
    console.log('\nPlease complete the setup steps first. See docs/google-calendar-setup.md for details.');
    rl.close();
    return;
  }

  // Get service account JSON path
  const jsonPath = await question('\nEnter the path to your service account JSON file: ');
  
  if (!fs.existsSync(jsonPath)) {
    console.log('❌ File not found. Please check the path and try again.');
    rl.close();
    return;
  }

  // Read and validate JSON
  let credentials;
  try {
    const jsonContent = fs.readFileSync(jsonPath, 'utf8');
    credentials = JSON.parse(jsonContent);
    
    if (!credentials.type || credentials.type !== 'service_account') {
      throw new Error('Invalid service account file');
    }
  } catch (error) {
    console.log('❌ Invalid JSON file. Please check the file format.');
    rl.close();
    return;
  }

  // Get calendar ID
  const calendarId = await question('Enter your Google Calendar ID: ');
  
  if (!calendarId.includes('@')) {
    console.log('❌ Invalid calendar ID format. Should be like: your-calendar@group.calendar.google.com');
    rl.close();
    return;
  }

  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Remove existing Google Calendar config if present
  envContent = envContent.replace(/^GOOGLE_CALENDAR_CREDENTIALS=.*$/gm, '');
  envContent = envContent.replace(/^GOOGLE_CALENDAR_ID=.*$/gm, '');
  
  // Add new configuration
  const credentialsString = JSON.stringify(credentials).replace(/"/g, '\\"');
  envContent += `\n\n# Google Calendar Integration\n`;
  envContent += `GOOGLE_CALENDAR_CREDENTIALS="${credentialsString}"\n`;
  envContent += `GOOGLE_CALENDAR_ID=${calendarId}\n`;

  // Write updated .env file
  fs.writeFileSync(envPath, envContent.trim() + '\n');
  
  console.log('\n✅ Google Calendar configuration added to .env file');
  console.log('\n🔄 Please restart your application to apply the changes.');
  console.log('\n📝 Test the integration by trying to book an appointment that conflicts with an existing calendar event.');
  
  rl.close();
}

setupGoogleCalendar().catch(console.error);