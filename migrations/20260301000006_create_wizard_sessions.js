exports.up = function (knex) {
  return knex.schema.createTable('wizard_sessions', (table) => {
    table.uuid('id').primary();
    table.string('user_id').notNullable();
    table.string('guild_id').notNullable();
    table.jsonb('data').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Index for cleanup queries
    table.index('created_at');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('wizard_sessions');
};
