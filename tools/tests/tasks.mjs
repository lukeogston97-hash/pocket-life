// Your task list while you're away (0.1.7, server/src/tasks.js), tested straight against the server's World with no
// browser: the list a game sends is tidied, then while the player is away their person carries on with it (every kind of
// task), with the same rules as playing (someone else's camp, tools, things that have gone), stopping to drink, working
// through the night, and what's left going back to their game when they come back. Also the admin's Clear task list.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node tasks.mjs   (exit 0: all ok)
// The proof is what happened in the world (a tree is a stump, a stick is where it was put), not the runner's own say-so.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const MINUTE = 60000, HOUR = 3600000;
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
const LAYOUT = () => ({ trees: [[10, 10], [12, 14]], rocks: [[15, 5], [16, 9]], bushes: [[8, -8]], oldStumps: [], plants: { tallGrass: [[5, -5], [6, -6]] },
  shore: [[-0.4, -0.9], [-5.6, 4.4]], open: [[3, 3], [4, 4], [20, 20], [-20, 20]], v: DATA.version, b: DATA.build, e: DATA.era });
const fire = (id, x, z, more = {}) => ({ id, kind: 'campfire', x, z, rot: 0, built: true, fuel: 0, lit: false, at: Date.now(), ...more });
async function start() {
  const socks = [];
  const ctx = { storage: storageOn(new Map()), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await wait(30);
  w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 4 * HOUR, placed: [], pond: { fish: 10, at: Date.now() }, layout: LAYOUT() };
  const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
  const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); await wait(5); return s.got.slice(from); };
  // a game joining the way the real one does (hello, then make a person), so leaving and coming back are the real thing
  const join = async (pid, name, at) => {
    const s = sock({ from: `addr-${pid}` });
    await ask(s, { t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid });
    if (name) await ask(s, { t: 'create', name, age: 30, look: {} });
    const p = w.persons.get(s.att.who);
    if (p && at) Object.assign(p, { x: at[0], z: at[1], stats: { health: 100, rest: 90, hunger: 90, thirst: 90, energy: 100 }, statsAt: Date.now() });
    return { s, p };
  };
  const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
  return { w, sock, ask, join, admin };
}
const leave = async (S, s) => { await S.w.webSocketMessage(s, JSON.stringify({ t: 'bye' })); await wait(5); };
const item = (S, id) => S.w.world.items.find((it) => it.id === id);

let S = await start();
console.log('A. the list a game sends is tidied');
let { s: kimS, p: kim } = await S.join('kim', 'Kim', [3, 3]);
await S.ask(kimS, { t: 'tasks', list: [
  { type: 'pickup', id: 10, extra: 'x'.repeat(500) }, { type: 'teleport', x: 1 }, { type: 'chop', what: 'tree', idx: 0, x: 10, z: 10 }, { type: 'walk', x: 9999, z: 3 },
  { type: 'drop', kind: 'stick' }, { type: 'drop', kind: 'gold', n: 1 }, { type: 'use', source: 'berryBush', bush: 0, x: 8, z: -8, top: 1.2, stop: 1 }, 'nonsense', null,
  ...Array.from({ length: 40 }, (_, i) => ({ type: 'walk', x: i, z: 0 }))] });
const types = (kim.tasks || []).map((t) => t.type);
expect(kim.tasks.length <= 30 && types[0] === 'pickup' && !('extra' in kim.tasks[0]) && types[1] === 'chop' && types[2] === 'use',
  'only real kinds of task, with only their own fields, at most 30', types.slice(0, 4).join(','));
expect(!types.includes('teleport') && !kim.tasks.some((t) => t.type === 'drop') && !kim.tasks.some((t) => t.type === 'walk' && t.x == null),
  'a task missing what it needs (a drop with no count, a walk off the map, an item that isn\'t one) is dropped');

