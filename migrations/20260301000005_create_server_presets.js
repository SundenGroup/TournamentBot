exports.up = function (knex) {
  return knex.schema.createTable('server_presets', (table) => {
    table.increments('id').primary();
    table.string('guild_id').notNullable().index();
    table.string('key').notNullable();
    table.jsonb('preset_data').notNullable();
    table.timestamps(true, true);

    // Unique constraint: one key per guild
    table.unique(['guild_id', 'key']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('server_presets');
};
