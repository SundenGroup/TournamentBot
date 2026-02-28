# Discord Tournament Bot — Technical Specification

> **Version:** 2.6
> **Last Updated:** February 2026
> **Tech Stack:** Node.js + discord.js v14+

---

## What's New in v2.6

### New Features
1. **Four-Tier Subscription System** — Free, Premium, Pro, and Business tiers with per-server subscriptions
2. **Tournament Tokens** — Purchasable tokens to extend monthly tournament limits
3. **Participant Boosts** — One-time purchases to increase participant cap for a single tournament
4. **Feature Gating** — Automatic feature restrictions based on subscription tier
5. **Stripe Integration** — Payment processing for subscriptions and token purchases
6. **Manual Grants** — Bot owner can grant any tier as trials to selected servers
7. **Results API** (Business) — REST endpoints for tournament data
8. **Webhooks** (Business) — Real-time event notifications
9. **White-Label Branding** (Business) — Custom bot identity per server

### Changes from v2.5
- Expanded from 3 tiers to 4 tiers (added Business tier)
- Removed "unlimited tournaments" — all tiers have monthly limits
- Added token system for flexible overage
- Added participant boost system for one-off large events
- API and webhooks moved to Business tier (enterprise feature)
- Pro tier repositioned with templates, analytics, and higher limits
- Updated pricing structure across all tiers

---

## Subscription Tiers

### Overview

Subscriptions are **per-server**. Each Discord server (guild) has its own subscription status. No tier offers "unlimited" anything — all have defined limits to ensure sustainable operation.

### Tier Comparison — Limits

| | Free | Premium | Pro | Business |
|--|------|---------|-----|----------|
| **Price (Monthly)** | $0 | $5.99 | $24.99 | $99 |
| **Price (Annual)** | $0 | $49 | $199 | $899 |
| **Annual Savings** | — | 32% | 34% | 24% |
| **Tournaments/month** | 3 | 15 | 50 | 200 |
| **Max participants** | 50 | 128 | 256 | 512 |
| **Concurrent active** | 1 | 3 | 10 | Unlimited |
| **Servers included** | 1 | 1 | 1 | 5 |

### Tier Comparison — Features

| Feature | Free | Premium | Pro | Business |
|---------|------|---------|-----|----------|
| All 5 formats | ✓ | ✓ | ✓ | ✓ |
| All team sizes (1-6) | ✓ | ✓ | ✓ | ✓ |
| Match rooms | ✓ | ✓ | ✓ | ✓ |
| Game presets | ✓ | ✓ | ✓ | ✓ |
| Creation wizard | ✓ | ✓ | ✓ | ✓ |
| 1-hour reminder | ✓ | ✓ | ✓ | ✓ |
| **Check-in** | ❌ | ✓ | ✓ | ✓ |
| **Seeding** | ❌ | ✓ | ✓ | ✓ |
| **Captain Mode** | ❌ | ✓ | ✓ | ✓ |
| **Full reminders (24h+1h)** | ❌ | ✓ | ✓ | ✓ |
| **Auto-cleanup** | ❌ | ✓ | ✓ | ✓ |
| **Required roles** | ❌ | ✓ | ✓ | ✓ |
| **Tournament templates** | ❌ | ❌ | ✓ | ✓ |
| **Advanced analytics** | ❌ | ❌ | ✓ | ✓ |
| **Results API** | ❌ | ❌ | ❌ | ✓ |
| **Webhooks** | ❌ | ❌ | ❌ | ✓ |
| **White-label branding** | ❌ | ❌ | ❌ | ✓ |
| **Support** | Community | Email | Priority | Dedicated |

### Feature Categorization

**Free Features (all tiers):**
- All 5 tournament formats (Single Elim, Double Elim, Swiss, Round Robin, Battle Royale)
- All team sizes (1-6 players)
- Match room creation
- All game presets
- Simple + Advanced creation wizard
- 1-hour reminder
- Basic participant management

**Premium Features (Premium, Pro, Business):**
- Check-in system
- Seeding
- Captain Mode
- Auto-Cleanup
- Required Roles
- Full reminders (24h + 1h)

**Pro Features (Pro, Business):**
- Tournament templates (save and reuse configurations)
- Advanced analytics (participation stats, completion rates)
- Priority support

**Business Features (Business only):**
- Results API access
- Webhook integrations
- White-label branding (custom bot name/avatar per server)
- 5 servers per subscription
- Dedicated support

---

## Token System

Tokens provide flexibility to exceed monthly limits without upgrading tiers. Inspired by Claude's "extra usage" model.

### Tournament Tokens

Purchase additional tournament capacity that adds to your monthly limit.

| Pack | Price | Tokens | Cost per Token |
|------|-------|--------|----------------|
| Starter | $9.99 | 10 | $1.00 |
| Standard | $24.99 | 30 | $0.83 |
| Bulk | $69.99 | 100 | $0.70 |

