// Ad-hoc bracket engine test harness (not part of the bot runtime).
// Simulates full tournaments and asserts they always reach a single champion.
const single = require('./src/services/singleEliminationService');
const double = require('./src/services/doubleEliminationService');
const swiss = require('./src/services/swissService');
const rr = require('./src/services/roundRobinService');

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, username: `Player${i + 1}`, seed: i + 1 }));
}

// Play every active match (winner = participant1) until none remain, with a
// safety cap to catch deadlocks (the original double-elim bug).
function playOut(service, bracket, { genNext = false } = {}) {
  let guard = 0;
  while (true) {
    if (++guard > 100000) return { deadlock: true };
    let active = service.getActiveMatches(bracket);
    if (active.length === 0) {
      if (genNext && !service.isComplete(bracket) && service.isRoundComplete && service.isRoundComplete(bracket)) {
        try { service.generateNextRound(bracket); continue; } catch { break; }
      }
      break;
    }
    for (const m of active) {
      const winnerId = m.participant1.id;
      service.advanceWinner(bracket, m.id, winnerId, '2-0');
    }
  }
  return { deadlock: false };
}

console.log('=== SINGLE ELIMINATION ===');
for (const n of [2, 3, 4, 5, 6, 7, 8, 11, 13, 16, 23, 32]) {
  const b = single.generateBracket(makePlayers(n), {});
  const r = playOut(single, b);
  const done = single.isComplete(b);
  const res = single.getResults(b);
  check(!r.deadlock, `SE n=${n} deadlocked`);
  check(done, `SE n=${n} did not complete`);
  check(res && res.winner, `SE n=${n} no winner`);
  console.log(`  n=${n}: complete=${done} winner=${res?.winner?.id} 3rd=${res?.thirdPlace?.id ?? '—'}`);
}

console.log('=== SINGLE ELIM + THIRD PLACE MATCH ===');
for (const n of [3, 4, 5, 8, 13]) {
  const b = single.generateBracket(makePlayers(n), { thirdPlaceMatch: true });
  check(b.thirdPlaceMatch, `TP n=${n}: third place match missing`);
  const r = playOut(single, b);
  check(!r.deadlock, `TP n=${n} deadlocked`);
  check(single.isComplete(b), `TP n=${n} did not complete`);
  const res = single.getResults(b);
  check(res.thirdPlace && res.thirdPlace.id === b.thirdPlaceMatch.winner.id, `TP n=${n}: results.thirdPlace should be the TP match winner`);
  console.log(`  n=${n}: complete=true 3rd=${res.thirdPlace?.id} (played: ${b.thirdPlaceMatch.isWalkover ? 'walkover' : 'match'})`);
}
{
  // n=3: one semifinal is a bye → third place resolves by walkover and the
  // bye notifier should DM it
  const b = single.generateBracket(makePlayers(3), { thirdPlaceMatch: true });
  playOut(single, b);
  check(b.thirdPlaceMatch.isWalkover === true, 'TP n=3 should resolve by walkover');
  const { notifyByesAndWalkovers } = require('./src/utils/byeNotifier');
  const dms = [];
  const mockClient = { users: { fetch: async (id) => ({ send: async (m) => dms.push({ id, m }) }) } };
  notifyByesAndWalkovers(mockClient, { id: 'x', title: 'T', settings: { teamSize: 1 }, bracket: b }).then(() => {
    check(dms.some(d => d.m.includes('Walkover')), 'TP walkover should DM the third-place winner');
  });
}
{
  // n=2: too small for semis → no TP match even when requested
  const b = single.generateBracket(makePlayers(2), { thirdPlaceMatch: true });
  check(!b.thirdPlaceMatch, 'TP n=2 should not create a third place match');
}

console.log('=== DOUBLE ELIMINATION (the deadlock case) ===');
for (const n of [2, 3, 4, 5, 6, 7, 8, 11, 13, 16, 23, 32]) {
  const b = double.generateBracket(makePlayers(n), {});
  const r = playOut(double, b);
  const done = double.isComplete(b);
  const res = double.getResults(b);
  check(!r.deadlock, `DE n=${n} DEADLOCKED`);
  check(done, `DE n=${n} did not complete`);
  check(res && res.winner, `DE n=${n} no winner`);
  console.log(`  n=${n}: complete=${done} winner=${res?.winner?.id} runnerUp=${res?.runnerUp?.id ?? '—'} 3rd=${res?.thirdPlace?.id ?? '—'}`);
}

