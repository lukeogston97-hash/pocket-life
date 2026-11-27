# Shelter: the basic shelter, and sleeping in it

Decided with Luke 27 Nov 2026, built as 0.2.5 test 1.

## How we got here
- Luke picked shelter as the next update (the last part of "storage and shelter" on his build order, before hunting and animals).
- Look: a lean-to (Luke's pick over an A-frame hut). Before building, a picture of it was drawn by the game itself (by a campfire, the roof from behind, the recipe, someone asleep in it as a mock-up) and Luke said build it.
- Name: Basic shelter (Luke: "Just call it Basic shelter"). Lean-to was the other option.
- Recipe: Luke felt long tool handles were odd in a shelter, then wanted it to match the picture (3 logs: 2 posts and the top beam) with lots of sticks. 3 logs + 16 sticks + 4 twine weighs 35, over the 30 you can carry, so it couldn't be made. He picked 3 logs + 10 sticks + 4 twine (weighs 29) for test 1, then 8 sticks for test 2 (Luke, 27 Nov 2026: "maybe it needs to be 8 sticks?"): 3 logs + 8 sticks + 4 twine, weighs 27. Three trees give the 3 logs and 6 of the sticks, so only 2 more come off the ground, and there's room left for 3 small things.
- It stays an item you carry and place (Luke: no shelter in the inventory would mean no campfire in the inventory either).
- What it does (Luke picked all four, then "it takes a lot to build, it should be twice as better than sleeping on the floor"): sleep in it is twice as good as on the ground. Rest and Health fill twice as fast, Hunger and Thirst drop half as fast, and away people sleep in it.
- Who: your camp, one at a time (Luke's pick). Like the crate: only goes in your camp, and anyone can use it once the camp ends.

## What players do
- Make it on the craft mat (Building): 3 logs, 8 sticks, 4 twine. Weight 50, its parts (27 until the 0.2.6 weights, when carrying went to 60: it leaves 10 to spare).
- Place it in your camp (inCamp): 2 x 2 squares on the placing grid, turned 4 ways, its front (the open side) shown by a circle while placing and starting off facing you. Built in 20 seconds. It's solid on all 4 squares, so people walk round its corners.
- Its tap menu: Sleep in shelter ("Twice as good as the ground", or greyed out "Someone's asleep in it"), Pack up, Take apart, Inspect, Walk here. Someone else's camp: only its name and Walk here, as for every placed thing.
- Sleep in shelter walks to its front, then your person lies down inside it, along its width, face up. Lying down ends your task list, as Sleep does. Tap yourself for Wake up: you're back out at its front, facing out. Any task wakes you, as before.
- Tall people's feet poke out of the ends a little (people are about 2 m tall in the game and the shelter is 2 m wide). Luke can say if it should be a little wider.
- While someone's asleep in it: its title says "Basic shelter · someone's asleep in it", Inspect says the same, and Pack up and Take apart are greyed out ("Get up first" for you, "Someone's asleep in it" for others; the server says the same).
- Everyone else sees the sleeper lying inside it (others.js), whether they're playing or away.
- Away from the game: when your person goes to bed (night, once the task list is done, or tired), they walk over to your camp's shelter and sleep in it if there's room; otherwise on the ground as before. The long sleep after a day away is in it too (they walk over first), with hunger and thirst still dropping to the floor, half as fast. Sleep in shelter on your task list carries on while you're away. Coming back, you wake up out at its front.
- Autopilot (in the game, no taps for 3 minutes) goes to bed in your camp's shelter too.

## How it's built
- Data: placeables.basic-shelter has bed { sleepers: 1, better: 2, at: [0, -0.05] } (at: where the sleeper's middle lies, metres from its middle, z out the way it faces), size [2, 2], front 1.25, solid 1, inCamp, buildSeconds 20. The item's look is parts (47 pieces in 6 colours: 2 posts, the top beam, 26 roof sticks, 2 cross sticks, twine). Any placeable can be a bed the same way (adding.md).
- Shared rule (rules.js needsStep): better (asleep in a bed) multiplies what sleep fills and divides what it drains. The server's advanceStats and sleepMs take it, and so does the game's own needs tick.
- Server (placed.js): bedOf, bedFront, sleepersIn, bedFree, bedBetter, freeBedFor, outOfBed. A sleeper has p.bed = its id; their p.x, p.z stay at its front (where they got in), so nothing about movement changed. The sleep action takes m.bed (built, by its front, not someone else's camp, room in it). pub and state messages carry bed; mine carries bed. Getting up, sitting, collapsing, coming back, the admin's Wake, Move person and removing the shelter all clear p.bed. whyNotTakeDown says "Someone's asleep in it". Away: decide walks to a free bed in their camp (strollTo, then: 'bed'); advanceAway walks there for the long sleep (plan.long). tasks.js has a 'bed' task, and getting into bed ends the list, as in the game.
- Game: placeables.js (PLACEABLES bed, bedSleepers, lieInBed, outOfBed, myFreeBed, the bed task, the tap menu, solidSpotsOf for things bigger than 1 x 1), moving.js setSleeping(on, fromServer, bed) (sendAct first, from its front, then lies down; the YXZ turn order is only used while lying in a bed), others.js (o.bed, drawn lying inside), needs.js (better), online.js (the server's bed for you), others.js sendMove sends nothing while you're in a bed.
- Admin: Move waits while someone's asleep in it ("Someone's asleep in it"); Remove gets the sleeper out (they sleep on, on the ground at its front). The World tab counts "Basic shelters 2 (1 slept in)", and a player's page says "asleep in a basic shelter".

## Checks
- tools/tests/shelter.mjs (quick, server only, part of server_tests): the recipe (3 logs, 8 sticks, 4 twine) and weight (27), only in your camp, Sleep in it (reach, camps, one at a time, anyone once the camp ends), the rates against sleeping on the ground, pack up and take apart refused, the admin's Move and Remove, getting up, away people going to it when tired and for the long sleep, the task, coming back.
- shelter (browser): made on the craft mat, placed and built, its tap menu, lying inside along it, someone else seeing that and being refused, Wake up out at its front.
- smoke's Recipes check gives 20 of everything now (it was 9; the shelter took 10 sticks in test 1).

## Later (not decided)
- A bigger shelter for 2, a bed of dry grass inside, leaves on the roof, shelter from weather or animals at night, sitting in it.
