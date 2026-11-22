#!/bin/sh
# Release the tested version: copies test/ to the main link, keeps a copy in releases/<version>/,
# and tells the world to move release-link games onto it.
# Run from the repo root: sh tools/release.sh   (then commit and push)
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('test/game-data.json'))['version'])")
FILES="index.html style.css game-data.json"
mkdir -p "releases/$VERSION"
for f in $FILES; do cp "test/$f" "$f"; cp "test/$f" "releases/$VERSION/$f"; done
# the game's code, one file per topic (index.html lists them)
rm -rf game "releases/$VERSION/game"
cp -r test/game game
cp -r test/game "releases/$VERSION/game"
rm -f game.js "releases/$VERSION/game.js" # from before the code was split up (0.1.7)
python3 tools/worlds.py release
echo "Released $VERSION (copy kept in releases/$VERSION): https://pocketlife.pages.dev/"
