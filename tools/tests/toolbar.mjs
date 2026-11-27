// The tool bar (0.1.17, Luke), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node toolbar.mjs   (exit 0: all as it should be)
// What it checks: someone from before the tool bar gets their tools put on it; new tools go on the bar while there's room
// and weigh nothing there; only tools on the bar get used and wear; a broken one is replaced by a spare; equip, unequip
// and swap (with the weight and full-bar checks); dropping a tool from the bar; making a tool when the inventory is full;
// the live setting for how many spots there are. Also the inventory's 10 squares and stacks (0.2.1).
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
const s = sock({ from: 'addr-kim' });
await ask(s, { t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid: 'kim' });
await ask(s, { t: 'create', name: 'Kim', age: 30, look: {} });
const p = w.persons.get(s.att.who);
const lastMe = (got) => [...got].reverse().find((m) => m.t === 'me');
const said = (got) => (got.find((m) => m.t === 'placeNo') || {}).why || '';
const W = (k) => DATA.items[k].weight;
const meNow = () => structuredClone(w.mine(p)); // (what the game is sent about them; sync has a spam limit of its own)

console.log('A. someone from before the tool bar');
Object.assign(p, { carry: { knife: 1, 'stone-axe': 2, stick: 3 }, wear: { 'stone-axe': [5, 30] } });
delete p.bar;
let me = meNow();
expect(me && me.bar && me.bar.knife === 1 && me.bar['stone-axe'] === 2, 'their tools go on the bar by themselves', JSON.stringify(me && me.bar));
expect(me.carry.knife === 1 && me.carry['stone-axe'] === 2, 'and still count as carried (an older game still sees them)');

console.log('B. new tools go on the bar while there is room, and weigh nothing there');
Object.assign(p, { carry: { stick: 3 }, wear: {}, bar: {} });
for (let i = 0; i < 8; i++) w.world.items.push({ id: 500 + i, kind: 'stone-axe', x: p.x, z: p.z, rot: 0, ...(i === 7 ? { uses: 4 } : {}) });
for (let i = 0; i < 8; i++) await ask(s, { t: 'take', id: 500 + i });
me = meNow();
expect(me.carry['stone-axe'] === 8 && me.bar['stone-axe'] === 7, '7 on the bar, the 8th in the inventory', `${me.bar['stone-axe']} of ${me.carry['stone-axe']}`);
expect(me.wear['stone-axe'][7] === 4, 'the worn one picked up last is the one in the inventory, still worn', JSON.stringify(me.wear['stone-axe']));

console.log('C. only tools on the bar get used');
Object.assign(p, { carry: { 'stone-pickaxe': 1 }, wear: { 'stone-pickaxe': [10] }, bar: {} });
w.wearTool(p, 'stone-pickaxe', () => {});
expect(p.wear['stone-pickaxe'][0] === 10, 'a pickaxe in the inventory doesn\'t wear (it isn\'t used)');
p.bar = { 'stone-pickaxe': 1 };
w.wearTool(p, 'stone-pickaxe', () => {});
expect(p.wear['stone-pickaxe'][0] === 9, 'on the bar it wears');

console.log('D. a broken tool: the next one on the bar, else a spare from the inventory');
const broke = [];
Object.assign(p, { carry: { knife: 2 }, wear: { knife: [1, 7] }, bar: { knife: 1 } });
w.wearTool(p, 'knife', (m) => broke.push(m));
expect(broke.some((m) => m.t === 'broke') && p.carry.knife === 1 && p.bar.knife === 1 && p.wear.knife[0] === 7, 'the spare moved up onto the bar', JSON.stringify({ bar: p.bar, wear: p.wear }));
Object.assign(p, { carry: { knife: 3 }, wear: { knife: [1, 6, 9] }, bar: { knife: 2 } });
w.wearTool(p, 'knife', () => {});
expect(p.carry.knife === 2 && p.bar.knife === 1 && p.wear.knife.join() === '6,9', 'with two on the bar, the second takes over and the spare stays put', JSON.stringify({ bar: p.bar, wear: p.wear }));

