# Storage: the small wooden crate, and planks

Decided with Luke 27 Nov 2026, built as 0.2.2 test 1.

## How we got here
- Luke wanted camp storage next, before food going off. He liked a woven basket (5 squares) and a crate (10), but felt the basket's recipe needed a bit more than 2 sticks + 2 twine and that a crate should use planks, so the basket waits. Squares and stacks for the inventory came first (0.2.1, inventory-and-menus.md), as one rule for the inventory and storage.
- Then (27 Nov 2026) Luke picked a Small wooden crate: 4 planks + 4 sticks + 2 twine, 5 squares.

## What players do
- Planks (Luke: the craft mat is best for now; a workbench may come later, then the recipe just gets "near": "workbench"): 1 log + a stone axe on the craft mat makes 2 planks. The axe is kept and doesn't wear (like the sharp stone for berry seeds). A plank weighs 2 (a log is 5). Recipes lists it as Planks, under Materials.
- Small wooden crate: 4 planks + 4 sticks + 2 twine (Luke's recipe). Weight 14 (its parts, like the campfire). The look is the crate Luke saw on 27 Nov, made smaller: two planks high all round, a stick in each corner tied with twine, a lid of two planks with two cross pieces and a tie on the front. About knee high, on one square of the placing grid (1 m, since 0.2.2's 1 m grid).
- It only goes in your own camp (inCamp, like a farm field): "Small wooden crates only go in your camp". Placed and built like a campfire (6 seconds).
- Open crate (its tap menu, with how full it is: "Empty", "2 of 5 squares") walks over and its 5 squares show at the top of the Inventory tab, above the tool bar, under its name and "2 of 5 squares". The inventory opens taller while it's there (80% of the screen).
- Moving things (Luke's pick: tap, then Put in or Take, like Drop 1 / Drop all):
  - Tap a square in your inventory (or a tool on the tool bar): the green button is Put in all (Put in when there's one, Put in 3 when only 3 fit), with Put in 1, Drop 1 and Drop all under it. Eat, Equip and Place step aside while the crate is open.
  - Tap a square in the crate: Take all (or Take 4 when you can only carry 4) and Take 1. Taking out stops at what you can carry (weight and squares). A tool comes out onto the tool bar if there's room, like one picked up, and keeps its wear both ways.
  - Dragging works too: a square onto the crate's squares goes in, a crate's square onto your inventory comes out. While the crate is open, the inventory stays on screen while you drag.
  - Dragging something onto a crate in the world says "Open the crate to put things in" (a put-in task that walks over could come later).
- The same squares and stacks as the inventory: up to 10 of a thing in a square (or its own stack), tools and things you place 1 each. A half-full square of a kind tops up first. Full: "The crate is full". A crate can't go in a crate ("Small wooden crates can't go in a crate").
- Its squares go when you close the inventory, switch to Recipes, walk more than about 3 m away, or the crate is gone.
- Who can open it (Luke's picks): only your camp while it lasts (others see "<camp> · Only its members can use things here", and nothing about what's in it: its title is just its name); once the camp ends (the fire goes out), anyone can.
- Pack up and Take apart are greyed out with "Empty it first" until it's empty (the server says the same). Then only who built it, as before.
- Inspect: "Holds 7 sticks and 3 berries" or "Empty". Its tap menu title: "Small wooden crate · 2 of 5 squares".
- While you're away: nothing. Open isn't carried on (there's nothing to do without you), and your person doesn't use the crate.
- No grass grows through placed things any more (it poked out of the crate's lid; before, only farm fields hid it).

## How it's built
- Data: placeables.small-crate has inCamp and storage: { squares: 5 } (any placeable can hold things that way); items plank and small-crate (parts looks); recipes plank (keeps the stone axe) and small-crate. tools/worlds.py gives the server inCamp and storage for every placeable, and item plurals.
- Shared rule (rules.js): storeRoom(store, kind, items, size, squares), how many more of a kind fit.
- Server: a placed thing keeps th.store { kind: n } and th.wear { kind: [uses left] } for its tools (placed.js: storageOf, storedCount, storeWear, storable, storeNoun, storeNo, spillStore). placedView sends store and wear while it holds something. Actions putIn and takeOut (actions.js; spam limits 5 a second) check it's built, you're within reach, and it isn't someone else's camp; place checks inCamp for every placeable now. whyNotTakeDown says "Empty it first".
- Game: placeables.js (PLACEABLES store and noun, the Open task, its tap menu, the title and Inspect words, storeCheck once a second), inventory.js (the crate's squares at the top of the Inventory tab, the info bar's Put in and Take, dragging in and out; straight away, and the server's answer has the last word).
- Admin: a crate's tap menu has Empty it (what's in it goes on the ground round it, tools keeping their wear; it says what's in it, and it's in the Log as Empty storage). Remove puts what's in it on the ground too. The World tab counts "Small wooden crates 2 (1 with things in)".
- Checks: tools/tests/storage.mjs (quick, server only) and `storage` (browser).

## Later (not decided)
- The woven basket (needs a recipe with a bit more to it), a bigger wooden crate (10 squares), a workbench for planks.
- A put-in task (drag onto a crate in the world, or carry on while away), your person using the crate while you're away, food going off with a drying rack, trading between camps.
