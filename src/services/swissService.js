const { v4: uuidv4 } = require('uuid');

/**
 * Generate initial Swiss bracket
 * @param {Array} participants - Array of participant/team objects
 * @param {Object} settings - Tournament settings
 * @returns {Object} Swiss bracket structure
 */
function generateBracket(participants, settings) {
  const count = participants.length;

  if (count < 2) {
    throw new Error('Need at least 2 participants');
  }

  // Calculate number of rounds (can be overridden in settings)
  const defaultRounds = Math.ceil(Math.log2(count));
  const totalRounds = settings.swissRounds || defaultRounds;

  // Initialize standings for all participants
  const standings = participants.map(p => ({
    participant: p,
    wins: 0,
    losses: 0,
    points: 0,
    buchholz: 0,
    opponents: [],
  }));

  // Shuffle participants for random initial seeding (unless already seeded)
  const seeded = participants.filter(p => p.seed != null);
  if (seeded.length === 0) {
    shuffleArray(standings);
  } else {
    // Sort by seed if seeding exists
    standings.sort((a, b) => {
      if (a.participant.seed && b.participant.seed) return a.participant.seed - b.participant.seed;
      if (a.participant.seed) return -1;
      if (b.participant.seed) return 1;
      return 0;
    });
  }

  // Generate first round
  const round1 = generateRound(standings, 1);

  return {
    type: 'swiss',
    totalRounds,
    currentRound: 1,
    rounds: [round1],
    standings,
  };
}

/**
 * Generate pairings for a round based on current standings
 * @param {Array} standings - Current standings array
 * @param {number} roundNumber - Round number to generate
 * @returns {Object} Round object with matches
 */
function generateRound(standings, roundNumber) {
  // Sort standings by points (desc), then by buchholz (desc)
  const sorted = [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.buchholz - a.buchholz;
  });

  const matches = [];
  const paired = new Set();
  let matchNumber = 1;

  // Calculate starting match number based on previous rounds
  // This ensures unique match numbers across all rounds
  if (roundNumber > 1) {
    // Each round has ceil(participants/2) matches
    matchNumber = (roundNumber - 1) * Math.ceil(standings.length / 2) + 1;
  }

  // Swiss pairing: pair players with similar records who haven't played each other
  for (let i = 0; i < sorted.length; i++) {
    if (paired.has(sorted[i].participant.id)) continue;

    const player = sorted[i];
    let opponent = null;

    // Find the highest-ranked unpaired opponent they haven't played
    for (let j = i + 1; j < sorted.length; j++) {
      if (paired.has(sorted[j].participant.id)) continue;

      const candidate = sorted[j];
      const alreadyPlayed = player.opponents.includes(candidate.participant.id);

      if (!alreadyPlayed) {
        opponent = candidate;
        break;
      }
    }

    // If no valid opponent found (all remaining have been played), pair anyway
    if (!opponent) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!paired.has(sorted[j].participant.id)) {
          opponent = sorted[j];
          break;
        }
      }
    }

    if (opponent) {
      // Create the match
      const match = {
        id: uuidv4(),
        matchNumber: matchNumber++,
        roundNumber,
        roundName: `Swiss Round ${roundNumber}`,
        participant1: player.participant,
        participant2: opponent.participant,
        winner: null,
        loser: null,
        score: null,
        channelId: null,
      };

      matches.push(match);
      paired.add(player.participant.id);
      paired.add(opponent.participant.id);
    } else {
      // Odd player gets a bye (automatic win)
      const match = {
        id: uuidv4(),
        matchNumber: matchNumber++,
        roundNumber,
        roundName: `Swiss Round ${roundNumber}`,
        participant1: player.participant,
        participant2: null,
        winner: player.participant,
        loser: null,
        score: null,
        isBye: true,
        channelId: null,
      };

      // Award the bye
      player.wins++;
      player.points++;

      matches.push(match);
      paired.add(player.participant.id);
    }
  }

  return {
    roundNumber,
    status: 'active',
    matches,
  };
}

/**
 * Generate the next round after current round is complete
 * @param {Object} bracket - Swiss bracket
 * @returns {Object} Updated bracket with new round
 */
function generateNextRound(bracket) {
  if (!isRoundComplete(bracket)) {
    throw new Error('Current round is not complete');
  }

  if (bracket.currentRound >= bracket.totalRounds) {
    throw new Error('All rounds have been completed');
  }

  // Mark current round as complete
  bracket.rounds[bracket.currentRound - 1].status = 'complete';

  // Generate next round
  const nextRoundNumber = bracket.currentRound + 1;
  const nextRound = generateRound(bracket.standings, nextRoundNumber);

  bracket.rounds.push(nextRound);
  bracket.currentRound = nextRoundNumber;

  return bracket;
}

