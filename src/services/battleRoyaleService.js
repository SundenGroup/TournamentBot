const { v4: uuidv4 } = require('uuid');

/**
 * Generate Battle Royale bracket with groups
 * @param {Array} participants - Array of team objects
 * @param {Object} settings - Tournament settings
 * @returns {Object} Battle Royale bracket structure
 */
function generateBracket(participants, settings) {
  const teamCount = participants.length;
  const lobbySize = settings.lobbySize || 20;
  const gamesPerStage = settings.gamesPerStage || 3;
  const advancingPerGroup = settings.advancingPerGroup || Math.floor(lobbySize / 2);

  if (teamCount < 2) {
    throw new Error('Need at least 2 teams');
  }

  // Calculate number of groups needed
  const groupCount = Math.ceil(teamCount / lobbySize);

  // Shuffle teams for random assignment
  const shuffled = [...participants].sort(() => Math.random() - 0.5);

  // Distribute teams into groups
  const groups = [];
  for (let i = 0; i < groupCount; i++) {
    const groupTeams = shuffled.slice(i * lobbySize, (i + 1) * lobbySize);

    // Initialize standings for each team in group
    const standings = groupTeams.map(team => ({
      team,
      points: 0,
      gamesPlayed: 0,
      placements: [], // Track individual game placements
    }));

    // Create empty games
    const games = [];
    for (let g = 1; g <= gamesPerStage; g++) {
      games.push({
        id: uuidv4(),
        gameNumber: g,
        status: 'pending',
        results: [],
      });
    }

    groups.push({
      id: uuidv4(),
      name: `Group ${String.fromCharCode(65 + i)}`, // Group A, B, C...
      teams: groupTeams,
      games,
      standings,
    });
  }

  // Calculate total teams advancing to finals
  const totalAdvancing = Math.min(
    advancingPerGroup * groupCount,
    teamCount
  );

  return {
    type: 'battle_royale',
    lobbySize,
    gamesPerStage,
    advancingPerGroup,
    totalAdvancing,
    currentStage: 'groups',
    groups,
    finals: null,
  };
}

/**
 * Report results for a game in a group or finals
 * @param {Object} bracket - Battle Royale bracket
 * @param {string} groupId - Group ID (or 'finals')
 * @param {number} gameNumber - Game number
 * @param {Array} placements - Array of team IDs in placement order (1st to last)
 * @returns {Object} Updated bracket
 */
function reportGameResults(bracket, groupId, gameNumber, placements) {
  let stage;

  if (groupId === 'finals') {
    if (!bracket.finals) {
      throw new Error('Finals have not started yet');
    }
    stage = bracket.finals;
  } else {
    stage = bracket.groups.find(g => g.id === groupId);
    if (!stage) {
      throw new Error('Group not found');
    }
  }

  const game = stage.games.find(g => g.gameNumber === gameNumber);
  if (!game) {
    throw new Error('Game not found');
  }

  if (game.status === 'complete') {
    throw new Error('Game results already reported');
  }

  const lobbySize = stage.teams.length;

  // Create results with points
  game.results = placements.map((teamId, index) => {
    const placement = index + 1;
    const points = Math.max(0, lobbySize - placement + 1);
    return {
      teamId,
      placement,
      points,
    };
  });

  game.status = 'complete';

  // Update standings
  for (const result of game.results) {
    const standing = stage.standings.find(s => s.team.id === result.teamId);
    if (standing) {
      standing.points += result.points;
      standing.gamesPlayed++;
      standing.placements.push(result.placement);
    }
  }

  // Sort standings by points (descending)
  stage.standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    // Tiebreaker: best single placement
    const bestA = Math.min(...a.placements);
    const bestB = Math.min(...b.placements);
    return bestA - bestB;
  });

  // Check if all games in groups are complete
  if (bracket.currentStage === 'groups') {
    const allGroupsComplete = bracket.groups.every(group =>
      group.games.every(g => g.status === 'complete')
    );

    if (allGroupsComplete) {
      // Auto-advance to finals
      advanceToFinals(bracket);
    }
  }

  // Check if finals complete
  if (bracket.currentStage === 'finals' && bracket.finals) {
    const allFinalsComplete = bracket.finals.games.every(g => g.status === 'complete');
    if (allFinalsComplete) {
      bracket.currentStage = 'complete';
    }
  }

  return bracket;
}

/**
 * Advance top teams from each group to finals
 * @param {Object} bracket - Battle Royale bracket
 */
