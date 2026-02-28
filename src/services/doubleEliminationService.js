const { v4: uuidv4 } = require('uuid');
const { getNextPowerOfTwo, getRoundName } = require('../utils/bracketUtils');
const { generateSeedOrder } = require('../utils/seedingUtils');

function generateBracket(participants, settings) {
  const count = participants.length;

  if (count < 2) {
    throw new Error('Need at least 2 participants');
  }

  const bracketSize = getNextPowerOfTwo(count);
  const wbRounds = Math.log2(bracketSize);

  // Sort participants by seed
  const sorted = [...participants].sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return 0;
  });

  // Generate seed order for bracket placement
  const seedOrder = generateSeedOrder(bracketSize);

  // Place participants
  const slots = new Array(bracketSize).fill(null);
  for (let i = 0; i < sorted.length; i++) {
    const position = seedOrder.indexOf(i + 1);
    slots[position] = sorted[i];
  }

  let matchNumber = 1;

  // ============ WINNERS BRACKET ============
  const winnersRounds = [];

  // WB Round 1
  const wbRound1Matches = [];
  for (let i = 0; i < bracketSize; i += 2) {
    const participant1 = slots[i];
    const participant2 = slots[i + 1];

    const match = {
      id: uuidv4(),
      matchNumber: matchNumber++,
      round: 1,
      roundName: `Winners Round 1`,
      bracket: 'winners',
      participant1,
      participant2,
      winner: null,
      loser: null,
      score: null,
      isBye: !participant1 || !participant2,
      nextWinMatchId: null,
      nextLoseMatchId: null,
      channelId: null,
    };

    if (match.isBye) {
      match.winner = participant1 || participant2;
    }

    wbRound1Matches.push(match);
  }
  winnersRounds.push({ round: 1, name: 'Winners Round 1', matches: wbRound1Matches });

  // WB subsequent rounds
  let prevWbMatches = wbRound1Matches;
  for (let round = 2; round <= wbRounds; round++) {
    const roundMatches = [];
    const matchesInRound = prevWbMatches.length / 2;

    let roundName;
    if (round === wbRounds) roundName = 'Winners Finals';
    else if (round === wbRounds - 1) roundName = 'Winners Semi-Finals';
    else roundName = `Winners Round ${round}`;

    for (let i = 0; i < matchesInRound; i++) {
      const sourceMatch1 = prevWbMatches[i * 2];
      const sourceMatch2 = prevWbMatches[i * 2 + 1];

      const match = {
        id: uuidv4(),
        matchNumber: matchNumber++,
        round,
        roundName,
        bracket: 'winners',
        participant1: sourceMatch1.isBye ? sourceMatch1.winner : null,
        participant2: sourceMatch2.isBye ? sourceMatch2.winner : null,
        winner: null,
        loser: null,
        score: null,
        isBye: false,
        sourceMatch1Id: sourceMatch1.id,
        sourceMatch2Id: sourceMatch2.id,
        nextWinMatchId: null,
        nextLoseMatchId: null,
        channelId: null,
      };

      sourceMatch1.nextWinMatchId = match.id;
      sourceMatch2.nextWinMatchId = match.id;

      roundMatches.push(match);
    }

    winnersRounds.push({ round, name: roundName, matches: roundMatches });
    prevWbMatches = roundMatches;
  }

  // ============ LOSERS BRACKET ============
  const losersRounds = [];

  // LB has (wbRounds - 1) * 2 rounds roughly
  // Round 1 of LB: losers from WB R1
  // Then alternating: LB match -> receive WB loser -> LB match -> receive WB loser...

  let lbRound = 1;
  const lbRoundCount = (wbRounds - 1) * 2;

  // First LB round: WB R1 losers play each other
  const lbRound1Matches = [];
  const wbR1Losers = wbRound1Matches; // These feed into LB
  for (let i = 0; i < wbR1Losers.length; i += 2) {
    const match = {
      id: uuidv4(),
      matchNumber: matchNumber++,
      round: lbRound,
      roundName: `Losers Round ${lbRound}`,
      bracket: 'losers',
      participant1: null, // Will be filled by WB loser
      participant2: null,
      winner: null,
      loser: null,
      score: null,
      isBye: false,
      sourceFromWb1Id: wbR1Losers[i].id,
      sourceFromWb2Id: wbR1Losers[i + 1]?.id,
      nextWinMatchId: null,
      channelId: null,
    };

    wbR1Losers[i].nextLoseMatchId = match.id;
    if (wbR1Losers[i + 1]) {
      wbR1Losers[i + 1].nextLoseMatchId = match.id;
    }

    lbRound1Matches.push(match);
  }
  losersRounds.push({ round: lbRound, name: `Losers Round ${lbRound}`, matches: lbRound1Matches });

  // Continue building losers bracket
  let prevLbMatches = lbRound1Matches;
  let wbRoundForLosers = 2; // Which WB round's losers drop in

  for (lbRound = 2; lbRound <= lbRoundCount; lbRound++) {
    const isDropInRound = lbRound % 2 === 0; // Even rounds receive WB losers

    let roundName;
    if (lbRound === lbRoundCount) roundName = 'Losers Finals';
    else if (lbRound === lbRoundCount - 1) roundName = 'Losers Semi-Finals';
    else roundName = `Losers Round ${lbRound}`;

    const roundMatches = [];

    if (isDropInRound && wbRoundForLosers <= wbRounds) {
      // LB winners vs WB losers dropping in
      const wbLosersRound = winnersRounds[wbRoundForLosers - 1];

      for (let i = 0; i < prevLbMatches.length; i++) {
        const lbSource = prevLbMatches[i];
        const wbDropIn = wbLosersRound?.matches[i];

        const match = {
          id: uuidv4(),
          matchNumber: matchNumber++,
          round: lbRound,
          roundName,
          bracket: 'losers',
          participant1: null, // LB winner
          participant2: null, // WB loser dropping in
          winner: null,
          loser: null,
          score: null,
          isBye: false,
          sourceLbMatchId: lbSource.id,
          sourceFromWbId: wbDropIn?.id,
          nextWinMatchId: null,
          channelId: null,
        };

        lbSource.nextWinMatchId = match.id;
        if (wbDropIn) {
          wbDropIn.nextLoseMatchId = match.id;
        }

        roundMatches.push(match);
      }

      wbRoundForLosers++;
    } else {
      // Pure LB round: LB winners play each other
      const matchesInRound = Math.ceil(prevLbMatches.length / 2);

      for (let i = 0; i < matchesInRound; i++) {
        const source1 = prevLbMatches[i * 2];
        const source2 = prevLbMatches[i * 2 + 1];

        const match = {
          id: uuidv4(),
          matchNumber: matchNumber++,
          round: lbRound,
          roundName,
          bracket: 'losers',
          participant1: null,
          participant2: null,
          winner: null,
          loser: null,
          score: null,
          isBye: !source2,
          sourceLbMatch1Id: source1.id,
          sourceLbMatch2Id: source2?.id,
          nextWinMatchId: null,
          channelId: null,
        };

        source1.nextWinMatchId = match.id;
        if (source2) {
          source2.nextWinMatchId = match.id;
        }

        roundMatches.push(match);
      }
    }

    losersRounds.push({ round: lbRound, name: roundName, matches: roundMatches });
    prevLbMatches = roundMatches;
  }

  // ============ GRAND FINALS ============
  const wbFinals = winnersRounds[winnersRounds.length - 1].matches[0];
  const lbFinals = losersRounds[losersRounds.length - 1].matches[0];

  const grandFinals = {
    id: uuidv4(),
    matchNumber: matchNumber++,
    round: 1,
    roundName: 'Grand Finals',
    bracket: 'grand_finals',
    participant1: null, // WB Champion
    participant2: null, // LB Champion
    winner: null,
    loser: null,
    score: null,
    isBye: false,
    sourceWbFinalsId: wbFinals.id,
    sourceLbFinalsId: lbFinals.id,
    nextWinMatchId: null,
    channelId: null,
  };

  wbFinals.nextWinMatchId = grandFinals.id;
  lbFinals.nextWinMatchId = grandFinals.id;

  // Bracket reset (if LB champion wins grand finals)
  const bracketReset = {
    id: uuidv4(),
    matchNumber: matchNumber++,
    round: 2,
    roundName: 'Grand Finals Reset',
    bracket: 'grand_finals',
    participant1: null,
    participant2: null,
    winner: null,
    loser: null,
    score: null,
    isBye: false,
    isReset: true,
    sourceGrandFinalsId: grandFinals.id,
    channelId: null,
  };

  grandFinals.resetMatchId = bracketReset.id;

  const grandFinalsRounds = [
    { round: 1, name: 'Grand Finals', matches: [grandFinals] },
    { round: 2, name: 'Grand Finals Reset', matches: [bracketReset] },
  ];

  return {
    type: 'double_elimination',
    bracketSize,
    winnersRounds,
    losersRounds,
    grandFinalsRounds,
    currentRound: 1,
    wbComplete: false,
    lbComplete: false,
    needsReset: false,
  };
}

