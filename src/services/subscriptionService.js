// Subscription service
// Tier checks, feature gates, limits, tokens, and grants

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
// Tier Limits Configuration
// ============================================================================

const TIER_LIMITS = {
  free: {
    tournamentsPerMonth: 3,
    maxParticipants: 50,
    maxConcurrent: 1,
    maxServers: 1,
  },
  premium: {
    tournamentsPerMonth: 15,
    maxParticipants: 128,
    maxConcurrent: 3,
    maxServers: 1,
  },
  pro: {
    tournamentsPerMonth: 50,
    maxParticipants: 256,
    maxConcurrent: 10,
    maxServers: 1,
  },
  business: {
    tournamentsPerMonth: 200,
    maxParticipants: 512,
    maxConcurrent: Infinity,
    maxServers: 5,
  },
};

// ============================================================================
// Feature Lists
// ============================================================================

const PREMIUM_FEATURES = [
  'checkin',
  'seeding',
  'captain_mode',
  'auto_cleanup',
  'required_roles',
  'full_reminders',
];

const PRO_FEATURES = [
  'tournament_templates',
  'advanced_analytics',
];

const BUSINESS_FEATURES = [
  'api_access',
  'webhooks',
  'white_label',
  'multi_server',
];

// ============================================================================
// Feature Names (for display)
// ============================================================================

const FEATURE_NAMES = {
  checkin: 'Check-in System',
  seeding: 'Seeding',
  captain_mode: 'Captain Mode',
  auto_cleanup: 'Auto-Cleanup',
  required_roles: 'Required Roles',
  full_reminders: 'Full Reminders (24h + 1h)',
  tournament_templates: 'Tournament Templates',
  advanced_analytics: 'Advanced Analytics',
  api_access: 'Results API',
  webhooks: 'Webhooks',
  white_label: 'White-Label Branding',
  multi_server: 'Multi-Server Support',
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
  const tiers = ['free', 'premium', 'pro', 'business'];
  const index = tiers.indexOf(currentTier);
  if (index === -1 || index === tiers.length - 1) return null;
  return tiers[index + 1];
}

