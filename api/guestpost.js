// AIMAN CHECKER - Guestpostlinks DA/PA/SS endpoint (REAL Moz data)
// Method: Cloudflare Turnstile solve (YesCaptcha) -> WP admin-ajax dapa_checker_function
// Returns real domain_authority / page_authority / spam_score from Moz official API.

const SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu';
const PAGE_URL = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/';
const AJAX_URL = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Solve Cloudflare Turnstile via YesCaptcha
async function solveTurnstile() {
  const key = process.env.YESCAPTCHA_KEY;
  if (!key) throw new Error('YESCAPTCHA_KEY env var not set');

  const createRes = await fetch('https://api.yescaptcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: key,
      task: { type: 'TurnstileTaskProxyless', websiteURL: PAGE_URL, websiteKey: SITE_KEY }
    })
  });
  const createData = await createRes.json();
  if (createData.errorId !== 0) throw new Error(`YesCaptcha create: ${createData.errorDescription}`);

  const taskId = createData.taskId;
  for (let i = 0; i < 30; i++) {
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

// Get session cookies from the tool page
async function getCookies() {
  const res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA } });
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

// Query Guestpostlinks for real Moz metrics
async function queryMetrics(urls, token, cookies) {
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
  payload.append('data[cf-turnstile-response]', token);

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
    body: payload.toString()
  });

  const json = await res.json();
  const results = {};
  if (json.success && Array.isArray(json.data)) {
    for (const item of json.data) {
      if (!item.api_result) continue;
      for (const [url, info] of Object.entries(item.api_result)) {
        const m = info.metrics || {};
        results[url] = {
          da: m.domain_authority ?? null,
          pa: m.page_authority ?? null,
          ss: m.spam_score ?? null,
          title: m.title || '',
          last_crawled: m.last_crawled || ''
        };
      }
    }
  }
  return { results, credits: json.user_remaining_credit };
}

// Get DR from Ahrefs free API
async function getDR(domain) {
  try {
    const res = await fetch(`https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}`);
    const json = await res.json();
    return json.domain_rating?.domain_rating ?? null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Provide { urls: [...] }' });
  }
  if (urls.length > 20) {
    return res.status(400).json({ error: 'Max 20 URLs per request' });
  }

  try {
    const [cookies, token] = await Promise.all([getCookies(), solveTurnstile()]);
    const { results, credits } = await queryMetrics(urls, token, cookies);

    // Enrich with DR
    await Promise.all(urls.map(async (u) => {
      const dr = await getDR(u);
      if (results[u]) results[u].dr = dr;
      else results[u] = { da: null, pa: null, ss: null, dr };
    }));

    return res.status(200).json({ success: true, data: results, credits });
  } catch (e) {
    console.error('Guestpost fetch error', e);
    return res.status(500).json({ error: e.message || 'Failed to fetch Guestpost data' });
  }
}
