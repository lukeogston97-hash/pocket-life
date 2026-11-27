// Placed things: things people put down and build in the world (the campfire is the first). Each is
// { id, kind, x, z, rot, built, fuel, lit, at } in world.placed; the rules for each kind are G.placeables (from
// game-data.json "placeables"). A fire burns its fuel only while lit: fuel is how many ms of burning are left as of
// `at`, so nothing has to tick. It goes out by itself when that runs out, whether or not anyone is watching.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, num, HOUR, laidNow } from './shared.js';
import { fireRuleOf, seatSpotOf, cropGrowth, berriesGrown, frontSpotOf } from './rules.js';

export const PLACEABLES = G.placeables || {};
// Farming (0.1.18): a farm field is a placed thing dug with a tool (PLACEABLES.field.madeWith, the stone hoe) instead
// of put down from an item. What grows on it is th.crop = { kind, at, berries } (kind: an id in G.crops, at: when it
// was planted, berries: [count, from] once some have been picked, like a wild bush's). It grows by itself: how grown
// is worked out from `at` (rules.js cropGrowth), so nothing has to tick. Once grown it's picked like its "like" source.
export const CROPS = G.crops || {};
export const cropSource = (crop) => { const def = crop && CROPS[crop.kind]; return def && def.like ? (G.sources || {})[def.like] || null : null; };
export const cropGrowMs = (crop) => ((CROPS[crop.kind] || {}).growHours || 24) * HOUR;
export const cropGrown = (crop, now = Date.now()) => cropGrowth(crop.at, cropGrowMs(crop), now) >= 1;
// berries on a grown crop right now (0 while it's still growing)
export function cropBerries(crop, now = Date.now()) {
  const src = cropSource(crop);
  if (!src || !cropGrown(crop, now)) return 0;
  const b = crop.berries || [null, null];
  return berriesGrown(b[0], b[1], src.holds || 5, (src.regrowHours || 0) * HOUR, now);
}
// Storage (0.2.2, the small wooden crate): a placed thing with storage { squares } holds things in its own squares, the
// same squares and stacks as the inventory (rules.js storeRoom). th.store { kind: n } is what's in it, and th.wear
// { kind: [uses left, ...] } how worn each tool in it is (one number per tool; missing ones are new), like a person's wear.
export const storageOf = (kind) => { const s = (PLACEABLES[kind] || {}).storage; return s && s.squares >= 1 ? s : null; };
export const storedCount = (th) => Object.values((th && th.store) || {}).reduce((n, k) => n + (k > 0 ? k : 0), 0);
// the short word for it in sentences: the last word of its name (Small wooden crate: crate)
export const storeNoun = (kind) => String((G.items[(PLACEABLES[kind] || {}).item] || {}).name || 'crate').split(' ').pop().toLowerCase();
// something that holds things can't go in one (a crate in a crate)
export const storable = (kind) => { const it = G.items[kind]; return !!it && !(it.places && storageOf(it.places)); };
// the uses left of each tool of this kind in it, in order (missing ones are new)
export function storeWear(th, kind) {
  const n = (th.store || {})[kind] || 0, full = (G.items[kind] || {}).uses || 0, w = (th.wear || {})[kind];
  const list = (Array.isArray(w) ? w : []).slice(0, n);
  while (list.length < n) list.push(full);
  return list;
}
// Beds (0.2.5, the basic shelter): a placed thing with bed { sleepers, better } is somewhere to sleep. Its sleeper has
// p.bed = its id while sleeping (p.sleeping, or p.asleep for the long sleep while away), and their p.x, p.z stay at its
// front, where they got in (every game draws them lying inside). Sleep there is `better` times as good (needs.js).
export const bedOf = (kind) => { const b = (PLACEABLES[kind] || {}).bed; return b && b.better >= 1 ? b : null; };
// where you stand to get in (its front)
export const bedFront = (th) => { const P = PLACEABLES[th.kind] || {}; return frontSpotOf(th, P.front || (P.solid || 0.5) + 0.3); };
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
    if (!th.lit) { if (th.claim) this.claimLost(th); return th; } // a claim's fire went out: the land is free, the fire is anyone's, its society ends (claims.js)
    if (this.admin.maintenance) { th.at = now; return th; } // maintenance: fires hold their fuel (nobody can tend them)
    th.fuel = Math.max(0, (th.fuel || 0) - (now - (th.at || now)));
    th.at = now;
    if (th.fuel <= 0) { th.lit = false; th.fuel = 0; }
    if (!th.lit && th.claim) this.claimLost(th); // a claim's fire went out: the land is free, the fire is anyone's, its society ends (claims.js)
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
    if (storedCount(th) > 0) return 'Empty it first'; // storage (0.2.2): what's in it would be lost
    if (this.burn(th).lit) return 'Put the fire out first';
    const now = Date.now();
    for (const o of this.persons.values()) if (o.who !== p.who && this.alive(o) && o.sit && o.sit.fire === th.id && o.sit.until > now) return 'Someone is sitting by it';
    if (this.sleepersIn(th.id).length) return "Someone's asleep in it"; // a bed (0.2.5)
    return '';
  },
  // Beds (0.2.5): who's asleep in this one right now (except: leave that person out)
  sleepersIn(id, except = null) {
    const out = [];
    for (const o of this.persons.values()) if (o.who !== except && o.bed === id && this.alive(o) && (o.sleeping || o.asleep)) out.push(o);
    return out;
  },
  // is there room in it for one more? (sleepers at a time)
  bedFree(th, except = null) { const b = th && bedOf(th.kind); return !!b && !!th.built && this.sleepersIn(th.id, except).length < (b.sleepers || 1); },
  // how much better their sleep is right now: their bed's `better` while they're asleep in it, else 1 (needs.js advanceStats)
  bedBetter(p) {
    if (!p || !p.bed || !(p.sleeping || p.asleep)) return 1;
    const th = this.placedById(p.bed), b = th && th.built && bedOf(th.kind);
    return b ? b.better : 1;
  },
  // a bed in their own camp with room in it (the nearest), for someone away going to sleep (away.js), or null
  freeBedFor(p) {
    const home = this.claimOf(p.who);
    if (!home) return null;
    const mine = this.placedList().filter((th) => bedOf(th.kind) && th.built && this.claimAt(th.x, th.z) === home && this.bedFree(th, p.who));
    return mine.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] || null;
  },
  // out of their bed (they woke up, or it's gone): it's free again. p.x, p.z are already at its front
  outOfBed(p) { if (p && p.bed) p.bed = null; },
  // why this person can't put things in or take them out of it now ('' if they can): it has to hold things and be built,
  // they have to be by it, and it can't be in someone else's camp (0.2.2; anyone's once the camp ends, Luke)
  storeNo(th, p, me) {
    if (!th || !storageOf(th.kind)) return "That can't hold things";
    if (!th.built) return 'Build it first';
    if (!me.admin && !this.near(p, [th.x, th.z], (PLACEABLES[th.kind] || {}).solid || 0.5)) return 'Too far away';
    const c = this.notYours(p, th.x, th.z, me.admin);
    return c ? this.claimNo(c) : '';
  },
  // what the game is told: fuel is ms left right now (so phone clocks don't matter)
  placedView(th, now = Date.now()) {
    this.burn(th, now);
    const v = { id: th.id, kind: th.kind, x: th.x, z: th.z, rot: th.rot, built: !!th.built, fuel: Math.round(th.fuel || 0), lit: !!th.lit, burnt: !!th.burnt };
    if (th.claim) v.claim = { who: th.claim, name: this.ownerName(th) }; // whose claim it is (while it burns)
    if (storedCount(th) > 0) { // what's in it (0.2.2), and how worn its tools are
      v.store = { ...th.store };
      const worn = Object.keys(v.store).filter((k) => (G.items[k] || {}).uses);
      if (worn.length) v.wear = Object.fromEntries(worn.map((k) => [k, storeWear(th, k)]));
    }
    if (th.crop) { // what grows on a farm field: ages in ms, so phone clocks don't matter (the game works the rest out)
      const b = th.crop.berries || [null, null];
      v.crop = { kind: th.crop.kind, age: Math.max(0, now - th.crop.at), berries: b[0] == null ? null : [b[0], Math.max(0, now - b[1])] };
    }
    return v;
  },
  // everything in it lands on the ground round it (the admin's Empty and Remove): tools keep their wear. The items made.
  spillStore(th) {
    const w = this.world, out = [];
    if (!w || !storedCount(th)) return out;
    const R = ((PLACEABLES[th.kind] || {}).solid || 0.5) + 0.35;
    for (const [kind, n] of Object.entries(th.store)) {
      if (!Object.hasOwn(G.items, kind)) continue;
      const worn = storeWear(th, kind), full = G.items[kind].uses;
      for (let k = 0; k < n && out.length < 60; k++) {
        const a = out.length * 2.39996, rad = R + (out.length % 3) * 0.18;
        const item = { id: w.nextId++, kind, x: num(th.x + Math.cos(a) * rad), z: num(th.z + Math.sin(a) * rad), rot: num(Math.random() * Math.PI), laid: laidNow() };
        if (full && worn[k] < full) item.uses = worn[k]; // a worn tool stays worn on the ground
        out.push(item);
      }
    }
    th.store = {}; delete th.wear;
    w.items.push(...out);
    return out;
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
