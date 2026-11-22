"""The checks. Each is an async function taking nothing; run.py runs them. Add new ones at the bottom and to CHECKS."""
import json, os
from lib import world, join, idle, text, shown, shot, expect, HERE

KNIFE_USES = json.load(open(os.path.join(HERE, '..', '..', 'test', 'game-data.json')))['items']['knife']['tool']['uses']

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
        await b.wait_for_timeout(1500)
        seen = await b.evaluate("document.getElementById('regions').textContent")
        expect('1 person' in seen, f'another phone on the menu sees 1 person in the world picker ({seen})')
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
        for x, y in [(250, 560), (140, 600), (300, 660), (200, 720), (120, 500)]:  # some open ground (not a stick or stone)
            await a.evaluate("document.getElementById('actMenu').hidden = true"); await a.wait_for_timeout(300)
            await a.mouse.dblclick(x, y); await a.wait_for_timeout(400)
            if await a.evaluate('!!__pl.walk.target'): break
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
        await a.evaluate("[...document.querySelectorAll('#craftList .craft-card')].find((c) => c.innerText.includes('Stone knife')).querySelector('.small-btn').click()")
        await a.wait_for_timeout(1500); await a.click('#craftClose')
        expect(await a.evaluate('!!__pl.you.carry.knife'), 'made a stone knife')
        await a.evaluate("""(() => { const P = __pl.plants.tallGrass, p = __pl.player.position;
          const c = P.clumps.filter((c) => !c.readyAt).sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0];
          __pl.queueTask({ type: 'cut', plant: 'tallGrass', i: c.i, x: c.x, z: c.z }); })()""")
        await idle(a, 60); await a.wait_for_timeout(1500)
        knife_wear = "(() => { const w = (__pl.you.wear || {}).knife; return Array.isArray(w) ? w[0] : w; })()"
        expect(await a.evaluate(knife_wear) == KNIFE_USES - 1, 'the knife wears with each cut')
        await a.evaluate("__pl.queueTask({ type: 'drop', kind: 'knife', n: 1, which: 0 })"); await idle(a, 20); await a.wait_for_timeout(1500)
        kid = await a.evaluate("(() => { const e = [...__pl.itemViews.entries()].find(([id, v]) => v.userData.label === 'Stone knife'); return e ? e[0] : null; })()")
        expect(kid is not None and not await a.evaluate('__pl.you.carry.knife'), f'dropped the worn knife ({kid})')
        await a.evaluate(f"__pl.queueTask({{ type: 'pickup', id: {kid} }})"); await idle(a, 20); await a.wait_for_timeout(1500)
        expect(await a.evaluate(knife_wear) == KNIFE_USES - 1, 'picked back up, it is still worn (not new again)')
        expect(await a.evaluate('!__pl.heldView'), 'hands empty when not using a tool')
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
            await pg.click('#pauseAdminBtn'); await pg.wait_for_timeout(300); await shot(pg, f'{tag}_08_admin')
            for k, t in enumerate(['players', 'inbox', 'world', 'settings']):
                await pg.click(f'[data-admin-tab="{t}"]'); await pg.wait_for_timeout(400); await shot(pg, f'{tag}_09{"abcd"[k]}_admin_{t}')
            await pg.click('[data-admin-tab="players"]'); await pg.wait_for_timeout(400); await pg.click('#adminPlayers .admin-entry'); await pg.wait_for_timeout(500); await shot(pg, f'{tag}_09e_admin_player')
            await pg.click('#adminClose')
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


