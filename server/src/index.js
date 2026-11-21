// Pocket Life server: one Durable Object holds the whole world.
// - the shared world: things on the ground, berry bushes, graves
// - every person: needs, inventory and where they are, kept here so they stay in the world 24/7
// - while a player is away their person looks after themselves (wanders, eats, picks berries, drinks),
//   after a day away they lie down asleep (needs pause), and after a week asleep they're gone
// - chat, reports, feedback and the admin player's tools
import { DurableObject } from 'cloudflare:workers';
import WORLDS from '../worlds.json'; // minimum version for each link
import FILTER from '../words.json'; // the chat filter, copied from game-data.json by tools/worlds.py
import G from '../game.json'; // needs, items, berry bushes, away rules: copied from game-data.json by tools/worlds.py
import { starText, badName } from './filter.js';
import { HOUR, MINUTE, freshStats, advanceStats, addCarry, takeCarry, applyGives, eatOne, posAt, dist, craft, sleepMs, spend } from './people.js';

const PROTOCOL = 2; // bump when the game and server stop understanding each other
const CORS = { 'Access-Control-Allow-Origin': '*' };
const WORLD_FORMAT = 1;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const kindOk = (k) => typeof k === 'string' && /^[a-z0-9-]{1,24}$/.test(k);
const AWAY = { sleepBelow: 35, wanderMin: 25, wanderMax: 50, strollSpeed: 1.2, eatBelow: 60, drinkBelow: 55, sleepAfterHours: 24, goneAfterDays: 7, graveHours: 24, ...(G.away || {}) };
const START = G.start || { x: 0.6, z: 1.9 };
// '0.0.6' with build 5 is [0,0,6,5]; a minVersion of '0.0.6' only checks the first three
const parts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
function tooOld(v, b, min) {
  const have = parts(v), want = parts(min);
  have[3] = Number(b) || 0;
  for (let i = 0; i < want.length; i++) { const a = have[i] || 0; if (a !== want[i]) return a < want[i]; }
  return false;
}
const FEEDBACK_KEEP = 300, REPORTS_KEEP = 300;
// Spam limits: each kind of message refills at so many a second, up to a small burst. The admin is never limited.
const LIMITS = { chop: [1, 3], sleep: [1, 4], craft: [1, 3], act: [3, 6], say: [1, 3], take: [5, 10], pick: [5, 10], drop: [2, 6], move: [12, 20], eat: [3, 6], drink: [1, 3], create: [1 / 5, 3],
  feedback: [1 / 30, 3], report: [1 / 30, 3], adminLogin: [1 / 5, 3], hello: [1 / 2, 4] };
