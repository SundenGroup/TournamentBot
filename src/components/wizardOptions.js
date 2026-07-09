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
    const { GAME_PRESETS } = require('../config/gamePresets');
    const brDefaults = GAME_PRESETS[data.gamePreset]?.brDefaults || {};
    const unit = data.teamSize === 1 ? 'players' : 'teams';
    const curLobby = data.lobbySize || brDefaults.lobbySize || 20;
    const curGames = data.gamesPerStage || brDefaults.gamesPerStage || 3;

    // Scoring model — the preset default is always the recommended first pick
    const { BR_SCORING_MODELS } = require('../services/battleRoyaleService');
    const defaultModel = brDefaults.scoringModel || 'placement';
    const curModel = data.brScoringModel || defaultModel;
    const modelOptions = Object.entries(BR_SCORING_MODELS).map(([key, m]) => ({
      label: key === defaultModel ? `${m.label} — recommended` : m.label,
      value: key,
      default: key === curModel,
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardOptions:${session.id}:brScoringModel`)
          .setPlaceholder('Scoring')
          .addOptions(modelOptions)
      )
    );

    // Lobby Size
    const lobbySizes = [...new Set([10, 16, 20, 25, 30, 50, 100, curLobby])].sort((a, b) => a - b);
    const lobbySizeOptions = lobbySizes.map(size => ({
      label: `${size} ${unit} per lobby`,
      value: String(size),
      default: size === curLobby,
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
    const gpsOptions = [...new Set([1, 2, 3, 4, 5, 6, 8, 10, curGames])].sort((a, b) => a - b).map(n => ({
      label: `${n} game${n > 1 ? 's' : ''} per stage`,
      value: String(n),
      default: n === curGames,
    }));

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`wizardOptions:${session.id}:gamesPerStage`)
          .setPlaceholder('Games per Stage')
          .addOptions(gpsOptions)
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

  // Third-place match toggle — single elimination only
  if (data.format === 'single_elimination') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`wizardOptions:${session.id}:toggleThirdPlace`)
          .setLabel(`${data.thirdPlaceMatch ? '✅' : '❌'} 3rd Place Match`)
          .setStyle(data.thirdPlaceMatch ? ButtonStyle.Success : ButtonStyle.Secondary)
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
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wizardOptions:${session.id}:back`)
      .setLabel('Back')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  // Multi-lobby BR only: how many advance from each group to the finals.
  // A cycling button (Auto → 2 → 4 → 6 → 8 → 10) — Auto fills one finals lobby.
  if (isBR && (data.maxParticipants || 0) > (data.lobbySize || 20)) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`wizardOptions:${session.id}:cycleAdvancing`)
        .setLabel(`Advance/group: ${data.advancingPerGroup == null ? 'Auto' : data.advancingPerGroup}`)
        .setEmoji('🎯')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`wizardOptions:${session.id}:create`)
      .setLabel('Create Tournament')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
  );
  rows.push(navRow);

  return { content, components: rows };
}

module.exports = {
  customId: 'wizardOptions',

  buildOptionsMessage,

  async execute(interaction, args) {
    const sessionId = args[0];
    const subAction = args[1];

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

    // Handle select menu interactions (String)
    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];

      let updated = session;
      switch (subAction) {
        case 'brScoringModel':
          updated = await updateSession(sessionId, { brScoringModel: value });
          break;
        case 'lobbySize':
          updated = await updateSession(sessionId, { lobbySize: parseInt(value, 10) });
          break;
        case 'gamesPerStage':
          updated = await updateSession(sessionId, { gamesPerStage: parseInt(value, 10) });
          break;
        case 'checkinWindow':
          updated = await updateSession(sessionId, { checkinWindow: parseInt(value, 10) });
          break;
      }

      // Render with the freshly-updated session, not the stale snapshot.
      return interaction.update(buildOptionsMessage(updated || session));
    }

    // Handle role select menu
    if (interaction.isRoleSelectMenu()) {
      if (subAction === 'requiredRoles') {
        const roleIds = interaction.values; // Array of role IDs
        const updated = await updateSession(sessionId, { requiredRoles: roleIds });
        return interaction.update(buildOptionsMessage(updated || session));
      }
    }

    // Handle button interactions
    if (interaction.isButton()) {
      switch (subAction) {
        case 'toggleThirdPlace': {
          const updated = await updateSession(sessionId, { thirdPlaceMatch: !session.data.thirdPlaceMatch });
          return interaction.update(buildOptionsMessage(updated || session));
        }

        case 'cycleAdvancing': {
          // Auto → 2 → 4 → 6 → 8 → 10 → Auto
          const cycle = [null, 2, 4, 6, 8, 10];
          const idx = cycle.indexOf(session.data.advancingPerGroup ?? null);
          const next = cycle[(idx + 1) % cycle.length];
          const updated = await updateSession(sessionId, { advancingPerGroup: next });
          return interaction.update(buildOptionsMessage(updated || session));
        }

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
