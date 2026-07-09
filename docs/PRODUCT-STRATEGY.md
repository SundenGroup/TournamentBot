# CLUTCH Tournaments — Product Strategy Review (July 2026)

Research-backed answers to four questions: (1) where the bot can improve,
(2) what adjacent bots we could launch, (3) whether to revisit Battle Royale,
(4) whether the pricing holds up. Based on a full codebase/product inventory
plus five web-research tracks (competitors & pricing, ranked-queue market,
scrim/league market, pickems/wager market, trackers/engagement/org-bots and
2025-26 Discord platform trends) — all fetched 2026-07-09, sources inline.

---

## 0. Where we stand (the honest snapshot)

**Product:** end-to-end in-Discord tournaments (4 formats + parked BR), match
rooms, buttons-first reporting, corrections/DQ/seeding/check-in/captain mode,
live web brackets (Bracket v2), a full web admin dashboard (Run view), REST
API + webhooks + white-label, 16 game presets, templates, analytics. ~18.6k
LOC, single process, Postgres, Stripe.

**Market position:** feature depth already **exceeds every Discord-native
rival**. The closest competitor (Tourney Bot, ~28K servers) has no API, no
analytics, an 8-participant free cap, and just burned its paid users by
discontinuing purchased tokens. NeatQueue (~25K servers) is queue/MMR-first
with only beta tournaments. Nobody else ships a public API or a real web
dashboard at the bot layer.

**Distribution position:** effectively zero. Official bot for GOALS + small
tournaments; never marketed. Everything below is filtered through that: the
constraint is not product breadth, it's **install base, trust signals, and
retention loops**.

---

## 1. Where the bot can improve

### 1a. The one strategic feature gap: nothing persists between tournaments

Every tournament is an island. The market evidence says persistent
competitive structure is both the biggest gap and the biggest opportunity:

