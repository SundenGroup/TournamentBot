const { v4: uuidv4 } = require('uuid');
const { getNextPowerOfTwo, getRoundName, bestScore } = require('../utils/bracketUtils');
const { generateSeedOrder } = require('../utils/seedingUtils');

function generateBracket(participants, settings) {
  const count = participants.length;

  if (count < 2) {
    throw new Error('Need at least 2 participants');
  }

  const bracketSize = getNextPowerOfTwo(count);
  const totalRounds = Math.log2(bracketSize);
  const byeCount = bracketSize - count;

  // Sort participants by seed (seeded first, then unseeded)
  const sorted = [...participants].sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return 0;
  });

  // Generate seed order for bracket placement
  const seedOrder = generateSeedOrder(bracketSize);

  // Place participants according to seed order
  const slots = new Array(bracketSize).fill(null);
  for (let i = 0; i < sorted.length; i++) {
    const position = seedOrder.indexOf(i + 1);
    slots[position] = sorted[i];
  }

  // Generate rounds
  const rounds = [];
  let matchNumber = 1;

  // Round 1
  const round1Matches = [];
  for (let i = 0; i < bracketSize; i += 2) {
    const participant1 = slots[i];
    const participant2 = slots[i + 1];

    const match = {
      id: uuidv4(),
      matchNumber: matchNumber++,
      round: 1,
      roundName: getRoundName(1, totalRounds),
      participant1: participant1,
      participant2: participant2,
      winner: null,
      score: null,
      isBye: !participant1 || !participant2,
      nextMatchId: null,
      channelId: null,
    };

    // Auto-advance byes (recorded with the best possible series score)
    if (match.isBye) {
      match.winner = participant1 || participant2;
      match.score = bestScore(settings?.bestOf);
    }

    round1Matches.push(match);
  }
  rounds.push({ round: 1, name: getRoundName(1, totalRounds), matches: round1Matches });

  // Generate subsequent rounds
  let previousMatches = round1Matches;
  for (let round = 2; round <= totalRounds; round++) {
    const roundMatches = [];
    const matchesInRound = previousMatches.length / 2;

    for (let i = 0; i < matchesInRound; i++) {
      const sourceMatch1 = previousMatches[i * 2];
      const sourceMatch2 = previousMatches[i * 2 + 1];

      const match = {
        id: uuidv4(),
        matchNumber: matchNumber++,
        round: round,
        roundName: getRoundName(round, totalRounds),
        participant1: sourceMatch1.isBye ? sourceMatch1.winner : null,
        participant2: sourceMatch2.isBye ? sourceMatch2.winner : null,
        winner: null,
        score: null,
        isBye: false,
        sourceMatch1Id: sourceMatch1.id,
        sourceMatch2Id: sourceMatch2.id,
        nextMatchId: null,
        channelId: null,
      };

      // Link previous matches to this one
      sourceMatch1.nextMatchId = match.id;
      sourceMatch2.nextMatchId = match.id;

      roundMatches.push(match);
    }

    rounds.push({ round, name: getRoundName(round, totalRounds), matches: roundMatches });
    previousMatches = roundMatches;
  }

  const bracket = {
    type: 'single_elimination',
    bracketSize,
    totalRounds,
    bestOf: settings?.bestOf || 1,
    rounds,
    currentRound: 1,
  };

  // Optional third-place match (settings.thirdPlaceMatch): the two semifinal
  // losers play it out instead of sharing 3rd. Kept OUTSIDE rounds[] so the
  // binary-tree renderers/connectors stay untouched; every consumer handles it
  // explicitly. Needs at least 2 rounds (4+ bracket) to have semifinals.
  if (settings?.thirdPlaceMatch && totalRounds >= 2) {
    const semis = rounds[rounds.length - 2].matches;
    bracket.thirdPlaceMatch = {
      id: uuidv4(),
      matchNumber: matchNumber++,
      round: totalRounds,
      roundName: 'Third Place Match',
      isThirdPlace: true,
      participant1: null, // loser of semi 1
      participant2: null, // loser of semi 2
      winner: null,
      score: null,
      isBye: false,
      sourceSemi1Id: semis[0].id,
      sourceSemi2Id: semis[1].id,
      channelId: null,
    };
  }

  return bracket;
}

/**
 * A semifinal that was a bye never produces a loser, so its third-place slot
 * can never fill — when the other slot has a real player, they win 3rd by
 * walkover (picked up by the bye notifier via isWalkover).
 */
function resolveThirdPlaceWalkover(bracket) {
  const tp = bracket.thirdPlaceMatch;
  if (!tp || tp.winner) return;

  const semis = bracket.rounds[bracket.rounds.length - 2].matches;
  const semi1 = semis.find(m => m.id === tp.sourceSemi1Id);
  const semi2 = semis.find(m => m.id === tp.sourceSemi2Id);

  if (tp.participant1 && !tp.participant2 && semi2?.isBye) {
    tp.winner = tp.participant1;
    tp.isWalkover = true;
    tp.score = bestScore(bracket.bestOf);
  } else if (tp.participant2 && !tp.participant1 && semi1?.isBye) {
    tp.winner = tp.participant2;
    tp.isWalkover = true;
    tp.score = bestScore(bracket.bestOf);
  }
}

function findMatch(bracket, matchId) {
  for (const round of bracket.rounds) {
    const match = round.matches.find(m => m.id === matchId);
    if (match) return match;
  }
  if (bracket.thirdPlaceMatch?.id === matchId) return bracket.thirdPlaceMatch;
  return null;
}

