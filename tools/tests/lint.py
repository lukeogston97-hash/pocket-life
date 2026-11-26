"""Lint the server and the game: python3 tools/tests/lint.py   (each of the game's files is a module; this also checks they load in order).
First it checks game-data.json for mistakes and that the server's copies of the rules are up to date (tools/worlds.py check)."""
import os, re, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
c = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'worlds.py'), 'check'])
if c.returncode: sys.exit(c.returncode)
GAME = os.path.join(ROOT, 'test', 'game')
# the game's files, in the order game/main.js loads them
order = re.findall(r"^import '\./([a-z-]+)\.js';", open(os.path.join(GAME, 'main.js'), encoding='utf-8').read(), re.M)
problems = []
on_disk = {f[:-3] for f in os.listdir(GAME) if f.endswith('.js')} - {'main'}
for f in sorted(on_disk - set(order)): problems.append(f'test/game/{f}.js is not in game/main.js, so it never loads')
# each file may only import from files above it in main.js (anything from further down goes through game.name, links.js)
for i, p in enumerate(order):
    for dep in re.findall(r"^\s*(?:import|\}) .*?from '\./([a-z-]+)\.js';", open(os.path.join(GAME, f'{p}.js'), encoding='utf-8').read(), re.M):
        if dep not in order[:i]: problems.append(f'game/{p}.js imports from game/{dep}.js, which loads after it: use game.name for that instead (game/links.js)')
if problems: sys.exit('\n'.join(problems))
# ESLint only looks inside this folder, so the game's and the server's code are copied in
for name, src in (('lint-game', GAME), ('lint-server', os.path.join(ROOT, 'server', 'src'))):
    shutil.rmtree(os.path.join(HERE, 'build', name), ignore_errors=True)
    shutil.copytree(src, os.path.join(HERE, 'build', name))
r = subprocess.run([os.path.join(HERE, 'node_modules', '.bin', 'eslint'), 'build/lint-game/', 'build/lint-server/'], cwd=HERE)
sys.exit(r.returncode)
