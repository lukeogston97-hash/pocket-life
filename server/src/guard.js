// Guards: checks that stop a changed (hacked) game from cheating, and stop the server being flooded.
// - reach: your person has to be near what they pick up, pick, cut, chop or mine (the server knows where things are)
// - moving: the server keeps where your person is; a game that says they jumped across the world, walked off the
//   map or moved while asleep is told where they really are instead
// - the layout: where trees, rocks, bushes and plants are, sent by the first game of each new build (and the admin's)
// - the admin code: a few wrong tries from one address and that address has to wait
// - feedback: a few from one address every ten minutes
//   (an address is only ever kept as a scrambled tag, me.from, and only in memory: never saved, never shown)
// The admin is never limited. These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, WORLDS, MINUTE, HOUR, num, tooOld } from './shared.js';

export const REACH = 4; // metres: how near your person has to be to something to use it (the game stands within about 2)
const MOVE = { most: 25, faster: 1.6 }; // up to 25 m at once (a patchy connection sends walks late, in bursts), refilled at 1.6 times walking speed
const moveLeft = new WeakMap(); // per connection: { left, at }: how far they may still move
const LISTS = { tree: 'trees', rock: 'rocks', bush: 'bushes', oldStump: 'oldStumps' };
const spots = (list, most) => (Array.isArray(list) ? list : []).slice(0, most).map((a) => (Array.isArray(a) ? [num(a[0]), num(a[1])] : null));

export const guardMethods = {
  /* ---------- reach ---------- */
  // is the person near enough to a spot ([x, z])? A spot the server doesn't know (no layout yet) is allowed.
  near(p, at, extra = 0) { return !at || Math.hypot(at[0] - p.x, at[1] - p.z) <= REACH + extra; },
  // where a laid-out thing is: where the admin moved it to, else where the layout put it (null if not known yet)
  spotOf(what, i) {
    const w = this.world, moved = w && w.moved && w.moved[`${what}:${i}`];
    if (moved) return moved;
    const list = w && w.layout && w.layout[LISTS[what]];
    return (list && list[i]) || null;
  },
  plantSpot(kind, i) { const L = this.world && this.world.layout; return (L && L.plants && L.plants[kind] && L.plants[kind][i]) || null; },
  nearWater(p) { const pond = G.pond || { x: 0, z: 0 }; return Math.hypot(p.x - pond.x, p.z - pond.z) <= (pond.r || 5) * 1.3 + REACH; },

  /* ---------- moving ---------- */
  // may this person move to nx, nz now? Not off the map, not while asleep, and no faster than a person walks
  // (with room for a patchy connection). The admin can teleport.
  moveOk(ws, me, p, nx, nz) {
    if (me.admin) return true;
    const edge = (G.worldSize || 100) / 2 - 1;
    if (!(Math.abs(nx) <= edge && Math.abs(nz) <= edge)) return false;
    const d = Math.hypot(nx - p.x, nz - p.z), now = Date.now();
    if (p.sleeping && d > 0.5 && now - (p.sleptAt || 0) > 5000) return false; // (the game may be finishing a step as they collapse)
    let b = moveLeft.get(ws);
    if (!b) moveLeft.set(ws, (b = { left: MOVE.most, at: now }));
    b.left = Math.min(MOVE.most, b.left + ((now - b.at) / 1000) * (G.walkSpeed || 2.2) * MOVE.faster);
    b.at = now;
    if (d > b.left + 0.5) return false;
    b.left -= d;
    return true;
  },

  /* ---------- the layout ---------- */
  // what a game says about where things are, tidied: for people away (bushes, shore, open ground) and for reach
  // (trees, rocks, old stumps, plants; each list is in the game's own order, so a thing's number finds its spot)
  cleanLayout(m) {
    const pts = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).filter((a) => Array.isArray(a)).map(([x, z]) => [num(x), num(z)]);
    const plants = {};
    for (const [k, list] of Object.entries(m.plants || {})) if ((G.plants || {})[k]) plants[k] = spots(list, 1000);
    return { bushes: pts(m.bushes, 200), shore: pts(m.shore, 200), open: pts(m.open, 1000), trees: spots(m.trees, 5000), rocks: spots(m.rocks, 2000), oldStumps: spots(m.oldStumps, 500), plants };
  },
  // Should this game send the layout? A world with none takes it from anyone. After that, only from a build the server
  // knows (the current test or release build) that's newer than the one that sent it, so new things in a build get
  // known. The admin's game sends it once more per build, and its word stands over anyone else's.
  needLayout(me) {
    const w = this.world, L = w && w.layout;
    if (!w) return false;
    if (!L) return true;
    const mine = `${me.v}.${me.b || 0}`, V = WORLDS.minVersion || {};
    if (mine !== V.test && mine !== V.release) return false;
    if (!L.v || tooOld(L.v, L.b, mine, L.e, me.e)) return true;
    return !!me.admin && !L.admin;
  },
  takeLayout(me, m) {
    const w = this.world;
    w.layout = { ...this.cleanLayout(m), v: me.v || '', b: me.b || 0, e: me.e || 0, admin: !!me.admin };
    for (const [key, at] of Object.entries(w.moved || {})) { // bushes the admin moved stay where they were moved to
      const [what, i] = key.split(':');
      if (what === 'bush' && w.layout.bushes[i]) w.layout.bushes[i] = at;
    }
  },

  /* ---------- the admin code ---------- */
  // wrong codes from one address: after 5 in 15 minutes that address has to wait (even the right code is refused)
  adminLocked(me) {
    const now = Date.now(), k = me.from || '', list = (this.adminFails.get(k) || []).filter((t) => now - t < 15 * MINUTE);
    if (list.length) this.adminFails.set(k, list); else this.adminFails.delete(k);
    return list.length >= 5;
  },
  adminFail(me) { const k = me.from || ''; this.adminFails.set(k, [...(this.adminFails.get(k) || []), Date.now()].slice(-10)); },

  /* ---------- feedback ---------- */
  // at most 5 from one address in ten minutes, and 60 an hour from everyone, so the Inbox can't be flooded
  feedbackOk(from = '') {
    const now = Date.now();
    this.feedbackLog = this.feedbackLog.filter(([t]) => now - t < HOUR);
    if (this.feedbackLog.length >= 60 || this.feedbackLog.filter(([t, a]) => a === from && now - t < 10 * MINUTE).length >= 5) return false;
    this.feedbackLog.push([now, from]);
    return true;
  },
};
