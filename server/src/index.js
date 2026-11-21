// Pocket Life server. Each world (test, live) is one Durable Object. It holds the shared world
// (things lying on the ground, berry bushes), passes everyone's moves and speech bubbles on,
// and slowly tops up sticks and stones (a stick falls under a tree, a stone turns up by a boulder).
import { DurableObject } from 'cloudflare:workers';
import WORLDS from '../worlds.json'; // maintenance and minimum version for each world

const CORS = { 'Access-Control-Allow-Origin': '*' };
const WORLD_FORMAT = 1; // bump if the saved world's shape changes, and add an upgrade step in load()
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const kindOk = (k) => typeof k === 'string' && /^[a-z0-9-]{1,24}$/.test(k);
// '0.0.6' with build 5 is [0,0,6,5]; a minVersion of '0.0.6' only checks the first three
const parts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
function tooOld(v, b, min) {
  const have = parts(v), want = parts(min);
  have[3] = Number(b) || 0;
  for (let i = 0; i < want.length; i++) { const a = have[i] || 0; if (a !== want[i]) return a < want[i]; }
  return false;
}
const FEEDBACK_KEEP = 300;

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.world = null;
    ctx.blockConcurrencyWhile(async () => { this.world = (await ctx.storage.get('world')) || null; });
  }
  save() { return this.ctx.storage.put('world', this.world); }
  async fetch(request) {
    const url = new URL(request.url);
    const worldName = url.searchParams.get('world') === 'live' ? 'live' : 'test';
    if (url.pathname === '/feedback') { // feedback sent while offline
      let note = {};
      try { note = JSON.parse(await request.text()); } catch (err) { /* ignore */ }
      await this.addFeedback(note, worldName);
      return new Response('ok', { headers: CORS });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ world: worldName });
    return new Response(null, { status: 101, webSocket: client });
  }
  async addFeedback(note, worldName) {
    const text = clean(note.text, 1000).trim();
    if (!text) return;
    const list = (await this.ctx.storage.get('feedback')) || [];
    list.push({ at: new Date().toISOString(), world: worldName, name: clean(note.name, 20), v: clean(note.v, 30), device: clean(note.device, 200), x: num(note.x), z: num(note.z), text });
    await this.ctx.storage.put('feedback', list.slice(-FEEDBACK_KEEP));
  }
  // tell everyone how many are online
  sendCount(leaving) {
    const n = this.people(leaving).length;
    this.send({ t: 'count', n }, null);
  }
  people(except) {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()).filter((p) => p && p.id && p.id !== except);
  }
  send(msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const p = ws.deserializeAttachment();
      if (p && p.id && p.id !== except) { try { ws.send(text); } catch (err) { /* gone */ } }
    }
  }
  // the shared world as players see it
  view() {
    const w = this.world;
    return w ? { items: w.items, bushes: w.bushes } : null;
  }
  berriesOn(i) {
    const w = this.world, b = w.bushes[i] || [null, null];
    if (b[0] == null || !w.regrowMs) return w.holds;
    const every = w.regrowMs / w.holds;
    return Math.min(w.holds, b[0] + Math.floor((Date.now() - b[1]) / every));
  }
  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (err) { return; }
    const me = ws.deserializeAttachment() || {};
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    if (m.t === 'hello') {
      const rules = WORLDS[me.world || 'test'] || {};
      if (rules.maintenance) { reply({ t: 'maintenance', text: clean(rules.message, 200) }); ws.close(1000, 'maintenance'); return; }
      if (rules.minVersion && tooOld(m.v, m.b, rules.minVersion)) { reply({ t: 'update', min: rules.minVersion }); ws.close(1000, 'update'); return; }
      Object.assign(me, { id: me.id || crypto.randomUUID().slice(0, 8), name: clean(m.name, 20), look: m.look && typeof m.look === 'object' ? m.look : {}, x: num(m.x), z: num(m.z), ry: num(m.ry), v: clean(m.v, 20) });
      ws.serializeAttachment(me);
      reply({ t: 'welcome', id: me.id, people: this.people(me.id), world: this.view(), needSeed: !this.world, count: this.people().length });
      this.send({ t: 'join', person: me }, me.id);
      this.sendCount();
      return;
    }
    if (!me.id) return;
    if (m.t === 'feedback') { await this.addFeedback(m, me.world); reply({ t: 'thanks' }); return; }
    const w = this.world;
    if (m.t === 'move') {
      Object.assign(me, { x: num(m.x), z: num(m.z), ry: num(m.ry), doing: clean(m.doing, 24) });
      ws.serializeAttachment(me);
      this.send({ t: 'move', id: me.id, x: me.x, z: me.z, ry: me.ry, doing: me.doing }, me.id);
    } else if (m.t === 'say') {
      const text = clean(m.text, 80).trim();
      if (text) this.send({ t: 'say', id: me.id, text }, null);
    } else if (m.t === 'seed' && !w) {
      // the first player into a new world lays it out (everyone's game builds the same starting world)
      const items = (Array.isArray(m.items) ? m.items : []).slice(0, 3000).filter((it) => it && kindOk(it.kind));
      const spots = {};
      for (const [k, list] of Object.entries(m.spots || {})) if (kindOk(k) && Array.isArray(list)) spots[k] = list.slice(0, 500).map(([x, z]) => [num(x), num(z)]);
      const caps = {};
      for (const [k, n] of Object.entries(m.caps || {})) if (kindOk(k) && Number.isFinite(n)) caps[k] = Math.max(0, Math.min(2000, Math.floor(n)));
      this.world = {
        format: WORLD_FORMAT, nextId: 1, items: [], bushes: [], spots, caps,
        holds: Math.max(1, Math.min(15, Math.floor(m.holds) || 5)),
        regrowMs: Math.max(0, Number(m.regrowMs) || 0),
        respawnMs: Math.max(60000, Number(m.respawnMs) || 600000),
      };
      for (const it of items) this.world.items.push({ id: this.world.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) });
      await this.save();
      await this.ctx.storage.setAlarm(Date.now() + this.world.respawnMs);
      this.send({ t: 'world', world: this.view() }, null);
    } else if (!w) {
      return;
    } else if (m.t === 'take') {
      const i = w.items.findIndex((it) => it.id === m.id);
      if (i < 0) { reply({ t: 'took', id: m.id, ok: false }); return; }
      w.items.splice(i, 1);
      await this.save();
      reply({ t: 'took', id: m.id, ok: true });
      this.send({ t: 'gone', id: m.id }, me.id);
    } else if (m.t === 'drop') {
      const added = [];
      for (const it of (Array.isArray(m.items) ? m.items : []).slice(0, 60)) {
        if (!it || !kindOk(it.kind)) continue;
        const item = { id: w.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) };
        w.items.push(item);
        added.push(item);
      }
      if (!added.length) return;
      await this.save();
      this.send({ t: 'added', items: added }, null);
    } else if (m.t === 'pick') {
      const i = Math.floor(m.bush);
      if (!(i >= 0 && i < 200)) return;
      if (this.berriesOn(i) < 1) { reply({ t: 'picked', bush: i, ok: false }); return; }
      const b = w.bushes[i] || [null, null];
      const every = w.regrowMs / w.holds;
      let count = w.holds, from = Date.now();
      if (b[0] != null && w.regrowMs) {
        const grown = Math.floor((Date.now() - b[1]) / every);
        count = Math.min(w.holds, b[0] + grown);
        from = count >= w.holds ? Date.now() : b[1] + grown * every;
      }
      w.bushes[i] = [count - 1, from];
      await this.save();
      reply({ t: 'picked', bush: i, ok: true });
      this.send({ t: 'bush', bush: i, count: count - 1, growFrom: from }, null);
    }
  }
  // nature tops up: one of each kind that's below its normal amount, at a spot near a tree or boulder
  async alarm() {
    const w = this.world;
    if (!w) return;
    const added = [];
    for (const [kind, cap] of Object.entries(w.caps)) {
      const have = w.items.filter((it) => it.kind === kind).length;
      const spots = w.spots[kind] || [];
      if (have >= cap || !spots.length) continue;
      const [x, z] = spots[Math.floor(Math.random() * spots.length)];
      const item = { id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) };
      w.items.push(item);
      added.push(item);
    }
    if (added.length) { await this.save(); this.send({ t: 'added', items: added }, null); }
    await this.ctx.storage.setAlarm(Date.now() + w.respawnMs);
  }
  webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    if (me && me.id) { this.send({ t: 'leave', id: me.id }, me.id); this.sendCount(me.id); }
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/feedback' && request.method === 'POST') {
      const world = url.searchParams.get('world') === 'live' ? 'live' : 'test';
      return env.WORLD.get(env.WORLD.idFromName(world)).fetch(request);
    }
    if (url.pathname === '/world') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: CORS });
      const world = url.searchParams.get('world') === 'live' ? 'live' : 'test';
      return env.WORLD.get(env.WORLD.idFromName(world)).fetch(request);
    }
    return new Response('Pocket Life server is running', { headers: CORS });
  },
};