/**
 * Report match result and update standings
 * @param {Object} bracket - Swiss bracket
 * @param {string} matchId - Match ID
 * @param {string} winnerId - Winner's participant ID
 * @param {string} [score] - Optional score string
 * @returns {Object} Updated bracket
 */
function advanceWinner(bracket, matchId, winnerId, score) {
  // Find the match
  let match = null;
  for (const round of bracket.rounds) {
    match = round.matches.find(m => m.id === matchId);
    if (match) break;
  }

  if (!match) {
    throw new Error('Match not found');
  }

  if (match.winner) {
    throw new Error('Match already has a winner');
  }

  if (match.isBye) {
    throw new Error('Cannot report bye match');
  }

  // Validate winner is in the match
  const p1Id = match.participant1?.id;
  const p2Id = match.participant2?.id;
  if (winnerId !== p1Id && winnerId !== p2Id) {
    throw new Error('Winner is not a participant in this match');
  }

  // Set winner and loser
  const isP1Winner = winnerId === p1Id;
  match.winner = isP1Winner ? match.participant1 : match.participant2;
  match.loser = isP1Winner ? match.participant2 : match.participant1;
  if (score) match.score = score;

  // Update standings
  const winnerStanding = bracket.standings.find(s => s.participant.id === match.winner.id);
  const loserStanding = bracket.standings.find(s => s.participant.id === match.loser.id);

  if (winnerStanding) {
    winnerStanding.wins++;
    winnerStanding.points++;
    winnerStanding.opponents.push(match.loser.id);
  }

  if (loserStanding) {
    loserStanding.losses++;
    loserStanding.opponents.push(match.winner.id);
  }

  // Recalculate Buchholz scores for all participants
  calculateBuchholz(bracket);

  return bracket;
}

/**
 * Calculate Buchholz tiebreaker scores
 * Buchholz = sum of all opponents' points
 * @param {Object} bracket - Swiss bracket
 */
function calculateBuchholz(bracket) {
  for (const standing of bracket.standings) {
    let buchholz = 0;
    for (const oppId of standing.opponents) {
      const oppStanding = bracket.standings.find(s => s.participant.id === oppId);
      if (oppStanding) {
        buchholz += oppStanding.points;
      }
    }
    standing.buchholz = buchholz;
  }
}

/**
 * Get all active (playable) matches
 * @param {Object} bracket - Swiss bracket
 * @returns {Array} Active matches
 */
function getActiveMatches(bracket) {
  const currentRound = bracket.rounds[bracket.currentRound - 1];
  if (!currentRound) return [];

  return currentRound.matches.filter(m =>
    !m.winner && !m.isBye && m.participant1 && m.participant2
  );
}

/**
 * Check if current round is complete
 * @param {Object} bracket - Swiss bracket
 * @returns {boolean}
 */
function isRoundComplete(bracket) {
  const currentRound = bracket.rounds[bracket.currentRound - 1];
  if (!currentRound) return false;

  return currentRound.matches.every(m => m.winner !== null);
}

/**
 * Check if tournament is complete (all rounds played)
 * @param {Object} bracket - Swiss bracket
 * @returns {boolean}
 */
function isComplete(bracket) {
  return bracket.currentRound === bracket.totalRounds && isRoundComplete(bracket);
}

/**
 * Get final results with rankings
 * @param {Object} bracket - Swiss bracket
 * @returns {Object|null} Results object or null if not complete
 */
function getResults(bracket) {
  if (!isComplete(bracket)) return null;

  // Sort by points desc, then buchholz desc
  const sorted = [...bracket.standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.buchholz - a.buchholz;
  });

  return {
    winner: sorted[0]?.participant || null,
    runnerUp: sorted[1]?.participant || null,
    thirdPlace: sorted[2]?.participant || null,
    standings: sorted,
  };
}

/**
 * Get current standings sorted by rank
 * @param {Object} bracket - Swiss bracket
 * @returns {Array} Sorted standings
 */
function getStandings(bracket) {
  return [...bracket.standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.buchholz - a.buchholz;
  });
}

/**
 * Find a match by ID across all rounds
 * @param {Object} bracket - Swiss bracket
 * @param {string} matchId - Match ID
 * @returns {Object|null} Match or null
 */
function findMatch(bracket, matchId) {
  for (const round of bracket.rounds) {
    const match = round.matches.find(m => m.id === matchId);
    if (match) return match;
  }
  return null;
}

/**
 * Fisher-Yates shuffle
 * @param {Array} array - Array to shuffle
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

module.exports = {
  generateBracket,
  generateNextRound,
  advanceWinner,
  getActiveMatches,
  isComplete,
  isRoundComplete,
  getResults,
  getStandings,
  findMatch,
};