function getRequiredTierForFeature(feature) {
  if (PREMIUM_FEATURES.includes(feature)) return 'premium';
  if (PRO_FEATURES.includes(feature)) return 'pro';
  if (BUSINESS_FEATURES.includes(feature)) return 'business';
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
function getEffectiveTier(guildId) {
  const sub = getSubscription(guildId);

  if (!sub) return 'free';

  // Check manual grant expiry
  if (sub.manualGrant && sub.manualGrant.expiresAt) {
    const expiresAt = new Date(sub.manualGrant.expiresAt);
    if (expiresAt < new Date()) {
      clearManualGrant(guildId);
      return 'free';
    }
  }

  // Check if linked to a Business subscription
  if (sub.parentSubscription) {
    const parent = getSubscription(sub.parentSubscription);
    if (parent?.tier === 'business') {
      return 'business';
    }
  }

  // Check grace period - if in grace period, maintain previous tier
  if (sub.gracePeriodEnd && sub.previousTier) {
    const gracePeriodEnd = new Date(sub.gracePeriodEnd);
    if (gracePeriodEnd > new Date()) {
      return sub.previousTier;
    } else {
      // Grace period expired - clear it
      updateSubscription(guildId, {
        gracePeriodEnd: null,
        previousTier: null,
      });
    }
  }

  return sub.tier || 'free';
}

/**
 * Check if guild is in grace period
 */
function isInGracePeriod(guildId) {
  const sub = getSubscription(guildId);
  if (!sub?.gracePeriodEnd) return false;
  return new Date(sub.gracePeriodEnd) > new Date();
}

/**
 * Start grace period when subscription expires/cancels
 */
function startGracePeriod(guildId, previousTier) {
  const gracePeriodEnd = new Date();
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  return updateSubscription(guildId, {
    tier: 'free',
    gracePeriodEnd,
    previousTier,
  });
}

/**
 * Start a free trial (7 days of Premium)
 */
function startFreeTrial(guildId, grantedBy) {
  const sub = getOrCreateSubscription(guildId);

  // Check if trial already used
  if (sub.trialUsed) {
    return { success: false, reason: 'Trial already used on this server' };
  }

  // Check if already has a paid tier
  const currentTier = getEffectiveTier(guildId);
  if (currentTier !== 'free') {
    return { success: false, reason: 'Server already has an active subscription' };
  }

  // Grant 7-day Premium trial
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  setManualGrant(guildId, 'premium', expiresAt, 'Free trial', grantedBy);
  updateSubscription(guildId, { trialUsed: true });

  return { success: true, expiresAt };
}

/**
 * Check if a feature is available for a guild
 * @returns {{ allowed: boolean, reason?: string, upgradeRequired?: string }}
 */
function checkFeature(guildId, feature) {
  const tier = getEffectiveTier(guildId);

  if (PREMIUM_FEATURES.includes(feature)) {
    if (tier === 'free') {
      return {
        allowed: false,
        reason: `${FEATURE_NAMES[feature] || feature} is a Premium feature`,
        upgradeRequired: 'premium',
      };
    }
  }

  if (PRO_FEATURES.includes(feature)) {
    if (tier === 'free' || tier === 'premium') {
      return {
        allowed: false,
        reason: `${FEATURE_NAMES[feature] || feature} is a Pro feature`,
        upgradeRequired: 'pro',
      };
    }
  }

  if (BUSINESS_FEATURES.includes(feature)) {
    if (tier !== 'business') {
      return {
        allowed: false,
        reason: `${FEATURE_NAMES[feature] || feature} is a Business feature`,
        upgradeRequired: 'business',
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a participant limit is within tier allowance (including boosts)
 */
function checkParticipantLimit(guildId, requestedLimit, boostToUse = null) {
  const tier = getEffectiveTier(guildId);
  const baseMax = TIER_LIMITS[tier].maxParticipants;
  const boostAmount = boostToUse || 0;
  const effectiveMax = Math.min(baseMax + boostAmount, 512); // Platform cap

  if (requestedLimit > effectiveMax) {
    const reason = boostAmount
      ? `Your ${tier} tier allows up to ${baseMax} participants (+${boostAmount} boost = ${effectiveMax}). You requested ${requestedLimit}.`
      : `Your ${tier} tier allows up to ${baseMax} participants. You requested ${requestedLimit}.`;

    return {
      allowed: false,
      reason,
      canBuyBoost: requestedLimit <= 512,
      suggestedBoost: getSuggestedBoost(requestedLimit - baseMax),
    };
  }

  return { allowed: true, effectiveMax };
}

/**
 * Check monthly tournament limit (including tokens)
 */
function checkTournamentLimit(guildId) {
  const sub = getOrCreateSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const baseLimit = TIER_LIMITS[tier].tournamentsPerMonth;

  const used = sub.usage?.tournamentsThisMonth || 0;
  const tokens = sub.tokens?.tournament || 0;

  // Check if within base limit first
  if (used < baseLimit) {
    return {
      allowed: true,
      remaining: baseLimit - used,
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
    reason: `You've used all ${baseLimit} tournaments this month and have no tokens.`,
    canBuyTokens: true,
    resetDate: sub.usage?.monthResetDate,
  };
}

/**
 * Check concurrent tournament limit
 */
function checkConcurrentLimit(guildId) {
  const sub = getOrCreateSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const limit = TIER_LIMITS[tier].maxConcurrent;
  const current = sub.usage?.concurrentActive || 0;

  if (limit === Infinity) {
    return { allowed: true };
  }

  if (current >= limit) {
    return {
      allowed: false,
      reason: `You have ${current} active tournament${current !== 1 ? 's' : ''}. Your ${tier} tier allows ${limit} concurrent.`,
      upgradeRequired: getNextTier(tier),
    };
  }

  return { allowed: true, remaining: limit - current };
}

/**
 * Record tournament creation (consumes token if needed)
 */
function recordTournamentCreation(guildId, participantBoostUsed = null) {
  const sub = getOrCreateSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const baseLimit = TIER_LIMITS[tier].tournamentsPerMonth;

  // Increment usage
  incrementTournamentUsage(guildId);
  incrementConcurrent(guildId);

  // Check if we need to consume a token
  const usedToken = sub.usage.tournamentsThisMonth > baseLimit;
  if (usedToken) {
    consumeTournamentToken(guildId);
  }

  // Consume participant boost if used
  let usedBoost = null;
  if (participantBoostUsed) {
    const consumed = consumeParticipantBoost(guildId, participantBoostUsed);
    if (consumed) {
      usedBoost = participantBoostUsed;
    }
  }

  return { usedToken, usedBoost };
}

/**
 * Record tournament completion (decrements concurrent count)
 */
function recordTournamentCompletion(guildId) {
  const { decrementConcurrent } = require('../data/subscriptions');
  decrementConcurrent(guildId);
}

// ============================================================================
// Grant Functions
// ============================================================================

/**
 * Grant a tier to a guild
 */
function grantTier(guildId, tier, days, reason, grantedBy) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  return setManualGrant(guildId, tier, expiresAt, reason, grantedBy);
}

/**
 * Revoke a granted tier
 */
function revokeTier(guildId) {
  return clearManualGrant(guildId);
}

/**
 * Grant free tokens to a guild
 */
function grantTokens(guildId, amount) {
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  return addTournamentTokens(guildId, amount, expiryDate);
}

/**
 * Get all active manual grants
 */
function getActiveGrants() {
  return getManualGrants().filter(sub => {
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
function getStatusEmbed(guildId) {
  const sub = getOrCreateSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const limits = TIER_LIMITS[tier];

  const tierEmoji = {
    free: '🆓',
    premium: '⭐',
    pro: '💎',
    business: '🏢',
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

  embed.addFields(
    { name: '\u200B', value: '**📊 Usage This Month**', inline: false },
    { name: 'Tournaments', value: `${used} / ${limits.tournamentsPerMonth}`, inline: true },
    { name: 'Concurrent Active', value: `${concurrent} / ${limits.maxConcurrent === Infinity ? '∞' : limits.maxConcurrent}`, inline: true },
    { name: 'Max Participants', value: `${limits.maxParticipants}`, inline: true }
  );

  if (resetTimestamp) {
    embed.addFields({
      name: 'Resets',
      value: `<t:${resetTimestamp}:R>`,
      inline: true,
    });
  }

  // Token balance
  const tokens = sub.tokens?.tournament || 0;
  const boosts = sub.tokens?.participantBoosts?.filter(b => !b.used) || [];

  embed.addFields(
    { name: '\u200B', value: '**🎟️ Tokens & Boosts**', inline: false },
    { name: 'Tournament Tokens', value: `${tokens}`, inline: true },
    { name: 'Participant Boosts', value: boosts.length > 0 ? boosts.map(b => `+${b.amount}`).join(', ') : 'None', inline: true }
  );

  return embed;
}

module.exports = {
  // Config
  TIER_LIMITS,
  PREMIUM_FEATURES,
  PRO_FEATURES,
  BUSINESS_FEATURES,
  FEATURE_NAMES,
  GRACE_PERIOD_DAYS,

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
