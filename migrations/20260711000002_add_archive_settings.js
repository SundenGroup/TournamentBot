exports.up = function (knex) {
  // Channel-capacity plan: #match-logs mirror + rolling auto-archive setting.
  return knex.schema.alterTable('server_settings', (table) => {
    table.boolean('match_logs_enabled').defaultTo(true);
    table.string('match_logs_channel_id').defaultTo(null);
    table.integer('auto_archive_minutes').defaultTo(0); // 0 = off (Pro/Studio feature)
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('server_settings', (table) => {
    table.dropColumn('match_logs_enabled');
    table.dropColumn('match_logs_channel_id');
    table.dropColumn('auto_archive_minutes');
  });
};
