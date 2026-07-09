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

## 6. Founder review addendum (July 2026)

Decisions and refinements after reviewing §1–5 with Simon.

### 6a. Pricing, simplified: two SKUs + B2B

Direction: **B2B is the real revenue; consumer subscriptions exist for a
healthy user base and a stable payment baseline.** Four tiers is too many for
that job. Collapse to:

| | **Free** | **Pro — $9.99/mo · $79/yr** | **Studio (B2B) — custom, from ~$500/mo** |
|---|---|---|---|
| Positioning | The weapon. "Run real tournaments free, in Discord, no ads." | One decision: *do I run a program, not just events?* | "The official tournament bot for your game" |
| Tournaments | **Unlimited** | Unlimited | Unlimited |
| Entrants | **64** | 256 (512 with Event Pass) | 512+ |
| Concurrent | 2 | Unlimited | Unlimited |
| Features | **Everything core** — all 4 formats, match rooms, buttons, check-in, seeding, captain mode, corrections/DQ, live web bracket *with "Powered by CLUTCH" footer* | Web dashboard, recurring tournaments, seasons/leagues (when built), templates, analytics, footer removal, priority support | Everything + white-label, custom game preset & private fields (the GOALS pattern), API + webhooks, multi-server, SLA/onboarding |
| Sold via | — | Stripe site (annual-forward) + Discord store (monthly) | Direct/contact |

- **Kill Premium ($5.99) and self-serve Business ($99).** Two consumer paid
  tiers force feature-hostage decisions ("which tier gets seeding?") that
  complicate copy, code, and support — and Premium's features (check-in,
  seeding, captain mode) are table stakes that make the *free* product feel
  complete, which is what the B2B story needs ("thousands of servers run
  this"). Business's features (API/white-label/multi-server) were always
  B2B features; move them to Studio where the price can be honest.
- **Optional later SKU: Event Pass (~$9.99 one-off)** — everything-Pro for a
  single tournament. Don't launch day one; add when someone asks.
- **Migration**: with zero marketing to date there's almost nobody to
  grandfather — this is the cheapest moment to simplify. Existing paid guilds
  (if any) get mapped Premium→Pro free for 12 months, Business→Studio talk.

**What risks can we take with free?** All of the cheap ones:
- *Infra cost* — negligible at current scale; the single-process ceiling is
  the real limit and it's capped naturally by 64 entrants/2 concurrent.
- *Support load* — the actual cost of generous free. Mitigate with the docs
  (already strong), a community server, and the dashboard reducing "how do I"
  tickets.
- *Cannibalization* — acceptable by design: free optimizes for install base,
  reviews, and the viral bracket footer. Pro's value is programs (recurring,
  leagues, dashboard, analytics), not the ability to run one event.
