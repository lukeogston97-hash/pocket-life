// Google sign-in (0.1.12: server/src/accounts.js), tried against the server's own code with no browser. Google's keys are
// swapped for a key made here, so the notes it signs stand in for Google's.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node accounts.mjs   (exit 0: all as it should be)
// Luke, 25 Nov 2026: optional; start as a guest, sign in later, then sign in on other devices to play the same person; a
// second device's guest person is removed after a warning; only the account's number is kept (scrambled).
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
const CID = 'test-client.apps.googleusercontent.com';
w.googleClient = () => CID;
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', use: 'sig' };
w.googleKeys = async () => [jwk];
const b64u = (b) => Buffer.from(b).toString('base64url');
async function note(sub, more = {}, key = pair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })), p = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: CID, sub, iat: now, exp: now + 3600, email: 'x@y.z', ...more }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
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

console.log('A. notes that must be refused');
for (const [what, tok] of [['nonsense', 'abc'], ['for another app', await note('111', { aud: 'someone-else' })], ['run out', await note('111', { exp: Math.floor(Date.now() / 1000) - 600 })],
  ['not from Google', await note('111', { iss: 'https://evil.example' })], ['signed with another key', await note('111', {}, other.privateKey)]]) {
  const got = await ask(sa, { t: 'signIn', pid: 'phone-a', token: tok });
  expect(last(got, 'signInNo') && !last(got, 'signedIn'), `a note that's ${what} is refused`);
}
expect(!Object.keys(w.accounts.links).length, 'nothing was linked');
const realOff = w.googleClient; w.googleClient = () => '';
expect(last(await ask(sa, { t: 'signIn', pid: 'phone-a', token: await note('111') }), 'signInNo'), 'with no client ID set, sign-in is refused');
w.googleClient = realOff;

console.log('B. the first device keeps its person');
let got = await ask(sa, { t: 'signIn', pid: 'phone-a', token: await note('111') });
expect(last(got, 'signedIn'), 'signing in from the main menu works');
expect(await tag('phone-a') === A && w.persons.get(A).name === 'Ann', 'phone A still plays Ann');
const saved = JSON.stringify(store.get('accounts'));
expect(saved && !saved.includes('111') && !saved.includes('x@y.z'), "storage has no account number or email in plain form", saved);

console.log('C. a second device with its own guest person');
got = await ask(sb, { t: 'signIn', pid: 'phone-b', token: await note('111') });
const q = last(got, 'signInAsk');
expect(q && q.mine === 'Bob' && q.theirs === 'Ann', 'it asks first, naming both people', JSON.stringify(q));
expect(w.persons.has(B) && await tag('phone-b') === B, 'nothing changed yet');
got = await ask(sb, { t: 'signIn', pid: 'phone-b', token: await note('111'), sure: true });
expect(last(got, 'signedIn'), 'sure: signed in');
expect(!w.persons.has(B) && !store.has(`p:${B}`), "the guest person Bob is removed");
expect(await tag('phone-b') === A, 'phone B now plays Ann');
expect(JSON.stringify(w.activity).includes('guest person was removed') && !JSON.stringify(w.activity).includes('left the world for good'), 'the Log says a guest person was removed (not that someone left)');

console.log('D. a device with no person, another account, signing out');
got = await ask(sc, { t: 'signIn', pid: 'phone-c', token: await note('111') });
expect(last(got, 'signedIn') && await tag('phone-c') === A, 'a device with no person signs straight in');
expect(last(await ask(sc, { t: 'signIn', pid: 'phone-c', token: await note('222') }), 'signInNo'), 'signing in with another account means signing out first');
got = await ask(sc, { t: 'signOut', pid: 'phone-c' });
expect(last(got, 'signedOut') && await tag('phone-c') === C, 'signing out: phone C is its own guest again');
expect(w.persons.get(A).name === 'Ann', 'and Ann is still there');

console.log('E. the admin');
await ask(admin, { t: 'a.player', id: A });
let page = last(admin.got, 'adminPlayer');
expect(page && page.google === 2, "Ann's page says she's signed in on 2 devices", page && page.google);
w.admin.banned.push(A);
expect((await tag('phone-b')) === A && w.admin.banned.includes(await tag('phone-b')), 'a ban on Ann covers every device signed in as her');
w.admin.banned = [];
await ask(admin, { t: 'a.signOutAll', id: A });
expect(!Object.keys(w.accounts.links).length && !Object.keys(w.accounts.accts).length, 'Sign out everywhere unlinks every device');
expect(await tag('phone-a') === A && await tag('phone-b') === B, "Ann stays with the phone she started on; phone B is a guest");

console.log('F. leaving the world for good takes the sign-in too');
await ask(sa, { t: 'signIn', pid: 'phone-a', token: await note('111') });
await ask(sc, { t: 'signIn', pid: 'phone-c', token: await note('111') });
await ask(sa, { t: 'forget', pid: 'phone-a' });
expect(!w.persons.has(A) && !Object.keys(w.accounts.accts).length && !Object.keys(w.accounts.links).length, 'Ann, her account and every device linked to it are gone');
got = await ask(sa, { t: 'signIn', pid: 'phone-a', token: await note('111') });
expect(last(got, 'signedIn') && w.accounts.accts[Object.keys(w.accounts.accts)[0]] === A, 'signing in again later is a fresh start');

const bad = results.filter((r) => !r).length;
console.log(bad ? `${bad} of ${results.length} FAILED` : `All ${results.length} passed`);
process.exit(bad ? 1 : 0);
