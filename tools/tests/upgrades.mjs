// Saved data upgrades and tidying (0.2.0, server/src/upgrades.js), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node upgrades.mjs   (exit 0: all as it should be)
import { World } from './build/server.mjs';
import { FORMAT } from '../../server/src/upgrades.js';

const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
let writes = 0;
function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { writes++; if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); },
    async getAlarm() { return 1; }, async setAlarm() {} };
}
async function start(store) {
  const socks = [], ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await new Promise((r) => setTimeout(r, 30));
  return w;
}
const now = Date.now();
const person = (who, more = {}) => ({ who, state: 'alive', name: who, look: {}, age: 30, born: now, x: 30, z: 30, ry: 0, stats: { health: 100, rest: 80, hunger: 50, thirst: 65, energy: 100 }, statsAt: now, carry: { stick: 2 }, log: {}, ...more });
const worldOf = () => ({ format: 1, nextId: 10, items: [{ id: 3, kind: 'stone', x: 1, z: 1, rot: 0 }], bushes: [], graves: [], spots: {}, caps: {}, placed: [] });

console.log('A. a world saved before 0.2.0 (no format number), on this server');
let store = new Map([['world', worldOf()], ['p:amy', person('amy')]]);
writes = 0;
let w = await start(store);
expect(FORMAT >= 2, `this server writes save format ${FORMAT}`);
expect(store.get('format') === FORMAT, `brought up to format ${FORMAT}`, `format ${store.get('format')}`);
expect(w.persons.get('amy').carry.stick === 2 && w.world.items.length === 1, "Amy's inventory and the stone on the ground are just as they were");

console.log('B. two steps to run, from format 1 to 3');
const steps = [
  { to: 3, what: 'carry becomes bag', run(x) { for (const p of x.persons.values()) { if (p.bag == null && p.carry) { p.bag = p.carry; delete p.carry; } } } },
  { to: 2, what: 'items get a made time', run(x) { for (const it of x.world.items) if (it.made == null) it.made = 1; } },
];
store.set('format', 1); // (as if A's world were still format 1: the real steps have run on it by now)
let out = await w.upgradeSaved(steps, 3);
expect(JSON.stringify(out.ran) === '[2,3]', 'both steps ran, oldest first', JSON.stringify(out));
expect(store.get('format') === 3, 'storage now says format 3');
expect(store.get('p:amy').bag && store.get('p:amy').bag.stick === 2 && !('carry' in store.get('p:amy')), "Amy was saved in the new format (her sticks kept)", JSON.stringify(store.get('p:amy').bag));
expect(store.get('world').items[0].made === 1, 'the world was saved in the new format');

console.log('C. starting again: nothing runs twice');
out = await w.upgradeSaved(steps, 3);
expect(out.ran.length === 0, 'no steps run', JSON.stringify(out));

console.log('D. saved data newer than the server (after a rollback)');
store.set('format', 9);
out = await w.upgradeSaved(steps, 3);
expect(out.newer === 9 && out.ran.length === 0 && store.get('format') === 9, 'left alone, and said in the Inbox', JSON.stringify(out));

console.log('E. a step that goes wrong');
store.set('format', 1);
const bad = [{ to: 2, what: 'fine', run(x) { x.world.marked = (x.world.marked || 0) + 1; } }, { to: 3, what: 'broken', run() { throw new Error('oops'); } }];
out = await w.upgradeSaved(bad, 3);
expect(out.failed === 3 && store.get('format') === 1, 'the format number stays where it was, so it tries again next start', JSON.stringify(out));

console.log('F. broken records');
store = new Map([['world', { format: 1, nextId: 4, spots: {}, caps: {} }], ['p:bob', 'not a person'], ['p:cat', person('cat', { carry: ['oops'] })], ['p:dan', person('dan')]]);
w = await start(store);
expect(!w.persons.has('bob') && store.get('bad:p:bob') === 'not a person' && !store.has('p:bob'), "a record that isn't a person is set aside (kept as bad:p:bob), not lost");
expect(w.persons.has('cat') && JSON.stringify(w.persons.get('cat').carry) === '{}', "Cat's unreadable inventory is made empty so the game can carry on");
expect(w.persons.get('dan').carry.stick === 2, 'Dan is untouched');
expect(Array.isArray(w.world.items) && Array.isArray(w.world.bushes) && Array.isArray(w.world.graves), 'a world missing its lists gets empty ones');
const fb = store.get('feedback') || [];
expect(JSON.stringify(fb).includes('reading saved data'), 'and the admin is told in the Inbox');

console.log('G. format 2 (0.2.2): farm fields move onto the 1 m placing grid');
const field = (id, x, z, more = {}) => ({ id, kind: 'field', x, z, rot: 0, built: true, at: now, ...more });
const oldWorld = { ...worldOf(), placed: [
  { id: 1, kind: 'campfire', x: 10, z: 10, rot: 0, built: true, fuel: 0, lit: false, at: now },
  field(2, 14.25, 10.25, { crop: { kind: 'berry-bush', at: now - 1000 } }), field(3, 15.75, 10.25), field(4, 17.25, 10.25), field(5, 14.25, 11.75),
  field(6, -3.25, -7.75), field(7, 20.25, 10.25), field(8, 20.75, 10.25), // (7 and 8 on top of each other: the game never allows it)
] };
store = new Map([['world', oldWorld]]);
w = await start(store);
const at = (id) => { const th = w.world.placed.find((t) => t.id === id); return [th.x, th.z]; };
expect(store.get('format') === 2, 'storage says format 2', store.get('format'));
expect(JSON.stringify([at(2), at(3), at(4), at(5)]) === JSON.stringify([[14.5, 10.5], [15.5, 10.5], [17.5, 10.5], [14.5, 11.5]]), 'each field is on the nearest 1 m square, still side by side', JSON.stringify([at(2), at(3), at(4), at(5)]));
expect(JSON.stringify(at(6)) === '[-3.5,-7.5]', 'below zero too', JSON.stringify(at(6)));
expect(w.world.placed.find((t) => t.id === 2).crop.kind === 'berry-bush', 'what grows on it comes with it');
expect(JSON.stringify(at(1)) === '[10,10]', 'the campfire stays where it was', JSON.stringify(at(1)));
expect(JSON.stringify(at(7)) === '[20.25,10.25]' && JSON.stringify(at(8)) === '[20.75,10.25]', 'fields that would land on another one stay where they were', JSON.stringify([at(7), at(8)]));
expect(store.get('world').placed.find((t) => t.id === 3).x === 15.5, 'and the world was saved like that');
const again = structuredClone(w.world.placed);
(await import('../../server/src/upgrades.js')).STEPS.find((x) => x.to === 2).run(w);
expect(JSON.stringify(w.world.placed) === JSON.stringify(again), 'running it again changes nothing');

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} of ${results.length} FAILED` : `all ${results.length} as they should be`);
process.exit(failed ? 1 : 0);
