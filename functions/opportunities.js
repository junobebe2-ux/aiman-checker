// Cloudflare Pages Function: GET/POST /opportunities
// Returns real, well-known sites that accept guest posts / directory / profile links,
// optionally filtered by niche. DA/DR are NOT stored here — the client pulls them LIVE
// via /check + /dr so every number shown is real.
//
// When BRIGHTDATA_TOKEN (Web Unlocker product) is configured, ?dynamic=1 also runs a live
// SERP discovery for "<niche> write for us" and merges fresh domains in.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

// Curated real opportunities. type: guest|directory|profile|forum|q&a
// niches: tech, business, marketing, health, finance, lifestyle, general
const SEED = [
  // High-authority general / business "write for us" & contributor platforms
  { domain: 'medium.com', type: 'guest', niches: ['general','tech','business','marketing','lifestyle'], note: 'Open publishing, instant dofollow-ish, huge reach' },
  { domain: 'dev.to', type: 'guest', niches: ['tech'], note: 'Developer community, free posting' },
  { domain: 'hashnode.com', type: 'guest', niches: ['tech'], note: 'Dev blogging, canonical links allowed' },
  { domain: 'substack.com', type: 'guest', niches: ['general','business','marketing'], note: 'Newsletter platform' },
  { domain: 'linkedin.com', type: 'profile', niches: ['general','business','marketing'], note: 'Articles + profile link, very high DA' },
  { domain: 'quora.com', type: 'q&a', niches: ['general','tech','business','health','finance'], note: 'Answer questions w/ contextual link' },
  { domain: 'reddit.com', type: 'forum', niches: ['general','tech','business','lifestyle'], note: 'Subreddit posts, mostly nofollow but traffic' },
  { domain: 'tumblr.com', type: 'profile', niches: ['general','lifestyle'], note: 'Microblog, easy backlink' },
  { domain: 'blogger.com', type: 'profile', niches: ['general'], note: 'Free Google-owned blog' },
  { domain: 'wordpress.com', type: 'profile', niches: ['general'], note: 'Free blog subdomain' },
  { domain: 'wix.com', type: 'profile', niches: ['general'], note: 'Free site builder profile' },
  { domain: 'weebly.com', type: 'profile', niches: ['general'], note: 'Free site builder' },
  { domain: 'github.com', type: 'profile', niches: ['tech'], note: 'README / profile / pages link, DA 96' },
  { domain: 'gitlab.com', type: 'profile', niches: ['tech'], note: 'Profile + pages' },
  { domain: 'about.me', type: 'profile', niches: ['general'], note: 'Personal profile page' },
  { domain: 'behance.net', type: 'profile', niches: ['lifestyle','marketing'], note: 'Portfolio, Adobe-owned high DA' },
  { domain: 'dribbble.com', type: 'profile', niches: ['lifestyle','marketing'], note: 'Design portfolio' },
  { domain: 'producthunt.com', type: 'profile', niches: ['tech','business'], note: 'Product listing + maker profile' },
  { domain: 'slideshare.net', type: 'directory', niches: ['general','business'], note: 'Upload decks w/ link' },
  { domain: 'issuu.com', type: 'directory', niches: ['general'], note: 'Publish docs' },
  { domain: 'scribd.com', type: 'directory', niches: ['general'], note: 'Document sharing' },
  // Q&A / community
  { domain: 'stackoverflow.com', type: 'profile', niches: ['tech'], note: 'Profile link (earn rep first)' },
  { domain: 'stackexchange.com', type: 'profile', niches: ['tech','general'], note: 'Network profile' },
  { domain: 'disqus.com', type: 'profile', niches: ['general'], note: 'Comment profile' },
  // Business directories
  { domain: 'crunchbase.com', type: 'directory', niches: ['business','tech'], note: 'Company profile, high DA' },
  { domain: 'g2.com', type: 'directory', niches: ['business','tech'], note: 'Software listing' },
  { domain: 'capterra.com', type: 'directory', niches: ['business','tech'], note: 'Software directory' },
  { domain: 'trustpilot.com', type: 'directory', niches: ['business'], note: 'Reviews + profile' },
  { domain: 'yelp.com', type: 'directory', niches: ['business','lifestyle'], note: 'Local business listing' },
  { domain: 'angel.co', type: 'directory', niches: ['business','tech'], note: 'Startup profile (wellfound)' },
  // Content / niche guest
  { domain: 'hackernoon.com', type: 'guest', niches: ['tech','business'], note: 'Tech publishing, contributor' },
  { domain: 'thriveglobal.com', type: 'guest', niches: ['health','lifestyle'], note: 'Wellness contributor' },
  { domain: 'entrepreneur.com', type: 'guest', niches: ['business'], note: 'Contributor network (selective)' },
  { domain: 'forbes.com', type: 'guest', niches: ['business','finance'], note: 'Council/contributor (selective, very high DA)' },
  { domain: 'businessinsider.com', type: 'guest', niches: ['business','finance'], note: 'Contributor (selective)' },
  { domain: 'searchenginejournal.com', type: 'guest', niches: ['marketing'], note: 'SEO/marketing guest' },
  { domain: 'semrush.com', type: 'guest', niches: ['marketing'], note: 'Blog contributor program' },
  { domain: 'smashingmagazine.com', type: 'guest', niches: ['tech'], note: 'Web dev/design guest' },
  { domain: 'css-tricks.com', type: 'guest', niches: ['tech'], note: 'Front-end guest' },
  { domain: 'healthline.com', type: 'guest', niches: ['health'], note: 'Health (selective)' },
  { domain: 'investopedia.com', type: 'guest', niches: ['finance'], note: 'Finance (selective)' },
  // Web 2.0 / free high-DA
  { domain: 'notion.so', type: 'profile', niches: ['general','tech'], note: 'Public page link' },
  { domain: 'gravatar.com', type: 'profile', niches: ['general'], note: 'Profile w/ link' },
  { domain: 'flickr.com', type: 'profile', niches: ['lifestyle'], note: 'Photo profile' },
  { domain: 'vimeo.com', type: 'profile', niches: ['general'], note: 'Video profile' },
  { domain: 'soundcloud.com', type: 'profile', niches: ['lifestyle'], note: 'Audio profile' },
  { domain: 'goodreads.com', type: 'profile', niches: ['lifestyle'], note: 'Author/reader profile' },
  { domain: 'pinterest.com', type: 'profile', niches: ['lifestyle','marketing'], note: 'Pin w/ link, traffic driver' }
];

