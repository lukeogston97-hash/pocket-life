// A load test of the real server code, in memory, with time moved on by hand: how the world's tick, storage writes and
// message sizes grow with people and items. Run it with: python3 tools/tests/load.py <people away> <loose items>
import { readFile } from 'node:fs/promises';
import { World } from './build/server.mjs';
const AWAY = Number(process.argv[2] || 300), ITEMS = Number(process.argv[3] || 105);
let skew = 0; const realNow = Date.now.bind(Date); Date.now = () => realNow() + skew;
const store = new Map(), socks = [], writes = { n: 0, bytes: 0, byKey: {} };
const ctx = {
  storage: {
    async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { const all = typeof k === 'object' ? Object.entries(k) : [[k, v]]; for (const [a, b] of all) { store.set(a, structuredClone(b)); writes.n++; const kind = a.startsWith('p:') ? 'person' : a; writes.byKey[kind] = (writes.byKey[kind] || 0) + 1; writes.bytes += JSON.stringify(b).length; } },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {}, async deleteAlarm() {},
  },
  getWebSockets() { return socks.filter((s) => !s.closed); },
  acceptWebSocket(ws) { socks.push(ws); },
  async blockConcurrencyWhile(f) { await f(); },
};
const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
await new Promise((r) => setTimeout(r, 50));
function sock() {
  const s = { att: {}, closed: false, out: 0, outBytes: 0, got: [], send(t) { this.out++; this.outBytes += t.length; this.got.push(t); if (this.got.length > 50) this.got.shift(); }, close() { this.closed = true; },
    serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  ctx.acceptWebSocket(s);
  return s;
}
const say = (s, m) => w.webSocketMessage(s, JSON.stringify(m));
const last = (s, t) => { for (let i = s.got.length - 1; i >= 0; i--) { const m = JSON.parse(s.got[i]); if (m.t === t) return m; } return null; };
const rnd = (a, b) => a + Math.random() * (b - a), pt = () => [+rnd(-46, 46).toFixed(2), +rnd(-46, 46).toFixed(2)];
const DATA = JSON.parse(await readFile(new URL('../../test/game-data.json', import.meta.url)));
const hello = (s, pid, extra = {}) => say(s, { t: 'hello', proto: 2, watch: false, v: DATA.version, b: DATA.build, link: 'test', pid, ...extra });
const name = (i) => 'Bo' + [...String(i)].map((d) => 'abcdefghij'[d]).join('');
// the first player lays the world out
const first = sock(); await hello(first, 'first');
const spots = { stick: Array.from({ length: 400 }, pt), stone: Array.from({ length: 400 }, pt) };
const kinds = ['stick', 'stone'];
await say(first, { t: 'seed', items: Array.from({ length: ITEMS }, (_, i) => ({ kind: kinds[i % 2], x: pt()[0], z: pt()[1], rot: 1 })), spots, caps: { stick: 60, stone: 45 }, holds: 5, regrowMs: 4 * 3600000, respawnMs: 300000,
  layout: { bushes: Array.from({ length: 30 }, pt), shore: Array.from({ length: 48 }, (_, k) => [+(-5.6 + Math.cos(k) * 6).toFixed(2), +(-0.9 + Math.sin(k) * 5).toFixed(2)]), open: Array.from({ length: 600 }, pt),
    trees: Array.from({ length: 1133 }, pt), rocks: Array.from({ length: 66 }, pt), oldStumps: [], plants: { tallGrass: Array.from({ length: 40 }, pt) } } });
// the items the check asked for beyond what a new world starts with (the server only takes startInWorld of each): added by the admin
if (ITEMS > 105) { const a = sock(); await hello(a, 'adminbot', { adminCode: 'secret123456' }); await say(a, { t: 'create', name: 'Boss', age: 30, look: {} });
  for (let i = 0; i < ITEMS - 105; i += 50) await say(a, { t: 'a.add', kind: kinds[(i / 50) % 2], n: 50, x: pt()[0], z: pt()[1] }); a.closed = true; await w.webSocketClose(a); }
await say(first, { t: 'create', name: 'First', age: 30, look: {} });
// people who played and went away
let t0 = realNow();
for (let i = 0; i < AWAY; i++) { const s = sock(); await hello(s, `away${i}`); await say(s, { t: 'create', name: name(i), age: 25, look: {} }); s.closed = true; await w.webSocketClose(s); }
console.log(`made ${AWAY} people in ${realNow() - t0} ms; world items ${w.world.items.length}`);
// 19 more playing
const players = [first];
for (let i = 0; i < 19; i++) { const s = sock(); await hello(s, `on${i}`); await say(s, { t: 'create', name: name(1000 + i), age: 25, look: {} }); players.push(s); }
const wel = sock(); await hello(wel, 'late'); 
const welcome = wel.got.map((t) => JSON.parse(t)).find((m) => m.t === 'welcome');
console.log(`welcome message: ${(wel.got.find((t) => t.includes('"t":"welcome"')).length / 1024).toFixed(0)} KB (people ${welcome.people.length}, items ${welcome.world.items.length}); world in storage ${(JSON.stringify(store.get('world')).length / 1024).toFixed(0)} KB`);
// an hour of ticks (every 20 s), with everyone playing doing something each minute
writes.n = 0; writes.bytes = 0; writes.byKey = {};
for (const s of socks) { s.out = 0; s.outBytes = 0; }
let tickMs = 0, worst = 0, actMs = 0, acts = 0;
for (let tick = 0; tick < 180; tick++) {
  skew += 20000;
  let a = performance.now(); await w.alarm(); let d = performance.now() - a; tickMs += d; worst = Math.max(worst, d);
  if (process.env.ACT !== "0" && tick % 3 === 0) for (const s of players) { // once a minute: walk a little, pick something up nearby, put it down, say something
    const me = w.persons.get(s.att.who); if (!me || me.state !== 'alive') continue;
    a = performance.now();
    await say(s, { t: 'move', x: me.x + rnd(-2, 2), z: me.z + rnd(-2, 2), ry: 0 });
    const near = w.world.items.find((it) => Math.hypot(it.x - me.x, it.z - me.z) < 4);
    if (near) { await say(s, { t: 'take', id: near.id }); await say(s, { t: 'drop', items: [{ kind: near.kind, x: me.x, z: me.z, rot: 0 }] }); }
    await say(s, { t: 'say', text: 'hello there' });
    actMs += performance.now() - a; acts += near ? 4 : 2;
  }
}
const out = socks.reduce((n, s) => n + s.out, 0), outKB = socks.reduce((n, s) => n + s.outBytes, 0) / 1024;
console.log(`one hour: tick ${ (tickMs / 180).toFixed(1) } ms on average, ${worst.toFixed(0)} ms at worst; an action ${(actMs / Math.max(1, acts)).toFixed(2)} ms`);
console.log(`storage writes in the hour: ${writes.n} (${JSON.stringify(writes.byKey)}), ${(writes.bytes / 1024 / 1024).toFixed(1)} MB written; that's ${(writes.n * 24).toLocaleString()} a day against a free limit of 100,000`);
console.log(`messages sent out in the hour: ${out.toLocaleString()} (${(outKB / 1024).toFixed(1)} MB)`);
const states = {}; for (const p of w.persons.values()) { const k = p.state !== 'alive' ? p.state : p.asleep ? 'asleep' : 'alive'; states[k] = (states[k] || 0) + 1; }
console.log('people now:', JSON.stringify(states));
process.exit(0);
