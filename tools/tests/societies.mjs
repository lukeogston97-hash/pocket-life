// Societies (0.1.4, server/src/societies.js), tested straight against the server's World with no browser and no timing:
// starting one, its one claim, invites, joining (after putting out your own claim's fire), leaving, leaders, being gone,
// and the admin's tools. Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node societies.mjs (exit 0: all ok)
// Wherever it can, the proof comes from what the rules then let a player do (picking something up inside a claim), what
// each game is sent, or what is in storage, not from a tool's own answer.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000, MAX = DATA.societies.maxMembers;
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
  const tool = async (m) => { const got = await ask(admin, m); const a = got.filter((x) => x.t === 'admin').pop(); return { text: a ? a.text : null, socs: (got.filter((x) => x.t === 'adminSocs').pop() || {}).list }; };
  return { w, sock, playing, ask, admin, tool };
}

const store = new Map();
let S = await start(store);
// fire 1 for Pat, fire 2 near it (inside its claim), fire 5 for Kim far away, fire 6 for Sam (clear of everything)
S.w.world = { format: 1, nextId: 50, items: [{ id: 10, kind: 'stick', x: 31, z: 31, rot: 0 }, { id: 11, kind: 'stick', x: 31.2, z: 31, rot: 0 }, { id: 12, kind: 'stick', x: 31.4, z: 31, rot: 0 }, { id: 13, kind: 'stick', x: 31.6, z: 31, rot: 0 }],
  bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0,
  placed: [fire(1, 30, 30), fire(2, 33, 33), fire(5, -30, -30), fire(6, -35, 30)] };
for (const [who, name, x, z] of [['pat', 'Pat', 30, 31], ['sam', 'Sam', 30.6, 30.6], ['kim', 'Kim', 31, 30], ['lee', 'Lee', 31.5, 30.5]]) S.w.persons.set(who, person(who, name, x, z));
const pat = S.playing('pat'), sam = S.playing('sam'), kim = S.playing('kim'), lee = S.playing('lee');
const placed = (id) => S.w.world.placed.find((th) => th.id === id);
const take = async (s, id) => (await S.ask(s, { t: 'take', id })).find((m) => m.t === 'took');
const said = (got) => got.filter((m) => m.t === 'socNo' || m.t === 'socNote' || m.t === 'claimNote').map((m) => m.why || m.text).join(' | ');
const meOf = (got) => got.filter((m) => m.t === 'me').pop();
const tagFor = (s, who) => s.got.filter((m) => m.t === 'socTag' && m.id === who).pop();

console.log('A. starting a society: your claim becomes the society\'s');
await S.ask(pat, { t: 'fire', id: 1, do: 'light' });
expect(placed(1).claim === 'pat', 'Pat lit fire 1 and it is their own claim');
let got = await S.ask(pat, { t: 'socStart', name: '  Rivers  ' });
let me = meOf(got);
expect(me && me.soc && me.soc.name === 'Rivers' && me.soc.lead && me.soc.members.length === 1 && me.soc.max === MAX, 'Pat started Rivers and leads it', JSON.stringify(me && me.soc));
expect(placed(1).claim === 's:1', 'Pat\'s claim is now the society\'s', placed(1).claim);
expect((tagFor(sam, 'pat') || {}).soc === 'Rivers', 'everyone is told, for the line under Pat\'s name tag');
expect(S.w.people(null).find((p) => p.id === 'pat').soc === 'Rivers', 'and people who join later see it too');
const seen = sam.got.filter((m) => m.t === 'placed' && m.thing.id === 1).pop();
expect(seen && seen.thing.claim && seen.thing.claim.name === 'Rivers' && seen.thing.claim.who === 's:1', 'Sam\'s game sees the fire is Rivers\' claim');
got = await S.ask(sam, { t: 'socStart', name: 'rivers' });
expect(/taken/.test(said(got)), 'no two societies can share a name', said(got));
got = await S.ask(sam, { t: 'socStart', name: ' ' });
expect(/Type a name/.test(said(got)), 'a society needs a name', said(got));
let took = await take(sam, 10);
expect(took && took.ok === false && /Rivers' claim|Rivers's claim/.test(took.why || ''), 'Sam can\'t pick up a stick inside Rivers\' claim', took && took.why);

