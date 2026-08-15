// Group Stage format: seeded groups of K play round robins, then the top X
// per group advance to a knockout playoff (single or double elimination) —
// or the event ends on group standings alone (playoffFormat 'none').
//
// Composition, not reimplementation: every group embeds a REAL round-robin
// bracket and the playoff embeds a REAL single/double-elim bracket; this
// service routes match operations to whichever sub-bracket owns the match.
// Match numbers are re-assigned globally (rooms and reporting key on them).
//
// The groups → playoffs transition is ADMIN-TRIGGERED (startPlayoffs), with a
// re-seeding window: if an admin has given every qualifier a distinct seed
// 1..Q before pressing the button, that order builds the playoff bracket;
// otherwise the standard convention applies (group winners seeded first in
// group order, then runners-up, and so on — which also guarantees two players
// from the same group can't meet in playoff round one).

const roundRobin = require('./roundRobinService');
const singleElim = require('./singleEliminationService');
const doubleElim = require('./doubleEliminationService');
const { generateSeedOrder } = require('../utils/seedingUtils');

const GROUP_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function snakeSeed(ordered, groupCount) {
  const buckets = Array.from({ length: groupCount }, () => []);
  let g = 0, dir = 1;
  for (const p of ordered) {
    buckets[g].push(p);
    g += dir;
    if (g === groupCount) { g = groupCount - 1; dir = -1; }
    else if (g === -1) { g = 0; dir = 1; }
  }
  return buckets;
}

function orderBySeed(participants) {
  return [...participants].sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return 0; // unseeded keep signup order (sort is stable)
  });
}

// Recursive renumber: assigns sequential matchNumbers to every match node
function renumber(node, counter) {
  if (Array.isArray(node)) {
    for (const v of node) counter = renumber(v, counter);
    return counter;
  }
  if (node && typeof node === 'object') {
    if ('matchNumber' in node && 'id' in node) node.matchNumber = ++counter.n;
    for (const key of Object.keys(node)) {
      if (key === 'participant1' || key === 'participant2' || key === 'winner' || key === 'loser') continue;
      counter = renumber(node[key], counter);
    }
  }
  return counter;
}

function generateBracket(participants, settings) {
  if (participants.length < 4) {
    throw new Error('A group stage needs at least 4 participants.');
  }
  const groupSize = Math.max(2, parseInt(settings.groupSize, 10) || 4);
  const groupCount = Math.ceil(participants.length / groupSize);
  const playoffFormat = ['single_elimination', 'double_elimination', 'none'].includes(settings.playoffFormat)
    ? settings.playoffFormat : 'single_elimination';

  const buckets = snakeSeed(orderBySeed(participants), groupCount);
  const smallest = Math.min(...buckets.map(b => b.length));
  if (smallest < 2) {
    throw new Error(`These settings leave a group with a single player — use a smaller group size or more players.`);
  }

  let advancingPerGroup = 0;
  if (playoffFormat !== 'none') {
    advancingPerGroup = Math.max(1, parseInt(settings.advancingPerGroup, 10) || 2);
    // Can't advance more than the smallest group holds
    advancingPerGroup = Math.min(advancingPerGroup, smallest);
    if (groupCount * advancingPerGroup < 2) {
      throw new Error('Playoffs need at least 2 qualifiers — raise advancing-per-group or add players.');
    }
  }

  const groups = buckets.map((bucket, i) => ({
    key: GROUP_KEYS[i] || String(i + 1),
    name: `Group ${GROUP_KEYS[i] || i + 1}`,
    bracket: roundRobin.generateBracket(bucket, settings),
  }));

  const counter = { n: 0 };
  for (const g of groups) {
    renumber(g.bracket.rounds, counter);
    // Match rooms and embeds show match.roundName — carry the group in it
    // ("Group A · Round 2") so players always know which group they're in.
    for (const round of g.bracket.rounds) {
      const rn = round.round ?? round.roundNumber;
      for (const m of round.matches) m.roundName = `${g.name} · Round ${rn}`;
    }
  }

  return {
    type: 'group_stage',
    stage: 'groups', // 'groups' | 'playoffs'
    groupSize,
    groupCount,
    advancingPerGroup,
    playoffFormat,
    groups,
    playoffs: null,
    nextMatchNumber: counter.n + 1,
  };
}

