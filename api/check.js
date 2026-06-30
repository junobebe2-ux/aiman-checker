/**
 * AIMAN CHECKER — API Proxy with auth & role-based limits
 * Backend: dachecker.io API (real Moz DA/PA/SS data)
 */
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { checkLimit, getLimits } from './limits.js';

const JWT_SECRET = '"aiman-checker-secret-key-2024"';
const USERS_PATH = '/tmp/users.json';
// Backend URL from Vercel env var (auto-updated by cron)
const EC2_SCRAPER = process.env.EC2_SCRAPER || 'https://concentrations-contain-rays-hans.trycloudflare.com';
const DACHECKER_API = `${EC2_SCRAPER}/api/da-pa-check`;

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
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 25000);
  try {
    const response = await fetch(`${DACHECKER_API}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: urls }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      if (data && data.results) {
        return {
          results: data.results.map(r => ({
            url: r.domain || r.url,
            domain_authority: r.da || r.domain_authority,
            page_authority: r.pa || r.page_authority,
            spam_score: r.ss !== undefined ? r.ss : r.spam_score,
            source: 'dachecker.io',
            status: 'success'
          }))
        };
      }
    }
  } catch (e) {
    console.error('dachecker.io failed:', e.message);
  }
  clearTimeout(timeout);
  return null;
}

export const handler = async (event, context) => {
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
      source: r.source || 'dachecker.io',
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