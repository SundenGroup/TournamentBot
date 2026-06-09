# Parked Features

These features are **temporarily disabled for the initial testing phase** so they
don't interfere with core tournament testing. Nothing has been deleted — the
implementation is intact and feature-flagged, and everything needed to restore it
is documented here.

Both features are gated by flags in [`src/config/index.js`](../src/config/index.js):

```js
const features = {
  tokens: process.env.FEATURE_TOKENS === 'true',         // default: OFF
  battleRoyale: process.env.FEATURE_BATTLE_ROYALE === 'true', // default: OFF
};
```

To re-enable a feature, set the corresponding env var to `true` **and** follow the
"How to fully restore" steps for that feature below (some UI/commands were
unregistered and need to be re-added so Discord re-publishes them).

---

## 1. Token System (tournament tokens + participant boosts)

### What it was
A consumable monetization layer that let servers exceed their subscription tier
limits:

- **Tournament tokens** — consumed automatically when a server exceeds its monthly
  tournament limit (`TIER_LIMITS[tier].tournamentsPerMonth`). Sold in packs of
  30 / 50 / 100, valid 12 months.
- **Participant boosts** — one-time `+128` / `+256` add-ons that raise the max
  participant cap for a single tournament beyond the tier base (up to the 512
  platform cap).

### User-facing surface (now removed)
- `/tokens balance | buy-tournaments | buy-boost` slash command
  → file moved to [`parked/commands/tokens.js`](../parked/commands/tokens.js)
- `/owner grant-tokens` and `/owner grant-boost` subcommands (in `src/commands/owner/grant.js`)
- The "🎟️ Tokens & Boosts" section of `/subscribe status`
- Token/boost balances in `/owner status`
- The `/tokens` entry in the `/admin help`-style command list
- Stripe products: `TOKEN_PRICES` (`tokens_30/50/100`) and `BOOST_PRICES`
  (`boost_128/256`) in `src/services/stripeService.js`

### What still exists (dormant, preserved)
- `src/data/subscriptions.js` — all token/boost storage + mutators
  (`addTournamentTokens`, `consumeTournamentToken`, `addParticipantBoost`,
  `consumeParticipantBoost`, `getTokenBalance`, …)
- `src/services/subscriptionService.js` — `grantTokens()`, `getTokenPurchaseEmbed()`,
  `getBoostPurchaseEmbed()` (exported, unused while parked)
- `src/services/stripeService.js` — `createTokenCheckout()`, `createBoostCheckout()`
  and the `checkout.session.completed` crediting paths (unreachable while parked)
- The `subscriptions` table columns for tokens/boosts are untouched.

### How it's neutralized
All gating routes through `src/services/subscriptionService.js`, so the creation
flows did not need changes. When `features.tokens` is false:

| Function | Behaviour while parked |
|---|---|
| `checkTournamentLimit()` | always returns `allowed: true` (monthly cap not enforced — tokens were the only way past it, so testing is never blocked) |
| `checkParticipantLimit()` | allows up to the 512 platform cap regardless of tier (no boost prompt) |
| `recordTournamentCreation()` | still increments usage/concurrency, but never consumes tokens/boosts |
| `getStatusEmbed()` | omits the Tokens & Boosts section |

> **Testing note:** tier *feature* gates (Premium/Pro/Business) and the concurrent
> limit still apply. Use `/owner grant <guild_id> business <days>` to give a test
> server Business tier (unlimited concurrency, 512 participants, all features).

### How to fully restore
1. Set `FEATURE_TOKENS=true`.
2. `git mv parked/commands/tokens.js src/commands/subscription/tokens.js`.
3. In `src/commands/owner/grant.js`: re-add the `grant-tokens` and `grant-boost`
   subcommand definitions + handlers (see git history of this change), and re-add
   the `grantTokens` / `addParticipantBoost` imports.
4. Restore the `/tokens` entry in the command list in `src/commands/admin/settings.js`.
5. Restore the token/boost lines in `/owner status`.
6. `npm run deploy-commands` to re-publish the slash commands.

---

## 2. Battle Royale format

