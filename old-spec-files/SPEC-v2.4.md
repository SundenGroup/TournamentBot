# Discord Tournament Bot — Technical Specification

> **Version:** 2.4
> **Last Updated:** February 2026
> **Tech Stack:** Node.js + discord.js v14+

---

## What's New in v2.4

### New Features
1. **Multi-Step Tournament Creation Wizard** — `/tournament create-advanced` now launches a guided multi-step wizard using Discord message components (select menus, buttons, modals) instead of a 19-option slash command.

### Bug Fixes
1. **Game nick collection in captain mode** — When captain mode + require-game-nick are both enabled, the captain now provides ALL team members' game nicks (one per line in a paragraph field) instead of only their own.
2. **Duplicate match room prevention** — Added race condition guards to prevent duplicate channel creation when concurrent interactions (button clicks, match reports) trigger channel creation for the same match.
3. **Match category per-game isolation** — Match room categories are now scoped per game. A Rocket League tournament no longer reuses a "VAL Matches" category from a previous Valorant tournament.

### Changes from v2.3
- Removed all 19 options from `/tournament create-advanced` slash command definition
- New wizard session store (`src/data/wizardSessions.js`) with 30-min TTL
- 5 new component handlers for wizard steps (`wizardGame`, `wizardBasic`, `wizardSettings`, `wizardOptions`) + shared creation helper (`wizardCreate`)
- `interactionCreate.js` now routes `RoleSelectMenu` interactions
- `channelService.js` uses `pendingCreations` Set and channel name dedup checks
- `findOrCreateMatchCategory` uses exact category name matching instead of broad `.includes()`
- `startTournament.js` and `handleStart()` immediately set status to `'active'` before deferring reply
- `signup.js` shows paragraph field for all team game nicks in captain mode
- `teamRegister.js` parses and validates per-member game nicks, stores captain's game nick

---

## What's New in v2.3

### New Features
1. **Captain Mode** — Deferred team member resolution. Only the captain needs to be in the server at signup; teammates are entered as text and resolved when the tournament starts.

### Changes from v2.2
- Server-wide `captainMode` default in server settings
- Per-tournament `captainMode` override on `/tournament create-advanced`
- `/admin set-captain-mode` toggle command
- Pending member display in participant lists and match embeds
- Null-safe guards across all DM loops, permission overwrites, and check-in logic
- Fixed `addTeam()` duplicate detection to handle null member IDs

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

## Feature: Multi-Step Tournament Creation Wizard (NEW in v2.4)

### Overview

`/tournament create-advanced` now launches a guided multi-step wizard instead of presenting 19 slash command options. The wizard uses Discord message components (select menus, buttons, modals) to walk the user through tournament creation. The simple `/tournament create` flow is unchanged.

### User Flow

```
/tournament create-advanced
    ↓
Step 1: Game Select (StringSelectMenu — top 25 presets + "More Games" expansion)
    ↓
Step 2: Basic Info (Modal — title, date/time, max players, description)
    ↓
Step 3: Settings (Message — format, team size, best of dropdowns + toggle buttons)
    ↓  [Create Tournament] or [More Options ⚙️]
    ↓
Step 4: Advanced Options (conditional — BR settings, check-in window, required roles)
    ↓  [Create Tournament]
    ↓
Tournament created → announcement posted
```

### Architecture

#### Session Store

In-memory Map stores temporary wizard state keyed by UUID. Sessions auto-expire after 30 minutes with a 5-minute cleanup interval.

**File: `src/data/wizardSessions.js`**

```javascript
const { v4: uuidv4 } = require('uuid');
const sessions = new Map();

// Exports:
createSession(userId, guildId)  // → { id, userId, guildId, data: {}, createdAt }
getSession(id)                  // → session or null (auto-deletes expired)
updateSession(id, dataObj)      // → merges dataObj into session.data
deleteSession(id)               // → removes session
```

#### CustomId Convention

