function generateSeedOrder(bracketSize) {
  // Generate standard seeding order for bracket placement
  // Ensures seed 1 and 2 can only meet in finals
  if (bracketSize === 2) return [1, 2];
  if (bracketSize === 4) return [1, 4, 2, 3];
  if (bracketSize === 8) return [1, 8, 4, 5, 2, 7, 3, 6];
  if (bracketSize === 16) return [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
  if (bracketSize === 32) {
    return [1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21,
            2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22];
  }

  // For larger brackets, generate algorithmically
  return generateSeedOrderRecursive(bracketSize);
}

function generateSeedOrderRecursive(size) {
  if (size === 2) return [1, 2];

  const half = size / 2;
  const previous = generateSeedOrderRecursive(half);
  const result = [];

  for (const seed of previous) {
    result.push(seed);
    result.push(size + 1 - seed);
  }

  return result;
}

function assignByes(seedOrder, participantCount) {
  // Higher seeds get byes first
  const byeCount = seedOrder.length - participantCount;
  const byePositions = new Set();

  for (let i = 0; i < byeCount; i++) {
    // Find position of seed (i+1) and give them a bye
    const seedToGetBye = i + 1;
    const position = seedOrder.indexOf(seedToGetBye);
    // The opponent position is either position+1 or position-1 depending on odd/even
    const opponentPosition = position % 2 === 0 ? position + 1 : position - 1;
    byePositions.add(opponentPosition);
  }

  return byePositions;
}

module.exports = {
  generateSeedOrder,
  assignByes,
};