function advanceToFinals(bracket) {
  const qualifiedTeams = [];

  // Get top N from each group
  for (const group of bracket.groups) {
    const topTeams = group.standings
      .slice(0, bracket.advancingPerGroup)
      .map(s => ({
        ...s.team,
        qualifiedFrom: group.name,
        groupPoints: s.points,
      }));
    qualifiedTeams.push(...topTeams);
  }

  // Create finals standings
  const finalsStandings = qualifiedTeams.map(team => ({
    team,
    points: 0,
    gamesPlayed: 0,
    placements: [],
  }));

  // Create finals games
  const finalsGames = [];
  for (let g = 1; g <= bracket.gamesPerStage; g++) {
    finalsGames.push({
      id: uuidv4(),
      gameNumber: g,
      status: 'pending',
      results: [],
    });
  }

  bracket.finals = {
    id: 'finals',
    name: 'Grand Finals',
    teams: qualifiedTeams,
    games: finalsGames,
    standings: finalsStandings,
  };

  bracket.currentStage = 'finals';
}

/**
 * Get active games that need results
 * @param {Object} bracket - Battle Royale bracket
 * @returns {Array} Active games with group info
 */
function getActiveMatches(bracket) {
  const active = [];

  if (bracket.currentStage === 'groups') {
    for (const group of bracket.groups) {
      for (const game of group.games) {
        if (game.status === 'pending') {
          active.push({
            ...game,
            groupId: group.id,
            groupName: group.name,
            teamCount: group.teams.length,
          });
        }
      }
    }
  } else if (bracket.currentStage === 'finals' && bracket.finals) {
    for (const game of bracket.finals.games) {
      if (game.status === 'pending') {
        active.push({
          ...game,
          groupId: 'finals',
          groupName: 'Grand Finals',
          teamCount: bracket.finals.teams.length,
        });
      }
    }
  }

  return active;
}

/**
 * Check if tournament is complete
 * @param {Object} bracket - Battle Royale bracket
 * @returns {boolean}
 */
function isComplete(bracket) {
  return bracket.currentStage === 'complete';
}

/**
 * Get final results
 * @param {Object} bracket - Battle Royale bracket
 * @returns {Object|null} Results object
 */
function getResults(bracket) {
  if (!isComplete(bracket)) return null;

  const standings = bracket.finals.standings;

  return {
    winner: standings[0]?.team || null,
    runnerUp: standings[1]?.team || null,
    thirdPlace: standings[2]?.team || null,
    standings: standings,
  };
}

/**
 * Get current standings for display
 * @param {Object} bracket - Battle Royale bracket
 * @returns {Object} Standings by stage
 */
function getStandings(bracket) {
  return {
    currentStage: bracket.currentStage,
    groups: bracket.groups.map(g => ({
      id: g.id,
      name: g.name,
      standings: g.standings,
      gamesComplete: g.games.filter(game => game.status === 'complete').length,
      totalGames: g.games.length,
    })),
    finals: bracket.finals ? {
      standings: bracket.finals.standings,
      gamesComplete: bracket.finals.games.filter(g => g.status === 'complete').length,
      totalGames: bracket.finals.games.length,
    } : null,
    advancingPerGroup: bracket.advancingPerGroup,
  };
}

/**
 * Get a specific group by ID
 * @param {Object} bracket - Battle Royale bracket
 * @param {string} groupId - Group ID
 * @returns {Object|null} Group object
 */
function getGroup(bracket, groupId) {
  if (groupId === 'finals') {
    return bracket.finals;
  }
  return bracket.groups.find(g => g.id === groupId) || null;
}

/**
 * Find match/game by ID
 * @param {Object} bracket - Battle Royale bracket
 * @param {string} gameId - Game ID
 * @returns {Object|null} Game with group info
 */
function findMatch(bracket, gameId) {
  for (const group of bracket.groups) {
    const game = group.games.find(g => g.id === gameId);
    if (game) {
      return { game, groupId: group.id, groupName: group.name };
    }
  }

  if (bracket.finals) {
    const game = bracket.finals.games.find(g => g.id === gameId);
    if (game) {
      return { game, groupId: 'finals', groupName: 'Grand Finals' };
    }
  }

  return null;
}

/**
 * Manually assign teams to groups
 * @param {Object} bracket - Battle Royale bracket
 * @param {Object} assignments - { groupId: [teamIds] }
 * @returns {Object} Updated bracket
 */
function assignTeamsToGroups(bracket, assignments) {
  // This would be used for admin manual assignment
  // For now, we use auto-random in generateBracket
  // Can be implemented later if needed
  throw new Error('Manual group assignment not yet implemented');
}

module.exports = {
  generateBracket,
  reportGameResults,
  getActiveMatches,
  isComplete,
  getResults,
  getStandings,
  getGroup,
  findMatch,
  assignTeamsToGroups,
};
