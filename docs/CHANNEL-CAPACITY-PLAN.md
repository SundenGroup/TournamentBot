# Channel Capacity Plan — surviving Discord's 500-channel limit

*July 2026. Trigger: running several big events at once (e.g. 3× double-elim,
512 players) blows straight through Discord's ~500-channels-per-server cap —
today the bot just fails generically and there is no way to continue.*

---

## 0. The facts (verified in code + Discord limits)

**The math.** A 512-player double-elim needs **256 match rooms for round 1
alone**. Three of them concurrently = **768 rooms** — impossible on a
500-channel server even if it were otherwise empty. Rooms for later rounds are
already created lazily (only when a match is ready), so the *start burst* of
round 1 is the peak, and results only free capacity if rooms are actually
deleted as the event progresses.

**What the bot does today (gaps):**
- `createPrivateChannel` handles the *category*-full case (50 per category)
  but not the *guild* cap: Discord error **30013 (max guild channels)** is
  unhandled → every room creation throws one by one → admins see only
  "⚠️ N room(s) failed to create — retry with /tournament create-rooms",
  which can never succeed. No pre-flight capacity check exists anywhere.
- Cleanup's **"archive" mode only moves channels to an "Archived Matches"
  category — they still count against the 500 cap.** Only delete mode frees
  capacity, and delete destroys the chat history.
- Auto-cleanup runs once, 30s after the *whole tournament* completes —
  nothing frees rooms *during* the event, which is when capacity matters.

**What the Support bot already proves (code read):**
- `transcriptGenerator.js`: paginated full-history fetch → HTML transcript.
- `TicketManager.closeTicket`: transcript → **delete channel** → done.
- `ticket_messages` table: messages persisted to DB at close, retrievable
  forever (`getTranscript` renders from DB, not from Discord).
- Transcript file also posted to a per-type log channel ("Match Logs").

That is exactly the model to port: **history to DB + transcript artifact,
then delete — archiving that actually frees capacity.**

---

## Phase 1 — Communicate the limit (fail early, fail loud) · S · ship pre-GOALS

Nothing may "just stop" anymore.

1. **Pre-flight capacity check** in `startTournamentFlow`, `createRoomsFlow`
   and web start: `available = 500 − guild.channels.cache.size − 5 (margin)`;
   `needed = ready round-1 matches (or BR lobbies)`. If `needed > available`,
   **block the start** with a precise, actionable message:
   > ❌ Starting needs **256** match rooms but this server only has **117**
   > channel slots free (Discord caps servers at 500 channels).
   > Free slots with `/admin cleanup`, enable auto-archive
   > (`/admin set-auto-archive`), or reduce the field — then start again.
2. **Catch 30013 mid-creation** (start burst / next-round rooms): stop
   creating further rooms immediately (don't hammer the API), post **one**
   admin summary in the tournament channel naming the cap, how many rooms are
   missing, and the exact recovery commands. Set a flag on the tournament so
   the dashboard shows a persistent "capacity reached" banner with the same
   guidance. `create-rooms` retries remain idempotent.
3. **Capacity visibility**: channels-used meter (X/500) on the dashboard Run
   view and in the `/tournament create-rooms` + start summaries whenever
   usage is > 400.

## Phase 2 — Real archiving: transcript + delete · M · ship pre-GOALS

Port the Support bot's model into a `transcriptService`:

1. On archive of a match/lobby room: paginated fetch of the full history →
   store in Postgres **`match_transcripts`** (tournament_id, match key,
   channel name, participants, messages JSONB incl. attachments/embeds
   summary, created_at) → **delete the channel** → clear `channelId` on the
   match. Failure to fetch never blocks deletion decisions by admins
   (transcript-first, but admin can force).
2. **Redefine cleanup modes**: `archive` now means *transcript + delete*
   (frees capacity, keeps history). The old move-to-category behavior remains
   available as `mode:category` for whoever wants it, with a warning that it
   does not free capacity.
3. **Where history lives — the dashboard is the canonical viewer**:
   - Run view: every decided match row (and BR game) gets a **Transcript**
     link → full room history rendered in dashboard style (authors,
     timestamps, attachment links) plus match context (players, score,
     reporter). Admin-authed via the standard guard stack.
   - History survives the event: transcripts are in Postgres, so completed
     tournaments stay fully browsable long after the channels are deleted.
   - Phase 3 tie-in: a contested result's transcript is one click away from
     the dashboard attention list — review, then confirm or correct.
   - Optional server setting: also post the HTML transcript file to a
     `#match-logs` channel, mirroring the Support bot.
4. Retention: transcripts kept 90 days (constant for now), daily prune job.

## Phase 3 — Rolling auto-archive after result + contest window · M · Pro/Studio

The steady-state fix: rooms disappear shortly after they stop being useful.

1. **Setting**: `/admin set-auto-archive minutes:<X>` (0 = off, default off,
   suggested 10) + per-tournament override in the wizard's More Options and
   the dashboard. Gated Pro/Studio (feature key `auto_archive`).
2. **Flow**: when a result is recorded (`applyMatchReport` / BR stage
   complete), post in-room:
   > ✅ Result recorded: **A** def. **B** (2-1). This room closes
   > in **10 min**. Spot a problem? Tap **⚠️ Contest result**.
   and stamp **`archiveAt` on the match inside the bracket JSON**
   (persisted — restart-safe by design, unlike the current in-memory
   reminders). A 60s sweeper archives every due room via Phase 2's service.
3. **Contest button** (participants of that match only): sets
   `match.contested = true`, cancels `archiveAt`, pings admins in the
   tournament channel with a jump link. Admins resolve with the existing
   correction flow or a **Confirm result** button that re-arms the timer.
   Contested matches surface on the dashboard's attention list.
4. Effect: concurrent rooms ≈ matches actually in play + contest windows.
   A 512 DE stops accumulating; the only remaining pressure is the round-1
   burst — which Phase 4 removes entirely.

## Phase 4 — Thread Mode: the scale unlock · L · Pro/Studio, next sprint

For events whose round-1 burst alone can't fit (512s, multi-event weekends):

- Per-tournament option (auto-suggested by the Phase 1 pre-flight when
  `needed > available`): match rooms become **private threads** under one
  `#⚔-match-rooms` channel per tournament.
- Why it wins: **threads don't count toward the 500-channel cap**; the
  active-thread cap is ~1000 per guild (768 R1 threads for 3×512 fits, and
  archived threads don't count); Discord auto-archives idle threads natively;
  no category juggling or per-room permission overwrites (members are added
  explicitly to each private thread — same ping UX as today).
- Same embeds, win buttons, transcripts (transcriptService reads threads the
  same way). Channels stay the default for normal events; Thread Mode is the
  big-event switch.

---

## Rollout & sizing

| Phase | Size | When | Plan gating |
|---|---|---|---|
| 1 Communicate limit | S (~½ day) | **Before July 20** | everyone |
| 2 Transcript + delete | M (~1 day) | **Before July 20** | everyone (capacity hygiene) |
| 3 Auto-archive + contest | M (~1 day) | right after GOALS week (flag-safe to land earlier, default off) | **Pro/Studio** |
| 4 Thread Mode | L (1–2 days) | next sprint | **Pro/Studio** |

Notes:
- GOALS (single tournament, Studio server) is safe with 1+2 alone; 3 and 4
  are what make "3× 512 DE on a busy server" routine.
- Phase 3's persisted-`archiveAt` + sweeper pattern is also the model the
  reminder system should migrate to (GOALS audit item — reminders are
  currently lost on restart).
