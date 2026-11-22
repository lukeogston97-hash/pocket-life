// The real world server (server/src/index.js, bundled to build/server.mjs by lib.py) running on this computer at
// ws://127.0.0.1:8795/world, with storage kept in memory. Env: ADMIN_CODE (default secret123456),
// TESTKIT=1 gives every new person 2 sticks, 3 stones, 1 twine and a stone axe, COLLAPSE=1 starts them with no Rest.
import { WebSocketServer } from 'ws';
import { World } from './build/server.mjs';
const store = new Map(); const socks = [];
const ctx = {
  storage: {
    async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); } else store.set(k, structuredClone(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {}, async deleteAlarm() {},
  },
  getWebSockets() { return socks.filter((s) => !s.closed); },
  acceptWebSocket(ws) { socks.push(ws); },
  async blockConcurrencyWhile(f) { await f(); },
};
const w = new World(ctx, { ADMIN_CODE: process.env.ADMIN_CODE || 'secret123456' });
const wss = new WebSocketServer({ port: Number(process.env.PORT || 8795) });
wss.on('connection', (raw) => {
  const s = { att: {}, closed: false, send(t) { raw.send(t); }, close() { this.closed = true; raw.close(); },
    serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  ctx.acceptWebSocket(s);
  raw.on('message', async (d) => {
    const t = String(d), m = JSON.parse(t);
    if (m.t !== 'move' && m.t !== 'ping') console.log('<-', m.t);
    await w.webSocketMessage(s, t);
    if (m.t === 'create') {
      const p = w.persons.get(s.att.who);
      if (process.env.TESTKIT) p.carry = { stick: 2, stone: 3, twine: 1, 'stone-axe': 1 };
      if (process.env.COLLAPSE) p.stats.rest = 0;
      if (process.env.TESTKIT || process.env.COLLAPSE) s.send(JSON.stringify(w.mine(p)));
    }
  });
  raw.on('close', () => { s.closed = true; w.webSocketClose(s); });
});
setInterval(() => w.alarm(), 5000);
console.log('test server up');
