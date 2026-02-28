// Tournament API Endpoints
// REST API for tournament data (Business tier)

const express = require('express');
const { getTournament, getTournamentsByGuild } = require('../../services/tournamentService');

const router = express.Router();

/**
 * GET /tournaments
 * List all tournaments for the authenticated guild
 */
router.get('/', (req, res) => {
  const tournaments = getTournamentsByGuild(req.guildId);

  const formatted = tournaments.map(t => formatTournamentSummary(t));

  res.json({
    tournaments: formatted,
    count: formatted.length,
  });
});

/**
 * GET /tournaments/:id
 * Get tournament details
 */
router.get('/:id', (req, res) => {
  const tournament = getTournament(req.params.id);

  if (!tournament) {
    return res.status(404).json({
      error: 'Tournament not found',
      message: `No tournament with ID ${req.params.id}`,
    });
  }

  // Verify guild ownership
  if (tournament.guildId !== req.guildId) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This tournament belongs to a different server',
    });
  }

  res.json(formatTournamentDetail(tournament));
});

/**
 * GET /tournaments/:id/bracket
 * Get full bracket state
 */
router.get('/:id/bracket', (req, res) => {
  const tournament = getTournament(req.params.id);

  if (!tournament) {
    return res.status(404).json({
      error: 'Tournament not found',
      message: `No tournament with ID ${req.params.id}`,
    });
  }

  if (tournament.guildId !== req.guildId) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This tournament belongs to a different server',
    });
  }

  if (!tournament.bracket) {
    return res.status(404).json({
      error: 'Bracket not available',
      message: 'Tournament has not started yet',
    });
  }

  res.json({
    tournamentId: tournament.id,
    format: tournament.settings.format,
    bracket: formatBracket(tournament.bracket, tournament.settings.format),
  });
});

/**
 * GET /tournaments/:id/matches
 * Get all matches with results
 */
router.get('/:id/matches', (req, res) => {
  const tournament = getTournament(req.params.id);

  if (!tournament) {
    return res.status(404).json({
      error: 'Tournament not found',
      message: `No tournament with ID ${req.params.id}`,
    });
  }

  if (tournament.guildId !== req.guildId) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This tournament belongs to a different server',
    });
  }

  if (!tournament.bracket) {
    return res.status(404).json({
      error: 'Matches not available',
      message: 'Tournament has not started yet',
    });
  }

  const matches = extractMatches(tournament.bracket, tournament.settings.format);

  res.json({
    tournamentId: tournament.id,
    matches,
    count: matches.length,
  });
});

/**
 * GET /tournaments/:id/participants
 * Get all participants/teams
 */
router.get('/:id/participants', (req, res) => {
  const tournament = getTournament(req.params.id);

  if (!tournament) {
    return res.status(404).json({
      error: 'Tournament not found',
      message: `No tournament with ID ${req.params.id}`,
    });
  }

  if (tournament.guildId !== req.guildId) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This tournament belongs to a different server',
    });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const participants = isSolo ? tournament.participants : tournament.teams;

  res.json({
    tournamentId: tournament.id,
    type: isSolo ? 'players' : 'teams',
    participants: participants.map(p => formatParticipant(p, isSolo)),
    count: participants.length,
  });
});

/**
 * GET /tournaments/:id/standings
 * Get final standings (completed tournaments only)
 */
router.get('/:id/standings', (req, res) => {
  const tournament = getTournament(req.params.id);

  if (!tournament) {
    return res.status(404).json({
      error: 'Tournament not found',
      message: `No tournament with ID ${req.params.id}`,
    });
  }

  if (tournament.guildId !== req.guildId) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This tournament belongs to a different server',
    });
  }

  if (tournament.status !== 'completed') {
    return res.status(400).json({
      error: 'Standings not available',
      message: 'Tournament is not yet completed',
    });
  }

  const standings = tournament.standings || [];

  res.json({
    tournamentId: tournament.id,
    standings: standings.map((s, i) => ({
      place: i + 1,
      participant: formatParticipant(s, tournament.settings.teamSize === 1),
    })),
  });
});

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatTournamentSummary(t) {
  const isSolo = t.settings.teamSize === 1;
  return {
    id: t.id,
    title: t.title,
    game: t.game?.displayName || 'Custom',
    status: t.status,
    format: t.settings.format,
    teamSize: t.settings.teamSize,
    participantCount: isSolo ? t.participants?.length || 0 : t.teams?.length || 0,
    maxParticipants: t.settings.maxParticipants,
    startTime: t.startTime,
    createdAt: t.createdAt,
  };
}

