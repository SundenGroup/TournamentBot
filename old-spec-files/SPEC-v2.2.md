# Discord Tournament Bot — Technical Specification

> **Version:** 2.2
> **Last Updated:** January 2026
> **Tech Stack:** Node.js + discord.js v14+

---

## What's New in v2.2

### New Features
1. **Discord Native Timestamps** — Dates display as clickable, per-user localized timestamps
2. **Reminder Service Connected** — Automatic reminders via DMs and channel announcements
3. **Reminder Recovery on Restart** — Scheduled reminders survive bot restarts
4. **Channel Cleanup/Archiving** — Admin commands to mass-delete or archive tournament match rooms
5. **Auto-Cleanup** — Optional automatic match room cleanup on tournament completion
6. **Expanded Timezone Support** — 35+ timezone abbreviations recognized in date parsing

### Bug Fixes
- Fixed date parser misinterpreting year-less dates (e.g., "Jan 30 07:25 UTC" no longer parses as year 2001)
- Fixed `ManageRoles` permission overwrite causing channel creation failure on non-Administrator bots

---

## Required Bot Permissions

The bot requires these guild-level permissions when invited:

| Permission | Purpose |
|---|---|
| Manage Channels | Create/delete match rooms and categories |
| Manage Roles | Edit channel permission overwrites (archive/lock channels) |
| Manage Messages | Pin/manage messages in match rooms |
| Send Messages | Post announcements, reminders, results |
| Embed Links | Send rich embeds |
| Read Message History | Fetch and edit tournament announcement messages |
| View Channels | Basic channel access |
| Use Application Commands | Slash commands |

**OAuth2 Permission Integer:** `268445776`

> **Note:** `ManageRoles` cannot be included in initial channel creation permission overwrites due to a Discord API restriction. The bot grants itself this permission on channels via a post-creation edit using its guild-level `ManageRoles` permission.

---

## Feature: Discord Native Timestamps

### Overview

All dates displayed by the bot now use Discord's native timestamp format (`<t:UNIX:STYLE>`), which automatically localizes to each user's timezone and locale.

### Display Format

Tournament dates render as:

```
<t:1739646000:F> (<t:1739646000:R>)
```

Which Discord displays as (example for a US user):

```
Saturday, February 15, 2026 7:00 PM (in 16 days)
```

The same timestamp shows the correct local time for every user regardless of their timezone.

### Available Timestamp Styles

| Style | Code | Example Output |
|---|---|---|
| Full | `F` | Saturday, February 15, 2026 7:00 PM |
| Short | `f` | February 15, 2026 7:00 PM |
| Date only | `D` | February 15, 2026 |
| Time only | `T` | 7:00 PM |
| Relative | `R` | in 16 days |

### Implementation

**Files Modified:**

| File | Change |
|---|---|
| `src/utils/timeUtils.js` | Added `toDiscordTimestamp(date, style)` and `toDiscordFullAndRelative(date)` |
| `src/utils/embedBuilder.js` | Updated `formatDate()` to use `toDiscordFullAndRelative()` |

### API

```javascript
const { toDiscordTimestamp, toDiscordFullAndRelative } = require('./utils/timeUtils');

// Single style
toDiscordTimestamp(date, 'F');  // "<t:1739646000:F>"
toDiscordTimestamp(date, 'R');  // "<t:1739646000:R>"

// Full + relative (used in tournament embeds)
toDiscordFullAndRelative(date); // "<t:1739646000:F> (<t:1739646000:R>)"
```

---

## Feature: Expanded Timezone Support

### Overview

The date parser now recognizes 35+ timezone abbreviations and correctly converts them to UTC. Previously only `UTC`, `EST`, `PST`, and `GMT` were supported.

### Supported Timezones

