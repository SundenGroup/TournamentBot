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

/**
 * Per-game customization of the signup "in-game nick" collection.
 *
 * Most games ask for a single in-game nickname. Some need more or need
 * something specific — e.g. GOALS collects a public **GOALS Username** AND a
 * private **GOALS User ID** (a UUID copied from the app). A preset declares
 * this with a `nickFields` array (or a legacy single `nickField` object) in
 * games.json; everything else falls back to one generic nickname field, so
 * this is a drop-in superset of the old behavior.
 *
 * Returns an ARRAY of field configs:
 *   { key, label, placeholder, minLength, private }
 * `private: true` fields (e.g. the GOALS User ID) are never shown in public
 * lists — only to admins. Accepts a preset key or a tournament.game object.
 * Discord limits: modal label ≤ 45 chars, placeholder ≤ 100.
 */
function getNickFields(game) {
  const key = typeof game === 'string' ? game : game?.preset;
  const preset = key ? GAME_PRESETS[key] : null;

  let raw;
  if (Array.isArray(preset?.nickFields) && preset.nickFields.length) {
    raw = preset.nickFields;
  } else if (preset?.nickField) {
    // legacy single-field config
    raw = [{ key: 'gameNick', ...preset.nickField }];
  } else {
    raw = [{ key: 'gameNick', label: 'In-Game Nickname', placeholder: 'Enter your in-game name', minLength: 0, private: false }];
  }

  return raw.slice(0, 3).map((f, i) => ({
    key: f.key || (i === 0 ? 'gameNick' : `field${i}`),
    label: (f.label || 'In-Game Nickname').slice(0, 45),
    placeholder: (f.placeholder || 'Enter your in-game name').slice(0, 100),
    minLength: Math.max(0, Math.min(Math.floor(Number(f.minLength) || 0), 1000)),
    private: !!f.private,
  }));
}

/**
 * Short label for the whole nick requirement — used on the wizard toggle and
 * the announcement embed field. Single-field games use that field's label;
 * multi-field games use the preset's `nickSummary` (fallback "<Game> info").
 */
function getNickSummary(game) {
  const key = typeof game === 'string' ? game : game?.preset;
  const preset = key ? GAME_PRESETS[key] : null;
  if (preset?.nickSummary) return preset.nickSummary;
  const fields = getNickFields(game);
  if (fields.length > 1) return `${preset?.shortName || 'Player'} info`;
  // single field: a game-specific label if the preset defined one, else the
  // compact generic "Game Nick" (keeps the wizard toggle + announce tidy)
  const defined = !!(preset?.nickField || (Array.isArray(preset?.nickFields) && preset.nickFields.length));
  return defined ? fields[0].label : 'Game Nick';
}

module.exports = {
  GAME_PRESETS,
  getPreset,
  getAllPresets,
  getPresetKeys,
  getFeaturedPresetKeys,
  getMenuEmoji,
  getGameEmojiText,
  getNickFields,
  getNickSummary,
  reloadPresets,
};
