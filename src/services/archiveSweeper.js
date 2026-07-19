// Rolling auto-archive sweeper (docs/CHANNEL-CAPACITY-PLAN.md Phase 3).
//
// `archiveAt` timestamps are PERSISTED on matches / BR stages inside the
// bracket JSON when a result is recorded, so pending archives survive
// restarts — this sweeper just looks for due ones every minute and runs the
// transcript+delete archive. Contested matches are skipped until an admin
// resolves them (which re-arms or clears the timestamp).

const { getAllRunningTournaments, updateTournament } = require('./tournamentService');
const { getServerSettings } = require('../data/serverSettings');
const { collectArchivables, archiveChannel } = require('./transcriptService');

const SWEEP_INTERVAL_MS = 60 * 1000;
let timer = null;

/** Effective rolling-archive minutes (per-tournament override ?? server). */
async function effectiveArchiveMinutes(tournament) {
  const own = tournament.settings.autoArchiveMinutes;
  if (own != null) return own;
  const s = await getServerSettings(tournament.guildId);
  return s.autoArchiveMinutes || 0;
}

// Arm any FINISHED match (winner set) that still has a room but no archive
// timer — e.g. a DQ forfeit, which advances the opponent without going through
// the report path that stamps `archiveAt`. In double-elim a DQ cascades
// forfeits into the losers bracket, orphaning those rooms. Only runs when
// rolling auto-archive is on; manual mode intentionally leaves rooms for the
// admin. Returns true if it armed anything. `ref.winner` is falsy for BR
// stages, so they're naturally skipped.
function reconcileOrphanRooms(tournament, now = Date.now()) {
  let armed = false;
  for (const item of collectArchivables(tournament)) {
    const ref = item.ref;
    if (ref && ref.winner && ref.channelId && !ref.archiveAt && !ref.contested) {
      ref.archiveAt = now;
      armed = true;
    }
  }
  return armed;
}

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
    // Rolling auto-archive on → self-heal any finished-match rooms that were
    // resolved outside the report path (DQ forfeits etc.) and left without a
    // timer, then archive everything that's now due.
    let changed = false;
    try {
      if ((await effectiveArchiveMinutes(tournament)) > 0) {
        changed = reconcileOrphanRooms(tournament);
      }
    } catch (error) {
      console.error('[archive-sweeper] reconcile failed:', error.message);
    }

    const due = collectDueArchives(tournament);
    if (due.length === 0 && !changed) continue;

    const guild = client.guilds.cache.get(tournament.guildId);
    if (!guild) continue;

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
