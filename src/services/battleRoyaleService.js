// Battle Royale engine v2 — config-driven scoring, single/multi-lobby stages,
// derived standings, corrections.
//
// Design rules (docs/BR-V2-PLAN.md):
//   • Scoring lives in config ({placementPoints, killPoints, killMultipliers})
//     resolved from the game preset at creation — identical points in a 15-team
//     and a 20-team lobby (v1 scored relative to lobby size, which was unfair
//     across uneven groups).
//   • Standings are ALWAYS recomputed from each game's raw inputs
//     (reported placements + kills). Nothing is incrementally mutated, so
//     corrections are a re-report + recompute, and double-counting can't happen.
//   • ≤ lobbySize entrants → ONE lobby, no finals stage (v1 pointlessly sent
//     half of a single lobby to a "finals" against the same teams).
//   • Multi-lobby → groups play gamesPerStage games, top advancingPerGroup per
//     group advance to Grand Finals. Auto advancing = fill one finals lobby.
//
// The bracket object keeps v1's field names (groups, finals, currentStage,
// gamesPerStage…) so existing embeds/persistence stay compatible.

const { v4: uuidv4 } = require('uuid');

// ============================================================================
// Scoring models
// ----------------------------------------------------------------------------
// A model is {label, placementPoints, killPoints, killMultipliers}.
//   placementPoints[i] = points for placement i+1; placements past the end of
//   the table score the LAST entry (normally 0).
//   killPoints         = flat points per kill (0 = placement-only).
//   killMultipliers    = [{upTo, x}] — kill points become kills × x where x is
//   the multiplier band for the team's placement (Warzone model). Overrides
//   killPoints when present.
// ============================================================================

const BR_SCORING_MODELS = {
  // Apex — ALGS official: 12/9/7/5/4/3/3/2/2/2/1×5, +1 per kill
  algs: {
    label: 'ALGS (placement + kills)',
    placementPoints: [12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 0],
    killPoints: 1,
    killMultipliers: null,
  },
  // PUBG — SUPER ruleset: 10/6/5/4/3/2/1/1/0…, +1 per kill
  super: {
    label: 'SUPER (placement + kills)',
    placementPoints: [10, 6, 5, 4, 3, 2, 1, 1, 0],
    killPoints: 1,
    killMultipliers: null,
  },
  // Warzone — kills × placement multiplier (1st 1.6× … 11th+ 1.0×)
  warzone: {
    label: 'Kill multiplier (Warzone)',
    placementPoints: [0],
    killPoints: 1,
    killMultipliers: [
      { upTo: 1, x: 1.6 },
      { upTo: 2, x: 1.5 },
      { upTo: 3, x: 1.4 },
      { upTo: 5, x: 1.3 },
      { upTo: 7, x: 1.2 },
      { upTo: 10, x: 1.1 },
    ],
  },
  // Pure kill race — placement irrelevant
  kill_race: {
    label: 'Kill race',
    placementPoints: [0],
    killPoints: 1,
    killMultipliers: null,
  },
  // Placement only — generic default for Custom BR games
  placement: {
    label: 'Placement points',
    placementPoints: [10, 7, 5, 4, 3, 2, 1, 0],
    killPoints: 0,
    killMultipliers: null,
  },
};

/** Resolve the scoring config from tournament settings (preset-seeded). */
function resolveScoring(settings = {}) {
  if (settings.brScoring && Array.isArray(settings.brScoring.placementPoints)) {
    return {
      model: settings.brScoring.model || 'custom',
      label: settings.brScoring.label
        || BR_SCORING_MODELS[settings.brScoring.model]?.label
        || 'Custom scoring',
      placementPoints: settings.brScoring.placementPoints,
      killPoints: settings.brScoring.killPoints ?? 0,
      killMultipliers: settings.brScoring.killMultipliers || null,
    };
  }
  const key = BR_SCORING_MODELS[settings.brScoringModel] ? settings.brScoringModel : 'placement';
  return { model: key, ...BR_SCORING_MODELS[key] };
}

