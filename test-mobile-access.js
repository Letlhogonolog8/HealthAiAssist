// Test mobile access connectivity
const http = require('http');

const testUrls = [
  'http://localhost:5000/api/health',
  'http://192.168.0.160:5000/api/health'
];

console.log('🔍 Testing mobile access connectivity...\n');

testUrls.forEach((url, index) => {
  const urlObj = new URL(url);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port,
    path: urlObj.pathname,
    method: 'GET',
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log(`✅ ${url} - Status: ${res.statusCode}`);
      if (res.statusCode === 200) {
        try {
          const response = JSON.parse(data);
          console.log(`   Response: ${JSON.stringify(response)}`);
        } catch (e) {
          console.log(`   Response: ${data.substring(0, 100)}...`);
        }
      }
      console.log('');
    });
  });

  req.on('error', (err) => {
    console.log(`❌ ${url} - Error: ${err.message}\n`);
  });

  req.on('timeout', () => {
    console.log(`⏰ ${url} - Timeout\n`);
    req.destroy();
  });

  req.end();
});

console.log('📱 Mobile Access Instructions:');
console.log('1. Make sure your mobile device is connected to the same Wi-Fi network');
console.log('2. Open your mobile browser and go to: http://192.168.0.160:5000');
console.log('3. If it doesn\'t work, check Windows Firewall settings');
console.log('4. You may need to allow Node.js through Windows Firewall\n');