const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { GAME_PRESETS } = require('../config/gamePresets');
const { getSession, updateSession } = require('../data/wizardSessions');
const { toDiscordFullAndRelative } = require('../utils/timeUtils');

const FORMAT_LABELS = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  swiss: 'Swiss',
  round_robin: 'Round Robin',
  battle_royale: 'Battle Royale',
};

const ALL_FORMATS = ['single_elimination', 'double_elimination', 'swiss', 'round_robin', 'battle_royale'];

function buildSettingsMessage(session) {
  const { data } = session;
  const preset = GAME_PRESETS[data.gamePreset];
  const gameIcon = preset?.icon || '🎮';
  const gameName = data.gameName || preset?.displayName || 'Custom Game';

  const dateDisplay = data.datetime
    ? toDiscordFullAndRelative(new Date(data.datetime))
    : 'Not set';

  let content = `🎮 **Tournament Wizard — Settings**\n\n`;
  content += `**Game:** ${gameIcon} ${gameName}\n`;
  content += `**Title:** ${data.title}\n`;
  content += `**Date:** ${dateDisplay}\n`;
  content += `**Players:** ${data.maxParticipants}\n\n`;
  content += `Customize your tournament settings below, or create with defaults.`;

  const rows = [];

  // Row 1: Format select
  const formatOptions = (preset?.formatOptions || ALL_FORMATS).map(f => ({
    label: FORMAT_LABELS[f] || f,
    value: f,
    default: f === data.format,
  }));

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`wizardSettings:${session.id}:format`)
        .setPlaceholder('Format')
        .addOptions(formatOptions)
    )
  );

  // Row 2: Team Size select
  const teamSizeOptions = (preset?.teamSizeOptions || [1, 2, 3, 4, 5]).map(size => ({
    label: size === 1 ? 'Solo (1v1)' : `${size}v${size}`,
    value: String(size),
    default: size === data.teamSize,
  }));

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`wizardSettings:${session.id}:teamSize`)
        .setPlaceholder('Team Size')
        .addOptions(teamSizeOptions)
    )
  );

  // Row 3: Best Of select (not shown for battle_royale)
  if (data.format !== 'battle_royale') {
    const bestOfOptions = (preset?.bestOfOptions || [1, 3, 5, 7]).map(bo => ({
      label: `Best of ${bo}`,
      value: String(bo),
      default: bo === data.bestOf,
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardSettings:${session.id}:bestOf`)
          .setPlaceholder('Best Of')
          .addOptions(bestOfOptions)
      )
    );
  }

  // Row 4: Toggle buttons
  const toggleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:toggleCheckin`)
      .setLabel(`${data.checkinRequired ? '✅' : '❌'} Check-in`)
      .setStyle(data.checkinRequired ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:toggleGameNick`)
      .setLabel(`${data.requireGameNick ? '✅' : '❌'} Game Nick`)
      .setStyle(data.requireGameNick ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:toggleCaptain`)
      .setLabel(`${data.captainMode ? '✅' : '❌'} Captain Mode`)
      .setStyle(data.captainMode ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:toggleSeeding`)
      .setLabel(`${data.seedingEnabled ? '✅' : '❌'} Seeding`)
      .setStyle(data.seedingEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  rows.push(toggleRow);

  // Row 5: Navigation buttons
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:editInfo`)
      .setLabel('Edit Info')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:moreOptions`)
      .setLabel('More Options')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`wizardSettings:${session.id}:create`)
      .setLabel('Create Tournament')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary),
  );
  rows.push(navRow);

  return { content, components: rows };
}

module.exports = {
  customId: 'wizardSettings',

  // Export for use by wizardBasic
  buildSettingsMessage,

  async execute(interaction, args) {
    const sessionId = args[0];
    const subAction = args[1]; // format, teamSize, bestOf, toggleX, editInfo, moreOptions, create

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

    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];

      switch (subAction) {
        case 'format':
          updateSession(sessionId, { format: value });
          break;
        case 'teamSize':
          updateSession(sessionId, { teamSize: parseInt(value, 10) });
          break;
        case 'bestOf':
          updateSession(sessionId, { bestOf: parseInt(value, 10) });
          break;
      }

      const message = buildSettingsMessage(session);
      return interaction.update(message);
    }

    // Handle button interactions
    if (interaction.isButton()) {
      switch (subAction) {
        case 'toggleCheckin':
          updateSession(sessionId, { checkinRequired: !session.data.checkinRequired });
          return interaction.update(buildSettingsMessage(session));

        case 'toggleGameNick':
          updateSession(sessionId, { requireGameNick: !session.data.requireGameNick });
          return interaction.update(buildSettingsMessage(session));

        case 'toggleCaptain':
          updateSession(sessionId, { captainMode: !session.data.captainMode });
          return interaction.update(buildSettingsMessage(session));

        case 'toggleSeeding':
          updateSession(sessionId, { seedingEnabled: !session.data.seedingEnabled });
          return interaction.update(buildSettingsMessage(session));

        case 'editInfo': {
          const preset = GAME_PRESETS[session.data.gamePreset];
          const isCustom = session.data.gamePreset === 'custom';

          const modal = new ModalBuilder()
            .setCustomId(`wizardBasic:${sessionId}`)
            .setTitle(`Edit ${preset?.displayName || 'Custom'} Tournament`);

          const rows = [];

          if (isCustom) {
            rows.push(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('gameName')
                  .setLabel('Game Name')
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder('Enter the game name')
                  .setRequired(true)
                  .setMaxLength(100)
              )
            );
          }

          rows.push(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Tournament Title')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(`e.g., Weekend ${preset?.shortName || ''} Cup`)
                .setRequired(true)
                .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('datetime')
                .setLabel('Date & Time (e.g., Feb 15 7pm UTC)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Feb 15 7pm UTC')
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('maxParticipants')
                .setLabel(`Max ${preset?.defaultTeamSize > 1 ? 'Teams' : 'Players'}`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('16')
                .setRequired(true)
            ),
          );

          if (!isCustom) {
            rows.push(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('description')
                  .setLabel('Description (optional)')
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('Custom rules or notes for participants')
                  .setRequired(false)
                  .setMaxLength(1000)
              )
            );
          }

          modal.addComponents(rows);
          return interaction.showModal(modal);
        }

        case 'moreOptions': {
          const { buildOptionsMessage } = require('./wizardOptions');
          const message = buildOptionsMessage(session);
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
