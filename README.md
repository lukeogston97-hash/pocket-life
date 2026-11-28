# Pocket Life

A 24/7 online survival world with friends in your pocket.

Make your own person in a soft low-poly world that starts from nothing. Gather, craft and set up camp with friends in one world shared by everyone. Pocket Life is in early access.

**Play:** https://pocketlife.pages.dev/

(The old GitHub Pages address still works and sends you to the new one.)

## What's here
- `content/`: all the game's content (items, recipes, placeables, the world, rules, people, words, version and What's new), one file per kind, each with a `_help` note. `python3 tools/worlds.py test-build` makes `test/game-data.json` from it.
- `test/`: the next version (index.html, style.css, game/*.js, game-data.json, vendor/three.js). The root holds the released copy (git keeps every release as its own commit).
- `test/game/*.js`: the game's code, one ES module per topic (three.js, no build step; game/main.js loads them in order)
- `server/`: the online world (a Cloudflare Worker with one Durable Object)
- `tools/`: release and data scripts; `tools/tests/` the checks (see its README)
- `docs/`: how to add things (docs/adding.md) and every decision so far (docs/design/)
- `CLAUDE.md`: the rules Claude Code follows when building it

## Updating the game
Open this repo in Claude Code (web, phone or computer) and ask for a change. Changes go into `test/` first; once they've been tried on the test link, they're copied to the release.
