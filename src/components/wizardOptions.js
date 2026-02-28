const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getSession, updateSession } = require('../data/wizardSessions');

function buildOptionsMessage(session) {
  const { data } = session;
  const isBR = data.format === 'battle_royale';
  const hasCheckin = data.checkinRequired;

  let content = `⚙️ **Tournament Wizard — Advanced Options**\n\n`;
  content += `Customize additional settings, then create your tournament.`;

  const rows = [];

  if (isBR) {
    // Lobby Size
    const lobbySizeOptions = [10, 20, 30, 50, 100].map(size => ({
      label: `${size} players per lobby`,
      value: String(size),
      default: size === (data.lobbySize || 20),
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardOptions:${session.id}:lobbySize`)
          .setPlaceholder('Lobby Size')
          .addOptions(lobbySizeOptions)
      )
    );

    // Games per Stage
    const gpsOptions = [1, 2, 3, 5, 7, 10].map(n => ({
      label: `${n} game${n > 1 ? 's' : ''} per stage`,
      value: String(n),
      default: n === (data.gamesPerStage || 3),
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardOptions:${session.id}:gamesPerStage`)
          .setPlaceholder('Games per Stage')
          .addOptions(gpsOptions)
      )
    );

    // Advancing per Group
    const apgOptions = [
      { label: 'Auto (based on group size)', value: 'auto' },
      { label: '2 teams advance', value: '2' },
      { label: '4 teams advance', value: '4' },
      { label: '6 teams advance', value: '6' },
      { label: '8 teams advance', value: '8' },
    ].map(opt => ({
      ...opt,
      default: data.advancingPerGroup == null
        ? opt.value === 'auto'
        : String(data.advancingPerGroup) === opt.value,
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardOptions:${session.id}:advancingPerGroup`)
          .setPlaceholder('Advancing per Group')
          .addOptions(apgOptions)
      )
    );
  }

  if (!isBR && hasCheckin) {
    // Check-in Window
    const checkinOptions = [5, 10, 15, 30, 60, 120].map(min => ({
      label: `${min} minute${min > 1 ? 's' : ''} before start`,
      value: String(min),
      default: min === (data.checkinWindow || 30),
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardOptions:${session.id}:checkinWindow`)
          .setPlaceholder('Check-in Window')
          .addOptions(checkinOptions)
      )
    );
  }

  // Required Roles (always available)
  rows.push(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`wizardOptions:${session.id}:requiredRoles`)
        .setPlaceholder('Required Roles (optional)')
        .setMinValues(0)
        .setMaxValues(3)
    )
  );

  // Navigation buttons
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wizardOptions:${session.id}:back`)
        .setLabel('Back')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`wizardOptions:${session.id}:create`)
        .setLabel('Create Tournament')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Primary),
    )
  );

  return { content, components: rows };
}

module.exports = {
  customId: 'wizardOptions',

  buildOptionsMessage,

  async execute(interaction, args) {
    const sessionId = args[0];
    const subAction = args[1];

    const session = getSession(sessionId);

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

    // Handle select menu interactions (String)
    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];

      switch (subAction) {
        case 'lobbySize':
          updateSession(sessionId, { lobbySize: parseInt(value, 10) });
          break;
        case 'gamesPerStage':
          updateSession(sessionId, { gamesPerStage: parseInt(value, 10) });
          break;
        case 'advancingPerGroup':
          updateSession(sessionId, { advancingPerGroup: value === 'auto' ? null : parseInt(value, 10) });
          break;
        case 'checkinWindow':
          updateSession(sessionId, { checkinWindow: parseInt(value, 10) });
          break;
      }

      const message = buildOptionsMessage(session);
      return interaction.update(message);
    }

    // Handle role select menu
    if (interaction.isRoleSelectMenu()) {
      if (subAction === 'requiredRoles') {
        const roleIds = interaction.values; // Array of role IDs
        updateSession(sessionId, { requiredRoles: roleIds });
        const message = buildOptionsMessage(session);
        return interaction.update(message);
      }
    }

    // Handle button interactions
    if (interaction.isButton()) {
      switch (subAction) {
        case 'back': {
          const { buildSettingsMessage } = require('./wizardSettings');
          const message = buildSettingsMessage(session);
          return interaction.update(message);
        }

        case 'create': {
          const { createTournamentFromWizard } = require('./wizardCreate');
          return createTournamentFromWizard(interaction, session);
        }
      }
    }
  },
};
