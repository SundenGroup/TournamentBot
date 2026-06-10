// Disqualification.
//
// Past results are history — a DQ takes effect from the round the entrant is
// currently in: every unfinished match they're part of is forfeited (the
// opponent wins with the best possible series score, e.g. 2-0 in a Bo3) and
// flagged isDQ so brackets render "DQ". If they're seeded into a match whose
// opponent isn't decided yet, the match is marked pendingDQ and forfeits
// automatically the moment the opponent arrives (hooked into the report flows
// via resolvePendingDQs). Swiss additionally stops pairing them in new rounds.

const { bestScore } = require('../utils/bracketUtils');

const singleElim = require('./singleEliminationService');
const doubleElim = require('./doubleEliminationService');
const swiss = require('./swissService');
const roundRobin = require('./roundRobinService');

const SERVICES = {
  single_elimination: singleElim,
  double_elimination: doubleElim,
  swiss,
  round_robin: roundRobin,
};

function collectAllMatches(bracket) {
  if (!bracket) return [];
  const matches = [];
  const roundGroups = bracket.type === 'double_elimination'
    ? [bracket.winnersRounds, bracket.losersRounds, bracket.grandFinalsRounds]
    : [bracket.rounds];
  for (const rounds of roundGroups) {
    for (const round of rounds || []) {
      matches.push(...(round.matches || []));
    }
  }
  if (bracket.thirdPlaceMatch) matches.push(bracket.thirdPlaceMatch);
  return matches;
}

function involves(match, participantId) {
  return match.participant1?.id === participantId || match.participant2?.id === participantId;
}

/**
 * Forfeit one match against `dqId`: the opponent advances with the best score.
 * Returns true if the forfeit happened.
 */
function forfeitMatch(bracket, match, dqId) {
  const opponent = match.participant1?.id === dqId ? match.participant2 : match.participant1;
  if (!opponent) return false;

  const service = SERVICES[bracket.type];
  service.advanceWinner(bracket, match.id, opponent.id, bestScore(bracket.bestOf));
  match.isDQ = true;
  match.dqId = dqId;
  delete match.pendingDQ;
  return true;
}

/**
 * Disqualify an entrant from the running tournament. Mutates the tournament's
 * bracket and entrant list — the caller persists.
 * Returns { forfeited, pending } counts.
 */
function disqualify(tournament, participantId, reason = null) {
  const bracket = tournament.bracket;
  if (!bracket || !SERVICES[bracket.type]) {
    throw new Error('Disqualification is only available for running bracket tournaments');
  }

  // Flag the entrant on the roster (drives 🚫 in lists)
  const isSolo = tournament.settings.teamSize === 1;
  const entrant = (isSolo ? tournament.participants : tournament.teams).find(e => e.id === participantId);
  if (entrant) {
    entrant.disqualified = true;
    if (reason) entrant.dqReason = reason;
  }

  // Swiss: never pair them again
  if (bracket.type === 'swiss') {
    const standing = bracket.standings.find(s => s.participant.id === participantId);
    if (standing) standing.disqualified = true;
  }

  // Forfeit every unfinished match they're in. Loop because a forfeit can
  // surface a new match for them (double elim: WB forfeit drops them to LB).
  let forfeited = 0;
  let guard = 0;
  while (guard++ < 50) {
    const open = collectAllMatches(bracket).filter(m => !m.winner && !m.isBye && involves(m, participantId));
    if (open.length === 0) break;

    let progressed = false;
    for (const match of open) {
      if (forfeitMatch(bracket, match, participantId)) {
        forfeited++;
        progressed = true;
      } else {
        // Opponent slot not decided yet — forfeit when they arrive
        match.pendingDQ = participantId;
      }
    }
    if (!progressed) break;
  }

  const pending = collectAllMatches(bracket).filter(m => m.pendingDQ && !m.winner).length;
  return { forfeited, pending };
}

/**
 * Forfeit any pendingDQ matches whose opponent has now arrived. Called after
 * every reported result. Returns the number of matches forfeited.
 */
function resolvePendingDQs(tournament) {
  const bracket = tournament.bracket;
  if (!bracket || !SERVICES[bracket.type]) return 0;

  let total = 0;
  let guard = 0;
  while (guard++ < 50) {
    const ready = collectAllMatches(bracket).filter(m =>
      m.pendingDQ && !m.winner && m.participant1 && m.participant2
    );
    if (ready.length === 0) break;
    for (const match of ready) {
      if (forfeitMatch(bracket, match, match.pendingDQ)) total++;
    }
  }
  return total;
}

module.exports = {
  disqualify,
  resolvePendingDQs,
};
