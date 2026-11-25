// Play on other devices with a link code (0.1.12: server/src/accounts.js), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node accounts.mjs   (exit 0: all as it should be)
// Luke, 25 Nov 2026: codes, not Google sign-in; a second device's guest person is removed after a warning.
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
const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
// each message on a fresh connection with the same attachment, so the spam limits (per connection) don't get in the way
const ask = async (s, m) => {
  const f = { att: structuredClone(s.att), got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  socks.splice(socks.indexOf(s), 1, f);
  await w.webSocketMessage(f, JSON.stringify(m)); await tick();
  socks.splice(socks.indexOf(f), 1, s);
  s.att = f.att; s.got.push(...f.got); return f.got;
};
const last = (got, t) => got.filter((m) => m.t === t).pop();
const person = (who, name) => ({ who, state: 'alive', name, look: {}, age: 30, born: Date.now(), x: 0, z: 0, ry: 0, stats: { health: 100, rest: 80, hunger: 50, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: { stick: 1 }, log: {} });
const tag = (pid) => w.whoFor({ pid });
const A = await tag('phone-a'), B = await tag('phone-b'), C = await tag('phone-c');
w.persons.set(A, person(A, 'Ann')); w.persons.set(B, person(B, 'Bob'));
store.set(`p:${B}`, w.persons.get(B));
const sa = sock({ id: 'w:a', who: null, self: A, watch: true, admin: false, from: 'a' });
const sb = sock({ id: B, who: B, self: B, watch: false, admin: false, alive: true, from: 'b' });
const sc = sock({ id: 'w:c', who: null, self: C, watch: true, admin: false, from: 'c' });
const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
const code = async (s, pid) => (last(await ask(s, { t: 'linkCode', pid }), 'linkCode') || {}).code;

console.log('A. getting a code');
expect(last(await ask(sc, { t: 'linkCode', pid: 'phone-c' }), 'linkNo'), 'a device with no person gets no code');
let k = await code(sa, 'phone-a');
expect(/^[A-HJ-NP-Z2-9]{6}$/.test(k || ''), 'the device with a person gets a 6-letter code with no look-alike letters', k);
const k2 = await code(sa, 'phone-a');
expect(k2 && k2 !== k && !w.codes.has(k), 'getting another code replaces the last one');
k = k2;

console.log('B. a second device with its own guest person');
expect(last(await ask(sb, { t: 'linkUse', pid: 'phone-b', code: 'ZZZZZZ' }), 'linkNo'), 'a wrong code is refused');
let got = await ask(sb, { t: 'linkUse', pid: 'phone-b', code: k.toLowerCase() });
const q = last(got, 'linkAsk');
expect(q && q.mine === 'Bob' && q.theirs === 'Ann', 'it asks first, naming both people (typed in small letters works too)', JSON.stringify(q));
expect(w.persons.has(B) && await tag('phone-b') === B, 'nothing changed yet');
got = await ask(sb, { t: 'linkUse', pid: 'phone-b', code: k, sure: true });
expect(last(got, 'linked'), 'sure: linked');
expect(!w.persons.has(B) && !store.has(`p:${B}`), 'the guest person Bob is removed');
expect(await tag('phone-b') === A && await tag('phone-a') === A, 'phone B now plays Ann, and phone A still does');
expect(JSON.stringify(w.activity).includes('guest person was removed') && !JSON.stringify(w.activity).includes('left the world for good'), 'the Log says a guest person was removed (not that someone left)');
expect(last(await ask(sc, { t: 'linkUse', pid: 'phone-c', code: k }), 'linkNo'), 'a code works only once');

console.log('C. a device with no person, unlinking');
k = await code(sb, 'phone-b');
expect(!!k, 'a linked device can get a code too');
got = await ask(sc, { t: 'linkUse', pid: 'phone-c', code: k });
expect(last(got, 'linked') && await tag('phone-c') === A, 'a device with no person links straight away');
w.codes.set('OLDONE', { who: A, until: Date.now() - 1 });
expect(last(await ask(sb, { t: 'linkUse', pid: 'phone-b', code: 'OLDONE' }), 'linkNo'), 'a code past its 10 minutes is refused');
got = await ask(sc, { t: 'unlink', pid: 'phone-c' });
expect(last(got, 'unlinked') && await tag('phone-c') === C, 'unlinking: phone C is its own guest again');
expect(w.persons.get(A).name === 'Ann', 'and Ann is still there');

console.log('D. guessing');
const sg = sock({ id: 'w:g', who: null, self: 'g', watch: true, admin: false, from: 'guesser' });
for (let i = 0; i < 10; i++) await ask(sg, { t: 'linkUse', pid: 'phone-g', code: `AAAA${i}A` });
k = await code(sa, 'phone-a');
const tooMany = last(await ask(sg, { t: 'linkUse', pid: 'phone-g', code: k }), 'linkNo');
expect(tooMany && /Too many/.test(tooMany.text), 'after 10 wrong codes from one address, even a right one waits an hour');

console.log('E. the admin');
await ask(admin, { t: 'a.player', id: A });
let page = last(admin.got, 'adminPlayer');
expect(page && page.linked === 1, "Ann's page says she's linked to 1 other device", page && page.linked);
w.admin.banned.push(A);
expect(w.admin.banned.includes(await tag('phone-b')), 'a ban on Ann covers every device linked to her');
w.admin.banned = [];
await ask(admin, { t: 'a.unlinkAll', id: A });
expect(!Object.keys(w.accounts.links).length && !Object.keys(w.accounts.accts).length, 'Unlink all devices unlinks every device');
expect(await tag('phone-a') === A && await tag('phone-b') === B, 'Ann stays with the device she started on; phone B is a guest');

console.log('F. leaving the world for good takes the links too');
k = await code(sa, 'phone-a');
await ask(sc, { t: 'linkUse', pid: 'phone-c', code: k });
await ask(sa, { t: 'forget', pid: 'phone-a' });
expect(!w.persons.has(A) && !Object.keys(w.accounts.accts).length && !Object.keys(w.accounts.links).length, 'Ann and every link to her are gone');
expect(await tag('phone-c') === C, 'phone C is a guest again');

const bad = results.filter((r) => !r).length;
console.log(bad ? `${bad} of ${results.length} FAILED` : `All ${results.length} passed`);
process.exit(bad ? 1 : 0);
