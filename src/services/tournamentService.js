const { v4: uuidv4 } = require('uuid');
const { tournaments } = require('../data/store');
const { getPreset } = require('../config/gamePresets');
const { DEFAULT_TOURNAMENT_SETTINGS } = require('../config/defaultSettings');
const { getServerSettings } = require('../data/serverSettings');
const webhooks = require('./webhookService');

function createTournament(data) {
  const id = uuidv4();
  const preset = getPreset(data.gamePreset);

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

      captainMode: data.captainMode ?? getServerSettings(data.guildId).captainMode ?? false,
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

function getTournament(id) {
  return tournaments.get(id) || null;
}

function getTournamentsByGuild(guildId) {
  return Array.from(tournaments.values()).filter(t => t.guildId === guildId);
}

function getActiveTournaments(guildId) {
  return getTournamentsByGuild(guildId).filter(t =>
    ['registration', 'checkin', 'active'].includes(t.status)
  );
}

function updateTournament(id, updates) {
  const tournament = tournaments.get(id);
  if (!tournament) return null;

  Object.assign(tournament, updates);
  tournaments.set(id, tournament);
  return tournament;
}

function deleteTournament(id) {
  return tournaments.delete(id);
}

function addParticipant(tournamentId, user) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { success: false, error: 'Tournament not found' };

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
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantRegistered(tournament, participant);

  return { success: true, tournament };
}

function removeParticipant(tournamentId, userId) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { success: false, error: 'Tournament not found' };

  if (tournament.status !== 'registration') {
    return { success: false, error: 'Cannot withdraw after registration closes' };
  }

  const index = tournament.participants.findIndex(p => p.id === userId);
  if (index === -1) {
    return { success: false, error: "You're not signed up" };
  }

  const participant = tournament.participants[index];
  tournament.participants.splice(index, 1);
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantWithdrawn(tournament, participant);

  return { success: true, tournament };
}

function addTeam(tournamentId, teamData) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { success: false, error: 'Tournament not found' };

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
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantRegistered(tournament, team);

  return { success: true, tournament, team };
}

function removeTeam(tournamentId, captainId) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return { success: false, error: 'Tournament not found' };

  if (tournament.status !== 'registration') {
    return { success: false, error: 'Cannot withdraw after registration closes' };
  }

  const index = tournament.teams.findIndex(t => t.captain.id === captainId);
  if (index === -1) {
    return { success: false, error: 'You are not a team captain in this tournament' };
  }

  const team = tournament.teams[index];
  tournament.teams.splice(index, 1);
  tournaments.set(tournamentId, tournament);

  // Trigger webhook
  webhooks.onParticipantWithdrawn(tournament, team);

  return { success: true, tournament, team };
}

function findTournamentByMessage(messageId) {
  for (const tournament of tournaments.values()) {
    if (tournament.messageId === messageId || tournament.participantListMessageId === messageId) {
      return tournament;
    }
  }
  return null;
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
