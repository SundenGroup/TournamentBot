exports.up = function (knex) {
  return knex.schema.createTable('processed_stripe_events', (table) => {
    // Stripe event id (evt_...). Primary key gives us atomic dedupe via
    // INSERT ... ON CONFLICT DO NOTHING, so a retried/replayed webhook delivery
    // is processed at most once.
    table.string('event_id').primary();
    table.string('type');
    table.timestamp('processed_at').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('processed_stripe_events');
};
