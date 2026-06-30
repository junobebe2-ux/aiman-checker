// Cloudflare Pages Function: POST /check  (NDJSON streaming)
// Source: prepostseo.com (Moz-backed DA/PA/SS). No batch cap like GPL.
// Flow: fetch page -> 2Captcha Turnstile -> emd/captcha-verify -> dapa/check
// Subrequest budget (100 domains): page(1) + captcha(1 + <=20 polls) + verify(1) + 2 batches(2) = ~25, under 50.

const SITE_KEY = '0x4AAAAAAAX_O8VfAMao1UUl';
const PAGE_URL = 'https://www.prepostseo.com/domain-authority-checker';
const BASE_URL = 'https://www.prepostseo.com/';
const VERIFY_PATH = 'emd/captcha-verify/';
const CHECK_PATH = 'dapa/check';
const HASH = '2YCFz6VHAbg3tm4JhNIQCNwg7QDLgHQORRNsi4Gqy';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHUNK = 50;        // prepostseo: tested 50/50 ok, 100 fails; 50 is safe
const MAX_POLLS = 20;    // captcha poll cap (20 * 3s = 60s)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const norm = (s) => String(s).toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .replace(/\/+$/, '')
  .trim();

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

// Parse Set-Cookie (CF Worker supports getSetCookie() in headers)
function parseCookies(res) {
  const out = {};
  // Cloudflare Workers: headers.getSetCookie() returns array of Set-Cookie values
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
  // 1. Fetch page to get XSRF-TOKEN + prepostseocom_session
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
  // session may rotate after verify
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
  // session may rotate
  const newCookies = parseCookies(res);
  Object.assign(cookies, newCookies);
  return out;
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const rawUrls = (body.urls || []).map(u => String(u).trim()).filter(Boolean);
  const cfToken = body.cf_token || '';
  const clientIp = request.headers.get('CF-Connecting-IP') || '';

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n'));

  (async () => {
    try {
      // Bot gate — Turnstile verify FIRST (before any paid 2Captcha call)
      const tv = await verifyTurnstile(cfToken, env.TURNSTILE_SECRET, clientIp);
      if (!tv.success) {
        send({ t: 'error', msg: 'Bot verification failed. Refresh the page and try again.' });
        return;
      }

      if (!rawUrls.length) { send({ t: 'error', msg: 'No domains provided' }); return; }
      if (rawUrls.length > 100) { send({ t: 'error', msg: 'Max 100 domains per request' }); return; }

      const urls = rawUrls.map(norm);
      const total = urls.length;
      const batches = [];
      for (let i = 0; i < urls.length; i += CHUNK) batches.push(urls.slice(i, i + CHUNK));

      send({ t: 'phase', phase: 'verify', msg: 'Verifying access \u00b7 solving security check' });
      const cookies = await initSession();
      const token = await solveTurnstile(env.TWOCAPTCHA_KEY);
      const reqKey = await verifyCaptcha(cookies, token);

      const metrics = {};
      let done = 0;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      for (let i = 0; i < batches.length; i++) {
        send({ t: 'batch', i: i + 1, total: batches.length, size: batches[i].length });
        send({ t: 'phase', msg: `Pulling Moz data \u00b7 batch ${i + 1}/${batches.length} (${batches[i].length} domains)` });
        const m = await queryBatch(batches[i], cookies, reqKey);
        Object.assign(metrics, m);

        // Stream per-domain reveals with delay so the UI looks like it's working through each one
        for (const d of batches[i]) {
          send({ t: 'scanning', domain: d });
          await sleep(40);
          const mm = metrics[d] || { da: null, pa: null, ss: null };
          done++;
          send({
            t: 'result',
            r: {
              url: d,
              domain_authority: mm.da,
              page_authority: mm.pa,
              spam_score: mm.ss,
              status: mm.da !== null ? 'success' : 'pending'
            }
          });
          send({ t: 'progress', done, total });
          await sleep(50);
        }
      }

      // Internal retry: re-auth + re-query domains that came back null (subrequest budget permitting)
      const stillPending = urls.filter(d => !metrics[d] || metrics[d].da == null);
      if (stillPending.length && stillPending.length <= 25) {
        send({ t: 'phase', msg: `Retrying ${stillPending.length} domain(s) on fresh session\u2026` });
        try {
          const c2 = await initSession();
          const tok2 = await solveTurnstile(env.TWOCAPTCHA_KEY);
          const rk2 = await verifyCaptcha(c2, tok2);
          const m2 = await queryBatch(stillPending, c2, rk2);
          Object.assign(metrics, m2);
          for (const d of stillPending) {
            send({ t: 'scanning', domain: d });
            await sleep(40);
            const mm = metrics[d] || { da: null, pa: null, ss: null };
            send({
              t: 'result',
              r: {
                url: d,
                domain_authority: mm.da,
                page_authority: mm.pa,
                spam_score: mm.ss,
                status: mm.da !== null ? 'success' : 'pending'
              }
            });
            await sleep(50);
          }
        } catch (re) {
          send({ t: 'phase', msg: `Retry skipped: ${re.message}` });
        }
      }

      const results = rawUrls.map(u => {
        const m = metrics[norm(u)] || { da: null, pa: null, ss: null };
        return {
          url: u,
          domain_authority: m.da,
          page_authority: m.pa,
          spam_score: m.ss,
          status: m.da !== null ? 'success' : 'failed'
        };
      });
      const success = results.filter(r => r.status === 'success').length;
      send({ t: 'done', total, success, failed: total - success, results });
    } catch (e) {
      send({ t: 'error', msg: e.message || 'failed' });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' }
  });
}
