// Tournament templates data store — backed by PostgreSQL

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Maximum templates per guild (Pro feature limit)
const MAX_TEMPLATES_PER_GUILD = 25;

// ============================================================================
// Row converters
// ============================================================================

function rowToTemplate(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    gamePreset: row.game_preset,
    gameDisplayName: row.game_display_name,
    gameShortName: row.game_short_name,
    format: row.format,
    teamSize: row.team_size,
    bestOf: row.best_of,
    maxParticipants: row.max_participants,
    checkinRequired: row.checkin_required,
    checkinWindow: row.checkin_window,
    seedingEnabled: row.seeding_enabled,
    requireGameNick: row.require_game_nick,
    captainMode: row.captain_mode,
    requiredRoles: row.required_roles || [],
    lobbySize: row.lobby_size,
    gamesPerStage: row.games_per_stage,
    advancingPerGroup: row.advancing_per_group,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
  };
}

function templateToRow(template) {
  return {
    id: template.id,
    guild_id: template.guildId,
    name: template.name,
    description: template.description || null,
    game_preset: template.gamePreset,
    game_display_name: template.gameDisplayName,
    game_short_name: template.gameShortName,
    format: template.format,
    team_size: template.teamSize || 1,
    best_of: template.bestOf || 1,
    max_participants: template.maxParticipants,
    checkin_required: template.checkinRequired || false,
    checkin_window: template.checkinWindow || 30,
    seeding_enabled: template.seedingEnabled || false,
    require_game_nick: template.requireGameNick || false,
    captain_mode: template.captainMode || false,
    required_roles: JSON.stringify(template.requiredRoles || []),
    lobby_size: template.lobbySize || null,
    games_per_stage: template.gamesPerStage || null,
    advancing_per_group: template.advancingPerGroup || null,
    created_by: template.createdBy,
    usage_count: template.usageCount || 0,
    last_used_at: template.lastUsedAt || null,
  };
}

// ============================================================================
// Public API (all async)
// ============================================================================

async function getTemplates(guildId) {
  const rows = await db('templates').where('guild_id', guildId);
  return rows.map(rowToTemplate);
}

async function getTemplate(guildId, templateId) {
  const row = await db('templates')
    .where({ guild_id: guildId, id: templateId })
    .first();
  return row ? rowToTemplate(row) : null;
}

async function getTemplateByName(guildId, name) {
  const row = await db('templates')
    .where('guild_id', guildId)
    .whereRaw('LOWER(name) = ?', [name.toLowerCase()])
    .first();
  return row ? rowToTemplate(row) : null;
}

async function saveTemplate(guildId, data) {
  const template = {
    id: uuidv4(),
    guildId,
    name: data.name,
    description: data.description || null,
    gamePreset: data.gamePreset,
    gameDisplayName: data.gameDisplayName,
    gameShortName: data.gameShortName,
    format: data.format,
    teamSize: data.teamSize,
    bestOf: data.bestOf,
    maxParticipants: data.maxParticipants,
    checkinRequired: data.checkinRequired || false,
    checkinWindow: data.checkinWindow || 30,
    seedingEnabled: data.seedingEnabled || false,
    requireGameNick: data.requireGameNick || false,
    captainMode: data.captainMode || false,
    requiredRoles: data.requiredRoles || [],
    lobbySize: data.lobbySize || null,
    gamesPerStage: data.gamesPerStage || null,
    advancingPerGroup: data.advancingPerGroup || null,
    createdBy: data.createdBy,
    usageCount: 0,
    lastUsedAt: null,
  };

  await db('templates').insert(templateToRow(template));
  return template;
}

async function updateTemplate(guildId, templateId, data) {
  const existing = await getTemplate(guildId, templateId);
  if (!existing) return null;

  const updated = { ...existing, ...data, updatedAt: new Date() };
  const row = templateToRow(updated);
  delete row.id; // Don't update primary key

  await db('templates')
    .where({ guild_id: guildId, id: templateId })
    .update({ ...row, updated_at: db.fn.now() });

  return updated;
}

async function deleteTemplate(guildId, templateId) {
  const deleted = await db('templates')
    .where({ guild_id: guildId, id: templateId })
    .del();
  return deleted > 0;
}

async function incrementUsage(guildId, templateId) {
  await db('templates')
    .where({ guild_id: guildId, id: templateId })
    .update({
      usage_count: db.raw('usage_count + 1'),
      last_used_at: db.fn.now(),
    });

  return getTemplate(guildId, templateId);
}

async function getTemplateCount(guildId) {
  const result = await db('templates')
    .where('guild_id', guildId)
    .count('id as count')
    .first();
  return parseInt(result.count, 10);
}

module.exports = {
  getTemplates,
  getTemplate,
  getTemplateByName,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  incrementUsage,
  getTemplateCount,
  MAX_TEMPLATES_PER_GUILD,
};
