const fs = require('fs');
const path = require('path');

// Load game presets from JSON file for easy customization
const gamesPath = path.join(__dirname, 'games.json');
let GAME_PRESETS = {};

function loadPresets() {
  try {
    const data = fs.readFileSync(gamesPath, 'utf8');
    GAME_PRESETS = JSON.parse(data);
    console.log(`Loaded ${Object.keys(GAME_PRESETS).length} game presets`);
  } catch (error) {
    console.error('Error loading game presets:', error);
    // Fallback to empty object
    GAME_PRESETS = {};
  }
}

// Load on startup
loadPresets();

function getPreset(gameKey) {
  return GAME_PRESETS[gameKey] || null;
}

function getAllPresets() {
  return GAME_PRESETS;
}

function getPresetKeys() {
  return Object.keys(GAME_PRESETS).filter(key => key !== 'custom');
}

function getFeaturedPresetKeys() {
  return Object.keys(GAME_PRESETS).filter(key => key !== 'custom' && GAME_PRESETS[key].featured);
}

// Reload presets (useful if file is updated)
function reloadPresets() {
  loadPresets();
}

module.exports = {
  GAME_PRESETS,
  getPreset,
  getAllPresets,
  getPresetKeys,
  getFeaturedPresetKeys,
  reloadPresets,
};
