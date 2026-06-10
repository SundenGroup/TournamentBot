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

**Advanced mode — `/tournament create-advanced`**
A guided wizard. Same basics, plus you can change **Format**, **Team Size**,
**Best-Of**, and toggle **Check-in**, **Seeding**, **Captain Mode**, **Game Nick**,
**Web Bracket**, and **Required Roles** before creating.

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

You can fill a test event quickly with `/admin add-players` or `/admin add-teams`.

**2. Start.** Click **Start** on the post, or run `/tournament start`. The bot
generates the bracket and creates a **private match room** for each first-round match.

With a non-power-of-2 field (e.g. 23 of 32), byes go to the **top seeds** — or
to signup order if seeding isn't used. The start confirmation lists who got
them, and every player/team that advances on a bye or walkover is **notified by
DM automatically** (including mid-tournament walkovers in double elimination).

**3. Match rooms.** Each room is visible only to the two competitors (all members,
for teams) plus tournament admins. Players coordinate and play there.

**4. Report results (admins).** Two ways:
- Click **👑 [name] Wins** in the match room, or
- `/tournament report tournament:<name> match_number:<#> winner:<name> score:<e.g. 2-1>`

The bracket advances automatically and the next round's rooms are created. Repeat
until a champion is decided.

**5. View & finish.** `/match bracket` or `/tournament bracket` shows the live
bracket/standings and the final podium (champion, runner-up, 3rd). Use
`/admin cleanup` to remove match rooms when you're done.

---

## Server setup (one-time)

| Command | What it does |
|---|---|
| `/admin set-announcement-channel channel:#…` | Where new tournaments are posted |
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

## Command reference

**Tournaments — `/tournament`** (admin)
`create` · `create-advanced` · `edit` · `list` · `info` · `start` · `cancel` ·
`report` · `bracket` · `seed set|list|randomize|clear`

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
`add-players` / `add-teams` *(debug)* · `clear-participants` *(debug)* · `help`

**Other**
`/help` — player help · `/subscribe` — plan & billing · `/analytics` *(Pro)* ·
`/templates` *(Pro)*

---

## Tips & troubleshooting

- **Test a full run fast:** create a tournament, `/admin add-players count:6` (or
  `add-teams`), `/tournament start`, then report matches. Try 6 entrants to see byes.
- **"Only tournament admins can report":** the user isn't an admin and doesn't have a
  tournament-admin role — add one with `/admin set-role`.
- **Stuck or mis-reported?** Cancel with `/tournament cancel` and recreate (there's
  no per-match undo yet).
- **Match rooms piling up:** `/admin cleanup`, or enable `/admin set-auto-cleanup`.

For the full web manual, open `/admin-manual` on the bot's host.
