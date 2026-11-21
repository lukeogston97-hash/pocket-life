# Pocket Life (working name)

Luke's mobile "life in your pocket" game: SEED meets One Hour One Life. Built step by step with Claude.

## Design decisions (keep to these)
- Soft low-poly 3D like SEED, minimal UI like One Hour One Life. Luke is very particular about the look: don't restyle without asking.
- One person per player. When you die you start as a new person in the same world.
- Real-time 24-hour clock and real dates (the world runs on the player's real local time, day and night follow it).
- Age is chosen when making a person (18 to 90). Male or female, male is the default with short hair.
- Players are 13+. Deaths: hunger, thirst, tiredness, old age, animals, accidents. No PvP.
- Home storage can't be taken, but if a player is gone too long and upkeep lapses, it goes out to the world.
- Start-from-nothing world. Every item has a weight (stick 1, stone 1). Carry capacity 30.
- Berries are picked one at a time from gooseberry bushes into your inventory, and eaten from there one at a time (2 hunger each). A full bush holds 5, and picked berries grow back one by one (a bare bush is full again after regrowHours, 4). One drink at the pond gives 10 thirst. These are playtest amounts; proper eating, drinking and resting tasks come later.
- Your person walks round rocks, bushes, logs, stumps and tree trunks.
- Controls (same on phone and computer): tap or left-click the ground to walk. Tap or click a stick, stone, berry bush or the pond to open a small menu (Pick up Stick, Harvest Berries, Drink, Walk here); right-click or holding a finger down opens it too. Walking doesn't cancel the task queue. Escape, or the Menu button at the top right, opens the pause menu (Resume, Inventory, New person). On a computer, W A S D move the camera, Q and E turn it round your person, and R and F tilt it.
- Later: shared persistent world (needs a server and database), day planner, skills, more stats, regions and time zones, app store wrapper.

## How the code is laid out
- index.html: the whole game (the root copy is the release, test/index.html is the copy being tested) (three.js r170 from jsDelivr through an import map). No build step.
- game-data.json: all content. Items, recipes, needs (stats), things to use (sources), day and night colours, character looks, body shapes, settings. It has a "help" section explaining each part.
- Adding content should almost always be a small edit to game-data.json, not code.
- The world is settings.worldSize metres square (100 for now), with thick forest past the edge. The clearing round the start is laid out from its own random numbers and the rest of the world from a second set, so changing the world never reshuffles the clearing.
- Keep it light for phones. Lots of copies of a shape are drawn as one InstancedMesh, split into chunks of the map. Grass, flowers and pebbles are only drawn near the camera. Far-off trees use simpler shapes.
- The game saves on the phone (localStorage) every few seconds and when the page is hidden: your person, inventory, needs, where things lie and how far each berry bush has grown back. The test link and the release keep separate saves. Saves are plain data (SAVE_FORMAT in index.html; bump it if the save's shape changes), ready to move to a server when the world goes online.
- If the frame rate drops below about 45, the game lowers its sharpness a step (pixel ratio), never below 1.

## Working on it
- Build in small steps. After each change, tell Luke in a few short lines what changed and what to try on his phone.
- Bump the version with every update (0.0.5, then 0.0.6 and so on), in game-data.json and CODE_VERSION in index.html. The page shows it in the title and on the Make your person screen.
- To test needs quickly, raise settings.needsSpeed (60 makes an hour pass in a minute). Put it back to 1 before pushing.
- game-data.json is loaded with fetch, so opening index.html straight from the disk won't work. Test with a local server (python3 -m http.server) or the test link.
- Test first, then release. Make every change in the test/ folder (test/index.html and test/game-data.json), push it to main, and tell Luke to try it on the test link: https://lukeogston97-hash.github.io/pocket-life/test/ (the page shows "(test)" by the version).
- Only when Luke says to release it, copy test/index.html and test/game-data.json over index.html and game-data.json in the root, and push. That updates the release link: https://lukeogston97-hash.github.io/pocket-life/
- Push to main, not only to a separate branch, or neither link updates. GitHub Pages updates about a minute or two after each push.
- When you bump the version, change it in both places: "version" in game-data.json and CODE_VERSION near the top of the script in index.html. Each new test copy of the same version also counts "build" (game-data.json) and CODE_BUILD (index.html) up by one; the test page shows it, like "v0.0.5 (test 2)". If a phone has kept an older copy of the page, the page sees the mismatch and reloads itself.
- No em-dashes in anything Luke reads.
