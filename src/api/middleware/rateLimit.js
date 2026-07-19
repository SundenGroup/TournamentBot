// Rate Limiting Middleware
// Limits API requests to 120/minute for Business tier

const rateLimitStore = new Map(); // guildId -> { count, windowStart }

const WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS = 120; // 120 requests per minute

/**
 * Rate limiting middleware
 */
function rateLimit(req, res, next) {
  const guildId = req.guildId;

  if (!guildId) {
    // No guild ID means auth middleware didn't run - skip rate limiting
    return next();
  }

  const now = Date.now();
  let record = rateLimitStore.get(guildId);

  // Reset window if expired
  if (!record || now - record.windowStart >= WINDOW_MS) {
    record = { count: 0, windowStart: now };
    rateLimitStore.set(guildId, record);
  }

  record.count++;

  // Set rate limit headers
  const remaining = Math.max(0, MAX_REQUESTS - record.count);
  const resetTime = Math.ceil((record.windowStart + WINDOW_MS) / 1000);

  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetTime);

  if (record.count > MAX_REQUESTS) {
    res.setHeader('Retry-After', Math.ceil((record.windowStart + WINDOW_MS - now) / 1000));
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Maximum ${MAX_REQUESTS} requests per minute. Try again in ${Math.ceil((record.windowStart + WINDOW_MS - now) / 1000)} seconds.`,
      retryAfter: Math.ceil((record.windowStart + WINDOW_MS - now) / 1000),
    });
  }

  next();
}

/**
 * Clean up old rate limit records (call periodically)
 */
function cleanupRateLimits() {
  const now = Date.now();
  for (const [guildId, record] of rateLimitStore.entries()) {
    if (now - record.windowStart >= WINDOW_MS * 2) {
      rateLimitStore.delete(guildId);
    }
  }
}

// Clean up every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);

// ── IP-based limiter for unauthenticated routes (public bracket + OAuth) ─────
// The v1 API limiter keys on guildId (post-auth); public routes have no auth,
// so a flood of distinct random /b/<uuid> ids (each a DB lookup, bypassing the
// response cache) could hammer the single Node process during a live event.
// Keyed on client IP — requires `app.set('trust proxy', 1)` so req.ip is the
// real client behind nginx, not 127.0.0.1.
const ipStore = new Map(); // ip -> { count, windowStart }
const IP_WINDOW_MS = 60000;
// Only the anonymous, floodable surfaces use this (public bracket pages + the
// OAuth entry points). Set high: many legitimate spectators share one public
// IP behind mobile carrier CGNAT / venue NAT during a big event, and each
// bracket auto-refreshes — a real flood is far higher still. The authenticated
// dashboard is NOT limited here (session-gated; mutations have their own
// per-guild limiter).
const IP_MAX = 600;

function ipRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let record = ipStore.get(ip);
  if (!record || now - record.windowStart >= IP_WINDOW_MS) {
    record = { count: 0, windowStart: now };
    ipStore.set(ip, record);
  }
  record.count++;
  if (record.count > IP_MAX) {
    res.setHeader('Retry-After', Math.ceil((record.windowStart + IP_WINDOW_MS - now) / 1000));
    return res.status(429).json({ error: 'Too many requests', message: 'Slow down and try again shortly.' });
  }
  next();
}

function cleanupIpLimits() {
  const now = Date.now();
  for (const [ip, record] of ipStore.entries()) {
    if (now - record.windowStart >= IP_WINDOW_MS * 2) ipStore.delete(ip);
  }
}
setInterval(cleanupIpLimits, 5 * 60 * 1000);

module.exports = {
  rateLimit,
  cleanupRateLimits,
  WINDOW_MS,
  MAX_REQUESTS,
  ipRateLimit,
};