function formatTournamentDetail(t) {
  const isSolo = t.settings.teamSize === 1;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    game: t.game?.displayName || 'Custom',
    gamePreset: t.gamePreset,
    status: t.status,
    format: t.settings.format,
    teamSize: t.settings.teamSize,
    startTime: t.startTime,
    participantCount: isSolo ? t.participants?.length || 0 : t.teams?.length || 0,
    maxParticipants: t.settings.maxParticipants,
    settings: {
      bestOf: t.settings.bestOf,
      checkinRequired: t.settings.checkinRequired,
      checkinWindow: t.settings.checkinWindow,
      seedingEnabled: t.settings.seedingEnabled,
      captainMode: t.settings.captainMode,
    },
    createdAt: t.createdAt,
    createdBy: t.createdBy,
  };
}

function formatParticipant(p, isSolo) {
  if (isSolo) {
    return {
      id: p.odId || p.odId,
      odId: p.odId,
      odName: p.odName,
      displayName: p.displayName,
      seed: p.seed,
      checkedIn: p.checkedIn,
      gameNick: p.gameNick,
    };
  }

  return {
    id: p.id,
    name: p.name,
    captain: p.captain ? {
      odId: p.captain.odId,
      odName: p.captain.odName,
    } : null,
    members: p.members?.map(m => ({
      odId: m.odId,
      odName: m.odName,
      displayName: m.displayName,
      pending: m.pending,
    })) || [],
    seed: p.seed,
    checkedIn: p.checkedIn,
  };
}

function formatBracket(bracket, format) {
  // Return bracket structure based on format
  switch (format) {
    case 'single_elimination':
      return {
        rounds: bracket.rounds?.map(formatRound) || [],
        totalRounds: bracket.totalRounds,
      };

    case 'double_elimination':
      return {
        winnersRounds: bracket.winnersRounds?.map(formatRound) || [],
        losersRounds: bracket.losersRounds?.map(formatRound) || [],
        grandFinals: bracket.grandFinalsRounds?.map(formatRound) || [],
      };

    case 'swiss':
      return {
        rounds: bracket.rounds?.map(formatRound) || [],
        totalRounds: bracket.totalRounds,
        standings: bracket.standings || [],
      };

    case 'round_robin':
      return {
        rounds: bracket.rounds?.map(formatRound) || [],
        totalRounds: bracket.totalRounds,
        standings: bracket.standings || [],
      };

    case 'battle_royale':
      return {
        groups: bracket.groups?.map(g => ({
          id: g.id,
          name: g.name,
          teams: g.teams,
          games: g.games,
          standings: g.standings,
        })) || [],
        finals: bracket.finals,
        stage: bracket.stage,
      };

    default:
      return bracket;
  }
}

function formatRound(round) {
  return {
    round: round.round,
    name: round.name,
    matches: round.matches?.map(formatMatch) || [],
  };
}

function formatMatch(match) {
  return {
    id: match.id,
    round: match.round,
    participant1: match.participant1 ? {
      id: match.participant1.id || match.participant1.odId,
      name: match.participant1.name || match.participant1.displayName,
      seed: match.participant1.seed,
    } : null,
    participant2: match.participant2 ? {
      id: match.participant2.id || match.participant2.odId,
      name: match.participant2.name || match.participant2.displayName,
      seed: match.participant2.seed,
    } : null,
    winner: match.winner ? {
      id: match.winner.id || match.winner.odId,
      name: match.winner.name || match.winner.displayName,
    } : null,
    score: match.score,
    status: match.status || (match.winner ? 'completed' : 'pending'),
    completedAt: match.completedAt,
  };
}

function extractMatches(bracket, format) {
  const matches = [];

  const addMatchesFromRounds = (rounds, bracketName = null) => {
    if (!rounds) return;
    for (const round of rounds) {
      for (const match of round.matches || []) {
        const formatted = formatMatch(match);
        if (bracketName) {
          formatted.bracket = bracketName;
        }
        matches.push(formatted);
      }
    }
  };

  switch (format) {
    case 'single_elimination':
    case 'swiss':
    case 'round_robin':
      addMatchesFromRounds(bracket.rounds);
      break;

    case 'double_elimination':
      addMatchesFromRounds(bracket.winnersRounds, 'winners');
      addMatchesFromRounds(bracket.losersRounds, 'losers');
      addMatchesFromRounds(bracket.grandFinalsRounds, 'grand_finals');
      break;

    case 'battle_royale':
      // BR doesn't have traditional matches
      break;
  }

  return matches;
}

module.exports = router;
