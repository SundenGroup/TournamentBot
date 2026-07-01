// Shared tournament-creation orchestration used by BOTH Discord creation flows
// (simple modal + advanced wizard) and the web-admin dashboard. Runs the
// subscription checks, creates the tournament, posts the announcement to the
// target channel, saves message ids, schedules reminders and records usage.
//
// Callers render failures themselves (Discord shows upgrade embeds, the web
// returns JSON) — this service only reports WHAT failed via a typed result:
//   { ok: false, type: 'concurrent'|'tournament_limit'|'participants'|'feature',
//     feature?, check, tier }
//   { ok: true, tournament, targetChannel, usedToken, usedBoost }

const { createTournament, updateTournament } = require('./tournamentService');
const { createTournamentEmbed, createTournamentButtons, createParticipantListEmbed } = require('../utils/embedBuilder');
const { getOrCreateAnnouncementChannel } = require('./announcementService');
const { scheduleReminders } = require('./reminderService');
const { getTokenBalance } = require('../data/subscriptions');
const {
  checkConcurrentLimit,
  checkTournamentLimit,
  checkParticipantLimit,
  checkFeature,
  recordTournamentCreation,
  getEffectiveTier,
  TIER_LIMITS,
} = require('./subscriptionService');

/**
 * Run every pre-creation subscription/entitlement check.
 * @returns {Promise<{ok: boolean, type?: string, feature?: string, check?: object,
 *                    tier?: string, boostToUse?: number|null, limitCheck?: object}>}
 */
async function runCreationChecks(guildId, { maxParticipants, features = [] }) {
  const concurrentCheck = await checkConcurrentLimit(guildId);
  if (!concurrentCheck.allowed) {
    return { ok: false, type: 'concurrent', check: concurrentCheck, tier: await getEffectiveTier(guildId) };
  }

  const limitCheck = await checkTournamentLimit(guildId);
  if (!limitCheck.allowed) {
    return { ok: false, type: 'tournament_limit', check: limitCheck, tier: await getEffectiveTier(guildId) };
  }

  // Participant cap — auto-apply the smallest sufficient purchased boost.
  let boostToUse = null;
  let participantCheck = await checkParticipantLimit(guildId, maxParticipants);
  if (!participantCheck.allowed) {
    const tier = await getEffectiveTier(guildId);
    const needed = maxParticipants - TIER_LIMITS[tier].maxParticipants;
    const tokenBalance = await getTokenBalance(guildId);
    const availableBoosts = tokenBalance.participantBoosts
      .filter(b => b.amount >= needed)
      .sort((a, b) => a.amount - b.amount);

    if (availableBoosts.length > 0) {
      boostToUse = availableBoosts[0].amount;
      participantCheck = await checkParticipantLimit(guildId, maxParticipants, boostToUse);
      console.log(`[Subscription] Guild ${guildId} auto-applying +${boostToUse} participant boost`);
    }
    if (!participantCheck.allowed) {
      return { ok: false, type: 'participants', check: participantCheck, tier };
    }
  }

  // Gated features (checkin, seeding, captain_mode, required_roles, public_bracket…)
  for (const feature of features) {
    const featureCheck = await checkFeature(guildId, feature);
    if (!featureCheck.allowed) {
      return { ok: false, type: 'feature', feature, check: featureCheck, tier: await getEffectiveTier(guildId) };
    }
  }

  if (limitCheck.usingToken) {
    console.log(`[Subscription] Guild ${guildId} using tournament token`);
  }
  return { ok: true, boostToUse, limitCheck };
}

/**
 * Resolve where the announcement goes. Per-tournament override → per-game /
 * server default → provided fallback channel.
 * Returns { channel } or { error } when an override is given but unusable.
 */
async function resolveAnnouncementChannel(guild, gamePreset, overrideChannelId = null, fallbackChannel = null) {
  if (overrideChannelId) {
    const channel = await guild.channels.fetch(overrideChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return { error: 'That channel could not be found or is not a text channel.' };
    }
    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms || !perms.has('ViewChannel') || !perms.has('SendMessages') || !perms.has('EmbedLinks')) {
      return { error: `I can't post in <#${overrideChannelId}> — I need View Channel, Send Messages and Embed Links there.` };
    }
    return { channel };
  }
  const resolved = await getOrCreateAnnouncementChannel(guild, gamePreset);
  return { channel: resolved || fallbackChannel };
}

/**
 * Create the tournament, announce it, persist message ids, schedule reminders
 * and record subscription usage. `data` is the exact createTournament payload
 * (must already include channelId).
 */
async function createAndAnnounce({ client, guildId, data, targetChannel, boostToUse = null }) {
  const tournament = await createTournament({ ...data, guildId, channelId: targetChannel.id });

  const embed = await createTournamentEmbed(tournament);
  const buttons = createTournamentButtons(tournament);
  const participantEmbed = await createParticipantListEmbed(tournament);

  const mainMessage = await targetChannel.send({ embeds: [embed], components: buttons });
  const listMessage = await targetChannel.send({ embeds: [participantEmbed] });

  await updateTournament(tournament.id, {
    messageId: mainMessage.id,
    participantListMessageId: listMessage.id,
  });

  scheduleReminders(tournament, client);

  const { usedToken, usedBoost } = await recordTournamentCreation(guildId, boostToUse);
  if (usedToken) console.log(`[Subscription] Guild ${guildId} consumed tournament token`);
  if (usedBoost) console.log(`[Subscription] Guild ${guildId} consumed +${usedBoost} participant boost`);

  return { tournament, usedToken, usedBoost };
}

module.exports = {
  runCreationChecks,
  resolveAnnouncementChannel,
  createAndAnnounce,
};