### What it was
A multi-team, multi-game lobby format (placement-points scoring) for BR titles,
with group stage → finals progression.

### User-facing surface (now removed)
- `battle_royale` removed from the wizard format list (`ALL_FORMATS` in
  `src/components/wizardSettings.js`)
- `/tournament br-report` subcommand (definition removed from `src/commands/tournament/create.js`)
- `/match games` subcommand (definition removed from `src/commands/match/match.js`)
- BR options in the advanced wizard (lobby size / games per stage / advancing per
  group) — these only render when format is `battle_royale`, which is now
  unreachable
- Battle Royale removed from `/help` formats list
- The 4 Battle-Royale games removed from the picker (see §3)

### What still exists (dormant, preserved)
- `src/services/battleRoyaleService.js` — the full BR engine (unchanged)
- BR handling branches throughout `create.js`, `startTournament.js`, `viewBracket.js`,
  `viewResults.js`, `matchReport.js`, `match.js` (`handleGames`), `channelService.js`,
  `templateService.js`, `analyticsService.js` — all intact but unreachable because no
  game offers the format and the format isn't selectable
- BR settings persistence (`lobbySize`, `gamesPerStage`, `advancingPerGroup`) in
  `tournamentService.js`, `templates.js`, `templateService.js`

> Battle Royale also had its own correctness issues noted in review (placement
> input not validated, uneven-group scoring, biased shuffle, `assignTeamsToGroups`
> stub throws). **Fix these before re-enabling** — they were intentionally left as-is
> since the feature is parked.

### How to fully restore
1. Set `FEATURE_BATTLE_ROYALE=true`.
2. Add `'battle_royale'` back to `ALL_FORMATS` in `src/components/wizardSettings.js`.
3. Re-add the `br-report` subcommand in `src/commands/tournament/create.js` and the
   `games` subcommand in `src/commands/match/match.js` (see git history).
4. Re-add the BR games to `src/config/games.json` (see §3) — restoring a game with
   `"battle_royale"` in its `formatOptions` and/or as `defaultFormat` is what makes
   the format reachable again.
5. Restore the Battle Royale lines in `/help`.
6. `npm run deploy-commands`.

---

## 3. Removed games (preserved JSON)

The default game set was trimmed to 15 + Custom for the first release. The 4 Battle
Royale games are parked with the BR feature; **Call of Duty, StarCraft, and Rainbow
Six Siege** were simply not part of the initial set. To restore any, paste its entry
back into `src/config/games.json` (add a `"category"` and `"featured": true` to match
the new schema).

### Battle Royale games (restore with the BR feature)

