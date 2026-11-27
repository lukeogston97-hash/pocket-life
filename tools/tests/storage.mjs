// Storage (0.2.2, the small wooden crate), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node storage.mjs   (exit 0: all as it should be)
// What it checks: planks are split from a log on the craft mat with the stone axe kept; the crate is made from 4 planks,
// 4 sticks and 2 twine, and only goes in your own camp; once built, things go in and out by its 5 squares (the same stacks
// as the inventory), tools keep their wear both ways, a crate can't go in a crate, taking out stops at what you can carry,
// you have to be by it, someone else's camp is off limits until the camp ends; it can't be packed up or taken apart until
// it's empty; the game is told what's in it; the admin's Empty it and Remove put what's in it on the ground.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000;
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
w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 4 * HOUR, placed: [], trees: {}, rocks: {}, pond: { fish: 10, at: Date.now() } };
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
const said = (got) => (got.find((m) => m.t === 'placeNo') || {}).why || '';
const crates = () => w.placedList().filter((th) => th.kind === 'small-crate');
const fire = (id, x, z, more = {}) => ({ id, kind: 'campfire', x, z, rot: 0, built: true, fuel: 100 * HOUR, lit: true, at: Date.now(), ...more });
const fresh = async () => { w.work = new Map(); await wait(1050); }; // (the time guard, and the spam limits)
const KNIFE = DATA.items.knife.tool.uses;

const { s: kimS, p: kim } = await join('kim', 'Kim', [20, 20]);
const { s: patS, p: pat } = await join('pat', 'Pat', [-20, 20]);
w.placedList().push(fire(1, 20, 20, { claim: kim.who }), fire(2, -20, 20, { claim: pat.who }));
w.work = new Map();

console.log('A. planks and the crate on the craft mat');
const plank = DATA.recipes.find((r) => r.id === 'plank'), crateR = DATA.recipes.find((r) => r.id === 'small-crate');
expect(plank && JSON.stringify(plank.needs) === '{"log":1}' && JSON.stringify(plank.keeps) === '{"stone-axe":1}' && plank.makes.plank === 2, 'planks: 1 log split with the stone axe (kept) makes 2', JSON.stringify(plank));
expect(crateR && JSON.stringify(crateR.needs) === '{"plank":4,"stick":4,"twine":2}' && crateR.makes['small-crate'] === 1, 'the crate: 4 planks, 4 sticks and 2 twine', JSON.stringify(crateR && crateR.needs));
expect(DATA.placeables['small-crate'].storage.squares === 5 && DATA.placeables['small-crate'].inCamp, 'it holds 5 squares and only goes in your camp');
Object.assign(kim, { x: 22, z: 20, carry: { log: 2, 'stone-axe': 1, stick: 4, twine: 2 }, wear: {}, bar: { 'stone-axe': 1 } });
await ask(kimS, { t: 'craft', id: 'plank' });
await fresh(); await ask(kimS, { t: 'craft', id: 'plank' });
expect(kim.carry.plank === 4 && !kim.carry.log && kim.carry['stone-axe'] === 1, 'two goes: 4 planks, no logs, and the axe is still there', JSON.stringify(kim.carry));
await fresh(); await ask(kimS, { t: 'craft', id: 'small-crate' });
expect(kim.carry['small-crate'] === 1 && !kim.carry.plank && !kim.carry.stick && !kim.carry.twine, 'made a small wooden crate', JSON.stringify(kim.carry));

console.log('B. it only goes in your own camp');
Object.assign(kim, { x: 34, z: 20 });
let got = await ask(kimS, { t: 'place', kind: 'small-crate', x: 35, z: 20, rot: 0 });
expect(said(got) === 'Small wooden crates only go in your camp' && !crates().length, 'outside their camp: no', said(got));
Object.assign(kim, { x: -23, z: 20 });
await fresh(); got = await ask(kimS, { t: 'place', kind: 'small-crate', x: -24, z: 20, rot: 0 });
expect(said(got).startsWith('This belongs to') && !crates().length, "in someone else's camp: no", said(got));
Object.assign(kim, { x: 23, z: 22 });
await fresh(); got = await ask(kimS, { t: 'place', kind: 'small-crate', x: 24, z: 22, rot: 0 });
const box = crates()[0];
expect(box && !box.built && !kim.carry['small-crate'], 'in their camp: put down as a site', said(got));
await fresh(); await ask(kimS, { t: 'build', id: box.id });
expect(box.built, 'and built');

