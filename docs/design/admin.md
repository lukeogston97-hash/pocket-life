# Admin: admin mode, the dashboard and live settings

How it works now. How it got this way (the admin player before admin mode, the first Admin update): docs/history/admin.md.

## Admin mode
- The admin is never a player (24 Nov 2026). On the server the admin is only a connection that watches with the code and has no person (`isAdmin(me)` in server/src/index.js); a playing connection that carries an old admin flag has it dropped before anything reads it.
- Way in: tap the version number on the main menu 5 times (each tap within 4 seconds of the last), then type the admin password. It's asked every time and never kept on the device: only in memory while admin mode is open; Exit admin forgets it. 5 wrong passwords in 15 minutes lock that address out for 15 minutes. A refused password is never kept or sent again (the server says no before it sends the game away for maintenance or an update).
- Other ways to the same box, so the admin is never locked out: `?admin` on the end of the address opens it when the game loads, and while maintenance is on, 5 taps on the words "Back soon". The password is still the lock.
- On touch screens the version number and "Back soon" take quick taps as taps, never a zoom, and every box the admin types in is 16 px.
- What it is: a watch view of the live world with no person, and a free camera. Phone: one finger slides, pinch zooms, two fingers twist to turn. Mouse: drag turns, right-drag (or Shift and drag) slides, the wheel zooms; W A S D slide, Q E turn, R F tilt. A top bar (Admin, world and time, counts, Dashboard, Exit), and the Dashboard: a dock on the left on a computer, a sheet from the bottom on a phone (700 px wide or less). Code: test/game/admin-mode.js (the way in, camera, taps) and test/game/admin.js (the dashboard and tools).
- Dashboard tabs: Server, Players, Inbox, World, Settings, Items, Log. They sit in rows of four, so a new tab joins the last row. New feedback or a report shows a line under the bar, only in admin mode.
- Rule (Luke: "as new thing get added the admin pannel needs to update as well"): every update that adds something adds the admin's control for it in the same update. docs/adding.md says how for each kind of thing. New items, recipes and live settings show up in the dashboard by themselves.
- Not built: switching worlds (Luke: "not need just yet"; the top bar already names the world, which is where it would go), and from the first mockup a panel for the selected thing, a map and camera modes.

## Tapping things in the world
- The ground: Add item (a picker with search, the Recipes headings and 1, 5 or 10) and Fly here.
- A person: their page, fly to, follow, move (tap where they go), fill needs, mute, kick, ban.
- A loose item: remove.
- A tree, stump, rock, boulder or berry bush: Move (then tap where it goes), Regrow (a stump back to a tree, a mined boulder back, a bush full of berries; since 0.2.9 Grow up now on a young tree and Fill with apples on an apple tree) and Remove (asks once more; gone for good).
- A campfire: Move, Fill with fuel, Light or Put out, End claim, Remove, and Fires and claims.
- A farm field: Move, Grow now (when something is planted: grown and full of berries), Remove.
- The layout never moves: moved things are kept in world.moved (`'tree:12': [x, z]`) and drawn shifted from where they were laid out; removed trees and rocks are state gone plus world.removed (removed rocks never come back), removed berry bushes are in world.removed.

## Server tab
- Today's use of Cloudflare's free plan (requests and storage writes).
- Maintenance, with its message: the main link shows Back soon to everyone. It pauses everyone who isn't playing: their needs, strolls, the day-asleep and 3-days-gone timers and every fire's fuel stop, and carry on from where they were when it ends or they get back in (persons.js paused and thaw, maintAt). People still playing (the test link) carry on.
- Message everyone; speed up time (10x, 60x or 600x, for a chosen length); the admin tag.

## Players and their pages
- Players: search by name, filters All, Online, Away, Asleep, Muted, Banned (with counts), 50 at a time.
- A person's page: needs as bars, and Edit needs and age (needs 0 to 100, health never below 1 since Remove from world is its own button, age 13 to 120; only changed boxes are sent). Rename (any name, for one the filter missed; everyone sees it straight away). A message only they see (shown while they're online, not kept). Their bag with Take 1, Take all and Give items (respects their carry limit), and their tool bar. Their task list as the server has it, with Clear task list (two taps; their game stops too). Their recipes found on the craft mat, with Find all and Clear found (a.found). Their camp, with Take out. How many devices they play on, with Unlink all devices. Reports about them, and their past people (past:<who>).
- Also there: Fly to, Follow, Move, Fill needs, Mute, Kick, Wake up, Send to sleep, Ban, Remove from world (two taps).
- Moving someone who is away: they carry on by themselves from the new spot. Follow keeps the camera on them until the view is moved by hand or they leave; a chip at the bottom says who (tap it to stop).

