// Subscription data store
// Per-server subscription status, tokens, and usage tracking
// Will be replaced with database in future

const subscriptions = new Map(); // guildId → subscription

/**
 * Default subscription object (free tier)
 */
function createDefaultSubscription(guildId) {
  const now = new Date();
  const monthResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1); // First of next month

  return {
    guildId,
    tier: 'free',

    // Stripe data (null for free tier and manual grants)
    stripeCustomerId: null,
    stripeSubscriptionId: null,

    // Billing
    billingCycle: null, // 'monthly' | 'annual' | null
    currentPeriodStart: null,
    currentPeriodEnd: null,

    // Manual grant (for trials)
    manualGrant: null,

    // Token balance
    tokens: {
      tournament: 0,
      tournamentExpiry: null,
      participantBoosts: [],
      purchaseHistory: [],
    },

    // Usage tracking
    usage: {
      tournamentsThisMonth: 0,
      monthResetDate,
      concurrentActive: 0,
    },

    // Business tier multi-server
    linkedServers: [],
    parentSubscription: null,

    // Business tier API access
    apiKey: null,
    apiKeyHash: null,
    webhookUrl: null,
    webhookSecret: null,

    // Business tier white-label branding
    branding: {
      botName: null,      // Custom bot name for embeds
      botAvatar: null,    // Custom avatar URL for embeds
      accentColor: null,  // Custom accent color (hex)
      footerText: null,   // Custom footer text
    },

    // Grace period (when subscription expires)
    gracePeriodEnd: null,
    previousTier: null,

    // Self-service trial
    trialUsed: false,

    // Metadata
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Core CRUD
// ============================================================================

function getSubscription(guildId) {
  if (!subscriptions.has(guildId)) {
    return null;
  }
  return subscriptions.get(guildId);
}

function getOrCreateSubscription(guildId) {
  if (!subscriptions.has(guildId)) {
    subscriptions.set(guildId, createDefaultSubscription(guildId));
  }
  return subscriptions.get(guildId);
}

function setSubscription(guildId, data) {
  const sub = { ...createDefaultSubscription(guildId), ...data, guildId };
  sub.updatedAt = new Date();
  subscriptions.set(guildId, sub);
  return sub;
}

function updateSubscription(guildId, data) {
  const current = getOrCreateSubscription(guildId);
  const updated = { ...current, ...data };
  updated.updatedAt = new Date();
  subscriptions.set(guildId, updated);
  return updated;
}

function deleteSubscription(guildId) {
  return subscriptions.delete(guildId);
}

// ============================================================================
// Usage Tracking
// ============================================================================

function incrementTournamentUsage(guildId) {
  const sub = getOrCreateSubscription(guildId);
  sub.usage.tournamentsThisMonth++;
  sub.updatedAt = new Date();
  return sub.usage.tournamentsThisMonth;
}

function resetMonthlyUsage(guildId) {
  const sub = getOrCreateSubscription(guildId);
  sub.usage.tournamentsThisMonth = 0;

  // Set next reset date to first of next month
  const now = new Date();
  sub.usage.monthResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  sub.updatedAt = new Date();

  return sub;
}

function incrementConcurrent(guildId) {
  const sub = getOrCreateSubscription(guildId);
  sub.usage.concurrentActive++;
  sub.updatedAt = new Date();
  return sub.usage.concurrentActive;
}

function decrementConcurrent(guildId) {
  const sub = getOrCreateSubscription(guildId);
  if (sub.usage.concurrentActive > 0) {
    sub.usage.concurrentActive--;
  }
  sub.updatedAt = new Date();
  return sub.usage.concurrentActive;
}

// ============================================================================
// Token Management
// ============================================================================

function addTournamentTokens(guildId, amount, expiryDate) {
  const sub = getOrCreateSubscription(guildId);
  sub.tokens.tournament += amount;

  // Track oldest expiry (tokens expire FIFO)
  if (!sub.tokens.tournamentExpiry || expiryDate < sub.tokens.tournamentExpiry) {
    sub.tokens.tournamentExpiry = expiryDate;
  }

  sub.updatedAt = new Date();
  return sub.tokens.tournament;
}

function consumeTournamentToken(guildId) {
  const sub = getOrCreateSubscription(guildId);
  if (sub.tokens.tournament > 0) {
    sub.tokens.tournament--;
    sub.updatedAt = new Date();
    return true;
  }
  return false;
}

function addParticipantBoost(guildId, amount) {
  const sub = getOrCreateSubscription(guildId);
  sub.tokens.participantBoosts.push({
    amount,
    purchasedAt: new Date(),
    used: false,
    usedAt: null,
  });
  sub.updatedAt = new Date();
  return sub.tokens.participantBoosts;
}

function consumeParticipantBoost(guildId, amount) {
  const sub = getOrCreateSubscription(guildId);
  const boostIndex = sub.tokens.participantBoosts.findIndex(
    b => b.amount === amount && !b.used
  );

  if (boostIndex !== -1) {
    sub.tokens.participantBoosts[boostIndex].used = true;
    sub.tokens.participantBoosts[boostIndex].usedAt = new Date();
    sub.updatedAt = new Date();
    return true;
  }
  return false;
}

function getTokenBalance(guildId) {
  const sub = getSubscription(guildId);
  if (!sub) {
    return { tournament: 0, participantBoosts: [] };
  }

  // Check for expired tokens
  const now = new Date();
  let validTokens = sub.tokens.tournament;
  if (sub.tokens.tournamentExpiry && new Date(sub.tokens.tournamentExpiry) < now) {
    // Tokens have expired - clear them
    sub.tokens.tournament = 0;
    sub.tokens.tournamentExpiry = null;
    validTokens = 0;
  }

  return {
    tournament: validTokens,
    tournamentExpiry: sub.tokens.tournamentExpiry,
    participantBoosts: sub.tokens.participantBoosts.filter(b => !b.used),
  };
}

/**
 * Clean up expired tokens across all subscriptions
 */
function cleanupExpiredTokens() {
  const now = new Date();
  let cleaned = 0;

  for (const sub of subscriptions.values()) {
    if (sub.tokens.tournament > 0 && sub.tokens.tournamentExpiry) {
      if (new Date(sub.tokens.tournamentExpiry) < now) {
        sub.tokens.tournament = 0;
        sub.tokens.tournamentExpiry = null;
        sub.updatedAt = now;
        cleaned++;
      }
    }
  }

  return cleaned;
}

/**
 * Get branding settings for a guild
 */
function getBranding(guildId) {
  const sub = getSubscription(guildId);
  if (!sub?.branding) {
    return null;
  }

  // Only return branding if at least one field is set
  const { botName, botAvatar, accentColor, footerText } = sub.branding;
  if (!botName && !botAvatar && !accentColor && !footerText) {
    return null;
  }

  return sub.branding;
}

/**
 * Update branding settings for a guild
 */
function updateBranding(guildId, brandingData) {
  const sub = getOrCreateSubscription(guildId);

  if (!sub.branding) {
    sub.branding = {
      botName: null,
      botAvatar: null,
      accentColor: null,
      footerText: null,
    };
  }

  // Merge new branding data
  Object.assign(sub.branding, brandingData);
  sub.updatedAt = new Date();

  return sub.branding;
}

/**
 * Clear all branding settings for a guild
 */
function clearBranding(guildId) {
  const sub = getSubscription(guildId);
  if (sub) {
    sub.branding = {
      botName: null,
      botAvatar: null,
      accentColor: null,
      footerText: null,
    };
    sub.updatedAt = new Date();
  }
  return sub;
}

function addPurchaseHistory(guildId, purchase) {
  const sub = getOrCreateSubscription(guildId);
  sub.tokens.purchaseHistory.push(purchase);
  sub.updatedAt = new Date();
  return sub.tokens.purchaseHistory;
}

// ============================================================================
// Business Multi-Server
// ============================================================================

function linkServer(parentGuildId, childGuildId) {
  const parent = getOrCreateSubscription(parentGuildId);

  if (!parent.linkedServers.includes(childGuildId)) {
    parent.linkedServers.push(childGuildId);
  }

  const child = getOrCreateSubscription(childGuildId);
  child.parentSubscription = parentGuildId;

  parent.updatedAt = new Date();
  child.updatedAt = new Date();

  return parent.linkedServers;
}

function unlinkServer(parentGuildId, childGuildId) {
  const parent = getSubscription(parentGuildId);
  if (parent) {
    parent.linkedServers = parent.linkedServers.filter(id => id !== childGuildId);
    parent.updatedAt = new Date();
  }

  const child = getSubscription(childGuildId);
  if (child) {
    child.parentSubscription = null;
    child.updatedAt = new Date();
  }

  return parent?.linkedServers || [];
}

function getLinkedServers(guildId) {
  const sub = getSubscription(guildId);
  return sub?.linkedServers || [];
}

// ============================================================================
// Queries
// ============================================================================

function getActiveSubscriptions() {
  return Array.from(subscriptions.values()).filter(s => s.tier !== 'free');
}

function getAllSubscriptions() {
  return Array.from(subscriptions.values());
}

function getExpiringSubscriptions(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  return Array.from(subscriptions.values()).filter(sub => {
    if (sub.manualGrant?.expiresAt) {
      return sub.manualGrant.expiresAt <= cutoff;
    }
    if (sub.currentPeriodEnd) {
      return sub.currentPeriodEnd <= cutoff;
    }
    return false;
  });
}

function getExpiringTokens(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  return Array.from(subscriptions.values()).filter(sub => {
    return sub.tokens.tournament > 0 &&
           sub.tokens.tournamentExpiry &&
           sub.tokens.tournamentExpiry <= cutoff;
  });
}

function getSubscriptionsNeedingReset() {
  const now = new Date();
  return Array.from(subscriptions.values()).filter(sub => {
    return sub.usage.monthResetDate && sub.usage.monthResetDate <= now;
  });
}

// ============================================================================
// Manual Grants
// ============================================================================

function setManualGrant(guildId, tier, expiresAt, reason, grantedBy) {
  const sub = getOrCreateSubscription(guildId);
  sub.tier = tier;
  sub.manualGrant = {
    grantedBy,
    grantedAt: new Date(),
    expiresAt,
    reason,
  };
  sub.updatedAt = new Date();
  return sub;
}

function clearManualGrant(guildId) {
  const sub = getSubscription(guildId);
  if (sub) {
    sub.tier = 'free';
    sub.manualGrant = null;
    sub.updatedAt = new Date();
  }
  return sub;
}

function getManualGrants() {
  return Array.from(subscriptions.values()).filter(s => s.manualGrant !== null);
}

module.exports = {
  // Core CRUD
  getSubscription,
  getOrCreateSubscription,
  setSubscription,
  updateSubscription,
  deleteSubscription,

  // Usage tracking
  incrementTournamentUsage,
  resetMonthlyUsage,
  incrementConcurrent,
  decrementConcurrent,

  // Token management
  addTournamentTokens,
  consumeTournamentToken,
  addParticipantBoost,
  consumeParticipantBoost,
  getTokenBalance,
  addPurchaseHistory,
  cleanupExpiredTokens,

  // Branding (Business tier)
  getBranding,
  updateBranding,
  clearBranding,

  // Business multi-server
  linkServer,
  unlinkServer,
  getLinkedServers,

  // Queries
  getActiveSubscriptions,
  getAllSubscriptions,
  getExpiringSubscriptions,
  getExpiringTokens,
  getSubscriptionsNeedingReset,

  // Manual grants
  setManualGrant,
  clearManualGrant,
  getManualGrants,

  // For testing/debugging
  subscriptions,
};
