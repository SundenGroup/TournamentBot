const { v4: uuidv4 } = require('uuid');

/**
 * Generate Round Robin bracket
 * Uses the circle method for scheduling
 * @param {Array} participants - Array of participant/team objects
 * @param {Object} settings - Tournament settings
 * @returns {Object} Round Robin bracket structure
 */
function generateBracket(participants, settings) {
  const count = participants.length;

  if (count < 2) {
    throw new Error('Need at least 2 participants');
  }

  // For round robin, add a "bye" slot if odd number of participants
  const playerList = [...participants];
  const hasGhost = count % 2 !== 0;
  if (hasGhost) {
    playerList.push(null); // Ghost player for byes
  }

  const n = playerList.length;
  const totalRounds = n - 1;
  const totalMatches = (count * (count - 1)) / 2;

  // Initialize standings
  const standings = participants.map(p => ({
    participant: p,
    wins: 0,
    losses: 0,
    matchesPlayed: 0,
    headToHead: {},
  }));

  // Generate rounds using circle method
  const rounds = [];
  let matchNumber = 1;

  // Create array of indices (0 to n-1)
  const indices = Array.from({ length: n }, (_, i) => i);

  for (let round = 1; round <= totalRounds; round++) {
    const roundMatches = [];

    // Pair: position 0 vs n-1, 1 vs n-2, etc.
    for (let i = 0; i < n / 2; i++) {
      const idx1 = indices[i];
      const idx2 = indices[n - 1 - i];
      const p1 = playerList[idx1];
      const p2 = playerList[idx2];

      // Skip if either is a ghost (bye)
      if (p1 === null || p2 === null) {
        continue;
      }

      const match = {
        id: uuidv4(),
        matchNumber: matchNumber++,
        roundNumber: round,
        roundName: `Round Robin - Round ${round}`,
        participant1: p1,
        participant2: p2,
        winner: null,
        loser: null,
        score: null,
        channelId: null,
      };

      roundMatches.push(match);
    }

    rounds.push({
      roundNumber: round,
      status: round === 1 ? 'active' : 'pending',
      matches: roundMatches,
    });

    // Rotate: keep index 0 fixed, rotate others clockwise
    // [0, 1, 2, 3, 4, 5] -> [0, 5, 1, 2, 3, 4]
    const last = indices.pop();
    indices.splice(1, 0, last);
  }

  return {
    type: 'round_robin',
    totalRounds,
    totalMatches,
    currentRound: 1,
    rounds,
    standings,
  };
}

/**
 * Report match result and update standings
 * @param {Object} bracket - Round Robin bracket
 * @param {string} matchId - Match ID
 * @param {string} winnerId - Winner's participant ID
 * @param {string} [score] - Optional score string
 * @returns {Object} Updated bracket
 */