## Inbox
- Feedback and Reports, with a new count. Done or Delete; Done ones are deleted after 30 days. Auto notes from errors ("Server error", "Game error") land here too, counted when they repeat.

## World tab
- Counts of everything (trees, stumps, young trees, apple trees and how many picked, boulders, rocks, berry bushes, each kind of placed thing, with "Farm fields 3 (2 planted)", loose items by kind).
- Regrow everything: stumps, mined boulders, broken rocks, bushes, the pond's fish, crops on farm fields, grass, and sticks and stones topped up. Since 0.2.9 also young trees grown up, every apple tree full, and everything gone from the wild back at once (never inside a camp or on something placed: wild.md).
- Clear loose items near you (10 m) or in the whole world (two taps).
- Fires and claims: every fire, whose claim it is, burning or out, and the fuel left. Fly to, Put out, Light, End claim, and under More the hours of fuel and who the claim goes to. The same rules as the game: one claim each, clear of the pond and of other claims, only a burning campfire holds one (`claimFit` in claims.js). Put out ends a claim on that fire, so it asks twice. End claim frees the land and the fire burns on. A fire with no fuel can't be lit. A fire the admin lights is nobody's claim until it's given to someone. The owner is told when their claim ends or when they're given one.
- Societies (camps): each with its leader, how many of how many, and its claim. Fly to, Members (each with Take out, and Rename), End (two taps: its fire goes out). A claim is a society: End claim ends it (the fire burns on), and Give claim starts a new one for that person. See societies.md.
- Danger zone, two buttons, each two taps (the second only counts after 1 second, so a double tap by mistake does nothing). Reset the world: the land, loose items, placed things, claims and the admin's moved and removed things start again; people stay. Reset everything (`a.reset` with `all`): that, plus every person, past people, the Inbox and the ban and mute lists. It keeps live settings, speed, maintenance and today's usage. Everyone rejoins and makes a new person. Only Restore can undo it. Check: `reset_all`.
- Restore an earlier time: quick picks (10 min, 1 hour, 6 hours, 1 day) or Pick a time (last 30 days); two taps. server/src/restore.js uses Cloudflare's point-in-time recovery, so everything goes back together (the land, every person and bag, claims, the Inbox, bans, maintenance, live settings). Everyone is told (`restoring`), the world restarts 1.5 s later and every game reconnects by itself. The phone that restored gets an undo point (kept in localStorage `pocket-life:restoreUndo`), shown as Undo on the World tab (used up once done). If a bad server update caused the damage, roll the code back first. The local test server keeps its own history so the `restore` check can try it.

## Changing numbers live: what wins
- game-data.json is where every number starts. A change the admin makes sits on top and wins, also over a new build, until its Reset is tapped. A changed number says "Changed (was X)".
- Settings tab: the live settings (liveSettings in game-data.json for names, groups, units and limits; server/src/live.js and LIVE_SET plus LIVE_BASE in game/admin.js wire up each id; saved as 'live'; games get them in welcome and 'live'). Groups now: Players (player limit, people in a camp, tool bar spots), Respawn times, The wild (0.2.9: how often a tree, a bush, tall grass, a boulder and a broken rock come back, and how full the wild grows back), Farming (planted crops grow in), Need rates.
- Items tab (server/src/live-items.js, storage key `liveItems`): an item's weight, a tool's uses, how much a food fills, and how many of each thing a recipe needs and makes. Every game gets them straight away. Not changeable there: names, looks, new items or ingredients, and how many lie about in the world. It shows one line per item, A to Z, summing up its numbers ("weighs 1 · 20 uses", "Changed" if any are), with the Recipes headings as chips (0.1.20) and a search; tap a line to open its numbers (Save once a box changes, Reset once it has). Check: `admin_items`.
- Copy my changes: lines like `items.knife.weight: 1 -> 4`, to send to Claude, who writes them into content/*.json (then test-build); then they're Reset in admin. That's how a change becomes permanent.

## Log
- Log tab (server/src/activity.js, storage key `activity`, the newest 200 lines): new people, deaths, someone back after 10 minutes or more away, someone gone after too long away, claims made, every admin tool that changes something (with its answer, also when it couldn't be done), admin mode opened, and wrong admin passwords (never the password). The same line again within 10 minutes is counted, not repeated. Filters: All, People, Admin, Refused.
- Few writes: one per line, and lines are rare (never one per ordinary action). Reset everything empties it; a Restore puts it back to how it was then.
