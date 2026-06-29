const https = require('https');
const { URL } = require('url');

const BRIGHTDATA_API_KEY = '7c5a3ffc-4c63-4d55-91b6-3c21e240ad72';
const PROXY_AUTH = `zone-residential:${BRIGHTDATA_API_KEY}`;
const PROXY = 'http://brd.superproxy.io:22225';

function testProxy() {
  return new Promise((resolve, reject) => {
    const proxyUrl = new URL(PROXY);
    
    const options = {
      hostname: proxyUrl.hostname,
      port: proxyUrl.port,
      path: 'https://api.ipify.org?format=json',
      method: 'GET',
      headers: {
        'Host': 'api.ipify.org',
        'Proxy-Authorization': 'Basic ' + Buffer.from(PROXY_AUTH).toString('base64'),
      },
      rejectUnauthorized: false
    };
    
    console.log('Testing BrightData proxy...');
    console.log('Proxy:', PROXY);
    console.log('Auth:', PROXY_AUTH.substring(0, 20) + '...');
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Response:', data);
        resolve(data);
      });
    });
    
    req.on('error', (e) => {
      console.error('Proxy error:', e.message);
      reject(e);
    });
    
    req.end();
  });
}

testProxy().catch(console.error);