// POST /haro — Streaming HARO/PR opportunity finder via Google SERP (BrightData).
// SERP-based discovery of journalist requests indexed across Featured / Qwoted / Terkel / SourceBottle.

import { googleSerp } from './_serp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const HARO_QUERIES = (niche) => [
  { q: `"looking for sources" ${niche}`, signal: 'sources' },
  { q: `site:featured.com ${niche}`, signal: 'Featured.com' },
  { q: `site:qwoted.com ${niche}`, signal: 'Qwoted' },
  { q: `site:terkel.io ${niche}`, signal: 'Terkel' },
  { q: `"journalist seeking" ${niche}`, signal: 'journalist' },
  { q: `"experts needed" ${niche}`, signal: 'experts' },
  { q: `"need a quote" ${niche}`, signal: 'quote' },
  { q: `"contributors wanted" ${niche}`, signal: 'contributors' }
];

function inferPlatform(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h.includes('featured.com')) return 'Featured.com';
    if (h.includes('qwoted')) return 'Qwoted';
    if (h.includes('terkel')) return 'Terkel';
    if (h.includes('sourcebottle')) return 'SourceBottle';
    if (h.includes('helpab2bwriter')) return 'HelpAB2BWriter';
    if (h.includes('helpareporter')) return 'HARO';
    if (h.includes('responsesource')) return 'ResponseSource';
    return h;
  } catch (_) { return 'web'; }
}

function score(r, keywords) {
  const hay = (r.title + ' ' + r.snippet).toLowerCase();
  let s = 0;
  for (const k of keywords) {
    const kk = k.toLowerCase().trim();
    if (kk.length < 3) continue;
    const re = new RegExp('\\b' + kk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const m = hay.match(re);
    if (m) s += m.length;
  }
  return s;
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const niche = (body.niche || '').trim();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (o) => writer.write(enc.encode(JSON.stringify(o) + '\n'));

  (async () => {
    try {
      if (!niche) { send({ t: 'error', msg: 'Niche required' }); return; }
      if (!env.BRIGHTDATA_TOKEN) { send({ t: 'error', msg: 'SERP not configured' }); return; }

      const keywords = niche.split(/[,\s]+/).filter(k => k.length >= 3);
      const queries = HARO_QUERIES(niche);
      const seen = new Map(); // url -> result

      for (let i = 0; i < queries.length; i++) {
        const { q, signal } = queries[i];
        send({ t: 'phase', msg: `Searching Google · pattern ${i + 1}/${queries.length}` });
        send({ t: 'query', q });
        try {
          const results = await googleSerp(env.BRIGHTDATA_TOKEN, q, 15);
          let added = 0;
          for (const r of results) {
            if (seen.has(r.url)) continue;
            const rec = {
              title: r.title,
              url: r.url,
              link: r.url, // legacy
              description: r.snippet,
              snippet: r.snippet,
              platform: inferPlatform(r.url),
              source: inferPlatform(r.url),
              signal,
              score: score(r, keywords)
            };
            seen.set(r.url, rec);
            send({ t: 'result', r: rec });
            added++;
          }
          send({ t: 'query_done', query: q, found: results.length, new: added, total: seen.size });
        } catch (e) {
          send({ t: 'warn', msg: `Pattern failed: ${e.message}` });
        }
      }

      const all = Array.from(seen.values()).sort((a, b) => b.score - a.score);
      send({ t: 'done', total: all.length, results: all });
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