console.log('B. invites: the leader invites someone nearby, they join, and can use the claim');
got = await S.ask(sam, { t: 'socInvite', id: 'kim' });
expect(/not in a society/.test(said(got)), 'only someone in a society can invite', said(got));
got = await S.ask(pat, { t: 'socInvite', id: 'sam' });
const inv = sam.got.filter((m) => m.t === 'socInvite').pop();
expect(/Invite sent to Sam/.test(said(got)) && inv && inv.soc === 'Rivers' && inv.by === 'Pat', 'Pat invited Sam, and Sam\'s game shows it', JSON.stringify(inv));
got = await S.ask(sam, { t: 'socAnswer', yes: true });
me = meOf(got);
expect(me && me.soc && me.soc.name === 'Rivers' && !me.soc.lead && me.soc.members.map((x) => x.name).join() === 'Pat,Sam', 'Sam joined Rivers (Pat leads, listed first)', JSON.stringify(me && me.soc && me.soc.members));
expect((tagFor(kim, 'sam') || {}).soc === 'Rivers', 'everyone sees Rivers under Sam\'s name');
expect(pat.got.some((m) => m.t === 'socNote' && /Sam joined Rivers/.test(m.text)), 'Pat is told Sam joined');
took = await take(sam, 10);
expect(took && took.ok !== false && !S.w.world.items.some((it) => it.id === 10), 'now Sam can pick up a stick inside Rivers\' claim', JSON.stringify(took));
got = await S.ask(sam, { t: 'socAnswer', yes: true });
expect(/run out|already/.test(said(got)), 'an invite only works once', said(got));
Object.assign(S.w.persons.get('sam'), { x: -34, z: 31 }); // (over at fire 6, clear of every claim)
got = await S.ask(sam, { t: 'fire', id: 6, do: 'light' });
expect(placed(6).lit && !placed(6).claim && /Only Rivers/.test(said(got)), 'Sam\'s own fire is just a fire: only the leader\'s fire claims', said(got));
Object.assign(S.w.persons.get('sam'), { x: 30.6, z: 30.6 });
got = await S.ask(sam, { t: 'socInvite', id: 'lee' });
expect(/Only the leader/.test(said(got)), 'only the leader invites', said(got));
const fuelBefore = S.w.burn(placed(1)).fuel;
S.w.persons.get('sam').carry = { stick: 2 };
await S.ask(sam, { t: 'fire', id: 1, do: 'add', n: 1, fuel: 'stick' });
expect(S.w.burn(placed(1)).fuel > fuelBefore + 60000, 'Sam can feed the society\'s fire', `${Math.round(fuelBefore / 60000)} -> ${Math.round(S.w.burn(placed(1)).fuel / 60000)} min`);

console.log('C. joining with a claim of your own: put the fire out first');
await S.ask(kim, { t: 'fire', id: 5, do: 'light' }); // (Kim is far from fire 5: the server may refuse; then the admin lights it and gives it to Kim)
if (placed(5).claim !== 'kim') { await S.tool({ t: 'a.fire', id: 5, do: 'light' }); await S.tool({ t: 'a.claim', id: 5, do: 'give', to: 'kim' }); }
expect(placed(5).claim === 'kim', 'Kim has her own claim (fire 5)');
await S.ask(pat, { t: 'socInvite', id: 'kim' });
got = await S.ask(kim, { t: 'socAnswer', yes: true });
expect(/Put your fire out first/.test(said(got)) && !S.w.socOf('kim'), 'Kim can\'t join while her fire holds her claim', said(got));
await S.tool({ t: 'a.fire', id: 5, do: 'out' });
got = await S.ask(kim, { t: 'socAnswer', yes: true });
expect(S.w.socOf('kim') && /You joined Rivers/.test(said(got)), 'once it\'s out, the same invite still works', said(got));
expect(S.w.socOf('kim').members.length === MAX, `Rivers has ${MAX} people`);
got = await S.ask(pat, { t: 'socInvite', id: 'lee' });
expect(/full/.test(said(got)) && !lee.got.some((m) => m.t === 'socInvite'), `a society is full at ${MAX}`, said(got));

console.log('D. away members feed the society\'s fire; leaving; a new leader; the last one out keeps the claim');
const samP = S.w.persons.get('sam');
samP.carry = { log: 1 };
S.w.burn(placed(1)); placed(1).fuel = 10 * HOUR; placed(1).at = Date.now();
const feed = S.w.fireToFeed(samP);
expect(feed && feed[0].id === 1 && feed[1] === 'log', 'Sam away would walk over and put a log on the society\'s fire', feed && `${feed[0].id} ${feed[1]}`);
got = await S.ask(pat, { t: 'socLeave' });
me = meOf(got);
let soc = S.w.socById(1);
expect(me && !me.soc && soc && soc.leader === 'sam' && placed(1).claim === 's:1', 'Pat left: Sam (who joined first) leads, and the claim stays Rivers\'', `${soc && soc.leader} ${placed(1).claim}`);
expect(sam.got.some((m) => m.t === 'socNote' && /Sam leads it now/.test(m.text)), 'members are told who leads now', said(sam.got.slice(-6)));
expect((tagFor(lee, 'pat') || {}).soc === null, 'Pat\'s name tag loses the line');
took = await take(pat, 11);
expect(took && took.ok === false, 'Pat can\'t use Rivers\' claim any more', took && took.why);
got = await S.ask(sam, { t: 'socRemove', id: 'kim' });
expect(!S.w.socOf('kim') && kim.got.some((m) => m.t === 'socNote' && /no longer in Rivers/.test(m.text)), 'the leader took Kim out, and Kim is told', said(got));
got = await S.ask(sam, { t: 'socLeave' });
expect(!S.w.socById(1) && placed(1).claim === 'sam' && /ended/.test(said(got)), 'Sam was the last one: Rivers ended and its claim is Sam\'s own', `${placed(1).claim} ${said(got)}`);

