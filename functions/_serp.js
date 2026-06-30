// Shared SERP helper — Google search via BrightData Web Unlocker.
// Reliable (no DDG anomaly), passes through CF Worker subrequest budget cleanly.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function stripTags(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function normDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch (_) { return null; }
}

// Hard junk filter — search engines + giants we'll never use as backlink targets
const SERP_BLOCK = [
  'google.', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'linkedin.com', 'pinterest.com', 'reddit.com',
  'wikipedia.org', 'duckduckgo.com', 'bing.com', 'yahoo.', 'quora.com',
  'medium.com', 'tumblr.com', 'tiktok.com', 'amazon.', 'ebay.com',
  'gstatic.com', 'googleusercontent.com', 'wikimedia.org', 'schema.org',
  'w3.org', 'archive.org', 'apple.com', 'microsoft.com'
];
export function isJunk(domain) {
  if (!domain) return true;
  return SERP_BLOCK.some(b => domain.includes(b));
}

// Parse Google SERP HTML for organic result links
export function parseGoogleSerp(html) {
  const results = [];
  const seen = new Set();

  // Strategy 1: anchor with /url?q= wrapper (classic Google)
  const a1 = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = a1.exec(html)) !== null) {
    let raw = decodeURIComponent(m[1]);
    if (!raw.startsWith('http')) continue;
    const dom = normDomain(raw);
    if (!dom || isJunk(dom)) continue;
    const title = stripTags(m[2]).slice(0, 200);
    if (!title || title.length < 5) continue;
    const key = raw;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ url: raw, domain: dom, title, snippet: '' });
  }

  // Strategy 2: direct https?:// anchors (newer SERP)
  if (results.length < 5) {
    const a2 = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = a2.exec(html)) !== null) {
      const raw = m[1];
      const dom = normDomain(raw);
      if (!dom || isJunk(dom)) continue;
      const title = stripTags(m[2]).slice(0, 200);
      if (!title || title.length < 10) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      results.push({ url: raw, domain: dom, title, snippet: '' });
      if (results.length >= 40) break;
    }
  }

  // Pull snippets where available and pair by index
  const snipRe = /<div[^>]+class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  const snips = [];
  while ((m = snipRe.exec(html)) !== null) snips.push(stripTags(m[1]).slice(0, 280));
  for (let i = 0; i < results.length && i < snips.length; i++) results[i].snippet = snips[i];

  return results;
}

// Fetch a Google SERP via BrightData Web Unlocker
export async function googleSerp(token, query, num = 20) {
  if (!token) throw new Error('BRIGHTDATA_TOKEN not set');
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&hl=en`;
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: 'web_unlocker1', url, format: 'raw' })
  });
  if (!res.ok) throw new Error(`BrightData ${res.status}`);
  const html = await res.text();
  return parseGoogleSerp(html);
}
