// Tournament lifecycle orchestration — the single implementation behind the
// Discord slash commands, the match-room buttons AND the web-admin dashboard.
//
// Each flow performs the full set of side-effects (bracket mutation, DB
// persistence, match-room creation, DMs, announcement updates, webhooks) and
// returns a plain summary for the caller to render. Validation failures throw
// Error(message) — messages carry no ❌ prefix so each surface frames them.
//
// Unifying these flows also fixed real gaps between the old copies:
//   • slash report didn't create next-round rooms or post the completion
//     announcement; button report didn't trigger auto-cleanup
//   • slash start and cancel never refreshed the announcement embed

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament, updateTournament, adminRemoveEntrant, resolveTeamMembers } = require('./tournamentService');
const { getServiceForBracket, findMatchByNumber, normalizeSeriesScore } = require('../utils/matchUtils');
const { createMatchRoom, createBRGroupRoom, collectTournamentChannels, bulkCleanupChannels, clearBracketChannelIds, getChannelCapacity, isCapacityError } = require('./channelService');
const { notifyByesAndWalkovers, getStartByeSummary } = require('../utils/byeNotifier');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const { createTournamentEmbed, createTournamentButtons, getBracketUrl } = require('../utils/embedBuilder');
const { getServerSettings } = require('../data/serverSettings');
const webhooks = require('./webhookService');

const FORMAT_NAMES = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  swiss: 'Swiss',
  round_robin: 'Round Robin',
  battle_royale: 'Battle Royale',
};

// ─── Start ───────────────────────────────────────────────────────────────────

/**
 * Start a tournament: generate the bracket, create first-round rooms, DM byes,
 * persist, refresh the announcement, fire webhooks.
 * Throws on validation failure; rolls back the status lock on mid-flight failure.
 */
async function startTournamentFlow({ client, guild, tournamentId }) {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
    throw new Error('Tournament is not in registration/checkin phase.');
  }

  const isSolo = tournament.settings.teamSize === 1;
  const participants = isSolo ? tournament.participants : tournament.teams;
  const participantCount = participants.length;
  if (participantCount < 2) throw new Error('Need at least 2 participants to start.');

  // Immediately mark as active to prevent concurrent starts. Remember the
  // prior status so we can roll back if anything below fails — otherwise a
  // failed start strands the tournament "active" with no bracket.
  const previousStatus = tournament.status;
  await updateTournament(tournamentId, { status: 'active' });

  try {
    // Resolve pending team members (captain mode)
    if (!isSolo && tournament.settings.captainMode) {
      const { resolved, failed } = await resolveTeamMembers(guild, tournament);
      if (resolved > 0 || failed > 0) {
        console.log(`Captain mode resolution for "${tournament.title}": ${resolved} resolved, ${failed} failed`);
      }
      await updateTournament(tournamentId, { teams: tournament.teams });
    }

    const format = tournament.settings.format;
    const service = getServiceForBracket({ type: format });
    const bracket = service.generateBracket(participants, tournament.settings);

    // ── Capacity pre-flight (docs/CHANNEL-CAPACITY-PLAN.md Phase 1) ─────────
    // Block a start that can't fit its first-round rooms instead of failing
    // one channel at a time with generic errors.
    const roomsNeeded = format === 'battle_royale'
      ? bracket.groups.length
      : service.getActiveMatches(bracket).filter(m => m.participant1 && m.participant2).length;
    const capacity = getChannelCapacity(guild);
    if (roomsNeeded > capacity.available) {
      throw new Error(
        `Starting needs **${roomsNeeded}** ${format === 'battle_royale' ? 'lobby' : 'match'} rooms, but this server ` +
        `only has **${capacity.available}** channel slots free (${capacity.used}/${capacity.cap} used — Discord caps servers at ${capacity.cap} channels). ` +
        'Free slots with `/admin cleanup mode:archive` (saves history, deletes rooms), enable rolling auto-archive ' +
        '(`/admin set-auto-archive`), or reduce the field — then start again.'
      );
    }

    tournament.bracket = bracket;
    tournament.status = 'active';

    let roomsCreated = 0;
    let roomsFailed = 0;
    let capacityHit = false;
    if (format === 'battle_royale') {
      for (const group of bracket.groups) {
        try {
          const channel = await createBRGroupRoom(guild, group, tournament);
          group.channelId = channel.id;
          roomsCreated++;
          // Post the interactive standings board (report buttons live here)
          tournament.bracket = bracket;
          await refreshBRBoard(client, { ...tournament, bracket }, group);
        } catch (error) {
          console.error('Error creating BR group room:', error);
          roomsFailed++;
          if (isCapacityError(error)) { capacityHit = true; break; }
        }
      }
    } else {
      const ready = service.getActiveMatches(bracket).filter(m => m.participant1 && m.participant2);
      for (const match of ready) {
        try {
          const channel = await createMatchRoom(guild, match, tournament);
          match.channelId = channel.id;
          roomsCreated++;
        } catch (error) {
          console.error('Error creating match room:', error);
          roomsFailed++;
          if (isCapacityError(error)) {
            // Stop hammering the API — every further create will fail too
            capacityHit = true;
            roomsFailed = ready.length - roomsCreated;
            break;
          }
        }
      }
    }
    if (capacityHit) {
      bracket.capacityHit = true;
      await announceCapacityIssue(client, tournament, roomsFailed);
    }

    // DM players/teams that start with a bye (marks matches byeNotified,
    // persisted by the update below)
    await notifyByesAndWalkovers(client, tournament);

    await updateTournament(tournamentId, { bracket, status: 'active' });

    webhooks.onTournamentStarted(tournament);

    // Refresh the announcement message (status pill + buttons flip to Active)
    await updateTournamentMessages(client, tournament);

    return {
      tournament,
      bracket,
      summary: {
        participantCount,
        isSolo,
        format,
        formatName: FORMAT_NAMES[format] || format,
        roomsCreated,
        roomsFailed,
        capacityHit,
        capacity: getChannelCapacity(guild),
        byeSummary: getStartByeSummary(tournament),
        bracketUrl: getBracketUrl(tournament),
      },
    };
  } catch (error) {
    console.error('Error starting tournament:', error);
    try {
      await updateTournament(tournamentId, { status: previousStatus, bracket: null });
    } catch (rollbackError) {
      console.error('Failed to roll back tournament status:', rollbackError);
    }
    throw error;
  }
}

