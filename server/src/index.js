// Pocket Life server: one Durable Object holds the whole world.
// - the shared world: things on the ground, trees, berry bushes, tall grass, graves (nature.js)
// - every person: needs, inventory and where they are, kept here so they stay in the world 24/7 (persons.js)
// - while a player is away their person looks after themselves; after a day away they lie down asleep (needs
//   pause), and after another day asleep they're gone (away.js)
// - at most G.maxPlaying people play at once; anyone else waits in line on the main menu (line.js)
// - things people place and build, like campfires (placed.js)
// - what players do, one small handler each (actions.js); chat, reports, feedback; the admin player's tools (admin.js)
// What every part shares (the game's rules from game.json, limits, helpers) is in shared.js.
import { DurableObject } from 'cloudflare:workers';
import { WORLDS, G, HOUR, PROTOCOL, CORS, clean, num, AWAY, tooOld, FEEDBACK_KEEP, lastHeard, QUIET_MS, TICK_MS, SAVE_EVERY, FREE, MAX_PLAYING, allowed, tagOf, ageOf } from './shared.js';
import { lineMethods } from './line.js';
import { personsMethods } from './persons.js';
import { awayMethods } from './away.js';
import { natureMethods } from './nature.js';
import { adminMethods } from './admin.js';
import { placedMethods } from './placed.js';
import { ACTIONS } from './actions.js';

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.world = null;
    this.persons = new Map(); // who -> person
    this.dirty = new Set();
    this.savedAt = new Map(); // who -> when they were last saved
    this.usage = { day: '', messages: 0, connections: 0, writes: 0, alarms: 0 }; // today's use of the free plan (UTC days)
    this.speed = null; // the admin's "speed up time": { x, until }
    this.admin = { maintenance: false, message: '', banned: [], muted: [] }; // set by the admin player in the game
    ctx.blockConcurrencyWhile(async () => {
      this.world = (await ctx.storage.get('world')) || null;
      Object.assign(this.admin, (await ctx.storage.get('admin')) || {});
      this.speed = (await ctx.storage.get('speed')) || null;
      Object.assign(this.usage, (await ctx.storage.get('usage')) || {});
      for (const [k, p] of await ctx.storage.list({ prefix: 'p:' })) this.persons.set(k.slice(2), p);
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + TICK_MS);
    });
  }

  /* ---------- storage and sending ---------- */
  // every storage write goes through here, so today's use can be counted
  put(key, value) { this.use('writes'); return this.ctx.storage.put(key, value); }
  save() { return this.put('world', this.world); }
  saveAdmin() { return this.put('admin', this.admin); }
  touch(p) { this.dirty.add(p.who); }
  // Save people who changed: just `only` (straight after they did something), everyone changed (all), or
  // by default only those not saved for SAVE_EVERY (the world's tick: walking about, needs ticking over).
  async flush(only, all = false) {
    const now = Date.now(), batch = {};
    for (const who of [...this.dirty]) {
      if (!all && (only ? who !== only : now - (this.savedAt.get(who) || 0) < SAVE_EVERY)) continue;
      this.dirty.delete(who);
      const p = this.persons.get(who);
      if (!p) continue;
      batch[`p:${who}`] = p;
      this.savedAt.set(who, now);
    }
    const keys = Object.keys(batch);
    this.use('writes', keys.length);
    for (let i = 0; i < keys.length; i += 100) await this.ctx.storage.put(Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, batch[k]])));
  }
  // today's use of the free plan, shown to the admin
  use(what, n = 1) {
    const day = new Date().toISOString().slice(0, 10);
    if (this.usage.day !== day) this.usage = { day, messages: 0, connections: 0, writes: 0, alarms: 0 };
    this.usage[what] += n;
  }
  usageNow() {
    const u = this.usage, requests = u.connections + u.alarms + Math.ceil(u.messages / 20);
    const pct = (n, of) => Math.round((n / of) * 100);
    return { requests: pct(requests, FREE.requests), writes: pct(u.writes, FREE.writes), messages: u.messages, playing: this.playing(), max: MAX_PLAYING, waiting: this.line().length };
  }
  sockets() { return this.ctx.getWebSockets().map((ws) => ({ ws, p: ws.deserializeAttachment() })).filter(({ p }) => p && p.id); }
  socketOf(who) { return who ? this.sockets().find(({ p }) => p.who === who) : undefined; }
  send(msg, except) {
    const text = JSON.stringify(msg);
    for (const { ws, p } of this.sockets()) if (p.id !== except) { try { ws.send(text); } catch (err) { /* gone */ } }
  }
  tell(who, msg) { const s = this.socketOf(who); if (s) { try { s.ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } } }
  // send someone a last message and close their connection
  boot(ws, msg) { try { ws.send(JSON.stringify(msg)); ws.close(1000, msg.t); } catch (err) { /* gone */ } }
  codeOk(code) { // the admin code is a Cloudflare secret (ADMIN_CODE) that only Luke knows
    const want = String(this.env.ADMIN_CODE || ''), have = String(code || '');
    if (!want || have.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ have.charCodeAt(i);
    return diff === 0;
  }
  sendCount() { this.send({ t: 'count', n: this.playing() }, null); }
  playing(except) { return this.sockets().filter(({ p }) => p.who && p.who !== except).length; } // watchers on the main menu aren't counted
  // Who is this? For now a person belongs to the phone's random id (pid). Sign-in later (Google, say) plugs in here:
  // check the sign-in with Google, then look up 'acct:<their Google id>' in storage to find their who. The first time
  // someone signs in, save 'acct:<id>' = the who from their phone, so they keep the person they already have.
  async whoFor(m) { return tagOf(m.pid || crypto.randomUUID()); }






  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/feedback') { // feedback sent while not connected
      let note = {};
      try { note = JSON.parse(await request.text()); } catch (err) { /* ignore */ }
      await this.addFeedback(note);
      return new Response('ok', { headers: CORS });
    }
    this.use('connections');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({});
    return new Response(null, { status: 101, webSocket: client });
  }
  async addFeedback(note) {
    const text = clean(note.text, 1000).trim();
    if (!text) return;
    const list = (await this.ctx.storage.get('feedback')) || [];
    list.push({ at: new Date().toISOString(), name: clean(note.name, 20), v: clean(note.v, 30), device: clean(note.device, 200), x: num(note.x), z: num(note.z), text });
    await this.put('feedback', list.slice(-FEEDBACK_KEEP));
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (err) { return; }
    if (!m || typeof m.t !== 'string') return;
    lastHeard.set(ws, Date.now());
    this.use('messages');
    if (m.t === 'ping') return;
    const me = ws.deserializeAttachment() || {};
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    if (m.t === 'hello') { if (me.id && !allowed(ws, me, 'hello')) { reply({ t: 'slow' }); return; } await this.hello(ws, me, m, reply); return; }
    if (m.t === 'bye') { try { ws.close(1000, 'bye'); } catch (err) { /* gone */ } this.webSocketClose(ws); return; }
    if (!me.id) return;
    if (me.watch && m.t !== 'feedback') return; // on the main menu: only watching the world
    if (!allowed(ws, me, m.t)) {
      if (m.t === 'take') reply({ t: 'took', id: m.id, ok: false });
      else if (m.t === 'pick') reply({ t: 'picked', bush: m.bush, ok: false });
      else if (m.t !== 'move') reply({ t: 'slow' });
      return;
    }
    const w = this.world;
    const p = this.persons.get(me.who);
    const save = () => { this.touch(p); this.flush(p.who); }; // what they did is saved straight away
    if (m.t.startsWith('a.')) { if (me.admin) await this.adminDo(ws, me, m); return; } // the admin player's tools (admin.js)
    const action = ACTIONS[m.t]; // everything else (actions.js)
    if (!action) return;
    if (action.when !== 'any') {
      if (!this.alive(p)) return;
      this.catchUp(p);
      if (!this.alive(p) || (action.when === 'world' && !w)) return;
    }
    await action.run.call(this, { ws, me, m, p, w, reply, save });
  }

  async hello(ws, me, m, reply) {
    if (m.proto !== PROTOCOL) { this.boot(ws, { t: 'maintenance', text: 'A big update is on its way. Back soon.' }); return; } // an older game
    const link = m.link === 'test' ? 'test' : 'release';
    const min = (WORLDS.minVersion || {})[link];
    const isAdmin = this.codeOk(m.adminCode);
    const who = await this.whoFor(m);
    if (!isAdmin && this.admin.banned.includes(who)) { this.boot(ws, { t: 'banned' }); return; }
    if (!isAdmin && this.admin.maintenance && link !== 'test') { this.boot(ws, { t: 'maintenance', text: this.admin.message }); return; }
    if (min && tooOld(m.v, m.b, min)) { this.boot(ws, { t: 'update', min }); return; }
    if (m.adminCode && !isAdmin) reply({ t: 'adminNo' });
    if (me.who) this.leave(ws, me); // was playing on this connection (Exit to the main menu): their person goes away
    // the world is full: watch from the main menu and wait in line (the admin always gets in)
    const full = !m.watch && !isAdmin && !this.mayPlay(ws, me, who);
    if (m.watch || full) { // the main menu: watch the world go by without a person
      const queued = full ? me.queued || Date.now() : 0;
      Object.assign(me, { id: me.watch && me.id ? me.id : `w:${crypto.randomUUID().slice(0, 8)}`, who: null, watch: true, queued, turnAt: 0, admin: isAdmin, tag: m.adminTag !== false, v: clean(m.v, 20), link, alive: false });
      ws.serializeAttachment(me);
      const p = this.persons.get(who);
      reply({ t: 'welcome', watch: true, id: me.id, people: this.people(null), world: this.view(), count: this.playing(), speed: this.speed,
        yours: this.alive(p) ? { name: p.name, age: ageOf(p) } : null, line: full ? this.placeOf(ws) : 0 });
      if (full) this.callLine();
      return;
    }
    me.queued = 0; me.turnAt = 0;
    // the same phone in another tab or link: that one closes
    for (const s of this.sockets()) if (s.p.who === who && s.ws !== ws) { s.p.alive = false; s.ws.serializeAttachment(s.p); this.boot(s.ws, { t: 'elsewhere' }); }
    Object.assign(me, { id: who, who, watch: false, admin: isAdmin, tag: m.adminTag !== false, said: me.said || [], v: clean(m.v, 20), link, alive: false });
    const p = this.persons.get(who);
    let away = null, dead = null;
    if (p && this.alive(p)) {
      if (p.asleep) this.catchUp(p, Date.now()); // asleep away: hunger and thirst dropped slowly to the floor
      if (p.leftAt) {
        this.advanceAway(p, Date.now());
        if (this.alive(p)) {
          away = { ms: Date.now() - p.leftAt, ...(p.log || {}) };
          p.plan = null; p.asleep = false; p.sleeping = false; p.collapsed = false; p.leftAt = 0; p.log = { ate: 0, drank: 0, picked: 0 }; // back: awake
          this.touch(p);
        }
      }
    }
    if (p && !this.alive(p)) {
      dead = { name: p.name, age: ageOf(p, p.diedAt || Date.now()), cause: p.cause, away: p.diedAway, gone: p.state === 'gone', had: !!p.hadThings };
      this.persons.delete(who);
      await this.ctx.storage.delete(`p:${who}`);
    }
    if (p && this.alive(p)) me.alive = true;
    ws.serializeAttachment(me);
    if (p) await this.flush(who);
    if (isAdmin) reply(this.adminState(me));
    const w = this.world;
    reply({ t: 'welcome', id: who, people: this.people(who), world: this.view(), needSeed: !w, needLayout: !!w && !w.layout,
      count: this.playing(), me: me.alive ? this.mine(p) : null, away, dead, speed: this.speed });
    if (me.alive) this.send({ t: 'join', person: this.pub(p) }, who);
    this.sendCount();
  }

  /* ---------- every minute: needs, people away, sleepers, graves, sticks and stones ---------- */
  async alarm() {
    const now = Date.now();
    this.use('alarms');
    try {
      // connections that have gone quiet (a phone locked, or the page closed without saying) are closed
      for (const { ws } of this.sockets()) {
        if (!lastHeard.has(ws)) { lastHeard.set(ws, now); continue; }
        if (now - lastHeard.get(ws) > QUIET_MS) { try { ws.close(1000, 'quiet'); } catch (err) { /* gone */ } this.webSocketClose(ws); }
      }
      for (const p of [...this.persons.values()]) {
        if (!this.alive(p)) {
          if (p.diedAt && now - p.diedAt > 30 * 24 * HOUR) { this.persons.delete(p.who); await this.ctx.storage.delete(`p:${p.who}`); }
          continue;
        }
        if (this.isOnline(p.who)) {
          this.catchUp(p, now);
          if (this.alive(p)) this.tell(p.who, this.mine(p));
          this.touch(p);
        } else {
          if (!p.leftAt) { p.leftAt = now; p.simAt = now; p.home = [p.x, p.z]; p.log = { ate: 0, drank: 0, picked: 0 }; this.touch(p); }
          if (p.asleep) { // asleep: needs are caught up when they come back (nothing to save until they wake or go)
            if (now - p.sleepAt > AWAY.goneAfterDays * 24 * HOUR) { // asleep too long (3 days away in all): gone, their things left where they slept
              p.state = 'gone'; p.diedAt = now;
              this.spill(p);
              this.send({ t: 'leave', id: p.who }, null);
              this.touch(p);
            }
          } else { this.advanceAway(p, now); this.touch(p); }
        }
      }
      await this.flush(); // only people not saved for a while
      if (this.usage.alarms % 15 === 0) await this.put('usage', this.usage); // about every 5 minutes
      this.callLine();
      const w = this.world;
      if (w) {
        const keep = (w.graves || []).filter((g) => g.at > now - AWAY.graveHours * HOUR);
        if (keep.length !== (w.graves || []).length) { w.graves = keep; this.send({ t: 'graves', graves: keep }, null); await this.save(); }
        if (now >= (w.nextRespawn || 0)) await this.respawn(now);
        // stumps grow back into trees after a few days (removed stumps are gone for good)
        const regrow = ((G.chopping || {}).regrowDays || 3) * 24 * HOUR;
        let grew = false;
        for (const [i, st] of Object.entries(w.trees || {})) if (st[0] === 'stump' && now - st[1] > regrow) { delete w.trees[i]; this.send({ t: 'tree', idx: Number(i), state: 'tree' }, null); grew = true; }
        if (grew) await this.save();
      }
      if (this.speed && now > this.speed.until) { this.speed = null; await this.ctx.storage.delete('speed'); this.send({ t: 'speed', speed: null }, null); }
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    if (!me || !me.id) return; // not joined, or already handled
    if (!me.who) { me.id = null; ws.serializeAttachment(me); return; } // a watcher on the main menu
    this.leave(ws, me);
  }
  // someone stops playing (closed the game, or Exit to the main menu): their person goes away and looks after themselves
  leave(ws, me) {
    const who = me.who, wasAlive = me.alive;
    me.id = null; me.who = null; me.alive = false; // this connection no longer plays them
    ws.serializeAttachment(me);
    const p = this.persons.get(who);
    if (wasAlive && this.alive(p) && !this.socketOf(who)) { // away now: they start looking after themselves
      p.leftAt = Date.now(); p.simAt = p.leftAt; p.statsAt = Math.min(p.statsAt, p.leftAt);
      p.home = [p.x, p.z]; p.plan = null; p.asleep = false; p.wanderNext = true; p.log = { ate: 0, drank: 0, picked: 0 }; // off for a stroll straight away
      this.touch(p);
      this.flush(who);
      this.send({ t: 'state', id: p.who, state: 'away', x: num(p.x), z: num(p.z) }, null);
    }
    this.sendCount();
    this.callLine(); // a spot may have opened for someone waiting
  }
  webSocketError(ws) { this.webSocketClose(ws); }

}
// the rest of the world's methods, kept in their own files by topic
Object.assign(World.prototype, lineMethods, personsMethods, awayMethods, natureMethods, adminMethods, placedMethods);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const world = () => env.WORLD.get(env.WORLD.idFromName('live'));
    if (url.pathname === '/feedback' && request.method === 'POST') return world().fetch(request);
    if (url.pathname === '/world') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: CORS });
      return world().fetch(request);
    }
    return new Response('Pocket Life server is running', { headers: CORS });
  },
};
