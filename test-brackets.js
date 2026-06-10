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

console.log('\n' + (failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
