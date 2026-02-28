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

module.exports = {
  rateLimit,
  cleanupRateLimits,
  WINDOW_MS,
  MAX_REQUESTS,
};