| Region | Abbreviations | UTC Offset |
|---|---|---|
| **UTC / GMT** | `UTC`, `GMT` | +0 |
| **Europe** | `WET` | +0 |
| | `WEST`, `CET` | +1 |
| | `CEST`, `EET` | +2 |
| | `EEST`, `MSK` | +3 |
| **North America** | `HST` | -10 |
| | `AKST` | -9 |
| | `AKDT`, `PST` | -8 |
| | `PDT`, `MST` | -7 |
| | `MDT`, `CST` | -6 |
| | `CDT`, `EST` | -5 |
| | `EDT` | -4 |
| **South America** | `BRT`, `ART` | -3 |
| **Asia** | `PKT` | +5 |
| | `IST` | +5.5 |
| | `ICT` | +7 |
| | `CST_ASIA`, `HKT`, `SGT`, `AWST` | +8 |
| | `JST`, `KST` | +9 |
| **Oceania** | `ACST` | +9.5 |
| | `AEST` | +10 |
| | `ACDT` | +10.5 |
| | `AEDT` | +11 |
| | `NZST` | +12 |
| | `NZDT` | +13 |
| **Africa** | `WAT` | +1 |
| | `SAST`, `CAT` | +2 |
| | `EAT` | +3 |

### Parsing Behavior

- If no timezone is provided, defaults to **UTC**
- Informal formats are parsed first (e.g., `Feb 15 7pm CET`), preventing the native `Date()` constructor from misinterpreting year-less strings
- ISO format strings (e.g., `2026-02-15 19:00`) fall through to the native parser

### Examples

| Input | Parsed As |
|---|---|
| `Feb 15 7pm UTC` | Feb 15, 2026 19:00 UTC |
| `Feb 15 8pm CET` | Feb 15, 2026 19:00 UTC |
| `Jan 30 07:25 UTC` | Jan 30, 2026 07:25 UTC |
| `Mar 1 3pm EST` | Mar 1, 2026 20:00 UTC |
| `2026-02-15 19:00` | Feb 15, 2026 19:00 (native parser) |

---

## Feature: Reminder Service

### Overview

The reminder service (`src/services/reminderService.js`) schedules automated reminders for tournament participants. It was previously implemented but never connected to any creation flow.

### Reminder Schedule

| Timing | Action |
|---|---|
| **24 hours before** | DM + channel reminder |
| **1 hour before** | DM + channel reminder |
| **Check-in window** | Opens check-in phase (if enabled), DMs participants, updates tournament embed |
| **Start time** | Removes no-shows, notifies channel that tournament is ready to start |

### Delivery

Each reminder is delivered to:
1. **Tournament announcement channel** — Public message visible to all
2. **DMs to participants** — Individual messages to each registered user/team member

Fake/test users (IDs starting with `fake_`) are skipped for DMs.

### Message Format

**Channel announcement:**
```
⏰ Reminder: **Weekend CS2 Cup** starts in 1 hour!
```

**DM (same format):**
```
⏰ Reminder: **Weekend CS2 Cup** starts in 1 hour!
```

### Connection Points

| File | Integration |
|---|---|
| `src/components/simpleCreateModal.js` | Calls `scheduleReminders()` after simple mode tournament creation |
| `src/commands/tournament/create.js` | Calls `scheduleReminders()` after advanced mode tournament creation |
| `src/commands/tournament/create.js` | Calls `cancelReminders()` when a tournament is cancelled |
| `src/events/ready.js` | Calls `rescheduleAllReminders()` on bot startup |

### Restart Recovery

On bot startup, `rescheduleAllReminders(client)` iterates all tournaments in the store and re-schedules reminders for any tournament that:
- Has status `registration` or `checkin`
- Has a `startTime` in the future

Console output on startup:
```
Re-scheduled reminders for 2 active tournament(s)
```

### Cancellation

When a tournament is cancelled via `/tournament cancel`:
1. Tournament status set to `cancelled`
2. `cancelReminders(tournamentId)` clears all scheduled timeouts
3. Console logs cancellation

Even if reminders aren't explicitly cancelled, the `sendReminder()` function checks tournament status before executing and silently skips cancelled/completed tournaments.

### API

```javascript
const { scheduleReminders, cancelReminders, rescheduleAllReminders } = require('./services/reminderService');

// Schedule reminders for a tournament
scheduleReminders(tournament, client);

// Cancel all reminders for a tournament
cancelReminders(tournamentId);

// Re-schedule reminders for all active tournaments (bot restart)
rescheduleAllReminders(client);
```

---

## Feature: Channel Cleanup / Archiving

### Overview

Admin commands to mass-delete or archive tournament match rooms after a tournament ends. Includes optional auto-cleanup on tournament completion.

### Admin Commands

