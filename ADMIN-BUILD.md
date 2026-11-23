# Admin mode: overnight build (23 Nov 2026) - working notes

Temporary file. Delete it before merging to main.
Branch: `admin-mode`. Never push unfinished work to main (the server deploys from main and is shared with players).

## What Luke asked for (all decided, do not re-ask)
- Admin moves out of the game. No player can be admin. Old `/admin` in the Say box is removed.
- Way in: tap or click the version number on the main menu 5 times, then the admin password (the existing Cloudflare secret ADMIN_CODE, never handled by Claude). Password asked every time (never stored on the device; kept in memory only so a dropped connection can rejoin while the page stays open).
- Admin is not a person: a free camera ("watch perspective") over the live world. Invisible to players, doesn't count as a player, claims and reach don't apply.
- Must work on PC (WASD/QE/RF, click) and phone (drag, pinch, twist, tap).
- Look: overlay dashboard over the live world, dark glass like the rest of the game. PC mockup: top bar (Admin pill, world name + time, online/away/asleep counts, usage, Maintenance, Exit admin), Dashboard docked left (tabs Server, Players, Inbox, World, Settings), selected thing panel top right, map + camera bottom right, world tools bottom centre (Select, Add item, Move, Regrow, Remove, Teleport). Phone: same panels slide up from the bottom.
- Everything the old Admin panel did, plus: follow and move people, edit stats and bag, claims and fires, activity log, "anything else that might be needed".
- Live editing: settings plus items (weights, recipes, need numbers). Source of truth: game-data.json is the base; an admin edit sits on top and wins, even over new builds, until Reset. Changed values show "changed (was X)". "Copy my changes" button exports them so they can be written into game-data.json later. Item weights stay whole numbers.
- Lists (Add item, Give, recipes, settings) come from game-data so new things show up by themselves. Every future update must add admin controls for what it adds (write this into CLAUDE.md and docs/adding.md).
- World switching: not needed yet, but admin connects to a world by name so a picker is easy later.
- New feedback count: only inside admin mode (Inbox tab), not on the player's Menu.
- One big update, published straight to the main build (skip the test link) once the full checks pass. No dev log entry. Version stays 0.1.2 (only the hidden build counter may go up so open games reload).
- If it can't be finished or checks fail: publish nothing, leave it on this branch, tell Luke.

## Plan (tick as done)
- [x] 1. Read the code (server, game admin/online/input/camera/screens, tests)
- [~] 2. Server: admin as watcher, old /admin removed (DONE, proven). Tools by target: a.movePerson and a.setStats DONE and proven; the rest of the new tools are DEFERRED until the client works (see 23:10 note)
- [ ] 3. Game: entry (5 taps + password), free camera PC + phone, exit
- [ ] 4. Game: overlay panels with all current tools
- [ ] 5. Extras: follow/move people, edit stats/bag, claims and fires, activity log
- [ ] 6. Live item and recipe editing + Copy my changes
- [ ] 7. Checks: update old ones, add new ones, lint, full run.py
- [ ] 8. Look review from screenshots (PC + phone)
- [ ] 9. Docs: CLAUDE.md, docs/design/admin.md, docs/adding.md
- [ ] 10. Release (same version), merge to main, push, confirm live, take this file out of git (keep it on disk), morning summary
- [ ] 11. Full check of the whole game (Luke, 21:30: he is releasing for public testing). After 10 is published: every automated check, go through each area as a new player on phone and PC, look for ways to break or cheat. Clear bugs: fix on the TEST LINK ONLY (test/ on main), do NOT release them, Luke releases. Design choices (look, how it plays): change nothing, list with a suggestion. Say what was and wasn't checked. Then cancel leftover check-ins and write the morning summary.