All wizard components use colon-separated customIds: `wizardStep:sessionId[:subAction]`

The existing `interactionCreate` router splits on `:` to get the handler name and passes the remainder as `args`.

| CustomId Pattern | Handler | Args |
|---|---|---|
| `wizardGame:{sessionId}` | `wizardGame` | `[sessionId]` |
| `wizardBasic:{sessionId}` | `wizardBasic` | `[sessionId]` |
| `wizardSettings:{sessionId}:format` | `wizardSettings` | `[sessionId, 'format']` |
| `wizardSettings:{sessionId}:toggleCheckin` | `wizardSettings` | `[sessionId, 'toggleCheckin']` |
| `wizardOptions:{sessionId}:lobbySize` | `wizardOptions` | `[sessionId, 'lobbySize']` |

### Step 1 — Game Select (`wizardGame.js`)

- Shows top 25 game presets as a `StringSelectMenu` + a "Custom Game" option
- If more than 25 presets exist, includes a "More Games..." option that re-renders with the full list
- On selection: stores game preset in session, shows basic info modal

### Step 2 — Basic Info Modal (`wizardBasic.js`)

- Modal with 3-4 fields depending on whether game is custom:
  - **Custom game:** Game Name, Title, Date/Time, Max Players
  - **Preset game:** Title, Date/Time, Max Players, Description (optional)
- Validates: title required, datetime via `parseDateTime`, maxParticipants 2-128
- On first pass: initializes format/teamSize/bestOf/toggles from game preset defaults
- On re-edit (via "Edit Info" button): preserves existing settings

### Step 3 — Settings Message (`wizardSettings.js`)

**Message layout (5 ActionRows):**

