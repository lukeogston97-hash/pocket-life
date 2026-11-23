# Pocket Life

Luke's mobile "life in your pocket" game (SEED meets One Hour One Life): a persistent online world you check in on every couple of days. Built step by step with Claude.

**How to add things: docs/adding.md.** Every decision so far is in docs/design/, one file per area (docs/design.md lists them). Read only the file for the area you're changing.

## Rules that always apply
- Look: soft low-poly 3D like SEED, dark glass UI, icons only, as little on screen as possible. Luke is very particular about the look: don't restyle without asking.
- One world for everyone (Oceania, Darwin time). One person per player; die and you start again in the same world. No PvP. Players 13+.
- Content goes in game-data.json, not code, wherever possible (items, recipes, needs, plants, sources, regions; its "help" section explains each). New items must show up by themselves in Inventory, Craft and the admin Add list; keep that true for placeables later.
- The world layout must never move (shared items, trees and bushes would stop lining up). New layout things get their own random seed.
- Stay inside Cloudflare's free plan: few messages (walks are sent once), few storage writes (save on actions, else every 5 min). Admin panel shows today's use.
- Writing for Luke: short, plain words, bullet lists with "- ", no em-dashes. Ask questions with tappable options, one at a time when he asks for that.

## Where things are
- test/ is the next version: index.html (page and loader), style.css, game/*.js (the code, one file per topic, joined in order by PARTS in index.html; one shared scope, so later parts can use earlier ones), game-data.json. The root and releases/<version>/ are released copies. No build step.
- game/ parts: rules (the rules the game and the server share; test-build copies it to server/src/rules.js), core, land, nature, plants, world-build, items, people, world-items, you, needs, inventory, camera, moving (walking, pathfinding, task queue, autopilot), placeables (campfires and other placed things, stations, Pack up and Take apart), input (taps, tap menus, pause), screens (make your person, death, main menu, world picker), loop, online (server messages), admin, others (other people, chat), start.
- server/ (Cloudflare Worker pocket-life, one Durable Object "live"): src/index.js (storage, sockets, hello, message pipeline, tick), actions.js (one handler per player message: { when: any|alive|world, run }), persons.js, away.js, nature.js, line.js, placed.js (placed things like campfires), admin.js, live.js (live settings), claims.js (campfire claims), guard.js (reach, movement and flood checks), rules.js (a generated copy of test/game/rules.js: never edit it), shared.js (rules from game.json, LIMITS, helpers), needs.js. game.json and words.json are generated from test/game-data.json by `python3 tools/worlds.py test-build`.
- A new action = handler in server/src/actions.js (+ a LIMITS entry; check reach with guard.js and claims with claims.js), a task in game/moving.js (send it with sendAct), a tap menu entry in game/input.js (thingActions).
- tools/tests: checks that run the real server locally and play the game in Chrome (see its README). tools/release.sh releases.

## How to work
- Small updates, a couple of things at a time. Bump version/build in test/game-data.json and add a devlog entry (shown in What's new).
- Checks, kept quick (Luke, 22 Nov 2026: they were taking too long): `python3 tools/tests/lint.py` always. Test builds: only the check for the area you touched (plus `layout` if world layout code changed). Releases (Luke, 22 Nov 2026: too slow, publish straight away): no extra checks if each test build was already checked; just release. Everything (`run.py`, which skips `screens`) only after big changes. `screens` (6 minutes of screenshots) only when reviewing the look. Add a check when you add a feature. Only one check run at a time.
- Test first: push to main, Luke tries https://pocketlife.pages.dev/test/ (never give that link to players). After each change tell Luke in a few short lines what changed and what to try.
- Release only when Luke says ("release", "publish"): `sh tools/release.sh`, commit, push. Cloudflare Pages (project pocketlife) and the server both deploy from main within a minute or two.
- Run `python3 tools/worlds.py test-build` after changing test/game/rules.js, or game-data.json needs, items, recipes, sources, plants, placeables, away, claims, chatFilter or settings the server uses. lint.py says if you forgot, and checks game-data.json for mistakes.
- Admin is all in the game on Luke's phone (/admin + code in the Say box; the code is a Cloudflare secret, never in the repo). Never handle Luke's passwords or keys.
- When a decision is made, add it to its file in docs/design/ (and here only if it's a rule that always applies).
