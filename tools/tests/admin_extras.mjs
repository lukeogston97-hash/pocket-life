// The admin's tools for fires and claims, the activity log, and Rename and Message for one person, tested straight
// against the server's World with no browser and no timing.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node admin_extras.mjs   (exit 0: all as it should be)
// Wherever it can, the proof that a tool worked comes from something other than the tool's own answer: what a player's
// game is sent, what the rules then let a player do (picking something up inside a claim), or what is in storage.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const FILE = JSON.parse(readFileSync(new URL('./build/server/game.json', import.meta.url), 'utf8'));
const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000, MAX = FILE.placeables.campfire.fire.maxHours * HOUR;
const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
const tick = () => new Promise((r) => setTimeout(r, 5));

function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {} };
}
const person = (who, name, x, z) => ({ who, state: 'alive', name, look: { name }, age: 30, born: Date.now(), x, z, ry: 0, stats: { health: 100, rest: 80, hunger: 75, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: {}, log: {} });
const fire = (id, x, z, more = {}) => ({ id, kind: 'campfire', x, z, rot: 0, built: true, fuel: 5 * HOUR, lit: false, at: Date.now(), ...more });
async function start(store) {
  const socks = [];
  const ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await new Promise((r) => setTimeout(r, 30));
  const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
  const playing = (who) => sock({ id: who, who, watch: false, admin: false, alive: true, from: `addr-${who}`, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test' });
  const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); await tick(); return s.got.slice(from); };
  const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
  const tool = async (m) => { const a = (await ask(admin, m)).filter((x) => x.t === 'admin').pop(); return a ? a.text : null; };
  const log = async () => (await ask(admin, { t: 'a.log' })).find((x) => x.t === 'adminLog').list;
  return { w, sock, playing, ask, admin, tool, log };
}
const hello = (pid, more = {}) => ({ t: 'hello', proto: 2, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test', pid, ...more });

const store = new Map();
let S = await start(store);
// a world with three fires clear of the pond and of each other, one too close to the first, and one by the pond
S.w.world = { format: 1, nextId: 50, items: [{ id: 10, kind: 'stick', x: 31, z: 31, rot: 0 }, { id: 11, kind: 'stick', x: 31.2, z: 31, rot: 0 }, { id: 12, kind: 'stick', x: 31.4, z: 31, rot: 0 }], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0,
  placed: [fire(1, 30, 30), fire(2, -35, 30), fire(3, 30, 12), fire(4, 5, 5), fire(5, -30, -30, { built: false, fuel: 0 })] };
S.w.persons.set('pat', person('pat', 'Pat', 30, 31));
S.w.persons.set('sam', person('sam', 'Sam', 30.6, 30.6));
const pat = S.playing('pat'), sam = S.playing('sam');
const placed = (id) => S.w.world.placed.find((th) => th.id === id);
const lastPlaced = (s, id) => s.got.filter((m) => m.t === 'placed' && m.thing.id === id).pop();
const samTakes = async (id) => (await S.ask(sam, { t: 'take', id })).find((m) => m.t === 'took');

console.log('A. fires: see them all, put one out, light it, set its fuel');
await S.ask(pat, { t: 'fire', id: 1, do: 'light' }); // Pat lights their first fire the way a player does: it becomes their claim
const patKey = () => (S.w.socOf('pat') ? `s:${S.w.socOf('pat').id}` : null); // (0.1.5: your claim is your society)
expect(placed(1).lit && placed(1).claim === patKey() && S.w.socOf('pat').name === "Pat's camp", 'Pat lit fire 1 the player\'s way and it is their claim, as their society');
let took = await samTakes(10);
expect(took && took.ok === false && /Pat's camp/.test(took.why || ''), 'so Sam can\'t pick up a stick inside it', took && took.why);
let fires = (await S.ask(S.admin, { t: 'a.fires' })).find((m) => m.t === 'adminFires');
const f1 = fires.list.find((f) => f.id === 1);
expect(fires.list.length === 5 && f1.lit && f1.built && f1.claim && f1.claim.name === "Pat's camp" && f1.max === MAX && f1.fuel > 4.9 * HOUR && f1.fuel <= 5 * HOUR, 'the admin\'s list has all 5 fires, with fire 1 burning, Pat\'s, about 5 hours left', `fuel ${Math.round(f1.fuel / 60000)} min of ${f1.max / HOUR} h`);
expect(fires.people.map((p) => p.name).join() === 'Pat,Sam', 'and the people a claim could go to', fires.people.map((p) => p.name).join());
let text = await S.tool({ t: 'a.fire', id: 1, do: 'out' });
expect(text === "Put out. Pat's camp ended with it", 'Put out says the claim (and its society) ended with it', text);
expect(!placed(1).lit && !placed(1).claim, 'the fire is out and nobody\'s');
expect(lastPlaced(sam, 1) && lastPlaced(sam, 1).thing.lit === false && !lastPlaced(sam, 1).thing.claim, 'every game is told (Sam\'s was)');
expect(pat.got.some((m) => m.t === 'socNote' && /has ended: its fire went out/.test(m.text)) && !S.w.socOf('pat'), 'Pat is told their claim and society have ended');
took = await samTakes(10);
expect(took && took.ok === true, 'and now Sam can pick the stick up: the land really is free');
expect(await S.tool({ t: 'a.fire', id: 1, do: 'out' }) === "It's already out", 'putting it out again says it is already out');
text = await S.tool({ t: 'a.fire', id: 1, do: 'light' });
expect(/^Lit, with \d/.test(text) && placed(1).lit && placed(1).burnt && !placed(1).claim, 'Light lights it, as nobody\'s claim', text);
expect(lastPlaced(pat, 1).thing.lit === true, 'and Pat\'s game is told it burns');
expect(await S.tool({ t: 'a.fire', id: 1, do: 'light' }) === "It's already burning", 'lighting it again says it is already burning');
text = await S.tool({ t: 'a.fire', id: 1, do: 'fuel', hours: 2 });
expect(text === '2 h of fuel' && Math.abs(placed(1).fuel - 2 * HOUR) < 1000 && placed(1).lit, 'Fuel 2 sets two hours and it keeps burning', `${text}, ${Math.round(placed(1).fuel / 60000)} min`);
text = await S.tool({ t: 'a.fire', id: 1, do: 'fuel', hours: 1.5 });
expect(text === '1 h 30 m of fuel', 'part hours work', text);
text = await S.tool({ t: 'a.fire', id: 1, do: 'fuel', hours: 1000 });
expect(placed(1).fuel === MAX && /the most it holds/.test(text), 'more than it holds is cut to the most it holds', text);
const said = [];
for (const bad of ['x', '5', -1, null, NaN, undefined, true, [3]]) said.push(await S.tool({ t: 'a.fire', id: 1, do: 'fuel', hours: bad }));
expect(placed(1).fuel > MAX - 1000 && placed(1).lit && said.every((t) => t === 'How many hours?'), 'anything that isn\'t a number from 0 up changes nothing (words, below 0, nothing typed, true, a list)', `${Math.round(placed(1).fuel / HOUR)} h left, answers: ${[...new Set(said)].join(' / ')}`);
text = await S.tool({ t: 'a.fire', id: 1, do: 'fuel', hours: 0 });
expect(text === 'No fuel left' && !placed(1).lit && placed(1).fuel === 0, 'Fuel 0 leaves none, and it is out', text);
expect(await S.tool({ t: 'a.fire', id: 1, do: 'light' }) === 'It has no fuel. Set its fuel first', 'a fire with no fuel can\'t be lit');
expect(await S.tool({ t: 'a.fire', id: 5, do: 'light' }) === "It isn't built yet", 'nor one that isn\'t built');
expect(await S.tool({ t: 'a.fire', id: 999, do: 'out' }) === 'That fire is gone', 'a fire that isn\'t there says so');
const before = JSON.stringify(S.w.world.placed);
await S.ask(pat, { t: 'a.fire', id: 2, do: 'light' }); await S.ask(pat, { t: 'a.claim', id: 2, do: 'give', to: 'pat' }); await S.ask(pat, { t: 'a.fires' }); await S.ask(pat, { t: 'a.log' });
expect(JSON.stringify(S.w.world.placed) === before && !pat.got.some((m) => m.t === 'adminFires' || m.t === 'adminLog' || m.t === 'admin'), 'a player sending the same messages changes nothing and is told nothing');

console.log('B. claims: give one, move it, end it, with the game\'s own rules');
await S.tool({ t: 'a.fire', id: 1, do: 'fuel', hours: 5 });
expect(await S.tool({ t: 'a.claim', id: 1, do: 'give', to: 'pat' }) === 'Light it first: a claim lasts only while its fire burns', 'a fire that is out can\'t hold a claim');
await S.tool({ t: 'a.fire', id: 1, do: 'light' });
text = await S.tool({ t: 'a.claim', id: 1, do: 'give', to: 'pat' });
expect(text === "Now Pat's claim, as Pat's camp" && placed(1).claim === patKey() && placed(1).by === 'pat', 'Give makes the burning fire Pat\'s claim (a new society)', text);
expect(pat.got.some((m) => m.t === 'claimNote' && /now your camp/.test(m.text)) && lastPlaced(sam, 1).thing.claim.name === "Pat's camp", 'Pat is told, and every game sees whose it is');
took = await samTakes(11);
expect(took && took.ok === false && /Pat's camp/.test(took.why || ''), 'and the rules hold Sam to it again', took && took.why);
expect(await S.tool({ t: 'a.claim', id: 1, do: 'give', to: 'pat' }) === 'Pat already has a claim', 'giving it to its owner says so');
const patNotes = pat.got.filter((m) => m.t === 'socNote').length;
text = await S.tool({ t: 'a.claim', id: 1, do: 'give', to: 'sam' });
expect(text === "Now Sam's claim, as Sam's camp (it was Pat's camp)" && placed(1).claim === `s:${S.w.socOf('sam').id}`, 'it can be moved to Sam', text);
expect(pat.got.filter((m) => m.t === 'socNote').length === patNotes + 1 && /has ended/.test(pat.got.filter((m) => m.t === 'socNote').pop().text) && !S.w.socOf('pat'), 'Pat is told theirs has ended');
took = await samTakes(11);
expect(took && took.ok === true, 'and Sam can now pick things up there');
await S.tool({ t: 'a.fire', id: 2, do: 'light' }); await S.tool({ t: 'a.fire', id: 3, do: 'light' }); await S.tool({ t: 'a.fire', id: 4, do: 'light' });
expect(await S.tool({ t: 'a.claim', id: 2, do: 'give', to: 'sam' }) === 'Sam already has a claim', 'one claim each: Sam can\'t be given a second');
expect(await S.tool({ t: 'a.claim', id: 3, do: 'give', to: 'pat' }) === "It's too close to Sam's camp", 'claims can\'t overlap');
expect(await S.tool({ t: 'a.claim', id: 4, do: 'give', to: 'pat' }) === "It's too close to the pond to be a claim", 'nor sit by the pond');
expect(await S.tool({ t: 'a.claim', id: 2, do: 'give', to: 'nobody' }) === "They've left", 'nor go to someone who isn\'t there');
expect(!placed(2).claim && !placed(3).claim && !placed(4).claim && S.w.claims().length === 1, 'none of those made a claim', `${S.w.claims().length} claim`);
text = await S.tool({ t: 'a.claim', id: 2, do: 'give', to: 'pat' });
expect(text === "Now Pat's claim, as Pat's camp" && S.w.claims().length === 2, 'a fire clear of everything can be Pat\'s', text);
text = await S.tool({ t: 'a.claim', id: 1, do: 'end' });
expect(text === "Sam's camp ended. The fire burns on" && placed(1).lit && !placed(1).claim && placed(1).by === 'sam' && !S.w.socOf('sam'), 'End claim frees the land and ends the society, the fire burns on and is still Sam\'s to pack up', text);
expect(sam.got.some((m) => m.t === 'socNote' && /has ended/.test(m.text)), 'Sam is told');
expect(await S.tool({ t: 'a.claim', id: 1, do: 'end' }) === "It's nobody's claim", 'ending it again says it is nobody\'s');
expect(store.get('world').placed.find((th) => th.id === 2).claim === patKey() && !store.get('world').placed.find((th) => th.id === 1).claim && store.get('societies').list.some((x) => x.leader === 'pat'), 'and all of it is saved');

console.log('C. the activity log');
let list = await S.log();
const has = (re, kind) => list.some((l) => re.test(l.text) && (!kind || l.kind === kind));
expect(list.length > 10 && list[0].at >= list[list.length - 1].at, 'newest first', `${list.length} lines`);
expect(has(/^Pat lit a fire and started Pat's camp$/, 'world'), 'Pat lighting their first fire is there', list.filter((l) => l.kind === 'world').map((l) => l.text).join(' | '));
expect(has(/^Fire \(campfire at 30, 30\): Put out\. Pat's camp ended with it$/, 'admin'), 'so is the admin putting it out, with which fire');
expect(has(/^Claim \(campfire at 30, 30\): Now Sam's claim, as Sam's camp \(it was Pat's camp\)$/, 'admin'), 'and the claim moving');
expect(has(/^Claim \(campfire at -35, 30\): Sam already has a claim$/, 'admin'), 'a tool that couldn\'t be done is there with why');
const n0 = list.length;
for (const t of ['a.state', 'a.players', 'a.fires', 'a.items', 'a.list', 'a.log']) await S.ask(S.admin, { t });
await S.ask(S.admin, { t: 'a.player', id: 'pat' });
expect((await S.log()).length === n0, 'looking at things adds nothing');
// a new person, through the game's own hello and create
const kimSock = S.sock({ from: 'addr-kim' });
await S.ask(kimSock, hello('kim-phone'));
const kim = kimSock.att.who;
await S.ask(kimSock, { t: 'create', name: 'Kim', age: 20, look: {} });
list = await S.log();
expect(S.w.persons.get(kim) && list[0].text === 'New person: Kim, 20' && list[0].kind === 'world', 'a new person gets a line', list[0].text);
// they go away for half an hour and come back; a short break in the connection gets no line
const kp = S.w.persons.get(kim);
Object.assign(kp, { leftAt: Date.now() - 30 * 60000, simAt: Date.now() - 30 * 60000, home: [kp.x, kp.z] });
kimSock.att = null;
const kimBack = S.sock({ from: 'addr-kim' });
await S.ask(kimBack, hello('kim-phone'));
list = await S.log();
expect(list[0].text === 'Kim came back after 30 m', 'back after half an hour away gets a line', list[0].text);
Object.assign(kp, { leftAt: Date.now() - 2 * 60000, simAt: Date.now() - 2 * 60000, home: [kp.x, kp.z] });
kimBack.att = null;
const kimAgain = S.sock({ from: 'addr-kim' });
await S.ask(kimAgain, hello('kim-phone'));
expect((await S.log())[0].text === 'Kim came back after 30 m', 'back after 2 minutes does not');
S.w.die(kp, 'thirst', false); await tick();
list = await S.log();
expect(list[0].text === 'Kim died: thirst' && list[0].kind === 'world', 'a death gets a line (die() is the one place people die)', list[0].text);
// the admin password
const bad = S.sock({ from: 'addr-bad' });
for (let i = 0; i < 4; i++) await S.ask(bad, hello('x', { watch: true, admin: true, adminCode: 'nope' }));
list = await S.log();
expect(list[0].text === 'Wrong admin password' && list[0].n === 4 && list[0].kind === 'guard', 'wrong passwords are counted on one line, not repeated', `${list[0].text} x${list[0].n}`);
await S.ask(bad, hello('x', { watch: true, admin: true, adminCode: 'nope' }));
expect((await S.log())[0].text === 'Wrong admin password 5 times: that address is locked out for 15 minutes', 'the fifth says that address is locked out');
const bad2 = S.sock({ from: 'addr-bad' }); // (a new connection from the same address, as trying again is: one connection is only let say hello a few times)
await S.ask(bad2, hello('x', { watch: true, admin: true, adminCode: 'secret123456' }));
list = await S.log();
expect(list[0].text === 'Admin password tried from an address that is locked out' && !bad2.att.admin && bad2.got.some((m) => m.t === 'adminNo'), 'and even the right password from there is refused, and noted', list[0].text);
const good = S.sock({ from: 'addr-good' });
await S.ask(good, hello('y', { watch: true, admin: true, adminCode: 'secret123456' }));
list = await S.log();
expect(good.att.admin === true && list[0].text === 'Admin mode opened' && list[0].kind === 'admin', 'getting in is noted too', list[0].text);
expect(!JSON.stringify(list).includes('secret123456') && !JSON.stringify(list).includes('nope'), 'no password is ever written in the log');
// a tool with no words of its own
await S.ask(S.admin, { t: 'a.add', kind: 'stone', n: 3, x: 12.2, z: -4.4 });
expect((await S.log())[0].text === 'Add item: 3 stone at 12, -4', 'Add item is noted with what and where', (await S.log())[0].text);
const stone = S.w.world.items.find((it) => it.kind === 'stone');
await S.ask(S.admin, { t: 'a.remove', id: stone.id });
expect(/^Remove: loose stone at /.test((await S.log())[0].text), 'so is removing a loose item', (await S.log())[0].text);
// stored, and still there after the server restarts
await tick();
expect(Array.isArray(store.get('activity')) && store.get('activity').length === (await S.log()).length, 'the log is in storage', `${(store.get('activity') || []).length} lines`);
const kept = (await S.log()).length;
S = await start(store);
expect((await S.log()).length === kept, 'and is still there after the server restarts', `${(await S.log()).length} lines`);
for (let i = 0; i < 260; i++) S.w.note('world', `line ${i}`);
list = await S.log();
expect(list.length === 200 && list[0].text === 'line 259' && list[199].text === 'line 60', 'only the newest 200 lines are kept', `${list.length}, newest "${list[0].text}"`);
await tick();
expect(store.get('activity').length === 200, 'in storage too');

console.log('D. one person: a new name, and a message only they see');
S.w.world = store.get('world');
const pat2 = S.playing('pat'), sam2 = S.playing('sam');
text = await S.tool({ t: 'a.rename', id: 'pat', name: '  Patricia  ' });
expect(text === 'Pat is now Patricia' && S.w.persons.get('pat').name === 'Patricia' && S.w.persons.get('pat').look.name === 'Patricia', 'Rename changes the name', text);
expect(sam2.got.some((m) => m.t === 'join' && m.person.id === 'pat' && m.person.name === 'Patricia') && !pat2.got.some((m) => m.t === 'join'), 'everyone else\'s game is sent the person again with the new name');
expect(pat2.got.some((m) => m.t === 'me' && m.name === 'Patricia'), 'their own game is sent it');
expect(store.get('p:pat').name === 'Patricia', 'and it is saved');
expect(S.admin.got.some((m) => m.t === 'adminPlayer' && m.name === 'Patricia'), 'the admin\'s page for them shows it');
expect(await S.tool({ t: 'a.rename', id: 'pat', name: '   ' }) === 'Type a name', 'an empty name is refused');
expect(await S.tool({ t: 'a.rename', id: 'pat', name: 'Patricia' }) === "That's already their name", 'so is the same name');
expect(await S.tool({ t: 'a.rename', id: 'pat', name: ' sam ' }) === 'Someone in the world already has that name' && S.w.persons.get('pat').name === 'Patricia', 'and a name someone else in the world has, whatever its capitals (names are one of a kind)');
await S.tool({ t: 'a.rename', id: 'pat', name: 'A very long name that goes on and on' });
expect(S.w.persons.get('pat').name.length === 20, 'a long name is cut to 20 letters', S.w.persons.get('pat').name);
expect(await S.tool({ t: 'a.rename', id: 'nobody', name: 'X' }) === "They've gone", 'someone who isn\'t there can\'t be renamed');
await S.tool({ t: 'a.rename', id: 'pat', name: 'Pat' });
const heardBefore = sam2.got.filter((m) => m.t === 'announce').length;
text = await S.tool({ t: 'a.tell', id: 'pat', text: 'Hello Pat, thanks for testing' });
expect(text === 'Sent to Pat' && pat2.got.some((m) => m.t === 'announce' && m.text === 'Hello Pat, thanks for testing'), 'Message shows on their screen', text);
expect(sam2.got.filter((m) => m.t === 'announce').length === heardBefore, 'and on nobody else\'s');
expect(await S.tool({ t: 'a.tell', id: 'pat', text: '  ' }) === 'Type a message', 'an empty message is refused');
pat2.att = null; // Pat's game closes: they're away
S.w.fresh();
text = await S.tool({ t: 'a.tell', id: 'pat', text: 'Are you there?' });
expect(text === "Pat is away, so they wouldn't see it", 'a message to someone away says they wouldn\'t see it', text);
list = await S.log();
expect(list.some((l) => l.text === 'Rename: Pat is now Patricia') && list.some((l) => l.text === 'Message: Sent to Pat'), 'both are in the log');

console.log('D2. found recipes (the craft mat, 0.1.8): made the player\'s way, kept tools stay, the admin gives all or clears, a new person keeps them');
const pat3 = S.playing('pat'); S.w.fresh();
const patP = () => S.w.persons.get('pat');
patP().carry = { stone: 2 }; patP().found = [];
await S.ask(pat3, { t: 'craft', id: 'sharp-stone' });
let mine = pat3.got.filter((m) => m.t === 'me').pop();
expect(patP().carry['sharp-stone'] === 1 && !patP().carry.stone && mine && mine.found.includes('sharp-stone'), 'Pat knocks 2 stones into a sharp stone: it is in their found recipes, and their game is told', JSON.stringify(mine && mine.found));
patP().carry = { berry: 1 };
await S.ask(pat3, { t: 'craft', id: 'berry-seeds' });
expect(!patP().carry['berry-seeds'] && patP().carry.berry === 1, 'berry seeds need a sharp stone on the mat too, even though it is kept');
patP().carry = { berry: 1, 'sharp-stone': 1 };
await S.ask(pat3, { t: 'craft', id: 'berry-seeds' });
expect(patP().carry['berry-seeds'] === 1 && patP().carry['sharp-stone'] === 1 && !patP().carry.berry && patP().found.includes('berry-seeds'), 'with one, the berry is cut open for its seeds and the sharp stone is kept', JSON.stringify(patP().carry));
// Luke's tool recipes (0.1.9 test 2): every tool is a blade, a handle and twine, made the player's way from scratch
// (0.1.21: the knife's handle is a short tool handle, a stick and twine; twigs are gone)
patP().carry = { stone: 8, stick: 5, twine: 8 }; patP().wear = {};
for (const id of ['sharp-stone', 'sharp-stone', 'sharp-stone', 'sharp-stone', 'axe-head', 'long-stick', 'long-stick', 'stone-axe', 'pick-head', 'stone-pickaxe', 'short-handle', 'knife']) await S.ask(S.playing('pat'), { t: 'craft', id }); // (a fresh connection each: crafting is limited to a few in a row)
expect(JSON.stringify(patP().carry) === JSON.stringify({ 'stone-axe': 1, 'stone-pickaxe': 1, knife: 1 }), 'from 8 stones, 5 sticks and 8 twine: sharp stones, a stone axe head, 2 long tool handles, a stone pick head, a stone axe, a stone pickaxe, a short tool handle and a stone knife, with nothing left over', JSON.stringify(patP().carry));
patP().found = ['sharp-stone', 'knife']; patP().carry = {}; patP().wear = {};
await S.ask(pat3, { t: 'a.found', id: 'pat', all: true });
expect(patP().found.length === 2, 'a player sending the admin\'s Found tool gets nothing', JSON.stringify(patP().found));
text = await S.tool({ t: 'a.found', id: 'pat', all: true });
mine = pat3.got.filter((m) => m.t === 'me').pop();
expect(text === 'Pat has found every recipe' && mine.found.length === Object.keys(FILE.recipes).length, 'Find all gives them every recipe, and their game is told', text);
const foundPage = S.admin.got.filter((m) => m.t === 'adminPlayer').pop();
expect(foundPage && foundPage.found.length === Object.keys(FILE.recipes).length, 'the admin\'s page for them shows it');
text = await S.tool({ t: 'a.found', id: 'pat', all: false });
expect(text === "Pat's found recipes are cleared" && patP().found.length === 0, 'Clear found empties them', text);
expect(await S.tool({ t: 'a.found', id: 'nobody', all: true }) === "They've gone", 'someone who isn\'t there has none to change');
patP().found = ['knife', 'no-such-recipe'];
patP().state = 'dead';
await S.ask(pat3, { t: 'create', name: 'Pat', look: {}, age: 30 });
expect(S.w.alive(patP()) && JSON.stringify(patP().found) === '["knife"]', 'a new person after dying keeps the recipes the last one found (ones the game no longer has are dropped)', JSON.stringify(patP().found));
list = await S.log();
expect(list.some((l) => /^Found recipes/.test(l.text)), 'the admin\'s changes are in the log');

console.log('E. Reset everything starts the log again');
await S.ask(S.admin, { t: 'a.reset', all: true }); await tick();
// (everyone is sent away by a reset, the admin too: a fresh admin connection reads the log)
const again = S.sock({ id: 'w:9', who: null, watch: true, admin: true, from: 'addr-admin' });
list = (await S.ask(again, { t: 'a.log' })).find((m) => m.t === 'adminLog').list;
expect(list.length === 1 && /^Reset everything/.test(list[0].text), 'one line is left, saying so', list.map((l) => l.text).join(' | '));
expect(store.get('activity').length === 1, 'in storage too');

console.log('F. leaving admin mode: the same connection says hello again as a plain watcher');
const boss = S.sock({ from: 'addr-boss' });
await S.ask(boss, hello('boss-pc', { watch: true, admin: true, adminCode: 'secret123456' }));
expect(boss.att.admin === true && (await S.ask(boss, { t: 'a.state' })).some((m) => m.t === 'admin'), 'in admin mode its tools answer');
await new Promise((r) => setTimeout(r, 2100)); // (one connection may say hello about every 2 seconds)
const afterExit = await S.ask(boss, hello('boss-pc', { watch: true }));
expect(boss.att.admin === false && boss.att.watch === true && afterExit.some((m) => m.t === 'welcome') && !afterExit.some((m) => m.t === 'admin'), 'after Exit it is a plain watcher: welcomed, with no admin numbers');
S.w.world = { format: 1, nextId: 1, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0, placed: [] }; // (E reset everything: a world and a person to protect)
S.w.persons.set('zed', person('zed', 'Zed', 0, 5));
const quiet = [];
for (const m of [{ t: 'a.state' }, { t: 'a.log' }, { t: 'a.players' }, { t: 'a.list' }, { t: 'a.announce', text: 'still here?' }, { t: 'a.removePerson', id: 'zed' }, { t: 'a.reset', all: true }]) quiet.push(...(await S.ask(boss, m)));
expect(quiet.length === 0 && S.w.world !== null && S.w.persons.has('zed') && S.w.alive(S.w.persons.get('zed')), 'and none of the admin tools answer it any more: Reset everything and Remove person from it do nothing', `${quiet.length} answers, world ${S.w.world ? 'still there' : 'GONE'}, Zed ${S.w.persons.has('zed') ? 'still there' : 'GONE'}`);
const heard = S.sock({ id: 'w:7', who: null, watch: true, admin: false, from: 'addr-w' });
await S.ask(boss, { t: 'a.announce', text: 'still here?' });
expect(!heard.got.some((m) => m.t === 'announce'), 'nor does anyone hear a message from it');

console.log('P. Grow back for one plant (0.2.0): a clump of grass, an ore vein or anything else in plants');
S = await start(new Map());
S.w.world = { format: 1, nextId: 1, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0, placed: [], plants: { tallGrass: { 2: Date.now() + 3600000 } } };
let grew = await S.tool({ t: 'a.regrow', what: 'plant', plant: 'tallGrass', idx: 2 });
expect(grew === 'Grown back' && !S.w.world.plants.tallGrass[2], 'a cut clump of tall grass is grown back', grew);
grew = await S.tool({ t: 'a.regrow', what: 'plant', plant: 'tallGrass', idx: 2 });
expect(grew === 'Already grown', 'asked again, it already is', grew);
grew = await S.tool({ t: 'a.regrow', what: 'plant', plant: 'constructor', idx: 0 });
expect(grew === 'Already grown', "a kind of plant that isn't one does nothing", grew);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} as they should be${failed ? `, ${failed} NOT` : ''}`);
process.exit(failed ? 1 : 0);
