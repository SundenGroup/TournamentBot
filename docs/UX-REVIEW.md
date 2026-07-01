# UX Review — Admin Flow & Player Signup (July 2026)

A walkthrough of everything admins and players see in Discord, with concrete
improvements. Items marked ✅ were implemented immediately; 💡 items are
recommended next steps, roughly ordered by impact.

---

## Admin flow

### Implemented now ✅

1. **Quick Start moved to the top of `/admin help`.** The most-read part of the
   longest embed was buried at the bottom. It also now points at the 👑 match-room
   buttons (the recommended way to report) instead of `/tournament report`.
2. **Premium markers on the wizard toggles.** Check-in 💎, Captain Mode 💎,
   Seeding 💎, Web Bracket 🌐 — admins on Free no longer discover the gate only
   after filling in the whole wizard. A legend line explains the icons and that
   green = on.
3. **Per-tournament channels** (`channel:` on both create commands) — the #1
   structural request for big-game/regional servers. See ADMIN-GUIDE.
4. **Web dashboard mirrors the whole admin toolset** (create/edit/start/report/
   correct/DQ/remove/rooms/cancel) — admins can run events from a browser where
   Discord modals are limiting.

### Recommended next 💡

1. **Date input is the #1 admin failure point.** Discord modals can't render a
   date picker, so `Feb 15 7pm UTC` free-text is parsed. Improvements:
   - echo the failed input back in the error ("Couldn't read \"feb 31\" as a
     date…") and list 2-3 accepted formats;
   - accept `<t:unix>` Discord timestamps pasted from other bots;
   - after creation, always show the parsed result prominently (already shown
     as a Discord timestamp in the embed — good).
2. **Wizard "Create with defaults" shortcut.** The settings screen already says
   "or create with defaults" — add a dedicated ✅ Create now button on the FIRST
   wizard screen so a confident admin skips two screens.
3. **`/tournament report` is redundant with the 👑 buttons** and lacks their
   score picker. Keep it (needed when a room was deleted), but the help copy
   should present buttons as the primary path (done in Quick Start), and the
   command could hint "tip: reporting is quicker with the buttons in the match
   room".
4. **Start button styling.** "🚀 Start Tournament" is a red Danger button —
   deliberate (prevents accidental starts) but reads as destructive. Consider
   Success style + the existing confirmation summary, or keep red and add a
   confirm step (the web dashboard uses two-step confirm).
5. **Error copy jargon.** "Tournament is not in registration/checkin phase" →
   "This tournament has already started (or finished)". One string in
   lifecycleService now serves slash+buttons+web, so it's a single edit.
6. **`/admin settings` → actionable.** Each row could name the command that
   changes it (it partially does); a future web Settings tab is the real fix.

---

## Player signup flow

### Implemented now ✅

1. **Signup confirmations now say what happens next.** Solo + team + game-nick
   variants all gained: start time (as a local-timezone Discord timestamp),
   check-in expectations ("check-in opens 30 minutes before start — watch for
   the ping, or you'll be dropped"), and where updates are posted. Before, a
   player got a bare "You're signed up!" and nothing else until (maybe) a DM.
2. **Check-in DM includes a jump link** straight to the announcement's ✅ Check
   In button — previously players had to scroll/find the message themselves.
   The channel ping now says to use the button on the announcement.

### Recommended next 💡

1. **Team-member resolution is the #1 player failure point.** Captains must
   type exact Discord usernames; "Could not find user: X" round-trips the whole
   modal. Ideas: accept `@mentions` and user IDs in the members field; fuzzy-
   match display names with a confirmation step; or (best) replace the flow
   with a UserSelect component message instead of a modal free-text field.
2. **Completion DM.** Podium is announced in-channel, but participants who
   aren't watching miss it. A short "🏆 X won — you placed #N (full results:
   link)" DM to entrants would close the loop. (Batch + rate-limit aware.)
3. **Withdraw confirmation** is instant with no undo. A two-step confirm (like
   the web dashboard's) prevents accidental self-removal a minute before start.
4. **"Register Team" naming.** 🎯 Register Team opens a modal asking for OTHER
   members — captains sometimes list themselves. The modal label says
   "(excluding yourself)" but a first line in the modal title/placeholder is
   ignored under pressure. UserSelect flow (item 1) also fixes this.
5. **Consistency polish** (from the copy inventory): unify "Tournament
   Complete!" vs "Tournament Completed"; standardize empty-state phrasing ("No
   active matches at the moment" vs "No matches"); a couple of DMs use ℹ️ where
   siblings use ✅/🚫.

---

## Where the popups can't get better (Discord limits, for reference)

- Modals allow max 5 text inputs, no selects/checkboxes/dates inside, no
  helper text besides labels (45 chars) + placeholders (100 chars).
- Slash-command choices/autocomplete can't render custom emoji or images.
- That's exactly why the wizard uses select menus + toggle buttons between
  modals, and why the web dashboard exists for anything form-heavy.
