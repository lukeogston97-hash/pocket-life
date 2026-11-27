// The basic shelter (0.2.5): somewhere to sleep, tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node shelter.mjs   (exit 0: all as it should be)
// What it checks: it's made from 3 logs, 8 sticks and 4 twine and only goes in your own camp; Sleep in it needs it built,
// you by its front and it not in someone else's camp, and puts you at its front; sleep there is twice as good as on the
// ground (Rest and Health fill twice as fast, Hunger and Thirst drop half as fast); one at a time; once the camp ends
// anyone can; it can't be packed up or taken apart while someone's asleep in it; everyone is told who's in it; getting
// up you're out; someone away walks over and sleeps in their camp's one when tired, and for the long sleep after a day
// away; a Sleep in shelter task carries on while away; coming back gets you out; the admin's Move waits and Remove gets
// the sleeper out.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000, MINUTE = 60000;
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
const LAYOUT = { trees: [[10, 10]], rocks: [[15, 5]], bushes: [[8, -8]], oldStumps: [], plants: { tallGrass: [[5, -5]] },
  shore: [[-0.4, -0.9], [-5.6, 4.4]], open: [[20, 24], [22, 18], [-20, 20]], v: DATA.version, b: DATA.build, e: DATA.era };
w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 4 * HOUR, placed: [], trees: {}, rocks: {}, pond: { fish: 10, at: Date.now() }, layout: LAYOUT };
const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); await wait(5); return s.got.slice(from); };
async function join(pid, name, at) {
  const s = sock({ from: `addr-${pid}` });
  await ask(s, { t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid });
  if (name) await ask(s, { t: 'create', name, age: 30, look: {} });
  const p = w.persons.get(s.att.who);
  if (p && at) Object.assign(p, { x: at[0], z: at[1], stats: { health: 100, rest: 90, hunger: 90, thirst: 90, energy: 100 }, statsAt: Date.now() });
  return { s, p };
}
const leave = async (s) => { await w.webSocketMessage(s, JSON.stringify({ t: 'bye' })); await wait(5); };
const said = (got) => (got.find((m) => m.t === 'placeNo') || {}).why || '';
const fire = (id, x, z, more = {}) => ({ id, kind: 'campfire', x, z, rot: 0, built: true, fuel: 100 * HOUR, lit: true, at: Date.now(), ...more });
const fresh = async () => { w.work = new Map(); await wait(1050); }; // (the time guard, and the spam limits)
const shelters = () => w.placedList().filter((th) => th.kind === 'basic-shelter');
const front = (th) => [th.x + Math.sin(th.rot || 0) * DATA.placeables['basic-shelter'].front, th.z + Math.cos(th.rot || 0) * DATA.placeables['basic-shelter'].front];
const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });

const { s: kimS, p: kim } = await join('kim', 'Kim', [20, 20]);
const { s: patS, p: pat } = await join('pat', 'Pat', [-20, 20]);
w.placedList().push(fire(1, 20, 20, { claim: kim.who }), fire(2, -20, 20, { claim: pat.who }));
w.work = new Map();

console.log('A. made on the craft mat, and only in your own camp');
const R = DATA.recipes.find((r) => r.id === 'basic-shelter'), P = DATA.placeables['basic-shelter'];
expect(R && JSON.stringify(R.needs) === '{"log":3,"stick":8,"twine":4}' && R.makes['basic-shelter'] === 1, 'the recipe: 3 logs, 8 sticks and 4 twine', JSON.stringify(R && R.needs));
expect(DATA.items['basic-shelter'].weight === 50 && DATA.items['basic-shelter'].places === 'basic-shelter', 'it weighs 50, the same as its parts (0.2.6 weights), and is placed');
expect(P.inCamp && P.bed && P.bed.sleepers === 1 && P.bed.better === 2 && JSON.stringify(P.size) === '[2,2]' && P.front > 1, 'only in your camp, 2 x 2 squares, one sleeper, twice as good', JSON.stringify(P));
Object.assign(kim, { carry: { log: 3, stick: 8, twine: 4 }, bar: {} });
await fresh(); await ask(kimS, { t: 'craft', id: 'basic-shelter' });
expect(kim.carry['basic-shelter'] === 1 && !kim.carry.log && !kim.carry.stick && !kim.carry.twine, 'made a basic shelter', JSON.stringify(kim.carry));
Object.assign(kim, { x: 36, z: 20 });
await fresh(); let got = await ask(kimS, { t: 'place', kind: 'basic-shelter', x: 37, z: 20, rot: 0 });
expect(said(got) === 'Basic shelters only go in your camp' && !shelters().length, 'outside their camp: no', said(got));
Object.assign(kim, { x: 24, z: 25.5 });
await fresh(); got = await ask(kimS, { t: 'place', kind: 'basic-shelter', x: 24, z: 24, rot: 0 });
const hut = shelters()[0];
expect(hut && !hut.built, 'in their camp: put down as a site', said(got));
await fresh(); await ask(kimS, { t: 'build', id: hut.id });
expect(hut.built, 'and built');

