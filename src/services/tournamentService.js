const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { tournaments } = require('../data/store');
const { rowToTournament } = require('../data/store');
const { getPreset } = require('../config/gamePresets');
const { DEFAULT_TOURNAMENT_SETTINGS } = require('../config/defaultSettings');
const { getServerSettings } = require('../data/serverSettings');
const webhooks = require('./webhookService');

// ============================================================================
// Helpers: camelCase JS object → snake_case DB row
// ============================================================================

function tournamentToRow(t) {
  return {
    id: t.id,
    guild_id: t.guildId,
    channel_id: t.channelId,
    message_id: t.messageId,
    participant_list_message_id: t.participantListMessageId,
    title: t.title,
    description: t.description,
    game: JSON.stringify(t.game),
    settings: JSON.stringify(t.settings),
    setup_mode: t.setupMode,
    start_time: t.startTime,
    status: t.status,
    checkin_open: t.checkinOpen,
    participants: JSON.stringify(t.participants),
    teams: JSON.stringify(t.teams),
    bracket: JSON.stringify(t.bracket),
    created_by: t.createdBy,
    created_at: t.createdAt,
  };
}

// ============================================================================
// Public API (all async, database-backed)
// ============================================================================

async function createTournament(data) {
  const id = uuidv4();
  const preset = getPreset(data.gamePreset);

  const serverCfg = await getServerSettings(data.guildId);

  const tournament = {
    id,
    guildId: data.guildId,
    channelId: data.channelId,
    messageId: null,
    participantListMessageId: null,

    title: data.title,
    description: data.description || preset?.ruleset || null,

    game: {
      preset: data.gamePreset,
      displayName: data.gameDisplayName || preset?.displayName,
      shortName: data.gameShortName || preset?.shortName,
      icon: preset?.icon || '🎮',
      logo: preset?.logo || null,
    },

    settings: {
      maxParticipants: data.maxParticipants,
      teamSize: data.teamSize || preset?.defaultTeamSize || 1,
      format: data.format || preset?.defaultFormat || DEFAULT_TOURNAMENT_SETTINGS.format,
      bestOf: data.bestOf || preset?.defaultBestOf || 1,

      checkinRequired: data.checkinRequired ?? DEFAULT_TOURNAMENT_SETTINGS.checkinRequired,
      checkinWindow: data.checkinWindow ?? DEFAULT_TOURNAMENT_SETTINGS.checkinWindow,

      seedingEnabled: data.seedingEnabled ?? DEFAULT_TOURNAMENT_SETTINGS.seedingEnabled,

      requireGameNick: data.requireGameNick ?? false,

      mapPool: data.mapPool || preset?.mapPool || null,
      mapPickProcess: data.mapPickProcess || preset?.mapPickProcess || null,

      ruleset: data.ruleset || preset?.ruleset || null,

      gameSettings: data.gameSettings || getDefaultGameSettings(preset),

      requiredRoles: data.requiredRoles || [],

      // Battle Royale specific settings
      lobbySize: data.lobbySize ?? 20,
      gamesPerStage: data.gamesPerStage ?? 3,
      advancingPerGroup: data.advancingPerGroup ?? null, // null = auto calculate

      captainMode: data.captainMode ?? serverCfg.captainMode ?? false,
    },

    setupMode: data.setupMode || 'simple',

    startTime: data.startTime,

    status: 'registration',
    checkinOpen: false,

    participants: [],
    teams: [],

    bracket: null,

    createdBy: data.createdBy,
    createdAt: new Date(),
  };

  // Persist to database
  await db('tournaments').insert(tournamentToRow(tournament));

  // Update in-memory cache
  tournaments.set(id, tournament);

  // Trigger webhook
  webhooks.onTournamentCreated(tournament);

  return tournament;
}

function getDefaultGameSettings(preset) {
  if (!preset || !preset.customFields) return {};

  const settings = {};
  for (const [key, field] of Object.entries(preset.customFields)) {
    settings[key] = field.default;
  }
  return settings;
}

async function getTournament(id) {
  // Check memory cache first
  if (tournaments.has(id)) {
    return tournaments.get(id);
  }

  // Fall back to database
  const row = await db('tournaments').where('id', id).first();
  if (!row) return null;

  const tournament = rowToTournament(row);
  tournaments.set(id, tournament);
  return tournament;
}

