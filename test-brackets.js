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

console.log('\n' + (failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
