// Cloudflare Pages Function: POST /check  (NDJSON streaming)
// GPL-only: real Moz DA/PA/SS via Guestpostlinks (Turnstile solved by YesCaptcha).
// DR is fetched separately by the client via /dr (keeps subrequests per invocation low).
// No in-worker retry — the client re-invokes /check for failed domains (fresh subrequest budget each call).
// Subrequest budget (100 domains): cookies(1) + captcha(1 + <=20 polls) + 5 batches = ~27, safely under the 50 free-plan cap.

const SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu';
const PAGE_URL = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/';
const AJAX_URL = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHUNK = 20;        // GPL max domains per batch
const MAX_POLLS = 20;    // captcha poll cap (20 * 3s = 60s) -> bounds subrequests

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
  for (let i = 0; i < MAX_POLLS; i++) {
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
      const batches = [];
      for (let i = 0; i < urls.length; i += CHUNK) batches.push(urls.slice(i, i + CHUNK));

      send({ t: 'phase', phase: 'verify', msg: 'Verifying access \u00b7 solving security check' });
      const cookies = await getCookies();
      const token = await solveTurnstile(env.YESCAPTCHA_KEY);

      const metrics = {};
      let refId = '';
      let done = 0;
      for (let i = 0; i < batches.length; i++) {
        send({ t: 'batch', i: i + 1, total: batches.length, size: batches[i].length });
        const { metrics: m, refId: rid } = await queryBatch(batches[i], urls, {
          token, cookies, batchIndex: i, batchTotal: batches.length, refId
        });
        if (rid) refId = rid;
        Object.assign(metrics, m);

        for (const d of batches[i]) {
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
          await new Promise(r => setTimeout(r, 20));
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
