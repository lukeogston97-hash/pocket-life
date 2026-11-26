#!/bin/sh
# Release the tested version: copies test/ to the main link and tells the world to move release-link games onto it.
# Run from the repo root: sh tools/release.sh   (then commit and push)
# Every release is its own commit ("Release x.y.z"), so git keeps every version. To roll back a release, revert that
# commit and push: the game files and the server's version setting (server/worlds.json) go back together.
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('test/game-data.json'))['version'])")
FILES="index.html style.css game-data.json manifest.webmanifest privacy.html"
for f in $FILES; do cp "test/$f" "$f"; done
# the game's code, one file per topic, its icons and the picture a shared link shows, and three.js (vendor/)
for d in game icons vendor; do
  rm -rf "$d"
  if [ -d "test/$d" ]; then cp -r "test/$d" "$d"; fi
done
python3 tools/worlds.py release
echo "Released $VERSION: https://pocketlife.pages.dev/"