- **NeatQueue's entire 25K-server business** is persistent ladders/MMR — and
  its own roadmap shows unsolved user demands (cross-server queues, "notify
  when next in line") ([roadmap.neatqueue.com](https://roadmap.neatqueue.com/feature-requests)).
- **League/season management is the clearest white space found anywhere in
  this research**: no Discord bot runs multi-week leagues (schedules,
  standings, playoffs) at any scale; the web platforms (Challonge, Toornament,
  start.gg, Battlefy) are all single-event tools with "leagues" bolted on.
- The only product attempting the queue+bracket bundle (GotNext/CompOPS) has
  83 servers — the bundle is unproven, not saturated.

**Recommended build order (each is a retention loop, not just a feature):**

1. **Server leaderboard & player profiles** — cross-tournament points, W/L,
   podiums, `/profile`. Cheap (all data already in `tournaments` rows), makes
   the 2nd tournament matter. Fixes the fact that `/analytics` currently
   advertises a `leaderboard` subcommand that doesn't exist.
2. **Seasons & leagues** — a "season" groups tournaments (or scheduled
   round-robin fixtures over weeks) into one standings table with an optional
   playoff bracket generated from standings. Reuses the RR engine + Bracket v2
   + dashboard verbatim.
3. **Recurring tournaments** — "every Friday 19:00 from this template."
   Templates + reminders already exist; this converts one-off organizers into
   weekly ones. (Apollo gates recurring events behind Premium — proven
   willingness to pay.)
4. **Ladder mode (later)** — open challenge ladder / KOTH with Elo. Attacks
   NeatQueue's turf only after 1–3 give us the audience.

### 1b. Feature/quality improvements (ranked)

| # | Improvement | Why (evidence) |
|---|---|---|
| 1 | **Team signup via UserSelect** instead of free-text usernames | #1 player failure point (docs/UX-REVIEW.md); free-text exact-username matching round-trips the whole modal |
| 2 | **Date input hardening** (echo bad input, accept `<t:unix>`, more formats) | #1 admin failure point (UX-REVIEW) |
| 3 | **Completion DMs + post-event MVP vote** | Engagement white space (MVP/awards/trophies has no incumbent at scale); closes the loop for players who miss the podium post |
| 4 | **Reminder persistence** | `setTimeout`-based reminders die on every deploy/restart — with daily deploys, real events WILL miss check-in pings. Move to DB-backed schedule scan |
| 5 | **Fix `/v1/tournaments/:id/standings`** | Reads a field the engines never populate — likely returns empty for most tournaments (Business-tier customers hit this) |
| 6 | **Gate the web dashboard as Pro** | Positioned Pro/Business in the plan, but not gated in code — our most differentiated feature is currently free |
| 7 | **Dashboard Phase 4** — SSE live updates, audit-log viewer, mobile pass, settings tab | Already specced (WEB-ADMIN-PLAN.md) |
| 8 | **Wizard "Create now" shortcut + error-copy polish + withdraw confirm** | Remaining UX-REVIEW items |
| 9 | **CI + broader tests** | `npm test` covers engines only; no CI, no lint. Reliability anxiety is a documented churn driver in this market (Elo Ranking bot collapse; GatherBot abandonment) — a public status page + tests are cheap trust signals |
| 10 | **Onboarding after invite** | First-run guided setup message (set channel → create → start). Nothing greets a new server today |

### 1c. "Simple but with all the features" — how to keep the ethos

The complexity firewall is already the right one: **simple mode never grows**
(game → 3 fields → done), presets absorb per-game complexity (GOALS
nickFields proved the pattern), and power lives in advanced mode + the web
dashboard. Rule of thumb going forward: new capability ships as (a) a preset
default, (b) an advanced-wizard toggle, or (c) a dashboard feature — never as
a new required step in simple mode.

---

## 2. Adjacent bots — what to launch (and what to avoid)

Verdicts from five market scans, mapped to our reusable assets (pure bracket
engines, OAuth+web layer, Stripe plumbing, per-guild settings, game presets):

### Do as **modules of CLUTCH**, not separate bots
1. **Leagues/seasons + leaderboards** (§1a) — the white space is real, but a
   separate bot would forfeit our distribution and re-split the audience. The
   organizer persona is identical.
2. **Competitive engagement pack** — MVP voting, server trophy case, awards,
   clip-contest voting. Fragmented hobbyist space, no scaled incumbent, and
   our bracket audience is the natural buyer ("who was MVP of the bracket").
   Ships as Premium value, not a standalone product.

### Credible **standalone sibling** (if we want a second bot)
3. **Cross-server scrim finder** ("CLUTCH Scrims") — teams list availability
   + rank; bot matches them across servers and spins up a shared match room.
   Evidence: genuinely unserved *inside* Discord (PRACC is web-first with a
   69.9K-member Discord; Team Up is the only bot claiming cross-server play at
   3.4K servers; Supatimer's matchmaking isn't live). Giant manual LFG servers
   (NA Open Scrims ~494K members) prove demand. Risk: network-effect cold
   start — mitigated by seeding from CLUTCH-installed servers. This is the
   one concept with real "new product" upside.
4. **Team/org manager** (rosters, tryouts, availability, scrim calendar) —
   underserved (biggest incumbent: 3.2K servers) and Guilded's shutdown
   (Dec 19, 2025) pushed org demand back to Discord — but the niche has
   resisted monetization (norm is free/hobbyist). Park unless it becomes a
   studio/B2B ask.

### The sleeper: **B2B white-label, not a bot**
5. **"Official tournament bot for your game"** — we already ARE this for
   GOALS (official bot, custom private ID fields, brand presets). Toornament
   validates the model commercially (white-labeled Rematch's official
   platform, Supercell/Brawl Stars integration; studio tiers up to
   €229–299/mo). Productize: preset + branding + private fields + dedicated
   channel structure + API, priced per studio (hundreds/mo). This is likely
   worth more than any second community bot, and GOALS is the case study.

### Avoid (evidence says no)
- **Stat/tracker bots** — saturated at the bottom, structurally fragile at the
  top: no/hostile APIs for Valorant/Apex/Warzone, and Discord's own **Game
  Stats Widget** (GDC 2026) threatens platform-level disintermediation.
- **Pickems/fantasy with prizes** — publishers own the high-value pickems
  (Valve/Riot in-client), Discord's Ads Policy explicitly bans promoting
  fantasy/picks, and cash prizes hit state-by-state law. Free pickems as an
  engagement feature inside CLUTCH: fine. A product: no.
- **Wager/duel money-match bots** — Discord policy + payment-processor
  hostility (Stripe bans skill-gaming prizes; PayPal pulled off CMG) + the two
  scaled incumbents have BBB F/B- trust wreckage. Hard no.
- **Event/RSVP scheduling** — Apollo/Sesh/Raid-Helper is a consolidated
  270–310K-server three-horse race.

---

## 3. Battle Royale — revisit, scoped, inside the main bot

### What the research says
- **Formats are stable and fully speccable.** Three canonical models:
  additive placement+kills (ALGS 12/9/7/5/4/3/2/1/0 +1/kill; PUBG SUPER
  10/6/5/4/3/2/1/1/0 +1/kill; FNCS placement-heavy +3–4/elim), multiplicative
  kills×placement (Warzone WSOW ×2.0→×1.0; WRS 2026 ×1.6→×1.0), pure kill
  race (best-N-of-M submitted games), plus the match-point finals overlay.
  A config-driven engine covers all of it.
- **Our parked engine is ~70% of Model 1** but: placement-only (no kill
  points), 4 documented bugs (uneven-group scoring, biased shuffle,
  `assignTeamsToGroups` stub, stale parked note), no web-bracket rendering,
  no buttons UX (free-text `placements:1,5,3,2…`), and the
  `FEATURE_BATTLE_ROYALE` flag is dead-wired (referenced nowhere).
- **Market:** Fortnite is **owned** by Yunite (171.9K servers, replay-file
  auto-scoring — don't compete). Apex is loyal to Overstat with gated APIs.
  Warzone has hostile APIs → manual/OCR is the norm. **PUBG is the only title
  with a free self-serve match API** (custom games flagged, 14-day window).
  Outside Fortnite, *no bot does placement+kills scoring well at any scale* —
  the biggest one trying is 3.8K servers.
- **Organizer pain is exactly our shape:** screenshot→spreadsheet scoring
  errors, manual multi-lobby seeding, no audit trail for corrections — i.e.,
  group stages + score entry + corrections + standings, which is what we do.

### Recommendation
**Yes, revisit — as a mode of the main bot, not a standalone bot.**

- **Not standalone.** Same buyer (community organizer), same infra (rooms,
  check-in, web, Stripe), and complexity is already firewalled by presets: BR
  options only appear when a BR game is picked. A separate bot doubles ops and
  splits reviews/install base precisely when distribution is our weakness.
  (If BR traction ever justifies its own brand, ship a marketing skin —
  "CLUTCH Royale" — over the same codebase.)
- **Does it add complexity?** Contained, yes; runaway, no — *if* we hold the
  line: BR never appears in simple mode's flow for non-BR games, and the
  dashboard Run view becomes the primary scoring surface (a tap-to-enter
  placement grid beats a slash command with comma-separated numbers by a
  mile — this is the killer UX nobody has).

### Sequenced plan
1. **Fix first** (parked-doc bugs + un-dead-wire or delete the flag).
2. **Engine v2**: config-driven scoring — placement table + pts/kill +
   optional multiplier + best-N-of-M + match-point overlay + the standard
   tiebreaker chains. Pure-function work; our strongest muscle; fully
   testable in `test-brackets.js`.
3. **Web**: BR standings/leaderboard view on the public bracket page (panel
   mode, like Swiss) + dashboard placements grid.
4. **Launch titles**: PUBG (with the self-serve API as our only auto-scoring
   integration), Warzone + Apex manual-first, restore parked presets. **Skip
   Fortnite** (Yunite). No OCR in v1 (assistive later at best — no tool has
   verified accuracy).

---

## 4. Pricing — findings and changes

### 4a. Two urgent facts before any pricing debate

1. **The caps are currently OFF.** While the token system is parked,
   `checkTournamentLimit` always allows and `checkParticipantLimit` allows up
   to 512 for everyone — the free tier is effectively unlimited
   tournaments/512 entrants today. Fine for the unmarketed phase, but it must
   become a *decision*, not an accident (and re-enabling limits must be
   decoupled from re-enabling tokens).
2. **Discord's Premium Apps parity mandate** (since Oct 7, 2024): any app
   selling paid features must also sell them via Discord's store at no higher
   price — Discord takes 15% (first $1M) / 30% vs Stripe's ~3%. **Annual
   plans are currently exempt** (Discord doesn't support them), and Discord
   purchases are desktop-only. Tourney Bot's token-store shutdown is the
   cautionary tale. → Strategy: annual-forward on our site (compliant,
   margin-preserving), monthly via Discord store for discovery. *Legal-check
   this before marketing push.*

### 4b. Market reference points (fetched 2026-07-09)

| Who | Price | Notes |
|---|---|---|
| Tourney Bot | $1.99 / $2.99 / $4.99 / $15.99/mo | Tiers = participant caps (32/64/128/512); free tier = **8 participants**; no API/analytics |
| Sesh (comparable premium bot) | $6.99/mo · Pro **$24.99/mo** | Pro = API + custom branding + commercial license — direct anchor for our Business features |
| Apollo | $7.99/mo ($5.83 annual) | Freemium recurring-events gate |
| InHouseQueue | ≈$3.6/$6.7/**$10.9**/mo | Top tier = white-label bot |
| Challonge Premier | $6.99–12/mo | 512 participants, ad removal |
| Toornament | €19/tournament · €19–299/mo | **Per-event pricing exists**; studio tiers validate B2B |
| start.gg | 6% fee on paid registrations | Platform-fee backlash in grassroots scene |
| Premium-bot sweet spot | **$5–13/server/mo** | White-label/API commands $10–25 |

### 4c. Recommended structure

Keep four tiers but reprice/reframe two of them:

| Tier | Today | Recommended | Change & rationale |
|---|---|---|---|
| **Free** | 3/mo, 50 entrants, 1 concurrent | **Unlimited tournaments, 64 entrants, 1 concurrent, "Powered by CLUTCH" on web bracket** | The free tier is our weapon (vs Tourney Bot's 8 entrants). Cap *size*, not *count* — count-caps punish exactly the habit (weekly cups) we want to form. Footer = viral loop |
| **Premium** | $5.99/mo · $49/yr | **Keep $5.99** — add 128 entrants, check-in/seeding/captain/auto-cleanup + **recurring tournaments + MVP/awards** when built | Right price (market $5–8). Needs one more "felt" feature; recurring is it |
| **Pro** | $24.99/mo · $199/yr | **$12.99/mo · $109/yr** — web dashboard (gated!), live web brackets, templates, analytics, leagues/seasons when built, 256 entrants | $24.99 without API is above market (Sesh's $24.99 *includes* API). $12.99 sits in the sweet spot; the dashboard finally gives Pro its hero feature |
| **Business** | $99/mo · $899/yr | **Keep $99, reframe as B2B/orgs/studios** — API, webhooks, white-label, multi-server, priority support; sell via site/contact | No bot charges this, but platforms do (Toornament Arena €229+). It's not a Discord-store SKU; it's the entry point to the studio offering (§2.5) |
| **Event Pass** *(new)* | — (tokens parked) | **~$9.99 one-off**: everything unlocked for a single tournament (512 entrants, all features) | Revives the parked boost/token idea in comprehensible form; matches Toornament's €19/event precedent; perfect for the "one big yearly cup" server that will never subscribe |

Also: keep the 7-day Premium trial; consider auto-granting it on first
tournament creation rather than requiring `/subscribe trial`.

### 4d. What NOT to do
- **Don't add entry-fee processing yet.** Stripe's TOS bans prize-tournament
  card payments (what pushed start.gg to PayPal-only), and Discord's gambling
  stack + 2026 state enforcement climate make money-in/money-out a compliance
  project, not a feature. Revisit only as prize-pool *display* + payout
  *tracking* (no money movement).
- **Don't mirror Tourney Bot's cap-only tiers** — our differentiation is
  features (dashboard, web brackets, API); caps are secondary.

---

## 5. If I had to pick five moves

1. **Gate the dashboard (Pro) + reprice Pro to $12.99 + decide the free-tier
   caps consciously** — pricing hygiene before any marketing.
2. **Ship the retention layer**: server leaderboard → recurring tournaments →
   seasons/leagues. This is the moat NeatQueue can't cheaply copy and the
   whitespace nobody owns.
3. **BR mode v2 inside the bot** (engine rework + dashboard placement grid;
   PUBG auto-scoring, Warzone/Apex manual; skip Fortnite).
4. **Productize the GOALS playbook** as "official tournament bot for your
   game" (white-label B2B, custom pricing) — our most defensible revenue line.
5. **Trust + distribution basics**: top.gg listing + review push, status
   page, CI, reminder persistence — the unglamorous things that separate
   "bot that dies" from "bot communities depend on" in every complaint thread
   we read.

---

*Full source citations live in the research transcripts (competitor pricing
table, market scans, BR format rulebooks — ALGS/PUBG/WRS official PDFs,
top.gg listings, Discord policy pages, all fetched 2026-07-09). Key figures
quoted above: Tourney Bot 27,959 servers & $1.99–15.99 tiers
(top.gg/tourneybot.gg); NeatQueue 25,384 servers (top.gg); Yunite 171,898
servers (top.gg); Apollo 309,909 / Sesh 305,519 / Raid-Helper 270,518
(top.gg); Sesh Pro $24.99 (sesh.fyi); Toornament plans Mar 2026
(blog.toornament.com); start.gg 6% fee Feb 14 2025 (CEO Gaming/X, start.gg
ToS); Discord Premium Apps 15%/30% + Oct 7 2024 parity mandate
(support-dev.discord.com); Guilded shutdown Dec 19 2025 (Roblox devforum);
ALGS Year 5/6 rules PDFs (algs.ea.com); PUBG SUPER v5.0.1
(wstatic-prod.pubgesports.com); CODWRS 2026 rulebook (callofduty.com).*
