/**
 * DA/PA/SS/DR Extractor using YesCaptcha + Residential Proxy
 * Target: dapachecker.org (Cloudflare Turnstile protected)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Config
const YESCAPTCHA_API_KEY = '478eaa708b16d466c687b9c3e1e7669d7b55cc11127237';
// BrightData Residential Proxy
const BRIGHTDATA_API_KEY = '7c5a3ffc-4c63-4d55-91b6-3c21e240ad72';
const RESIDENTIAL_PROXY = `http://brd.superproxy.io:22225`;
const PROXY_AUTH = `zone-residential:${BRIGHTDATA_API_KEY}`;
const TARGET_URL = 'https://dapachecker.org/';

// Domains to check
const DOMAINS = [
  'malcomschein.my.id',
  'google.com',
  'mozilla.org',
  'example.com'
];

/**
 * Make HTTP request through residential proxy
 */
function proxyRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    
    const proxyUrl = new URL(RESIDENTIAL_PROXY);
    
    const reqOptions = {
      hostname: proxyUrl.hostname,
      port: proxyUrl.port,
      path: urlObj.href,
      method: options.method || 'GET',
      headers: {
        'Host': urlObj.host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Proxy-Authorization': 'Basic ' + Buffer.from(PROXY_AUTH).toString('base64'),
        ...options.headers
      },
      rejectUnauthorized: false
    };

    const lib = isHttps ? https : http;
    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

/**
 * Solve Cloudflare Turnstile using YesCaptcha
 */
async function solveTurnstile(siteKey, pageUrl) {
  const payload = {
    key: YESCAPTCHA_API_KEY,
    action: 'create',
    task: {
      type: 'TurnstileTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey
    }
  };

  // Create task using https
  const createData = await httpsPost('https://api.yescaptcha.com/createTask', payload);
  
  if (createData.errorId !== 0) {
    throw new Error(`YesCaptcha error: ${createData.errorCode} - ${createData.errorDescription}`);
  }

  const taskId = createData.taskId;
  console.log(`[YesCaptcha] Task created: ${taskId}`);

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    
    const getData = await httpsPost('https://api.yescaptcha.com/getTaskResult', {
      key: YESCAPTCHA_API_KEY,
      taskId: taskId
    });
    
    if (getData.status === 'ready') {
      console.log(`[YesCaptcha] Captcha solved!`);
      return getData.solution.token;
    }
    
    if (getData.errorId !== 0) {
      throw new Error(`YesCaptcha poll error: ${getData.errorDescription}`);
    }
  }

  throw new Error('YesCaptcha timeout - captcha not solved within 60s');
}

/**
 * HTTPS POST helper
 */
function httpsPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(data);
    
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length
      },
      rejectUnauthorized: false
    };
    
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${responseData}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Extract DA, PA, SS from dapachecker.org
 */
async function extractMetrics(domain) {
  console.log(`\n[Check] ${domain}`);
  
  try {
    // Step 1: Get initial page to find Turnstile sitekey
    const initialRes = await proxyRequest(TARGET_URL);
    
    // Extract Turnstile sitekey from HTML
    const siteKeyMatch = initialRes.body.match(/data-sitekey="([^"]+)"/);
    if (!siteKeyMatch) {
      console.log(`[Warn] No Turnstile found, trying direct submission`);
    }
    
    const siteKey = siteKeyMatch ? siteKeyMatch[1] : null;
    console.log(`[Turnstile] Sitekey: ${siteKey || 'not found'}`);
    
    // Step 2: Solve captcha if needed
    let turnstileToken = null;
    if (siteKey) {
      turnstileToken = await solveTurnstile(siteKey, TARGET_URL);
    }
    
    // Step 3: Submit domain check
    const submitRes = await proxyRequest(`${TARGET_URL}check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://dapachecker.org',
        'Referer': TARGET_URL
      },
      body: `url=${encodeURIComponent(domain)}${turnstileToken ? `&cf-turnstile-response=${turnstileToken}` : ''}`
    });
    
    // Step 4: Parse results
    const results = parseResults(submitRes.body, domain);
    
    return results;
    
  } catch (error) {
    console.error(`[Error] ${domain}: ${error.message}`);
    return { domain, error: error.message };
  }
}

/**
 * Parse DA, PA, SS, DR from HTML response
 */
function parseResults(html, domain) {
  const results = { domain };
  
  // Try various patterns
  const patterns = {
    da: /DA[:\s]*(\d+)|Domain Authority[:\s]*(\d+)|"da"[:\s]*(\d+)/i,
    pa: /PA[:\s]*(\d+)|Page Authority[:\s]*(\d+)|"pa"[:\s]*(\d+)/i,
    ss: /SS[:\s]*(\d+)|Spam Score[:\s]*(\d+)|"ss"[:\s]*(\d+)/i,
    dr: /DR[:\s]*(\d+)|Domain Rating[:\s]*(\d+)|"dr"[:\s]*(\d+)/i
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = html.match(pattern);
    if (match) {
      results[key.toUpperCase()] = parseInt(match[1] || match[2] || match[3]);
    }
  }
  
  // Also try JSON data in page
  const jsonMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data.domainAuthority) results.DA = data.domainAuthority;
      if (data.pageAuthority) results.PA = data.pageAuthority;
      if (data.spamScore) results.SS = data.spamScore;
    } catch (e) {}
  }
  
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('DA/PA/SS/DR Extractor - YesCaptcha + Residential Proxy');
  console.log('='.repeat(60));
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Proxy: ${RESIDENTIAL_PROXY}`);
  console.log(`Domains: ${DOMAINS.length}`);
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const domain of DOMAINS) {
    const result = await extractMetrics(domain);
    results.push(result);
    await sleep(1000); // Rate limiting
  }
  
  // Output results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.table(results);
  
  // Save to file
  const fs = require('fs');
  fs.writeFileSync(
    '/home/ubuntu/aiman-checker/results.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\nResults saved to: /home/ubuntu/aiman-checker/results.json');
}

main().catch(console.error);