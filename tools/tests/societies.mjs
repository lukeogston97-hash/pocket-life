// Societies (0.1.4, reworked 0.1.5: your claim is your society, server/src/societies.js), tested straight against the
// server's World with no browser and no timing: lighting your first fire starts it, renaming, invites, joining (after
// putting out your own fire), only the leader putting the fire out, leaving, leaders, the fire going out ending it, being
// gone, the admin's tools, and claims from before 0.1.5 becoming societies on start.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node societies.mjs   (exit 0: all ok)
// Wherever it can, the proof comes from what the rules then let a player do (picking something up inside a claim), what
// each game is sent, or what is in storage, not from a tool's own answer.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000, MAX = DATA.societies.maxMembers;
const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
const tick = () => new Promise((r) => setTimeout(r, 5));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await wait(30);
  const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
  const playing = (who) => sock({ id: who, who, watch: false, admin: false, alive: true, from: `addr-${who}`, v: DATA.version, b: DATA.build, e: DATA.era, link: 'test' });
  const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); await tick(); return s.got.slice(from); };
  const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
  const tool = async (m) => { const got = await ask(admin, m); const a = got.filter((x) => x.t === 'admin').pop(); return { text: a ? a.text : null, socs: (got.filter((x) => x.t === 'adminSocs').pop() || {}).list }; };
  return { w, sock, playing, ask, admin, tool };
}

const store = new Map();
let S = await start(store);
// fire 1 for Pat; fire 2 inside its claim; fire 5 for Kim far away; fire 6 clear of everything
S.w.world = { format: 1, nextId: 50, items: [{ id: 10, kind: 'stick', x: 31, z: 31, rot: 0 }, { id: 11, kind: 'stick', x: 31.2, z: 31, rot: 0 }, { id: 12, kind: 'stick', x: 31.4, z: 31, rot: 0 }, { id: 13, kind: 'stick', x: 31.6, z: 31, rot: 0 }],
  bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0,
  placed: [fire(1, 30, 30), fire(2, 31.5, 33), fire(5, -30, -30), fire(6, -35, 30)] };
for (const [who, name, x, z] of [['pat', 'Pat', 30, 31], ['sam', 'Sam', 30.6, 30.6], ['kim', 'Kim', 31, 30], ['lee', 'Lee', 31.5, 30.5]]) S.w.persons.set(who, person(who, name, x, z));
const pat = S.playing('pat'), sam = S.playing('sam'), kim = S.playing('kim'), lee = S.playing('lee');
const placed = (id) => S.w.world.placed.find((th) => th.id === id);
const take = async (s, id) => (await S.ask(s, { t: 'take', id })).find((m) => m.t === 'took');
const said = (got) => got.filter((m) => m.t === 'socNo' || m.t === 'socNote' || m.t === 'claimNote' || m.t === 'placeNo').map((m) => m.why || m.text).join(' | ');
const meOf = (got) => got.filter((m) => m.t === 'me').pop();
const tagFor = (s, who) => s.got.filter((m) => m.t === 'socTag' && m.id === who).pop();

console.log('A. lighting your first fire starts your society; the leader can rename it');
let got = await S.ask(pat, { t: 'fire', id: 1, do: 'light' });
let me = meOf(got);
expect(placed(1).claim === 's:1' && me && me.soc && me.soc.name === "Pat's camp" && me.soc.lead && me.soc.members.length === 1 && me.soc.max === MAX, "Pat lit fire 1: it's Pat's claim and Pat's society, Pat's camp", `${placed(1).claim} ${JSON.stringify(me && me.soc)}`);
expect(/your camp while it burns/.test(said(got)), 'Pat is told', said(got));
expect(!S.w.people(null).find((p) => p.id === 'pat').soc, 'with only Pat in it, nothing shows under Pat\'s name');
got = await S.ask(pat, { t: 'fire', id: 2, do: 'light' });
expect(placed(2).lit && !placed(2).claim && /already have a camp/.test(said(got)), 'a second fire is just a fire', said(got));
let took = await take(sam, 10);
expect(took && took.ok === false && /belongs to Pat's camp/.test(took.why || ''), 'Sam can\'t pick up a stick inside it', took && took.why);
got = await S.ask(pat, { t: 'socRename', name: '  Rivers  ' });
expect(S.w.socOf('pat').name === 'Rivers' && (meOf(got) || {}).soc && meOf(got).soc.name === 'Rivers', 'Pat renamed it Rivers');
const seen = sam.got.filter((m) => m.t === 'placed' && m.thing.id === 1).pop();
expect(seen && seen.thing.claim && seen.thing.claim.name === 'Rivers' && seen.thing.claim.who === 's:1', 'Sam\'s game sees the claim is now called Rivers');
got = await S.ask(sam, { t: 'socRename', name: 'Mine' });
expect(/Only the leader/.test(said(got)), 'only the leader renames', said(got));