// ── Ownership routing ───────────────────────────────────────────────────────

function playoffEngine(bracket) {
  return bracket.playoffFormat === 'double_elimination' ? doubleElim : singleElim;
}

function owningGroup(bracket, matchId) {
  for (const g of bracket.groups) {
    if (roundRobin.findMatch(g.bracket, matchId)) return g;
  }
  return null;
}

function findMatch(bracket, matchId) {
  const g = owningGroup(bracket, matchId);
  if (g) return roundRobin.findMatch(g.bracket, matchId);
  if (bracket.playoffs) return playoffEngine(bracket).findMatch(bracket.playoffs, matchId);
  return null;
}

function advanceWinner(bracket, matchId, winnerId, score = null, goals = null) {
  const g = owningGroup(bracket, matchId);
  if (g) {
    if (bracket.playoffs) throw new Error('Group results are locked once the playoffs have started.');
    roundRobin.advanceWinner(g.bracket, matchId, winnerId, score, goals);
    return bracket;
  }
  if (bracket.playoffs && playoffEngine(bracket).findMatch(bracket.playoffs, matchId)) {
    playoffEngine(bracket).advanceWinner(bracket.playoffs, matchId, winnerId, score);
    return bracket;
  }
  throw new Error('Match not found');
}

function correctResult(bracket, matchId, newWinnerId, newScore = null, newGoals = null) {
  const g = owningGroup(bracket, matchId);
  if (g) {
    if (bracket.playoffs) throw new Error('Group results are locked once the playoffs have started.');
    roundRobin.correctResult(g.bracket, matchId, newWinnerId, newScore, newGoals);
    return bracket;
  }
  if (bracket.playoffs && playoffEngine(bracket).findMatch(bracket.playoffs, matchId)) {
    playoffEngine(bracket).correctResult(bracket.playoffs, matchId, newWinnerId, newScore);
    return bracket;
  }
  throw new Error('Match not found');
}

function getActiveMatches(bracket) {
  if (bracket.stage === 'playoffs' && bracket.playoffs) {
    return playoffEngine(bracket).getActiveMatches(bracket.playoffs);
  }
  return bracket.groups.flatMap(g => roundRobin.getActiveMatches(g.bracket));
}

// ── Stage state ─────────────────────────────────────────────────────────────

function groupsComplete(bracket) {
  return bracket.groups.every(g => roundRobin.isComplete(g.bracket));
}

function isComplete(bracket) {
  if (bracket.playoffFormat === 'none') return groupsComplete(bracket);
  return bracket.playoffs ? playoffEngine(bracket).isComplete(bracket.playoffs) : false;
}

/** Top advancingPerGroup per group, in standing order, tagged with origin. */
function qualifiers(bracket) {
  const out = [];
  for (const g of bracket.groups) {
    const standings = roundRobin.getStandings(g.bracket);
    standings.slice(0, bracket.advancingPerGroup).forEach((row, i) => {
      out.push({ participant: row.participant, group: g.key, position: i + 1 });
    });
  }
  return out;
}

/**
 * Admin-triggered transition. Default seeding is ALWAYS the convention —
 * position-major, group order — which guarantees no same-group meeting in
 * round one. Custom order is an EXPLICIT choice ({useCustomSeeds: true},
 * requiring distinct seeds 1..Q on the qualifiers): original tournament
 * seeds can coincidentally form a valid 1..Q set (snake groups + favorites
 * winning ⇒ qualifiers hold seeds 1..Q exactly), so it must never be
 * inferred from the values.
 */
