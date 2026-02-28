const { GAME_PRESETS } = require('../config/gamePresets');
const { createTournament, updateTournament } = require('../services/tournamentService');
const { createTournamentEmbed, createTournamentButtons, createParticipantListEmbed } = require('../utils/embedBuilder');
const { getOrCreateAnnouncementChannel } = require('../services/announcementService');
const { scheduleReminders } = require('../services/reminderService');
const { deleteSession } = require('../data/wizardSessions');
const { getTokenBalance } = require('../data/subscriptions');
const {
  checkConcurrentLimit,
  checkTournamentLimit,
  checkParticipantLimit,
  checkFeature,
  recordTournamentCreation,
  getEffectiveTier,
  getUpgradeEmbed,
  getTokenPurchaseEmbed,
  getBoostPurchaseEmbed,
  TIER_LIMITS,
} = require('../services/subscriptionService');

async function createTournamentFromWizard(interaction, session) {
  const { data } = session;
  const guildId = session.guildId;
  const preset = GAME_PRESETS[data.gamePreset];

  // === Subscription checks ===

  // 1. Check concurrent limit
  const concurrentCheck = checkConcurrentLimit(guildId);
  if (!concurrentCheck.allowed) {
    return interaction.update({
      ...getUpgradeEmbed('concurrent', getEffectiveTier(guildId), concurrentCheck.reason),
      components: [],
    });
  }

  // 2. Check tournament limit (may use token)
  const limitCheck = checkTournamentLimit(guildId);
  if (!limitCheck.allowed) {
    return interaction.update({
      ...getTokenPurchaseEmbed(limitCheck),
      components: [],
    });
  }

  // 3. Check participant limit (and try to use a boost if available)
  let boostToUse = null;
  let participantCheck = checkParticipantLimit(guildId, data.maxParticipants);

  if (!participantCheck.allowed) {
    // Check if we have an available boost that would cover it
    const tier = getEffectiveTier(guildId);
    const baseMax = TIER_LIMITS[tier].maxParticipants;
    const needed = data.maxParticipants - baseMax;
    const tokenBalance = getTokenBalance(guildId);

    // Find smallest boost that covers the need
    const availableBoosts = tokenBalance.participantBoosts
      .filter(b => b.amount >= needed)
      .sort((a, b) => a.amount - b.amount);

    if (availableBoosts.length > 0) {
      // Use the smallest sufficient boost
      boostToUse = availableBoosts[0].amount;
      participantCheck = checkParticipantLimit(guildId, data.maxParticipants, boostToUse);
      console.log(`[Subscription] Guild ${guildId} auto-applying +${boostToUse} participant boost`);
    }

    // If still not allowed (no suitable boost), show purchase prompt
    if (!participantCheck.allowed) {
      return interaction.update({
        ...getBoostPurchaseEmbed(participantCheck),
        components: [],
      });
    }
  }

  // 4. Check premium features
  const premiumFeaturesToCheck = [];
  if (data.checkinRequired) premiumFeaturesToCheck.push('checkin');
  if (data.seedingEnabled) premiumFeaturesToCheck.push('seeding');
  if (data.captainMode) premiumFeaturesToCheck.push('captain_mode');
  if (data.requiredRoles?.length > 0) premiumFeaturesToCheck.push('required_roles');

  for (const feature of premiumFeaturesToCheck) {
    const featureCheck = checkFeature(guildId, feature);
    if (!featureCheck.allowed) {
      return interaction.update({
        ...getUpgradeEmbed(feature, getEffectiveTier(guildId)),
        components: [],
      });
    }
  }

  // Log if using a token
  if (limitCheck.usingToken) {
    console.log(`[Subscription] Guild ${guildId} using tournament token`);
  }

  const announcementChannel = await getOrCreateAnnouncementChannel(interaction.guild);
  const targetChannel = announcementChannel || interaction.channel;

  let gameDisplayName = data.gameName || preset?.displayName;
  let gameShortName = preset?.shortName;

  if (data.gamePreset === 'custom') {
    gameDisplayName = data.gameName || data.title;
    gameShortName = (data.gameName || data.title).substring(0, 4).toUpperCase();
  }

  const tournament = createTournament({
    guildId: session.guildId,
    channelId: targetChannel.id,
    title: data.title,
    description: data.description || undefined,
    gamePreset: data.gamePreset,
    gameDisplayName,
    gameShortName,
    maxParticipants: data.maxParticipants,
    teamSize: data.teamSize,
    format: data.format,
    bestOf: data.bestOf,
    checkinRequired: data.checkinRequired,
    checkinWindow: data.checkinWindow,
    seedingEnabled: data.seedingEnabled,
    requireGameNick: data.requireGameNick,
    captainMode: data.captainMode,
    lobbySize: data.lobbySize,
    gamesPerStage: data.gamesPerStage,
    advancingPerGroup: data.advancingPerGroup,
    requiredRoles: data.requiredRoles || [],
    startTime: new Date(data.datetime),
    setupMode: 'advanced',
    createdBy: session.userId,
  });

  const embed = createTournamentEmbed(tournament);
  const buttons = createTournamentButtons(tournament);
  const participantEmbed = createParticipantListEmbed(tournament);

  await interaction.update({
    content: `✅ Tournament **${data.title}** created! Announced in ${targetChannel}.`,
    components: [],
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

  deleteSession(session.id);
}

module.exports = {
  createTournamentFromWizard,
};
