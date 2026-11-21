# Edits server/worlds.json (pushed to main, Cloudflare puts it live in about a minute).
#   python3 tools/worlds.py test-build              older test games move to the current test build
#   python3 tools/worlds.py release                 live: newest version, maintenance off
#   python3 tools/worlds.py maintenance live on "Back in 10 minutes"
#   python3 tools/worlds.py maintenance live off
import json, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
path = os.path.join(root, 'server', 'worlds.json')
w = json.load(open(path))
data = json.load(open(os.path.join(root, 'test', 'game-data.json')))
cmd = sys.argv[1] if len(sys.argv) > 1 else ''
if cmd == 'test-build':
    w['test']['minVersion'] = f"{data['version']}.{data.get('build', 0)}"
elif cmd == 'release':
    w['live'].update(minVersion=data['version'], maintenance=False, message='')
elif cmd == 'maintenance' and len(sys.argv) >= 4:
    world, on = sys.argv[2], sys.argv[3] == 'on'
    w[world].update(maintenance=on, message=(sys.argv[4] if on and len(sys.argv) > 4 else ''))
else:
    sys.exit(__doc__ or 'see the top of tools/worlds.py')
json.dump(w, open(path, 'w'), indent=2); open(path, 'a').write('\n')
print(json.dumps({k: v for k, v in w.items() if k != 'help'}))
