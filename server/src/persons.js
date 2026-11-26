// People: what everyone is told about a person, what the player is told about their own, catching their needs up, collapsing, dying.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, advanceStats, posAt, num, AWAY, REST, ageOf, wearList, laidNow, barOf } from './shared.js';

// a name as it's compared with others: capitals, extra spaces and look-alike forms of the same letters don't count
const nameKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export const personsMethods = {
  // Leave the world for good (Settings): their things drop where they stand, they leave their camp (the usual rules: the
  // member who joined first leads, the last one out puts the fire out), and their person, past people, feedback and links
  // to other devices are removed. A ban stays (the ban list isn't touched). The admin's Log says someone left, with no name.
  async forget(who, ws, me, why = 'left') { // why 'link': their guest person, removed as this device was linked to another person
    const p = this.persons.get(who);
    if (this.alive(p)) { this.catchUp(p); if (this.alive(p)) this.spill(p); }
    if (p) this.send({ t: 'leave', id: who }, null);
    for (const s of this.sockets()) if (s.p.who === who && s.ws !== ws) { s.p.alive = false; s.p.who = null; this.attach(s.ws, s.p); this.boot(s.ws, { t: 'elsewhere' }); }
    this.persons.delete(who); this.dirty.delete(who); this.later.delete(who); this.savedAt.delete(who);
    if (me.who === who) { Object.assign(me, { id: `w:${crypto.randomUUID().slice(0, 8)}`, who: null, self: null, watch: true, alive: false }); this.attach(ws, me); }
    const soc = this.socOf(who);
    if (soc) { const mem = soc.members.find((x) => x.who === who); if (mem) mem.name = 'Someone'; await this.socOut(soc, who, 'left'); }
    await this.ctx.storage.delete([`p:${who}`, `past:${who}`]);
    this.use('writes', 2);
    const acc = this.accountOf(who); // linked: the link goes too, and every other device linked to them is a guest again
    if (acc) { this.dropAccount(acc.acct); await this.saveAccounts(); }
    const fb = (await this.ctx.storage.get('feedback')) || [], kept = fb.filter((x) => x.who !== who);
    if (kept.length !== fb.length) await this.put('feedback', kept);
    this.note('world', why === 'link' ? "Someone's guest person was removed as they linked to another device" : 'Someone left the world for good');
    this.sendCount();
  },
  alive(p) { return p && p.state === 'alive'; },
  // Names are one of a kind (Luke, 25 Nov 2026): nobody can take a name a person in the world already has, whether
  // they're playing, away or asleep. "Luke" and "luke " are the same name. The dead, people who left the world and
  // banned players don't hold theirs. except: the person being named (renaming someone to their own name in capitals).
  nameTaken(name, except = null) {
    const key = nameKey(name);
    for (const p of this.persons.values()) if (p.who !== except && this.alive(p) && !this.admin.banned.includes(p.who) && nameKey(p.name) === key) return true;
    return false;
  },
  isOnline(who) { const s = this.socketOf(who); return !!(s && s.p.alive); }, // (socketOf prefers the connection still playing them)
  // online, away, asleep (a day away: needs drop slowly to a floor) or sleeping (resting, by choice or when tired)
  stateOf(p) { return p.asleep && !this.isOnline(p.who) ? 'asleep' : p.sleeping ? 'sleeping' : this.isOnline(p.who) ? 'online' : 'away'; },
  // what everyone else is told about a person
  pub(p, now = Date.now()) {
    const state = this.stateOf(p);
    const [x, z] = state === 'away' ? posAt(p, now) : [p.x, p.z];
    const out = { id: p.who, name: p.name, look: { ...p.look, age: ageOf(p, now) }, x: num(x), z: num(z), ry: num(p.ry), state };
    if (p.sit && p.sit.until > now) out.sit = [p.sit.fire, p.sit.seat]; // sitting by a fire
    const soc = this.socTagName(p.who);
    if (soc) out.soc = soc; // their society, shown under their name tag once it has 2 or more people (societies.js)
    if (state === 'away' && p.plan && p.plan.kind === 'walk' && p.plan.arrive > now) Object.assign(out, { tx: p.plan.to[0], tz: p.plan.to[1], speed: AWAY.strollSpeed, ms: Math.round(p.plan.arrive - now) });
    return out;
  },
  people(except) { return [...this.persons.values()].filter((p) => this.alive(p) && p.who !== except).map((p) => this.pub(p)); },
  // what the player is told about their own person
  mine(p) {
    p.seen = p.seen || []; // everything they've ever carried (recipes used to show from this; kept for hints later)
    for (const k of Object.keys(p.carry || {})) if (!p.seen.includes(k)) p.seen.push(k);
    return { t: 'me', seen: p.seen, found: p.found || [], name: p.name, look: p.look, age: ageOf(p), born: p.born, x: num(p.x), z: num(p.z), ry: num(p.ry),
      stats: p.stats, statsAt: p.statsAt, carry: p.carry, wear: p.wear || {}, lastKind: p.lastKind, sleeping: !!p.sleeping, collapsed: !!p.collapsed,
      bar: barOf(p, G), // the tools on the tool bar (0.1.17). (A comment here once hid sleeping and collapsed, 0.1.17 to 0.1.20 test 1: Sleep got you straight back up.)
      sit: p.sit && p.sit.until > Date.now() ? { fire: p.sit.fire, seat: p.sit.seat, ms: p.sit.until - Date.now() } : null,
      soc: this.socView(p.who) }; // their society: name, leader, members (societies.js)
  },
  // Maintenance pauses everyone who isn't playing (release-link players are shut out, so it shouldn't cost them anything):
  // their needs, strolls, the day-asleep and 3-days-gone timers all stop, and carry on from where they were afterwards.
  paused(p) { return !!this.admin.maintenance && !this.isOnline(p.who); },
  // their clocks moved on past the pause: from when maintenance began (or when they stopped playing, if that was later) to now.
  // Called when they come back during maintenance, and for everyone not playing when it ends.
  thaw(p, now = Date.now()) {
    if (!this.admin.maintenance || !this.alive(p)) return;
    const d = now - Math.max(this.admin.maintAt || now, p.leftAt || 0);
    if (!(d > 0)) return;
    for (const k of ['statsAt', 'simAt', 'leftAt', 'sleepAt']) if (p[k]) p[k] += d;
    if (p.plan) { p.plan.start += d; p.plan.arrive += d; }
    this.touch(p);
  },
  catchUp(p, now = Date.now()) {
    if (!this.alive(p) || this.paused(p)) return;
    if (p.asleep && !this.isOnline(p.who)) { advanceStats(p, now, G, this.speed, AWAY.asleepFloor); return; } // asleep away: slowly down to the floor, can't die
    if (this.isOnline(p.who) || !p.leftAt) { const d = advanceStats(p, now, G, this.speed); if (d) this.die(p, d.cause, false); else this.collapse(p); }
    else this.advanceAway(p, now);
  },
  // Rest ran out (collapseAtZero): they drop asleep where they stand, and can't get up until it's back to wakeAt
  collapse(p) {
    if (!REST || !REST.collapseAtZero || p.sleeping || !(p.stats.rest <= 0)) return;
    p.sleeping = true; p.collapsed = true; p.sleptAt = Date.now();
    this.standUp(p); // (sat by a fire: they drop asleep there, no longer sitting)
    this.touch(p);
    this.send({ t: 'state', id: p.who, state: 'sleeping', x: num(p.x), z: num(p.z) }, p.who);
    this.tell(p.who, this.mine(p));
  },
  // a person dies: their things drop where they fell and a small grave marks the spot for a day
  die(p, cause, away) {
    const w = this.world;
    p.state = 'dead';
    p.cause = cause;
    p.diedAt = Date.now();
    p.diedAway = !!away;
    this.note('world', `${p.name} died${away ? ' while away' : ''}${cause ? `: ${cause}` : ''}`);
    p.plan = null;
    p.sit = null;
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
      s.p.alive = false; this.attach(s.ws, s.p);
      try { s.ws.send(JSON.stringify({ t: 'died', name: p.name, age: ageOf(p), cause, away: false, had: false })); } catch (err) { /* gone */ }
    }
  },
  // everything they carried goes on the ground round where they are
  spill(p) {
    const w = this.world;
    const out = [];
    let i = 0;
    for (const [kind, n] of Object.entries(p.carry || {})) {
      const full = (G.items[kind] || {}).uses, worn = full ? wearList(p, kind, G) : []; // tools keep their wear on the ground
      for (let k = 0; k < n && i < 200; k++, i++) {
        const a = i * 2.39996, r = 0.3 + Math.sqrt(i) * 0.16;
        const item = { id: w ? w.nextId++ : 0, kind, x: num(p.x + Math.cos(a) * r), z: num(p.z + Math.sin(a) * r), rot: num(Math.random() * Math.PI), laid: laidNow() };
        if (worn[k] < full) item.uses = worn[k];
        out.push(item);
      }
    }
    p.hadThings = out.length > 0;
    p.carry = {};
    p.wear = {};
    p.bar = {};
    p.lastKind = null;
    if (w && out.length) { w.items.push(...out); this.save(); this.send({ t: 'added', items: out }, null); }
  },
  // Starting up: items taken out of the game (game-data.json "retired", Luke 26 Nov 2026: twigs) that are still in someone's
  // inventory or on the ground become what it says (another item, or null: just gone), so the game and the server never
  // meet a thing they don't know. Runs every time the world starts, so an earlier time restored is tidied too.
  // Returns the people who changed and whether the world did, to be saved.
  retireOld() {
    const into = {};
    for (const [old, to] of Object.entries(G.retired || {})) if (!Object.hasOwn(G.items, old)) into[old] = to && Object.hasOwn(G.items, to) ? to : null;
    const people = [];
    let world = false;
    if (!Object.keys(into).length) return { people, world };
    for (const p of this.persons.values()) {
      let changed = false;
      for (const [old, to] of Object.entries(into)) {
        const n = (p.carry || {})[old];
        if (n === undefined) continue;
        delete p.carry[old];
        if (to && n > 0) p.carry[to] = (p.carry[to] || 0) + n;
        if (p.wear) delete p.wear[old];
        if (p.bar) delete p.bar[old];
        changed = true;
      }
      const found = Array.isArray(p.found) ? p.found.filter((id) => Object.hasOwn(G.recipes || {}, id)) : null; // (the recipe that made it went too)
      if (found && found.length !== p.found.length) { p.found = found; changed = true; }
      if (Object.hasOwn(into, p.lastKind)) { p.lastKind = into[p.lastKind] && p.carry[into[p.lastKind]] ? into[p.lastKind] : Object.keys(p.carry || {})[0] || null; changed = true; }
      if (changed) people.push(p);
    }
    const w = this.world;
    if (w && Array.isArray(w.items) && w.items.some((it) => Object.hasOwn(into, it.kind))) {
      w.items = w.items.filter((it) => !Object.hasOwn(into, it.kind) || into[it.kind]);
      for (const it of w.items) if (Object.hasOwn(into, it.kind)) { it.kind = into[it.kind]; delete it.uses; }
      world = true;
    }
    return { people, world };
  },
};