/** The "Tournament Started" embed — shared copy for slash + button + logs. */
function buildStartEmbed(tournament, summary) {
  const { participantCount, isSolo, format, formatName, roomsCreated, roomsFailed, byeSummary, bracketUrl, capacityHit, capacity } = summary;
  const bracket = tournament.bracket;

  let description = `**${tournament.title}** is now live!\n\n`;
  description += `• ${participantCount} ${isSolo ? 'players' : 'teams'} competing\n`;
  description += `• ${roomsCreated} ${format === 'battle_royale' ? 'lobby' : 'match'} rooms created\n`;
  if (capacityHit) {
    description += `• 🚨 **Server channel limit reached (Discord caps servers at 500)** — ${roomsFailed} room(s) missing. ` +
      `Free slots with \`/admin cleanup mode:archive\`, then run \`/tournament create-rooms\`.\n`;
  } else if (roomsFailed > 0) {
    description += `• ⚠️ **${roomsFailed} room(s) failed to create** — run \`/tournament create-rooms\` to retry, and check the bot has Manage Channels + Manage Roles.\n`;
  }
  if (!capacityHit && capacity && capacity.used > 400) {
    description += `• 📊 Channel capacity: **${capacity.used}/${capacity.cap}** used — consider \`/admin set-auto-archive\` for big events.\n`;
  }
  description += `• Format: ${formatName}\n`;

  if (format === 'swiss') {
    description += `• Rounds: ${bracket.totalRounds}\n`;
  } else if (format === 'round_robin') {
    description += `• Rounds: ${bracket.totalRounds}\n`;
    description += `• Total Matches: ${bracket.totalMatches}\n`;
  } else if (format === 'battle_royale') {
    description += `• Groups: ${bracket.groups.length}\n`;
    description += `• Games per Stage: ${bracket.gamesPerStage}\n`;
    description += `• Teams to Finals: ${bracket.totalAdvancing}\n`;
  }

  if (format === 'battle_royale') {
    description += `\nEach lobby room has a live standings board — admins report`;
    description += `\nresults by tapping the **\uD83C\uDFAE Game** buttons. No typing needed.`;
  } else {
    description += `\nUse \`/match list\` to see active matches.`;
  }

  if (byeSummary) {
    description += `\n\n${byeSummary}\n*Players with a bye have been notified by DM.*`;
  }
  if (bracketUrl) {
    description += `\n\n🌐 **Live web bracket:** ${bracketUrl}`;
  }

  const embed = new EmbedBuilder()
    .setTitle('🚀 Tournament Started!')
    .setColor(0x2ecc71)
    .setDescription(description);
  if (tournament.game.logo) embed.setThumbnail(tournament.game.logo);
  return embed;
}

// ─── Report ──────────────────────────────────────────────────────────────────

/**
 * Apply a validated match result and run every downstream side-effect:
 * DQ forfeits, bye/walkover DMs, Swiss round generation, next-round rooms,
 * completion announcement + auto-cleanup, webhooks.
 *
 * Caller must have verified: match exists, has both participants, no winner
 * yet, winnerId is one of them, score already normalized (normalizeSeriesScore).
 */