function startPlayoffs(bracket, settings, { useCustomSeeds = false } = {}) {
  if (bracket.playoffFormat === 'none') throw new Error('This tournament ends after the group stage — there are no playoffs.');
  if (bracket.playoffs) throw new Error('The playoffs have already started.');
  if (!groupsComplete(bracket)) {
    const open = bracket.groups.filter(g => !roundRobin.isComplete(g.bracket)).map(g => g.name);
    throw new Error(`All group matches must be reported first — still open: ${open.join(', ')}.`);
  }

  const qs = qualifiers(bracket);

  let seeded;
  if (useCustomSeeds) {
    const seeds = qs.map(q => q.participant.seed).filter(s => Number.isInteger(s));
    const valid = seeds.length === qs.length && new Set(seeds).size === qs.length
      && Math.min(...seeds) === 1 && Math.max(...seeds) === qs.length;
    if (!valid) {
      throw new Error(`Custom playoff seeding needs every qualifier to have a distinct seed 1–${qs.length}. Fix the seeds (Seeding tab / CSV) or start with standard seeding.`);
    }
    seeded = qs.map(q => ({ ...q.participant }));
  } else {
    const g = bracket.groups.length;
    const N = qs.length;
    // Mirror-cross template for the classic top-2 shape (full power-of-two
    // bracket): each group winner meets the RUNNER-UP OF ITS MIRROR GROUP
    // (A↔H, B↔G, …), and a mirror pair's two matches land in opposite halves.
    // Every half then contains each group exactly once, so a same-group
    // rematch is impossible before the final. Seeds double as bracket
    // positions: winners carry 1..g, runners-up g+1..2g.
    if (bracket.advancingPerGroup === 2 && N === g * 2 && g >= 2 && (N & (N - 1)) === 0) {
      const winnersOrder = generateSeedOrder(g);   // winner seeds in match-slot order
      const topSorted = [...winnersOrder.slice(0, g / 2)].sort((a, b) => a - b);
      const botSorted = [...winnersOrder.slice(g / 2)].sort((a, b) => a - b);
      const winnerSeed = new Array(g);             // group index → playoff seed of its winner
      let ti = 0, bi = 0;
      for (let i = 0; i < g; i++) winnerSeed[i] = i % 2 === 0 ? topSorted[ti++] : botSorted[bi++];
      const groupIndex = new Map(bracket.groups.map((grp, i) => [grp.key, i]));
      seeded = qs.map(q => {
        const gi = groupIndex.get(q.group);
        const seed = q.position === 1
          ? winnerSeed[gi]
          : N + 1 - winnerSeed[g - 1 - gi];        // partner slot of the mirror group's winner
        return { ...q.participant, seed };
      });
    } else {
      // Fallback (top-1, top-3+, or non-power-of-two fields) — position-major:
      // all 1st places (group order), then all 2nd places, … Guarantees no
      // same-group meeting in round one.
      const ordered = [...qs].sort((a, b) =>
        a.position - b.position || bracket.groups.findIndex(gr => gr.key === a.group) - bracket.groups.findIndex(gr => gr.key === b.group));
      seeded = ordered.map((q, i) => ({ ...q.participant, seed: i + 1 }));
    }
  }

  const engine = playoffEngine(bracket);
  const po = engine.generateBracket(seeded, { ...settings, seedingEnabled: true });
  renumber(po, { n: bracket.nextMatchNumber - 1 });
  // Same clarity for playoff rooms: "Playoffs · Semifinals" etc.
  (function stamp(node) {
    if (Array.isArray(node)) { node.forEach(stamp); return; }
    if (node && typeof node === 'object') {
      if ('matchNumber' in node && 'id' in node && node.roundName && !String(node.roundName).startsWith('Playoffs')) {
        node.roundName = `Playoffs · ${node.roundName}`;
      }
      for (const k of Object.keys(node)) {
        if (k === 'participant1' || k === 'participant2' || k === 'winner' || k === 'loser') continue;
        stamp(node[k]);
      }
    }
  })(po);

  bracket.playoffs = po;
  bracket.stage = 'playoffs';

  return { qualifiers: qs, customSeeds: useCustomSeeds };
}

