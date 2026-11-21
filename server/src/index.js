// Pocket Life server (starter). Each world (test, live) is one Durable Object: it holds who's
// connected and passes their moves and speech bubbles to everyone else in that world.
import { DurableObject } from 'cloudflare:workers';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

export class World extends DurableObject {
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
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
  webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (err) { return; }
    const me = ws.deserializeAttachment() || {};
    if (m.t === 'hello') {
      Object.assign(me, { id: me.id || crypto.randomUUID().slice(0, 8), name: clean(m.name, 20), look: m.look && typeof m.look === 'object' ? m.look : {}, x: num(m.x), z: num(m.z), ry: num(m.ry), v: clean(m.v, 20) });
      ws.serializeAttachment(me);
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, people: this.people(me.id) }));
      this.send({ t: 'join', person: me }, me.id);
    } else if (!me.id) {
      return;
    } else if (m.t === 'move') {
      Object.assign(me, { x: num(m.x), z: num(m.z), ry: num(m.ry), doing: clean(m.doing, 24) });
      ws.serializeAttachment(me);
      this.send({ t: 'move', id: me.id, x: me.x, z: me.z, ry: me.ry, doing: me.doing }, me.id);
    } else if (m.t === 'say') {
      const text = clean(m.text, 80).trim();
      if (text) this.send({ t: 'say', id: me.id, text }, null);
    }
  }
  webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    if (me && me.id) this.send({ t: 'leave', id: me.id }, me.id);
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/world') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: CORS });
      const world = url.searchParams.get('world') === 'live' ? 'live' : 'test';
      return env.WORLD.get(env.WORLD.idFromName(world)).fetch(request);
    }
    return new Response('Pocket Life server is running', { headers: CORS });
  },
};
