// Rolling auto-archive sweeper (docs/CHANNEL-CAPACITY-PLAN.md Phase 3).
//
// `archiveAt` timestamps are PERSISTED on matches / BR stages inside the
// bracket JSON when a result is recorded, so pending archives survive
// restarts — this sweeper just looks for due ones every minute and runs the
// transcript+delete archive. Contested matches are skipped until an admin
// resolves them (which re-arms or clears the timestamp).

const { getAllRunningTournaments, updateTournament } = require('./tournamentService');
const { collectArchivables, archiveChannel } = require('./transcriptService');

const SWEEP_INTERVAL_MS = 60 * 1000;
let timer = null;

/** Pure selector — exported for tests. */
function collectDueArchives(tournament, now = Date.now()) {
  return collectArchivables(tournament).filter(item => {
    const ref = item.ref;
    if (!ref?.archiveAt || ref.contested) return false;
    return ref.archiveAt <= now;
  });
}

async function sweepOnce(client) {
  let tournaments;
  try {
    tournaments = await getAllRunningTournaments();
  } catch (error) {
    console.error('[archive-sweeper] query failed:', error.message);
    return;
  }

  for (const tournament of tournaments) {
    const due = collectDueArchives(tournament);
    if (due.length === 0) continue;

    const guild = client.guilds.cache.get(tournament.guildId);
    if (!guild) continue;

    let changed = false;
    for (const item of due) {
      try {
        const res = await archiveChannel({
          guild,
          tournament,
          matchKey: item.matchKey,
          matchLabel: item.matchLabel,
          channelId: item.channelId,
          participants: item.participants,
        });
        if (res.deleted || res.missing) {
          item.clear();
          item.ref.archiveAt = null;
          changed = true;
          if (res.deleted) {
            console.log(`[archive-sweeper] archived "${item.matchLabel}" (${res.messageCount} msgs) — ${tournament.title}`);
          }
        }
      } catch (error) {
        console.error(`[archive-sweeper] failed for ${item.matchLabel}:`, error.message);
      }
    }

    if (changed) {
      try {
        await updateTournament(tournament.id, { bracket: tournament.bracket });
      } catch (error) {
        console.error('[archive-sweeper] persist failed:', error.message);
      }
    }
  }
}

function startArchiveSweeper(client) {
  if (timer) return;
  timer = setInterval(() => {
    sweepOnce(client).catch(err => console.error('[archive-sweeper] sweep error:', err));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  console.log('Archive sweeper started (60s interval)');
}

module.exports = { startArchiveSweeper, sweepOnce, collectDueArchives };
