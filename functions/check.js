// Cloudflare Pages Function: POST /check  (NDJSON streaming)
// Real Moz DA/PA/SS via Guestpostlinks (Turnstile solved by YesCaptcha) + DR via Ahrefs.
// Streams progress events line-by-line so the UI can show live progress and never looks stuck.
// Failed domains are retried in fresh sessions until resolved (capped rounds).

const SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu';
const PAGE_URL = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/';
const AJAX_URL = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHUNK = 20;       // GPL max domains per batch
const MAX_ROUNDS = 6;   // retry rounds for stubborn domains

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const norm = (s) => String(s).toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .replace(/\/+$/, '')
  .trim();

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

// One GPL batch. batchIndex 0 needs turnstile token; later batches reuse refId.
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
        out[norm(url)] = {
          da: m.domain_authority ?? null,
          pa: m.page_authority ?? null,
          ss: m.spam_score ?? null
        };
      }
    }
  }
  return { metrics: out, refId: newRefId };
}

async function getDR(domain) {
  try {
    const res = await fetch(`https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}`);
    const json = await res.json();
    return json.domain_rating?.domain_rating ?? null;
  } catch (e) { return null; }
}

// Run a full GPL session over `urls` (solve turnstile once, batches reuse ref_id).
// Returns { [normDomain]: {da,pa,ss} }. Emits batch events via send().
async function runSession(urls, key, send, baseDone, grandTotal) {
  const cookies = await getCookies();
  const token = await solveTurnstile(key);
  const batches = [];
  for (let i = 0; i < urls.length; i += CHUNK) batches.push(urls.slice(i, i + CHUNK));

  const all = {};
  let refId = '';
  let done = baseDone;
  for (let i = 0; i < batches.length; i++) {
    send({ t: 'batch', i: i + 1, total: batches.length, size: batches[i].length });
    const { metrics, refId: rid } = await queryBatch(batches[i], urls, {
      token, cookies, batchIndex: i, batchTotal: batches.length, refId
    });
    if (rid) refId = rid;
    Object.assign(all, metrics);

    // Fetch DR in parallel for this batch, then stream each row with a tiny stagger
    const drs = await Promise.all(batches[i].map(d => getDR(d)));
    for (let j = 0; j < batches[i].length; j++) {
      const d = batches[i][j];
      const m = metrics[d] || all[d] || { da: null, pa: null, ss: null };
      done++;
      send({
        t: 'result',
        r: {
          url: d,
          domain_authority: m.da,
          page_authority: m.pa,
          spam_score: m.ss,
          domain_rating: drs[j],
          status: m.da !== null ? 'success' : 'pending'
        }
      });
      send({ t: 'progress', done, total: grandTotal });
      await new Promise(r => setTimeout(r, 25)); // cascade rows in UI
    }
  }
  return all;
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const rawUrls = (body.urls || []).map(u => String(u).trim()).filter(Boolean);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n'));

  (async () => {
    try {
      if (!rawUrls.length) { send({ t: 'error', msg: 'No domains provided' }); return; }
      if (rawUrls.length > 100) { send({ t: 'error', msg: 'Max 100 domains per request' }); return; }

      const urls = rawUrls.map(norm);
      const total = urls.length;
      send({ t: 'phase', phase: 'verify', msg: 'Verifying access \u00b7 solving security check' });

      // First pass
      let metrics = await runSession(urls, env.YESCAPTCHA_KEY, send, 0, total);

      // Retry rounds for any domain that came back null
      let failed = urls.filter(d => !metrics[d] || metrics[d].da === null);
      let round = 0;
      while (failed.length && round < MAX_ROUNDS) {
        round++;
        send({ t: 'retry', round, count: failed.length, domains: failed.slice(0, 50) });
        await new Promise(r => setTimeout(r, 1500 * round)); // backoff
        const more = await runSession(failed, env.YESCAPTCHA_KEY, send, 0, total);
        for (const [k, v] of Object.entries(more)) {
          if (v && v.da !== null) metrics[k] = v;
        }
        failed = urls.filter(d => !metrics[d] || metrics[d].da === null);
      }

      // Final assembled results (preserve original input order + raw input string)
      const results = await Promise.all(rawUrls.map(async (u) => {
        const nu = norm(u);
        const m = metrics[nu] || { da: null, pa: null, ss: null };
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
