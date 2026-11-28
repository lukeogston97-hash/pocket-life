// The wild and clearing land (0.2.9, Luke), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node wild.mjs   (exit 0: all as it should be)
// What it checks: stumps, bushes, grass and boulders are cleared only in your own camp, with the right tool, and drop
// what they give; nothing cleared comes back while the camp is there; the wild grows back by itself (one of each kind
// every so often, never near anyone, never on something placed, never past how full the admin says), as thick as it
// was laid out; loose sticks and stones never turn up in camps; apple trees are picked one apple at a time, drop their
// apples when chopped and grow them back from when the stump has grown back; an apple tree on a farm field needs the
// squares round it empty, is chopped to a stump that grows back in a day, and its stump can be dug up; the new tasks
// carry on while you're away; the admin's Regrow everything and live settings.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000, DAY = 24 * HOUR;
const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {} };
}
const socks = [];
const ctx = { storage: storageOn(new Map()), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
await wait(30);
// the layout: trees 0-3 out in the wild (tree 1 an apple tree), tree 4 in Kim's camp; boulder 0 in the camp, boulder 1
// and rock 2 out in the wild; a berry bush, a bush with no berries and a clump of grass in the camp and out in the wild
const LAYOUT = { trees: [[30, 30], [32, 30], [40, -30], [-40, -30], [24, 24]], apples: [1], rocks: [[26, 20], [34, 34], [-30, -30]], boulders: [0, 1],
  bushes: [[22, 22], [45, 45]], shrubs: [[18, 18], [44, -44]], plants: { tallGrass: [[21, 17], [46, 40]] }, oldStumps: [], shore: [], open: [],
  v: DATA.version, b: DATA.build, e: DATA.era };
w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 4 * HOUR, placed: [], trees: {}, rocks: {}, pond: { fish: 10, at: Date.now() },
  layout: structuredClone(LAYOUT) };
const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); await wait(5); return s.got.slice(from); };
async function join(pid, name, at) {
  const s = sock({ from: `addr-${pid}` });
  await ask(s, { t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid });
  await ask(s, { t: 'create', name, age: 30, look: {} });
  const p = w.persons.get(s.att.who);
  Object.assign(p, { x: at[0], z: at[1], stats: { health: 100, rest: 90, hunger: 90, thirst: 90, energy: 100 }, statsAt: Date.now() });
  return { s, p };
}
const said = (got) => (got.find((m) => m.t === 'placeNo' || m.t === 'appleNo') || {}).why || '';
const fire = (id, x, z, more = {}) => ({ id, kind: 'campfire', x, z, rot: 0, built: true, fuel: 100 * HOUR, lit: true, at: Date.now(), ...more });
const ground = () => { const k = {}; for (const it of w.world.items) k[it.kind] = (k[it.kind] || 0) + 1; return k; };
const clearGround = () => { w.world.items = []; };
const fresh = async () => { w.work = new Map(); await wait(1050); }; // (the time guard, and the spam limits)
const W = w.world, at = (who, x, z) => Object.assign(who, { x, z });

const { s: kimS, p: kim } = await join('kim', 'Kim', [21, 21]);
const { p: pat } = await join('pat', 'Pat', [-45, 45]);
w.world.layout = structuredClone(LAYOUT); // (joining may have asked for a layout)
w.placedList().push(fire(1, 20, 20, { claim: kim.who }));
Object.assign(kim, { carry: { 'stone-hoe': 1, 'stone-axe': 1, 'stone-pickaxe': 1 }, wear: {}, bar: { 'stone-hoe': 1, 'stone-axe': 1, 'stone-pickaxe': 1 } });
w.work = new Map();

