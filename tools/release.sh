#!/bin/sh
# Release the tested version: copies test/ to the main link, keeps a copy in releases/<version>/,
# and tells the world to move release-link games onto it.
# Run from the repo root: sh tools/release.sh   (then commit and push)
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('test/game-data.json'))['version'])")
FILES="index.html style.css game-data.json manifest.webmanifest privacy.html"
mkdir -p "releases/$VERSION"
for f in $FILES; do cp "test/$f" "$f"; cp "test/$f" "releases/$VERSION/$f"; done
# the game's code, one file per topic (index.html lists them), and its icons and the picture a shared link shows
for d in game icons; do
  rm -rf "$d" "releases/$VERSION/$d"
  cp -r "test/$d" "$d"
  cp -r "test/$d" "releases/$VERSION/$d"
done
rm -f game.js "releases/$VERSION/game.js" # from before the code was split up (0.1.7)
python3 tools/worlds.py release
# keep only the newest few release copies (enough to roll back), so the project stays light. Newest by era, then
# version number, from each copy's own game-data.json (era goes up when numbers are reset lower). Commit times were
# used before, but a shallow clone hasn't got the old commits, so it once kept 0.1.6 and dropped 0.1.7 (25 Nov 2026).
python3 -c "
import json, os, shutil
def key(v):
    try: d = json.load(open('releases/' + v + '/game-data.json', encoding='utf-8'))
    except Exception: return (-1, ())
    return (d.get('era') or 0, tuple(int(x) for x in str(d.get('version', '0')).split('.') if x.isdigit()))
vs = sorted((d for d in os.listdir('releases') if os.path.isdir('releases/' + d)), key=key)
for v in vs[:-3]: shutil.rmtree('releases/' + v)
"
echo "Released $VERSION (copy kept in releases/$VERSION): https://pocketlife.pages.dev/"