async function applyMatchReport({ client, guild, tournament, match, winnerId, score }) {
  const bracket = tournament.bracket;
  const service = getServiceForBracket(bracket);
  const isSolo = tournament.settings.teamSize === 1;

  service.advanceWinner(bracket, match.id, winnerId, score);

  const winner = match.participant1?.id === winnerId ? match.participant1 : match.participant2;
  const loser = match.participant1?.id === winnerId ? match.participant2 : match.participant1;

  // Forfeit any matches a disqualified player just arrived in
  const { resolvePendingDQs } = require('./disqualifyService');
  resolvePendingDQs(tournament);

  // A reported result can cascade walkovers (double-elim losers bracket) —
  // DM anyone who just advanced without playing, then persist the flags.
  await notifyByesAndWalkovers(client, tournament);

  await updateTournament(tournament.id, { bracket });

  webhooks.onMatchCompleted(tournament, {
    id: match.id,
    round: match.round,
    winner,
    loser,
    score: match.score || score || null,
  });

  // Swiss: a completed round generates the next one (which may hand out a bye)
  let swissRoundStarted = null;
  if (bracket.type === 'swiss' && service.isRoundComplete(bracket)) {
    if (bracket.currentRound < bracket.totalRounds) {
      service.generateNextRound(bracket);
      swissRoundStarted = bracket.currentRound;
      await notifyByesAndWalkovers(client, tournament);
    }
  }

  if (service.isComplete(bracket)) {
    // The final room follows the same rolling-archive rules
    await scheduleMatchArchive(client, tournament, match);

    const results = service.getResults(bracket);
    await updateTournament(tournament.id, { bracket, status: 'completed' });
    tournament.status = 'completed';

    webhooks.onTournamentCompleted(tournament, results.standings || [results.winner, results.runnerUp, results.thirdPlace].filter(Boolean));

    await announceTournamentComplete(client, tournament, results);
    await updateTournamentAnnouncement(client, tournament);
    await triggerAutoCleanup(guild, tournament);

    // Free the concurrent-tournament slot (was never decremented before —
    // free-tier servers would permanently exhaust their concurrent limit)
    const { recordTournamentCompletion } = require('./subscriptionService');
    await recordTournamentCompletion(tournament.guildId).catch(() => {});

    return { winner, loser, isSolo, swissRoundStarted, completed: true, results, newRooms: 0 };
  }

  // Create rooms for matches that just became ready
  let newRooms = 0;
  for (const activeMatch of service.getActiveMatches(bracket)) {
    if (!activeMatch.channelId && activeMatch.participant1 && activeMatch.participant2) {
      try {
        const channel = await createMatchRoom(guild, activeMatch, tournament);
        activeMatch.channelId = channel.id;
        newRooms++;
      } catch (error) {
        console.error('Error creating match room:', error);
        if (isCapacityError(error)) {
          // Server is at the 500-channel cap — stop, tell admins once
          if (!bracket.capacityHit) {
            bracket.capacityHit = true;
            await announceCapacityIssue(client, tournament, null);
          }
          break;
        }
      }
    }
  }

  // Rolling auto-archive (Phase 3): this room's job is done — schedule it
  await scheduleMatchArchive(client, tournament, match);

  await updateTournament(tournament.id, { bracket });

  return { winner, loser, isSolo, swissRoundStarted, completed: false, results: null, newRooms };
}

// ─── Correct ─────────────────────────────────────────────────────────────────

/**
 * Correct an already-reported result. Validates the match + score, snapshots
 * the bracket so a mid-correction throw never leaves a half-mutated cache.
 */
async function correctMatchFlow({ client, tournament, matchNumber, winnerId, score }) {
  const bracket = tournament.bracket;
  if (!bracket) throw new Error('Tournament has not started yet.');
  const service = getServiceForBracket(bracket);

  const match = findMatchByNumber(bracket, matchNumber);
  if (!match) throw new Error('Match not found.');

  const scoreResult = normalizeSeriesScore(score, tournament.settings.bestOf || 1);
  if (!scoreResult.ok) throw new Error(scoreResult.error);

  const isSolo = tournament.settings.teamSize === 1;
  const getName = (p) => (isSolo ? p?.username : p?.name);
  const oldWinnerName = getName(match.winner);
  const oldScore = match.score;

  const snapshot = JSON.parse(JSON.stringify(bracket));
  try {
    service.correctResult(bracket, match.id, winnerId, scoreResult.score);
  } catch (error) {
    tournament.bracket = snapshot;
    throw error;
  }

  // A correction settles any contest on this match and re-arms auto-archive
  if (match.contested) {
    match.contested = false;
    match.contestedBy = null;
  }
  match.archiveAt = null;
  await scheduleMatchArchive(client, tournament, match);

  await updateTournament(tournament.id, { bracket });
  await updateTournamentMessages(client, tournament);

  return {
    match,
    isSolo,
    oldWinnerName,
    oldScore,
    newWinnerName: getName(match.winner),
    normalizedScore: scoreResult.score,
    wasCompleted: tournament.status === 'completed',
  };
}

// ─── Disqualify ──────────────────────────────────────────────────────────────

async function disqualifyFlow({ client, tournament, participantId, reason }) {
  if (!tournament.bracket || tournament.status !== 'active') {
    throw new Error('Disqualification only works on a running tournament. During registration, remove the entrant instead.');
  }

  const isSolo = tournament.settings.teamSize === 1;
  const entrant = (isSolo ? tournament.participants : tournament.teams).find(e => e.id === participantId);
  if (!entrant) throw new Error('Participant not found in this tournament.');
  if (entrant.disqualified) throw new Error('Already disqualified.');

  const { disqualify } = require('./disqualifyService');
  const result = disqualify(tournament, participantId, reason);

  // DM opponents who advanced off the forfeits, persist everything
  await notifyByesAndWalkovers(client, tournament);
  await updateTournament(tournament.id, {
    bracket: tournament.bracket,
    participants: tournament.participants,
    teams: tournament.teams,
  });
  await updateTournamentMessages(client, tournament);

  const name = isSolo ? entrant.username : entrant.name;

  // Tell the channel too — a DQ is tournament-relevant news
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    await channel.send(`🚫 **${name}** has been disqualified from **${tournament.title}**.`);
  } catch { /* channel gone — not fatal */ }

  return { name, isSolo, forfeited: result.forfeited, pending: result.pending, bestOf: tournament.settings.bestOf };
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