**Rules:**
- 1 token = 1 tournament (any size within your tier's participant limit)
- Tokens are consumed only after monthly limit is exhausted
- Tokens expire 12 months after purchase
- Tokens work with any tier (including Free)
- Unused tokens roll over month-to-month until expiry

### Participant Boosts

One-time purchases to increase the participant cap for a single tournament.

| Boost | Price | Effect |
|-------|-------|--------|
| +64 participants | $4.99 | Adds 64 to max for one tournament |
| +128 participants | $9.99 | Adds 128 to max for one tournament |
| +256 participants | $19.99 | Adds 256 to max for one tournament |

**Rules:**
- Applied at tournament creation time
- Single-use (consumed when tournament is created)
- Cannot exceed 512 participants total (platform limit)
- Purchased boosts never expire
- Can stack multiple boosts for very large events

### Use Cases

| Scenario | Solution |
|----------|----------|
| Premium user running 18 tournaments in a busy month | Buy 10-token pack, use 3 tokens for overflow |
| Free user wants to run a 100-person tournament | Buy +64 participant boost ($4.99) |
| Pro user hosting a 400-person championship | Buy +256 boost ($19.99), runs 400-person event |
| Esports org with seasonal spikes | Buy 100-token bulk pack, use throughout the year |

---

## Subscription Data Model

### Server Subscription Object

```javascript
// src/data/subscriptions.js
const subscriptions = new Map(); // guildId → subscription

const subscription = {
  guildId: '123456789',
  
  // Tier: 'free' | 'premium' | 'pro' | 'business'
  tier: 'premium',
  
  // Stripe data (null for free tier and manual grants)
  stripeCustomerId: 'cus_xxx',
  stripeSubscriptionId: 'sub_xxx',
  
  // Billing
  billingCycle: 'monthly', // 'monthly' | 'annual'
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  
  // Manual grant (for trials)
  manualGrant: {
    grantedBy: 'owner_user_id',
    grantedAt: Date,
    expiresAt: Date,
    reason: 'Beta tester'
  },
  
  // Token balance
  tokens: {
    tournament: 0,                    // Current tournament token balance
    tournamentExpiry: Date,           // Oldest token expiry date
    participantBoosts: [              // Purchased boosts (unused)
      { amount: 64, purchasedAt: Date },
      { amount: 128, purchasedAt: Date }
    ],
    purchaseHistory: [                // For accounting/receipts
      { type: 'tournament_pack', amount: 10, price: 999, date: Date, stripePaymentId: 'pi_xxx' }
    ]
  },
  
  // Usage tracking
  usage: {
    tournamentsThisMonth: 2,
    monthResetDate: Date,
    concurrentActive: 1               // Currently active tournaments
  },
  
  // Business tier multi-server
  linkedServers: ['guild_id_2', 'guild_id_3'],  // Max 4 additional for Business
  parentSubscription: null,                      // If this is a linked server
  
  // Business tier API access
  apiKey: 'tb_live_xxx',                     // Stored temporarily for display
  apiKeyHash: 'hashed_key',                   // SHA-256 hash for verification
  webhookUrl: 'https://example.com/webhook',
  webhookSecret: 'whsec_xxx',

  // Business tier white-label branding
  branding: {
    botName: null,                            // Custom bot name for embeds
    botAvatar: null,                          // Custom avatar URL
    accentColor: null,                        // Hex color (e.g., '#FF5733')
    footerText: null                          // Custom footer text
  },

  // Grace period (when subscription expires)
  gracePeriodEnd: null,                       // 3 days after expiry
  previousTier: null,                         // Tier before grace period

  // Self-service trial
  trialUsed: false,                           // Each server can trial once

  // Metadata
  createdAt: Date,
  updatedAt: Date
};
```

### Tier Limits Configuration

```javascript
// src/services/subscriptionService.js

const TIER_LIMITS = {
  free: {
    tournamentsPerMonth: 3,
    maxParticipants: 50,
    maxConcurrent: 1,
    maxServers: 1
  },
  premium: {
    tournamentsPerMonth: 15,
    maxParticipants: 128,
    maxConcurrent: 3,
    maxServers: 1
  },
  pro: {
    tournamentsPerMonth: 50,
    maxParticipants: 256,
    maxConcurrent: 10,
    maxServers: 1
  },
  business: {
    tournamentsPerMonth: 200,
    maxParticipants: 512,
    maxConcurrent: Infinity,
    maxServers: 5
  }
};

const PREMIUM_FEATURES = [
  'checkin',
  'seeding',
  'captain_mode',
  'auto_cleanup',
  'required_roles',
  'full_reminders'
];

const PRO_FEATURES = [
  'tournament_templates',
  'advanced_analytics'
];

const BUSINESS_FEATURES = [
  'api_access',
  'webhooks',
  'white_label',
  'multi_server'
];
```

### Exports

```javascript
// src/data/subscriptions.js
module.exports = {
  // Core CRUD
  getSubscription(guildId),
  setSubscription(guildId, data),
  updateSubscription(guildId, data),
  deleteSubscription(guildId),
  
  // Usage tracking
  incrementTournamentUsage(guildId),
  resetMonthlyUsage(guildId),
  incrementConcurrent(guildId),
  decrementConcurrent(guildId),
  
  // Token management
  addTournamentTokens(guildId, amount, expiryDate),
  consumeTournamentToken(guildId),
  addParticipantBoost(guildId, amount),
  consumeParticipantBoost(guildId, amount),
  getTokenBalance(guildId),
  
  // Business multi-server
  linkServer(parentGuildId, childGuildId),
  unlinkServer(parentGuildId, childGuildId),
  getLinkedServers(guildId),
  
  // Queries
  getActiveSubscriptions(),
  getExpiringSubscriptions(days),
  getExpiringTokens(days),
};
```

---

## Subscription Service

### Feature Gating

```javascript
// src/services/subscriptionService.js

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
        reason: `${formatFeatureName(feature)} is a Premium feature`,
        upgradeRequired: 'premium'
      };
    }
  }
  
  if (PRO_FEATURES.includes(feature)) {
    if (tier === 'free' || tier === 'premium') {
      return { 
        allowed: false, 
        reason: `${formatFeatureName(feature)} is a Pro feature`,
        upgradeRequired: 'pro'
      };
    }
  }
  
  if (BUSINESS_FEATURES.includes(feature)) {
    if (tier !== 'business') {
      return { 
        allowed: false, 
        reason: `${formatFeatureName(feature)} is a Business feature`,
        upgradeRequired: 'business'
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
    return {
      allowed: false,
      reason: `Your ${tier} tier allows up to ${baseMax} participants` +
              (boostAmount ? ` (+${boostAmount} boost = ${effectiveMax})` : '') +
              `. You requested ${requestedLimit}.`,
      canBuyBoost: requestedLimit <= 512,
      suggestedBoost: getSuggestedBoost(requestedLimit - baseMax)
    };
  }
  
  return { allowed: true, effectiveMax };
}

/**
 * Check monthly tournament limit (including tokens)
 */
function checkTournamentLimit(guildId) {
  const sub = getSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const baseLimit = TIER_LIMITS[tier].tournamentsPerMonth;
  
  const used = sub?.usage?.tournamentsThisMonth || 0;
  const tokens = sub?.tokens?.tournament || 0;
  
  // Check if within base limit first
  if (used < baseLimit) {
    return { 
      allowed: true, 
      remaining: baseLimit - used,
      tokensAvailable: tokens,
      usingToken: false
    };
  }
  
  // Base limit exceeded — check tokens
  if (tokens > 0) {
    return {
      allowed: true,
      remaining: 0,
      tokensAvailable: tokens,
      usingToken: true,
      message: `Using 1 tournament token (${tokens - 1} remaining after this)`
    };
  }
  
  // No tokens available
  return {
    allowed: false,
    reason: `You've used all ${baseLimit} tournaments this month and have no tokens.`,
    canBuyTokens: true,
    resetDate: sub?.usage?.monthResetDate
  };
}

