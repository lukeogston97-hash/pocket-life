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
- [ ] 1. Read the code (server, game admin/online/input/camera/screens, tests)
- [ ] 2. Server: admin as watcher, old /admin removed, tools by target
- [ ] 3. Game: entry (5 taps + password), free camera PC + phone, exit
- [ ] 4. Game: overlay panels with all current tools
- [ ] 5. Extras: follow/move people, edit stats/bag, claims and fires, activity log
- [ ] 6. Live item and recipe editing + Copy my changes
- [ ] 7. Checks: update old ones, add new ones, lint, full run.py
- [ ] 8. Look review from screenshots (PC + phone)
- [ ] 9. Docs: CLAUDE.md, docs/design/admin.md, docs/adding.md
- [ ] 10. Release (same version), merge to main, push, confirm live, delete this file, cancel check-ins, morning summary

## Progress log (newest last)
- 21:25 Branch created, notes written.
- 21:26 Check-ins scheduled (cancel the unfired ones at the end with delete_trigger): trig_01MFHwhkpa4tSebmEMrMSKke (11pm), trig_01CJurrnop76uWLnHagb5J9f (1am), trig_0112iKM78AXZAZMz46fHmjpR (3:30am), trig_013FP6oEBHVHXBqQ6WauqUjp (6am).
