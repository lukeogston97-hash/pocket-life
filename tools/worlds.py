"""Builds the game's data and the server's copies of the game's rules, and moves games on to a new version.

The game's content is in content/*.json, one file per kind (items, recipes, placeables, world, rules, people, text, and
version with the devlog). Each file's "_help" explains its sections. test/game-data.json is made from them: never edit it.

  python3 tools/worlds.py test-build   after changing content/*.json or test/game/rules.js: checks the content, writes
                                       test/game-data.json and the server's copies (server/game.json, words.json,
                                       src/rules.js) and moves older test games on to the current test build
  python3 tools/worlds.py release      release-link games move to the new version (tools/release.sh runs this)
  python3 tools/worlds.py check        changes nothing: checks the content for mistakes, and that test/game-data.json and
                                       the server's copies are up to date (tools/tests/lint.py runs this)

Pushed to main, Cloudflare puts the server live in about a minute. Maintenance is switched on and off by the admin in the game.
"""
import json, os, re, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SERVER = os.path.join(root, 'server')
CONTENT = os.path.join(root, 'content')
GAME_DATA = os.path.join(root, 'test', 'game-data.json')
# the order of the sections in test/game-data.json (kept as it was, so the file reads the same as before 0.2.0)
ORDER = ['version', 'build', 'era', 'server', 'settings', 'testNames', 'defaultLook', 'stats', 'energyCosts', 'chopping', 'mining',
         'retired', 'itemGroups', 'items', 'recipes', 'placeables', 'sources', 'away', 'night', 'berryBushes', 'daylight', 'looks',
         'bodyShapes', 'chatFilter', 'tips', 'devlog', 'plants', 'regions', 'liveSettings', 'claims', 'societies', 'crops']


def load_content():
    """content/*.json joined into one: (data, help notes, where each section came from)."""
    data, notes, home = {}, {}, {}
    for f in sorted(os.listdir(CONTENT)):
        if not f.endswith('.json'): continue
        part = json.load(open(os.path.join(CONTENT, f), encoding='utf-8'))
        notes.update(part.pop('_help', {}))
        for k, v in part.items():
            if k in data: sys.exit(f'content/{f}: "{k}" is already in content/{home[k]}')
            data[k], home[k] = v, f
    ordered = {k: data[k] for k in ORDER if k in data}
    ordered.update({k: v for k, v in data.items() if k not in ordered})  # a new section goes at the end
    return ordered, notes, home


def game_data_text(d):
    """test/game-data.json as it should be: everything the game needs, without the help notes."""
    note = {'_generated': 'Made from content/*.json by python3 tools/worlds.py test-build. Edit those files, not this one.'}
    return json.dumps({**note, **d}, indent=2, ensure_ascii=False) + '\n'


data, HELP, HOME = load_content()
rules_js = open(os.path.join(root, 'test', 'game', 'rules.js'), encoding='utf-8').read()


