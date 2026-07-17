// Subscription service
// Tier checks, feature gates, limits, tokens, and grants

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { features } = require('../config');
const {
  getSubscription,
  getOrCreateSubscription,
  updateSubscription,
  setManualGrant,
  clearManualGrant,
  incrementTournamentUsage,
  incrementConcurrent,
  consumeTournamentToken,
  consumeParticipantBoost,
  addTournamentTokens,
  getManualGrants,
  cleanupExpiredTokens,
} = require('../data/subscriptions');

// Grace period duration (3 days)
const GRACE_PERIOD_DAYS = 3;

// ============================================================================
// Tiers — pricing v2 (docs/PRODUCT-STRATEGY.md §6a): Free / Pro / Studio.
// ----------------------------------------------------------------------------
// Legacy paid tiers map at read time (premium → pro, business → studio) so
// existing grants and Stripe subscriptions keep working unchanged.
//
// Enforcement model:
//   • FEATURE gates always follow the lists below. v2 only ever LOOSENS
//     feature access vs v1 (check-in + web bracket became free), so applying
//     them immediately claws nothing back.
//   • LIMIT checks (monthly count / entrant cap / concurrent) only apply when
//     config.features.enforceTiers is on (ENFORCE_TIERS env). It stays OFF
//     until after the GOALS event on July 20, 2026 — flipping it is a
//     deliberate post-event step.
// ============================================================================

const TIER_ORDER = ['free', 'pro', 'studio'];

const LEGACY_TIER_MAP = { premium: 'pro', business: 'studio' };

/** Map legacy tier names (stored in old grants/subscriptions) to v2 tiers. */
function normalizeTier(tier) {
  if (!tier) return 'free';
  return LEGACY_TIER_MAP[tier] || (TIER_ORDER.includes(tier) ? tier : 'free');
}

const TIER_LIMITS = {
  free: {
    tournamentsPerMonth: 5,   // a weekly cup + one extra
    maxParticipants: 64,      // bracket formats; BR: one lobby (multi-lobby is Pro)
    maxConcurrent: 2,
    maxServers: 1,
  },
  pro: {
    tournamentsPerMonth: Infinity,
    maxParticipants: 256,
    maxConcurrent: Infinity,
    maxServers: 1,
  },
  studio: {
    tournamentsPerMonth: Infinity,
    maxParticipants: 512,
    maxConcurrent: Infinity,
    maxServers: 5,
  },
};

// ============================================================================
// Feature Lists
// ----------------------------------------------------------------------------
// Free includes everything not listed here — notably check-in (protects a
// first-timer's event quality) and the live web bracket (with footer).
// web_dashboard / footer_removal are declared for plan display; their route
// wiring lands with the post-GOALS enforcement flip.
// ============================================================================

const PRO_FEATURES = [
  'seeding',
  'captain_mode',
  'auto_cleanup',
  'auto_archive',
  'required_roles',
  'full_reminders',
  'tournament_templates',
  'advanced_analytics',
  'multi_lobby_br',
  'footer_removal',
  'web_dashboard',
];

const STUDIO_FEATURES = [
  'api_access',
  'webhooks',
  'white_label',
  'multi_server',
  'custom_presets',
];

// Legacy aliases (old call sites / display code)
const PREMIUM_FEATURES = PRO_FEATURES;
const BUSINESS_FEATURES = STUDIO_FEATURES;

// ============================================================================
// Feature Names (for display)
// ============================================================================

const FEATURE_NAMES = {
  checkin: 'Check-in System',
  seeding: 'Seeding',
  captain_mode: 'Captain Mode',
  auto_cleanup: 'Auto-Cleanup',
  auto_archive: 'Rolling Auto-Archive (close rooms after results)',
  required_roles: 'Required Roles',
  full_reminders: 'Full Reminders (24h + 1h)',
  tournament_templates: 'Tournament Templates',
  advanced_analytics: 'Advanced Analytics',
  public_bracket: 'Live Web Bracket',
  multi_lobby_br: 'Multi-Lobby Battle Royale (group stages)',
  footer_removal: 'Bracket Footer Removal',
  web_dashboard: 'Web Admin Dashboard',
  api_access: 'Results API',
  webhooks: 'Webhooks',
  white_label: 'White-Label Branding',
  multi_server: 'Multi-Server Support',
  custom_presets: 'Custom Game Presets & Private Fields',
  concurrent: 'More Concurrent Tournaments',
  participants: 'More Participants',
};