async def regions():
    """The world picker under Play: Oceania is open; Europe and Americas say Coming soon and can't be played."""
    async with world() as W:
        b = await W.page('regionB'); await join(b)
        a = await W.page('regionA')
        expect('1 person' in await a.evaluate("document.querySelector('#regions .region small').textContent"), 'Oceania shows 1 person in it')
        names = await a.evaluate("[...document.querySelectorAll('#regions .region')].map((b) => b.innerText.split('\\n')[0])")
        expect(names == ['Oceania', 'Europe', 'Americas'], f'three worlds under Play ({names})')
        await a.evaluate("document.querySelectorAll('#regions .region')[1].click()"); await a.wait_for_timeout(600)
        expect(await a.evaluate("__pl.freshLook && [...__pl.itemViews.values()].every((v) => !v.visible) && __pl.trees.every((t) => t.state === 'tree' || !t.stump || !t.stump.visible)"), 'it looks fresh: nothing on the ground')
        expect(await text(a, '#playText') == 'Europe is coming soon' and await a.evaluate("document.getElementById('playBtn').disabled"), 'Europe is coming soon and Play is off')
        await a.wait_for_timeout(800)
        expect(await a.evaluate("[...__pl.others.values()].every((o) => !o.mesh.visible)"), 'its world shows empty')
        await shot(a, 'regions_europe')
        await a.evaluate("document.querySelectorAll('#regions .region')[0].click()"); await a.wait_for_timeout(600)
        expect(await text(a, '#playText') == 'Play' and not await a.evaluate("document.getElementById('playBtn').disabled"), 'back on Oceania, Play works')
        expect(await a.evaluate("!__pl.freshLook && [...__pl.itemViews.values()].every((v) => v.visible)"), 'back on Oceania, its things show again')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def pond():
    """Someone standing in the pond can always walk out, and others in the water are shown on the shore."""
    async with world() as W:
        a = await W.page('pondA'); await join(a)
        await a.evaluate("__pl.player.position.set(-5.6, __pl.player.position.y, -0.9)")  # the middle of the main pond
        await a.evaluate("(() => { __pl.queueTask({ type: 'walk', x: 2, z: 4 }); })()")
        await idle(a, 40); await a.wait_for_timeout(500)
        p = await a.evaluate("[__pl.player.position.x, __pl.player.position.z]")
        expect(abs(p[0] - 2) < 0.6 and abs(p[1] - 4) < 0.6, f'walks out of the pond to where they were going ({p[0]:.1f}, {p[1]:.1f})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def smoke():
    """A quick look that the game still works: menu, make a person, inventory, craft, walk, back to the menu."""
    async with world(TESTKIT=1) as W:
        a = await W.page('smoke')
        expect(await shown(a, '#mainMenu'), 'main menu')
        await join(a)
        expect(bool(await text(a, '#hudName')), 'in the world')
        await a.click('#bagBtn'); expect(await shown(a, '#bag'), 'inventory opens')
        expect(await a.evaluate("document.querySelectorAll('#bagList > li').length >= 10 && document.getElementById('bagInfo').hidden"), 'inventory shows the grid, no info until a tap')
        await a.click('#bagClose')
        tools = await a.evaluate("""(() => { __pl.you.carry.knife = 2; __pl.you.wear.knife = [5, 12]; document.getElementById('bagBtn').click();
          const t = [...document.querySelectorAll('#bagList .bag-tile[data-kind="knife"]')].map((b) => b.getAttribute('aria-label'));
          document.getElementById('bagClose').click(); return t; })()""")
        expect(tools == ['Stone knife, 5 uses left', 'Stone knife, spare, 12 uses'], f'each tool gets its own tile: the one in use, then a spare ({tools})')
        await a.click('#craftBtn'); expect(await a.evaluate("document.querySelectorAll('#craftList .craft-card').length > 0 || !document.getElementById('craftMore').hidden"), 'craft shows recipes, or how to find them'); await a.click('#craftClose')
        found = await a.evaluate("""(() => { const out = [];
          for (const seen of [[], ['stick'], ['stick', 'stone']]) {
            __pl.you.carry = {}; __pl.you.seen = seen; document.getElementById('craftBtn').click();
            out.push([document.querySelectorAll('#craftList .craft-card').length, document.querySelectorAll('#craftChips .craft-chip').length]);
            document.getElementById('craftClose').click(); }
          return out; })()""")
        expect(found == [[0, 0], [0, 0], [4, 3]], f'recipes are discovered (all but one thing had), with Tools and Building buttons ({found})')
        await a.evaluate("(() => { const p = __pl.player.position; __pl.queueTask({ type: 'walk', x: p.x + 1.5, z: p.z + 1 }); })()")
        await idle(a, 20)
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn'); await a.wait_for_timeout(1500)
        expect(await shown(a, '#mainMenu'), 'Exit goes back to the menu')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def campfire():
    """Craft a campfire, place it, build it, add sticks, light it, sit by it (it carries on while away), put it out."""
    async with world(CAMPKIT=1) as W:
        a = await W.page('fireA'); await join(a)
        b = await W.page('fireB'); await join(b)
        await a.click('#craftBtn'); await a.wait_for_timeout(500)
        await a.evaluate("[...document.querySelectorAll('#craftList .craft-card')].find((c) => c.innerText.includes('Campfire')).querySelector('.small-btn').click()")
        await a.wait_for_timeout(1500); await a.click('#craftClose')
        expect(await a.evaluate('__pl.you.carry.campfire === 1 && !__pl.you.carry.log && __pl.you.carry.stick === 6 && !__pl.you.carry.stone'), 'crafting a campfire uses 1 log, 3 sticks and 4 stones')
        await a.click('#bagBtn'); await a.wait_for_timeout(400); await shot(a, 'campfire-bag')
        expect(await a.evaluate("document.getElementById('bagInfo').hidden"), 'the info bar waits for a tap')
        await a.click('#bagList .bag-tile[data-kind="campfire"]'); await a.wait_for_timeout(200)
        expect(await a.evaluate("!document.getElementById('bagInfo').hidden && document.getElementById('bagInfo').innerText.includes('Campfire')"), 'tapping a tile shows its info')
        await shot(a, 'campfire-bag-info')
        await a.click('#bagInfo button.go')
        await a.wait_for_timeout(400)
        expect(await a.evaluate('__pl.placing.on') and await shown(a, '#placeBar'), 'Place opens the place bar')
        spot = await a.evaluate("""(() => { const p = __pl.player.position;
          for (let r = 2; r < 8; r += 0.5) for (let k = 0; k < 16; k++) { const x = p.x + Math.cos(k / 16 * 6.28) * r, z = p.z + Math.sin(k / 16 * 6.28) * r;
            if (!__pl.cantPlaceAt(x, z, 'campfire')) { __pl.movePlacing(x, z); return [x, z]; } } return null; })()""")
        expect(spot is not None, f'found a spot to put it ({spot})')
        await shot(a, 'campfire-placing')
        await a.evaluate('__pl.finishPlacing()')
        await idle(a, 40); await a.wait_for_timeout(1500)
        built = await a.evaluate('[...__pl.placed.values()].map((t) => t.built)')
        expect(built == [True], f'it was put down and built ({built})')
        expect(not await a.evaluate('__pl.you.carry.campfire'), 'the campfire left the inventory')
        expect(await b.evaluate('[...__pl.placed.values()].map((t) => t.built)') == [True], 'the other phone sees it built')
        fid = await a.evaluate('[...__pl.placed.keys()][0]')
        await a.evaluate(f"__pl.queueTask({{ type: 'tend', id: {fid}, do: 'light' }})"); await idle(a, 10)
        expect(not await a.evaluate(f'__pl.isLit(__pl.placed.get({fid}))'), "it won't light with no fuel")
        await a.evaluate(f"__pl.queueTask({{ type: 'tend', id: {fid}, do: 'add', n: 5 }})"); await idle(a, 15); await a.wait_for_timeout(800)
        fuel = await a.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))')
        expect(abs(fuel - 5 * 300000) < 2000 and await a.evaluate('__pl.you.carry.stick') == 1, f'5 sticks give 25 minutes of fuel ({fuel})')
        acts = await a.evaluate(f"__pl.placedActions(__pl.placed.get({fid})).map((x) => (x.foot ? '_' : '') + x.label + (x.sub ? ':' + x.sub.map((y) => y.label).join('|') : ''))")
        expect(acts[0] == 'Light fire' and 'Add fuel:Add 1 stick' in acts and acts[-2:] == ['_Inspect', '_Walk here'], f'campfire menu: Light fire first, a fuel list, Inspect and Walk here along the bottom ({acts})')
        fuel_b = await b.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))')
        expect(abs(fuel_b - fuel) < 3000, 'the other phone sees the same fuel')
        await a.evaluate(f"__pl.queueTask({{ type: 'tend', id: {fid}, do: 'light' }})"); await idle(a, 15); await a.wait_for_timeout(800)
        expect(await a.evaluate(f'__pl.isLit(__pl.placed.get({fid}))') and await b.evaluate(f'__pl.isLit(__pl.placed.get({fid}))'), 'lit, on both phones')
        acts = await a.evaluate(f"__pl.placedActions(__pl.placed.get({fid})).map((x) => x.label)")
        expect('Light fire' not in acts and acts.index('Put out fire') > acts.index('Sit by campfire'), f'lit: Put out fire comes after Sit ({acts})')
        f1 = await a.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))'); await a.wait_for_timeout(3000)
        f2 = await a.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))')
        expect(2000 < f1 - f2 < 4500, f'it burns fuel while lit ({f1 - f2} ms in 3 s)')
        await a.evaluate(f"__pl.queueTask({{ type: 'sit', id: {fid}, ms: 300000 }})")
        for _ in range(30):
            await a.wait_for_timeout(500)
            if await a.evaluate('!!__pl.you.sit'): break
        expect(await a.evaluate('!!__pl.you.sit'), 'sitting by the fire')
        await a.wait_for_timeout(1500); await shot(a, 'campfire-sitting')
        feet = await a.evaluate(f"""(() => {{ const th = __pl.placed.get({fid}), P = __pl.player.userData.parts, v = new __pl.player.position.constructor();
          return Math.min(...[P.legL, P.legR].map((l) => {{ l.children.forEach((c) => c.updateMatrixWorld(true)); let m = 9;
            l.traverse((c) => {{ if (c.isMesh) {{ c.getWorldPosition(v); m = Math.min(m, Math.hypot(v.x - th.x, v.z - th.z)); }} }}); return m; }})); }})()""")
        expect(feet > 0.6, f'feet stay out of the fire ({feet:.2f} m from the middle)')
        expect(await b.evaluate('[...__pl.others.values()].some((o) => o.sit)'), 'the other phone sees them sitting')
        await shot(b, 'campfire-sitting-other')
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn'); await a.wait_for_timeout(2500)
        expect(await b.evaluate("[...__pl.others.values()].some((o) => o.sit && o.state === 'away')"), 'still sitting while away')
        await a.click('#playBtn'); await a.wait_for_timeout(2500)
        # since 0.2.8 sitting has no set time: you sit until you stand up, do something else or the fire goes out
        expect(await a.evaluate("!!__pl.you.sit && !!__pl.tasks.current && __pl.tasks.current.type === 'sit'"), 'back in the game: still sitting')
        await a.evaluate('__pl.endSit(true)'); await a.wait_for_timeout(1500)
        expect(not await b.evaluate('[...__pl.others.values()].some((o) => o.sit)'), 'stood up, on both phones')
        await a.evaluate(f"__pl.queueTask({{ type: 'tend', id: {fid}, do: 'out' }})"); await idle(a, 15); await a.wait_for_timeout(800)
        f3 = await b.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))'); await b.wait_for_timeout(2000)
        f4 = await b.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))')
        expect(not await b.evaluate(f'__pl.isLit(__pl.placed.get({fid}))') and f3 == f4 and f3 > 0, 'put out: no fuel used while out')
        # packing up and taking apart (0.2.6): only who built it; packing puts the campfire back in the inventory
        await b.evaluate(f"__pl.queueTask({{ type: 'unplace', id: {fid} }})"); await idle(b, 30); await b.wait_for_timeout(1000)
        expect(await a.evaluate(f'__pl.placed.has({fid})'), "someone else can't pack it up")
        await a.evaluate(f"__pl.queueTask({{ type: 'unplace', id: {fid} }})"); await idle(a, 30); await a.wait_for_timeout(1000)
        expect(await a.evaluate('__pl.you.carry.campfire') == 1 and not await b.evaluate(f'__pl.placed.has({fid})'), 'packed up: back in the inventory, gone on the other phone')
        await a.click('#bagBtn'); await a.wait_for_timeout(300)
        await a.click('#bagList .bag-tile[data-kind="campfire"]'); await a.click('#bagInfo button.go'); await a.wait_for_timeout(300)
        await a.evaluate("""(() => { const p = __pl.player.position;
          for (let r = 2; r < 8; r += 0.5) for (let k = 0; k < 16; k++) { const x = p.x + Math.cos(k / 16 * 6.28) * r, z = p.z + Math.sin(k / 16 * 6.28) * r;
            if (!__pl.cantPlaceAt(x, z, 'campfire')) { __pl.movePlacing(x, z); return; } } })()""")
        await a.evaluate('__pl.finishPlacing()'); await idle(a, 40); await a.wait_for_timeout(1500)
        fid2 = await a.evaluate('[...__pl.placed.keys()][0]')
        n0 = await a.evaluate('__pl.itemViews.size')
        await a.evaluate(f"__pl.queueTask({{ type: 'apart', id: {fid2} }})"); await idle(a, 30); await a.wait_for_timeout(1500)
        n1 = await a.evaluate('__pl.itemViews.size')
        expect(not await a.evaluate(f'__pl.placed.has({fid2})') and n1 - n0 == 8, f'taken apart (never lit): its 8 parts land round it ({n1 - n0})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def mining():
    """The stone pickaxe breaks a rock (5 stones, rock gone) and mines a boulder (3-5 stones, it stays, mined)."""
    async with world(MINEKIT=1) as W:
        a = await W.page('mineA'); await join(a)
        near = """((boulder) => { const p = __pl.player.position;
          return __pl.rocks.map((r, i) => [i, r]).filter(([i, r]) => r.boulder === boulder && r.state === 'whole').sort((x, y) => Math.hypot(x[1].x - p.x, x[1].z - p.z) - Math.hypot(y[1].x - p.x, y[1].z - p.z))[0][0]; })"""
        stones = "[...__pl.itemViews.values()].filter((v) => v.userData.label === 'Stone').length"
        for boulder, lo, hi, state in [(False, 5, 5, 'gone'), (True, 3, 5, 'mined')]:
            i = await a.evaluate(f"{near}({'true' if boulder else 'false'})")
            before = await a.evaluate(stones)
            await a.evaluate(f"(() => {{ const r = __pl.rocks[{i}]; __pl.queueTask({{ type: 'mine', idx: {i}, x: r.x, z: r.z }}); }})()")
            await idle(a, 90); await a.wait_for_timeout(2000)
            got = await a.evaluate(stones) - before
            expect(lo <= got <= hi, f"{'boulder' if boulder else 'rock'} gave {lo}-{hi} stones ({got})")
            expect(await a.evaluate(f"__pl.rocks[{i}].state") == state, f"{'boulder' if boulder else 'rock'} is {state}")
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def admin_tools():
    """The Admin panel: tabs, finding someone and giving them things, live settings, moving and removing things, the Inbox."""
    async with world() as W:
        b = await W.page('playerB'); await join(b)
        a = await W.page('adminA'); await join(a)
        await a.click('#sayBtn'); await a.fill('#sayInput', '/admin secret123456'); await a.press('#sayInput', 'Enter'); await a.wait_for_timeout(800)
        await a.mouse.click(195, 300); await a.wait_for_timeout(300)
        expect(await a.evaluate('__pl.admin.on'), 'admin on')
        await a.click('#menuBtn'); await a.click('#pauseAdminBtn'); await a.wait_for_timeout(400)
        for t in ['players', 'inbox', 'world', 'settings', 'server']:
            await a.click(f'[data-admin-tab="{t}"]'); await a.wait_for_timeout(400)
            expect(await a.evaluate(f"!document.querySelector('[data-admin-page=\"{t}\"]').hidden"), f'{t} tab shows')
        # find B by name and open their page
        name = await b.evaluate('__pl.you.look.name')
        await a.click('[data-admin-tab="players"]'); await a.fill('#adminFind', name[:4]); await a.wait_for_timeout(900)
        expect(name in await text(a, '#adminPlayers'), 'search finds them')
        await a.click('#adminPlayers .admin-entry.tap'); await a.wait_for_timeout(700)
        expect(name in await text(a, '#adminPlayer'), 'their page opens')
        sticks = await b.evaluate('__pl.you.carry.stick || 0')
        await a.click('#adminPlayer >> text=Give items'); await a.click('#adminPickCount >> text=5'); await a.fill('#adminPickFind', 'stick')
        await a.click('#adminPickList >> text=Stick'); await a.wait_for_timeout(900)
        expect(await b.evaluate('__pl.you.carry.stick || 0') == sticks + 5, 'gave them 5 sticks')
        await a.click('#adminPlayer >> text=Take all'); await a.wait_for_timeout(900)
        expect(not await b.evaluate('__pl.you.carry.stick'), 'took them back')
        # live settings reach everyone, and Reset puts them back
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        await a.evaluate(f"({send})({{ t: 'a.live', id: 'hungerPerHour', value: 10 }})"); await a.wait_for_timeout(800)
        expect(await b.evaluate('__pl.STAT.hunger.perHour') == -10, 'live need rate reaches players')
        await a.click('[data-admin-tab="settings"]'); await a.wait_for_timeout(300)
        expect('Changed' in await text(a, '#adminSettings'), 'Settings shows it changed')
        await a.evaluate(f"({send})({{ t: 'a.live', id: 'hungerPerHour', value: null }})"); await a.wait_for_timeout(800)
        expect(await b.evaluate('__pl.STAT.hunger.perHour') < 0 and await b.evaluate('__pl.STAT.hunger.perHour') != -10, 'Reset puts it back')
        # move a tree, remove a rock and a berry bush
        i = await a.evaluate("__pl.trees.findIndex((t) => t.state === 'tree')")
        x0 = await a.evaluate(f'__pl.trees[{i}].x')
        await a.evaluate(f"({send})({{ t: 'a.move', what: 'tree', idx: {i}, x: __pl.trees[{i}].x + 3, z: __pl.trees[{i}].z }})")
        r = await a.evaluate("__pl.rocks.findIndex((r) => r.state === 'whole')")
        await a.evaluate(f"({send})({{ t: 'a.remove', what: 'rock', idx: {r} }})")
        await a.evaluate(f"({send})({{ t: 'a.remove', what: 'bush', idx: 1 }})"); await a.wait_for_timeout(900)
        expect(abs(await b.evaluate(f'__pl.trees[{i}].x') - (x0 + 3)) < 0.05, 'the tree moved for everyone')
        expect(await b.evaluate(f'__pl.rocks[{r}].state') == 'gone', 'the rock is gone')
        expect(await b.evaluate('!!__pl.berryBushes[1].userData.removed'), 'the bush is gone')
        await a.evaluate(f"({send})({{ t: 'a.regrowAll' }})"); await a.wait_for_timeout(900)
        expect(await b.evaluate(f'__pl.rocks[{r}].state') == 'gone', 'a removed rock stays gone after Regrow everything')
        # a fresh join sees the same
        c = await W.page('playerC'); await join(c); await c.wait_for_timeout(500)
        expect(abs(await c.evaluate(f'__pl.trees[{i}].x') - (x0 + 3)) < 0.05 and await c.evaluate('!!__pl.berryBushes[1].userData.removed'), 'moves and removals kept')
        # the Inbox: feedback marked Done
        await b.evaluate(f"({send})({{ t: 'feedback', text: 'test note', v: '0' }})"); await b.wait_for_timeout(500)
        await a.click('[data-admin-tab="inbox"]'); await a.evaluate(f"({send})({{ t: 'a.list' }})"); await a.wait_for_timeout(600)
        expect('test note' in await text(a, '#adminInbox'), 'feedback in the Inbox')
        await a.click('#adminInbox >> text=Done'); await a.wait_for_timeout(600)
        expect('test note' not in await text(a, '#adminInbox'), 'Done hides it')
        expect(not W.errors, f'no errors {W.errors[:3]}')


CHECKS = {'layout': layout, 'smoke': smoke, 'menu': menu, 'line': line, 'walking': walking, 'grass_and_tools': grass_and_tools, 'collapse': collapse, 'screens': screens, 'new_home': new_home, 'strolling': strolling, 'regions': regions, 'pond': pond, 'campfire': campfire, 'mining': mining, 'admin_tools': admin_tools}

# shortcuts: `run.py quick` for small changes
GROUPS = {'quick': ['layout', 'smoke']}
