const https = require('https');
const { URL } = require('url');

const API_KEY = '7c5a3ffc-4c63-4d55-91b6-3c21e240ad72';
const PROXY = 'http://brd.superproxy.io:22225';

// Try different auth formats
const auths = [
  `zone-residential:${API_KEY}`,
  `zone:${API_KEY}`,
  `${API_KEY}:`,
  `zone-residential:${API_KEY}`,
];

async function testAuth(authStr) {
  return new Promise((resolve) => {
    const proxyUrl = new URL(PROXY);
    
    const options = {
      hostname: proxyUrl.hostname,
      port: proxyUrl.port,
      path: 'https://api.ipify.org?format=json',
      method: 'GET',
      headers: {
        'Host': 'api.ipify.org',
        'Proxy-Authorization': 'Basic ' + Buffer.from(authStr).toString('base64'),
      },
      rejectUnauthorized: false
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data: data.substring(0, 100) });
      });
    });
    
    req.on('error', (e) => {
      resolve({ status: 0, error: e.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });
    
    req.end();
  });
}

async function main() {
  console.log('Testing BrightData auth formats...\n');
  
  for (const auth of auths) {
    console.log(`Trying: ${auth.substring(0, 25)}...`);
    const result = await testAuth(auth);
    console.log(`  Status: ${result.status}`);
    console.log(`  Response: ${result.data || result.error}\n`);
    
    if (result.status === 200) {
      console.log('SUCCESS! Using:', auth);
      break;
    }
  }
}

main();