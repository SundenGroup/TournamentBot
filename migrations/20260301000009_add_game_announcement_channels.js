exports.up = function (knex) {
  // Per-game announcement channel overrides: { "<gameKey>": "<channelId>" }.
  // Falls back to the server-wide announcement channel when a game has no entry.
  return knex.schema.alterTable('server_settings', (table) => {
    table.jsonb('game_announcement_channels').defaultTo('{}');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('server_settings', (table) => {
    table.dropColumn('game_announcement_channels');
  });
};
