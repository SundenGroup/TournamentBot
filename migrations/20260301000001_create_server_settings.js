exports.up = function (knex) {
  return knex.schema.createTable('server_settings', (table) => {
    table.string('guild_id').primary();
    table.string('announcement_channel_name').defaultTo('tournament-announcements');
    table.string('announcement_channel_id');
    table.string('match_room_category');
    table.string('default_format').defaultTo('single_elimination');
    table.boolean('default_checkin').defaultTo(false);
    table.integer('default_checkin_window').defaultTo(30);
    table.boolean('auto_cleanup').defaultTo(false);
    table.string('auto_cleanup_mode').defaultTo('delete');
    table.jsonb('tournament_admin_roles').defaultTo('[]');
    table.boolean('captain_mode').defaultTo(false);
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('server_settings');
};
