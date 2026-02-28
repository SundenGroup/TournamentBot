const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { GAME_PRESETS, getPresetKeys } = require('../config/gamePresets');

module.exports = {
  customId: 'gameSelect',
  async execute(interaction) {
    const selectedGame = interaction.values[0];

    // Handle "More Games..." selection — show full list
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
        .setCustomId('gameSelect')
        .setPlaceholder('Select a game')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      return interaction.update({
        content: '🎮 **Create Tournament — All Games**\n\nSelect a game to get started:\n\n*Or use `/tournament create-advanced` for full customization.*',
        components: [row],
      });
    }

    const preset = GAME_PRESETS[selectedGame];

    const modal = new ModalBuilder()
      .setCustomId(`simpleCreate:${selectedGame}`)
      .setTitle(`Create ${preset?.displayName || 'Custom'} Tournament`);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Tournament Title')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`e.g., Weekend ${preset?.shortName || ''} Cup`)
      .setRequired(true)
      .setMaxLength(100);

    const datetimeInput = new TextInputBuilder()
      .setCustomId('datetime')
      .setLabel('Date & Time (e.g., Feb 15 7pm UTC)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Feb 15 7pm UTC')
      .setRequired(true);

    const maxParticipantsInput = new TextInputBuilder()
      .setCustomId('maxParticipants')
      .setLabel(`Max ${preset?.defaultTeamSize > 1 ? 'Teams' : 'Players'}`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('16')
      .setRequired(true);

    const rows = [
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(datetimeInput),
      new ActionRowBuilder().addComponents(maxParticipantsInput),
    ];

    // Add custom game name field if custom preset
    if (selectedGame === 'custom') {
      const gameNameInput = new TextInputBuilder()
        .setCustomId('gameName')
        .setLabel('Game Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter the game name')
        .setRequired(true);

      rows.splice(0, 0, new ActionRowBuilder().addComponents(gameNameInput));
    }

    modal.addComponents(rows);

    await interaction.showModal(modal);
  },
};
