# Adding things to Pocket Life

The short way to add each kind of thing. Most are one edit to test/game-data.json (its "help" section explains every field). After any game-data.json change the server uses (items, recipes, needs, sources, plants, placeables, away, chatFilter, liveSettings), run `python3 tools/worlds.py test-build`.

## Content (game-data.json only)
- **Item**: copy an entry in `items`, give it a new id (lower case, no spaces), name, plural, weight (whole number), look and a short "about". It shows up by itself in the Inventory, Craft, the admin Add item picker and Give items, grouped as Tools (has tool.uses), Food (has eat), Building (has places) or Materials.
- **Food**: an item with `eat` (like `{ "hunger": 10 }`). Something that must be cooked first: no `eat` on the raw item, and a recipe with `"near": "campfire"` that makes the cooked one.
- **Tool**: an item with `tool.uses`. To make a source or plant need it, set `tool` there.
- **Recipe**: add to `recipes` (`id`, `needs`, `makes`, optional `group`, optional `near` for a station like the campfire). It appears in Craft once a player has had all but one of its things.
- **Something that lies about and respawns** (like sticks and stones): give the item `startInWorld` (how many) and `spawnsNear` (`trees` or `boulders`). It starts turning up by itself, no world reset needed.
- **Cuttable plant** (like tall grass): an entry in `plants`, with its own `seed` so nothing else in the world moves.
- **Placeable** (like the campfire): an entry in `placeables`, plus an item with `"places": "<id>"`. Fires, seats, Pack up, Take apart and the admin's Move, Remove and Fill with fuel all come with it. Its look needs a shape in game/placeables.js (makePlacedView).
- **A new item shape**: add it to SHAPES in game/items.js, then items can use it by name. If lots of them will lie on the ground, build its geometry with sharedGeo (as sticks, stones and logs do) so they're drawn together and stay cheap on phones.

- **Before pushing**: `python3 tools/tests/lint.py` checks game-data.json for mistakes first (an item name that doesn't exist, a shape that isn't there, a weight that isn't a whole number...) and says what's wrong in plain words.

## Settings and numbers
- **A setting the admin can change live** (Admin > Settings): add it to `liveSettings` in game-data.json (id, name, group, unit, min, max, step), then wire the id up in two places: RULES in server/src/live.js and LIVE_SET plus LIVE_BASE in game/admin.js.

## Code (when data isn't enough)
- **A rule both the game and the server work out** (how needs move, how a fire burns, what fits where): it goes in test/game/rules.js, once. test-build copies it to the server. Never write the same maths in both places.
- **A new action a player does**: a handler in server/src/actions.js (and a LIMITS entry in shared.js), a task in game/moving.js, a tap menu entry in game/input.js (thingActions). The game sends it with sendAct (online.js), so it survives a short break in the connection. On the server, check the person is near what they're acting on (this.near, this.spotOf in guard.js) and that it isn't in someone else's claim (this.notYours in claims.js).
- **A new admin tool**: a case in server/src/admin.js (every admin message starts with `a.`), and a button in game/admin.js (a tab) or a tap menu entry under Admin (adminThingActions, adminPlacedActions, adminGroundActions, adminPersonActions).
- **A new kind of world thing** (ore vein, animal): needs code for drawing, tapping and its server state, like trees and rocks. Keep the world layout the same: give it its own random seed. For the admin, add it to MOVABLE in server/src/admin.js and movedThing in game/world-build.js. So the server can check players are near it, add its spots to layoutData (game/online.js) and cleanLayout and LISTS (server/src/guard.js). More water (ponds, streams): teach nearWater in guard.js about it.
- **A new part of the game code**: a new file in test/game/ and its name in PARTS in test/index.html.
- **Saving** (each write counts against Cloudflare's free 100,000 a day): when a person changes in a way that lasts (what they carry, eating, drinking, feeding a fire), `this.touch(p)`. For someone away who only walked on or whose needs ticked over, `this.touchLater(p)` (saved about once an hour, since the server can play them forward again). The world: `this.save()` only when something in it changed. After changing what gets saved, run `python3 tools/tests/load.py 300`.
- **Errors**: no need to wrap new code in try/catch. The server's tick and each message, and the game's frame, already catch a problem, carry on and put a note in the admin's Inbox (Server error / Game error). Fix what shows up there.

## Every update
- Bump `build` in test/game-data.json (and `version` for a new version), add a devlog entry if Luke wants one, run `python3 tools/tests/lint.py` and the check for the area you touched, push to main and Luke tries the test link.
- Add the decision to the right file in docs/design/.
- Release only when Luke says: `sh tools/release.sh`, commit, push.
