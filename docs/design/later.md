# Planned and not built yet, and what's still open

Only what isn't built. Once something is built, its notes move to the file for its area. The full earlier version of this file (the Google sign-in plan in detail, both audits item by item): docs/history/later.md.

## Coming later (Luke's ideas, in no set order)
- Buildings: use the placeables system (placeables.md).
- Small placeables like stools (Luke, 27 Nov 2026: "I do want to add stool, ect later, maybe a snap to grid button?"). Suggested: each placeable can have its own grid in the data, so a stool snaps to half-metre spots inside the 1 m squares and still lines up, with no extra button; a Snap on/off button on the place bar could come later for decorations. Not decided: settle it with the first small placeable.
- Storage and shelter. The small wooden crate (0.2.2, storage.md) and the basic shelter (0.2.5, shelter.md) are built. Still to come: the woven basket, a bigger crate, bigger shelters, and trading between camps.
- Keeping food, as one update with storage: food going off (raw about a day, cooked about 3 days, dried a couple of weeks) and a drying rack.
- Farming next steps (farming.md, Later): watering, more crops. The balance check (27 Nov 2026) found farming the most generous thing in the game: one berry grows a bush that gives 30 berries a day for good (food for about 3 people), and a camp has room for 100+ fields. Fine until berries are worth something (trading, cooking); then watering, or planted bushes that run out and need replanting.
- From the balance check (27 Nov 2026), to keep an eye on: the pickaxe has hardly any job until ores; bigger buildings than the basic shelter (50 of the 60 carry) should be built on the spot from materials you bring, not made and carried; and once everything is made (about 10 minutes from scratch), a day's upkeep is about a minute, so more things to make is what will bring people back.
- Stone: better pickaxes, ore, quarries; maybe slow the loose-stone top-up once mining is the main source.
- The wild (wild.md, Later): other fruit and nut trees, autopilot picking apples. Sizes to look at (Luke asked, 28 Nov 2026): with the world 100 m square and a camp 10 m round its fire, about 25 camps fill the land you can walk on (18 would take about 60% of it), so the wild shrinks as camps grow.
- A bigger world (Luke, 23 Nov 2026, eventually): 1 km square. Needs the game to draw only what's near you (its own update). The current 100 m stays exactly as it is; new land gets its own random seed. Claims maybe about 50 m then.
- More worlds: Europe and Americas, each its own world on its own time (the main menu already shows them as coming soon; basics.md). The worlds stay run by the admin (no player-run worlds).
- Also mentioned: a day planner, skills, more stats, an app store wrapper. The day planner is the schedule: its Schedule tab is in the task list (0.2.7) and says Coming soon (away.md).
- Sound: not yet (Luke, 25 Nov 2026: "just don't do sound yet").
- Google sign-in, optional, so a person works on any device without a link code (link codes are built: online.md). Luke found Google's setup too much for now. If it comes back: Luke makes the web client ID himself (never the secret; Claude never handles his passwords or keys), Google refuses sign-in inside most apps' built-in browsers, and the server's whoFor is where it plugs in. The full plan: docs/history/later.md.
- Not built in admin mode: switching worlds, a panel for the selected thing, a map, camera modes (admin.md).

## Known limits
- A ban is by the device's id (a random id the browser keeps); clearing the site's data makes a new one.
- At the player limit (20 playing all day, 300 away) the server uses about 81,000 of the free 100,000 storage writes a day (code.md, Cloudflare's free plan).

## Only Luke can do or decide
- Room for a crowd: the free plan allows 20 playing at once. Switching Cloudflare to Workers Paid (about USD 5 a month) takes the daily limits away; then raise Player limit in Admin > Settings.
- Sticks, stones and tall grass for a crowd: 60 of each now (stones were 45, tall grass 40, until 0.1.13). A knife, a stone axe and a campfire take about 8 stones, 4 sticks and 4 twine, so about 7 players get going at the start, then 1 or 2 more an hour from the top-up. Ideas: bigger amounts, a faster top-up, the amounts as live settings, grass that grows back sooner.
- Privacy and rules: read it; give a name for who runs the game and an email address if he wants them on it (Feedback is the only way in for now).
- The address pocketlife.pages.dev reads like a test address (a .com of its own is about USD 10 to 15 a year).
- The GitHub repo is public, so anyone can read the code and the test link.
- The tagline: "A real-time life in your pocket" for now.