#### `/admin cleanup`

Manually clean up match rooms from a specific tournament.

| Option | Type | Required | Description |
|---|---|---|---|
| `tournament` | String | Yes | Tournament to clean up (autocomplete) |
| `mode` | String | Yes | `delete` or `archive` |

**Autocomplete:** Only shows tournaments that have a bracket with existing channel IDs. Already-cleaned tournaments and tournaments without brackets are excluded.

**Example response:**
```
✅ Cleanup complete: 8/8 channels deleted.
```

#### `/admin set-auto-cleanup`

Enable or disable automatic match room cleanup when a tournament completes.

| Option | Type | Required | Description |
|---|---|---|---|
| `enabled` | Boolean | Yes | Enable/disable auto-cleanup |
| `mode` | String | No | `delete` or `archive` (default: delete) |

**Example responses:**
```
✅ Auto-cleanup enabled. Match rooms will be deleted 30 seconds after tournament completion.
```
```
✅ Auto-cleanup disabled.
```

### Auto-Cleanup Behavior

When enabled and a tournament completes (via `/match report` or `/match br-report`):

1. 30-second delay (so players can see final results in match rooms)
2. All match room channels are deleted or archived
3. Channel IDs are cleared from the bracket data
4. Console log confirms completion

```
Auto-cleanup: Deleting 8 channels for "Weekend CS2 Cup" in 30s
Auto-cleanup complete: 8/8 channels processed for "Weekend CS2 Cup"
```

### Archive Mode

When mode is `archive`:
1. Channel permissions are updated to deny `SendMessages` for @everyone (read-only)
2. Channel is moved to an "Archived Matches" category
3. If the archive category is full (50 channels), a new one is created ("Archived Matches 2", etc.)

### Channel Collection

The `collectTournamentChannels(bracket)` function extracts all channel IDs from a bracket, supporting all tournament formats:

| Format | Channel Sources |
|---|---|
| Single Elimination | `bracket.rounds[].matches[].channelId` |
| Double Elimination | `bracket.winnersRounds[]`, `losersRounds[]`, `grandFinalsRounds[]` match channelIds |
| Swiss | `bracket.rounds[].matches[].channelId` |
| Round Robin | `bracket.rounds[].matches[].channelId` |
| Battle Royale | `bracket.groups[].channelId`, `bracket.finals.channelId` |

### Post-Cleanup

After cleanup (manual or auto), `clearBracketChannelIds()` removes all `channelId` values from the bracket data. This ensures:
- The tournament won't appear in the cleanup autocomplete list again
- No stale channel references remain

### Server Settings

| Setting | Default | Description |
|---|---|---|
| `autoCleanup` | `false` | Whether to auto-cleanup on tournament completion |
| `autoCleanupMode` | `'delete'` | `'delete'` or `'archive'` |

### Settings Display

The `/admin settings` embed now includes:
```
🧹 Auto-Cleanup: Enabled (delete)
```

### Implementation

| File | Change |
|---|---|
| `src/services/channelService.js` | Added `collectTournamentChannels()`, `findOrCreateArchiveCategory()`, `archiveMatchRoom()`, `bulkCleanupChannels()`, `clearBracketChannelIds()` |
| `src/commands/admin/settings.js` | Added `/admin cleanup` and `/admin set-auto-cleanup` subcommands, autocomplete handler |
| `src/data/serverSettings.js` | Added `autoCleanup` and `autoCleanupMode` to `DEFAULT_SETTINGS` |
| `src/commands/match/match.js` | Added `triggerAutoCleanup()` called after tournament completion in both `handleReport()` and `handleBRReport()` |

---

## Updated Server Settings

```javascript
const DEFAULT_SETTINGS = {
  announcementChannelName: 'tournament-announcements',
  announcementChannelId: null,
  matchRoomCategory: null,
  defaultFormat: 'single_elimination',
  defaultCheckin: false,
  defaultCheckinWindow: 30,
  autoCleanup: false,        // NEW in v2.2
  autoCleanupMode: 'delete', // NEW in v2.2 — 'delete' or 'archive'
};
```

---

## Updated Admin Commands Summary

### Server Settings (Admin)

