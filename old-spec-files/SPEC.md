# Discord Tournament Bot — Technical Specification

> **Version:** 2.1  
> **Last Updated:** January 2026  
> **Tech Stack:** Node.js + discord.js v14+

---

## Overview

A Discord bot that allows server admins to create and manage tournaments with support for single/double elimination formats, solo or team play, seeding, and game-specific configurations. Features both simple and advanced setup modes for different admin needs.

### Core Principles

- **Simple for users** — Button-based signup, clear feedback
- **Flexible for admins** — Simple mode for quick setup, advanced mode for full control
- **Game-aware** — Pre-configured settings for popular games, customizable for any game
- **Scalable architecture** — Built to support databases and future features

---

## Game Configuration System

### Overview

The bot includes a **game presets system** that provides pre-configured defaults for popular games. Admins can use these presets as-is, modify them, or create fully custom tournaments.

### Game Preset Structure

Each game preset includes:

| Setting | Description | Example (CS2) |
|---------|-------------|---------------|
| `displayName` | Game's display name | "Counter-Strike 2" |
| `shortName` | Abbreviated name | "CS2" |
| `icon` | Emoji or custom emoji | "🎯" |
| `defaultTeamSize` | Default players per team | 5 |
| `teamSizeOptions` | Allowed team sizes | [1, 2, 5] |
| `defaultFormat` | Default bracket format | "double_elimination" |
| `defaultBestOf` | Default match length | 3 |
| `bestOfOptions` | Allowed best-of values | [1, 3, 5] |
| `mapPool` | Available maps (if applicable) | ["Dust2", "Mirage", "Inferno", ...] |
| `mapPickProcess` | How maps are selected | "veto" / "random" / "admin_pick" |
| `ruleset` | Default rules text | "Standard competitive rules..." |
| `customFields` | Game-specific settings | { "overtime": true, "knifeRound": true } |

### Built-in Game Presets