console.log('=== DOUBLE ELIM — LB champion wins (forces bracket reset) ===');
{
  // Play so that the WB finalist loses the grand finals → reset must trigger and resolve.
  const b = double.generateBracket(makePlayers(8), {});
  let guard = 0;
  while (!double.isComplete(b)) {
    if (++guard > 100000) { check(false, 'reset-path deadlock'); break; }
    const active = double.getActiveMatches(b);
    if (!active.length) break;
    for (const m of active) {
      // In grand finals, let the LB champion (participant2) win the first game to force a reset.
      let winnerId = m.participant1.id;
      if (m.bracket === 'grand_finals' && !m.isReset && m.participant2) winnerId = m.participant2.id;
      double.advanceWinner(b, m.id, winnerId, '2-1');
    }
  }
  check(double.isComplete(b), 'DE reset path did not complete');
  console.log(`  reset complete=${double.isComplete(b)} needsReset=${b.needsReset} winner=${double.getResults(b)?.winner?.id}`);
}

console.log('=== SWISS ===');
for (const n of [4, 5, 7, 8]) {
  const b = swiss.generateBracket(makePlayers(n), {});
  playOut(swiss, b, { genNext: true });
  const done = swiss.isComplete(b);
  check(done, `Swiss n=${n} did not complete`);
  // No player should receive more than one bye.
  const byeCounts = {};
  for (const round of b.rounds) for (const m of round.matches) if (m.isBye) byeCounts[m.winner.id] = (byeCounts[m.winner.id] || 0) + 1;
  const repeat = Object.entries(byeCounts).filter(([, c]) => c > 1);
  check(repeat.length === 0, `Swiss n=${n} gave repeat byes: ${JSON.stringify(repeat)}`);
  console.log(`  n=${n}: complete=${done} rounds=${b.rounds.length} byes=${JSON.stringify(byeCounts)}`);
}

console.log('=== ROUND ROBIN ===');
for (const n of [3, 4, 5, 6]) {
  const b = rr.generateBracket(makePlayers(n), {});
  playOut(rr, b);
  const done = rr.isComplete(b);
  const standings = rr.getStandings(b);
  check(done, `RR n=${n} did not complete`);
  check(standings.length === n, `RR n=${n} standings count ${standings.length}`);
  console.log(`  n=${n}: complete=${done} matches=${b.totalMatches} winner=${standings[0]?.participant.id}`);
}

