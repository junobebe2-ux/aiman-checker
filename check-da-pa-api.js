const https = require('https');
const http = require('http');
const { URL } = require('url');

// Config from .env.prod
const PROXY_LIST = '31.59.20.176:6754:hcwoqjbo:15jf7g5nb1vm,31.56.127.193:7684:hcwoqjbo:15jf7g5nb1vm,45.38.107.97:6014:hcwoqjbo:15jf7g5nb1vm,38.154.203.95:5863:hcwoqjbo:15jf7g5nb1vm,198.105.121.200:6462:hcwoqjbo:15jf7g5nb1vm,64.137.96.74:6641:hcwoqjbo:15jf7g5nb1vm,198.23.243.226:6361:hcwoqjbo:15jf7g5nb1vm,38.154.185.97:6370:hcwoqjbo:15jf7g5nb1vm,142.111.67.146:5611:hcwoqjbo:15jf7g5nb1vm,191.96.254.138:6185:hcwoqjbo:15jf7g5nb1vm';
const YESCAPTCHA_API_KEY = '478eaa708b16d466c687b9c3e1e7669d7b55cc11127237';

// Parse first proxy
const proxyParts = PROXY_LIST.split(',')[0].split(':');
const PROXY_HOST = proxyParts[0];
const PROXY_PORT = proxyParts[1];
const PROXY_USER = proxyParts[2];
const PROXY_PASS = proxyParts[3];

const TARGET_URL = 'https://www.dapachecker.org/api/user/dapa-checker';
const DOMAINS = ['malcomschein.my.id', 'google.com', 'mozilla.org', 'example.com'];

/**
 * Make HTTPS POST request through proxy
 */
function apiRequest(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const proxyAuth = Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64');
    
    const options = {
      hostname: PROXY_HOST,
      port: parseInt(PROXY_PORT),
      path: TARGET_URL,
      method: 'POST',
      headers: {
        'Host': 'www.dapachecker.org',
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Accept': 'application/json',
        'Proxy-Authorization': 'Basic ' + proxyAuth
      },
      rejectUnauthorized: false
    };
    
    console.log(`[Proxy] ${PROXY_HOST}:${PROXY_PORT} user=${PROXY_USER}`);
    
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(responseData)
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: { raw: responseData.substring(0, 500) }
          });
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Check single domain
 */
async function checkDomain(domain) {
  console.log(`\n[Check] ${domain}`);
  try {
    const result = await apiRequest({ urls: [domain] });
    console.log(`[Status] ${result.statusCode}`);
    console.log(`[Response]`, JSON.stringify(result.data, null, 2));
    return { domain, ...result.data };
  } catch (error) {
    console.error(`[Error] ${domain}: ${error.message}`);
    return { domain, error: error.message };
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(60));
  console.log('DA/PA/SS Checker - Using Proxy from .env.prod');
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const domain of DOMAINS) {
    const result = await checkDomain(domain);
    results.push(result);
    
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.table(results.map(r => ({
    domain: r.domain,
    DA: r.data?.[0]?.site_da || '-',
    PA: r.data?.[0]?.site_pa || '-',
    SS: r.data?.[0]?.spam_score || '-',
    error: r.error || r.type || null
  })));
  
  // Save results
  const fs = require('fs');
  fs.writeFileSync(
    '/home/ubuntu/aiman-checker/results-api.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\nSaved to: /home/ubuntu/aiman-checker/results-api.json');
}

main().catch(console.error);