console.log('A. clearing land, only in your own camp');
at(kim, 22, 21);
let got = await ask(kimS, { t: 'clear', what: 'bush', idx: 0 });
expect(w.isCleared('bush', 0) && ground().stick === 1 && ground().berry === 5, 'a berry bush in their camp dug up: a stick, and its 5 berries fall', JSON.stringify(ground()));
expect(w.berriesOn(0) === 0, 'nothing left to pick on it');
await fresh(); got = await ask(kimS, { t: 'clear', what: 'bush', idx: 0 });
expect(said(got) === 'Someone dug it up first', 'it can only be dug up once', said(got));
await fresh(); got = await ask(kimS, { t: 'pick', bush: 0 });
expect(got.some((m) => m.t === 'picked' && !m.ok) && !(kim.carry.berry > 0), 'and no berries can be picked off it');
at(kim, 45, 44); await fresh(); got = await ask(kimS, { t: 'clear', what: 'bush', idx: 1 });
expect(said(got) === 'Only in your camp' && !w.isCleared('bush', 1), 'out in the wild: Only in your camp', said(got));
at(kim, 19, 18); clearGround(); kim.bar = { 'stone-axe': 1, 'stone-pickaxe': 1 }; await fresh(); got = await ask(kimS, { t: 'clear', what: 'shrub', idx: 0 });
expect(said(got).includes('stone hoe') && !w.isCleared('shrub', 0), 'without the hoe on the tool bar: no', said(got));
kim.bar['stone-hoe'] = 1; await fresh(); got = await ask(kimS, { t: 'clear', what: 'shrub', idx: 0 });
expect(w.isCleared('shrub', 0) && ground().stick === 1 && got.some((m) => m.t === 'me'), 'a bush with no berries dug up with the hoe: a stick', JSON.stringify(ground()));
expect([].concat(kim.wear['stone-hoe'])[0] === DATA.items['stone-hoe'].tool.uses - 2, 'the hoe wore by a use each time', JSON.stringify(kim.wear));
at(kim, 21, 18); clearGround(); await fresh(); got = await ask(kimS, { t: 'clear', what: 'plant', plant: 'tallGrass', idx: 0 });
expect(w.isCleared('plant', 0, 'tallGrass') && ground().twine === 1, 'grass cleared: its twine falls', JSON.stringify(ground()));
await fresh(); got = await ask(kimS, { t: 'cut', plant: 'tallGrass', i: 0 });
expect(!(kim.carry.twine > 0) && got.some((m) => m.t === 'cutNo' && m.why === "It's been cleared"), 'cleared grass can no longer be cut', JSON.stringify(got.map((m) => m.t)));
at(kim, 27, 20); clearGround(); await fresh(); got = await ask(kimS, { t: 'clear', what: 'boulder', idx: 0 });
expect(W.rocks[0] && W.rocks[0][0] === 'gone' && ground().stone === 6, 'a boulder in their camp broken right down: 6 stones', JSON.stringify(ground()));
at(kim, 35, 34); await fresh(); got = await ask(kimS, { t: 'clear', what: 'boulder', idx: 1 });
expect(said(got) === 'Only in your camp' && !W.rocks[1], 'one out in the wild: Only in your camp', said(got));
await fresh(); got = await ask(kimS, { t: 'clear', what: 'boulder', idx: 2 });
expect(said(got) === "That can't be broken up", 'a small rock is broken the usual way, not cleared', said(got));
at(kim, 30, 31); clearGround(); await fresh(); await ask(kimS, { t: 'chop', what: 'tree', idx: 0 });
await fresh(); got = await ask(kimS, { t: 'chop', what: 'stump', idx: 0 });
expect(said(got) === 'Only in your camp' && W.trees[0][0] === 'stump', 'a stump out in the wild can\'t be dug up (it grows back)', said(got));
at(kim, 24, 25); await fresh(); await ask(kimS, { t: 'chop', what: 'tree', idx: 4 });
await fresh(); got = await ask(kimS, { t: 'chop', what: 'stump', idx: 4 });
expect(W.trees[4][0] === 'gone', 'one in their camp can', JSON.stringify(W.trees[4]));
for (const bad of [{ what: 'tree', idx: 0 }, { what: 'bush', idx: 99 }, { what: 'plant', plant: 'nope', idx: 0 }, { what: 'boulder', idx: -1 }, { what: 'shrub', idx: 1.5 }]) {
  await fresh(); got = await ask(kimS, { t: 'clear', ...bad });
  expect(said(got), `nonsense is refused: ${JSON.stringify(bad)}`, said(got));
}

console.log('B. what was cleared in a camp stays cleared');
let t0 = Date.now();
w.topUpWild(t0); w.topUpWild(t0 + 100 * DAY);
expect(w.isCleared('bush', 0) && w.isCleared('shrub', 0) && w.isCleared('plant', 0, 'tallGrass') && W.rocks[0][0] === 'gone' && W.trees[4][0] === 'gone', 'even 100 days later, while the camp is there');
expect(!Object.keys(W.wildAt || {}).length, 'and nothing is waiting to grow back (the wild is all there)', JSON.stringify(W.wildAt));

