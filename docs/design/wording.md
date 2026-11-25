# Wording: the words players see

- Decided 24 Nov 2026 (0.1.6). Luke felt the wording across the game had "gone haywire": the same things had different names in different places, a few lines said the opposite of what happened, and some read robotic. He picked camp as the one word, kept Hunger and Thirst, and had it all fixed in one test build.
- Players are 13+ and mostly on a phone: friendly, clear, full words, like the game talking to them. The short notes style in CLAUDE.md ("Writing for Luke") is for messages to Luke, not for the game.

## The words for things
- Camp: a claim and its society are one thing (0.1.5), and players only ever see "camp": "Your camp", "<name>'s camp" (the starting name), Menu > Camp, Invite to camp, End camp, "Light it to start your camp here". The code, the server's internals and the admin still say claim and society.
- Hunger and Thirst: the rings' names (a full ring means fed). What fills them says what you got, not the ring: "+10 food", "+15 water" (gainLabel in stats). Low: Hungry, Thirsty. Full: Not hungry, Not thirsty.
- Raw fish and cooked fish: food that has to be cooked first says raw in its name.
- Task list: what your person will do next ("Your task list is full"), never queue.
- Inventory, person ("your person"), left the world (gone after too long away).
- Away words, the same on name tags and in the Camp panel: away (player away), away, asleep (player away, person asleep), asleep (playing, person asleep), not in the world.

## How to write it
- Item names start with a capital only at the start of a line or a title ("Stone knife" on a tile). Anywhere else they're lower case: "Pick up stick", "Drop 2 sticks", "Made stone knife", "+1 stick".
- The tap menu and the task list use the same words for the same task: "Pack up", "Take apart", "Sit by the fire", "Chop into sticks", "Add 1 stick". The tag over your person while doing it uses the task list's words ("Chopping a tree…").
- Times in labels and notes are short: "10 s", "40 min", "5 h", "7 h 30 min", "2 d 5 h". In a full sentence use words: "You were away for 5 hours".
- Needs as numbers: "Rest 12", or "Rest 12 of 25" when it has to reach a number. No %.
- Say what happened and what to do next, in a few friendly words: "Fire lit, but it's too close to the pond to start your camp", "Only Luke can put it out", "You'll join automatically". No clipped bits like "Lit." or "Just a fire:".
- Never say something the screen contradicts (the Menu isn't "Paused": the world keeps going).
- Full sentences end with a full stop; button labels, notes and toasts don't. What's new lines: no full stop, 90 letters at most (working.md).
- No em-dashes. Australian spelling (colour, metres).

## Where the text is
- Content (item names and about lines, need labels, recipes, What's new) is in test/game-data.json.
- The rest is in test/index.html, test/game/*.js and the server's notes to players (server/src/claims.js, societies.js, actions.js, and a few in admin.js). Check both sides when changing a word.
- Privacy and rules (0.1.10) is in test/privacy.html, and only there: the game's Settings > Privacy and rules shows the same words. Keep it to headings, paragraphs and lists. Change its "Last updated" date when the words change. It has to stay true: when the game starts keeping something new (sign-in, say), the page changes in the same update.
