// The real world server (server/src/index.js, bundled to build/server.mjs by lib.py) running on this computer at
// ws://127.0.0.1:8795/world, with storage kept in memory. Env: ADMIN_CODE (default secret123456),
// FISHKIT=1 gives a fishing spear, a campfire and 6 sticks (a kit's tools start on the tool bar; KIT_IN_BAG=1 puts them in the inventory). TESTKIT=1 gives every new person 2 sticks, 3 stones, 1 twine and a stone axe, MINEKIT=1 a stone pickaxe, CAMPKIT=1 a log, 6 sticks, 2 twigs and 2 stones (a campfire's things, plus 6 sticks of fuel), CRAFTKIT=1 3 sticks, 4 stones and 2 twine (for the craft mat), COLLAPSE=1 starts them with no Rest.
import { WebSocketServer } from 'ws';
import { World } from './build/server.mjs';
const store = new Map(); const socks = [];
const env = { ADMIN_CODE: process.env.ADMIN_CODE || 'secret123456' };
// Point-in-time recovery, as on Cloudflare (it keeps 30 days of the world's storage; server/src/restore.js): every change
// to storage is a point in its history, a bookmark names one, and a restore happens when the world restarts (ctx.abort).
const history = [{ at: Date.now(), data: new Map() }]; // (stored values are copies that never change, so points can share them)
const remember = () => history.push({ at: Date.now(), data: new Map(store) });
const mark = (i) => `pitr-${String(i).padStart(8, '0')}`;
const undoMarks = new Map(); // an undo bookmark -> the point it stands for (the moment the restore happened)
let restoreTo = null, undoMark = null, ready = Promise.resolve();
const pointOf = (b) => (undoMarks.has(b) ? undoMarks.get(b) : /^pitr-\d+$/.test(b) ? Number(b.slice(5)) : -1);
const ctx = {
  storage: {
    async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); } else store.set(k, structuredClone(v)); remember(); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); remember(); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); },
    async getAlarm() { return 1; }, async setAlarm() {}, async deleteAlarm() {},
    async getCurrentBookmark() { return mark(history.length - 1); },
    async getBookmarkForTime(t) { const at = new Date(t).getTime(); let i = 0; history.forEach((h, k) => { if (h.at <= at) i = k; }); return mark(i); },
    async onNextSessionRestoreBookmark(b) {
      const i = pointOf(String(b));
      if (!history[i]) throw new Error(`No such bookmark: ${b}`);
      restoreTo = i; undoMark = `pitr-undo-${undoMarks.size + 1}`; undoMarks.set(undoMark, -1);
      return undoMark;
    },
  },
  getWebSockets() { return socks.filter((s) => !s.closed); },
  acceptWebSocket(ws) { socks.push(ws); },
  async blockConcurrencyWhile(f) { ready = f(); await ready; },
  // The world restarts, as on Cloudflare: every connection drops (the games reconnect by themselves), a restore that was
  // asked for happens, and a fresh World loads what's in storage.
  abort(reason) {
    console.log('restart:', reason);
    inTurn(async () => {
      for (const s of socks) { s.gone = true; if (!s.closed) s.close(); }
      socks.length = 0;
      if (restoreTo != null) {
        undoMarks.set(undoMark, history.length - 1);
        store.clear();
        for (const [k, v] of history[restoreTo].data) store.set(k, v);
        remember();
        restoreTo = null;
      }
      w = new World(ctx, env);
      await ready;
    });
  },
};
let w = new World(ctx, env);
// One thing at a time, as on Cloudflare: a Durable Object finishes one message (its storage calls hold the next one back)
// before the next is handled, so the checks see the same order of events the real server gives.
let line = Promise.resolve();
const inTurn = (f) => { line = line.then(f).catch((err) => console.error(err)); return line; };
const wss = new WebSocketServer({ port: Number(process.env.PORT || 8795) });
wss.on('connection', (raw) => {
  const s = { att: {}, closed: false, send(t) { raw.send(t); }, close() { this.closed = true; raw.close(); },
    serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } };
  ctx.acceptWebSocket(s);
  raw.on('message', (d) => inTurn(async () => {
    if (s.gone) return; // (from before a restart)
    const t = String(d), m = JSON.parse(t);
    if (m.t !== 'move' && m.t !== 'ping') console.log('<-', m.t);
    if (m.t === '__keys') { s.send(JSON.stringify({ t: '__keys', keys: [...store.keys()], value: m.get ? store.get(m.get) : null })); return; } // for checks: what's in storage
    await w.webSocketMessage(s, t);
    if (m.t === 'create') {
      const p = w.persons.get(s.att.who);
      if (process.env.TESTKIT) p.carry = { stick: 2, stone: 3, twine: 1, 'stone-axe': 1 };
      if (process.env.MINEKIT) p.carry = { 'stone-pickaxe': 1 };
      if (process.env.CAMPKIT) p.carry = { log: 1, stick: 6, twig: 2, stone: 2 };
      if (process.env.FISHKIT) p.carry = { 'fishing-spear': 1, campfire: 1, stick: 6 };
      if (process.env.CRAFTKIT) p.carry = { stick: 3, stone: 4, twine: 2 };
      if (process.env.KIT) p.carry = JSON.parse(process.env.KIT); // any kit: KIT='{"campfire":1,"stick":3}'
      if (process.env.COLLAPSE) p.stats.rest = 0;
      if (process.env.KIT_IN_BAG) p.bar = {}; else delete p.bar; // a kit's tools go on the tool bar (0.1.17), as for someone from before it; KIT_IN_BAG=1 keeps them in the inventory
      if (process.env.TESTKIT || process.env.MINEKIT || process.env.CAMPKIT || process.env.FISHKIT || process.env.CRAFTKIT || process.env.KIT || process.env.COLLAPSE) s.send(JSON.stringify(w.mine(p)));
    }
  }));
  raw.on('close', () => { s.closed = true; if (!s.gone) inTurn(() => w.webSocketClose(s)); });
});
setInterval(() => inTurn(() => w.alarm()), 5000);
console.log('test server up');