/**
 * Check concurrent tournament limit
 */
function checkConcurrentLimit(guildId) {
  const sub = getSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const limit = TIER_LIMITS[tier].maxConcurrent;
  const current = sub?.usage?.concurrentActive || 0;
  
  if (limit === Infinity) {
    return { allowed: true };
  }
  
  if (current >= limit) {
    return {
      allowed: false,
      reason: `You have ${current} active tournaments. Your ${tier} tier allows ${limit} concurrent.`,
      upgradeRequired: getNextTier(tier)
    };
  }
  
  return { allowed: true, remaining: limit - current };
}

/**
 * Record tournament creation (consumes token if needed)
 */
function recordTournamentCreation(guildId, participantBoostUsed = null) {
  const sub = getSubscription(guildId);
  const tier = getEffectiveTier(guildId);
  const baseLimit = TIER_LIMITS[tier].tournamentsPerMonth;
  
  // Increment usage
  sub.usage.tournamentsThisMonth++;
  sub.usage.concurrentActive++;
  
  // Consume token if over base limit
  const usedToken = sub.usage.tournamentsThisMonth > baseLimit;
  if (usedToken && sub.tokens.tournament > 0) {
    sub.tokens.tournament--;
  }
  
  // Consume participant boost if used
  if (participantBoostUsed) {
    const boostIndex = sub.tokens.participantBoosts.findIndex(
      b => b.amount === participantBoostUsed && !b.used
    );
    if (boostIndex !== -1) {
      sub.tokens.participantBoosts[boostIndex].used = true;
      sub.tokens.participantBoosts[boostIndex].usedAt = new Date();
    }
  }
  
  updateSubscription(guildId, sub);
  
  return { usedToken, usedBoost: participantBoostUsed };
}

/**
 * Get effective tier for a guild (checks linked servers and grant expiry)
 */
