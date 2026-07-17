exports.up = function (knex) {
  // Channel-capacity plan Phase 2: archived match-room history lives here —
  // channels get deleted (freeing the 500-channel cap), transcripts stay
  // browsable from the web dashboard forever.
  return knex.schema.createTable('match_transcripts', (table) => {
    table.uuid('id').primary();
    table.uuid('tournament_id').notNullable().index();
    table.string('guild_id').notNullable();
    // Stable key: match id for brackets, "br-lobby:<groupId>" for BR lobbies
    table.string('match_key').notNullable();
    table.string('match_label').notNullable();     // "Match #12 — A vs B" / "Group A lobby"
    table.string('channel_name').notNullable();
    table.jsonb('participants').defaultTo('[]');   // [{id, name}]
    table.jsonb('messages').defaultTo('[]');       // serialized history (see transcriptService)
    table.integer('message_count').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['tournament_id', 'match_key']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('match_transcripts');
};
