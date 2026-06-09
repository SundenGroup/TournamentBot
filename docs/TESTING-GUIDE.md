# Tournament Bot — Testing Guide

A practical walkthrough for bug-testing the bot after the "finalize for testing"
changes. Two full scenarios are included: **Rocket League (3v3)** to exercise team
play + **double elimination** (the headline fix), and **GOALS (1v1)** to exercise
solo play + single elimination.

> **Parked for this phase:** the token system and Battle Royale are disabled
> (see [PARKED-FEATURES.md](PARKED-FEATURES.md)). You won't see `/tokens`,
> `/tournament br-report`, `/match games`, or any Battle Royale games/formats.

---

## 0. One-time setup

1. **Remove tier limits for testing.** As the bot owner, grant your test server
   Business tier so concurrency/feature limits never get in the way:
   ```
   /owner grant guild_id:<your server id> tier:business days:30
   ```
   (Get the server ID via Discord → Server Settings → Widget, or right-click the
   server with Developer Mode on. Check it worked with `/owner status guild_id:<id>`.)

2. **(Optional) Set an announcement channel** so tournaments post in one place:
   ```
   /admin set-announcement-channel channel:#tournaments
   ```

3. **Confirm the command list is clean.** In the server, type `/` and check that
   `/tokens` is gone and `/tournament` no longer has a `br-report` subcommand.
   (Global command updates can take a few minutes to propagate.)

---

## Command reference

| Command | Purpose |
|---|---|
| `/tournament create` | Simple create — pick a game, fill a short modal |
| `/tournament create-advanced` | Guided wizard (format, team size, best-of, toggles) |
| `/tournament list` | List tournaments in the server |
| `/tournament info tournament:` | Show tournament details |
| `/tournament start tournament:` | Generate the bracket and start (also a button on the post) |
| `/tournament report tournament: match_number: winner: score:` | Report a match result |
| `/tournament bracket tournament:` | View bracket / standings |
| `/tournament cancel tournament:` | Cancel a tournament |
| `/match list tournament:` | List active matches |
| `/match bracket tournament:` | View bracket / standings |
| `/admin add-players tournament: count:` | **Debug:** add N fake solo players |
| `/admin add-teams tournament: count:` | **Debug:** add N fake teams |
| `/admin clear-participants tournament:` | **Debug:** clear all entrants |

Players also interact via the **buttons** on the tournament announcement embed:
**Sign Up / Register Team**, **Withdraw**, **Check In**, **Start** (admin).

---

## Scenario A — Rocket League 3v3 (team + double elimination)

Rocket League defaults to **3v3 teams** and **double elimination**, so this scenario
directly exercises the double-elim fix. **Use 6 teams** (a non-power-of-2 count) —
that's the exact case that used to deadlock.

1. **Create:**
   ```
   /tournament create
   ```
   Select **🚗 Rocket League** → in the modal set:
   - Title: `RL 3v3 Test Cup`
   - Date & Time: `tomorrow 7pm UTC`
   - Max Teams: `6`

   The bot posts an announcement with a **Register Team** button.

2. **(Optional) Real team signup test:** click **Register Team**, enter a team name
   and 2 member usernames. Confirm the participant list updates and the button feels
   responsive (no "interaction failed").

3. **Fill with fake teams** to reach 6 (a bye-producing count):
   ```
   /admin add-teams tournament:RL 3v3 Test Cup count:6
   ```

4. **Start:** click the **Start** button on the post, or:
   ```
   /tournament start tournament:RL 3v3 Test Cup
   ```
   You should get "Tournament Started" with match rooms — and **no deadlock**.

5. **Play it out.** List matches, then report each one:
   ```
   /match list tournament:RL 3v3 Test Cup
   /tournament report tournament:RL 3v3 Test Cup match_number:1 winner:<team name> score:3-2
   ```
   Keep reporting as new matches appear (winners bracket → losers bracket → grand
   finals). **Tip:** to test the **grand-finals reset**, have the losers-bracket
   finalist win the first grand-finals game — a reset match should appear.

6. **Verify completion:**
   ```
   /tournament bracket tournament:RL 3v3 Test Cup
   ```
   ✅ Champion, runner-up, and **3rd place** are all shown, and the tournament
   reaches a winner with 6 teams (the byes auto-advanced correctly).

**What this proves:** double-elim no longer deadlocks on non-power-of-2 fields (#1),
3rd place is computed (#12), team registration + transactions work, and the Start
button doesn't brick the tournament on error (#14).

---

## Scenario B — GOALS 1v1 (solo + single elimination)

GOALS defaults to **solo (1v1)** and **single elimination**. Use **5 players** to
exercise byes in single elim.

1. **Create:**
   ```
   /tournament create
   ```
   Select **⚽ GOALS** → modal:
   - Title: `GOALS 1v1 Ladder`
   - Date & Time: `tomorrow 8pm UTC`
   - Max Players: `5`

2. **(Optional) Real signup test:** click **Sign Up** and confirm you're added.

3. **Fill with fake players:**
   ```
   /admin add-players tournament:GOALS 1v1 Ladder count:5
   ```

4. **Start:**
   ```
   /tournament start tournament:GOALS 1v1 Ladder
   ```

5. **Play it out:**
   ```
   /match list tournament:GOALS 1v1 Ladder
   /tournament report tournament:GOALS 1v1 Ladder match_number:1 winner:<player> score:1-0
   ```

6. **Verify:**
   ```
   /tournament bracket tournament:GOALS 1v1 Ladder
   ```
   ✅ The top seed gets a bye in round 1, the bracket completes, and 3rd place shows.

**What this proves:** single-elim byes/seeding (5 players → 8-bracket), solo signup,
and 3rd-place reporting (#12).

---

## Extra coverage (worth a few minutes)

- **Advanced wizard / format switching:** run `/tournament create-advanced`, pick a
  game, then on the settings screen toggle **Check-in / Seeding / Captain Mode** and
  change **Format** and **Team Size**. Each click should update the message
  **immediately** (this was previously broken — buttons appeared to do nothing).
- **Swiss & Round Robin:** via the wizard, create a GOALS tournament with **Swiss**
  (try 5 players → exercises byes; no player should get two byes) or **Round Robin**
  (everyone plays everyone; standings resolve cleanly even with tied records).
- **Withdraw / Check-in:** before starting, click **Withdraw** then **Sign Up**
  again; if check-in is enabled, open it and click **Check In**. All should respond
  without timeouts.
- **Cancel & cleanup:** `/tournament cancel` and `/admin cleanup` to tidy match rooms.

---

## If something looks wrong

- Check `pm2 logs tournament-bot` on the droplet for stack traces.
- "This interaction failed" on a button usually means a timeout or an unhandled
  error — grab the log line and the steps to reproduce.
- Confirm migrations ran on the last deploy (look for `Ran 2 migration(s)` in the
  startup log): `processed_stripe_events` and the tournament message-id indexes.