console.log('E. no person in the world for too long: out of the society');
await S.ask(sam, { t: 'fire', id: 1, do: 'out' });
await S.ask(pat, { t: 'socStart', name: 'Hill' });
await S.ask(pat, { t: 'socInvite', id: 'kim' });
await S.ask(kim, { t: 'socAnswer', yes: true });
soc = S.w.socOf('pat');
expect(soc && soc.name === 'Hill' && soc.members.length === 2, 'Pat started Hill and Kim joined');
const kimP = S.w.persons.get('kim');
kimP.state = 'dead'; kimP.diedAt = Date.now() - HOUR;
await S.w.socGone(kimP);
expect(S.w.socOf('kim') === soc, 'dead for an hour: still in it (they can start again)');
kimP.diedAt = Date.now() - 4 * 24 * HOUR;
await S.w.socGone(kimP);
expect(!S.w.socOf('kim') && soc.members.length === 1, 'not back for 3 days: out of it');
Object.assign(kimP, { state: 'alive', diedAt: 0 });

console.log('F. the admin: list, rename, take out, give a claim, end; players can\'t');
await new Promise((r) => setTimeout(r, 3500)); // (the spam limits: a few invites and answers in a row, then one every few seconds)
await S.ask(pat, { t: 'socInvite', id: 'kim' });
await S.ask(kim, { t: 'socAnswer', yes: true });
let r = await S.tool({ t: 'a.socs' });
const hill = (r.socs || []).find((x) => x.name === 'Hill');
expect(hill && hill.leader === 'Pat' && hill.members.map((x) => x.name).join() === 'Pat,Kim' && hill.max === MAX, 'the admin sees Hill, its leader and members', JSON.stringify(hill));
r = await S.tool({ t: 'a.socRename', id: soc.id, name: 'Hilltop' });
expect(soc.name === 'Hilltop' && /now Hilltop/.test(r.text) && (tagFor(lee, 'kim') || {}).soc === 'Hilltop', 'rename: everyone sees the new name', r.text);
await S.ask(pat, { t: 'fire', id: 1, do: 'light' }); // (fire 1 is out now; Pat's fire claims for Hilltop)
if (placed(1).claim !== `s:${soc.id}`) { await S.tool({ t: 'a.fire', id: 1, do: 'light' }); await S.tool({ t: 'a.claim', id: 1, do: 'give', to: 'kim' }); }
expect(placed(1).claim === `s:${soc.id}`, 'a claim given to a member goes to their society', placed(1).claim);
r = await S.tool({ t: 'a.socs' });
expect(((r.socs || []).find((x) => x.id === soc.id) || {}).claim, 'the admin\'s list shows the society\'s claim');
await S.ask(kim, { t: 'a.socEnd', id: soc.id });
expect(S.w.socById(soc.id), 'a player sending an admin tool gets nothing');
r = await S.tool({ t: 'a.socRemove', id: soc.id, who: 'kim' });
expect(!S.w.socOf('kim') && /Kim is out of Hilltop/.test(r.text), 'the admin took Kim out', r.text);
r = await S.tool({ t: 'a.socEnd', id: soc.id });
expect(!S.w.socById(soc.id) && placed(1).claim === 'pat' && /ended/.test(r.text), 'the admin ended Hilltop: its claim is its leader\'s own', `${placed(1).claim} ${r.text}`);
const lines = S.w.activity.map((l) => l.text).join(' | ');
expect(/started Rivers/.test(lines) && /joined Rivers/.test(lines) && /End society/.test(lines), 'the Log has the society lines', lines.slice(0, 160));

console.log('G. kept in storage: a restart still knows every society');
await S.ask(lee, { t: 'socStart', name: 'Lakeside' });
S = await start(store);
expect(S.w.societies.list.some((x) => x.name === 'Lakeside' && x.leader === 'lee'), 'after a restart, Lakeside is still there');
await S.tool({ t: 'a.reset', all: true });
expect(!S.w.societies.list.length && !store.has('societies'), 'Reset everything ends every society');

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} of ${results.length} failed` : `\nall ${results.length} ok`);
process.exit(bad ? 1 : 0);
