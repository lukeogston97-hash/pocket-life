"""The checks. Each is an async function taking nothing; run.py runs them. Add new ones at the bottom and to CHECKS."""
import json, os
from lib import world, join, idle, text, shown, shot, expect, HERE, HTTP_PORT, TIPS

KNIFE_USES = json.load(open(os.path.join(HERE, '..', '..', 'test', 'game-data.json')))['items']['knife']['tool']['uses']

# Make something on the craft mat (0.1.8) the way a player does: open the inventory and its Craft, tap each thing in the bag to
# put it on the mat, then Make. things: [(kind, how many)]. Returns what the mat said before Make (its name line).
async def mat_make(pg, things, close=True):
    if not await pg.evaluate("document.getElementById('bag').classList.contains('open') && !document.getElementById('mat').hidden"):
        if not await pg.evaluate("document.getElementById('bag').classList.contains('open')"): await pg.click('#bagBtn')
        await pg.click('#bagCraft'); await pg.wait_for_timeout(300)
    if await pg.evaluate("!document.getElementById('matClear').hidden"): await pg.click('#matClear')
    for kind, n in things:
        for _ in range(n):
            await pg.click(f'#bagList .bag-tile[data-kind="{kind}"]'); await pg.wait_for_timeout(120)
    said = await pg.evaluate("document.getElementById('matName').textContent")
    await pg.click('#matMake'); await pg.wait_for_timeout(1800)
    if close: await pg.click('#bagClose')
    return said


FINGERPRINT = """(() => {
  const r = (v) => Math.round(v * 100) / 100, h = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };
  const P = __pl;
  return {
    trees: P.trees.length + ':' + h(JSON.stringify(P.trees.map((t) => [r(t.x), r(t.z)]))),
    oldStumps: P.oldStumps.length + ':' + h(JSON.stringify(P.oldStumps.map((t) => [r(t.x), r(t.z)]))),
    bushes: P.berryBushes.length + ':' + h(JSON.stringify(P.berryBushes.map((b) => [r(b.position.x), r(b.position.z)]))),
    plants: Object.entries(P.plants).map(([k, p]) => k + ':' + p.clumps.length + ':' + h(JSON.stringify(p.clumps.map((c) => [r(c.x), r(c.z)])))).join(','),
    serverLayout: h(JSON.stringify((({ boulders, ...rest }) => rest)(P.layoutData()))), // (what the server is told, as it was before it was also told which rocks are boulders, 0.1.10)
    boulders: (P.layoutData().boulders || []).length + ':' + h(JSON.stringify(P.layoutData().boulders || [])), // which rocks are boulders
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
            for k in fp:
                if k not in want: print(f'  (new, not in the baseline yet: add "{k}": "{fp[k]}" to layout-baseline.json)')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def menu():
    """Main menu, making a person, Back, Play, Exit to the menu, coming back."""
    async with world() as W:
        a = await W.page('menuA')
        expect(await shown(a, '#mainMenu'), 'main menu shows first')
        expect(await text(a, '#playSub') == 'Make your person', 'Play says Make your person')
        same = await a.evaluate("(() => { let worst = 0; for (let x = -20; x <= 10; x += 0.37) for (let z = -15; z <= 15; z += 0.41) worst = Math.max(worst, Math.abs(__pl.pondShape(x, z) - __pl.pondShapeAt(__pl.POND, x, z))); return worst; })()")
        expect(same == 0, f"the pond's shape in the shared rules (the server's check of where things are placed) is exactly the game's own ({same})")
        ver = await text(a, '#menuVer')
        expect(ver.startswith('Early access · v0.'), f'the main menu says Early access by the version ({ver})')
        await shot(a, 'menu')
        await a.click('#menuSettingsBtn'); expect(await shown(a, '#settings'), 'Settings opens'); await a.click('#settingsClose')
        # Settings > Privacy and rules (0.1.10): the words of privacy.html, shown in the game
        await a.click('#menuSettingsBtn'); await a.click('#rulesBtn')
        await a.wait_for_function("document.querySelectorAll('#rulesBody h2').length >= 5", timeout=15000)
        words = await text(a, '#rulesBody')
        expect(await shown(a, '#rules') and not await shown(a, '#settings') and all(w in words for w in ('What the game keeps', 'Rules for playing', '13 or older')), "Settings > Privacy and rules shows the page's words in the game")
        fits = await a.evaluate("(() => { const b = document.getElementById('rulesBody'), c = b.closest('.modal-card').getBoundingClientRect(); return [b.scrollHeight > b.clientHeight + 50, c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight]; })()")
        expect(all(fits), f'the panel fits the phone, and its words scroll inside it ({fits})')
        await shot(a, 'menu_rules')
        await a.keyboard.press('Escape'); expect(not await shown(a, '#rules'), 'Escape puts it away')
        # the same words as a page of its own (for links from outside the game), with a way back to the game
        pv = await a.context.new_page()
        await pv.route('https://fonts.**', lambda r: r.abort())
        await pv.goto(f'http://127.0.0.1:{HTTP_PORT}/test/privacy.html')
        alone = await pv.evaluate("[document.title, document.querySelectorAll('#words h2').length, document.querySelector('.top a').getAttribute('href'), document.getElementById('words').textContent]")
        expect('Privacy and rules' in alone[0] and alone[1] >= 5 and alone[2] == './', 'privacy.html opens as a page of its own, with a link back to the game')
        expect(''.join(alone[3].split()) == ''.join(words.split()), 'the game shows exactly the words of that page')  # (spaces between the page's lines aside)
        await shot(pv, 'menu_rules_page'); await pv.close()
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
        note = await text(a, '#pause p')
        expect(note == 'The world keeps going while this is open.', f'the Menu says only that the world keeps going ({note})')  # (Luke, 25 Nov 2026: nothing about Darwin time)
        # the pause menu has What's new, Settings and Feedback too, each closed with the same Close link
        await a.click('#pauseNewsBtn'); expect(await shown(a, '#news') and not await shown(a, '#pause'), "What's new opens from the pause menu"); await a.click('#newsClose')
        await a.click('#menuBtn'); await a.click('#pauseSettingsBtn'); expect(await shown(a, '#settings'), 'Settings opens from the pause menu'); await a.click('#settingsClose')
        await a.click('#menuBtn'); await a.click('#pauseSettingsBtn'); await a.click('#rulesBtn')
        expect(await shown(a, '#rules') and 'Rules for playing' in (await text(a, '#rulesBody') or ''), 'Privacy and rules opens from there too')
        await a.click('#rulesClose'); expect(not await shown(a, '#rules'), 'Close puts it away')
        await a.click('#menuBtn'); await a.click('#pauseFeedbackBtn'); expect(await shown(a, '#feedback'), 'Feedback opens from the pause menu')
        px = await a.evaluate("[parseFloat(getComputedStyle(document.getElementById('feedbackText')).fontSize), parseFloat(getComputedStyle(document.getElementById('reportNote')).fontSize)]")
        expect(min(px) >= 16, f'on a touch screen the feedback box and the report note are 16 px or more, so an iPhone does not zoom the page ({px})')
        await shot(a, 'menu_feedback'); await a.click('#feedbackCancel')
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
        # Privacy and rules with no connection: the panel says so, and gives the way to the page
        await c.route('**/privacy.html*', lambda r: r.abort())
        await c.click('#menuBtn'); await c.click('#pauseSettingsBtn'); await c.click('#rulesBtn')
        await c.wait_for_function("document.querySelector('#rulesBody a')", timeout=15000)
        expect("Couldn't load this just now" in await text(c, '#rulesBody') and await c.evaluate("document.querySelector('#rulesBody a').getAttribute('href')") == 'privacy.html', "if the page can't be fetched the panel says so, with a link to it")
        await c.unroute('**/privacy.html*'); await c.click('#rulesClose'); await c.click('#menuBtn'); await c.click('#pauseSettingsBtn'); await c.click('#rulesBtn')
        await c.wait_for_function("document.querySelectorAll('#rulesBody h2').length >= 5", timeout=15000)
        expect(True, 'and opening it again once the connection is back shows the words')
        await c.click('#rulesClose')
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
        said = await mat_make(a, [('stone', 2)])
        expect(said == 'Sharp stone' and await a.evaluate('__pl.you.carry["sharp-stone"] === 1 && __pl.you.carry.stone === 1'), f'2 stones on the craft mat make a sharp stone ({said})')
        await a.click('#bagBtn'); await a.click('#bagCraft'); await a.wait_for_timeout(300); await shot(a, 'craft')
        said = await mat_make(a, [('sharp-stone', 1), ('stick', 1), ('twine', 1)])
        expect(await a.evaluate('!!__pl.you.carry.knife && !__pl.you.carry["sharp-stone"]'), f'made a stone knife from a sharp stone, stick and twine ({said})')
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
    """Screenshots of every screen on a phone and a computer, for a look (in tools/tests/shots): the game as a player, then admin mode."""
    async with world(TESTKIT=1) as W:
        for tag, w, h in [('phone', 390, 844), ('pc', 1280, 800)]:
            pg = await W.page(f'screens{tag}', w, h)
            await shot(pg, f'{tag}_01_menu')
            await join(pg); await shot(pg, f'{tag}_02_world')
            await pg.click('#needs'); await shot(pg, f'{tag}_03_needs'); await pg.click('#needs')
            await pg.click('#bagBtn'); await shot(pg, f'{tag}_04_inventory'); await pg.click('#bagClose')
            await pg.click('#bagBtn'); await pg.click('#bagCraft'); await pg.click('#bagList .bag-tile[data-kind="stone"]'); await pg.click('#bagList .bag-tile[data-kind="stone"]'); await shot(pg, f'{tag}_05_craft'); await pg.click('#bagClose')
            await pg.click('#sayBtn'); await pg.fill('#sayInput', 'hello there'); await pg.press('#sayInput', 'Enter'); await shot(pg, f'{tag}_06_chat')
            await pg.mouse.click(w // 2, int(h * 0.3)); await pg.wait_for_timeout(300)
            await pg.click('#menuBtn'); await shot(pg, f'{tag}_07_pause'); await pg.click('#pauseSettingsBtn'); await shot(pg, f'{tag}_07b_settings')
            await pg.click('#rulesBtn'); await pg.wait_for_function("document.querySelectorAll('#rulesBody h2').length >= 5", timeout=15000); await shot(pg, f'{tag}_07c_rules'); await pg.click('#rulesClose')
            # admin mode, on a second screen of the same size, while the first is still playing (so there is someone to look at)
            ad = await W.page(f'screensadmin{tag}', w, h)
            await ad.evaluate('__pl.openAdminLogin()'); await ad.wait_for_function("!document.getElementById('adminLogin').hidden", timeout=5000)
            await ad.fill('#adminLoginCode', 'secret123456'); await shot(ad, f'{tag}_08_admin_password')
            await ad.click('#adminLoginGo'); await ad.wait_for_function('!__pl.adminMode.asking', timeout=8000); await frames(ad, 2)
            await shot(ad, f'{tag}_09_admin_world')
            await ad.click('#adminDashBtn'); await ad.wait_for_timeout(500); await shot(ad, f'{tag}_10a_admin_server')
            for k, t in enumerate(['players', 'inbox', 'world', 'settings', 'items', 'log']):
                await ad.click(f'[data-admin-tab="{t}"]'); await ad.wait_for_timeout(700); await shot(ad, f'{tag}_10{"bcdefg"[k]}_admin_{t}')
            await ad.click('[data-admin-tab="players"]'); await ad.wait_for_timeout(700); await ad.click('#adminPlayers .admin-entry'); await ad.wait_for_function("document.querySelector('#adminPlayer .admin-stat')", timeout=8000)
            await shot(ad, f'{tag}_10h_admin_person')
            await ad.click('#adminPlayer >> text=Edit needs and age'); await shot(ad, f'{tag}_10i_admin_person_edit')
            await ad.click('#adminClose')
            await pg.evaluate("__pl.showWelcomeBack({ ms: 5 * 3600000, ate: 3, drank: 2, picked: 4, slept: true })"); await shot(pg, f'{tag}_11_welcome_back'); await pg.click('#backBtn')
            await pg.evaluate("__pl.die({ name: __pl.you.look.name, age: 25, cause: 'thirst' })"); await shot(pg, f'{tag}_12_death')
            # this size is done: its two games close, so the next size isn't drawn alongside them (four games at once is more
            # than this computer's software 3D can keep up with: a click then took over 30 seconds, 24 Nov 2026)
            await ad.context.close(); await pg.context.close()
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
    # This world has no night. At night people away lie down and sleep instead of strolling, and the world's clock is the
    # real Darwin clock, so this check used to fail whenever it was run between 8 pm and 6 am Darwin time (found 24 Nov 2026).
    DAY = {'night': {'from': 0, 'to': 0}}
    async with world(DAY) as W:
        a = await W.page('strollA', data=DAY); await join(a)
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn'); await a.wait_for_timeout(1000)
        b = await W.page('strollB', data=DAY); await join(b)
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


async def tasks_away():
    """Your person keeps working while the Menu is open, and after you leave the server carries on with your task list
    (0.1.7, server/src/tasks.js): things on it get done, Welcome back says so, and what's left comes back to your list."""
    away = {**json.load(open(os.path.join(HERE, '..', '..', 'test', 'game-data.json')))['away'], 'comeBackSeconds': 1}  # (the short break after leaving, cut down: a quick check)
    async with world({'away': away}) as W:
        a = await W.page('tasksA', data={'away': {'comeBackSeconds': 1}}); await join(a)
        here = "[__pl.player.position.x, __pl.player.position.z]"
        p0 = await a.evaluate(here)
        await a.evaluate("(() => { const p = __pl.player.position; __pl.queueTask({ type: 'walk', x: p.x + 5, z: p.z + 0.5 }); })()")
        await a.click('#menuBtn'); await a.wait_for_timeout(4500)
        p1 = await a.evaluate(here)
        moved = ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5
        expect(moved > 3.5, f'a walk carries on while the Menu is open ({moved:.1f} m)')
        await a.click('#resumeBtn')
        # the two nearest loose things to pick up, then a long walk, and Exit straight away
        ids = await a.evaluate("(() => { const p = __pl.player.position; return [...__pl.world.items].filter((it) => it.kind === 'stick' || it.kind === 'stone')"
                               ".sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z)).slice(0, 2).map((it) => it.id); })()")
        await a.evaluate(f"(() => {{ for (const id of {ids}) __pl.queueTask({{ type: 'pickup', id }}); __pl.queueTask({{ type: 'walk', x: -30, z: 30 }}); }})()")
        await a.wait_for_timeout(300)
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn')
        await a.wait_for_timeout(9000)
        await join(a)
        left = await a.evaluate(f"{ids}.filter((id) => __pl.getItem(id)).length")
        carried = await a.evaluate("Object.values(__pl.you.carry).reduce((n, c) => n + c, 0)")
        expect(left == 0 and carried >= 2, f'while you were away your person picked both up ({left} still on the ground, carrying {carried})')
        back = await a.evaluate("document.getElementById('backText').textContent")
        expect('on your task list' in back, f'Welcome back says so ({back})')
        rest = await a.evaluate("[__pl.tasks.current, ...__pl.tasks.list].filter(Boolean).map((t) => t.type)")
        expect(rest[:1] == ['walk'], f'the long walk still to finish is back on your list ({rest})')
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
        expect(not await a.evaluate("!!document.getElementById('craftBtn')"), 'no hammer button at the bottom: Craft is in the inventory')
        await a.click('#bagBtn'); await a.click('#bagCraft')
        expect(await shown(a, '#bag') and await a.evaluate("!document.getElementById('mat').hidden && !document.getElementById('matEmpty').hidden"), 'Craft in the inventory shows the craft mat, empty')
        await a.click('#bagClose')
        found = await a.evaluate("""(() => { const out = [];
          for (const f of [[], ['sharp-stone'], ['sharp-stone', 'knife', 'campfire']]) {
            __pl.you.carry = {}; __pl.you.found = f; document.getElementById('bagBtn').click(); document.getElementById('bagCraft').click(); document.getElementById('matTabFound').click();
            const rows = [...document.querySelectorAll('#foundList .found-row')], grey = (r) => r.classList.contains('not-made');
            out.push([rows.length, rows.filter(grey).length, rows.findIndex(grey), document.querySelectorAll('#foundChips .craft-chip').length, !document.getElementById('foundMore').hidden]);
            document.getElementById('bagClose').click(); }
          return out; })()""")
        n = found[0][0]
        expect(n > 3 and all(x[0] == n and x[1] == n - m and x[2] == m and x[3] >= 3 and x[4] for x, m in zip(found, [0, 1, 3])), f'Recipes lists every recipe: the ones you have made first, the rest greyed out, with Tools, Building and Materials buttons ({found})')
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
        await mat_make(a, [('log', 1), ('twig', 2), ('stone', 2)])
        expect(await a.evaluate('__pl.you.carry.campfire === 1 && !__pl.you.carry.log && __pl.you.carry.stick === 6 && !__pl.you.carry.stone && !__pl.you.carry.twig'), 'crafting a campfire uses 1 log, 2 twigs and 2 stones')
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
        await a.evaluate("document.getElementById('placeText').textContent = \"Too close to Alexandra's camp to start your own\"")
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
        expect('Light fire' not in acts and acts.index('Put out fire') > acts.index('Sit by the fire'), f'lit: Put out fire comes after Sit ({acts})')
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
        expect(not await a.evaluate(f'__pl.placed.has({fid2})') and n1 - n0 == 5, f'taken apart (never lit): its 5 parts land round it ({n1 - n0})')
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
        await a.click('#adminPickList >> text="Stick"'); await a.wait_for_timeout(900)  # (exactly Stick: the list is in name order, and Long stick comes first since 0.1.8)
        expect(await b.evaluate('__pl.you.carry.stick || 0') == sticks + 5, 'gave them 5 sticks')
        await a.click('#adminPlayer >> text=Take all'); await a.wait_for_timeout(900)
        expect(not await b.evaluate('__pl.you.carry.stick'), 'took them back')
        # live settings reach everyone, and Reset puts them back
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        await a.evaluate(f"({send})({{ t: 'a.live', id: 'hungerPerHour', value: 10 }})"); await a.wait_for_timeout(800)
        expect(await b.evaluate('__pl.STAT.hunger.perHour') == -10, 'live need rate reaches players')
        await a.click('[data-admin-tab="settings"]'); await a.wait_for_timeout(300)
        expect('Changed' in await text(a, '#adminSettings'), 'Settings shows it changed')
        expect('Things left on the ground fade after (0: never)' in await text(a, '#adminSettings') and 'Normal: 7 days' in await text(a, '#adminSettings'), 'Settings has how long things left on the ground last (7 days)')
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
        expect(await b.evaluate(f"(__pl.placed.get({fid}).claim || {{}}).name") == f"{name}'s camp", "the other phone sees whose claim it is (their society, 0.1.5)")
        why = await b.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {{ const w = __pl.cantPlaceAt(th.x + dx, th.z + dz, 'campfire'); if (w !== 'Not enough room here' && w !== 'Too close to another one') return w; }} return 'no clear spot'; }})()")
        expect(why == f"This belongs to {name}'s camp", f"can't place inside someone else's claim ({why})")
        acts = await b.evaluate(f"__pl.menuActions({{ kind: 'placed', th: __pl.placed.get({fid}), name: '' }}).map((x) => x.label)")
        expect(acts[0] == f"{name}'s camp" and 'Put out fire' not in acts, f'their fire menu only says whose claim it is ({acts})')
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


