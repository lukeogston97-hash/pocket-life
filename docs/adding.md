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
- **A new item shape**: add it to SHAPES in game/items.js, then items can use it by name.

## Settings and numbers
- **A setting the admin can change live** (Admin > Settings): add it to `liveSettings` in game-data.json (id, name, group, unit, min, max, step), then wire the id up in two places: RULES in server/src/live.js and LIVE_SET plus LIVE_BASE in game/admin.js.

## Code (when data isn't enough)
- **A new action a player does**: a handler in server/src/actions.js (and a LIMITS entry in shared.js), a task in game/moving.js, a tap menu entry in game/input.js (menuActions).
- **A new admin tool**: a case in server/src/admin.js (every admin message starts with `a.`), and a button in game/admin.js (a tab) or a tap menu entry under Admin (adminThingActions, adminPlacedActions, adminGroundActions, adminPersonActions).
- **A new kind of world thing** (ore vein, animal): needs code for drawing, tapping and its server state, like trees and rocks. Keep the world layout the same: give it its own random seed. For the admin, add it to MOVABLE in server/src/admin.js and movedThing in game/world-build.js.
- **A new part of the game code**: a new file in test/game/ and its name in PARTS in test/index.html.

## Every update
- Bump `build` in test/game-data.json (and `version` for a new version), add a devlog entry if Luke wants one, run `python3 tools/tests/lint.py` and the check for the area you touched, push to main and Luke tries the test link.
- Add the decision to the right file in docs/design/.
- Release only when Luke says: `sh tools/release.sh`, commit, push.
