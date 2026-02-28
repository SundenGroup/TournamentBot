// API Authentication Middleware
// Validates API keys and checks Business tier access

const { getSubscription, getAllSubscriptions } = require('../../data/subscriptions');
const { getEffectiveTier } = require('../../services/subscriptionService');
const { hashApiKey } = require('../../utils/apiKeyGenerator');

// Cache for API key -> guildId lookups (refreshed periodically)
let apiKeyCache = new Map();
let lastCacheRefresh = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Refresh the API key cache
 */
function refreshApiKeyCache() {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_TTL) {
    return;
  }

  apiKeyCache = new Map();
  const subscriptions = getAllSubscriptions();

  for (const sub of subscriptions) {
    if (sub.apiKey && sub.apiKeyHash) {
      apiKeyCache.set(sub.apiKeyHash, sub.guildId);
    }
  }

  lastCacheRefresh = now;
}

/**
 * Find guild by API key
 */
function findGuildByApiKey(apiKey) {
  refreshApiKeyCache();

  const keyHash = hashApiKey(apiKey);

  // Check cache first
  if (apiKeyCache.has(keyHash)) {
    return apiKeyCache.get(keyHash);
  }

  // Fallback to direct lookup
  const subscriptions = getAllSubscriptions();
  for (const sub of subscriptions) {
    if (sub.apiKeyHash === keyHash) {
      return sub.guildId;
    }
  }

  return null;
}

/**
 * Authentication middleware
 * Validates API key and attaches guildId to request
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Missing Authorization header',
      message: 'Include your API key as: Authorization: Bearer tb_live_xxx',
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'Invalid Authorization format',
      message: 'Use format: Authorization: Bearer tb_live_xxx',
    });
  }

  const apiKey = parts[1];

  if (!apiKey.startsWith('tb_live_')) {
    return res.status(401).json({
      error: 'Invalid API key format',
      message: 'API keys start with tb_live_',
    });
  }

  const guildId = findGuildByApiKey(apiKey);

  if (!guildId) {
    return res.status(401).json({
      error: 'Invalid API key',
      message: 'API key not found or has been revoked',
    });
  }

  // Verify Business tier
  const tier = getEffectiveTier(guildId);
  if (tier !== 'business') {
    return res.status(403).json({
      error: 'Business tier required',
      message: 'API access is only available on the Business tier',
    });
  }

  // Attach guild info to request
  req.guildId = guildId;
  req.apiKey = apiKey;

  next();
}

module.exports = {
  authenticate,
  findGuildByApiKey,
  refreshApiKeyCache,
};
