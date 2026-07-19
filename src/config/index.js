require('dotenv').config();
const crypto = require('node:crypto');

// ============================================================================
// Feature flags
// ----------------------------------------------------------------------------
//   tokens — tournament tokens + participant boosts (parked, see
//            docs/PARKED-FEATURES.md). While off, token purchase paths are
//            unreachable. Tier LIMITS are governed by enforceTiers below.
//   enforceTiers — pricing v2 enforcement (Free 5/mo·64·2 concurrent, Pro,
//            Studio). OFF until after the GOALS July 20 event; flipping it on
//            is a deliberate post-event step (docs/PRODUCT-STRATEGY.md §6).
// Battle Royale (v2) is fully enabled — reachable through the BR game presets.
// ============================================================================
const features = {
  tokens: process.env.FEATURE_TOKENS === 'true',
  enforceTiers: process.env.ENFORCE_TIERS === 'true',
};

const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://tournaments.clutch.game';

// The admin session + CSRF signing key falls back to a token-derived value so
// the dashboard works without extra config, but that means anyone who obtains
// the bot token can forge admin sessions for any guild. Warn loudly in prod so
// SESSION_SECRET gets set to an independent random value.
if (!process.env.SESSION_SECRET && (process.env.NODE_ENV === 'production')) {
  console.warn(
    '[SECURITY] SESSION_SECRET is not set — web-admin session/CSRF keys are ' +
    'derived from DISCORD_TOKEN. Set SESSION_SECRET to a long random string ' +
    'so a token leak cannot forge admin sessions.'
  );
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    // Needed for the web-admin Discord OAuth login (dev portal → OAuth2).
    clientSecret: process.env.DISCORD_CLIENT_SECRET || null,
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  features,
  // Public base URL for the hosted bracket pages (nginx on the droplet
  // terminates TLS for this domain and proxies to the bot's Express app).
  publicBaseUrl,
  // Web-admin dashboard (Discord OAuth). The session-signing key falls back to
  // a stable value derived from the bot token so sessions work without extra
  // config, but SESSION_SECRET should be set explicitly in production.
  webAdmin: {
    oauthRedirectUri: `${publicBaseUrl}/admin/callback`,
    sessionSecret: process.env.SESSION_SECRET
      || crypto.createHash('sha256').update('clutch-web-admin:' + (process.env.DISCORD_TOKEN || 'dev')).digest('hex'),
    // Whether OAuth is configured enough to enable the dashboard.
    enabled: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  },
};
