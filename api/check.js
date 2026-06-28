/**
 * AIMAN CHECKER — API Proxy with auth & role-based limits
 * Backend: Scrape DAPA website directly via YesCaptcha
 * (bypass Cloudflare, dapet SS real 0-100)
 */

const BATCH_SIZE = 5;     // DAPA free limit 5 per request
const REQ_DELAY_MS = 3000;
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { checkLimit, getLimits } = require('./limits');
const https = require('https');
const http = require('http');

var JWT_SECRET = (process.env.JWT_SECRET) || 'aiman-checker-jwt-secret-change-in-production-2024';
const USERS_PATH = '/tmp/users.json';
const YESCAPTCHA_KEY = process.env.YESCAPTCHA_KEY || '';
const DAPA_BASE = 'https://www.dapachecker.org';

function loadUsers() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function verifyAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { role: 'guest', user: null };
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    if (user) {
      const today = new Date().toISOString().slice(0, 10);
      if (user.usage.date !== today) {
        user.usage.today = 0;
        user.usage.date = today;
      }
      return { role: user.role, user, limits: getLimits(user.role) };
    }
  } catch (e) {}
  return { role: 'guest', user: null, limits: getLimits('guest') };
}

function saveUserUsage(user) {
  try {
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx].usage = user.usage;
      fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
    }
  } catch (e) {}
}

// ─── YesCaptcha Solver ────────────────────────────────────────────

async function solveCaptcha(sitekey, pageUrl) {
  if (!YESCAPTCHA_KEY) return null;
  
  // Create task
  const taskResp = await fetch('https://api.yescaptcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: YESCAPTCHA_KEY,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteKey: sitekey,
        websiteURL: pageUrl
      }
    })
  });
  const task = await taskResp.json();
  
  if (task.errorId !== 0) {
    console.error('YesCaptcha createTask error:', task.errorDescription);
    return null;
  }
  
  const taskId = task.taskId;
  
  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    
    const getResp = await fetch('https://api.yescaptcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: YESCAPTCHA_KEY,
        taskId: taskId
      })
    });
    const result = await getResp.json();
    
    if (result.errorId !== 0) {
      console.error('YesCaptcha getTask error:', result.errorDescription);
      return null;
    }
    
    if (result.status === 'ready') {
      return result.solution.token;
    }
  }
  
  return null;
}

// ─── DAPA Session Manager ────────────────────────────────────────

function extractCsrfFromCookie(cookieStr) {
  if (!cookieStr) return null;
  const cookies = cookieStr.split(';').map(c => c.trim());
  const xsrf = cookies.find(c => c.startsWith('XSRF-TOKEN='));
  if (!xsrf) return null;
  const tokenVal = xsrf.split('=').slice(1).join('=');
  try {
    return decodeURIComponent(tokenVal);
  } catch {
    return tokenVal;
  }
}

function extractCsrfFromHtml(html) {
  // Try meta tag
  const metaMatch = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  if (metaMatch) return metaMatch[1];
  // Try input hidden
  const inputMatch = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/i);
  if (inputMatch) return inputMatch[1];
  // Try JSON in script tag
  const scriptMatch = html.match(/csrfToken["'\s:=]+["']([^"']+)["']/);
  if (scriptMatch) return scriptMatch[1];
  return null;
}