| Command | Description |
|---|---|
| `/admin settings` | View current server settings (updated with auto-cleanup) |
| `/admin set-announcement-channel` | Set tournament announcement channel |
| `/admin set-match-category` | Set match room category |
| `/admin cleanup` | **NEW** — Clean up match rooms from a tournament |
| `/admin set-auto-cleanup` | **NEW** — Enable/disable automatic cleanup |

---

## Channel Permission Architecture

### Match Room Creation

When creating match rooms and categories, the bot sets permission overwrites in a two-step process:

**Step 1 — Channel creation** with base permissions:
```javascript
permissionOverwrites: [
  { id: everyone, deny: [ViewChannel] },
  { id: bot, allow: [ViewChannel, SendMessages, ManageChannels, ManageMessages, EmbedLinks, ReadMessageHistory] },
  { id: participant1, allow: [ViewChannel, SendMessages] },
  { id: participant2, allow: [ViewChannel, SendMessages] },
]
```

**Step 2 — Post-creation edit** to add `ManageRoles`:
```javascript
await channel.permissionOverwrites.edit(bot.id, { ManageRoles: true });
```

> **Why two steps?** Discord's API rejects channel creation requests that include `ManageRoles` in permission overwrites, even when the bot has `ManageRoles` at the guild level. This is a known API restriction. The post-creation edit works because the bot's guild-level `ManageRoles` permission is sufficient for editing existing channel overwrites.

### Category Creation

Same two-step pattern for both match categories and archive categories:
1. Create with `ViewChannel` + `ManageChannels`
2. Edit to add `ManageRoles`

---

## Updated File Structure

```
src/
├── commands/
│   ├── admin/
│   │   └── settings.js          # Updated: +cleanup, +set-auto-cleanup, +autocomplete
│   ├── match/
│   │   └── match.js             # Updated: +triggerAutoCleanup on completion
│   └── tournament/
│       └── create.js            # Updated: +scheduleReminders, +cancelReminders
│
├── components/
│   └── simpleCreateModal.js     # Updated: +scheduleReminders after creation
│
├── services/
│   ├── channelService.js        # Updated: +cleanup functions, +ManageRoles post-creation
│   └── reminderService.js       # Updated: +channel announcements, +rescheduleAllReminders
│
├── utils/
│   ├── timeUtils.js             # Updated: +Discord timestamps, +timezone table
│   └── embedBuilder.js          # Updated: formatDate uses Discord timestamps
│
├── data/
│   └── serverSettings.js        # Updated: +autoCleanup, +autoCleanupMode
│
└── events/
    └── ready.js                 # Updated: +rescheduleAllReminders on startup
```

---

## Verification Checklist

### Discord Timestamps
- [ ] Create a tournament — date field shows as clickable Discord timestamp
- [ ] Timestamp shows relative countdown (e.g., "in 3 hours")
- [ ] Different users see the time in their local timezone

### Timezone Parsing
- [ ] `Feb 15 7pm UTC` parses correctly
- [ ] `Feb 15 8pm CET` parses as 7pm UTC
- [ ] `Jan 30 07:25 UTC` parses as current year (not 2001)
- [ ] `2026-02-15 19:00` still works via native parser

### Reminders
- [ ] Create tournament with near-future start time
- [ ] Console shows "Scheduled X reminder(s) for tournament: ..."
- [ ] Reminder posts in tournament channel
- [ ] Reminder DMs sent to participants
- [ ] Cancel tournament — console confirms reminders cancelled
- [ ] Restart bot — console shows "Re-scheduled reminders for X active tournament(s)"

### Channel Cleanup
- [ ] Run tournament to completion
- [ ] `/admin cleanup tournament:X mode:delete` — match rooms deleted
- [ ] `/admin cleanup tournament:X mode:archive` — channels locked and moved to "Archived Matches"
- [ ] Cleaned-up tournament no longer appears in cleanup autocomplete
- [ ] Cancelled tournaments without channels don't appear in list

### Auto-Cleanup
- [ ] `/admin set-auto-cleanup enabled:true` — confirms enabled
- [ ] Complete a tournament — match rooms auto-deleted after 30 seconds
- [ ] `/admin set-auto-cleanup enabled:false` — confirms disabled
- [ ] Complete a tournament — match rooms remain

---

*End of Specification v2.2*