console.log('B. away, every kind of task gets done, the same as playing');
S = await start();
({ s: kimS, p: kim } = await S.join('kim', 'Kim', [3, 3]));
const w = S.w.world;
w.items.push({ id: 10, kind: 'stick', x: 4, z: 3, rot: 0 }, { id: 11, kind: 'log', x: 18, z: 18, rot: 0 });
w.placed.push(fire(3, -20, 20, { fuel: 5 * HOUR })); // (enough to burn for the whole test, once lit)
Object.assign(kim.carry, { 'stone-axe': 1, 'stone-pickaxe': 1, knife: 1, 'fishing-spear': 1, campfire: 1, stick: 4, fish: 1 }); // 28 of the 60 they can carry
kim.bar = { 'stone-axe': 1, 'stone-pickaxe': 1, knife: 1, 'fishing-spear': 1 }; // the tools on the tool bar (0.1.17): only tools there get used
const list = [
  { type: 'pickup', id: 10 },
  { type: 'chop', what: 'tree', idx: 0, x: 10, z: 10 },
  { type: 'drop', kind: 'stick', n: 1, x: 6, z: 7 },
  { type: 'cut', plant: 'tallGrass', i: 0, x: 5, z: -5 },
  { type: 'use', source: 'berryBush', bush: 0, x: 8, z: -8, top: 1.2, stop: 1 },
  { type: 'mine', idx: 0, what: 'rock', x: 15, z: 5 },
  { type: 'chop', what: 'log', id: 11, x: 18, z: 18 }, // (from a list saved before 0.2.6: logs are cut on the craft mat now, so it's skipped)
  { type: 'walk', x: 20, z: 20 },
  { type: 'place', item: 'campfire', kind: 'campfire', x: 22.5, z: 22.5, rot: 0 }, // (the middle of a 1 m square on the placing grid)
  { type: 'fish' },
  { type: 'tend', id: 3, do: 'add', n: 2, fuel: 'stick' },
  { type: 'tend', id: 3, do: 'light' },
  { type: 'make', id: 3, recipe: 'cooked-fish' },
  { type: 'sit', id: 3 },
];
await S.ask(kimS, { t: 'tasks', list });
expect(kim.tasks.length === list.length, 'the server has the whole list', kim.tasks.length);
await leave(S, kimS);
expect(kim.leftAt > 0 && kim.tasks.length === list.length, 'Kim\'s player left: Kim is away with the list');
const spear = ((kim.wear || {})['fishing-spear'] || [DATA.items['fishing-spear'].tool.uses])[0]; // (a new spear has no wear list yet)
const t0 = Date.now();
for (let m = 1; m <= 12; m++) { S.w.advanceAway(kim, t0 + m * MINUTE); await wait(2); } // twelve minutes away, a tick a minute
const near = (x, z, kind) => w.items.some((it) => it.kind === kind && Math.hypot(it.x - x, it.z - z) < 0.3);
expect(!item(S, 10), 'picked up the stick lying by them');
expect(w.trees && w.trees[0] && w.trees[0][0] === 'stump' && w.items.some((it) => it.kind === 'log' && Math.hypot(it.x - 10, it.z - 10) < 2), 'chopped tree 0: a stump, with a log by it');
expect(near(6, 7, 'stick'), 'put a stick down where the list said');
expect(w.plants && w.plants.tallGrass && w.plants.tallGrass[0] > Date.now() && kim.carry.twine >= 1, 'cut the tall grass: it grows back later, twine in the bag');
expect((kim.carry.berry || 0) >= 1, 'picked berries off the bush', kim.carry.berry);
expect(w.rocks && w.rocks[0] && w.rocks[0][0] === 'gone' && w.items.filter((it) => it.kind === 'stone').length >= 5, 'broke rock 0 into stones');
expect(item(S, 11) && !w.items.some((it) => it.kind === 'stick' && Math.hypot(it.x - 18, it.z - 18) < 2), "an old Chop into sticks task is skipped: the log stays (0.2.6, Luke: sticks are cut from a log on the craft mat)");
const mine = w.placed.find((th) => th.by === kim.who);
expect(mine && mine.built && Math.hypot(mine.x - 22.5, mine.z - 22.5) < 0.05 && !kim.carry.campfire, 'placed the campfire where the list said, then built it (as the game does)');
expect(kim.wear && kim.wear['fishing-spear'] && kim.wear['fishing-spear'][0] < spear, 'went fishing (the spear wore)', `${spear} then ${kim.wear && kim.wear['fishing-spear']}`);
const f3 = w.placed.find((th) => th.id === 3);
expect(f3.lit && f3.fuel > 5 * HOUR, 'put sticks on fire 3 and lit it', `${Math.round(f3.fuel / MINUTE)} min of fuel`);
expect((kim.carry['cooked-fish'] || 0) === 1 && (kim.carry.fish || 0) <= 1, 'cooked the fish on it', `${kim.carry['cooked-fish']} cooked, ${kim.carry.fish || 0} raw (a catch may have added one)`);
expect(kim.sit && kim.sit.fire === 3 && kim.plan && kim.plan.kind === 'sit', 'and sat down by it (sitting until the fire goes out, as in the game)');
expect(kim.tasks.length === 0 && kim.log.tasks === list.length, 'the whole list done (but the old log task), the build it added too', `${kim.log.tasks} done, ${kim.tasks.length} left`);