| Row | Component |
|---|---|
| 1 | Format select (from game preset's `formatOptions`) |
| 2 | Team Size select (from `teamSizeOptions`) |
| 3 | Best Of select (from `bestOfOptions`, hidden for Battle Royale) |
| 4 | Toggle buttons: ✅/❌ Check-in, Game Nick, Captain Mode, Seeding |
| 5 | Navigation: [← Edit Info] [⚙️ More Options] [✅ Create Tournament] |

- Select menus and toggle buttons use `interaction.update()` to edit the message in-place
- Toggle buttons use `ButtonStyle.Success` (green) / `ButtonStyle.Secondary` (gray)
- "Edit Info" re-opens the basic info modal
- "More Options" navigates to Step 4
- "Create Tournament" creates the tournament with current settings

### Step 4 — Advanced Options (`wizardOptions.js`)

Conditional content based on format and settings:

**Battle Royale format:**

| Row | Component |
|---|---|
| 1 | Lobby Size select (10, 20, 30, 50, 100) |
| 2 | Games per Stage select (1, 2, 3, 5, 7, 10) |
| 3 | Advancing per Group select (Auto, 2, 4, 6, 8) |
| 4 | Required Roles (RoleSelectMenu, max 3) |
| 5 | [← Back] [✅ Create Tournament] |

**Non-BR + check-in enabled:** Check-in Window select + Required Roles + navigation

**Non-BR + no check-in:** Required Roles + navigation

### Tournament Creation (`wizardCreate.js`)

Shared helper (not registered as a component — no `customId`/`execute`):

1. Reads all values from `session.data`
2. Fills defaults from game preset for unset values
3. Calls `createTournament()` from tournamentService
4. Posts announcement embed + participant list
5. Schedules reminders
6. Deletes wizard session
7. Updates the wizard message with a success confirmation via `interaction.update()`

### RoleSelectMenu Routing

Added to `src/events/interactionCreate.js`:

```javascript
if (interaction.isRoleSelectMenu()) {
  const [action, ...args] = interaction.customId.split(':');
  const handler = interaction.client.selectMenus.get(action);
  // same routing pattern as StringSelectMenu
}
```

### Implementation

| File | Action | Description |
|---|---|---|
| `src/data/wizardSessions.js` | **New** | In-memory wizard session storage with auto-cleanup |
| `src/components/wizardGame.js` | **New** | Step 1: Game selection → shows basic info modal |
| `src/components/wizardBasic.js` | **New** | Step 2: Basic info modal → shows settings message |
| `src/components/wizardSettings.js` | **New** | Step 3: Format/team/bestOf selects + toggle buttons |
| `src/components/wizardOptions.js` | **New** | Step 4: BR settings, check-in window, required roles |
| `src/components/wizardCreate.js` | **New** | Shared tournament creation helper (not a registered component) |
| `src/commands/tournament/create.js` | **Modified** | Stripped options from create-advanced, launches wizard |
| `src/events/interactionCreate.js` | **Modified** | Added RoleSelectMenu routing |

---

## Fix: Game Nick Collection in Captain Mode (v2.4)

### Problem

When both captain mode and require-game-nick were enabled, only the captain's in-game nickname was collected. Teammates' nicks were never requested.

### Solution

When captain mode + requireGameNick are both enabled, the team registration modal shows a **paragraph** (multi-line) text field where the captain enters ALL team members' game nicks, one per line (their own first, then each teammate in the same order as the member list).

When captain mode is OFF, the existing single-line field for the captain's own nick is preserved.

### Changes

| File | Change |
|---|---|
| `src/components/signup.js` | Captain mode + requireGameNick: shows `teamGameNicks` paragraph field labeled "All Game Nicks (N nicks, one per line)". Non-captain mode: keeps existing `captainGameNick` short field. |
| `src/components/teamRegister.js` | Parses `teamGameNicks` field, validates count matches `teamSize`, assigns `gameNick` property to each member object and the captain. Also fixed existing bug where captain's game nick was collected but never stored on the captain object. |

### Validation

The handler rejects registration if the number of nicks provided doesn't match `teamSize`:

```
❌ Please provide exactly 5 game nicks (one per line). You provided 3.
```

---

## Fix: Duplicate Match Room Prevention (v2.4)

### Problem

Race conditions caused duplicate match room channels when:
1. Both the "Start Tournament" button and `/tournament start` command were triggered concurrently
2. Concurrent match reports both saw `match.channelId` as undefined and each created a new channel

### Solution

Three-layer protection:

#### Layer 1 — Early status flip

Both `startTournament.js` (button) and `handleStart()` (command) immediately set tournament status to `'active'` **before** deferring the reply. This prevents the second concurrent handler from passing the status check.

```javascript
// Immediately mark as active to prevent concurrent starts
updateTournament(tournamentId, { status: 'active' });
await interaction.deferReply({ ephemeral: true });
```

#### Layer 2 — Pending creation tracking

`channelService.js` maintains a `pendingCreations` Set that tracks in-progress channel creations by key (`match:{guildId}:{matchId}` or `br:{guildId}:{groupId}`). If a second call arrives for the same key, it waits 2 seconds and returns the existing channel.

#### Layer 3 — Channel name dedup

Before creating a channel, `_createMatchRoom()` checks the guild's channel cache for an existing channel with the same name. If found, returns the existing channel instead of creating a duplicate.

### Changes

| File | Change |
|---|---|
| `src/services/channelService.js` | Added `pendingCreations` Set, dedup wrapper on `createMatchRoom()` and `createBRGroupRoom()`, channel name cache check |
| `src/components/startTournament.js` | Early `updateTournament(tournamentId, { status: 'active' })` before `deferReply()` |
| `src/commands/tournament/create.js` | Same early status flip in `handleStart()` |

---

## Fix: Match Category Per-Game Isolation (v2.4)

### Problem

`findOrCreateMatchCategory()` searched for existing categories using `.includes('match')`, which matched any game's match category. A Rocket League tournament would reuse a "VAL Matches" category from a previous Valorant tournament.

### Solution

Changed the category search to use exact name matching:

```javascript
// Before (matches any category containing "match")
guild.channels.cache.find(c => c.name.toLowerCase().includes('match'))

// After (exact match on the target category name)
guild.channels.cache.find(c =>
  c.type === ChannelType.GuildCategory &&
  (c.name === categoryName || c.name.startsWith(categoryName))
)
```

This ensures each game gets its own match category (e.g., "RL Matches", "VAL Matches") and overflow categories are matched correctly ("RL Matches 2", etc.).

### Changes

| File | Change |
|---|---|
| `src/services/channelService.js` | `findOrCreateMatchCategory()` uses exact `categoryName` match with `startsWith` for numbered overflow |

---

## Feature: Captain Mode (NEW in v2.3)

### Overview

Captain Mode controls whether ALL team members must be verified Discord server members at signup time, or whether the captain can enter Discord usernames as text that get resolved later when the tournament starts.

- **Captain Mode OFF (default):** All members must be resolvable guild members at signup. Registration fails if a name can't be found.
- **Captain Mode ON:** Only the captain needs to be in the server. Captain enters teammate Discord usernames as text. At tournament start, the bot resolves text names to Discord members. Resolved members get match room access; unresolved ones are display-only.

Solo tournaments are unaffected. The captain (the user pressing the button) is always resolved.

### Configuration

Captain Mode is configured in two places:

#### 1. Server-wide default

```
/admin set-captain-mode enabled:true
/admin set-captain-mode enabled:false
```

Sets the default for all new tournaments in the server. Visible in `/admin settings` as:
```
👑 Captain Mode: Enabled
```

#### 2. Per-tournament override

```
/tournament create-advanced ... captain_mode:true
```

The `captain_mode` boolean option on `create-advanced` overrides the server default for that tournament. When not provided, falls through to the server-wide setting.

#### Resolution priority

The `captainMode` value stored on the tournament is determined at creation time:

```javascript
captainMode: data.captainMode ?? getServerSettings(data.guildId).captainMode ?? false
```

At registration time, `teamRegister.js` also falls back to the server setting for tournaments created before captain mode was enabled:

```javascript
const captainModeEnabled = tournament.settings.captainMode
  ?? getServerSettings(tournament.guildId).captainMode
  ?? false;
```

### Registration Flow

#### Captain Mode OFF (default behavior)

1. Captain submits team registration modal with teammate usernames
2. Bot resolves each username against guild member cache (by username or display name)
3. Falls back to `guild.members.fetch(id)` for numeric IDs
4. If any member can't be found: registration fails with error message
5. All members stored with Discord IDs
6. DMs sent to all team members

#### Captain Mode ON

1. Captain submits team registration modal with teammate usernames
2. Bot stores each teammate as a **pending** member:
   ```javascript
   { id: null, username: cleanInput, displayName: cleanInput, pending: true }
   ```
3. Captain is always resolved (they're the interaction user)
4. Registration succeeds immediately
5. DMs are skipped for pending members (no ID to fetch)
6. Participant list shows `username (pending)` for unresolved members

### Resolution at Tournament Start

When a tournament with captain mode starts (via `/tournament start` or the Start Tournament button), pending members are resolved before bracket generation:

1. Bot calls `resolveTeamMembers(guild, tournament)`
2. For each member with `pending: true`:
   - Searches guild member cache by username and display name (case-insensitive)
   - Falls back to `guild.members.fetch({ query: username, limit: 5 })`
   - If found: updates `id`, `username`, `displayName`, removes `pending` flag
   - If not found: member remains pending (display-only in match rooms)
3. Updated teams are persisted
4. Console logs resolution counts:
   ```
   Captain mode resolution for "Weekend Cup": 3 resolved, 1 failed
   ```

### Pending Member Behavior

Members that remain unresolved after tournament start are handled gracefully:

| Feature | Behavior with pending members |
|---|---|
| **Match room permissions** | Skipped (no Discord ID to grant access) |
| **Match embed display** | Shown with `(pending)` tag |
| **Check-in** | Cannot check in (ID is null, won't match interaction user) |
| **Check-in threshold** | Only counts resolved members for "all checked in" |
| **DM reminders** | Skipped |
| **DM on withdrawal** | Skipped |
| **Participant list** | Shows `username (pending)` |
| **Duplicate detection** | Compared by username (case-insensitive) instead of ID |

### Duplicate Detection in addTeam()

The `addTeam()` function in `tournamentService.js` uses a dual comparison strategy:

- **Resolved members** (have an `id`): compared by `member.id === existing.id`
- **Pending members** (both have `pending: true`): compared by `username.toLowerCase()`

This prevents the same pending username from being registered on multiple teams while avoiding null ID comparisons.

### Null-Safety Guards

All code paths that previously assumed `member.id` is a non-null string now guard against null:

| File | Location | Guard |
|---|---|---|
| `src/services/channelService.js` | `createMatchRoom()` solo participant1 | `match.participant1.id &&` |
| `src/services/channelService.js` | `createMatchRoom()` solo participant2 | `match.participant2.id &&` |
| `src/services/channelService.js` | `createMatchRoom()` team1 member loop | `member.id &&` |
| `src/services/channelService.js` | `createMatchRoom()` team2 member loop | `member.id &&` |
| `src/services/channelService.js` | `createBRGroupRoom()` solo team check | `team.id &&` |
| `src/services/channelService.js` | `createBRGroupRoom()` team member loop | `member.id &&` |
| `src/services/channelService.js` | `createMatchEmbed()` captain indicator | `m.id && m.id === team.captain?.id` |
| `src/services/reminderService.js` | `sendReminder()` team DM loop | `!member.id \|\|` |
| `src/services/reminderService.js` | `openCheckin()` team DM loop | `!member.id \|\|` |
| `src/components/withdraw.js` | Team withdrawal DM loop | `if (!member.id) continue` |
| `src/components/teamRegister.js` | Post-registration DM loop | `if (!member.id) continue` |
| `src/components/checkin.js` | Team check-in threshold | Counts only `m.id && !m.id.startsWith('fake_')` |

### Admin Command

#### `/admin set-captain-mode`

| Option | Type | Required | Description |
|---|---|---|---|
| `enabled` | Boolean | Yes | Enable/disable captain mode server-wide |

**Example responses:**
```
✅ Captain Mode enabled. Only the team captain needs to be in the server at signup. Other members are resolved at tournament start.
```
```
✅ Captain Mode disabled. All team members must be in the server at signup.
```

### Tournament Create Option

#### `captain_mode` on `/tournament create-advanced`

| Option | Type | Required | Description |
|---|---|---|---|
| `captain_mode` | Boolean | No | Only captain required at signup; members resolved at start |

When not provided, the tournament inherits the server-wide `captainMode` setting.

### API

```javascript
const { resolveTeamMembers } = require('./services/tournamentService');

// Resolve pending team members against a guild
// Returns { resolved: number, failed: number }
const { resolved, failed } = await resolveTeamMembers(guild, tournament);
```

### Implementation

| File | Changes |
|---|---|
| `src/data/serverSettings.js` | Added `captainMode: false` to `DEFAULT_SETTINGS` |
| `src/services/tournamentService.js` | Import `getServerSettings`, store `captainMode` in tournament settings, fix `addTeam()` duplicate detection for null IDs, added `resolveTeamMembers()` export |
| `src/commands/admin/settings.js` | Added `set-captain-mode` subcommand + handler + settings display field + help text |
| `src/commands/tournament/create.js` | Added `captain_mode` option to `create-advanced`, resolution step in `handleStart()` |
| `src/components/teamRegister.js` | Import `getServerSettings`, conditional member resolution (resolve vs store-as-text), server setting fallback, guard DM loop |
| `src/components/startTournament.js` | Resolution step before bracket generation |
| `src/services/channelService.js` | Null-safe guards on 6 permission overwrite locations + captain indicator + pending tags in match embeds |
| `src/components/checkin.js` | Resolved-member-count threshold for full team check-in |
| `src/services/reminderService.js` | Null guards on 2 DM loops |
| `src/components/withdraw.js` | Null guard on DM loop |
| `src/utils/embedBuilder.js` | Show `(pending)` next to unresolved team members in participant list |

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

Fake/test users (IDs starting with `fake_`) and pending members (null IDs from captain mode) are skipped for DMs.

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
  autoCleanup: false,
  autoCleanupMode: 'delete',
  tournamentAdminRoles: [],
  captainMode: false,          // NEW in v2.3
};
```

---

## Updated Tournament Settings

The `tournament.settings` object now includes:

```javascript
settings: {
  maxParticipants,
  teamSize,
  format,
  bestOf,
  checkinRequired,
  checkinWindow,
  seedingEnabled,
  requireGameNick,
  mapPool,
  mapPickProcess,
  ruleset,
  gameSettings,
  requiredRoles,
  lobbySize,
  gamesPerStage,
  advancingPerGroup,
  captainMode,                 // NEW in v2.3 — boolean
}
```

---

## Updated Admin Commands Summary

### Server Settings (Admin)

| Command | Description |
|---|---|
| `/admin settings` | View current server settings |
| `/admin set-announcement-channel` | Set tournament announcement channel |
| `/admin set-match-category` | Set match room category |
| `/admin set-role` | Add/remove tournament admin roles |
| `/admin cleanup` | Clean up match rooms from a tournament |
| `/admin set-auto-cleanup` | Enable/disable automatic cleanup |
| `/admin set-captain-mode` | **NEW** — Toggle captain mode (deferred member resolution) |
| `/admin add-players` | Debug: add fake players |
| `/admin add-teams` | Debug: add fake teams |
| `/admin clear-participants` | Debug: clear participants |
| `/admin help` | Show help overview |

---

## Channel Permission Architecture

### Match Room Creation

When creating match rooms and categories, the bot sets permission overwrites in a two-step process:

**Step 1 — Channel creation** with base permissions:
```javascript
permissionOverwrites: [
  { id: everyone, deny: [ViewChannel] },
  { id: bot, allow: [ViewChannel, SendMessages, ManageChannels, ManageMessages, EmbedLinks, ReadMessageHistory] },
  { id: participant1, allow: [ViewChannel, SendMessages] },  // skipped if id is null
  { id: participant2, allow: [ViewChannel, SendMessages] },  // skipped if id is null
]
```

**Step 2 — Post-creation edit** to add `ManageRoles`:
```javascript
await channel.permissionOverwrites.edit(bot.id, { ManageRoles: true });
```

> **Why two steps?** Discord's API rejects channel creation requests that include `ManageRoles` in permission overwrites, even when the bot has `ManageRoles` at the guild level. This is a known API restriction. The post-creation edit works because the bot's guild-level `ManageRoles` permission is sufficient for editing existing channel overwrites.

### Null-Safe Permission Overwrites (v2.3)

All permission overwrite pushes now guard against null member IDs (from captain mode pending members or other edge cases):

```javascript
// Before (would throw on null id)
if (!member.id.startsWith('fake_')) { ... }

// After (null-safe)
if (member.id && !member.id.startsWith('fake_')) { ... }
```

This applies to all 6 locations in `channelService.js` where participant/member permissions are added.

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
│   │   └── settings.js          # v2.2: +cleanup, +auto-cleanup
│   │                            # v2.3: +set-captain-mode, +captain mode display
│   ├── match/
│   │   └── match.js             # v2.2: +triggerAutoCleanup on completion
│   └── tournament/
│       └── create.js            # v2.2: +scheduleReminders, +cancelReminders
│                                # v2.3: +captain_mode option, +resolveTeamMembers at start
│                                # v2.4: stripped create-advanced options, launches wizard
│                                #        +early status flip in handleStart()
│
├── components/
│   ├── checkin.js               # v2.3: resolved-member-count threshold
│   ├── signup.js                # v2.4: paragraph field for all team game nicks in captain mode
│   ├── simpleCreateModal.js     # v2.2: +scheduleReminders after creation
│   ├── startTournament.js       # v2.3: +resolveTeamMembers before bracket generation
│   │                            # v2.4: +early status flip to prevent concurrent starts
│   ├── teamRegister.js          # v2.3: conditional member resolution, server setting fallback
│   │                            # v2.4: +per-member game nick parsing, +captain nick storage
│   ├── wizardBasic.js           # v2.4: NEW — Step 2: basic info modal handler
│   ├── wizardCreate.js          # v2.4: NEW — shared tournament creation helper (not registered)
│   ├── wizardGame.js            # v2.4: NEW — Step 1: game selection handler
│   ├── wizardOptions.js         # v2.4: NEW — Step 4: advanced options handler
│   ├── wizardSettings.js        # v2.4: NEW — Step 3: settings message handler
│   └── withdraw.js              # v2.3: null guard on DM loop
│
├── services/
│   ├── channelService.js        # v2.2: +cleanup functions, +ManageRoles post-creation
│   │                            # v2.3: +null-safe permission guards, +pending tags in embeds
│   │                            # v2.4: +pendingCreations dedup, +channel name check,
│   │                            #        +exact category name matching
│   ├── reminderService.js       # v2.2: +channel announcements, +rescheduleAllReminders
│   │                            # v2.3: +null guards on DM loops
│   └── tournamentService.js     # v2.3: +captainMode setting, +resolveTeamMembers(),
│                                #        +null-safe addTeam() duplicate detection
│
├── utils/
│   ├── timeUtils.js             # v2.2: +Discord timestamps, +timezone table
│   └── embedBuilder.js          # v2.2: formatDate uses Discord timestamps
│                                # v2.3: +(pending) display for unresolved members
│
├── data/
│   ├── serverSettings.js        # v2.2: +autoCleanup, +autoCleanupMode
│   │                            # v2.3: +captainMode
│   └── wizardSessions.js        # v2.4: NEW — in-memory wizard session store
│
└── events/
    ├── interactionCreate.js     # v2.4: +RoleSelectMenu routing
    └── ready.js                 # v2.2: +rescheduleAllReminders on startup
```

---

## Verification Checklist

### Tournament Creation Wizard (v2.4)

#### Basic wizard flow
- [ ] `/tournament create-advanced` — shows game select menu (ephemeral)
- [ ] Select a game (e.g., CS2) — modal appears with title/date/max fields
- [ ] Submit modal — settings message appears with game preset defaults
- [ ] Click "Create Tournament" — tournament created, announcement posted

#### Settings customization
- [ ] Change format via dropdown → message updates showing new format
- [ ] Toggle check-in on → button turns green with ✅
- [ ] Toggle captain mode on → button turns green with ✅
- [ ] Click "Create Tournament" — tournament has customized settings

#### Advanced options
- [ ] Select format "Battle Royale" in Step 3
- [ ] Click "More Options" → BR-specific settings appear (lobby size, games per stage, etc.)
- [ ] Adjust values and click "Create Tournament" — tournament has correct BR settings

#### Required roles
- [ ] In Step 4, use role select menu to pick 1-3 roles
- [ ] Create tournament → requiredRoles are set on the tournament

#### Edge cases
- [ ] Session timeout (30+ min) → shows "Session expired" error
- [ ] Invalid date in modal → shows error, does not advance
- [ ] Max participants outside 2-128 → shows error
- [ ] Custom game → shows Game Name field in modal
- [ ] "Edit Info" button → modal re-opens, settings preserved on submit

#### Existing behavior
- [ ] `/tournament create` (simple mode) — completely unchanged

### Game Nick in Captain Mode (v2.4)
- [ ] Captain mode ON + require game nick: modal shows paragraph field for all nicks
- [ ] Captain provides correct count → registration succeeds, nicks assigned to members
- [ ] Captain provides wrong count → registration fails with count error
- [ ] Captain mode OFF + require game nick: modal shows single-line field (unchanged)

### Duplicate Match Room Prevention (v2.4)
- [ ] Starting a tournament creates correct number of match rooms (no duplicates)
- [ ] Rapid concurrent match reports do not create duplicate next-round channels

### Match Category Isolation (v2.4)
- [ ] Create Valorant tournament → channels under "VAL Matches" category
- [ ] Create Rocket League tournament → channels under "RL Matches" category (separate)
- [ ] Categories not shared across different games

### Captain Mode (v2.3)

#### Server-wide toggle
- [ ] `/admin set-captain-mode enabled:true` — confirms enabled
- [ ] `/admin settings` — shows "Captain Mode: Enabled"
- [ ] `/admin set-captain-mode enabled:false` — confirms disabled, shows "Captain Mode: Disabled"

#### Per-tournament override
- [ ] `/tournament create-advanced ... captain_mode:true` — creates tournament with captain mode
- [ ] Default (option not set) uses server-wide setting
- [ ] Server setting changed after tournament creation — registration respects current server setting as fallback

#### Registration flow
- [ ] Captain mode ON: captain registers team with text usernames (members not in server) — succeeds
- [ ] Participant list shows `username (pending)` for unresolved members
- [ ] Captain mode OFF: registration fails if member not found — same as current behavior

#### Tournament start resolution
- [ ] When tournament starts: bot resolves pending members, logs count to console
- [ ] Resolved members get match room access (channel permission overwrites)
- [ ] Unresolved members are display-only in match embeds (shown with `(pending)` tag)

#### Null safety
- [ ] DMs, reminders, withdrawals: no crashes on null member IDs
- [ ] Check-in threshold counts only resolved members
- [ ] Solo tournaments: completely unaffected by captain mode changes

### Discord Timestamps (v2.2)
- [ ] Create a tournament — date field shows as clickable Discord timestamp
- [ ] Timestamp shows relative countdown (e.g., "in 3 hours")
- [ ] Different users see the time in their local timezone

### Timezone Parsing (v2.2)
- [ ] `Feb 15 7pm UTC` parses correctly
- [ ] `Feb 15 8pm CET` parses as 7pm UTC
- [ ] `Jan 30 07:25 UTC` parses as current year (not 2001)
- [ ] `2026-02-15 19:00` still works via native parser

### Reminders (v2.2)
- [ ] Create tournament with near-future start time
- [ ] Console shows "Scheduled X reminder(s) for tournament: ..."
- [ ] Reminder posts in tournament channel
- [ ] Reminder DMs sent to participants
- [ ] Cancel tournament — console confirms reminders cancelled
- [ ] Restart bot — console shows "Re-scheduled reminders for X active tournament(s)"

### Channel Cleanup (v2.2)
- [ ] Run tournament to completion
- [ ] `/admin cleanup tournament:X mode:delete` — match rooms deleted
- [ ] `/admin cleanup tournament:X mode:archive` — channels locked and moved to "Archived Matches"
- [ ] Cleaned-up tournament no longer appears in cleanup autocomplete
- [ ] Cancelled tournaments without channels don't appear in list

### Auto-Cleanup (v2.2)
- [ ] `/admin set-auto-cleanup enabled:true` — confirms enabled
- [ ] Complete a tournament — match rooms auto-deleted after 30 seconds
- [ ] `/admin set-auto-cleanup enabled:false` — confirms disabled
- [ ] Complete a tournament — match rooms remain

---

*End of Specification v2.4*