```javascript
// Example preset structure - actual presets can be expanded
const GAME_PRESETS = {
  cs2: {
    displayName: "Counter-Strike 2",
    shortName: "CS2",
    icon: "🎯",
    defaultTeamSize: 5,
    teamSizeOptions: [1, 2, 5],
    defaultFormat: "double_elimination",
    defaultBestOf: 3,
    bestOfOptions: [1, 3, 5],
    mapPool: ["Ancient", "Anubis", "Dust2", "Inferno", "Mirage", "Nuke", "Vertigo"],
    mapPickProcess: "veto",
    ruleset: "Standard competitive rules. Overtime enabled. Knife for sides.",
    customFields: {
      overtime: { type: "boolean", default: true, label: "Overtime Enabled" },
      knifeRound: { type: "boolean", default: true, label: "Knife for Sides" },
      techPauseLimit: { type: "number", default: 4, label: "Tech Pauses per Team" }
    }
  },
  
  valorant: {
    displayName: "Valorant",
    shortName: "VAL",
    icon: "🔫",
    defaultTeamSize: 5,
    teamSizeOptions: [1, 5],
    defaultFormat: "single_elimination",
    defaultBestOf: 3,
    bestOfOptions: [1, 3, 5],
    mapPool: ["Ascent", "Bind", "Breeze", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Split", "Sunset"],
    mapPickProcess: "veto",
    ruleset: "Standard competitive rules.",
    customFields: {
      allowedAgents: { type: "string", default: "all", label: "Agent Restrictions" }
    }
  },
  
  fortnite: {
    displayName: "Fortnite",
    shortName: "FN",
    icon: "🏝️",
    defaultTeamSize: 4,
    teamSizeOptions: [1, 2, 3, 4],
    defaultFormat: "single_elimination",
    defaultBestOf: 1,
    bestOfOptions: [1, 3],
    mapPool: null, // Not applicable
    mapPickProcess: null,
    ruleset: "Battle Royale format. Placement points + elimination points.",
    customFields: {
      scoringSystem: { 
        type: "select", 
        options: ["placement_only", "kills_only", "combined"],
        default: "combined",
        label: "Scoring System"
      },
      matchesPerRound: { type: "number", default: 3, label: "Games per Round" }
    }
  },
  
  league_of_legends: {
    displayName: "League of Legends",
    shortName: "LoL",
    icon: "⚔️",
    defaultTeamSize: 5,
    teamSizeOptions: [1, 5],
    defaultFormat: "double_elimination",
    defaultBestOf: 3,
    bestOfOptions: [1, 3, 5],
    mapPool: ["Summoner's Rift"],
    mapPickProcess: null, // Single map
    ruleset: "Tournament Draft. No remake abuse.",
    customFields: {
      draftMode: { 
        type: "select", 
        options: ["tournament_draft", "blind_pick"],
        default: "tournament_draft",
        label: "Draft Mode"
      },
      sidePick: { type: "select", options: ["higher_seed", "coin_flip"], default: "higher_seed", label: "Side Selection" }
    }
  },
  
  rocket_league: {
    displayName: "Rocket League",
    shortName: "RL",
    icon: "🚗",
    defaultTeamSize: 3,
    teamSizeOptions: [1, 2, 3],
    defaultFormat: "double_elimination",
    defaultBestOf: 5,
    bestOfOptions: [3, 5, 7],
    mapPool: ["DFH Stadium", "Mannfield", "Champions Field", "Urban Central", "Beckwith Park", "Utopia Coliseum", "Aquadome", "Neo Tokyo", "Wasteland", "Farmstead"],
    mapPickProcess: "random",
    ruleset: "Standard competitive settings. No mutators.",
    customFields: {
      gameLength: { type: "number", default: 5, label: "Game Length (minutes)" },
      overtime: { type: "select", options: ["unlimited", "5_min", "sudden_death"], default: "unlimited", label: "Overtime Mode" }
    }
  },
  
  street_fighter_6: {
    displayName: "Street Fighter 6",
    shortName: "SF6",
    icon: "👊",
    defaultTeamSize: 1,
    teamSizeOptions: [1],
    defaultFormat: "double_elimination",
    defaultBestOf: 3,
    bestOfOptions: [3, 5],
    mapPool: null,
    mapPickProcess: null,
    ruleset: "Double elimination. Standard tournament rules.",
    customFields: {
      roundsPerGame: { type: "number", default: 3, label: "Rounds per Game" },
      timerSetting: { type: "number", default: 99, label: "Round Timer" }
    }
  },
  
  // Generic preset for unlisted games
  custom: {
    displayName: null, // Admin provides
    shortName: null,
    icon: "🎮",
    defaultTeamSize: 1,
    teamSizeOptions: [1, 2, 3, 4, 5, 6, 8, 10],
    defaultFormat: "single_elimination",
    defaultBestOf: 1,
    bestOfOptions: [1, 3, 5, 7],
    mapPool: null,
    mapPickProcess: null,
    ruleset: null,
    customFields: {}
  }
};
```

### Adding New Game Presets

Presets are stored in `/src/config/gamePresets.js` and can be:
1. **Built-in** — Shipped with the bot
2. **Server-specific** — Admins can create presets for their server (stored in database when available)

**Command:** `/admin game-preset create`

Creates a new game preset for the server (advanced feature for later).

---

## Admin Setup Modes

### Simple vs Advanced Mode

When creating a tournament, admins choose between two modes:

| Mode | Best For | Options Shown |
|------|----------|---------------|
| **Simple** | Quick setup, casual tournaments | Title, game, date/time, max participants |
| **Advanced** | Competitive events, custom rules | All options including game-specific settings |

### Simple Mode Flow

**Command:** `/tournament create`

When run without arguments, bot responds with a game selection menu:

```
🎮 Create Tournament — Simple Mode

Select a game to get started:

[Counter-Strike 2] [Valorant] [Fortnite]
[League of Legends] [Rocket League] [Street Fighter 6]
[Other Game...]

Or use `/tournament create-advanced` for full customization.
```

After game selection, bot opens a **simplified modal**:

```
┌─────────────────────────────────────┐
│ Create CS2 Tournament               │
├─────────────────────────────────────┤
│ Tournament Title:                   │
│ [Weekend CS2 Cup________________]   │
│                                     │
│ Date & Time (e.g., Feb 15 7pm UTC): │
│ [________________________________]  │
│                                     │
│ Max Teams:                          │
│ [16______________________________]  │
│                                     │
│         [Cancel]  [Create]          │
└─────────────────────────────────────┘
```

**What Simple Mode auto-fills from preset:**
- Team size (5 for CS2)
- Format (double elimination for CS2)
- Best of (3 for CS2)
- Ruleset (standard CS2 rules)
- Check-in (disabled by default)
- Seeding (disabled by default)