async function cancelFlow({ client, tournament }) {
  await updateTournament(tournament.id, { status: 'cancelled' });
  tournament.status = 'cancelled';

  webhooks.onTournamentCancelled(tournament);

  const { cancelReminders } = require('./reminderService');
  cancelReminders(tournament.id);

  // Every creation takes a concurrent slot, so every cancel frees one
  const { recordTournamentCompletion } = require('./subscriptionService');
  await recordTournamentCompletion(tournament.guildId).catch(() => {});

  // Refresh the announcement so the status + buttons reflect the cancellation
  await updateTournamentMessages(client, tournament);
}

// ─── Edit ────────────────────────────────────────────────────────────────────

/**
 * Edit title/description/startTime/maxParticipants/bestOf on a tournament that
 * hasn't started. Mirrors the Discord edit-modal validation exactly.
 */
async function editTournamentFlow({ client, tournament, fields }) {
  if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
    throw new Error('This tournament has already started and can no longer be edited.');
  }

  const isSolo = tournament.settings.teamSize === 1;
  const entrantCount = isSolo ? tournament.participants.length : tournament.teams.length;

  const title = String(fields.title ?? tournament.title).trim();
  if (!title || title.length > 100) throw new Error('Title must be 1-100 characters.');

  const startTime = fields.startTime ? new Date(fields.startTime) : new Date(tournament.startTime);
  if (isNaN(startTime.getTime())) throw new Error('Could not parse the date/time.');

  const maxParticipants = parseInt(fields.maxParticipants ?? tournament.settings.maxParticipants, 10);
  if (isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 512) {
    throw new Error('Max participants must be a number between 2 and 512.');
  }
  if (maxParticipants < entrantCount) {
    throw new Error(`Max ${isSolo ? 'players' : 'teams'} can't be lower than the current signup count (${entrantCount}).`);
  }

  const bestOf = parseInt(fields.bestOf ?? tournament.settings.bestOf, 10);
  if (isNaN(bestOf) || bestOf < 1 || bestOf > 15 || bestOf % 2 === 0) {
    throw new Error('Best Of must be an odd number between 1 and 15 (e.g. 1, 3, 5, 7).');
  }

  const description = fields.description !== undefined
    ? String(fields.description).trim().slice(0, 1000) || null
    : (tournament.description || null);

  const changes = [];
  if (title !== tournament.title) changes.push('title');
  const dateChanged = startTime.getTime() !== new Date(tournament.startTime).getTime();
  if (dateChanged) changes.push('date');
  if (maxParticipants !== tournament.settings.maxParticipants) changes.push('max participants');
  if (bestOf !== tournament.settings.bestOf) changes.push('best of');
  if (description !== (tournament.description || null)) changes.push('description');

  if (changes.length === 0) return { updated: tournament, changes, dateChanged: false };

  const settings = { ...tournament.settings, maxParticipants, bestOf };
  const updated = await updateTournament(tournament.id, { title, description, startTime, settings });
  if (!updated) throw new Error('Failed to save changes, please try again.');

  if (dateChanged) {
    const { scheduleReminders } = require('./reminderService');
    scheduleReminders(updated, client);
  }
  await updateTournamentMessages(client, updated);

  return { updated, changes, dateChanged };
}

// ─── Remove entrant ──────────────────────────────────────────────────────────

async function removeEntrantFlow({ client, tournament, entrantId }) {
  const isSolo = tournament.settings.teamSize === 1;

  const result = await adminRemoveEntrant(tournament.id, entrantId);
  if (!result.success) throw new Error(result.error);

  const removed = result.removed;
  const name = isSolo ? removed.username : removed.name;

  await updateTournamentMessages(client, result.tournament);

  // Let the removed player(s) know
  const userIds = [];
  if (isSolo) {
    if (removed.id && !String(removed.id).startsWith('fake_')) userIds.push(removed.id);
  } else {
    for (const m of removed.members || []) {
      if (m.id && !String(m.id).startsWith('fake_')) userIds.push(m.id);
    }
  }
  for (const uid of userIds) {
    try {
      const u = await client.users.fetch(uid);
      await u.send(`ℹ️ ${isSolo ? 'You have' : `Your team **${name}** has`} been removed from **${tournament.title}** by a tournament admin.`);
    } catch { /* DMs closed */ }
  }

  const count = isSolo ? result.tournament.participants.length : result.tournament.teams.length;
  return { name, isSolo, count, tournament: result.tournament };
}

// ─── Create rooms (retry) ────────────────────────────────────────────────────

