// Tournament templates data store
// Allows Pro+ users to save and reuse tournament configurations

const { v4: uuidv4 } = require('uuid');

const templates = new Map(); // guildId -> Map<templateId, template>

/**
 * Get all templates for a guild
 */
function getTemplates(guildId) {
  if (!templates.has(guildId)) {
    templates.set(guildId, new Map());
  }
  return Array.from(templates.get(guildId).values());
}

/**
 * Get a specific template
 */
function getTemplate(guildId, templateId) {
  const guildTemplates = templates.get(guildId);
  if (!guildTemplates) return null;
  return guildTemplates.get(templateId) || null;
}

/**
 * Get a template by name
 */
function getTemplateByName(guildId, name) {
  const guildTemplates = templates.get(guildId);
  if (!guildTemplates) return null;

  const lowerName = name.toLowerCase();
  for (const template of guildTemplates.values()) {
    if (template.name.toLowerCase() === lowerName) {
      return template;
    }
  }
  return null;
}

/**
 * Save a new template
 */
function saveTemplate(guildId, data) {
  if (!templates.has(guildId)) {
    templates.set(guildId, new Map());
  }

  const template = {
    id: uuidv4(),
    guildId,
    name: data.name,
    description: data.description || null,

    // Tournament settings
    gamePreset: data.gamePreset,
    gameDisplayName: data.gameDisplayName,
    gameShortName: data.gameShortName,
    format: data.format,
    teamSize: data.teamSize,
    bestOf: data.bestOf,
    maxParticipants: data.maxParticipants,

    // Optional settings
    checkinRequired: data.checkinRequired || false,
    checkinWindow: data.checkinWindow || 30,
    seedingEnabled: data.seedingEnabled || false,
    requireGameNick: data.requireGameNick || false,
    captainMode: data.captainMode || false,
    requiredRoles: data.requiredRoles || [],

    // Battle Royale settings
    lobbySize: data.lobbySize || null,
    gamesPerStage: data.gamesPerStage || null,
    advancingPerGroup: data.advancingPerGroup || null,

    // Metadata
    createdBy: data.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
    usageCount: 0,
  };

  templates.get(guildId).set(template.id, template);
  return template;
}

/**
 * Update a template
 */
function updateTemplate(guildId, templateId, data) {
  const guildTemplates = templates.get(guildId);
  if (!guildTemplates) return null;

  const template = guildTemplates.get(templateId);
  if (!template) return null;

  const updated = { ...template, ...data, updatedAt: new Date() };
  guildTemplates.set(templateId, updated);
  return updated;
}

/**
 * Delete a template
 */
function deleteTemplate(guildId, templateId) {
  const guildTemplates = templates.get(guildId);
  if (!guildTemplates) return false;
  return guildTemplates.delete(templateId);
}

/**
 * Increment usage count
 */
function incrementUsage(guildId, templateId) {
  const template = getTemplate(guildId, templateId);
  if (template) {
    template.usageCount++;
    template.lastUsedAt = new Date();
  }
  return template;
}

/**
 * Get template count for a guild
 */
function getTemplateCount(guildId) {
  const guildTemplates = templates.get(guildId);
  return guildTemplates ? guildTemplates.size : 0;
}

// Maximum templates per guild (Pro feature limit)
const MAX_TEMPLATES_PER_GUILD = 25;

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
  templates, // For debugging
};
