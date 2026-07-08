// Web-admin mutations (Phase 2-3): the state-changing half of the dashboard.
// Every route: session + guild ownership re-check + CSRF + rate limit + audit.
// The heavy lifting is the SAME lifecycleService/creationService flows the
// Discord slash commands and buttons use — the web is just another surface.

const express = require('express');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getClient } = require('./botClient');
const { requireSession, requireGuildAdmin, verifyLiveGuildAdmin, requireCsrf, adminRateLimit } = require('./adminAuth');
const { logWebAction } = require('./audit');
const { getTournament } = require('../services/tournamentService');
const { GAME_PRESETS, getPresetKeys, getFeaturedPresetKeys, getNickFields, getNickSummary } = require('../config/gamePresets');
const { getServiceForBracket, findMatchByNumber, normalizeSeriesScore, listAllMatches, validSeriesScores } = require('../utils/matchUtils');
const {
  startTournamentFlow,
  applyMatchReport,
  correctMatchFlow,
  disqualifyFlow,
  cancelFlow,
  editTournamentFlow,
  removeEntrantFlow,
  createRoomsFlow,
} = require('../services/lifecycleService');
const { runCreationChecks, resolveAnnouncementChannel, createAndAnnounce } = require('../services/creationService');

const router = express.Router();

// All mutation routes share the same guard stack.
const mutate = [requireSession, requireCsrf, adminRateLimit];

function getGuildOr503(guildId, res) {
  const client = getClient();
  const guild = client?.guilds.cache.get(guildId);
  if (!guild) {
    res.status(503).json({ error: 'The bot is not connected to this server right now.' });
    return null;
  }
  return guild;
}

/** Load a tournament and verify the session manages its guild. */
async function loadOwned(req, res) {
  const t = await getTournament(req.params.id).catch(() => null);
  if (!t) {
    res.status(404).json({ error: 'Tournament not found' });
    return null;
  }
  if (!req.session.guilds.some(g => g.id === t.guildId)) {
    res.status(403).json({ error: 'You do not manage this server' });
    return null;
  }
  return t;
}

/**
 * loadOwned + LIVE re-authorization against Discord (session guild lists are
 * a login-time snapshot; mutations must not honor a since-revoked admin).
 */
async function loadOwnedForMutation(req, res) {
  const t = await loadOwned(req, res);
  if (!t) return null;
  if (!(await verifyLiveGuildAdmin(t.guildId, req.session.uid))) {
    res.status(403).json({ error: 'Your admin rights on this server could not be confirmed — sign out and back in.' });
    return null;
  }
  return t;
}

/** Live re-authorization for guild-scoped mutations (create). */
async function requireLiveGuildAdmin(req, res, next) {
  if (!(await verifyLiveGuildAdmin(req.params.guildId, req.session.uid))) {
    return res.status(403).json({ error: 'Your admin rights on this server could not be confirmed — sign out and back in.' });
  }
  next();
}

function audit(req, tournament, action, details = {}) {
  return logWebAction({
    userId: req.session.uid,
    username: req.session.username,
    guildId: tournament?.guildId || req.params.guildId,
    tournamentId: tournament?.id || null,
    action,
    details,
  });
}

const entrantName = (t, e) => (t.settings.teamSize === 1 ? e.username : e.name);

// ════════════════════════════════════════════════════════════════════════════
// Read endpoints backing the create/manage UI
// ════════════════════════════════════════════════════════════════════════════

// Game presets + formats for the create form
router.get('/admin/api/meta', requireSession, (req, res) => {
  const featured = new Set(getFeaturedPresetKeys());
  const games = getPresetKeys().map(key => {
    const p = GAME_PRESETS[key];
    return {
      key,
      name: p.displayName,
      shortName: p.shortName,
      category: p.category || null,
      logo: p.logo || null,
      featured: featured.has(key),
      defaultTeamSize: p.defaultTeamSize || 1,
      teamSizeOptions: p.teamSizeOptions || [1],
      defaultFormat: p.defaultFormat || 'single_elimination',
      formatOptions: p.formatOptions || ['single_elimination', 'double_elimination', 'swiss', 'round_robin'],
      defaultBestOf: p.defaultBestOf || 1,
      bestOfOptions: p.bestOfOptions || [1, 3, 5],
    };
  });
  games.push({
    key: 'custom', name: 'Custom game', shortName: 'CUST', category: null, logo: null, featured: true,
    defaultTeamSize: 1, teamSizeOptions: [1, 2, 3, 4, 5],
    defaultFormat: 'single_elimination',
    formatOptions: ['single_elimination', 'double_elimination', 'swiss', 'round_robin'],
    defaultBestOf: 1, bestOfOptions: [1, 3, 5, 7],
  });
  res.json({
    games,
    formats: {
      single_elimination: 'Single Elimination',
      double_elimination: 'Double Elimination',
      swiss: 'Swiss',
      round_robin: 'Round Robin',
    },
  });
});

