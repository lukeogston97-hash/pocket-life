// People: what everyone is told about a person, what the player is told about their own, catching their needs up, collapsing, dying.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, advanceStats, posAt, num, AWAY, REST, ageOf } from './shared.js';

export const personsMethods = {
  alive(p) { return p && p.state === 'alive'; },
  isOnline(who) { return !!who && !!this.sockets().find(({ p }) => p.who === who && p.alive); },
  // online, away, asleep (a day away: needs drop slowly to a floor) or sleeping (resting, by choice or when tired)
  stateOf(p) { return p.asleep && !this.isOnline(p.who) ? 'asleep' : p.sleeping ? 'sleeping' : this.isOnline(p.who) ? 'online' : 'away'; },
  // what everyone else is told about a person
  pub(p, now = Date.now()) {
    const s = this.socketOf(p.who), state = this.stateOf(p);
    const [x, z] = state === 'away' ? posAt(p, now) : [p.x, p.z];
    const out = { id: p.who, name: p.name, look: { ...p.look, age: ageOf(p, now) }, x: num(x), z: num(z), ry: num(p.ry), state, badge: !!(s && s.p.admin && s.p.tag) };
    if (state === 'away' && p.plan && p.plan.kind === 'walk' && p.plan.arrive > now) Object.assign(out, { tx: p.plan.to[0], tz: p.plan.to[1], speed: AWAY.strollSpeed, ms: Math.round(p.plan.arrive - now) });
    return out;
  },
  people(except) { return [...this.persons.values()].filter((p) => this.alive(p) && p.who !== except).map((p) => this.pub(p)); },
  // what the player is told about their own person
  mine(p) {
    return { t: 'me', name: p.name, look: p.look, age: ageOf(p), born: p.born, x: num(p.x), z: num(p.z), ry: num(p.ry),
      stats: p.stats, statsAt: p.statsAt, carry: p.carry, wear: p.wear || {}, lastKind: p.lastKind, sleeping: !!p.sleeping, collapsed: !!p.collapsed };
  },
  catchUp(p, now = Date.now()) {
    if (!this.alive(p)) return;
    if (p.asleep && !this.isOnline(p.who)) { advanceStats(p, now, G, this.speed, AWAY.asleepFloor); return; } // asleep away: slowly down to the floor, can't die
    if (this.isOnline(p.who) || !p.leftAt) { const d = advanceStats(p, now, G, this.speed); if (d) this.die(p, d.cause, false); else this.collapse(p); }
    else this.advanceAway(p, now);
  },
  // Rest ran out (collapseAtZero): they drop asleep where they stand, and can't get up until it's back to wakeAt
  collapse(p) {
    if (!REST || !REST.collapseAtZero || p.sleeping || !(p.stats.rest <= 0)) return;
    p.sleeping = true; p.collapsed = true;
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
      try { s.ws.send(JSON.stringify({ t: 'died', name: p.name, age: ageOf(p), cause, away: false, had: false })); } catch (err) { /* gone */ }
    }
  },
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
  },
};
