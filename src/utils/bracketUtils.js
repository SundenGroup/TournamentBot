function getNextPowerOfTwo(n) {
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

/**
 * The best possible series score for a best-of: what a bye, walkover or
 * DQ forfeit is recorded as (Bo3 → "2-0", Bo5 → "3-0"). Bo1 has no series
 * score, so null.
 */
function bestScore(bestOf) {
  if (!bestOf || bestOf <= 1) return null;
  return `${Math.ceil(bestOf / 2)}-0`;
}

function calculateByes(participantCount, bracketSize) {
  return bracketSize - participantCount;
}

function getRoundName(roundNumber, totalRounds, isWinnersBracket = true) {
  const roundsFromFinal = totalRounds - roundNumber;

  if (roundsFromFinal === 0) {
    return isWinnersBracket ? 'Finals' : 'Losers Finals';
  }
  if (roundsFromFinal === 1) {
    return isWinnersBracket ? 'Semi-Finals' : 'Losers Semi-Finals';
  }
  if (roundsFromFinal === 2) {
    return isWinnersBracket ? 'Quarter-Finals' : 'Losers Quarter-Finals';
  }

  return isWinnersBracket ? `Round ${roundNumber}` : `Losers Round ${roundNumber}`;
}

module.exports = {
  getNextPowerOfTwo,
  calculateByes,
  getRoundName,
  bestScore,
};