async function createRoomsFlow({ guild, tournament }) {
  if (!tournament.bracket || tournament.status !== 'active') {
    throw new Error('This tournament is not running, so there are no match rooms to create.');
  }

  const bracket = tournament.bracket;
  let created = 0, failed = 0, existing = 0, capacityHit = false;

  if (bracket.type === 'battle_royale') {
    for (const group of bracket.groups || []) {
      if (group.channelId) { existing++; continue; }
      try {
        const channel = await createBRGroupRoom(guild, group, tournament);
        group.channelId = channel.id;
        created++;
      } catch (error) {
        console.error('create-rooms BR error:', error);
        failed++;
        if (isCapacityError(error)) { capacityHit = true; break; }
      }
    }
  } else {
    const service = getServiceForBracket(bracket);
    for (const match of service.getActiveMatches(bracket)) {
      if (!match.participant1 || !match.participant2) continue;
      if (match.channelId) { existing++; continue; }
      try {
        const channel = await createMatchRoom(guild, match, tournament);
        match.channelId = channel.id;
        created++;
      } catch (error) {
        console.error('create-rooms match error:', error);
        failed++;
        if (isCapacityError(error)) { capacityHit = true; break; }
      }
    }
  }

  // A successful full retry clears the capacity flag; hitting the cap sets it
  if (capacityHit) bracket.capacityHit = true;
  else if (failed === 0 && bracket.capacityHit) bracket.capacityHit = false;

  if (created > 0 || capacityHit || (failed === 0 && bracket.capacityHit === false)) {
    await updateTournament(tournament.id, { bracket });
  }
  const capacity = getChannelCapacity(guild);
  return { created, failed, existing, capacityHit, capacity };
}

// ─── Battle Royale: game reports, corrections, kills ─────────────────────────
//
// BR has no matches — lobbies play N games and results arrive as placement
// orders (+ optional kills). These flows are the single implementation behind
// the tap-to-report buttons AND the web dashboard grid. No comma syntax.

const battleRoyale = require('./battleRoyaleService');

/** Resolve a stage by its board key ('f' = finals, else group index). */
function getBRStage(bracket, groupKey) {
  if (groupKey === 'f') return bracket.finals;
  const idx = parseInt(groupKey, 10);
  return Number.isInteger(idx) ? bracket.groups[idx] || null : null;
}

/** The board key used in button customIds for a stage. */
function brStageKey(bracket, stage) {
  if (bracket.finals && stage.id === bracket.finals.id) return 'f';
  return String(bracket.groups.findIndex(g => g.id === stage.id));
}

function brEngineKey(bracket, groupKey) {
  // The engine addresses the finals as 'finals' and groups by their uuid.
  if (groupKey === 'f') return 'finals';
  const stage = getBRStage(bracket, groupKey);
  return stage?.id || null;
}

/**
 * Apply a game report and every side-effect: persistence, lobby-board refresh,
 * result announcement, finals-room creation, completion flow.
 */
async function applyBRGameReport({ client, guild, tournament, groupKey, gameNumber, placements, kills = {} }) {
  const bracket = tournament.bracket;
  const engineKey = brEngineKey(bracket, groupKey);
  if (!engineKey) throw new Error('Lobby not found.');

  const result = battleRoyale.reportGameResults(bracket, engineKey, gameNumber, placements, kills);
  return finishBRMutation({ client, guild, tournament, result, groupKey, gameNumber, kind: 'report' });
}

/** Correct an already-reported game (same tap flow, different commit). */
async function applyBRGameCorrection({ client, guild, tournament, groupKey, gameNumber, placements, kills = {} }) {
  const bracket = tournament.bracket;
  const engineKey = brEngineKey(bracket, groupKey);
  if (!engineKey) throw new Error('Lobby not found.');

  const result = battleRoyale.correctGameResults(bracket, engineKey, gameNumber, placements, kills);
  return finishBRMutation({ client, guild, tournament, result, groupKey, gameNumber, kind: 'correct' });
}

/** Add/replace kills on a reported game (placements untouched). */
async function applyBRSetKills({ client, tournament, groupKey, gameNumber, kills }) {
  const bracket = tournament.bracket;
  const engineKey = brEngineKey(bracket, groupKey);
  if (!engineKey) throw new Error('Lobby not found.');

  const result = battleRoyale.setKills(bracket, engineKey, gameNumber, kills);
  await updateTournament(tournament.id, { bracket });
  await refreshBRBoard(client, tournament, result.stage);
  return result;
}

