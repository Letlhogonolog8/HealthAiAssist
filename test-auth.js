// Simple test script to verify authentication
const fetch = require('node-fetch');

async function testAuth() {
  const baseUrl = 'http://localhost:5000';
  
  try {
    console.log('Testing authentication flow...');
    
    // Test 1: Check session endpoint
    console.log('\n1. Testing session endpoint...');
    const sessionResponse = await fetch(`${baseUrl}/api/debug/session`);
    const sessionData = await sessionResponse.json();
    console.log('Session data:', sessionData);
    
    // Test 2: Try to access protected endpoint without auth
    console.log('\n2. Testing protected endpoint without auth...');
    const protectedResponse = await fetch(`${baseUrl}/api/auth/me`);
    console.log('Protected endpoint status:', protectedResponse.status);
    
    // Test 3: Test login
    console.log('\n3. Testing login...');
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'patient', password: 'patient123' })
    });
    console.log('Login status:', loginResponse.status);
    const loginData = await loginResponse.json();
    console.log('Login response:', loginData);
    
    // Test 4: Test auth/me after login
    console.log('\n4. Testing auth/me after login...');
    const authMeResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': loginResponse.headers.get('set-cookie') || ''
      }
    });
    console.log('Auth me status:', authMeResponse.status);
    const authMeData = await authMeResponse.json();
    console.log('Auth me response:', authMeData);
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

testAuth();