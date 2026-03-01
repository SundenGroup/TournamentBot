// Server-specific custom game presets — backed by PostgreSQL

const db = require('../db');

async function getServerPresets(guildId) {
  const rows = await db('server_presets').where('guild_id', guildId);
  return rows.map(row => ({
    key: row.key,
    ...row.preset_data,
  }));
}

async function addServerPreset(guildId, preset) {
  await db('server_presets').insert({
    guild_id: guildId,
    key: preset.key,
    preset_data: JSON.stringify(preset),
  });
  return preset;
}

async function removeServerPreset(guildId, presetKey) {
  await db('server_presets')
    .where({ guild_id: guildId, key: presetKey })
    .del();
}

module.exports = {
  getServerPresets,
  addServerPreset,
  removeServerPreset,
};
