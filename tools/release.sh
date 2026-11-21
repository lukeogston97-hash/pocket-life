#!/bin/sh
# Release the tested version: copies test/ to the main link, keeps a copy in releases/<version>/,
# and tells the world to move release-link games onto it.
# Run from the repo root: sh tools/release.sh   (then commit and push)
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('test/game-data.json'))['version'])")
FILES="index.html style.css game.js game-data.json"
mkdir -p "releases/$VERSION"
for f in $FILES; do cp "test/$f" "$f"; cp "test/$f" "releases/$VERSION/$f"; done
python3 tools/worlds.py release
echo "Released $VERSION (copy kept in releases/$VERSION)"
