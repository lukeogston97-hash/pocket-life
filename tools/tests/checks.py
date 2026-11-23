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
        # the pause menu has What's new, Settings and Feedback too, each closed with the same Close link
        await a.click('#pauseNewsBtn'); expect(await shown(a, '#news') and not await shown(a, '#pause'), "What's new opens from the pause menu"); await a.click('#newsClose')
        await a.click('#menuBtn'); await a.click('#pauseSettingsBtn'); expect(await shown(a, '#settings'), 'Settings opens from the pause menu'); await a.click('#settingsClose')
        await a.click('#menuBtn'); await a.click('#pauseFeedbackBtn'); expect(await shown(a, '#feedback'), 'Feedback opens from the pause menu'); await a.click('#feedbackCancel')
        await a.click('#menuBtn'); await a.wait_for_timeout(300)
        await a.click('#exitBtn'); await a.wait_for_timeout(2500)
        expect(await shown(a, '#mainMenu'), 'Exit goes back to the menu')
        expect((await text(a, '#playSub') or '').startswith(f'as {name}'), 'Play now says as <name>')
        await a.click('#playBtn'); await a.wait_for_timeout(2500)
        expect(await text(a, '#hudName') == name and not await shown(a, '#mainMenu'), 'Play carries on as the same person')
        # the real game has no ready-made name (settings.autoName is off): you have to type one, and it can be 13 to 90
        c = await W.page('menuC', data={'settings': {'autoName': False}})
        await c.click('#playBtn'); await c.wait_for_timeout(1500)
        expect(await c.evaluate("document.getElementById('nameInput').value") == '' and await c.evaluate("document.getElementById('ageInput').min") == '13', 'no name filled in, and age starts at 13')
        await c.click('.start-btn'); await c.wait_for_timeout(300)
        expect(await shown(c, '#nameErr'), 'starting without a name asks for one')
        await c.fill('#nameInput', 'Tester'); await c.click('.start-btn')
        await c.wait_for_function("document.getElementById('mainMenu').hidden && !document.getElementById('app').classList.contains('is-creating')", timeout=30000)
        expect(await text(c, '#hudName') == 'Tester', 'in the world with the name they typed')
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
        boss = await W.page('restBoss'); await boss.evaluate(RAW)  # the admin: a separate connection that only watches
        await boss.evaluate("conn('boss', { watch: true, admin: true, adminCode: 'secret123456' })")
        told = await boss.evaluate(f"ask('boss', {{ t: 'a.fill', id: '{await a.evaluate('__pl.net.myId')}' }})"); await a.wait_for_timeout(1000)
        expect(await a.evaluate('__pl.you.stats.rest') >= 25, f'Rest topped up by the admin ("{told}")')
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
        expect(found == [[0, 0], [0, 0], [5, 3]], f'recipes are discovered (all but one thing had), with Tools and Building buttons ({found})')
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
        # the longest note there is fits on one or two lines across the bar (it once squeezed to a word a line)
        await a.evaluate("document.getElementById('placeText').textContent = \"Just a fire: too close to Alexandra's claim\"")
        box = await a.evaluate("(() => { const t = document.getElementById('placeText').getBoundingClientRect(), b = document.getElementById('placeBar').getBoundingClientRect(); return [t.width, t.height, b.width, innerWidth]; })()")
        expect(box[1] < 40 and box[0] > 120 and box[2] > box[3] * 0.8, f'a long note fits in the place bar on one or two lines (note {box[0]:.0f} x {box[1]:.0f}, bar {box[2]:.0f} of {box[3]})')
        await a.evaluate(f"__pl.movePlacing({spot[0]}, {spot[1]})")
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
    """The admin's dashboard, from admin mode: tabs, finding someone and giving them things, live settings, moving and removing things, the Inbox."""
    async with world() as W:
        b = await W.page('playerB'); await join(b)
        a = await W.page('adminA'); await open_admin(a)  # the admin is not a person: admin mode, from the main menu
        expect(await a.evaluate('__pl.admin.on && __pl.ui.mode === "admin" && !__pl.player'), 'admin mode is on, with no person')
        await a.click('#adminDashBtn'); await a.wait_for_timeout(400)
        expect(await shown(a, '#adminPanel'), 'the Dashboard button opens the dashboard')
        f0 = await a.evaluate('window.__frames'); await frames(a, 3, 60000)
        expect(await a.evaluate('window.__frames') >= f0 + 3, 'the world keeps being drawn with the dashboard open')
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


