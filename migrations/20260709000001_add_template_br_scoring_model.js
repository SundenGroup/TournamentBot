exports.up = function (knex) {
  // Battle Royale v2: templates remember the chosen scoring model
  // ('super' | 'algs' | 'warzone' | 'kill_race' | 'placement').
  return knex.schema.alterTable('templates', (table) => {
    table.string('br_scoring_model').defaultTo(null);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('templates', (table) => {
    table.dropColumn('br_scoring_model');
  });
};
