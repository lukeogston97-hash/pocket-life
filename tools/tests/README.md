# Checks

Runs the real server code on this computer and plays the test build (`test/`) in Chrome, so nothing touches the live world.

- First time: `cd tools/tests && npm install` (plus Python Playwright and Chrome; set CHROME to its path if it isn't /usr/bin/google-chrome).
- Small change: `python3 tools/tests/run.py quick` (layout + smoke, about a minute) plus the check for what you touched.
- All checks (only after big changes, about 35 minutes; skips `screens`): `python3 tools/tests/run.py`. `screens` only when reviewing the look: `python3 tools/tests/run.py screens`. One or two: `python3 tools/tests/run.py menu grass_and_tools`.
- `layout` compares the world layout with `layout-baseline.json`. It must not change, or shared items and bushes won't line up with the live world. Only after an intended layout change: `UPDATE_LAYOUT=1 python3 tools/tests/run.py layout`.
- `screens` saves screenshots of every screen (phone and computer) in `tools/tests/shots/` to look over.
- Add a check: write an async function in `checks.py` and add it to `CHECKS`.
- `server_tests` runs quick tests of the server's own code with no browser (a few seconds): `admin_extras.mjs` (the admin's fire, claim, Log, rename and message tools), `live_items.mjs` (item and recipe numbers changed live) `stale_admin.mjs` (an old admin flag gives a player nothing) `cheats.mjs` (things only a changed game would send, like chopping a tree that isn't there) `societies.mjs` (societies: starting, invites, joining, leaving, leaders, being gone, the admin's tools) `forget.mjs` (Leave the world for good) `toolbar.mjs` (the tool bar: equip, unequip, swap, weight, breaking, the live number of spots) `farming.mjs` (farm fields: digging in your camp, flattening, planting, growing, picking, away, the admin) and `retire.mjs` (items taken out of the game, like twigs, turned into what game-data.json's retired says when the world starts). Add to them when you add an admin tool: they're the fastest way to try every wrong input. By hand: `cd tools/tests && python3 -c "import lib; lib.bundle()" && node admin_extras.mjs`.
- This computer (Claude's) draws the 3D world in software at 1 to 2 frames a second, so a check counts frames, never milliseconds, and nothing here can judge how the game feels.
- How the server copes as the world grows: `python3 tools/tests/load.py 300` runs the real server code in memory with 300 people away and 20 playing for an hour, and prints the tick time, storage writes (against the free 100,000 a day) and message sizes. `ACT=0` in front: nobody playing. Run it after changing what gets saved or sent. `bots.mjs` makes people who then go away, for checks that need a busy world (`crowd`).

- Lint: `python3 tools/tests/lint.py` (the content, then the server and each of the game's files as modules, and that the game's imports only go upwards in game/main.js).
- Pictures: `python3 tools/tests/pictures.py` redraws the app icon and the picture a shared link shows (test/icons/) from the game itself. Not a check: run it when the look of the world, the people or the name changes, then look at the files. It also needs Pillow and numpy.