console.log('B. invites: the leader invites someone nearby, they join, and share the claim');
got = await S.ask(sam, { t: 'socInvite', id: 'kim' });
expect(/Light a campfire first/.test(said(got)), 'someone with no society is told how to start one', said(got));
got = await S.ask(pat, { t: 'socInvite', id: 'sam' });
const inv = sam.got.filter((m) => m.t === 'socInvite').pop();
expect(/Invite sent to Sam/.test(said(got)) && inv && inv.soc === 'Rivers' && inv.by === 'Pat', 'Pat invited Sam, and Sam\'s game shows it', JSON.stringify(inv));
got = await S.ask(sam, { t: 'socAnswer', yes: true });
me = meOf(got);
expect(me && me.soc && me.soc.name === 'Rivers' && !me.soc.lead && me.soc.members.map((x) => x.name).join() === 'Pat,Sam', 'Sam joined Rivers (Pat leads, listed first)', JSON.stringify(me && me.soc && me.soc.members));
expect((tagFor(kim, 'sam') || {}).soc === 'Rivers' && (tagFor(kim, 'pat') || {}).soc === 'Rivers', 'with 2 in it, everyone sees Rivers under both names');
took = await take(sam, 10);
expect(took && took.ok !== false && !S.w.world.items.some((it) => it.id === 10), 'now Sam can pick up a stick inside the claim', JSON.stringify(took));
Object.assign(S.w.persons.get('sam'), { x: -34, z: 31 }); // (over at fire 6, clear of every claim)
got = await S.ask(sam, { t: 'fire', id: 6, do: 'light' });
expect(placed(6).lit && !placed(6).claim && /You're in Rivers/.test(said(got)), "Sam's own fire is just a fire", said(got));
Object.assign(S.w.persons.get('sam'), { x: 30.6, z: 30.6 });
got = await S.ask(sam, { t: 'fire', id: 1, do: 'out' });
expect(placed(1).lit && /Only Pat can put it out/.test(said(got)), 'only the leader can put the society\'s fire out', said(got));
const fuelBefore = S.w.burn(placed(1)).fuel;
S.w.persons.get('sam').carry = { stick: 2 };
await S.ask(sam, { t: 'fire', id: 1, do: 'add', n: 1, fuel: 'stick' });
expect(S.w.burn(placed(1)).fuel > fuelBefore + 60000, 'Sam can feed it', `${Math.round(fuelBefore / 60000)} -> ${Math.round(S.w.burn(placed(1)).fuel / 60000)} min`);
got = await S.ask(sam, { t: 'socInvite', id: 'lee' });
expect(/Only the leader/.test(said(got)), 'only the leader invites', said(got));

console.log('C. joining while your own fire holds your claim: put it out first');
await S.tool({ t: 'a.fire', id: 5, do: 'light' });
let r = await S.tool({ t: 'a.claim', id: 5, do: 'give', to: 'kim' });
expect(placed(5).claim && S.w.socOf('kim') && S.w.socOf('kim').name === "Kim's camp", 'the admin gave fire 5 to Kim: it is her society, Kim\'s camp', r.text);
r = await S.tool({ t: 'a.claim', id: 6, do: 'give', to: 'sam' });
expect(/Sam is in Rivers/.test(r.text || '') && !placed(6).claim, 'one claim each: Sam is in Rivers already', r.text);
await S.ask(pat, { t: 'socInvite', id: 'kim' });
got = await S.ask(kim, { t: 'socAnswer', yes: true });
expect(/Put your fire out first/.test(said(got)) && S.w.socOf('kim').name === "Kim's camp", "Kim can't join while her fire holds her claim", said(got));
await S.tool({ t: 'a.fire', id: 5, do: 'out' });
expect(!S.w.socOf('kim') && !placed(5).claim, 'putting her fire out ended Kim\'s camp');
got = await S.ask(kim, { t: 'socAnswer', yes: true });
expect(S.w.socOf('kim') && S.w.socOf('kim').name === 'Rivers' && /You joined Rivers/.test(said(got)), 'the same invite still works', said(got));
got = await S.ask(pat, { t: 'socInvite', id: 'lee' });
expect(/full/.test(said(got)) && !lee.got.some((m) => m.t === 'socInvite'), `a society is full at ${MAX}`, said(got));

console.log('D. away members feed it; the leader leaves; the last one out puts its fire out');
const samP = S.w.persons.get('sam');
samP.carry = { log: 1 };
S.w.burn(placed(1)); placed(1).fuel = 10 * HOUR; placed(1).at = Date.now();
const feed = S.w.fireToFeed(samP);
expect(feed && feed[0].id === 1 && feed[1] === 'log', 'Sam away would put a log on the society\'s fire', feed && `${feed[0].id} ${feed[1]}`);
got = await S.ask(pat, { t: 'socLeave' });
let soc = S.w.socById(1);
expect(!(meOf(got) || {}).soc && soc && soc.leader === 'sam' && placed(1).claim === 's:1' && placed(1).lit, 'Pat left: Sam (who joined first) leads, and the fire burns on as Rivers\'', `${soc && soc.leader} ${placed(1).claim}`);
expect(sam.got.some((m) => m.t === 'socNote' && /Sam leads it now/.test(m.text)), 'members are told who leads now');
took = await take(pat, 11);
expect(took && took.ok === false, 'Pat can\'t use the claim any more', took && took.why);
await S.ask(sam, { t: 'socRemove', id: 'kim' });
expect(!S.w.socOf('kim') && kim.got.some((m) => m.t === 'socNote' && /no longer in Rivers/.test(m.text)) && (tagFor(lee, 'sam') || {}).soc === null, 'the leader took Kim out; with one left, Sam\'s name tag loses the line');
got = await S.ask(sam, { t: 'socLeave' });
expect(!S.w.socById(1) && !placed(1).lit && !placed(1).claim && /ended/.test(said(got)), 'Sam was the last one: Rivers ended and its fire went out', `${placed(1).lit} ${said(got)}`);

console.log('E. a fire that burns out ends its society; no person in the world for 3 days and you leave');
await S.ask(pat, { t: 'fire', id: 1, do: 'light' });
soc = S.w.socOf('pat');
expect(soc && soc.name === "Pat's camp", 'Pat lit fire 1 again: a new society, Pat\'s camp');
await S.ask(pat, { t: 'socInvite', id: 'kim' }); await S.ask(kim, { t: 'socAnswer', yes: true });
const kimP = S.w.persons.get('kim');
kimP.state = 'dead'; kimP.diedAt = Date.now() - HOUR;
await S.w.socGone(kimP);
expect(S.w.socOf('kim') === soc, 'dead for an hour: still in it (they can start again)');
kimP.diedAt = Date.now() - 4 * 24 * HOUR;
await S.w.socGone(kimP);
expect(!S.w.socOf('kim') && soc.members.length === 1, 'not back for 3 days: out of it');
Object.assign(kimP, { state: 'alive', diedAt: 0 });
await wait(3500); // (the spam limits: a few invites and answers in a row, then one every few seconds)
await S.ask(pat, { t: 'socInvite', id: 'kim' }); await S.ask(kim, { t: 'socAnswer', yes: true });
expect(S.w.socOf('kim') === soc, 'Kim joined again');
placed(1).fuel = 1000; placed(1).at = Date.now() - 5000; // its fuel ran out a few seconds ago
S.w.claims(); // (what the tick does)
expect(!S.w.socById(soc.id) && !S.w.socOf('pat') && kim.got.some((m) => m.t === 'socNote' && /fire went out/.test(m.text)), 'its fire burnt out: the society ended, and members are told');

console.log('F. the admin: list, rename, take out, end a claim, end a society; players can\'t');
placed(1).fuel = 5 * HOUR;
await S.ask(pat, { t: 'fire', id: 1, do: 'light' });
soc = S.w.socOf('pat');
await wait(3500);
await S.ask(pat, { t: 'socInvite', id: 'kim' }); await S.ask(kim, { t: 'socAnswer', yes: true });
r = await S.tool({ t: 'a.socs' });
const row = (r.socs || []).find((x) => x.id === soc.id);
expect(row && row.leader === 'Pat' && row.members.map((x) => x.name).join() === 'Pat,Kim' && row.max === MAX && row.claim, 'the admin sees it, its leader, members and claim', JSON.stringify(row));
r = await S.tool({ t: 'a.socRename', id: soc.id, name: 'Hilltop' });
expect(soc.name === 'Hilltop' && /now Hilltop/.test(r.text) && (tagFor(lee, 'kim') || {}).soc === 'Hilltop', 'rename: everyone sees the new name', r.text);
await S.ask(kim, { t: 'a.socEnd', id: soc.id });
expect(S.w.socById(soc.id), 'a player sending an admin tool gets nothing');
r = await S.tool({ t: 'a.socRemove', id: soc.id, who: 'kim' });
expect(!S.w.socOf('kim') && /Kim is out of Hilltop/.test(r.text), 'the admin took Kim out', r.text);
r = await S.tool({ t: 'a.claim', id: 1, do: 'end' });
expect(!S.w.socById(soc.id) && placed(1).lit && !placed(1).claim, 'the admin ended its claim: the society ended, the fire burns on', r.text);
r = await S.tool({ t: 'a.claim', id: 1, do: 'give', to: 'pat' });
soc = S.w.socOf('pat');
expect(soc && placed(1).claim === `s:${soc.id}`, 'the admin gave the fire to Pat: a new society, Pat\'s', r.text);
r = await S.tool({ t: 'a.socEnd', id: soc.id });
expect(!S.w.socById(soc.id) && !placed(1).lit && !placed(1).claim && /fire is out/.test(r.text), 'the admin ended it: its fire went out', r.text);
const lines = S.w.activity.map((l) => l.text).join(' | ');
expect(/started Pat's camp/.test(lines) && /joined Rivers/.test(lines) && /End society/.test(lines), 'the Log has the society lines', lines.slice(0, 160));

console.log('G. starting up: a claim from before 0.1.5 becomes a society, one with no fire ends; storage; Reset everything');
await S.ask(lee, { t: 'fire', id: 1, do: 'light' }); // (Lee is near fire 1)
const leeSoc = S.w.socOf('lee');
expect(leeSoc && leeSoc.name === "Lee's camp", 'Lee lit fire 1: Lee\'s camp');
const w0 = store.get('world');
w0.placed.find((th) => th.id === 6).claim = 'sam'; // an old-style claim, as 0.1.4 kept them (fire 6 is lit)
store.set('world', w0);
store.set('societies', { next: 9, list: [...store.get('societies').list, { id: 8, name: 'No fire', leader: 'kim', members: [{ who: 'kim', name: 'Kim', at: 1 }], made: 1 }] });
S = await start(store);
const old = S.w.socOf('sam');
expect(old && old.name === "Sam's camp" && S.w.world.placed.find((th) => th.id === 6).claim === `s:${old.id}`, 'the old claim became Sam\'s camp', JSON.stringify(old));
expect(!S.w.socById(8) && S.w.socOf('lee') && S.w.socOf('lee').name === "Lee's camp", 'a society with no fire ended; Lee\'s camp is still there');
expect(store.get('societies').list.some((x) => x.name === "Sam's camp"), 'and it was saved');
await S.tool({ t: 'a.reset', all: true });
expect(!S.w.societies.list.length && !store.has('societies'), 'Reset everything ends every society');

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} of ${results.length} failed` : `\nall ${results.length} ok`);
process.exit(bad ? 1 : 0);