console.log('=== DISQUALIFICATION ===');
{
  const { disqualify, resolvePendingDQs } = require('./src/services/disqualifyService');

  // SE: DQ player with an open match → opponent advances with best score
  const t = { settings: { teamSize: 1, bestOf: 3 }, participants: makePlayers(8), teams: [], bracket: single.generateBracket(makePlayers(8), { bestOf: 3 }) };
  const m1 = single.getActiveMatches(t.bracket)[0];
  const dqTarget = m1.participant1;
  const r = disqualify(t, dqTarget.id, 'no-show');
  check(r.forfeited === 1, `SE DQ should forfeit 1 match, got ${r.forfeited}`);
  check(m1.winner.id === m1.participant2.id && m1.isDQ && m1.score === '2-0', 'SE DQ: opponent should win 2-0 with isDQ');
  check(t.participants.find(p => p.id === dqTarget.id).disqualified, 'entrant should be flagged');
  playOut(single, t.bracket);
  check(single.isComplete(t.bracket), 'SE completes after DQ');
  console.log('  SE: forfeit 2-0 + flag + completes ✓');

  // SE pendingDQ: DQ player already advanced to a slot whose opponent is TBD
  const t2 = { settings: { teamSize: 1, bestOf: 3 }, participants: makePlayers(4), teams: [], bracket: single.generateBracket(makePlayers(4), { bestOf: 3 }) };
  const semi1 = t2.bracket.rounds[0].matches[0];
  single.advanceWinner(t2.bracket, semi1.id, semi1.participant1.id, '2-0'); // p in final, opponent TBD
  const advanced = semi1.participant1;
  const r2 = disqualify(t2, advanced.id);
  check(r2.pending === 1 && r2.forfeited === 0, `pendingDQ expected, got f=${r2.forfeited} p=${r2.pending}`);
  const semi2 = t2.bracket.rounds[0].matches[1];
  single.advanceWinner(t2.bracket, semi2.id, semi2.participant1.id, '2-1');
  const n = resolvePendingDQs(t2);
  check(n === 1, `resolvePendingDQs should forfeit 1, got ${n}`);
  check(single.isComplete(t2.bracket), 'final decided by DQ forfeit');
  console.log('  SE pendingDQ: forfeits when opponent arrives ✓');

  // DE: DQ removes player from winners AND losers bracket
  const t3 = { settings: { teamSize: 1, bestOf: 3 }, participants: makePlayers(8), teams: [], bracket: double.generateBracket(makePlayers(8), { bestOf: 3 }) };
  const wb1 = double.getActiveMatches(t3.bracket)[0];
  const dq3 = wb1.participant1;
  disqualify(t3, dq3.id);
  // play everything out; the DQ'd player must never win anything further
  let guard = 0;
  while (!double.isComplete(t3.bracket) && guard++ < 200) {
    const act = double.getActiveMatches(t3.bracket);
    if (!act.length) break;
    for (const m of act) double.advanceWinner(t3.bracket, m.id, m.participant1.id, '2-0');
    resolvePendingDQs(t3);
  }
  check(double.isComplete(t3.bracket), 'DE completes after DQ');
  const res3 = double.getResults(t3.bracket);
  check(res3.winner.id !== dq3.id && res3.runnerUp.id !== dq3.id, 'DQ player cannot podium');
  console.log('  DE: DQ propagates through losers bracket, completes ✓');

  // Swiss: DQ'd player excluded from future rounds
  const t4 = { settings: { teamSize: 1, bestOf: 1 }, participants: makePlayers(8), teams: [], bracket: swiss.generateBracket(makePlayers(8), { bestOf: 1 }) };
  const sm = swiss.getActiveMatches(t4.bracket)[0];
  const dq4 = sm.participant1;
  disqualify(t4, dq4.id);
  for (const m of swiss.getActiveMatches(t4.bracket)) swiss.advanceWinner(t4.bracket, m.id, m.participant1.id);
  swiss.generateNextRound(t4.bracket);
  const nextRound = t4.bracket.rounds[1];
  const paired = nextRound.matches.some(m => m.participant1?.id === dq4.id || m.participant2?.id === dq4.id);
  check(!paired, 'Swiss: DQ player must not be paired in next round');
  console.log('  Swiss: excluded from future pairings ✓');

  // RR: all remaining matches forfeited
  const t5 = { settings: { teamSize: 1, bestOf: 3 }, participants: makePlayers(4), teams: [], bracket: rr.generateBracket(makePlayers(4), { bestOf: 3 }) };
  const dq5 = t5.bracket.standings[0].participant;
  const r5 = disqualify(t5, dq5.id);
  check(r5.forfeited === 3, `RR: expected 3 forfeits (plays everyone), got ${r5.forfeited}`);
  console.log('  RR: all remaining matches forfeited ✓');
}