function placementPointsFor(scoring, placement) {
  const table = scoring.placementPoints;
  if (!table.length) return 0;
  return table[Math.min(placement, table.length) - 1];
}

function killMultiplierFor(scoring, placement) {
  if (!scoring.killMultipliers) return null;
  for (const band of scoring.killMultipliers) {
    if (placement <= band.upTo) return band.x;
  }
  return 1.0;
}

/** Points for one team in one game. Placement null = auto-filled (shares the
 *  averaged points of all unclaimed placements — see computeGameResults). */
function scoreFor(scoring, placement, kills) {
  const base = placementPointsFor(scoring, placement);
  const mult = killMultiplierFor(scoring, placement);
  const killScore = mult != null ? kills * mult : kills * scoring.killPoints;
  return round1(base + killScore);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ============================================================================
// Bracket generation
// ============================================================================

/** Unbiased Fisher-Yates (v1 used sort(() => Math.random() - 0.5), which is
 *  biased and non-uniform). */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Snake-seed teams across groups: 1→A, 2→B, 3→B, 4→A … keeps groups even. */
function snakeSeed(teams, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  let g = 0, dir = 1;
  for (const team of teams) {
    groups[g].push(team);
    g += dir;
    if (g === groupCount) { g = groupCount - 1; dir = -1; }
    else if (g === -1) { g = 0; dir = 1; }
  }
  return groups;
}

function makeGames(count) {
  const games = [];
  for (let g = 1; g <= count; g++) {
    games.push({
      id: uuidv4(),
      gameNumber: g,
      status: 'pending',
      reported: [],   // teamIds in reported finish order (raw input)
      kills: {},      // teamId -> kills (raw input)
      results: [],    // derived per recompute: {teamId, placement, kills, points}
    });
  }
  return games;
}

function makeStage(id, name, teams, gamesCount) {
  return {
    id,
    name,
    teams,
    games: makeGames(gamesCount),
    standings: teams.map(team => emptyStanding(team)),
  };
}

function emptyStanding(team) {
  return { team, points: 0, kills: 0, wins: 0, gamesPlayed: 0, placements: [] };
}

/**
 * Generate a Battle Royale bracket.
 * @param {Array} participants  team/player objects
 * @param {Object} settings     tournament settings (lobbySize, gamesPerStage,
 *                              advancingPerGroup, seedingEnabled, brScoring…)
 */
function generateBracket(participants, settings = {}) {
  const teamCount = participants.length;
  if (teamCount < 2) throw new Error('Need at least 2 participants.');

  const lobbySize = Math.max(2, settings.lobbySize || 20);
  const gamesPerStage = Math.max(1, settings.gamesPerStage || 3);
  const groupCount = Math.ceil(teamCount / lobbySize);
  const singleLobby = groupCount === 1;

  // Auto advancing fills exactly one finals lobby; explicit values are clamped
  // so the finals never exceeds the lobby size.
  let advancingPerGroup = 0;
  if (!singleLobby) {
    const auto = Math.max(1, Math.floor(lobbySize / groupCount));
    advancingPerGroup = settings.advancingPerGroup
      ? Math.max(1, Math.min(settings.advancingPerGroup, Math.floor(lobbySize / groupCount)))
      : auto;
  }

  const seeded = settings.seedingEnabled && participants.some(p => p.seed != null);
  const ordered = seeded
    ? [...participants].sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9))
    : shuffle(participants);

  const buckets = singleLobby ? [ordered] : snakeSeed(ordered, groupCount);

  const groups = buckets.map((teams, i) => makeStage(
    uuidv4(),
    singleLobby ? 'Lobby' : `Group ${String.fromCharCode(65 + i)}`,
    teams,
    gamesPerStage
  ));

  const scoring = resolveScoring(settings);

  return {
    type: 'battle_royale',
    scoring,
    lobbySize,
    gamesPerStage,
    advancingPerGroup,
    singleLobby,
    totalAdvancing: singleLobby ? 0 : advancingPerGroup * groupCount,
    currentStage: 'groups',
    groups,
    finals: null,
  };
}