**Result embed shows:**
```
🏆 Weekend CS2 Cup

📝 Standard competitive rules. Overtime enabled. Knife for sides.

🎮 Game: Counter-Strike 2
📅 Saturday, February 15, 2026 at 7:00 PM UTC
👥 Teams: 0 / 16
👤 Team Size: 5 players
🔄 Format: Double Elimination (Best of 3)

⚙️ Created with Simple Mode — use /tournament edit to customize

[🎯 Register Team] [❌ Withdraw Team]
```

---

### Advanced Mode Flow

**Command:** `/tournament create-advanced`

Full slash command with all options:

**Options:**
| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `title` | String | Yes | Tournament name |
| `game` | String | Yes | Game selection (autocomplete with presets) |
| `datetime` | String | Yes | Start date/time |
| `max_participants` | Integer | Yes | Max slots |
| `format` | String | No | `single_elimination` / `double_elimination` |
| `team_size` | Integer | No | Players per team |
| `best_of` | Integer | No | Matches are best of X |
| `description` | String | No | Custom description (overrides preset) |
| `checkin_required` | Boolean | No | Enable check-in |
| `checkin_window` | Integer | No | Check-in window in minutes |
| `allow_seeding` | Boolean | No | Enable admin seeding |
| `map_pool` | String | No | Comma-separated map list (overrides preset) |
| `map_pick_process` | String | No | veto / random / admin_pick |
| `ruleset` | String | No | Custom rules text |

**After submission**, if the game has custom fields, bot follows up:

```
⚙️ Game-Specific Settings for CS2

Configure additional settings or accept defaults:

Overtime Enabled: [Yes ✓] [No]
Knife for Sides: [Yes ✓] [No]
Tech Pauses per Team: [4]

[Use Defaults] [Save Settings]
```

---

### Editing Tournaments

**Command:** `/tournament edit`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `tournament` | String | Yes | Tournament ID (autocomplete) |
| `setting` | String | Yes | Setting to change (autocomplete) |
| `value` | String | Yes | New value |

Available settings:
- All creation options
- Game-specific custom fields
- Can switch between simple/advanced mode retroactively

---

## Tournament Object (Updated)

```javascript
{
  id: "uuid",
  guildId: "discord_guild_id",
  channelId: "discord_channel_id",
  messageId: "tournament_embed_message_id",
  participantListMessageId: "participant_list_message_id",
  
  // Basic Info
  title: "Weekend CS2 Cup",
  description: "Standard competitive rules. Overtime enabled.", // From preset or custom
  
  // Game Configuration
  game: {
    preset: "cs2", // Reference to preset, or "custom"
    displayName: "Counter-Strike 2",
    shortName: "CS2",
    icon: "🎯"
  },
  
  // Tournament Settings
  settings: {
    maxParticipants: 16,
    teamSize: 5,
    format: "double_elimination",
    bestOf: 3,
    
    // Check-in
    checkinRequired: false,
    checkinWindow: 30,
    
    // Seeding  
    seedingEnabled: false,
    
    // Map Settings (if applicable)
    mapPool: ["Ancient", "Anubis", "Dust2", "Inferno", "Mirage", "Nuke", "Vertigo"],
    mapPickProcess: "veto",
    
    // Ruleset
    ruleset: "Standard competitive rules. Overtime enabled. Knife for sides.",
    
    // Game-specific custom fields
    gameSettings: {
      overtime: true,
      knifeRound: true,
      techPauseLimit: 4
    }
  },
  
  // Setup Mode (for reference)
  setupMode: "simple" | "advanced",
  
  // Timing
  startTime: Date,
  
  // Status
  status: "registration" | "checkin" | "active" | "completed" | "cancelled",
  checkinOpen: false,
  
  // Participants/Teams
  participants: [], // For solo (teamSize = 1)
  teams: [],        // For team tournaments
  
  // Bracket
  bracket: null,
  
  // Metadata
  createdBy: "admin_user_id",
  createdAt: Date
}
```

---

## Features

### 1. Tournament Creation

See **Admin Setup Modes** section above for Simple vs Advanced flows.

---

### 2. User/Team Registration

#### Solo Signup (team_size = 1)

**Interaction:** Button click on "Sign Up"

**Flow:**
1. User clicks "Sign Up" button
2. Bot validates: tournament open, not full, not already signed up
3. Add user to participant list
4. Update embed and participant list
5. Ephemeral confirmation: "✅ You're signed up for **{tournament_name}**!"