async function getTournamentsByGuild(guildId) {
  const rows = await db('tournaments').where('guild_id', guildId);
  const results = rows.map(rowToTournament);

  // Refresh cache for these tournaments
  for (const t of results) {
    tournaments.set(t.id, t);
  }

  return results;
}

async function getActiveTournaments(guildId) {
  const rows = await db('tournaments')
    .where('guild_id', guildId)
    .whereIn('status', ['registration', 'checkin', 'active']);

  const results = rows.map(rowToTournament);

  // Refresh cache
  for (const t of results) {
    tournaments.set(t.id, t);
  }

  return results;
}

async function updateTournament(id, updates) {
  // Fetch current state from database to ensure we have the latest
  const row = await db('tournaments').where('id', id).first();
  if (!row) return null;

  const tournament = rowToTournament(row);
  Object.assign(tournament, updates);

  // Build the columns that changed
  const updateRow = {};
  const fieldMap = {
    guildId: 'guild_id',
    channelId: 'channel_id',
    messageId: 'message_id',
    participantListMessageId: 'participant_list_message_id',
    title: 'title',
    description: 'description',
    game: 'game',
    settings: 'settings',
    setupMode: 'setup_mode',
    startTime: 'start_time',
    status: 'status',
    checkinOpen: 'checkin_open',
    participants: 'participants',
    teams: 'teams',
    bracket: 'bracket',
    createdBy: 'created_by',
    createdAt: 'created_at',
  };

  const jsonFields = new Set(['game', 'settings', 'participants', 'teams', 'bracket']);

  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (camel in updates) {
      updateRow[snake] = jsonFields.has(camel)
        ? JSON.stringify(updates[camel])
        : updates[camel];
    }
  }

  if (Object.keys(updateRow).length > 0) {
    await db('tournaments').where('id', id).update(updateRow);
  }

  // Update in-memory cache
  tournaments.set(id, tournament);
  return tournament;
}

async function deleteTournament(id) {
  const deleted = await db('tournaments').where('id', id).del();

  // Remove from in-memory cache
  tournaments.delete(id);

  return deleted > 0;
}

async function addParticipant(tournamentId, user) {
  const row = await db('tournaments').where('id', tournamentId).first();
  if (!row) return { success: false, error: 'Tournament not found' };

  const tournament = rowToTournament(row);

  if (tournament.status !== 'registration') {
    return { success: false, error: 'Registration is closed' };
  }

  if (tournament.participants.length >= tournament.settings.maxParticipants) {
    return { success: false, error: 'Tournament is full' };
  }

  const existing = tournament.participants.find(p => p.id === user.id);
  if (existing) {
    return { success: false, error: "You're already signed up!" };
  }

  const participant = {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    gameNick: user.gameNick || null,
    seed: null,
    checkedIn: false,
    joinedAt: new Date(),
  };

  tournament.participants.push(participant);

  // Persist updated participants to database
  await db('tournaments')
    .where('id', tournamentId)
    .update({ participants: JSON.stringify(tournament.participants) });

  // Update in-memory cache
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantRegistered(tournament, participant);

  return { success: true, tournament };
}

async function removeParticipant(tournamentId, userId) {
  const row = await db('tournaments').where('id', tournamentId).first();
  if (!row) return { success: false, error: 'Tournament not found' };

  const tournament = rowToTournament(row);

  if (tournament.status !== 'registration') {
    return { success: false, error: 'Cannot withdraw after registration closes' };
  }

  const index = tournament.participants.findIndex(p => p.id === userId);
  if (index === -1) {
    return { success: false, error: "You're not signed up" };
  }

  const participant = tournament.participants[index];
  tournament.participants.splice(index, 1);

  // Persist updated participants to database
  await db('tournaments')
    .where('id', tournamentId)
    .update({ participants: JSON.stringify(tournament.participants) });

  // Update in-memory cache
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantWithdrawn(tournament, participant);

  return { success: true, tournament };
}

