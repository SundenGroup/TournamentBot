// Stripe integration service
// Handles checkout sessions, subscriptions, and webhook processing

const Stripe = require('stripe');
const {
  getSubscription,
  getOrCreateSubscription,
  updateSubscription,
  addTournamentTokens,
  addParticipantBoost,
  addPurchaseHistory,
} = require('../data/subscriptions');

// Initialize Stripe with secret key
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ============================================================================
// Pricing Configuration
// ============================================================================

const SUBSCRIPTION_PRICES = {
  premium_monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
  premium_annual: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID,
  pro_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  pro_annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  business_monthly: process.env.STRIPE_BUSINESS_MONTHLY_PRICE_ID,
  business_annual: process.env.STRIPE_BUSINESS_ANNUAL_PRICE_ID,
};

const TOKEN_PRICES = {
  tokens_30: process.env.STRIPE_TOKENS_30_PRICE_ID,
  tokens_50: process.env.STRIPE_TOKENS_50_PRICE_ID,
  tokens_100: process.env.STRIPE_TOKENS_100_PRICE_ID,
};

const BOOST_PRICES = {
  boost_128: process.env.STRIPE_BOOST_128_PRICE_ID,
  boost_256: process.env.STRIPE_BOOST_256_PRICE_ID,
};

const TOKEN_AMOUNTS = {
  tokens_30: 30,
  tokens_50: 50,
  tokens_100: 100,
};

const BOOST_AMOUNTS = {
  boost_128: 128,
  boost_256: 256,
};

// ============================================================================
// Helper Functions
// ============================================================================

function isStripeConfigured() {
  return stripe !== null && process.env.STRIPE_SECRET_KEY;
}

function getTierFromPriceId(priceId) {
  for (const [key, value] of Object.entries(SUBSCRIPTION_PRICES)) {
    if (value === priceId) {
      const [tier] = key.split('_');
      return tier;
    }
  }
  return null;
}

function getBillingCycleFromPriceId(priceId) {
  for (const [key, value] of Object.entries(SUBSCRIPTION_PRICES)) {
    if (value === priceId) {
      return key.includes('annual') ? 'annual' : 'monthly';
    }
  }
  return 'monthly';
}

// ============================================================================
// Checkout Session Creation
// ============================================================================

/**
 * Create a Stripe checkout session for subscription upgrade
 */
async function createSubscriptionCheckout(guildId, tier, billingCycle, userId, guildName) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
  }

  const priceKey = `${tier}_${billingCycle}`;
  const priceId = SUBSCRIPTION_PRICES[priceKey];

  if (!priceId) {
    throw new Error(`Price ID not configured for ${priceKey}. Please set STRIPE_${priceKey.toUpperCase()}_PRICE_ID.`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      guild_id: guildId,
      guild_name: guildName,
      user_id: userId,
      tier,
      billing_cycle: billingCycle,
      product_type: 'subscription',
    },
    success_url: `${process.env.STRIPE_SUCCESS_URL || 'https://discord.com/channels/@me'}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: process.env.STRIPE_CANCEL_URL || 'https://discord.com/channels/@me',
    subscription_data: {
      metadata: {
        guild_id: guildId,
        tier,
      },
    },
  });

  return session;
}

/**
 * Create a Stripe checkout session for token purchase
 */
async function createTokenCheckout(guildId, productKey, userId, guildName) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
  }

  const priceId = TOKEN_PRICES[productKey];

  if (!priceId) {
    throw new Error(`Price ID not configured for ${productKey}. Please set STRIPE_${productKey.toUpperCase()}_PRICE_ID.`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      guild_id: guildId,
      guild_name: guildName,
      user_id: userId,
      product_type: productKey,
    },
    success_url: `${process.env.STRIPE_SUCCESS_URL || 'https://discord.com/channels/@me'}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: process.env.STRIPE_CANCEL_URL || 'https://discord.com/channels/@me',
  });

  return session;
}

/**
 * Create a Stripe checkout session for boost purchase
 */