console.log('E. equip, unequip and swap');
Object.assign(p, { carry: { knife: 1, 'stone-axe': 1 }, wear: {}, bar: { knife: 1 } });
me = lastMe(await ask(s, { t: 'equip', kind: 'stone-axe' }));
expect(me.bar['stone-axe'] === 1, 'equip puts it on the bar');
me = lastMe(await ask(s, { t: 'unequip', kind: 'stone-axe' }));
expect(!me.bar['stone-axe'] && me.carry['stone-axe'] === 1, 'unequip takes it off, into the inventory');
Object.assign(p, { carry: { 'stone-axe': 1, stone: (DATA.settings.carryCapacity - W('stone-axe')) / W('stone') }, wear: {}, bar: { 'stone-axe': 1 } }); // (full once the axe is back in)
let got = await ask(s, { t: 'unequip', kind: 'stone-axe' });
expect(!lastMe(got).bar['stone-axe'] && said(got) === '', 'an axe fits back in an inventory with room for it');
Object.assign(p, { carry: { 'stone-axe': 1, stone: DATA.settings.carryCapacity / W('stone') }, wear: {}, bar: { 'stone-axe': 1 } }); // (already full)
got = await ask(s, { t: 'unequip', kind: 'stone-axe' });
expect(said(got) === 'Too heavy to carry' && lastMe(got).bar['stone-axe'] === 1, 'a full inventory: it stays on the bar', said(got));
Object.assign(p, { carry: { knife: 1, 'stone-axe': 6, 'fishing-spear': 1 }, wear: { 'stone-axe': [30, 30, 30, 30, 30, 30], 'fishing-spear': [3] }, bar: { knife: 1, 'stone-axe': 6 } });
got = await ask(s, { t: 'equip', kind: 'fishing-spear' });
expect(said(got) === 'Your tool bar is full' && !lastMe(got).bar['fishing-spear'], 'a full bar says so', said(got));
got = await ask(s, { t: 'equip', kind: 'fishing-spear', out: { kind: 'knife', which: 0 } });
me = lastMe(got);
expect(me.bar['fishing-spear'] === 1 && !me.bar.knife && me.carry.knife === 1 && me.wear['fishing-spear'][0] === 3, 'dropped onto the knife: they swap, the spear keeps its wear', JSON.stringify(me.bar));
Object.assign(p, { carry: { 'stone-axe': 2, knife: 6 }, wear: { 'stone-axe': [2, 25] }, bar: { 'stone-axe': 1, knife: 6 } });
me = lastMe(await ask(s, { t: 'equip', kind: 'stone-axe', which: 1, out: { kind: 'stone-axe', which: 0 } }));
expect(me.bar['stone-axe'] === 1 && me.wear['stone-axe'].join() === '25,2', 'swapping an axe for the other axe: the fresh one goes on the bar', JSON.stringify(me.wear['stone-axe']));

console.log('F. dropping a tool from the bar, and spares first');
Object.assign(p, { carry: { knife: 3 }, wear: { knife: [4, 8, 12] }, bar: { knife: 2 } });
await ask(s, { t: 'drop', items: [{ kind: 'knife', x: p.x, z: p.z, which: 0 }] });
expect(p.carry.knife === 2 && p.bar.knife === 1 && p.wear.knife.join() === '8,12', 'the one in use was dropped: one left on the bar, the spare stays in the inventory', JSON.stringify({ bar: p.bar, wear: p.wear }));
await ask(s, { t: 'drop', items: [{ kind: 'knife', x: p.x, z: p.z }] });
expect(p.carry.knife === 1 && p.bar.knife === 1 && p.wear.knife.join() === '8', 'no which: the one in the inventory goes first', JSON.stringify({ bar: p.bar, wear: p.wear }));

console.log('G. making a tool with a full inventory');
const knifeRecipe = Object.values(DATA.recipes).find((r) => r.makes && r.makes.knife);
Object.assign(p, { carry: { ...knifeRecipe.needs, ...(knifeRecipe.keeps || {}) }, wear: {}, bar: {} });
const fill = 30 - Object.entries(p.carry).reduce((a, [k, n]) => a + W(k) * n, 0);
p.carry.stone = (p.carry.stone || 0) + fill;
me = lastMe(await ask(s, { t: 'craft', id: knifeRecipe.id }));
expect(me.carry.knife === 1 && me.bar.knife === 1, 'it goes on the bar, so it fits', JSON.stringify(me.bar));

console.log('H. how many spots is a live setting');
Object.assign(p, { carry: { knife: 1, 'stone-axe': 1, 'stone-pickaxe': 1 }, wear: {}, bar: { knife: 1, 'stone-axe': 1, 'stone-pickaxe': 1 } });
await w.setLive('toolSlots', 2);
me = meNow();
expect(Object.values(me.bar).reduce((a, n) => a + n, 0) === 2 && me.bar.knife && me.bar['stone-axe'] && !me.bar['stone-pickaxe'], '2 spots: the last tool goes back to the inventory', JSON.stringify(me.bar));
await w.setLive('toolSlots', null);
expect((w.liveView().find((x) => x.id === 'toolSlots') || {}).value === 7, 'Reset: 7 again');

console.log('I. what the game is told about them still says asleep (0.1.17 hid it behind a comment: Sleep got you straight back up)');
me = lastMe(await ask(s, { t: 'sleep', on: true }));
expect(me && me.sleeping === true && me.collapsed === false && me.bar, 'Sleep: the answer says asleep, with the tool bar too', JSON.stringify(me && { sleeping: me.sleeping, collapsed: me.collapsed }));
me = lastMe(await ask(s, { t: 'sleep', on: false }));
expect(me && me.sleeping === false, 'and awake again', JSON.stringify(me && { sleeping: me.sleeping }));