function getEffectiveTier(guildId) {
  const sub = getSubscription(guildId);
  
  if (!sub) return 'free';
  
  // Check manual grant expiry
  if (sub.manualGrant && sub.manualGrant.expiresAt < new Date()) {
    updateSubscription(guildId, { tier: 'free', manualGrant: null });
    return 'free';
  }
  
  // Check if linked to a Business subscription
  if (sub.parentSubscription) {
    const parent = getSubscription(sub.parentSubscription);
    if (parent?.tier === 'business') {
      return 'business';
    }
  }
  
  return sub.tier || 'free';
}
```

---

## Token Purchase Flow

### Stripe Products Setup

Create these products in Stripe Dashboard:

**Subscriptions:**
- `prod_premium_monthly` — Premium Monthly ($5.99)
- `prod_premium_annual` — Premium Annual ($49)
- `prod_pro_monthly` — Pro Monthly ($24.99)
- `prod_pro_annual` — Pro Annual ($199)
- `prod_business_monthly` — Business Monthly ($99)
- `prod_business_annual` — Business Annual ($899)

**One-time Purchases:**
- `prod_tokens_10` — 10 Tournament Tokens ($9.99)
- `prod_tokens_30` — 30 Tournament Tokens ($24.99)
- `prod_tokens_100` — 100 Tournament Tokens ($69.99)
- `prod_boost_64` — +64 Participant Boost ($4.99)
- `prod_boost_128` — +128 Participant Boost ($9.99)
- `prod_boost_256` — +256 Participant Boost ($19.99)

### Token Purchase Command

```javascript
// src/commands/subscription/tokens.js

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tokens')
    .setDescription('Purchase tournament tokens or participant boosts')
    .addSubcommand(sub =>
      sub.setName('buy-tournaments')
        .setDescription('Buy tournament tokens')
        .addStringOption(opt =>
          opt.setName('pack')
            .setDescription('Token pack to purchase')
            .setRequired(true)
            .addChoices(
              { name: '10 Tokens — $9.99 ($1.00 each)', value: 'tokens_10' },
              { name: '30 Tokens — $24.99 ($0.83 each)', value: 'tokens_30' },
              { name: '100 Tokens — $69.99 ($0.70 each)', value: 'tokens_100' }
            )))
    .addSubcommand(sub =>
      sub.setName('buy-boost')
        .setDescription('Buy a participant boost for larger tournaments')
        .addStringOption(opt =>
          opt.setName('size')
            .setDescription('Boost size')
            .setRequired(true)
            .addChoices(
              { name: '+64 Participants — $4.99', value: 'boost_64' },
              { name: '+128 Participants — $9.99', value: 'boost_128' },
              { name: '+256 Participants — $19.99', value: 'boost_256' }
            )))
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Check your token balance')),
  
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'balance') {
      const sub = getSubscription(interaction.guildId);
      const tokens = sub?.tokens?.tournament || 0;
      const boosts = sub?.tokens?.participantBoosts?.filter(b => !b.used) || [];
      
      const embed = new EmbedBuilder()
        .setTitle('🎟️ Token Balance')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Tournament Tokens', value: `${tokens}`, inline: true },
          { name: 'Participant Boosts', value: boosts.length > 0 
            ? boosts.map(b => `+${b.amount}`).join(', ') 
            : 'None', inline: true }
        );
      
      if (tokens > 0 && sub.tokens.tournamentExpiry) {
        embed.addFields({
          name: 'Oldest Token Expires',
          value: `<t:${Math.floor(sub.tokens.tournamentExpiry.getTime() / 1000)}:R>`
        });
      }
      
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (subcommand === 'buy-tournaments' || subcommand === 'buy-boost') {
      const product = interaction.options.getString('pack') || interaction.options.getString('size');
      
      const session = await createTokenCheckoutSession(
        interaction.guildId,
        product,
        interaction.user.id
      );
      
      const embed = new EmbedBuilder()
        .setTitle('🛒 Complete Your Purchase')
        .setDescription('Click below to complete your purchase securely via Stripe.')
        .setColor(0x5865F2);
      
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Complete Purchase')
            .setStyle(ButtonStyle.Link)
            .setURL(session.url)
        );
      
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
  }
};
```

### Webhook Handling for Token Purchases

```javascript
// In src/services/stripeService.js

async function handleWebhook(event) {
  switch (event.type) {
    // ... subscription events ...
    
    case 'checkout.session.completed': {
      const session = event.data.object;
      const guildId = session.metadata.guild_id;
      const productType = session.metadata.product_type;
      
      if (session.mode === 'payment') {
        // One-time purchase (tokens or boosts)
        if (productType.startsWith('tokens_')) {
          const amount = parseInt(productType.split('_')[1]);
          const expiryDate = new Date();
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);
          
          addTournamentTokens(guildId, amount, expiryDate);
          
          // Log purchase
          addPurchaseHistory(guildId, {
            type: 'tournament_tokens',
            amount,
            price: session.amount_total,
            date: new Date(),
            stripePaymentId: session.payment_intent
          });
        }
        
        if (productType.startsWith('boost_')) {
          const amount = parseInt(productType.split('_')[1]);
          
          addParticipantBoost(guildId, amount);
          
          // Log purchase
          addPurchaseHistory(guildId, {
            type: 'participant_boost',
            amount,
            price: session.amount_total,
            date: new Date(),
            stripePaymentId: session.payment_intent
          });
        }
      }
      
      if (session.mode === 'subscription') {
        // Subscription purchase — existing logic
        await activateSubscription(guildId, {
          tier: session.metadata.tier,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          billingCycle: session.metadata.billing_cycle
        });
      }
      
      break;
    }
  }
}
```

---

## Grace Period

When a subscription expires (Stripe cancellation or payment failure), a 3-day grace period preserves features:

```javascript
const GRACE_PERIOD_DAYS = 3;

function startGracePeriod(guildId, previousTier) {
  const gracePeriodEnd = new Date();
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  updateSubscription(guildId, {
    tier: 'free',
    gracePeriodEnd,
    previousTier
  });
}

function isInGracePeriod(guildId) {
  const sub = getSubscription(guildId);
  if (!sub?.gracePeriodEnd) return false;
  return new Date() < new Date(sub.gracePeriodEnd);
}

