exports.up = function (knex) {
  return knex.schema.createTable('tournaments', (table) => {
    table.uuid('id').primary();
    table.string('guild_id').notNullable().index();
    table.string('channel_id');
    table.string('message_id');
    table.string('participant_list_message_id');

    table.string('title').notNullable();
    table.text('description');

    // Game info (stored as JSONB for flexibility)
    table.jsonb('game');

    // Settings (JSONB — contains format, maxParticipants, teamSize, bestOf, etc.)
    table.jsonb('settings');

    table.string('setup_mode').defaultTo('simple');
    table.timestamp('start_time');
    table.string('status').defaultTo('registration').index();
    table.boolean('checkin_open').defaultTo(false);

    // Participants and teams (JSONB arrays)
    table.jsonb('participants').defaultTo('[]');
    table.jsonb('teams').defaultTo('[]');

    // Bracket data (JSONB — can be large)
    table.jsonb('bracket');

    table.string('created_by');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('tournaments');
};
