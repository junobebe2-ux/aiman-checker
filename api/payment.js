/**
 * AIMAN CHECKER — Payment System
 * POST /api/payment (create payment)
 * GET  /api/payment/status/:refId (check payment status)
 * POST /api/payment/confirm/:refId (admin manual confirmation)
 * GET  /api/payment (admin list pending)
 * 
 * Two networks:
 *   - USDT on Base (Ethereum L2)
 *   - USDC on Solana
 * 
 * Env vars: BASE_WALLET, SOLANA_WALLET
 * Optionally: BASESCAN_API_KEY, SOLSCAN_API_KEY
 */

const jwt = require('jsonwebtoken');
const { PLAN_PRICES, PLAN_DAYS } = require('./limits');
const fs = require('fs');

var JWT_SECRET = process.env.JWT_SECRET || 'aiman-checker-jwt-secret-change-in-production-2024';
const USERS_PATH = '/tmp/users.json';
const TRANSACTIONS_PATH = '/tmp/transactions.json';

const BASE_WALLET = process.env.BASE_WALLET || '0xSET_BY_ADMIN_LATER';
const SOLANA_WALLET = process.env.SOLANA_WALLET || 'SOLANA_WALLET_NOT_SET';
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || '';
const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY || '';

const USDT_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const BASE_EXPLORER = 'https://api.basescan.org/api';
const SOLANA_USDC_MINT = 'EPjFWdd5UfKt85WtTJCwmbXoWXoFwZpEUoXpYQNEhxE';

