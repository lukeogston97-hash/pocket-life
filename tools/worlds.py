# Edits server/worlds.json (pushed to main, Cloudflare puts it live in about a minute).
#   python3 tools/worlds.py test-build              older test games move to the current test build
#   python3 tools/worlds.py release                 release-link games move to the new version
# (maintenance is switched on and off by the admin player in the game)
import json, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
path = os.path.join(root, 'server', 'worlds.json')
w = json.load(open(path))
data = json.load(open(os.path.join(root, 'test', 'game-data.json')))
cmd = sys.argv[1] if len(sys.argv) > 1 else ''
if cmd == 'test-build':
    w['minVersion']['test'] = f"{data['version']}.{data.get('build', 0)}"
    # the server's copy of the chat filter
    words = os.path.join(root, 'server', 'words.json')
    json.dump(data.get('chatFilter', {}), open(words, 'w'), indent=2); open(words, 'a').write('\n')
    # the server's copy of the rules it needs to keep people alive: needs, items, sources, away
    srcs = data.get('sources', {})
    berry = next((k for s in srcs.values() for k in (s.get('harvest') or {})), 'berry')
    game = {
        'needs': data['stats'],
        'items': {k: {'weight': v.get('weight', 1), 'eat': v.get('eat'), 'uses': (v.get('tool') or {}).get('uses', 0), 'places': v.get('places')} for k, v in data['items'].items()},
        'recipes': {r['id']: {'needs': r['needs'], 'makes': r['makes']} for r in data.get('recipes', [])},
        'sources': {k: {'gives': v.get('gives'), 'harvest': v.get('harvest'), 'water': bool(v.get('water')), 'tool': v.get('tool'), 'toolHarvest': v.get('toolHarvest')} for k, v in srcs.items()},
        'plants': {k: {'gives': v.get('gives', {}), 'count': v.get('count', 40), 'regrowHours': v.get('regrowHours', 2), 'tool': v.get('tool')} for k, v in data.get('plants', {}).items()},
        'berryKind': berry,
        'carryCapacity': data['settings']['carryCapacity'],
        'maxPlaying': data['settings'].get('maxPlaying', 20),
        'respawnMinutes': data['settings'].get('respawnMinutes', 10),
        'age': {'min': data['looks']['age']['min'], 'max': data['looks']['age']['max']},
        'away': data.get('away', {}),
        'night': data.get('night'),
        'timeZone': data['settings'].get('worldTimeZone', 'Australia/Darwin'),
        'energyCosts': data.get('energyCosts', {}),
        'chopping': data.get('chopping', {}),
        # things you place and build (the campfire): which item places them, how they burn, where people sit
        'placeables': {k: {'item': next((i for i, it in data['items'].items() if it.get('places') == k), k), 'buildSeconds': v.get('buildSeconds', 10),
                           'solid': v.get('solid', 0.5), 'fire': v.get('fire'), 'seats': v.get('seats')} for k, v in data.get('placeables', {}).items()},
        'start': {'x': 0.6, 'z': 1.9},
        'pond': {'x': -5.6, 'z': -0.9},  # the main pond's middle (POND in game.js)
    }
    path2 = os.path.join(root, 'server', 'game.json')
    json.dump(game, open(path2, 'w'), indent=2); open(path2, 'a').write('\n')
elif cmd == 'release':
    w['minVersion']['release'] = f"{data['version']}.{data.get('build', 0)}"  # a patch (new build) moves everyone on too
else:
    sys.exit(__doc__ or 'see the top of tools/worlds.py')
json.dump(w, open(path, 'w'), indent=2); open(path, 'a').write('\n')
print(json.dumps({k: v for k, v in w.items() if k != 'help'}))