function getEffectiveTier(guildId) {
  const sub = getSubscription(guildId);
  // During grace period, use previous tier
  if (isInGracePeriod(guildId) && sub?.previousTier) {
    return sub.previousTier;
  }
  // ... existing logic
}
```

---

## Free Trials

Self-service 7-day Premium trial available to each server once:

```javascript
function startFreeTrial(guildId, grantedBy) {
  const sub = getSubscription(guildId);

  // Check eligibility
  if (sub?.trialUsed) {
    return { success: false, reason: 'This server has already used its free trial.' };
  }
  if (sub?.tier !== 'free') {
    return { success: false, reason: 'You already have an active subscription.' };
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  updateSubscription(guildId, {
    tier: 'premium',
    trialUsed: true,
    manualGrant: {
      grantedBy,
      grantedAt: new Date(),
      expiresAt,
      reason: 'Free trial'
    }
  });

  return { success: true, expiresAt };
}
```

---

## Token Cleanup

Expired tokens are cleaned up on bot startup:

```javascript
// In src/events/ready.js
const expiredTokensCleaned = cleanupExpiredTokens();
if (expiredTokensCleaned > 0) {
  console.log(`Cleaned up expired tokens for ${expiredTokensCleaned} subscription(s)`);
}
```

---

## Auto-Boost Application

When creating a tournament that exceeds participant limits, boosts are auto-applied:

```javascript
// In wizardCreate.js / simpleCreateModal.js
if (!participantCheck.allowed) {
  const tier = getEffectiveTier(guildId);
  const baseMax = TIER_LIMITS[tier].maxParticipants;
  const needed = data.maxParticipants - baseMax;

  // Find smallest boost that covers the need
  const tokenBalance = getTokenBalance(guildId);
  const availableBoosts = tokenBalance.participantBoosts
    .filter(b => b.amount >= needed)
    .sort((a, b) => a.amount - b.amount);

  if (availableBoosts.length > 0) {
    boostToUse = availableBoosts[0].amount;
    participantCheck = checkParticipantLimit(guildId, data.maxParticipants, boostToUse);
  }
}
```

---

## Feature Gate Integration

### Tournament Creation with Tokens and Boosts

```javascript
// In wizardCreate.js / simpleCreateModal.js

async function createTournamentWithGates(interaction, data) {
  const guildId = interaction.guildId;
  
  // 1. Check concurrent limit
  const concurrentCheck = checkConcurrentLimit(guildId);
  if (!concurrentCheck.allowed) {
    return interaction.reply({
      embeds: [getUpgradeEmbed('concurrent', getEffectiveTier(guildId), concurrentCheck.reason)],
      ephemeral: true
    });
  }
  
  // 2. Check tournament limit (may use token)
  const limitCheck = checkTournamentLimit(guildId);
  if (!limitCheck.allowed) {
    return interaction.reply({
      embeds: [getTokenPurchaseEmbed(limitCheck)],
      ephemeral: true
    });
  }
  
  // 3. Check participant limit (may need boost)
  const selectedBoost = data.participantBoost || null;
  const participantCheck = checkParticipantLimit(guildId, data.maxParticipants, selectedBoost);
  if (!participantCheck.allowed) {
    return interaction.reply({
      embeds: [getBoostPurchaseEmbed(participantCheck)],
      ephemeral: true
    });
  }
  
  // 4. Check premium features
  const premiumFeatures = [];
  if (data.checkinRequired) premiumFeatures.push('checkin');
  if (data.seedingEnabled) premiumFeatures.push('seeding');
  if (data.captainMode) premiumFeatures.push('captain_mode');
  if (data.requiredRoles?.length) premiumFeatures.push('required_roles');
  
  for (const feature of premiumFeatures) {
    const check = checkFeature(guildId, feature);
    if (!check.allowed) {
      return interaction.reply({
        embeds: [getUpgradeEmbed(feature, getEffectiveTier(guildId))],
        ephemeral: true
      });
    }
  }
  
  // 5. Warn if using token
  if (limitCheck.usingToken) {
    // Could show a confirmation, or just proceed with info message
    console.log(`[Tokens] Guild ${guildId} using tournament token`);
  }
  
  // 6. All checks passed — create tournament
  const tournament = createTournament(data);
  
  // 7. Record usage (consumes token/boost if applicable)
  recordTournamentCreation(guildId, selectedBoost);
  
  return tournament;
}
```

### Upgrade and Purchase Embeds

```javascript
// src/services/subscriptionService.js

function getUpgradeEmbed(feature, currentTier, customReason = null) {
  const featureNames = {
    checkin: 'Check-in System',
    seeding: 'Seeding',
    captain_mode: 'Captain Mode',
    auto_cleanup: 'Auto-Cleanup',
    required_roles: 'Required Roles',
    full_reminders: 'Full Reminders',
    tournament_templates: 'Tournament Templates',
    advanced_analytics: 'Advanced Analytics',
    api_access: 'Results API',
    webhooks: 'Webhooks',
    white_label: 'White-Label Branding',
    concurrent: 'More Concurrent Tournaments',
    participants: 'More Participants'
  };
  
  const requiredTier = getRequiredTierForFeature(feature);
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⭐ Upgrade Required')
    .setDescription(customReason || `**${featureNames[feature]}** requires ${requiredTier} tier.`)
    .addFields(
      { name: 'Your Current Tier', value: capitalize(currentTier), inline: true },
      { name: 'Required Tier', value: capitalize(requiredTier), inline: true }
    );
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel('View Plans')
        .setStyle(ButtonStyle.Link)
        .setURL('https://yourdomain.com/pricing'),
      new ButtonBuilder()
        .setCustomId('dismiss_upgrade')
        .setLabel('Maybe Later')
        .setStyle(ButtonStyle.Secondary)
    );
  
  return { embeds: [embed], components: [row] };
}