function advanceWinner(bracket, matchId, winnerId, score = null) {
  // Find the match across all brackets
  let match = findMatch(bracket, matchId);

  if (!match) {
    throw new Error('Match not found');
  }

  if (match.winner) {
    throw new Error('Match already has a winner');
  }

  const p1Id = match.participant1?.id;
  const p2Id = match.participant2?.id;

  if (winnerId !== p1Id && winnerId !== p2Id) {
    throw new Error('Winner is not a participant in this match');
  }

  const winner = winnerId === p1Id ? match.participant1 : match.participant2;
  const loser = winnerId === p1Id ? match.participant2 : match.participant1;

  match.winner = winner;
  match.loser = loser;
  match.score = score;

  // Handle advancement based on bracket type
  if (match.bracket === 'winners') {
    // Winner advances in WB
    if (match.nextWinMatchId) {
      const nextMatch = findMatch(bracket, match.nextWinMatchId);
      if (nextMatch) {
        // Check if advancing to Grand Finals (WB Finals → Grand Finals)
        if (nextMatch.bracket === 'grand_finals') {
          nextMatch.participant1 = winner; // WB Champion goes to participant1
        } else if (nextMatch.sourceMatch1Id === matchId) {
          nextMatch.participant1 = winner;
        } else {
          nextMatch.participant2 = winner;
        }
      }
    }

    // Loser drops to LB
    if (match.nextLoseMatchId) {
      const lbMatch = findMatch(bracket, match.nextLoseMatchId);
      if (lbMatch) {
        if (lbMatch.sourceFromWb1Id === matchId || lbMatch.sourceFromWbId === matchId) {
          lbMatch.participant2 = loser; // WB losers go to participant2
        } else if (lbMatch.sourceFromWb2Id === matchId) {
          lbMatch.participant1 = loser;
        }
      }
    }
  } else if (match.bracket === 'losers') {
    // Winner advances in LB
    if (match.nextWinMatchId) {
      const nextMatch = findMatch(bracket, match.nextWinMatchId);
      if (nextMatch) {
        // Check if advancing to Grand Finals (LB Finals → Grand Finals)
        if (nextMatch.bracket === 'grand_finals') {
          nextMatch.participant2 = winner; // LB Champion goes to participant2
        } else if (nextMatch.sourceLbMatchId === matchId || nextMatch.sourceLbMatch1Id === matchId) {
          nextMatch.participant1 = winner;
        } else {
          nextMatch.participant2 = winner;
        }
      }
    }
    // Loser is eliminated (no action needed)
  } else if (match.bracket === 'grand_finals') {
    if (match.isReset) {
      // Reset match complete - tournament over
    } else {
      // First grand finals match
      // Check if WB champion won (from WB finals)
      const wbFinals = findMatch(bracket, match.sourceWbFinalsId);
      const wbChampion = wbFinals?.winner;

      if (winner.id === wbChampion?.id) {
        // WB champion wins, no reset needed
        bracket.needsReset = false;
      } else {
        // LB champion wins, bracket reset
        bracket.needsReset = true;
        const resetMatch = findMatch(bracket, match.resetMatchId);
        if (resetMatch) {
          resetMatch.participant1 = match.participant1;
          resetMatch.participant2 = match.participant2;
        }
      }
    }
  }

  return bracket;
}