// ============================================================================
// Derived standings — the heart of v2
// ============================================================================

/**
 * Compute the full per-team results of one game from its raw inputs.
 * Reported teams take placements 1..n. Unreported teams are auto-filled: each
 * receives the AVERAGE of the remaining placement-point slots (fair share of
 * last place — v1 handed them arbitrary sequential placements).
 */
function computeGameResults(stage, game, scoring) {
  if (game.status !== 'complete') return [];

  const reportedSet = new Set(game.reported);
  const results = [];

  game.reported.forEach((teamId, idx) => {
    const kills = game.kills[teamId] || 0;
    results.push({
      teamId,
      placement: idx + 1,
      kills,
      points: scoreFor(scoring, idx + 1, kills),
    });
  });

  const unreported = stage.teams.filter(t => !reportedSet.has(t.id));
  if (unreported.length > 0) {
    const from = game.reported.length + 1;
    let sum = 0;
    for (let p = from; p < from + unreported.length; p++) {
      sum += placementPointsFor(scoring, p);
    }
    const shared = round1(sum / unreported.length);
    // Kill points still count individually for auto-filled teams; the
    // multiplier band is the first unclaimed placement for all of them.
    const mult = killMultiplierFor(scoring, from);
    for (const team of unreported) {
      const kills = game.kills[team.id] || 0;
      const killScore = mult != null ? kills * mult : kills * scoring.killPoints;
      results.push({
        teamId: team.id,
        placement: null, // shared last place
        kills,
        points: round1(shared + killScore),
      });
    }
  }

  return results;
}

/** Rebuild a stage's standings from scratch from its completed games. */
function recomputeStandings(bracket, stage) {
  const byId = new Map(stage.teams.map(t => [t.id, emptyStanding(t)]));

  for (const game of stage.games) {
    if (game.status !== 'complete') continue;
    game.results = computeGameResults(stage, game, bracket.scoring);
    for (const r of game.results) {
      const s = byId.get(r.teamId);
      if (!s) continue; // team moved/removed — result ignored
      s.points = round1(s.points + r.points);
      s.kills += r.kills;
      s.gamesPlayed++;
      s.placements.push(r.placement ?? stage.teams.length);
      if (r.placement === 1) s.wins++;
    }
  }

  stage.standings = [...byId.values()].sort(compareStandings);
}

/** Points → wins → kills → best single placement → name (stable). */
function compareStandings(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.kills !== a.kills) return b.kills - a.kills;
  const bestA = a.placements.length ? Math.min(...a.placements) : Infinity;
  const bestB = b.placements.length ? Math.min(...b.placements) : Infinity;
  if (bestA !== bestB) return bestA - bestB;
  const nameA = a.team.name || a.team.username || '';
  const nameB = b.team.name || b.team.username || '';
  return nameA.localeCompare(nameB);
}

// ============================================================================
// Reporting + corrections
// ============================================================================

/** Validate raw report inputs against a stage. Throws with a clear message. */
function validateReport(stage, placements, kills) {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new Error('No placements provided.');
  }
  const valid = new Set(stage.teams.map(t => t.id));
  const seen = new Set();
  for (const id of placements) {
    if (!valid.has(id)) throw new Error('Placement list contains a team that is not in this lobby.');
    if (seen.has(id)) throw new Error('Placement list contains the same team twice.');
    seen.add(id);
  }
  if (kills) {
    for (const [id, n] of Object.entries(kills)) {
      if (!valid.has(id)) throw new Error('Kills list contains a team that is not in this lobby.');
      if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error('Kills must be a whole number between 0 and 999.');
    }
  }
}

function getStage(bracket, groupId) {
  if (groupId === 'finals') return bracket.finals;
  return bracket.groups.find(g => g.id === groupId) || null;
}

/**
 * Report a game's results (first report — game must be pending).
 * @param placements  teamIds in finish order (top-N is fine; rest auto-fill)
 * @param kills       optional {teamId: kills}
 * @returns {{stage, game, stageComplete, finalsCreated, tournamentComplete}}
 */