function getTokenPurchaseEmbed(limitCheck) {
  const embed = new EmbedBuilder()
    .setColor(0xFFA500)
    .setTitle('🎟️ Monthly Limit Reached')
    .setDescription(limitCheck.reason)
    .addFields(
      { name: 'Option 1', value: 'Purchase tournament tokens to continue this month' },
      { name: 'Option 2', value: 'Wait for monthly reset' }
    );
  
  if (limitCheck.resetDate) {
    embed.addFields({
      name: 'Resets',
      value: `<t:${Math.floor(limitCheck.resetDate.getTime() / 1000)}:R>`
    });
  }
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel('Buy Tokens')
        .setStyle(ButtonStyle.Primary)
        .setCustomId('buy_tokens'),
      new ButtonBuilder()
        .setLabel('View Plans')
        .setStyle(ButtonStyle.Link)
        .setURL('https://yourdomain.com/pricing')
    );
  
  return { embeds: [embed], components: [row] };
}

function getBoostPurchaseEmbed(participantCheck) {
  const embed = new EmbedBuilder()
    .setColor(0xFFA500)
    .setTitle('👥 Participant Limit Exceeded')
    .setDescription(participantCheck.reason)
    .addFields(
      { name: 'Suggested Boost', value: `+${participantCheck.suggestedBoost} participants` }
    );
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel('Buy Boost')
        .setStyle(ButtonStyle.Primary)
        .setCustomId(`buy_boost_${participantCheck.suggestedBoost}`),
      new ButtonBuilder()
        .setLabel('View Plans')
        .setStyle(ButtonStyle.Link)
        .setURL('https://yourdomain.com/pricing')
    );
  
  return { embeds: [embed], components: [row] };
}
```

---

## Manual Grants (Bot Owner)

### Command: `/owner grant`

Bot owner can grant any tier to selected servers for trial/promotional purposes.

```javascript
// src/commands/owner/grant.js

module.exports = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Bot owner commands')
    .addSubcommand(sub =>
      sub.setName('grant')
        .setDescription('Grant subscription tier to a server')
        .addStringOption(opt =>
          opt.setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('tier')
            .setDescription('Tier to grant')
            .setRequired(true)
            .addChoices(
              { name: 'Premium', value: 'premium' },
              { name: 'Pro', value: 'pro' },
              { name: 'Business', value: 'business' }
            ))
        .addIntegerOption(opt =>
          opt.setName('days')
            .setDescription('Duration in days')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(365))
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Reason for grant')))
    .addSubcommand(sub =>
      sub.setName('revoke')
        .setDescription('Revoke granted tier from a server')
        .addStringOption(opt =>
          opt.setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('grant-tokens')
        .setDescription('Grant free tokens to a server')
        .addStringOption(opt =>
          opt.setName('guild_id')
            .setDescription('Server ID')
            .setRequired(true))
        .addIntegerOption(opt =>
          opt.setName('amount')
            .setDescription('Number of tokens')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)))
    .addSubcommand(sub =>
      sub.setName('list-grants')
        .setDescription('List all active manual grants')),
  
  async execute(interaction) {
    // Owner check
    if (interaction.user.id !== process.env.BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ This command is restricted to the bot owner.',
        ephemeral: true
      });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'grant') {
      const guildId = interaction.options.getString('guild_id');
      const tier = interaction.options.getString('tier');
      const days = interaction.options.getInteger('days');
      const reason = interaction.options.getString('reason') || 'Manual grant';
      
      grantTier(guildId, tier, days, reason, interaction.user.id);
      
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      
      return interaction.reply({
        content: `✅ Granted **${tier.toUpperCase()}** to server \`${guildId}\`\n` +
                 `**Duration:** ${days} days\n` +
                 `**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:F>\n` +
                 `**Reason:** ${reason}`,
        ephemeral: true
      });
    }
    
    if (subcommand === 'revoke') {
      const guildId = interaction.options.getString('guild_id');
      revokeTier(guildId);
      return interaction.reply({
        content: `✅ Revoked granted tier from server \`${guildId}\``,
        ephemeral: true
      });
    }
    
    if (subcommand === 'grant-tokens') {
      const guildId = interaction.options.getString('guild_id');
      const amount = interaction.options.getInteger('amount');
      
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      addTournamentTokens(guildId, amount, expiryDate);
      
      return interaction.reply({
        content: `✅ Granted **${amount} tournament tokens** to server \`${guildId}\``,
        ephemeral: true
      });
    }
    
    if (subcommand === 'list-grants') {
      const grants = getActiveSubscriptions()
        .filter(s => s.manualGrant)
        .map(s => {
          const expires = Math.floor(s.manualGrant.expiresAt.getTime() / 1000);
          return `• \`${s.guildId}\` — **${s.tier}** — expires <t:${expires}:R> — ${s.manualGrant.reason}`;
        });
      
      if (grants.length === 0) {
        return interaction.reply({ content: 'No active manual grants.', ephemeral: true });
      }
      
      return interaction.reply({
        content: `**Active Grants (${grants.length}):**\n${grants.join('\n')}`,
        ephemeral: true
      });
    }
  }
};
```

---

## Results API (Business)

### Overview

Business tier includes REST API access for retrieving tournament data. This enables external integrations like website brackets, stream overlays, and automated leaderboards.

### Authentication

API requests require an API key in the header:

```
Authorization: Bearer tb_live_xxxxx
```

API keys are generated when a server upgrades to Business and can be regenerated via `/subscribe api-key regenerate`.

### Rate Limits

| Tier | Requests per minute |
|------|---------------------|
| Business | 120 |

### Endpoints

Base URL: `https://api.yourdomain.com/v1`

#### GET /tournaments/:id

Returns tournament details.

