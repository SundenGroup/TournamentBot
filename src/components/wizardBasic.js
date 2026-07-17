const { GAME_PRESETS } = require('../config/gamePresets');
const { parseDateTime } = require('../utils/timeUtils');
const { getSession, updateSession } = require('../data/wizardSessions');
const { buildSettingsMessage } = require('./wizardSettings');

module.exports = {
  customId: 'wizardBasic',
  async execute(interaction, args) {
    const sessionId = args[0];
    const session = await getSession(sessionId);

    if (!session) {
      return interaction.reply({
        content: '❌ Wizard session expired. Please run `/tournament create-advanced` again.',
        ephemeral: true,
      });
    }

    if (session.userId !== interaction.user.id) {
      return interaction.reply({
        content: '❌ This wizard belongs to another user.',
        ephemeral: true,
      });
    }

    const title = interaction.fields.getTextInputValue('title');
    const datetimeStr = interaction.fields.getTextInputValue('datetime');
    const maxParticipantsStr = interaction.fields.getTextInputValue('maxParticipants');

    let gameName = null;
    if (session.data.gamePreset === 'custom') {
      gameName = interaction.fields.getTextInputValue('gameName');
    }

    let description = null;
    try {
      description = interaction.fields.getTextInputValue('description');
    } catch {
      // Description field not present (custom game modal has no room for it)
    }

    // Validate datetime
    const startTime = parseDateTime(datetimeStr);
    if (!startTime) {
      return interaction.reply({
        content: '❌ Could not parse the date/time. Please use a format like "Feb 15 7pm UTC" or "2026-02-15 19:00".',
        ephemeral: true,
      });
    }

    // Validate max participants against the platform hard cap only; the
    // per-plan limit is applied later by runCreationChecks (respects tier).
    const maxParticipants = parseInt(maxParticipantsStr, 10);
    if (isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 512) {
      return interaction.reply({
        content: '❌ Max participants must be a number between 2 and 512.',
        ephemeral: true,
      });
    }

    // Store validated values (preserve existing settings if re-editing)
    const preset = GAME_PRESETS[session.data.gamePreset];
    const updates = {
      title,
      datetime: startTime.toISOString(),
      maxParticipants,
      description,
      gameName,
    };

    // Only set defaults on first pass (when format isn't set yet)
    if (!session.data.format) {
      updates.format = preset?.defaultFormat || 'single_elimination';
      updates.teamSize = preset?.defaultTeamSize || 1;
      updates.bestOf = preset?.defaultBestOf || 1;
      updates.checkinRequired = false;
      updates.requireGameNick = false;
      updates.captainMode = false;
      updates.seedingEnabled = false;
      // BR games seed their preset defaults (scoring model, lobby, games)
      if (updates.format === 'battle_royale') {
        const brDefaults = preset?.brDefaults || {};
        updates.lobbySize = brDefaults.lobbySize ?? 20;
        updates.gamesPerStage = brDefaults.gamesPerStage ?? 3;
        if (brDefaults.scoringModel) updates.brScoringModel = brDefaults.scoringModel;
      }
    }

    await updateSession(sessionId, updates);

    // Build and send the settings message
    const message = buildSettingsMessage(session);
    await interaction.reply({ ...message, ephemeral: true });
  },
};
