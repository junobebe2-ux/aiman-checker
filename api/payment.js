/**
 * AIMAN CHECKER — Payment System
 * POST /api/payment (create payment)
 * GET  /api/payment/status/:refId (check payment status)
 * 
 * USDT TRC20 crypto payments via TronGrid free API.
 */

const jwt = require('jsonwebtoken');
const { PLAN_PRICES, PLAN_DAYS } = require('./limits');
const fs = require('fs');

var JWT_SECRET = process.env.JWT_SECRET || 'aiman-checker-jwt-secret-change-in-production-2024';
const USERS_PATH = '/tmp/users.json';
const TRANSACTIONS_PATH = '/tmp/transactions.json';
const TRON_WALLET = process.env.TRON_WALLET || 'TXYZAdminWalletAddressHere';
const TRONGRID_API = 'https://api.trongrid.io/v1';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT TRC20 mainnet

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

// Check USDT TRC20 transactions for our wallet via TronGrid
async function checkPayment(txId, expectedAmount) {
  try {
    const url = `${TRONGRID_API}/accounts/${TRON_WALLET}/transactions/trc20?limit=50&contract_address=${USDT_CONTRACT}`;
    const resp = await fetch(url);
    if (!resp.ok) return { confirmed: false, confirmations: 0, error: `TronGrid ${resp.status}` };
    
    const data = await resp.json();
    const txns = data.data || [];
    
    // Check if our reference ID appears in any memo or if amount matches
    if (txId) {
      const match = txns.find(t => 
        t.transaction_id === txId && 
        t.to === TRON_WALLET
      );
      if (match) {
        const value = parseInt(match.value) / 1e6; // USDT has 6 decimals
        if (value >= expectedAmount) {
          return { 
            confirmed: true, 
            confirmations: 1, // Basic check; real impl would check block confirmations
            txId: match.transaction_id,
            value,
            from: match.from
          };
        }
      }
    }
    
    // Check recent incoming USDT to our wallet
    const incoming = txns.filter(t => t.to === TRON_WALLET);
    for (const t of incoming) {
      const value = parseInt(t.value) / 1e6;
      if (value >= expectedAmount && value < expectedAmount * 1.01) {
        return {
          confirmed: true,
          confirmations: 1,
          txId: t.transaction_id,
          value,
          from: t.from
        };
      }
    }
    
    return { confirmed: false, confirmations: 0 };
  } catch (e) {
    return { confirmed: false, confirmations: 0, error: e.message };
  }
}

async function createPayment(plan, userId) {
  const price = PLAN_PRICES[plan];
  if (!price || price <= 0) {
    return { error: `Invalid plan: ${plan}` };
  }
  
  const refId = genRefId();
  const days = PLAN_DAYS[plan] || 30;
  
  const txn = {
    refId,
    userId: userId || 'guest',
    plan,
    amount: price,
    currency: 'USDT',
    network: 'TRC20',
    walletAddress: TRON_WALLET,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24h expiry
    days
  };
  
  const txns = loadTxns();
  txns.push(txn);
  saveTxns(txns);
  
  // Generate a simple QR code URL (using a public QR API)
  const qrData = `tron:${TRON_WALLET}?amount=${price}&contract=${USDT_CONTRACT}&ref=${refId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;
  
  return {
    refId: txn.refId,
    address: TRON_WALLET,
    amount: price,
    currency: 'USDT',
    network: 'TRC20',
    qr: qrUrl,
    expiresAt: txn.expiresAt,
    plan,
    days
  };
}

async function checkStatus(refId) {
  const txns = loadTxns();
  const txn = txns.find(t => t.refId === refId);
  if (!txn) {
    return { error: 'Transaction not found' };
  }
  
  // Check blockchain for payment
  const result = await checkPayment(txn.txId || null, txn.amount);
  
  if (result.confirmed && txn.status === 'pending') {
    txn.status = 'confirmed';
    txn.confirmedAt = new Date().toISOString();
    txn.txId = result.txId || txn.txId;
    txn.fromAddress = result.from || txn.fromAddress;
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
    confirmations: result.confirmations || 0,
    txId: result.txId || txn.txId || null
  };
}

// Main handler
module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST /api/payment — create payment
  if (req.method === 'POST') {
    const { plan } = req.body || {};
    
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
    
    const payment = await createPayment(plan, userId);
    return res.json(payment);
  }

  // GET /api/payment/status/:refId
  const urlPath = req.url || '';
  const statusMatch = urlPath.match(/\/api\/payment\/status\/([\w_]+)/);
  if (req.method === 'GET' && statusMatch) {
    const refId = statusMatch[1];
    const status = await checkStatus(refId);
    return res.json(status);
  }

  // Fallback: list all pending for admin (auth required)
  if (req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const result = verifyToken(token);
    if (result.valid && result.user.role === 'admin') {
      const txns = loadTxns();
      return res.json({ transactions: txns.slice(-100) });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};