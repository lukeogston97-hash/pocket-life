// Guards: checks that stop a changed (hacked) game from cheating, and stop the server being flooded.
// - reach: your person has to be near what they pick up, pick, cut, chop or mine (the server knows where things are),
//   and a tree, rock, bush or clump of grass the layout doesn't have isn't there to use at all (isThing, isPlant)
// - moving: the server keeps where your person is; a game that says they jumped across the world, walked off the
//   map or moved while asleep is told where they really are instead
// - the layout: where trees, rocks, bushes and plants are, sent by the first game of each new build (and the admin's)
// - the admin code: a few wrong tries from one address and that address has to wait
// - feedback: a few from one address every ten minutes
//   (an address is only ever kept as a scrambled tag, me.from, and only in memory: never saved, never shown)
// - waits: things that take time in the game (chopping, mining, cutting, fishing, building, cooking, lighting a fire)
//   can't be done faster than that (worked)
// - placing: nothing is put in the water, off the land or inside a tree, rock or bush (cantPlaceAt)
// - rocks and boulders: once the layout says which rocks are boulders, the game's word for it isn't taken (rockKind)
// The admin is never limited. These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, WORLDS, MINUTE, HOUR, num, tooOld } from './shared.js';
import { pondShapeAt } from './rules.js';

export const REACH = 4; // metres: how near your person has to be to something to use it (the game stands within about 2)
const MOVE = { most: 25, faster: 1.6 }; // up to 25 m at once (a patchy connection sends walks late, in bursts), refilled at 1.6 times walking speed
const moveLeft = new WeakMap(); // per connection: { left, at }: how far they may still move
const LISTS = { tree: 'trees', rock: 'rocks', bush: 'bushes', oldStump: 'oldStumps' };
// Waits: each person earns a second of work for every second that passes, up to `most` seconds saved up, and something
// that takes S seconds in the game costs `share` of S. A real game has always earned it, because it has just spent that
// long doing the thing (and what it did while the connection was down, 30 seconds at most, is covered by what was
// saved up). A changed game can do a thing in a little over half the time at best, and never for nothing.
// share is well under 1 on purpose: the server has one copy of the game's times (the test build's), and the released
// game may still be waiting the old, shorter time for something whose time was raised since. At 0.6 a time can go up
// by two thirds before players on the released game would ever be told to slow down.
const WORK = { most: 90, share: 0.6 };
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
  // Is number i a real tree, rock, bush or old stump? Once the world's layout is known (it has its trees), a number the
  // layout doesn't have isn't a thing at all, so a changed game can't chop, mine or pick it from wherever its person
  // stands. (Found 24 Nov 2026: tree 4000, rock 1500 and bush 150 could all be used, for logs, stones and berries from
  // nowhere.) With no layout yet nothing can be checked, as before.
  isThing(what, i) {
    const w = this.world, L = w && w.layout;
    if (!L || !(L.trees || []).length) return true;
    return !!((L[LISTS[what]] || [])[i] || (w.moved && w.moved[`${what}:${i}`]));
  },
  // the same for a plant (a clump of tall grass)
  isPlant(kind, i) {
    const L = this.world && this.world.layout;
    if (!L || !(L.trees || []).length) return true;
    return !!((L.plants && L.plants[kind]) || [])[i];
  },
  nearWater(p) { const pond = G.pond || { x: 0, z: 0 }; return Math.hypot(p.x - pond.x, p.z - pond.z) <= (pond.r || 5) * 1.3 + REACH; },

  /* ---------- waits ---------- */
  // Has this person had the time to do something that takes `seconds` in the game? Takes it off what they've earned if
  // so. Kept in memory only, per person (so reconnecting doesn't fill it up). Never for the admin, nor when the server
  // itself is carrying on with someone's task list (ws is null: tasks.js keeps its own time).
  worked(ws, me, p, seconds) {
    if (!ws || this.isAdmin(me) || !(seconds > 0)) return true;
    const now = Date.now() / 1000;
    let b = this.work.get(p.who);
    if (!b) { if (this.work.size > 2000) this.work.clear(); this.work.set(p.who, (b = { left: WORK.most, at: now })); }
    b.left = Math.min(WORK.most, b.left + (now - b.at));
    b.at = now;
    const cost = seconds * WORK.share;
    if (b.left < cost) return false;
    b.left -= cost;
    return true;
  },

  /* ---------- where things can be put ---------- */
  // Why a placed thing can't go at x, z (the game's own words), or null if it can. The game checks this itself before
  // it lets you place (cantPlaceAt in game/placeables.js); this is so a changed game can't put a campfire in the pond,
  // off the land, or in the middle of a tree, rock or bush. A little looser than the game's own check everywhere, so a
  // real game is never refused: the game keeps 1.35 from the water (1.3 here), 3 m in from the edge (2.5 here), and
  // 0.8 m or more from anything solid (half a metre from its middle here).
  cantPlaceAt(x, z) {
    const edge = (G.worldSize || 100) / 2 - 2.5;
    if (!(Math.abs(x) <= edge && Math.abs(z) <= edge)) return 'Too close to the forest';
    if (G.pond && pondShapeAt(G.pond, x, z) < 1.3) return 'Too close to the water';
    const w = this.world, L = w && w.layout;
    if (!L) return null; // (no layout yet: nothing more to check against)
    const gone = { tree: w.trees || {}, rock: w.rocks || {} }, removed = w.removed || {};
    for (const what of ['tree', 'rock', 'bush']) {
      const list = L[LISTS[what]] || [];
      for (let i = 0; i < list.length; i++) {
        if (removed[`${what}:${i}`] || (gone[what] && gone[what][i] && gone[what][i][0] === 'gone')) continue; // dug out, broken or removed: the ground is free
        const at = this.spotOf(what, i);
        if (at && Math.hypot(at[0] - x, at[1] - z) < 0.5) return 'Not enough room here';
      }
    }
    return null;
  },
  // Is rock number i a rock or a boulder? The layout says, once a build that knows to tell it (0.1.10 on) has sent one;
  // until then it's the game's word, as it always was. (A boulder mined "as a rock" vanished for everyone until rocks came back.)
  rockKind(i, said) {
    const B = this.world && this.world.layout && this.world.layout.boulders;
    return Array.isArray(B) ? (B.includes(i) ? 'boulder' : 'rock') : said;
  },

  /* ---------- moving ---------- */
  // may this person move to nx, nz now? Not off the map, not while asleep, and no faster than a person walks
  // (with room for a patchy connection). The admin can teleport.
  moveOk(ws, me, p, nx, nz) {
    if (this.isAdmin(me)) return true;
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
    const rocks = spots(m.rocks, 2000);
    // which rocks are boulders (their numbers): only a build that says so (0.1.10 on) has this, else null (rockKind)
    const boulders = Array.isArray(m.boulders) ? [...new Set(m.boulders.filter((i) => Number.isInteger(i) && i >= 0 && i < rocks.length))].slice(0, 2000) : null;
    return { bushes: pts(m.bushes, 200), shore: pts(m.shore, 200), open: pts(m.open, 1000), trees: spots(m.trees, 5000), rocks, oldStumps: spots(m.oldStumps, 500), plants, ...(boulders ? { boulders } : {}) };
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
    return this.isAdmin(me) && !L.admin;
  },
  takeLayout(me, m) {
    const w = this.world;
    w.layout = { ...this.cleanLayout(m), v: me.v || '', b: me.b || 0, e: me.e || 0, admin: this.isAdmin(me) };
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
  feedbackOk(from = '') { return this.inboxOk('feedbackLog', from); },
  // The same for reports about players. They used to be limited per connection only, so reconnecting over and over got
  // round it (found in the 24 Nov 2026 whole-game check). Their count is kept apart from feedback's.
  reportOk(from = '') { return this.inboxOk('reportLog', from); },
  inboxOk(log, from) {
    const now = Date.now();
    this[log] = (this[log] || []).filter(([t]) => now - t < HOUR);
    if (this[log].length >= 60 || this[log].filter(([t, a]) => a === from && now - t < 10 * MINUTE).length >= 5) return false;
    this[log].push([now, from]);
    return true;
  },
};
