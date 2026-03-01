// Subscription data store — backed by PostgreSQL

const db = require('../db');

// ============================================================================
// Row converters
// ============================================================================

function rowToSubscription(row) {
  return {
    guildId: row.guild_id,
    tier: row.tier,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    billingCycle: row.billing_cycle,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    manualGrant: row.manual_grant || null,
    tokens: row.tokens || { tournament: 0, tournamentExpiry: null, participantBoosts: [], purchaseHistory: [] },
    usage: row.usage || { tournamentsThisMonth: 0, monthResetDate: null, concurrentActive: 0 },
    linkedServers: row.linked_servers || [],
    parentSubscription: row.parent_subscription,
    apiKey: row.api_key,
    apiKeyHash: row.api_key_hash,
    webhookUrl: row.webhook_url,
    webhookSecret: row.webhook_secret,
    branding: row.branding || { botName: null, botAvatar: null, accentColor: null, footerText: null },
    gracePeriodEnd: row.grace_period_end,
    previousTier: row.previous_tier,
    trialUsed: row.trial_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subscriptionToRow(sub) {
  return {
    guild_id: sub.guildId,
    tier: sub.tier,
    stripe_customer_id: sub.stripeCustomerId,
    stripe_subscription_id: sub.stripeSubscriptionId,
    billing_cycle: sub.billingCycle,
    current_period_start: sub.currentPeriodStart,
    current_period_end: sub.currentPeriodEnd,
    manual_grant: sub.manualGrant ? JSON.stringify(sub.manualGrant) : null,
    tokens: JSON.stringify(sub.tokens),
    usage: JSON.stringify(sub.usage),
    linked_servers: JSON.stringify(sub.linkedServers || []),
    parent_subscription: sub.parentSubscription,
    api_key: sub.apiKey,
    api_key_hash: sub.apiKeyHash,
    webhook_url: sub.webhookUrl,
    webhook_secret: sub.webhookSecret,
    branding: JSON.stringify(sub.branding),
    grace_period_end: sub.gracePeriodEnd,
    previous_tier: sub.previousTier,
    trial_used: sub.trialUsed,
  };
}

function createDefaultSubscription(guildId) {
  const now = new Date();
  const monthResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    guildId,
    tier: 'free',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingCycle: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    manualGrant: null,
    tokens: {
      tournament: 0,
      tournamentExpiry: null,
      participantBoosts: [],
      purchaseHistory: [],
    },
    usage: {
      tournamentsThisMonth: 0,
      monthResetDate,
      concurrentActive: 0,
    },
    linkedServers: [],
    parentSubscription: null,
    apiKey: null,
    apiKeyHash: null,
    webhookUrl: null,
    webhookSecret: null,
    branding: {
      botName: null,
      botAvatar: null,
      accentColor: null,
      footerText: null,
    },
    gracePeriodEnd: null,
    previousTier: null,
    trialUsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Core CRUD
// ============================================================================

async function getSubscription(guildId) {
  const row = await db('subscriptions').where('guild_id', guildId).first();
  if (!row) return null;
  return rowToSubscription(row);
}

async function getOrCreateSubscription(guildId) {
  let sub = await getSubscription(guildId);
  if (!sub) {
    sub = createDefaultSubscription(guildId);
    await db('subscriptions').insert(subscriptionToRow(sub));
  }
  return sub;
}

async function setSubscription(guildId, data) {
  const sub = { ...createDefaultSubscription(guildId), ...data, guildId };
  sub.updatedAt = new Date();
  const row = subscriptionToRow(sub);

  await db('subscriptions')
    .insert(row)
    .onConflict('guild_id')
    .merge({ ...row, updated_at: db.fn.now() });

  return sub;
}

async function updateSubscription(guildId, data) {
  const current = await getOrCreateSubscription(guildId);
  const updated = { ...current, ...data };
  updated.updatedAt = new Date();
  const row = subscriptionToRow(updated);
  delete row.guild_id; // Don't update primary key

  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ ...row, updated_at: db.fn.now() });

  return updated;
}

async function deleteSubscription(guildId) {
  const deleted = await db('subscriptions').where('guild_id', guildId).del();
  return deleted > 0;
}

// ============================================================================
// Usage Tracking
// ============================================================================

async function incrementTournamentUsage(guildId) {
  const sub = await getOrCreateSubscription(guildId);
  sub.usage.tournamentsThisMonth++;
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ usage: JSON.stringify(sub.usage), updated_at: db.fn.now() });
  return sub.usage.tournamentsThisMonth;
}

async function resetMonthlyUsage(guildId) {
  const sub = await getOrCreateSubscription(guildId);
  sub.usage.tournamentsThisMonth = 0;
  const now = new Date();
  sub.usage.monthResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ usage: JSON.stringify(sub.usage), updated_at: db.fn.now() });
  return sub;
}

