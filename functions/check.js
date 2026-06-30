// Cloudflare Pages Function: POST /check  (BATCH mode — return after complete)
// Source: prepostseo.com (Moz-backed DA/PA/SS). No batch cap like GPL.
// Flow: fetch page -> 2Captcha Turnstile -> emd/captcha-verify -> dapa/check

import { getSessionUser } from './_auth.js';

const SITE_KEY = '0x4AAAAAAAX_O8VfAMao1UUl';
const PAGE_URL = 'https://www.prepostseo.com/domain-authority-checker';
const BASE_URL = 'https://www.prepostseo.com/';
const VERIFY_PATH = 'emd/captcha-verify/';
const CHECK_PATH = 'dapa/check';
const HASH = '2YCFz6VHAbg3tm4JhNIQCNwg7QDLgHQORRNsi4Gqy';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHUNK = 50;
const MAX_POLLS = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const DAILY_LIMIT_PUBLIC = 3;
const PUBLIC_MAX_DOMAINS = 10;
const LOGGED_MAX_DOMAINS = 100;
const ipUsage = new Map();

const norm = (s) => String(s).toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .replace(/\/+$/, '')
  .trim();

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function bumpIp(ip) {
  if (!ip) return { count: 0, allowed: true };
  const day = todayUTC();
  const cur = ipUsage.get(ip);
  if (!cur || cur.day !== day) {
    ipUsage.set(ip, { day, count: 1 });
    return { count: 1, allowed: true };
  }
  if (cur.count >= DAILY_LIMIT_PUBLIC) {
    return { count: cur.count, allowed: false };
  }
  cur.count++;
  return { count: cur.count, allowed: true };
}

async function verifyTurnstile(token, secret, ip) {
  if (!secret) throw new Error('TURNSTILE_SECRET not set');
  if (!token) return { success: false, error: 'missing-token' };
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  return res.json();
}

async function solveTurnstile(key) {
  if (!key) throw new Error('TWOCAPTCHA_KEY env var not set');
  const cRes = await fetch('https://api.2captcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: key,
      task: { type: 'TurnstileTaskProxyless', websiteURL: PAGE_URL, websiteKey: SITE_KEY }
    })
  });
  const cData = await cRes.json();
  if (cData.errorId !== 0) throw new Error(`2Captcha create: ${cData.errorDescription}`);
  const taskId = cData.taskId;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const rRes = await fetch('https://api.2captcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: key, taskId })
    });
    const rData = await rRes.json();
    if (rData.status === 'ready') return rData.solution.token || rData.solution.gRecaptchaResponse;
    if (rData.errorId !== 0) throw new Error(`2Captcha result: ${rData.errorDescription}`);
  }
  throw new Error('Turnstile solve timeout');
}

