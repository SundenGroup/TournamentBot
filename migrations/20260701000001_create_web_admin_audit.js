exports.up = function (knex) {
  // Audit trail for state-changing actions taken from the web-admin dashboard
  // (who did what, where, when — Discord slash commands are already attributable
  // via Discord itself, web actions need their own trail).
  return knex.schema.createTable('web_admin_audit', (table) => {
    table.increments('id').primary();
    table.string('user_id').notNullable();        // Discord user id of the actor
    table.string('username');                     // display name at time of action
    table.string('guild_id').notNullable();
    table.string('tournament_id');                // nullable: guild-level actions
    table.string('action').notNullable();         // e.g. 'report', 'start', 'disqualify'
    table.jsonb('details').defaultTo('{}');       // action-specific payload
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['guild_id', 'created_at']);
    table.index(['tournament_id']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('web_admin_audit');
};
