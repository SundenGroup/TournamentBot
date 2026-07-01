# Web Admin Dashboard — Feasibility & Plan

Mirroring the Discord admin toolset on a logged-in web dashboard at
`tournaments.clutch.game`. **Verdict: highly feasible** — the architecture is
unusually well-suited, with no blockers.

## Status

- **Phase 0 (auth) + Phase 1 (read-only dashboard) — BUILT.** Discord OAuth
  login, signed-cookie sessions, per-guild authorization (mirrors
  `canManageTournaments`), and a Clutch-branded dashboard that lists your
  manageable servers → their tournaments → the live bracket (reusing
  `bracket.html` in an iframe via a session-gated data feed). Ships dormant:
  `webAdmin.enabled` is false until `DISCORD_CLIENT_SECRET` is set on the host,
  and the OAuth redirect `…/admin/callback` must be registered in the dev portal.
  Files: `src/api/{session,botClient,adminAuth,adminDashboard}.js`,
  `public/admin-dashboard.html`.
- **Phases 2–4 — not started** (safe mutations → live-ops → polish; see below).

## Why it's a good fit (what already exists)

1. **The web server runs in the same process as the bot.** `src/index.js` logs
   the Discord client in, then starts the Express server — one process. That
   means web endpoints can reach the live discord.js `client` directly, so any
   action needing Discord (creating match rooms, posting announcements, DMing
   players) works from the web exactly as it does from a slash command. This is
   the single biggest enabler and it's already true.
2. **The admin logic is already decoupled from Discord.** The heavy lifting lives
   in plain service functions — `tournamentService` (createTournament,
   addParticipant, adminRemoveEntrant, updateTournament…), the four bracket
   engines (pure), `disqualifyService`, `channelService`. A web handler calls the
   same functions a slash command does.
3. **We already serve this domain with an Express app** and already have one auth
   pattern (the Business API-key middleware) and a read-only public data feed
   (`/api/public/brackets/:id`) plus a bracket renderer (`bracket.html`) to reuse.

## The three new pieces

1. **Login — Discord OAuth2.** "Log in with Discord" (authorization-code flow,
   scopes `identify` + `guilds`). A signed session cookie holds the user id.
   *Prereq:* add `DISCORD_CLIENT_SECRET` (from the dev portal) and a
   `SESSION_SECRET` to the droplet env, plus register the OAuth redirect URL.
2. **Authorization — reuse the existing admin check.** For a chosen guild, fetch
   the member via the bot (`GET /guilds/{id}/members/{userId}` — the bot is in
   the guild) and apply the **same** `canManageTournaments` logic used in Discord
   (Administrator / Manage Server / a tournament-admin role). Re-check on every
   state-changing request, not just at login.
3. **Endpoints + UI.** Thin POST endpoints that wrap the existing services, and a
   dashboard UI in the Clutch brand (reusing the tokens/renderer already built).

## What can be mirrored (essentially the whole toolset)

| Web action | Backed by |
|---|---|
| List my servers (where I'm admin **and** the bot is present) | client guild cache + authz check |
| List / view tournaments, bracket, standings, participants | existing services + `bracket.html` |
| Create tournament (simple + advanced) | `createTournament` |
| Edit, add/remove player & team | `updateTournament`, `adminRemove…`, `addParticipant/Team` |
| Start, report (with score), correct, disqualify, create-rooms, cancel | bracket engines + `channelService` via the shared client |
| Seeding, per-game announce channels, server settings | existing services |

## Security must-dos (before launch — this is an outward, state-changing surface)

- Re-authorize per action (don't trust a cached "is admin" flag).
- CSRF protection on all POSTs; `SameSite`/`Secure` cookies.
- Rate limiting (reuse/extend the existing limiter, ideally shared-store).
- Audit log of web-initiated actions (who/what/when).
- Confirm the tournament being acted on belongs to a guild the user administers.

## Suggested phasing (each phase deployable + de-risked)

- **Phase 0 — Auth spike (small):** Discord OAuth login + session + a "your
  manageable servers" screen. Proves the whole auth/authz path. Read-only, low risk.
- **Phase 1 — Read-only dashboard:** tournament list + bracket/standings/roster
  views for guilds you administer. No mutations.
- **Phase 2 — Safe mutations:** create/edit tournaments, add/remove entrants
  (registration phase only).
- **Phase 3 — Live-ops:** start, report + score, correct, disqualify, create-rooms
  (the calls that reach into the Discord client).
- **Phase 4 — Polish:** audit log, live updates (reuse the 15s poll or SSE), mobile.

## Positioning

This is a natural **Pro/Business** headline feature (a white-glove management
surface). Recommend gating it accordingly, like the live web bracket.

## Recommendation

Start with **Phase 0 + 1** (Discord login + read-only dashboard). It de-risks the
only genuinely new part (auth), delivers immediate value (manage-from-browser
visibility), and touches no mutation paths — so it can ship safely and fast.
Once that's proven, Phases 2–3 are mostly thin wrappers over services that already
exist and are already tested.
