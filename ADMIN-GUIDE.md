# Tournament Bot -- Admin Guide

Welcome! This guide covers everything you need to run tournaments as a server admin or community manager.

---

## Table of Contents

1. [Initial Setup](#1-initial-setup)
2. [Creating a Tournament](#2-creating-a-tournament)
3. [Tournament Lifecycle](#3-tournament-lifecycle)
4. [Reporting Results](#4-reporting-results)
5. [Team Tournaments](#5-team-tournaments)
6. [Battle Royale Tournaments](#6-battle-royale-tournaments)
7. [Seeding](#7-seeding)
8. [Server Settings](#8-server-settings)
9. [Debug & Testing Tools](#9-debug--testing-tools)
10. [Templates](#10-templates)
11. [Tokens & Boosts](#11-tokens--boosts)
12. [Subscription Management](#12-subscription-management)
13. [Command Reference](#13-command-reference)

---

## 1. Initial Setup

Once the bot is added to your server, there are a few things worth configuring before your first tournament.

### Set an announcement channel

```
/admin set-announcement-channel channel:#tournaments
```

This is where the bot posts tournament embeds (the signup message with buttons). If you skip this, the bot creates a `#tournament-announcements` channel automatically.

### Set a match room category

```
/admin set-match-category category:Tournament Matches
```

When a tournament starts, the bot creates individual text channels for each match under this category. If you skip this, it creates one automatically.

### Add tournament admin roles (optional)

```
/admin set-role action:Add role role:@Tournament Manager
```

By default, only users with the **Administrator** or **Manage Server** permission can create and manage tournaments. If you want community managers (who don't have those permissions) to run tournaments, add their role here. You can add up to 3 roles.

### Verify your settings

```
/admin settings
```

Shows your current configuration at a glance.

---

## 2. Creating a Tournament

There are two creation modes: **Simple** and **Advanced**.

### Simple Mode

```
/tournament create
```

1. A dropdown appears with popular games (CS2, League of Legends, Fortnite, etc.). Pick one, or choose "Other Game" for anything custom.
2. A form pops up asking for:
   - **Tournament Title** -- e.g. "Friday Night Fights"
   - **Date & Time** -- natural language works: `March 10 8pm EST`, `tomorrow 7pm UTC`, `Saturday 3pm`
   - **Max Players/Teams** -- between 2 and 128
3. Hit submit and the tournament is live with a signup embed in your announcement channel.

Simple mode uses the game's default settings (format, team size, best-of-1, no check-in).

### Advanced Mode

```
/tournament create-advanced
```

Same game picker, but after the basic info form you get a **settings screen** with dropdowns and toggles:

- **Format** -- Single Elimination, Double Elimination, Swiss, Round Robin, or Battle Royale
- **Team Size** -- Solo, 2v2, 3v3, up to 10v10 (depends on game)
- **Best Of** -- Bo1, Bo3, Bo5, Bo7
- **Check-in** -- Toggle on/off (Premium feature)
- **Game Nickname** -- Require participants to enter their in-game name
- **Captain Mode** -- Only the team captain needs to be in the server at signup (Premium)
- **Seeding** -- Allow manual/randomized seeding before start (Premium)

There's also a **More Options** button for:
- Check-in window (5 to 120 minutes)
- Required roles (only members with specific roles can join)
- Battle Royale settings (lobby size, games per stage, advancing count)

---

## 3. Tournament Lifecycle

Every tournament goes through these phases:

### Registration
The bot posts a signup embed with **Sign Up** (or **Register Team**) and **Withdraw** buttons. Players click to join. You'll see the participant count update in real-time.

### Check-in (if enabled)
Check-in opens automatically at `start time - check-in window`. For example, if your tournament starts at 8 PM with a 15-minute check-in window, check-in opens at 7:45 PM. The signup button is replaced with a **Check In** button. Players who don't check in are removed when the tournament starts.

### Starting
When the scheduled start time arrives, the bot posts a message saying the tournament is ready. You then start it manually:

```
/tournament start tournament:Friday Night Fights
```

Or click the **Start Tournament** button that appears in the channel.

This generates the bracket, creates match room channels, and the tournament is live.

> **Why manual start?** This gives you a chance to handle late check-ins, adjust seeding, or wait a few extra minutes if needed.

### Active
Matches are played. Results are reported (by admins or via match room buttons). The bracket advances automatically. New match room channels are created for each new round.

### Completed
When the final match is reported, the bot announces the results with a podium (champion, runner-up, 3rd place). If auto-cleanup is enabled, match room channels are cleaned up after 30 seconds.

### Cancelling
Need to call it off?

```
/tournament cancel tournament:Friday Night Fights
```

This cancels the tournament immediately. Scheduled reminders are also cancelled.

---

## 4. Reporting Results

### From match room channels

When a tournament starts, each match gets its own text channel (e.g. `#match-1-player-a-vs-player-b`). Inside the channel, there are buttons:

- **Player A Wins**
- **Player B Wins**

Any admin can click a button to report the result. The bracket advances automatically.

### From slash commands

```
/tournament report tournament:Friday Night Fights match_number:1 winner:PlayerA score:2-1
```

The `score` is optional but nice for record-keeping. The `winner` field autocompletes with the participants in that match.

### Viewing the bracket

```
/tournament bracket tournament:Friday Night Fights
```

Or click the **View Bracket** button on the tournament embed.

---

## 5. Team Tournaments

When you create a tournament with a team size of 2 or more, the signup flow changes:

1. Players click **Register Team** on the tournament embed
2. A form asks for:
   - **Team Name**
   - **Team Members** -- one username per line (the number of members must match the team size minus the captain)
3. The person who registers becomes the **team captain**

### Captain commands

Captains can manage their team during registration:

| Command | What it does |
|---|---|
| `/team add` | Add a member to the team |
| `/team remove` | Remove a member (can't remove yourself) |
| `/team transfer` | Hand off the captain role to a teammate |

### Captain Mode (Premium)

Normally, all team members must be in the server when the captain registers. With **Captain Mode** enabled, the captain just types names -- members don't need to be in the server yet. They're resolved when the tournament starts.

Great for cross-server communities or when members join last-minute.

---

## 6. Battle Royale Tournaments

Battle Royale format works differently from bracket-based formats:

### Structure
- **Group Stage**: Participants are split into lobbies (configurable size: 10-100). Each group plays multiple games.
- **Finals**: Top teams from each group advance to a Grand Finals lobby.

### Reporting BR Results

```
/tournament br-report tournament:PUBG Weekly group:A game_number:1 placements:5,12,3,8,1,15,7,20,10,2
```

The `placements` field is a comma-separated list of lobby numbers in finish order (1st place first). Any teams not listed are auto-filled to last place.

The bot tracks placement points across games. When all group stage games are reported, it automatically creates the finals lobby.

### BR Settings (Advanced Mode)
- **Lobby Size** -- How many teams per lobby (10/20/30/50/100)
- **Games per Stage** -- How many games each group plays (1-10)
- **Advancing per Group** -- How many teams advance to finals (auto, or 2/4/6/8)

---

## 7. Seeding

Seeding is a **Premium** feature. It must be enabled when creating the tournament (toggle it on in Advanced Mode).

### Set individual seeds

```
/tournament seed set tournament:Friday Night Fights participant:PlayerA seed:1
```

### View current seeding

```
/tournament seed list tournament:Friday Night Fights
```

Shows seeded players (sorted by seed) and unseeded players.

### Randomize seeds

```
/tournament seed randomize tournament:Friday Night Fights
```

Randomly assigns seeds to all currently unseeded participants.

### Clear all seeds

```
/tournament seed clear tournament:Friday Night Fights
```

Seeding affects bracket placement -- seed 1 plays the lowest seed in round 1, etc.

---

## 8. Server Settings

All settings are managed through `/admin` subcommands:

| Command | What it does | Tier |
|---|---|---|
| `/admin settings` | View all current settings | Free |
| `/admin set-announcement-channel` | Set where tournament embeds are posted | Free |
| `/admin set-match-category` | Set where match rooms are created | Free |
| `/admin set-role` | Add/remove tournament admin roles (up to 3) | Free |
| `/admin set-auto-cleanup` | Auto-delete/archive match rooms after tournaments | Premium |
| `/admin set-captain-mode` | Enable captain mode server-wide | Premium |
| `/admin cleanup` | Manually clean up match rooms from a tournament | Free |
| `/admin help` | Full command reference | Free |

---

## 9. Debug & Testing Tools

These are built specifically for testing. They add fake participants so you can test the full tournament flow without needing real players.

### Add fake players (solo tournaments)

```
/admin add-players tournament:Test Tournament count:16
```

Adds 16 fake players with random names. They show up in the participant list just like real players.

### Add fake teams (team tournaments)

```
/admin add-teams tournament:Test Tournament count:8
```

Adds 8 fake teams with random names and generated members.

### Clear all participants

```
/admin clear-participants tournament:Test Tournament
```

Removes everyone (real and fake) from the tournament. Useful for resetting and trying again.

### Recommended testing flow

1. `/tournament create-advanced` -- Create a test tournament (set the time to a few minutes from now)
2. `/admin add-players count:8` -- Add fake players
3. `/tournament start` -- Start it immediately (no need to wait for the scheduled time)
4. Report results in the match room channels by clicking the winner buttons
5. Watch the bracket advance and the tournament complete
6. `/admin cleanup` -- Clean up match room channels when done

---

## 10. Templates

Templates are a **Pro** feature that lets you save tournament configurations for reuse. Handy if you run the same type of tournament every week.

### Save a template from an existing tournament

```
/templates save tournament:Friday Night Fights name:FNF Standard description:Our weekly 1v1 bracket
```

This captures all settings: game, format, team size, best-of, check-in, max participants, and everything else.

### List your templates

```
/templates list
```

### View template details

```
/templates view name:FNF Standard
```

### Delete a template

```
/templates delete name:FNF Standard
```

You can save up to **25 templates** per server. Templates track how many times they've been used.

---

## 11. Tokens & Boosts

### Tournament Tokens

Every tier has a monthly tournament limit (Free: 3, Premium: 15, Pro: 50, Business: 200). If you need more, you can buy token packs:

| Pack | Tokens |
|---|---|
| Small | 30 |
| Medium | 50 |
| Large | 100 |

Tokens are consumed automatically when you exceed your monthly limit. They expire 12 months after purchase.

```
/tokens buy-tournaments pack:30 Tokens
```

### Participant Boosts

Each tier has a max participant cap (Free: 50, Premium: 128, Pro: 256, Business: 512). Boosts raise this for a single tournament:

| Boost | Extra Capacity |
|---|---|
| Standard | +128 participants |
| Large | +256 participants |

Boosts never expire and are consumed automatically when you create a tournament that exceeds your base cap. Maximum is 512 participants regardless of boosts.

```
/tokens buy-boost size:+128 Participants
```

### Check your balance

```
/tokens balance
```

---

## 12. Subscription Management

### View your current plan

```
/subscribe status
```

Shows your tier, usage this month, token/boost balance, and billing info.

### Compare plans

```
/subscribe plans
```

Side-by-side comparison of all tiers and features.

### Upgrade

```
/subscribe upgrade tier:Premium billing:Monthly
```

Opens a Stripe checkout page. Available tiers: Premium ($5.99/mo), Pro ($24.99/mo), Business ($99/mo). Annual billing saves up to 34%.

### Manage billing

```
/subscribe manage
```

Opens the Stripe billing portal where you can update payment methods, switch plans, or cancel.

### Free trial

```
/subscribe trial
```

Starts a 7-day Premium trial. One per server, no payment required.

---

## 13. Command Reference

### Tournament Management (Admin)

| Command | Description |
|---|---|
| `/tournament create` | Create a tournament (simple mode) |
| `/tournament create-advanced` | Create with full settings control |
| `/tournament list` | List all tournaments in the server |
| `/tournament info` | View a specific tournament's details |
| `/tournament start` | Start a tournament (generates bracket) |
| `/tournament cancel` | Cancel a tournament |
| `/tournament report` | Report a match result |
| `/tournament br-report` | Report Battle Royale game results |
| `/tournament bracket` | View bracket/standings |
| `/tournament seed set` | Set a participant's seed (Premium) |
| `/tournament seed list` | View current seeding (Premium) |
| `/tournament seed randomize` | Randomize seeds (Premium) |
| `/tournament seed clear` | Clear all seeds (Premium) |

### Server Settings (Admin)

| Command | Description |
|---|---|
| `/admin settings` | View current settings |
| `/admin set-announcement-channel` | Set announcement channel |
| `/admin set-match-category` | Set match room category |
| `/admin set-role` | Manage tournament admin roles |
| `/admin set-auto-cleanup` | Toggle auto-cleanup (Premium) |
| `/admin set-captain-mode` | Toggle captain mode (Premium) |
| `/admin cleanup` | Clean up match rooms |
| `/admin help` | Full command reference |

### Debug Tools (Admin)

| Command | Description |
|---|---|
| `/admin add-players` | Add fake players for testing |
| `/admin add-teams` | Add fake teams for testing |
| `/admin clear-participants` | Remove all participants |

### Player Commands (Everyone)

| Command | Description |
|---|---|
| `/match list` | View active matches |
| `/match bracket` | View bracket/standings |
| `/match games` | View BR games |
| `/team add` | Add a team member (captain only) |
| `/team remove` | Remove a team member (captain only) |
| `/team transfer` | Transfer captain role (captain only) |
| `/help` | Player help guide |

### Subscription & Tokens (Everyone)

| Command | Description |
|---|---|
| `/subscribe status` | View subscription status |
| `/subscribe plans` | Compare plans |
| `/subscribe upgrade` | Upgrade tier |
| `/subscribe manage` | Manage billing |
| `/subscribe trial` | Start free trial |
| `/tokens balance` | View token/boost balance |
| `/tokens buy-tournaments` | Buy tournament tokens |
| `/tokens buy-boost` | Buy participant boosts |

### Templates (Pro)

| Command | Description |
|---|---|
| `/templates list` | List saved templates |
| `/templates view` | View template details |
| `/templates save` | Save a tournament as a template |
| `/templates delete` | Delete a template |

---

## Supported Games

The bot comes with presets for 21+ games with optimized defaults:

**Featured:** CS2, League of Legends, PUBG, Rocket League, Fortnite, Street Fighter 6, GeoGuessr

**All games:** VALORANT, Dota 2, Marvel Rivals, GOALS, 2XKO, PUBG Mobile, Overwatch, Call of Duty, Mobile Legends, EA Sports FC, StarCraft, Rainbow Six Siege, Tekken 8, Apex Legends, Deadlock

You can also choose **Custom** to run a tournament for any game not on the list.

---

## Tier Comparison Quick Reference

| | Free | Premium | Pro | Business |
|---|---|---|---|---|
| **Tournaments/month** | 3 | 15 | 50 | 200 |
| **Max participants** | 50 | 128 | 256 | 512 |
| **Concurrent** | 1 | 3 | 10 | Unlimited |
| Check-in | -- | Yes | Yes | Yes |
| Seeding | -- | Yes | Yes | Yes |
| Captain Mode | -- | Yes | Yes | Yes |
| Auto-cleanup | -- | Yes | Yes | Yes |
| Templates | -- | -- | Yes | Yes |
| Analytics | -- | -- | Yes | Yes |
| REST API | -- | -- | -- | Yes |
| Webhooks | -- | -- | -- | Yes |
| White-label | -- | -- | -- | Yes |

---

Questions? Run `/admin help` for a quick in-Discord reference, or `/help` for the player-facing guide.
