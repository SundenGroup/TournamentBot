exports.up = function (knex) {
  // findTournamentByMessage() looks tournaments up by these columns on every
  // button/reaction interaction. Without indexes that's a sequential scan.
  return knex.schema.alterTable('tournaments', (table) => {
    table.index('message_id', 'idx_tournaments_message_id');
    table.index('participant_list_message_id', 'idx_tournaments_participant_list_message_id');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('tournaments', (table) => {
    table.dropIndex('message_id', 'idx_tournaments_message_id');
    table.dropIndex('participant_list_message_id', 'idx_tournaments_participant_list_message_id');
  });
};