console.log('C. the wild grows back');
at(kim, -30, -31); clearGround(); await fresh(); await ask(kimS, { t: 'quarry', what: 'rock', idx: 2, x: -30, z: -31 });
expect(W.rocks[2] && W.rocks[2][0] === 'gone' && ground().stone === 5, 'a rock out in the wild broken: 5 stones', JSON.stringify(ground()));
t0 = Date.now();
expect(w.topUpWild(t0) && W.wildAt.rock > t0, 'its wait starts (and is kept with the world)', JSON.stringify(W.wildAt));
w.topUpWild(t0 + 3 * HOUR);
expect(W.rocks[2], 'not back before rockBackHours', JSON.stringify(W.rocks));
w.topUpWild(t0 + 5 * HOUR);
expect(W.rocks[2], 'nor while someone is near where it goes');
at(kim, 21, 21); w.topUpWild(t0 + 5 * HOUR);
expect(!W.rocks[2], 'once nobody is near, it comes back', JSON.stringify(W.rocks));
w.topUpWild(t0 + 5 * HOUR);
expect(!W.wildAt.rock, 'and with nothing else gone, nothing is waiting');
// the camp ends: its land is the wild's again
w.placedList()[0].lit = false; w.placedList()[0].claim = null;
t0 = Date.now();
w.topUpWild(t0 + HOUR);
const waits = { ...W.wildAt };
expect(waits.tree && waits.bush && waits.tallGrass && waits.boulder, 'when the camp ends, what was cleared there starts to grow back', JSON.stringify(waits));
w.topUpWild(t0 + 4 * HOUR);
expect(W.trees[4][0] === 'gone' && w.isCleared('bush', 0), 'not while Kim is right there', JSON.stringify(W.trees[4]));
at(kim, -45, -45);
const before = socks.flatMap((s) => s.got).length;
w.topUpWild(t0 + 4 * HOUR);
const heard = socks.flatMap((s) => s.got).slice(before);
expect(W.trees[4][0] === 'young' && heard.some((m) => m.t === 'tree' && m.idx === 4 && m.state === 'young'), 'a tree comes back young, and everyone hears', JSON.stringify(W.trees[4]));
expect([w.isCleared('bush', 0), w.isCleared('shrub', 0)].filter((x) => x).length === 1, 'one of the two bushes comes back (one of each kind at a time)');
expect(!w.isCleared('plant', 0, 'tallGrass') && W.plants.tallGrass[0] > t0, 'the grass comes back as stubble, growing', JSON.stringify(W.plants));
expect(W.rocks[0] && W.rocks[0][0] === 'gone', 'the boulder waits longer (every 12 hours)');
if (!w.isCleared('bush', 0)) expect(w.berriesOn(0, t0 + 4 * HOUR) === 0 && heard.some((m) => m.t === 'bush' && m.bush === 0), 'a berry bush comes back with no berries yet');
// something placed on its spot: it doesn't come back there
w.placedList().push({ id: 9, kind: 'small-crate', x: 26.5, z: 20.5, rot: 0, built: true, fuel: 0, lit: false, at: Date.now() });
w.topUpWild(t0 + 30 * HOUR);
expect(W.rocks[0] && W.rocks[0][0] === 'gone', 'a boulder never comes back on something placed');
w.world.placed = w.placedList().filter((th) => th.id !== 9);
w.topUpWild(t0 + 30 * HOUR);
expect(!W.rocks[0], 'and does once it has gone', JSON.stringify(W.rocks));
// the young tree grows up in the same time as a stump
W.trees[4] = ['young', Date.now() - 3 * DAY];
await w.alarm();
expect(!W.trees[4], 'a young tree grows up into a tree', JSON.stringify(W.trees));
// how full the wild grows back (the admin's live setting)
const adm = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
await ask(adm, { t: 'a.live', id: 'wildGrowsBackTo', value: 50 });
W.trees[2] = ['gone', Date.now()]; W.trees[3] = ['gone', Date.now()]; delete W.trees[0]; // (4 of 5 trees standing: 80%)
w.topUpWild(Date.now()); w.topUpWild(Date.now() + 10 * HOUR);
expect(W.trees[2] && W.trees[3], 'with the wild at 50% or more, nothing more grows back', JSON.stringify(W.trees));
W.trees[0] = ['gone', Date.now()]; W.trees[1] = ['gone', Date.now()]; // (2 of 5: 40%)
w.topUpWild(Date.now() + 20 * HOUR);
const back = [0, 1, 2, 3].filter((i) => W.trees[i] && W.trees[i][0] === 'young').length;
expect(back === 1, 'below it, one comes back at a time', JSON.stringify(W.trees));
await ask(adm, { t: 'a.live', id: 'wildGrowsBackTo', value: null });
for (const i of [0, 1, 2, 3]) delete W.trees[i];
W.wildAt = {};

