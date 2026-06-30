#!/usr/bin/env node
/**
 * GUESTPOSTLINKS DA/PA/SS EXTRACTOR
 * 
 * Real data from Moz official API via tools.guestpostlinks.net
 * Solves Cloudflare Turnstile via YesCaptcha
 * 
 * Endpoint: WP admin-ajax.php action=dapa_checker_function
 * + DR from Ahrefs free API
 */

const https = require('https');
const { URLSearchParams } = require('url');

// Config
const YESCAPTCHA_KEY = process.env.YESCAPTCHA_KEY || '478eaa708b16d466c687b9c3e1e7669d7b55cc11127237';
const SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu';
const PAGE_URL = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/';
const AJAX_URL = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php';

const REFERENCE = { DA: 62, PA: 35, SS: 32, DR: 0 };

/**
 * HTTP request helper
 */
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false
    };
    
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Solve Cloudflare Turnstile via YesCaptcha
 */
async function solveTurnstile() {
  console.log('[Captcha] Creating Turnstile task...');
  
  // Create task
  const createPayload = JSON.stringify({
    clientKey: YESCAPTCHA_KEY,
    task: {
      type: 'TurnstileTaskProxyless',
      websiteURL: PAGE_URL,
      websiteKey: SITE_KEY
    }
  });
  
  const createRes = await request('https://api.yescaptcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, createPayload);
  
  const createData = JSON.parse(createRes.body);
  if (createData.errorId !== 0) {
    throw new Error(`YesCaptcha create error: ${createData.errorDescription || JSON.stringify(createData)}`);
  }
  
  const taskId = createData.taskId;
  console.log(`[Captcha] Task created: ${taskId}, polling...`);
  
  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    
    const resultPayload = JSON.stringify({ clientKey: YESCAPTCHA_KEY, taskId });
    const resultRes = await request('https://api.yescaptcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, resultPayload);
    
    const resultData = JSON.parse(resultRes.body);
    
    if (resultData.status === 'ready') {
      const token = resultData.solution.token || resultData.solution.gRecaptchaResponse;
      console.log(`[Captcha] Solved! Token: ${token.substring(0, 30)}...`);
      return token;
    }
    
    if (resultData.errorId !== 0) {
      throw new Error(`YesCaptcha result error: ${resultData.errorDescription}`);
    }
    
    process.stdout.write('.');
  }
  
  throw new Error('Turnstile solve timeout');
}

/**
 * Get fresh cookies from the page
 */
async function getCookies() {
  const res = await request(PAGE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  const cookies = (res.headers['set-cookie'] || [])
    .map(c => c.split(';')[0])
    .join('; ');
  
  return cookies;
}

/**
 * Query Guestpostlinks for DA/PA/SS
 */
async function getGuestpostMetrics(urls, turnstileToken, cookies) {
  console.log('[GPL] Querying DA/PA/SS...');
  
  // Build payload - WordPress admin-ajax expects nested data[]
  const payload = new URLSearchParams();
  payload.append('action', 'dapa_checker_function');
  payload.append('data[urls]', urls.join('\n'));
  payload.append('data[same_url]', '0');
  payload.append('data[same_domain]', '0');
  payload.append('data[batch_mode]', 'batch');
  payload.append('data[batch_index]', '0');
  payload.append('data[batch_total]', '1');
  payload.append('data[all_urls_raw]', urls.join('\n'));
  payload.append('data[ref_id]', '');
  payload.append('data[batch_session_token]', '');
  payload.append('data[cf-turnstile-response]', turnstileToken);
  
  const body = payload.toString();
  
  const res = await request(AJAX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://tools.guestpostlinks.net',
      'Referer': PAGE_URL,
      'Cookie': cookies,
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  
  console.log(`[GPL] Response status: ${res.status}`);
  
  // Parse JSON response
  const json = JSON.parse(res.body);
  const results = {};
  
  if (json.success && json.data) {
    for (const item of json.data) {
      if (item.api_result) {
        for (const [url, info] of Object.entries(item.api_result)) {
          const m = info.metrics || {};
          results[url] = {
            DA: m.domain_authority ?? null,
            PA: m.page_authority ?? null,
            SS: m.spam_score ?? null,
            title: m.title || '',
            last_crawled: m.last_crawled || ''
          };
        }
      }
    }
  }
  
  return { results, credits: json.user_remaining_credit, raw: res.body };
}

/**
 * Get DR from Ahrefs
 */
function getDR(domain) {
  return new Promise((resolve) => {
    https.get(
      `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}`,
      { rejectUnauthorized: false },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.domain_rating?.domain_rating || 0);
          } catch (e) { resolve(0); }
        });
      }
    ).on('error', () => resolve(0));
  });
}

/**
 * Main
 */
async function main() {
  const domains = process.argv.slice(2);
  if (domains.length === 0) {
    domains.push('malcomschein.my.id');
  }
  
  console.log('='.repeat(70));
  console.log('GUESTPOSTLINKS DA/PA/SS EXTRACTOR (Moz official data)');
  console.log('='.repeat(70));
  console.log(`Domains: ${domains.join(', ')}`);
  console.log('');
  
  try {
    // Step 1: Get cookies
    console.log('[1/4] Getting session cookies...');
    const cookies = await getCookies();
    console.log(`      Cookies: ${cookies ? cookies.substring(0, 50) + '...' : 'none'}`);
    
    // Step 2: Solve Turnstile
    console.log('\n[2/4] Solving Cloudflare Turnstile...');
    const token = await solveTurnstile();
    
    // Step 3: Query metrics
    console.log('\n[3/4] Fetching DA/PA/SS from Guestpostlinks...');
    const { results, credits } = await getGuestpostMetrics(domains, token, cookies);
    console.log(`      Credits remaining: ${credits}`);
    
    // Step 4: Get DR + combine
    console.log('\n[4/4] Fetching DR from Ahrefs + combining...');
    const finalResults = [];
    for (const domain of domains) {
      const dr = await getDR(domain);
      const gpl = results[domain] || { DA: null, PA: null, SS: null };
      finalResults.push({
        domain,
        DA: gpl.DA,
        PA: gpl.PA,
        SS: gpl.SS,
        DR: dr
      });
    }
    
    // Output
    console.log('\n' + '='.repeat(70));
    console.log('FINAL RESULTS (REAL Moz + Ahrefs data)');
    console.log('='.repeat(70));
    console.table(finalResults);
    
    // Validate reference
    const ref = finalResults.find(r => r.domain === 'malcomschein.my.id');
    if (ref) {
      console.log('\n' + '='.repeat(70));
      console.log('VALIDATION (malcomschein.my.id)');
      console.log('='.repeat(70));
      console.log(`Expected: DA:62, PA:35, SS:32, DR:0`);
      console.log(`Got:      DA:${ref.DA}, PA:${ref.PA}, SS:${ref.SS}, DR:${ref.DR}`);
      const allMatch = ref.DA === 62 && ref.PA === 35 && ref.SS === 32 && Math.round(ref.DR) === 0;
      console.log(`Status:   ${allMatch ? '✅ ALL MATCH — REAL DATA CONFIRMED!' : '⚠️ Mismatch'}`);
    }
    
    // Save
    const fs = require('fs');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(`/home/ubuntu/aiman-checker/results-${ts}.json`, JSON.stringify(finalResults, null, 2));
    fs.writeFileSync('/home/ubuntu/aiman-checker/results-latest.json', JSON.stringify(finalResults, null, 2));
    console.log(`\n💾 Saved to results-latest.json`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();