async def societies():
    """Societies (0.1.4, reworked 0.1.5): lighting your first fire starts your society ("<name>'s camp", players see camps), Menu > Camp
    renames it, invite someone by tapping them, they join from the invite card, name tags show it with 2 or more, members
    share the claim but only the leader puts the fire out, the admin's World tab lists and renames it, leaving takes two
    taps, and the last one out ends it with its fire."""
    async with world(CAMPKIT=1) as W:
        a = await W.page('leaderA'); await join(a)
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        name_a = await a.evaluate('__pl.you.look.name')
        # A lights a fire away from the pond: a claim and a society
        await a.evaluate(f"({send})({{ t: 'craft', id: 'campfire' }})"); await a.wait_for_timeout(800)
        await a.evaluate("__pl.queueTask({ type: 'walk', x: 28, z: 6 })"); await idle(a, 50); await a.wait_for_timeout(1500)
        spot = await a.evaluate("(() => { const p = __pl.player.position; for (let k = 0; k < 16; k++) { const ang = k / 16 * Math.PI * 2, x = p.x + Math.cos(ang) * 1.8, z = p.z + Math.sin(ang) * 1.8; if (!__pl.cantPlaceAt(x, z, 'campfire')) return [x, z]; } return null; })()")
        expect(spot is not None, f'a spot for the fire ({spot})')
        expect(await a.evaluate(f"__pl.claimHere({spot[0]:.2f}, {spot[1]:.2f}).text") == 'Light it to start your camp here', 'placing it says lighting it starts your camp')
        await a.evaluate(f"({send})({{ t: 'place', kind: 'campfire', x: {spot[0]:.2f}, z: {spot[1]:.2f}, rot: 0 }})"); await a.wait_for_timeout(800)
        fid = await a.evaluate("[...__pl.placed.keys()][0]")
        for m in [f"{{ t: 'build', id: {fid} }}", f"{{ t: 'fire', id: {fid}, do: 'add', n: 5, fuel: 'stick' }}", f"{{ t: 'fire', id: {fid}, do: 'light' }}"]:
            await a.evaluate(f"({send})({m})"); await a.wait_for_timeout(700)
        expect(await a.evaluate("(__pl.you.soc || {}).name") == f"{name_a}'s camp" and await a.evaluate(f"__pl.placed.get({fid}).claim.who") == 's:1', f"lighting it started A's society, {name_a}'s camp, holding the claim")
        # Menu > Society: rename it
        await a.click('#menuBtn'); await a.wait_for_timeout(400)
        await a.click('#pauseSocietyBtn'); await a.wait_for_timeout(400)
        expect(await text(a, '#socTitle') == f"{name_a}'s camp" and await shown(a, '#socNameForm') and 'You lead this camp' in await text(a, '#socText'), 'the Camp panel shows it, with a Rename box for the leader')
        await a.fill('#socName', 'Rivers'); await a.click('#socNameForm button[type=submit]'); await a.wait_for_timeout(1500)
        expect(await a.evaluate("(__pl.you.soc || {}).name") == 'Rivers' and await text(a, '#socTitle') == 'Rivers', 'A renamed it Rivers')
        expect(await text(a, '#socLeave') == 'End camp' and 'fire goes out' in await text(a, '#socFoot'), 'alone, Leave says End camp: its fire goes out')
        await shot(a, 'society-panel')
        await a.click('#socClose'); await a.wait_for_timeout(300)
        # B comes over; A taps B: Invite to camp
        b = await W.page('memberB'); await join(b); await b.wait_for_timeout(800)
        ax, az = await a.evaluate("[__pl.player.position.x, __pl.player.position.z]")
        await b.evaluate(f"__pl.queueTask({{ type: 'walk', x: {ax + 1.6:.2f}, z: {az:.2f} }})"); await idle(b, 60); await b.wait_for_timeout(1500)
        expect(await b.evaluate(f"!!__pl.notMineAt({spot[0]:.2f}, {spot[1]:.2f})"), "B isn't in Rivers yet: its claim is someone else's to B")
        pick = "(() => { const o = [...__pl.others.values()][0]; return __pl.menuActions({ kind: 'person', person: o, name: o.title }); })()"
        acts = await a.evaluate(f"{pick}.map((x) => [x.label, !!x.disabled, x.note || ''])")
        inv = next((x for x in acts if x[0] == 'Invite to camp'), None)
        expect(inv is not None and not inv[1], f"A's tap menu on B has Invite to camp ({acts})")
        await a.evaluate(f"{pick}.find((x) => x.label === 'Invite to camp').run()")
        await b.wait_for_function("!document.getElementById('socInvite').hidden", timeout=20000)
        expect(await text(b, '#socInviteText') == f'{name_a} invites you to join Rivers', f"B's invite card says who and which ({await text(b, '#socInviteText')})")
        await shot(b, 'society-invite')
        await b.click('#socYes'); await b.wait_for_timeout(2000)
        expect(await b.evaluate("(__pl.you.soc || {}).name") == 'Rivers' and not await shown(b, '#socInvite'), 'B tapped Join: B is in Rivers and the card is gone')
        expect(not await b.evaluate(f"!!__pl.notMineAt({spot[0]:.2f}, {spot[1]:.2f})"), "now B can use things in Rivers' claim")
        tag = await a.evaluate("[...__pl.others.values()][0].name.el.textContent")
        expect('Rivers' in tag, f"with 2 in it, A sees Rivers under B's name ({tag})")
        expect(await b.evaluate("__pl.claimHere(0, 0).text") == "You're in Rivers, so this is just a fire", "B's own fires are just fires")
        out = await b.evaluate(f"__pl.placedActions(__pl.placed.get({fid})).filter((x) => x.label === 'Put out fire').map((x) => [!!x.disabled, x.note || ''])")
        expect(out == [[True, f'Only {name_a} can put it out']], f"only the leader can put Rivers' fire out ({out})")
        # the admin's World tab lists it; Members, then Rename
        c = await W.page('adminC'); await open_admin(c)
        await c.click('#adminDashBtn'); await c.click('[data-admin-tab="world"]'); await c.wait_for_timeout(1500)
        r = await text(c, '#adminSocs')
        expect('Rivers' in r and '2 of 3' in r and 'claim burning' in r and await text(c, '#adminSocsState') == '1 society', f'the admin sees Rivers, 2 of 3, with its claim ("{r}")')
        await c.click('#adminSocs button:has-text("Members")'); await c.wait_for_timeout(500)
        await c.fill('#adminSocs input.admin-input', 'Riverside'); await c.click('#adminSocs button:has-text("Rename")'); await c.wait_for_timeout(1500)
        await shot(c, 'society-admin')
        expect(await a.evaluate("(__pl.you.soc || {}).name") == 'Riverside' and 'Riverside' in await a.evaluate("[...__pl.others.values()][0].name.el.textContent"), "the admin renamed it: A's game and B's name tag say Riverside")
        await c.close()
        # B leaves from the panel: two taps
        await b.click('#menuBtn'); await b.wait_for_timeout(400); await b.click('#pauseSocietyBtn'); await b.wait_for_timeout(400)
        names = await b.evaluate("[...document.querySelectorAll('#socMembers .soc-who')].map((e) => e.textContent)")
        expect(len(names) == 2 and names[0].startswith(name_a) and 'Leader' in names[0] and not await shown(b, '#socNameForm'), f'the panel lists both, the leader first, and no Rename for B ({names})')
        await b.click('#socLeave'); await b.wait_for_timeout(700)
        expect(await b.evaluate("(__pl.you.soc || {}).name") == 'Riverside', 'one tap on Leave does nothing yet')
        await b.click('#socLeave'); await b.wait_for_timeout(2000)
        expect(await b.evaluate("__pl.you.soc") is None and await b.evaluate(f"!!__pl.notMineAt({spot[0]:.2f}, {spot[1]:.2f})"), "the second tap: B left, and Riverside's claim is someone else's again")
        tag = await a.evaluate("[...__pl.others.values()][0].name.el.textContent")
        expect('Riverside' not in tag, f"B's name tag lost the line ({tag})")
        # A, alone again, ends it: the fire goes out
        await a.click('#menuBtn'); await a.wait_for_timeout(400); await a.click('#pauseSocietyBtn'); await a.wait_for_timeout(400)
        await a.click('#socLeave'); await a.wait_for_timeout(700); await a.click('#socLeave'); await a.wait_for_timeout(2000)
        expect(await a.evaluate("__pl.you.soc") is None and not await a.evaluate(f"__pl.isLit(__pl.placed.get({fid}))") and not await a.evaluate(f"!!__pl.placed.get({fid}).claim"), 'A ended it: no society, and its fire is out')
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
    """Maintenance pauses people who aren't playing: their needs stop, then carry on afterwards. It's run from admin mode, which stays in; someone playing on the release link is shut out; and the admin can still get in from the release link (5 taps on Back soon) to turn it off."""
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
        # (it moves again: down, or up if they were hungry enough to eat in those seconds. It used to say "carries on
        # dropping", which failed whenever hunger happened to cross 60, where someone away eats: 25 Nov 2026)
        expect(abs(h5 - h4) > 1, f'afterwards their needs move again ({h4:.1f} to {h5:.1f})')
        # The admin has to be able to get in from the release link while maintenance is on (to turn it off): there the main
        # menu is behind Back soon, so 5 taps on those words open the password box. The new game is opened under an address
        # without /test/ in it, which makes it a release-link game, as it will be once released.
        nxt = os.path.join(HERE, '..', '..', 'release-next')
        if not os.path.lexists(nxt): os.symlink('test', nxt)
        try:
            await a.evaluate(f"({send})({{ t: 'a.maintenance', on: true, text: 'Tidying up' }})"); await a.wait_for_timeout(600)
            d = await W.page('adminOnRelease', path='release-next/')
            st = await d.evaluate("({ maint: !document.getElementById('maint').hidden, mode: __pl.ui.mode, link: window.__sent.filter((m) => m.t === 'hello')[0].link })")
            expect(st == {'maint': True, 'mode': 'menu', 'link': 'release'}, f'on the release link during maintenance, the admin sees Back soon like everyone ({st})')
            for attempt in range(4):
                await tap_version(d, 5, 'maintTitle')
                if await shown(d, '#adminLogin'): break
                await d.wait_for_timeout(4500)
            expect(await shown(d, '#adminLogin'), '5 taps on the words Back soon ask for the password')
            # a wrong password: refused, still Back soon, and never sent again when the game next looks in
            await d.fill('#adminLoginCode', 'not-the-password'); await d.click('#adminLoginGo')
            await d.wait_for_function('!__pl.adminMode.asking', timeout=40000); await d.wait_for_timeout(500)
            st = await d.evaluate("({ on: __pl.adminMode.on, kept: __pl.adminMode.hasCode, maint: !document.getElementById('maint').hidden, box: !document.getElementById('adminLogin').hidden, note: document.getElementById('adminLoginNote').textContent })")
            expect(not st['on'] and not st['kept'] and st['maint'] and st['box'] and "didn't work" in st['note'], f"a wrong password there is refused and forgotten, and Back soon stays ({st})")
            hellos = "window.__sent.filter((m) => m.t === 'hello')"
            n0, c0 = await d.evaluate(f'[{hellos}.length, {hellos}.filter((m) => m.adminCode).length]')
            await d.wait_for_timeout(24000)  # (it looks in again every 20 seconds while Back soon is up)
            n1, c1 = await d.evaluate(f'[{hellos}.length, {hellos}.filter((m) => m.adminCode).length]')
            expect(n1 > n0 and c1 == c0, f'when the game looks in again it does not send the refused password ({n1 - n0} more looks, {c1 - c0} with a password)')
            # the right password: in, Back soon gone, and maintenance can be turned off from there
            await d.fill('#adminLoginCode', 'secret123456'); await d.click('#adminLoginGo')
            await d.wait_for_function('__pl.adminMode.on', timeout=40000); await d.wait_for_timeout(600)
            st = await d.evaluate("({ mode: __pl.ui.mode, maint: !document.getElementById('maint').hidden, person: !!__pl.player, box: !document.getElementById('adminLogin').hidden })")
            expect(st == {'mode': 'admin', 'maint': False, 'person': False, 'box': False}, f'the right password opens admin mode over the live world, with Back soon gone ({st})')
            await d.click('#adminDashBtn'); await d.click('[data-admin-tab="server"]'); await d.wait_for_timeout(600)
            expect(await d.evaluate("document.getElementById('adminMaintBtn').textContent") == 'Turn off', 'its dashboard knows maintenance is on')
            await d.click('#adminMaintBtn'); await d.wait_for_timeout(1500)
            await a.evaluate(f"({send})({{ t: 'a.state' }})"); await a.wait_for_timeout(1200)
            expect(await a.evaluate('__pl.admin.maintenance') is False, 'and turns it off from there (the other admin screen sees it is off)')
        finally:
            if os.path.islink(nxt): os.remove(nxt)
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
        await a.click('#bagBtn'); await a.click('#bagCraft'); await a.click('#bagList .bag-tile[data-kind="fish"]')
        mat = await a.evaluate("[document.getElementById('matName').textContent, document.getElementById('matWhy').textContent, document.getElementById('matMake').disabled]")
        expect(mat == ['Cooked fish', 'Cook this on a lit campfire', True], f'raw fish on the craft mat says to cook it on a lit campfire, and the mat won\'t make it ({mat})')
        await a.click('#bagClose')
        await a.evaluate(f"__pl.queueTask({{ type: 'make', id: {fid}, recipe: 'cooked-fish' }})"); await idle(a, 40); await a.wait_for_timeout(800)
        made = await a.evaluate("[__pl.you.carry.fish || 0, __pl.you.carry['cooked-fish'] || 0]")
        expect(made == [1, 1], f'cooking uses a fish and makes cooked fish ({made})')
        # (wait for the server's answer, not a set time: on a slow computer with two games open it can take over a second)
        t0 = await a.evaluate('performance.now()')
        await a.evaluate("__pl.sendAct({ t: 'eat', kind: 'cooked-fish' })")
        try: await a.wait_for_function("!(__pl.you.carry['cooked-fish'])", timeout=10000, polling=50)
        except Exception: pass
        took = await a.evaluate('performance.now()') - t0
        ate = await a.evaluate("[__pl.you.carry['cooked-fish'] || 0, __pl.you.stats.hunger]")
        expect(ate[0] == 0 and ate[1] > 95, f'eating cooked fish fills you up ({ate}, the answer took {took:.0f} ms)')
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