/** Shared tail of report/correct: rooms, persistence, announcements, boards. */
async function finishBRMutation({ client, guild, tournament, result, groupKey, gameNumber, kind }) {
  const bracket = tournament.bracket;
  const { stage, finalsCreated, tournamentComplete, finalsRegenerated } = result;

  // New finals stage → create its lobby room + board; group lobbies are done,
  // so the rolling auto-archive can reclaim them.
  if (finalsCreated && guild) {
    try {
      const channel = await createBRGroupRoom(guild, bracket.finals, tournament);
      bracket.finals.channelId = channel.id;
      await refreshBRBoard(client, tournament, bracket.finals);
    } catch (error) {
      console.error('Error creating finals room:', error);
      if (isCapacityError(error) && !bracket.capacityHit) {
        bracket.capacityHit = true;
        await announceCapacityIssue(client, tournament, 1);
      }
    }
    await announceBRFinals(client, tournament, bracket);
    await scheduleBRStageArchives(tournament, bracket.groups);
  }

  if (tournamentComplete) {
    await updateTournament(tournament.id, { bracket, status: 'completed' });
    tournament.status = 'completed';

    const results = battleRoyale.getResults(bracket);
    webhooks.onTournamentCompleted(tournament, results.standings.map(s => s.team));

    await announceBRGameResult(client, tournament, stage, gameNumber, kind);
    await refreshBRBoard(client, tournament, stage);
    await announceTournamentComplete(client, tournament, results);
    await updateTournamentAnnouncement(client, tournament);
    if (guild) await triggerAutoCleanup(guild, tournament);

    // Free the concurrent-tournament slot
    const { recordTournamentCompletion } = require('./subscriptionService');
    await recordTournamentCompletion(tournament.guildId).catch(() => {});

    return { ...result, groupKey };
  }

  await updateTournament(tournament.id, { bracket });
  await announceBRGameResult(client, tournament, stage, gameNumber, kind);
  await refreshBRBoard(client, tournament, stage);
  if (finalsRegenerated) await refreshBRBoard(client, tournament, bracket.finals);

  return { ...result, groupKey };
}

// ─── BR display: lobby board + announcements ─────────────────────────────────

/** Compact standings table for embeds (monospace). */
function brStandingsTable(bracket, stage, limit = 20) {
  const name = (t) => (t.name || t.username || 'Unknown');
  const usesKills = (bracket.scoring?.killPoints || 0) > 0 || bracket.scoring?.killMultipliers;

  const isGroupsStage = bracket.currentStage === 'groups' && !bracket.singleLobby && stage.id !== 'finals';
  const cut = isGroupsStage ? bracket.advancingPerGroup : 0;

  let out = '```\n';
  out += usesKills ? ' #  Team                 Pts  Kills\n' : ' #  Team                 Pts\n';
  stage.standings.slice(0, limit).forEach((s, i) => {
    const mark = cut && i < cut ? '▸' : ' ';
    const nm = name(s.team).slice(0, 20).padEnd(20);
    const pts = String(s.points).padStart(4);
    out += `${mark}${String(i + 1).padStart(2)}  ${nm}${pts}`;
    if (usesKills) out += `  ${String(s.kills).padStart(4)}`;
    out += '\n';
  });
  if (stage.standings.length > limit) out += ` …and ${stage.standings.length - limit} more\n`;
  out += '```';
  if (cut) out += `\n▸ Top **${cut}** advance to the Grand Finals`;
  return out;
}

