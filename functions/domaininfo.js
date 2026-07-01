// POST /domaininfo -> Domain info: indexed pages + domain age + WHOIS + social presence
// Uses Google site: search via BrightData + free WHOIS API

import { googleSerp, stripTags, normDomain } from './_serp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const domain = String(body.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');

  if (!domain) {
    return new Response(JSON.stringify({ ok: false, error: 'Domain wajib diisi' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const BRIGHTDATA = env.BRIGHTDATA_TOKEN;
  const result = { ok: true, domain, indexedPages: null, domainAge: null, registrar: null, expiry: null, ssl: null };

  try {
    // 1) Indexed pages: Google site:domain.com search
    try {
      const serpResults = await googleSerp(BRIGHTDATA, `site:${domain}`, 10);
      // Get the result count from SERP - parse from Google's "About X results" text
      // We need raw HTML for that, so let's do a direct fetch
      const countRes = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BRIGHTDATA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: 'web_unlocker1', url: `https://www.google.com/search?q=${encodeURIComponent('site:' + domain)}&hl=en`, format: 'raw' })
      });

      if (countRes.ok) {
        const html = await countRes.text();
        // Parse "About 1,230,000 results" or "Sekitar 1.230.000 hasil"
        const countMatch = html.match(/(?:About|Sekitar|Aproximadamente|Cerca\s*de)\s+([\d.,]+)\s*(?:results|hasil|resultados)/i)
          || html.match(/id="result-stats"[^>]*>\s*([\d.,]+)/i)
          || html.match(/>([\d.,]+)\s*(?:results|hasil)/i);
        if (countMatch) {
          result.indexedPages = parseInt(countMatch[1].replace(/[.,]/g, ''), 10);
        }
        // Also count from actual SERP results as fallback
        if (!result.indexedPages) {
          result.indexedPages = serpResults.length;
          result.indexedPagesNote = 'Estimated from top results (exact count not shown)';
        }
      }
    } catch (e) { /* ignore */ }

    // 2) Domain age + WHOIS via free WHOIS API (whoisjs.com or similar)
    try {
      const whoisRes = await fetch(`https://whoisjs.com/api/v1/${domain}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (whoisRes.ok) {
        const whoisText = await whoisRes.text();
        let whoisData = {};
        try { whoisData = JSON.parse(whoisText); } catch {}
        const whoisStr = JSON.stringify(whoisData);

        // Extract creation date
        const createdMatch = whoisStr.match(/(?:Creation\s*Date|Created|Registration\s*Time|created)[^0-9]*(\d{4}-\d{2}-\d{2})/i)
          || whoisStr.match(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/i);
        if (createdMatch) {
          const created = new Date(createdMatch[1]);
          const now = new Date();
          const ageYears = Math.floor((now - created) / (365.25 * 24 * 60 * 60 * 1000));
          result.domainAge = ageYears;
          result.createdDate = createdMatch[1];
        }

        // Extract registrar
        const regMatch = whoisStr.match(/(?:Registrar|Sponsoring\s*Registrar)[^:]*:\s*([^\n"]+)/i);
        if (regMatch) result.registrar = regMatch[1].trim().slice(0, 80);

        // Extract expiry
        const expMatch = whoisStr.match(/(?:Registry\s*Expiry|Expir[a-z]+\s*Date|paid-till)[^0-9]*(\d{4}-\d{2}-\d{2})/i);
        if (expMatch) result.expiry = expMatch[1];
      }
    } catch (e) { /* WHOIS may fail for some TLDs */ }

    // 3) SSL certificate check
    try {
      const sslRes = await fetch(`https://${domain}`, { method: 'HEAD', redirect: 'manual' });
      result.ssl = sslRes.ok || sslRes.status < 400;
    } catch (e) {
      try {
        await fetch(`https://${domain}`, { method: 'HEAD' });
        result.ssl = true;
      } catch { result.ssl = false; }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}
