/**
 * AIMAN CHECKER — API Proxy with auth & role-based limits
 */
const API_URL = "https://app.dapachecker.tools/get-domain-metrics";
const BATCH_SIZE = 50;
const REQ_DELAY_MS = 3000;
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { checkLimit, getLimits } = require('./limits');

var JWT_SECRET = (process.env.JWT_SECRET) || 'aiman-checker-jwt-secret-change-in-production-2024';
const USERS_PATH = '/tmp/users.json';

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
      // Reset daily usage if new day
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

// Parse proxy list from env
function getProxyAgents() {
  const raw = process.env.PROXY_LIST || "";
  if (!raw) return [];
  return raw.split(",").map(entry => {
    const [host, port, user, pass] = entry.trim().split(":");
    return { host, port, user, pass };
  });
}

function rotateProxy(proxies, index) {
  if (!proxies.length) return null;
  const p = proxies[index % proxies.length];
  return {
    url: "http://" + p.user + ":" + p.pass + "@" + p.host + ":" + p.port,
    host: p.host,
    port: p.port
  };
}

async function fetchWithProxy(urls, proxyConfig) {
  const body = JSON.stringify({ urls });
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://dapa-checker.com",
      "Referer": "https://dapa-checker.com/",
      "User-Agent": "Mozilla/5.0 (compatible; AIMANChecker/1.0)"
    },
    body
  };

  if (proxyConfig) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent(proxyConfig.url);
    const fetchWithProxy = (await import("node-fetch")).default;
    const resp = await fetchWithProxy(API_URL, { ...options, agent });
    return resp;
  } else {
    const resp = await fetch(API_URL, options);
    return resp;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Send { urls: [...] }" });
  }

  // Normalize
  urls = urls.map(u => {
    u = (u || "").trim();
    if (u && !u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
    return u;
  }).filter(Boolean);

  if (urls.length === 0) return res.status(400).json({ error: "No valid URLs" });

  // ---- AUTH & ROLE-BASED LIMITS ----
  const authResult = verifyAuth(req.headers.authorization);
  const role = authResult.role;
  const user = authResult.user;
  const limits = authResult.limits || getLimits(role);

  // Check limit for this request
  const limitCheck = checkLimit(role, urls.length);
  if (!limitCheck.allowed) {
    return res.status(403).json({
      error: "plan_limit_exceeded",
      message: limitCheck.message,
      plan: role,
      plan_label: limits.label,
      plan_limit: limitCheck.limit,
      your_count: limitCheck.yourCount,
      upgrade_url: "/pricing.html"
    });
  }

  // Track usage for logged-in users
  if (user) {
    user.usage.today += urls.length;
    user.usage.total = (user.usage.total || 0) + urls.length;
    saveUserUsage(user);
  }

  // ---- PROXY / PREMIUM LOGIC ----
  const proxies = getProxyAgents();
  const isPremium = proxies.length > 0 && (role === 'pro' || role === 'business' || role === 'admin');
  const maxBatches = isPremium ? Math.ceil(urls.length / BATCH_SIZE) + 5 : Math.min(2, Math.ceil(urls.length / BATCH_SIZE));
  const total = urls.length;
  const allResults = [];
  const errors = [];
  let proxyIndex = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (batchNum > maxBatches) {
      errors.push("Plan limit: " + maxBatches + " batches (" + (maxBatches * BATCH_SIZE) + " URLs) allowed");
      break;
    }

    const batch = urls.slice(i, i + BATCH_SIZE);
    const proxyConfig = isPremium ? rotateProxy(proxies, proxyIndex++) : null;

    try {
      const response = isPremium
        ? await fetchWithProxy(batch, proxyConfig)
        : await fetch(API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Origin": "https://dapa-checker.com",
              "Referer": "https://dapa-checker.com/",
              "User-Agent": "Mozilla/5.0 (compatible; AIMANChecker/1.0)"
            },
            body: JSON.stringify({ urls: batch })
          });

      if (!response.ok) {
        const text = await response.text();
        throw new Error("API " + response.status + ": " + text);
      }

      const data = await response.json();
      allResults.push(...data);

      if (i + BATCH_SIZE < total) {
        await new Promise(r => setTimeout(r, REQ_DELAY_MS));
      }
    } catch (err) {
      errors.push("Batch " + batchNum + ": " + err.message);
      if (!isPremium) break;
    }
  }

  // Extract key metrics - convert mozSpam (Moz v1: 0-17) to percentage (0-100)
  const metrics = allResults.map(r => {
    const raw = parseFloat(String(r.mozSpam || "0").replace('%', '').trim()) || 0;
    // Moz Spam Score v1 uses 17 flags → convert to 0-100 percentage
    const spamPct = Math.round((raw / 17) * 100);
    return {
    domain: r.domain || "",
    DA: r.mozDA || "0",
    PA: r.mozPA || "0",
    Spam: String(spamPct), // converted from Moz v1 (0-17) to percentage (0-100)
    DR: r.ahrefsDR || "0",
    TF: r.majesticTF || "0",
    CF: r.majesticCF || "0",
    MozRank: r.mozRank || "0",
    Backlinks: r.ahrefsBacklinks || 0,
    RefDomains: r.ahrefsRefDomains || 0,
    Traffic: r.ahrefsTraffic || 0,
    Keywords: r.ahrefsOrganicKeywords || 0
  }); // end metrics.map

  res.json({
    success: true,
    total,
    checked: metrics.length,
    results: metrics,
    errors: errors.length > 0 ? errors : undefined,
    partial: errors.length > 0,
    plan: role,
    plan_label: limits.label,
    plan_limit: limits.maxUrls,
    remaining: user ? (limits.maxUrls - user.usage.today) : (limits.maxUrls - urls.length)
  });
}