# Checks

Runs the real server code on this computer and plays the test build (`test/`) in Chrome, so nothing touches the live world.

- First time: `cd tools/tests && npm install` (plus Python Playwright and Chrome; set CHROME to its path if it isn't /usr/bin/google-chrome).
- Small change: `python3 tools/tests/run.py quick` (layout + smoke, about a minute) plus the check for what you touched.
- All checks (only after big changes, about 35 minutes; skips `screens`): `python3 tools/tests/run.py`. `screens` only when reviewing the look: `python3 tools/tests/run.py screens`. One or two: `python3 tools/tests/run.py menu grass_and_tools`.
- `layout` compares the world layout with `layout-baseline.json`. It must not change, or shared items and bushes won't line up with the live world. Only after an intended layout change: `UPDATE_LAYOUT=1 python3 tools/tests/run.py layout`.
- `screens` saves screenshots of every screen (phone and computer) in `tools/tests/shots/` to look over.
- Add a check: write an async function in `checks.py` and add it to `CHECKS`.
- `server_tests` runs three quick tests of the server's own code with no browser (a few seconds): `admin_extras.mjs` (the admin's fire, claim, Log, rename and message tools), `live_items.mjs` (item and recipe numbers changed live) and `stale_admin.mjs` (an old admin flag gives a player nothing). Add to them when you add an admin tool: they're the fastest way to try every wrong input. By hand: `cd tools/tests && python3 -c "import lib; lib.bundle()" && node admin_extras.mjs`.
- This computer (Claude's) draws the 3D world in software at 1 to 2 frames a second, so a check counts frames, never milliseconds, and nothing here can judge how the game feels.
- How the server copes as the world grows: `python3 tools/tests/load.py 300` runs the real server code in memory with 300 people away and 20 playing for an hour, and prints the tick time, storage writes (against the free 100,000 a day) and message sizes. `ACT=0` in front: nobody playing. Run it after changing what gets saved or sent. `bots.mjs` makes people who then go away, for checks that need a busy world (`crowd`).

- Lint: `python3 tools/tests/lint.py` (the server, and the game with its parts joined).
