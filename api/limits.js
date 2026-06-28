/**
 * AIMAN CHECKER — Rate limits per role
 */
const RATE_LIMITS = {
  guest: {
    label: 'Guest',
    maxUrls: 100,
    historyDays: 0,
    batchLimit: 2,
    description: 'Free trial — 100 URLs'
  },
  free: {
    label: 'Free',
    maxUrls: 200,
    historyDays: 7,
    batchLimit: 4,
    description: 'Free plan — 200 URLs per session'
  },
  pro: {
    label: 'Pro',
    maxUrls: 1000,
    historyDays: 30,
    batchLimit: 20,
    description: 'Pro plan — 1000 URLs per session'
  },
  business: {
    label: 'Business',
    maxUrls: 5000,
    historyDays: 90,
    batchLimit: 100,
    description: 'Business plan — 5000 URLs per session'
  },
  admin: {
    label: 'Admin',
    maxUrls: 100000,
    historyDays: 365,
    batchLimit: 2000,
    description: 'Unlimited'
  }
};

function getLimits(role) {
  return RATE_LIMITS[role] || RATE_LIMITS.guest;
}

function checkLimit(role, requested) {
  const limits = getLimits(role);
  if (requested > limits.maxUrls) {
    return { allowed: false, limit: limits.maxUrls, yourCount: requested, message: "Plan " + limits.label + " allows max " + limits.maxUrls + " URLs (you requested " + requested + ")" };
  }
  return { allowed: true, limit: limits.maxUrls };
}

module.exports = { RATE_LIMITS, getLimits, checkLimit };
