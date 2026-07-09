// Final step of the advanced-creation wizard. The shared creation
// orchestration (subscription checks, channel resolution, announcement,
// reminders, usage accounting) lives in services/creationService.js — also
// used by the simple modal and the web-admin dashboard.

const { GAME_PRESETS } = require('../config/gamePresets');
const { deleteSession } = require('../data/wizardSessions');
const { runCreationChecks, resolveAnnouncementChannel, createAndAnnounce } = require('../services/creationService');
const { checkFailureReply } = require('./simpleCreateModal');

async function createTournamentFromWizard(interaction, session) {
  const { data } = session;
  const guildId = session.guildId;
  const preset = GAME_PRESETS[data.gamePreset];

  // Gated features picked in the wizard
  const features = [];
  if (data.checkinRequired) features.push('checkin');
  if (data.seedingEnabled) features.push('seeding');
  if (data.captainMode) features.push('captain_mode');
  if (data.requiredRoles?.length > 0) features.push('required_roles');
  if (data.publicBracket) features.push('public_bracket');
  // BR events bigger than one lobby run multi-lobby group stages
  if (data.format === 'battle_royale') {
    const brDefaults = preset?.brDefaults || {};
    const lobby = data.lobbySize || brDefaults.lobbySize || 20;
    if (data.maxParticipants > lobby) features.push('multi_lobby_br');
  }

  // Subscription checks (concurrent / monthly / participant cap / features)
  const checks = await runCreationChecks(guildId, { maxParticipants: data.maxParticipants, features });
  if (!checks.ok) {
    return interaction.update({ ...(await checkFailureReply(guildId, checks)), components: [] });
  }

  // Announcement channel: per-tournament override (stored in the wizard
  // session by /tournament create-advanced channel:#…) → per-game → default
  const resolved = await resolveAnnouncementChannel(interaction.guild, data.gamePreset, data.announcementChannelId || null);
  if (resolved.error) {
    return interaction.update({ content: `❌ ${resolved.error}`, components: [] });
  }
  const targetChannel = resolved.channel || interaction.channel;

  let gameDisplayName = data.gameName || preset?.displayName;
  let gameShortName = preset?.shortName;

  if (data.gamePreset === 'custom') {
    gameDisplayName = data.gameName || data.title;
    gameShortName = (data.gameName || data.title).substring(0, 4).toUpperCase();
  }

  // Ack inside the 3s window; the announcement posts right after.
  await interaction.update({
    content: `✅ Tournament **${data.title}** created! Announced in ${targetChannel}.`,
    components: [],
  });

  try {
    await createAndAnnounce({
      client: interaction.client,
      guildId,
      targetChannel,
      boostToUse: checks.boostToUse,
      data: {
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
        brScoringModel: data.brScoringModel,
        requiredRoles: data.requiredRoles || [],
        publicBracket: data.publicBracket ?? false,
        thirdPlaceMatch: (data.format === 'single_elimination' && data.thirdPlaceMatch) || false,
        startTime: new Date(data.datetime),
        setupMode: 'advanced',
        createdBy: session.userId,
      },
      });
  } catch (error) {
    // Turn the premature ✅ into an accurate failure message. The wizard
    // session is kept so a retry doesn't mean redoing every step.
    console.error('Wizard create failed:', error);
    await interaction.editReply({
      content: `❌ Creation failed: ${error.message}\nNothing was created — run \`/tournament create-advanced\` to try again.`,
    }).catch(() => {});
    return;
  }

  await deleteSession(session.id);
}

module.exports = {
  createTournamentFromWizard,
};