const buckets = new WeakMap(); // per connection, kept in memory only
const lastHeard = new WeakMap(); // per connection: when it last sent anything (the game pings every 25 seconds)
const QUIET_MS = 90000; // nothing heard for this long: the phone is asleep or gone, so the person goes away
const TICK_MS = 20000; // how often the world moves on (needs, people away, sticks and stones)
function allowed(ws, me, t) {
  const lim = LIMITS[t];
  if (!lim || me.admin) return true;
  const [rate, burst] = lim, now = Date.now() / 1000;
  let b = buckets.get(ws);
  if (!b) buckets.set(ws, (b = {}));
  const k = b[t] || (b[t] = { n: burst, at: now });
  k.n = Math.min(burst, k.n + (now - k.at) * rate);
  k.at = now;
  if (k.n < 1) return false;
  k.n -= 1;
  return true;
}
// a short public tag for a phone, so a person, mutes and reports stick to the same phone across visits
async function tagOf(pid) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pocket-life:${clean(pid, 40)}`)));
  return [...bytes.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// a look from the game, kept small and plain
function cleanLook(look) {
  const out = {};
  if (!look || typeof look !== 'object') return out;
  for (const [k, v] of Object.entries(look).slice(0, 30)) {
    if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = clean(v, 30);
    else if (Number.isFinite(v)) out[k] = num(v);
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.world = null;
    this.persons = new Map(); // who -> person
    this.dirty = new Set();
    this.speed = null; // the admin's "speed up time": { x, until }
    this.admin = { maintenance: false, message: '', banned: [], muted: [] }; // set by the admin player in the game
    ctx.blockConcurrencyWhile(async () => {
      this.world = (await ctx.storage.get('world')) || null;
      Object.assign(this.admin, (await ctx.storage.get('admin')) || {});
      this.speed = (await ctx.storage.get('speed')) || null;
      for (const [k, p] of await ctx.storage.list({ prefix: 'p:' })) this.persons.set(k.slice(2), p);
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + TICK_MS);
    });
  }

  /* ---------- storage and sending ---------- */
  save() { return this.ctx.storage.put('world', this.world); }
  saveAdmin() { return this.ctx.storage.put('admin', this.admin); }
  touch(p) { this.dirty.add(p.who); }
  async flush() {
    if (!this.dirty.size) return;
    const batch = {};
    for (const who of this.dirty) { const p = this.persons.get(who); if (p) batch[`p:${who}`] = p; }
    this.dirty.clear();
    const keys = Object.keys(batch);
    for (let i = 0; i < keys.length; i += 100) await this.ctx.storage.put(Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, batch[k]])));
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
  playing() { return this.sockets().filter(({ p }) => p.who).length; } // watchers on the main menu aren't counted
  // Who is this? For now a person belongs to the phone's random id (pid). Sign-in later (Google, say) plugs in here:
  // check the sign-in with Google, then look up 'acct:<their Google id>' in storage to find their who. The first time
  // someone signs in, save 'acct:<id>' = the who from their phone, so they keep the person they already have.
  async whoFor(m) { return tagOf(m.pid || crypto.randomUUID()); }

  /* ---------- people ---------- */
  alive(p) { return p && p.state === 'alive'; }
  isOnline(who) { return !!who && !!this.sockets().find(({ p }) => p.who === who && p.alive); }
  // online, away, asleep (a day away, needs paused) or sleeping (resting, by choice or when tired)
  stateOf(p) { return p.asleep && !this.isOnline(p.who) ? 'asleep' : p.sleeping ? 'sleeping' : this.isOnline(p.who) ? 'online' : 'away'; }
  // what everyone else is told about a person
  pub(p, now = Date.now()) {
    const s = this.socketOf(p.who), state = this.stateOf(p);
    const [x, z] = state === 'away' ? posAt(p, now) : [p.x, p.z];
    const out = { id: p.who, name: p.name, look: p.look, x: num(x), z: num(z), ry: num(p.ry), state, badge: !!(s && s.p.admin && s.p.tag) };
    if (state === 'away' && p.plan && p.plan.kind === 'walk' && p.plan.arrive > now) Object.assign(out, { tx: p.plan.to[0], tz: p.plan.to[1], speed: AWAY.strollSpeed });
    return out;
  }
  people(except) { return [...this.persons.values()].filter((p) => this.alive(p) && p.who !== except).map((p) => this.pub(p)); }
  // what the player is told about their own person
  mine(p) {
    return { t: 'me', name: p.name, look: p.look, age: p.age, born: p.born, x: num(p.x), z: num(p.z), ry: num(p.ry),
      stats: p.stats, statsAt: p.statsAt, carry: p.carry, wear: p.wear || {}, lastKind: p.lastKind, sleeping: !!p.sleeping };
  }
  catchUp(p, now = Date.now()) {
    if (!this.alive(p)) return;
    if (p.asleep && !this.isOnline(p.who)) { p.statsAt = now; return; }
    if (this.isOnline(p.who) || !p.leftAt) { const d = advanceStats(p, now, G, this.speed); if (d) this.die(p, d.cause, false); }
    else this.advanceAway(p, now);
  }
  // a person dies: their things drop where they fell and a small grave marks the spot for a day
  die(p, cause, away) {
    const w = this.world;
    p.state = 'dead';
    p.cause = cause;
    p.diedAt = Date.now();
    p.diedAway = !!away;
    p.plan = null;
    this.spill(p);
    if (w) {
      w.graves = (w.graves || []).filter((g) => g.at > Date.now() - AWAY.graveHours * HOUR);
      w.graves.push({ x: num(p.x), z: num(p.z), name: p.name, at: Date.now() });
      this.save();
      this.send({ t: 'graves', graves: w.graves }, null);
    }
    this.touch(p);
    this.send({ t: 'leave', id: p.who }, null);
    const s = this.socketOf(p.who);
    if (s) {
      s.p.alive = false; s.ws.serializeAttachment(s.p);
      try { s.ws.send(JSON.stringify({ t: 'died', name: p.name, age: p.age, cause, away: false, had: false })); } catch (err) { /* gone */ }
    }
  }
  // everything they carried goes on the ground round where they are
  spill(p) {
    const w = this.world;
    const out = [];
    let i = 0;
    for (const [kind, n] of Object.entries(p.carry || {})) for (let k = 0; k < n && i < 200; k++, i++) {
      const a = i * 2.39996, r = 0.3 + Math.sqrt(i) * 0.16;
      out.push({ id: w ? w.nextId++ : 0, kind, x: num(p.x + Math.cos(a) * r), z: num(p.z + Math.sin(a) * r), rot: num(Math.random() * Math.PI) });
    }
    p.hadThings = out.length > 0;
    p.carry = {};
    p.wear = {};
    p.lastKind = null;
    if (w && out.length) { w.items.push(...out); this.save(); this.send({ t: 'added', items: out }, null); }
  }

  /* ---------- away: looking after themselves ---------- */
  // Plays a person's time forward to `now`: walking, drinking, picking berries, eating, idling,
  // then asleep after a day away. Walks are told to anyone watching so they see them stroll about.
  advanceAway(p, now) {
    if (!this.alive(p) || p.asleep) return;
    const L = this.world && this.world.layout;
    const sleepAt = p.leftAt + AWAY.sleepAfterHours * HOUR;
    for (let guard = 0; guard < 400; guard++) {
      const until = Math.min(now, sleepAt, p.plan ? p.plan.arrive : now);
      const d = advanceStats(p, until, G, this.speed);
      [p.x, p.z] = posAt(p, until);
      p.simAt = until;
      if (d) { this.die(p, d.cause, true); return; }
      if (until >= sleepAt) { // a day away: lie down and sleep (needs pause)
        p.plan = null; p.asleep = true; p.sleepAt = sleepAt; p.log.slept = true;
        this.touch(p);
        this.send({ t: 'state', id: p.who, state: 'asleep', x: num(p.x), z: num(p.z) }, null);
        return;
      }
      if (p.plan && until < p.plan.arrive) return; // still on the way
      const done = p.plan;
      p.plan = null;
      if (done) this.arrive(p, done, until);
      if (until >= now) { if (!p.plan) this.decide(p, until, now, L); return; }
      this.decide(p, until, now, L);
      if (!p.plan) return;
    }
  }
  arrive(p, plan, t) {
    if (plan.kind === 'sleep') { // rested: up again
      p.sleeping = false;
      if (plan.arrive > Date.now() - 30000) this.send({ t: 'state', id: p.who, state: 'away', x: num(p.x), z: num(p.z) }, null);
      this.touch(p);
      return;
    }
    if (plan.then === 'drink') {
      const src = G.sources[plan.source];
      for (let n = 0; n < 8 && src && p.stats.thirst != null && p.stats.thirst < 95; n++) { applyGives(p, src.gives); spend(p, 'drink', G); p.log.drank++; }
    } else if (plan.then === 'pick') {
      for (let n = 0; n < 4 && this.berriesOn(plan.bush, t) > 0; n++) {
        if (!addCarry(p, G.berryKind, 1, G)) break;
        this.takeBerry(plan.bush, t);
        spend(p, 'harvest', G);
        p.log.picked++;
      }
    }
    this.touch(p);
  }
  // what to do next: eat if hungry, then water, then berries, otherwise potter about near home
  decide(p, t, now, L) {
    while (p.stats.hunger != null && p.stats.hunger < AWAY.eatBelow && eatOne(p, G)) p.log.ate++;
    const at = [p.x, p.z];
    // tired (or already lying down): sleep where they are until rest is full
    if (p.sleeping || (p.stats.rest != null && p.stats.rest < AWAY.sleepBelow)) {
      const was = p.sleeping;
      p.sleeping = true;
      p.plan = { kind: 'sleep', start: t, arrive: t + sleepMs(p, G) / (this.speed && t < this.speed.until ? this.speed.x : 1) };
      if (!was) p.log.slept = true;
      if (!was && p.plan.arrive > now) this.send({ t: 'state', id: p.who, state: 'sleeping', x: num(p.x), z: num(p.z) }, null);
      return;
    }
    const walk = (to, extra) => {
      const ms = (dist(at, to) / AWAY.strollSpeed) * 1000 + 500;
      p.plan = { kind: 'walk', from: at, to: [num(to[0]), num(to[1])], start: t, arrive: t + ms, ...extra };
      spend(p, 'walkPerMetre', G, dist(at, to));
      if (p.plan.arrive > now) this.send({ t: 'stroll', id: p.who, x: p.plan.to[0], z: p.plan.to[1], speed: AWAY.strollSpeed, then: extra && extra.then }, null);
    };
    const idle = (ms) => { p.plan = { kind: 'idle', start: t, arrive: t + ms }; };
    if (!L) { idle(10 * MINUTE); return; }
    const water = Object.keys(G.sources).find((k) => G.sources[k].gives && G.sources[k].water);
    if (water && p.stats.thirst != null && p.stats.thirst < AWAY.drinkBelow && L.shore.length) {
      const to = L.shore.reduce((a, b) => (dist(at, a) < dist(at, b) ? a : b));
      walk(to, { then: 'drink', source: water });
      return;
    }
    if (p.stats.hunger != null && p.stats.hunger < AWAY.eatBelow && L.bushes.length) {
      const near = L.bushes.map((b, i) => ({ i, b, d: dist(at, b) })).sort((a, b) => a.d - b.d);
      const ripe = near.find((n) => this.berriesOn(n.i, t) > 0);
      const go = ripe || near[0];
      const d = Math.max(0.01, go.d), stand = [go.b[0] + ((at[0] - go.b[0]) / d) * 1.0, go.b[1] + ((at[1] - go.b[1]) / d) * 1.0];
      if (go.d < 1.6) { if (ripe) { this.arrive(p, { then: 'pick', bush: go.i }, t); idle(20000); } else idle(15 * MINUTE); return; }
      walk(stand, ripe ? { then: 'pick', bush: go.i } : {});
      return;
    }
    // potter about: rest a little, then stroll somewhere within reach of where you left them
    if (!p.wanderNext) { p.wanderNext = true; idle((15 + Math.random() * 45) * 1000); return; }
    p.wanderNext = false;
    const home = AWAY.near === 'pond' && G.pond ? [G.pond.x, G.pond.z] : p.home || at; // round the main pond, or where you left them
    const spots = (L.open || []).filter((o) => dist(o, home) <= AWAY.wanderMax && dist(o, at) > 3);
    const far = spots.filter((o) => dist(o, home) >= AWAY.wanderMin);
    if (!spots.length) { idle(2 * MINUTE); return; } // nowhere to stroll to: rest a while
    walk(pickRandom(far.length && Math.random() < 0.6 ? far : spots));
  }

  /* ---------- berry bushes ---------- */
  berriesOn(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    if (b[0] == null || !w.regrowMs) return w.holds;
    const every = w.regrowMs / w.holds;
    return Math.min(w.holds, b[0] + Math.floor((t - b[1]) / every));
  }
  takeBerry(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    const every = w.regrowMs / w.holds;
    let count = w.holds, from = t;
    if (b[0] != null && w.regrowMs) {
      const grown = Math.floor((t - b[1]) / every);
      count = Math.min(w.holds, b[0] + grown);
      from = count >= w.holds ? t : b[1] + grown * every;
    }
    count -= 1;
    w.bushes[i] = [count, from];
    this.save();
    this.send({ t: 'bush', bush: i, count, growFrom: from }, null);
  }

  /* ---------- the shared world as players see it ---------- */
  view() {
    const w = this.world;
    return w ? { items: w.items, bushes: w.bushes, graves: w.graves || [], trees: w.trees || {}, oldStumps: w.oldStumps || {} } : null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/feedback') { // feedback sent while not connected
      let note = {};
      try { note = JSON.parse(await request.text()); } catch (err) { /* ignore */ }
      await this.addFeedback(note);
      return new Response('ok', { headers: CORS });
    }
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
    await this.ctx.storage.put('feedback', list.slice(-FEEDBACK_KEEP));
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (err) { return; }
    if (!m || typeof m.t !== 'string') return;
    lastHeard.set(ws, Date.now());
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
    const save = () => { this.touch(p); this.flush(); };
    switch (m.t) {
      case 'feedback': await this.addFeedback(m); reply({ t: 'thanks' }); return;
      case 'adminLogin':
        me.tries = (me.tries || 0) + 1;
        if (me.tries > 5 || !this.codeOk(m.code)) { ws.serializeAttachment(me); reply({ t: 'adminNo' }); return; }
        me.admin = true;
        ws.serializeAttachment(me);
        reply(this.adminState(me));
        if (me.alive) this.send({ t: 'badge', id: me.id, on: !!me.tag }, me.id);
        return;
      case 'report': {
        const them = this.persons.get(m.id), sock = this.socketOf(m.id);
        if (!them) { reply({ t: 'reported', ok: false }); return; }
        const list = (await this.ctx.storage.get('reports')) || [];
        list.push({ at: new Date().toISOString(), by: { name: p ? p.name : '', who: me.who }, about: { name: them.name, who: them.who, v: sock ? sock.p.v : '' },
          reason: clean(m.reason, 30), note: clean(m.note, 500), said: (sock && sock.p.said) || [], x: num(them.x), z: num(them.z) });
        await this.ctx.storage.put('reports', list.slice(-REPORTS_KEEP));
        reply({ t: 'reported', ok: true });
        return;
      }
      case 'create': { // making a new person
        if (this.alive(p)) { reply(this.mine(p)); return; }
        const name = clean(m.name, 20).trim();
        if (!name || (!me.admin && badName(name, FILTER))) { reply({ t: 'badName' }); return; }
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
        const np = { who: me.who, state: 'alive', name, look: cleanLook({ ...m.look, name }), age: Math.max(G.age.min, Math.min(G.age.max, Math.round(Number(m.age) || G.age.min))),
          born: Date.now(), x: num(START.x + Math.cos(a) * r), z: num(START.z + Math.sin(a) * r), ry: 0.62,
          stats: freshStats(G), statsAt: Date.now(), carry: {}, lastKind: null, log: { ate: 0, drank: 0, picked: 0 } };
        this.persons.set(me.who, np);
        me.alive = true;
        ws.serializeAttachment(me);
        this.touch(np);
        await this.flush();
        reply(this.mine(np));
        this.send({ t: 'join', person: this.pub(np) }, me.id);
        return;
      }
    }
    if (m.t.startsWith('a.')) { if (me.admin) await this.adminDo(ws, me, m); return; }
    if (m.t === 'say') {
      const text = starText(clean(m.text, 80).trim(), FILTER);
      if (!text || !this.alive(p)) return;
      me.said = [...(me.said || []), [Date.now(), text]].slice(-8); // kept for reports
      ws.serializeAttachment(me);
      if (this.admin.muted.includes(me.who)) reply({ t: 'say', id: me.id, text }); // muted by the admin: only they see it
      else this.send({ t: 'say', id: me.id, text }, null);
      return;
    }
    if (m.t === 'seed' && !w) { await this.seed(m); return; }
    if (m.t === 'layout' && w && !w.layout) { w.layout = this.cleanLayout(m); await this.save(); return; }
    if (!this.alive(p)) return;
    this.catchUp(p);
    if (!this.alive(p)) return;
    if (m.t === 'act') { // bending, picking, drinking: shown to everyone else
      const pose = ['bend', 'kneel', 'pick', 'chop'].includes(m.pose) ? m.pose : 'bend';
      this.send({ t: 'act', id: me.id, pose, seconds: Math.max(0.3, Math.min(25, Number(m.seconds) || 0.5)) }, me.id);
    } else if (m.t === 'move') {
      const nx = num(m.x), nz = num(m.z), moved = Math.hypot(nx - p.x, nz - p.z);
      if (moved < 30) spend(p, 'walkPerMetre', G, moved); // walking takes a little energy
      p.x = nx; p.z = nz; p.ry = num(m.ry);
      this.touch(p);
      this.send({ t: 'move', id: me.id, x: p.x, z: p.z, ry: p.ry, doing: clean(m.doing, 24) }, me.id);
    } else if (m.t === 'sleep') { // lie down to rest, or get up
      p.sleeping = !!m.on;
      save();
      reply(this.mine(p));
      this.send({ t: 'state', id: me.id, state: p.sleeping ? 'sleeping' : 'online', x: num(p.x), z: num(p.z) }, me.id);
    } else if (m.t === 'craft') {
      if (craft(p, (G.recipes || {})[m.id], G)) { spend(p, 'craft', G); save(); }
      reply(this.mine(p));
    } else if (m.t === 'eat') {
      if (eatOne(p, G, m.kind)) save();
      reply(this.mine(p));
    } else if (m.t === 'drink') {
      const src = G.sources[m.source];
      if (src && src.gives && src.water) { applyGives(p, src.gives); spend(p, 'drink', G); save(); }
      reply(this.mine(p));
    } else if (!w) {
      return;
    } else if (m.t === 'take') {
      const i = w.items.findIndex((it) => it.id === m.id);
      if (i < 0 || !addCarry(p, w.items[i].kind, 1, G)) { reply({ t: 'took', id: m.id, ok: false }); return; }
      w.items.splice(i, 1);
      spend(p, 'pickup', G);
      await this.save();
      save();
      reply({ t: 'took', id: m.id, ok: true });
      this.send({ t: 'gone', id: m.id }, me.id);
    } else if (m.t === 'drop') {
      const added = [];
      for (const it of (Array.isArray(m.items) ? m.items : []).slice(0, 60)) {
        if (!it || !kindOk(it.kind) || !takeCarry(p, it.kind, 1)) continue;
        const item = { id: w.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) };
        w.items.push(item);
        added.push(item);
      }
      save();
      reply(this.mine(p));
      if (!added.length) return;
      await this.save();
      this.send({ t: 'added', items: added }, null);
    } else if (m.t === 'chop') { // chopping a tree, digging out a stump, or chopping a log into sticks
      const C = G.chopping || {}, rule = C[m.what === 'oldStump' ? 'stump' : m.what], tool = C.tool;
      if (!rule || (tool && !p.carry[tool])) { reply(this.mine(p)); return; }
      w.trees = w.trees || {};
      let at = [num(m.x), num(m.z)];
      if (m.what === 'oldStump') { // an old stump that was already in the world: dug out for good
        const i = Math.floor(m.idx);
        if (!(i >= 0 && i < 5000)) return;
        w.oldStumps = w.oldStumps || {};
        if (w.oldStumps[i]) { reply({ t: 'oldStump', idx: i }); return; }
        w.oldStumps[i] = Date.now();
        this.send({ t: 'oldStump', idx: i }, null);
      } else if (m.what === 'tree' || m.what === 'stump') {
        const i = Math.floor(m.idx);
        if (!(i >= 0 && i < 5000)) return;
        const st = w.trees[i];
        if (m.what === 'tree' && st) { reply({ t: 'tree', idx: i, state: st[0] }); return; } // someone else got it first
        if (m.what === 'stump' && (!st || st[0] !== 'stump')) { reply({ t: 'tree', idx: i, state: st ? st[0] : 'tree' }); return; }
        w.trees[i] = [m.what === 'tree' ? 'stump' : 'gone', Date.now()];
        this.send({ t: 'tree', idx: i, state: w.trees[i][0] }, null);
      } else {
        const j = w.items.findIndex((it) => it.id === m.id && it.kind === m.what);
        if (j < 0) { reply(this.mine(p)); return; }
        at = [w.items[j].x, w.items[j].z];
        w.items.splice(j, 1);
        this.send({ t: 'gone', id: m.id }, null);
      }
      // what falls: round where it was chopped
      const out = [];
      let n = 0;
      for (const [kind, count] of Object.entries(rule.gives || {})) for (let k = 0; k < count && n < 20; k++, n++) {
        const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.8;
        out.push({ id: w.nextId++, kind, x: num(at[0] + Math.cos(a) * r), z: num(at[1] + Math.sin(a) * r), rot: num(Math.random() * Math.PI) });
      }
      w.items.push(...out);
      if (out.length) this.send({ t: 'added', items: out }, null);
      spend(p, 'chop', G);
      // the tool wears; a worn-out tool breaks
      if (tool && G.items[tool] && G.items[tool].uses) {
        p.wear = p.wear || {};
        p.wear[tool] = (p.wear[tool] ?? G.items[tool].uses) - 1;
        if (p.wear[tool] <= 0) {
          takeCarry(p, tool, 1);
          if (p.carry[tool]) p.wear[tool] = G.items[tool].uses;
          reply({ t: 'broke', kind: tool });
        }
      }
      await this.save();
      save();
      reply(this.mine(p));
    } else if (m.t === 'pick') {
      const i = Math.floor(m.bush);
      if (!(i >= 0 && i < 200)) return;
      if (this.berriesOn(i) < 1 || !addCarry(p, G.berryKind, 1, G)) { reply({ t: 'picked', bush: i, ok: false }); return; }
      this.takeBerry(i);
      spend(p, 'harvest', G);
      save();
    }
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
    if (m.watch) { // the main menu: watch the world go by without a person
      Object.assign(me, { id: `w:${crypto.randomUUID().slice(0, 8)}`, who: null, watch: true, admin: isAdmin, tag: m.adminTag !== false, v: clean(m.v, 20), link, alive: false });
      ws.serializeAttachment(me);
      const p = this.persons.get(who);
      reply({ t: 'welcome', watch: true, id: me.id, people: this.people(null), world: this.view(), count: this.playing(), speed: this.speed,
        yours: this.alive(p) ? { name: p.name, age: p.age } : null });
      return;
    }
    // the same phone in another tab or link: that one closes
    for (const s of this.sockets()) if (s.p.who === who && s.ws !== ws) { s.p.alive = false; s.ws.serializeAttachment(s.p); this.boot(s.ws, { t: 'elsewhere' }); }
    Object.assign(me, { id: who, who, watch: false, admin: isAdmin, tag: m.adminTag !== false, said: me.said || [], v: clean(m.v, 20), link, alive: false });
    const p = this.persons.get(who);
    let away = null, dead = null;
    if (p && this.alive(p)) {
      if (p.asleep) p.statsAt = Date.now(); // needs were paused while asleep
      if (p.leftAt) {
        this.advanceAway(p, Date.now());
        if (this.alive(p)) {
          away = { ms: Date.now() - p.leftAt, ...(p.log || {}) };
          p.plan = null; p.asleep = false; p.sleeping = false; p.leftAt = 0; p.log = { ate: 0, drank: 0, picked: 0 }; // back: awake
          this.touch(p);
        }
      }
    }
    if (p && !this.alive(p)) {
      dead = { name: p.name, age: p.age, cause: p.cause, away: p.diedAway, gone: p.state === 'gone', had: !!p.hadThings };
      this.persons.delete(who);
      await this.ctx.storage.delete(`p:${who}`);
    }
    if (p && this.alive(p)) me.alive = true;
    ws.serializeAttachment(me);
    await this.flush();
    if (isAdmin) reply(this.adminState(me));
    const w = this.world;
    reply({ t: 'welcome', id: who, people: this.people(who), world: this.view(), needSeed: !w, needLayout: !!w && !w.layout,
      count: this.playing(), me: me.alive ? this.mine(p) : null, away, dead, speed: this.speed });
    if (me.alive) this.send({ t: 'join', person: this.pub(p) }, who);
    this.sendCount();
  }
  cleanLayout(m) {
    const pts = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).filter((a) => Array.isArray(a)).map(([x, z]) => [num(x), num(z)]);
    return { bushes: pts(m.bushes, 200), shore: pts(m.shore, 200), open: pts(m.open, 1000) };
  }
  // the first player into a new world lays it out (everyone's game builds the same starting world)
  async seed(m) {
    const items = (Array.isArray(m.items) ? m.items : []).slice(0, 3000).filter((it) => it && kindOk(it.kind));
    const spots = {};
    for (const [k, list] of Object.entries(m.spots || {})) if (kindOk(k) && Array.isArray(list)) spots[k] = list.slice(0, 500).map(([x, z]) => [num(x), num(z)]);
    const caps = {};
    for (const [k, n] of Object.entries(m.caps || {})) if (kindOk(k) && Number.isFinite(n)) caps[k] = Math.max(0, Math.min(2000, Math.floor(n)));
    const respawnMs = Math.max(MINUTE, Number(m.respawnMs) || 10 * MINUTE);
    this.world = {
      format: WORLD_FORMAT, nextId: 1, items: [], bushes: [], graves: [], spots, caps,
      holds: Math.max(1, Math.min(15, Math.floor(m.holds) || 5)),
      regrowMs: Math.max(0, Number(m.regrowMs) || 0),
      respawnMs, nextRespawn: Date.now() + respawnMs,
      layout: this.cleanLayout(m.layout || {}),
    };
    for (const it of items) this.world.items.push({ id: this.world.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) });
    await this.save();
    this.send({ t: 'world', world: this.view() }, null);
  }

  /* ---------- every minute: needs, people away, sleepers, graves, sticks and stones ---------- */
  async alarm() {
    const now = Date.now();
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
          if (p.asleep) { // needs pause while asleep (nothing to save until they wake or go)
            if (now - p.sleepAt > AWAY.goneAfterDays * 24 * HOUR) { // a week asleep: gone, their things left where they slept
              p.state = 'gone'; p.diedAt = now;
              this.spill(p);
              this.send({ t: 'leave', id: p.who }, null);
              this.touch(p);
            }
          } else { this.advanceAway(p, now); this.touch(p); }
        }
      }
      await this.flush();
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
  // nature tops up: one of each kind that's below its normal amount, at a spot near a tree or boulder
  async respawn(now) {
    const w = this.world;
    w.nextRespawn = now + (w.respawnMs || 10 * MINUTE);
    const added = [];
    for (const [kind, cap] of Object.entries(w.caps || {})) {
      const have = w.items.filter((it) => it.kind === kind).length;
      const spots = (w.spots || {})[kind] || [];
      if (have >= cap || !spots.length) continue;
      const [x, z] = pickRandom(spots);
      const item = { id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) };
      w.items.push(item);
      added.push(item);
    }
    await this.save();
    if (added.length) this.send({ t: 'added', items: added }, null);
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
      this.flush();
      this.send({ t: 'state', id: p.who, state: 'away', x: num(p.x), z: num(p.z) }, null);
    }
    this.sendCount();
  }
  webSocketError(ws) { this.webSocketClose(ws); }

  /* ---------- the admin player ---------- */
  adminState(me) {
    return { t: 'admin', on: true, tag: !!me.tag, maintenance: this.admin.maintenance, message: this.admin.message, speed: this.speed };
  }
  // Each admin message starts with 'a.' and only works for the admin.
  async adminDo(ws, me, m) {
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    const done = (text) => reply({ t: 'adminDone', text, ...this.adminState(me) });
    const w = this.world;
    const them = m.id ? this.persons.get(m.id) : null;
    const sock = m.id ? this.socketOf(m.id) : null;
    switch (m.t) {
      case 'a.tag':
        me.tag = !!m.on; ws.serializeAttachment(me);
        this.send({ t: 'badge', id: me.id, on: me.tag }, me.id);
        return done(me.tag ? 'Admin tag on' : 'Admin tag off');
      case 'a.maintenance':
        this.admin.maintenance = !!m.on;
        this.admin.message = clean(m.text, 200).trim();
        await this.saveAdmin();
        if (this.admin.maintenance) for (const { ws: s, p } of this.sockets()) if (!p.admin && p.link !== 'test') this.boot(s, { t: 'maintenance', text: this.admin.message });
        return done(this.admin.maintenance ? 'Maintenance on' : 'Maintenance off');
      case 'a.list': {
        const feedback = ((await this.ctx.storage.get('feedback')) || []).slice(-100).reverse();
        const reports = ((await this.ctx.storage.get('reports')) || []).slice(-100).reverse();
        const online = this.sockets().filter(({ p }) => p.who).map(({ p }) => {
          const per = this.persons.get(p.who);
          return { id: p.who, name: per && this.alive(per) ? per.name : '(making a person)', v: p.v, link: p.link, x: per ? per.x : 0, z: per ? per.z : 0, muted: this.admin.muted.includes(p.who) };
        });
        const all = [...this.persons.values()].filter((p) => this.alive(p));
        const counts = { online: all.filter((p) => this.isOnline(p.who)).length, away: all.filter((p) => !this.isOnline(p.who) && !p.asleep).length, asleep: all.filter((p) => p.asleep).length };
        return reply({ t: 'adminList', feedback, reports, online, banned: this.admin.banned, counts });
      }
      case 'a.delete': { // delete one feedback note or report
        const key = m.list === 'reports' ? 'reports' : 'feedback';
        const list = (await this.ctx.storage.get(key)) || [];
        await this.ctx.storage.put(key, list.filter((x) => x.at !== m.at));
        return done('Deleted');
      }
      case 'a.announce': {
        const text = starText(clean(m.text, 140).trim(), FILTER);
        if (text) this.send({ t: 'announce', text }, null);
        return done('Message sent');
      }
      case 'a.kick': case 'a.ban': {
        if (!them && !sock) return done("They've left");
        if (sock && sock.p.admin) return done("That's you");
        if (m.t === 'a.ban' && !this.admin.banned.includes(m.id)) { this.admin.banned.push(m.id); await this.saveAdmin(); }
        if (sock) this.boot(sock.ws, { t: m.t === 'a.ban' ? 'banned' : 'kicked' });
        return done(`${them ? them.name : 'They'} ${m.t === 'a.ban' ? 'banned' : 'kicked'}`);
      }
      case 'a.unban':
        this.admin.banned = this.admin.banned.filter((x) => x !== m.who); await this.saveAdmin();
        return done('Unbanned');
      case 'a.mute': {
        const who = m.who || m.id;
        if (!who) return done("They've left");
        this.admin.muted = this.admin.muted.filter((x) => x !== who);
        if (m.on) this.admin.muted.push(who);
        await this.saveAdmin();
        return done(m.on ? 'Muted for everyone' : 'Unmuted for everyone');
      }
      case 'a.fill': // top up someone's needs
        if (!this.alive(them)) return done("They've gone");
        this.catchUp(them);
        for (const s of G.needs) them.stats[s.id] = 100;
        them.statsAt = Date.now();
        this.touch(them); await this.flush();
        this.tell(them.who, this.mine(them));
        return done(`${them.name} fed and watered`);
      case 'a.wake': // a sleeper gets up and starts another day away
        if (!this.alive(them) || !them.asleep) return done("They're not asleep");
        Object.assign(them, { asleep: false, leftAt: Date.now(), simAt: Date.now(), statsAt: Date.now(), plan: null, home: [them.x, them.z] });
        this.touch(them); await this.flush();
        this.send({ t: 'state', id: them.who, state: 'away', x: num(them.x), z: num(them.z) }, null);
        return done(`${them.name} woke up`);
      case 'a.sleep': // send someone away to sleep now (for testing)
        if (!this.alive(them) || sock) return done('Only for people who are away');
        Object.assign(them, { asleep: true, sleepAt: Date.now(), plan: null });
        this.touch(them); await this.flush();
        this.send({ t: 'state', id: them.who, state: 'asleep', x: num(them.x), z: num(them.z) }, null);
        return done(`${them.name} is asleep`);
      case 'a.removePerson': // take someone out of the world; their things drop where they are
        if (!this.alive(them)) return done("They've gone");
        if (sock) return done("They're playing right now");
        them.state = 'gone'; them.diedAt = Date.now();
        this.spill(them);
        this.touch(them); await this.flush();
        this.send({ t: 'leave', id: them.who }, null);
        return done(`${them.name} removed`);
      case 'a.speed': { // needs run x times faster for a few minutes, to test people looking after themselves
        const x = Math.max(1, Math.min(600, Number(m.x) || 1));
        for (const p of this.persons.values()) this.catchUp(p);
        this.speed = x > 1 ? { x, until: Date.now() + Math.max(1, Math.min(60, Number(m.minutes) || 10)) * MINUTE } : null;
        if (this.speed) await this.ctx.storage.put('speed', this.speed); else await this.ctx.storage.delete('speed');
        this.send({ t: 'speed', speed: this.speed }, null);
        return done(this.speed ? `Time ${x}x faster for ${Math.round((this.speed.until - Date.now()) / MINUTE)} minutes` : 'Time back to normal');
      }
      case 'a.reset':
        this.world = null;
        await this.ctx.storage.delete('world');
        for (const { ws: s } of this.sockets()) this.boot(s, { t: 'reset' }); // everyone rejoins and the first one lays it out fresh
        return;
      case 'a.add': {
        if (!w || !kindOk(m.kind)) return;
        const item = { id: w.nextId++, kind: m.kind, x: num(m.x), z: num(m.z), rot: num(Math.random() * Math.PI) };
        w.items.push(item);
        await this.save();
        this.send({ t: 'added', items: [item] }, null);
        return;
      }
      case 'a.remove': {
        if (!w) return;
        const i = w.items.findIndex((it) => it.id === m.id);
        if (i < 0) return;
        w.items.splice(i, 1);
        await this.save();
        this.send({ t: 'gone', id: m.id }, null);
        return;
      }
    }
  }
}

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
