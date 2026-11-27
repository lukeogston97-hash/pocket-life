// Farming (0.1.18, Luke), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node farming.mjs   (exit 0: all as it should be)
// What it checks: a farm field is dug with the stone hoe on the tool bar, only in your own camp, on the placing grid (1 m squares since 0.2.2),
// and wears the hoe; it can't be packed up or taken apart, only flattened with the hoe (whatever grew is lost); berry
// seeds are planted on an empty field and used up; the crop grows by itself in about a day (worked out from when it was
// planted); once grown it's picked like a wild berry bush (2 at a time with the knife); someone else's camp is off
// limits; away, a task list digs, plants and picks; the admin's Grow, Regrow everything and Planted crops grow in.
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
const fields = () => w.placedList().filter((th) => th.kind === 'field');
const fire = (id, x, z, more = {}) => ({ id, kind: 'campfire', x, z, rot: 0, built: true, fuel: 100 * HOUR, lit: true, at: Date.now(), ...more });

const { s: kimS, p: kim } = await join('kim', 'Kim', [20, 20]);
const { s: patS, p: pat } = await join('pat', 'Pat', [-20, 20]);
w.placedList().push(fire(1, 20, 20, { claim: kim.who }), fire(2, -20, 20, { claim: pat.who }));
w.work = new Map(); // (the time guard: each test acts at once)
const fresh = async () => { w.work = new Map(); await wait(1050); }; // (the time guard, and the spam limit of 1 a second, burst 3)

console.log('A. digging a farm field');
Object.assign(kim, { x: 23, z: 20, carry: { 'stone-hoe': 1 }, wear: {}, bar: {} });
let got = await ask(kimS, { t: 'dig', kind: 'field', x: 24, z: 20, rot: 0 });
expect(said(got).includes('tool bar') && !fields().length, 'no hoe on the tool bar: no field', said(got));
kim.bar = { 'stone-hoe': 1 };
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: 24.13, z: 20.31, rot: 0 });
const f1 = fields()[0];
expect(f1 && f1.built && f1.x === 24.5 && f1.z === 20.5 && !said(got), 'dug: on the 1 m grid, ready straight away', f1 && `${f1.x}, ${f1.z}`);
expect([].concat(kim.wear['stone-hoe'])[0] === DATA.items['stone-hoe'].tool.uses - 1, 'the hoe wore by a use', JSON.stringify(kim.wear));
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: 24.5, z: 20.5, rot: 0 });
expect(said(got) === 'Too close to something else' && fields().length === 1, 'not on top of another field', said(got));
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: 25.5, z: 20.5, rot: 0 });
expect(fields().length === 2, 'but right beside one is fine (1 m squares side by side)');
Object.assign(kim, { x: 33, z: 20 });
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: 34, z: 20, rot: 0 });
expect(said(got) === 'Farm fields only go in your camp' && fields().length === 2, 'outside their camp: no', said(got));
Object.assign(kim, { x: -22, z: 20 });
await fresh(); got = await ask(kimS, { t: 'dig', kind: 'field', x: -23, z: 20, rot: 0 });
expect(said(got) === 'Farm fields only go in your camp', "in someone else's camp: no", said(got));

console.log('B. a field is flattened with the hoe, never packed up or taken apart');
Object.assign(kim, { x: 26.5, z: 21.5 });
const f2 = fields()[1];
got = await ask(kimS, { t: 'unplace', id: f2.id });
expect(said(got) === 'Flatten it with a hoe' && fields().length === 2, 'Pack up: no', said(got));
got = await ask(kimS, { t: 'apart', id: f2.id });
expect(said(got) === 'Flatten it with a hoe' && fields().length === 2, 'Take apart: no', said(got));
await fresh(); got = await ask(kimS, { t: 'flatten', id: f2.id });
expect(fields().length === 1 && got.some((m) => m.t === 'me'), 'Flatten: gone');

