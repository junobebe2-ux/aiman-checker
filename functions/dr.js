// Cloudflare Pages Function: POST /dr
// Batch Ahrefs Domain Rating lookup. One subrequest per domain.
// Client sends <=40 domains per call so each invocation stays under the 50-subrequest free-plan cap.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const norm = (s) => String(s).toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .replace(/\/+$/, '')
  .trim();

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
  const { request } = context;
  try {
    const body = await request.json();
    const urls = (body.urls || []).map(u => norm(u)).filter(Boolean);
    if (!urls.length) {
      return new Response(JSON.stringify({ error: 'urls required' }), { status: 400, headers: CORS });
    }
    if (urls.length > 45) {
      return new Response(JSON.stringify({ error: 'Max 45 domains per /dr call' }), { status: 400, headers: CORS });
    }
    const drs = await Promise.all(urls.map(getDR));
    const out = {};
    urls.forEach((u, i) => { out[u] = drs[i]; });
    return new Response(JSON.stringify({ success: true, dr: out }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'failed' }), { status: 500, headers: CORS });
  }
}
