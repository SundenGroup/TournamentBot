const { v4: uuidv4 } = require('uuid');
const { getNextPowerOfTwo, getRoundName, bestScore } = require('../utils/bracketUtils');
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
      match.score = bestScore(settings?.bestOf);
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

  const bracket = {
    type: 'double_elimination',
    bracketSize,
    bestOf: settings?.bestOf || 1,
    winnersRounds,
    losersRounds,
    grandFinalsRounds,
    currentRound: 1,
    wbComplete: false,
    lbComplete: false,
    needsReset: false,
  };

  // Byes are fully known at generation time. Mark which slots can never be
  // filled (a winners-bracket bye produces no loser, so the losers-bracket slot
  // it would have fed is permanently empty), then auto-advance any match that
  // can only ever receive a single player. Without this, every non-power-of-2
  // field deadlocks: losers-bracket matches fed by a bye sit forever with one
  // empty slot and never become playable.
  computeWalkoverFlags(bracket);
  resolveWalkovers(bracket);

  return bracket;
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

  // A reported result may have dropped a loser into (or advanced a winner toward)
  // a match whose other slot is a structural bye. Cascade any such walkovers.
  resolveWalkovers(bracket);

  return bracket;
}

// ============================================================================
// Walkover / bye resolution
// ----------------------------------------------------------------------------
// `computeWalkoverFlags` runs once at generation. For every match it records:
//   producesWinner — will this match ever yield a winner?
//   producesLoser  — will this match drop a loser into the losers bracket?
//                    (only winners-bracket matches drop losers)
//   p1Dead/p2Dead  — is that participant slot fed by a source that can never
//                    produce a player? (i.e. a permanently empty slot)
// Because byes only ever occur in winners-bracket round 1 and are known up
// front, a single forward pass (WB → LB → GF, all source links point backward)
// is enough to label the whole structure.
//
// `resolveWalkovers` then auto-advances any match that has exactly one real
// participant and a dead other slot, propagating winners forward and repeating
// until stable.
// ============================================================================

function computeWalkoverFlags(bracket) {
  const byId = {};
  for (const round of bracket.winnersRounds) for (const m of round.matches) byId[m.id] = m;
  for (const round of bracket.losersRounds) for (const m of round.matches) byId[m.id] = m;
  for (const round of bracket.grandFinalsRounds) for (const m of round.matches) byId[m.id] = m;

  // Winners bracket — process round by round.
  bracket.winnersRounds.forEach((round, roundIdx) => {
    for (const m of round.matches) {
      if (roundIdx === 0) {
        // Round 1: at least one real player guaranteed. A bye (one empty slot)
        // produces a winner but no loser.
        m.producesWinner = true;
        m.producesLoser = !!(m.participant1 && m.participant2);
        m.p1Dead = !m.participant1 && !m.participant2; // never (guaranteed ≥1)
        m.p2Dead = false;
      } else {
        // Fed by winners of two WB matches, which always produce a winner.
        m.producesWinner = true;
        m.producesLoser = true;
        m.p1Dead = false;
        m.p2Dead = false;
      }
    }
  });

  // Losers bracket — losers never drop further, so producesLoser is always false.
  for (const round of bracket.losersRounds) {
    for (const m of round.matches) {
      let p1Dead;
      let p2Dead;
      if (m.sourceFromWb1Id !== undefined || m.sourceFromWb2Id !== undefined) {
        // LB round 1: p2 = loser of sourceFromWb1, p1 = loser of sourceFromWb2.
        const src1 = byId[m.sourceFromWb1Id];
        const src2 = byId[m.sourceFromWb2Id];
        p2Dead = !src1 || !src1.producesLoser;
        p1Dead = !src2 || !src2.producesLoser;
      } else if (m.sourceLbMatchId !== undefined || m.sourceFromWbId !== undefined) {
        // LB drop-in round: p1 = LB winner, p2 = dropping WB loser.
        const lbSrc = byId[m.sourceLbMatchId];
        const wbSrc = byId[m.sourceFromWbId];
        p1Dead = !lbSrc || !lbSrc.producesWinner;
        p2Dead = !wbSrc || !wbSrc.producesLoser;
      } else {
        // Pure LB round: both slots from LB winners.
        const s1 = byId[m.sourceLbMatch1Id];
        const s2 = byId[m.sourceLbMatch2Id];
        p1Dead = !s1 || !s1.producesWinner;
        p2Dead = !s2 || !s2.producesWinner;
      }
      m.p1Dead = p1Dead;
      m.p2Dead = p2Dead;
      m.producesWinner = !(p1Dead && p2Dead);
      m.producesLoser = false;
    }
  }

  // Grand finals: WB champ (p1) always live; LB champ (p2) live unless the
  // entire losers bracket collapsed (impossible for ≥2 entrants).
  const gf = bracket.grandFinalsRounds[0].matches[0];
  const lbFinals = byId[gf.sourceLbFinalsId];
  gf.p1Dead = false;
  gf.p2Dead = !lbFinals || !lbFinals.producesWinner;
  gf.producesWinner = true;
  gf.producesLoser = false;
}

