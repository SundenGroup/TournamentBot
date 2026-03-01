exports.up = function (knex) {
  return knex.schema.createTable('subscriptions', (table) => {
    table.string('guild_id').primary();
    table.string('tier').defaultTo('free');

    // Stripe data
    table.string('stripe_customer_id');
    table.string('stripe_subscription_id');

    // Billing
    table.string('billing_cycle'); // 'monthly' | 'annual' | null
    table.timestamp('current_period_start');
    table.timestamp('current_period_end');

    // Manual grant
    table.jsonb('manual_grant');

    // Token balance
    table.jsonb('tokens').defaultTo(JSON.stringify({
      tournament: 0,
      tournamentExpiry: null,
      participantBoosts: [],
      purchaseHistory: [],
    }));

    // Usage tracking
    table.jsonb('usage').defaultTo(JSON.stringify({
      tournamentsThisMonth: 0,
      monthResetDate: null,
      concurrentActive: 0,
    }));

    // Business tier multi-server
    table.jsonb('linked_servers').defaultTo('[]');
    table.string('parent_subscription');

    // Business tier API access
    table.string('api_key');
    table.string('api_key_hash');
    table.string('webhook_url');
    table.string('webhook_secret');

    // Business tier branding
    table.jsonb('branding').defaultTo(JSON.stringify({
      botName: null,
      botAvatar: null,
      accentColor: null,
      footerText: null,
    }));

    // Grace period
    table.timestamp('grace_period_end');
    table.string('previous_tier');

    // Trial
    table.boolean('trial_used').defaultTo(false);

    // Metadata
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('subscriptions');
};
