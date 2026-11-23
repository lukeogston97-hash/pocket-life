// Claims (built 0.3.0, decided with Luke 23 Nov 2026): your first campfire becomes your claim when you light it,
// a circle of G.claims.radius metres round it, and stays yours only while the fire burns. Once it goes out the land is
// free and the cold fire is anyone's. One claim each. Claims can't overlap, and can't touch the free area round the
// main pond (G.claims.spawnRadius from the pond's middle). Inside someone else's claim others can only walk through:
// no building, picking things up, chopping, mining, picking or cutting, and no using, feeding or putting out the fire.
// The admin can do anything anywhere. A fire's claim is th.claim (the owner's who); burn() in placed.js ends it.
// Societies (0.1.4, societies.js): a society's claim is th.claim 's:<id>'. Its members use it as their own, and only its
// leader's fire can claim for it.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G } from './shared.js';
import { claimProblem } from './rules.js';
import { socKey } from './societies.js';

const C = { radius: 10, spawnRadius: 16, placeable: 'campfire', ...(G.claims || {}) };
export const CLAIM_R = C.radius;
export const CLAIM_KIND = C.placeable; // the one kind of placed thing that can hold a claim

export const claimsMethods = {
  // every claim right now: built, lit fires with an owner
  claims() { return this.placedList().filter((th) => th.claim && this.burn(th).claim); },
  // a player's claim: their society's if they're in one (societies.js: th.claim is 's:<id>'), else their own
  claimOf(who) {
    if (!who) return null;
    const s = this.socOf(who), key = s ? socKey(s) : who;
    return this.claims().find((th) => th.claim === key) || null;
  },
  claimAt(x, z) { return this.claims().find((th) => Math.hypot(th.x - x, th.z - z) <= C.radius) || null; },
  // is this claim theirs to use: their own, or their society's
  claimIsMine(th, who) {
    if (!th || !th.claim || !who) return false;
    if (th.claim === who) return true;
    const s = this.socOf(who);
    return !!s && th.claim === socKey(s);
  },
  // someone else's claim at x, z, or null if p may act there (their own or their society's claim, nobody's land, or the admin)
  notYours(p, x, z, admin) {
    if (admin || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const c = this.claimAt(x, z);
    return c && !this.claimIsMine(c, p.who) ? c : null;
  },
  ownerName(th) {
    const s = this.socOfClaim(th.claim);
    if (s) return s.name;
    if (String(th.claim).startsWith('s:')) return 'A society';
    const o = this.persons.get(th.claim); return o ? o.name : 'Someone';
  },
  // a few words for whoever a claim belongs to: the player, or every member of the society playing right now
  tellClaim(key, text) { const s = this.socOfClaim(key); if (s) this.socNote(s, text); else this.tell(key, { t: 'claimNote', text }); },
  // the answer when someone tries something inside another person's claim
  claimNo(c) { return `This is ${this.ownerName(c)}'s claim`; },
  // lighting a fire: it becomes the lighter's claim if they have none and it fits here. Says what happened.
  // why this fire can't be p's claim (null if it can): they have one, or it's too close to the pond or someone else's claim
  claimFit(th, p) {
    return claimProblem(th.x, th.z, { radius: C.radius, spawnRadius: C.spawnRadius, pond: G.pond || { x: 0, z: 0 }, hasClaim: !!this.claimOf(p.who),
      claims: this.claims().filter((o) => o.id !== th.id).map((o) => ({ x: o.x, z: o.z, name: this.ownerName(o) })) }); // rules.js, the same as in the game
  },
  // In a society only the leader's fire claims, for the society (Luke, 24 Nov 2026: one society claim).
  tryClaim(th, p) {
    if (th.kind !== C.placeable || th.claim) return '';
    const s = this.socOf(p.who);
    if (s && s.leader !== p.who) return `Lit. Only ${s.name}'s leader can claim land, so this is just a fire`;
    const no = this.claimFit(th, p);
    if (no) return no.why === 'has' ? (s ? `Lit. ${s.name} already has a claim, so this is just a fire` : 'Lit. You already have a claim, so this is just a fire') : no.why === 'pond' ? "Lit. It's too close to the pond to claim land" : `Lit. Too close to ${no.name}'s claim to claim land`;
    th.claim = s ? socKey(s) : p.who;
    th.by = p.who; // it's theirs to pack up later
    this.note('world', s ? `${p.name} claimed land for ${s.name}` : `${p.name} claimed land`);
    if (s) this.socNote(s, `${p.name} claimed land for ${s.name}`, p.who);
    return s ? `Lit. The land round it is now ${s.name}'s claim, while it burns` : `Lit. The land round it is now your claim, while it burns`;
  },
};
