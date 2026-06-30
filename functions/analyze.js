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
    const backlinks = await getAhrefsBacklinks(domain, env);

    // 3) Find broken backlinks (404/dead links from competitors)
    const brokenLinks = await findBrokenBacklinks(backlinks, env);

    // 4) Find guest post opportunities in same niche
    const niche = await extractNiche(domain, env); // scrape homepage title/meta
    const guestPosts = await findGuestPosts(niche, env);

    // 5) Content gap analysis vs competitors
    const contentGaps = await analyzeContentGaps(domain, niche, env);

    // 6) Generate action items
    const actionItems = generateActionItems(currentMetrics, backlinks, guestPosts, brokenLinks, contentGaps, domain);

    return new Response(JSON.stringify({
      ok: true,
      domain,
      current: currentMetrics,
      benchmark: { da: 40, pa: 35, dr: 30 }, // mock: average of top 10 competitors
      content_gaps: contentGaps.gaps,
      action_items: actionItems,
      backlinks: backlinks.slice(0, 10), // top 10 backlinks
      broken_links: brokenLinks.slice(0, 5), // top 5 broken opportunities
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
  // Scrape Ahrefs free backlink checker via BrightData Web Unlocker
  const BRIGHTDATA_API = 'https://api.brightdata.com/request';
  const ahrefsUrl = `https://ahrefs.com/backlink-checker?input=${encodeURIComponent(domain)}&mode=subdomains`;
  
  try {
    const res = await fetch(BRIGHTDATA_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.BRIGHTDATA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        zone: 'web_unlocker1',
        url: ahrefsUrl,
        format: 'raw'
      })
    });

    if (!res.ok) throw new Error('BrightData failed: ' + res.status);
    const html = await res.text();

    // Parse backlinks from Ahrefs HTML
    // Structure: <table class="backlinks-table"> → <tr> → <td>
    const backlinks = [];
    const rows = html.match(/<tr[^>]*data-backlink[^>]*>[\s\S]*?<\/tr>/gi) || [];
    
    for (const row of rows.slice(0, 20)) { // top 20
      const urlMatch = row.match(/href="([^"]+)"/);
      const drMatch = row.match(/data-dr="(\d+)"/);
      const anchorMatch = row.match(/data-anchor="([^"]+)"/);
      const dofollowMatch = row.match(/data-dofollow="(true|false)"/);
      
      if (urlMatch) {
        backlinks.push({
          url: urlMatch[1],
          dr: drMatch ? parseInt(drMatch[1]) : 0,
          anchor: anchorMatch ? anchorMatch[1] : domain,
          dofollow: dofollowMatch ? dofollowMatch[1] === 'true' : false
        });
      }
    }

    return backlinks.length > 0 ? backlinks : getFallbackBacklinks(domain);
  } catch (err) {
    console.error('Ahrefs scrape failed:', err.message);
    return getFallbackBacklinks(domain);
  }
}

function getFallbackBacklinks(domain) {
  // Fallback mock data kalau scrape gagal
  return [
    { url: 'https://example.com/blog/seo-tips', dr: 65, anchor: 'SEO guide', dofollow: true },
    { url: 'https://another.com/resources', dr: 58, anchor: domain, dofollow: true }
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

async function findBrokenBacklinks(backlinks, env) {
  // Check each backlink URL untuk status 404/5xx
  const broken = [];
  const batch = backlinks.slice(0, 10); // limit 10 untuk avoid timeout
  
  await Promise.all(batch.map(async (link) => {
    try {
      const res = await fetch(link.url, { 
        method: 'HEAD', 
        redirect: 'follow',
        signal: AbortSignal.timeout(5000) // 5s timeout
      });
      if (res.status === 404 || res.status >= 500) {
        broken.push({ ...link, status: res.status });
      }
    } catch (err) {
      // Timeout or network error = potentially broken
      broken.push({ ...link, status: 'timeout', error: err.message });
    }
  }));

  return broken;
}

async function analyzeContentGaps(domain, niche, env) {
  // Compare domain vs top 3 competitors in niche
  // 1) Scrape homepage word count + internal links
  // 2) Google SERP top 3 for niche keyword → scrape their stats
  // 3) Return gaps
  
  try {
    const yourSite = await analyzePageContent(`https://${domain}`, env);
    
    // Get top 3 competitors from Google SERP
    const competitors = await getTopCompetitors(niche, env);
    const competitorStats = await Promise.all(
      competitors.slice(0, 3).map(url => analyzePageContent(url, env))
    );
    
    const avgWords = competitorStats.reduce((sum, c) => sum + c.wordCount, 0) / competitorStats.length;
    const avgLinks = competitorStats.reduce((sum, c) => sum + c.internalLinks, 0) / competitorStats.length;
    
    return {
      your: yourSite,
      competitors: competitorStats,
      gaps: {
        wordCount: Math.max(0, Math.round(avgWords - yourSite.wordCount)),
        internalLinks: Math.max(0, Math.round(avgLinks - yourSite.internalLinks)),
        missingKeywords: [] // TODO: keyword gap analysis
      }
    };
  } catch (err) {
    console.error('Content gap analysis failed:', err.message);
    return { gaps: { wordCount: 0, internalLinks: 0, missingKeywords: [] } };
  }
}

async function analyzePageContent(url, env) {
  try {
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    const html = await res.text();
    
    // Extract text content (strip HTML tags)
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ');
    
    const wordCount = text.trim().split(/\s+/).length;
    const internalLinks = (html.match(/<a[^>]+href="[^"]*"/gi) || []).length;
    
    return { url, wordCount, internalLinks };
  } catch (err) {
    return { url, wordCount: 0, internalLinks: 0, error: err.message };
  }
}

async function getTopCompetitors(niche, env) {
  // Google SERP top 10 for niche keyword
  // Mock: return dummy URLs (integrate real SERP scraper later)
  return [
    'https://competitor1.com',
    'https://competitor2.com',
    'https://competitor3.com'
  ];
}

function generateActionItems(current, backlinks, guestPosts, brokenLinks, contentGaps, domain) {
  const items = [];

  // Priority 1: Claim broken backlinks (easy wins)
  if (brokenLinks.length > 0) {
    items.push({
      priority: 'high',
      category: 'Broken Link Building',
      action: `Reclaim ${brokenLinks.length} broken backlinks pointing to competitors`,
      impact: '+2-5 DR per recovered link (easy wins)',
      effort: 'Low',
      details: brokenLinks.map(b => `${b.url} (DR${b.dr}) - Status: ${b.status}`)
    });
  }

  // Priority 2: Get backlinks from high-DR guest posts
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

  // Priority 3: Content gaps (word count, internal links)
  const gaps = contentGaps.gaps || {};
  if (gaps.wordCount > 0 || gaps.internalLinks > 0) {
    const actions = [];
    if (gaps.wordCount > 500) actions.push(`Add ${gaps.wordCount} words to match competitor average`);
    if (gaps.internalLinks > 5) actions.push(`Add ${gaps.internalLinks} internal links for better structure`);
    
    items.push({
      priority: 'medium',
      category: 'Content Optimization',
      action: 'Close content gaps vs top 3 competitors',
      impact: '+2-5 PA, better user signals',
      effort: 'Medium',
      details: actions
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