/** The per-lobby board: standings embed + one button per game. */
function buildBRBoard(tournament, stage) {
  const bracket = tournament.bracket;
  const done = stage.games.filter(g => g.status === 'complete').length;

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${stage.name} — Standings`)
    .setColor(stage.id === 'finals' ? 0xffd700 : 0xff6b35)
    .setDescription(
      `**${tournament.title}**\n` +
      `${bracket.scoring?.label || 'Placement points'} · Game ${Math.min(done + 1, stage.games.length)} of ${stage.games.length}` +
      `\n\n${brStandingsTable(bracket, stage)}`
    )
    .setFooter({ text: done < stage.games.length
      ? 'Admins: tap a game button to report results — no typing needed.'
      : 'All games reported. Tap a game to correct it.' });

  const key = brStageKey(bracket, stage);
  const rows = [];
  let row = new ActionRowBuilder();
  stage.games.forEach((g, i) => {
    if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
    const isNext = g.status === 'pending' && stage.games.findIndex(x => x.status === 'pending') === i;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`brReport:${tournament.id}:${key}:${g.gameNumber}:start`)
        .setLabel(`${g.status === 'complete' ? '✅' : '🎮'} Game ${g.gameNumber}`)
        .setStyle(isNext ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  });
  rows.push(row);

  return { embeds: [embed], components: rows };
}

/** Re-render a stage's lobby board (posts it if missing). */
async function refreshBRBoard(client, tournament, stage) {
  if (!stage?.channelId) return;
  try {
    const channel = await client.channels.fetch(stage.channelId);
    const board = buildBRBoard(tournament, stage);
    if (stage.boardMessageId) {
      const msg = await channel.messages.fetch(stage.boardMessageId).catch(() => null);
      if (msg) { await msg.edit(board); return; }
    }
    const sent = await channel.send(board);
    stage.boardMessageId = sent.id;
    await updateTournament(tournament.id, { bracket: tournament.bracket });
  } catch (error) {
    console.error('Error refreshing BR board:', error);
  }
}

/** Post a game-result summary to the tournament's announcement channel. */
async function announceBRGameResult(client, tournament, stage, gameNumber, kind = 'report') {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;

    const game = stage.games.find(g => g.gameNumber === gameNumber);
    if (!game || game.status !== 'complete') return;

    const teamById = new Map(stage.teams.map(t => [t.id, t]));
    const name = (id) => {
      const t = teamById.get(id);
      return t ? (t.name || t.username || 'Unknown') : 'Unknown';
    };

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const top = game.results
      .filter(r => r.placement != null)
      .sort((a, b) => a.placement - b.placement)
      .slice(0, 5);

    const embed = new EmbedBuilder()
      .setTitle(`${kind === 'correct' ? '🛠️' : '🎮'} ${stage.name} — Game ${gameNumber} ${kind === 'correct' ? 'corrected' : 'results'}`)
      .setColor(stage.id === 'finals' ? 0xffd700 : 0xff6b35);
    if (tournament.game.logo) embed.setThumbnail(tournament.game.logo);

    let description = `**${tournament.title}**\n\n`;
    top.forEach((r, i) => {
      description += `${medals[i]} **${name(r.teamId)}** — ${r.points} pts`;
      if (r.kills) description += ` (${r.kills} kills)`;
      description += '\n';
    });

    description += `\n**Standings after Game ${gameNumber}:**\n`;
    stage.standings.slice(0, 5).forEach((s, i) => {
      description += `${i + 1}. ${s.team.name || s.team.username} — **${s.points}** pts\n`;
    });

    const done = stage.games.filter(g => g.status === 'complete').length;
    description += `\n📊 *${done}/${stage.games.length} games reported*`;

    embed.setDescription(description);
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing BR game result:', error);
  }
}

/** Announce the Grand Finals roster in the tournament channel. */
async function announceBRFinals(client, tournament, bracket) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel || !bracket.finals) return;

    const embed = new EmbedBuilder()
      .setTitle(`🚀 GRAND FINALS — ${tournament.title}`)
      .setColor(0xffd700);
    if (tournament.game.logo) embed.setThumbnail(tournament.game.logo);

    let description = `**${bracket.finals.teams.length} ${tournament.settings.teamSize === 1 ? 'players' : 'teams'} have qualified!**\n\n`;
    const byGroup = {};
    for (const team of bracket.finals.teams) {
      const from = team.qualifiedFrom || 'Qualified';
      (byGroup[from] = byGroup[from] || []).push(team);
    }
    for (const [groupName, teams] of Object.entries(byGroup)) {
      description += `**${groupName}:** ${teams.map(t => t.name || t.username).join(', ')}\n`;
    }
    description += `\n${bracket.gamesPerStage} games decide the champion. Good luck! 🏆`;

    embed.setDescription(description);
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing BR finals:', error);
  }
}

// ─── Channel capacity + rolling auto-archive ─────────────────────────────────
// docs/CHANNEL-CAPACITY-PLAN.md Phases 1 & 3.

/** One clear admin-facing message when the 500-channel cap interrupts rooms. */
async function announceCapacityIssue(client, tournament, missingCount) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;
    const missing = missingCount != null ? `**${missingCount}** room(s) could not be created. ` : '';
    await channel.send(
      `🚨 **Server channel limit reached** — Discord caps servers at 500 channels, and this server is full. ${missing}` +
      `Matches without a room can still be reported with \`/tournament report\` or from the web dashboard.\n` +
      `**To fix:** free slots with \`/admin cleanup mode:archive\` (saves history to #match-logs + the dashboard, then deletes rooms) ` +
      `and run \`/tournament create-rooms\` to create the missing rooms. Rolling auto-archive (\`/admin set-auto-archive\`) prevents this.`
    );
  } catch (error) {
    console.error('Error announcing capacity issue:', error);
  }
}

/** Effective auto-archive delay for a tournament (per-tournament override → server setting). */
async function getAutoArchiveMinutes(tournament) {
  const own = tournament.settings.autoArchiveMinutes;
  if (own != null) return own;
  const settings = await getServerSettings(tournament.guildId);
  return settings.autoArchiveMinutes || 0;
}

/**
 * After a result: stamp `archiveAt` on the match (persisted with the bracket
 * → restart-safe) and post the closing notice with the contest button.
 */
async function scheduleMatchArchive(client, tournament, match) {
  try {
    if (!match?.channelId || match.contested) return;
    const minutes = await getAutoArchiveMinutes(tournament);
    if (!minutes) return;

    match.archiveAt = Date.now() + minutes * 60 * 1000;

    const isSolo = tournament.settings.teamSize === 1;
    const winnerName = isSolo ? match.winner?.username : match.winner?.name;
    const channel = await client.channels.fetch(match.channelId).catch(() => null);
    if (!channel) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`contestResult:${tournament.id}:${match.id}`)
        .setLabel('⚠️ Contest result')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`archiveNow:${tournament.id}:${match.id}`)
        .setLabel('🗄️ Close now (admin)')
        .setStyle(ButtonStyle.Secondary)
    );
    await channel.send({
      content:
        `✅ Result recorded${winnerName ? `: **${winnerName}** wins` : ''}${match.score ? ` (${match.score})` : ''}. ` +
        `This room closes in **${minutes} min** — the full chat history is saved and stays available to admins.\n` +
        `Spot a problem with the result? Tap **⚠️ Contest result** to keep the room open and alert the admins.`,
      components: [row],
    });
  } catch (error) {
    console.error('Error scheduling match archive:', error);
  }
}