// ============================================================================
// Helper Functions
// ============================================================================

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getNextTier(currentTier) {
  const index = TIER_ORDER.indexOf(normalizeTier(currentTier));
  if (index === -1 || index === TIER_ORDER.length - 1) return null;
  return TIER_ORDER[index + 1];
}

function getRequiredTierForFeature(feature) {
  if (PRO_FEATURES.includes(feature)) return 'pro';
  if (STUDIO_FEATURES.includes(feature)) return 'studio';
  return 'free';
}

function getSuggestedBoost(needed) {
  if (needed <= 64) return 64;
  if (needed <= 128) return 128;
  return 256;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get effective tier for a guild (checks linked servers, grant expiry, and grace period)
 */
async function getEffectiveTier(guildId) {
  const sub = await getSubscription(guildId);

  if (!sub) return 'free';

  // Check manual grant expiry
  if (sub.manualGrant && sub.manualGrant.expiresAt) {
    const expiresAt = new Date(sub.manualGrant.expiresAt);
    if (expiresAt < new Date()) {
      await clearManualGrant(guildId);
      return 'free';
    }
  }

  // Check if linked to a Studio (legacy Business) multi-server subscription
  if (sub.parentSubscription) {
    const parent = await getSubscription(sub.parentSubscription);
    if (normalizeTier(parent?.tier) === 'studio') {
      return 'studio';
    }
  }

  // Check grace period - if in grace period, maintain previous tier
  if (sub.gracePeriodEnd && sub.previousTier) {
    const gracePeriodEnd = new Date(sub.gracePeriodEnd);
    if (gracePeriodEnd > new Date()) {
      return normalizeTier(sub.previousTier);
    } else {
      // Grace period expired - clear it
      await updateSubscription(guildId, {
        gracePeriodEnd: null,
        previousTier: null,
      });
    }
  }

  return normalizeTier(sub.tier);
}

/**
 * Check if guild is in grace period
 */
async function isInGracePeriod(guildId) {
  const sub = await getSubscription(guildId);
  if (!sub?.gracePeriodEnd) return false;
  return new Date(sub.gracePeriodEnd) > new Date();
}

/**
 * Start grace period when subscription expires/cancels
 */
async function startGracePeriod(guildId, previousTier) {
  const gracePeriodEnd = new Date();
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  return await updateSubscription(guildId, {
    tier: 'free',
    gracePeriodEnd,
    previousTier,
  });
}

/**
 * Start a free trial (7 days of Pro)
 */
async function startFreeTrial(guildId, grantedBy) {
  const sub = await getOrCreateSubscription(guildId);

  // Check if trial already used
  if (sub.trialUsed) {
    return { success: false, reason: 'Trial already used on this server' };
  }

  // Check if already has a paid tier
  const currentTier = await getEffectiveTier(guildId);
  if (currentTier !== 'free') {
    return { success: false, reason: 'Server already has an active subscription' };
  }

  // Grant 7-day Pro trial
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await setManualGrant(guildId, 'pro', expiresAt, 'Free trial', grantedBy);
  await updateSubscription(guildId, { trialUsed: true });

  return { success: true, expiresAt };
}

/**
 * Check if a feature is available for a guild
 * @returns {{ allowed: boolean, reason?: string, upgradeRequired?: string }}
 */
async function checkFeature(guildId, feature) {
  const tier = await getEffectiveTier(guildId);

  if (PRO_FEATURES.includes(feature)) {
    if (tier === 'free') {
      return {
        allowed: false,
        reason: `${FEATURE_NAMES[feature] || feature} is a Pro feature`,
        upgradeRequired: 'pro',
      };
    }
  }

  if (STUDIO_FEATURES.includes(feature)) {
    if (tier !== 'studio') {
      return {
        allowed: false,
        reason: `${FEATURE_NAMES[feature] || feature} is part of the Studio plan`,
        upgradeRequired: 'studio',
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a participant limit is within tier allowance (including boosts).
 * Limits are only enforced when ENFORCE_TIERS is on (post-GOALS step) —
 * until then only the 512 platform cap applies.
 */
async function checkParticipantLimit(guildId, requestedLimit, boostToUse = null) {
  const PLATFORM_CAP = 512;
  if (requestedLimit > PLATFORM_CAP) {
    return { allowed: false, reason: `Maximum ${PLATFORM_CAP} participants allowed.`, canBuyBoost: false };
  }

  if (!features.enforceTiers) {
    return { allowed: true, effectiveMax: PLATFORM_CAP };
  }

  const tier = await getEffectiveTier(guildId);
  const baseMax = TIER_LIMITS[tier].maxParticipants;
  // Participant boosts belong to the parked token system
  const boostAmount = features.tokens ? (boostToUse || 0) : 0;
  const effectiveMax = Math.min(baseMax + boostAmount, PLATFORM_CAP);

  if (requestedLimit > effectiveMax) {
    const reason = boostAmount
      ? `Your ${tier} plan allows up to ${baseMax} participants (+${boostAmount} boost = ${effectiveMax}). You requested ${requestedLimit}.`
      : `Your ${tier} plan allows up to ${baseMax} participants. You requested ${requestedLimit}.`;

    return {
      allowed: false,
      reason,
      canBuyBoost: features.tokens && requestedLimit <= PLATFORM_CAP,
      suggestedBoost: getSuggestedBoost(requestedLimit - baseMax),
      upgradeRequired: getNextTier(tier),
    };
  }

  return { allowed: true, effectiveMax };
}

/**
 * Check monthly tournament limit. Enforced only when ENFORCE_TIERS is on;
 * tournament tokens (parked) can extend the cap when that system returns.
 */
async function checkTournamentLimit(guildId) {
  if (!features.enforceTiers) {
    return { allowed: true, remaining: Infinity, tokensAvailable: 0, usingToken: false };
  }

  const sub = await getOrCreateSubscription(guildId);
  const tier = await getEffectiveTier(guildId);
  const baseLimit = TIER_LIMITS[tier].tournamentsPerMonth;

  const used = sub.usage?.tournamentsThisMonth || 0;
  const tokens = features.tokens ? (sub.tokens?.tournament || 0) : 0;

  // Check if within base limit first (Pro/Studio: Infinity — always within)
  if (used < baseLimit) {
    return {
      allowed: true,
      remaining: baseLimit === Infinity ? Infinity : baseLimit - used,
      tokensAvailable: tokens,
      usingToken: false,
    };
  }

  // Base limit exceeded - check tokens
  if (tokens > 0) {
    return {
      allowed: true,
      remaining: 0,
      tokensAvailable: tokens,
      usingToken: true,
      message: `Using 1 tournament token (${tokens - 1} remaining after this)`,
    };
  }

  // No tokens available
  return {
    allowed: false,
    reason: `You've used all ${baseLimit} free tournaments this month. Pro has no monthly limit.`,
    canBuyTokens: features.tokens,
    upgradeRequired: getNextTier(tier),
    resetDate: sub.usage?.monthResetDate,
  };
}

/**
 * Check concurrent tournament limit. Enforced only when ENFORCE_TIERS is on.
 */
async function checkConcurrentLimit(guildId) {
  if (!features.enforceTiers) {
    return { allowed: true };
  }

  const sub = await getOrCreateSubscription(guildId);
  const tier = await getEffectiveTier(guildId);
  const limit = TIER_LIMITS[tier].maxConcurrent;
  const current = sub.usage?.concurrentActive || 0;

  if (limit === Infinity) {
    return { allowed: true };
  }

  if (current >= limit) {
    return {
      allowed: false,
      reason: `You have ${current} active tournament${current !== 1 ? 's' : ''}. Your ${tier} plan allows ${limit} at once.`,
      upgradeRequired: getNextTier(tier),
    };
  }

  return { allowed: true, remaining: limit - current };
}

/**
 * Record tournament creation (consumes token if needed)
 */
async function recordTournamentCreation(guildId, participantBoostUsed = null) {
  // Always track usage/concurrency (cheap, drives analytics + concurrent limit).
  await incrementTournamentUsage(guildId);
  await incrementConcurrent(guildId);

  // Tokens parked: never consume tournament tokens or participant boosts.
  if (!features.tokens) {
    return { usedToken: false, usedBoost: null };
  }

  const sub = await getOrCreateSubscription(guildId);
  const tier = await getEffectiveTier(guildId);
  const baseLimit = TIER_LIMITS[tier].tournamentsPerMonth;

  // Check if we need to consume a token
  const usedToken = sub.usage.tournamentsThisMonth > baseLimit;
  if (usedToken) {
    await consumeTournamentToken(guildId);
  }

  // Consume participant boost if used
  let usedBoost = null;
  if (participantBoostUsed) {
    const consumed = await consumeParticipantBoost(guildId, participantBoostUsed);
    if (consumed) {
      usedBoost = participantBoostUsed;
    }
  }

  return { usedToken, usedBoost };
}

/**
 * Record tournament completion (decrements concurrent count)
 */
async function recordTournamentCompletion(guildId) {
  const { decrementConcurrent } = require('../data/subscriptions');
  await decrementConcurrent(guildId);
}

// ============================================================================
// Grant Functions
// ============================================================================

/**
 * Grant a tier to a guild
 */
async function grantTier(guildId, tier, days, reason, grantedBy) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  return await setManualGrant(guildId, tier, expiresAt, reason, grantedBy);
}

/**
 * Revoke a granted tier
 */
async function revokeTier(guildId) {
  return await clearManualGrant(guildId);
}

/**
 * Grant free tokens to a guild
 */
async function grantTokens(guildId, amount) {
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  return await addTournamentTokens(guildId, amount, expiryDate);
}

/**
 * Get all active manual grants
 */
async function getActiveGrants() {
  const grants = await getManualGrants();
  return grants.filter(sub => {
    if (!sub.manualGrant?.expiresAt) return false;
    return new Date(sub.manualGrant.expiresAt) > new Date();
  });
}

// ============================================================================
// Embed Builders
// ============================================================================

/**
 * Create upgrade prompt embed
 */
function getUpgradeEmbed(feature, currentTier, customReason = null) {
  const requiredTier = getRequiredTierForFeature(feature);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⭐ Upgrade Required')
    .setDescription(customReason || `**${FEATURE_NAMES[feature] || feature}** requires ${capitalize(requiredTier)} tier.`)
    .addFields(
      { name: 'Your Current Tier', value: capitalize(currentTier), inline: true },
      { name: 'Required Tier', value: capitalize(requiredTier), inline: true }
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('dismiss_upgrade')
        .setLabel('Maybe Later')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Create token purchase prompt embed
 */
function getTokenPurchaseEmbed(limitCheck) {
  const embed = new EmbedBuilder()
    .setColor(0xFFA500)
    .setTitle('🎟️ Monthly Limit Reached')
    .setDescription(limitCheck.reason)
    .addFields(
      { name: 'Option 1', value: 'Purchase tournament tokens to continue this month', inline: false },
      { name: 'Option 2', value: 'Wait for monthly reset', inline: false }
    );

  if (limitCheck.resetDate) {
    const resetTimestamp = Math.floor(new Date(limitCheck.resetDate).getTime() / 1000);
    embed.addFields({
      name: 'Resets',
      value: `<t:${resetTimestamp}:R>`,
      inline: false,
    });
  }

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('dismiss_upgrade')
        .setLabel('OK')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Create boost purchase prompt embed
 */
function getBoostPurchaseEmbed(participantCheck) {
  const embed = new EmbedBuilder()
    .setColor(0xFFA500)
    .setTitle('👥 Participant Limit Exceeded')
    .setDescription(participantCheck.reason)
    .addFields(
      { name: 'Suggested Boost', value: `+${participantCheck.suggestedBoost} participants`, inline: false }
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('dismiss_upgrade')
        .setLabel('OK')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Create subscription status embed
 */
async function getStatusEmbed(guildId) {
  const sub = await getOrCreateSubscription(guildId);
  const tier = await getEffectiveTier(guildId);
  const limits = TIER_LIMITS[tier];

  const tierEmoji = {
    free: '🆓',
    pro: '💎',
    studio: '🏢',
  };

  const embed = new EmbedBuilder()
    .setColor(tier === 'free' ? 0x95a5a6 : 0x5865F2)
    .setTitle(`${tierEmoji[tier]} Subscription Status`)
    .addFields(
      { name: 'Current Tier', value: capitalize(tier), inline: true },
      { name: 'Billing', value: sub.billingCycle ? capitalize(sub.billingCycle) : 'N/A', inline: true }
    );

  // Add grant info if applicable
  if (sub.manualGrant) {
    const expiresAt = Math.floor(new Date(sub.manualGrant.expiresAt).getTime() / 1000);
    embed.addFields({
      name: sub.manualGrant.reason === 'Free trial' ? 'Trial Expires' : 'Grant Expires',
      value: `<t:${expiresAt}:R>`,
      inline: true,
    });
  }

  // Show grace period warning if applicable
  if (sub.gracePeriodEnd && sub.previousTier) {
    const gracePeriodEnd = new Date(sub.gracePeriodEnd);
    if (gracePeriodEnd > new Date()) {
      const graceTimestamp = Math.floor(gracePeriodEnd.getTime() / 1000);
      embed.addFields({
        name: '⚠️ Grace Period',
        value: `Your ${capitalize(sub.previousTier)} features will end <t:${graceTimestamp}:R>. Renew to keep them!`,
        inline: false,
      });
    }
  }

  // Usage section
  const used = sub.usage?.tournamentsThisMonth || 0;
  const concurrent = sub.usage?.concurrentActive || 0;
  const resetDate = sub.usage?.monthResetDate;
  const resetTimestamp = resetDate ? Math.floor(new Date(resetDate).getTime() / 1000) : null;

  // While tier limits aren't enforced (pre-launch period), show ∞ so usage
  // never reads as an overage.
  const showLimit = (n) => (!features.enforceTiers || n === Infinity) ? '∞' : String(n);

  embed.addFields(
    { name: '\u200B', value: '**📊 Usage This Month**', inline: false },
    { name: 'Tournaments', value: `${used} / ${showLimit(limits.tournamentsPerMonth)}`, inline: true },
    { name: 'Concurrent Active', value: `${concurrent} / ${showLimit(limits.maxConcurrent)}`, inline: true },
    { name: 'Max Participants', value: showLimit(limits.maxParticipants), inline: true }
  );

  if (resetTimestamp) {
    embed.addFields({
      name: 'Resets',
      value: `<t:${resetTimestamp}:R>`,
      inline: true,
    });
  }

  // Token balance (parked — only shown when the token system is enabled)
  if (features.tokens) {
  const tokens = sub.tokens?.tournament || 0;
  const boosts = sub.tokens?.participantBoosts?.filter(b => !b.used) || [];

  embed.addFields(
    { name: '\u200B', value: '**🎟️ Tokens & Boosts**', inline: false },
    { name: 'Tournament Tokens', value: `${tokens}`, inline: true },
    { name: 'Participant Boosts', value: boosts.length > 0 ? boosts.map(b => `+${b.amount}`).join(', ') : 'None', inline: true }
  );
  }

  return embed;
}

module.exports = {
  // Config
  TIER_LIMITS,
  TIER_ORDER,
  PRO_FEATURES,
  STUDIO_FEATURES,
  PREMIUM_FEATURES,   // legacy alias of PRO_FEATURES
  BUSINESS_FEATURES,  // legacy alias of STUDIO_FEATURES
  FEATURE_NAMES,
  GRACE_PERIOD_DAYS,
  normalizeTier,

  // Core functions
  getEffectiveTier,
  checkFeature,
  checkParticipantLimit,
  checkTournamentLimit,
  checkConcurrentLimit,
  recordTournamentCreation,
  recordTournamentCompletion,

  // Grace period & trials
  isInGracePeriod,
  startGracePeriod,
  startFreeTrial,
  cleanupExpiredTokens,

  // Grant functions
  grantTier,
  revokeTier,
  grantTokens,
  getActiveGrants,

  // Embed builders
  getUpgradeEmbed,
  getTokenPurchaseEmbed,
  getBoostPurchaseEmbed,
  getStatusEmbed,

  // Helpers
  capitalize,
  getNextTier,
  getRequiredTierForFeature,
};
