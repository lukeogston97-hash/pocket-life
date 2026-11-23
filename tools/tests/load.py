"""How the server copes as the world grows: python3 tools/tests/load.py [people away] [loose items]

Runs the real server code in memory with that many people away and 20 playing, moves time on an hour, and prints how long
a tick takes, how many storage writes that hour cost (against Cloudflare's free 100,000 a day) and how big the messages are.
Add ACT=0 in front to see what the world costs with nobody doing anything. Nothing touches the live world."""
import os, subprocess, sys
from lib import bundle, HERE
bundle()
sys.exit(subprocess.run(['node', os.path.join(HERE, 'load.mjs'), *sys.argv[1:]]).returncode)
