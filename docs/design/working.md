# Working on it: versions, testing, releasing, checks

- Build in SMALL steps: Luke asked for just a couple of things per update from 0.0.7 on. After each change, tell Luke in a few short lines what changed and what to try on his phone.
- Bump the version with every update (0.0.6, then 0.0.7 and so on). It's only in game-data.json: "version", plus "build" which starts at 1 for each new version and counts up with each test copy. The page shows it, like "v0.0.6 (test 2)".
- To test needs quickly, raise settings.needsSpeed (60 makes an hour pass in a minute). Put it back to 1 before pushing.
- game-data.json is loaded with fetch, so opening index.html straight from the disk won't work. Test with a local server (python3 -m http.server) or the test link.
- Test first, then release. Make every change in the test/ folder, push it to main, and tell Luke to try it on the test link: https://pocketlife.pages.dev/test/
- Each new test build: bump "build", then run python3 tools/worlds.py test-build so older test games move to it.
- Maintenance: Luke switches it on and off himself in the game (Admin in the Menu). Release-link players see a Back soon screen, needs pause, and it rejoins by itself. The test link still gets in, so Luke can try the new build first.
- server/worlds.json holds the minVersion for each link. Older games get sent to the newest version (they wait and retry if the link hasn't updated yet).
- Only when Luke says to release it ("release", "publish"), run sh tools/release.sh (it keeps only the newest 3 copies in releases/; it also sets the release link's minVersion to version.build, so a patch moves everyone on too; Luke turns maintenance off in the game), then commit and push. It copies test/ to the root (the release link: https://pocketlife.pages.dev/) and keeps a copy in releases/<version>/ so we can roll back.
- Push to main, not only to a separate branch, or neither link updates. The game's home is Cloudflare Pages (project pocketlife, https://pocketlife.pages.dev/, set up 22 Nov 2026), which rebuilds from main about a minute after each push. The old GitHub Pages address (lukeogston97-hash.github.io/pocket-life/) still updates too, but its index.html sends people to pocketlife.pages.dev with the phone's id after # so they keep their person (0.1.7).
- Before pushing a change, run the checks, kept quick (Luke, 22 Nov 2026): lint always, then only the checks for the area you touched; releases add `run.py quick`; everything (`run.py`, which skips `screens`) only after big changes (see tools/tests/README.md; first time `cd tools/tests && npm install`). The layout check must pass: the world's layout can never move. Add a check for each new feature in tools/tests/checks.py.
- No em-dashes in anything Luke reads.