// Load / save transactions
function loadTxns() {
  try {
    if (fs.existsSync(TRANSACTIONS_PATH)) {
      return JSON.parse(fs.readFileSync(TRANSACTIONS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveTxns(txns) {
  try {
    fs.writeFileSync(TRANSACTIONS_PATH, JSON.stringify(txns, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save transactions:', e.message);
  }
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save users:', e.message);
  }
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    return user ? { valid: true, user } : { valid: false };
  } catch (e) {
    return { valid: false };
  }
}

// Generate a unique reference ID
function genRefId() {
  return 'pay_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ===== BASE NETWORK CHECK (USDT) via Basescan =====
async function checkBasePayment(expectedAmount) {
  try {
    const apiKey = BASESCAN_API_KEY ? `&apikey=${BASESCAN_API_KEY}` : '';
    const url = `${BASE_EXPLORER}?module=account&action=tokentx&address=${BASE_WALLET}&contractaddress=${USDT_BASE_CONTRACT}&sort=desc&limit=20${apiKey}`;
    
    const resp = await fetch(url);
    if (!resp.ok) {
      return { confirmed: false, confirmations: 0, error: `Basescan ${resp.status}`, manualMode: !BASESCAN_API_KEY };
    }
    
    const data = await resp.json();
    
    if (data.status !== '1' || !data.result) {
      return { confirmed: false, confirmations: 0, error: 'No transactions found', manualMode: false };
    }
    
    const txns = Array.isArray(data.result) ? data.result : [];
    
    // Look for incoming USDT transfers to our wallet
    for (const txn of txns) {
      if (txn.to.toLowerCase() === BASE_WALLET.toLowerCase()) {
        const value = parseFloat(txn.value) / 1e6; // USDT has 6 decimals on Base
        if (value >= expectedAmount && value < expectedAmount * 1.05) {
          return {
            confirmed: true,
            confirmations: 1,
            txId: txn.hash,
            value,
            from: txn.from
          };
        }
      }
    }
    
    return { confirmed: false, confirmations: 0 };
  } catch (e) {
    return { confirmed: false, confirmations: 0, error: e.message, manualMode: false };
  }
}

// ===== SOLANA NETWORK CHECK (USDC) via Solscan =====
async function checkSolanaPayment(expectedAmount) {
  try {
    // Use Solscan free API for token transfers
    const headers = {};
    if (SOLSCAN_API_KEY) {
      headers['Authorization'] = `Bearer ${SOLSCAN_API_KEY}`;
    }
    
    // Solscan v2 API for token transfers
    const url = `https://api.solscan.io/v2/account/tokens?address=${SOLANA_WALLET}&page_size=20&sort_by=recent&usdc=true`;
    
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      // Try alternative: public Solscan API without auth
      const altUrl = `https://api.solscan.io/account/spl?address=${SOLANA_WALLET}&pageSize=20`;
      const altResp = await fetch(altUrl);
      if (!altResp.ok) {
        return { confirmed: false, confirmations: 0, error: `Solscan ${resp.status}`, manualMode: !SOLSCAN_API_KEY };
      }
      const altData = await altResp.json();
      return processSolscanResult(altData, expectedAmount);
    }
    
    const data = await resp.json();
    return processSolscanResult(data, expectedAmount);
  } catch (e) {
    // Try fallback public endpoint
    try {
      const fallbackUrl = `https://api.solscan.io/account/spl?address=${SOLANA_WALLET}&pageSize=20`;
      const fallbackResp = await fetch(fallbackUrl);
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        return processSolscanResult(fallbackData, expectedAmount);
      }
    } catch (e2) {}
    
    return { confirmed: false, confirmations: 0, error: e.message, manualMode: !SOLSCAN_API_KEY };
  }
}

function processSolscanResult(data, expectedAmount) {
  try {
    const tokens = data.data || [];
    
    // Look for USDC (mint: EPjFWdd5UfKt85WtTJCwmbXoWXoFwZpEUoXpYQNEhxE)
    for (const token of tokens) {
      if (token.tokenAddress === SOLANA_USDC_MINT || token.mint === SOLANA_USDC_MINT) {
        // Check token account balance changes / recent transfers
        // Solscan token data shows amount and recent activity
        const amount = parseFloat(token.amount) || parseFloat(token.tokenAmount?.uiAmount) || 0;
        if (amount >= expectedAmount && amount < expectedAmount * 1.05) {
          return {
            confirmed: true,
            confirmations: 1,
            txId: token.txHash || token.signature || 'solana_tx',
            value: amount,
            from: token.owner || SOLANA_WALLET
          };
        }
      }
    }
    
    return { confirmed: false, confirmations: 0 };
  } catch (e) {
    return { confirmed: false, confirmations: 0, error: e.message };
  }
}

// Create a new payment
async function createPayment(plan, userId, network) {
  const price = PLAN_PRICES[plan];
  if (!price || price <= 0) {
    return { error: `Invalid plan: ${plan}` };
  }
  
  if (network !== 'base' && network !== 'solana') {
    return { error: 'Invalid network. Choose: base or solana' };
  }
  
  const refId = genRefId();
  const days = PLAN_DAYS[plan] || 30;
  
  const walletAddress = network === 'base' ? BASE_WALLET : SOLANA_WALLET;
  const currency = network === 'base' ? 'USDT' : 'USDC';
  const networkName = network === 'base' ? 'Base' : 'Solana';
  
  const txn = {
    refId,
    userId: userId || 'guest',
    plan,
    amount: price,
    currency,
    network: networkName,
    networkKey: network,
    walletAddress,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24h expiry
    days
  };
  
  const txns = loadTxns();
  txns.push(txn);
  saveTxns(txns);
  
  // Generate QR code URL
  const qrData = network === 'base'
    ? `ethereum:${BASE_WALLET}?value=${price}e18&contract=${USDT_BASE_CONTRACT}&ref=${refId}`
    : `solana:${SOLANA_WALLET}?amount=${price}&spl=${SOLANA_USDC_MINT}&ref=${refId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;
  
  return {
    refId: txn.refId,
    address: walletAddress,
    amount: price,
    currency,
    network: networkName,
    networkKey: network,
    qr: qrUrl,
    qr_url: qrUrl,
    expiresAt: txn.expiresAt,
    plan,
    days
  };
}

// Check payment status
async function checkStatus(refId) {
  const txns = loadTxns();
  const txn = txns.find(t => t.refId === refId);
  if (!txn) {
    return { error: 'Transaction not found' };
  }
  
  // If already confirmed, return early
  if (txn.status === 'confirmed') {
    return {
      refId: txn.refId,
      status: 'confirmed',
      amount: txn.amount,
      plan: txn.plan,
      currency: txn.currency,
      network: txn.network,
      confirmations: 1,
      txId: txn.txId || null
    };
  }
  
  // Check if expired
  if (new Date() > new Date(txn.expiresAt)) {
    txn.status = 'expired';
    saveTxns(txns);
    return {
      refId: txn.refId,
      status: 'expired',
      amount: txn.amount,
      plan: txn.plan,
      confirmations: 0
    };
  }
  
  // Check blockchain for payment
  let result;
  if (txn.networkKey === 'base') {
    result = await checkBasePayment(txn.amount);
  } else {
    result = await checkSolanaPayment(txn.amount);
  }
  
  // If in manual mode (no API key), return pending with manual flag
  if (result.manualMode) {
    return {
      refId: txn.refId,
      status: txn.status,
      amount: txn.amount,
      plan: txn.plan,
      currency: txn.currency,
      network: txn.network,
      confirmations: 0,
      manualMode: true,
      manualMessage: 'No blockchain API key configured. Admin must confirm manually.'
    };
  }
  
  if (result.confirmed && txn.status === 'pending') {
    txn.status = 'confirmed';
    txn.confirmedAt = new Date().toISOString();
    txn.txId = result.txId || txn.txId;
    txn.fromAddress = result.from || txn.fromAddress;
    txn.confirmations = result.confirmations || 1;
    saveTxns(txns);
    
    // Upgrade user if we have a userId
    if (txn.userId && txn.userId !== 'guest') {
      const users = loadUsers();
      const user = users.find(u => u.id === txn.userId);
      if (user) {
        const plan = txn.plan === 'business' ? 'business' : 'pro';
        user.role = plan;
        user.plan = plan;
        user.planExpires = new Date(Date.now() + txn.days * 86400000).toISOString();
        if (!user.transactions) user.transactions = [];
        user.transactions.push({
          type: 'payment',
          plan: txn.plan,
          amount: txn.amount,
          currency: txn.currency,
          network: txn.network,
          txId: result.txId,
          date: new Date().toISOString()
        });
        saveUsers(users);
      }
    }
  }
  
  return {
    refId: txn.refId,
    status: txn.status,
    amount: txn.amount,
    plan: txn.plan,
    currency: txn.currency,
    network: txn.network,
    confirmations: result.confirmations || 0,
    txId: result.txId || txn.txId || null
  };
}

// Admin manual confirm a pending transaction
function manualConfirm(refId) {
  const txns = loadTxns();
  const txn = txns.find(t => t.refId === refId);
  if (!txn) {
    return { error: 'Transaction not found' };
  }
  
  if (txn.status === 'confirmed') {
    return { error: 'Transaction already confirmed' };
  }
  
  txn.status = 'confirmed';
  txn.confirmedAt = new Date().toISOString();
  txn.txId = txn.txId || 'manual_' + Date.now().toString(36);
  txn.confirmations = 1;
  txn.manualConfirm = true;
  saveTxns(txns);
  
  // Upgrade user
  if (txn.userId && txn.userId !== 'guest') {
    const users = loadUsers();
    const user = users.find(u => u.id === txn.userId);
    if (user) {
      const plan = txn.plan === 'business' ? 'business' : 'pro';
      user.role = plan;
      user.plan = plan;
      user.planExpires = new Date(Date.now() + txn.days * 86400000).toISOString();
      if (!user.transactions) user.transactions = [];
      user.transactions.push({
        type: 'payment',
        plan: txn.plan,
        amount: txn.amount,
        currency: txn.currency,
        network: txn.network,
        txId: txn.txId,
        date: new Date().toISOString()
      });
      saveUsers(users);
    }
  }
  
  return {
    refId: txn.refId,
    status: 'confirmed',
    amount: txn.amount,
    plan: txn.plan,
    network: txn.network,
    confirmations: 1
  };
}

// Main handler
module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlPath = req.url || '';
  
  // POST /api/payment/confirm/:refId — admin manual confirmation
  const confirmMatch = urlPath.match(/\/api\/payment\/confirm\/([\w_]+)/);
  if (req.method === 'POST' && confirmMatch) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const result = verifyToken(token);
    if (!result.valid || result.user.role !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized. Admin only.' });
    }
    const refId = confirmMatch[1];
    const confirmResult = manualConfirm(refId);
    if (confirmResult.error) {
      return res.status(400).json(confirmResult);
    }
    return res.json(confirmResult);
  }

  // POST /api/payment — create payment
  if (req.method === 'POST') {
    const { plan, network } = req.body || {};
    
    // Optional auth
    let userId = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) {
      const result = verifyToken(token);
      if (result.valid) userId = result.user.id;
    }
    
    if (!plan || !PLAN_PRICES[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose: free, pro, business' });
    }
    
    if (plan === 'free') {
      return res.status(400).json({ error: 'Free plan cannot be purchased' });
    }
    
    if (!network || (network !== 'base' && network !== 'solana')) {
      return res.status(400).json({ error: 'Invalid network. Choose: base (USDT) or solana (USDC)' });
    }
    
    const payment = await createPayment(plan, userId, network);
    if (payment.error) {
      return res.status(400).json(payment);
    }
    return res.json(payment);
  }

  // GET /api/payment/status/:refId
  const statusMatch = urlPath.match(/\/api\/payment\/status\/([\w_]+)/);
  if (req.method === 'GET' && statusMatch) {
    const refId = statusMatch[1];
    const status = await checkStatus(refId);
    return res.json(status);
  }

  // GET /api/payment — list all for admin
  if (req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const result = verifyToken(token);
    if (result.valid && result.user.role === 'admin') {
      const txns = loadTxns();
      return res.json({ transactions: txns.slice(-200) });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};