function parseCookies(res) {
  const out = {};
  let setCookies = [];
  if (typeof res.headers.getSetCookie === 'function') {
    setCookies = res.headers.getSetCookie();
  } else {
    const raw = res.headers.get('set-cookie') || '';
    setCookies = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  }
  for (const c of setCookies) {
    const m = c.match(/^\s*([^=]+)=([^;]+)/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function cookieHeader(c) {
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function initSession() {
  const pageRes = await fetch(PAGE_URL, { headers: { 'User-Agent': UA } });
  const cookies = parseCookies(pageRes);
  if (!cookies['XSRF-TOKEN'] || !cookies['prepostseocom_session']) {
    throw new Error(`prepostseo cookies missing: ${Object.keys(cookies).join(',')}`);
  }
  return cookies;
}

async function verifyCaptcha(cookies, token) {
  const xsrf = decodeURIComponent(cookies['XSRF-TOKEN']);
  const ts = Date.now();
  const form = new URLSearchParams();
  form.append('emd_captcha_1', `2${HASH}`);
  form.append('emd_captcha_2', token);
  form.append('emd_captcha_3', String(Math.floor(ts / 1000)));

  const res = await fetch(BASE_URL + VERIFY_PATH + ts, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrf,
      'Origin': 'https://www.prepostseo.com',
      'Referer': PAGE_URL,
      'Cookie': cookieHeader(cookies)
    },
    body: form.toString()
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) {
    throw new Error(`verify parse fail: ${text.slice(0, 200)}`);
  }
  if (!data.req_key) throw new Error(`no req_key: ${text.slice(0, 200)}`);
  const newCookies = parseCookies(res);
  Object.assign(cookies, newCookies);
  return data.req_key;
}

async function queryBatch(urls, cookies, reqKey) {
  const xsrf = decodeURIComponent(cookies['XSRF-TOKEN']);
  const form = new URLSearchParams();
  form.append('tool_key', 'domain_authority_checker');
  form.append('req_key', reqKey);
  form.append('req_key_2', reqKey);
  form.append('e_track_key', '');
  for (const u of urls) form.append('urls[]', u);

  const res = await fetch(BASE_URL + CHECK_PATH, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrf,
      'Origin': 'https://www.prepostseo.com',
      'Referer': PAGE_URL,
      'Cookie': cookieHeader(cookies)
    },
    body: form.toString()
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) {
    throw new Error(`check parse fail: ${text.slice(0, 200)}`);
  }
  const out = {};
  if (Array.isArray(data.data)) {
    for (const item of data.data) {
      const k = norm(item.url || item.domain || '');
      if (!k) continue;
      out[k] = {
        da: item.domain_auth ?? null,
        pa: item.page_auth ?? null,
        ss: item.spam_score ?? null
      };
    }
  }
  const newCookies = parseCookies(res);
  Object.assign(cookies, newCookies);
  return out;
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const rawUrls = (body.urls || []).map(u => String(u).trim()).filter(Boolean);
  const cfToken = body.cf_token || '';
  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  const sessionUser = await getSessionUser(request, env);
  const logged = !!sessionUser;

  try {
    // Bot gate
    const tv = await verifyTurnstile(cfToken, env.TURNSTILE_SECRET, clientIp);
    if (!tv.success) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Bot verification failed. Refresh the page and try again.' 
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    if (!rawUrls.length) {
      return new Response(JSON.stringify({ ok: false, error: 'No domains provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    // Limits
    const maxDomains = logged ? LOGGED_MAX_DOMAINS : PUBLIC_MAX_DOMAINS;
    if (rawUrls.length > maxDomains) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: logged
          ? `Max ${LOGGED_MAX_DOMAINS} domains per request`
          : `Public limit: max ${PUBLIC_MAX_DOMAINS} domains per run. Login to unlock ${LOGGED_MAX_DOMAINS}.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    // Rate limit (public only)
    if (!logged) {
      const usage = bumpIp(clientIp);
      if (!usage.allowed) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: `Daily limit reached (${DAILY_LIMIT_PUBLIC} runs/day per IP). Try again tomorrow or login for unlimited.`
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...CORS }
        });
      }
    }

    const urls = rawUrls.map(norm);
    const total = urls.length;
    const batches = [];
    for (let i = 0; i < urls.length; i += CHUNK) batches.push(urls.slice(i, i + CHUNK));

    // Auth + solve
    const cookies = await initSession();
    const token = await solveTurnstile(env.TWOCAPTCHA_KEY);
    const reqKey = await verifyCaptcha(cookies, token);

    // Query all batches
    const metrics = {};
    for (let i = 0; i < batches.length; i++) {
      const m = await queryBatch(batches[i], cookies, reqKey);
      Object.assign(metrics, m);
    }

    // Retry failed domains (if < 25)
    const stillPending = urls.filter(d => !metrics[d] || metrics[d].da == null);
    if (stillPending.length && stillPending.length <= 25) {
      try {
        const c2 = await initSession();
        const tok2 = await solveTurnstile(env.TWOCAPTCHA_KEY);
        const rk2 = await verifyCaptcha(c2, tok2);
        const m2 = await queryBatch(stillPending, c2, rk2);
        Object.assign(metrics, m2);
      } catch (_) {
        // Skip retry error
      }
    }

    // Build final results
    const results = rawUrls.map(u => {
      const m = metrics[norm(u)] || { da: null, pa: null, ss: null };
      return {
        domain: u,
        da: m.da,
        pa: m.pa,
        ss: m.ss,
        dr: null,  // DR belum diimplementasi di endpoint ini
        status: m.da !== null ? 'success' : 'failed'
      };
    });

    const success = results.filter(r => r.status === 'success').length;
    return new Response(JSON.stringify({ 
      ok: true, 
      total, 
      success, 
      failed: total - success, 
      results 
    }), {
      headers: { 'Content-Type': 'application/json', ...CORS }
    });

  } catch (e) {
    return new Response(JSON.stringify({ 
      ok: false, 
      error: e.message || 'Internal server error' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }
}
