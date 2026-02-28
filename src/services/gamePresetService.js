const { GAME_PRESETS, getPreset, getPresetKeys } = require('../config/gamePresets');
const { getServerPresets } = require('../data/serverPresets');

function getAllAvailablePresets(guildId) {
  const builtIn = getPresetKeys().map(key => ({
    key,
    ...GAME_PRESETS[key],
    isBuiltIn: true,
  }));

  const serverCustom = getServerPresets(guildId).map(preset => ({
    ...preset,
    isBuiltIn: false,
  }));

  return [...builtIn, ...serverCustom];
}

function getPresetForGuild(guildId, presetKey) {
  // First check built-in
  const builtIn = getPreset(presetKey);
  if (builtIn) return builtIn;

  // Then check server presets
  const serverPresets = getServerPresets(guildId);
  return serverPresets.find(p => p.key === presetKey) || null;
}

function getGameChoices(guildId) {
  const presets = getAllAvailablePresets(guildId);
  return presets
    .filter(p => p.key !== 'custom')
    .map(p => ({
      name: `${p.icon} ${p.displayName}`,
      value: p.key,
    }))
    .concat([{ name: '🎮 Other Game...', value: 'custom' }]);
}

module.exports = {
  getAllAvailablePresets,
  getPresetForGuild,
  getGameChoices,
};
