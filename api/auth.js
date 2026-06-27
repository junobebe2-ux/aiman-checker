/**
 * AIMAN CHECKER — Auth System
 * POST /api/auth (register/login)
 * GET  /api/auth?me=true (verify token)
 * 
 * Uses JWT and a JSON file store at /tmp/users.json (Vercel-compatible).
 * Register: { email, password } → { token, user }
 * Login:    { email, password } → { token, user }
 * GET me:   Authorization: Bearer <token> → { user, role, limits }
 */

const jwt = require('jsonwebtoken');
const { LIMITS, getLimits } = require('./limits');
const fs = require('fs');
const path = require('path');

var JWT_SECRET = (process.env.JWT_SECRET) || 'aiman-checker-jwt-secret-change-in-production-2024';
const USERS_PATH = '/tmp/users.json';
const TOKEN_EXPIRY = '7d';

// Simple in-memory / file-backed user store
function loadUsers() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      const raw = fs.readFileSync(USERS_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    // ignore
  }
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    // Vercel readonly /tmp — fallback to in-memory only; data lost between cold starts
    console.error('Failed to save users:', e.message);
  }
}

function findUser(email) {
  const users = loadUsers();
  return users.find(u => u.email === email.toLowerCase().trim());
}

function createUser(email, password) {
  const users = loadUsers();
  const newUser = {
    id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    email: email.toLowerCase().trim(),
    password: simpleHash(password),
    role: 'free',
    plan: 'free',
    planExpires: null,
    apiKey: genApiKey(),
    usage: { today: 0, date: new Date().toISOString().slice(0, 10), total: 0 },
    transactions: [],
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers(users);
  return newUser;
}

function simpleHash(str) {
  // Not crypto-secure; for prod use bcrypt. This avoids native deps for Vercel.
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + Buffer.from(str).toString('base64').slice(0, 8);
}

function verifyPassword(password, hash) {
  return simpleHash(password) === hash;
}

function genApiKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'ac_';
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Reload user for latest role/data
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    return user ? { valid: true, user } : { valid: false, error: 'User not found' };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
    planExpires: user.planExpires,
    apiKey: user.apiKey,
    usage: user.usage,
    transactions: (user.transactions || []).slice(-50), // last 50
    createdAt: user.createdAt
  };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/auth?me=true  — verify token
  if (req.method === 'GET' && req.query && req.query.me === 'true') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const result = verifyToken(token);
    if (!result.valid) {
      return res.status(401).json({ error: result.error || 'Invalid token' });
    }

    const user = sanitizeUser(result.user);
    const limits = getLimits(user.role);

    // Reset daily count if new day
    const today = new Date().toISOString().slice(0, 10);
    if (user.usage.date !== today) {
      user.usage.today = 0;
      user.usage.date = today;
    }

    return res.json({ user, role: user.role, limits });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (action === 'register') {
    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = findUser(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = createUser(email, password);
    const token = signToken(user);
    const limits = getLimits(user.role);

    return res.json({ token, user: sanitizeUser(user), role: user.role, limits });
  }

  if (action === 'login') {
    const user = findUser(email);
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    const limits = getLimits(user.role);

    return res.json({ token, user: sanitizeUser(user), role: user.role, limits });
  }

  return res.status(400).json({ error: 'Unknown action. Use "register" or "login".' });
};