async def reset_all():
    """Reset everything, from admin mode: every person, their past people, the Inbox and the world go, settings stay, everyone playing starts again, the admin stays in admin mode and the new world is laid out straight away."""
    keys = "() => new Promise((done) => { const keep = window.__sock, s = new WebSocket(keep.url); s.onopen = () => { s.send(JSON.stringify({ t: '__keys' })); window.__sock = keep; }; s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === '__keys') { s.close(); done(m.keys); } }; })"
    has = lambda ks, start: [k for k in ks if k == start or (start.endswith(':') and k.startswith(start))]
    async with world() as W:
        b = await W.page('resetB'); await join(b)
        c = await W.page('resetC'); await join(c)  # someone who is playing when it happens
        a = await W.page('resetA'); await open_admin(a)  # the admin is not a person
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        in_admin = lambda: a.evaluate("__pl.ui.mode === 'admin' && __pl.adminMode.on && !__pl.player && document.getElementById('creator').hidden && document.getElementById('mainMenu').hidden")
        # things a reset should clear: a note in the Inbox, a log on the ground, a person who left (a past person)
        await b.evaluate(f"({send})({{ t: 'feedback', text: 'a note before the reset', v: '0' }})")
        bid = await b.evaluate('__pl.net.myId')
        await a.evaluate(f"({send})({{ t: 'a.add', kind: 'log', n: 3, x: 6, z: 8 }})")
        await a.evaluate(f"({send})({{ t: 'a.live', id: 'maxPlaying', value: 7 }})")  # a setting: this one stays
        await a.evaluate(f"({send})({{ t: 'a.mute', who: 'someone', on: true }})")  # a mute: this one goes
        await b.context.close(); await a.wait_for_timeout(1000)  # B leaves (only someone away can be removed)
        await a.evaluate(f"({send})({{ t: 'a.removePerson', id: {json.dumps(bid)} }})"); await a.wait_for_timeout(800)
        b = await W.page('resetB'); await b.click('#playBtn'); await b.wait_for_timeout(2000)  # the same phone back: the server files their old person as a past person
        before = await a.evaluate(keys)
        expect(has(before, 'p:') and has(before, 'past:') and has(before, 'feedback') and has(before, 'live') and has(before, 'world'), f'before: people, a past person, a note and a setting are stored ({sorted(set(k.split(":")[0] for k in before))})')
        expect(await a.evaluate("__pl.world.items.filter((it) => it.kind === 'log').length") == 3, 'and 3 logs lie on the ground')
        await a.click('#adminDashBtn'); await a.wait_for_timeout(400)
        await a.click('[data-admin-tab="world"]'); await a.wait_for_timeout(400)
        tap = "document.getElementById('adminResetAllBtn').click()"
        await a.evaluate(f'{tap}; {tap}'); await a.wait_for_timeout(1200)  # a double tap by mistake
        expect(await in_admin() and has(await a.evaluate(keys), 'p:') and await c.evaluate('!!__pl.player'), 'a double tap by mistake resets nothing')
        expect('Tap again' in await text(a, '#adminResetAllBtn'), 'the button asks for a second tap')
        # The button only stays ready for a few seconds. The looks above take longer than that on this computer (the first
        # run of this check missed it and never reset anything), so wait for it to go back to normal, then tap twice on
        # purpose with nothing in between: once, a pause of over a second, and again.
        await a.wait_for_function("!document.getElementById('adminResetAllBtn').textContent.includes('Tap again')", timeout=20000)
        await a.evaluate(f"(async () => {{ {tap}; await new Promise((r) => setTimeout(r, 1300)); {tap}; }})()")
        await c.wait_for_function("!document.getElementById('creator').hidden", timeout=60000)
        expect(await c.evaluate('!__pl.player'), "after the second tap, someone who was playing has no person and makes a new one")
        # the admin's connection is dropped with everyone's and comes back by itself, still the admin, with the password it holds
        await a.wait_for_function("__pl.net.myId && __pl.admin.on", timeout=60000); await a.wait_for_timeout(2500)
        expect(await in_admin(), 'the admin is still in admin mode afterwards, with no person (not sent to make one)')
        after = await a.evaluate(keys)
        expect(not has(after, 'p:') and not has(after, 'past:') and not has(after, 'feedback') and not has(after, 'reports'), f'no people, past people or Inbox left ({sorted(after)})')
        expect(has(after, 'live'), 'the settings stay')
        admin = await a.evaluate(keys.replace("{ t: '__keys' }", "{ t: '__keys', get: 'admin' }").replace('done(m.keys)', 'done(m.value)'))
        expect(admin and not admin['muted'] and not admin['banned'], f'bans and mutes are cleared ({admin})')
        await b.wait_for_function("!document.getElementById('creator').hidden", timeout=60000)
        expect(True, 'the other player makes a new person too')
        # nobody has started a new person yet: the admin's own game has laid the new world out, so the admin isn't left looking at the old one
        expect(has(after, 'world'), "the new world is laid out straight away (by the admin's game), before any player comes back")
        expect(await a.evaluate("__pl.world.items.filter((it) => it.kind === 'log').length") == 0, "the admin sees the fresh world (the logs are gone)")
        expect(await a.evaluate('__pl.world.items.length') > 0, 'and it is laid out again')
        expect(len(has(await a.evaluate(keys), 'p:')) == 0, 'nobody is stored yet')
        await c.click('.start-btn')
        await c.wait_for_function("document.getElementById('mainMenu').hidden && !document.getElementById('app').classList.contains('is-creating')", timeout=60000); await c.wait_for_timeout(1500)
        expect(await c.evaluate('!!__pl.player'), 'a new person starts in the new world')
        expect(await c.evaluate("__pl.world.items.filter((it) => it.kind === 'log').length") == 0 and await c.evaluate('__pl.world.items.length') > 0, 'and they see the same fresh world')
        expect(len(has(await a.evaluate(keys), 'p:')) == 1, 'one person stored: the new one')
        expect(await in_admin(), 'the admin is still in admin mode at the end')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def claims():
    """Lighting your first campfire away from the pond claims the land round it; others can't use it; putting it out frees it."""
    async with world(CAMPKIT=1) as W:
        a = await W.page('ownerA'); await join(a)
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        await a.evaluate(f"({send})({{ t: 'craft', id: 'campfire' }})"); await a.wait_for_timeout(800)
        expect(await a.evaluate('__pl.you.carry.campfire') == 1, 'made a campfire')
        await a.evaluate("__pl.queueTask({ type: 'walk', x: 28, z: 6 })"); await idle(a, 50); await a.wait_for_timeout(1500)
        spot = await a.evaluate("(() => { const p = __pl.player.position; for (let k = 0; k < 16; k++) { const ang = k / 16 * Math.PI * 2, x = p.x + Math.cos(ang) * 1.8, z = p.z + Math.sin(ang) * 1.8; if (!__pl.cantPlaceAt(x, z, 'campfire')) return [x, z]; } return null; })()")
        expect(spot is not None and ((spot[0] + 5.6) ** 2 + (spot[1] + 0.9) ** 2) ** 0.5 > 27, f'a spot to place it away from the pond ({spot})')
        await a.evaluate(f"({send})({{ t: 'place', kind: 'campfire', x: {spot[0]:.2f}, z: {spot[1]:.2f}, rot: 0 }})"); await a.wait_for_timeout(800)
        fid = await a.evaluate("[...__pl.placed.keys()][0]")
        for m in [f"{{ t: 'build', id: {fid} }}", f"{{ t: 'fire', id: {fid}, do: 'add', n: 5, fuel: 'stick' }}", f"{{ t: 'fire', id: {fid}, do: 'light' }}"]:
            await a.evaluate(f"({send})({m})"); await a.wait_for_timeout(700)
        expect(await a.evaluate(f"!!__pl.placed.get({fid}).claim && __pl.isLit(__pl.placed.get({fid}))"), 'lighting it made a claim')
        b = await W.page('visitorB'); await join(b); await b.wait_for_timeout(800)
        name = await a.evaluate('__pl.you.look.name')
        expect(await b.evaluate(f"(__pl.placed.get({fid}).claim || {{}}).name") == name, "the other phone sees whose claim it is")
        why = await b.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {{ const w = __pl.cantPlaceAt(th.x + dx, th.z + dz, 'campfire'); if (w !== 'Not enough room here' && w !== 'Too close to another one') return w; }} return 'no clear spot'; }})()")
        expect(why == f"That's {name}'s claim", f"can't place inside someone else's claim ({why})")
        acts = await b.evaluate(f"__pl.menuActions({{ kind: 'placed', th: __pl.placed.get({fid}), name: '' }}).map((x) => x.label)")
        expect(acts[0] == f"{name}'s claim" and 'Put out fire' not in acts, f'their fire menu only says whose claim it is ({acts})')
        # the server says no too: B walks over and tries to put it out
        await b.evaluate(f"__pl.queueTask({{ type: 'walk', x: __pl.placed.get({fid}).x + 1.6, z: __pl.placed.get({fid}).z }})"); await idle(b, 40); await b.wait_for_timeout(1500)
        await b.evaluate(f"({send})({{ t: 'fire', id: {fid}, do: 'out' }})"); await b.wait_for_timeout(800)
        expect(await a.evaluate(f"__pl.isLit(__pl.placed.get({fid}))"), "the server won't let them put it out")
        # the owner puts it out: the claim is gone
        await a.evaluate(f"__pl.queueTask({{ type: 'walk', x: __pl.placed.get({fid}).x - 1.6, z: __pl.placed.get({fid}).z }})"); await idle(a, 30); await a.wait_for_timeout(1500)
        await a.evaluate(f"({send})({{ t: 'fire', id: {fid}, do: 'out' }})"); await a.wait_for_timeout(800)
        free = await b.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); return [__pl.isLit(th), !!__pl.notMineAt(th.x + 3, th.z)]; }})()")
        expect(free == [False, False], f'once out, the land is free ({free})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def guards():
    """The server's guards: you can't take, chop or drink from far away, or jump across the world. (Guessing the admin code: see admin_login.)"""
    async with world() as W:
        a = await W.page('guardA'); await join(a)
        b = await W.page('guardB'); await join(b); await b.wait_for_timeout(500)
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        # a stick on the far side of the world can't be picked up from here
        far = await a.evaluate("(() => { const p = __pl.player.position; return [...__pl.world.items].sort((x, y) => Math.hypot(y.x - p.x, y.z - p.z) - Math.hypot(x.x - p.x, x.z - p.z))[0].id; })()")
        await a.evaluate(f"({send})({{ t: 'take', id: {far} }})"); await a.wait_for_timeout(700)
        expect(await b.evaluate(f"!!__pl.getItem({far})") and not await a.evaluate("Object.keys(__pl.you.carry).length"), "a far-off stick can't be taken")
        # nor a far-off tree chopped (even with an axe, and saying it's right here)
        tree = await a.evaluate("(() => { const p = __pl.player.position; return __pl.trees.map((t, i) => [i, Math.hypot(t.x - p.x, t.z - p.z)]).sort((x, y) => y[1] - x[1])[0][0]; })()")
        await a.evaluate(f"({send})({{ t: 'chop', what: 'tree', idx: {tree}, x: __pl.player.position.x, z: __pl.player.position.z }})"); await a.wait_for_timeout(700)
        expect(await b.evaluate(f"__pl.trees[{tree}].state") == 'tree', "a far-off tree can't be chopped")
        # a game that says its person jumped across the world is put back where they really are
        before = await b.evaluate("(() => { const o = [...__pl.others.values()][0]; return [o.mesh.position.x, o.mesh.position.z]; })()")
        await a.evaluate(f"({send})({{ t: 'move', x: 40, z: -40, ry: 0 }})"); await a.wait_for_timeout(900)
        after = await b.evaluate("(() => { const o = [...__pl.others.values()][0]; return [o.mesh.position.x, o.mesh.position.z]; })()")
        expect(abs(after[0] - before[0]) < 1 and abs(after[1] - before[1]) < 1, f'no jumping across the world ({after})')
        await a.evaluate(f"({send})({{ t: 'move', x: 400, z: 0, ry: 0 }})"); await a.wait_for_timeout(500)
        # a normal walk still works, and things near you can still be picked up
        near = await a.evaluate("(() => { const p = __pl.player.position; const it = [...__pl.world.items].sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0]; __pl.queueTask({ type: 'pickup', id: it.id }); return it.id; })()")
        await idle(a, 40); await a.wait_for_timeout(1200)
        expect(not await b.evaluate(f"!!__pl.getItem({near})") and await a.evaluate("Object.values(__pl.you.carry).reduce((s, n) => s + n, 0)") == 1, 'walking over and picking up still works')
        # drinking only works by the water
        await a.evaluate("__pl.queueTask({ type: 'walk', x: 20, z: 12 })"); await idle(a, 40); await a.wait_for_timeout(1500)
        await a.evaluate(f"({send})({{ t: 'sync' }})"); await a.wait_for_timeout(500)
        thirst = await a.evaluate("__pl.you.stats.thirst")
        await a.evaluate(f"({send})({{ t: 'drink', source: 'pond' }})"); await a.wait_for_timeout(700)
        expect(await a.evaluate("__pl.you.stats.thirst") <= thirst + 0.5, "can't drink far from the pond")
        # (wrong admin codes locking an address out: that's in the admin_login check now, where the admin logs in)
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def maintenance():
    """Maintenance pauses people who aren't playing: their needs stop, then carry on afterwards. It's run from admin mode, which stays in; someone playing on the release link is shut out."""
    async with world() as W:
        b = await W.page('pausedB'); await join(b); await b.wait_for_timeout(500)
        who = await b.evaluate('__pl.net.myId')
        a = await W.page('maintA'); await open_admin(a)  # the admin is not a person
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        await b.close(); await a.wait_for_timeout(1500)  # B stops playing: their person is away
        # (asks for their page and waits for the fresh answer, however long it takes: replies took up to 700 ms on this computer)
        hunger = f"(async () => {{ const was = __pl.adminData.playerData; ({send})({{ t: 'a.player', id: '{who}' }}); for (let k = 0; k < 100; k++) {{ await new Promise((r) => setTimeout(r, 50)); const d = __pl.adminData.playerData; if (d && d !== was && d.stats) return d.stats.hunger; }} return null; }})()"
        await a.evaluate(f"({send})({{ t: 'a.speed', x: 600, minutes: 5 }})"); await a.wait_for_timeout(300)  # an hour passes every 6 seconds
        h0 = await a.evaluate(hunger); await a.wait_for_timeout(7000); h1 = await a.evaluate(hunger)
        expect(h1 < h0 - 1, f'away from the game their hunger drops ({h0:.1f} to {h1:.1f})')
        # someone playing on the release link (the released copy of the game, as players have it) when maintenance starts
        c = await W.page('releaseC', path=''); await join(c)
        expect(await c.evaluate("!!__pl.player && document.getElementById('maint').hidden"), 'someone is playing on the release link')
        await a.evaluate(f"({send})({{ t: 'a.maintenance', on: true, text: 'Back soon' }})"); await a.wait_for_timeout(600)
        h2 = await a.evaluate(hunger); await a.wait_for_timeout(9000); h3 = await a.evaluate(hunger)
        expect(h2 is not None and h3 is not None, "admin mode stays in during maintenance (it can still ask for someone's page)")
        expect(abs(h3 - h2) < 0.2, f'during maintenance it stays put ({h2:.1f} to {h3:.1f})')
        expect(await shown(c, '#maint'), 'the release-link player is shut out and sees Back soon')
        await a.evaluate(f"({send})({{ t: 'a.maintenance', on: false }})"); await a.wait_for_timeout(600)
        h4 = await a.evaluate(hunger)
        # (time is sped up 600 times here, so the second or so it takes to ask already costs a little: unpaused, those 9 seconds would have cost about 6)
        expect(-0.1 < h3 - h4 < 2.5, f'ending maintenance costs them nothing ({h3:.1f} to {h4:.1f})')
        await a.wait_for_timeout(8000); h5 = await a.evaluate(hunger)
        expect(h5 < h4 - 1, f'afterwards it carries on dropping ({h4:.1f} to {h5:.1f})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def restore():
    """Restore, from admin mode: the whole world goes back to an earlier time (bags and the ground too), everyone rejoins by themselves, the admin comes back still in admin mode, and Undo puts it back."""
    async with world() as W:
        b = await W.page('restoreB'); await join(b)
        a = await W.page('restoreA'); await open_admin(a)  # the admin is not a person
        in_admin = lambda: a.evaluate("__pl.ui.mode === 'admin' && __pl.adminMode.on && __pl.admin.on && !__pl.player && document.getElementById('mainMenu').hidden")
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        logs = "__pl.world.items.filter((it) => it.kind === 'log').length"
        sticks = '(__pl.you.carry.stick || 0)'
        before = await b.evaluate(sticks)
        t0 = await a.evaluate('Date.now()'); await a.wait_for_timeout(1200)
        # after t0: B is given 5 sticks and 3 logs go on the ground
        bid = await b.evaluate('__pl.net.myId')
        await a.evaluate(f"({send})({{ t: 'a.give', id: {json.dumps(bid)}, kind: 'stick', n: 5 }})")
        await a.evaluate(f"({send})({{ t: 'a.add', kind: 'log', n: 3, x: 6, z: 8 }})"); await a.wait_for_timeout(1500)
        expect(await b.evaluate(sticks) == before + 5 and await b.evaluate(logs) == 3, 'after the chosen time: 5 sticks given and 3 logs on the ground')
        # the panel: quick picks, Pick a time, and one tap only asks again
        await a.click('#adminDashBtn'); await a.wait_for_timeout(400)
        await a.click('[data-admin-tab="world"]'); await a.wait_for_timeout(400)
        picks = await text(a, '#adminRestoreWhen')
        expect(all(k in picks for k in ['10 min', '1 hour', '6 hours', '1 day', 'Pick a time']), 'quick picks and Pick a time show')
        expect((await text(a, '#adminRestoreBtn')).startswith('Restore to '), f'the button says when ({await text(a, "#adminRestoreBtn")})')
        await a.click('#adminRestoreWhen >> text=Pick a time'); await a.wait_for_timeout(300)
        expect(await shown(a, '#adminRestoreAt'), 'Pick a time shows a date and time box')
        await a.click('#adminRestoreBtn'); await a.wait_for_timeout(300)
        expect('Tap again' in await text(a, '#adminRestoreBtn'), 'one tap asks for a second')
        await a.click('#adminClose'); await a.wait_for_timeout(300)
        expect(await a.evaluate(logs) == 3, 'and nothing was restored by it')
        # restore to t0 (sent straight, to the second)
        await a.wait_for_timeout(max(0, 5500 - (await a.evaluate('Date.now()') - t0)))  # (it has to be at least 5 seconds ago)
        await a.evaluate(f"({send})({{ t: 'a.restore', at: {t0} }})")
        await b.wait_for_function('!__pl.net.myId', timeout=15000)  # the world restarts: everyone's connection drops
        await b.wait_for_function("__pl.net.myId && document.getElementById('joining').hidden", timeout=30000); await b.wait_for_timeout(1500)
        expect(await b.evaluate(sticks) == before and await b.evaluate(logs) == 0, f'restored: the sticks and logs are gone again ({await b.evaluate(sticks)} sticks, {await b.evaluate(logs)} logs)')
        expect(await b.evaluate('!!__pl.player'), 'the player is back in the world by themselves')
        await a.wait_for_function("__pl.net.myId && __pl.admin.on", timeout=60000); await a.wait_for_timeout(1500)
        expect(await in_admin(), 'the admin is back by itself too, still in admin mode (with the password it holds), with no person')
        expect(await a.evaluate(logs) == 0, 'and the admin sees the restored world (no logs)')
        expect(await a.evaluate("!!localStorage.getItem('pocket-life:restoreUndo')"), "the admin's phone keeps an undo point")
        stored = await a.evaluate("JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
        expect('secret123456' not in stored, 'which is not the password (that is never kept on the device)')
        # Undo: back to how it was just before the restore
        await a.evaluate("document.getElementById('announce').hidden = true")
        await a.click('#adminDashBtn'); await a.wait_for_timeout(400)
        await a.click('[data-admin-tab="world"]'); await a.wait_for_timeout(400)
        expect(await shown(a, '#adminRestoreUndo'), f'Undo shows ({await text(a, "#adminRestoreUndoText")})')
        tap = "document.getElementById('adminUndoBtn').click()"  # (taps in the page itself, so a slow software-drawn page can't squeeze them together)
        await a.evaluate(tap); await a.wait_for_timeout(1200); await a.evaluate(tap)
        await b.wait_for_function('!__pl.net.myId', timeout=15000)
        await b.wait_for_function("__pl.net.myId && document.getElementById('joining').hidden", timeout=30000); await b.wait_for_timeout(1500)
        expect(await b.evaluate(sticks) == before + 5 and await b.evaluate(logs) == 3, f'undone: the sticks and logs are back ({await b.evaluate(sticks)} sticks, {await b.evaluate(logs)} logs)')
        expect(await a.evaluate("!localStorage.getItem('pocket-life:restoreUndo')"), 'and the undo point is used up')
        await a.wait_for_function("__pl.net.myId && __pl.admin.on", timeout=60000); await a.wait_for_timeout(1000)
        expect(await in_admin(), 'the admin is still in admin mode after the undo')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def reconnect():
    """Something you finish while the connection is down is sent when it comes back, so it isn't lost."""
    async with world() as W:
        a = await W.page('dropA'); await join(a)
        b = await W.page('dropB'); await join(b); await b.wait_for_timeout(500)
        item = await a.evaluate("(() => { const p = __pl.player.position; return [...__pl.world.items].sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0].id; })()")
        await a.evaluate(f"(() => {{ const it = __pl.getItem({item}); __pl.queueTask({{ type: 'walk', x: it.x + 0.6, z: it.z }}); }})()"); await idle(a, 40); await a.wait_for_timeout(800)
        await a.evaluate("(() => { __pl.net.wanted = false; window.__sock.close(); })()"); await a.wait_for_timeout(400)  # the connection drops (and stays down for now)
        await a.evaluate(f"__pl.queueTask({{ type: 'pickup', id: {item} }})"); await idle(a, 20); await a.wait_for_timeout(600)
        expect(await a.evaluate('__pl.outbox.length') == 1 and await b.evaluate(f"!!__pl.getItem({item})"), 'picked up while offline: kept to send later')
        await a.evaluate("(() => { __pl.net.wanted = true; __pl.goOnline(); })()"); await a.wait_for_timeout(3500)
        carried = await a.evaluate("Object.values(__pl.you.carry).reduce((s, n) => s + n, 0)")
        expect(carried == 1 and not await b.evaluate(f"!!__pl.getItem({item})") and not await a.evaluate(f"!!__pl.getItem({item})"), f'sent once the connection is back ({carried} carried)')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def errors():
    """If something in the game goes wrong it carries on instead of freezing, and the admin's Inbox gets one note about it."""
    async with world() as W:
        a = await W.page('errAdmin'); await open_admin(a)  # the admin is not a person
        # someone else is playing too, as there was when the admin was a player. With B alone in the world the planted fault
        # below goes wrong in two places (and so with two different wordings, two notes); with company it's one, as on main.
        c = await W.page('errC'); await join(c)
        b = await W.page('errB'); await join(b); await b.wait_for_timeout(500)
        await b.evaluate("__pl.others.set('broken', {})"); await b.wait_for_timeout(1500)  # from now on every frame goes wrong
        f0 = await b.evaluate('window.__frames'); await b.wait_for_timeout(2000); f1 = await b.evaluate('window.__frames')
        if f1 <= f0: await frames(b, 1, 30000); f1 = await b.evaluate('window.__frames')  # (this computer draws about 1 to 2 frames a second)
        expect(f1 > f0, f'the game keeps running ({f1 - f0} more frames)')
        await b.evaluate("__pl.others.delete('broken')"); await b.wait_for_timeout(500)
        await b.evaluate("__pl.queueTask({ type: 'walk', x: __pl.player.position.x + 2, z: __pl.player.position.z })"); await idle(b, 30)
        expect(not await b.evaluate('!!__pl.walk.target'), 'and carries on as normal once the problem has gone')
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        await a.evaluate(f"({send})({{ t: 'a.list' }})"); await a.wait_for_timeout(1500)
        notes = await a.evaluate("__pl.adminData.inboxData.feedback.filter((x) => x.text.startsWith('Game error')).map((x) => [x.text.split('\\n')[0], x.count || 1])")
        expect(len(notes) == 1 and 'frame' in notes[0][0], f"the admin's Inbox has one note about it ({notes})")
        problems = [e for e in W.errors if 'errB' not in e]
        expect(not problems, f'no other errors {problems[:3]}')


async def crowd():
    """A busy world: with 40 people about, only the nearest few get a body, and the game keeps running."""
    import subprocess
    data = json.load(open(os.path.join(HERE, '..', '..', 'test', 'game-data.json')))
    async with world() as W:
        a = await W.page('crowdA'); await join(a); await a.wait_for_timeout(500)
        subprocess.run(['node', os.path.join(HERE, 'bots.mjs'), '40', data['version'], str(data['build'])], check=True, stdout=subprocess.DEVNULL)
        await a.wait_for_timeout(3000)
        n = await a.evaluate("(() => { const all = [...__pl.others.values()]; return [all.length, all.filter((o) => o.body).length, all.filter((o) => o.shown).length, __pl.peopleDrawn()]; })()")
        expect(n[0] == 40, f'everyone is known about ({n[0]} people)')
        expect(0 < n[1] <= n[3] and n[1] == n[2], f'only the nearest {n[3]} have a body ({n[1]} do)')
        f0 = await a.evaluate('window.__frames'); await a.wait_for_timeout(2000)
        expect(await a.evaluate('window.__frames') > f0, 'the game keeps running')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def bagdrag():
    """Drag a tile out of the bag: onto a built campfire adds fuel, onto the ground is a drop task (with a see-through copy) that puts one there; the bag comes back after."""
    async with world({}, FISHKIT=1) as W:
        a = await W.page('dragA'); await join(a)
        await a.click('#bagBtn'); await a.wait_for_timeout(400)
        await a.click('#bagList .bag-tile[data-kind="campfire"]'); await a.wait_for_timeout(200)
        await a.click('#bagInfo button.go'); await a.wait_for_timeout(400)
        spot = await a.evaluate("""(() => { const p = __pl.player.position;
          for (let r = 2; r < 8; r += 0.5) for (let k = 0; k < 16; k++) { const x = p.x + Math.cos(k / 16 * 6.28) * r, z = p.z + Math.sin(k / 16 * 6.28) * r;
            if (!__pl.cantPlaceAt(x, z, 'campfire')) { __pl.movePlacing(x, z); return [x, z]; } } return null; })()""")
        expect(spot is not None, f'found a spot for the fire ({spot})')
        await a.evaluate('__pl.finishPlacing()'); await idle(a, 40); await a.wait_for_timeout(1500)
        fid = await a.evaluate('[...__pl.placed.keys()][0]')
        scr = """(([x, y, z]) => { const v = new __pl.THREE.Vector3(x, y, z).project(__pl.camera), r = document.getElementById('world').getBoundingClientRect();
          return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; })"""
        async def drag(kind, pt):
            if not await a.evaluate("document.getElementById('bag').classList.contains('open')"): await a.click('#bagBtn')
            await a.wait_for_timeout(500)
            box = await (await a.query_selector(f'#bagList .bag-tile[data-kind="{kind}"]')).bounding_box()
            await a.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); await a.mouse.down()
            await a.mouse.move(pt[0], pt[1], steps=8); await a.mouse.up(); await a.wait_for_timeout(400)
        sticks = await a.evaluate('__pl.you.carry.stick')
        fire = await a.evaluate(f"({scr})([{spot[0]}, 0.3, {spot[1]}])")
        await drag('stick', fire); await idle(a, 30); await a.wait_for_timeout(800)
        left = await a.evaluate('__pl.you.carry.stick'); fuel = await a.evaluate(f'__pl.fuelLeft(__pl.placed.get({fid}))')
        expect(left == sticks - 1 and fuel > 0, f'a stick dragged onto the fire went in as fuel ({sticks} -> {left}, fuel {fuel})')
        expect(await a.evaluate("document.getElementById('bag').classList.contains('open')"), 'the bag is open again after the drag')
        # a drop onto bare ground away from your feet: it walks over and puts it down where you let go
        P = await a.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        tgt = [P[0] + 3.5, P[1] + 3.5]
        near = "(() => { const p = __pl.player.position; let best = 99, at = null; for (const v of __pl.itemViews.values()) { const d = Math.hypot(v.position.x - %s, v.position.z - %s); if (d < best) { best = d; at = [v.position.x, v.position.z]; } } return [best, at]; })()"
        await drag('stick', await a.evaluate(f"({scr})([{tgt[0]}, 0, {tgt[1]}])"))
        g = await a.evaluate('__pl.dropGhosts.size'); listed = await a.evaluate("document.getElementById('queueNow').textContent")
        expect(g == 1 and listed == 'Putting down', f'the drop is a task with a see-through copy where it will land ({g} copies, "{listed}")')
        nums = await a.evaluate("[...document.querySelectorAll('.qnum')].map((e) => e.textContent).join()")
        expect(nums == '1', f'a lone task keeps its number ({nums!r})')
        await idle(a, 60); await a.wait_for_timeout(800)
        expect(await a.evaluate('__pl.dropGhosts.size') == 0, 'the see-through copy goes once it is down')
        left2 = await a.evaluate('__pl.you.carry.stick')
        d = await a.evaluate(near % (tgt[0], tgt[1]))
        expect(left2 == left - 1 and d[0] < 3.0, f'a stick dragged onto far ground was put down there ({left} -> {left2}, {d[0]:.1f} m from where I let go)')
        expect(await a.evaluate("document.getElementById('bag').classList.contains('open')"), 'the bag is open again after a drop')
        await a.evaluate("document.getElementById('bag').classList.remove('open')")
        # a loose item already in the queue can't be tapped again till its task is done or taken off
        sid = await a.evaluate(f"(() => {{ let best = null, bd = 99; for (const it of __pl.world.items) {{ const d = Math.hypot(it.x - {tgt[0]}, it.z - {tgt[1]}); if (d < bd) {{ bd = d; best = it; }} }} return best && best.id; }})()")
        P2 = await a.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        await a.evaluate(f"__pl.queueTask({{ type: 'walk', x: {P2[0] - 6}, z: {P2[1]} }}); __pl.queueTask({{ type: 'pickup', id: {sid} }})")
        await a.wait_for_timeout(300)
        sp = await a.evaluate(f"(() => {{ const v = __pl.itemViews.get({sid}).position; return ({scr})([v.x, v.y, v.z]); }})()")
        await a.mouse.click(sp[0], sp[1]); await a.wait_for_timeout(400)
        expect(await a.evaluate("document.getElementById('actMenu').hidden"), 'tapping a stick already queued opens no menu')
        # (dragging a loose item along the ground is not checked yet: the headless mouse drag did not pick the stick up)

async def glow():
    """A mouse over a loose item gives it a faint outline, a campfire gets none; moving away takes it off."""
    async with world({}, FISHKIT=1) as W:
        a = await W.page('glow'); await join(a)
        scr = """(([x, y, z]) => { const v = new __pl.THREE.Vector3(x, y, z).project(__pl.camera), r = document.getElementById('world').getBoundingClientRect();
          return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; })"""
        await a.click('#bagBtn'); await a.wait_for_timeout(400)
        await a.click('#bagList .bag-tile[data-kind="campfire"]'); await a.wait_for_timeout(200)
        await a.click('#bagInfo button.go'); await a.wait_for_timeout(400)
        spot = await a.evaluate("""(() => { const p = __pl.player.position;
          for (let r = 2; r < 8; r += 0.5) for (let k = 0; k < 16; k++) { const x = p.x + Math.cos(k / 16 * 6.28) * r, z = p.z + Math.sin(k / 16 * 6.28) * r;
            if (!__pl.cantPlaceAt(x, z, 'campfire')) { __pl.movePlacing(x, z); return [x, z]; } } return null; })()""")
        await a.evaluate('__pl.finishPlacing()'); await idle(a, 40); await a.wait_for_timeout(1500)
        fire = await a.evaluate(f"({scr})([{spot[0]}, 0.3, {spot[1]}])")
        await a.mouse.move(fire[0], fire[1], steps=4); await a.wait_for_timeout(500)
        fid = await a.evaluate('[...__pl.placed.keys()][0]')
        expect(await a.evaluate('__pl.glowOn === null'), 'a campfire doesn\'t glow (only loose items do)')
        it = await a.evaluate("""(() => { const p = __pl.player.position; let b = null, bd = 1e9;
          for (const it of __pl.world.items) { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; b = it; } } return b && [b.id, b.x, b.z]; })()""")
        pt = await a.evaluate(f"({scr})(((v) => [v.x, v.y, v.z])(__pl.itemViews.get({it[0]}).position))")
        await a.mouse.move(pt[0], pt[1], steps=4); await a.wait_for_timeout(500)
        expect(await a.evaluate(f'__pl.glowOn === __pl.itemViews.get({it[0]})'), 'a loose item glows under the mouse')
        await a.mouse.move(5, 5); await a.wait_for_timeout(500)
        expect(await a.evaluate('__pl.glowOn !== __pl.itemViews.get(%d)' % it[0]), 'the glow goes when the mouse moves off')

async def fishing():
    """Fish at the pond with a spear: catches go in the bag, the spear wears, the pond runs dry for everyone, raw fish can't be eaten,
    cooking takes a lit campfire and makes cooked fish that fills you up."""
    import copy
    srv = copy.deepcopy(json.load(open(os.path.join(HERE, '..', '..', 'server', 'game.json')))['sources'])
    srv['pond']['fish'].update(chance=1.0, holds=2)  # every try catches, and the pond holds only 2
    D = json.load(open(os.path.join(HERE, '..', '..', 'test', 'game-data.json')))
    src = copy.deepcopy(D['sources']); src['pond']['fish'].update(seconds=1, chance=1.0, holds=2)
    recipes = copy.deepcopy(D['recipes'])
    for r in recipes:
        if r['id'] == 'cooked-fish': r['seconds'] = 2
    async with world({'sources': srv}, FISHKIT=1) as W:
        a = await W.page('fishA', data={'sources': src, 'recipes': recipes}); await join(a)
        acts = await a.evaluate("__pl.menuActions({ kind: 'use', task: { type: 'use', source: 'pond', water: true }, name: 'Pond' }).map((x) => x.label + (x.disabled ? '!' : ''))")
        expect(acts == ['Drink', 'Fish', 'Walk here'], f'the pond menu has Fish when you carry a spear ({acts})')
        # a campfire by the start, built and lit
        await a.click('#bagBtn'); await a.wait_for_timeout(400)
        await a.click('#bagList .bag-tile[data-kind="campfire"]'); await a.wait_for_timeout(200)
        await a.click('#bagInfo button.go'); await a.wait_for_timeout(400)
        spot = await a.evaluate("""(() => { const p = __pl.player.position;
          for (let r = 2; r < 8; r += 0.5) for (let k = 0; k < 16; k++) { const x = p.x + Math.cos(k / 16 * 6.28) * r, z = p.z + Math.sin(k / 16 * 6.28) * r;
            if (!__pl.cantPlaceAt(x, z, 'campfire')) { __pl.movePlacing(x, z); return [x, z]; } } return null; })()""")
        expect(spot is not None, f'found a spot for the fire ({spot})')
        await a.evaluate('__pl.finishPlacing()'); await idle(a, 40); await a.wait_for_timeout(1500)
        fid = await a.evaluate('[...__pl.placed.keys()][0]')
        await a.evaluate(f"__pl.queueTask({{ type: 'tend', id: {fid}, do: 'add', n: 5 }})"); await idle(a, 15)
        await a.evaluate(f"__pl.queueTask({{ type: 'tend', id: {fid}, do: 'light' }})"); await idle(a, 15); await a.wait_for_timeout(800)
        expect(await a.evaluate(f'__pl.isLit(__pl.placed.get({fid}))'), 'the fire is lit')
        # three tries (walking to the shore first), the pond holds two
        for _ in range(3): await a.evaluate("__pl.queueTask({ type: 'fish' })")
        await idle(a, 90); await a.wait_for_timeout(800)
        got = await a.evaluate("[__pl.you.carry.fish || 0, (__pl.you.wear['fishing-spear'] || [])[0]]")
        expect(got == [2, 17], f'2 fish caught, the third try finds none, and the spear wore 3 uses ({got})')
        b = await W.page('fishB'); await join(b)
        for _ in range(2): await b.evaluate("__pl.queueTask({ type: 'fish' })")
        await idle(b, 60); await b.wait_for_timeout(800)
        expect(not await b.evaluate('__pl.you.carry.fish'), 'the pond ran out of fish for everyone, not just the first person')
        # raw fish can't be eaten; cooking by the lit fire takes a moment and makes cooked fish
        await a.evaluate("__pl.sendAct({ t: 'eat', kind: 'fish' })"); await a.wait_for_timeout(800)
        expect(await a.evaluate('__pl.you.carry.fish') == 2, "raw fish can't be eaten")
        await a.evaluate(f"__pl.queueTask({{ type: 'make', id: {fid}, recipe: 'cooked-fish' }})"); await idle(a, 40); await a.wait_for_timeout(800)
        made = await a.evaluate("[__pl.you.carry.fish || 0, __pl.you.carry['cooked-fish'] || 0]")
        expect(made == [1, 1], f'cooking uses a fish and makes cooked fish ({made})')
        await a.evaluate("__pl.sendAct({ t: 'eat', kind: 'cooked-fish' })"); await a.wait_for_timeout(800)
        ate = await a.evaluate("[__pl.you.carry['cooked-fish'] || 0, __pl.you.stats.hunger]")
        expect(ate[0] == 0 and ate[1] > 95, f'eating cooked fish fills you up ({ate})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


QUIET = 1500  # ms to wait when a check says "nothing comes back": a reply has taken up to about 700 ms here, so shorter proves nothing
RAW = """(() => {
  // a bare connection to the server (no game), for checks about who the server lets do what
  window.__raw = window.__raw || {};
  window.conn = (name, hello) => new Promise((done, fail) => {
    const D = window.GAME_DATA, ws = new WebSocket(D.server + '?world=live'), got = [];
    window.__raw[name] = { ws, got };
    ws.onmessage = (e) => { try { got.push(JSON.parse(e.data)); } catch (err) { /* not for us */ } };
    ws.onerror = () => fail(new Error('no connection'));
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', proto: 2, v: D.version, b: D.build || 0, e: D.era || 0, link: 'test', pid: 'raw-' + name, ...hello })); setTimeout(done, 700); };
  });
  window.say = (name, m) => window.__raw[name].ws.send(JSON.stringify(m));
  // send an admin tool and wait for what it answers (an 'admin' message with words in text); '' if nothing came in 5 s
  window.ask = (name, m) => new Promise((done) => {
    const got = window.__raw[name].got, from = got.length, t0 = Date.now();
    window.say(name, m);
    const look = () => { const a = got.slice(from).find((x) => x.t === 'admin' && x.text); if (a) done(a.text); else if (Date.now() - t0 > 5000) done(''); else setTimeout(look, 40); };
    look();
  });
  window.heard = (name, t) => window.__raw[name].got.filter((m) => m.t === t);
})()"""


async def admin_login():
    """Who is the admin: only a connection that watches with the right code. Someone playing a person never is, a wrong code is refused, and too many wrong codes lock that address out."""
    async with world() as W:
        pg = await W.page('rawhost')
        await pg.evaluate(RAW)
        ev = pg.evaluate
        # someone just watching from the main menu can't use the admin's tools
        await ev("conn('watcher', { watch: true })")
        await ev("say('watcher', { t: 'a.state' })"); await pg.wait_for_timeout(QUIET)
        expect(len(await ev("heard('watcher', 'welcome')")) == 1 and not await ev("heard('watcher', 'admin').length"), "a plain watcher isn't the admin")
        # admin mode: watching, with the code
        await ev("conn('boss', { watch: true, admin: true, adminCode: 'secret123456' })")
        on = await ev("heard('boss', 'admin')")
        expect(len(on) == 1 and on[0].get('on') is True, f'watching with the right code is the admin ({on})')
        hi = (await ev("heard('boss', 'welcome')"))[0]
        expect(hi.get('watch') is True and str(hi.get('id', '')).startswith('w:') and not hi.get('me'), f"the admin has no person: a watcher ({hi.get('id')})")
        told = await ev("ask('boss', { t: 'a.announce', text: 'hello from admin' })"); await pg.wait_for_timeout(300)
        expect(told == 'Message sent' and [m.get('text') for m in await ev("heard('watcher', 'announce')")] == ['hello from admin'], f"the admin's tools work from admin mode (\"{told}\")")
        # someone playing a person is never the admin, even with the right code
        await ev("conn('player', { adminCode: 'secret123456', admin: true })")
        await ev("say('player', { t: 'create', name: 'Pat', age: 30, look: {} })"); await pg.wait_for_timeout(600)
        expect(len(await ev("heard('player', 'me')")) >= 1, 'they have a person')
        await ev("say('player', { t: 'a.state' })"); await ev("say('player', { t: 'a.announce', text: 'from a player' })"); await pg.wait_for_timeout(QUIET)
        expect(not await ev("heard('player', 'admin').length") and not await ev("heard('player', 'adminDone').length"), 'a player with the right code is not the admin')
        expect(len(await ev("heard('watcher', 'announce')")) == 1, "a player can't use the admin's tools")
        # the old way in (typed in the Say box) is gone
        await ev("say('player', { t: 'adminLogin', code: 'secret123456' })"); await pg.wait_for_timeout(QUIET)
        expect(not await ev("heard('player', 'admin').length"), 'the old /admin login does nothing')
        # a wrong code is refused
        await ev("conn('guess', { watch: true, admin: true, adminCode: 'wrong-one' })")
        expect(len(await ev("heard('guess', 'adminNo')")) == 1 and not await ev("heard('guess', 'admin').length"), 'a wrong code is refused')
        # and after a few wrong ones, that address has to wait: even the right code is refused
        for k in range(5):
            await ev(f"conn('guess{k}', {{ watch: true, admin: true, adminCode: 'wrong{k}' }})")
        await ev("conn('late', { watch: true, admin: true, adminCode: 'secret123456' })")
        expect(not await ev("heard('late', 'admin').length") and len(await ev("heard('late', 'adminNo')")) == 1, 'too many wrong codes locks that address out')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def admin_people():
    """Admin mode and people: moving someone, typing their needs and age. The person's own game follows."""
    async with world() as W:
        a = await W.page('movedOne'); await join(a)
        boss = await W.page('rawhost2')
        await boss.evaluate(RAW)
        ev = boss.evaluate
        await ev("conn('boss', { watch: true, admin: true, adminCode: 'secret123456' })")
        expect(len(await ev("heard('boss', 'admin')")) == 1, 'admin mode is on')
        who = await a.evaluate('__pl.net.myId')
        at = lambda: a.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        # (what a tool answers: the server sends it as an 'admin' message with the words in text, as it always has)
        ask = lambda m: ev(f"ask('boss', {m})")
        x0, z0 = await at()
        # move them 20 m away: their own game goes there, and stays there
        told = await ask(f"{{ t: 'a.movePerson', id: '{who}', x: 22, z: 14 }}"); await a.wait_for_timeout(600)
        x1, z1 = await at()
        expect(told.endswith(' moved'), f'the admin is told it worked ("{told}")')
        expect(abs(x1 - 22) < 1.5 and abs(z1 - 14) < 1.5, f'their game put them where the admin moved them ({x1:.1f}, {z1:.1f}; was {x0:.1f}, {z0:.1f})')
        await a.wait_for_timeout(3500)  # (their game says where it is now and then: it mustn't walk them back)
        x2, z2 = await at()
        expect(abs(x2 - x1) < 0.5 and abs(z2 - z1) < 0.5, f'and they stay there ({x2:.1f}, {z2:.1f})')
        page = lambda: ev(f"(async () => {{ say('boss', {{ t: 'a.player', id: '{who}' }}); await new Promise((r) => setTimeout(r, 500)); const d = heard('boss', 'adminPlayer'); return d[d.length - 1]; }})()")
        pg = await page()
        expect(abs(pg['x'] - 22) < 1.5 and abs(pg['z'] - 14) < 1.5, f"the server has them there too ({pg['x']}, {pg['z']})")
        # not into the pond, not off the map
        told = await ask(f"{{ t: 'a.movePerson', id: '{who}', x: -5.6, z: -0.9 }}")
        expect('pond' in told, f'not into the pond ("{told}")')
        told = await ask(f"{{ t: 'a.movePerson', id: '{who}', x: 400, z: 0 }}")
        expect('outside' in told, f'not off the map ("{told}")')
        await a.wait_for_timeout(600)
        x3, z3 = await at()
        expect(abs(x3 - x2) < 0.5 and abs(z3 - z2) < 0.5, 'a refused move leaves them where they were')
        # needs and age, typed in
        told = await ask(f"{{ t: 'a.setStats', id: '{who}', stats: {{ hunger: 12, thirst: 34.5, health: 0, bogus: 50 }}, age: 41 }}"); await a.wait_for_timeout(600)
        expect(told.endswith(' changed'), f'the admin is told it worked ("{told}")')
        st = await a.evaluate('__pl.you.stats')
        expect(abs(st['hunger'] - 12) < 1 and abs(st['thirst'] - 34.5) < 1, f"their game shows the typed needs (hunger {st['hunger']:.1f}, thirst {st['thirst']:.1f})")
        expect(st['health'] >= 1 and 'bogus' not in st, f"health can't be typed down to death, and unknown needs are ignored (health {st['health']})")
        expect(not await a.evaluate('__pl.you.dead'), 'they are still alive')
        pg = await page()
        expect(pg['age'] == 41 and await a.evaluate('__pl.you.look.age') == 41, f"age changed for the admin and for them ({pg['age']})")
        await ask(f"{{ t: 'a.setStats', id: '{who}', age: 5 }}")
        expect((await page())['age'] == 13, 'age never goes below 13')
        # someone away: they go to the menu, their person carries on by themselves, and can still be moved
        await a.evaluate("document.getElementById('menuBtn').click()"); await a.wait_for_timeout(300)
        await a.click('#exitBtn'); await a.wait_for_timeout(1500)
        pg = await page()
        expect(pg['state'] == 'away', f"they're away now ({pg['state']})")
        told = await ask(f"{{ t: 'a.movePerson', id: '{who}', x: 30, z: -25 }}")
        pg = await page()
        expect(abs(pg['x'] - 30) < 0.6 and abs(pg['z'] + 25) < 0.6 and pg['state'] in ('away', 'online'), f"someone away is moved too ({pg['x']}, {pg['z']}, {pg['state']})")
        expect('carry on by themselves' in told, f'and the admin is told they are not pinned there ("{told}")')
        await boss.wait_for_timeout(12000)  # two ticks of the world on the test server
        pg2 = await page()
        from_old = ((pg2['x'] - 22) ** 2 + (pg2['z'] - 14) ** 2) ** 0.5
        # (what they do next depends on the time of day in the world: at night they lie down and sleep where they were put)
        expect(pg2['state'] in ('away', 'online') and from_old > 15, f"two ticks on they're still in the world, and weren't put back where they were moved from (now {pg2['x']}, {pg2['z']}, {pg2['state']})")
        expect(not W.errors, f'no errors {W.errors[:3]}')


CAM = "(() => { const c = __pl.controls; return { pan: c.enablePan, min: c.minDistance, max: c.maxDistance, lo: +c.minPolarAngle.toFixed(4), hi: +c.maxPolarAngle.toFixed(4), one: c.touches.ONE, two: c.touches.TWO, on: c.enabled }; })()"


async def frames(pg, n, timeout=120000):
    """Wait until the game has drawn n more frames. This computer draws the 3D world in software at about 1 to 2 frames a
    second (measured 23 Nov 2026: the untouched main menu and admin mode alike), so checks count frames, never milliseconds."""
    f0 = await pg.evaluate('window.__frames')
    await pg.wait_for_function(f'window.__frames >= {f0 + n}', timeout=timeout)


async def tap_version(pg, n):
    """Tap the version number n times the way a person does: a finger on a phone, a mouse on a computer, one after another.
    (pg.click waits for the page to settle before each one, which takes seconds on this computer's software 3D: not how anyone taps.)"""
    x, y = await pg.evaluate("(() => { const r = document.getElementById('menuVer').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    touch = await pg.evaluate("'ontouchstart' in window")
    for _ in range(n):
        if touch: await pg.touchscreen.tap(x, y)
        else: await pg.mouse.click(x, y)
    await pg.wait_for_timeout(400)


async def open_admin(pg, code='secret123456', taps=False):
    """Into admin mode from the main menu, through the real password box. Returns once the server has answered.
    taps=True also does the 5 taps on the version number (only admin_mode does: the taps are what it's checking). The other
    checks open the box directly, because on this computer, with a second page playing, taps land 2 to 3 seconds apart
    (measured 23 Nov 2026) and a missed gap would fail a check that isn't about taps at all."""
    if taps:
        for attempt in range(4):  # (a gap can still run long here: say so plainly instead of failing on it)
            await tap_version(pg, 5)
            if await pg.evaluate("!document.getElementById('adminLogin').hidden"): break
            print(f'  note: 5 taps did not open the box on try {attempt + 1} (taps too far apart on this computer); trying again')
            await pg.wait_for_timeout(4500)
    else:
        await pg.evaluate('__pl.openAdminLogin()')
    await pg.wait_for_function("!document.getElementById('adminLogin').hidden", timeout=5000)
    await pg.fill('#adminLoginCode', code); await pg.click('#adminLoginGo')
    await pg.wait_for_function("!__pl.adminMode.asking", timeout=8000)
    await pg.wait_for_timeout(300)


async def admin_mode():
    """Admin mode: 5 taps on the version number and the password, no person, a free camera over the live world, and Exit puts everything back. On a phone and a computer."""
    async with world() as W:
        for tag, (w, h) in {'phone': (390, 844), 'pc': (1440, 900)}.items():
            pg = await W.page(f'adm-{tag}', w, h)
            # a password an older build left on the device is deleted, and nothing keeps one now
            await pg.evaluate("localStorage.setItem('pocket-life:admin', 'old-code-left-behind'); localStorage.setItem('pocket-life:adminTag', 'on')")
            await pg.reload(); await pg.wait_for_function('window.__frames >= 3', timeout=180000); await pg.wait_for_timeout(1500)
            expect(await pg.evaluate("localStorage.getItem('pocket-life:admin') === null && localStorage.getItem('pocket-life:adminTag') === null"), f'{tag}: an old password left on the device is deleted')
            before = await pg.evaluate(CAM)
            # 4 taps do nothing; the 5th asks for the password
            await tap_version(pg, 4)
            expect(await pg.evaluate("document.getElementById('adminLogin').hidden"), f'{tag}: 4 taps on the version do nothing')
            await pg.wait_for_timeout(5000)  # a long pause (over the 4 seconds allowed between taps): the count starts again
            await tap_version(pg, 1)
            expect(await pg.evaluate("document.getElementById('adminLogin').hidden"), f'{tag}: a 5th tap after a long pause does nothing either (5 in a row are needed)')
            await pg.wait_for_timeout(5000)
            for attempt in range(4):
                await tap_version(pg, 5)
                if await shown(pg, '#adminLogin'): break
                await pg.wait_for_timeout(5000)
            expect(await shown(pg, '#adminLogin'), f'{tag}: 5 taps in a row ask for the password')
            # a wrong password: still on the main menu
            await pg.fill('#adminLoginCode', 'not-the-password'); await pg.click('#adminLoginGo')
            await pg.wait_for_function("!__pl.adminMode.asking", timeout=8000); await pg.wait_for_timeout(300)
            st = await pg.evaluate("({ mode: __pl.ui.mode, m: __pl.adminMode, note: document.getElementById('adminLoginNote').textContent, menu: !document.getElementById('mainMenu').hidden })")
            expect(st['mode'] == 'menu' and not st['m']['on'] and not st['m']['hasCode'] and st['menu'] and "didn't work" in st['note'], f"{tag}: a wrong password is refused and forgotten ({st['note']})")
            await pg.click('#adminLoginCancel'); await pg.wait_for_timeout(200)
            # the right one: admin mode, with no person
            await open_admin(pg, taps=True)
            st = await pg.evaluate("({ mode: __pl.ui.mode, m: __pl.adminMode, person: !!__pl.player, menu: !document.getElementById('mainMenu').hidden, cls: document.getElementById('app').className, admin: __pl.admin.on })")
            expect(st['mode'] == 'admin' and st['m']['on'] and st['admin'] and not st['person'] and not st['menu'] and 'is-admin' in st['cls'], f'{tag}: the right password opens admin mode, with no person ({st})')
            expect(await shown(pg, '#adminBar') and not await shown(pg, '.hud-bottom') and not await shown(pg, '.hud-top'), f"{tag}: the admin's bar shows and the player's HUD doesn't")
            stored = await pg.evaluate("JSON.stringify(Object.fromEntries(Object.entries(localStorage))) + JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))")
            expect('secret123456' not in stored, f'{tag}: the password is not kept on the device')
            # the world is live underneath
            f0 = await pg.evaluate('window.__frames'); await frames(pg, 4, 60000)
            expect(await pg.evaluate('window.__frames') >= f0 + 4, f'{tag}: the world keeps being drawn (4 more frames)')
            if tag == 'pc':  # keys: W slides the view, Q turns it
                t0 = await pg.evaluate('[__pl.controls.target.x, __pl.controls.target.z, __pl.camera.position.x, __pl.camera.position.z]')
                fwd0 = await pg.evaluate("(() => { const c = __pl.controls.target, p = __pl.camera.position, d = Math.hypot(c.x - p.x, c.z - p.z); return [(c.x - p.x) / d, (c.z - p.z) / d]; })()")
                await pg.keyboard.down('KeyW'); await frames(pg, 14); await pg.keyboard.up('KeyW'); await frames(pg, 12)  # (then let it glide to a stop)
                t1 = await pg.evaluate('[__pl.controls.target.x, __pl.controls.target.z, __pl.camera.position.x, __pl.camera.position.z]')
                along = (t1[0] - t0[0]) * fwd0[0] + (t1[1] - t0[1]) * fwd0[1]
                side = abs((t1[0] - t0[0]) * -fwd0[1] + (t1[1] - t0[1]) * fwd0[0])
                expect(along > 1 and side < along * 0.2, f'pc: holding W slides the view forward, the way the camera faces ({along:.1f} m forward, {side:.1f} m sideways)')
                await pg.keyboard.down('KeyQ'); await frames(pg, 14); await pg.keyboard.up('KeyQ'); await frames(pg, 12)
                t2 = await pg.evaluate('[__pl.controls.target.x, __pl.controls.target.z, __pl.camera.position.x, __pl.camera.position.z]')
                turned = ((t2[2] - t2[0] - (t1[2] - t1[0])) ** 2 + (t2[3] - t2[1] - (t1[3] - t1[1])) ** 2) ** 0.5
                stayed = ((t2[0] - t1[0]) ** 2 + (t2[1] - t1[1]) ** 2) ** 0.5
                expect(turned > 1 and stayed < 0.5, f'pc: holding Q turns the view round the spot it looks at ({turned:.1f} m swing, the spot moved {stayed:.2f} m)')
            # Exit: the main menu again, the password forgotten, the camera as a player has it
            await pg.click('#adminExit'); await pg.wait_for_timeout(1200)
            st = await pg.evaluate("({ mode: __pl.ui.mode, m: __pl.adminMode, menu: !document.getElementById('mainMenu').hidden, cls: document.getElementById('app').className, admin: __pl.admin.on })")
            expect(st['mode'] == 'menu' and not st['m']['on'] and not st['m']['hasCode'] and not st['admin'] and st['menu'] and 'is-admin' not in st['cls'], f'{tag}: Exit admin goes back to the main menu and forgets the password ({st})')
            after = await pg.evaluate(CAM)
            expect(after == before, f"{tag}: the camera is as a player has it again ({after})")
            # and playing afterwards is ordinary: a person, no admin
            await join(pg)
            st = await pg.evaluate("({ mode: __pl.ui.mode, person: !!__pl.player, admin: __pl.admin.on, m: __pl.adminMode })")
            expect(st['mode'] == 'world' and st['person'] and not st['admin'] and not st['m']['on'], f'{tag}: playing afterwards is ordinary, not the admin ({st})')
            expect(not await shown(pg, '#adminBar') and await shown(pg, '.hud-bottom'), f"{tag}: the player's HUD is back and the admin's bar is gone")
            await pg.close()
        expect(not W.errors, f'no errors {W.errors[:3]}')


# where a spot in the world is on the admin's screen (the same sum the game's name tags use)
SCREEN = """(x, y, z) => { const v = new __pl.THREE.Vector3(x, y, z).project(__pl.camera), c = document.getElementById('world').getBoundingClientRect();
  return [c.left + (v.x * 0.5 + 0.5) * c.width, c.top + (-v.y * 0.5 + 0.5) * c.height, v.z < 1]; }"""


async def admin_taps():
    """Admin mode: tapping the world. The ground offers Add item, a person can be moved by tapping where they go, a loose item can be removed. A player's own game is the witness."""
    async with world() as W:
        b = await W.page('tapPlayer'); await join(b)
        a = await W.page('tapAdmin', 1440, 900); await open_admin(a)
        who = await b.evaluate('__pl.net.myId')
        name = await b.evaluate('__pl.you.look.name')
        menu = lambda: a.evaluate("({ shown: !document.getElementById('actMenu').hidden, title: document.getElementById('actTitle').textContent, acts: [...document.querySelectorAll('#actList .act-btn')].map((x) => x.firstChild.textContent) })")
        toast = lambda: a.evaluate("document.getElementById('adminToast').hidden ? '' : document.getElementById('adminToast').textContent")
        me = lambda: a.evaluate(f"(() => {{ const o = __pl.others.get('{who}'); return o ? [o.mesh.position.x, o.mesh.position.y, o.mesh.position.z] : null; }})()")
        p = await me()
        expect(p is not None, 'the admin sees the player in the world')
        # the ground, 4 m from them: Add item
        gx, gz = p[0] + 4, p[2] + 1
        sx, sy, front = await a.evaluate(f"({SCREEN})({gx}, {p[1]}, {gz})")
        expect(front and 380 < sx < 1400 and 80 < sy < 860, f'that spot is on screen ({sx:.0f}, {sy:.0f})')
        await a.mouse.click(sx, sy); await a.wait_for_timeout(600)
        m = await menu()
        expect(m['shown'] and 'Add item' in m['acts'] and 'Fly here' in m['acts'], f"tapping the ground offers Add item and Fly here ({m})")
        stones = await b.evaluate("__pl.world.items.filter((it) => it.kind === 'stone').length")
        await a.click('#actList >> text=Add item'); await a.wait_for_timeout(400)
        expect(await shown(a, '#adminPick'), 'Add item opens the list of things')
        await a.click('#adminPickCount >> text=5'); await a.fill('#adminPickFind', 'stone'); await a.click('#adminPickList >> text=Stone'); await a.wait_for_timeout(1500)
        near = await b.evaluate(f"__pl.world.items.filter((it) => it.kind === 'stone' && Math.hypot(it.x - {gx}, it.z - {gz}) < 3).length")
        expect(await b.evaluate("__pl.world.items.filter((it) => it.kind === 'stone').length") == stones + 5 and near >= 5, f"5 stones land where the admin tapped, in the player's game too ({near} within 3 m)")
        # a person: Move them, then tap where they go
        p = await me()
        sx, sy, front = await a.evaluate(f"({SCREEN})({p[0]}, {p[1] + 0.9}, {p[2]})")
        await a.mouse.click(sx, sy); await a.wait_for_timeout(600)
        m = await menu()
        expect(m['shown'] and m['title'] == name and 'Move them' in m['acts'] and 'Open their page' in m['acts'], f"tapping a person offers what the admin can do with them ({m})")
        await a.click('#actList >> text=Move them'); await a.wait_for_timeout(400)
        expect(name in await toast(), f'the admin is told to tap where they go ("{await toast()}")')
        tx, tz = p[0] - 6, p[2] + 5
        sx, sy, front = await a.evaluate(f"({SCREEN})({tx}, {p[1]}, {tz})")
        await a.mouse.click(sx, sy); await a.wait_for_timeout(2000)
        bx, bz = await b.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        expect(((bx - tx) ** 2 + (bz - tz) ** 2) ** 0.5 < 2.5, f"their own game puts them where the admin tapped (aimed {tx:.1f}, {tz:.1f}; they are at {bx:.1f}, {bz:.1f})")
        expect('moved' in await toast(), f'and the admin is told ("{await toast()}")')
        # a loose item: Remove
        it = await a.evaluate(f"(() => {{ const c = __pl.controls.target; return __pl.world.items.filter((i) => i.kind === 'stone' && Math.hypot(i.x - {gx}, i.z - {gz}) < 3).map((i) => [i.id, i.x, i.z])[0]; }})()")
        sx, sy, front = await a.evaluate(f"({SCREEN})({it[1]}, {p[1] + 0.05}, {it[2]})")
        await a.mouse.click(sx, sy); await a.wait_for_timeout(600)
        m = await menu()
        expect(m['shown'] and any(x.startswith('Remove') for x in m['acts']), f"tapping a loose item offers Remove ({m})")
        before = await b.evaluate("__pl.world.items.length")
        await a.click('#actList >> text=Remove'); await a.wait_for_timeout(1500)
        expect(await b.evaluate("__pl.world.items.length") == before - 1, "the item is gone in the player's game too")
        st = await a.evaluate("({ mode: __pl.ui.mode, person: !!__pl.player })")
        expect(st['mode'] == 'admin' and not st['person'], f'the admin is still in admin mode with no person ({st})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def live_items_game():
    """The admin's item and recipe numbers reach a player's own game: the weight they carry, what a recipe needs and whether they can make it, and someone joining later gets the same."""
    card = """(() => { const c = [...document.querySelectorAll('#craftList .craft-card')].find((x) => x.textContent.includes('Stone knife')); if (!c) return null;
      return { chips: [...c.querySelectorAll('.need-chip')].map((x) => x.textContent), canMake: !c.querySelector('button.small-btn').disabled }; })()"""
    async with world(TESTKIT=1) as W:
        p = await W.page('liveP'); await join(p)
        boss = await W.page('liveBoss'); await boss.evaluate(RAW)
        await boss.evaluate("conn('boss', { watch: true, admin: true, adminCode: 'secret123456' })")
        ask = lambda m: boss.evaluate(f"ask('boss', {m})")
        weight = lambda pg: pg.evaluate("Number(document.getElementById('carryWeight').textContent)")
        w0 = await weight(p)
        expect(w0 == 8, f'to start: 2 sticks, 3 stones, twine and a stone axe weigh 8 ({w0})')
        # a stick now weighs 3: the player's carried weight changes without them doing anything
        told = await ask("{ t: 'a.liveItem', at: ['items', 'stick', 'weight'], value: 3 }")
        await p.wait_for_function("Number(document.getElementById('carryWeight').textContent) === 12", timeout=20000)
        expect(told == 'Changed to 3' and await weight(p) == 12, f"a stick made to weigh 3: the player's game shows 12 carried ({await weight(p)})")
        # the knife recipe, as the player sees it in Craft
        await p.click('#craftBtn'); await p.wait_for_function(f"!!({card})", timeout=20000)
        c0 = await p.evaluate(card)
        expect(c0['canMake'] and c0['chips'] == ['Sticks 1/1', 'Stones 1/1', 'Twine 1/1'], f"the player can make a stone knife from what they carry ({c0['chips']})")
        await ask("{ t: 'a.liveItem', at: ['recipes', 'knife', 'needs', 'stick'], value: 3 }")
        await p.wait_for_function(f"(() => {{ const c = {card}; return c && !c.canMake; }})()", timeout=20000)
        c1 = await p.evaluate(card)
        expect(not c1['canMake'] and c1['chips'] == ['Sticks 2/3', 'Stones 1/1', 'Twine 1/1'], f"a knife made to need 3 sticks: the open Craft list shows it and they can't make one with 2 ({c1['chips']})")
        # back to the game file's numbers
        expect(await ask("{ t: 'a.liveItem', at: ['recipes', 'knife', 'needs', 'stick'], value: null }") == 'Back to what the game file says', 'Reset answers plainly')
        await ask("{ t: 'a.liveItem', at: ['items', 'stick', 'weight'], value: null }")
        await p.wait_for_function(f"(() => {{ const c = {card}; return c && c.canMake; }})() && Number(document.getElementById('carryWeight').textContent) === 8", timeout=20000)
        expect(await weight(p) == 8 and (await p.evaluate(card))['canMake'], 'Reset puts both back for the player: 8 carried, and the knife can be made again')
        # someone who joins later gets the admin's numbers on the way in
        await ask("{ t: 'a.liveItem', at: ['items', 'stick', 'weight'], value: 2 }")
        q = await W.page('liveQ'); await join(q)
        expect(await weight(q) == 10, f'someone joining afterwards carries 10 (their 2 sticks weigh 2 each) ({await weight(q)})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


CHECKS = {'layout': layout, 'smoke': smoke, 'menu': menu, 'line': line, 'walking': walking, 'grass_and_tools': grass_and_tools, 'collapse': collapse, 'screens': screens, 'new_home': new_home, 'strolling': strolling, 'regions': regions, 'pond': pond, 'campfire': campfire, 'mining': mining, 'admin_tools': admin_tools, 'reset_all': reset_all, 'restore': restore, 'claims': claims, 'guards': guards, 'maintenance': maintenance, 'reconnect': reconnect, 'errors': errors, 'crowd': crowd, 'fishing': fishing, 'bagdrag': bagdrag, 'glow': glow, 'admin_login': admin_login, 'admin_people': admin_people, 'admin_mode': admin_mode, 'admin_taps': admin_taps, 'live_items_game': live_items_game}

# shortcuts: `run.py quick` for small changes
GROUPS = {'quick': ['layout', 'smoke']}
