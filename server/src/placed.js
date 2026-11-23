// Placed things: things people put down and build in the world (the campfire is the first). Each is
// { id, kind, x, z, rot, built, fuel, lit, at } in world.placed; the rules for each kind are G.placeables (from
// game-data.json "placeables"). A fire burns its fuel only while lit: fuel is how many ms of burning are left as of
// `at`, so nothing has to tick. It goes out by itself when that runs out, whether or not anyone is watching.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, num } from './shared.js';
import { fireRuleOf, seatSpotOf } from './rules.js';

export const PLACEABLES = G.placeables || {};
// the fire's rules in ms: each fuel it takes, and the most it holds (rules.js, the same as in the game)
export const fireRule = (kind) => fireRuleOf((PLACEABLES[kind] || {}).fire, (k) => !!G.items[k]);
// where seat k round a placed thing is (rules.js, the same as in the game)
export function seatAt(th, k) { const [x, z] = seatSpotOf(th, (PLACEABLES[th.kind] || {}).seats, k); return [num(x), num(z)]; }

export const placedMethods = {
  placedList() { const w = this.world; if (w && !w.placed) w.placed = []; return w ? w.placed : []; },
  placedById(id) { return this.placedList().find((th) => th.id === id); },
  // a built one of this kind near the person (a fire has to be lit): recipes with "near" need one, like cooking.
  // A little more room than the game allows (stationNear in game/placeables.js), as walks end a bit apart.
  stationFor(p, kind) {
    const P = PLACEABLES[kind];
    if (!P) return null;
    return this.placedList().find((th) => th.kind === kind && th.built && (!fireRule(kind) || this.burn(th).lit)
      && !this.notYours(p, th.x, th.z) && Math.hypot(th.x - p.x, th.z - p.z) <= 4 + (P.solid || 0.5)) || null; // not in someone else's claim
  },
  // bring a fire up to now: burnt fuel is gone, and with none left it's out
  burn(th, now = Date.now()) {
    if (!th.lit) { if (th.claim) { th.claim = null; th.by = null; } return th; } // a claim's fire went out: the land is free and the fire is anyone's
    if (this.admin.maintenance) { th.at = now; return th; } // maintenance: fires hold their fuel (nobody can tend them)
    th.fuel = Math.max(0, (th.fuel || 0) - (now - (th.at || now)));
    th.at = now;
    if (th.fuel <= 0) { th.lit = false; th.fuel = 0; }
    if (!th.lit && th.claim) { th.claim = null; th.by = null; } // a claim's fire went out: the land is free and the fire is anyone's
    return th;
  },
  // when a placed thing's fire goes out (ms): Infinity if it isn't a fire or is gone; now (or earlier) if it's already out
  fireOutAt(id, now = Date.now()) {
    const th = this.placedById(id);
    if (!th || !fireRule(th.kind)) return Infinity;
    if (!th.lit) return now - 1;
    return (th.at || now) + (th.fuel || 0);
  },
  // why a built one can't be packed up or taken apart ('' if it can): only by who built it (or the admin; ones from
  // before 0.2.6 have no builder, so anyone), a fire has to be out, and nobody else can be sitting by it
  whyNotTakeDown(th, p, admin) {
    const c = this.notYours(p, th.x, th.z, admin);
    if (c) return this.claimNo(c);
    if (th.by && th.by !== p.who && !admin) return 'Only the person who built it can do that';
    if (this.burn(th).lit) return 'Put the fire out first';
    const now = Date.now();
    for (const o of this.persons.values()) if (o.who !== p.who && this.alive(o) && o.sit && o.sit.fire === th.id && o.sit.until > now) return 'Someone is sitting by it';
    return '';
  },
  // what the game is told: fuel is ms left right now (so phone clocks don't matter)
  placedView(th, now = Date.now()) {
    this.burn(th, now);
    const v = { id: th.id, kind: th.kind, x: th.x, z: th.z, rot: th.rot, built: !!th.built, fuel: Math.round(th.fuel || 0), lit: !!th.lit, burnt: !!th.burnt };
    if (th.claim) v.claim = { who: th.claim, name: this.ownerName(th) }; // whose claim it is (while it burns)
    return v;
  },
  sendPlaced(th, reply, extra) {
    const v = this.placedView(th);
    this.send({ t: 'placed', thing: v }, null);
    if (extra && reply) reply({ t: 'placed', thing: v, ...extra });
  },
  // who is sitting where: someone alive with a sit that hasn't ended
  sitterAt(fire, seat, now = Date.now(), except = null) {
    for (const p of this.persons.values()) if (p.who !== except && this.alive(p) && p.sit && p.sit.fire === fire && p.sit.seat === seat && p.sit.until > now) return p;
    return null;
  },
  // stand up (the sit ended, or they did something else)
  standUp(p, tellOthers = true) {
    if (!p.sit) return;
    p.sit = null;
    this.touch(p);
    if (tellOthers) this.send({ t: 'sit', id: p.who, off: true }, null);
  },
};
