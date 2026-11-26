# Pocket Life: design notes

Luke's mobile "life in your pocket" game: SEED meets One Hour One Life. Built step by step with Claude.

Every decision so far, split by area so an update only reads the file it needs. When something is decided, add it to the file for its area (or a new file, listed here). Each file says how things are now; when a long story of how it got there is no longer needed day to day, it moves to docs/history/ (only for looking back).

Since 0.2.0 the game's content is in content/*.json (one file per kind; test/game-data.json is made from them by `python3 tools/worlds.py test-build`). Where these notes say game-data.json, the section named is in content/: items, itemGroups and retired in items.json; recipes in recipes.json; placeables and crops in placeables.json; sources, plants, chopping, mining, berryBushes, regions, daylight and night in world.json; settings, stats, energyCosts, away, claims, societies and liveSettings in rules.json; looks, bodyShapes, defaultLook and testNames in people.json; tips and chatFilter in text.json; version, build and the devlog in version.json.

Version numbers: 0.2.x and 0.3.x written as "old 0.3.0" are the numbers from before the reset on 23 Nov 2026 (old 0.3.8 became 0.1.0), so they're older than every 0.1.x. The next minor version, when Luke says, is a new 0.2.0.

- docs/adding.md: how to add items, recipes, placeables, live settings, actions and admin tools (start here)
- docs/design/basics.md: look, clock, age, needs, walking, controls
- docs/design/online.md: one shared world, chat, safety, playing on other devices (link codes), leaving for good
- docs/design/away.md: what your person does while you're away; timing, sleep and death
- docs/design/needs-and-crafting.md: crafting, chopping, rest, stamina, tall grass, held tools, the timing pass, stone and mining, fishing and cooking
- docs/design/placeables.md: campfires, fuel, sitting, the placing grid, flat ground (and trees, rocks and bushes moving with it)
- docs/design/farming.md: the stone hoe, farm fields (dig in your camp, flatten), berry seeds, crops growing, the admin's Grow now
- docs/design/claims.md: campfire claims (who can do what where, fuel, away people)
- docs/design/societies.md: societies (your claim is your society: lighting starts it, invites, leader, leaving, the admin's list)
- docs/design/inventory-and-menus.md: inventory grid, Recipes tab and craft mat, tap menus, stations, pack up
- docs/design/admin.md: admin mode (the way in, tapping things), the dashboard's tabs (Server, Players, Inbox, World, Settings, Items, Log), Reset and Restore, changing numbers live
- docs/design/wording.md: the words players see (camp, +10 food, capitals, times, the same words in tap menus and the task list)
- docs/design/later.md: only what isn't built yet, known limits, and what only Luke can do or decide
- docs/design/code.md: how the code works now: the page and loading, shared rules, drawing, the server, Cloudflare's free plan, the server's guards, privacy page and tips
- docs/design/working.md: versions, What's new, test then release, checks
- docs/history/: code.md, later.md and admin.md as they were on 26 Nov 2026 (audits, measurements, the first admin), only for looking back