console.log('C. putting things in');
Object.assign(kim, { carry: { stick: 15, berry: 3, knife: 2, 'small-crate': 1, stone: 10 }, wear: { knife: [KNIFE, 7] }, bar: { knife: 1 } });
await fresh(); got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'stick', n: 15 });
expect(box.store.stick === 15 && !kim.carry.stick, '15 sticks go in (2 squares: 10 and 5)', JSON.stringify(box.store));
const view = got.find((m) => m.t === 'placed' && m.thing.id === box.id) || kimS.got.filter((m) => m.t === 'placed' && m.thing.id === box.id).pop();
expect(view && view.thing.store && view.thing.store.stick === 15, 'the game is told what is in it', JSON.stringify(view && view.thing.store));
got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'knife', which: 1 });
expect(box.store.knife === 1 && JSON.stringify(box.wear.knife) === '[7]' && kim.carry.knife === 1 && kim.bar.knife === 1 && JSON.stringify(kim.wear.knife) === `[${KNIFE}]`, 'a spare knife goes in with its wear (7 uses), the one on the tool bar stays', `${JSON.stringify(box.wear)} ${JSON.stringify(kim.wear)}`);
const seen = kimS.got.filter((m) => m.t === 'placed' && m.thing.id === box.id).pop();
expect(seen && seen.thing.wear && JSON.stringify(seen.thing.wear.knife) === '[7]', 'and the game is told how worn it is');
got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'small-crate', n: 1 });
expect(said(got) === "Small wooden crates can't go in a crate" && kim.carry['small-crate'] === 1, "a crate can't go in a crate", said(got));
got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'berry', n: 3 });
expect(box.store.berry === 3, '3 berries: the fourth square');
got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'stone', n: 10 });
expect(box.store.stone === 10 && !kim.carry.stone, '10 stones: the fifth square');
Object.assign(kim, { carry: { ...kim.carry, log: 1 } });
got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'log', n: 1 });
expect(said(got) === 'The crate is full' && kim.carry.log === 1, 'all 5 squares used: The crate is full', said(got));
Object.assign(kim, { carry: { ...kim.carry, stick: 8 } });
got = await ask(kimS, { t: 'putIn', id: box.id, kind: 'stick', n: 8 });
expect(box.store.stick === 20 && kim.carry.stick === 3, "but its sticks' half-full square tops up: 5 more go in, 3 stay", `${box.store.stick} in, ${kim.carry.stick} left`);

console.log('D. taking things out');
await fresh(); got = await ask(kimS, { t: 'takeOut', id: box.id, kind: 'stick', n: 4 });
expect(box.store.stick === 16 && kim.carry.stick === 7, '4 sticks out', `${box.store.stick} in, ${kim.carry.stick} carried`);
Object.assign(kim, { bar: {}, wear: {}, carry: { stick: 7, log: 1 } }); // (the knife on the bar put down)
got = await ask(kimS, { t: 'takeOut', id: box.id, kind: 'knife' });
expect(!box.store.knife && !box.wear && kim.bar.knife === 1 && JSON.stringify(kim.wear.knife) === '[7]', 'the knife comes out still worn (7 uses), straight onto the tool bar', `${JSON.stringify(kim.wear)} ${JSON.stringify(kim.bar)}`);
Object.assign(kim, { carry: { ...kim.carry, log: 5 } }); // 25 weight + 7 sticks: 32, over the 30
got = await ask(kimS, { t: 'takeOut', id: box.id, kind: 'stone', n: 10 });
expect(said(got) === 'Too heavy to carry' && box.store.stone === 10, 'too heavy: nothing comes out', said(got));
Object.assign(kim, { carry: { stick: 7, log: 4 } }); // 27 of 30
await fresh(); got = await ask(kimS, { t: 'takeOut', id: box.id, kind: 'stone', n: 10 });
expect(box.store.stone === 7 && kim.carry.stone === 3, 'Take all stops at what you can carry: 3 of the 10 stones', `${box.store.stone} in, ${kim.carry.stone} carried`);
Object.assign(kim, { x: 30, z: 22 });
await fresh(); got = await ask(kimS, { t: 'takeOut', id: box.id, kind: 'berry', n: 1 });
expect(said(got) === 'Too far away' && box.store.berry === 3, 'from 6 m away: Too far away', said(got));