function placeWinnerForward(bracket, match, winner) {
  if (!match.nextWinMatchId) return;
  const next = findMatch(bracket, match.nextWinMatchId);
  if (!next) return;

  if (next.bracket === 'grand_finals') {
    if (match.bracket === 'winners') next.participant1 = winner;
    else next.participant2 = winner;
  } else if (
    next.sourceMatch1Id === match.id ||
    next.sourceLbMatchId === match.id ||
    next.sourceLbMatch1Id === match.id
  ) {
    next.participant1 = winner;
  } else {
    next.participant2 = winner;
  }
}

function resolveWalkovers(bracket) {
  const allMatches = () => {
    const list = [];
    for (const round of bracket.winnersRounds) list.push(...round.matches);
    for (const round of bracket.losersRounds) list.push(...round.matches);
    for (const round of bracket.grandFinalsRounds) list.push(...round.matches);
    return list;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const m of allMatches()) {
      if (m.winner) continue;
      if (m.bracket === 'grand_finals') continue; // GF/reset are real contests
      if (m.producesWinner === false) continue;   // dead match — never resolves

      const p1 = m.participant1;
      const p2 = m.participant2;

      // Auto-advance only when exactly one real player is present and the other
      // slot is a structural bye (dead). Two present players is a real match.
      let soleWinner = null;
      if (p1 && !p2 && m.p2Dead) soleWinner = p1;
      else if (p2 && !p1 && m.p1Dead) soleWinner = p2;

      if (soleWinner) {
        m.winner = soleWinner;
        m.loser = null; // a walkover has no loser to drop
        m.isWalkover = true; // lets the Discord layer DM the advanced player
        m.score = bestScore(bracket.bestOf);
        placeWinnerForward(bracket, m, soleWinner);
        changed = true;
      }
    }
  }
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

  // Third place is the loser of the Losers Finals — the player eliminated by
  // the LB champion (who then went to Grand Finals). The previous code read the
  // Losers Semi-Finals (one round too early).
  let thirdPlace = null;
  if (bracket.losersRounds.length >= 1) {
    const lbFinals = bracket.losersRounds[bracket.losersRounds.length - 1];
    const lbFinalsMatch = lbFinals.matches[0];
    if (lbFinalsMatch?.loser) {
      thirdPlace = lbFinalsMatch.loser;
    }
  }

  return { winner, runnerUp, thirdPlace };
}

/**
 * Rewind an automatically resolved (walkover) match so a corrected result can
 * re-propagate through it. Played results downstream block the correction.
 */
function rewindAutoMatch(bracket, match) {
  if (!match.winner) return;
  if (!match.isWalkover) {
    throw new Error(`Match #${match.matchNumber} already has a played result that depends on this one — correct it first.`);
  }
  const advanced = match.winner;
  if (match.nextWinMatchId) {
    const next = findMatch(bracket, match.nextWinMatchId);
    if (next) {
      if (next.winner) rewindAutoMatch(bracket, next);
      if (next.participant1?.id === advanced.id) next.participant1 = null;
      else if (next.participant2?.id === advanced.id) next.participant2 = null;
    }
  }
  match.winner = null;
  match.isWalkover = false;
  match.score = null;
  match.byeNotified = false;
}