console.log('=== RESULT CORRECTION ===');
{
  // SE: correct before next match played
  const b = single.generateBracket(makePlayers(4), { bestOf: 3 });
  const m = b.rounds[0].matches[0];
  single.advanceWinner(b, m.id, m.participant1.id, '2-0'); // wrong winner
  single.correctResult(b, m.id, m.participant2.id, '2-1');
  check(m.winner.id === m.participant2.id && m.score === '2-1', 'SE corrected winner+score');
  const final = b.rounds[1].matches[0];
  check(final.participant1.id === m.participant2.id, 'SE: corrected winner re-propagated to final');
  // block when downstream played
  const m2 = b.rounds[0].matches[1];
  single.advanceWinner(b, m2.id, m2.participant1.id, '2-0');
  single.advanceWinner(b, final.id, final.participant1.id, '2-0');
  let blocked = false;
  try { single.correctResult(b, m2.id, m2.participant2.id, '2-1'); } catch { blocked = true; }
  check(blocked, 'SE: correction blocked when final already played');
  console.log('  SE: swap + re-propagate + downstream block ✓');

  // Swiss: current round correction swaps standings
  const sb = swiss.generateBracket(makePlayers(4), { bestOf: 1 });
  const sm = sb.rounds[0].matches[0];
  swiss.advanceWinner(sb, sm.id, sm.participant1.id);
  swiss.correctResult(sb, sm.id, sm.participant2.id);
  const w = sb.standings.find(s => s.participant.id === sm.participant2.id);
  const l = sb.standings.find(s => s.participant.id === sm.participant1.id);
  check(w.wins === 1 && w.losses === 0 && l.wins === 0 && l.losses === 1, 'Swiss standings swapped');
  console.log('  Swiss: standings recomputed ✓');

  // RR: correction swaps headToHead
  const rb = rr.generateBracket(makePlayers(4), { bestOf: 1 });
  const rm = rb.rounds[0].matches[0];
  rr.advanceWinner(rb, rm.id, rm.participant1.id);
  rr.correctResult(rb, rm.id, rm.participant2.id);
  const rw = rb.standings.find(s => s.participant.id === rm.participant2.id);
  check(rw.wins === 1 && rw.headToHead[rm.participant1.id] === 'win', 'RR standings + h2h swapped');
  console.log('  RR: standings + head-to-head swapped ✓');

  // DE: basic correction with unplayed downstream
  const db = double.generateBracket(makePlayers(4), { bestOf: 3 });
  const dm = db.winnersRounds[0].matches[0];
  double.advanceWinner(db, dm.id, dm.participant1.id, '2-0');
  double.correctResult(db, dm.id, dm.participant2.id, '2-1');
  check(dm.winner.id === dm.participant2.id, 'DE winner corrected');
  const wbFinal = db.winnersRounds[1].matches[0];
  check(wbFinal.participant1.id === dm.participant2.id, 'DE corrected winner in WB final slot');
  const lbMatch = db.losersRounds[0].matches[0];
  const lbHasOldLoser = lbMatch.participant1?.id === dm.participant1.id || lbMatch.participant2?.id === dm.participant1.id;
  check(lbHasOldLoser, 'DE corrected loser placed into losers bracket');
  console.log('  DE: winner/loser re-propagated ✓');
}

console.log('=== CORRECTION GUARDS + DE GF SAFEGUARD ===');
{
  // correction must refuse bye/walkover/DQ matches in every format
  for (const [name, svc, n] of [['SE', single, 5], ['DE', double, 5], ['Swiss', swiss, 5], ['RR', rr, 4]]) {
    const b = svc.generateBracket(makePlayers(n), { bestOf: 3 });
    // find a bye/walkover match that has a winner
    const all = [];
    if (b.rounds) for (const r of b.rounds) all.push(...r.matches);
    if (b.winnersRounds) for (const r of b.winnersRounds) all.push(...r.matches);
    const forfeit = all.find(m => (m.isBye || m.isWalkover) && m.winner);
    if (forfeit) {
      let blocked = false;
      try { svc.correctResult(b, forfeit.id, forfeit.winner.id, '2-0'); } catch { blocked = true; }
      check(blocked, `${name}: correcting a bye/walkover must be blocked`);
    }
  }
  console.log('  bye/walkover corrections blocked in all formats ✓');

  // DE: correcting a WB result must not deadlock the grand finals
  {
    const b = double.generateBracket(makePlayers(4), { bestOf: 3 });
    // play WB fully so both WB matches + the drop to LB happen
    const wb1 = b.winnersRounds[0].matches[0];
    const wb2 = b.winnersRounds[0].matches[1];
    double.advanceWinner(b, wb1.id, wb1.participant1.id, '2-0');
    double.advanceWinner(b, wb2.id, wb2.participant1.id, '2-0');
    // correct wb1 winner — must re-propagate without leaving GF unreachable
    double.correctResult(b, wb1.id, wb1.participant2.id, '2-1');
    // now play everything out and confirm it completes
    let guard = 0;
    while (!double.isComplete(b) && guard++ < 200) {
      const act = double.getActiveMatches(b);
      if (!act.length) break;
      for (const m of act) double.advanceWinner(b, m.id, m.participant1.id, '2-0');
    }
    check(double.isComplete(b), 'DE completes after a WB correction (no GF deadlock)');
    console.log('  DE WB correction → tournament still completes ✓');
  }
}

// ============================================================================
// BATTLE ROYALE v2
// ============================================================================
const br = require('./src/services/battleRoyaleService');

