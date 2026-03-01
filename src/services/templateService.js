// Template service
// Manages tournament templates for Pro+ users

const { EmbedBuilder } = require('discord.js');
const {
  getTemplates,
  getTemplate,
  getTemplateByName,
  saveTemplate,
  deleteTemplate,
  incrementUsage,
  getTemplateCount,
  MAX_TEMPLATES_PER_GUILD,
} = require('../data/templates');
const { GAME_PRESETS } = require('../config/gamePresets');

/**
 * Create a template from a tournament
 */
async function createTemplateFromTournament(guildId, tournament, name, description, createdBy) {
  // Check template limit
  if (await getTemplateCount(guildId) >= MAX_TEMPLATES_PER_GUILD) {
    return {
      success: false,
      error: `You've reached the maximum of ${MAX_TEMPLATES_PER_GUILD} templates. Delete some to create new ones.`,
    };
  }

  // Check for duplicate name
  if (await getTemplateByName(guildId, name)) {
    return {
      success: false,
      error: `A template named "${name}" already exists. Choose a different name.`,
    };
  }

  const template = await saveTemplate(guildId, {
    name,
    description,
    gamePreset: tournament.gamePreset,
    gameDisplayName: tournament.game?.displayName,
    gameShortName: tournament.game?.shortName,
    format: tournament.settings.format,
    teamSize: tournament.settings.teamSize,
    bestOf: tournament.settings.bestOf,
    maxParticipants: tournament.settings.maxParticipants,
    checkinRequired: tournament.settings.checkinRequired,
    checkinWindow: tournament.settings.checkinWindow,
    seedingEnabled: tournament.settings.seedingEnabled,
    requireGameNick: tournament.settings.requireGameNick,
    captainMode: tournament.settings.captainMode,
    requiredRoles: tournament.settings.requiredRoles,
    lobbySize: tournament.settings.lobbySize,
    gamesPerStage: tournament.settings.gamesPerStage,
    advancingPerGroup: tournament.settings.advancingPerGroup,
    createdBy,
  });

  return { success: true, template };
}

/**
 * Create a template from wizard session data
 */
async function createTemplateFromWizard(guildId, data, name, description, createdBy) {
  // Check template limit
  if (await getTemplateCount(guildId) >= MAX_TEMPLATES_PER_GUILD) {
    return {
      success: false,
      error: `You've reached the maximum of ${MAX_TEMPLATES_PER_GUILD} templates. Delete some to create new ones.`,
    };
  }

  // Check for duplicate name
  if (await getTemplateByName(guildId, name)) {
    return {
      success: false,
      error: `A template named "${name}" already exists. Choose a different name.`,
    };
  }

  const preset = GAME_PRESETS[data.gamePreset];

  const template = await saveTemplate(guildId, {
    name,
    description,
    gamePreset: data.gamePreset,
    gameDisplayName: data.gameName || preset?.displayName,
    gameShortName: preset?.shortName || (data.gameName || '').substring(0, 4).toUpperCase(),
    format: data.format,
    teamSize: data.teamSize,
    bestOf: data.bestOf,
    maxParticipants: data.maxParticipants,
    checkinRequired: data.checkinRequired,
    checkinWindow: data.checkinWindow,
    seedingEnabled: data.seedingEnabled,
    requireGameNick: data.requireGameNick,
    captainMode: data.captainMode,
    requiredRoles: data.requiredRoles,
    lobbySize: data.lobbySize,
    gamesPerStage: data.gamesPerStage,
    advancingPerGroup: data.advancingPerGroup,
    createdBy,
  });

  return { success: true, template };
}

/**
 * Apply template to wizard session
 */
function applyTemplateToSession(template) {
  return {
    gamePreset: template.gamePreset,
    gameName: template.gameDisplayName,
    format: template.format,
    teamSize: template.teamSize,
    bestOf: template.bestOf,
    maxParticipants: template.maxParticipants,
    checkinRequired: template.checkinRequired,
    checkinWindow: template.checkinWindow,
    seedingEnabled: template.seedingEnabled,
    requireGameNick: template.requireGameNick,
    captainMode: template.captainMode,
    requiredRoles: template.requiredRoles,
    lobbySize: template.lobbySize,
    gamesPerStage: template.gamesPerStage,
    advancingPerGroup: template.advancingPerGroup,
  };
}

