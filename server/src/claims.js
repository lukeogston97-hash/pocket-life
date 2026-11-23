// Claims (built 0.3.0, decided with Luke 23 Nov 2026): your first campfire becomes your claim when you light it,
// a circle of G.claims.radius metres round it, and stays yours only while the fire burns. Once it goes out the land is
// free and the cold fire is anyone's. One claim each. Claims can't overlap, and can't touch the free area round the
// main pond (G.claims.spawnRadius from the pond's middle). Inside someone else's claim others can only walk through:
// no building, picking things up, chopping, mining, picking or cutting, and no using, feeding or putting out the fire.
// The admin can do anything anywhere. A fire's claim is th.claim (the owner's who); burn() in placed.js ends it.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G } from './shared.js';

const C = { radius: 10, spawnRadius: 16, placeable: 'campfire', ...(G.claims || {}) };
export const CLAIM_R = C.radius;

export const claimsMethods = {
  // every claim right now: built, lit fires with an owner
  claims() { return this.placedList().filter((th) => th.claim && this.burn(th).claim); },
  claimOf(who) { return who ? this.claims().find((th) => th.claim === who) || null : null; },
  claimAt(x, z) { return this.claims().find((th) => Math.hypot(th.x - x, th.z - z) <= C.radius) || null; },
  // someone else's claim at x, z, or null if p may act there (their own claim, nobody's land, or the admin)
  notYours(p, x, z, admin) {
    if (admin || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const c = this.claimAt(x, z);
    return c && c.claim !== p.who ? c : null;
  },
  ownerName(th) { const o = this.persons.get(th.claim); return o ? o.name : 'Someone'; },
  // the answer when someone tries something inside another person's claim
  claimNo(c) { return `This is ${this.ownerName(c)}'s claim`; },
  // lighting a fire: it becomes the lighter's claim if they have none and it fits here. Says what happened.
  tryClaim(th, p) {
    if (th.kind !== C.placeable || th.claim) return '';
    if (this.claimOf(p.who)) return 'Lit. You already have a claim, so this is just a fire';
    const pond = G.pond || { x: 0, z: 0 };
    if (Math.hypot(th.x - pond.x, th.z - pond.z) < C.spawnRadius + C.radius) return "Lit. It's too close to the pond to claim land";
    const near = this.claims().find((o) => o.id !== th.id && Math.hypot(o.x - th.x, o.z - th.z) < C.radius * 2);
    if (near) return `Lit. Too close to ${this.ownerName(near)}'s claim to claim land`;
    th.claim = p.who;
    th.by = p.who; // it's theirs to pack up later
    return `Lit. The land round it is now your claim, while it burns`;
  },
};
