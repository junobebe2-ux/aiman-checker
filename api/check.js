/**
 * AIMAN CHECKER — API Proxy with auth & role-based limits
 * Backend: EC2 scraper (dachecker.io API)
 * DA/PA from Moz, SS calculated from DA metrics
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { checkLimit, getLimits } = require('./limits');

const JWT_SECRET = process.env.JWT_SECRET || 'aiman-checker-jwt-secret-change-in-production-2024';
const USERS_PATH = '/tmp/users.json';
const EC2_SCRAPER = 'https://attract-blair-indicated-valves.trycloudflare.com'; // Hardcoded - cron auto-update // v2-tunnel

function calculateSpamScore(da) {
  const estimatedMozSpam = Math.max(1, Math.round(15 - da * 0.15));
  return Math.round(estimatedMozSpam * 100 / 18.75);
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function verifyAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { role: 'guest', user: null };
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    if (user) {
      const today = new Date().toISOString().slice(0, 10);
      if (user.usage.date !== today) {
        user.usage.today = 0;
        user.usage.date = today;
      }
      return { role: user.role, user, limits: getLimits(user.role) };
    }
  } catch (e) {}
  return { role: 'guest', user: null, limits: getLimits('guest') };
}

function saveUserUsage(user) {
  try {
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx].usage = user.usage;
      fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
    }
  } catch (e) {}
}

async function callScraper(urls) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${EC2_SCRAPER}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    return await response.json();
  } catch (e) {
    clearTimeout(timeout);
    console.error('Scraper error:', e.message);
    return null;
  }
}

exports.handler = async (event, context) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const { role, user } = verifyAuth(authHeader);
    const body = JSON.parse(event.body);
    const urls = body.urls || [];
    if (!urls.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'urls required' }) };
    }
    const canCheck = checkLimit(role, user, urls.length);
    if (!canCheck.allowed) {
      return { statusCode: 429, body: JSON.stringify({ error: canCheck.message, limit: canCheck.limit, used: canCheck.used }) };
    }
    const scraperResult = await callScraper(urls);
    if (!scraperResult || !scraperResult.results) {
      return { statusCode: 502, body: JSON.stringify({ error: 'scraper unavailable' }) };
    }
    const results = scraperResult.results.map(r => ({
      url: r.url,
      domain_authority: r.domain_authority,
      page_authority: r.page_authority,
      spam_score: r.spam_score !== undefined ? r.spam_score : calculateSpamScore(r.domain_authority),
      source: r.source || 'dapachecker.org',
      status: r.status
    }));
    if (user) {
      user.usage.today += urls.length;
      saveUserUsage(user);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, total: urls.length, checked: results.length, results })
    };
  } catch (e) {
    console.error('Error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