/** Remove `participant` from the slot it occupies in `match` (if any). */
function clearSlot(match, participantId) {
  if (!match) return;
  if (match.participant1?.id === participantId) match.participant1 = null;
  else if (match.participant2?.id === participantId) match.participant2 = null;
}

/**
 * Correct a wrongly reported result. Downstream matches must be unplayed;
 * automatic walkovers in the way are rewound and re-resolved after the swap.
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
  const oldWinner = match.winner;
  const oldLoser = match.loser;
  const winnerChanged = oldWinner.id !== newWinnerId;

  if (!winnerChanged) {
    match.score = newScore;
    return bracket;
  }

  if (match.bracket === 'grand_finals') {
    if (match.isReset) {
      // Reset match is terminal — just swap.
      match.winner = newWinner;
      match.loser = newLoser;
      match.score = newScore;
      return bracket;
    }
    // First grand finals game: flipping the winner flips the bracket reset.
    const reset = findMatch(bracket, match.resetMatchId);
    if (reset?.winner) {
      throw new Error('The bracket-reset match has already been played — correct that result instead.');
    }
    match.winner = newWinner;
    match.loser = newLoser;
    match.score = newScore;
    const wbFinals = findMatch(bracket, match.sourceWbFinalsId);
    bracket.needsReset = newWinner.id !== wbFinals?.winner?.id;
    if (reset) {
      reset.participant1 = bracket.needsReset ? match.participant1 : null;
      reset.participant2 = bracket.needsReset ? match.participant2 : null;
    }
    return bracket;
  }

  // Downstream guards (rewinding walkovers where needed)
  const nextWin = match.nextWinMatchId ? findMatch(bracket, match.nextWinMatchId) : null;
  const nextLose = match.nextLoseMatchId ? findMatch(bracket, match.nextLoseMatchId) : null;
  if (nextWin?.winner) rewindAutoMatch(bracket, nextWin);
  if (nextLose?.winner) rewindAutoMatch(bracket, nextLose);

  // Pull the old placements out, apply the swap, re-place
  clearSlot(nextWin, oldWinner.id);
  clearSlot(nextLose, oldLoser?.id);

  match.winner = newWinner;
  match.loser = newLoser;
  match.score = newScore;
  delete match.isDQ;
  delete match.dqId;

  if (nextWin) {
    if (nextWin.bracket === 'grand_finals') {
      if (match.bracket === 'winners') nextWin.participant1 = newWinner;
      else nextWin.participant2 = newWinner;
    } else if (
      nextWin.sourceMatch1Id === matchId ||
      nextWin.sourceLbMatchId === matchId ||
      nextWin.sourceLbMatch1Id === matchId
    ) {
      nextWin.participant1 = newWinner;
    } else {
      nextWin.participant2 = newWinner;
    }
  }
  if (nextLose && match.bracket === 'winners') {
    if (nextLose.sourceFromWb1Id === matchId || nextLose.sourceFromWbId === matchId) {
      nextLose.participant2 = newLoser;
    } else if (nextLose.sourceFromWb2Id === matchId) {
      nextLose.participant1 = newLoser;
    }
  }

  resolveWalkovers(bracket);

  // Safeguard: a rewound walkover can leave a Grand Finals slot empty (GF is
  // excluded from resolveWalkovers). Repopulate GF from the finals winners so
  // the bracket can never deadlock after a correction.
  const gf = bracket.grandFinalsRounds[0].matches[0];
  if (!gf.winner) {
    const wbF = findMatch(bracket, gf.sourceWbFinalsId);
    const lbF = findMatch(bracket, gf.sourceLbFinalsId);
    if (wbF?.winner && !gf.participant1) gf.participant1 = wbF.winner;
    if (lbF?.winner && !gf.participant2) gf.participant2 = lbF.winner;
  }

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
