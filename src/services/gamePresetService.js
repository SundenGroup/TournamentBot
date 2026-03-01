const { GAME_PRESETS, getPreset, getPresetKeys } = require('../config/gamePresets');
const { getServerPresets } = require('../data/serverPresets');

async function getAllAvailablePresets(guildId) {
  const builtIn = getPresetKeys().map(key => ({
    key,
    ...GAME_PRESETS[key],
    isBuiltIn: true,
  }));

  const serverCustom = (await getServerPresets(guildId)).map(preset => ({
    ...preset,
    isBuiltIn: false,
  }));

  return [...builtIn, ...serverCustom];
}

async function getPresetForGuild(guildId, presetKey) {
  // First check built-in
  const builtIn = getPreset(presetKey);
  if (builtIn) return builtIn;

  // Then check server presets
  const serverPresets = await getServerPresets(guildId);
  return serverPresets.find(p => p.key === presetKey) || null;
}

async function getGameChoices(guildId) {
  const presets = await getAllAvailablePresets(guildId);
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
