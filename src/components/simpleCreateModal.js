const { GAME_PRESETS } = require('../config/gamePresets');
const { createTournament, updateTournament } = require('../services/tournamentService');
const { createTournamentEmbed, createTournamentButtons, createParticipantListEmbed } = require('../utils/embedBuilder');
const { parseDateTime } = require('../utils/timeUtils');
const { getOrCreateAnnouncementChannel } = require('../services/announcementService');
const { scheduleReminders } = require('../services/reminderService');
const { getTokenBalance } = require('../data/subscriptions');
const {
  checkConcurrentLimit,
  checkTournamentLimit,
  checkParticipantLimit,
  recordTournamentCreation,
  getEffectiveTier,
  getUpgradeEmbed,
  getTokenPurchaseEmbed,
  getBoostPurchaseEmbed,
  TIER_LIMITS,
} = require('../services/subscriptionService');

module.exports = {
  customId: 'simpleCreate',
  async execute(interaction, args) {
    const gamePreset = args[0];
    const preset = GAME_PRESETS[gamePreset];
    const guildId = interaction.guildId;

    const title = interaction.fields.getTextInputValue('title');
    const datetimeStr = interaction.fields.getTextInputValue('datetime');
    const maxParticipantsStr = interaction.fields.getTextInputValue('maxParticipants');

    let gameName = preset?.displayName;
    if (gamePreset === 'custom') {
      gameName = interaction.fields.getTextInputValue('gameName');
    }

    const startTime = parseDateTime(datetimeStr);
    if (!startTime) {
      return interaction.reply({
        content: '❌ Could not parse the date/time. Please use a format like "Feb 15 7pm UTC".',
        ephemeral: true,
      });
    }

    const maxParticipants = parseInt(maxParticipantsStr, 10);
    if (isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 128) {
      return interaction.reply({
        content: '❌ Max participants must be a number between 2 and 128.',
        ephemeral: true,
      });
    }

    // === Subscription checks ===

    // 1. Check concurrent limit
    const concurrentCheck = checkConcurrentLimit(guildId);
    if (!concurrentCheck.allowed) {
      return interaction.reply({
        ...getUpgradeEmbed('concurrent', getEffectiveTier(guildId), concurrentCheck.reason),
      });
    }

    // 2. Check tournament limit (may use token)
    const limitCheck = checkTournamentLimit(guildId);
    if (!limitCheck.allowed) {
      return interaction.reply({
        ...getTokenPurchaseEmbed(limitCheck),
      });
    }

    // 3. Check participant limit (and try to use a boost if available)
    let boostToUse = null;
    let participantCheck = checkParticipantLimit(guildId, maxParticipants);

    if (!participantCheck.allowed) {
      // Check if we have an available boost that would cover it
      const tier = getEffectiveTier(guildId);
      const baseMax = TIER_LIMITS[tier].maxParticipants;
      const needed = maxParticipants - baseMax;
      const tokenBalance = getTokenBalance(guildId);

      // Find smallest boost that covers the need
      const availableBoosts = tokenBalance.participantBoosts
        .filter(b => b.amount >= needed)
        .sort((a, b) => a.amount - b.amount);

      if (availableBoosts.length > 0) {
        // Use the smallest sufficient boost
        boostToUse = availableBoosts[0].amount;
        participantCheck = checkParticipantLimit(guildId, maxParticipants, boostToUse);
        console.log(`[Subscription] Guild ${guildId} auto-applying +${boostToUse} participant boost`);
      }

      // If still not allowed (no suitable boost), show purchase prompt
      if (!participantCheck.allowed) {
        return interaction.reply({
          ...getBoostPurchaseEmbed(participantCheck),
        });
      }
    }

    // Log if using a token
    if (limitCheck.usingToken) {
      console.log(`[Subscription] Guild ${guildId} using tournament token`);
    }

    // Get or create announcement channel
    const announcementChannel = await getOrCreateAnnouncementChannel(interaction.guild);
    const targetChannel = announcementChannel || interaction.channel;

    const tournament = createTournament({
      guildId: interaction.guildId,
      channelId: targetChannel.id,
      title,
      gamePreset,
      gameDisplayName: gameName,
      gameShortName: gamePreset === 'custom' ? gameName.substring(0, 4).toUpperCase() : preset?.shortName,
      maxParticipants,
      startTime,
      setupMode: 'simple',
      createdBy: interaction.user.id,
    });

    const embed = createTournamentEmbed(tournament);
    const buttons = createTournamentButtons(tournament);
    const participantEmbed = createParticipantListEmbed(tournament);

    await interaction.reply({
      content: `✅ Tournament created! Announced in ${targetChannel}.`,
      ephemeral: true,
    });

    const mainMessage = await targetChannel.send({ embeds: [embed], components: buttons });
    const listMessage = await targetChannel.send({ embeds: [participantEmbed] });

    updateTournament(tournament.id, {
      messageId: mainMessage.id,
      participantListMessageId: listMessage.id,
    });

    scheduleReminders(tournament, interaction.client);

    // Record usage (consumes token and/or boost if needed)
    const { usedToken, usedBoost } = recordTournamentCreation(guildId, boostToUse);
    if (usedToken) {
      console.log(`[Subscription] Guild ${guildId} consumed tournament token`);
    }
    if (usedBoost) {
      console.log(`[Subscription] Guild ${guildId} consumed +${usedBoost} participant boost`);
    }
  },
};
