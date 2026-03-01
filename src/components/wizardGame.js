const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { GAME_PRESETS, getPresetKeys } = require('../config/gamePresets');
const { getSession, updateSession } = require('../data/wizardSessions');

module.exports = {
  customId: 'wizardGame',
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

    const selectedGame = interaction.values[0];

    // Handle "More Games..." — show full list
    if (selectedGame === '__more_games__') {
      const allKeys = getPresetKeys();
      const options = allKeys.map(key => ({
        label: GAME_PRESETS[key].displayName,
        value: key,
        emoji: GAME_PRESETS[key].icon,
        description: `${GAME_PRESETS[key].defaultTeamSize}v${GAME_PRESETS[key].defaultTeamSize} ${GAME_PRESETS[key].defaultFormat.replace('_', ' ')}`,
      }));

      options.push({
        label: 'Other Game...',
        value: 'custom',
        emoji: '🎮',
        description: 'Create a tournament for any game',
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`wizardGame:${sessionId}`)
        .setPlaceholder('Select a game')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      return interaction.update({
        content: '🎮 **Create Tournament — All Games**\n\nSelect a game to get started:',
        components: [row],
      });
    }

    await updateSession(sessionId, { gamePreset: selectedGame });

    const preset = GAME_PRESETS[selectedGame];
    const isCustom = selectedGame === 'custom';

    const modal = new ModalBuilder()
      .setCustomId(`wizardBasic:${sessionId}`)
      .setTitle(`Create ${preset?.displayName || 'Custom'} Tournament`);

    const rows = [];

    if (isCustom) {
      const gameNameInput = new TextInputBuilder()
        .setCustomId('gameName')
        .setLabel('Game Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter the game name')
        .setRequired(true)
        .setMaxLength(100);
      rows.push(new ActionRowBuilder().addComponents(gameNameInput));
    }

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Tournament Title')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`e.g., Weekend ${preset?.shortName || ''} Cup`)
      .setRequired(true)
      .setMaxLength(100);
    rows.push(new ActionRowBuilder().addComponents(titleInput));

    const datetimeInput = new TextInputBuilder()
      .setCustomId('datetime')
      .setLabel('Date & Time (e.g., Feb 15 7pm UTC)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Feb 15 7pm UTC')
      .setRequired(true);
    rows.push(new ActionRowBuilder().addComponents(datetimeInput));

    const maxParticipantsInput = new TextInputBuilder()
      .setCustomId('maxParticipants')
      .setLabel(`Max ${preset?.defaultTeamSize > 1 ? 'Teams' : 'Players'}`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('16')
      .setRequired(true);
    rows.push(new ActionRowBuilder().addComponents(maxParticipantsInput));

    if (!isCustom) {
      const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Custom rules or notes for participants')
        .setRequired(false)
        .setMaxLength(1000);
      rows.push(new ActionRowBuilder().addComponents(descriptionInput));
    }

    modal.addComponents(rows);
    await interaction.showModal(modal);
  },
};