```json
{
  "id": "abc123",
  "title": "Weekend CS2 Cup",
  "game": "cs2",
  "status": "active",
  "format": "double_elimination",
  "teamSize": 5,
  "startTime": "2026-02-15T19:00:00Z",
  "participantCount": 16,
  "maxParticipants": 32,
  "settings": {
    "bestOf": 3,
    "checkinRequired": true,
    "seedingEnabled": true
  }
}
```

#### GET /tournaments/:id/bracket

Returns full bracket state.

```json
{
  "tournamentId": "abc123",
  "format": "double_elimination",
  "winnersRounds": [...],
  "losersRounds": [...],
  "grandFinals": {...}
}
```

#### GET /tournaments/:id/matches

Returns all matches with results.

```json
{
  "matches": [
    {
      "id": "m_001",
      "round": 1,
      "bracket": "winners",
      "participant1": { "id": "t_001", "name": "Team Alpha", "seed": 1 },
      "participant2": { "id": "t_002", "name": "Team Beta", "seed": 16 },
      "winner": "t_001",
      "score": "2-0",
      "status": "completed",
      "completedAt": "2026-02-15T19:45:00Z"
    }
  ]
}
```

#### GET /tournaments/:id/standings

Returns final placements (after tournament completion).

```json
{
  "standings": [
    { "place": 1, "participant": { "id": "t_001", "name": "Team Alpha" } },
    { "place": 2, "participant": { "id": "t_005", "name": "Team Echo" } },
    { "place": 3, "participant": { "id": "t_003", "name": "Team Gamma" } }
  ]
}
```

---

## Webhooks (Business)

### Configuration

```
/subscribe webhook set url:https://example.com/webhook
/subscribe webhook test
/subscribe webhook disable
```

### Events

| Event | Trigger |
|-------|---------|
| `tournament.created` | New tournament created |
| `tournament.started` | Tournament started |
| `tournament.completed` | Tournament finished |
| `participant.registered` | Team/player registered |
| `participant.withdrawn` | Team/player withdrew |
| `participant.checked_in` | Team/player checked in |
| `match.started` | Match room created |
| `match.completed` | Match result reported |

### Payload Format

```json
{
  "event": "match.completed",
  "timestamp": "2026-02-15T19:45:00Z",
  "guildId": "123456789",
  "data": {
    "tournamentId": "abc123",
    "matchId": "m_001",
    "winner": { "id": "t_001", "name": "Team Alpha" },
    "loser": { "id": "t_002", "name": "Team Beta" },
    "score": "2-0",
    "round": 1,
    "bracket": "winners"
  }
}
```

### Verification

Webhooks include a signature header:

```
X-Webhook-Signature: sha256=xxxx
```

---

## Implementation Phases

### Phase 1: Subscription Infrastructure (No Stripe)

Build the subscription system with manual grants only:

1. Create `src/data/subscriptions.js` — subscription store with token support
2. Create `src/services/subscriptionService.js` — tier checks, limits, tokens, grants
3. Add `/owner grant`, `/owner revoke`, `/owner grant-tokens`, `/owner list-grants` commands
4. Add `/subscribe status` command
5. Add `/tokens balance` command
6. Integrate feature gates into tournament creation
7. Integrate feature gates into admin commands
8. Add upgrade embeds with "View Plans" button

**Deliverable:** Fully functional tier system, testable via manual grants.

### Phase 2: Stripe Integration

1. Create `src/services/stripeService.js`
2. Create `src/api/webhooks/stripe.js`
3. Add `/subscribe upgrade` command
4. Add `/subscribe manage` command
5. Add `/tokens buy-tournaments` and `/tokens buy-boost` commands
6. Set up Express server for Stripe webhooks
7. Test full purchase flow for subscriptions and tokens

**Deliverable:** Users can purchase subscriptions and tokens via Stripe.

### Phase 3: Pro Features

1. Create tournament templates system
2. Create analytics dashboard/commands
3. Add `/templates save`, `/templates list`, `/templates use` commands
4. Add `/analytics` command

**Deliverable:** Pro tier fully functional.

### Phase 4: Business Features (API & Webhooks)

1. Create `src/api/v1/` directory with REST endpoints
2. Add API key generation and authentication middleware
3. Create webhook delivery service
4. Add `/subscribe api-key` and `/subscribe webhook` commands
5. Document API for users
6. Add white-label branding configuration

**Deliverable:** Business tier fully functional with API access.

---

## Updated Environment Variables

```env
# Discord
DISCORD_TOKEN=xxx
DISCORD_CLIENT_ID=xxx

# Bot Owner
BOT_OWNER_ID=your_discord_user_id

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Subscription Price IDs
STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_xxx
STRIPE_PREMIUM_ANNUAL_PRICE_ID=price_xxx
STRIPE_PRO_MONTHLY_PRICE_ID=price_xxx
STRIPE_PRO_ANNUAL_PRICE_ID=price_xxx
STRIPE_BUSINESS_MONTHLY_PRICE_ID=price_xxx
STRIPE_BUSINESS_ANNUAL_PRICE_ID=price_xxx

# Token/Boost Price IDs
STRIPE_TOKENS_10_PRICE_ID=price_xxx
STRIPE_TOKENS_30_PRICE_ID=price_xxx
STRIPE_TOKENS_100_PRICE_ID=price_xxx
STRIPE_BOOST_64_PRICE_ID=price_xxx
STRIPE_BOOST_128_PRICE_ID=price_xxx
STRIPE_BOOST_256_PRICE_ID=price_xxx

# API (Phase 4)
API_BASE_URL=https://api.yourdomain.com
API_PORT=3000

# Database (future)
DATABASE_URL=xxx
```

