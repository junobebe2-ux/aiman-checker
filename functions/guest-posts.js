// POST /guest-posts — Streaming guest post finder via Google SERP (BrightData).
// 6 search patterns × ~20 results = up to 120 candidate domains, deduped + scored.

import { googleSerp, isJunk, stripTags } from './_serp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const QUERY_TEMPLATES = (niche) => [
  { q: `"write for us" ${niche}`, signal: 'write for us' },
  { q: `"guest post" ${niche}`, signal: 'guest post' },
  { q: `"submit a guest post" ${niche}`, signal: 'submit guest post' },
  { q: `"contribute to" ${niche}`, signal: 'contributor' },
  { q: `"guest blogger" ${niche}`, signal: 'guest blogger' },
  { q: `"accepting guest posts" ${niche}`, signal: 'accepting posts' }
];

// Bonus filter: result URL/title that strongly suggests a guest post page
function looksLikeOpportunity(r) {
  const t = (r.title + ' ' + r.url).toLowerCase();
  return /write[-\s]?for[-\s]?us|guest[-\s]?post|contribute|guest[-\s]?author|guest[-\s]?blogger|submit/.test(t);
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
      if (niche.length > 80) { send({ t: 'error', msg: 'Niche too long' }); return; }
      if (!env.BRIGHTDATA_TOKEN) { send({ t: 'error', msg: 'SERP not configured' }); return; }

      const queries = QUERY_TEMPLATES(niche);
      const seen = new Map(); // domain -> result

      for (let i = 0; i < queries.length; i++) {
        const { q, signal } = queries[i];
        send({ t: 'phase', msg: `Searching Google · pattern ${i + 1}/${queries.length}` });
        send({ t: 'query', q });
        try {
          const results = await googleSerp(env.BRIGHTDATA_TOKEN, q, 20);
          let added = 0;
          for (const r of results) {
            if (seen.has(r.domain)) continue;
            const isHot = looksLikeOpportunity(r);
            const rec = {
              domain: r.domain,
              url: r.url,
              title: r.title,
              snippet: r.snippet,
              signal,
              hot: isHot,
              score: isHot ? 2 : 1
            };
            seen.set(r.domain, rec);
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