/**
 * Get template list embed
 */
async function getTemplateListEmbed(guildId) {
  const templateList = await getTemplates(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📋 Tournament Templates')
    .setFooter({ text: `${templateList.length}/${MAX_TEMPLATES_PER_GUILD} templates used` });

  if (templateList.length === 0) {
    embed.setDescription('No templates saved yet.\n\nUse `/templates save` after creating a tournament to save its settings as a template.');
    return embed;
  }

  // Sort by usage count (most used first)
  templateList.sort((a, b) => b.usageCount - a.usageCount);

  const formatNames = {
    single_elimination: 'Single Elim',
    double_elimination: 'Double Elim',
    swiss: 'Swiss',
    round_robin: 'Round Robin',
    battle_royale: 'Battle Royale',
  };

  const lines = templateList.map((t, i) => {
    const game = t.gameDisplayName || 'Custom';
    const format = formatNames[t.format] || t.format;
    const teamInfo = t.teamSize === 1 ? 'Solo' : `${t.teamSize}v${t.teamSize}`;
    const uses = t.usageCount === 1 ? '1 use' : `${t.usageCount} uses`;

    return `**${i + 1}. ${t.name}**\n${game} • ${format} • ${teamInfo} • ${t.maxParticipants} max • ${uses}`;
  });

  embed.setDescription(lines.join('\n\n'));

  return embed;
}

/**
 * Get template detail embed
 */
function getTemplateDetailEmbed(template) {
  const formatNames = {
    single_elimination: 'Single Elimination',
    double_elimination: 'Double Elimination',
    swiss: 'Swiss',
    round_robin: 'Round Robin',
    battle_royale: 'Battle Royale',
  };

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📋 Template: ${template.name}`)
    .addFields(
      { name: 'Game', value: template.gameDisplayName || 'Custom', inline: true },
      { name: 'Format', value: formatNames[template.format] || template.format, inline: true },
      { name: 'Team Size', value: template.teamSize === 1 ? 'Solo' : `${template.teamSize}v${template.teamSize}`, inline: true },
      { name: 'Max Participants', value: `${template.maxParticipants}`, inline: true },
      { name: 'Best Of', value: `${template.bestOf}`, inline: true },
      { name: 'Uses', value: `${template.usageCount}`, inline: true }
    );

  if (template.description) {
    embed.setDescription(template.description);
  }

  // Build features list
  const features = [];
  if (template.checkinRequired) features.push(`✅ Check-in (${template.checkinWindow}min)`);
  if (template.seedingEnabled) features.push('✅ Seeding');
  if (template.captainMode) features.push('✅ Captain Mode');
  if (template.requireGameNick) features.push('✅ Game Nick Required');
  if (template.requiredRoles?.length > 0) features.push(`✅ Role Restricted (${template.requiredRoles.length})`);

  if (features.length > 0) {
    embed.addFields({ name: 'Features', value: features.join('\n'), inline: false });
  }

  // Battle Royale settings
  if (template.format === 'battle_royale') {
    const brSettings = [];
    if (template.lobbySize) brSettings.push(`Lobby Size: ${template.lobbySize}`);
    if (template.gamesPerStage) brSettings.push(`Games/Stage: ${template.gamesPerStage}`);
    if (template.advancingPerGroup) brSettings.push(`Advancing/Group: ${template.advancingPerGroup}`);

    if (brSettings.length > 0) {
      embed.addFields({ name: 'Battle Royale Settings', value: brSettings.join('\n'), inline: false });
    }
  }

  const createdAt = Math.floor(new Date(template.createdAt).getTime() / 1000);
  embed.setFooter({ text: `Created <t:${createdAt}:R> • ID: ${template.id.substring(0, 8)}` });

  return embed;
}

module.exports = {
  createTemplateFromTournament,
  createTemplateFromWizard,
  applyTemplateToSession,
  getTemplateListEmbed,
  getTemplateDetailEmbed,
  getTemplates,
  getTemplate,
  getTemplateByName,
  deleteTemplate,
  incrementUsage,
  getTemplateCount,
  MAX_TEMPLATES_PER_GUILD,
};
