exports.up = function (knex) {
  return knex.schema.createTable('templates', (table) => {
    table.uuid('id').primary();
    table.string('guild_id').notNullable().index();
    table.string('name').notNullable();
    table.text('description');

    // Tournament settings
    table.string('game_preset');
    table.string('game_display_name');
    table.string('game_short_name');
    table.string('format');
    table.integer('team_size').defaultTo(1);
    table.integer('best_of').defaultTo(1);
    table.integer('max_participants');

    // Optional settings
    table.boolean('checkin_required').defaultTo(false);
    table.integer('checkin_window').defaultTo(30);
    table.boolean('seeding_enabled').defaultTo(false);
    table.boolean('require_game_nick').defaultTo(false);
    table.boolean('captain_mode').defaultTo(false);
    table.jsonb('required_roles').defaultTo('[]');

    // Battle Royale settings
    table.integer('lobby_size');
    table.integer('games_per_stage');
    table.integer('advancing_per_group');

    // Metadata
    table.string('created_by');
    table.timestamps(true, true);
    table.integer('usage_count').defaultTo(0);
    table.timestamp('last_used_at');

    // Unique constraint: one name per guild
    table.unique(['guild_id', 'name']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('templates');
};
