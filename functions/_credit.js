// functions/_credit.js — Shared credit tracking & rate limit engine
// Works across endpoints via in-memory (resets on deploy)
// Import: import { checkRateLimit, checkCredit, consumeCredit, enrich } from './_credit.js';

// Per-IP rate limit store: "ip:endpoint:hour" externKey -> { count, ts }
const rateStore = new Map();

// Credit usage: service -> { hour, used, cap }
const creditStore = new Map();

function getCreditHour() {
  return Math.floor(Date.now() / 3600000);
}

// Expose current credit state for admin dashboard
export const credits = {
  get twocaptcha() {
    const hour = getCreditHour();
    let rec = creditStore.get('twocaptcha');
    if (!rec || rec.hour !== hour) { rec = { hour, used: 0, cap: 30 }; creditStore.set('twocaptcha', rec); }
    return rec;
  },
  get brightdata() {
    const hour = getCreditHour();
    let rec = creditStore.get('brightdata');
    if (!rec || rec.hour !== hour) { rec = { hour, used: 0, cap: 50 }; creditStore.set('brightdata', rec); }
    return rec;
  }
};

function getRateKey(ip, endpoint) {
  return `${ip}:${endpoint}:${getCreditHour()}`;
}

// ---- Bot Detection ----
export function detectBot(request) {
  let score = 0;
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const accept = (request.headers.get('accept') || '').toLowerCase();

  if (!ua || ua.length < 10 || ua === 'undefined') score += 40;
  if (/bot|crawl|spider|scrap|python|curl|wget|http|urllib|java\|go-http|aria|fetch[\/:]|axios|node|spring/i.test(ua)) score += 35;
  if (/okhttp|ionic|expo|react-native|flutter|webview|headless|selenium|phantom|playwright/i.test(ua)) score += 25;
  if (!accept.includes('text/html')) score += 15;
  if (!request.headers.get('accept-language')) score += 10;
  if (!request.headers.get('sec-fetch-dest')) score += 10;

  const cfThreat = request.headers.get('cf-threat') || '';
  if (cfThreat.includes('bot')) score += 30;
  if (cfThreat.includes('ai')) score += 20;

  return Math.min(100, score);
}

// ---- Rate Limiting ----
export function checkRateLimit(ip, endpoint, isAuthed = false) {
  const key = getRateKey(ip, endpoint);
  let rec = rateStore.get(key);
  if (!rec) { rec = { count: 0 }; rateStore.set(key, rec); }

  const maxReq = isAuthed ? 30 : 6;
  if (rec.count >= maxReq) {
    return { allowed: false, remaining: 0, reason: 'hourly' };
  }
  rec.count++;
  return { allowed: true, remaining: maxReq - rec.count };
}

// ---- Credit Budget ----
export function checkCredit(service) {
  const hour = getCreditHour();
  let rec = creditStore.get(service);
  if (!rec || rec.hour !== hour) {
    rec = { hour, used: 0, cap: service === 'brightdata' ? 50 : 30 };
    creditStore.set(service, rec);
  }
  return {
    allowed: rec.used < rec.cap,
    remaining: rec.cap - rec.used,
    used: rec.used,
    cap: rec.cap
  };
}

export function consumeCredit(service, amount = 1) {
  const budget = checkCredit(service);
  const hour = getCreditHour();
  let rec = creditStore.get(service);
  if (!rec || rec.hour !== hour) {
    rec = { hour, used: 0, cap: service === 'brightdata' ? 50 : 30 };
    creditStore.set(service, rec);
  }
  rec.used += amount;
  return { ...budget, used: rec.used, remaining: rec.cap - rec.used };
}

// ---- Request Enrichment ----
export function enrich(request) {
  const ip = (request.headers.get('cf-connecting-ip') || 'unknown').replace(/^[^:]+:/, '');
  const botScore = detectBot(request);
  return { ip, botScore };
}
