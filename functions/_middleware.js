// Cloudflare Pages Function Middleware: functions/_middleware.js
// Runs on every request before page/function handler
// Adds: bot detection, request logging, per-IP rate limit

// In-memory stores (reset on deploy / worker recycle)
const ipHistory = new Map();   // ip -> [{ts, path, score}]
const botBlocked = new Set();  // Set<ip> auto-blocked

function getHour() {
  return Math.floor(Date.now() / 3600000);
}

function getHourKey(ip) {
  return `${ip}:${getHour()}`;
}

// Simple bot score (0-100). 0 = human, 100 = definite bot
function scoreBot(request) {
  let score = 0;
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const accept = request.headers.get('accept');
  const acceptLC = (accept || '').toLowerCase();

  if (!ua || ua.length < 10 || ua === 'undefined') score += 40;
  if (/bot|crawl|spider|scrap|python|curl|wget|http|urllib|java\|go-http|aria|fetch[\/:]|axios|node|spring/i.test(ua)) score += 35;
  if (/okhttp|ionic|expo|react-native|flutter|webview|headless|selenium|phantom|playwright/i.test(ua)) score += 25;
  if (!acceptLC.includes('text/html')) score += 15;
  if (!request.headers.get('accept-language')) score += 10;
  if (!request.headers.get('sec-fetch-dest')) score += 10;

  // Has CF threat signal
  const cfThreat = request.headers.get('cf-threat') || '';
  if (cfThreat.includes('bot')) score += 30;
  if (cfThreat.includes('ai')) score += 20;

  return Math.min(100, score);
}

// Count requests in last 60s from this IP
function requestRate(ip) {
  const now = Date.now();
  const h = ipHistory.get(ip) || [];
  const recent = h.filter(e => now - e.ts < 60000);
  ipHistory.set(ip, recent);
  return recent.length;
}

// Log request to history
function logReq(ip, path, botScore) {
  const h = ipHistory.get(ip) || [];
  h.push({ ts: Date.now(), path, score: botScore });
  if (h.length > 100) h.shift();
  ipHistory.set(ip, h);
}

export async function onRequest(context) {
  const { request } = context;
  const ip = (request.headers.get('cf-connecting-ip') || 'unknown').replace(/^[^:]+:/, '');
  const url = new URL(request.url);
  const botScore = scoreBot(request);

  logReq(ip, url.pathname, botScore);

  // BLOCK: extremely suspicious
  if (botScore >= 80) {
    botBlocked.add(ip);
    return new Response(JSON.stringify({
      ok: false,
      error: 'Akses ditolak: pola traffic mencurigakan'
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // BLOCK: bot swarm ( >20 req/min dari 1 IP = Auto API abuse detector )
  const rate = requestRate(ip);
  if (rate > 20) {
    botBlocked.add(ip);
    return new Response(JSON.stringify({
      ok: false,
      error: 'Rate limit terlampaui. Tunggu 60 detik.'
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' }
    });
  }

  // SUSPICIOUS: botScore 50-79 → delay response (slow them down)
  if (botScore >= 50 && botScore < 80) {
    const delay = 3000 + Math.floor(Math.random() * 2000);
    await new Promise(r => setTimeout(r, delay));
  }

  return context.next();
}
