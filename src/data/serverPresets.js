// Server-specific custom game presets
// Will be replaced with database in future

const serverPresets = new Map();

function getServerPresets(guildId) {
  return serverPresets.get(guildId) || [];
}

function addServerPreset(guildId, preset) {
  const presets = getServerPresets(guildId);
  presets.push(preset);
  serverPresets.set(guildId, presets);
  return preset;
}

function removeServerPreset(guildId, presetKey) {
  const presets = getServerPresets(guildId);
  const filtered = presets.filter(p => p.key !== presetKey);
  serverPresets.set(guildId, filtered);
}

module.exports = {
  serverPresets,
  getServerPresets,
  addServerPreset,
  removeServerPreset,
};
