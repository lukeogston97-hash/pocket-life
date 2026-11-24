// Live item and recipe numbers (server/src/live-items.js), tested straight against the server's World, with no browser and
// no timing. Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node live_items.mjs   (exit 0: all as it should be)
// It checks that nothing changes until the admin changes something, that a change really reaches the rules players are
// held to (carrying, crafting), the limits on what can be changed, and what wins between the admin and game-data.json.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const FILE = JSON.parse(readFileSync(new URL('./build/server/game.json', import.meta.url), 'utf8')); // the numbers as game-data.json has them
const results = [];
const expect = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail ? ` (${detail})` : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {} };
}
async function start(store) {
  const socks = [];
  const ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await new Promise((r) => setTimeout(r, 30));
  const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
  const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'a' });
  const player = sock({ id: 'abc', who: 'abc', watch: false, admin: false, alive: true, from: 'b', v: '0.1.2', b: 3, e: 1, link: 'release' });
  w.world = w.world || { format: 1, nextId: 1, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0, placed: [] };
  if (!w.persons.has('abc')) w.persons.set('abc', { who: 'abc', state: 'alive', name: 'Pat', look: {}, age: 30, born: Date.now(), x: 0.6, z: 1.9, ry: 0, stats: { health: 100, rest: 80, hunger: 75, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: {}, log: {} });
  const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); return s.got.slice(from); };
  const tool = async (m) => { const got = await ask(admin, m); const a = got.filter((x) => x.t === 'admin').pop(); return a ? a.text : null; };
  return { w, admin, player, ask, tool, person: () => w.persons.get('abc') };
}

const store = new Map();
let S = await start(store);
// the server's rules object isn't exported, so read it the way the game is told: ask for every number
const view = async () => (await S.ask(S.admin, { t: 'a.items' })).find((m) => m.t === 'adminItems').list;
const valueAt = (list, at) => { const e = list.find((x) => same(x.at, at)); return e ? e.value : undefined; };

console.log('A. nothing changes until the admin changes something');
let list = await view();
expect(list.length > 20 && list.every((e) => e.value === e.base && !e.changed), 'every number is the game file\'s, none marked changed', `${list.length} numbers`);
expect(Object.entries(FILE.items).every(([k, it]) => valueAt(list, ['items', k, 'weight']) === it.weight), 'every item weighs what the file says');
expect(Object.entries(FILE.recipes).every(([k, r]) => Object.entries(r.needs).every(([i, n]) => valueAt(list, ['recipes', k, 'needs', i]) === n)), 'every recipe needs what the file says');
expect(!store.has('liveItems'), 'and nothing is stored');

console.log('B. a change reaches the rules players are held to');
S.person().carry = { stick: 28 }; // 28 of 30 carried: a knife (weight 1) fits
expect((await S.tool({ t: 'a.give', id: 'abc', kind: 'knife', n: 1 })).startsWith('Gave'), 'before: a knife (weight 1) fits in a bag with 2 to spare');
await S.tool({ t: 'a.take', id: 'abc', kind: 'knife', n: 1 });
expect(await S.tool({ t: 'a.liveItem', at: ['items', 'knife', 'weight'], value: 4 }) === 'Changed to 4', 'the admin makes a knife weigh 4');
expect(await S.tool({ t: 'a.give', id: 'abc', kind: 'knife', n: 1 }) === 'Too heavy for them to carry', 'now the same bag has no room for it');
S.person().carry = { stick: 1, 'sharp-stone': 1, twine: 1 };
await S.tool({ t: 'a.liveItem', at: ['recipes', 'knife', 'needs', 'stick'], value: 2 });
await S.ask(S.player, { t: 'craft', id: 'knife' });
expect(!S.person().carry.knife && S.person().carry.stick === 1, 'a knife now needs 2 sticks: 1 stick is not enough to craft one');
S.person().carry = { stick: 2, 'sharp-stone': 1, twine: 1 };
await S.ask(S.player, { t: 'craft', id: 'knife' });
expect(S.person().carry.knife === 1 && !S.person().carry.stick, 'with 2 sticks it crafts, and both sticks are used');
expect(S.player.got.some((m) => m.t === 'liveItems') && S.admin.got.some((m) => m.t === 'liveItems'), 'every game is told the new numbers');
list = await view();
const kw = list.find((e) => same(e.at, ['items', 'knife', 'weight']));
expect(kw.value === 4 && kw.base === 1 && kw.changed, 'the admin sees it as changed, with what it was', `value ${kw.value}, was ${kw.base}`);
expect(list.filter((e) => e.changed).length === 2, 'and only those two are marked changed');