async def tap_version(pg, n, what='menuVer'):
    """Tap the version number (or another thing, by id) n times the way a person does: a finger on a phone, a mouse on a computer, one after another.
    (pg.click waits for the page to settle before each one, which takes seconds on this computer's software 3D: not how anyone taps.)"""
    x, y = await pg.evaluate(f"(() => {{ const r = document.getElementById('{what}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()")
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
            # (something for the dashboard to hold: the Log, which has at least "Admin mode opened")
            await pg.click('#adminDashBtn'); await pg.click('[data-admin-tab="log"]')
            await pg.wait_for_function("document.querySelectorAll('#adminLog .admin-logline').length > 0 && __pl.adminData.logData", timeout=8000)
            # Exit: the main menu again, the password forgotten, the camera as a player has it
            await pg.click('#adminExit'); await pg.wait_for_timeout(1200)
            left = await pg.evaluate("({ shown: ['adminLog', 'adminInbox', 'adminPlayers', 'adminPlayer', 'adminFires', 'adminItems'].filter((id) => document.getElementById(id).childElementCount), kept: Object.entries(__pl.adminData).filter(([k, v]) => k !== 'adminTab' && v != null).map(([k]) => k), panel: !document.getElementById('adminPanel').hidden })")
            expect(left == {'shown': [], 'kept': [], 'panel': False}, f'{tag}: nothing the dashboard showed stays on the page after Exit ({left})')
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
        await a.click('#adminPickCount >> text=5'); await a.fill('#adminPickFind', 'stone'); await a.click('#adminPickList >> text="Stone"'); await a.wait_for_timeout(1500)  # (exactly Stone, not Sharp stone, which comes first in name order since 0.1.8)
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
        # a tree and a rock laid out with the world: their own menus, and Remove (which asks first). The view is put over one,
        # then the screen is searched for a spot where a tap really lands on it (another tree can stand in the way).
        for what, left, title in [('tree', "__pl.trees.filter((t) => t.state === 'tree').length", ('Tree', 'Pine tree')), ('rock', "__pl.rocks.filter((r) => r.state !== 'gone').length", ('Rock', 'Boulder'))]:
            await a.evaluate(f"""(() => {{ const c = __pl.controls, list = __pl.{what}s.filter((t) => t.state === '{'tree' if what == 'tree' else 'whole'}');
                const t = list.sort((p, q) => Math.hypot(p.x - c.target.x, p.z - c.target.z) - Math.hypot(q.x - c.target.x, q.z - c.target.z))[0];
                const dx = t.x - c.target.x, dz = t.z - c.target.z; c.target.x += dx; c.target.z += dz; __pl.camera.position.x += dx; __pl.camera.position.z += dz; }})()""")
            await frames(a, 3)
            spot = await a.evaluate(f"""(() => {{ const c = document.getElementById('world').getBoundingClientRect(), mx = c.left + c.width / 2, my = c.top + c.height / 2;
                for (let r = 0; r < 260; r += 12) for (let k = 0; k < (r ? 12 : 1); k++) {{ const x = mx + Math.cos(k / 12 * 6.283) * r, y = my + Math.sin(k / 12 * 6.283) * r;
                  if (x < 400 || x > c.right - 20 || y < 80 || y > c.bottom - 20) continue; const t = __pl.adminAt(x, y); if (t.kind === '{what}') return [x, y, t.name, t.acts]; }}
                return null; }})()""")
            expect(spot is not None and spot[2] in title, f'a {what} near the middle of the view can be tapped ({spot})')
            n0 = await b.evaluate(left)
            await a.mouse.click(spot[0], spot[1]); await a.wait_for_timeout(600)
            m = await menu()
            expect(m['shown'] and m['title'] in title and 'Move' in m['acts'] and 'Remove' in m['acts'], f"tapping a {what} offers Move and Remove ({m})")
            await a.click('#actList >> text=Remove'); await a.wait_for_timeout(400)
            m = await menu()
            expect(m['shown'] and 'Yes, remove' in m['acts'] and 'Move' not in m['acts'] and await b.evaluate(left) == n0, f"Remove asks first, and nothing is gone yet ({m['acts']})")
            await a.click('#actList >> text=Yes, remove'); await a.wait_for_timeout(1500)
            expect(await b.evaluate(left) == n0 - 1, f"then the {what} is gone in the player's game too ({n0} to {await b.evaluate(left)})")
        st = await a.evaluate("({ mode: __pl.ui.mode, person: !!__pl.player })")
        expect(st['mode'] == 'admin' and not st['person'], f'the admin is still in admin mode with no person ({st})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def live_items_game():
    """The admin's item and recipe numbers reach a player's own game: the weight they carry, what a recipe needs and whether they can make it, and someone joining later gets the same."""
    card = """(() => { const c = document.querySelector('#foundList .found-row[data-recipe="knife"]'); if (!c) return null;
      const chips = [...c.querySelectorAll('.need-chip')]; return { chips: chips.map((x) => x.textContent), canMake: chips.every((x) => x.classList.contains('ok')) }; })()"""
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
        # the knife recipe, as the player sees it in Found (0.1.8): they knock 2 stones into a sharp stone, then the admin gives them every recipe
        await mat_make(p, [('stone', 2)])
        pid = await p.evaluate('__pl.net.myId')
        told = await ask(f"{{ t: 'a.found', id: '{pid}', all: true }}")
        await p.wait_for_function("__pl.you.found.includes('knife')", timeout=20000)
        expect('found every recipe' in str(told), f'the admin gives them every recipe ({told})')
        await p.click('#bagBtn'); await p.click('#bagCraft'); await p.click('#matTabFound'); await p.wait_for_function(f"!!({card})", timeout=20000)
        c0 = await p.evaluate(card)
        expect(c0['canMake'] and c0['chips'] == ['Sharp stones 1/1', 'Sticks 1/1', 'Twine 1/1'], f"the player can make a stone knife from what they carry ({c0['chips']})")
        await ask("{ t: 'a.liveItem', at: ['recipes', 'knife', 'needs', 'stick'], value: 3 }")
        await p.wait_for_function(f"(() => {{ const c = {card}; return c && !c.canMake; }})()", timeout=20000)
        c1 = await p.evaluate(card)
        expect(not c1['canMake'] and c1['chips'] == ['Sharp stones 1/1', 'Sticks 2/3', 'Twine 1/1'], f"a knife made to need 3 sticks: the open Recipes list shows it and they can't make one with 2 ({c1['chips']})")
        # back to the game file's numbers
        expect(await ask("{ t: 'a.liveItem', at: ['recipes', 'knife', 'needs', 'stick'], value: null }") == 'Back to what the game file says', 'Reset answers plainly')
        await ask("{ t: 'a.liveItem', at: ['items', 'stick', 'weight'], value: null }")
        await p.wait_for_function(f"(() => {{ const c = {card}; return c && c.canMake; }})() && Number(document.getElementById('carryWeight').textContent) === 7", timeout=20000)
        expect(await weight(p) == 7 and (await p.evaluate(card))['canMake'], 'Reset puts both back for the player: 7 carried (2 stones became a sharp stone), and the knife can be made again')
        # someone who joins later gets the admin's numbers on the way in
        await ask("{ t: 'a.liveItem', at: ['items', 'stick', 'weight'], value: 2 }")
        q = await W.page('liveQ'); await join(q)
        expect(await weight(q) == 10, f'someone joining afterwards carries 10 (their 2 sticks weigh 2 each) ({await weight(q)})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def admin_items():
    """The Items tab in admin mode: find an item, change a number with the real box and Save, see it marked changed with what it was, a player's game follows, Copy my changes lists it, Reset puts it back."""
    rows = """(() => [...document.querySelectorAll('#adminItems > *')].map((r) => r.classList.contains('admin-item-head') ? { head: r.textContent }
      : { label: r.querySelector('.admin-body').textContent, tag: r.querySelector('.admin-tag').textContent, value: r.querySelector('input').value, btns: [...r.querySelectorAll('button')].map((b) => b.textContent) }))()"""
    async with world(TESTKIT=1) as W:
        p = await W.page('itemsP'); await join(p)
        a = await W.page('itemsA', 1440, 900); await open_admin(a)
        await a.click('#adminDashBtn'); await a.wait_for_timeout(300)
        await a.click('[data-admin-tab="items"]')
        await a.wait_for_function("document.querySelectorAll('#adminItems .admin-setting').length > 20", timeout=20000)
        all_rows = await a.evaluate(rows)
        heads = [r['head'] for r in all_rows if 'head' in r]
        expect(len(heads) == len(set(heads)) and heads == sorted(heads, key=str.lower) and 'Stone knife' in heads and 'Berry' in heads, f'every item is listed once, A to Z ({len(heads)} headings, {len(all_rows) - len(heads)} numbers)')
        expect('All as the game file has them' in await text(a, '#adminItemsState') and await a.evaluate("document.getElementById('adminItemsCopy').disabled"), 'to start nothing is changed, and there is nothing to copy')
        # find the stone knife: its own numbers and its recipe's, together
        await a.fill('#adminItemsFind', 'stone knife'); await a.wait_for_timeout(500)
        kn = await a.evaluate(rows)
        labels = [r['label'] for r in kn if 'label' in r]
        expect([r.get('head') for r in kn if 'head' in r] == ['Stone knife'] and labels == ['Weight', 'Uses before it wears out', 'Recipe needs: sharp stones', 'Recipe needs: sticks', 'Recipe needs: twine', 'Recipe makes: stone knives'], f'search finds the stone knife with its own numbers and its recipe ({labels})')
        # change its weight in the real box
        w0 = await p.evaluate("Number(document.getElementById('carryWeight').textContent)")
        await a.fill('#adminItems .admin-setting >> nth=0 >> input', '4')
        await a.click('#adminItems .admin-setting >> nth=0 >> text=Save')
        await a.wait_for_function(f"(({rows}).find((r) => r.label === 'Weight') || {{}}).tag === 'Changed (was 1)'", timeout=20000)
        row = [r for r in await a.evaluate(rows) if r.get('label') == 'Weight'][0]
        expect(row['value'] == '4' and row['tag'] == 'Changed (was 1)' and row['btns'] == ['Save', 'Reset'], f'Save marks it changed with what it was, and offers Reset ({row})')
        expect('1 changed' in await text(a, '#adminItemsState'), f"the tab says how many are changed ({await text(a, '#adminItemsState')})")
        # a player carrying nothing that changed is unaffected; give them a knife and it weighs 4
        await a.evaluate(f"window.__sock.send(JSON.stringify({{ t: 'a.give', id: '{await p.evaluate('__pl.net.myId')}', kind: 'knife', n: 1 }}))")
        carried = "Number(document.getElementById('carryWeight').textContent)"
        try: await p.wait_for_function(f"{carried} === {w0 + 4}", timeout=20000)
        except Exception: pass  # (the line below says what it was instead)
        w1 = await p.evaluate(carried)
        expect(w1 == w0 + 4, f"a knife in a player's bag now weighs 4 in their own game ({w0} to {w1} carried)")
        # Copy my changes
        await a.click('#adminItemsCopy'); await a.wait_for_timeout(600)
        copied = await a.evaluate("document.getElementById('adminItemsText').hidden ? '' : document.getElementById('adminItemsText').value")
        expect('items.knife.weight: 1 -> 4' in copied and copied.count('->') == 1, f'Copy my changes lists exactly that change ({copied!r})')
        # Reset
        await a.click('#adminItems .admin-setting >> nth=0 >> text=Reset')
        await a.wait_for_function(f"(({rows}).find((r) => r.label === 'Weight') || {{}}).tag === 'Game file: 1'", timeout=20000)
        row = [r for r in await a.evaluate(rows) if r.get('label') == 'Weight'][0]
        expect(row['value'] == '1' and row['btns'] == ['Save'], f'Reset puts the game file\'s number back ({row})')
        await p.wait_for_function(f"Number(document.getElementById('carryWeight').textContent) === {w0 + 1}", timeout=20000)
        expect('All as the game file has them' in await text(a, '#adminItemsState'), "and the player's knife weighs 1 again; nothing is marked changed")
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def admin_follow():
    """Admin mode: following someone. The camera goes with them as they walk, turning doesn't stop it, moving the view yourself does, and so does the chip or them leaving."""
    async with world() as W:
        b = await W.page('followed'); await join(b)
        a = await W.page('follower', 1440, 900); await open_admin(a)
        who = await b.evaluate('__pl.net.myId'); name = await b.evaluate('__pl.you.look.name')
        gap = lambda: a.evaluate(f"(() => {{ const o = __pl.others.get('{who}'), t = __pl.controls.target; return o ? Math.hypot(o.mesh.position.x - t.x, o.mesh.position.z - t.z) : -1; }})()")
        # (on: who the game says it is following. 'none' when nobody, so a missing value can never pass for 'stopped')
        st = lambda: a.evaluate("(() => { const f = __pl.adminMode.follow; return { on: f === undefined ? 'MISSING' : f === null ? 'none' : f, chip: document.getElementById('adminFollow').hidden ? '' : document.getElementById('adminFollow').textContent }; })()")
        # from their menu in the world
        p = await a.evaluate(f"(() => {{ const o = __pl.others.get('{who}'); return [o.mesh.position.x, o.mesh.position.y, o.mesh.position.z]; }})()")
        sx, sy, front = await a.evaluate(f"({SCREEN})({p[0]}, {p[1] + 0.9}, {p[2]})")
        await a.mouse.click(sx, sy); await a.wait_for_timeout(600)
        await a.click('#actList >> text=Follow them'); await frames(a, 3)
        s0 = await st()
        expect(s0['on'] == who, f"Follow them starts following that person (following {s0['on']}, they are {who})")
        expect(s0['chip'] == f'Following {name} · tap to stop', f"and a chip says so ({s0['chip']})")
        expect(await gap() < 1, f'the view is on them ({await gap():.2f} m off)')
        # they walk 12 m: once they've stopped, the view is on them again
        start = await b.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        await b.evaluate("__pl.queueTask({ type: 'walk', x: __pl.player.position.x + 9, z: __pl.player.position.z + 8 })"); await idle(b, 60)
        end = await b.evaluate('[__pl.player.position.x, __pl.player.position.z]')
        walked = ((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2) ** 0.5
        await frames(a, 30, 180000)  # (each frame closes a fifth of the gap, and this computer draws about one or two a second)
        expect(walked > 8 and (await st())['on'] == who and await gap() < 1.5, f'they walked {walked:.1f} m and the view went with them ({await gap():.2f} m off)')
        # turning the view doesn't stop it
        await a.keyboard.down('KeyQ'); await frames(a, 8); await a.keyboard.up('KeyQ'); await frames(a, 8)
        expect((await st())['on'] == who and await gap() < 1.5, 'turning the view (Q) keeps following')
        # moving the view yourself does
        await a.keyboard.down('KeyW'); await frames(a, 6); await a.keyboard.up('KeyW'); await frames(a, 4)
        s1 = await st()
        expect(s1['on'] == 'none' and s1['chip'] == '', f'moving the view yourself (W) stops following, and the chip goes ({s1})')
        # from their page in the dashboard, then the chip stops it
        await a.click('#adminDashBtn'); await a.click('[data-admin-tab="players"]'); await a.wait_for_function("document.querySelectorAll('#adminPlayers .admin-entry.tap').length > 0", timeout=20000)
        await a.click('#adminPlayers .admin-entry.tap'); await a.wait_for_function("[...document.querySelectorAll('#adminPlayer button')].some((x) => x.textContent === 'Follow')", timeout=20000)
        await a.click('#adminPlayer >> text="Follow"'); await frames(a, 3)
        expect((await st())['on'] == who, 'Follow on their page starts it too')
        await a.click('#adminFollow'); await a.wait_for_timeout(300)
        s2 = await st()
        expect(s2['on'] == 'none' and s2['chip'] == '', f'tapping the chip stops it ({s2})')
        # they leave the world while being followed
        await a.click('#adminPlayer >> text="Follow"'); await frames(a, 3)
        await b.context.close(); await a.wait_for_timeout(1500)
        await a.evaluate(f"window.__sock.send(JSON.stringify({{ t: 'a.removePerson', id: '{who}' }}))")
        await a.wait_for_function("__pl.adminMode.follow === null", timeout=60000)
        s3 = await st()
        expect(s3['on'] == 'none' and s3['chip'] == '', f'when they leave the world, following stops by itself ({s3})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def admin_extras():
    """Admin mode, the tools added last: a fire's fuel, flame and claim from the World tab and from the fire's own menu; a person's needs, age and name typed in and a message only they see; the Log. The player's own game is the witness."""
    async with world(CAMPKIT=1) as W:
        b = await W.page('firePlayer'); await join(b)
        send = "(m) => window.__sock.send(JSON.stringify(m))"
        # the player makes a campfire away from the pond and lights it, the way a player does: it's their claim
        await b.evaluate(f"({send})({{ t: 'craft', id: 'campfire' }})"); await b.wait_for_timeout(800)
        await b.evaluate("__pl.queueTask({ type: 'walk', x: 28, z: 6 })"); await idle(b, 50); await b.wait_for_timeout(1500)
        spot = await b.evaluate("(() => { const p = __pl.player.position; for (let k = 0; k < 16; k++) { const ang = k / 16 * Math.PI * 2, x = p.x + Math.cos(ang) * 1.8, z = p.z + Math.sin(ang) * 1.8; if (!__pl.cantPlaceAt(x, z, 'campfire')) return [x, z]; } return null; })()")
        expect(spot is not None, f'a spot for the campfire ({spot})')
        await b.evaluate(f"({send})({{ t: 'place', kind: 'campfire', x: {spot[0]:.2f}, z: {spot[1]:.2f}, rot: 0 }})"); await b.wait_for_timeout(800)
        fid = await b.evaluate("[...__pl.placed.keys()][0]")
        for m in [f"{{ t: 'build', id: {fid} }}", f"{{ t: 'fire', id: {fid}, do: 'add', n: 5, fuel: 'stick' }}", f"{{ t: 'fire', id: {fid}, do: 'light' }}"]:
            await b.evaluate(f"({send})({m})"); await b.wait_for_timeout(700)
        who = await b.evaluate('__pl.net.myId')
        name = await b.evaluate('__pl.you.look.name')
        fire = lambda: b.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); return {{ lit: __pl.isLit(th), claim: th.claim ? th.claim.name : '', fuel: th.fuel }}; }})()")
        f = await fire()
        expect(f['lit'] and f['claim'] == f"{name}'s camp", f"the player's fire burns and is their claim, as their society ({f})")

        a = await W.page('fireAdmin', 1440, 900); await open_admin(a)
        # what the admin is told: every line shown under the bar is kept as it appears (a line is only up for a few seconds,
        # and on this computer reading it afterwards can come too late)
        await a.evaluate("(() => { window.__told = []; const t = document.getElementById('adminToast'); new MutationObserver(() => { if (!t.hidden && t.textContent) window.__told.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true }); })()")
        toast = lambda: a.evaluate("window.__told[window.__told.length - 1] || ''")
        row = lambda: a.evaluate("(() => { const e = document.querySelector('#adminFires [data-fire]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()")
        tap_twice = lambda label: a.evaluate(f"(async () => {{ const find = () => [...document.querySelectorAll('#adminFires button')].find((x) => x.textContent === '{label}' || x.textContent.startsWith('Tap again')); const b1 = find(); if (!b1) return 'no button'; b1.click(); await new Promise((r) => setTimeout(r, 900)); const b2 = find(); if (!b2) return 'gone'; const said = b2.textContent; b2.click(); return said; }})()")
        await a.click('#adminDashBtn'); await a.click('[data-admin-tab="world"]')
        await a.wait_for_function("document.querySelectorAll('#adminFires [data-fire]').length === 1", timeout=8000)
        r = await row()
        expect(f"{name}'s camp" in r and 'claim · burning' in r and await a.evaluate("document.getElementById('adminFiresState').textContent") == '1 fire · 1 claim', f'the World tab lists the fire as their claim, burning ("{r}")')
        await shot(a, 'admin-extras-1-world-pc')
        # its fuel, typed in hours
        await a.click('#adminFires >> text=More')
        await a.fill('#adminFires input[type=number]', '2'); await a.click('#adminFires >> text=Set fuel'); await a.wait_for_timeout(1500)
        f = await fire()
        expect(abs(f['fuel'] - 2 * 3600000) < 120000 and f['lit'] and f['claim'] == f"{name}'s camp", f"Set fuel 2: the player's game has two hours on the fire, still burning, still theirs ({f['fuel'] / 60000:.0f} min)")
        said = await toast()
        expect(said == '2 h of fuel', f'the admin is told ("{said}")')
        # End claim: the land is free, the fire burns on
        asked = await tap_twice('End claim'); await a.wait_for_timeout(1500)
        f = await fire()
        expect(asked.startswith('Tap again') and f['lit'] and f['claim'] == '', f'End claim asks to tap again, then the fire burns on as nobody\'s claim ({f}; button said "{asked}")')
        r = await row()
        expect('claim' not in r.split(' · ')[0] and f'built by {name}' in r, f'the list shows it as a plain fire the player built ("{r}")')
        # give it back
        await a.select_option('#adminFires select', who); await a.click('#adminFires >> text=Give claim'); await a.wait_for_timeout(1500)
        f = await fire()
        expect(f['claim'] == f"{name}'s camp" and f['lit'], f"Give claim: it's the player's claim (and society) again ({f})")
        said = await toast()
        expect(said == f"Now {name}'s claim, as {name}'s camp", f'the admin is told ("{said}")')
        # Put out: asks again because it ends their claim
        asked = await tap_twice('Put out'); await a.wait_for_timeout(1500)
        f = await fire()
        expect(name in asked and not f['lit'] and f['claim'] == '', f'Put out warns it ends their claim, then the fire is out and the claim gone ({f}; button said "{asked}")')
        # the fire's own menu, tapped in the world: Light, then Put out. The player steps away first, or the tap can land on
        # them standing by the fire (it did from 0.1.3 at least, found 24 Nov 2026)
        await b.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); __pl.queueTask({{ type: 'walk', x: th.x + 6, z: th.z + 6 }}); }})()"); await idle(b, 30)
        menu = lambda: a.evaluate("({ shown: !document.getElementById('actMenu').hidden, title: document.getElementById('actTitle').textContent, acts: [...document.querySelectorAll('#actList .act-btn')].map((x) => x.firstChild.textContent) })")
        fx, fy, fz = await a.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); return [th.x, __pl.controls.target.y, th.z]; }})()")
        await a.click('#adminFires >> text=Fly to'); await frames(a, 3)
        fx, fy, fz = await a.evaluate(f"(() => {{ const th = __pl.placed.get({fid}); return [th.x, __pl.controls.target.y - 0.8, th.z]; }})()")
        sx, sy, front = await a.evaluate(f"({SCREEN})({fx}, {fy}, {fz})")
        expect(front and 400 < sx < 1400 and 80 < sy < 860, f'Fly to puts the fire in view ({sx:.0f}, {sy:.0f})')
        await a.mouse.click(sx, sy); await a.wait_for_timeout(600)
        m = await menu()
        expect(m['shown'] and 'Light' in m['acts'] and 'Fires and claims' in m['acts'] and 'Move' in m['acts'], f"tapping the fire in the world offers Light and the rest ({m})")
        await a.click('#actList >> text=Light'); await a.wait_for_timeout(1500)
        f, said = await fire(), await toast()
        expect(f['lit'] and f['claim'] == '' and said.startswith('Lit'), f'Light from its menu lights it, as nobody\'s claim ({f}; "{said}")')
        await a.mouse.click(sx, sy); await a.wait_for_timeout(600)
        m = await menu()
        expect(m['shown'] and 'Put out' in m['acts'] and 'Light' not in m['acts'], f"now its menu offers Put out ({m['acts']})")
        await a.click('#actList >> text=Put out'); await a.wait_for_timeout(1500)
        expect(not (await fire())['lit'], 'and Put out from its menu puts it out')

        # a person's page: needs and age typed in
        await a.click('[data-admin-tab="players"]'); await a.wait_for_timeout(1200)
        await a.click(f'#adminPlayers >> text={name}'); await a.wait_for_function("document.querySelector('#adminPlayer .admin-stat')", timeout=8000)
        st0 = await b.evaluate('__pl.you.stats')
        await a.click('#adminPlayer >> text=Edit needs and age')
        labels = await a.evaluate("[...document.querySelectorAll('#adminPlayer .admin-edit label')].map((l) => l.firstChild.textContent)")
        expect('Hunger' in labels and 'Age' in labels and len(labels) == len(st0) + 1, f'every need and their age can be typed ({labels})')
        await shot(a, 'admin-extras-2-person-pc')
        await a.fill('#adminPlayer .admin-edit label:has-text("Hunger") input', '12'); await a.fill('#adminPlayer .admin-edit label:has-text("Age") input', '44')
        await a.click('#adminPlayer >> text=Save'); await a.wait_for_timeout(1500)
        st = await b.evaluate('__pl.you.stats')
        expect(abs(st['hunger'] - 12) < 1.5 and await b.evaluate('__pl.you.look.age') == 44, f"their own game has hunger 12 and age 44 ({st['hunger']:.1f}, {await b.evaluate('__pl.you.look.age')})")
        expect(abs(st['thirst'] - st0['thirst']) < 3 and abs(st['health'] - st0['health']) < 3, f"the needs that weren't touched stay as they were (thirst {st0['thirst']:.1f} to {st['thirst']:.1f})")
        expect(await a.evaluate("!document.querySelector('#adminPlayer .admin-edit')"), 'and the boxes close again')
        # a new name
        await a.fill('#adminPlayer input[aria-label="Name"]', 'Robin'); await a.click('#adminPlayer >> text=Rename'); await a.wait_for_timeout(1500)
        got = await b.evaluate("[__pl.you.look.name, document.getElementById('hudName').textContent]")
        expect(got == ['Robin', 'Robin'], f"Rename: their own game shows the new name straight away ({got})")
        said = await toast()
        expect(await a.evaluate(f"__pl.others.get('{who}').title") == 'Robin' and said == f'{name} is now Robin', f'the admin sees it on them in the world too, and is told ("{said}")')
        expect('Robin' in await a.evaluate("document.querySelector('#adminPlayer .admin-name').textContent"), 'and their page has the new name')
        # a message only they see
        await a.fill('#adminPlayer input[aria-label="A message only they see"]', 'Hello from the admin'); await a.click('#adminPlayer >> text=Send'); await a.wait_for_timeout(1500)
        seen = await b.evaluate("[!document.getElementById('announce').hidden, document.getElementById('announce').textContent]")
        expect(seen[0] and 'Hello from the admin' in seen[1], f"Message: it shows on their screen ({seen})")
        expect(await a.evaluate("document.getElementById('announce').hidden"), 'and not on the admin\'s')

        # the Log has it all, newest first, and its filter works
        await a.click('[data-admin-tab="log"]'); await a.wait_for_function("document.querySelectorAll('#adminLog .admin-logline').length > 5", timeout=8000)
        lines = await a.evaluate("[...document.querySelectorAll('#adminLog .admin-logline')].map((l) => l.lastChild.textContent)")
        for want in ['Message: Sent to Robin', f'Rename: {name} is now Robin', f'Edit person: {name} changed', f"Claim (campfire at {round(spot[0])}, {round(spot[1])}): Now {name}'s claim", f"{name} lit a fire and started {name}'s camp", f'New person: {name}, ', 'Admin mode opened']:
            expect(any(l.startswith(want) for l in lines), f'the Log has "{want}"')
        expect(lines.index('Message: Sent to Robin') < lines.index(f"{name} lit a fire and started {name}'s camp"), 'newest first')
        await shot(a, 'admin-extras-3-log-pc')
        await a.click('#adminLogShow >> text=People'); await a.wait_for_timeout(400)
        people = await a.evaluate("[...document.querySelectorAll('#adminLog .admin-logline')].map((l) => l.lastChild.textContent)")
        expect(len(people) >= 2 and all(not l.startswith(('Rename', 'Message', 'Fire', 'Claim (', 'Admin', 'Edit')) for l in people), f'People shows only what happened to people ({people})')
        # every tab fits and can be read, on a computer and on a phone
        fits = "(() => { const box = document.querySelector('.admin-tabs').getBoundingClientRect(); return [...document.querySelectorAll('[data-admin-tab]')].map((t) => { const r = t.getBoundingClientRect(); return [t.textContent, r.left >= box.left - 1 && r.right <= box.right + 1 && r.width > 40 && r.height >= 30 && t.scrollWidth <= t.clientWidth + 1]; }); })()"
        tabs = await a.evaluate(fits)
        expect(len(tabs) == 7 and all(ok for _, ok in tabs), f'all 7 tabs fit on a computer ({tabs})')
        await a.set_viewport_size({'width': 390, 'height': 844}); await frames(a, 2)
        tabs = await a.evaluate(fits)
        expect(len(tabs) == 7 and all(ok for _, ok in tabs), f'and at phone size ({tabs})')
        await shot(a, 'admin-extras-4-log-phone')
        await a.click('[data-admin-tab="world"]'); await a.wait_for_function("document.querySelectorAll('#adminFires [data-fire]').length === 1", timeout=8000)
        await shot(a, 'admin-extras-5-world-phone')
        st = await a.evaluate("({ mode: __pl.ui.mode, person: !!__pl.player })")
        expect(st['mode'] == 'admin' and not st['person'], f'the admin is still in admin mode with no person ({st})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def admin_phone():
    """Admin mode on a touch screen: quick taps on the version number never zoom the page, ?admin on the end of the address also opens the password box (it is not a way round the password), and every box the admin types in is 16 px or more (an iPhone zooms the whole page in on a smaller one)."""
    async with world() as W:
        b = await W.page('phoneBoxPlayer'); await join(b)  # (someone for the admin to open a page for)
        expect(await b.evaluate("document.getElementById('adminLogin').hidden"), 'an ordinary address never shows the password box')
        a = await W.page('phoneBoxAdmin', path='test/?admin&z=')
        st = await a.evaluate("({ box: !document.getElementById('adminLogin').hidden, mode: __pl.ui.mode, on: __pl.adminMode.on, touch: getComputedStyle(document.getElementById('menuVer')).touchAction })")
        expect(st['box'] and st['mode'] == 'menu' and not st['on'], f"?admin on the address opens the password box on the main menu, and that is all it does ({st})")
        expect(st['touch'] == 'manipulation', f"quick taps on the version number are taps, never a zoom ({st['touch']})")
        boxes = lambda sel: a.evaluate(f"[...document.querySelectorAll('{sel}')].filter((e) => e.getClientRects().length).map((e) => [e.id || e.getAttribute('aria-label') || e.placeholder || e.tagName, parseFloat(getComputedStyle(e).fontSize)])")
        small = lambda rows: [r for r in rows if r[1] < 16]
        rows = await boxes('#adminLogin input')
        expect(len(rows) == 1 and not small(rows), f'the password box is 16 px or more ({rows})')
        await shot(a, 'admin_phone_1_password')
        await a.fill('#adminLoginCode', 'not-it'); await a.click('#adminLoginGo'); await a.wait_for_function('!__pl.adminMode.asking', timeout=8000); await a.wait_for_timeout(300)
        expect(not await a.evaluate('__pl.adminMode.on') and await a.evaluate('__pl.ui.mode') == 'menu', 'a wrong password from that address is refused like anywhere else')
        await a.fill('#adminLoginCode', 'secret123456'); await a.click('#adminLoginGo'); await a.wait_for_function('__pl.adminMode.on', timeout=8000)
        await a.click('#adminDashBtn')
        ALL = '#adminPanel input, #adminPanel select, #adminPanel textarea'
        for tab, least in [('server', 2), ('players', 1), ('settings', 3), ('items', 5)]:
            await a.click(f'[data-admin-tab="{tab}"]'); await a.wait_for_timeout(1200)
            rows = await boxes(ALL)
            expect(len(rows) >= least and not small(rows), f'{tab}: all {len(rows)} boxes are 16 px or more' + (f' (too small: {small(rows)[:4]})' if small(rows) else ''))
            if tab == 'settings': await shot(a, 'admin_phone_3_settings')
        await a.click('[data-admin-tab="players"]'); await a.wait_for_timeout(1200)
        await a.click('#adminPlayers .admin-entry'); await a.wait_for_function("document.querySelector('#adminPlayer .admin-stat')", timeout=8000)
        await a.click('#adminPlayer >> text=Edit needs and age'); await a.wait_for_timeout(400)
        rows = await boxes(ALL)
        expect(len(rows) >= 7 and not small(rows), f"a person's page: all {len(rows)} boxes (needs, age, name, message) are 16 px or more" + (f' (too small: {small(rows)[:4]})' if small(rows) else ''))
        await shot(a, 'admin_phone_2_person')
        out = await a.evaluate(f"(() => {{ const p = document.getElementById('adminPanel').getBoundingClientRect(); return [...document.querySelectorAll('{ALL}')].filter((e) => e.getClientRects().length).filter((e) => {{ const r = e.getBoundingClientRect(); return r.right > p.right + 1 || r.left < p.left - 1 || r.width < 40; }}).map((e) => e.id || e.getAttribute('aria-label') || e.tagName); }})()")
        expect(out == [], f'and none of them sticks out of the dashboard or is squashed ({out})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def craft_mat():
    """The craft mat (0.1.8): tap or drag things from the inventory onto it, it says what they make straight away (no mystery, 0.1.10) or what's missing, Make, a kept tool stays, and Recipes lists every recipe (greyed out until made) and puts any one's things on the mat."""
    said = "document.getElementById('matName').textContent"
    tile = lambda k: f'#bagList .bag-tile[data-kind="{k}"]'
    count = lambda k: f"(() => {{ const t = document.querySelector('#bagList .bag-tile[data-kind=\"{k}\"] .count'); return t ? Number(t.textContent) : document.querySelector('#bagList .bag-tile[data-kind=\"{k}\"]') ? 1 : 0; }})()"
    async with world(CRAFTKIT=1) as W:
        a = await W.page('matA'); await join(a)
        await a.click('#bagBtn'); await a.click('#bagCraft'); await a.wait_for_timeout(300)
        expect(await a.evaluate("!document.getElementById('mat').hidden && !document.getElementById('matEmpty').hidden && document.getElementById('matMake').disabled"), 'Craft in the inventory shows an empty craft mat, Make not lit')
        expect('Try two stones' in await a.evaluate("document.getElementById('matEmpty').textContent"), 'someone who has found nothing yet gets a tip: try two stones')
        await shot(a, 'mat-empty')
        await a.click(tile('stone'))
        expect(await a.evaluate(said) == "Something's missing" and await a.evaluate(count('stone')) == 3, f"one stone on the mat: something's missing, and the bag shows 3 left ({await a.evaluate(said)})")
        await a.click(tile('stone'))
        expect(await a.evaluate(said) == 'Sharp stone' and await a.evaluate("!document.getElementById('matMake').disabled && !!document.querySelector('#matPic .pic')"), 'two stones: it says sharp stone straight away (no mystery), and Make lights up')
        await shot(a, 'mat-new')
        await a.click('#matMake'); await a.wait_for_timeout(1800)
        expect(await a.evaluate("__pl.you.carry['sharp-stone'] === 1 && __pl.you.carry.stone === 2 && __pl.you.found.includes('sharp-stone')"), 'Make: a sharp stone, 2 stones used, and it counts as made')
        expect(await a.evaluate(said) == 'Sharp stone' and 'first one' in await a.evaluate("document.getElementById('matWhy').textContent"), 'the mat says it was your first one')
        await shot(a, 'mat-discovered')
        await a.click('#matClear')
        # a stick with the sharp stone: a twig, and the sharp stone is kept (it's a tool in this recipe)
        await a.click(tile('stick')); await a.click(tile('sharp-stone'))
        expect(await a.evaluate(said) == 'Twig', f'a stick and a sharp stone make a twig ({await a.evaluate(said)})')
        await a.click('#matMake'); await a.wait_for_timeout(1800)
        expect(await a.evaluate("__pl.you.carry.twig === 2 && __pl.you.carry['sharp-stone'] === 1 && __pl.you.carry.stick === 2"), 'a stick cut into 2 twigs, and the sharp stone is kept')
        expect('Try two stones' not in await a.evaluate("document.getElementById('matEmpty').textContent"), 'the tip goes once something is found')
        await a.click('#matClear')
        # things that don't go together
        await a.click(tile('twig')); await a.click(tile('twine'))
        expect(await a.evaluate(said) == 'Nothing happens', f'a twig and twine: nothing happens ({await a.evaluate(said)})')
        await a.click('#matList .mat-tile[data-kind="twig"]')
        expect(await a.evaluate("!document.querySelector('#matList .mat-tile[data-kind=\"twig\"]')"), 'tapping it on the mat takes it off')
        # drag the sharp stone onto the mat with the mouse, then the stick
        for k in ['sharp-stone', 'stick']:
            box = await a.evaluate(f"(() => {{ const r = document.querySelector('{tile(k)}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }})()")
            spot = await a.evaluate("(() => { const r = document.getElementById('matSpot').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
            await a.mouse.move(*box); await a.mouse.down()
            for i in range(1, 9): await a.mouse.move(box[0] + (spot[0] - box[0]) * i / 8, box[1] + (spot[1] - box[1]) * i / 8)
            await a.mouse.up(); await a.wait_for_timeout(300)
        on = await a.evaluate("[...document.querySelectorAll('#matList .mat-tile')].map((t) => t.dataset.kind).sort().join(',')")
        expect(on == 'sharp-stone,stick,twine', f'dragged onto the mat ({on})')
        expect(await a.evaluate(said) == 'Stone knife', 'a sharp stone, a stick and twine: a stone knife')
        await a.click('#matMake'); await a.wait_for_timeout(1800)
        expect(await a.evaluate("__pl.you.carry.knife === 1 && !__pl.you.carry['sharp-stone'] && __pl.you.found.length === 3"), 'a stone knife, its sharp stone used up as the blade')
        # Recipes: every recipe by kind, the ones you've made first, the rest greyed out; tap one to put its things on the mat (what's missing shows faded)
        await a.click('#matTabFound'); await a.wait_for_timeout(300)
        rows = await a.evaluate("[...document.querySelectorAll('#foundList .found-row')].map((r) => [r.dataset.recipe, r.classList.contains('not-made')])")
        chips = await a.evaluate("[...document.querySelectorAll('#foundChips .craft-chip')].map((c) => c.textContent)")
        made = sorted(r for r, grey in rows[:3] if not grey)
        expect(made == ['knife', 'sharp-stone', 'twig'] and len(rows) > 3 and all(grey for _, grey in rows[3:]) and chips[0] == f'All {len(rows)}' and len(chips) >= 3, f'Recipes lists the 3 made first, then the rest greyed out, with All, Tools, Building and Materials ({rows}, {chips})')
        await shot(a, 'mat-found')
        await a.click('#foundList .found-row[data-recipe="knife"]'); await a.wait_for_timeout(300)
        need = await a.evaluate("[...document.querySelectorAll('#matList .mat-tile.need')].map((t) => t.dataset.kind)")
        expect(need == ['sharp-stone'] and await a.evaluate(said) == 'Stone knife' and 'Still need 1 sharp stone' in await a.evaluate("document.getElementById('matWhy').textContent"), f'tapping the knife puts its stick and twine on the mat, and the sharp stone shows as still needed ({need})')
        await shot(a, 'mat-goal')
        # one not made yet (greyed out) puts its things on the mat too: as many as it takes, with what you don't have faded
        await a.click('#foundList .found-row.not-made[data-recipe="campfire"]'); await a.wait_for_timeout(300)
        took = await a.evaluate("""(() => { const out = {};
          for (const t of document.querySelectorAll('#matList .mat-tile')) { const c = t.querySelector('.count'); out[t.dataset.kind] = (out[t.dataset.kind] || 0) + (c ? Number(c.textContent.replace('+', '')) : 1); }
          return out; })()""")
        expect(await a.evaluate(said) == 'Campfire' and took == {'log': 1, 'twig': 2, 'stone': 2}, f'tapping the greyed-out campfire puts a log, 2 twigs and 2 stones on the mat, the log faded ({took})')
        await shot(a, 'mat-greyed')
        await a.click('#bagClose')
        expect(await a.evaluate('__pl.you.carry.stick === 1 && __pl.you.carry.twine === 1'), 'closing it puts nothing anywhere: things only leave the bag on Make')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def loading():
    """The loading screen covers the main menu until the world is drawn, says so when the game can't start, and the page carries what a shared link and a home screen need."""
    async with world() as W:
        # the game's code arrives late: the loading screen is up, and a tap where Play is lands on it, not on a Play that isn't ready
        a = await W.page('loadA', slow=2500, ready=False)
        await a.wait_for_timeout(1200)
        seen = await a.evaluate("(() => { const b = document.getElementById('boot'), r = b && b.getBoundingClientRect(), at = document.elementFromPoint(innerWidth / 2, innerHeight - 180); return { text: b ? b.textContent.replace(/\\s+/g, ' ').trim() : '', covers: !!r && r.width >= innerWidth && r.height >= innerHeight, tap: !!(at && b && b.contains(at)), frames: window.__frames || 0 }; })()")
        expect('Pocket Life' in seen['text'] and 'Loading' in seen['text'], f"while loading: the game's name and Loading ({seen['text'][:60]})")
        expect(seen['covers'] and seen['tap'] and not seen['frames'], f'it covers the whole screen, so nothing under it can be tapped ({seen})')
        await shot(a, 'loading')
        await a.wait_for_function('window.__frames >= 3', timeout=180000)
        await a.wait_for_function("!document.getElementById('boot')", timeout=15000)
        expect(await shown(a, '#mainMenu'), 'once the world is drawn it fades away to the main menu')
        await a.click('#playBtn'); await a.wait_for_timeout(1500)
        expect(await shown(a, '#creator'), 'and Play works')
        # what a shared link, a search result and a home screen icon need
        head = await a.evaluate("""(async () => {
          const q = (s) => document.querySelector(s), meta = (s) => (q(s) || {}).content || '';
          const ok = async (u) => { try { return (await fetch(u)).ok; } catch (e) { return false; } };
          const man = q('link[rel=manifest]'), icon = q('link[rel=icon]'), touch = q('link[rel=apple-touch-icon]');
          let m = null; try { m = await (await fetch(man.href)).json(); } catch (e) { /* none */ }
          return { desc: meta('meta[name=description]').length, ogTitle: meta('meta[property="og:title"]'), ogImage: meta('meta[property="og:image"]'), theme: meta('meta[name=theme-color]'),
            icon: !!icon && await ok(icon.href), touch: !!touch && await ok(touch.href), share: await ok('icons/share.jpg'),
            manifest: !!m && m.name === 'Pocket Life' && m.display === 'browser', icons: !!m && (await Promise.all(m.icons.map((i) => ok(new URL(i.src, man.href).href)))).every(Boolean) };
        })()""")
        expect(50 <= head['desc'] <= 160 and 'Pocket Life' in head['ogTitle'] and head['ogImage'].endswith('/icons/share.jpg'), f"the page has a description and what a shared link shows ({head['desc']} letters, {head['ogImage']})")
        expect(head['icon'] and head['touch'] and head['share'], 'its icons and the picture a shared link shows are there')
        expect(head['manifest'] and head['icons'], "the home screen details are there, and open the game in the browser (so it's the same person)")
        expect(not W.errors, f'no errors {W.errors[:3]}')
        # three.js never arrives: the loading screen says the game couldn't start, with a way to try again (it used to leave a main menu where nothing worked)
        b = await W.page('loadB', three=False, ready=False)
        await b.wait_for_function("document.getElementById('boot') && document.getElementById('boot').classList.contains('failed')", timeout=30000)
        said = await text(b, '#bootText')
        expect("couldn't start" in said and await shown(b, '#bootAgain'), f'with three.js missing it says so, with Try again ({said[:50]})')
        await shot(b, 'loading_failed')


# how wide the Make your person stage was last drawn (renderCreator in game/people.js sets the renderer's scissor to it)
STAGE_DRAWN = "(async () => { const f = window.__frames; while (window.__frames < f + 2) await new Promise((r) => setTimeout(r, 100)); return Math.round(__pl.renderer.getScissor(new __pl.THREE.Vector4()).z); })()"


async def sideways():
    """A phone held sideways: Make your person fits (the sheet goes down the right) and the game can be started and played."""
    async with world() as W:
        for tag, w, h in [('wide', 844, 390), ('small', 667, 375)]:
            pg = await W.page(f'side{tag}', w, h, touch=True)
            await pg.click('#playBtn'); await pg.wait_for_timeout(1500)
            off = await pg.evaluate("['#creatorTitle', '#creatorBack', '#nameInput', '#sexOpts', '#ageInput', '#buildOpts', '#skinOpts', '#hairOpts', '#hairColourOpts', '#tunicOpts', '.start-btn'].filter((s) => { const r = document.querySelector(s).getBoundingClientRect(); return !(r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight); })")
            expect(not off, f'{w} x {h}: every choice and Start my life are on the screen {off}')
            stage = await pg.evaluate("(() => { const p = document.getElementById('previewSpace').getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect(); return [Math.round(p.width), Math.round(p.height), Math.round(s.left)]; })()")
            expect(stage[0] >= 200 and stage[1] >= 200 and stage[2] > w * 0.25, f'your person has room on the left, the sheet is on the right ({stage})')
            drawn = await pg.evaluate(STAGE_DRAWN)
            expect(abs(drawn - (stage[2] + 24)) <= 2, f'and is drawn in that space, not across the whole screen ({drawn} px wide)')
            await shot(pg, f'sideways_{tag}_creator')
            await pg.click('.start-btn')
            await pg.wait_for_function("document.getElementById('mainMenu').hidden && !document.getElementById('app').classList.contains('is-creating')", timeout=30000)
            await pg.wait_for_timeout(1000)
            hud = await pg.evaluate("['.who', '#menuBtn', '#needs', '#sayBtn', '#bagBtn'].filter((s) => { const r = document.querySelector(s).getBoundingClientRect(); return !(r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight); })")
            expect(not hud, f'{w} x {h}: in the world, the corners are all on the screen {hud}')
            await shot(pg, f'sideways_{tag}_world')
            await pg.context.close()
        # an upright phone and a computer keep the sheet under your person, who is drawn across the whole width above it
        for tag, w, h in [('upright', 390, 844), ('computer', 1280, 800)]:
            pg = await W.page(f'side{tag}', w, h)
            await pg.click('#playBtn'); await pg.wait_for_timeout(1500)
            under = await pg.evaluate("(() => { const p = document.getElementById('previewSpace').getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect(); return s.top >= p.bottom - 1; })()")
            drawn = await pg.evaluate(STAGE_DRAWN)
            expect(under and drawn == w, f'{w} x {h}: the sheet is under your person, who is drawn across the whole width ({drawn} px)')
            await pg.context.close()
        # a very narrow phone: the chat's Send button stays on the screen
        n = await W.page('sidenarrow', 320, 568); await join(n)
        await n.click('#sayBtn'); await n.wait_for_timeout(300)
        send = await n.evaluate("(() => { const r = document.querySelector('.send-btn').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), innerWidth]; })()")
        expect(send[1] <= send[2], f'on a 320 px phone the Send button is on the screen ({send})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def menu_rest():
    """The main menu draws about 30 times a second once the sharpness has settled; making a person and the world draw every frame."""
    measure = """(ms) => new Promise((done) => { let n = 0; const f0 = __pl.renderer.info.render.frame, t0 = performance.now();
      (function tick() { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done({ frames: n / (ms / 1000), drawn: (__pl.renderer.info.render.frame - f0) / (ms / 1000), rest: __pl.speed.rest, step: __pl.speed.step }); })(); })"""
    async with world() as W:
        # a tiny screen on Low, so this computer's software 3D can keep up with the screen (60 frames a second)
        pg = await W.page('rest', 96, 96, touch=False)
        await pg.evaluate("document.querySelector('[data-gfx=low]').click()"); await pg.wait_for_timeout(1500)
        m = await pg.evaluate(measure, 4000)
        fast = m['frames'] >= 45
        if not fast: print(f"  (this computer only manages {m['frames']:.0f} frames a second here, too slow to see the main menu resting: only the rest is checked)")
        expect(m['rest'] and (not fast or 20 <= m['drawn'] <= m['frames'] * 0.75), f"the main menu's world is drawn about 30 times a second ({m['drawn']:.0f} of {m['frames']:.0f} frames)")
        await pg.evaluate("document.getElementById('playBtn').click()"); await pg.wait_for_timeout(1500)  # (the menu doesn't fit a screen this small: clicked from inside)
        c = await pg.evaluate(measure, 2000)
        expect(not c['rest'] and c['drawn'] >= c['frames'] * 0.9, f"making a person is drawn every frame ({c['drawn']:.0f} of {c['frames']:.0f})")
        await pg.evaluate("document.querySelector('.start-btn').click()")
        await pg.wait_for_function("document.getElementById('mainMenu').hidden && !document.getElementById('app').classList.contains('is-creating')", timeout=30000)
        w = await pg.evaluate(measure, 3000)
        expect(not w['rest'] and w['drawn'] >= w['frames'] * 0.9, f"and so is the world ({w['drawn']:.0f} of {w['frames']:.0f})")
        expect(w['step'] == 0, 'resting never made the picture less sharp')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def tips():
    """First-steps tips, the five Luke picked: one at a time in the pill, each once. A tip goes when you do what it says, or by itself."""
    fast = {'show': 8, 'gap': 1, 'pace': 3}
    HINT = "(() => { const h = document.getElementById('hint'); return h.hidden ? '' : h.textContent; })()"
    SEEN = "JSON.parse(localStorage.getItem('pocket-life:tips') || 'null')"

    async def tip(pg, starts, s=40):  # wait for the pill to say this
        for _ in range(s * 2):
            t = await pg.evaluate(HINT)
            if t.startswith(starts): return t
            await pg.wait_for_timeout(500)
        return await pg.evaluate(HINT)

    async def gone(pg, s=30):
        for _ in range(s * 2):
            if not await pg.evaluate(HINT): return True
            await pg.wait_for_timeout(500)
        return False

    async def start(pg):  # Play and into the world, like join(), but the pill is left alone
        await pg.click('#playBtn'); await pg.wait_for_timeout(1500)
        if await pg.evaluate("!document.getElementById('creator').hidden"): await pg.click('.start-btn')
        await pg.wait_for_function("document.getElementById('mainMenu').hidden && !document.getElementById('app').classList.contains('is-creating')", timeout=30000)

    async with world() as W:
        a = await W.page('tipsA', data={'tips': fast}, tips=True)
        await start(a)
        t = await tip(a, 'Double-tap')
        expect(t == 'Double-tap the ground to walk. Tap anything to see what you can do.', f'someone new is told how to walk first ({t})')
        box = await a.evaluate("(() => { const r = document.getElementById('hint').getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, r.height < 60]; })()")
        expect(all(box), f'the pill fits the phone, in two lines at most ({box})')
        await shot(a, 'tips_walk')
        # walking: that tip goes and the next one comes
        for x, y in [(250, 560), (140, 600), (300, 660), (200, 720), (120, 500)]:  # some open ground
            await a.evaluate("document.getElementById('actMenu').hidden = true"); await a.wait_for_timeout(300)
            await a.mouse.dblclick(x, y); await a.wait_for_timeout(400)
            if await a.evaluate('!!__pl.walk.target'): break
        t = await tip(a, 'Tap a stick')
        expect(t == 'Tap a stick or a stone on the ground, then Pick up.' and 'walk' in (await a.evaluate(SEEN) or []), f'after walking, how to pick things up ({t})')
        # picking something up
        await idle(a)
        await a.evaluate("(() => { const p = __pl.player.position; const it = [...__pl.world.items].sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0]; __pl.queueTask({ type: 'pickup', id: it.id }); })()")
        t = await tip(a, 'The rings', 90)
        expect(t == 'The rings are your needs. Tap them to see what each one is.', f'after the first pick-up, what the rings are ({t})')
        # tapping the rings puts the pill away at once, and nothing shows over the open rings
        await a.click('#needs')
        expect(not await a.evaluate(HINT), 'tapping the rings puts it away')
        await a.wait_for_timeout(4000)
        expect(not await a.evaluate(HINT), 'and no tip shows over the open rings')
        await a.click('#needs')
        t = await tip(a, 'Pick berries')
        expect(t == 'Pick berries from a bush and eat them from your inventory. Drink at the pond.', f'then food and water ({t})')
        await shot(a, 'tips_food')
        # left alone, a tip goes by itself, and the next one still comes
        expect(await gone(a), 'a tip that is not acted on goes by itself')
        t = await tip(a, 'Open your inventory')
        expect(t == 'Open your inventory and tap Craft to make things. Try two stones first.', f'then crafting, the last one ({t})')
        await a.click('#bagBtn'); await a.wait_for_timeout(300)
        expect(not await a.evaluate(HINT), 'opening the inventory puts it away')
        await a.click('#bagClose'); await a.wait_for_timeout(6000)
        seen = await a.evaluate(SEEN)
        expect(seen == TIPS and len(TIPS) == 5 and not await a.evaluate(HINT), f'all five seen, and nothing more is said ({seen})')
        # they're kept on the phone: Exit and Play again shows nothing
        await a.click('#menuBtn'); await a.wait_for_timeout(300); await a.click('#exitBtn'); await a.wait_for_timeout(2500)
        await start(a); await a.wait_for_timeout(6000)
        expect(not await a.evaluate(HINT), 'each tip shows once: nothing the next time you play')
        await a.context.close()
        # a tip for something you've already done is never shown (this person starts with sticks and stones in their bag)
    async with world(TESTKIT=1) as W:
        b = await W.page('tipsB', data={'tips': {**fast, 'show': 3}}, tips=True)
        await start(b)
        t = await tip(b, 'Double-tap'); expect(t.startswith('Double-tap'), 'someone who already carries things still starts with walking')
        expect(await gone(b), 'it goes')
        t = await tip(b, 'The rings')
        expect(t.startswith('The rings') and 'pickup' in (await b.evaluate(SEEN) or []), f'and is never told how to pick things up ({t})')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def placed_kinds():
    """A second kind of placed thing, made from data alone (a drying rack that isn't in the game): it's drawn as its own item, not as a campfire, and can be placed and built. The campfire is put together as before."""
    game = json.load(open(os.path.join(HERE, '..', '..', 'server', 'game.json')))
    data = json.load(open(os.path.join(HERE, '..', '..', 'test', 'game-data.json'), encoding='utf-8'))
    srv = {'items': {**game['items'], 'rack': {**game['items']['log'], 'weight': 3, 'places': 'rack'}},
           'placeables': {**game['placeables'], 'rack': {'item': 'rack', 'buildSeconds': 2, 'solid': 0.5, 'fire': None, 'seats': None}}}
    mine = {'items': {'rack': {**data['items']['log'], 'name': 'Drying rack', 'plural': 'Drying racks', 'weight': 3, 'places': 'rack', 'startInWorld': 0}},
            'placeables': {'rack': {'name': 'Drying rack', 'buildSeconds': 2, 'buildVerb': 'Building the drying rack', 'solid': 0.5}}}
    PARTS = """(id) => { const th = __pl.placed.get(id), p = th.view.userData.parts; let meshes = 0; th.view.traverse((m) => { if (m.isMesh) meshes++; });
      return { kind: th.kind, built: th.built, pieces: p.pieces.length, fuel: p.fuel.length, burns: p.burns.length, flame: !!p.flame, meshes, label: th.view.userData.label }; }"""
    SPOT = """(kind) => { const p = __pl.player.position;
      for (let r = 2; r < 8; r += 0.5) for (let k = 0; k < 16; k++) { const x = p.x + Math.cos(k / 16 * 6.28) * r, z = p.z + Math.sin(k / 16 * 6.28) * r;
        if (!__pl.cantPlaceAt(x, z, kind)) { __pl.movePlacing(x, z); return [x, z]; } } return null; }"""
    async with world(srv, KIT=json.dumps({'rack': 1, 'campfire': 1})) as W:
        a = await W.page('rackA', data=mine); await join(a)
        b = await W.page('rackB', data=mine); await join(b)
        expect(await a.evaluate("__pl.you.carry.rack === 1 && __pl.you.carry.campfire === 1"), 'the person carries a drying rack and a campfire')
        # the rack: placed from the inventory like a campfire is
        await a.click('#bagBtn'); await a.wait_for_timeout(400)
        await a.click('#bagList .bag-tile[data-kind="rack"]'); await a.wait_for_timeout(200)
        expect(await a.evaluate("document.getElementById('bagInfo').innerText.includes('Drying rack') && !!document.querySelector('#bagInfo button.go')"), 'its tile has a Place button, from the data alone')
        await a.click('#bagInfo button.go'); await a.wait_for_timeout(400)
        ghost = await a.evaluate("(() => { let n = 0; __pl.placing.ghost.traverse((m) => { if (m.isMesh) n++; }); return [__pl.placing.on, __pl.placing.kind, n]; })()")
        fire_meshes = await a.evaluate("(() => { let n = 0; __pl.buildItem('campfire').model.traverse((m) => { if (m.isMesh) n++; }); return n; })()")
        expect(ghost[0] and ghost[1] == 'rack' and 0 < ghost[2] < fire_meshes, f'the ghost while placing is the rack\'s own shape, not a campfire ({ghost[2]} meshes, a campfire has {fire_meshes})')
        spot = await a.evaluate(SPOT, 'rack')
        await shot(a, 'placed_rack_ghost')
        await a.evaluate('__pl.finishPlacing()'); await idle(a, 40); await a.wait_for_timeout(1500)
        rid = await a.evaluate("[...__pl.placed.values()].find((t) => t.kind === 'rack').id")
        r = await a.evaluate(PARTS, rid)
        expect(r['built'] and r['pieces'] == 1 and r['fuel'] == 0 and r['burns'] == 0 and not r['flame'] and r['label'] == 'Drying rack', f'put down and built: one piece, no fuel sticks, no flames, named Drying rack ({r})')
        expect(not await a.evaluate('__pl.you.carry.rack'), 'it left the inventory')
        rb = await b.evaluate(PARTS, rid)
        expect(rb['built'] and rb['pieces'] == 1, 'the other phone sees it built, drawn the same way')
        await shot(a, 'placed_rack')
        # the campfire next to it is put together as it always was
        await a.click('#bagBtn'); await a.wait_for_timeout(400)
        await a.click('#bagList .bag-tile[data-kind="campfire"]'); await a.wait_for_timeout(200)
        await a.click('#bagInfo button.go'); await a.wait_for_timeout(400)
        spot = await a.evaluate(SPOT, 'campfire')
        await a.evaluate('__pl.finishPlacing()'); await idle(a, 60); await a.wait_for_timeout(1500)
        fid = await a.evaluate("[...__pl.placed.values()].find((t) => t.kind === 'campfire').id")
        f = await a.evaluate(PARTS, fid)
        expect(f['built'] and f['pieces'] == 13 and f['fuel'] == 5 and f['burns'] == 4 and f['flame'], f'the campfire: 13 pieces (9 stones, a log, 3 sticks), 5 fuel sticks, 4 that char, and flames ({f})')
        menu = await a.evaluate(f"__pl.placedActions(__pl.placed.get({rid})).map((x) => x.label)")
        expect('Light fire' not in menu and 'Sit by the fire' not in menu and 'Pack up' in menu, f'the rack\'s tap menu has no fire or seat lines, and Pack up ({menu})')
        await shot(a, 'placed_rack_and_fire')
        expect(not W.errors, f'no errors {W.errors[:3]}')


async def server_tests():
    """The server's own code, tested with no browser (quick): the admin's fire, claim, Log, rename and message tools, live item numbers, that an old admin flag gives a player nothing, that things which aren't in the world can't be chopped, mined or picked, societies, task lists carried on while away, and old things left on the ground fading."""
    import subprocess
    from lib import bundle
    bundle()
    for f in ['admin_extras.mjs', 'live_items.mjs', 'stale_admin.mjs', 'cheats.mjs', 'societies.mjs', 'tasks.mjs', 'fade.mjs']:
        r = subprocess.run(['node', f], cwd=HERE, capture_output=True, text=True, timeout=180)
        last = (r.stdout.strip().splitlines() or ['(nothing printed)'])[-1]
        if r.returncode: print(r.stdout[-4000:], r.stderr[-2000:])
        expect(r.returncode == 0, f'{f}: {last[:160]}')


CHECKS = {'layout': layout, 'smoke': smoke, 'menu': menu, 'line': line, 'walking': walking, 'grass_and_tools': grass_and_tools, 'collapse': collapse, 'screens': screens, 'new_home': new_home, 'strolling': strolling, 'tasks_away': tasks_away, 'regions': regions, 'pond': pond, 'campfire': campfire, 'mining': mining, 'admin_tools': admin_tools, 'reset_all': reset_all, 'restore': restore, 'claims': claims, 'societies': societies, 'guards': guards, 'maintenance': maintenance, 'reconnect': reconnect, 'errors': errors, 'crowd': crowd, 'fishing': fishing, 'bagdrag': bagdrag, 'glow': glow, 'admin_login': admin_login, 'admin_people': admin_people, 'admin_mode': admin_mode, 'admin_taps': admin_taps, 'live_items_game': live_items_game, 'craft_mat': craft_mat, 'admin_items': admin_items, 'admin_follow': admin_follow, 'admin_extras': admin_extras, 'admin_phone': admin_phone, 'loading': loading, 'sideways': sideways, 'menu_rest': menu_rest, 'tips': tips, 'placed_kinds': placed_kinds, 'server_tests': server_tests}

# shortcuts: `run.py quick` for small changes
GROUPS = {'quick': ['layout', 'smoke']}