console.log('D. loose sticks and stones never turn up in a camp, or right next to someone');
w.placedList().push(fire(2, 20, 20, { claim: kim.who }));
at(kim, 0, 0); at(pat, -45, 45);
W.items = []; W.spots = { stick: [[21, 21], [-44, 45], [10, -10]] }; W.caps = { stick: 30 };
for (let k = 0; k < 60; k++) await w.respawn(Date.now());
const sticks = W.items.filter((it) => it.kind === 'stick');
expect(sticks.length > 0 && sticks.every((it) => Math.hypot(it.x - 10, it.z + 10) < 1), 'only at the spot that is neither in a camp nor by Pat', `${sticks.length} sticks`);
W.items = []; W.spots = {}; W.caps = {};

console.log('E. apple trees');
at(kim, 32, 29); clearGround(); delete W.trees[1]; W.apples = {};
await fresh(); got = await ask(kimS, { t: 'apple', idx: 1 });
expect(kim.carry.apple === 1 && w.applesOn(1) === 3, 'picking an apple tree: 1 apple, 3 left', `${kim.carry.apple}, ${w.applesOn(1)}`);
await fresh(); got = await ask(kimS, { t: 'apple', idx: 0 });
expect(said(got) === 'There are no apples on it', 'a tree that isn\'t an apple tree has none', said(got));
await fresh(); got = await ask(kimS, { t: 'chop', what: 'tree', idx: 1 });
expect(W.trees[1][0] === 'stump' && ground().apple === 3 && ground().log === 1 && ground().stick === 2, 'chopped down: a log, 2 sticks and its 3 apples fall', JSON.stringify(ground()));
await fresh(); got = await ask(kimS, { t: 'apple', idx: 1 });
expect(said(got) === "It's been chopped down" && kim.carry.apple === 1, 'a stump has no apples', said(got));
W.trees[1] = ['stump', Date.now() - 3 * DAY];
await w.alarm();
expect(!W.trees[1] && w.applesOn(1) === 0 && w.applesOn(1, Date.now() + 6.1 * HOUR) === 1, 'grown back, its apples grow from then: none yet, 1 after 6 hours', JSON.stringify(W.apples));
W.trees[1] = ['young', Date.now()];
await fresh(); got = await ask(kimS, { t: 'apple', idx: 1 });
expect(said(got) === "It's too young for apples", 'a young apple tree has none either', said(got));
await fresh(); got = await ask(kimS, { t: 'chop', what: 'tree', idx: 1 });
expect(W.trees[1][0] === 'young', 'and can\'t be chopped', JSON.stringify(W.trees[1]));
delete W.trees[1]; delete W.apples[1];