#### Team Registration (team_size > 1)

**Interaction:** Button click on "Register Team"

**Flow:**
1. User (team captain) clicks "Register Team"
2. Bot opens a modal:
   ```
   ┌─────────────────────────────────────┐
   │ Register Your Team                  │
   ├─────────────────────────────────────┤
   │ Team Name: [________________]       │
   │                                     │
   │ Team Members (Discord usernames,    │
   │ one per line, excluding yourself):  │
   │ [________________________________] │
   │ [________________________________] │
   │ [________________________________] │
   │ [________________________________] │
   │                                     │
   │         [Cancel]  [Register]        │
   └─────────────────────────────────────┘
   ```
3. Bot validates:
   - Correct number of members (team_size - 1, since captain is auto-included)
   - All mentioned users are in the server
   - No user is already on another team
   - Team name is unique
4. Bot creates team entry with captain + members
5. Update embed and team list
6. DM all team members: "You've been added to team **{team_name}** for **{tournament_name}**"

**Team Captain Permissions:**
- Can withdraw the entire team
- Receives admin communications
- Is the point of contact for scheduling

**Participant Display (Solo):**
```
📋 Signed Up (7/16):
1. PlayerOne
2. FragMaster
3. NoScope360
4. ClutchKing
5. AimAssist
6. SilentStrike
7. VictoryLap
```

**Participant Display (Teams):**
```
📋 Registered Teams (4/8):

1. Team Alpha (Captain: PlayerOne)
   └ PlayerOne, FragMaster, NoScope360, ClutchKing, AimAssist

2. Shadow Squad (Captain: SilentStrike)
   └ SilentStrike, VictoryLap, NightOwl, DarkKnight, PhantomX

3. Victory Royale (Captain: ChampionK)
   └ ChampionK, ProPlayer, EliteGamer, TopFragger, Clutchmaster

4. Underdogs (Captain: NewbieOne)
   └ NewbieOne, RookieTwo, FreshThree, GreenFour, NoviceFive
```

---

### 3. Withdrawal

#### Solo Withdrawal

User clicks "Withdraw", removed from list.

#### Team Withdrawal

**Only the team captain can withdraw the team.**

**Flow:**
1. Captain clicks "Withdraw Team"
2. Bot confirms: "Are you sure you want to withdraw **{team_name}**?"
3. On confirm:
   - Remove team from participant list
   - DM all team members notification
   - Update embed

**Team Management Commands:**

| Command | Description |
|---------|-------------|
| `/team remove @member` | Captain removes a member |
| `/team add @member` | Captain adds a member |
| `/team transfer @member` | Transfer captain role |

---

### 4. Seeding (Admin Only)

When `seedingEnabled` is true:

| Command | Description |
|---------|-------------|
| `/tournament seed` | Assign seed to participant/team |
| `/tournament seedlist` | View current seeding |
| `/tournament randomize-seeds` | Randomize unseeded participants |

**Seeding Display:**
```
🌱 Seeding for Weekend CS2 Cup:

1. Team Alpha ⭐
2. Shadow Squad ⭐
3. Victory Royale ⭐
4. Underdogs ⭐
5-8. (Unseeded - will be randomized)

⭐ = Manually seeded
```

**Seeding Rules:**
- Seed 1 is the highest/best
- Seeded participants placed to avoid early matchups
- BYEs assigned to higher seeds first
- Unseeded fill remaining slots randomly

---

### 5. Reminders

**Automatic DMs:**

| Timing | Message |
|--------|---------|
| 24h before | "⏰ Reminder: **{tournament}** starts in 24 hours!" |
| 1h before | "⏰ Reminder: **{tournament}** starts in 1 hour!" |

For teams: DM sent to all members.

---

### 6. Check-in

When `checkinRequired` is true:

- Opens `checkinWindow` minutes before start
- Players/teams must confirm attendance
- No-shows removed when tournament starts

**Check-in Display (Teams):**
```
✅ Team Check-in (3/4 teams):

Team Alpha ✓ (5/5 checked in)
Shadow Squad ✓ (5/5 checked in)  
Victory Royale ✓ (5/5 checked in)
Underdogs ⏳ (3/5 checked in)
  └ Missing: GreenFour, NoviceFive
```

---

### 7. Bracket Generation

**Command:** `/tournament start`

1. Finalize participant list
2. Generate bracket based on format
3. Apply seeding
4. Assign BYEs
5. Post bracket embed
6. Create Round 1 match rooms