function extractTurnstileSitekey(html) {
  const match = html.match(/sitekey["']?\s*:\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

async function getDapaSession() {
  // Step 1: GET spam-score-checker page → get cookies + CSRF + turnstile
  const resp = await fetch(DAPA_BASE + '/spam-score-checker', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
    }
  });
  
  const html = await resp.text();
  const cookies = resp.headers.get('set-cookie') || '';
  
  // Parse cookies
  const cookieObj = {};
  cookies.split(',').forEach(c => {
    const parts = c.trim().split(';')[0].split('=');
    if (parts.length >= 2) {
      cookieObj[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  
  // Build cookie string
  const cookieStr = Object.entries(cookieObj)
    .map(([k, v]) => k + '=' + v)
    .join('; ');
  
  // Extract CSRF from cookie first (Laravel uses XSRF-TOKEN cookie)
  let csrfToken = extractCsrfFromCookie(cookies);
  if (!csrfToken) {
    csrfToken = extractCsrfFromHtml(html);
  }
  
  // Check for Turnstile
  const sitekey = extractTurnstileSitekey(html);
  let turnstileToken = null;
  
  if (sitekey) {
    console.log('Turnstile detected, sitekey:', sitekey.substring(0, 20) + '...');
    turnstileToken = await solveCaptcha(sitekey, DAPA_BASE + '/spam-score-checker');
  }
  
  return { cookies: cookieStr, csrfToken, turnstileToken };
}

// ─── DAPA Checker → Langsung hit /check/da ──────────────────────

async function checkSpamDapa(urls, session) {
  if (!session.csrfToken) {
    throw new Error('No CSRF token from DAPA session');
  }
  
  const body = JSON.stringify({
    urls: urls,
    _token: session.csrfToken
  });
  
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-TOKEN': session.csrfToken,
    'Cookie': session.cookies,
    'Origin': DAPA_BASE,
    'Referer': DAPA_BASE + '/spam-score-checker',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  };
  
  if (session.turnstileToken) {
    headers['Cf-Turnstile-Response'] = session.turnstileToken;
  }
  
  const resp = await fetch(DAPA_BASE + '/check/da', {
    method: 'POST',
    headers: headers,
    body: body
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('DAPA ' + resp.status + ': ' + text.substring(0, 200));
  }
  
  const data = await resp.json();
  return data;
}

// ─── Parse DAPA response → AIMAN format ─────────────────────────

function parseDapaResult(dapaData) {
  const results = dapaData.results || dapaData.data || dapaData || [];
  return results.map(r => ({
    domain: r.domain || r.url || '',
    DA: r.DA || r.da || r.mozDA || '0',
    PA: r.PA || r.pa || r.mozPA || '0',
    Spam: String(r.SS || r.spam_score || r.Spam || r.ss || '0'),
    DR: r.DR || r.dr || r.ahrefsDR || '0',
    TF: r.TF || r.tf || r.majesticTF || '0',
    CF: r.CF || r.cf || r.majesticCF || '0',
    MozRank: r.MozRank || r.mozRank || r.MR || '0',
    Backlinks: r.Backlinks || r.backlinks || r.ahrefsBacklinks || 0,
    RefDomains: r.RefDomains || r.refDomains || r.ahrefsRefDomains || 0,
    Traffic: r.Traffic || r.traffic || r.ahrefsTraffic || 0,
    Keywords: r.Keywords || r.keywords || r.ahrefsOrganicKeywords || 0
  }));
}

// ─── Main Handler ────────────────────────────────────────────────

// Cache session per 10 menit
let cachedSession = null;
let sessionCacheTime = 0;
const SESSION_TTL = 10 * 60 * 1000; // 10 menit

async function getOrRefreshSession() {
  const now = Date.now();
  if (cachedSession && (now - sessionCacheTime) < SESSION_TTL) {
    return cachedSession;
  }
  cachedSession = await getDapaSession();
  sessionCacheTime = now;
  console.log('DAPA session refreshed at', new Date().toISOString());
  return cachedSession;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Send { urls: [...] }' });
  }

  urls = urls.map(u => {
    u = (u || '').trim();
    if (u && !u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
    return u;
  }).filter(Boolean);

  if (urls.length === 0) return res.status(400).json({ error: 'No valid URLs' });

  const authResult = verifyAuth(req.headers.authorization);
  const role = authResult.role;
  const user = authResult.user;
  const limits = authResult.limits || getLimits(role);

  const limitCheck = checkLimit(role, urls.length);
  if (!limitCheck.allowed) {
    return res.status(403).json({
      error: 'plan_limit_exceeded',
      message: limitCheck.message,
      plan: role,
      plan_label: limits.label,
      plan_limit: limitCheck.limit,
      your_count: limitCheck.yourCount,
      upgrade_url: '/pricing.html'
    });
  }

  if (user) {
    user.usage.today += urls.length;
    user.usage.total = (user.usage.total || 0) + urls.length;
    saveUserUsage(user);
  }

  const allResults = [];
  const errors = [];
  const total = urls.length;
  let session;

  try {
    session = await getOrRefreshSession();
  } catch (err) {
    // Fallback ke formula mozSpam kalo session gagal
    console.error('DAPA session failed, fallback to mozSpam:', err.message);
    return await fallbackHandler(req, res);
  }

  // SKIP DAPA - use fallback Moz API for now
  console.log('⚠️  Skipping DAPA (blocked by login), using Moz API fallback');
  return await fallbackHandler(req, res);

  // Batch process (DAPA free: 5/req)
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = urls.slice(i, i + BATCH_SIZE);

    try {
      const dapaResp = await checkSpamDapa(
        batch.map(u => {
          const parsed = new URL(u);
          return parsed.hostname || u;
        }),
        session
      );
      const parsed = parseDapaResult(dapaResp);
      allResults.push(...parsed);

      if (i + BATCH_SIZE < total) {
        await new Promise(r => setTimeout(r, REQ_DELAY_MS));
      }
    } catch (err) {
      errors.push('Batch ' + batchNum + ': ' + err.message);
      // Refresh session on error (mungkin CSRF expired)
      try {
        session = await getDapaSession();
        sessionCacheTime = Date.now();
        cachedSession = session;
        // Retry batch
        const dapaResp = await checkSpamDapa(
          batch.map(u => new URL(u).hostname || u),
          session
        );
        const parsed = parseDapaResult(dapaResp);
        allResults.push(...parsed);
      } catch (retryErr) {
        errors.push('Batch ' + batchNum + ' retry: ' + retryErr.message);
      }
    }
  }

  res.json({
    success: true,
    total,
    checked: allResults.length,
    results: allResults,
    errors: errors.length > 0 ? errors : undefined,
    partial: errors.length > 0,
    plan: role,
    plan_label: limits.label,
    plan_limit: limits.maxUrls,
    remaining: user ? (limits.maxUrls - user.usage.today) : (limits.maxUrls - urls.length)
  });
}

// Fallback: mozSpam formula kalo DAPA direct gagal
async function fallbackHandler(req, res) {
  const API_URL = 'https://app.dapachecker.tools/get-domain-metrics';
  const BATCH_SIZE = 50;
  const REQ_DELAY_MS = 3000;

  const authResult = verifyAuth(req.headers.authorization);
  const role = authResult.role;
  const user = authResult.user;
  const limits = authResult.limits || getLimits(role);

  let { urls } = req.body;
  urls = urls || [];
  
  const total = urls.length;
  const allResults = [];
  const errors = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = urls.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://dapa-checker.com',
          'Referer': 'https://dapa-checker.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; AIMANChecker/1.0)'
        },
        body: JSON.stringify({ urls: batch })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error('API ' + response.status + ': ' + text);
      }

      const data = await response.json();
      allResults.push(...data);

      if (i + BATCH_SIZE < total) {
        await new Promise(r => setTimeout(r, REQ_DELAY_MS));
      }
    } catch (err) {
      errors.push('Batch ' + batchNum + ': ' + err.message);
      break;
    }
  }

  const metrics = allResults.map(r => {
    const raw = parseFloat(String(r.mozSpam || '0').replace('%', '').trim()) || 0;
    let pct;
    if (raw <= 17) {
      pct = Math.round((raw / 18.75) * 100);
    } else {
      pct = Math.round(raw);
    }
    if (pct > 100) pct = 100;
    if (pct < 0) pct = 0;
    return {
      domain: r.domain || '',
      DA: r.mozDA || '0',
      PA: r.mozPA || '0',
      Spam: String(pct),
      DR: r.ahrefsDR || '0',
      TF: r.majesticTF || '0',
      CF: r.majesticCF || '0',
      MozRank: r.mozRank || '0',
      Backlinks: r.ahrefsBacklinks || 0,
      RefDomains: r.ahrefsRefDomains || 0,
      Traffic: r.ahrefsTraffic || 0,
      Keywords: r.ahrefsOrganicKeywords || 0
    };
  });

  res.json({
    success: true,
    total,
    checked: metrics.length,
    results: metrics,
    errors: errors.length > 0 ? errors : undefined,
    partial: errors.length > 0,
    fallback: true,
    plan: role,
    plan_label: limits.label,
    plan_limit: limits.maxUrls,
    remaining: user ? (limits.maxUrls - user.usage.today) : (limits.maxUrls - urls.length)
  });
}