import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Generate a secure session secret
const sessionSecret = crypto.randomBytes(64).toString('hex');

console.log('Generated SESSION_SECRET:', sessionSecret);

// Check if .env file exists
const envPath = '.env';
const envExists = fs.existsSync(envPath);

if (envExists) {
  console.log('\n✅ .env file already exists');
  console.log('Please add this line to your .env file:');
  console.log(`SESSION_SECRET=${sessionSecret}`);
} else {
  // Create basic .env file
  const envContent = `# Development Environment Variables
NODE_ENV=development
PORT=5000
SESSION_SECRET=${sessionSecret}
SECURE_COOKIES=false

# Database (add your actual database URL)
# DATABASE_URL=postgresql://username:password@localhost:5432/healthai

# Optional API Keys (add as needed)
# OPENAI_API_KEY=your_openai_key_here
# TWILIO_ACCOUNT_SID=your_twilio_sid
# TWILIO_AUTH_TOKEN=your_twilio_token
`;

  fs.writeFileSync(envPath, envContent);
  console.log('\n✅ Created .env file with SESSION_SECRET');
}

console.log('\nYou can now run: npm run dev');