console.log('J. the inventory has 10 squares, up to 10 of a thing in each, tools and things you place 1 (0.2.1, Luke)');
let nextItem = 500;
const lay = (kind) => { const id = nextItem++; w.world.items.push({ id, kind, x: p.x, z: p.z, rot: 0 }); return id; };
const take = async (kind) => { await wait(250); const got = await ask(s, { t: 'take', id: lay(kind) }); return got.find((m) => m.t === 'took') || {}; }; // (spaced out: picking up has a spam limit, 5 a second)
const squares = () => { const me = meNow(), bar = me.bar || {}; return Object.entries(me.carry).reduce((a, [k, n]) => a + Math.ceil(Math.max(0, n - (bar[k] || 0)) / (DATA.items[k].tool || DATA.items[k].places ? 1 : 10)), 0); };
const TEN = { stick: 1, stone: 1, twine: 1, 'sharp-stone': 1, 'short-handle': 1, berry: 1, fish: 1, 'cooked-fish': 1, 'axe-head': 1, 'pick-head': 1 };
Object.assign(p, { carry: { ...TEN }, wear: {}, bar: {}, x: 0, z: 0 });
expect(squares() === 10, '10 different things: all 10 squares used', squares());
let r = await take('hoe-head');
expect(r.ok === false && r.why === 'Your inventory is full' && !p.carry['hoe-head'], 'something new: Your inventory is full', JSON.stringify(r));
r = await take('stick');
expect(r.ok === true && p.carry.stick === 2, 'one more stick: it goes on the stack', JSON.stringify(r));
r = await take('knife');
expect(r.ok === true && p.bar.knife === 1, 'a tool goes on the tool bar, so it needs no square', JSON.stringify(p.bar));
const unGot = await ask(s, { t: 'unequip', kind: 'knife' });
expect(said(unGot) === 'Your inventory is full' && p.bar.knife === 1, "unequipping it: no square for it", said(unGot));
Object.assign(p, { carry: { stick: 9 }, wear: {}, bar: {} });
r = await take('stick'); r = await take('stick');
expect(p.carry.stick === 11 && squares() === 2, '11 sticks: a square of 10 and a square of 1', squares());
Object.assign(p, { carry: { ...TEN, campfire: 1 }, wear: {}, bar: {} });
expect(squares() === 11, 'over the squares already (from before 0.2.1)', squares());
r = await take('stone');
expect(r.ok === true && p.carry.stone === 2, 'can still top up a stack', JSON.stringify(r));
r = await take('hoe-head');
expect(r.ok === false && /full/.test(r.why), 'but nothing new', r.why);
const handle = Object.values(DATA.recipes).find((x) => x.makes && x.makes['medium-handle']); // (2 sticks and a twine: the long tool handle till 0.2.7)
Object.assign(p, { carry: { ...TEN, stick: 4, twine: 2 }, wear: {}, bar: {}, found: [] });
me = lastMe(await ask(s, { t: 'craft', id: handle.id }));
expect(!me.carry['medium-handle'] && me.carry.stick === 4, 'making something new with no square for it: not made', JSON.stringify(me.carry));
Object.assign(p, { carry: { ...TEN, stick: 2, twine: 1 }, wear: {}, bar: {} });
me = lastMe(await ask(s, { t: 'craft', id: handle.id }));
expect(me.carry['medium-handle'] === 1 && !me.carry.stick, 'its things used up free the square it needs: made', JSON.stringify(me.carry));
Object.assign(p, { carry: { ...TEN }, wear: {}, bar: {} });
await w.setLive('inventorySquares', 11);
r = await take('hoe-head');
expect(r.ok === true, 'Inventory squares is a live setting: 11 squares, it fits', JSON.stringify(r));
await w.setLive('inventorySquares', null);
await w.setLive('stackSize', 20);
Object.assign(p, { carry: { stick: 19 }, wear: {}, bar: {} });
r = await take('stick');
expect(Math.ceil(p.carry.stick / 20) === 1 && w.liveView().some((x) => x.id === 'stackSize' && x.value === 20), 'Stack size is a live setting: 20 sticks in one square', p.carry.stick);
await w.setLive('stackSize', null);
expect((w.liveView().find((x) => x.id === 'inventorySquares') || {}).value === 10 && (w.liveView().find((x) => x.id === 'stackSize') || {}).value === 10, 'Reset: 10 and 10 again');
Object.assign(p, { carry: { ...TEN, berry: 10 }, wear: {}, bar: {} });
expect(!w.canCarry(p, { berry: 1 }) && w.canCarry(p, { stick: 1 }), 'carrying on while away: a berry needs a new square, a stick has room');

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} ok`);
process.exit(failed ? 1 : 0);