// Text channels the bot can post in (for the per-tournament channel picker)
router.get('/admin/api/guilds/:guildId/channels', requireSession, requireGuildAdmin, (req, res) => {
  const guild = getGuildOr503(req.params.guildId, res);
  if (!guild) return;

  const me = guild.members.me;
  const channels = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildText)
    .filter(ch => {
      const perms = me ? ch.permissionsFor(me) : null;
      return perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages) && perms?.has(PermissionFlagsBits.EmbedLinks);
    })
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(ch => ({ id: ch.id, name: ch.name, category: ch.parent?.name || null }));

  res.json({ channels });
});

// Everything the Manage tab needs: entrants + matches with REAL ids
// (the iframe bracket keeps using the hashed public payload for display).
router.get('/admin/api/tournaments/:id/manage', requireSession, async (req, res) => {
  const t = await loadOwned(req, res);
  if (!t) return;

  const isSolo = t.settings.teamSize === 1;
  // The game's signup fields (e.g. GOALS Username + private User ID). Private
  // values are hidden from the public list, so this admin-only view is where
  // admins retrieve them. Resolve each entrant's values into label/value pairs.
  const nickFields = t.settings.requireGameNick ? getNickFields(t.game) : [];
  const valueOf = (entity, f) =>
    (entity?.gameFields && entity.gameFields[f.key]) ||
    (f.key === 'gameNick' ? (entity?.gameNick || null) : null);
  const entrantFields = (e) => nickFields.map(f => {
    const value = isSolo
      ? valueOf(e, f)
      : ((e.members || []).map(m => valueOf(m, f)).filter(Boolean).join(', ') || null);
    return value ? { label: f.label, value, private: f.private } : null;
  }).filter(Boolean);

  const entrants = (isSolo ? t.participants : t.teams).map(e => ({
    id: e.id,
    name: entrantName(t, e),
    seed: e.seed ?? null,
    checkedIn: !!e.checkedIn,
    disqualified: !!e.disqualified,
    fake: String(e.id).startsWith('fake_'),
    fields: entrantFields(e),
  }));

  const toRef = p => (p ? { id: p.id, name: isSolo ? p.username : p.name } : null);
  const matches = listAllMatches(t.bracket).map(({ match, section, round, roundName }) => ({
    matchNumber: match.matchNumber ?? null,
    section,
    round,
    roundName,
    participant1: toRef(match.participant1),
    participant2: toRef(match.participant2),
    winnerId: match.winner?.id ?? null,
    score: match.score ?? null,
    isBye: !!match.isBye,
    isWalkover: !!match.isWalkover,
    isDQ: !!match.isDQ,
    hasRoom: !!match.channelId,
  }));

  res.set('Cache-Control', 'no-store');
  res.json({
    id: t.id,
    title: t.title,
    status: t.status,
    format: t.settings.format,
    isSolo,
    teamSize: t.settings.teamSize,
    bestOf: t.settings.bestOf || 1,
    validScores: (t.settings.bestOf || 1) > 1 ? validSeriesScores(t.settings.bestOf) : null,
    maxParticipants: t.settings.maxParticipants,
    startTime: t.startTime,
    description: t.description || '',
    nickSummary: t.settings.requireGameNick ? getNickSummary(t.game) : null,
    entrants,
    matches,
    counts: { entrants: entrants.length, pending: matches.filter(m => !m.winnerId && m.participant1 && m.participant2).length },
    can: {
      edit: ['registration', 'checkin'].includes(t.status),
      start: ['registration', 'checkin'].includes(t.status) && entrants.length >= 2,
      cancel: ['registration', 'checkin', 'active'].includes(t.status),
      removeEntrant: ['registration', 'checkin'].includes(t.status),
      report: t.status === 'active' && t.settings.format !== 'battle_royale',
      correct: !!t.bracket && t.settings.format !== 'battle_royale',
      disqualify: t.status === 'active' && t.settings.format !== 'battle_royale',
      createRooms: t.status === 'active',
    },
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Mutations
// ════════════════════════════════════════════════════════════════════════════

// Create a tournament (simple-mode parity + format/team-size/best-of/channel)
router.post('/admin/api/guilds/:guildId/tournaments', ...mutate, requireGuildAdmin, requireLiveGuildAdmin, async (req, res) => {
  const guild = getGuildOr503(req.params.guildId, res);
  if (!guild) return;

  const b = req.body || {};
  const gamePreset = String(b.gamePreset || '');
  const preset = GAME_PRESETS[gamePreset];
  if (!preset && gamePreset !== 'custom') return res.status(400).json({ error: 'Unknown game preset' });

  const title = String(b.title || '').trim();
  if (!title || title.length > 100) return res.status(400).json({ error: 'Title must be 1-100 characters' });

  const gameName = String(b.gameName || '').trim();
  if (gamePreset === 'custom' && !gameName) return res.status(400).json({ error: 'Custom games need a game name' });

  // new Date(null) is the epoch, so reject missing values explicitly
  if (!b.startTime) return res.status(400).json({ error: 'Pick a start time' });
  const startTime = new Date(b.startTime);
  if (isNaN(startTime.getTime())) return res.status(400).json({ error: 'Invalid start time' });

  const maxParticipants = parseInt(b.maxParticipants, 10);
  if (isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 512) {
    return res.status(400).json({ error: 'Max participants must be between 2 and 512' });
  }

  const format = b.format || preset?.defaultFormat || 'single_elimination';
  if (!['single_elimination', 'double_elimination', 'swiss', 'round_robin'].includes(format)) {
    return res.status(400).json({ error: 'Unsupported format' });
  }

  const teamSize = parseInt(b.teamSize ?? preset?.defaultTeamSize ?? 1, 10);
  if (isNaN(teamSize) || teamSize < 1 || teamSize > 10) return res.status(400).json({ error: 'Team size must be 1-10' });

  const bestOf = parseInt(b.bestOf ?? preset?.defaultBestOf ?? 1, 10);
  if (isNaN(bestOf) || bestOf < 1 || bestOf > 15 || bestOf % 2 === 0) {
    return res.status(400).json({ error: 'Best of must be an odd number between 1 and 15' });
  }

  const publicBracket = !!b.publicBracket;

  // Subscription / entitlement checks — same as Discord creation
  const checks = await runCreationChecks(guild.id, {
    maxParticipants,
    features: publicBracket ? ['public_bracket'] : [],
  });
  if (!checks.ok) {
    const messages = {
      concurrent: checks.check?.reason || 'Concurrent tournament limit reached for this server\'s plan.',
      tournament_limit: checks.check?.reason || 'Monthly tournament limit reached for this server\'s plan.',
      participants: checks.check?.reason || 'Participant cap exceeded for this server\'s plan.',
      feature: `The "${checks.feature}" feature needs a higher plan.`,
    };
    return res.status(403).json({ error: messages[checks.type] || 'Not allowed on the current plan.' });
  }

  // Per-tournament channel override → per-game/server default
  const resolved = await resolveAnnouncementChannel(guild, gamePreset === 'custom' ? null : gamePreset, b.channelId || null, null);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  if (!resolved.channel) return res.status(400).json({ error: 'No announcement channel available — pick a channel.' });

  try {
    const { tournament } = await createAndAnnounce({
      client: getClient(),
      guildId: guild.id,
      targetChannel: resolved.channel,
      boostToUse: checks.boostToUse,
      data: {
        title,
        description: String(b.description || '').trim().slice(0, 1000) || undefined,
        gamePreset,
        gameDisplayName: gamePreset === 'custom' ? gameName : preset.displayName,
        gameShortName: gamePreset === 'custom' ? gameName.substring(0, 4).toUpperCase() : preset.shortName,
        maxParticipants,
        teamSize,
        format,
        bestOf,
        startTime,
        publicBracket,
        setupMode: 'web',
        createdBy: req.session.uid,
      },
    });

    await audit(req, tournament, 'create', { title, gamePreset, format, teamSize, bestOf, maxParticipants, channelId: resolved.channel.id });
    res.status(201).json({ ok: true, id: tournament.id, title: tournament.title, channel: { id: resolved.channel.id, name: resolved.channel.name } });
  } catch (err) {
    console.error('[web-admin] create error:', err);
    res.status(500).json({ error: 'Failed to create the tournament' });
  }
});

// Edit (registration/checkin only)
router.patch('/admin/api/tournaments/:id', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  try {
    const { updated, changes } = await editTournamentFlow({
      client: getClient(),
      tournament: t,
      fields: {
        title: req.body?.title,
        description: req.body?.description,
        startTime: req.body?.startTime,
        maxParticipants: req.body?.maxParticipants,
        bestOf: req.body?.bestOf,
      },
    });
    await audit(req, t, 'edit', { changes });
    res.json({ ok: true, changes, title: updated.title });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// Start
router.post('/admin/api/tournaments/:id/start', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  const guild = getGuildOr503(t.guildId, res);
  if (!guild) return;
  try {
    const { summary } = await startTournamentFlow({ client: getClient(), guild, tournamentId: t.id });
    await audit(req, t, 'start', { rooms: summary.roomsCreated, roomsFailed: summary.roomsFailed });
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// Cancel
router.post('/admin/api/tournaments/:id/cancel', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  if (['completed', 'cancelled'].includes(t.status)) {
    return res.status(400).json({ error: `Tournament is already ${t.status}.` });
  }
  try {
    await cancelFlow({ client: getClient(), tournament: t });
    await audit(req, t, 'cancel', {});
    res.json({ ok: true });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// Report a result
router.post('/admin/api/tournaments/:id/report', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  const guild = getGuildOr503(t.guildId, res);
  if (!guild) return;

  if (!t.bracket) return res.status(400).json({ error: 'Tournament has not started yet.' });
  if (t.bracket.type === 'battle_royale') return res.status(400).json({ error: 'Battle Royale results are reported in Discord (/tournament br-report).' });

  const matchNumber = parseInt(req.body?.matchNumber, 10);
  const winnerId = String(req.body?.winnerId || '');
  const match = findMatchByNumber(t.bracket, matchNumber);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (match.winner) return res.status(400).json({ error: 'This match has already been reported. Use Correct instead.' });
  if (winnerId !== match.participant1?.id && winnerId !== match.participant2?.id) {
    return res.status(400).json({ error: 'Selected winner is not in this match.' });
  }

  const scoreResult = normalizeSeriesScore(req.body?.score, t.settings.bestOf || 1);
  if (!scoreResult.ok) return res.status(400).json({ error: scoreResult.error.replace(/\*\*|`/g, '') });

  try {
    const result = await applyMatchReport({
      client: getClient(), guild, tournament: t, match, winnerId, score: scoreResult.score,
    });
    await audit(req, t, 'report', { matchNumber, winnerId, score: scoreResult.score, completed: result.completed });
    res.json({
      ok: true,
      winner: entrantName(t, result.winner),
      loser: result.loser ? entrantName(t, result.loser) : null,
      score: scoreResult.score,
      swissRoundStarted: result.swissRoundStarted,
      newRooms: result.newRooms,
      completed: result.completed,
      champion: result.completed ? entrantName(t, result.results.winner) : null,
    });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// Correct a result
router.post('/admin/api/tournaments/:id/correct', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  if (t.bracket?.type === 'battle_royale') return res.status(400).json({ error: 'Battle Royale results are corrected in Discord.' });
  try {
    const result = await correctMatchFlow({
      client: getClient(),
      tournament: t,
      matchNumber: parseInt(req.body?.matchNumber, 10),
      winnerId: String(req.body?.winnerId || ''),
      score: req.body?.score,
    });
    await audit(req, t, 'correct', { matchNumber: result.match.matchNumber, winnerId: req.body?.winnerId, score: result.normalizedScore });
    res.json({
      ok: true,
      newWinner: result.newWinnerName,
      oldWinner: result.oldWinnerName,
      score: result.normalizedScore,
      wasCompleted: result.wasCompleted,
    });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message.replace(/\*\*|`/g, '') });
  }
});

// Disqualify
router.post('/admin/api/tournaments/:id/disqualify', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  try {
    const result = await disqualifyFlow({
      client: getClient(),
      tournament: t,
      participantId: String(req.body?.participantId || ''),
      reason: String(req.body?.reason || '').slice(0, 200) || null,
    });
    await audit(req, t, 'disqualify', { participantId: req.body?.participantId, reason: req.body?.reason || null });
    res.json({ ok: true, name: result.name, forfeited: result.forfeited, pending: result.pending });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// Remove an entrant (registration/check-in)
router.post('/admin/api/tournaments/:id/remove-entrant', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  try {
    const result = await removeEntrantFlow({
      client: getClient(),
      tournament: t,
      entrantId: String(req.body?.entrantId || ''),
    });
    await audit(req, t, 'remove_entrant', { entrantId: req.body?.entrantId, name: result.name });
    res.json({ ok: true, name: result.name, remaining: result.count });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// Create missing match rooms
router.post('/admin/api/tournaments/:id/create-rooms', ...mutate, async (req, res) => {
  const t = await loadOwnedForMutation(req, res);
  if (!t) return;
  const guild = getGuildOr503(t.guildId, res);
  if (!guild) return;
  try {
    const result = await createRoomsFlow({ guild, tournament: t });
    await audit(req, t, 'create_rooms', result);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[web-admin] ${req.method} ${req.path} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