async function incrementConcurrent(guildId) {
  const sub = await getOrCreateSubscription(guildId);
  sub.usage.concurrentActive++;
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ usage: JSON.stringify(sub.usage), updated_at: db.fn.now() });
  return sub.usage.concurrentActive;
}

async function decrementConcurrent(guildId) {
  const sub = await getOrCreateSubscription(guildId);
  if (sub.usage.concurrentActive > 0) {
    sub.usage.concurrentActive--;
  }
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ usage: JSON.stringify(sub.usage), updated_at: db.fn.now() });
  return sub.usage.concurrentActive;
}

// ============================================================================
// Token Management
// ============================================================================

async function addTournamentTokens(guildId, amount, expiryDate) {
  const sub = await getOrCreateSubscription(guildId);
  sub.tokens.tournament += amount;

  if (!sub.tokens.tournamentExpiry || expiryDate < sub.tokens.tournamentExpiry) {
    sub.tokens.tournamentExpiry = expiryDate;
  }

  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ tokens: JSON.stringify(sub.tokens), updated_at: db.fn.now() });

  return sub.tokens.tournament;
}

async function consumeTournamentToken(guildId) {
  const sub = await getOrCreateSubscription(guildId);
  if (sub.tokens.tournament > 0) {
    sub.tokens.tournament--;
    await db('subscriptions')
      .where('guild_id', guildId)
      .update({ tokens: JSON.stringify(sub.tokens), updated_at: db.fn.now() });
    return true;
  }
  return false;
}

async function addParticipantBoost(guildId, amount) {
  const sub = await getOrCreateSubscription(guildId);
  sub.tokens.participantBoosts.push({
    amount,
    purchasedAt: new Date(),
    used: false,
    usedAt: null,
  });

  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ tokens: JSON.stringify(sub.tokens), updated_at: db.fn.now() });

  return sub.tokens.participantBoosts;
}

async function consumeParticipantBoost(guildId, amount) {
  const sub = await getOrCreateSubscription(guildId);
  const boostIndex = sub.tokens.participantBoosts.findIndex(
    b => b.amount === amount && !b.used
  );

  if (boostIndex !== -1) {
    sub.tokens.participantBoosts[boostIndex].used = true;
    sub.tokens.participantBoosts[boostIndex].usedAt = new Date();
    await db('subscriptions')
      .where('guild_id', guildId)
      .update({ tokens: JSON.stringify(sub.tokens), updated_at: db.fn.now() });
    return true;
  }
  return false;
}

async function getTokenBalance(guildId) {
  const sub = await getSubscription(guildId);
  if (!sub) {
    return { tournament: 0, participantBoosts: [] };
  }

  const now = new Date();
  let validTokens = sub.tokens.tournament;
  if (sub.tokens.tournamentExpiry && new Date(sub.tokens.tournamentExpiry) < now) {
    sub.tokens.tournament = 0;
    sub.tokens.tournamentExpiry = null;
    validTokens = 0;
    await db('subscriptions')
      .where('guild_id', guildId)
      .update({ tokens: JSON.stringify(sub.tokens), updated_at: db.fn.now() });
  }

  return {
    tournament: validTokens,
    tournamentExpiry: sub.tokens.tournamentExpiry,
    participantBoosts: sub.tokens.participantBoosts.filter(b => !b.used),
  };
}

async function cleanupExpiredTokens() {
  const rows = await db('subscriptions').select('guild_id', 'tokens');
  const now = new Date();
  let cleaned = 0;

  for (const row of rows) {
    const tokens = row.tokens || {};
    if (tokens.tournament > 0 && tokens.tournamentExpiry) {
      if (new Date(tokens.tournamentExpiry) < now) {
        tokens.tournament = 0;
        tokens.tournamentExpiry = null;
        await db('subscriptions')
          .where('guild_id', row.guild_id)
          .update({ tokens: JSON.stringify(tokens), updated_at: db.fn.now() });
        cleaned++;
      }
    }
  }

  return cleaned;
}

async function addPurchaseHistory(guildId, purchase) {
  const sub = await getOrCreateSubscription(guildId);
  sub.tokens.purchaseHistory.push(purchase);
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ tokens: JSON.stringify(sub.tokens), updated_at: db.fn.now() });
  return sub.tokens.purchaseHistory;
}

// ============================================================================
// Branding (Business tier)
// ============================================================================

async function getBranding(guildId) {
  const sub = await getSubscription(guildId);
  if (!sub?.branding) return null;

  const { botName, botAvatar, accentColor, footerText } = sub.branding;
  if (!botName && !botAvatar && !accentColor && !footerText) return null;

  return sub.branding;
}

