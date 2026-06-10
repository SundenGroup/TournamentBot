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

/**
 * Emoji for select-menu options: the game's uploaded application emoji
 * (official logo, see scripts/upload-game-emojis.js) when available,
 * falling back to the unicode icon. Returns the raw API component-emoji shape.
 */
function getMenuEmoji(preset) {
  if (preset?.menuEmoji) return { id: preset.menuEmoji };
  return preset?.icon ? { name: preset.icon } : undefined;
}

/**
 * Game emoji for EMBEDS and MESSAGE CONTENT: `<:name:id>` markup of the
 * uploaded logo emoji when available, unicode icon otherwise. Note: Discord
 * renders this in embeds/messages but NOT in autocomplete or slash-command
 * choices — those are plain text and must keep the unicode icon.
 * Accepts a preset key or a tournament.game object ({preset, icon}).
 */
function getGameEmojiText(game) {
  const key = typeof game === 'string' ? game : game?.preset;
  const preset = key ? GAME_PRESETS[key] : null;
  if (preset?.menuEmoji) {
    return `<:${key.replace(/[^a-zA-Z0-9_]/g, '_')}:${preset.menuEmoji}>`;
  }
  if (typeof game === 'object' && game?.icon) return game.icon;
  return preset?.icon || '🎮';
}

module.exports = {
  GAME_PRESETS,
  getPreset,
  getAllPresets,
  getPresetKeys,
  getFeaturedPresetKeys,
  getMenuEmoji,
  getGameEmojiText,
  reloadPresets,
};
