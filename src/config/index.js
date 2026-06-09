require('dotenv').config();

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

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  features,
  // Public base URL for the hosted bracket pages (nginx on the droplet
  // terminates TLS for this domain and proxies to the bot's Express app).
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://tournaments.clutch.game',
};