async function updateBranding(guildId, brandingData) {
  const sub = await getOrCreateSubscription(guildId);

  if (!sub.branding) {
    sub.branding = { botName: null, botAvatar: null, accentColor: null, footerText: null };
  }

  Object.assign(sub.branding, brandingData);
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ branding: JSON.stringify(sub.branding), updated_at: db.fn.now() });

  return sub.branding;
}

async function clearBranding(guildId) {
  const branding = { botName: null, botAvatar: null, accentColor: null, footerText: null };
  await db('subscriptions')
    .where('guild_id', guildId)
    .update({ branding: JSON.stringify(branding), updated_at: db.fn.now() });
  return branding;
}

// ============================================================================
// Business Multi-Server
// ============================================================================

async function linkServer(parentGuildId, childGuildId) {
  const parent = await getOrCreateSubscription(parentGuildId);
  if (!parent.linkedServers.includes(childGuildId)) {
    parent.linkedServers.push(childGuildId);
  }

  const child = await getOrCreateSubscription(childGuildId);
  child.parentSubscription = parentGuildId;

  await Promise.all([
    db('subscriptions')
      .where('guild_id', parentGuildId)
      .update({ linked_servers: JSON.stringify(parent.linkedServers), updated_at: db.fn.now() }),
    db('subscriptions')
      .where('guild_id', childGuildId)
      .update({ parent_subscription: parentGuildId, updated_at: db.fn.now() }),
  ]);

  return parent.linkedServers;
}

async function unlinkServer(parentGuildId, childGuildId) {
  const parent = await getSubscription(parentGuildId);
  if (parent) {
    parent.linkedServers = parent.linkedServers.filter(id => id !== childGuildId);
    await db('subscriptions')
      .where('guild_id', parentGuildId)
      .update({ linked_servers: JSON.stringify(parent.linkedServers), updated_at: db.fn.now() });
  }

  const child = await getSubscription(childGuildId);
  if (child) {
    await db('subscriptions')
      .where('guild_id', childGuildId)
      .update({ parent_subscription: null, updated_at: db.fn.now() });
  }

  return parent?.linkedServers || [];
}

async function getLinkedServers(guildId) {
  const sub = await getSubscription(guildId);
  return sub?.linkedServers || [];
}

// ============================================================================
// Queries
// ============================================================================

async function getActiveSubscriptions() {
  const rows = await db('subscriptions').whereNot('tier', 'free');
  return rows.map(rowToSubscription);
}

async function getAllSubscriptions() {
  const rows = await db('subscriptions').select('*');
  return rows.map(rowToSubscription);
}

async function getExpiringSubscriptions(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const rows = await db('subscriptions').select('*');
  return rows.map(rowToSubscription).filter(sub => {
    if (sub.manualGrant?.expiresAt) {
      return new Date(sub.manualGrant.expiresAt) <= cutoff;
    }
    if (sub.currentPeriodEnd) {
      return new Date(sub.currentPeriodEnd) <= cutoff;
    }
    return false;
  });
}

async function getExpiringTokens(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const rows = await db('subscriptions').select('guild_id', 'tokens');
  return rows
    .filter(row => {
      const tokens = row.tokens || {};
      return tokens.tournament > 0 &&
        tokens.tournamentExpiry &&
        new Date(tokens.tournamentExpiry) <= cutoff;
    })
    .map(row => rowToSubscription(row));
}

async function getSubscriptionsNeedingReset() {
  const now = new Date();
  const rows = await db('subscriptions').select('guild_id', 'usage');
  return rows
    .filter(row => {
      const usage = row.usage || {};
      return usage.monthResetDate && new Date(usage.monthResetDate) <= now;
    })
    .map(row => ({ guildId: row.guild_id }));
}

// ============================================================================
// Manual Grants
// ============================================================================

async function setManualGrant(guildId, tier, expiresAt, reason, grantedBy) {
  const sub = await getOrCreateSubscription(guildId);
  sub.tier = tier;
  sub.manualGrant = {
    grantedBy,
    grantedAt: new Date(),
    expiresAt,
    reason,
  };

  await db('subscriptions')
    .where('guild_id', guildId)
    .update({
      tier,
      manual_grant: JSON.stringify(sub.manualGrant),
      updated_at: db.fn.now(),
    });

  return sub;
}

async function clearManualGrant(guildId) {
  const sub = await getSubscription(guildId);
  if (sub) {
    await db('subscriptions')
      .where('guild_id', guildId)
      .update({
        tier: 'free',
        manual_grant: null,
        updated_at: db.fn.now(),
      });
    sub.tier = 'free';
    sub.manualGrant = null;
  }
  return sub;
}

async function getManualGrants() {
  const rows = await db('subscriptions').whereNotNull('manual_grant');
  return rows.map(rowToSubscription);
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
};
