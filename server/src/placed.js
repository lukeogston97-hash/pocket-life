// Placed things: things people put down and build in the world (the campfire is the first). Each is
// { id, kind, x, z, rot, built, fuel, lit, at } in world.placed; the rules for each kind are G.placeables (from
// game-data.json "placeables"). A fire burns its fuel only while lit: fuel is how many ms of burning are left as of
// `at`, so nothing has to tick. It goes out by itself when that runs out, whether or not anyone is watching.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, num } from './shared.js';

export const PLACEABLES = G.placeables || {};
// the fire's rules in ms: one piece of fuel, and the most it holds
export const fireRule = (kind) => {
  const f = (PLACEABLES[kind] || {}).fire;
  if (!f) return null;
  const each = (f.secondsEach || 300) * 1000, fuels = { [f.fuel]: each }; // every fuel it takes, in ms each (otherFuels: { log: 1800 })
  for (const [k, s] of Object.entries(f.otherFuels || {})) if (G.items[k] && s > 0) fuels[k] = s * 1000;
  return { fuel: f.fuel, each, fuels, max: each * (f.maxFuel || 10) };
};
// where seat k round a placed thing is (the game works it out the same way)
export function seatAt(th, k) {
  const s = (PLACEABLES[th.kind] || {}).seats || {}, n = s.count || 6, a = (th.rot || 0) + (k * Math.PI * 2) / n;
  return [num(th.x + Math.sin(a) * (s.distance || 1.2)), num(th.z + Math.cos(a) * (s.distance || 1.2))];
}

export const placedMethods = {
  placedList() { const w = this.world; if (w && !w.placed) w.placed = []; return w ? w.placed : []; },
  placedById(id) { return this.placedList().find((th) => th.id === id); },
  // a built one of this kind near the person (a fire has to be lit): recipes with "near" need one, like cooking.
  // A little more room than the game allows (stationNear in game/placeables.js), as walks end a bit apart.
  stationFor(p, kind) {
    const P = PLACEABLES[kind];
    if (!P) return null;
    return this.placedList().find((th) => th.kind === kind && th.built && (!fireRule(kind) || this.burn(th).lit)
      && Math.hypot(th.x - p.x, th.z - p.z) <= 4 + (P.solid || 0.5)) || null;
  },
  // bring a fire up to now: burnt fuel is gone, and with none left it's out
  burn(th, now = Date.now()) {
    if (!th.lit) return th;
    th.fuel = Math.max(0, (th.fuel || 0) - (now - (th.at || now)));
    th.at = now;
    if (th.fuel <= 0) { th.lit = false; th.fuel = 0; }
    return th;
  },
  // what the game is told: fuel is ms left right now (so phone clocks don't matter)
  placedView(th, now = Date.now()) {
    this.burn(th, now);
    return { id: th.id, kind: th.kind, x: th.x, z: th.z, rot: th.rot, built: !!th.built, fuel: Math.round(th.fuel || 0), lit: !!th.lit };
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