---

### 8. Single Elimination Bracket

Standard knockout — lose once, eliminated.

**Structure (16 participants):**
```
Ro16 (8 matches) → QF (4) → SF (2) → Finals (1)
```

---

### 9. Double Elimination Bracket

Two brackets — must lose twice to be eliminated.

**Structure:**
```
WINNERS BRACKET          LOSERS BRACKET
WB Round 1 ────┐
               ├─ WB R2    LB Round 1 (WB R1 losers)
               │                │
               ├─ WB Semi  LB Round 2
               │                │
          WB Finals        LB Semi
               │                │
               └─── GRAND FINALS ◄──┘
                        │
                  (Reset if LB wins)
```

**Grand Finals:**
- WB Champion vs LB Champion
- If LB Champion wins → Bracket Reset (second match)

---

### 10. Match Rooms

**Auto-created text channels for each match.**

**Naming:** `match-{round}-{number}-{team1}-vs-{team2}`

**Content includes:**
- Participants/teams and members
- Match rules (from tournament settings)
- Map information (if applicable)
- Report buttons for admin

**Permissions:**
- Match participants can view/send
- Others cannot see
- Admins always have access

**Match Room (with game-specific info):**
```
⚔️ Winners Bracket Round 1 — Match 1

Team Alpha vs Team Echo

👥 Team Alpha:
   PlayerOne (C), FragMaster, NoScope360, ClutchKing, AimAssist

👥 Team Echo:
   EchoLead (C), EchoTwo, EchoThree, EchoFour, EchoFive

📋 Match Info:
- Best of 3
- Map Pick: Veto Process
- Available Maps: Ancient, Anubis, Dust2, Inferno, Mirage, Nuke, Vertigo

📜 Rules:
- Overtime enabled
- Knife for sides
- 4 tech pauses per team

Good luck! 🎮

[👑 Team Alpha Wins] [👑 Team Echo Wins]
```

---

### 11. Match Reporting

**Command:** `/match report`

| Option | Type | Required |
|--------|------|----------|
| `match_id` | String | Yes |
| `winner` | String | Yes |
| `score` | String | No |

**Flow:**
1. Admin reports winner
2. Bot updates bracket
3. Winner advances / loser drops or eliminated
4. Next round rooms created when ready

---

### 12. Tournament Completion

```
🏆 TOURNAMENT COMPLETE 🏆

Weekend CS2 Cup

🥇 Champion: Team Alpha
🥈 Runner-up: Victory Royale
🥉 3rd Place: Shadow Squad

🎮 Game: Counter-Strike 2
🔄 Format: Double Elimination
📊 Total Matches: 14

Congratulations!
```

---

## Admin Commands Summary

### Tournament Management
| Command | Description |
|---------|-------------|
| `/tournament create` | Simple mode creation |
| `/tournament create-advanced` | Advanced mode creation |
| `/tournament edit` | Edit tournament settings |
| `/tournament start` | Start bracket |
| `/tournament cancel` | Cancel tournament |
| `/tournament info` | Show details |
| `/tournament list` | List all tournaments |

### Seeding
| Command | Description |
|---------|-------------|
| `/tournament seed` | Set participant seed |
| `/tournament seedlist` | View seeding |
| `/tournament randomize-seeds` | Randomize unseeded |

### Match Management
| Command | Description |
|---------|-------------|
| `/match report` | Report winner |
| `/match list` | List active matches |

### Team Management (Captain)
| Command | Description |
|---------|-------------|
| `/team add` | Add member |
| `/team remove` | Remove member |
| `/team transfer` | Transfer captain |

### Server Settings (Admin)
| Command | Description |
|---------|-------------|
| `/admin game-preset list` | List available presets |
| `/admin game-preset create` | Create server preset |
| `/admin game-preset edit` | Edit server preset |
| `/admin default-settings` | Set server defaults |

---

## File Structure

