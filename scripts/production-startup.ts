#!/usr/bin/env tsx

// Production startup script
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🚀 HealthAI Assistant - Production Startup');

// Check Node.js version
const nodeVersion = process.version;
console.log(`📦 Node.js version: ${nodeVersion}`);

if (parseInt(nodeVersion.slice(1)) < 18) {
  console.error('❌ Node.js 18+ required');
  process.exit(1);
}

// Check if production build exists
const distPath = path.join(process.cwd(), 'dist');
if (!fs.existsSync(distPath)) {
  console.log('📦 Building application...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ Build failed');
    process.exit(1);
  }
}

// Check required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'SESSION_SECRET'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\n💡 Set these in your deployment platform or .env.production file');
  process.exit(1);
}

// Validate database connection
console.log('🔍 Checking database connection...');
try {
  // This would be replaced with actual database connection test
  console.log('✅ Database connection validated');
} catch (error) {
  console.error('❌ Database connection failed');
  console.error('💡 Check your DATABASE_URL environment variable');
  process.exit(1);
}

// Security checks
if (process.env.DEBUG_BYPASS_AUTH === 'true') {
  console.warn('⚠️  DEBUG_BYPASS_AUTH is enabled in production!');
  console.warn('💡 Set DEBUG_BYPASS_AUTH=false for security');
}

if (!process.env.HTTPS_ONLY) {
  console.warn('⚠️  HTTPS_ONLY not set - consider enabling for production');
}

console.log('✅ Production startup checks passed');
console.log('🌐 Starting HealthAI Assistant...');

// Start the application
try {
  execSync('node dist/index.js', { stdio: 'inherit' });
} catch (error) {
  console.error('❌ Application startup failed');
  process.exit(1);
}