## Progress log (newest last)
- 21:25 Branch created, notes written.
- 21:26 Check-ins scheduled (cancel the unfired ones at the end with delete_trigger): trig_01MFHwhkpa4tSebmEMrMSKke (11pm), trig_01CJurrnop76uWLnHagb5J9f (1am), trig_0112iKM78AXZAZMz46fHmjpR (3:30am), trig_013FP6oEBHVHXBqQ6WauqUjp (6am).
- 21:32 Luke added step 11 (full check of the whole game, fixes to the test link only). Baseline: lint passes on untouched code; tools/tests npm install done.
- 22:05 Step 1 done. Checks run here (Chrome, Node, Playwright all present). On UNTOUCHED main: lint passes, smoke passes, admin_tools passes (334 s here, so the full run.py will take well over 35 minutes), layout FAILS on serverLayout only.
- 22:05 FINDING for step 11 (was there before this build, not caused by it): tools/tests/layout-baseline.json says serverLayout 38022df1, main gives 1994efcb. Checked on this machine: at bb4d71a (where the baseline was saved) the check passes with 38022df1, so the machine is fine. Hashing each part of layoutData() (script kept at /home/claude/notes/layout_parts.py, run from tools/tests) shows ONLY `shore` changed (46 points both times, d80729e -> e5fdf8d0). bushes, open, trees, rocks, oldStumps and plants are identical, so nothing laid out in the shared world moved. Likely from 4f81a83 "a fix for getting stuck walking to the pond" (matched by its message only, diff NOT read yet: confirm in step 11). DO NOT run UPDATE_LAYOUT or edit layout-baseline.json: whether that change was meant is Luke's call. Report it to him.
- Guard for this build: after my changes every part must still hash to the main values: bushes 30:c382205b, shore 46:e5fdf8d0, open 600:c31ad514, trees 1133:1cd3e8d5, rocks 66:948268a7, oldStumps 0:741638a5, plants 1:ced5fb4c, all 1994efcb.
- 22:40 Step 2, first half DONE and saved. Server: the admin is only a connection that WATCHES with the code (index.js isAdmin: admin && watch && no who). hello ignores the code on a playing connection. adminLogin (/admin in the Say box), the admin tag and the badge are removed.
  - Proven by check `admin_login` (python3 tools/tests/run.py admin_login, passes): plain watcher is not admin, watcher with code is, a player with the right code is not and can't use a.* tools, old adminLogin does nothing, wrong code refused, 5 wrong codes lock the address.
  - Proven by tools/tests/stale_admin.mjs (exit 0; exits 1 with the fix taken out, tried both ways): a connection still carrying admin:true from before the update loses the flag on its next message. Without that line it kept the reach bypasses in actions.js (took a stick from 55 m). The a.* tools were already closed to it. Runs the World class directly, not Cloudflare's runtime.
  - Changed but NOT yet exercised by any test: maintenance kick now uses isAdmin (admin.js). The old checks maintenance, admin_tools, reset_all, restore, errors, collapse, screens, guards all log in through the Say box, so they are BROKEN on this branch until rewritten (step 7). The game client still has the old admin code too: game and server disagree on purpose until steps 3-4.
  - The 20 `me.admin` reads in actions.js are left in place on purpose (less churn in player actions); they can no longer be true for a player.
  - Lesson: my first grep for admin flags filtered out lines containing `this.admin.` and so missed admin.js:96. Re-grepped with nothing filtered.
- NEXT: server tools that need a target instead of the admin's own person: a.movePerson, edit stats/age, bag set, rename, message one player, claims list/remove, fire light/out/fuel, activity log. Extend the raw check as each lands.
- 23:10 Server tools added and saved: a.movePerson { id, x, z } and a.setStats { id, stats, age }. Check `admin_people` (19 assertions, passes, 99 s) uses a real player page plus a raw admin connection.
  - Proven: an online person's own game goes to the new spot and stays; refusals for the pond (rough circle, the server only knows the pond's radius) and off the map; needs typed in reach their game; health can't be typed below 1 (my choice: no killing through a number box, Remove from world is its own button); age changes, never below 13 (I allow up to 120, since birthdays can pass 90: my choice, tell Luke); someone AWAY is moved and not snapped back.
  - Someone away is NOT pinned where they are put: they decide again by themselves (away.js decide). The admin's answer says so. Tonight the test ran at night in the world's clock, so they lay down and slept in place. The daytime branch (stroll back toward the pond or their claim) is read from the code, NOT observed in a test: the server uses real Darwin time and the check can't change it.
  - NOT tested: moving someone sitting by a fire, or someone 'asleep' after a day away; typing Rest to 0 (collapse).
  - Tool answers arrive as t:'admin' with words in `text` (never 'adminDone': adminState's t wins the spread). Checks use the `ask()` helper, which waits for the answer. A fixed pause raced it: replies took 200 to 700 ms here. "Nothing comes back" checks wait QUIET = 1500 ms; that is longer than seen, not a guarantee. The firm proof that a player is never admin is tools/tests/stale_admin.mjs (no timing) plus admin_login.
  - Lesson: when a reply seemed missing I guessed twice (an exception, then the wording) before measuring. A one-run diagnostic showed the real cause and a wording bug. Measure first.
- 23:10 PLAN CHANGE (time): the client is the biggest piece and nothing can be published without it. Order from here: step 3 (entry, password, free camera, exit) proven in a real page, then step 4 (existing tools on the new screen), then rewrite the 8 broken checks, THEN the remaining extras and live item editing if time allows. If the whole update can't be finished and checked, publish nothing and tell Luke exactly what is done.
