// Leave the world for good (Settings, 0.1.11: server/src/persons.js forget), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node forget.mjs   (exit 0: all as it should be)
// Luke, 25 Nov 2026: things drop where they stand, everything about them goes (person, past people, feedback), a hold to
// confirm in the game. A ban stays, their camp follows the usual leaving rules, and the admin's Log has no name.
import { World } from './build/server.mjs';

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
const store = new Map(), socks = [];
const ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
await new Promise((r) => setTimeout(r, 30));
const tagOf = (pid) => w.whoFor({ pid }); const PID = 'phone-of-cam', CAM = await tagOf(PID), DEE = 'dee';
w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 3600000,
  placed: [{ id: 1, kind: 'campfire', x: 50, z: 50, rot: 0, built: true, fuel: 6 * 3600000, lit: true, at: Date.now(), by: CAM, claim: 's:1' }] };
const person = (who, name) => ({ who, state: 'alive', name, look: {}, age: 30, born: Date.now(), x: 50, z: 52, ry: 0, stats: { health: 100, rest: 80, hunger: 50, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: {}, log: {} });
const cam = person(CAM, 'Cam'); cam.carry = { log: 2, stone: 1 };
w.persons.set(CAM, cam); w.persons.set(DEE, person(DEE, 'Dee'));
w.societies = { next: 2, list: [{ id: 1, name: "Cam's camp", leader: CAM, members: [{ who: CAM, name: 'Cam', at: 1 }, { who: DEE, name: 'Dee', at: 2 }], made: 1 }] };
store.set(`p:${CAM}`, cam); store.set(`past:${CAM}`, [{ name: 'Old Cam' }]); store.set(`past:${DEE}`, [{ name: 'Old Dee' }]);
store.set('feedback', [{ who: CAM, text: 'from cam' }, { who: DEE, text: 'from dee' }, { text: 'from before' }]);
w.admin.banned = ['someone-else'];
const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
const me = sock({ id: CAM, who: CAM, self: CAM, watch: false, admin: false, alive: true, from: 'a', link: 'test' });
const other = sock({ id: DEE, who: DEE, self: DEE, watch: false, admin: false, alive: true, from: 'b', link: 'test' });

await w.webSocketMessage(me, JSON.stringify({ t: 'forget' })); await tick();
expect(w.persons.has(CAM), 'with no phone id sent, nothing happens');

await w.webSocketMessage(me, JSON.stringify({ t: 'forget', pid: PID })); await tick();
expect(me.got.some((m) => m.t === 'forgotten'), 'the game is told it went through');
expect(!w.persons.has(CAM) && !store.has(`p:${CAM}`), 'their person is gone, from the world and from storage');
expect(!store.has(`past:${CAM}`) && store.has(`past:${DEE}`), 'their past people are gone; someone else\'s stay');
const fb = store.get('feedback').map((x) => x.text);
expect(fb.join() === 'from dee,from before', 'their feedback is gone; everyone else\'s stays', fb.join());
const dropped = w.world.items.map((x) => x.kind).sort().join();
expect(dropped === 'log,log,stone', 'what they carried dropped where they stood', dropped);
const s = w.societies.list[0];
expect(s && s.leader === DEE && s.members.length === 1, 'they left their camp, and the member who joined first leads it now');
expect(w.world.placed[0].lit, 'the camp\'s fire still burns (someone is still in it)');
expect(other.got.some((m) => m.t === 'leave' && m.id === CAM), 'other players see them leave');
expect(w.admin.banned.join() === 'someone-else', 'the ban list isn\'t touched');
const log = JSON.stringify(w.activity || []);
expect(log.includes('Someone left the world for good') && !log.includes('"Cam '), 'the admin\'s Log says someone left, with no name (the camp keeps its own name)');
expect(!me.deserializeAttachment().who, 'that connection no longer plays a person');

// from the main menu (watching, no person), and the last one out of a camp
const solo = person(DEE, 'Dee');
await w.webSocketMessage(other, JSON.stringify({ t: 'forget', pid: 'not-dees-phone' })); await tick();
expect(w.persons.has(DEE), 'someone else\'s phone id can\'t remove you');
const deePid = 'phone-of-dee', DEE2 = await tagOf(deePid);
w.persons.set(DEE2, { ...solo, who: DEE2 }); w.societies.list[0].members = [{ who: DEE2, name: 'Dee', at: 2 }]; w.societies.list[0].leader = DEE2;
const watcher = sock({ id: 'w:9', who: null, self: DEE2, watch: true, admin: false, alive: false, from: 'c' });
await w.webSocketMessage(watcher, JSON.stringify({ t: 'forget', pid: deePid })); await tick();
expect(!w.persons.has(DEE2), 'it works from the main menu too');
expect(!w.societies.list.length && !w.world.placed[0].lit, 'the last one out ends the camp and its fire goes out');

const bad = results.filter((r) => !r).length;
console.log(bad ? `${bad} of ${results.length} FAILED` : `All ${results.length} passed`);
process.exit(bad ? 1 : 0);
