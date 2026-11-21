# Edits server/worlds.json (pushed to main, Cloudflare puts it live in about a minute).
#   python3 tools/worlds.py test-build              older test games move to the current test build
#   python3 tools/worlds.py release                 live: newest version, maintenance off
#   python3 tools/worlds.py maintenance on "Back in 10 minutes"
#   python3 tools/worlds.py maintenance off
import json, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
path = os.path.join(root, 'server', 'worlds.json')
w = json.load(open(path))
data = json.load(open(os.path.join(root, 'test', 'game-data.json')))
cmd = sys.argv[1] if len(sys.argv) > 1 else ''
if cmd == 'test-build':
    w['minVersion']['test'] = f"{data['version']}.{data.get('build', 0)}"
elif cmd == 'release':
    w['minVersion']['release'] = data['version']
    w.update(maintenance=False, message='')
elif cmd == 'maintenance' and len(sys.argv) >= 3:
    on = sys.argv[2] == 'on'
    w.update(maintenance=on, message=(sys.argv[3] if on and len(sys.argv) > 3 else ''))
else:
    sys.exit(__doc__ or 'see the top of tools/worlds.py')
json.dump(w, open(path, 'w'), indent=2); open(path, 'a').write('\n')
print(json.dumps({k: v for k, v in w.items() if k != 'help'}))