def problems(d):
    """Mistakes in game-data.json that would break the game or the server, as plain sentences."""
    out = []
    items, stats = d.get('items', {}), {s.get('id') for s in d.get('stats', [])}
    placeables = d.get('placeables', {})
    shapes = set(re.findall(r'^  (\w+)\(look\) \{', open(os.path.join(root, 'test', 'game', 'items.js'), encoding='utf-8').read(), re.M))
    whole = lambda n: isinstance(n, int) and not isinstance(n, bool)
    def known(kind, where, what=items, name='item'):
        if kind not in what: out.append(f'{where}: there is no {name} called "{kind}"')
    def counts(m, where, what=items, name='item', ranges=False):
        for k, n in (m or {}).items():
            known(k, where, what, name)
            ok = whole(n) and n > 0 or (ranges and isinstance(n, list) and len(n) == 2 and all(whole(x) and x >= 0 for x in n))
            if not ok and what is items: out.append(f'{where}: "{k}" needs a whole number above 0, not {n!r}')

    if not re.fullmatch(r'\d+\.\d+\.\d+', str(d.get('version', ''))): out.append('version should look like 0.3.0')
    if not whole(d.get('build')) or d['build'] < 1: out.append('build should be a whole number, 1 or more')
    if len(stats) != len(d.get('stats', [])): out.append('stats: two needs share an id')
    for s in d.get('stats', []):
        for k in (s.get('atZero') or {}): known(k, f'stats.{s.get("id")}.atZero', stats, 'need')
    for k, it in items.items():
        w = f'items.{k}'
        if not re.fullmatch(r'[a-z0-9-]{1,24}', k): out.append(f'{w}: an id is lower case letters, numbers and dashes (24 at most)')
        if not it.get('name'): out.append(f'{w}: needs a name')
        if not whole(it.get('weight', 1)) or it.get('weight', 1) < 0: out.append(f'{w}: weight should be a whole number (Luke: no .1 or .5)')
        shape = (it.get('look') or {}).get('shape')
        if shape not in shapes: out.append(f'{w}: look.shape "{shape}" is not a shape in game/items.js ({", ".join(sorted(shapes))})')
        for s in (it.get('eat') or {}): known(s, f'{w}.eat', stats, 'need')
        if 'tool' in it and not (whole((it['tool'] or {}).get('uses')) and it['tool']['uses'] > 0): out.append(f'{w}: tool.uses should be a whole number above 0')
        if it.get('places') is not None: known(it['places'], f'{w}.places', placeables, 'placeable')
        if it.get('spawnsNear') not in (None, 'trees', 'boulders'): out.append(f'{w}: spawnsNear is "trees" or "boulders"')
        if not whole(it.get('startInWorld', 0)) or it.get('startInWorld', 0) < 0: out.append(f'{w}: startInWorld should be a whole number')
    # items taken out of the game (0.1.21): what any left over become, another item or null (just gone)
    retired = d.get('retired', {})
    if not isinstance(retired, dict): out.append('retired: a list like {"twig": "stick"}')
    else:
        for k, to in retired.items():
            if k in items: out.append(f'retired.{k}: "{k}" is still an item, so it isn\'t taken out (remove it from items first)')
            if to is not None and to not in items: out.append(f'retired.{k}: there is no item called "{to}" for it to become (or null to just take it away)')
    groups = d.get('itemGroups')
    if groups is not None and (not isinstance(groups, list) or not groups or not all(isinstance(g, str) and g.strip() for g in groups) or len(set(groups)) != len(groups)):
        out.append('itemGroups: a list of headings (words), each one once')
    for k, it in items.items():
        if it.get('group') is not None and it['group'] not in (groups or []): out.append(f'items.{k}: group "{it["group"]}" is not one of itemGroups ({", ".join(groups or [])})')
    for r in d.get('recipes', []):
        if r.get('group') is not None and r['group'] not in (groups or []): out.append(f'recipes.{r.get("id")}: group "{r["group"]}" is not one of itemGroups')
    ids = [r.get('id') for r in d.get('recipes', [])]
    if len(set(ids)) != len(ids): out.append('recipes: two recipes share an id')
    for r in d.get('recipes', []):
        w = f'recipes.{r.get("id")}'
        if not r.get('needs') or not r.get('makes'): out.append(f'{w}: needs both "needs" and "makes"')
        counts(r.get('needs'), f'{w}.needs'); counts(r.get('makes'), f'{w}.makes'); counts(r.get('keeps'), f'{w}.keeps')
        if r.get('near') is not None: known(r['near'], f'{w}.near', placeables, 'placeable')
        both = set(r.get('needs') or {}) & set(r.get('keeps') or {})
        if both: out.append(f'{w}: "{", ".join(sorted(both))}" is in both needs (used up) and keeps (kept): pick one')
    # the craft mat (0.1.8) finds a recipe by exactly what's on it, so no two recipes can want the same things
    wants = {}
    for r in d.get('recipes', []):
        want = dict(r.get('needs') or {})
        for k, n in (r.get('keeps') or {}).items(): want[k] = want.get(k, 0) + n
        key = tuple(sorted(want.items()))
        if key in wants: out.append(f'recipes.{r.get("id")}: wants the same things on the craft mat as recipes.{wants[key]}, so the mat can\'t tell them apart')
        else: wants[key] = r.get('id')
    for k, p in placeables.items():
        w = f'placeables.{k}'
        if p.get('madeWith') is not None:  # dug with a tool (0.1.18, the farm field), so no item places it
            known(p['madeWith'], f'{w}.madeWith')
            if not (items.get(p['madeWith']) or {}).get('tool'): out.append(f'{w}.madeWith: "{p["madeWith"]}" should be a tool (it goes on the tool bar)')
        elif not any(it.get('places') == k for it in items.values()): out.append(f'{w}: no item has "places": "{k}", so nobody could place it')
        f = p.get('fire')
        if f:
            known(f.get('fuel'), f'{w}.fire.fuel')
            for x in (f.get('otherFuels') or {}): known(x, f'{w}.fire.otherFuels')
    for k, s in d.get('sources', {}).items():
        w = f'sources.{k}'
        counts(s.get('harvest'), f'{w}.harvest'); counts(s.get('toolHarvest'), f'{w}.toolHarvest')
        for x in (s.get('gives') or {}): known(x, f'{w}.gives', stats, 'need')
        if s.get('tool') is not None: known(s['tool'], f'{w}.tool')
        if s.get('fish'):
            known(s['fish'].get('tool'), f'{w}.fish.tool'); known(s['fish'].get('catch'), f'{w}.fish.catch')
            if not 0 < s['fish'].get('chance', 0) <= 1: out.append(f'{w}.fish.chance: needs a number above 0 and up to 1')
    for k, c in d.get('crops', {}).items():
        w = f'crops.{k}'
        known(c.get('seed'), f'{w}.seed')
        known(c.get('on', 'field'), f'{w}.on', placeables, 'placeable')
        if c.get('like') is not None: known(c['like'], f'{w}.like', d.get('sources', {}), 'source')
        if not (isinstance(c.get('growHours'), (int, float)) and c['growHours'] > 0): out.append(f'{w}.growHours should be a number above 0')
    seeds = [p.get('seed') for p in d.get('plants', {}).values()]
    if len(set(seeds)) != len(seeds) or None in seeds: out.append('plants: each plant needs its own "seed" number (so the rest of the world never moves)')
    for k, p in d.get('plants', {}).items():
        counts(p.get('gives'), f'plants.{k}.gives')
        if p.get('tool') is not None: known(p['tool'], f'plants.{k}.tool')
    for key in ('chopping', 'mining'):
        c = d.get(key, {})
        if c.get('tool') is not None: known(c['tool'], f'{key}.tool')
        for what, rule in c.items():
            if isinstance(rule, dict): counts(rule.get('gives'), f'{key}.{what}.gives', ranges=True)
    live = [s.get('id') for s in d.get('liveSettings', [])]
    if len(set(live)) != len(live): out.append('liveSettings: two settings share an id')
    for s in d.get('liveSettings', []):
        if not (isinstance(s.get('min'), (int, float)) and isinstance(s.get('max'), (int, float)) and s['min'] <= s['max']): out.append(f'liveSettings.{s.get("id")}: needs min and max, min first')
    c = d.get('claims')
    if c is not None:
        known(c.get('placeable'), 'claims.placeable', placeables, 'placeable')
        if not (isinstance(c.get('radius'), (int, float)) and c['radius'] > 0): out.append('claims.radius should be a number above 0')
    so = d.get('societies')
    if so is not None:
        for k in ('maxMembers', 'nameMax', 'inviteMinutes', 'inviteReach'):
            if not (isinstance(so.get(k), (int, float)) and so[k] > 0): out.append(f'societies.{k} should be a number above 0')
    age = (d.get('looks') or {}).get('age') or {}
    if not (whole(age.get('min')) and whole(age.get('max')) and age['min'] <= age.get('start', age['min']) <= age['max']): out.append('looks.age: needs min, start and max, in that order')
    opened = [r for r in d.get('regions', []) if r.get('open')]
    if len(opened) != 1: out.append('regions: exactly one world can be open for now')
    elif opened[0].get('timeZone') != d['settings'].get('worldTimeZone'): out.append("regions: the open world's timeZone should match settings.worldTimeZone")
    # What's new (Luke, 23 Nov 2026): each version has its release date and short + added, ~ improved and − fixed lines
    day = re.compile(r'\d{4}-\d{2}-\d{2}$')
    for i, e in enumerate(d.get('devlog', [])):
        w = f'devlog[{i}] ({e.get("version")})'
        if not re.fullmatch(r'\d+\.\d+\.(\d+|x)( to \d+\.\d+\.\d+)?', str(e.get('version', ''))): out.append(f'{w}: needs a "version" like "0.1.2"')
        if not day.match(str(e.get('date', ''))): out.append(f'{w}: needs a release "date" like "2026-11-23"')
        if 'from' in e and not (day.match(str(e['from'])) and str(e['from']) <= str(e.get('date', ''))): out.append(f'{w}.from: a date like "2026-11-21", before "date"')
        for k in e:
            if k == 'notes': out.append(f'{w}: put its lines in "added", "improved" or "fixed" instead of "notes"')
            elif k not in ('version', 'date', 'from', 'title', 'added', 'improved', 'fixed'): out.append(f'{w}: unknown key "{k}"')
        if not any(e.get(k) for k in ('added', 'improved', 'fixed')): out.append(f'{w}: needs at least one line in "added", "improved" or "fixed"')
        for k in ('added', 'improved', 'fixed'):
            if k not in e: continue
            if not (isinstance(e[k], list) and all(isinstance(t, str) and t.strip() for t in e[k])): out.append(f'{w}.{k}: should be a list of short lines'); continue
            for t in e[k]:
                if len(t) > 90 or t.endswith('.') or '—' in t: out.append(f'{w}.{k}: keep lines short (90 letters at most), with no full stop at the end and no em-dash: "{t[:40]}..."')
    for k in d:
        if k not in ('version', 'build', 'server', 'devlog') and k not in HELP: out.append(f'content/{HOME.get(k, "?")}: "{k}" has no note in its "_help"')
    return out


