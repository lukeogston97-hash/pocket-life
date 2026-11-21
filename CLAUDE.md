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
- Berries are picked from gooseberry bushes into your inventory and eaten from there, one at a time. A picked bush grows its berries back over regrowHours.
- Controls: tap or left-click to walk, or to pick up or use what you tapped. Walking doesn't cancel the task queue. Right-click (or hold a finger down on a phone) opens a small action menu. Escape opens the pause menu. On a computer, W A S D move the camera, Q and E turn it round your person, and R and F tilt it.
- Later: shared persistent world (needs a server and database), day planner, skills, more stats, regions and time zones, app store wrapper.

## How the code is laid out
- index.html: the whole game (three.js r170 from jsDelivr through an import map). No build step.
- game-data.json: all content. Items, recipes, needs (stats), things to use (sources), day and night colours, character looks, body shapes, settings. It has a "help" section explaining each part.
- Adding content should almost always be a small edit to game-data.json, not code.
- The world is settings.worldSize metres square (100 for now), with thick forest past the edge. The clearing round the start is laid out from its own random numbers and the rest of the world from a second set, so changing the world never reshuffles the clearing.
- Keep it light for phones. Lots of copies of a shape are drawn as one InstancedMesh, split into chunks of the map. Grass, flowers and pebbles are only drawn near the camera. Far-off trees use simpler shapes.
- Nothing saves yet, so a reload starts a fresh life. The world and the player are kept as plain data (world.items and you), ready to be saved or sent to a server later.

## Working on it
- Build in small steps. After each change, tell Luke in a few short lines what changed and what to try on his phone.
- Bump "version" in game-data.json with every update (0.0.4, then 0.0.5 and so on). The page shows it in the title and on the Make your person screen.
- To test needs quickly, raise settings.needsSpeed (60 makes an hour pass in a minute). Put it back to 1 before pushing.
- game-data.json is loaded with fetch, so opening index.html straight from the disk won't work. Test with a local server (python3 -m http.server) or the test link.
- Hosting: GitHub Pages serves the main branch at https://lukeogston97-hash.github.io/pocket-life/ (the test link). Each push to main updates it within a minute or two.
- When a change is ready, push it to main, not only to a separate branch, so the test link updates. Luke tests on the live link, usually on his phone.
- No em-dashes in anything Luke reads.