- *The one risk NOT to take*: launching generous and later clawing back
  (Tourney Bot's token fiasco is the cautionary tale). Whatever free is on
  marketing day is a floor forever — which is why 64 entrants (not 512) is
  the right free cap, set consciously *before* the marketing push. Today's
  accidental "everything free" (parked tokens disabled all caps) gets
  formalized into these numbers, decoupled from the token flag.

### 6b. Battle Royale with zero added complexity — the three rules

The concern: BR must not make the bot harder for a non-technical admin.
Design answer — BR ships invisible behind the same three walls that already
hide per-game complexity:

1. **Scoring lives in the game preset, never in a form.** Picking "PUBG"
   in `/tournament create` IS choosing SUPER scoring (10/6/5/4/3/2/1/1/0 +1
   per kill), lobby size, games per stage. Same 3-field modal as today
   (title, date, max). Warzone preset = kill×multiplier model; Apex = ALGS
   table. An admin never sees the words "scoring model" unless they open
   advanced mode, where it's one dropdown ("Standard (recommended) / kill
   race / custom").
2. **Reporting is taps, never syntax.** The old `placements:1,5,3,2,…`
   comma format is dead. In Discord: a "Report Game N" button in the lobby
   room → select menus, "Who placed 1st? → 2nd? → 3rd?…" — report the top 5
   and press *Done*, the engine already auto-fills the rest as shared last
   place. On the dashboard Run view: a tap-in-finish-order grid with
   per-team kill boxes (the full-detail path). Non-techy admins never need
   the dashboard; power admins never need Discord.
3. **BR UI only exists when a BR game is picked.** No BR options, buttons,
   or copy anywhere for CS2/VALORANT/GOALS organizers. (Already how the
   wizard works — the parked options render only for `battle_royale`.)

Player-side: nothing new at all — same signup button, same check-in, one
lobby channel instead of match rooms, standings on the same live web page.

Rollout: fix the four parked bugs → engine v2 (config-driven scoring) →
tap-to-report flows → enable for PUBG + Warzone + Apex + a "Custom BR"
preset. Skip Fortnite (Yunite owns it). Success bar: a first-time admin runs
a 40-player BR night without reading the manual.

### 6c. GOALS — July 20, 2026

Signups for the first big GOALS tournament open **July 20 on the Clutch
Bot** — first major brand running on it publicly, under the CLUTCH brand
(no white-label, by their choice). Implications:
- This *is* the soft launch. The §5 "trust basics" (reminder persistence,
  monitoring, deploy freeze that week) graduate from backlog to pre-July-20
  checklist, plus a mass-DM rate-limit review (check-in/bye loops at 100+
  players) and a full GOALS-preset dry run.
- It also validates §2.5 (studio offering) with zero sales effort — the
  case study writes itself: "GOALS runs its official tournaments on CLUTCH."
  Capture metrics during the event (signups, check-in rate, bracket page
  views) for that story.
- Free-tier caps must NOT be enforced before this event concludes.

---

## 7. LFG deep-dive (July 2026 research)

Question: Gankster and VALORANT LFG built ecosystems around teammate-finding —
what's there for us? Live counts below pulled 2026-07-09 directly from
Discord's invite API unless noted.

### 7a. The market shape: servers thrive, products die

**Demand is enormous and lives in Discord servers, not products:**
| Community | Members (online) |
|---|---|
| VALORANT official (w/ Riot) | 2,445,685 (377K) |
| Fortnite official (LFG channels) | 1,725,003 (333K) |
| **VALORANT LFG** (community-run) | **1,112,859 (231K online)** |
| Destiny 2 LFG | 532K (143K) — **sells $2.99/$9.99/$29.99-mo tiers** |
| R6 official / Apex official / CoD | 907K / 852K / 688K |

**Standalone LFG products are a graveyard:** TEAMS.gg dead Jan 2025 after
1.5M connection requests ("ads and subscriptions… haven't been enough to
cover the costs" — their own goodbye page); Guilded dead Dec 2025; Duoo's
domain now redirects to an elo-boosting shop; GamerLink and Teamfind are
zombies; LF.Group exited to Xsolla and its site is dark. First parties fare
no better: Discord killed its own LFG (never left beta), Blizzard removed
Overwatch's in-game LFG ("social and disruptive behavior problems we never
solved"), Apex removed Clubs. The recurring failure: **users match and
leave** — no retention, no willingness to pay, moderation costs exported to
volunteers.

### 7b. How Gankster actually cracked it (the part worth copying)

Gankster (Israeli startup, $4.25M seed Dec 2022 — Bessemer, Hetz, Overwolf,
Samsung Next) did NOT build a destination site and wait. They became
**infrastructure for the communities that already own the audience**:
- Their bot **powers the group system inside the 1.1M-member VALORANT LFG
  server** — press "create a group" posts in-channel, funneling users to
  Gankster accounts + app (documented in player threads; they host a branded
  page for the server at valorant.gankster.gg/communities/valorantlfg).
- They **sponsor the community-admin layer**: a $50K fund for community
  leaders, fronted by Flokie — who owns the official VALORANT Discord
  (1.5M+) — via a "Gaming Admins" community (Nov 2023).
- They own a **reputation graph** (GANKREP: post-game tags incl. Toxic/Troll)
  — the moat LFG servers can't build themselves.
- They **partner instead of build** where an incumbent owns a vertical:
  Fortnite tournaments run through a Yunite partnership, not Gankster
  brackets.

The playbook: distribution = the big servers, product = the workflow inside
them, moat = identity/reputation data. That is "building an ecosystem."

### 7c. What CLUTCH should do

1. **Build tournament-scoped LFG into CLUTCH** (do this): free-agent signup
   ("I don't have a team — match me"), auto-formed teams at start
   (Challengermode does exactly this), an organizer draft view (Battlefy's
   Free Agent Draft), and a **sub-finder** for no-shows (ESEA's "ringer"
   list). This is proven prior art on every serious platform, has **zero
   Discord-bot competition**, fixes our own team-tournament pain (partial
   rosters, no-shows), and improves the GOALS events immediately. It also
   makes free-agent players a growth loop: they join the server to play.
2. **Do not build a standalone LFG destination.** The graveyard is
   conclusive; even $4.25M-funded Gankster monetizes weakly and had to buy
   distribution through community funds.
3. **Run the Gankster playbook with tournaments as the wedge** (the real
   opportunity): the mega-LFG servers already run "regular tournaments and
   events with prizes" as retention — with duct-tape tooling. Our pitch to
   them mirrors Gankster's: a branded, embedded tournament system (buttons,
   auto rooms, live web brackets with their branding) in exchange for
   distribution. Three server partnerships (say, a 100K+ Warzone community,
   an R6 community, a VALORANT community) would dwarf any top.gg marketing.
   Gankster itself is a possible **partner, not rival** — they outsource
   brackets (Yunite for Fortnite); we outsource group-finding.
4. **Later, only if (1) works:** extend free-agent pools cross-server into a
   scrim/team-finding network. Our edge over every dead LFG product: entrants
   come with **verified competitive history** (real results from real
   tournaments) — a trust signal Gankster has to synthesize with GANKREP and
   nobody else has at all.

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
