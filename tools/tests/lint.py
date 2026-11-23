"""Lint the server and the game: python3 tools/tests/lint.py   (joins the game's parts first, like index.html does).
First it checks game-data.json for mistakes and that the server's copies of the rules are up to date (tools/worlds.py check)."""
import os, re, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
c = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'worlds.py'), 'check'])
if c.returncode: sys.exit(c.returncode)
html = open(os.path.join(ROOT, 'test', 'index.html'), encoding='utf-8').read()
parts = re.findall(r"'([a-z-]+)'", re.search(r'const PARTS = \[(.*?)\];', html, re.S).group(1))
os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
with open(os.path.join(HERE, 'build', 'game.js'), 'w', encoding='utf-8') as f:
    for p in parts: f.write(f'// ===== game/{p}.js =====\n' + open(os.path.join(ROOT, 'test', 'game', f'{p}.js'), encoding='utf-8').read() + '\n')
# ESLint only looks inside this folder, so the server's code is copied in
shutil.rmtree(os.path.join(HERE, 'build', 'lint-server'), ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'server', 'src'), os.path.join(HERE, 'build', 'lint-server'))
r = subprocess.run([os.path.join(HERE, 'node_modules', '.bin', 'eslint'), 'build/game.js', 'build/lint-server/'], cwd=HERE)
sys.exit(r.returncode)