async function createBoostCheckout(guildId, productKey, userId, guildName) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
  }

  const priceId = BOOST_PRICES[productKey];

  if (!priceId) {
    throw new Error(`Price ID not configured for ${productKey}. Please set STRIPE_${productKey.toUpperCase()}_PRICE_ID.`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      guild_id: guildId,
      guild_name: guildName,
      user_id: userId,
      product_type: productKey,
    },
    success_url: `${process.env.STRIPE_SUCCESS_URL || 'https://discord.com/channels/@me'}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: process.env.STRIPE_CANCEL_URL || 'https://discord.com/channels/@me',
  });

  return session;
}

/**
 * Create a Stripe billing portal session for subscription management
 */
async function createBillingPortalSession(guildId) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
  }

  const sub = getSubscription(guildId);
  if (!sub?.stripeCustomerId) {
    throw new Error('No Stripe customer found for this server.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: process.env.STRIPE_RETURN_URL || 'https://discord.com/channels/@me',
  });

  return session;
}

// ============================================================================
// Webhook Handling
// ============================================================================

/**
 * Process Stripe webhook events
 */
async function handleWebhook(event) {
  console.log(`[Stripe] Received webhook event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const guildId = session.metadata.guild_id;
      const productType = session.metadata.product_type;

      if (session.mode === 'subscription') {
        // Subscription purchase
        await activateSubscription(guildId, {
          tier: session.metadata.tier,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          billingCycle: session.metadata.billing_cycle,
        });
        console.log(`[Stripe] Activated ${session.metadata.tier} subscription for guild ${guildId}`);
      } else if (session.mode === 'payment') {
        // One-time purchase (tokens or boosts)
        if (productType.startsWith('tokens_')) {
          const amount = TOKEN_AMOUNTS[productType];
          const expiryDate = new Date();
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);

          addTournamentTokens(guildId, amount, expiryDate);

          addPurchaseHistory(guildId, {
            type: 'tournament_tokens',
            amount,
            price: session.amount_total,
            date: new Date(),
            stripePaymentId: session.payment_intent,
          });

          console.log(`[Stripe] Added ${amount} tournament tokens for guild ${guildId}`);
        }

        if (productType.startsWith('boost_')) {
          const amount = BOOST_AMOUNTS[productType];

          addParticipantBoost(guildId, amount);

          addPurchaseHistory(guildId, {
            type: 'participant_boost',
            amount,
            price: session.amount_total,
            date: new Date(),
            stripePaymentId: session.payment_intent,
          });

          console.log(`[Stripe] Added +${amount} participant boost for guild ${guildId}`);
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const guildId = subscription.metadata.guild_id;

      if (guildId) {
        const tier = subscription.metadata.tier || getTierFromPriceId(subscription.items.data[0]?.price?.id);
        const billingCycle = getBillingCycleFromPriceId(subscription.items.data[0]?.price?.id);

        updateSubscription(guildId, {
          tier,
          billingCycle,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        });

        console.log(`[Stripe] Updated subscription for guild ${guildId}: ${tier} (${billingCycle})`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const guildId = subscription.metadata.guild_id;

      if (guildId) {
        updateSubscription(guildId, {
          tier: 'free',
          stripeSubscriptionId: null,
          billingCycle: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
        });

        console.log(`[Stripe] Subscription cancelled for guild ${guildId}, reverted to free tier`);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;

      if (subscriptionId && invoice.billing_reason === 'subscription_cycle') {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const guildId = subscription.metadata.guild_id;

        if (guildId) {
          const tier = subscription.metadata.tier || getTierFromPriceId(subscription.items.data[0]?.price?.id);
          const billingCycle = getBillingCycleFromPriceId(subscription.items.data[0]?.price?.id);

          updateSubscription(guildId, {
            tier,
            billingCycle,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          });

          console.log(`[Stripe] Renewal payment succeeded for guild ${guildId}: ${tier} (${billingCycle})`);
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const guildId = subscription.metadata.guild_id;

        if (guildId) {
          console.log(`[Stripe] Payment failed for guild ${guildId}`);
          // Grace period will be handled by getEffectiveTier() checking currentPeriodEnd
        }
      }
      break;
    }

    default:
      console.log(`[Stripe] Unhandled event type: ${event.type}`);
  }
}

/**
 * Activate a subscription after successful checkout
 */
async function activateSubscription(guildId, data) {
  const now = new Date();
  const periodEnd = new Date(now);

  if (data.billingCycle === 'annual') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  updateSubscription(guildId, {
    tier: data.tier,
    stripeCustomerId: data.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId,
    billingCycle: data.billingCycle,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    manualGrant: null, // Clear any manual grant when paying
  });
}

/**
 * Construct and verify Stripe webhook event
 */
function constructWebhookEvent(payload, signature) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured.');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret not configured. Please set STRIPE_WEBHOOK_SECRET.');
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Configuration
  isStripeConfigured,
  SUBSCRIPTION_PRICES,
  TOKEN_PRICES,
  BOOST_PRICES,
  TOKEN_AMOUNTS,
  BOOST_AMOUNTS,

  // Checkout
  createSubscriptionCheckout,
  createTokenCheckout,
  createBoostCheckout,
  createBillingPortalSession,

  // Webhooks
  handleWebhook,
  constructWebhookEvent,

  // Direct access (for testing)
  stripe,
};