function makeTeams(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Team${i + 1}`, seed: i + 1 }));
}
/** Report every pending game with teams in lobby order (Team with lowest index wins). */
function playOutBR(bracket, killsFor = null) {
  let guard = 0;
  while (!br.isComplete(bracket) && guard++ < 1000) {
    const active = br.getActiveMatches(bracket);
    if (!active.length) break;
    for (const g of active) {
      const stage = br.getGroup(bracket, g.groupId);
      const order = stage.teams.map(t => t.id);
      br.reportGameResults(bracket, g.groupId, g.gameNumber, order, killsFor ? killsFor(order) : {});
    }
  }
}

console.log('=== BR: SINGLE LOBBY (no finals stage) ===');
{
  const b = br.generateBracket(makeTeams(16), { lobbySize: 20, gamesPerStage: 3, brScoringModel: 'super', seedingEnabled: true });
  check(b.singleLobby === true, 'BR 16/20: should be single lobby');
  check(b.groups.length === 1 && b.groups[0].name === 'Lobby', 'BR 16/20: one group named Lobby');
  check(b.finals === null, 'BR 16/20: no finals stage');
  playOutBR(b);
  check(br.isComplete(b), 'BR 16/20: completes after group games');
  check(b.finals === null, 'BR 16/20: still no finals after completion');
  const res = br.getResults(b);
  check(res.winner?.id === 't1', 'BR 16/20: winner from lobby standings');
  // SUPER: 3 wins = 30 pts
  check(res.standings[0].points === 30, `BR 16/20: winner has 30 pts (got ${res.standings[0].points})`);
  console.log(`  16 teams, lobby 20: single lobby, complete, winner=${res.winner.id} pts=${res.standings[0].points} ✓`);
}

console.log('=== BR: MULTI-LOBBY → FINALS ===');
{
  const b = br.generateBracket(makeTeams(40), { lobbySize: 20, gamesPerStage: 2, brScoringModel: 'super', seedingEnabled: true });
  check(b.groups.length === 2, 'BR 40/20: two groups');
  check(b.groups[0].teams.length === 20 && b.groups[1].teams.length === 20, 'BR 40/20: even snake split');
  check(b.advancingPerGroup === 10, `BR 40/20: auto advancing = 10 (got ${b.advancingPerGroup})`);
  // snake seeding: seed 1 → A, seed 2+3 → B, seed 4 → A
  check(b.groups[0].teams[0].id === 't1' && b.groups[1].teams[0].id === 't2' && b.groups[1].teams[1].id === 't3', 'BR 40/20: snake seed order');
  playOutBR(b);
  check(br.isComplete(b), 'BR 40/20: completes');
  check(b.finals && b.finals.teams.length === 20, 'BR 40/20: finals has 20 teams');
  check(b.finals.teams.every(t => t.qualifiedFrom), 'BR 40/20: finals teams carry qualifiedFrom');
  console.log(`  40 teams: 2 groups → finals(20) → complete, champion=${br.getResults(b).winner.id} ✓`);
}

console.log('=== BR: SCORING MODELS ===');
{
  // SUPER: 1st with 5 kills = 10 + 5
  check(br.scoreFor(br.BR_SCORING_MODELS.super, 1, 5) === 15, 'SUPER 1st+5k = 15');
  check(br.scoreFor(br.BR_SCORING_MODELS.super, 9, 2) === 2, 'SUPER 9th+2k = 2 (0 placement)');
  check(br.scoreFor(br.BR_SCORING_MODELS.super, 40, 0) === 0, 'SUPER 40th = 0 (past table)');
  // ALGS: 1st 12 (+1/kill), 10th = 2
  check(br.scoreFor(br.BR_SCORING_MODELS.algs, 1, 3) === 15, 'ALGS 1st+3k = 15');
  check(br.scoreFor(br.BR_SCORING_MODELS.algs, 10, 0) === 2, 'ALGS 10th = 2');
  // Warzone: pure kills × multiplier
  check(br.scoreFor(br.BR_SCORING_MODELS.warzone, 1, 10) === 16, 'WZ 1st 10k = 16');
  check(br.scoreFor(br.BR_SCORING_MODELS.warzone, 4, 10) === 13, 'WZ 4th 10k = 13 (1.3×)');
  check(br.scoreFor(br.BR_SCORING_MODELS.warzone, 30, 10) === 10, 'WZ 30th 10k = 10 (1.0×)');
  // kill race + placement-only
  check(br.scoreFor(br.BR_SCORING_MODELS.kill_race, 1, 7) === 7, 'Kill race = kills');
  check(br.scoreFor(br.BR_SCORING_MODELS.placement, 2, 9) === 7, 'Placement-only ignores kills');
  // Fairness: same points regardless of lobby size (the v1 uneven-groups bug)
  const b = br.generateBracket(makeTeams(25), { lobbySize: 20, gamesPerStage: 1, brScoringModel: 'super' });
  check(b.groups[0].teams.length === 13 && b.groups[1].teams.length === 12, 'BR 25/20: 13+12 split');
  for (const g of b.groups) br.reportGameResults(b, g.id, 1, g.teams.map(t => t.id));
  const p1 = b.groups[0].standings[0].points, p2 = b.groups[1].standings[0].points;
  check(p1 === p2 && p1 === 10, `BR uneven groups: both winners score 10 (got ${p1}/${p2})`);
  console.log('  SUPER/ALGS/Warzone/kill-race/placement exact + uneven-lobby fairness ✓');
}

console.log('=== BR: PARTIAL REPORT — UNPLACED SCORE 0 (+ KILLS) ===');
{
  const b = br.generateBracket(makeTeams(8), { lobbySize: 20, gamesPerStage: 1, brScoringModel: 'super' });
  const lobby = b.groups[0];
  // Report only top 3 — the other 5 get 0 placement points, kills still count
  br.reportGameResults(b, lobby.id, 1, ['t3', 't5', 't1'], { t7: 4 });
  const game = lobby.games[0];
  const filled = game.results.filter(r => r.placement === null);
  check(filled.length === 5, 'auto-fill: 5 unreported teams');
  check(filled.every(r => r.points === (r.teamId === 't7' ? 4 : 0)), `auto-fill: unplaced score 0 (+kills)`);
  check(Number.isInteger(lobby.standings.reduce((s, x) => s + x.points, 0)), 'auto-fill: no decimals with integer scoring');
  check(lobby.standings[0].team.id === 't3' && lobby.standings[0].points === 10, 'auto-fill: reported top intact');
  check(br.scoringDepth(br.BR_SCORING_MODELS.super) === 8, 'scoringDepth: SUPER = 8');
  check(br.scoringDepth(br.BR_SCORING_MODELS.algs) === 15, 'scoringDepth: ALGS = 15');
  check(br.scoringDepth(br.BR_SCORING_MODELS.warzone) === 0, 'scoringDepth: Warzone = 0');
  console.log('  top-3 report → unplaced 0 pts, kills counted, depths ok ✓');
}

console.log('=== BR: VALIDATION ===');
{
  const b = br.generateBracket(makeTeams(4), { lobbySize: 20, gamesPerStage: 2, brScoringModel: 'super' });
  const lobby = b.groups[0];
  let thrown = 0;
  try { br.reportGameResults(b, lobby.id, 1, ['t1', 't1', 't2']); } catch { thrown++; }
  try { br.reportGameResults(b, lobby.id, 1, ['t1', 'ghost']); } catch { thrown++; }
  try { br.reportGameResults(b, lobby.id, 1, []); } catch { thrown++; }
  try { br.reportGameResults(b, lobby.id, 1, ['t1', 't2'], { t1: -3 }); } catch { thrown++; }
  try { br.reportGameResults(b, lobby.id, 99, ['t1']); } catch { thrown++; }
  check(thrown === 5, `validation: 5 bad inputs rejected (got ${thrown})`);
  br.reportGameResults(b, lobby.id, 1, ['t1', 't2', 't3', 't4']);
  let dup = false;
  try { br.reportGameResults(b, lobby.id, 1, ['t2', 't1']); } catch { dup = true; }
  check(dup, 'validation: re-reporting a complete game is blocked');
  console.log('  duplicates/unknowns/empty/bad-kills/re-report all rejected ✓');
}

console.log('=== BR: CORRECTIONS ===');
{
  // Same-stage correction recomputes exactly (no double count)
  const b = br.generateBracket(makeTeams(4), { lobbySize: 20, gamesPerStage: 2, brScoringModel: 'super' });
  const lobby = b.groups[0];
  br.reportGameResults(b, lobby.id, 1, ['t1', 't2', 't3', 't4'], { t1: 2 });
  br.reportGameResults(b, lobby.id, 2, ['t1', 't2', 't3', 't4']);
  check(br.isComplete(b), 'BR corr: single lobby complete');
  check(b.groups[0].standings[0].team.id === 't1' && b.groups[0].standings[0].points === 22, 'BR corr: t1 leads 22');
  br.correctGameResults(b, lobby.id, 1, ['t4', 't3', 't2', 't1'], { t4: 1 });
  const s = b.groups[0].standings;
  check(s.find(x => x.team.id === 't1').points === 10 + 4, `BR corr: t1 recomputed to 14 (got ${s.find(x => x.team.id === 't1').points})`);
  check(s.find(x => x.team.id === 't4').points === 11 + 4, 'BR corr: t4 recomputed to 15');
  check(br.getResults(b).winner.id === 't4', 'BR corr: post-completion correction flips champion');

  // Group correction regenerates an untouched finals roster
  const b2 = br.generateBracket(makeTeams(8), { lobbySize: 4, gamesPerStage: 1, advancingPerGroup: 2, brScoringModel: 'super' });
  for (const g of b2.groups) br.reportGameResults(b2, g.id, 1, g.teams.map(t => t.id));
  check(b2.currentStage === 'finals' && b2.finals.teams.length === 4, 'BR corr: finals created (2×2)');
  const gA = b2.groups[0];
  const before = new Set(b2.finals.teams.map(t => t.id));
  const reversed = [...gA.teams.map(t => t.id)].reverse();
  const r = br.correctGameResults(b2, gA.id, 1, reversed);
  check(r.finalsRegenerated, 'BR corr: finals regenerated');
  const after = new Set(b2.finals.teams.map(t => t.id));
  check([...after].some(id => !before.has(id)), 'BR corr: finals roster changed');
  // After a finals game is reported, group corrections are locked
  br.reportGameResults(b2, 'finals', 1, b2.finals.teams.map(t => t.id));
  let locked = false;
  try { br.correctGameResults(b2, gA.id, 1, gA.teams.map(t => t.id)); } catch { locked = true; }
  check(locked, 'BR corr: group correction blocked once finals reported');
  console.log('  recompute-exact + finals regen + late-lock ✓');
}

console.log('=== BR: KILLS + LOBBY MOVES ===');
{
  const b = br.generateBracket(makeTeams(6), { lobbySize: 20, gamesPerStage: 2, brScoringModel: 'algs' });
  const lobby = b.groups[0];
  br.reportGameResults(b, lobby.id, 1, lobby.teams.map(t => t.id));
  br.setKills(b, lobby.id, 1, { [lobby.teams[1].id]: 4 });
  const s2 = lobby.standings.find(x => x.team.id === lobby.teams[1].id);
  check(s2.kills === 4 && s2.points === 9 + 4, `BR kills: 2nd +4 kills = 13 (got ${s2.points})`);

  const b3 = br.generateBracket(makeTeams(30), { lobbySize: 20, gamesPerStage: 1, brScoringModel: 'super' });
  const [g1, g2] = b3.groups;
  const mover = g1.teams[g1.teams.length - 1].id;
  br.moveTeam(b3, mover, g2.id);
  check(!g1.teams.some(t => t.id === mover) && g2.teams.some(t => t.id === mover), 'BR move: team switched lobbies');
  br.reportGameResults(b3, g1.id, 1, g1.teams.map(t => t.id));
  let moveBlocked = false;
  try { br.moveTeam(b3, g1.teams[0].id, g2.id); } catch { moveBlocked = true; }
  check(moveBlocked, 'BR move: blocked after a reported game');
  console.log('  setKills recompute + moveTeam guards ✓');
}

console.log('=== BR: ADVANCING CLAMP (3 groups) ===');
{
  const b = br.generateBracket(makeTeams(60), { lobbySize: 20, gamesPerStage: 1, advancingPerGroup: 10, brScoringModel: 'super' });
  check(b.groups.length === 3, 'BR 60/20: 3 groups');
  check(b.advancingPerGroup === 6, `BR 60/20: advancing clamped 10→6 (got ${b.advancingPerGroup})`);
  playOutBR(b);
  check(b.finals.teams.length === 18 && b.finals.teams.length <= b.lobbySize, 'BR 60/20: finals fits one lobby');
  console.log('  3×20 → advancing clamped to 6, finals=18 ✓');
}

console.log('\n' + (failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
