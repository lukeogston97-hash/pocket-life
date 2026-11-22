"""Shared bits for the Pocket Life checks: a local copy of the server, a web server for the game and a browser.

Each check opens the test build (test/) in Chrome with ?debug (so window.__pl is there), talking to the real server
code running on this computer. Nothing touches the live world."""
import asyncio, json, os, shutil, subprocess, sys, time
from contextlib import asynccontextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHOTS = os.path.join(HERE, 'shots')
THREE = os.path.join(HERE, 'node_modules', 'three')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
HTTP_PORT, WS_PORT = 8794, 8795
NOISE = ('Failed to load resource', 'GPU stall', 'WebGL', 'Automatic fallback to software')


def bundle(game_changes=None):
    """Bundle the server for running here. game_changes: dict merged into server/game.json first (e.g. {'maxPlaying': 2})."""
    src = os.path.join(ROOT, 'server')
    build = os.path.join(HERE, 'build')
    work = os.path.join(build, 'server')
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(src, work, ignore=shutil.ignore_patterns('node_modules', '.wrangler'))
    if game_changes:
        p = os.path.join(work, 'game.json')
        g = json.load(open(p)); g.update(game_changes); json.dump(g, open(p, 'w'))
    esb = os.path.join(HERE, 'node_modules', '.bin', 'esbuild')
    subprocess.run([esb, os.path.join(work, 'src', 'index.js'), '--bundle', '--format=esm', '--platform=node', '--log-level=warning',
                    f'--alias:cloudflare:workers={os.path.join(HERE, "stub.js")}', f'--outfile={os.path.join(build, "server.mjs")}'], check=True)


@asynccontextmanager
async def world(game_changes=None, **env):
    """A fresh world: the game on http://127.0.0.1:8794, the server on ws://127.0.0.1:8795, and a browser."""
    from playwright.async_api import async_playwright
    import socket
    for port in (HTTP_PORT, WS_PORT):  # another check still running would share (and spoil) the world
        with socket.socket() as sk:
            if sk.connect_ex(('127.0.0.1', port)) == 0: raise RuntimeError(f'port {port} is busy: is another check still running?')
    os.makedirs(SHOTS, exist_ok=True)
    bundle(game_changes)
    http = subprocess.Popen([sys.executable, '-m', 'http.server', str(HTTP_PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log = open(os.path.join(HERE, 'build', 'server.log'), 'w')
    srv = subprocess.Popen(['node', os.path.join(HERE, 'server.mjs')], cwd=HERE, env={**os.environ, **{k: str(v) for k, v in env.items()}}, stdout=log, stderr=subprocess.STDOUT)
    time.sleep(1.2)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            W = World(browser)
            try:
                yield W
            finally:
                await browser.close()
    finally:
        http.kill(); srv.kill()
        http.wait(); srv.wait()  # so the next check finds the ports free


class World:
    def __init__(self, browser):
        self.browser = browser
        self.errors = []

    async def page(self, pid, w=390, h=844, data=None, tz='Australia/Darwin', path='test/'):
        """Open the game as a phone (pid is its random id). data: changes merged into game-data.json."""
        ctx = await self.browser.new_context(viewport={'width': w, 'height': h}, timezone_id=tz, has_touch=w < 600)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: self.errors.append(f'{pid}: {e}'))
        pg.on('console', lambda m: self.errors.append(f'{pid}: {m.text}') if m.type == 'error' and not any(n in m.text for n in NOISE) else None)

        async def three(route):
            await route.fulfill(path=os.path.join(THREE, route.request.url.split('three@0.170.0/')[1]), content_type='application/javascript', headers={'Access-Control-Allow-Origin': '*'})
        await pg.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', three)
        await pg.route('https://fonts.**', lambda r: r.abort())

        async def game_data(route):
            resp = await route.fetch(); d = json.loads(await resp.text())
            d['server'] = f'ws://127.0.0.1:{WS_PORT}/world'
            for k, v in (data or {}).items():
                if isinstance(v, dict) and isinstance(d.get(k), dict): d[k].update(v)
                else: d[k] = v
            await route.fulfill(response=resp, body=json.dumps(d))
        await pg.route('**/game-data.json', game_data)
        # keep the phone's id, and remember the socket and what's sent so checks can look
        await pg.add_init_script("localStorage.setItem('pocket-life:pid', %s); window.__sent = []; const S = WebSocket.prototype.send;"
                                 "WebSocket.prototype.send = function (d) { window.__sock = this; try { window.__sent.push(JSON.parse(d)); } catch (e) {} return S.call(this, d); };" % json.dumps(pid))
        await pg.goto(f'http://127.0.0.1:{HTTP_PORT}/{path}?debug')
        await pg.wait_for_function('window.__frames >= 3', timeout=180000)
        await pg.wait_for_timeout(1500)
        return pg


async def join(pg):
    """From the main menu: Play, then make a person (or carry on as yours) and wait to be in the world."""
    await pg.click('#playBtn'); await pg.wait_for_timeout(1500)
    if await pg.evaluate("!document.getElementById('creator').hidden"):
        await pg.click('.start-btn')
    await pg.wait_for_function("document.getElementById('mainMenu').hidden && !document.getElementById('app').classList.contains('is-creating')", timeout=30000)
    await pg.wait_for_timeout(1000)
    await pg.evaluate("document.getElementById('hint').hidden = true")


async def idle(pg, max_s=40):
    """Wait until the person has nothing left to do."""
    for _ in range(int(max_s * 2)):
        await pg.wait_for_timeout(500)
        if await pg.evaluate("!__pl.tasks.current && !__pl.tasks.list.length"): return True
    return False


text = lambda pg, sel: pg.evaluate(f"(document.querySelector({json.dumps(sel)}) || {{}}).textContent")
shown = lambda pg, sel: pg.evaluate(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }})()")


async def shot(pg, name):
    await pg.wait_for_timeout(400)
    await pg.screenshot(path=os.path.join(SHOTS, f'{name}.png'))


def expect(ok, what):
    """Record one result: prints it and raises if it failed."""
    print(('  ok   ' if ok else '  FAIL ') + what)
    if not ok: raise AssertionError(what)
