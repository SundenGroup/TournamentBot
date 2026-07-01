require('dotenv').config();
const crypto = require('node:crypto');

// ============================================================================
// Feature flags
// ----------------------------------------------------------------------------
// Some features are temporarily parked while the core bot is being tested.
// They are NOT deleted — the implementation and full specs are preserved (see
// docs/PARKED-FEATURES.md). Flip the env var (or the default below) to re-enable.
//
//   tokens       — tournament tokens + participant boosts (the consumable
//                  escape-hatch over tier limits) and the /tokens command.
//   battleRoyale — Battle Royale format, its games, and br-report/match games UI.
// ============================================================================
const features = {
  tokens: process.env.FEATURE_TOKENS === 'true',
  battleRoyale: process.env.FEATURE_BATTLE_ROYALE === 'true',
};

const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://tournaments.clutch.game';

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