console.log('F. an apple tree on a farm field');
at(kim, 23.5, 20.5); clearGround(); kim.carry = { 'stone-hoe': 1, 'stone-axe': 1, 'apple-seeds': 2 }; kim.bar = { 'stone-hoe': 1, 'stone-axe': 1 };
await fresh(); await ask(kimS, { t: 'dig', kind: 'field', x: 24.5, z: 20.5, rot: 0 });
await fresh(); await ask(kimS, { t: 'dig', kind: 'field', x: 25.5, z: 20.5, rot: 0 });
const fieldsNow = () => w.placedList().filter((th) => th.kind === 'field');
const [f1, f2] = fieldsNow();
expect(f1 && f2, 'two fields side by side');
await fresh(); got = await ask(kimS, { t: 'plant', id: f1.id, seed: 'apple-seeds' });
expect(said(got) === 'It needs the squares round it empty' && !f1.crop, 'apple seeds next to another field: no', said(got));
await fresh(); await ask(kimS, { t: 'flatten', id: f2.id });
await fresh(); got = await ask(kimS, { t: 'plant', id: f1.id, seed: 'apple-seeds' });
expect(f1.crop && f1.crop.kind === 'apple-tree' && kim.carry['apple-seeds'] === 1, 'with the squares round it empty: planted', said(got));
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: 25.5, z: 21.5, rot: 0 });
expect(said(got) === 'Too close to the apple tree' && fieldsNow().length === 1, 'no new field next to it, even across a corner', said(got));
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: 26.5, z: 20.5, rot: 0 });
expect(fieldsNow().length === 2, 'two squares away is fine');
await fresh(); got = await ask(kimS, { t: 'treeCrop', id: f1.id, do: 'chop' });
expect(said(got) === 'Not grown yet', 'not grown: nothing to chop', said(got));
f1.crop.at = Date.now() - 25 * HOUR;
await fresh(); got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(kim.carry.apple === 1, 'grown: picked like a wild one', `${kim.carry.apple}`);
await fresh(); got = await ask(kimS, { t: 'treeCrop', id: f1.id, do: 'dig' });
expect(said(got) === 'Chop it down first', 'its stump can only be dug up once it\'s chopped', said(got));
clearGround(); await fresh(); got = await ask(kimS, { t: 'treeCrop', id: f1.id, do: 'chop' });
expect(f1.crop.stump && ground().log === 1 && ground().stick === 2 && ground().apple === 3, 'chopped: a log, 2 sticks and its 3 apples fall, and a stump is left', JSON.stringify(ground()));
expect(w.placedView(f1).crop.stump >= 0, 'the game is told how long ago it was chopped');
await fresh(); got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(said(got) === "It's a stump, growing back", 'nothing to pick off a stump', said(got));
f1.crop.stump = Date.now() - 25 * HOUR;
await fresh(); got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(said(got) === 'None to pick yet', 'a day later it has grown back, its apples growing from then', said(got));
f1.crop.stump = Date.now() - 31 * HOUR; f1.crop.berries = [0, Date.now() - 31 * HOUR];
await fresh(); got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(kim.carry.apple === 2 && !f1.crop.stump, '6 hours after that: an apple to pick, and it is just a tree again', `${kim.carry.apple}`);
await fresh(); await ask(kimS, { t: 'treeCrop', id: f1.id, do: 'chop' });
clearGround(); await fresh(); got = await ask(kimS, { t: 'treeCrop', id: f1.id, do: 'dig' });
expect(!f1.crop && ground().log === 1, 'its stump dug up: a log, and the field is empty again', JSON.stringify(ground()));

console.log('G. while away, and the admin');
const tasks = w.cleanTasks([{ type: 'apple', idx: 1 }, { type: 'clear', what: 'bush', idx: 0 }, { type: 'clear', what: 'plant', plant: 'tallGrass', idx: 0 }, { type: 'treeCrop', id: f1.id, do: 'chop' }, { type: 'clear', what: 'nope', idx: 0 }, { type: 'treeCrop', id: 1, do: 'burn' }]);
expect(tasks.length === 4, 'a task list keeps apples, clearing and a tree on a field, and drops nonsense', JSON.stringify(tasks));
at(kim, 33, 30);
expect(w.taskHow(kim, { type: 'apple', idx: 1 }, W.layout, Date.now()) && !w.taskHow(kim, { type: 'apple', idx: 0 }, W.layout, Date.now()), 'away, they pick apples off an apple tree (and only an apple tree)');
W.cleared = { 'bush:1': Date.now() };
expect(!w.taskHow(kim, { type: 'clear', what: 'shrub', idx: 1 }, W.layout, Date.now()), 'and never clear anything out in the wild');
W.trees = { 2: ['young', Date.now()], 1: ['stump', Date.now()] }; W.apples = { 1: [0, Date.now()] };
await ask(adm, { t: 'a.regrowAll' });
expect(!W.trees[2] && !W.trees[1] && w.applesOn(1) === 4, 'Regrow everything: young trees grown up, apple trees full', JSON.stringify(W.trees));
expect(!w.isCleared('bush', 1), 'and what was gone from the wild is back (nobody nearby or not)', JSON.stringify(W.cleared));
const live = w.liveView().map((d) => d.id);
expect(['wildTreeHours', 'wildBushHours', 'wildGrassHours', 'wildBoulderHours', 'rockBackHours', 'wildGrowsBackTo'].every((id) => live.includes(id)), "the admin's Settings has the wild's numbers", live.join(', '));
await ask(adm, { t: 'a.live', id: 'wildTreeHours', value: 5 });
expect(DATA.wild && w.wildKinds().find((k) => k.kind === 'tree').every === 5, 'and a changed one is used straight away');
await ask(adm, { t: 'a.live', id: 'wildTreeHours', value: null });

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad} of ${results.length} as they should be${bad ? `, ${bad} NOT` : ''}`);
process.exit(bad ? 1 : 0);
