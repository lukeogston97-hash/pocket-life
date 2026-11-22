// Away: while a player is gone their person looks after themselves (strolls, eats, drinks, picks berries, sleeps), played forward to now.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, MINUTE, advanceStats, addCarry, applyGives, eatOne, posAt, dist, sleepMs, spend, num, AWAY, pickRandom, isNight, morningAfter } from './shared.js';

export const awayMethods = {
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
      if (until >= sleepAt) { // a day away: lie down and sleep (hunger and thirst drop slowly to a floor)
        p.plan = null; p.sit = null; p.asleep = true; p.sleepAt = sleepAt; p.log.slept = true;
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
  },
  arrive(p, plan, t) {
    if (plan.kind === 'sit') { // sat by the fire for as long as they were asked to: up again
      this.standUp(p, plan.arrive > Date.now() - 30000);
      return;
    }
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
  },
  // what to do next: eat if hungry, then water, then berries, otherwise potter about near home
  decide(p, t, now, L) {
    while (p.stats.hunger != null && p.stats.hunger < AWAY.eatBelow && eatOne(p, G)) p.log.ate++;
    const at = [p.x, p.z];
    // sitting by a fire (a task they left running): they stay sat there while the fire is lit
    const out = p.sit ? this.fireOutAt(p.sit.fire, t) : 0;
    if (p.sit && p.sit.until > t && out > t) { p.plan = { kind: 'sit', start: t, arrive: Math.min(p.sit.until, out) }; return; }
    if (p.sit) this.standUp(p, false);
    // night: off to bed until morning. Tired (or already lying down): sleep where they are until rest is full
    const night = isNight(t, G);
    if (night || p.sleeping || (p.stats.rest != null && p.stats.rest < AWAY.sleepBelow)) {
      const was = p.sleeping;
      p.sleeping = true;
      const fast = this.speed && t < this.speed.until ? this.speed.x : 1;
      p.plan = { kind: 'sleep', start: t, arrive: night ? t + (morningAfter(t, G) - t) / fast : t + sleepMs(p, G) / fast };
      if (!was) p.log.slept = true;
      if (!was && p.plan.arrive > now) this.send({ t: 'state', id: p.who, state: 'sleeping', x: num(p.x), z: num(p.z) }, null);
      return;
    }
    const walk = (to, extra) => {
      const ms = (dist(at, to) / AWAY.strollSpeed) * 1000 + 500;
      p.plan = { kind: 'walk', from: at, to: [num(to[0]), num(to[1])], start: t, arrive: t + ms, ...extra };
      spend(p, 'walkPerMetre', G, dist(at, to));
      if (p.plan.arrive > now) this.send({ t: 'stroll', id: p.who, x: p.plan.to[0], z: p.plan.to[1], speed: AWAY.strollSpeed, ms: Math.round(p.plan.arrive - now), then: extra && extra.then }, null);
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
  },
};