console.log("E. someone else's camp, until it ends");
Object.assign(pat, { x: 25.5, z: 22, carry: { stick: 2 }, wear: {}, bar: {} });
await fresh(); got = await ask(patS, { t: 'takeOut', id: box.id, kind: 'berry', n: 3 });
expect(said(got).startsWith('This belongs to') && box.store.berry === 3 && !pat.carry.berry, "Pat can't take things out of Kim's crate", said(got));
got = await ask(patS, { t: 'putIn', id: box.id, kind: 'stick', n: 2 });
expect(said(got).startsWith('This belongs to') && pat.carry.stick === 2, 'or put things in', said(got));
w.placedById(1).lit = false; w.placedById(1).fuel = 0; // Kim's fire goes out: the camp ends
await fresh(); got = await ask(patS, { t: 'takeOut', id: box.id, kind: 'berry', n: 3 });
expect(!said(got) && !box.store.berry && pat.carry.berry === 3, 'once the camp has ended, anyone can (Luke)', said(got));
w.placedById(1).lit = true; w.placedById(1).fuel = 100 * HOUR; w.placedById(1).at = Date.now(); w.placedById(1).claim = kim.who; // (Kim lights it again)

console.log('F. packing up only once it is empty');
Object.assign(kim, { x: 23, z: 22, carry: {}, wear: {}, bar: {} });
await fresh(); got = await ask(kimS, { t: 'unplace', id: box.id });
expect(said(got) === 'Empty it first' && crates().length === 1, 'Pack up: Empty it first', said(got));
got = await ask(kimS, { t: 'apart', id: box.id });
expect(said(got) === 'Empty it first' && crates().length === 1, 'Take apart: Empty it first', said(got));

console.log('G. the admin');
const adm = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
const tool = async (m) => { const a = (await ask(adm, m)).filter((x) => x.t === 'admin').pop(); return a ? a.text : null; };
const before = JSON.stringify(box.store);
got = await ask(kimS, { t: 'a.empty', id: box.id });
expect(JSON.stringify(box.store) === before, 'a player sending Empty it changes nothing');
box.store.knife = 1; box.wear = { knife: [4] };
const n0 = w.world.items.length;
let text = await tool({ t: 'a.empty', id: box.id });
const out = w.world.items.slice(n0);
expect(/things put on the ground$/.test(text || '') && !Object.keys(box.store).length && out.length === 24, "Empty it: what's in it goes on the ground round it", `${text}; ${out.length} things`);
expect(out.find((it) => it.kind === 'knife').uses === 4 && out.every((it) => Math.hypot(it.x - box.x, it.z - box.z) < 1.6), 'the knife keeps its wear, and everything lands by the crate');
text = await tool({ t: 'a.empty', id: box.id });
expect(text === "There's nothing in it", 'and again: nothing in it', text);
await fresh(); got = await ask(kimS, { t: 'unplace', id: box.id });
expect(!crates().length && kim.carry['small-crate'] === 1, 'empty: Kim packs it up', said(got));
Object.assign(kim, { x: 23, z: 22 });
await fresh(); await ask(kimS, { t: 'place', kind: 'small-crate', x: 24, z: 22, rot: 0 });
const box2 = crates()[0];
await fresh(); await ask(kimS, { t: 'build', id: box2.id });
Object.assign(kim, { carry: { berry: 4 } });
await ask(kimS, { t: 'putIn', id: box2.id, kind: 'berry', n: 4 });
const n1 = w.world.items.length;
await ask(adm, { t: 'a.remove', id: box2.id });
expect(!crates().length && w.world.items.slice(n1).filter((it) => it.kind === 'berry').length === 4, "Remove: the crate goes, and what's in it lands on the ground");
const log = (await ask(adm, { t: 'a.log' })).find((x) => x.t === 'adminLog').list;
const where = `small-crate at ${Math.round(box.x)}, ${Math.round(box.z)}`; // (on the 1 m placing grid)
expect(log.some((l) => l.text.startsWith(`Empty storage (${where}): `)), 'Empty it is in the Log', log.slice(0, 3).map((l) => l.text).join(' | '));

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} ok`);
process.exit(failed ? 1 : 0);
