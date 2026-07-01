// POST /speed -> Page Speed check
// Primary: Google PageSpeed Insights API (needs PSI_API_KEY env var for reliable use)
// Fallback: BrightData-based page analysis (TTFB, render-blocking, image optimization, etc.)

import { stripTags } from './_serp.js';

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
  let url = String(body.url || '').trim();

  if (!url) {
    return new Response(JSON.stringify({ ok: false, error: 'URL wajib diisi' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  const strategy = body.strategy || 'mobile';
  const PSI_KEY = env.PSI_API_KEY;

  // 1) Try PageSpeed Insights API (with key if available)
  if (PSI_KEY) {
    try {
      const psiResult = await callPSI(url, strategy, PSI_KEY);
      if (psiResult) return new Response(JSON.stringify(psiResult), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    } catch (e) { /* fall through to fallback */ }
  }

  // 2) Try PSI API without key (may work if quota not exhausted)
  try {
    const psiResult = await callPSI(url, strategy, null);
    if (psiResult) return new Response(JSON.stringify(psiResult), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (e) { /* fall through to fallback */ }

  // 3) Fallback: BrightData-based page analysis
  try {
    const fallback = await analyzePageSpeed(url, strategy, env);
    return new Response(JSON.stringify(fallback), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}

async function callPSI(url, strategy, apiKey) {
  const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=PERFORMANCE${apiKey ? `&key=${apiKey}` : ''}`;

  const res = await fetch(psiUrl, {
    headers: { 'User-Agent': 'AIMAN-Checker/1.0' }
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    if (errData.error?.code === 429) throw new Error('QUOTA_EXCEEDED');
    throw new Error(`PSI API ${res.status}`);
  }

  const data = await res.json();
  const lighthouse = data.lighthouseResult || {};
  const perfCat = lighthouse.categories?.performance || {};
  const audits = lighthouse.audits || {};
  const score = Math.round((perfCat.score || 0) * 100);

  const metrics = {
    lcp: ((audits['largest-contentful-paint']?.numericValue || 0) / 1000).toFixed(2),
    fid: ((audits['max-potential-fid']?.numericValue || 0) / 1000).toFixed(3),
    cls: (audits['cumulative-layout-shift']?.numericValue || 0).toFixed(3),
    fcp: ((audits['first-contentful-paint']?.numericValue || 0) / 1000).toFixed(2),
    ttfb: Math.round(audits['server-response-time']?.numericValue || 0),
    tbt: ((audits['total-blocking-time']?.numericValue || 0) / 1000).toFixed(2),
    si: ((audits['speed-index']?.numericValue || 0) / 1000).toFixed(2),
    tti: ((audits['interactive']?.numericValue || 0) / 1000).toFixed(2)
  };

  const crux = data.loadingExperience?.metrics || {};
  const fieldData = {};
  if (crux.LARGEST_CONTENTFUL_PAINT_MS) {
    fieldData.lcp = crux.LARGEST_CONTENTFUL_PAINT_MS.percentile;
    fieldData.lcpCat = crux.LARGEST_CONTENTFUL_PAINT_MS.category;
  }
  if (crux.FIRST_INPUT_DELAY_MS) {
    fieldData.fid = crux.FIRST_INPUT_DELAY_MS.percentile;
    fieldData.fidCat = crux.FIRST_INPUT_DELAY_MS.category;
  }
  if (crux.CUMULATIVE_LAYOUT_SHIFT_SCORE) {
    fieldData.cls = crux.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100;
    fieldData.clsCat = crux.CUMULATIVE_LAYOUT_SHIFT_SCORE.category;
  }

  const opportunities = [];
  if (perfCat.auditRefs) {
    for (const ref of perfCat.auditRefs) {
      const audit = audits[ref.id];
      if (audit?.details?.overallSavingsMs && audit.score < 0.9) {
        opportunities.push({
          id: audit.id,
          title: audit.title,
          desc: audit.description,
          savingsMs: audit.details.overallSavingsMs,
          score: audit.score
        });
      }
    }
  }
  opportunities.sort((a, b) => b.savingsMs - a.savingsMs);

  return {
    ok: true,
    url: lighthouse.finalUrl || url,
    strategy,
    score,
    metrics,
    fieldData: Object.keys(fieldData).length ? fieldData : null,
    opportunities: opportunities.slice(0, 8),
    source: 'google_psi'
  };
}

// Fallback: fetch page via BrightData and analyze HTML for speed issues
async function analyzePageSpeed(url, strategy, env) {
  const BRIGHTDATA = env.BRIGHTDATA_TOKEN;
  if (!BRIGHTDATA) throw new Error('Tidak bisa cek speed: PSI API quota habis dan BrightData tidak tersedia. Tambahkan PSI_API_KEY env var.');

  const t0 = Date.now();
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BRIGHTDATA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: 'web_unlocker1', url, format: 'raw' })
  });

  if (!res.ok) throw new Error(`BrightData ${res.status}`);
  const brightdataTime = Date.now() - t0;
  const html = await res.text();
  const pageSize = new Blob([html]).size;
  // BrightData adds latency, estimate real TTFB as fraction
  const ttfb = Math.max(100, Math.round(brightdataTime * 0.3));

  // Analyze HTML for performance issues
  const issues = [];
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';

  // Render-blocking CSS in head
  const blockingCSS = (head.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).length;
  const blockingJS = (head.match(/<script[^>]+src=[^>]*(?!async|defer)[^>]*>/gi) || []).filter(s => !/async|defer/i.test(s)).length;

  // Images without loading="lazy"
  const allImages = html.match(/<img[^>]+>/gi) || [];
  const imagesLazy = allImages.filter(img => /loading=["']lazy["']/i.test(img)).length;
  const imagesNoLazy = allImages.length - imagesLazy;
  const imagesNoAlt = allImages.filter(img => !/alt=/i.test(img)).length;

  // Total scripts
  const totalScripts = (html.match(/<script[^>]*>/gi) || []).length;
  const inlineStyles = (html.match(/<style[^>]*>/gi) || []).length;

  // Check minification (rough: look for excessive whitespace in CSS/JS)
  const cssContent = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('');
  const isCssMinified = cssContent.length > 0 && (cssContent.match(/\n/g) || []).length < cssContent.length / 200;

  // HTTPS check
  const isHttps = url.startsWith('https://');

  // Compression check (from response headers)
  const isCompressed = res.headers.get('content-encoding') === 'gzip' || res.headers.get('content-encoding') === 'br';

  // Build issues list
  if (blockingCSS > 3) issues.push({ title: `Render-blocking CSS: ${blockingCSS} file di <head>`, desc: 'Pindahkan CSS non-kritikal atau gunakan media="print" onload. Inline critical CSS.', severity: 'high' });
  if (blockingJS > 2) issues.push({ title: `Render-blocking JavaScript: ${blockingJS} script di <head>`, desc: 'Tambahkan async atau defer ke script tag. Pindahkan script ke bawah sebelum </body>.', severity: 'high' });
  if (imagesNoLazy > 5) issues.push({ title: `${imagesNoLazy} gambar tanpa lazy loading`, desc: 'Tambahkan loading="lazy" ke gambar below-the-fold untuk defer loading.', severity: 'medium' });
  if (imagesNoAlt > 0) issues.push({ title: `${imagesNoAlt} gambar tanpa alt text`, desc: 'Alt text penting untuk SEO dan accessibility. Tambahkan ke semua gambar.', severity: 'low' });
  if (totalScripts > 15) issues.push({ title: `Terlalu banyak script: ${totalScripts}`, desc: 'Gabungkan dan minifikasi script. Kurangi third-party scripts.', severity: 'medium' });
  if (!isCssMinified && cssContent.length > 500) issues.push({ title: 'CSS belum di-minify', desc: 'Minifikasi CSS untuk reduce file size. Gunakan tools seperti cssnano.', severity: 'low' });
  if (pageSize > 500000) issues.push({ title: `Page size besar: ${(pageSize / 1024).toFixed(0)}KB`, desc: 'Kompres gambar, minifikasi CSS/JS, enable gzip/brotli compression.', severity: 'high' });
  if (!isHttps) issues.push({ title: 'Tidak menggunakan HTTPS', desc: 'Install SSL certificate. HTTPS adalah ranking factor Google.', severity: 'high' });
  if (!isCompressed) issues.push({ title: 'Compression tidak aktif', desc: 'Enable gzip atau brotli compression di server untuk reduce transfer size.', severity: 'medium' });
  if (ttfb > 1000) issues.push({ title: `Server response lambat: ${ttfb}ms`, desc: 'Optimasi database query, gunakan CDN, enable caching. Target TTFB < 600ms.', severity: 'high' });

  // Estimate score based on issues
  let estScore = 90;
  issues.forEach(i => {
    if (i.severity === 'high') estScore -= 12;
    else if (i.severity === 'medium') estScore -= 6;
    else estScore -= 3;
  });
  estScore = Math.max(10, estScore);

  // Estimate CWV from available data
  const estLCP = Math.max(1.5, (pageSize / 200000) * 2 + (blockingCSS + blockingJS) * 0.3 + (ttfb / 1000) * 0.5).toFixed(2);
  const estCLS = imagesNoLazy > 10 ? '0.25' : imagesNoLazy > 3 ? '0.15' : '0.05';
  const estFID = totalScripts > 20 ? '0.15' : totalScripts > 10 ? '0.08' : '0.03';

  return {
    ok: true,
    url,
    strategy,
    score: estScore,
    metrics: {
      lcp: estLCP,
      fid: estFID,
      cls: estCLS,
      fcp: Math.max(0.8, parseFloat(estLCP) * 0.6).toFixed(2),
      ttfb: ttfb,
      tbt: (totalScripts * 0.03).toFixed(2),
      si: (parseFloat(estLCP) * 1.3).toFixed(2),
      tti: (parseFloat(estLCP) * 1.8).toFixed(2)
    },
    fieldData: null,
    opportunities: issues.map(i => ({
      title: i.title,
      desc: i.desc,
      savingsMs: i.severity === 'high' ? 1500 : i.severity === 'medium' ? 700 : 300,
      score: i.severity === 'high' ? 0.3 : 0.6
    })),
    source: 'fallback_analysis',
    note: 'Skor estimasi berdasarkan analisis HTML. Untuk data Lighthouse akurat, tambahkan PSI_API_KEY.'
  };
}
