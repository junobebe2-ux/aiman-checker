/**
 * AIMAN CHECKER — Shared Limits Configuration
 * Centralized role-based limits for all endpoints.
 */

const LIMITS = {
  guest: {
    label: 'Guest',
    maxUrls: 100,
    historyDays: 0,
    batchLimit: 2,       // max batches of 50
    description: 'Free trial — 100 URLs'
  },
  free: {
    label: 'Free',
    maxUrls: 200,
    historyDays: 7,
    batchLimit: 4,
    description: '200 URLs, 7-day history'
  },
  pro: {
    label: 'Pro',
    maxUrls: 1000,
    historyDays: 30,
    batchLimit: Infinity,
    description: '1000 URLs, 30-day history'
  },
  business: {
    label: 'Business',
    maxUrls: 5000,
    historyDays: 90,
    batchLimit: Infinity,
    description: '5000 URLs, 90-day history'
  },
  admin: {
    label: 'Admin',
    maxUrls: Infinity,
    historyDays: Infinity,
    batchLimit: Infinity,
    description: 'Unlimited'
  }
};

const PLAN_PRICES = {
  free: 0,
  pro: 9.99,
  business: 29.99
};

const PLAN_DAYS = {
  pro: 30,
  business: 90
};

function getLimits(role = 'guest') {
  return LIMITS[role] || LIMITS.guest;
}

function getMaxUrls(role = 'guest') {
  const l = getLimits(role);
  return l.maxUrls;
}

function checkLimit(role, urlCount) {
  const max = getMaxUrls(role);
  if (urlCount > max) {
    return {
      allowed: false,
      limit: max,
      yourCount: urlCount,
      role,
      message: `Your plan (${getLimits(role).label}) allows max ${max} URLs. You submitted ${urlCount}.`
    };
  }
  return { allowed: true, limit: max, yourCount: urlCount };
}

module.exports = { LIMITS, getLimits, getMaxUrls, checkLimit, PLAN_PRICES, PLAN_DAYS };