// a food's filling and a tool's uses, through the game's own eating and crafting
S.person().carry = { berry: 2 }; S.person().stats.hunger = 20; S.person().statsAt = Date.now();
await S.ask(S.player, { t: 'eat', kind: 'berry' });
const rose1 = S.person().stats.hunger - 20;
await S.tool({ t: 'a.liveItem', at: ['items', 'berry', 'eat', 'hunger'], value: 25 });
S.person().stats.hunger = 20; S.person().statsAt = Date.now();
await S.ask(S.player, { t: 'eat', kind: 'berry' });
const rose2 = S.person().stats.hunger - 20;
expect(Math.abs(rose1 - FILE.items.berry.eat.hunger) < 0.5 && Math.abs(rose2 - 25) < 0.5, 'a berry fills what the file says, then what the admin says', `${rose1.toFixed(1)} then ${rose2.toFixed(1)}`);
await S.tool({ t: 'a.liveItem', at: ['items', 'berry', 'eat', 'hunger'], value: null });
await S.tool({ t: 'a.liveItem', at: ['items', 'stone-axe', 'uses'], value: 3 });
S.person().carry = { 'axe-head': 1, stick: 1, twine: 1 }; S.person().wear = {};
await S.ask(S.player, { t: 'craft', id: 'stone-axe' });
const me = S.player.got.filter((m) => m.t === 'me').pop();
expect(S.person().carry['stone-axe'] === 1 && [].concat((me.wear || {})['stone-axe'] ?? [])[0] === 3, 'a stone axe made now has the admin\'s 3 uses, not the file\'s', `wear ${JSON.stringify((me.wear || {})['stone-axe'])}, file says ${FILE.items['stone-axe'].uses}`);
await S.tool({ t: 'a.liveItem', at: ['items', 'stone-axe', 'uses'], value: null });
S.person().carry = {}; S.person().wear = {};

console.log('C. the limits on what can be changed');
await S.tool({ t: 'a.liveItem', at: ['items', 'log', 'weight'], value: 2.6 });
expect(valueAt(await view(), ['items', 'log', 'weight']) === 3, 'weights are whole numbers (2.6 becomes 3)');
await S.tool({ t: 'a.liveItem', at: ['items', 'log', 'weight'], value: -5 });
expect(valueAt(await view(), ['items', 'log', 'weight']) === 0, 'never below 0');
const before = JSON.stringify(await view());
const refused = [];
for (const [at, value] of [[['items', 'stick', 'uses'], 5], [['items', 'berry', 'eat', 'thirst'], 50], [['recipes', 'knife', 'needs', 'log'], 1], [['items', 'no-such-thing', 'weight'], 2],
  [['items', '__proto__', 'weight'], 2], [['recipes', 'knife', 'needs', '__proto__'], 2], [['items', 'knife', 'weight', 'x'], 2], [['items', 'knife'], 2], ['items.knife.weight', 2], [['items', 'knife', 'weight'], 'heavy'], [['items', 'knife', 'places'], 1]]) {
  refused.push(await S.tool({ t: 'a.liveItem', at, value }));
}
expect(refused.every((t) => t === "That can't be changed"), 'a stick can\'t be made a tool, a food can\'t fill a new need, a recipe can\'t gain an ingredient, and nonsense is refused', `${refused.length} tries`);
expect(JSON.stringify(await view()) === before && ({}).weight === undefined, 'and none of those changed anything');
await S.ask(S.player, { t: 'a.liveItem', at: ['items', 'knife', 'weight'], value: 9 });
expect(valueAt(await view(), ['items', 'knife', 'weight']) === 4, 'a player can\'t change anything');

console.log('D. what wins: the admin, until Reset; the file, once they agree');
await S.tool({ t: 'a.liveItem', at: ['items', 'log', 'weight'], value: FILE.items.log.weight });
expect(!(store.get('liveItems').items || {}).log, 'a number set to the same as the file\'s is not kept as a change');
const kept = structuredClone(store.get('liveItems'));
expect(same(kept, { items: { knife: { weight: 4 } }, recipes: { knife: { needs: { stick: 2 } } } }), 'what is stored is just the two changes', JSON.stringify(kept));
S = await start(store); // the server restarts on the same storage (a new build, or Cloudflare moving it)
list = await view();
expect(valueAt(list, ['items', 'knife', 'weight']) === 4 && valueAt(list, ['recipes', 'knife', 'needs', 'stick']) === 2, 'after a restart the admin\'s numbers still win');
expect(await S.tool({ t: 'a.liveItem', at: ['items', 'knife', 'weight'], value: null }) === 'Back to what the game file says', 'Reset puts one back');
expect(valueAt(await view(), ['items', 'knife', 'weight']) === FILE.items.knife.weight, 'to the file\'s number');
// changes left behind for things a later build took out, or that are no longer allowed: ignored, and dropped
store.set('liveItems', { items: { 'old-thing': { weight: 9 }, knife: { weight: 3, places: 'x' }, stick: { uses: 7 }, berry: { eat: { hunger: 12, thirst: 40 } } }, recipes: { 'old-recipe': { needs: { stick: 5 } }, knife: { needs: { log: 3 } } }, junk: 5 });
S = await start(store);
list = await view();
expect(valueAt(list, ['items', 'knife', 'weight']) === 3 && valueAt(list, ['items', 'berry', 'eat', 'hunger']) === 12, 'changes that still make sense are used');
expect(list.filter((e) => e.changed).length === 2 && !list.some((e) => e.at.includes('old-thing') || e.at.includes('old-recipe')), 'changes for things that are gone, or not allowed, are ignored', `${list.filter((e) => e.changed).length} changed`);
await S.tool({ t: 'a.liveItem', at: ['items', 'knife', 'weight'], value: null });
expect(same(store.get('liveItems'), { items: { knife: {}, berry: { eat: { hunger: 12 } } } }) || same(store.get('liveItems'), { items: { berry: { eat: { hunger: 12 } } } }), 'and they are dropped from what is stored at the next change', JSON.stringify(store.get('liveItems')));

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nAll ${results.length} passed`);
process.exit(failed ? 1 : 0);