/** BR: lobbies whose stage is over get the same rolling treatment. */
async function scheduleBRStageArchives(tournament, stages) {
  const minutes = await getAutoArchiveMinutes(tournament);
  if (!minutes) return;
  for (const stage of stages) {
    if (stage?.channelId) stage.archiveAt = Date.now() + minutes * 60 * 1000;
  }
}

// ─── Completion side-effects (shared) ────────────────────────────────────────

/** Post the "TOURNAMENT COMPLETE" podium embed to the tournament's channel. */
async function announceTournamentComplete(client, tournament, results) {
  const isSolo = tournament.settings.teamSize === 1;

  const embed = new EmbedBuilder()
    .setTitle('🏆 TOURNAMENT COMPLETE 🏆')
    .setColor(0xffd700)
    .setDescription(tournament.title);
  if (tournament.game.logo) embed.setThumbnail(tournament.game.logo);

  const winnerName = isSolo ? results.winner?.username : results.winner?.name;
  const runnerUpName = isSolo ? results.runnerUp?.username : results.runnerUp?.name;
  const thirdPlaceName = isSolo ? results.thirdPlace?.username : results.thirdPlace?.name;

  const fields = [
    { name: '🥇 Champion', value: winnerName || 'Unknown', inline: true },
    { name: '🥈 Runner-up', value: runnerUpName || 'Unknown', inline: true },
  ];
  if (thirdPlaceName) fields.push({ name: '🥉 3rd Place', value: thirdPlaceName, inline: true });
  fields.push(
    { name: '🎮 Game', value: `${require('../config/gamePresets').getGameEmojiText(tournament.game)} ${tournament.game.displayName}`, inline: true },
    { name: '🔄 Format', value: tournament.settings.format.replace('_', ' '), inline: true }
  );
  embed.addFields(fields);
  embed.setFooter({ text: 'Congratulations to all participants!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`viewResults:${tournament.id}`)
      .setLabel('Show Complete Results')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Success)
  );
  const bracketUrl = getBracketUrl(tournament);
  if (bracketUrl) {
    row.addComponents(
      new ButtonBuilder().setLabel('View Bracket').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(bracketUrl)
    );
  }

  try {
    const channel = await client.channels.fetch(tournament.channelId);
    await channel.send({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error('Error posting tournament results:', error);
  }
}

/** Re-render the original announcement message as completed. */
async function updateTournamentAnnouncement(client, tournament) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(tournament.messageId);
    if (!message) return;

    tournament.status = 'completed';
    const embed = await createTournamentEmbed(tournament);
    const buttons = createTournamentButtons(tournament);
    await message.edit({ embeds: [embed], components: buttons });
  } catch (error) {
    console.error('Error updating tournament announcement:', error);
  }
}

/**
 * Auto-cleanup (Pro): reclaim match rooms 30s after completion.
 * Modes: 'delete' (plain), 'archive' (transcript + delete — history saved to
 * the dashboard and #match-logs), 'category' (legacy move — does NOT free
 * Discord's 500-channel cap).
 */
async function triggerAutoCleanup(guild, tournament) {
  const settings = await getServerSettings(guild.id);
  if (!settings.autoCleanup) return;

  const channelIds = collectTournamentChannels(tournament.bracket);
  if (channelIds.length === 0) return;

  const mode = settings.autoCleanupMode || 'delete';
  console.log(`Auto-cleanup (${mode}): ${channelIds.length} channels for "${tournament.title}" in 30s`);

  setTimeout(async () => {
    try {
      // Re-fetch the current bracket — an admin correction/report in the last
      // 30s must not be overwritten by the snapshot captured at completion.
      const fresh = await getTournament(tournament.id);
      if (!fresh?.bracket) return;

      if (mode === 'archive') {
        const { archiveTournamentChannels } = require('./transcriptService');
        const res = await archiveTournamentChannels(guild, fresh);
        await updateTournament(tournament.id, { bracket: fresh.bracket });
        console.log(`Auto-cleanup complete: archived ${res.archived} rooms (${res.messages} messages) for "${tournament.title}"`);
        return;
      }

      const count = await bulkCleanupChannels(guild, channelIds, mode);
      if (mode !== 'category') {
        clearBracketChannelIds(fresh.bracket);
        await updateTournament(tournament.id, { bracket: fresh.bracket });
      }
      console.log(`Auto-cleanup complete: ${count}/${channelIds.length} channels processed for "${tournament.title}"`);
    } catch (error) {
      console.error('Auto-cleanup error:', error);
    }
  }, 30000);
}

module.exports = {
  startTournamentFlow,
  buildStartEmbed,
  applyMatchReport,
  correctMatchFlow,
  disqualifyFlow,
  cancelFlow,
  editTournamentFlow,
  removeEntrantFlow,
  createRoomsFlow,
  announceTournamentComplete,
  updateTournamentAnnouncement,
  triggerAutoCleanup,
  FORMAT_NAMES,
  // Battle Royale
  applyBRGameReport,
  applyBRGameCorrection,
  applyBRSetKills,
  getBRStage,
  brStageKey,
  buildBRBoard,
  refreshBRBoard,
  // Capacity + rolling auto-archive (docs/CHANNEL-CAPACITY-PLAN.md)
  scheduleMatchArchive,
  getAutoArchiveMinutes,
};