function reportGameResults(bracket, groupId, gameNumber, placements, kills = {}) {
  const stage = getStage(bracket, groupId);
  if (!stage) throw new Error('Lobby not found.');

  const game = stage.games.find(g => g.gameNumber === gameNumber);
  if (!game) throw new Error(`Game ${gameNumber} not found.`);
  if (game.status === 'complete') {
    throw new Error(`Game ${gameNumber} is already reported — use the correction flow to change it.`);
  }

  validateReport(stage, placements, kills);

  game.reported = [...placements];
  game.kills = { ...kills };
  game.status = 'complete';
  recomputeStandings(bracket, stage);

  return applyStageTransitions(bracket, stage, game);
}

/**
 * Correct an already-reported game (placements and/or kills).
 * Group-stage games can be corrected until the finals have a completed game —
 * a correction while the finals roster is still fresh regenerates it.
 */
function correctGameResults(bracket, groupId, gameNumber, placements, kills = {}) {
  const stage = getStage(bracket, groupId);
  if (!stage) throw new Error('Lobby not found.');

  const game = stage.games.find(g => g.gameNumber === gameNumber);
  if (!game) throw new Error(`Game ${gameNumber} not found.`);
  if (game.status !== 'complete') throw new Error(`Game ${gameNumber} has no result yet — report it first.`);

  const isGroupStage = groupId !== 'finals' && !bracket.singleLobby;
  const finalsStarted = bracket.finals?.games.some(g => g.status === 'complete');
  if (isGroupStage && bracket.finals && finalsStarted) {
    throw new Error('Group results can no longer be corrected — the Grand Finals already have reported games.');
  }

  validateReport(stage, placements, kills);

  game.reported = [...placements];
  game.kills = { ...kills };
  recomputeStandings(bracket, stage);

  // Group correction while finals exist but are untouched → roster may change
  let finalsRegenerated = false;
  if (isGroupStage && bracket.finals && !finalsStarted) {
    const oldChannelId = bracket.finals.channelId;
    createFinals(bracket);
    bracket.finals.channelId = oldChannelId; // keep the existing lobby room
    finalsRegenerated = true;
  }

  return { stage, game, finalsRegenerated };
}

/** Add/replace kills on a completed game without touching placements. */
function setKills(bracket, groupId, gameNumber, kills) {
  const stage = getStage(bracket, groupId);
  if (!stage) throw new Error('Lobby not found.');
  const game = stage.games.find(g => g.gameNumber === gameNumber);
  if (!game) throw new Error(`Game ${gameNumber} not found.`);
  if (game.status !== 'complete') throw new Error(`Game ${gameNumber} has no result yet — report placements first.`);

  validateReport(stage, game.reported, kills);
  game.kills = { ...game.kills, ...kills };
  recomputeStandings(bracket, stage);
  return { stage, game };
}

/** Stage transitions after a report: groups→finals, finals→complete. */
function applyStageTransitions(bracket, stage, game) {
  let finalsCreated = false;
  let tournamentComplete = false;

  const stageComplete = stage.games.every(g => g.status === 'complete');

  if (stageComplete && bracket.currentStage === 'groups') {
    const allGroupsComplete = bracket.groups.every(group =>
      group.games.every(g => g.status === 'complete'));
    if (allGroupsComplete) {
      if (bracket.singleLobby) {
        bracket.currentStage = 'complete';
        tournamentComplete = true;
      } else {
        createFinals(bracket);
        bracket.currentStage = 'finals';
        finalsCreated = true;
      }
    }
  } else if (stageComplete && bracket.currentStage === 'finals') {
    bracket.currentStage = 'complete';
    tournamentComplete = true;
  }

  return { stage, game, stageComplete, finalsCreated, tournamentComplete };
}

/** Build (or rebuild) the Grand Finals from current group standings. */
function createFinals(bracket) {
  const qualified = [];
  for (const group of bracket.groups) {
    for (const s of group.standings.slice(0, bracket.advancingPerGroup)) {
      qualified.push({
        ...s.team,
        qualifiedFrom: group.name,
        groupPoints: s.points,
      });
    }
  }
  // Seed the finals lobby by group-stage points (best first)
  qualified.sort((a, b) => b.groupPoints - a.groupPoints);

  bracket.finals = makeStage('finals', 'Grand Finals', qualified, bracket.gamesPerStage);
}