console.log('C. the same rules as playing: someone else\'s camp, things that have gone');
S = await start();
const { s: patS } = await S.join('pat', 'Pat', [30, 30]);
S.w.world.placed.push(fire(5, 30, 30, { fuel: 5 * HOUR }));
await S.ask(patS, { t: 'fire', id: 5, do: 'light' }); // Pat's camp
S.w.world.items.push({ id: 20, kind: 'stick', x: 31, z: 31, rot: 0 });
({ s: kimS, p: kim } = await S.join('kim', 'Kim', [24, 30]));
kim.carry['stone-axe'] = 1;
kim.bar = { 'stone-axe': 1 }; // (on the tool bar, 0.1.17)
S.w.world.trees = { 1: ['stump', Date.now()] }; // tree 1 was chopped by someone else
await S.ask(kimS, { t: 'tasks', list: [{ type: 'pickup', id: 20 }, { type: 'chop', what: 'tree', idx: 1, x: 12, z: 14 }, { type: 'walk', x: 20, z: 20 }] });
await leave(S, kimS);
for (let m = 1; m <= 3; m++) S.w.advanceAway(kim, Date.now() + m * MINUTE);
expect(item(S, 20) && !kim.carry.stick, 'the stick inside Pat\'s camp is left alone');
expect(kim.tasks.length === 0 && kim.log.tasks === 1 && S.w.world.trees[1][0] === 'stump' && !S.w.world.items.some((it) => it.kind === 'log'), 'the tree that had gone is skipped, and only the walk counts as done', kim.log.tasks);

console.log('D. thirsty: a drink first, then back to the list; at night the list still gets done');
S = await start();
({ s: kimS, p: kim } = await S.join('kim', 'Kim', [3, 3]));
kim.stats.thirst = 40;
await S.ask(kimS, { t: 'tasks', list: [{ type: 'walk', x: -20, z: 20 }] });
await leave(S, kimS);
for (let m = 1; m <= 3; m++) S.w.advanceAway(kim, Date.now() + m * MINUTE);
expect(kim.log.drank > 0 && kim.stats.thirst > 55 && kim.log.tasks === 1, 'drank at the pond, then did the walk', `drank ${kim.log.drank}, thirst ${Math.round(kim.stats.thirst)}, done ${kim.log.tasks}`);
// the last 11 pm in Darwin (UTC+9:30): night
const darwinNight = () => { const d = new Date(Date.now() - 24 * HOUR); d.setUTCHours(13, 30, 0, 0); return d.getTime(); };
S = await start();
({ s: kimS, p: kim } = await S.join('kim', 'Kim', [3, 3]));
await S.ask(kimS, { t: 'tasks', list: [{ type: 'walk', x: 20, z: 20 }, { type: 'walk', x: -20, z: 20 }] });
await leave(S, kimS);
let night = darwinNight();
Object.assign(kim, { leftAt: night, simAt: night, statsAt: night, plan: { kind: 'idle', start: night, arrive: night + 1000 } }); // (just after the short break)
S.w.advanceAway(kim, night + 15000);
expect(kim.log.tasks === 1 && !kim.sleeping && kim.plan.kind === 'walk', 'at 11 pm with things on the list: they keep going', `done ${kim.log.tasks}, sleeping ${kim.sleeping}`);
S.w.advanceAway(kim, night + 2 * MINUTE);
expect(kim.log.tasks === 2 && kim.sleeping, 'then, with the list done, off to sleep as it\'s night', `done ${kim.log.tasks}, sleeping ${kim.sleeping}`);

