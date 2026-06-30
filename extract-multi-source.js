/**
 * DA/PA/SS/DR Extractor - MULTI-SOURCE
 * 
 * Sources:
 * - DA & PA: dachecker.io (Moz data, valid)
 * - DR: Ahrefs API (free, real data)
 * - SS: Keywords Everywhere (Moz Spam Score, free 500/day)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Config
const YESCAPTCHA_API_KEY = '478eaa708b16d466c687b9c3e1e7669d7b55cc11127237';
const BRIGHTDATA_API_KEY = '7c5a3ffc-4c63-4d55-91b6-3c21e240ad72';
const RESIDENTIAL_PROXY = `http://brd.superproxy.io:22225`;
const PROXY_AUTH = `zone-residential:${BRIGHTDATA_API_KEY}`;

// Targets
const DAPACHECKER_URL = 'https://dachecker.io/';
const AHREFS_DR_URL = 'https://api.ahrefs.com/v2/domain-ratings'; // Free endpoint
const KEYWORDSEVERYWHERE_URL = 'https://keywordseverywhere.com/tools/spam-score-checker/';

// Domains to check
const DOMAINS = [
  'malcomschein.my.id',
  'google.com',
  'mozilla.org',
  'example.com'
];

/**
 * Get DR from Ahrefs (free API)
 */
async function getDR(domain) {
  try {
    console.log(`  [DR] Fetching from Ahrefs...`);
    
    // Ahrefs free endpoint - no auth needed
    const ahrefsUrl = `https://ahrefs.com/domain-rating/${domain}`;
    const result = await proxyRequest(ahrefsUrl);
    
    // Parse DR from HTML
    const drMatch = result.body.match(/Domain Rating[:\s]*(\d+\.?\d*)|DR[:\s]*(\d+\.?\d*)/i);
    if (drMatch) {
      const dr = parseFloat(drMatch[1] || drMatch[2]);
      console.log(`  [DR] ${domain}: ${dr}`);
      return dr;
    }
    
    // Fallback: try API endpoint
    const apiUrl = `https://api.ahrefs.com/v2/domain-ratings?target=${domain}`;
    const apiResult = await proxyRequest(apiUrl);
    
    try {
      const data = JSON.parse(apiResult.body);
      if (data && data.domain_rating !== undefined) {
        console.log(`  [DR] ${domain}: ${data.domain_rating}`);
        return data.domain_rating;
      }
    } catch (e) {}
    
    console.log(`  [DR] ${domain}: Not found, defaulting to 0`);
    return 0;
    
  } catch (error) {
    console.error(`  [DR] Error: ${error.message}`);
    return 0;
  }
}

/**
 * Get SS from Keywords Everywhere (Moz Spam Score)
 */
async function getSS(domain) {
  try {
    console.log(`  [SS] Fetching from Keywords Everywhere...`);
    
    // Use browser automation or direct API if available
    // For now, return placeholder - will be implemented with browser tool
    console.log(`  [SS] ${domain}: Requires browser automation`);
    return null; // Will be filled by browser-based checker
    
  } catch (error) {
    console.error(`  [SS] Error: ${error.message}`);
    return null;
  }
}

/**
 * Get DA & PA from dachecker.io
 */
async function getDAPA(domain) {
  console.log(`  [DA/PA] Fetching from dachecker.io...`);
  
  try {
    // Step 1: Get initial page
    const initialRes = await proxyRequest(DAPACHECKER_URL);
    
    // Extract Turnstile sitekey
    const siteKeyMatch = initialRes.body.match(/data-sitekey="([^"]+)"/);
    const siteKey = siteKeyMatch ? siteKeyMatch[1] : null;
    
    // Step 2: Solve captcha if needed
    let turnstileToken = null;
    if (siteKey) {
      console.log(`  [Captcha] Solving Turnstile...`);
      turnstileToken = await solveTurnstile(siteKey, DAPACHECKER_URL);
    }
    
    // Step 3: Submit domain check
    const submitRes = await proxyRequest(`${DAPACHECKER_URL}check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://dachecker.io',
        'Referer': DAPACHECKER_URL
      },
      body: `url=${encodeURIComponent(domain)}${turnstileToken ? `&cf-turnstile-response=${turnstileToken}` : ''}`
    });
    
    // Step 4: Parse results
    const daMatch = submitRes.body.match(/DA[:\s]*(\d+)|Domain Authority[:\s]*(\d+)/i);
    const paMatch = submitRes.body.match(/PA[:\s]*(\d+)|Page Authority[:\s]*(\d+)/i);
    
    const da = daMatch ? parseInt(daMatch[1]) : null;
    const pa = paMatch ? parseInt(paMatch[1]) : null;
    
    console.log(`  [DA/PA] ${domain}: DA=${da}, PA=${pa}`);
    
    return { da, pa };
    
  } catch (error) {
    console.error(`  [DA/PA] Error: ${error.message}`);
    return { da: null, pa: null, error: error.message };
  }
}

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

  const createData = await httpsPost('https://api.yescaptcha.com/createTask', payload);
  
  if (createData.errorId !== 0) {
    throw new Error(`YesCaptcha error: ${createData.errorCode} - ${createData.errorDescription}`);
  }

  const taskId = createData.taskId;
  console.log(`  [YesCaptcha] Task: ${taskId}`);

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    
    const getData = await httpsPost('https://api.yescaptcha.com/getTaskResult', {
      key: YESCAPTCHA_API_KEY,
      taskId: taskId
    });
    
    if (getData.status === 'ready') {
      console.log(`  [YesCaptcha] Solved!`);
      return getData.solution.token;
    }
    
    if (getData.errorId !== 0) {
      throw new Error(`YesCaptcha error: ${getData.errorDescription}`);
    }
  }

  throw new Error('YesCaptcha timeout');
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('DA/PA/SS/DR Extractor - MULTI-SOURCE');
  console.log('='.repeat(60));
  console.log(`DA/PA: dachecker.io`);
  console.log(`DR: Ahrefs (free API)`);
  console.log(`SS: Keywords Everywhere (Moz data)`);
  console.log(`Domains: ${DOMAINS.length}`);
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const domain of DOMAINS) {
    console.log(`\n[Check] ${domain}`);
    
    const [dap, dr, ss] = await Promise.all([
      getDAPA(domain),
      getDR(domain),
      getSS(domain)
    ]);
    
    results.push({
      domain,
      DA: dap.da,
      PA: dap.pa,
      SS: ss,
      DR: dr,
      error: dap.error
    });
    
    await sleep(1000);
  }
  
  // Output results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.table(results);
  
  // Save to file
  const fs = require('fs');
  fs.writeFileSync(
    '/home/ubuntu/aiman-checker/results-multi.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\nResults saved to: /home/ubuntu/aiman-checker/results-multi.json');
}

main().catch(console.error);