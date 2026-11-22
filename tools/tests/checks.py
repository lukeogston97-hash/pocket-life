"""The checks. Each is an async function taking nothing; run.py runs them. Add new ones at the bottom and to CHECKS."""
import json, os
from lib import world, join, idle, text, shown, shot, expect, HERE

FINGERPRINT = """(() => {
  const r = (v) => Math.round(v * 100) / 100, h = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };
  const P = __pl;
  return {
    trees: P.trees.length + ':' + h(JSON.stringify(P.trees.map((t) => [r(t.x), r(t.z)]))),
    oldStumps: P.oldStumps.length + ':' + h(JSON.stringify(P.oldStumps.map((t) => [r(t.x), r(t.z)]))),
    bushes: P.berryBushes.length + ':' + h(JSON.stringify(P.berryBushes.map((b) => [r(b.position.x), r(b.position.z)]))),
    plants: Object.entries(P.plants).map(([k, p]) => k + ':' + p.clumps.length + ':' + h(JSON.stringify(p.clumps.map((c) => [r(c.x), r(c.z)])))).join(','),
    serverLayout: h(JSON.stringify(P.layoutData())),
  };
})()"""


async def layout():
    """The world is laid out exactly as before (shared items, bushes and trees must line up with the live world)."""
    async with world() as W:
        pg = await W.page('layout')
        fp = await pg.evaluate(FINGERPRINT)
        base = os.path.join(HERE, 'layout-baseline.json')
        if not os.path.exists(base) or os.environ.get('UPDATE_LAYOUT'):
            json.dump(fp, open(base, 'w'), indent=2); print('  saved a new layout baseline:', fp)
        else:
            want = json.load(open(base))
            for k, v in want.items(): expect(fp.get(k) == v, f'layout {k} unchanged ({fp.get(k)})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def menu():
    """Main menu, making a person, Back, Play, Exit to the menu, coming back."""
    async with world() as W:
        a = await W.page('menuA')
        expect(await shown(a, '#mainMenu'), 'main menu shows first')
        expect(await text(a, '#playSub') == 'Make your person', 'Play says Make your person')
        await shot(a, 'menu')
        await a.click('#menuSettingsBtn'); expect(await shown(a, '#settings'), 'Settings opens'); await a.click('#settingsClose')
        await a.click('#menuNewsBtn'); expect(await shown(a, '#news'), "What's new opens"); await a.click('#newsClose')
        await a.click('#playBtn'); await a.wait_for_timeout(1500)
        expect(await shown(a, '#creator'), 'Play opens Make your person')
        await a.click('#creatorBack'); await a.wait_for_timeout(1200)
        expect(await shown(a, '#mainMenu'), 'Back returns to the menu')
        await join(a)
        name = await text(a, '#hudName')
        expect(bool(name), f'in the world as {name}')
        b = await W.page('menuB')
        expect('1 person' in (await text(b, '#menuNetText') or ''), 'another phone on the menu sees 1 person')
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await shot(a, 'pause')
        await a.click('#exitBtn'); await a.wait_for_timeout(2500)
        expect(await shown(a, '#mainMenu'), 'Exit goes back to the menu')
        expect((await text(a, '#playSub') or '').startswith(f'as {name}'), 'Play now says as <name>')
        await a.click('#playBtn'); await a.wait_for_timeout(2500)
        expect(await text(a, '#hudName') == name and not await shown(a, '#mainMenu'), 'Play carries on as the same person')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def line():
    """With the world full (limit set to 2 here) a third player waits in line and gets in when someone exits."""
    async with world({'maxPlaying': 2}) as W:
        a = await W.page('lineA'); await join(a)
        b = await W.page('lineB'); await join(b)
        c = await W.page('lineC')
        await c.click('#playBtn'); await c.wait_for_timeout(1500)
        expect(await text(c, '#playText') == 'World is full', 'third player sees World is full')
        expect('1st in line' in (await text(c, '#playSub') or ''), "and that they're 1st in line")
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn')
        for _ in range(20):
            await c.wait_for_timeout(500)
            if await shown(c, '#creator'): break
        expect(await shown(c, '#creator'), 'they get in when a spot opens')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def walking():
    """A walk sends a few messages (not every step), and another phone sees you end up in the right place."""
    async with world() as W:
        a = await W.page('walkA'); await join(a)
        b = await W.page('walkB'); await join(b)
        await a.evaluate('window.__sent.length = 0')
        p0 = await a.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        await a.mouse.dblclick(250, 560)
        await idle(a); await a.wait_for_timeout(1500)
        p1 = await a.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        moves = await a.evaluate("window.__sent.filter((m) => m.t === 'move').length")
        expect(abs(p1[0] - p0[0]) + abs(p1[1] - p0[1]) > 1, 'double-tap walks')
        expect(moves <= 8, f'a walk sends few messages ({moves})')
        await b.wait_for_timeout(3000)
        seen = await b.evaluate("(() => { const o = [...__pl.others.values()][0]; return o ? [o.mesh.position.x, o.mesh.position.z] : null; })()")
        expect(seen and abs(seen[0] - p1[0]) < 0.3 and abs(seen[1] - p1[1]) < 0.3, 'the other phone sees them where they stopped')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def grass_and_tools():
    """Tall grass by hand gives twine; make a knife; the knife cuts grass and picks 2 berries; tools wear."""
    async with world(TESTKIT=1) as W:
        a = await W.page('grassA'); await join(a)
        n = await a.evaluate('__pl.plants.tallGrass.clumps.length')
        expect(n == 40, f'40 tall grass clumps ({n})')
        before = await a.evaluate('__pl.you.carry.twine || 0')
        await a.evaluate("""(() => { const P = __pl.plants.tallGrass, p = __pl.player.position;
          const c = [...P.clumps].sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0];
          __pl.queueTask({ type: 'cut', plant: 'tallGrass', i: c.i, x: c.x, z: c.z }); })()""")
        await idle(a, 60); await a.wait_for_timeout(1500)
        expect(await a.evaluate('__pl.you.carry.twine || 0') == before + 1, 'cutting grass by hand gives 1 twine')
        await a.click('#craftBtn'); await a.wait_for_timeout(500); await shot(a, 'craft')
        await a.evaluate("[...document.querySelectorAll('#craftList .craft-card')].find((c) => c.innerText.includes('Stone knife')).querySelector('button').click()")
        await a.wait_for_timeout(1500); await a.click('#craftClose')
        expect(await a.evaluate('!!__pl.you.carry.knife'), 'made a stone knife')
        await a.evaluate("""(() => { const P = __pl.plants.tallGrass, p = __pl.player.position;
          const c = P.clumps.filter((c) => !c.readyAt).sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0];
          __pl.queueTask({ type: 'cut', plant: 'tallGrass', i: c.i, x: c.x, z: c.z }); })()""")
        await idle(a, 60); await a.wait_for_timeout(1500)
        expect(await a.evaluate('(__pl.you.wear || {}).knife') == 9, 'the knife wears with each cut')
        await a.evaluate("""(() => { const p = __pl.player.position; const [i, b] = __pl.berryBushes.map((b, i) => [i, b]).sort((x, y) => x[1].position.distanceTo(p) - y[1].position.distanceTo(p))[0];
          __pl.queueTask({ type: 'use', source: b.userData.source, bush: i, x: b.position.x, z: b.position.z, stop: 1.1, top: b.position.y + 1 }); })()""")
        await idle(a, 60); await a.wait_for_timeout(1500)
        expect(await a.evaluate('__pl.you.carry.berry') == 2, 'with a knife a pick gives 2 berries')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def collapse():
    """With no Rest your person collapses asleep and can't get up until Rest is back to 25."""
    async with world(COLLAPSE=1) as W:
        a = await W.page('restA'); await join(a); await a.wait_for_timeout(2500)
        expect(await a.evaluate('__pl.you.sleeping && __pl.you.collapsed'), 'collapsed asleep with no Rest')
        await a.mouse.dblclick(250, 560); await a.wait_for_timeout(800)
        expect(not await a.evaluate('!!__pl.walk.target'), "can't walk off while too tired")
        await a.evaluate("window.__sock.send(JSON.stringify({ t: 'sleep', on: false }))"); await a.wait_for_timeout(1000)
        expect(await a.evaluate('__pl.you.sleeping'), "the server won't wake them either")
        await a.click('#sayBtn'); await a.fill('#sayInput', '/admin secret123456'); await a.press('#sayInput', 'Enter'); await a.wait_for_timeout(800)
        await a.mouse.click(195, 300); await a.wait_for_timeout(300)
        await a.evaluate("window.__sock.send(JSON.stringify({ t: 'a.fill', id: __pl.net.myId }))"); await a.wait_for_timeout(1000)
        expect(await a.evaluate('__pl.you.stats.rest') >= 25, 'Rest topped up')
        await a.evaluate("(() => { const p = __pl.player.position; __pl.queueTask({ type: 'walk', x: p.x + 2, z: p.z }); })()"); await a.wait_for_timeout(1500)
        expect(not await a.evaluate('__pl.you.sleeping'), 'once rested, a task wakes them')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def screens():
    """Screenshots of every screen on a phone and a computer, for a look (in tools/tests/shots)."""
    async with world(TESTKIT=1) as W:
        for tag, w, h in [('phone', 390, 844), ('pc', 1280, 800)]:
            pg = await W.page(f'screens{tag}', w, h)
            await shot(pg, f'{tag}_01_menu')
            await join(pg); await shot(pg, f'{tag}_02_world')
            await pg.click('#needs'); await shot(pg, f'{tag}_03_needs'); await pg.click('#needs')
            await pg.click('#bagBtn'); await shot(pg, f'{tag}_04_inventory'); await pg.click('#bagClose')
            await pg.click('#craftBtn'); await shot(pg, f'{tag}_05_craft'); await pg.click('#craftClose')
            await pg.click('#sayBtn'); await pg.fill('#sayInput', 'hello there'); await pg.press('#sayInput', 'Enter'); await shot(pg, f'{tag}_06_chat')
            await pg.fill('#sayInput', '/admin secret123456'); await pg.press('#sayInput', 'Enter'); await pg.wait_for_timeout(800)
            await pg.mouse.click(w // 2, int(h * 0.3)); await pg.wait_for_timeout(300)
            await pg.click('#menuBtn'); await shot(pg, f'{tag}_07_pause')
            await pg.click('#pauseAdminBtn'); await shot(pg, f'{tag}_08_admin')
            await pg.click('#adminListBtn'); await shot(pg, f'{tag}_09_admin_list'); await pg.click('#adminListClose'); await pg.click('#adminClose')
            await pg.evaluate("__pl.showWelcomeBack({ ms: 5 * 3600000, ate: 3, drank: 2, picked: 4, slept: true })"); await shot(pg, f'{tag}_10_welcome_back'); await pg.click('#backBtn')
            await pg.evaluate("__pl.die({ name: __pl.you.look.name, age: 25, cause: 'thirst' })"); await shot(pg, f'{tag}_11_death')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def new_home():
    """The old GitHub address sends you to pocketlife.pages.dev with your phone's id, so you keep your person."""
    import json as _j
    from lib import ROOT, THREE, HTTP_PORT, WS_PORT
    async with world() as W:
        ctx = await W.browser.new_context(viewport={'width': 390, 'height': 844})
        pg = await ctx.new_page()
        async def three(route):
            await route.fulfill(path=os.path.join(THREE, route.request.url.split('three@0.170.0/')[1]), content_type='application/javascript', headers={'Access-Control-Allow-Origin': '*'})
        await pg.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', three)
        await pg.route('https://fonts.**', lambda r: r.abort())
        async def local(route):  # both addresses are served from this computer's copy of test/
            url = route.request.url
            path = url.split('/pocket-life/', 1)[1] if 'github.io' in url else url.split('pages.dev/', 1)[1]
            path = path.split('?')[0].split('#')[0] or 'index.html'
            if path.endswith('/'): path += 'index.html'
            f = os.path.join(ROOT, path)
            if not os.path.exists(f): await route.fulfill(status=404); return
            body = open(f, 'rb').read()
            if path.endswith('game-data.json'):
                d = _j.loads(body); d['server'] = f'ws://127.0.0.1:{WS_PORT}/world'; body = _j.dumps(d).encode()
            ct = {'html': 'text/html', 'js': 'application/javascript', 'json': 'application/json', 'css': 'text/css'}.get(path.rsplit('.', 1)[-1], 'application/octet-stream')
            await route.fulfill(body=body, content_type=ct)
        await pg.route('https://lukeogston97-hash.github.io/**', local)
        await pg.route('https://pocketlife.pages.dev/**', local)
        await pg.goto('https://lukeogston97-hash.github.io/pocket-life/test/')
        await pg.evaluate("localStorage.setItem('pocket-life:pid', 'old-phone-id')")
        await pg.goto('https://lukeogston97-hash.github.io/pocket-life/test/')
        await pg.wait_for_url('https://pocketlife.pages.dev/test/**', timeout=30000)
        await pg.wait_for_function('window.__frames >= 2', timeout=180000)
        expect(pg.url == 'https://pocketlife.pages.dev/test/', f'ends up on pocketlife.pages.dev/test/ with nothing after # ({pg.url})')
        expect(await pg.evaluate("localStorage.getItem('pocket-life:pid')") == 'old-phone-id', 'the phone id came along')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def strolling():
    """Someone away strolls about on another phone's screen without walking through trees or rocks, and doesn't get stuck."""
    async with world() as W:
        a = await W.page('strollA'); await join(a)
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn'); await a.wait_for_timeout(1000)
        b = await W.page('strollB'); await join(b)
        inside, moved, last, still = 0, 0.0, None, 0
        for _ in range(90):
            await b.wait_for_timeout(500)
            pos = await b.evaluate("""(() => { const o = [...__pl.others.values()][0]; if (!o) return null; const p = o.mesh.position;
              return [p.x, p.z, !!__pl.solidAt(p.x, p.z), o.state]; })()""")
            if not pos: continue
            if pos[2]: inside += 1
            if last:
                step = ((pos[0] - last[0]) ** 2 + (pos[1] - last[1]) ** 2) ** 0.5
                moved += step
            last = pos
        print(f'    walked {moved:.1f} m in 45 s')
        expect(moved > 5, f'the away person strolls about ({moved:.1f} m)')
        expect(inside == 0, f'never inside a tree, rock or bush ({inside} of 90 looks)')
        expect(not W.errors, f'no errors {W.errors[:3]}')


CHECKS = {'layout': layout, 'menu': menu, 'line': line, 'walking': walking, 'grass_and_tools': grass_and_tools, 'collapse': collapse, 'screens': screens, 'new_home': new_home, 'strolling': strolling}
