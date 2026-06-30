// POST /analyze -> Analyze domain + generate action items to boost DA/PA/DR
// Flow: 1) Get current metrics (DA/PA/DR) 2) Ahrefs backlink profile 3) Find guest post opps 4) Generate checklist

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
  const domain = String(body.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

  if (!domain) {
    return new Response(JSON.stringify({ ok: false, error: 'Domain required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1) Get current metrics via /check internal call
    const metricsRes = await fetch(`${new URL(request.url).origin}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [domain], cf_token: body.cf_token || '' })
    });

    let currentMetrics = { da: null, pa: null, dr: null, ss: null };
    if (metricsRes.ok && metricsRes.body) {
      const reader = metricsRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'result' && ev.url === domain) {
              currentMetrics = {
                da: ev.domain_authority,
                pa: ev.page_authority,
                dr: ev.domain_rating,
                ss: ev.spam_score
              };
            }
          } catch (_) {}
        }
      }
    }

    // 2) Ahrefs free tier: get top backlinks + referring domains
    // Ahrefs Site Explorer free: https://ahrefs.com/backlink-checker → scrape or use unofficial API
    // For now: mock data (lo bisa integrate real Ahrefs scraper later)
    const backlinks = await getAhrefsBacklinks(domain, env);

    // 3) Find guest post opportunities in same niche
    const niche = await extractNiche(domain, env); // scrape homepage title/meta
    const guestPosts = await findGuestPosts(niche, env);

    // 4) Generate action items
    const actionItems = generateActionItems(currentMetrics, backlinks, guestPosts, domain);

    return new Response(JSON.stringify({
      ok: true,
      domain,
      current: currentMetrics,
      benchmark: { da: 40, pa: 35, dr: 30 }, // mock: average of top 10 competitors
      action_items: actionItems,
      backlinks: backlinks.slice(0, 10), // top 10 backlinks
      guest_posts: guestPosts.slice(0, 5) // top 5 guest post opps
    }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}

async function getAhrefsBacklinks(domain, env) {
  // TODO: integrate real Ahrefs scraper or API
  // For now: mock data
  return [
    { url: 'https://example.com/blog/seo-tips', dr: 65, anchor: 'SEO guide', dofollow: true },
    { url: 'https://another.com/resources', dr: 58, anchor: domain, dofollow: true },
    { url: 'https://highdr.io/tools', dr: 72, anchor: 'best tools', dofollow: false }
  ];
}

async function extractNiche(domain, env) {
  // Scrape homepage title/meta to guess niche
  try {
    const res = await fetch(`https://${domain}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].toLowerCase() : '';
    // Simple keyword extraction
    if (title.includes('seo')) return 'seo';
    if (title.includes('marketing')) return 'digital marketing';
    if (title.includes('tech')) return 'technology';
    return 'general';
  } catch (_) {
    return 'general';
  }
}

async function findGuestPosts(niche, env) {
  // Mock: call /guest-posts internally or return dummy
  return [
    { domain: 'authority-blog.com', dr: 68, signal: 'write for us', email: 'editor@authority-blog.com' },
    { domain: 'niche-magazine.com', dr: 55, signal: 'guest post', email: 'contact@niche-magazine.com' }
  ];
}

function generateActionItems(current, backlinks, guestPosts, domain) {
  const items = [];

  // Priority 1: Get backlinks from high-DR guest posts
  if (guestPosts.length > 0) {
    items.push({
      priority: 'high',
      category: 'Backlink Acquisition',
      action: `Pitch ${guestPosts.length} guest post opportunities (DR 50+)`,
      impact: '+5-10 DR per accepted post',
      effort: 'Medium',
      details: guestPosts.map(g => `${g.domain} (DR${g.dr}) - ${g.email}`)
    });
  }

  // Priority 2: Replicate competitor backlinks
  const highDrBacklinks = backlinks.filter(b => b.dr > 60 && b.dofollow);
  if (highDrBacklinks.length > 0) {
    items.push({
      priority: 'high',
      category: 'Competitor Analysis',
      action: `Target ${highDrBacklinks.length} high-DR sites linking to competitors`,
      impact: '+3-8 DR per successful outreach',
      effort: 'High',
      details: highDrBacklinks.map(b => `${b.url} (DR${b.dr})`)
    });
  }

  // Priority 3: Fix on-page SEO
  if (current.ss > 10) {
    items.push({
      priority: 'medium',
      category: 'Technical SEO',
      action: 'Reduce spam score (currently ' + current.ss + '%)',
      impact: 'Improves trust signals, indirect DA boost',
      effort: 'Low',
      details: ['Remove low-quality outbound links', 'Disavow toxic backlinks', 'Add SSL if missing']
    });
  }

  // Priority 4: Content gaps
  items.push({
    priority: 'medium',
    category: 'Content Strategy',
    action: 'Publish 5+ in-depth articles (2000+ words)',
    impact: '+2-5 PA, attracts natural backlinks',
    effort: 'High',
    details: ['Target long-tail keywords', 'Add internal links', 'Optimize meta titles']
  });

  // Priority 5: HARO / PR
  items.push({
    priority: 'low',
    category: 'PR & Mentions',
    action: 'Respond to 10 journalist queries (HARO/Featured)',
    impact: '+1-3 DR per featured mention',
    effort: 'Medium',
    details: ['Check /dr-booster daily', 'Pitch within 24h of query', 'Include expert quote']
  });

  return items;
}
