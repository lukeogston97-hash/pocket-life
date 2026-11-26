// Things only a changed (hacked) game would send, tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node cheats.mjs   (exit 0: every one is refused)
// The server knows where every tree, rock, bush and clump of grass is (the layout the game sends). Real things have to be
// near your person. This checks the other half: a number that isn't in the layout at all isn't a thing, so it can't be
// chopped, mined or picked from wherever you stand. And that ordinary play next to real things still works.
// Also names and chat: marks that hide text or make it read backwards are taken out, and a name nobody could see is refused.
// And reports about players are limited per address, the way feedback is.
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
// names are one of a kind (Luke, 25 Nov 2026): not one a person in the world already has (playing, away or asleep), with
// capitals and extra spaces not counting. The names of the dead, people who left and banned players are free again.
const whoNamed = (name) => [...S.w.persons.values()].find((p) => p.name === name && S.w.alive(p)).who;
const twin = async (pid, name) => { const t = await newcomer(pid, name); if (!t.name) S.socks.splice(S.socks.indexOf(t.c), 1); return { ...t, taken: t.c.got.some((m) => m.t === 'badName' && m.taken) }; };
for (const [pid, name] of [['twin-a', 'zoË'], ['twin-b', '  Mary-Jane '], ['twin-c', 'evil  kim']]) {
  n = await twin(pid, name);
  expect(n.name === null && n.taken, `a name someone in the world has is refused, and the game is told why: "${name}"`, JSON.stringify(n.name));
}
const strolling = await newcomer('stroller', 'Wanderer'), strollerWho = strolling.c.att.who;
S.socks.splice(S.socks.indexOf(strolling.c), 1); // (their game has gone: they're away, their person still in the world)
n = await twin('twin-d', 'wanderer');
expect(S.w.stateOf(S.w.persons.get(strollerWho)) === 'away' && n.name === null && n.taken, 'someone away keeps their name', JSON.stringify(n.name));
S.w.persons.get(whoNamed('Mary-Jane')).state = 'dead';
S.w.persons.get(whoNamed('Bo 🙂')).state = 'gone'; // (gone after too long away)
S.w.persons.delete(whoNamed("D'Arcy")); // (left the world for good)
S.w.admin.banned.push(whoNamed('Łukasz'));
for (const [pid, name, whose] of [['twin-e', 'mary-jane', 'someone who died'], ['twin-f', 'Bo 🙂', 'someone gone after too long away'], ['twin-g', "d'arcy", 'someone who left the world'], ['twin-h', 'łukasz', 'a banned player']]) {
  n = await twin(pid, name);
  expect(n.name === name, `the name of ${whose} is free again: "${name}"`, JSON.stringify(n.name));
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
  // (0.2.0: every other message a player can send, with the same names)
  await quietly({ t: 'plant', id: k, seed: k }); await quietly({ t: 'harvest', id: k }); await quietly({ t: 'dig', kind: k, x: 30.5, z: 30.5 }); await quietly({ t: 'flatten', id: k });
  await quietly({ t: 'equip', kind: k, which: 0 }); await quietly({ t: 'equip', kind: 'stone-axe', which: k, out: { kind: k, which: k } }); await quietly({ t: 'unequip', kind: k, which: k });
  await quietly({ t: 'build', id: k }); await quietly({ t: 'unplace', id: k }); await quietly({ t: 'apart', id: k }); await quietly({ t: 'fish' });
  await quietly({ t: 'tasks', list: [{ type: k, kind: k, id: k, plant: k, source: k, what: k }] }); await quietly({ t: 'tasks', list: k });
  await quietly({ t: 'socInvite', who: k, name: k }); await quietly({ t: 'socAnswer', id: k, yes: true }); await quietly({ t: 'socRename', name: k }); await quietly({ t: 'socRemove', who: k });
  await quietly({ t: 'sleep', on: k }); await quietly({ t: 'move', x: k, z: k, path: k }); await quietly({ t: 'act', pose: k, seconds: k }); await quietly({ t: 'say', text: k });
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
expect(threw === 0 && S.p.carry.stick === 3 && Math.abs(fed - 2 * DATA.placeables.campfire.fire.secondsEach * 1000) < 30000, 'a fuel called constructor feeds the fire with 2 of its usual fuel, sticks, and nothing odd', `${S.p.carry.stick} sticks left, fuel up ${Math.round(fed / 60000)} min`);

console.log('H. reports about players: limited per address, however many times it reconnects');
S = await start(LAYOUT());
const reportFrom = async (addr, k) => { // a new connection every time, as someone reconnecting over and over would have
  const c = { att: { id: `r-${addr}-${k}`, who: `r-${addr}-${k}`, watch: false, admin: false, alive: false, from: addr, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test' }, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  S.socks.push(c);
  await S.w.webSocketMessage(c, JSON.stringify({ t: 'report', id: 'hax', reason: 'spam', note: `report ${k}` })); await wait(2);
  S.socks.splice(S.socks.indexOf(c), 1);
  return c.got.map((m) => m.t + (m.ok === false ? ':no' : '')).join();
};
const kept = async () => ((await S.w.ctx.storage.get('reports')) || []).length;
const answers = [];
for (let k = 0; k < 8; k++) answers.push(await reportFrom('addr-one', k));
expect(await kept() === 5 && answers.slice(0, 5).every((a) => a === 'reported') && answers.slice(5).every((a) => a === 'slow'), 'one address gets 5 reports in, then is told to slow down, on new connections too', `${await kept()} kept, answers: ${answers.join(' ')}`);
expect(await reportFrom('addr-two', 0) === 'reported' && await kept() === 6, 'someone else can still report');
expect(await reportFrom('addr-two', 1) === 'reported' && (await S.ask({ t: 'feedback', text: 'a note', v: '0' })).some((m) => m.t === 'thanks') && ((await S.w.ctx.storage.get('feedback')) || []).length === 1, 'and feedback has its own count: it still gets through');
const gone = { att: { id: 'r-x', who: 'r-x', watch: false, admin: false, alive: false, from: 'addr-three', v: DATA.version, b: DATA.build, e: DATA.era, link: 'test' }, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
S.socks.push(gone);
for (let k = 0; k < 3; k++) await S.w.webSocketMessage(gone, JSON.stringify({ t: 'report', id: 'nobody-there', reason: 'spam' }));
S.socks.splice(S.socks.indexOf(gone), 1);
expect(await reportFrom('addr-three', 9) === 'reported', "reports about someone who isn't there don't use up the count");
let n60 = 0;
for (let k = 0; k < 70; k++) if (await reportFrom(`addr-many-${k}`, 0) === 'reported') n60++;
expect(await kept() === 60 && n60 === 60 - 8, 'and 60 an hour from everyone is the most the Inbox takes', `${await kept()} kept in all`);

console.log('I. placing: not in the water, off the land, or in the middle of a tree or rock (it only changed how things look, but still)');
S = await start(LAYOUT());
S.p.carry = { campfire: 12 };
const placeAt = async (x, z) => { // the person stands a metre away and asks to put a campfire at x, z (spots on the placing grid, 0.1.17)
  S.p.x = x + 1; S.p.z = z;
  const got = await S.ask({ t: 'place', kind: 'campfire', x, z, rot: 0 });
  const no = got.find((m) => m.t === 'placeNo');
  return no ? no.why : (S.w.world.placed || []).some((th) => Math.abs(th.x - x) < 0.01 && Math.abs(th.z - z) < 0.01) ? 'placed' : 'nothing';
};
const POND = { x: -5.6, z: -0.9 };
expect(await placeAt(POND.x, POND.z) === 'Too close to the water', 'the middle of the pond: Too close to the water');
expect(await placeAt(POND.x + 5.5, POND.z) === 'Too close to the water', 'the water\'s edge: the same');
expect(await placeAt(2, -1) === 'placed', 'two metres back from the water, where the game lets you: placed');
expect(await placeAt(10, 10) === 'Not enough room here', 'the middle of tree 0: Not enough room here');
expect(await placeAt(5, 5) === 'Not enough room here', 'on rock 0: the same');
expect(await placeAt(3, 3.2) === 'Not enough room here', 'in bush 0: the same');
expect(await placeAt(48.2, 0) === 'Too close to the forest', 'past the edge of the land: Too close to the forest');
expect(await placeAt(30, 30) === 'placed', 'open ground: placed, as before');
expect(await placeAt(11, 12.5) === 'placed', 'a couple of metres from two trees: placed');
S.w.world.rocks = { 0: ['gone', Date.now()] };
expect(await placeAt(5, 5) === 'placed', 'where rock 0 was, once it has been broken and is gone: placed');
S.w.world.trees = { 1: ['gone', Date.now()] };
expect(await placeAt(12, 10) === 'placed', 'where tree 1 was, once its stump has been dug out: placed');
S.w.world.moved = { 'tree:0': [40, 40] };
expect(await placeAt(40, 40) === 'Not enough room here' && await placeAt(9, 10) === 'placed', 'a tree the admin moved: no room where it stands now, room where it was');
S = await start(null);
S.p.carry = { campfire: 3 };
expect(await placeAt(20, 20) === 'placed' && await placeAt(POND.x, POND.z) === 'Too close to the water', 'a world with no layout yet: open ground is fine, the pond is still the pond');

console.log('J. waits: what takes time in the game can\'t be done faster by a changed game');
const many = { trees: Array.from({ length: 24 }, (_, k) => [60 + k * 0.01, 60]), rocks: [[5, 5]], bushes: [[3, 3]], oldStumps: [], plants: { tallGrass: [[20, 20]] }, shore: [], open: [], v: DATA.version, b: DATA.build, e: DATA.era };
S = await start(many);
S.p.carry = { 'stone-axe': 1 }; S.p.wear = {};
S.p.x = 60; S.p.z = 60.5;
const secs = DATA.chopping.tree.seconds, fits = Math.floor(90 / (secs * 0.6)); // what a person has saved up to start with, in trees (guard.js WORK)
let chopped = 0, slowed = 0;
for (let k = 0; k < fits + 3; k++) { const got = await S.ask({ t: 'chop', what: 'tree', idx: k }); if ((S.w.world.trees || {})[k]) chopped++; else if (got.some((m) => m.t === 'slow')) slowed++; }
expect(chopped === fits && slowed === 3, `${fits + 3} trees chopped one after another with no waiting: ${fits} come down (what was saved up), the other 3 are told to slow down`, `${chopped} chopped, ${slowed} slowed`);
S.w.work.get('hax').at -= secs; // the time one tree takes goes by
await S.ask({ t: 'chop', what: 'tree', idx: fits });
expect((S.w.world.trees || {})[fits] && !(S.w.world.trees || {})[fits + 1], 'after waiting as long as a tree takes, the next one comes down');
const drained = () => { S.w.work.set('hax', { left: 0, at: Date.now() / 1000 }); };
const earned = (s) => { S.w.work.get('hax').at -= s; };
// each timed thing, with nothing saved up and then with the time gone by
S = await start(LAYOUT());
S.p.carry = { campfire: 1, 'stone-pickaxe': 1, knife: 1, 'fishing-spear': 1, fish: 2, stick: 3 }; S.p.wear = {};
S.p.x = 31; S.p.z = 30;
await S.ask({ t: 'place', kind: 'campfire', x: 30, z: 30, rot: 0 });
const site = () => S.w.world.placed[0];
drained();
let got = await S.ask({ t: 'build', id: site().id });
expect(!site().built && got.some((m) => m.t === 'slow'), 'building a campfire the moment it is put down: not built, told to slow down');
earned(DATA.placeables.campfire.buildSeconds);
await S.ask({ t: 'build', id: site().id });
expect(site().built, 'after the 10 seconds building takes: built');
drained();
await S.ask({ t: 'fire', id: site().id, do: 'add', n: 3 });
expect(site().fuel > 0 && S.p.carry.stick === undefined, 'adding fuel takes no time: it goes on straight away, with nothing saved up');
drained();
got = await S.ask({ t: 'fire', id: site().id, do: 'light' });
expect(!site().lit && got.some((m) => m.t === 'slow'), 'lighting it straight away: not lit');
earned(DATA.placeables.campfire.fire.lightSeconds);
await S.ask({ t: 'fire', id: site().id, do: 'light' });
expect(site().lit, 'after the 3 seconds lighting takes: lit');
drained();
got = await S.ask({ t: 'craft', id: 'cooked-fish' });
expect(S.p.carry.fish === 2 && !S.p.carry['cooked-fish'] && got.some((m) => m.t === 'slow'), 'cooking a fish with no wait: still raw');
earned(20);
await S.ask({ t: 'craft', id: 'cooked-fish' });
expect(S.p.carry.fish === 1 && S.p.carry['cooked-fish'] === 1, 'after the 20 seconds cooking takes: cooked');
drained();
S.p.x = 5.5; S.p.z = 5.5;
got = await S.ask({ t: 'quarry', what: 'rock', idx: 0 });
expect(!(S.w.world.rocks || {})[0] && got.some((m) => m.t === 'slow'), 'breaking a rock with no wait: still whole');
S.p.x = 20.5; S.p.z = 20.5;
got = await S.ask({ t: 'cut', plant: 'tallGrass', i: 0 });
expect(!S.p.carry.twine && got.some((m) => m.t === 'cutNo' && m.why === 'Slow down a little'), 'cutting grass with no wait: no twine');
earned(2);
await S.ask({ t: 'cut', plant: 'tallGrass', i: 0 });
expect(S.p.carry.twine === 1, 'after the 2 seconds it takes with a knife: twine');
drained();
S.p.x = POND.x + 6; S.p.z = POND.z;
got = await S.ask({ t: 'fish' });
expect(got.some((m) => m.t === 'fished' && m.why === 'Slow down a little') && (S.p.wear['fishing-spear'] || []).length === 0, 'fishing with no wait: no try, and the spear isn\'t worn');
// what takes no time is never held up
S.w.world.items.push({ id: 900, kind: 'stick', x: S.p.x, z: S.p.z, rot: 0 });
await S.ask({ t: 'take', id: 900 }); await S.ask({ t: 'drop', items: [{ kind: 'stick' }] }); await S.ask({ t: 'eat', kind: 'cooked-fish' });
expect(S.w.world.items.some((it) => it.kind === 'stick') && !S.p.carry['cooked-fish'], 'picking up, dropping and eating take no time: never held up, even with nothing saved up');
expect(S.w.worked(null, {}, S.p, 500) === true, 'the server carrying on with someone\'s task list while they\'re away keeps its own time: never held up');
expect(S.w.worked({}, { admin: true, watch: true, who: null }, S.p, 500) === true, 'nor is the admin');

console.log('K. rocks and boulders: the layout says which is which, not the game');
const withBoulders = { ...LAYOUT(), rocks: [[5, 5], [7, 5]], boulders: [1] };
S = await start({ ...S.w.cleanLayout(withBoulders), v: DATA.version, b: DATA.build, e: DATA.era });
expect(JSON.stringify(S.w.world.layout.boulders) === '[1]', 'a layout from this build says rock 1 is a boulder');
expect(JSON.stringify(S.w.cleanLayout({ rocks: [[1, 1], [2, 2]], boulders: [1, 1, 7, -1, 'x', 0.5, null] }).boulders) === '[1]', 'only whole numbers of rocks that are there are kept');
S.p.carry = { 'stone-pickaxe': 1 }; S.p.wear = {};
S.p.x = 7.5; S.p.z = 5.5;
await S.ask({ t: 'quarry', what: 'rock', idx: 1 }); // a boulder, mined "as a rock"
let stones = S.ground().stone || 0;
expect(S.w.world.rocks[1][0] === 'mined' && stones >= 3 && stones <= 5, 'a boulder mined "as a rock" is mined as the boulder it is: it stays, worn down, and gives 3 to 5 stones', `${S.w.world.rocks[1][0]}, ${stones} stones`);
S.w.world.items = [];
S.p.x = 5.5; S.p.z = 5.5;
await S.ask({ t: 'quarry', what: 'boulder', idx: 0 }); // a rock, mined "as a boulder"
expect(S.w.world.rocks[0][0] === 'gone' && S.ground().stone === 5, 'a rock mined "as a boulder" breaks like the rock it is: gone, 5 stones', `${S.w.world.rocks[0][0]}, ${S.ground().stone} stones`);
S = await start(LAYOUT()); // a layout from an older build: it doesn't say
S.p.carry = { 'stone-pickaxe': 1 }; S.p.wear = {};
S.p.x = 5.5; S.p.z = 5.5;
await S.ask({ t: 'quarry', what: 'boulder', idx: 0 });
expect(S.w.world.rocks[0][0] === 'mined', 'a layout from before 0.1.10 doesn\'t say, so it\'s the game\'s word, as it always was');

console.log('L. a brand new world uses the server\'s own numbers for berries and top-ups, whatever the first game says');
S = await start(null);
S.w.world = null;
await S.ask({ t: 'seed', items: [], spots: {}, caps: {}, holds: 15, regrowMs: 1, respawnMs: 1, layout: LAYOUT() });
const nw = S.w.world, src = DATA.sources.berryBush;
expect(nw && nw.holds === src.holds && nw.regrowMs === src.regrowHours * 3600000 && nw.respawnMs === DATA.settings.respawnMinutes * 60000,
  `a first game saying bushes hold 15 berries that grow back at once: the world is made with ${src.holds} berries, ${src.regrowHours} hours and a top-up every ${DATA.settings.respawnMinutes} minutes`, nw ? `${nw.holds}, ${nw.regrowMs / 3600000} h, ${nw.respawnMs / 60000} min` : 'no world');

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} as they should be${failed ? `, ${failed} NOT` : ''}`);
process.exit(failed ? 1 : 0);
