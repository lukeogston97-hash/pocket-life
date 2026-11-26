// Away: while a player is gone their person carries on with their task list (tasks.js) and looks after themselves (strolls,
// eats, drinks, picks berries, sleeps), played forward to now.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, MINUTE, advanceStats, addCarry, takeCarry, applyGives, eatOne, posAt, dist, sleepMs, spend, num, AWAY, pickRandom, isNight, morningAfter } from './shared.js';
import { fireRule } from './placed.js';
import { CLAIM_R } from './claims.js';

const SIT_CHECK = 15 * MINUTE; // sitting by a fire while away: how often they see whether they need anything

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
    if (plan.then === 'task') { if (plan.kind === 'work') this.finishTask(p, t); return; } // a task on their list: done now (tasks.js); walked over: decide starts it
    if (plan.kind === 'sit') return; // a while by the fire: decide() sees if they stay sat there (still lit, nothing needed) or get up
    if (plan.kind === 'sleep') { // rested: up again
      p.sleeping = false;
      if (plan.arrive > Date.now() - 30000) this.send({ t: 'state', id: p.who, state: 'away', x: num(p.x), z: num(p.z) }, null);
      this.touch(p);
      return;
    }
    if (plan.then === 'drink') {
      const src = G.sources[plan.source];
      for (let n = 0; n < 8 && src && p.stats.thirst != null && p.stats.thirst < 95; n++) { applyGives(p, src.gives); spend(p, 'drink', G); p.log.drank++; }
    } else if (plan.then === 'feed') this.feedFire(p); // (saves them itself if anything went on the fire)
    else if (plan.then === 'pick') {
      let got = 0;
      for (; got < 4 && this.berriesOn(plan.bush, t) > got; got++) {
        if (!addCarry(p, G.berryKind, 1, G)) break;
        spend(p, 'harvest', G);
        p.log.picked++;
      }
      if (got) { this.takeBerries(plan.bush, got, t); this.touch(p); } // the bush changed with their bag: saved soon, together
    }
    // (a plain walk or a drink: nothing lasting, so no save is asked for here; the tick asks for one now and then)
  },
  // their claim's fire, and whether there's room in it for something they carry (biggest fuel first): [fire, kind] or null.
  // least: the room there has to be before it's worth walking over (so they don't go back and forth for every stick)
  fireToFeed(p, least = 30 * MINUTE) {
    const th = this.claimOf(p.who), f = th && fireRule(th.kind);
    if (!f) return null;
    const room = f.max - this.burn(th).fuel;
    const kind = Object.keys(f.fuels).filter((k) => p.carry[k] > 0 && Math.max(f.fuels[k], least) <= room).sort((a, b) => f.fuels[b] - f.fuels[a])[0];
    return kind ? [th, kind] : null;
  },
  // is there a bush with berries on it they may pick (not in someone else's camp)? (hungry with tasks to do: berries first if there are any)
  ripeBushNear(p, at, t) {
    const L = this.world && this.world.layout;
    return !!(L && L.bushes.some((b, i) => !(this.world.removed || {})[`bush:${i}`] && !this.notYours(p, b[0], b[1]) && this.berriesOn(i, t) > 0));
  },
  // put everything that fits on their claim's fire from their bag (logs first, then sticks)
  feedFire(p) {
    let fed = 0;
    for (let guard = 0; guard < 60; guard++) {
      const got = this.fireToFeed(p, 0);
      if (!got) break;
      const [th, kind] = got, f = fireRule(th.kind);
      if (Math.hypot(th.x - p.x, th.z - p.z) > 4) break;
      takeCarry(p, kind, 1);
      th.fuel = Math.min(f.max, th.fuel + f.fuels[kind]); th.at = Date.now();
      fed++;
    }
    if (!fed) return;
    p.log.fed = (p.log.fed || 0) + fed;
    this.save();
    const th = this.claimOf(p.who);
    if (th) this.sendPlaced(th, null);
    this.touch(p);
  },
  // what to do next: eat if hungry, then water, then berries, then the next thing on their task list (tasks.js), then keep
  // their claim's fire going, otherwise potter about near home
  decide(p, t, now, L) {
    while (p.stats.hunger != null && p.stats.hunger < AWAY.eatBelow && eatOne(p, G)) p.log.ate++;
    const at = [p.x, p.z];
    // what they need first: bed (night once their task list is done, tired, or already lying down), a drink, berries
    const night = isNight(t, G), working = !!(p.tasks && p.tasks.length);
    const bed = (night && !working) || p.sleeping || (p.stats.rest != null && p.stats.rest < AWAY.sleepBelow);
    const water = Object.keys(G.sources).find((k) => G.sources[k].gives && G.sources[k].water);
    const thirsty = !!(L && water && p.stats.thirst != null && p.stats.thirst < AWAY.drinkBelow && L.shore.length);
    const hungry = !!(L && p.stats.hunger != null && p.stats.hunger < AWAY.eatBelow && L.bushes.length && !(working && !this.ripeBushNear(p, at, t))); // (with tasks to do and no ripe berries: the tasks)
    // sitting by a fire (a task they left running): they stay sat there while it's lit, checked every SIT_CHECK, and get up
    // for bed, a drink or berries (0.2.1: they sat on until the fire went out, so Rest ran out and they woke up collapsed)
    const out = p.sit ? this.fireOutAt(p.sit.fire, t) : 0;
    if (p.sit && p.sit.until > t && out > t && !bed && !thirsty && !hungry) { p.plan = { kind: 'sit', start: t, arrive: Math.min(p.sit.until, out, t + SIT_CHECK) }; return; }
    if (p.sit) this.standUp(p, now - t < 30000);
    // night: off to bed until morning, once their task list is done. Tired (or already lying down): sleep where they are until rest is full
    if (bed) {
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
    if (thirsty) {
      const to = L.shore.reduce((a, b) => (dist(at, a) < dist(at, b) ? a : b));
      walk(to, { then: 'drink', source: water });
      return;
    }
    if (hungry) {
      const near = L.bushes.map((b, i) => ({ i, b, d: dist(at, b) })).filter((n) => !(this.world.removed || {})[`bush:${n.i}`] && !this.notYours(p, n.b[0], n.b[1])) // not ones in someone else's claim
        .sort((a, b) => a.d - b.d);
      const ripe = near.find((n) => this.berriesOn(n.i, t) > 0);
      const go = ripe || near[0];
      if (!go) { idle(15 * MINUTE); return; } // every bush taken out
      const d = Math.max(0.01, go.d), stand = [go.b[0] + ((at[0] - go.b[0]) / d) * 1.0, go.b[1] + ((at[1] - go.b[1]) / d) * 1.0];
      if (go.d < 1.6) { if (ripe) { this.arrive(p, { then: 'pick', bush: go.i }, t); idle(20000); } else idle(15 * MINUTE); return; }
      walk(stand, ripe ? { then: 'pick', bush: go.i } : {});
      return;
    }
    // the next thing on their task list (tasks.js)
    if (working && this.taskStep(p, t, now, L)) return;
    if (!L) { idle(10 * MINUTE); return; }
    // their claim's fire has room for a log or stick they carry: go and put it on
    const feed = this.fireToFeed(p);
    if (feed) {
      const [th] = feed, d = Math.max(0.01, dist(at, [th.x, th.z]));
      if (d <= 2.5) { this.feedFire(p); idle(20000); return; }
      walk([th.x + ((at[0] - th.x) / d) * 1.8, th.z + ((at[1] - th.z) / d) * 1.8], { then: 'feed' });
      return;
    }
    // potter about: rest a little, then stroll somewhere within reach of home (their claim's fire if they have one)
    if (!p.wanderNext) { p.wanderNext = true; idle((15 + Math.random() * 45) * 1000); return; }
    p.wanderNext = false;
    const fire = this.claimOf(p.who);
    const home = fire ? [fire.x, fire.z] : AWAY.near === 'pond' && G.pond ? [G.pond.x, G.pond.z] : p.home || at; // their claim, round the main pond, or where you left them
    const reach = fire ? Math.min(AWAY.wanderMax, CLAIM_R) : AWAY.wanderMax;
    const spots = (L.open || []).filter((o) => dist(o, home) <= reach && dist(o, at) > 3);
    const far = spots.filter((o) => dist(o, home) >= AWAY.wanderMin);
    if (!spots.length) { idle(2 * MINUTE); return; } // nowhere to stroll to: rest a while
    walk(pickRandom(far.length && Math.random() < 0.6 ? far : spots));
  },
};
