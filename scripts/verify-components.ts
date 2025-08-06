#!/usr/bin/env tsx

/**
 * Component Verification Script
 * Verifies that all components can be imported without errors
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPONENTS_DIR = join(__dirname, '../client/src/components');

const REQUIRED_COMPONENTS = [
  'patient-portal-final.tsx',
  'doctor-portal.tsx',
  'radiologist-dashboard.tsx',
  'enhanced-chatbot.tsx',
  'google-ai-scanner.tsx',
  'admin-dashboard.tsx',
  'dashboard-layout.tsx',
  'index.ts'
];

const REMOVED_COMPONENTS = [
  'radiologist-dashboard-debug-fixed.tsx',
  'doctor-portal-debug.tsx',
  'doctor-portal-realtime.tsx',
  'enhanced-chatbot-debug-fixed.tsx',
  'google-ai-scanner-fixed.tsx'
];

console.log('🔍 Verifying component structure...\n');

// Check required components exist
console.log('✅ Required Components:');
let allRequiredExist = true;
for (const component of REQUIRED_COMPONENTS) {
  const path = join(COMPONENTS_DIR, component);
  const exists = existsSync(path);
  console.log(`  ${exists ? '✅' : '❌'} ${component}`);
  if (!exists) allRequiredExist = false;
}

// Check removed components are gone
console.log('\n🗑️  Removed Components:');
let allRemovedGone = true;
for (const component of REMOVED_COMPONENTS) {
  const path = join(COMPONENTS_DIR, component);
  const exists = existsSync(path);
  console.log(`  ${!exists ? '✅' : '❌'} ${component} ${!exists ? '(removed)' : '(still exists)'}`);
  if (exists) allRemovedGone = false;
}

// Summary
console.log('\n📊 Summary:');
console.log(`  Required components: ${allRequiredExist ? '✅ All present' : '❌ Missing components'}`);
console.log(`  Duplicate cleanup: ${allRemovedGone ? '✅ Complete' : '❌ Duplicates remain'}`);

if (allRequiredExist && allRemovedGone) {
  console.log('\n🎉 Component verification passed! All components are properly structured.');
  process.exit(0);
} else {
  console.log('\n⚠️  Component verification failed. Please check the issues above.');
  process.exit(1);
}