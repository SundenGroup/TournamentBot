# Parked Features

Features parked here are disabled but preserved — the implementation is intact
and everything needed to restore them is documented below.

> **Battle Royale is no longer parked.** It shipped as BR v2 in July 2026:
> config-driven scoring (ALGS / SUPER / Warzone / kill race / placement),
> single- and multi-lobby stages with advancement, tap-to-report buttons,
> public standings page and dashboard grid. The old `FEATURE_BATTLE_ROYALE`
> flag was removed. See the Battle Royale section of the
> [admin manual](../public/admin-manual.html).

Flags in [`src/config/index.js`](../src/config/index.js):

```js
const features = {
  tokens: process.env.FEATURE_TOKENS === 'true',        // parked add-on system, default OFF
  enforceTiers: process.env.ENFORCE_TIERS === 'true',   // pricing-v2 LIMIT enforcement, default OFF
};
```

`enforceTiers` is not a parked feature — it is the deliberate post-GOALS (July 20,
2026) switch that turns on the Free-plan limits (5 tournaments/month, 64 entrants,
2 concurrent). Feature gates (seeding, captain mode, multi-lobby BR, …) are always
active per docs/PRODUCT-STRATEGY.md §6a.

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

## 2. Battle Royale format — UNPARKED (shipped as v2)

Restored and rebuilt in July 2026. The v1 engine's known issues (unvalidated
placement input, lobby-size-relative scoring across uneven groups, biased
shuffle, `assignTeamsToGroups` stub) were all fixed in the rewrite; standings
are now derived from raw per-game inputs, so corrections are safe by
construction. The four BR game presets (PUBG, PUBG Mobile, Apex Legends,
Warzone) live in `src/config/games.json` with `brDefaults`, and custom games
can pick the `battle_royale` format.

---

## 3. Removed games (preserved JSON)

The default game set is 19 + Custom (the 4 Battle Royale games shipped with BR v2).
**Call of Duty, StarCraft, and Rainbow Six Siege** were simply not part of the
initial set. To restore any, paste its entry
back into `src/config/games.json` (add a `"category"` and `"featured": true` to match
the new schema).

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

### Current default game set (19 + Custom)

| Category | Games |
|---|---|
| FPS | Counter-Strike 2, VALORANT |
| Hero Shooter | Deadlock, Marvel Rivals, Overwatch |
| MOBA | League of Legends, Dota 2, Mobile Legends |
| Fighting | Street Fighter 6, Tekken 8, 2XKO |
| Sports | Rocket League, GOALS, EA Sports FC |
| Battle Royale | PUBG: Battlegrounds, PUBG Mobile, Apex Legends, Call of Duty: Warzone |
| Casual | GeoGuessr |
| Custom | (user-defined) |