def server_files(d):
    """The server's copies, as { path: text }: the chat filter, the rules it needs (needs, items, away and so on) and the shared rules."""
    srcs = d.get('sources', {})
    berry = next((k for s in srcs.values() for k in (s.get('harvest') or {})), 'berry')
    game = {
        'needs': d['stats'],
        'items': {k: {'name': v.get('name', k), 'weight': v.get('weight', 1), 'eat': v.get('eat'), 'uses': (v.get('tool') or {}).get('uses', 0), 'places': v.get('places'),
                       'startInWorld': v.get('startInWorld', 0), 'spawnsNear': v.get('spawnsNear')} for k, v in d['items'].items()},
        # (seconds and pose: how long a task takes and how it looks, for people carrying on with their task list while away, tasks.js)
        'recipes': {r['id']: {'needs': r['needs'], 'makes': r['makes'], **({'keeps': r['keeps']} if r.get('keeps') else {}), **({'near': r['near']} if r.get('near') else {}), **({'seconds': r['seconds']} if r.get('seconds') else {})} for r in d.get('recipes', [])},
        'sources': {k: {'gives': v.get('gives'), 'harvest': v.get('harvest'), 'water': bool(v.get('water')), 'tool': v.get('tool'), 'toolHarvest': v.get('toolHarvest'), 'regrowHours': v.get('regrowHours', 0), 'holds': v.get('holds'), 'fish': v.get('fish'), 'seconds': v.get('seconds', 2), 'pose': v.get('pose')} for k, v in srcs.items()},
        'plants': {k: {'gives': v.get('gives', {}), 'count': v.get('count', 40), 'regrowHours': v.get('regrowHours', 2), 'tool': v.get('tool'),
                       'seconds': v.get('seconds', 6), 'toolSeconds': v.get('toolSeconds'), 'pose': v.get('pose')} for k, v in d.get('plants', {}).items()},
        'berryKind': berry,
        'carryCapacity': d['settings']['carryCapacity'],
        'toolSlots': d['settings'].get('toolSlots', 7),  # the tool bar's spots (0.1.17); a live setting too
        'maxPlaying': d['settings'].get('maxPlaying', 20),
        'respawnMinutes': d['settings'].get('respawnMinutes', 10),
        'fadeDays': d['settings'].get('fadeDays', 7),
        'worldSize': d['settings'].get('worldSize', 100),
        'walkSpeed': d['settings'].get('walkSpeed', 2.2),
        'age': {'min': d['looks']['age']['min'], 'max': d['looks']['age']['max']},
        'away': d.get('away', {}),
        'night': d.get('night'),
        'timeZone': d['settings'].get('worldTimeZone', 'Australia/Darwin'),
        'energyCosts': d.get('energyCosts', {}),
        'chopping': d.get('chopping', {}),
        'mining': d.get('mining', {}),
        # things you place and build (the campfire): which item places them, how they burn, where people sit
        'placeables': {k: {'item': next((i for i, it in d['items'].items() if it.get('places') == k), k), 'buildSeconds': v.get('buildSeconds', 10),
                           'solid': v.get('solid', 0.5), 'size': v.get('size'), 'keepClear': v.get('keepClear'), 'fire': v.get('fire'), 'seats': v.get('seats'),
                           # dug with a tool instead of placed from an item (0.1.18, the farm field)
                           **({'madeWith': v['madeWith'], 'makeSeconds': v.get('makeSeconds', 8), 'flattenSeconds': v.get('flattenSeconds', 4), 'inCamp': bool(v.get('inCamp'))} if v.get('madeWith') else {})}
                       for k, v in d.get('placeables', {}).items()},
        # what grows on a farm field (0.1.18)
        'crops': {k: {'seed': c['seed'], 'on': c.get('on', 'field'), 'growHours': c.get('growHours', 24), 'plantSeconds': c.get('plantSeconds', 3), 'like': c.get('like')} for k, c in d.get('crops', {}).items()},
        # numbers the admin can change live (Admin > Settings); wired up in server/src/live.js
        'liveSettings': d.get('liveSettings', []),
        'claims': d.get('claims', {}),
        'societies': d.get('societies', {}),
        # items taken out of the game and what any left over become (0.1.21, twigs into sticks: retireOld in persons.js)
        'retired': d.get('retired', {}),
        'start': {'x': 0.6, 'z': 1.9},
        'pond': {'x': -5.6, 'z': -0.9, 'r': 5.0},  # the main pond's middle and rough radius (POND in game/land.js)
    }
    return {
        os.path.join(SERVER, 'words.json'): json.dumps(d.get('chatFilter', {}), indent=2) + '\n',
        os.path.join(SERVER, 'game.json'): json.dumps(game, indent=2) + '\n',
        # the rules the game and the server share: test/game/rules.js is the one to edit
        os.path.join(SERVER, 'src', 'rules.js'): "// GENERATED: a copy of test/game/rules.js, made by `python3 tools/worlds.py test-build`. Don't edit this copy.\n" + rules_js,
    }


