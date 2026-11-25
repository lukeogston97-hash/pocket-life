// Pocket Life server: one Durable Object holds the whole world.
// - the shared world: things on the ground, trees, berry bushes, tall grass, graves (nature.js)
// - every person: needs, inventory and where they are, kept here so they stay in the world 24/7 (persons.js)
// - while a player is away their person looks after themselves; after a day away they lie down asleep (needs
//   pause), and after another day asleep they're gone (away.js)
// - at most G.maxPlaying people play at once; anyone else waits in line on the main menu (line.js)
// - things people place and build, like campfires (placed.js)
// - what players do, one small handler each (actions.js); chat, reports, feedback; the admin player's tools (admin.js)
// - societies: groups of players sharing one claim (societies.js)
// - Restore: the admin puts the whole world back to an earlier time with Cloudflare's 30 days of history (restore.js)
// What every part shares (the game's rules from game.json, limits, helpers) is in shared.js.
import { DurableObject } from 'cloudflare:workers';
import { WORLDS, G, HOUR, MINUTE, PROTOCOL, CORS, clean, num, AWAY, tooOld, FEEDBACK_KEEP, lastHeard, QUIET_MS, TICK_MS, SAVE_EVERY, AWAY_SAVE_EVERY, FREE, allowed, tagOf, ageOf } from './shared.js';
import { lineMethods } from './line.js';
import { personsMethods } from './persons.js';
import { awayMethods } from './away.js';
import { natureMethods } from './nature.js';
import { adminMethods } from './admin.js';
import { placedMethods } from './placed.js';
import { liveMethods, maxPlaying } from './live.js';
import { liveItemsMethods } from './live-items.js';
import { claimsMethods } from './claims.js';
import { societiesMethods, freshSocieties } from './societies.js';
import { restoreMethods } from './restore.js';
import { guardMethods } from './guard.js';
import { activityMethods, BACK_AFTER, longText } from './activity.js';
import { taskMethods } from './tasks.js';
import { ACTIONS } from './actions.js';

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.world = null;
    this.persons = new Map(); // who -> person
    this.dirty = new Set();
    this.later = new Set(); // people away whose walk or needs moved on but nothing lasting changed: saved now and then (touchLater)
    this.errorsNoted = new Map(); // server errors already put in the admin's Inbox this hour (noteError)
    this.savedAt = new Map(); // who -> when they were last saved
    this.usage = { day: '', messages: 0, connections: 0, writes: 0, alarms: 0 }; // today's use of the free plan (UTC days)
    this.speed = null; // the admin's "speed up time": { x, until }
    this.admin = { maintenance: false, message: '', banned: [], muted: [] }; // set by the admin player in the game
    this.live = {}; // live settings the admin changed (live.js)
    this.liveItems = {}; // item and recipe numbers the admin changed (live-items.js)
    this.activity = []; // the admin's activity log (activity.js)
    this.societies = freshSocieties(); // groups of players sharing a claim (societies.js)
    this.adminFails = new Map(); // wrong admin codes, by address (guard.js); kept in memory only
    this.work = new Map(); // who -> the seconds of work they've earned for things that take time (guard.js worked); kept in memory only
    this.feedbackLog = []; // when feedback came in and from where, to stop floods (guard.js)
    this.reportLog = []; // the same for reports about players
    this.socks = null; this.byWho = null; // who's connected, worked out once per message or tick (sockets, socketOf)
    this.restoring = false; // a restore is on its way (restore.js)
    ctx.blockConcurrencyWhile(async () => {
      this.world = (await ctx.storage.get('world')) || null;
      Object.assign(this.admin, (await ctx.storage.get('admin')) || {});
      this.speed = (await ctx.storage.get('speed')) || null;
      this.live = (await ctx.storage.get('live')) || {};
      this.applyLive();
      this.liveItems = (await ctx.storage.get('liveItems')) || {};
      this.applyLiveItems();
      this.activity = (await ctx.storage.get('activity')) || [];
      this.societies = (await ctx.storage.get('societies')) || freshSocieties();
      Object.assign(this.usage, (await ctx.storage.get('usage')) || {});
      for (const [k, p] of await ctx.storage.list({ prefix: 'p:' })) this.persons.set(k.slice(2), p);
      if (this.world && this.socTidy()) { await this.put('world', this.world); await this.saveSocs(); } // (claims from before 0.1.5 become societies: societies.js)
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + TICK_MS);
    });
  }

  /* ---------- storage and sending ---------- */
  // every storage write goes through here, so today's use can be counted
  put(key, value) { this.use('writes'); return this.ctx.storage.put(key, value); }
  save() { return this.put('world', this.world); }
  saveAdmin() { return this.put('admin', this.admin); }
  touch(p) { this.dirty.add(p.who); }
  // someone away who only walked on or whose needs ticked over: the server can play that forward again from their last
  // save, so they're saved at most every AWAY_SAVE_EVERY instead of every SAVE_EVERY
  touchLater(p) { if (!this.dirty.has(p.who)) this.later.add(p.who); }
  // Save people who changed: just `only` (straight after they did something), everyone changed (all), or
  // by default only those not saved for SAVE_EVERY (the world's tick: walking about, needs ticking over).
  async flush(only, all = false) {
    const now = Date.now(), batch = {};
    for (const who of [...this.dirty]) {
      if (!all && (only ? who !== only : now - (this.savedAt.get(who) || 0) < SAVE_EVERY)) continue;
      this.dirty.delete(who);
      this.later.delete(who);
      const p = this.persons.get(who);
      if (!p) continue;
      batch[`p:${who}`] = p;
      this.savedAt.set(who, now);
    }
    if (!only) for (const who of [...this.later]) { // people away with nothing lasting to save: now and then
      if (!this.savedAt.has(who)) this.savedAt.set(who, now - Math.random() * AWAY_SAVE_EVERY); // (after a restart: spread out, not all at once)
      if (!all && now - this.savedAt.get(who) < AWAY_SAVE_EVERY) continue;
      this.later.delete(who);
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
    return { requests: pct(requests, FREE.requests), writes: pct(u.writes, FREE.writes), messages: u.messages, playing: this.playing(), max: maxPlaying(), waiting: this.line().length };
  }
  /* ---------- who's connected ---------- */
  // Every connection with its attachment (who it plays, admin, watching...), worked out once and reused until something
  // changes: an attachment is saved (attach), or the next message, tick or connection starts (fresh). Until 0.3.2 every
  // "is this person online?" unpacked every connection again, so a tick cost people in the world x people online.
  // Always save an attachment with this.attach(ws, me), never ws.serializeAttachment, or the list goes stale.
  sockets() {
    if (!this.socks) this.socks = this.ctx.getWebSockets().map((ws) => ({ ws, p: ws.deserializeAttachment() })).filter(({ p }) => p && p.id);
    return this.socks;
  }
  // the connection playing someone (if two do for a moment, the one still playing them), or undefined
  socketOf(who) {
    if (!who) return undefined;
    if (!this.byWho) {
      this.byWho = new Map();
      for (const s of this.sockets()) {
        if (!s.p.who) continue;
        const had = this.byWho.get(s.p.who);
        if (!had || (!had.p.alive && s.p.alive)) this.byWho.set(s.p.who, s);
      }
    }
    return this.byWho.get(who);
  }
  attach(ws, me) { ws.serializeAttachment(me); this.fresh(); }
  fresh() { this.socks = null; this.byWho = null; }
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
    this.fresh();
    const url = new URL(request.url);
    const from = await tagOf(request.headers.get('CF-Connecting-IP') || ''); // their address, scrambled: only for the limits in guard.js
    if (url.pathname === '/feedback') { // feedback sent while not connected
      let note = {};
      try { note = JSON.parse((await request.text()).slice(0, 4000)); } catch (err) { /* ignore */ }
      await this.addFeedback(note, from);
      return new Response('ok', { headers: CORS });
    }
    this.use('connections');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.attach(server, { from });
    return new Response(null, { status: 101, webSocket: client });
  }
  async addFeedback(note, from = '') {
    const text = clean(note && note.text, 1000).trim();
    if (!text || !this.feedbackOk(from)) return; // (too many from one address: quietly dropped)
    const list = (await this.ctx.storage.get('feedback')) || [];
    // a note the game or the server sent by itself (an error): the same one again is counted, not added again
    const same = note.auto && list.find((x) => x.auto && !x.done && x.text === text);
    if (same) { same.count = (same.count || 1) + 1; same.lastAt = new Date().toISOString(); await this.put('feedback', list); return; }
    list.push({ at: new Date().toISOString(), name: clean(note.name, 20), v: clean(note.v, 30), device: clean(note.device, 200), x: num(note.x), z: num(note.z), text, ...(note.auto ? { auto: true } : {}) });
    await this.put('feedback', list.slice(-FEEDBACK_KEEP));
    this.tellAdmins({ t: 'adminNew', list: 'feedback' }); // the admin's Inbox count goes up straight away
  }
  // Something went wrong on the server: it's logged, and a note goes to the admin's Inbox (as feedback starting "Server error"),
  // each problem once an hour at most, so Luke hears about it without anyone having to report it.
  async noteError(where, err) {
    const what = `${where}: ${err && err.message ? err.message : String(err)}`.slice(0, 200), now = Date.now();
    console.error(`${what}\n`, err && err.stack ? err.stack : '');
    for (const [k, t] of this.errorsNoted) if (now - t > HOUR) this.errorsNoted.delete(k); // (an hour on, the same problem gets noted again)
    if (now - (this.errorsNoted.get(what) || 0) < HOUR || this.errorsNoted.size > 50) return;
    this.errorsNoted.set(what, now);
    const trace = String((err && err.stack) || '').split('\n').slice(1, 4).map((l) => l.trim()).join(' | ').slice(0, 300);
    try { await this.addFeedback({ auto: true, text: `Server error (${what})${trace ? `\n${trace}` : ''}`, name: 'The server', v: (WORLDS.minVersion || {}).test || '' }, 'server'); } catch (e) { /* storage trouble: it's in the log */ }
  }
  // The admin (Luke) is never a person in the world: it's a connection that only watches (admin mode in the game, opened
  // from the main menu with the admin code). A connection playing someone is never the admin, whatever it says.
  isAdmin(me) { return !!(me && me.admin && me.watch && !me.who); }
  tellAdmins(msg) {
    const text = JSON.stringify(msg);
    for (const { ws, p } of this.sockets()) if (this.isAdmin(p)) { try { ws.send(text); } catch (err) { /* gone */ } }
  }

  async webSocketMessage(ws, raw) {
    this.fresh();
    let m;
    try { m = JSON.parse(raw); } catch (err) { return; }
    if (!m || typeof m.t !== 'string') return;
    lastHeard.set(ws, Date.now());
    this.use('messages');
    if (m.t === 'ping') return;
    if (this.restoring) return; // a restore is on its way and the world restarts in a moment, so nothing else is done (restore.js)
    const me = ws.deserializeAttachment() || {};
    // Nobody playing a person is ever the admin. A connection from before admin moved out of the game (23 Nov 2026) could
    // still carry the old flag, so it's dropped here, before anything reads it (the reach, claim and name checks in actions.js).
    if (me.admin && !this.isAdmin(me)) { me.admin = false; this.attach(ws, me); }
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    if (m.t === 'hello') { if (me.id && !allowed(ws, me, 'hello')) { reply({ t: 'slow' }); return; } await this.hello(ws, me, m, reply); return; }
    if (m.t === 'bye') { try { ws.close(1000, 'bye'); } catch (err) { /* gone */ } this.webSocketClose(ws); return; }
    if (!me.id) return;
    const isAdmin = this.isAdmin(me);
    // on the main menu: only watching the world. The admin (who also only watches) can use their tools, and their game can
    // send the layout and lay out a brand new world: after a reset there may be no player about to do it, and the admin
    // would be looking at what's left of the old one.
    if (me.watch && m.t !== 'feedback' && !(isAdmin && (m.t.startsWith('a.') || m.t === 'layout' || m.t === 'seed'))) return;
    if (!allowed(ws, me, m.t)) {
      if (m.t === 'take') reply({ t: 'took', id: m.id, ok: false });
      else if (m.t === 'pick') reply({ t: 'picked', bush: m.bush, ok: false });
      else if (m.t !== 'move') reply({ t: 'slow' });
      return;
    }
    const w = this.world;
    const p = this.persons.get(me.who);
    const save = () => { this.touch(p); this.flush(p.who); }; // what they did is saved straight away
    if (m.t.startsWith('a.')) { if (isAdmin) await this.adminDo(ws, me, m); return; } // the admin's tools (admin.js)
    const action = Object.hasOwn(ACTIONS, m.t) ? ACTIONS[m.t] : null; // everything else (actions.js); only its own handlers, nothing every object has
    if (!action) return;
    if (action.when !== 'any') {
      if (!this.alive(p)) return;
      this.catchUp(p);
      if (!this.alive(p) || (action.when === 'world' && !w)) return;
    }
    try {
      await action.run.call(this, { ws, me, m, p, w, reply, save });
    } catch (err) { // one action going wrong never takes the world down: it's noted, and their game gets their person as the server has them
      await this.noteError(`the action "${clean(m.t, 20)}"`, err);
      try { if (this.alive(p)) reply(this.mine(p)); } catch (e) { /* gone */ }
    }
  }

  async hello(ws, me, m, reply) {
    if (m.proto !== PROTOCOL) { this.boot(ws, { t: 'maintenance', text: 'A big update is on its way.' }); return; } // an older game
    const link = m.link === 'test' ? 'test' : 'release';
    const min = (WORLDS.minVersion || {})[link];
    const asksAdmin = !!m.watch && !!m.admin && !!m.adminCode; // admin mode: watching only, never while playing a person
    const isAdmin = asksAdmin && !this.adminLocked(me) && this.codeOk(m.adminCode);
    if (m.adminCode && !isAdmin) { // too many wrong codes from one address and it has to wait (guard.js)
      const locked = this.adminLocked(me), wrong = locked || !this.codeOk(m.adminCode); // (the right code sent while playing is refused too, but isn't a wrong password)
      this.adminFail(me);
      if (wrong) this.note('guard', locked ? 'Admin password tried from an address that is locked out' : this.adminLocked(me) ? 'Wrong admin password 5 times: that address is locked out for 15 minutes' : 'Wrong admin password');
      reply({ t: 'adminNo' }); // said before anything below can send the game away (maintenance, an update), so it never keeps trying a refused password
    }
    const who = await this.whoFor(m);
    if (!isAdmin && this.admin.banned.includes(who)) { this.boot(ws, { t: 'banned' }); return; }
    if (!isAdmin && this.admin.maintenance && link !== 'test') { this.boot(ws, { t: 'maintenance', text: this.admin.message }); return; }
    if (min && tooOld(m.v, m.b, min, m.e, (WORLDS.era || {})[link])) { this.boot(ws, { t: 'update', min }); return; }
    if (me.who) this.leave(ws, me); // was playing on this connection (Exit to the main menu): their person goes away
    // the world is full: watch from the main menu and wait in line (the admin always gets in)
    const full = !m.watch && !isAdmin && !this.mayPlay(ws, me, who);
    if (m.watch || full) { // the main menu: watch the world go by without a person
      const queued = full ? me.queued || Date.now() : 0;
      Object.assign(me, { id: me.watch && me.id ? me.id : `w:${crypto.randomUUID().slice(0, 8)}`, who: null, watch: true, queued, turnAt: 0, admin: isAdmin, v: clean(m.v, 20), b: Math.floor(Number(m.b)) || 0, e: Math.floor(Number(m.e)) || 0, link, alive: false });
      this.attach(ws, me);
      const p = this.persons.get(who);
      reply({ t: 'welcome', watch: true, id: me.id, people: this.people(null), world: this.view(), count: this.playing(), speed: this.speed, live: this.live, liveItems: this.liveItems,
        yours: this.alive(p) ? { name: p.name, age: ageOf(p) } : null, line: full ? this.placeOf(ws) : 0, needLayout: isAdmin && this.needLayout(me), needSeed: isAdmin && !this.world });
      if (isAdmin) { reply(this.adminState(me)); this.note('admin', 'Admin mode opened'); } // admin mode is on: the panels get their numbers
      if (full) this.callLine();
      return;
    }
    me.queued = 0; me.turnAt = 0;
    // the same phone in another tab or link: that one closes
    for (const s of this.sockets()) if (s.p.who === who && s.ws !== ws) { s.p.alive = false; this.attach(s.ws, s.p); this.boot(s.ws, { t: 'elsewhere' }); }
    Object.assign(me, { id: who, who, watch: false, admin: false, said: me.said || [], v: clean(m.v, 20), b: Math.floor(Number(m.b)) || 0, e: Math.floor(Number(m.e)) || 0, link, alive: false });
    const p = this.persons.get(who);
    let away = null, dead = null, tasks = null;
    if (p && this.alive(p)) {
      this.thaw(p); // maintenance paused them: their clocks carry on from where they stopped
      if (p.asleep) this.catchUp(p, Date.now()); // asleep away: hunger and thirst dropped slowly to the floor
      if (p.leftAt) {
        this.advanceAway(p, Date.now());
        if (this.alive(p)) {
          away = { ms: Date.now() - p.leftAt, ...(p.log || {}) };
          tasks = p.tasks = this.tasksBack(p); p.took = []; // what's left of their task list goes back to their game (tasks.js)
          if (away.ms >= BACK_AFTER) this.note('world', `${p.name} came back after ${longText(away.ms)}`);
          p.plan = null; p.asleep = false; p.sleeping = false; p.collapsed = false; p.leftAt = 0; p.log = { ate: 0, drank: 0, picked: 0 }; // back: awake
          this.touch(p);
        }
      }
    }
    if (p && !this.alive(p)) {
      dead = { name: p.name, age: ageOf(p, p.diedAt || Date.now()), cause: p.cause, away: p.diedAway, gone: p.state === 'gone', had: !!p.hadThings };
      await this.rememberPast(p);
      this.persons.delete(who);
      await this.ctx.storage.delete(`p:${who}`);
    }
    if (p && this.alive(p)) me.alive = true;
    this.attach(ws, me);
    if (p) await this.flush(who);
    const w = this.world;
    reply({ t: 'welcome', id: who, people: this.people(who), world: this.view(), needSeed: !w, needLayout: this.needLayout(me),
      count: this.playing(), me: me.alive ? this.mine(p) : null, away, tasks, dead, speed: this.speed, live: this.live, liveItems: this.liveItems });
    if (me.alive) this.send({ t: 'join', person: this.pub(p) }, who);
    this.sendCount();
  }

  /* ---------- every minute: needs, people away, sleepers, graves, sticks and stones ---------- */
  async alarm() {
    this.fresh();
    if (this.restoring) { await this.ctx.storage.setAlarm(Date.now() + TICK_MS); return; } // (restore.js: the world restarts in a moment)
    const now = Date.now();
    this.use('alarms');
    try {
      // connections that have gone quiet (a phone locked, or the page closed without saying) are closed
      for (const { ws } of this.sockets()) {
        if (!lastHeard.has(ws)) { lastHeard.set(ws, now); continue; }
        if (now - lastHeard.get(ws) > QUIET_MS) { try { ws.close(1000, 'quiet'); } catch (err) { /* gone */ } this.webSocketClose(ws); }
      }
      for (const p of [...this.persons.values()]) {
        try { // (one person's record going wrong never stops everyone else's tick)
          if (!this.alive(p)) {
            await this.socGone(p, now); // no person in the world for too long: out of their society (societies.js)
            if (p.diedAt && now - p.diedAt > 30 * 24 * HOUR) { await this.rememberPast(p); this.persons.delete(p.who); await this.ctx.storage.delete(`p:${p.who}`); }
            continue;
          }
          if (this.paused(p)) continue; // maintenance: nothing happens to people who aren't playing
          if (this.isOnline(p.who)) {
            this.catchUp(p, now);
            if (this.alive(p)) this.tell(p.who, this.mine(p));
            this.touch(p);
          } else {
            if (!p.leftAt) { p.leftAt = now; p.simAt = now; p.home = [p.x, p.z]; p.log = { ate: 0, drank: 0, picked: 0 }; this.touch(p); }
            if (p.asleep) { // asleep: needs are caught up when they come back (nothing to save until they wake or go)
              if (now - p.sleepAt > AWAY.goneAfterDays * 24 * HOUR) { // asleep too long (3 days away in all): gone, their things left where they slept
                p.state = 'gone'; p.diedAt = now;
                this.note('world', `${p.name} was away too long and is gone`);
                this.spill(p);
                this.send({ t: 'leave', id: p.who }, null);
                this.touch(p);
              }
            } else { this.advanceAway(p, now); this.touchLater(p); } // (anything lasting they did was marked to save sooner: away.js)
          }
        } catch (err) { await this.noteError('the tick', err); }
      }
      if (this.world) this.claims(); // every claim's fire brought up to now: one that burnt out ends its society (claims.js claimLost)
      await this.flush(); // only people not saved for a while
      if (this.usage.alarms % 15 === 0) await this.put('usage', this.usage); // about every 5 minutes
      this.callLine();
      const w = this.world;
      if (w) {
        const keep = (w.graves || []).filter((g) => g.at > now - AWAY.graveHours * HOUR);
        if (keep.length !== (w.graves || []).length) { w.graves = keep; this.send({ t: 'graves', graves: keep }, null); await this.save(); }
        if (now >= (w.nextRespawn || 0)) await this.respawn(now);
        if (now >= (this.fadeAt || 0)) { this.fadeAt = now + HOUR; if (this.fadeOld(now)) await this.save(); } // old things left on the ground (nature.js)
        // stumps grow back into trees after a few days (removed stumps are gone for good)
        const regrow = ((G.chopping || {}).regrowDays || 3) * 24 * HOUR;
        let grew = false;
        for (const [i, st] of Object.entries(w.trees || {})) if (st[0] === 'stump' && now - st[1] > regrow) { delete w.trees[i]; this.send({ t: 'tree', idx: Number(i), state: 'tree' }, null); grew = true; }
        // mined boulders can be mined again after the same time; one broken rock comes back every rockBackHours
        const R = G.mining || {}, again = (R.regrowDays || 3) * 24 * HOUR;
        for (const [i, st] of Object.entries(w.rocks || {})) if (st[0] === 'mined' && now - st[1] > again) { delete w.rocks[i]; this.send({ t: 'rock', idx: Number(i), state: 'whole' }, null); grew = true; }
        const broken = Object.keys(w.rocks || {}).filter((i) => w.rocks[i][0] === 'gone' && !(w.removed || {})[`rock:${i}`]); // ones the admin removed stay gone
        if (!broken.length) w.nextRockBack = 0;
        else if (!w.nextRockBack) { w.nextRockBack = now + (R.rockBackHours || 4) * HOUR; grew = true; }
        else if (now >= w.nextRockBack) {
          const i = broken[Math.floor(Math.random() * broken.length)];
          delete w.rocks[i];
          this.send({ t: 'rock', idx: Number(i), state: 'whole' }, null);
          w.nextRockBack = broken.length > 1 ? now + (R.rockBackHours || 4) * HOUR : 0;
          grew = true;
        }
        if (grew) await this.save();
      }
      for (const [k, list] of this.adminFails) if (!list.some((t) => now - t < 15 * MINUTE)) this.adminFails.delete(k); // old wrong-code counts are forgotten
      if (this.speed && now > this.speed.until) { this.speed = null; await this.ctx.storage.delete('speed'); this.send({ t: 'speed', speed: null }, null); }
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  webSocketClose(ws) {
    this.fresh(); // (a connection has gone)
    const me = ws.deserializeAttachment();
    if (!me || !me.id) return; // not joined, or already handled
    if (!me.who) { me.id = null; this.attach(ws, me); return; } // a watcher on the main menu
    this.leave(ws, me);
  }
  // someone stops playing (closed the game, or Exit to the main menu): their person goes away and looks after themselves
  leave(ws, me) {
    const who = me.who, wasAlive = me.alive;
    me.id = null; me.who = null; me.alive = false; // this connection no longer plays them
    this.attach(ws, me);
    const p = this.persons.get(who);
    if (wasAlive && this.alive(p) && !this.socketOf(who)) { // away now: they start looking after themselves
      p.leftAt = Date.now(); p.simAt = p.leftAt; p.statsAt = Math.min(p.statsAt, p.leftAt);
      p.home = [p.x, p.z]; p.asleep = false; p.wanderNext = true; p.log = { ate: 0, drank: 0, picked: 0 }; p.took = []; // (p.tasks: what's left of their task list, carried on with while they're away: tasks.js)
      // they stay put for a few seconds (away.comeBackSeconds), so a short break in the connection changes nothing; then off for a stroll
      p.plan = { kind: 'idle', start: p.leftAt, arrive: p.leftAt + (AWAY.comeBackSeconds || 0) * 1000 };
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
Object.assign(World.prototype, lineMethods, personsMethods, awayMethods, natureMethods, adminMethods, placedMethods, liveMethods, liveItemsMethods, claimsMethods, societiesMethods, guardMethods, restoreMethods, activityMethods, taskMethods);

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