console.log('B. Sleep in it');
Object.assign(kim, { x: 4, z: 4 });
await fresh(); got = await ask(kimS, { t: 'sleep', on: true, bed: hut.id });
expect(said(got) === 'Too far away' && !kim.sleeping && !kim.bed, 'from across the world: Too far away', said(got));
Object.assign(pat, { x: front(hut)[0], z: front(hut)[1] });
await fresh(); got = await ask(patS, { t: 'sleep', on: true, bed: hut.id });
expect(said(got).startsWith('This belongs to') && !pat.sleeping, "someone else's camp: no", said(got));
Object.assign(pat, { x: -20, z: 22 });
const [fx, fz] = front(hut);
Object.assign(kim, { x: fx + 0.6, z: fz + 0.3 });
const before = patS.got.length;
await fresh(); got = await ask(kimS, { t: 'sleep', on: true, bed: hut.id });
const me = got.find((m) => m.t === 'me'), told = patS.got.slice(before).find((m) => m.t === 'state' && m.id === kim.who);
expect(kim.sleeping && kim.bed === hut.id && Math.hypot(kim.x - fx, kim.z - fz) < 0.01, 'in it: asleep, and where they are is its front', `${kim.x}, ${kim.z}`);
expect(me && me.sleeping && me.bed === hut.id, 'their game is told they are in it');
expect(told && told.state === 'sleeping' && told.bed === hut.id, 'and everyone else too (so they draw them lying inside)', JSON.stringify(told));
expect(w.pub(kim).bed === hut.id, 'someone joining sees them in it too');

console.log('C. twice as good as sleeping on the ground');
Object.assign(pat, { sleeping: true, bed: null, x: -20, z: 22 });
const t0 = Date.now();
for (const p of [kim, pat]) Object.assign(p, { stats: { health: 50, rest: 20, hunger: 80, thirst: 80, energy: 100 }, statsAt: t0 - HOUR });
w.catchUp(kim, t0); w.catchUp(pat, t0);
const gain = (p, k, was) => p.stats[k] - was;
const ratio = (k, was) => gain(kim, k, was) / gain(pat, k, was);
expect(Math.abs(ratio('rest', 20) - 2) < 0.01, 'Rest fills twice as fast', `${gain(kim, 'rest', 20).toFixed(2)} in the shelter, ${gain(pat, 'rest', 20).toFixed(2)} on the ground`);
expect(Math.abs(ratio('health', 50) - 2) < 0.01, 'Health heals twice as fast', `${gain(kim, 'health', 50).toFixed(2)} and ${gain(pat, 'health', 50).toFixed(2)}`);
expect(Math.abs(ratio('hunger', 80) - 0.5) < 0.01 && Math.abs(ratio('thirst', 80) - 0.5) < 0.01, 'Hunger and Thirst drop half as fast', `${gain(kim, 'hunger', 80).toFixed(2)} and ${gain(pat, 'hunger', 80).toFixed(2)}`);
expect(w.bedBetter(kim) === 2 && w.bedBetter(pat) === 1, 'the bed counts only for who is in it');
Object.assign(pat, { sleeping: false });

console.log('D. while someone is asleep in it');
await fresh(); got = await ask(kimS, { t: 'unplace', id: hut.id });
expect(said(got) === "Someone's asleep in it" && shelters().length === 1, "it can't be packed up", said(got));
await fresh(); got = await ask(kimS, { t: 'apart', id: hut.id });
expect(said(got) === "Someone's asleep in it" && shelters().length === 1, "or taken apart", said(got));
await ask(admin, { t: 'a.move', what: 'placed', id: hut.id, x: 26, z: 24 });
expect(hut.x === 24 && hut.z === 24, "the admin's Move waits until it's empty", `${hut.x}, ${hut.z}`);
// one at a time, and anyone's once the camp ends (the fire goes out)
w.placedById(1).lit = false; w.burn(w.placedById(1));
Object.assign(pat, { x: fx, z: fz });
await fresh(); got = await ask(patS, { t: 'sleep', on: true, bed: hut.id });
expect(said(got) === "Someone's asleep in it" && !pat.sleeping, 'the camp ended: anyone may, but one at a time', said(got));

console.log('E. getting up');
await fresh(); got = await ask(kimS, { t: 'sleep', on: false });
expect(!kim.sleeping && !kim.bed && Math.hypot(kim.x - fx, kim.z - fz) < 0.01, 'up and out, at its front');
await fresh(); got = await ask(patS, { t: 'sleep', on: true, bed: hut.id });
expect(pat.sleeping && pat.bed === hut.id, 'then the next person can', said(got));
await fresh(); await ask(patS, { t: 'sleep', on: false });
expect(!pat.bed, 'and get up');