cmd = sys.argv[1] if len(sys.argv) > 1 else ''
wpath = os.path.join(SERVER, 'worlds.json')
w = json.load(open(wpath))
now = f"{data['version']}.{data.get('build', 0)}"
era = data.get('era', 0)  # version numbers were reset lower once: a newer era beats any number
wrong = problems(data)
if cmd in ('test-build', 'check') and wrong:
    sys.exit('content/*.json has mistakes:\n' + '\n'.join(f'- {p}' for p in wrong))
if cmd == 'check':
    stale = [os.path.relpath(p, root) for p, text in {GAME_DATA: game_data_text(data), **server_files(data)}.items() if not os.path.exists(p) or open(p, encoding='utf-8').read() != text]
    if w.get('era', {}).get('test', 0) != era: stale.append(f'server/worlds.json (test games should be on era {era})')
    if w['minVersion'].get('test') != now: stale.append(f'server/worlds.json (test games should be on {now})')
    if stale: sys.exit("test/game-data.json or the server's copies are out of date: run python3 tools/worlds.py test-build\n" + '\n'.join(f'- {s}' for s in stale))
    sys.exit(0)
elif cmd == 'test-build':
    for p, text in {GAME_DATA: game_data_text(data), **server_files(data)}.items(): open(p, 'w', encoding='utf-8').write(text)
    w['minVersion']['test'] = now
    w.setdefault('era', {})['test'] = era
elif cmd == 'release':
    w['minVersion']['release'] = now  # a patch (new build) moves everyone on too
    w.setdefault('era', {})['release'] = era
else:
    sys.exit(__doc__)
json.dump(w, open(wpath, 'w'), indent=2); open(wpath, 'a').write('\n')
print(json.dumps({k: v for k, v in w.items() if k != 'help'}))
