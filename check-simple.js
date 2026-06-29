const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Config from .env.prod
const PROXY_LIST = '31.59.20.176:6754:hcwoqjbo:15jf7g5nb1vm';
const proxyParts = PROXY_LIST.split(':')[0] + ':' + PROXY_LIST.split(':')[1];
const proxyUser = PROXY_LIST.split(':')[2];
const proxyPass = PROXY_LIST.split(':')[3];

const TARGET_URL = 'https://www.dapachecker.org/api/user/dapa-checker';
const DOMAINS = ['malcomschein.my.id'];

// Create proxy agent
const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyParts}`;
console.log('Proxy URL:', proxyUrl.replace(/:[^:]*@/, ':***@'));

const agent = new HttpsProxyAgent(proxyUrl);

async function checkDomain(domain) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ urls: [domain] });
    
    const options = {
      hostname: 'www.dapachecker.org',
      port: 443,
      path: '/api/user/dapa-checker',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Accept': 'application/json'
      },
      agent: agent,
      rejectUnauthorized: false
    };
    
    console.log(`\n[Check] ${domain}`);
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log('[Response]', JSON.stringify(parsed, null, 2));
          resolve({ domain, ...parsed });
        } catch (e) {
          console.log('[Raw Response]', data.substring(0, 300));
          resolve({ domain, raw: data });
        }
      });
    });
    
    req.on('error', (e) => {
      console.error('[Error]', e.message);
      resolve({ domain, error: e.message });
    });
    
    req.write(body);
    req.end();
  });
}

checkDomain(DOMAINS[0]).then(r => {
  console.log('\nResult:', JSON.stringify(r, null, 2));
  const fs = require('fs');
  fs.writeFileSync('/home/ubuntu/aiman-checker/results-test.json', JSON.stringify(r, null, 2));
}).catch(console.error);