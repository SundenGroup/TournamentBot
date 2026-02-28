const { v4: uuidv4 } = require('uuid');
const { getNextPowerOfTwo, getRoundName } = require('../utils/bracketUtils');
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

    // Auto-advance byes
    if (match.isBye) {
      match.winner = participant1 || participant2;
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

  return {
    type: 'single_elimination',
    bracketSize,
    totalRounds,
    rounds,
    currentRound: 1,
  };
}

function advanceWinner(bracket, matchId, winnerId) {
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

  // Validate winner is in the match
  const p1Id = match.participant1?.id;
  const p2Id = match.participant2?.id;
  if (winnerId !== p1Id && winnerId !== p2Id) {
    throw new Error('Winner is not a participant in this match');
  }

  // Set winner
  match.winner = winnerId === p1Id ? match.participant1 : match.participant2;

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
  return matches;
}

function isComplete(bracket) {
  const finalRound = bracket.rounds[bracket.rounds.length - 1];
  const finalMatch = finalRound.matches[0];
  return finalMatch.winner !== null;
}

function getResults(bracket) {
  if (!isComplete(bracket)) return null;

  const finalRound = bracket.rounds[bracket.rounds.length - 1];
  const finalMatch = finalRound.matches[0];

  const winner = finalMatch.winner;
  const runnerUp = finalMatch.participant1?.id === winner.id
    ? finalMatch.participant2
    : finalMatch.participant1;

  // Third place is from semi-finals losers (if applicable)
  let thirdPlace = null;
  if (bracket.rounds.length >= 2) {
    const semiFinals = bracket.rounds[bracket.rounds.length - 2];
    for (const match of semiFinals.matches) {
      if (match.winner && match.winner.id !== winner.id && match.winner.id !== runnerUp.id) {
        // This is a semi-final loser
        const loser = match.participant1?.id === match.winner.id
          ? match.participant2
          : match.participant1;
        if (!thirdPlace) thirdPlace = loser;
      }
    }
  }

  return { winner, runnerUp, thirdPlace };
}

module.exports = {
  generateBracket,
  advanceWinner,
  getActiveMatches,
  isComplete,
  getResults,
};
