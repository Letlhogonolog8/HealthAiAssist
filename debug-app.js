// HealthAI Assistant Debug Script
const baseUrl = 'https://healthaiassist-production-production.up.railway.app';

async function debugApp() {
  console.log('🔍 HealthAI Assistant Debug Report\n');
  
  // Test health endpoint
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    const healthData = await health.json();
    console.log('✅ Health Check:', healthData);
  } catch (error) {
    console.log('❌ Health Check Failed:', error.message);
  }
  
  // Test login
  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Tlhox', password: 'inw73KYI' })
    });
    const loginData = await login.json();
    console.log('✅ Login Test:', loginData);
  } catch (error) {
    console.log('❌ Login Failed:', error.message);
  }
  
  // Test admin stats
  try {
    const stats = await fetch(`${baseUrl}/api/admin/stats`);
    const statsData = await stats.json();
    console.log('✅ Admin Stats:', statsData);
  } catch (error) {
    console.log('❌ Admin Stats Failed:', error.message);
  }
  
  // Test doctor stats
  try {
    const doctorStats = await fetch(`${baseUrl}/api/doctor/stats`);
    const doctorData = await doctorStats.json();
    console.log('✅ Doctor Stats:', doctorData);
  } catch (error) {
    console.log('❌ Doctor Stats Failed:', error.message);
  }
  
  console.log('\n🎉 Debug Complete!');
}

// Run in browser console or Node.js
if (typeof window !== 'undefined') {
  // Browser
  debugApp();
} else {
  // Node.js
  const fetch = require('node-fetch');
  debugApp();
}