async function addTeam(tournamentId, teamData) {
  const row = await db('tournaments').where('id', tournamentId).first();
  if (!row) return { success: false, error: 'Tournament not found' };

  const tournament = rowToTournament(row);

  if (tournament.status !== 'registration') {
    return { success: false, error: 'Registration is closed' };
  }

  if (tournament.teams.length >= tournament.settings.maxParticipants) {
    return { success: false, error: 'Tournament is full' };
  }

  // Check for duplicate team name
  const duplicateName = tournament.teams.find(
    t => t.name.toLowerCase() === teamData.name.toLowerCase()
  );
  if (duplicateName) {
    return { success: false, error: 'Team name is already taken' };
  }

  // Check if any member is already on a team
  const newMembers = teamData.members.concat(teamData.captain);

  for (const team of tournament.teams) {
    const existingMembers = team.members.concat(team.captain);

    for (const newMember of newMembers) {
      for (const existing of existingMembers) {
        // Compare by ID for resolved members, by username for pending ones
        if (newMember.id && existing.id && newMember.id === existing.id) {
          return { success: false, error: `A player is already on another team` };
        }
        if (newMember.pending && existing.pending &&
            newMember.username.toLowerCase() === existing.username.toLowerCase()) {
          return { success: false, error: `A player is already on another team` };
        }
      }
    }
  }

  const team = {
    id: uuidv4(),
    name: teamData.name,
    captain: teamData.captain,
    members: teamData.members,
    seed: null,
    checkedIn: false,
    memberCheckins: {},
    joinedAt: new Date(),
  };

  tournament.teams.push(team);

  // Persist updated teams to database
  await db('tournaments')
    .where('id', tournamentId)
    .update({ teams: JSON.stringify(tournament.teams) });

  // Update in-memory cache
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantRegistered(tournament, team);

  return { success: true, tournament, team };
}

async function removeTeam(tournamentId, captainId) {
  const row = await db('tournaments').where('id', tournamentId).first();
  if (!row) return { success: false, error: 'Tournament not found' };

  const tournament = rowToTournament(row);

  if (tournament.status !== 'registration') {
    return { success: false, error: 'Cannot withdraw after registration closes' };
  }

  const index = tournament.teams.findIndex(t => t.captain.id === captainId);
  if (index === -1) {
    return { success: false, error: 'You are not a team captain in this tournament' };
  }

  const team = tournament.teams[index];
  tournament.teams.splice(index, 1);

  // Persist updated teams to database
  await db('tournaments')
    .where('id', tournamentId)
    .update({ teams: JSON.stringify(tournament.teams) });

  // Update in-memory cache
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantWithdrawn(tournament, team);

  return { success: true, tournament, team };
}

async function findTournamentByMessage(messageId) {
  const row = await db('tournaments')
    .where('message_id', messageId)
    .orWhere('participant_list_message_id', messageId)
    .first();

  if (!row) return null;

  const tournament = rowToTournament(row);
  tournaments.set(tournament.id, tournament);
  return tournament;
}

async function resolveTeamMembers(guild, tournament) {
  let resolved = 0;
  let failed = 0;

  for (const team of tournament.teams) {
    for (const member of team.members) {
      if (!member.pending) continue;

      // Try cache first
      let guildMember = guild.members.cache.find(m =>
        m.user.username.toLowerCase() === member.username.toLowerCase() ||
        m.displayName.toLowerCase() === member.username.toLowerCase()
      );

      // Fallback to fetch
      if (!guildMember) {
        try {
          const fetched = await guild.members.fetch({ query: member.username, limit: 5 });
          guildMember = fetched.find(m =>
            m.user.username.toLowerCase() === member.username.toLowerCase() ||
            m.displayName.toLowerCase() === member.username.toLowerCase()
          );
        } catch {
          // Fetch failed
        }
      }

      if (guildMember) {
        member.id = guildMember.id;
        member.username = guildMember.user.username;
        member.displayName = guildMember.displayName;
        delete member.pending;
        resolved++;
      } else {
        failed++;
      }
    }

    // Also update captain reference if it matches a resolved member
    const captainInMembers = team.members.find(m => m.id && m.id === team.captain.id);
    if (captainInMembers) {
      team.captain = { id: captainInMembers.id, username: captainInMembers.username, displayName: captainInMembers.displayName };
    }
  }

  // Persist resolved team data back to database
  await db('tournaments')
    .where('id', tournament.id)
    .update({ teams: JSON.stringify(tournament.teams) });

  // Update in-memory cache
  tournaments.set(tournament.id, tournament);

  return { resolved, failed };
}

module.exports = {
  createTournament,
  getTournament,
  getTournamentsByGuild,
  getActiveTournaments,
  updateTournament,
  deleteTournament,
  addParticipant,
  removeParticipant,
  addTeam,
  removeTeam,
  findTournamentByMessage,
  resolveTeamMembers,
};