---

## Updated File Structure

```
src/
├── api/                              # Business tier API
│   ├── v1/
│   │   ├── tournaments.js
│   │   ├── matches.js
│   │   └── standings.js
│   ├── webhooks/
│   │   └── stripe.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── rateLimit.js
│   └── index.js
│
├── commands/
│   ├── admin/
│   │   └── settings.js               # +feature gate checks, admin help
│   ├── general/
│   │   └── help.js                   # Player-facing help
│   ├── owner/
│   │   └── grant.js                  # grant, revoke, grant-tokens, list-grants
│   ├── subscription/
│   │   ├── subscribe.js              # status, upgrade, manage, trial, api-key, webhook, branding
│   │   └── tokens.js                 # buy-tournaments, buy-boost, balance
│   ├── analytics/                    # Pro feature
│   │   └── analytics.js              # overview, tournament, leaderboard
│   ├── templates/                    # Pro feature
│   │   └── templates.js              # save, list, view, delete
│   ├── match/
│   │   └── match.js
│   └── tournament/
│       └── create.js                 # +feature gate checks, +auto-boost
│
├── components/
│   ├── wizardCreate.js               # +feature gate checks, +token consumption
│   ├── simpleCreateModal.js          # +feature gate checks
│   ├── boostSelect.js                # NEW — boost selection in wizard
│   └── ...
│
├── data/
│   ├── subscriptions.js              # Subscription + token store
│   ├── templates.js                  # NEW — Pro tournament templates
│   ├── serverSettings.js
│   ├── tournaments.js
│   └── wizardSessions.js
│
├── services/
│   ├── subscriptionService.js        # Tier checks, tokens, grants, limits
│   ├── stripeService.js              # Stripe integration
│   ├── webhookService.js             # Business webhook delivery
│   ├── templateService.js            # NEW — Pro template management
│   ├── analyticsService.js           # NEW — Pro analytics
│   ├── channelService.js
│   ├── reminderService.js
│   └── tournamentService.js
│
├── utils/
│   ├── apiKeyGenerator.js
│   └── ...
│
└── events/
    ├── interactionCreate.js
    └── ready.js                      # +subscription/token expiry checks
```

---

## Verification Checklist

### Subscription System (v2.6)

#### Tier limits (implemented)
- [x] Free: 4th tournament blocked after 3 (with token purchase prompt)
- [x] Free: 51 participants blocked (with boost purchase prompt)
- [x] Free: 2nd concurrent tournament blocked
- [x] Premium: 16th tournament blocked after 15
- [x] Premium: 129 participants blocked
- [x] Pro: 51st tournament blocked after 50
- [x] Pro: 257 participants blocked
- [x] Business: 201st tournament blocked after 200

#### Token system (implemented)
- [x] `/tokens balance` shows current tokens and boosts
- [x] `/tokens buy-tournaments` creates Stripe checkout session
- [x] After purchase, tokens are added to balance
- [x] Creating tournament over monthly limit consumes token
- [x] Tokens expire after 12 months
- [x] Token cleanup on bot startup

#### Participant boosts (implemented)
- [x] `/tokens buy-boost` creates Stripe checkout session
- [x] After purchase, boost appears in balance
- [x] Creating tournament with boost allows higher participant count
- [x] Boost is consumed after tournament creation
- [x] Cannot exceed 512 platform cap
- [x] Auto-boost application when participant limit exceeded

#### Manual grants (implemented)
- [x] `/owner grant guild_id:123 tier:pro days:30` works
- [x] `/owner grant-tokens guild_id:123 amount:10` works
- [x] `/owner list-grants` shows active grants
- [x] `/owner revoke guild_id:123` revokes access
- [x] Grant expiry reverts to free tier

#### Feature gates (implemented)
- [x] Check-in blocked on Free (Premium feature)
- [x] Templates blocked on Premium (Pro feature)
- [x] API access blocked on Pro (Business feature)
- [x] All gates show appropriate upgrade/purchase prompts

#### Grace period (implemented)
- [x] 3-day grace period when subscription expires
- [x] Previous tier features preserved during grace
- [x] Automatic revert after grace expires

#### Free trials (implemented)
- [x] `/subscribe trial` starts 7-day Premium trial
- [x] One trial per server (trialUsed flag)
- [x] Trial expiry reverts to free tier

#### Business features (implemented)
- [x] `/subscribe api-key` generate/view/regenerate/revoke
- [x] `/subscribe webhook` configure/view/test/disable
- [x] `/subscribe branding` set-name/set-avatar/set-color/set-footer/reset
- [x] REST API with authentication and rate limiting
- [x] Webhook delivery with retry logic

### Pro Features (v2.6)

- [x] `/templates list|view|save|delete` commands
- [x] `/analytics overview|tournament|leaderboard` commands

### Previous Features (v2.2-v2.4)

- [x] Tournament wizard flow unchanged
- [x] Captain mode works on Premium+
- [x] Reminders: 1-hour on Free, full on Premium+
- [x] Auto-cleanup works on Premium+

### Requires Stripe Setup (to test)

- [ ] Subscription checkout flow
- [ ] Token/boost purchase flow
- [ ] Subscription management portal
- [ ] Webhook for payment events

---

*End of Specification v2.6*
