// Things only a changed (hacked) game would send, tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node cheats.mjs   (exit 0: every one is refused)
// The server knows where every tree, rock, bush and clump of grass is (the layout the game sends). Real things have to be
// near your person. This checks the other half: a number that isn't in the layout at all isn't a thing, so it can't be
// chopped, mined or picked from wherever you stand. And that ordinary play next to real things still works.
// Also names and chat: marks that hide text or make it read backwards are taken out, and a name nobody could see is refused.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
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
async function start(layout) {
  const store = new Map(), socks = [];
  const ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await wait(30);
  w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 4 * 3600000, placed: [], ...(layout ? { layout } : {}) };
  const p = { who: 'hax', state: 'alive', name: 'Hax', look: {}, age: 30, born: Date.now(), x: 30, z: 30, ry: 0, stats: { health: 100, rest: 80, hunger: 50, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: { 'stone-axe': 1, 'stone-pickaxe': 1, knife: 1 }, log: {} };
  w.persons.set('hax', p);
  const s = { att: { id: 'hax', who: 'hax', watch: false, admin: false, alive: true, from: 'a', v: DATA.version, b: DATA.build, e: DATA.era, link: 'test' }, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  socks.push(s);
  // (a fresh connection for each try, so the spam limits never get in the way of what's being tested)
  const ask = async (m) => { const c = { ...s, att: structuredClone(s.att), got: [] }; socks.push(c); await w.webSocketMessage(c, JSON.stringify(m)); await wait(5); socks.splice(socks.indexOf(c), 1); return c.got; };
  const ground = () => { const k = {}; for (const it of w.world.items) k[it.kind] = (k[it.kind] || 0) + 1; return k; };
  return { w, p, ask, ground, socks, carried: (k) => p.carry[k] || 0 };
}
const LAYOUT = () => ({ trees: [[10, 10], [12, 10]], rocks: [[5, 5]], bushes: [[3, 3]], oldStumps: [], plants: { tallGrass: [[20, 20]] }, shore: [], open: [], v: DATA.version, b: DATA.build, e: DATA.era });
const none = (o) => Object.keys(o).length === 0;

console.log('A. things that are not in the world can\'t be used (the layout has 2 trees, 1 rock, 1 bush, 1 clump of grass, no old stumps)');
let S = await start(LAYOUT());
await S.ask({ t: 'chop', what: 'tree', idx: 4000 });
expect(none(S.ground()) && !(S.w.world.trees || {})[4000], 'chopping tree number 4000 gives nothing and changes nothing', JSON.stringify(S.ground()));
await S.ask({ t: 'chop', what: 'stump', idx: 4000 });
expect(none(S.ground()), 'nor digging out its stump');
await S.ask({ t: 'chop', what: 'oldStump', idx: 300 });
expect(none(S.ground()) && !(S.w.world.oldStumps || {})[300], 'digging out old stump number 300 gives nothing (this world has none)', JSON.stringify(S.ground()));
await S.ask({ t: 'quarry', what: 'boulder', idx: 1500 });
await S.ask({ t: 'quarry', what: 'rock', idx: 1501 });
expect(none(S.ground()) && none(S.w.world.rocks || {}), 'mining rock numbers 1500 and 1501 gives nothing', JSON.stringify(S.ground()));
for (let k = 0; k < 3; k++) await S.ask({ t: 'pick', bush: 150 });
expect(S.carried('berry') === 0 && !S.w.world.bushes[150], 'picking from bush number 150 gives no berries', `${S.carried('berry')} berries`);
await S.ask({ t: 'cut', plant: 'tallGrass', i: 7 });
expect(S.carried('twine') === 0, 'cutting grass clump number 7 gives no twine', `${S.carried('twine')} twine`);
for (const bad of [-1, 2.5, 'x', null, 1e9]) { await S.ask({ t: 'chop', what: 'tree', idx: bad }); await S.ask({ t: 'pick', bush: bad }); await S.ask({ t: 'quarry', what: 'rock', idx: bad }); }
expect(none(S.ground()) && S.carried('berry') === 0, 'nor do numbers that make no sense (below 0, a fraction past the end, words, nothing, huge)', JSON.stringify(S.ground()));

console.log('B. real things still have to be near, as before');
await S.ask({ t: 'chop', what: 'tree', idx: 0 });
await S.ask({ t: 'pick', bush: 0 });
await S.ask({ t: 'quarry', what: 'rock', idx: 0 });
await S.ask({ t: 'cut', plant: 'tallGrass', i: 0 });
expect(none(S.ground()) && S.carried('berry') === 0 && S.carried('twine') === 0, 'from 28 m away or more, nothing real can be chopped, picked, mined or cut');

console.log('C. and next to them, ordinary play works');
S.p.x = 10.5; S.p.z = 11;
await S.ask({ t: 'chop', what: 'tree', idx: 0 });
expect(S.ground().log === 1 && S.ground().stick === 2 && S.w.world.trees[0][0] === 'stump', 'next to tree 0: chopping it gives a log and 2 sticks, and it is a stump', JSON.stringify(S.ground()));
await S.ask({ t: 'chop', what: 'stump', idx: 0 });
expect(S.ground().log === 2 && S.w.world.trees[0][0] === 'gone', 'and the stump can be dug out');
S.p.x = 3.5; S.p.z = 3.5;
await S.ask({ t: 'pick', bush: 0 });
expect(S.carried('berry') === 2, 'next to bush 0: picking gives berries (2 with a knife)', `${S.carried('berry')} berries`);
S.p.x = 5.5; S.p.z = 5.5;
await S.ask({ t: 'quarry', what: 'rock', idx: 0 });
expect(S.ground().stone === 5 && S.w.world.rocks[0][0] === 'gone', 'next to rock 0: mining gives 5 stones', JSON.stringify(S.ground()));
S.p.x = 20.5; S.p.z = 20.5;
await S.ask({ t: 'cut', plant: 'tallGrass', i: 0 });
expect(S.carried('twine') === 1, 'next to grass clump 0: cutting gives twine', `${S.carried('twine')} twine`);

console.log('D. a thing the admin moved is still a thing, where it was moved to');
S = await start(LAYOUT());
S.w.world.moved = { 'tree:1': [40, 40] };
S.p.x = 40.5; S.p.z = 40.5;
await S.ask({ t: 'chop', what: 'tree', idx: 1 });
expect(S.ground().log === 1, 'tree 1, moved to 40,40, can be chopped there', JSON.stringify(S.ground()));

console.log('E. a world with no layout yet (nobody has sent one): nothing can be checked, so it works as it always has');
S = await start(null);
await S.ask({ t: 'chop', what: 'tree', idx: 7 });
expect(S.ground().log === 1, 'chopping works before the layout is known', JSON.stringify(S.ground()));

console.log('F. names and chat: nothing unseen that hides text or turns it round');
S = await start(LAYOUT());
const newcomer = async (pid, name) => { // a new game says hello and makes a person, the way the game does
  const c = { att: { from: `addr-${pid}` }, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  S.socks.push(c);
  await S.w.webSocketMessage(c, JSON.stringify({ t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid }));
  await S.w.webSocketMessage(c, JSON.stringify({ t: 'create', name, age: 20, look: {} })); await wait(5);
  const made = S.w.persons.get(c.att.who);
  return { c, name: made && made.state === 'alive' ? made.name : null, refused: c.got.some((m) => m.t === 'badName') };
};
let n = await newcomer('n1', '\u202eevil\u202c Kim');
expect(n.name === 'evil Kim', 'the mark that makes text read backwards is taken out of a name', JSON.stringify(n.name));
for (const [what, name] of [['only unseen spaces', '\u200b\u200b\u2060'], ['only a blank letter', '\u3164'], ['only joiners', '\u200d\u200c'], ['only a braille blank', '\u2800\u2800'], ['only spaces', '   ']]) {
  n = await newcomer(`blank-${what}`, name);
  expect(n.name === null && n.refused, `a name of ${what} is refused`, JSON.stringify(n.name));
}
for (const name of ['Zoë', 'Łukasz', '李雷', 'Bo 🙂', "D'Arcy", 'Mary-Jane', 'علي']) {
  n = await newcomer(`ok-${name}`, name);
  expect(n.name === name, `an ordinary name is kept as typed: ${name}`, JSON.stringify(n.name));
}
const speaker = await newcomer('talker', 'Talker'), heard = await newcomer('listener', 'Listener');
const says = async (text) => { const from = heard.c.got.length; const c = { ...speaker.c, att: structuredClone(speaker.c.att), got: [] }; S.socks.push(c); await S.w.webSocketMessage(c, JSON.stringify({ t: 'say', text })); await wait(5); S.socks.splice(S.socks.indexOf(c), 1); return heard.c.got.slice(from).filter((m) => m.t === 'say').map((m) => m.text); };
expect(JSON.stringify(await says('hello \u202ethere')) === '["hello there"]', 'the same mark is taken out of chat', JSON.stringify(await says('hi \u202eyou')));
expect((await says('\u200b\u2060')).length === 0 && (await says('\u3164')).length === 0, 'a line with nothing to see in it is not sent to anyone');
expect(JSON.stringify(await says('ça va? 🙂 ok')) === '["ça va? 🙂 ok"]', 'ordinary chat with accents and an emoji is kept as typed');

console.log('G. names every object has (constructor, toString...) are not kinds of message, recipes, items or fuels');
S = await start(LAYOUT());
S.w.world.placed = [{ id: 1, kind: 'campfire', x: 31, z: 31, rot: 0, built: true, fuel: 3600000, lit: true, at: Date.now(), by: 'hax' }];
S.p.x = 30; S.p.z = 30;
Object.assign(S.p, { carry: { stick: 5, 'stone-axe': 2, berry: 1 }, wear: { 'stone-axe': [5] } });
const had = JSON.stringify(S.p.carry), fuelWas = S.w.world.placed[0].fuel;
let threw = 0;
const quietly = async (m) => { try { await S.ask(m); } catch (e) { threw++; console.log('       threw:', e.message, 'on', JSON.stringify(m)); } };
const hush = console.error; console.error = () => {}; // (an error the server notes is printed as well: the notes are counted below)
for (const k of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
  await quietly({ t: k }); await quietly({ t: k, id: k, kind: k });
  await quietly({ t: 'craft', id: k }); await quietly({ t: 'eat', kind: k }); await quietly({ t: 'drink', source: k });
  await quietly({ t: 'drop', items: [{ kind: k, x: 30, z: 30 }] }); await quietly({ t: 'place', kind: k, x: 30.5, z: 30.5 });
  await quietly({ t: 'chop', what: k, idx: 0, id: 1 }); await quietly({ t: 'quarry', what: k, idx: 0 });
  await quietly({ t: 'cut', plant: k, i: 0 }); await quietly({ t: 'take', id: k }); await quietly({ t: 'sit', id: k, seat: k }); await quietly({ t: 'report', id: k, reason: k });
}
console.error = hush;
await wait(20);
const errorNotes = ((await S.w.ctx.storage.get('feedback')) || []).filter((x) => x.auto);
expect(threw === 0, 'none of them makes the server throw', `${threw} threw`);
expect(errorNotes.length === 0, "none of them puts a Server error note in the admin's Inbox", errorNotes.map((x) => x.text.slice(0, 70)).join(' | '));
expect(JSON.stringify(S.p.carry) === had && S.w.world.items.length === 0, 'and the person carries what they did, with nothing new on the ground', JSON.stringify(S.p.carry));
// feeding a fire with a fuel called constructor: taken as the fire's usual fuel (sticks), as any unknown fuel is
await quietly({ t: 'fire', id: 1, do: 'add', fuel: 'constructor', n: 2 });
const fed = S.w.world.placed[0].fuel - fuelWas;
expect(threw === 0 && S.p.carry.stick === 3 && Math.abs(fed - 2 * 300000) < 30000, 'a fuel called constructor feeds the fire with 2 of its usual fuel, sticks, and nothing odd', `${S.p.carry.stick} sticks left, fuel up ${Math.round(fed / 60000)} min`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} as they should be${failed ? `, ${failed} NOT` : ''}`);
process.exit(failed ? 1 : 0);