console.log('C. planting and growing');
Object.assign(kim, { x: 25.5, z: 20.25 });
await fresh(); got = await ask(kimS, { t: 'plant', id: f1.id, seed: 'berry-seeds' });
expect(said(got) === 'You have no seeds to plant' && !f1.crop, 'no seeds: nothing planted', said(got));
kim.carry['berry-seeds'] = 2;
await fresh(); got = await ask(kimS, { t: 'plant', id: f1.id, seed: 'berry-seeds' });
expect(f1.crop && f1.crop.kind === 'berry-bush' && kim.carry['berry-seeds'] === 1, 'planted: a berry bush, one seed used', JSON.stringify(f1.crop));
await fresh(); got = await ask(kimS, { t: 'plant', id: f1.id, seed: 'berry-seeds' });
expect(said(got) === 'Something is already growing here' && kim.carry['berry-seeds'] === 1, 'one crop a field', said(got));
const view = (th) => w.placedView(th);
expect(view(f1).crop && view(f1).crop.age < 5000 && view(f1).crop.berries === null, 'everyone is told what grows there and how old it is');
got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(said(got) === 'Not grown yet', 'not grown yet: nothing to pick', said(got));
f1.crop.at = Date.now() - 23 * HOUR;
got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(said(got) === 'Not grown yet', 'still growing after 23 hours (about a day)', said(got));
f1.crop.at = Date.now() - 24 * HOUR - 1000;
kim.carry = { 'berry-seeds': 1 }; kim.bar = {};
got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(kim.carry.berry === 1 && f1.crop.berries[0] === 4, 'grown after a day: picked 1 berry, 4 left', JSON.stringify(f1.crop.berries));
Object.assign(kim.carry, { knife: 1 }); kim.bar = { knife: 1 };
got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(kim.carry.berry === 3 && f1.crop.berries[0] === 2, 'with the knife on the tool bar: 2 at a time', JSON.stringify(f1.crop.berries));
await ask(kimS, { t: 'harvest', id: f1.id });
got = await ask(kimS, { t: 'harvest', id: f1.id });
expect(kim.carry.berry === 5 && said(got) === 'None to pick yet', 'picked bare, then none to pick until they grow back', said(got));

console.log("D. someone else's farm");
Object.assign(pat, { x: 25.5, z: 21 });
pat.carry = { 'stone-hoe': 1 }; pat.bar = { 'stone-hoe': 1 };
f1.crop.berries = null;
got = await ask(patS, { t: 'harvest', id: f1.id });
expect(said(got).startsWith('This belongs to') && !pat.carry.berry, "Pat can't pick Kim's berries", said(got));
await fresh(); got = await ask(patS, { t: 'flatten', id: f1.id });
expect(said(got).startsWith('This belongs to') && fields().length === 1, "or flatten Kim's field", said(got));

console.log('E. while away: a task list digs, plants and picks');
Object.assign(kim, { x: 22, z: 22, carry: { 'stone-hoe': 1, 'berry-seeds': 1 }, bar: { 'stone-hoe': 1 }, wear: {} });
const before = fields().length;
const tasks = w.cleanTasks([{ type: 'dig', kind: 'field', x: 22.5, z: 23.5, rot: 0 }, { type: 'harvest', id: f1.id }, { type: 'bogus' }, { type: 'plant', id: 999, seed: 'berry-seeds' }]);
expect(tasks.length === 3 && tasks[0].type === 'dig' && tasks[2].seed === 'berry-seeds', 'the list is tidied (a kind of task that does not exist goes)', tasks.map((t) => t.type).join());
kim.tasks = tasks;
const how = w.taskHow(kim, kim.tasks[0], null, Date.now());
expect(how && how.pose === 'chop' && how.seconds === DATA.placeables.field.makeSeconds, 'digging: walk over, then 8 s with the hoe', JSON.stringify(how));
w.finishTask(kim);
const dug = fields().find((th) => th.x === 22.5 && th.z === 23.5);
expect(fields().length === before + 1 && !!dug, 'they dug it', fields().length);
w.finishTask(kim);
expect(kim.carry.berry >= 1, 'picked the grown bush while away', JSON.stringify(kim.carry));
kim.tasks = w.cleanTasks([{ type: 'plant', id: dug.id, seed: 'berry-seeds' }]);
w.finishTask(kim);
expect(dug.crop && dug.crop.kind === 'berry-bush' && !kim.carry['berry-seeds'], 'and planted the new field');

console.log('F. the admin');
const adm = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
await w.webSocketMessage(adm, JSON.stringify({ t: 'a.regrow', what: 'placed', id: dug.id }));
await wait(5);
expect(view(dug).crop.age >= 24 * HOUR && view(dug).crop.berries === null, 'Grow: grown and full of berries straight away');
dug.crop.at = Date.now(); f1.crop.berries = [0, Date.now()];
await w.webSocketMessage(adm, JSON.stringify({ t: 'a.regrowAll' }));
await wait(5);
expect(view(dug).crop.age >= 24 * HOUR && view(f1).crop.berries === null, 'Regrow everything grows every crop too');
// the live setting (Settings > Farming): how long a crop takes, for every crop, straight away
dug.crop.at = Date.now() - 0.2 * HOUR;
await w.webSocketMessage(adm, JSON.stringify({ t: 'a.live', id: 'cropGrowHours', value: 0.1 }));
await wait(5);
const canPick = () => !!w.taskHow(kim, { type: 'harvest', id: dug.id }, null, Date.now()); // (only once it's grown)
expect(canPick(), 'Planted crops grow in 0.1 h: a crop planted 12 minutes ago can be picked');
await w.webSocketMessage(adm, JSON.stringify({ t: 'a.live', id: 'cropGrowHours', value: null }));
await wait(5);
expect(!canPick(), 'and back to 24 h with Reset: still growing');

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} ok`);
process.exit(failed ? 1 : 0);