```
discord-tournament-bot/
├── src/
│   ├── index.js
│   ├── config/
│   │   ├── index.js              # Main config
│   │   ├── gamePresets.js        # Built-in game presets
│   │   └── defaultSettings.js    # Default tournament settings
│   │
│   ├── commands/
│   │   ├── tournament/
│   │   │   ├── create.js         # Simple mode
│   │   │   ├── createAdvanced.js # Advanced mode
│   │   │   ├── edit.js
│   │   │   ├── start.js
│   │   │   ├── cancel.js
│   │   │   ├── info.js
│   │   │   ├── list.js
│   │   │   ├── seed.js
│   │   │   ├── seedlist.js
│   │   │   └── randomizeSeeds.js
│   │   ├── match/
│   │   │   ├── report.js
│   │   │   └── list.js
│   │   ├── team/
│   │   │   ├── add.js
│   │   │   ├── remove.js
│   │   │   └── transfer.js
│   │   └── admin/
│   │       ├── gamePresetList.js
│   │       ├── gamePresetCreate.js
│   │       ├── gamePresetEdit.js
│   │       └── defaultSettings.js
│   │
│   ├── events/
│   │   ├── ready.js
│   │   ├── interactionCreate.js
│   │   └── guildCreate.js
│   │
│   ├── components/
│   │   ├── gameSelect.js         # Game selection buttons
│   │   ├── simpleCreateModal.js  # Simple mode modal
│   │   ├── gameSettingsButtons.js # Game-specific settings
│   │   ├── signup.js
│   │   ├── withdraw.js
│   │   ├── teamRegister.js
│   │   ├── teamWithdraw.js
│   │   ├── checkin.js
│   │   └── matchReport.js
│   │
│   ├── services/
│   │   ├── tournamentService.js
│   │   ├── gamePresetService.js  # Handles preset logic
│   │   ├── bracketService.js
│   │   ├── singleEliminationService.js
│   │   ├── doubleEliminationService.js
│   │   ├── seedingService.js
│   │   ├── teamService.js
│   │   ├── matchService.js
│   │   ├── reminderService.js
│   │   └── channelService.js
│   │
│   ├── utils/
│   │   ├── embedBuilder.js
│   │   ├── permissions.js
│   │   ├── timeUtils.js
│   │   ├── bracketUtils.js
│   │   └── seedingUtils.js
│   │
│   └── data/
│       ├── store.js              # In-memory storage
│       └── serverPresets.js      # Server-specific presets
│
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Server-Specific Settings

Servers can customize:

**Default Settings:**
```javascript
{
  guildId: "discord_guild_id",
  defaults: {
    defaultFormat: "double_elimination",
    defaultCheckin: true,
    defaultCheckinWindow: 30,
    defaultSeeding: false,
    announcementChannel: "channel_id", // Where to post tournaments
    matchRoomCategory: "category_id"   // Category for match rooms
  },
  customPresets: [
    // Server-created game presets
  ]
}
```

**Command:** `/admin default-settings`

| Option | Type | Description |
|--------|------|-------------|
| `setting` | String | Setting to change |
| `value` | String | New value |

---

## Environment Variables

```env
# Discord
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id

# Config
NODE_ENV=development

# Future
# DATABASE_URL=postgresql://...
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Tournament full | "Registration is full" |
| Already registered | "You're already signed up!" |
| Invalid team size | "Teams must have exactly {n} members" |
| Member on another team | "{user} is already on another team" |
| Not captain | "Only the team captain can do this" |
| Tournament started | "Registration is closed" |
| Invalid seed | "Seed must be between 1 and {max}" |
| Seed taken | "Seed {n} is already assigned" |
| Invalid game preset | "Unknown game. Use 'Other Game' for custom." |
| Match report error | "That participant is not in this match" |

---

## Quick Start for Claude Code

```
Create a Discord tournament bot based on this specification.

Build in this order:

Phase 1 - Foundation:
1. Project setup (package.json, folder structure, config)
2. Game presets system (gamePresets.js with 6 presets)
3. Basic bot connection and command registration

Phase 2 - Tournament Creation:
4. Simple mode: /tournament create with game select + modal
5. Advanced mode: /tournament create-advanced
6. Tournament embed display

Phase 3 - Registration:
7. Solo signup flow (buttons)
8. Team registration (modal)
9. Withdrawal handling

Phase 4 - Tournament Flow:
10. Seeding commands
11. Check-in system
12. Reminders (node-cron)

Phase 5 - Brackets:
13. Single elimination generation
14. Match room creation
15. Match reporting
16. Double elimination logic

Use discord.js v14. Store data in-memory for now.
```

---

## Notes

- Game presets make simple mode fast while advanced mode stays flexible
- Custom fields in presets can be extended per-game without code changes
- Server presets allow communities to define their own game configs
- All times in UTC internally, display in user timezone
- Match rooms created in configured category or server default

---

*End of Specification v2.1*
