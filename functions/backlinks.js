// POST /backlinks -> Get backlinks pointing to a domain
// Uses Ahrefs free DR endpoint to estimate referring domains + BrightData SERP for "link:" queries
// Falls back to Ahrefs site explorer backlinks page scrape

import { googleSerp, stripTags, normDomain, isJunk } from './_serp.js';

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

  try {
    // 1) Fetch Ahrefs backlinks page via BrightData (shows top referring pages)
    let backlinks = [];
    let refDomains = 0;

    if (BRIGHTDATA) {
      try {
        const ahrefsUrl = `https://ahrefs.com/site-explorer/overview/v2/exact/recent?target=${encodeURIComponent(domain)}`;
        const res = await fetch('https://api.brightdata.com/request', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${BRIGHTDATA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ zone: 'web_unlocker1', url: ahrefsUrl, format: 'raw' })
        });

        if (res.ok) {
          const html = await res.text();
          // Extract metrics from Ahrefs page (referring domains count)
          const refMatch = html.match(/referring\s*domains?[^0-9]*(\d[\d,]*)/i);
          if (refMatch) refDomains = parseInt(refMatch[1].replace(/,/g, ''), 10);

          // Try to extract backlink entries from JSON data in page
          const jsonMatches = html.match(/\{"urlFrom":"[^"]+","urlTo":"[^"]+[^}]*\}/g);
          if (jsonMatches) {
            backlinks = jsonMatches.slice(0, 30).map(m => {
              try {
                const obj = JSON.parse(m);
                return {
                  source: obj.urlFrom || '',
                  target: obj.urlTo || '',
                  dr: obj.domainRating || obj.dr || 0,
                  title: obj.title || '',
                  type: obj.linkType || 'text'
                };
              } catch { return null; }
            }).filter(Boolean);
          }
        }
      } catch (e) { /* Ahrefs scrape may fail, continue */ }
    }

    // 2) Fallback: Use Google SERP to find pages linking to domain
    if (backlinks.length < 5) {
      try {
        const results = await googleSerp(BRIGHTDATA, `"${domain}" -site:${domain}`, 20);
        backlinks = results.map(r => ({
          source: r.url,
          target: domain,
          dr: 0,
          title: r.title,
          type: 'mention'
        }));
      } catch (e) { /* ignore */ }
    }

    // 3) Get DR for each backlink source domain (batch, limited)
    if (backlinks.length > 0 && backlinks[0].dr === 0) {
      const origin = new URL(request.url).origin;
      const sourceDomains = [...new Set(backlinks.map(b => normDomain(b.source)).filter(Boolean))].slice(0, 15);
      
      try {
        const drRes = await fetch(`${origin}/dr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: sourceDomains })
        });
        if (drRes.ok) {
          const drData = await drRes.json();
          // /dr returns { success: true, dr: { domain: drValue } }
          const drMap = drData.dr || {};
          backlinks.forEach(b => {
            const d = normDomain(b.source);
            if (d && drMap[d] != null) b.dr = drMap[d];
          });
        }
      } catch (e) { /* ignore */ }
    }

    // 4) Sort by DR descending
    backlinks.sort((a, b) => (b.dr || 0) - (a.dr || 0));

    return new Response(JSON.stringify({
      ok: true,
      domain,
      refDomains,
      totalFound: backlinks.length,
      backlinks: backlinks.slice(0, 30)
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}
