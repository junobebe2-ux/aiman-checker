// Cloudflare Pages Function: POST /check
// Real Moz DA/PA/SS via Guestpostlinks (Turnstile solved by YesCaptcha) + DR via Ahrefs.
// Same-origin endpoint — no EC2/tunnel needed.

const SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu';
const PAGE_URL = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/';
const AJAX_URL = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

async function solveTurnstile(key) {
  if (!key) throw new Error('YESCAPTCHA_KEY env var not set');
  const cRes = await fetch('https://api.yescaptcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: key,
      task: { type: 'TurnstileTaskProxyless', websiteURL: PAGE_URL, websiteKey: SITE_KEY }
    })
  });
  const cData = await cRes.json();
  if (cData.errorId !== 0) throw new Error(`YesCaptcha create: ${cData.errorDescription}`);
  const taskId = cData.taskId;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const rRes = await fetch('https://api.yescaptcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: key, taskId })
    });
    const rData = await rRes.json();
    if (rData.status === 'ready') return rData.solution.token || rData.solution.gRecaptchaResponse;
    if (rData.errorId !== 0) throw new Error(`YesCaptcha result: ${rData.errorDescription}`);
  }
  throw new Error('Turnstile solve timeout');
}

async function getCookies() {
  const res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA } });
  const sc = res.headers.get('set-cookie') || '';
  return sc.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

// Query ONE batch. batchIndex 0 needs turnstile token; later batches reuse refId.
async function queryBatch(urls, allRaw, opts) {
  const { token, cookies, batchIndex, batchTotal, refId } = opts;
  const p = new URLSearchParams();
  p.append('action', 'dapa_checker_function');
  p.append('data[urls]', urls.join('\n'));
  p.append('data[same_url]', '0');
  p.append('data[same_domain]', '0');
  p.append('data[batch_mode]', 'batch');
  p.append('data[batch_index]', String(batchIndex));
  p.append('data[batch_total]', String(batchTotal));
  p.append('data[all_urls_raw]', batchIndex === 0 ? allRaw.join('\n') : '');
  p.append('data[ref_id]', refId || '');
  p.append('data[batch_session_token]', '');
  if (batchIndex === 0) p.append('data[cf-turnstile-response]', token);

  const res = await fetch(AJAX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://tools.guestpostlinks.net',
      'Referer': PAGE_URL,
      'Cookie': cookies
    },
    body: p.toString()
  });
  const json = await res.json();
  const out = {};
  let newRefId = refId;
  if (json.success && Array.isArray(json.data)) {
    for (const item of json.data) {
      if (item.ref_id) newRefId = item.ref_id;
      if (!item.api_result) continue;
      for (const [url, info] of Object.entries(item.api_result)) {
        const m = info.metrics || {};
        out[url] = {
          da: m.domain_authority ?? null,
          pa: m.page_authority ?? null,
          ss: m.spam_score ?? null
        };
      }
    }
  }
  return { metrics: out, refId: newRefId };
}

// Query all URLs in batches of 20. Turnstile solved once (batch 0); rest reuse ref_id.
async function queryMetrics(urls, token, cookies) {
  const CHUNK = 20;
  const batches = [];
  for (let i = 0; i < urls.length; i += CHUNK) batches.push(urls.slice(i, i + CHUNK));

  const all = {};
  let refId = '';
  for (let i = 0; i < batches.length; i++) {
    const { metrics, refId: rid } = await queryBatch(batches[i], urls, {
      token, cookies, batchIndex: i, batchTotal: batches.length, refId
    });
    Object.assign(all, metrics);
    if (rid) refId = rid;
  }
  return all;
}

async function getDR(domain) {
  try {
    const res = await fetch(`https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}`);
    const json = await res.json();
    return json.domain_rating?.domain_rating ?? null;
  } catch (e) { return null; }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const rawUrls = (body.urls || []).map(u => String(u).trim()).filter(Boolean);
    if (!rawUrls.length) {
      return new Response(JSON.stringify({ error: 'urls required' }), { status: 400, headers: CORS });
    }
    if (rawUrls.length > 100) {
      return new Response(JSON.stringify({ error: 'Max 100 URLs per request' }), { status: 400, headers: CORS });
    }

    // Normalize a domain (strip scheme, www, trailing slash, lowercase)
    const norm = (s) => String(s).toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
      .trim();

    // Send clean domains to Guestpostlinks for reliable matching
    const urls = rawUrls.map(norm);

    const [cookies, token] = await Promise.all([getCookies(), solveTurnstile(env.YESCAPTCHA_KEY)]);
    const metrics = await queryMetrics(urls, token, cookies);

    // Build a normalized lookup from whatever keys Guestpostlinks returned
    const metricsByNorm = {};
    for (const [k, v] of Object.entries(metrics)) {
      metricsByNorm[norm(k)] = v;
    }

    const results = await Promise.all(rawUrls.map(async (u) => {
      const nu = norm(u);
      const m = metrics[nu] || metricsByNorm[nu] || { da: null, pa: null, ss: null };
      const dr = await getDR(nu);
      return {
        url: u,
        domain_authority: m.da,
        page_authority: m.pa,
        spam_score: m.ss,
        domain_rating: dr,
        source: 'guestpostlinks (Moz) + ahrefs',
        status: m.da !== null ? 'success' : 'failed'
      };
    }));

    return new Response(JSON.stringify({
      success: true,
      total: rawUrls.length,
      checked: results.length,
      results
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'failed' }), { status: 500, headers: CORS });
  }
}