function advanceWinner(bracket, matchId, winnerId, score, goals = null) {
  // Find the match
  let match = null;
  let matchRound = null;
  for (const round of bracket.rounds) {
    match = round.matches.find(m => m.id === matchId);
    if (match) {
      matchRound = round;
      break;
    }
  }

  if (!match) {
    throw new Error('Match not found');
  }

  if (match.winner) {
    throw new Error('Match already has a winner');
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
  const games = parseGameScore(score);
  // Optional goal detail ("7-4", winner-first, NOT auto-swapped — a series
  // winner can total fewer goals). Feeds the 3rd/4th tiebreakers.
  const g = parseGoals(goals);
  if (g) match.goals = `${g.winner}-${g.loser}`;

  // Update standings
  const winnerStanding = bracket.standings.find(s => s.participant.id === match.winner.id);
  const loserStanding = bracket.standings.find(s => s.participant.id === match.loser.id);

  if (winnerStanding) {
    winnerStanding.wins++;
    winnerStanding.matchesPlayed++;
    winnerStanding.headToHead[match.loser.id] = 'win';
    winnerStanding.gamesWon = (winnerStanding.gamesWon || 0) + games.winner;
    winnerStanding.gamesLost = (winnerStanding.gamesLost || 0) + games.loser;
    if (g) {
      winnerStanding.goalsFor = (winnerStanding.goalsFor || 0) + g.winner;
      winnerStanding.goalsAgainst = (winnerStanding.goalsAgainst || 0) + g.loser;
    }
  }

  if (loserStanding) {
    loserStanding.losses++;
    loserStanding.matchesPlayed++;
    loserStanding.headToHead[match.winner.id] = 'loss';
    loserStanding.gamesWon = (loserStanding.gamesWon || 0) + games.loser;
    loserStanding.gamesLost = (loserStanding.gamesLost || 0) + games.winner;
    if (g) {
      loserStanding.goalsFor = (loserStanding.goalsFor || 0) + g.loser;
      loserStanding.goalsAgainst = (loserStanding.goalsAgainst || 0) + g.winner;
    }
  }

  // Check if round is complete and advance
  updateRoundStatus(bracket);

  return bracket;
}

/**
 * Update round statuses based on completed matches
 * @param {Object} bracket - Round Robin bracket
 */
function updateRoundStatus(bracket) {
  // Mark every fully-played round complete and find the first one that isn't.
  // Then activate exactly that round and point currentRound at it. The previous
  // version advanced currentRound on every complete round in the loop, which
  // could skip past an incomplete middle round.
  let firstIncomplete = null;
  for (let i = 0; i < bracket.rounds.length; i++) {
    const round = bracket.rounds[i];
    const allComplete = round.matches.every(m => m.winner !== null);
    if (allComplete) {
      round.status = 'complete';
    } else if (firstIncomplete === null) {
      firstIncomplete = i;
    }
  }

  if (firstIncomplete === null) {
    // All rounds done.
    bracket.currentRound = bracket.rounds.length + 1;
  } else {
    bracket.rounds[firstIncomplete].status = 'active';
    bracket.currentRound = bracket.rounds[firstIncomplete].roundNumber;
  }
}

/**
 * Get all active (playable) matches
 * @param {Object} bracket - Round Robin bracket
 * @returns {Array} Active matches
 */
function getActiveMatches(bracket) {
  const matches = [];

  for (const round of bracket.rounds) {
    if (round.status === 'active') {
      for (const match of round.matches) {
        if (!match.winner && match.participant1 && match.participant2) {
          matches.push(match);
        }
      }
    }
  }

  return matches;
}

/**
 * Check if tournament is complete (all matches played)
 * @param {Object} bracket - Round Robin bracket
 * @returns {boolean}
 */
function isComplete(bracket) {
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (match.winner === null) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Get final results with rankings
 * Uses head-to-head for tiebreakers
 * @param {Object} bracket - Round Robin bracket
 * @returns {Object|null} Results object or null if not complete
 */
function getResults(bracket) {
  if (!isComplete(bracket)) return null;

  const sorted = sortStandings(bracket.standings);

  return {
    winner: sorted[0]?.participant || null,
    runnerUp: sorted[1]?.participant || null,
    thirdPlace: sorted[2]?.participant || null,
    standings: sorted,
  };
}

/**
 * Get current standings sorted by rank
 * @param {Object} bracket - Round Robin bracket
 * @returns {Array} Sorted standings
 */
function getStandings(bracket) {
  return sortStandings(bracket.standings);
}

/**
 * Sort standings by wins, then a head-to-head mini-league among tied teams.
 *
 * The previous comparator applied raw pairwise head-to-head directly inside the
 * sort callback. That is non-transitive: with a 3-way cycle (A beat B, B beat C,
 * C beat A) the comparator returns inconsistent orderings and Array.sort produces
 * a garbage result. Instead we group teams by win count and, within each tied
 * group, rank by record *against the other tied teams only* (transitive), then by
 * fewer total losses, then deterministically by id.
 *
 * @param {Array} standings - Standings array
 * @returns {Array} Sorted standings
 */
/** "2-1" → {winner: 2, loser: 1} game tallies (winner-first normalized; 0-0 when absent). */
function parseGameScore(score) {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(String(score || '').trim());
  if (!m) return { winner: 0, loser: 0 };
  const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
  return { winner: Math.max(a, b), loser: Math.min(a, b) };
}

/** "7-4" winner-first goal totals — direction preserved (no max-swap). */
function parseGoals(goals) {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(String(goals || '').trim());
  if (!m) return null;
  return { winner: parseInt(m[1], 10), loser: parseInt(m[2], 10) };
}

function goalDiff(s) {
  return (s.goalsFor || 0) - (s.goalsAgainst || 0);
}

function gameDiff(s) {
  return (s.gamesWon || 0) - (s.gamesLost || 0);
}

function sortStandings(standings) {
  // Group by wins (descending).
  const groups = new Map();
  for (const s of standings) {
    if (!groups.has(s.wins)) groups.set(s.wins, []);
    groups.get(s.wins).push(s);
  }

  const winKeys = [...groups.keys()].sort((a, b) => b - a);
  const result = [];

  for (const winKey of winKeys) {
    const group = groups.get(winKey);

    // Tiebreak order (GOALS ruleset): 1) game record ("4-2 beats 4-4"),
    // 2) head-to-head ONLY between exactly two still-tied players,
    // 3) total goal difference, 4) most goals scored, then stable.
    group.sort((a, b) => {
      const gd = gameDiff(b) - gameDiff(a);
      if (gd !== 0) return gd;
      const goald = goalDiff(b) - goalDiff(a);
      if (goald !== 0) return goald;
      const gf = (b.goalsFor || 0) - (a.goalsFor || 0);
      if (gf !== 0) return gf;
      if (a.losses !== b.losses) return a.losses - b.losses;
      return a.participant.id < b.participant.id ? -1 : a.participant.id > b.participant.id ? 1 : 0;
    });

    // H2H outranks goals but only for EXACT-2 cohorts on game record: walk
    // equal-gameDiff cohorts and let the head-to-head winner lead a pair.
    let i = 0;
    while (i < group.length) {
      let j = i + 1;
      while (j < group.length && gameDiff(group[j]) === gameDiff(group[i])) j++;
      if (j - i === 2) {
        const [a, b] = [group[i], group[i + 1]];
        if (a.headToHead[b.participant.id] === 'loss' && b.headToHead[a.participant.id] === 'win') {
          group[i] = b; group[i + 1] = a;
        }
      }
      i = j;
    }

    result.push(...group);
  }

  return result;
}

/**
 * Find a match by ID across all rounds
 * @param {Object} bracket - Round Robin bracket
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
 * Check if a specific round is complete
 * @param {Object} bracket - Round Robin bracket
 * @param {number} roundNumber - Round number to check
 * @returns {boolean}
 */
function isRoundComplete(bracket, roundNumber = bracket.currentRound) {
  const round = bracket.rounds.find(r => r.roundNumber === roundNumber);
  if (!round) return false;

  return round.matches.every(m => m.winner !== null);
}

/**
 * Correct a wrongly reported result. Round robin has no structural
 * dependencies between matches, so any played match can be corrected.
 */
function correctResult(bracket, matchId, newWinnerId, newScore = null, newGoals = null) {
  const match = findMatch(bracket, matchId);
  if (!match) throw new Error('Match not found');
  if (!match.winner) throw new Error('This match has no result yet — use the normal report instead');
  if (match.isBye || match.isWalkover || match.isDQ) throw new Error('This match was decided by a bye, walkover, or disqualification and cannot be corrected.');

  const p1 = match.participant1;
  const p2 = match.participant2;
  if (newWinnerId !== p1?.id && newWinnerId !== p2?.id) {
    throw new Error('That winner is not a participant in this match');
  }

  const newWinner = newWinnerId === p1.id ? p1 : p2;
  const newLoser = newWinnerId === p1.id ? p2 : p1;

  // Rewind the OLD game tallies (score-only corrections need this too)
  const oldGames = parseGameScore(match.score);
  const oldGoals = parseGoals(match.goals);
  const wStand = (id) => bracket.standings.find(s => s.participant.id === id);
  const ow = wStand(match.winner.id), ol = wStand(match.loser.id);
  if (ow) { ow.gamesWon = (ow.gamesWon || 0) - oldGames.winner; ow.gamesLost = (ow.gamesLost || 0) - oldGames.loser; }
  if (ol) { ol.gamesWon = (ol.gamesWon || 0) - oldGames.loser; ol.gamesLost = (ol.gamesLost || 0) - oldGames.winner; }
  if (oldGoals) {
    if (ow) { ow.goalsFor = (ow.goalsFor || 0) - oldGoals.winner; ow.goalsAgainst = (ow.goalsAgainst || 0) - oldGoals.loser; }
    if (ol) { ol.goalsFor = (ol.goalsFor || 0) - oldGoals.loser; ol.goalsAgainst = (ol.goalsAgainst || 0) - oldGoals.winner; }
  }

  if (match.winner.id !== newWinnerId) {
    if (ow) {
      ow.wins--;
      ow.losses++;
      ow.headToHead[match.loser.id] = 'loss';
    }
    if (ol) {
      ol.losses--;
      ol.wins++;
      ol.headToHead[match.winner.id] = 'win';
    }
    match.winner = newWinner;
    match.loser = newLoser;
  }
  match.score = newScore;
  const newGames = parseGameScore(newScore);
  const nw = wStand(match.winner.id), nl = wStand(match.loser.id);
  if (nw) { nw.gamesWon = (nw.gamesWon || 0) + newGames.winner; nw.gamesLost = (nw.gamesLost || 0) + newGames.loser; }
  if (nl) { nl.gamesWon = (nl.gamesWon || 0) + newGames.loser; nl.gamesLost = (nl.gamesLost || 0) + newGames.winner; }
  const ng = parseGoals(newGoals);
  match.goals = ng ? `${ng.winner}-${ng.loser}` : null;
  if (ng) {
    if (nw) { nw.goalsFor = (nw.goalsFor || 0) + ng.winner; nw.goalsAgainst = (nw.goalsAgainst || 0) + ng.loser; }
    if (nl) { nl.goalsFor = (nl.goalsFor || 0) + ng.loser; nl.goalsAgainst = (nl.goalsAgainst || 0) + ng.winner; }
  }
  delete match.isDQ;
  delete match.dqId;
  return bracket;
}

module.exports = {
  generateBracket,
  advanceWinner,
  correctResult,
  getActiveMatches,
  isComplete,
  isRoundComplete,
  getResults,
  getStandings,
  findMatch,
};
