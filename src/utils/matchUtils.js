// Shared match helpers used by the Discord report/correct commands, the
// match-room buttons and the web-admin API. Single source of truth for
// bracket-service selection, match lookup and series-score validation.

const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');

function getServiceForBracket(bracket) {
  switch (bracket.type) {
    case 'double_elimination': return doubleElim;
    case 'swiss': return swiss;
    case 'round_robin': return roundRobin;
    case 'battle_royale': return battleRoyale;
    case 'single_elimination':
    default: return singleElim;
  }
}

/** Locate a match by its display number (includes the third-place match). */
function findMatchByNumber(bracket, matchNumber) {
  if (bracket.type === 'double_elimination') {
    for (const round of [...bracket.winnersRounds, ...bracket.losersRounds, ...bracket.grandFinalsRounds]) {
      const match = round.matches.find(m => m.matchNumber === matchNumber);
      if (match) return match;
    }
    return null;
  }
  for (const round of bracket.rounds || []) {
    const match = round.matches.find(m => m.matchNumber === matchNumber);
    if (match) return match;
  }
  if (bracket.thirdPlaceMatch?.matchNumber === matchNumber) return bracket.thirdPlaceMatch;
  return null;
}

/** Locate a match by internal id (delegates to the format service). */
function findMatchById(bracket, matchId) {
  return getServiceForBracket(bracket).findMatch(bracket, matchId);
}

/**
 * Valid series scores for a best-of: the winner takes ceil(bo/2) games,
 * the loser anywhere from 0 to floor(bo/2). Bo3 → 2-0, 2-1; Bo5 → 3-0..3-2.
 */
function validSeriesScores(bestOf) {
  const need = Math.ceil(bestOf / 2);
  const scores = [];
  for (let l = 0; l < need; l++) scores.push(`${need}-${l}`);
  return scores;
}

/**
 * Validate + normalize a reported score for the tournament's best-of.
 * Bo1: score optional and free-form (map scores like 16-14 allowed).
 * Bo>1: score required, must be a valid series result, normalized winner-first.
 * Returns { ok: true, score } or { ok: false, error } (error has no ❌ prefix —
 * each surface adds its own framing).
 */
function normalizeSeriesScore(score, bestOf) {
  // whitespace-only counts as "no score provided"
  let normalized = score && String(score).trim() ? String(score).trim() : null;
  if (normalized && !/^\d{1,3}-\d{1,3}$/.test(normalized)) {
    return { ok: false, error: 'Invalid score format. Use format like `2-1` or `16-14`.' };
  }
  const bo = bestOf || 1;
  if (bo > 1) {
    const valid = validSeriesScores(bo);
    if (!normalized) {
      return { ok: false, error: `This is a **Best of ${bo}** — include the series score: ${valid.map(s => `\`${s}\``).join(' or ')}` };
    }
    const [a, b] = normalized.split('-').map(Number);
    normalized = `${Math.max(a, b)}-${Math.min(a, b)}`;
    if (!valid.includes(normalized)) {
      return { ok: false, error: `\`${score}\` isn't a valid Best of ${bo} result. Valid scores: ${valid.map(s => `\`${s}\``).join(', ')}` };
    }
  }
  return { ok: true, score: normalized };
}

/**
 * Flatten every match in a bracket with its section + round context.
 * Sections: 'bracket' (SE/Swiss/RR rounds), 'winners' | 'losers' |
 * 'grand_finals' (DE), 'third_place'. Battle Royale has no matches → [].
 */
function listAllMatches(bracket) {
  const out = [];
  if (!bracket || bracket.type === 'battle_royale') return out;

  if (bracket.type === 'double_elimination') {
    for (const [section, rounds] of [
      ['winners', bracket.winnersRounds],
      ['losers', bracket.losersRounds],
      ['grand_finals', bracket.grandFinalsRounds],
    ]) {
      for (const round of rounds || []) {
        for (const match of round.matches || []) {
          out.push({ match, section, round: round.round ?? round.roundNumber ?? null, roundName: round.name || null });
        }
      }
    }
    return out;
  }

  for (const round of bracket.rounds || []) {
    for (const match of round.matches || []) {
      out.push({ match, section: 'bracket', round: round.round ?? round.roundNumber ?? null, roundName: round.name || null });
    }
  }
  if (bracket.thirdPlaceMatch) {
    out.push({ match: bracket.thirdPlaceMatch, section: 'third_place', round: null, roundName: 'Third Place' });
  }
  return out;
}

module.exports = {
  getServiceForBracket,
  findMatchByNumber,
  findMatchById,
  validSeriesScores,
  normalizeSeriesScore,
  listAllMatches,
};
