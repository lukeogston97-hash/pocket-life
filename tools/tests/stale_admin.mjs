// A connection that was a playing admin before the update (its saved attachment still says admin: true):
// does the server still give it admin powers? Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node stale_admin.mjs   (exit 0: no admin powers).
import { World } from './build/server.mjs';
const store = new Map(), socks = [];
const ctx = { storage: {
    async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {} },
  getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); },
  async blockConcurrencyWhile(f) { await f(); } };
const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
await new Promise((r) => setTimeout(r, 50));
// a world with one stick far away, and a person standing at the start
w.world = { format: 1, nextId: 2, items: [{ id: 1, kind: 'stick', x: 40, z: 40, rot: 0 }], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 0, placed: [] };
w.persons.set('abc', { who: 'abc', state: 'alive', name: 'Old', look: {}, born: Date.now(), x: 0.6, z: 1.9, ry: 0, stats: { health: 100, rest: 80, hunger: 75, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: {}, log: {} });
const stale = sock({ id: 'abc', who: 'abc', watch: false, admin: true, alive: true, from: 'x', v: '0.1.2', b: 3, e: 1, link: 'release' });
const watcher = sock({ id: 'w:1', who: null, watch: true, admin: false, from: 'y' });
const before = structuredClone(stale.att);
await w.webSocketMessage(stale, JSON.stringify({ t: 'take', id: 1 }));          // reach: only an admin could take a stick 55 m away
await w.webSocketMessage(stale, JSON.stringify({ t: 'a.announce', text: 'x' })); // an admin tool
const out = { flagBefore: before.admin, flagAfter: stale.att.admin, stickStillThere: w.world.items.some((it) => it.id === 1), carried: w.persons.get('abc').carry,
  took: stale.got.filter((m) => m.t === 'took'), adminReplies: stale.got.filter((m) => m.t.startsWith('admin')).length, announceHeardByOthers: watcher.got.filter((m) => m.t === 'announce').length };
console.log(JSON.stringify(out));
process.exit(out.flagAfter === false && out.stickStillThere && !Object.keys(out.carried).length && out.adminReplies === 0 && out.announceHeardByOthers === 0 ? 0 : 1);