/**
 * Change what happens after the groups — allowed any time BEFORE the playoffs
 * are built (the setting only takes effect at the groups→playoffs transition).
 * Mutates both the live bracket and settings; the caller persists.
 */
function setPlayoffConfig(bracket, settings, { playoffFormat, advancingPerGroup }) {
  if (bracket?.type !== 'group_stage') throw new Error('This tournament has no group stage.');
  if (bracket.playoffs) {
    throw new Error('The playoffs are already built — rebuild them first (possible while no playoff result exists), then change the format.');
  }
  if (!['single_elimination', 'double_elimination', 'none'].includes(playoffFormat)) {
    throw new Error('Playoff format must be single elimination, double elimination, or none.');
  }

  const groupSize = settings.groupSize || bracket.groups?.[0]?.bracket?.standings?.length || 4;
  let adv = 0;
  if (playoffFormat !== 'none') {
    adv = parseInt(advancingPerGroup, 10);
    if (!Number.isInteger(adv) || adv < 1 || adv >= groupSize) {
      throw new Error(`Advancing per group must be between 1 and ${groupSize - 1}.`);
    }
    if (adv * bracket.groups.length < 2) throw new Error('At least 2 players must advance to play playoffs.');
  }

  bracket.playoffFormat = playoffFormat;
  bracket.advancingPerGroup = adv;
  settings.playoffFormat = playoffFormat;
  settings.advancingPerGroup = adv;
  return { playoffFormat, advancingPerGroup: adv };
}

/**
 * Tear a freshly built playoff bracket back down (re-seed window): only while
 * ZERO playoff matches have real results — byes don't count. Returns the
 * bracket to the groups-complete state so startPlayoffs can run again.
 */
function rebuildPlayoffs(bracket) {
  if (bracket?.type !== 'group_stage') throw new Error('This tournament has no group stage.');
  if (!bracket.playoffs) throw new Error('The playoffs have not been built yet — nothing to rebuild.');

  let decided = 0;
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if ('matchNumber' in node && 'id' in node && node.winner && !node.isBye && !node.isWalkover) decided++;
      for (const k of Object.keys(node)) {
        if (k === 'participant1' || k === 'participant2' || k === 'winner' || k === 'loser') continue;
        walk(node[k]);
      }
    }
  })(bracket.playoffs);
  if (decided > 0) {
    throw new Error(`Can't rebuild — ${decided} playoff match${decided === 1 ? ' already has a result' : 'es already have results'}. Use corrections instead.`);
  }

  delete bracket.playoffs;
  delete bracket.roomsPending;
  bracket.stage = 'groups';
  return true;
}

// ── Results / standings ─────────────────────────────────────────────────────

function getGroupStandings(bracket) {
  return bracket.groups.map(g => ({
    key: g.key,
    name: g.name,
    complete: roundRobin.isComplete(g.bracket),
    standings: roundRobin.getStandings(g.bracket),
  }));
}

function getResults(bracket) {
  if (!isComplete(bracket)) return null;
  if (bracket.playoffFormat === 'none') {
    // Groups-only: no single champion — results are the group tables
    const groups = getGroupStandings(bracket);
    return {
      winner: null,
      runnerUp: null,
      thirdPlace: null,
      standings: groups.flatMap(g => g.standings),
      groups,
      groupsOnly: true,
    };
  }
  const res = playoffEngine(bracket).getResults(bracket.playoffs);
  return res ? { ...res, groups: getGroupStandings(bracket) } : null;
}

module.exports = {
  generateBracket,
  advanceWinner,
  correctResult,
  findMatch,
  getActiveMatches,
  isComplete,
  getResults,
  // group-stage specific
  groupsComplete,
  qualifiers,
  startPlayoffs,
  setPlayoffConfig,
  rebuildPlayoffs,
  getGroupStandings,
};
