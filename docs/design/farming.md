# Farming: the stone hoe, farm fields, seeds and crops

Decided with Luke 26 Nov 2026 (0.1.18, built in one test build: "Build it all in one thanks").

## What players do
- Stone hoe: a stone hoe head (1 stone and 1 twine), then the hoe (the head, a long stick and twine). A plain stone, not a sharp one (Luke asked; a hoe scrapes and turns soil, it doesn't cut). 30 uses. A tool like the others: it goes on the tool bar and only works from there.
- Dig farm field: on the ground's tap menu while you carry a hoe, only in your own camp (a lit claim that's yours or your camp's). Outside your camp it isn't on the menu at all (Luke, 27 Nov 2026, 0.2.6: it only shows when you tap the ground in your camp; until then it was greyed out with "Only in your camp"). In your camp with the hoe only in your inventory, it's greyed out ("Equip your stone hoe"). Choosing the spot is the same as placing a campfire (the ghost, the green or red square, Turn, Cancel) with a Dig button. Your person walks over and digs for 8 seconds (the chop swing with the hoe), and the field takes shape as they dig. It takes a use of the hoe and some stamina (energyCosts dig 8).
- A field is 1 m square (one square on the placing grid), and fields can sit side by side. It was 1.5 m until 0.2.2, when the grid went to 1 m squares and Luke picked 1 x 1 fields (27 Nov 2026). He worried smaller berry bushes would look odd, so grown bushes kept their size: the same on average, just less spread out sideways, so they sit on the 1 m bed (cropParts in game/placeables.js). It's a low bed of dug soil with lumpy rows of earth; no grass grows through it. People walk round it.
- Flatten field (tap menu, needs the hoe on the tool bar, 4 seconds): it's gone, back to grass, and whatever grew on it is lost (the tap menu says so: "The berry bush is lost"). A field can't be packed up or taken apart (the server says "Flatten it with a hoe").
- Berry seeds: 1 berry on the craft mat with a sharp stone (kept). Berries have small seeds in real life (Luke asked).
- Plant berry seeds (tap the field, 3 seconds kneeling): one packet of seeds, one crop per field. It grows by itself in about a day (growHours 24): a sprout for the first third, then a young bush that gets bigger, then a grown berry bush with 5 berries. No watering for now (Luke: maybe later).
- Pick berries: a grown planted bush is picked exactly like a wild one (one at a time, 2 with the knife on the tool bar, berries grow back one by one in 4 hours). The tap menu says "5 left" or "Next in 40 min"; while it grows, "Grown in 5 h".
- Inspect says what it is: "Dug and ready for seeds", "Berry bush sprout · grown in 18 h", "Young berry bush · grown in 6 h", "Berry bush · 3 berries".
- Camps: other people can't dig, plant, pick or flatten inside your camp (the tap menu only says whose camp it is, and the server says no). If the camp's fire goes out, its fields stay and anyone can use them, the same as a campfire.
- Away: dig, flatten, plant and harvest carry on from the task list while you're away (server/src/tasks.js).

## Test 2 (Luke 26 Nov 2026, after trying test 1)
- Walk over farm fields (Luke: "no worries"), grown berry bushes on them too. He asked for bushes and berry bushes in the wild to be walked through as well, so they are (they still take room for putting things down).
- Dig several at once (Luke picked "Tap spots, then Dig"): in Dig mode each tap on the ground adds another field (a see-through field on its square), a tap on one already chosen takes it off, Turn turns them all, and Dig digs them one after another (the button says "Dig 3"). Up to 20 at a time. Each one takes a use of the hoe.
- Planting stays one field at a time (Luke).
- The ground's Dig menu stays as it is: Dig farm field, with Walk here small under it (Luke looked at 4 options on the Dig menu page of the design canvas and kept Walk here).
- Fixed: rocks floated next to camps where the ground was levelled. Trees, rocks and bushes now move up or down with the levelled ground (docs/design/placeables.md, Flat ground).

## How it's built
- Data (game-data.json): items hoe-head, stone-hoe (tool, 30 uses) and berry-seeds; their recipes; placeables.field with madeWith (the tool that digs it, instead of an item that places it), makeSeconds, makeVerb, flattenSeconds, inCamp, size and look (shape field, soil and row colours); crops (berry-bush: seed, on, growHours, plantSeconds, like: the source whose picking rules it follows); energyCosts dig and plant.
- Server: a field is a placed thing (world.placed) that is built from the start; its crop is th.crop = { kind, at, berries } (berries as a wild bush's [count, from] once some are picked). How grown it is comes from `at` (rules.js cropGrowth and cropStage, shared with the game), so nothing ticks and nothing is saved while it grows. Actions dig, flatten, plant and harvest (server/src/actions.js), each with a LIMITS entry, the time guard (worked) and the camp check. The view sends ages, not times (crop.age, berries' age), so phone clocks don't matter.
- Game: game/placeables.js. Fields come from PLACEABLES like campfires (a placeable with madeWith has no item); CROPS from the data. fieldModel draws the bed and rows (shared shapes for every field); drawCrop shows the sprout, the young bush (scaled as it grows) or the grown bush and its berries, checked once a second. The game shows each step straight away and the server puts it right if it said no. Grass under a field is hidden (levelPlaced marks it, refillDetail skips it).
- Fixed on the way: the game's berry sources didn't know about the knife (tool and toolHarvest), so picking with a knife showed one berry until the server's answer came back. Now it shows both straight away, for wild bushes too.

## Admin
- A field's tap menu in admin mode: Move, Grow now (when something is planted: grown and full of berries), Remove. Regrow everything grows every crop too.
- Settings tab, Farming: Planted crops grow in (h), one number for every crop (cropGrowHours; live.js and LIVE_SET). Handy for trying the stages in a few minutes.
- World tab counts: "Farm fields 3 (2 planted)".

## Checks
- tools/tests/farming.mjs (quick, server only): digging in your camp only, on the grid, the hoe on the bar and its wear, no packing up, flattening, planting, growing from the planting time, picking (2 with the knife), someone else's camp, away tasks, the admin's Grow now, Regrow everything and the live grow time.
- farming (browser): the ground's Dig farm field in and out of the camp, digging, no grass through the field, planting, the sprout and young bush, Grow now, picking with the knife, the other phone seeing each step, Flatten field.

## Apple trees on fields (0.2.9)
- Apple seeds grow an apple tree on a field in a day; it needs the squares round its field empty, is picked like a wild one, chopped to a stump that grows back in a day, and its stump can be dug up (the field is empty again). The whole of it is in wild.md.

## Later (not decided)
- Watering, more crops (each a crops entry with its own seed and like), scarecrows or fences, crops that die if left, autopilot picking your own bushes.