// ============================================================================
// Lobby management
// ============================================================================

/**
 * Move a team to another group. Only before any game in EITHER group has been
 * reported — lobby composition is part of every completed game's raw input.
 */
function moveTeam(bracket, teamId, targetGroupId) {
  if (bracket.currentStage !== 'groups') throw new Error('Lobbies can only be changed during the group stage.');

  const from = bracket.groups.find(g => g.teams.some(t => t.id === teamId));
  const to = bracket.groups.find(g => g.id === targetGroupId);
  if (!from) throw new Error('Team not found in any lobby.');
  if (!to) throw new Error('Target lobby not found.');
  if (from.id === to.id) return { from, to };

  const played = [...from.games, ...to.games].some(g => g.status === 'complete');
  if (played) throw new Error('Lobbies can no longer be changed — games have already been reported.');
  if (to.teams.length >= bracket.lobbySize) throw new Error(`${to.name} is already full (${bracket.lobbySize} max).`);

  const team = from.teams.find(t => t.id === teamId);
  from.teams = from.teams.filter(t => t.id !== teamId);
  to.teams.push(team);
  recomputeStandings(bracket, from);
  recomputeStandings(bracket, to);
  return { from, to };
}

// Kept for API compatibility with v1 callers; now implemented via moveTeam.
function assignTeamsToGroups(bracket, assignments) {
  for (const [groupId, teamIds] of Object.entries(assignments || {})) {
    for (const teamId of teamIds) moveTeam(bracket, teamId, groupId);
  }
  return bracket;
}

// ============================================================================
// Queries (shapes kept v1-compatible for embeds/persistence)
// ============================================================================

function getActiveMatches(bracket) {
  const active = [];
  const pushStage = (stage, groupId, groupName) => {
    for (const game of stage.games) {
      if (game.status === 'pending') {
        active.push({ ...game, groupId, groupName, teamCount: stage.teams.length });
      }
    }
  };

  if (bracket.currentStage === 'groups') {
    for (const group of bracket.groups) pushStage(group, group.id, group.name);
  } else if (bracket.currentStage === 'finals' && bracket.finals) {
    pushStage(bracket.finals, 'finals', bracket.finals.name);
  }
  return active;
}

function isComplete(bracket) {
  return bracket.currentStage === 'complete';
}

function getResults(bracket) {
  if (!isComplete(bracket)) return null;
  // Single lobby: the lone group IS the final standings.
  const standings = bracket.singleLobby
    ? bracket.groups[0].standings
    : bracket.finals?.standings || [];

  return {
    winner: standings[0]?.team || null,
    runnerUp: standings[1]?.team || null,
    thirdPlace: standings[2]?.team || null,
    standings,
  };
}

function getStandings(bracket) {
  return {
    currentStage: bracket.currentStage,
    singleLobby: !!bracket.singleLobby,
    scoring: bracket.scoring,
    advancingPerGroup: bracket.advancingPerGroup,
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
  };
}

function getGroup(bracket, groupId) {
  return getStage(bracket, groupId);
}

function findMatch(bracket, gameId) {
  for (const group of bracket.groups) {
    const game = group.games.find(g => g.id === gameId);
    if (game) return { game, groupId: group.id, groupName: group.name };
  }
  if (bracket.finals) {
    const game = bracket.finals.games.find(g => g.id === gameId);
    if (game) return { game, groupId: 'finals', groupName: bracket.finals.name };
  }
  return null;
}

module.exports = {
  BR_SCORING_MODELS,
  resolveScoring,
  scoreFor,
  generateBracket,
  reportGameResults,
  correctGameResults,
  setKills,
  moveTeam,
  assignTeamsToGroups,
  computeGameResults,
  recomputeStandings,
  getActiveMatches,
  isComplete,
  getResults,
  getStandings,
  getGroup,
  findMatch,
};