function findMatch(bracket, matchId) {
  for (const round of bracket.winnersRounds) {
    const match = round.matches.find(m => m.id === matchId);
    if (match) return match;
  }
  for (const round of bracket.losersRounds) {
    const match = round.matches.find(m => m.id === matchId);
    if (match) return match;
  }
  for (const round of bracket.grandFinalsRounds) {
    const match = round.matches.find(m => m.id === matchId);
    if (match) return match;
  }
  return null;
}

function getActiveMatches(bracket) {
  const matches = [];

  const checkMatch = (match) => {
    if (!match.winner && !match.isBye && match.participant1 && match.participant2) {
      matches.push(match);
    }
  };

  for (const round of bracket.winnersRounds) {
    round.matches.forEach(checkMatch);
  }
  for (const round of bracket.losersRounds) {
    round.matches.forEach(checkMatch);
  }

  // Grand finals
  const gf = bracket.grandFinalsRounds[0].matches[0];
  if (gf.participant1 && gf.participant2 && !gf.winner) {
    matches.push(gf);
  }

  // Reset match (only if needed)
  if (bracket.needsReset) {
    const reset = bracket.grandFinalsRounds[1].matches[0];
    if (reset.participant1 && reset.participant2 && !reset.winner) {
      matches.push(reset);
    }
  }

  return matches;
}

function isComplete(bracket) {
  const gf = bracket.grandFinalsRounds[0].matches[0];

  if (!gf.winner) return false;

  if (bracket.needsReset) {
    const reset = bracket.grandFinalsRounds[1].matches[0];
    return reset.winner !== null;
  }

  return true;
}

function getResults(bracket) {
  if (!isComplete(bracket)) return null;

  let finalMatch;
  if (bracket.needsReset) {
    finalMatch = bracket.grandFinalsRounds[1].matches[0];
  } else {
    finalMatch = bracket.grandFinalsRounds[0].matches[0];
  }

  const winner = finalMatch.winner;
  const runnerUp = finalMatch.participant1?.id === winner.id
    ? finalMatch.participant2
    : finalMatch.participant1;

  // Third place is LB semi-finals loser
  let thirdPlace = null;
  if (bracket.losersRounds.length >= 2) {
    const lbSemis = bracket.losersRounds[bracket.losersRounds.length - 2];
    const lbSemiMatch = lbSemis.matches[0];
    if (lbSemiMatch?.loser) {
      thirdPlace = lbSemiMatch.loser;
    }
  }

  return { winner, runnerUp, thirdPlace };
}

module.exports = {
  generateBracket,
  advanceWinner,
  findMatch,
  getActiveMatches,
  isComplete,
  getResults,
};
