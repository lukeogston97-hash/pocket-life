# Pocket Life

A "life in your pocket" mobile game. Make your own person, then live a real-time life in a soft low-poly world that starts from nothing. Early prototype.

**Play:** https://pocketlife.pages.dev/

**Try the next version (test):** https://pocketlife.pages.dev/test/

(The old GitHub Pages address still works and sends you to the new one.)

## What's here
- `test/`: the next version (index.html, style.css, game/*.js, game-data.json). The root and `releases/<version>/` hold released copies.
- `game/*.js`: the game's code, one file per topic (three.js, no build step; index.html joins them)
- `game-data.json`: all the content (items, recipes, needs, plants, looks, settings), with a help section inside the file
- `server/`: the online world (a Cloudflare Worker with one Durable Object)
- `tools/`: release and world scripts; `tools/tests/` the checks (see its README)
- `CLAUDE.md`: the design decisions and rules Claude Code follows when building it

## Updating the game
Open this repo in Claude Code (web, phone or computer) and ask for a change. Changes go into `test/` first; once they've been tried on the test link, they're copied to the release.
