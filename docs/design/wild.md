# The wild, clearing land and apple trees (0.2.9)

Decided with Luke on 28 Nov 2026. He felt the rules for trees, rocks, berry bushes, boulders and grass were getting confusing and wanted them rethought together: players can farm and renew things, it looks good and makes sense, nobody can ruin the whole world, and things popping back in camps is annoying. His idea: clear land right down in your camp and have it grow back randomly in the world. Then: "if there are 18 camps", the game shouldn't try to keep the same amount out in the wild. He asked for it all at once, apple trees included, "working perfectly in harmony".

## The one rule: the wild always grows back, your camp is yours
- Using things works anywhere (except someone else's camp) and they grow back in the same spot: chop a tree (its stump grows back), pick berries or apples, cut grass, mine a boulder (it refills).
- Clearing things only works in your own camp, and what you clear never comes back there: Dig up stump (the stone axe, 10 s, 1 log), Dig up bush (berry bushes and plain ones: the stone hoe, 8 s, 1 stick, and a berry bush's berries fall), Clear grass (the stone hoe, 3 s, its twine if it's grown), Break up boulder (the stone pickaxe, 20 s, 6 stones). Numbers in clearing (content/world.json); energy energyCosts.clear.
- Out in the wild those show greyed out with "Only in your camp"; inside someone else's camp the menu says whose camp it is, as before. The server refuses the same (actions.js clear, chop for stumps).
- Rocks (Luke said yes to Claude's pick): loose things like sticks and stones. Break one anywhere with the pickaxe for 5 stones; one broken rock comes back somewhere rocky in the wild every rockBackHours (no longer the same spot).
- Remove stump is now Dig up stump (the tap menu and the task list).

## The wild tops itself up (server/src/nature.js topUpWild)
- The world keeps the wild as thick as it was laid out, not a fixed total (Luke's 18 camps): the wild is everywhere outside camps, so the more land camps take, the less wild there is, and nothing is squeezed into what's left.
- Something gone from the wild comes back at its own laid-out spot: a broken rock, something cleared in a camp that has since ended, or a stump dug up before 0.2.9. The admin's removals (world.removed) stay gone for good.
- One of each kind at a time: a tree every 2 hours, a bush (berry or plain) every 2 hours, grass every half hour, a boulder every 12 hours, a rock every rockBackHours (4). The wait starts when something goes and is kept with the world (world.wildAt), so a new build doesn't start it again.
- Never inside a camp, never within 15 m of anyone (awayFromPeople; playing or away, awake or asleep), never on something placed, and only while the wild has less than growsBackTo per cent of that kind (100).
- How it comes back: a tree young (drawn small, growing up in the same time a stump takes, 1 to 2 days; "Grown in 5 h" on its tap menu, too young to chop or pick), a berry bush with no berries yet, grass as stubble, rocks and boulders whole.
- When a camp ends, its land is the wild's again and slowly grows back over.
- Loose sticks and stones (respawn, the same file) never turn up inside a camp or within 8 m of anyone (LOOSE_AWAY): a few tries for a spot, else next time.
- A stump you leave in your camp still grows back (it was only used): dig it up to keep the land clear.

## Apple trees (Luke's idea)
- 24 of the world's leafy trees you can walk up to are apple trees, 3 of them near the start, at least 6 m apart (appleTrees: count, nearStart, its own seed, so the layout never moves). The server learns which from the layout (layout.apples, like boulders).
- 4 apples each, picked one at a time (Pick apples, 2 s), one growing back every 6 hours (sources.appleTree: holds 4, regrowHours 24). The server keeps world.apples { tree: [count, from] }, the same maths as berries.
- An apple (weighs 2, eaten raw, +20 food: twice a berry). Apple seeds: an apple and a sharp stone (kept) on the craft mat.
- Chop an apple tree: a log, 2 sticks and the apples still on it fall. Its stump grows back into an apple tree, and its apples grow back from then.
- The apples are one InstancedMesh (game/world-build.js), sat on the crown's lumpy surface (crownSurface) round its upper side, where they show from above. Tapping one is tapping its tree.

## Apple trees on farm fields (farming.md)
- Plant apple seeds on a farm field in your camp. It grows in 1 day (Luke): a sprout, a young tree getting bigger, then a full tree with 4 apples, the same size as a wild one.
- It needs the squares round its field empty (room 1: the 8 squares round it; Luke wasn't sure, Claude picked this so the leaves don't cover other fields and taps land on what you meant). Planting is refused next to anything placed ("It needs the squares round it empty"), and nothing can be dug or placed in those squares afterwards ("Too close to the apple tree"). Rule: roomClash in rules.js, the same in the game and on the server.
- Pick apples like a wild one; Chop tree (the axe) drops a log, 2 sticks and its apples and leaves a stump on the field (Luke: the stump grows back) that grows back in a day (tree.stumpBackHours 24, Claude's pick: so digging up and replanting is never quicker); Dig up stump (your camp, the axe) gives a log and leaves the field empty. Flatten field still loses the tree.
- A young or grown tree on a field is in the way like a wild one (its trunk), and so is its stump; a sprout isn't.

## Admin
- Settings, The wild: the wild grows a tree, a bush and tall grass back every (h), a boulder comes back every (h), a broken rock comes back every (h), the wild grows back to (%).
- Tap a young tree: Grow up now. Tap an apple tree with apples picked: Fill with apples. A farm field's Grow now grows a tree on it back too.
- Regrow everything also grows young trees up, fills every apple tree, and brings back everything gone from the wild at once (still never inside a camp or on something placed).
- World tab counts: Young trees, Apple trees (how many picked).

## Checks
- tools/tests/wild.mjs (quick, server only): clearing only in your own camp with the right tool, what falls, nothing cleared coming back while the camp is there, the wild growing back (its wait, never near anyone or on something placed, how full), loose sticks never in camps, apple trees wild and on fields, away tasks, the admin.
- wild (browser): apple trees with apples, picking and chopping one, Only in your camp, a camp with a plain bush dug up (both phones), apple seeds on a field, its squares, Grow now, picking, chopping and digging up the stump, a young tree drawn small.

## Later (not decided)
- Other fruit trees, nut trees, other woods.
- Autopilot and people away picking apples by themselves (a task list already carries on with Pick apples).
- The world's size against camps: with the world 100 m square and a camp 10 m round its fire, about 25 camps would cover the land you can walk on. The 1 km world (later.md) fixes that.
