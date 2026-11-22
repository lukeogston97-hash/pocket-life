# Checks

Runs the real server code on this computer and plays the test build (`test/`) in Chrome, so nothing touches the live world.

- First time: `cd tools/tests && npm install` (plus Python Playwright and Chrome; set CHROME to its path if it isn't /usr/bin/google-chrome).
- Small change: `python3 tools/tests/run.py quick` (layout + smoke, about a minute) plus the check for what you touched.
- All checks (before a release, about 12 minutes): `python3 tools/tests/run.py`. One or two: `python3 tools/tests/run.py menu grass_and_tools`.
- `layout` compares the world layout with `layout-baseline.json`. It must not change, or shared items and bushes won't line up with the live world. Only after an intended layout change: `UPDATE_LAYOUT=1 python3 tools/tests/run.py layout`.
- `screens` saves screenshots of every screen (phone and computer) in `tools/tests/shots/` to look over.
- Add a check: write an async function in `checks.py` and add it to `CHECKS`.

- Lint: `python3 tools/tests/lint.py` (the server, and the game with its parts joined).