async function brightdataSerp(token, query) {
  // Web Unlocker style: POST to BrightData API. Adjust to actual product on first real token.
  try {
    const res = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone: 'serp',
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`,
        format: 'raw'
      })
    });
    if (!res.ok) return [];
    const html = await res.text();
    const domains = new Set();
    const re = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\//gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const d = m[1].toLowerCase().replace(/^www\./, '');
      if (!/google|gstatic|youtube|schema|w3\.org/.test(d)) domains.add(d);
    }
    return [...domains].slice(0, 20).map(domain => ({ domain, type: 'guest', niches: ['dynamic'], note: 'Live SERP discovery' }));
  } catch (e) { return []; }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

async function handle(niche, query, dynamic, env) {
  let list = SEED;
  if (niche && niche !== 'all') {
    list = SEED.filter(s => s.niches.includes(niche) || s.niches.includes('general'));
  }
  let dynamicSites = [];
  if (dynamic && env.BRIGHTDATA_TOKEN && query) {
    dynamicSites = await brightdataSerp(env.BRIGHTDATA_TOKEN, `${query} "write for us" OR "guest post" OR "contribute"`);
  }
  const seen = new Set();
  const merged = [...dynamicSites, ...list].filter(s => {
    if (seen.has(s.domain)) return false;
    seen.add(s.domain); return true;
  });
  return new Response(JSON.stringify({
    success: true,
    count: merged.length,
    brightdata: !!(env.BRIGHTDATA_TOKEN),
    dynamic_used: dynamicSites.length > 0,
    opportunities: merged
  }), { status: 200, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const u = new URL(request.url);
  return handle(u.searchParams.get('niche') || 'all', u.searchParams.get('q') || '', u.searchParams.get('dynamic') === '1', env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  return handle(body.niche || 'all', body.q || '', !!body.dynamic, env);
}