console.log('F. away: tired, they walk over and sleep in their camp\'s shelter');
// a camp again for Kim (lit), and Kim goes away tired a few metres off
Object.assign(w.placedById(1), { lit: true, fuel: 100 * HOUR, at: Date.now(), claim: kim.who });
Object.assign(kim, { x: 20, z: 24, stats: { health: 100, rest: 20, hunger: 90, thirst: 90, energy: 100 }, statsAt: Date.now() });
await leave(kimS);
const ta = Date.now();
Object.assign(kim, { leftAt: ta, simAt: ta, statsAt: ta, plan: null });
for (let m = 1; m <= 4; m++) w.advanceAway(kim, ta + m * MINUTE);
expect(kim.sleeping && kim.bed === hut.id && Math.hypot(kim.x - fx, kim.z - fz) < 0.05, 'asleep in it, having walked to its front', `bed ${kim.bed}, at ${kim.x.toFixed(2)}, ${kim.z.toFixed(2)}`);
const restBefore = kim.stats.rest;
w.advanceAway(kim, ta + 64 * MINUTE);
expect(kim.stats.rest - restBefore > DATA.stats.find((s) => s.id === 'rest').whileAsleep * 1.5 * 0.9, 'and Rest fills at the shelter rate', `${restBefore.toFixed(1)} to ${kim.stats.rest.toFixed(1)}`);
w.advanceAway(kim, ta + 10 * HOUR);
expect(!kim.bed || kim.sleeping, 'rested: up and out again (or still asleep at night)', `sleeping ${kim.sleeping}, bed ${kim.bed}`);

console.log('G. away: the long sleep after a day away is in their camp\'s shelter');
Object.assign(kim, { sleeping: false, bed: null, plan: null, x: 18, z: 22, stats: { health: 100, rest: 95, hunger: 95, thirst: 95, energy: 100 } });
const tb = Date.now();
Object.assign(kim, { leftAt: tb - 24 * HOUR + MINUTE, simAt: tb, statsAt: tb });
w.advanceAway(kim, tb + 5 * MINUTE);
expect(kim.asleep && kim.bed === hut.id && Math.hypot(kim.x - fx, kim.z - fz) < 0.05, 'they walk over and lie down in it for the long sleep', `asleep ${kim.asleep}, bed ${kim.bed}`);
expect(w.pub(kim).state === 'asleep' && w.pub(kim).bed === hut.id, 'everyone sees them asleep in it');
const hungerBefore = kim.stats.hunger;
kim.statsAt = Date.now() - 10 * HOUR;
w.catchUp(kim, Date.now());
const ground = -DATA.stats.find((s) => s.id === 'hunger').whileAsleep * 10;
expect(hungerBefore - kim.stats.hunger < ground * 0.6, 'hunger drops half as fast asleep in it', `${(hungerBefore - kim.stats.hunger).toFixed(2)} in 10 h (${ground} on the ground)`);

console.log('H. coming back gets you out');
const back = await join('kim', null, null);
expect(!kim.asleep && !kim.sleeping && !kim.bed, 'back: awake and out of it', `asleep ${kim.asleep}, bed ${kim.bed}`);

console.log('I. a Sleep in shelter task carries on while away');
await ask(back.s, { t: 'tasks', list: [{ type: 'bed', id: hut.id }, { type: 'walk', x: 3, z: 3 }] });
expect((kim.tasks || []).length === 2 && kim.tasks[0].type === 'bed' && kim.tasks[0].id === hut.id, 'the list keeps it', JSON.stringify(kim.tasks));
Object.assign(kim, { x: 20, z: 22, stats: { health: 100, rest: 90, hunger: 90, thirst: 90, energy: 100 }, statsAt: Date.now() });
await leave(back.s);
const tc = Date.now();
Object.assign(kim, { leftAt: tc, simAt: tc, statsAt: tc, plan: null });
for (let m = 1; m <= 3; m++) w.advanceAway(kim, tc + m * MINUTE);
expect(kim.sleeping && kim.bed === hut.id && !(kim.tasks || []).length, 'they go and lie down in it, and that ends the list (as in the game)', `bed ${kim.bed}, tasks ${JSON.stringify(kim.tasks)}`);

console.log("J. the admin's Remove gets the sleeper out");
await ask(admin, { t: 'a.remove', id: hut.id });
expect(!shelters().length && !kim.bed && kim.sleeping, 'gone, and they sleep on at its front', `bed ${kim.bed}`);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} of ${results.length} FAILED` : `\nall ${results.length} ok`);
process.exit(bad ? 1 : 0);