function advanceWinner(bracket, matchId, winnerId, score = null) {
  const match = findMatch(bracket, matchId);

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

  // Set winner
  match.winner = winnerId === p1Id ? match.participant1 : match.participant2;
  if (score) match.score = score;

  // Advance to next match if exists
  if (match.nextMatchId) {
    for (const round of bracket.rounds) {
      const nextMatch = round.matches.find(m => m.id === match.nextMatchId);
      if (nextMatch) {
        // Determine which slot (participant1 or participant2)
        if (nextMatch.sourceMatch1Id === matchId) {
          nextMatch.participant1 = match.winner;
        } else {
          nextMatch.participant2 = match.winner;
        }
        break;
      }
    }
  }

  // Semifinal losers drop into the third-place match (when enabled)
  const tp = bracket.thirdPlaceMatch;
  if (tp && !match.isThirdPlace) {
    const loser = winnerId === p1Id ? match.participant2 : match.participant1;
    if (tp.sourceSemi1Id === matchId) tp.participant1 = loser;
    else if (tp.sourceSemi2Id === matchId) tp.participant2 = loser;
    resolveThirdPlaceWalkover(bracket);
  }

  // Update current round
  updateCurrentRound(bracket);

  return bracket;
}

function updateCurrentRound(bracket) {
  for (const round of bracket.rounds) {
    const incomplete = round.matches.filter(m => !m.winner && !m.isBye);
    if (incomplete.length > 0) {
      bracket.currentRound = round.round;
      return;
    }
  }
  // All matches complete
  bracket.currentRound = bracket.totalRounds + 1;
}

function getActiveMatches(bracket) {
  const matches = [];
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (!match.winner && !match.isBye && match.participant1 && match.participant2) {
        matches.push(match);
      }
    }
  }
  const tp = bracket.thirdPlaceMatch;
  if (tp && !tp.winner && tp.participant1 && tp.participant2) {
    matches.push(tp);
  }
  return matches;
}

function isComplete(bracket) {
  const finalRound = bracket.rounds[bracket.rounds.length - 1];
  const finalMatch = finalRound.matches[0];
  if (finalMatch.winner === null) return false;
  // With a third-place match, the tournament isn't done until it's played
  // (a walkover resolves it automatically when a semifinal was a bye).
  if (bracket.thirdPlaceMatch && !bracket.thirdPlaceMatch.winner) return false;
  return true;
}

function getResults(bracket) {
  if (!isComplete(bracket)) return null;

  const finalRound = bracket.rounds[bracket.rounds.length - 1];
  const finalMatch = finalRound.matches[0];

  const winner = finalMatch.winner;
  const runnerUp = finalMatch.participant1?.id === winner.id
    ? finalMatch.participant2
    : finalMatch.participant1;

  // With a third-place match, 3rd is decided on the server. Otherwise the
  // semifinal losers share it and we surface the first one.
  if (bracket.thirdPlaceMatch?.winner) {
    return { winner, runnerUp, thirdPlace: bracket.thirdPlaceMatch.winner };
  }

  // Third place: the losers of the semi-finals (no 3rd-place playoff, so they
  // tie for 3rd). Identify each semi-final's loser directly — the previous code
  // filtered on the semi-final WINNER, which is always a finalist, so it never
  // matched and thirdPlace was always null.
  let thirdPlace = null;
  if (bracket.rounds.length >= 2) {
    const semiFinals = bracket.rounds[bracket.rounds.length - 2];
    for (const match of semiFinals.matches) {
      if (!match.winner) continue;
      const loser = match.participant1?.id === match.winner.id
        ? match.participant2
        : match.participant1;
      if (loser && !thirdPlace) thirdPlace = loser;
    }
  }

  return { winner, runnerUp, thirdPlace };
}

/**
 * Correct a wrongly reported result. Safe only while nothing downstream
 * depends on it: the next match (and the third-place match, for semifinals)
 * must be unplayed — automatic third-place walkovers are rewound.
 */
function correctResult(bracket, matchId, newWinnerId, newScore = null) {
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
  const winnerChanged = match.winner.id !== newWinnerId;

  // Score-only correction needs no structural checks
  if (!winnerChanged) {
    match.score = newScore;
    return bracket;
  }

  // Downstream guards
  if (match.nextMatchId) {
    const next = findMatch(bracket, match.nextMatchId);
    if (next?.winner) {
      throw new Error(`Match #${next.matchNumber} already has a result that depends on this one — correct it first.`);
    }
  }
  const tp = bracket.thirdPlaceMatch;
  const feedsTp = tp && (tp.sourceSemi1Id === matchId || tp.sourceSemi2Id === matchId);
  if (feedsTp && tp.winner && !tp.isWalkover) {
    throw new Error('The Third Place Match already has a result that depends on this one — correct it first.');
  }

  // Apply
  match.winner = newWinner;
  match.score = newScore;
  delete match.isDQ;
  delete match.dqId;

  // Re-propagate the winner
  if (match.nextMatchId) {
    const next = findMatch(bracket, match.nextMatchId);
    if (next) {
      if (next.sourceMatch1Id === matchId) next.participant1 = newWinner;
      else next.participant2 = newWinner;
    }
  }

  // Re-propagate the loser into the third-place match
  if (feedsTp) {
    if (tp.winner && tp.isWalkover) {
      tp.winner = null;
      tp.isWalkover = false;
      tp.score = null;
      tp.byeNotified = false;
    }
    if (tp.sourceSemi1Id === matchId) tp.participant1 = newLoser;
    else tp.participant2 = newLoser;
    resolveThirdPlaceWalkover(bracket);
  }

  updateCurrentRound(bracket);
  return bracket;
}

module.exports = {
  generateBracket,
  advanceWinner,
  correctResult,
  findMatch,
  getActiveMatches,
  isComplete,
  getResults,
};
