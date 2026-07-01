# Tournament Bot — Admin Guide

A simple guide to running tournaments on your Discord server.

> Reporting match results is **admin-only**. Match rooms are **private** to the two
> sides of each match (plus admins). See [Roles & permissions](#roles--permissions).

---

## Quick start (5 steps)

1. **Create** — `/tournament create`, pick a game, fill in title / date / size.
2. **Players sign up** — they click **Sign Up** (or **Register Team**) on the post.
3. **Start** — click **Start** on the post (or `/tournament start`) to generate the bracket.
4. **Report results** — as matches finish, admins report winners (`/tournament report` or the 👑 buttons in each match room).
5. **View standings** — `/match bracket` or `/tournament bracket` anytime.

That's the whole loop. Everything below is detail.

---

## Creating a tournament

**Simple mode — `/tournament create`**
Pick a game from the dropdown, then fill the short form:
- **Title** (e.g. "Friday Night Cup")
- **Date & Time** (natural text like `Feb 15 7pm UTC`)
- **Max Players / Teams**

The game's defaults (team size, format, best-of) are applied automatically. The bot
posts an announcement with **Sign Up** / **Register Team** buttons.

**One tournament = one channel.** Both create commands take an optional
`channel:` — the tournament announces there and ALL of its posts (start,
check-in, round news, DQs, final results) follow it. Perfect for running the
same game per region: `/tournament create channel:#cs2-eu`, then another with
`channel:#cs2-na`. Without `channel:` the per-game override or server default
applies as before. (The web dashboard's create form has the same picker.)

**Advanced mode — `/tournament create-advanced`**
A guided wizard. Same basics, plus you can change **Format**, **Team Size**,
**Best-Of**, and toggle **Check-in**, **Seeding**, **Captain Mode**, **Game Nick**,
**Web Bracket**, and **Required Roles** before creating. Under **More Options**:
check-in window, required roles, and — for single elimination — a **3rd Place
Match** toggle (semifinal losers play it out instead of sharing third; if a
semifinal was a bye, third place resolves automatically by walkover).

**Live web bracket** *(Pro/Business)* — when enabled, the tournament gets a
public, auto-updating bracket page at `tournaments.clutch.game/b/<id>`,
linked from the announcement (🌐 Live Bracket button) and from
`/tournament bracket` / `/match bracket`. It covers every format (elimination
trees, Swiss/round-robin standings), shows entrants during registration, and
updates itself every 15 seconds as results are reported — ideal for big
tournaments where the text bracket gets unwieldy. Simple mode enables it
automatically on eligible tiers; the wizard exposes an on/off toggle.

---

## Formats

| Format | How it works |
|---|---|
| **Single Elimination** | Lose once, you're out. |
| **Double Elimination** | A winners + losers bracket; you must lose twice to be eliminated. Includes grand finals (with a possible bracket reset). |
| **Swiss** | Fixed number of rounds; each round you're paired against someone with a similar record. No one is eliminated. |
| **Round Robin** | Everyone plays everyone once; ranked by record. |

All formats handle **any number of entrants** (non-power-of-2 fields get byes
automatically).

---

## Games

15 built-in games plus **Custom** (any game you name yourself):

| Category | Games |
|---|---|
| FPS | Counter-Strike 2, VALORANT |
| Hero Shooter | Deadlock, Marvel Rivals, Overwatch |
| MOBA | League of Legends, Dota 2, Mobile Legends |
| Fighting | Street Fighter 6, Tekken 8, 2XKO |
| Sports | Rocket League, GOALS, EA Sports FC |
| Casual | GeoGuessr |

Pick **Other Game…** in the dropdown for anything custom.

---

## Running a tournament

**1. Registration.** Players use the buttons on the announcement:
- **Sign Up** (solo) / **Register Team** (team games)
- **Withdraw** to drop out
- **Check In** (only if check-in is enabled)

When a captain registers a team, every teammate is **DMed** that they've been
added. With Captain Mode, names that can't be matched to a server member yet
show as *(pending)* on the signup list — they're resolved (and DMed) when the
tournament starts.

You can fill a test event quickly with `/admin add-players` or `/admin add-teams`.

**2. Start.** Click **Start** on the post, or run `/tournament start`. The bot
generates the bracket and creates a **private match room** for each first-round match.

With a non-power-of-2 field (e.g. 23 of 32), byes go to the **top seeds** — or
to signup order if seeding isn't used. The start confirmation lists who got
them, and every player/team that advances on a bye or walkover is **notified by
DM automatically** (including mid-tournament walkovers in double elimination).

**3. Match rooms.** Each room is visible only to the two competitors (all members,
for teams) plus tournament admins. The bot **pings the players** in the room when
it's created so everyone knows where their match is played.

**4. Report results (admins).** Two ways:
- Click **👑 [name] Wins** in the match room — in Bo3+ a score picker follows (2-0 / 2-1 …), or
- `/tournament report tournament:<name> match_number:<#> winner:<name> score:<e.g. 2-1>`

The bracket advances automatically and the next round's rooms are created. Repeat
until a champion is decided.

**Reported the wrong result?** `/tournament correct match_number: winner: score:`
fixes it — as long as nothing downstream has been played yet (later results that
depend on the wrong one must be corrected first).

**Disqualifying someone:** `/tournament disqualify participant: [reason:]` —
their remaining matches are forfeited (opponents win with the best possible
score, e.g. 2-0 in a Bo3, shown as **DQ** on the brackets), upcoming matches
forfeit automatically when the opponent is decided, and past results stand.

**Manually registering real entrants:** `/tournament add-player user:@…` (solo)
and `/tournament add-team name: captain:@… members:@… @…` register actual server
members — they get a DM. For *fake* test entrants use
`/admin add-test-players` / `add-test-teams` instead.

**Removing an entrant before start:** `/tournament remove-player participant:` or
`/tournament remove-team team:` removes a specific player/team during
registration or check-in (they're DMed). To remove everyone, use
`/admin clear-participants`. Once the tournament is running, use
`/tournament disqualify` instead.

**Byes, walkovers and DQ forfeits** are recorded with the best possible series
score (2-0 in a Bo3); Bo1 records no series score.

**5. View & finish.** `/match bracket` or `/tournament bracket` shows the live
bracket/standings and the final podium (champion, runner-up, 3rd). Use
`/admin cleanup` to remove match rooms when you're done.

---

## Server setup (one-time)

| Command | What it does |
|---|---|
| `/admin set-announcement-channel channel:#…` | Where new tournaments are posted. Add `game:` to give one game its own channel (e.g. CS2 cups → #cs2-tournaments); other games keep the default |
| `/admin set-match-category category:…` | Category that match rooms are created under |
| `/admin set-role role:@…` | Add/remove a **tournament-admin role** (lets non-admins manage tournaments) |
| `/admin settings` | View current server settings |

---

## Roles & permissions

**Who can manage tournaments / report results?** Anyone with **Administrator**,
**Manage Server**, or a **tournament-admin role** (set via `/admin set-role`).
Regular players cannot report results — if they click a win button they'll be told
it's admin-only.

**Match-room access.** Rooms are private: only the two sides of the match (plus
admin roles and the bot) can see and chat in them. Test/fake participants and
unresolved members aren't added.

---

## Web dashboard

Sign in with Discord at **[tournaments.clutch.game/admin](https://tournaments.clutch.game/admin)**
to manage from the browser. You'll see every server where the bot is installed
*and* you can manage tournaments (same permission check as in Discord: owner,
Administrator, Manage Server, or a tournament-admin role) — each server's
tournaments with status at a glance, plus the full live bracket/standings/roster
view for any of them, including tournaments whose public Web Bracket toggle is
off (the dashboard view is admin-only).

Read-only for now: creating tournaments, reporting results and other actions
still happen in Discord. Sessions last 7 days; use **Log out** to end one sooner.

---

## Command reference

**Tournaments — `/tournament`** (admin)
`create` · `create-advanced` · `edit` · `list` · `info` · `start` · `cancel` ·
`report` · `correct` · `disqualify` · `add-player` · `add-team` ·
`remove-player` · `remove-team` · `bracket` · `seed set|list|randomize|clear`

> **Editing:** `/tournament edit` opens a pre-filled form to change the title,
> date/time, max players/teams, best-of, and description of a posted tournament
> — signups and the Live Bracket link are preserved, and the announcement
> updates in place. Only works before the tournament starts; game and format
> are never editable.

**Matches — `/match`** (everyone)
`list` — active matches · `bracket` — bracket/standings

**Teams — `/team`** (captains)
`add` · `remove` · `transfer`

**Admin — `/admin`**
`settings` · `set-announcement-channel` · `set-match-category` · `set-role` ·
`cleanup` · `set-auto-cleanup` *(Premium)* · `set-captain-mode` *(Premium)* ·
`add-test-players` / `add-test-teams` *(debug, fake entrants)* ·
`clear-participants` *(debug)* · `help`

**Other**
`/help` — player help · `/subscribe` — plan & billing · `/analytics` *(Pro)* ·
`/templates` *(Pro)*

---

## Tips & troubleshooting

- **Test a full run fast:** create a tournament, `/admin add-test-players count:6`
  (or `add-test-teams`), `/tournament start`, then report matches. Try 6 entrants
  to see byes.
- **"Only tournament admins can report":** the user isn't an admin and doesn't have a
  tournament-admin role — add one with `/admin set-role`.
- **Mis-reported a result?** `/tournament correct` fixes it while nothing
  downstream has been played.
- **Match rooms piling up:** `/admin cleanup`, or enable `/admin set-auto-cleanup`.
- **Some match rooms didn't get created?** Run `/tournament create-rooms` to
  retry the current round, and make sure the bot has **Manage Channels** +
  **Manage Roles** and a role positioned above the others.

For the full web manual, open `/admin-manual` on the bot's host.