console.log('E. coming back: what\'s left goes back to the game');
S = await start();
({ s: kimS, p: kim } = await S.join('kim', 'Kim', [3, 3]));
S.w.world.items.push({ id: 30, kind: 'stick', x: 4, z: 3, rot: 0 });
await S.ask(kimS, { t: 'tasks', list: [{ type: 'walk', x: -20, z: 20 }, { type: 'pickup', id: 30 }] });
await leave(S, kimS);
Object.assign(kim, { plan: null }); // (not waiting out the short break)
S.w.advanceAway(kim, Date.now() + 3000); // part way along the walk
const back = S.sock({ from: 'addr-kim' });
const got = await S.ask(back, { t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid: 'kim' });
const wel = got.find((m) => m.t === 'welcome');
expect(wel && Array.isArray(wel.tasks) && wel.tasks.length === 2 && wel.tasks[0].type === 'walk' && wel.tasks[1].id === 30, 'the walk they were on and the pick-up after it come back', JSON.stringify(wel && wel.tasks));
kim = S.w.persons.get(kim.who);
kim.tasks = [{ type: 'drop', kind: 'stick', n: 1, x: 2, z: 2, from: 31 }, { type: 'drop', kind: 'stick', n: 1, x: 2, z: 2, from: 32 }, { type: 'pickup', id: 33 }, { type: 'drop', kind: 'stick', n: 1, x: 2, z: 2, from: 33 }];
kim.took = [31];
const left = S.w.tasksBack(kim);
expect(left.length === 3 && left[0].from === undefined && left[1].type === 'pickup' && left[2].from === 33, 'moving a loose item: kept if its pick-up happened (or is still to come), dropped if it never will', JSON.stringify(left));
const doneAway = got.find((m) => m.t === 'welcome').away;
expect(doneAway && doneAway.ms >= 0, 'and Welcome back gets how long they were away');

console.log('F. the admin can see and clear a task list');
S = await start();
({ s: kimS, p: kim } = await S.join('kim', 'Kim', [3, 3]));
await S.ask(kimS, { t: 'tasks', list: [{ type: 'walk', x: 20, z: 20 }, { type: 'walk', x: -20, z: 20 }] });
let page = (await S.ask(S.admin, { t: 'a.player', id: kim.who })).find((m) => m.t === 'adminPlayer');
expect(page && page.tasks && page.tasks.length === 2, 'Kim\'s page shows the list', page && JSON.stringify(page.tasks));
const ans = await S.ask(S.admin, { t: 'a.clearTasks', id: kim.who });
expect(kim.tasks.length === 0 && kimS.got.some((m) => m.t === 'stopTasks') && ans.some((m) => m.t === 'admin' && /empty/.test(m.text)), 'Clear task list empties it, and Kim\'s game stops too');

console.log('G. left sitting by a lit fire: they get up for bed and a drink, so Rest never runs out (0.2.1)');
// Luke, 27 Nov 2026: left sitting by the fire overnight, his person sat on all night and came back collapsed, Rest 0
const sitBy = async (at, stats) => {
  S = await start();
  ({ s: kimS, p: kim } = await S.join('kim', 'Kim', [4, 3]));
  S.w.world.placed.push(fire(5, 4, 4, { fuel: 6 * 24 * HOUR, lit: true, at, by: kim.who }));
  kim.stats = { health: 100, energy: 100, ...stats };
  await S.ask(kimS, { t: 'sit', id: 5, seat: 0 });
  await leave(S, kimS);
  Object.assign(kim, { leftAt: at, simAt: at, statsAt: at, plan: { kind: 'idle', start: at, arrive: at + 15000 } });
  kim.sit.until = at + 365 * 24 * HOUR;
};
night = darwinNight() - 2 * HOUR; // 9 pm
await sitBy(night, { rest: 55, hunger: 80, thirst: 80 });
S.w.advanceAway(kim, night + 2 * MINUTE);
expect(!kim.sit && kim.sleeping, 'left sitting at 9 pm: they lie down for the night', `sitting ${!!kim.sit}, sleeping ${kim.sleeping}`);
S.w.advanceAway(kim, night + 9 * HOUR);
expect(kim.stats.rest > 90 && !kim.collapsed, 'and at 6 am Rest is full', `rest ${Math.round(kim.stats.rest)}`);
const day = darwinNight() - 13 * HOUR; // 10 am
await sitBy(day, { rest: 70, hunger: 90, thirst: 80 });
S.w.advanceAway(kim, day + HOUR);
expect(kim.sit && kim.plan.kind === 'sit', 'left sitting at 10 am: still sat by the fire an hour later');
S.w.advanceAway(kim, day + 5 * HOUR);
expect(!kim.sit && kim.log.drank > 0, 'thirsty: up for a drink', `sitting ${!!kim.sit}, drank ${kim.log.drank}`);
for (let h = 6; h <= 20; h++) S.w.advanceAway(kim, day + h * HOUR);
expect(kim.stats.rest > 25 && kim.log.slept, 'and later off to sleep, Rest never ran out', `rest ${Math.round(kim.stats.rest)}`);

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} of ${results.length} FAILED` : `\nall ${results.length} ok`);
process.exit(bad ? 1 : 0);