```json
"pubg": {
  "displayName": "PUBG: Battlegrounds", "shortName": "PUBG", "icon": "🪖", "logo": null,
  "defaultTeamSize": 4, "teamSizeOptions": [1, 2, 4],
  "defaultFormat": "battle_royale", "formatOptions": ["battle_royale"],
  "defaultBestOf": 1, "bestOfOptions": [1],
  "mapPool": ["Erangel", "Miramar", "Taego", "Deston", "Vikendi"], "mapPickProcess": "random",
  "ruleset": "WWCD format. Placement points scoring.",
  "customFields": { "gamesPerStage": { "type": "number", "default": 6, "label": "Games per Stage" }, "lobbySize": { "type": "number", "default": 16, "label": "Lobby Size (Teams)" } }
},
"pubg_mobile": {
  "displayName": "PUBG Mobile", "shortName": "PUBGM", "icon": "📱", "logo": null,
  "defaultTeamSize": 4, "teamSizeOptions": [1, 2, 4],
  "defaultFormat": "battle_royale", "formatOptions": ["battle_royale"],
  "defaultBestOf": 1, "bestOfOptions": [1],
  "mapPool": ["Erangel", "Miramar", "Sanhok", "Vikendi", "Livik"], "mapPickProcess": "random",
  "ruleset": "Placement + kill points scoring.",
  "customFields": { "gamesPerStage": { "type": "number", "default": 6, "label": "Games per Stage" }, "lobbySize": { "type": "number", "default": 16, "label": "Lobby Size (Teams)" } }
},
"apex_legends": {
  "displayName": "Apex Legends", "shortName": "APEX", "icon": "🔺", "logo": null,
  "defaultTeamSize": 3, "teamSizeOptions": [1, 2, 3],
  "defaultFormat": "battle_royale", "formatOptions": ["battle_royale"],
  "defaultBestOf": 1, "bestOfOptions": [1],
  "mapPool": ["World's Edge", "Storm Point", "Broken Moon", "Kings Canyon", "Olympus"], "mapPickProcess": "random",
  "ruleset": "ALGS format. Placement + kill points.",
  "customFields": { "gamesPerStage": { "type": "number", "default": 6, "label": "Games per Stage" }, "lobbySize": { "type": "number", "default": 20, "label": "Lobby Size (Teams)" } }
},
"fortnite": {
  "displayName": "Fortnite", "shortName": "FN", "icon": "🏝️", "logo": null,
  "defaultTeamSize": 4, "teamSizeOptions": [1, 2, 3, 4],
  "defaultFormat": "battle_royale", "formatOptions": ["battle_royale", "single_elimination", "double_elimination"],
  "defaultBestOf": 1, "bestOfOptions": [1, 3],
  "mapPool": null, "mapPickProcess": null,
  "ruleset": "Battle Royale format. Placement points scoring.",
  "customFields": { "gamesPerStage": { "type": "number", "default": 3, "label": "Games per Stage" }, "lobbySize": { "type": "number", "default": 25, "label": "Lobby Size" } }
}
```

### Other games not in the initial set (bracket formats, safe to restore any time)

```json
"call_of_duty": {
  "displayName": "Call of Duty", "shortName": "CoD", "icon": "💥", "logo": null,
  "defaultTeamSize": 4, "teamSizeOptions": [1, 2, 4],
  "defaultFormat": "double_elimination", "formatOptions": ["single_elimination", "double_elimination", "swiss", "round_robin"],
  "defaultBestOf": 5, "bestOfOptions": [3, 5, 7],
  "mapPool": null, "mapPickProcess": "veto",
  "ruleset": "CDL ruleset. Hardpoint, Search & Destroy, Control rotation.",
  "customFields": { "gameModes": { "type": "string", "default": "HP, SND, CTL", "label": "Game Modes" } }
},
"starcraft": {
  "displayName": "StarCraft", "shortName": "SC", "icon": "🌌", "logo": null,
  "defaultTeamSize": 1, "teamSizeOptions": [1],
  "defaultFormat": "double_elimination", "formatOptions": ["single_elimination", "double_elimination", "swiss", "round_robin"],
  "defaultBestOf": 3, "bestOfOptions": [1, 3, 5, 7],
  "mapPool": null, "mapPickProcess": "veto",
  "ruleset": "Standard competitive rules. Loser picks next map.",
  "customFields": {}
},
"rainbow_six_siege": {
  "displayName": "Rainbow Six Siege", "shortName": "R6", "icon": "🔒", "logo": null,
  "defaultTeamSize": 5, "teamSizeOptions": [5],
  "defaultFormat": "single_elimination", "formatOptions": ["single_elimination", "double_elimination", "swiss", "round_robin"],
  "defaultBestOf": 3, "bestOfOptions": [1, 3, 5],
  "mapPool": null, "mapPickProcess": "veto",
  "ruleset": "Standard competitive settings. 6th pick enabled.",
  "customFields": { "sixthPick": { "type": "boolean", "default": true, "label": "6th Pick Enabled" } }
}
```

### Current default game set (15 + Custom)

| Category | Games |
|---|---|
| FPS | Counter-Strike 2, VALORANT |
| Hero Shooter | Deadlock, Marvel Rivals, Overwatch |
| MOBA | League of Legends, Dota 2, Mobile Legends |
| Fighting | Street Fighter 6, Tekken 8, 2XKO |
| Sports | Rocket League, GOALS, EA Sports FC |
| Casual | GeoGuessr |
| Custom | (user-defined) |
