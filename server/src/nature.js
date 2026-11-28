// Nature and the shared world: berry bushes, apple trees, tools wearing out, the world as players see it, laying out a new world,
// sticks and stones topping up, and the wild growing back (0.2.9).
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, MINUTE, HOUR, BERRY_SRC, takeCarry, wearList, onBar, WORLD_FORMAT, num, kindOk, pickRandom, laidNow } from './shared.js';
import { CLAIM_R } from './claims.js';
import { PLACEABLES } from './placed.js';
import { berriesGrown, berryPicked, placeRect, placeGap } from './rules.js';

const APPLE_SRC = (G.sources || {}).appleTree || null; // apple trees (0.2.9), picked like a berry bush
const wild = () => ({ awayFromPeople: 15, growsBackTo: 100, ...(G.wild || {}), everyHours: (G.wild || {}).everyHours || {} }); // (read each time: live settings change it)
export const LOOSE_AWAY = 8; // metres: loose sticks and stones never turn up closer than this to anyone (0.2.9)
// what can be cleared in a camp and isn't laid out as trees or rocks keeps its time here: world.cleared['bush:3'] (a berry
// bush), 'shrub:12' (a bush with no berries), 'tallGrass:7' (a plant by its id). Trees and rocks keep it in their state ('gone').
const clearedKey = (what, i, plant) => (what === 'plant' ? `${plant}:${i}` : `${what}:${i}`);

export const natureMethods = {
  // a tool on the tool bar wears with each use; a worn-out one breaks, and the next one on the bar takes over, with its
  // own wear. If the bar had no other, a spare of the same tool in the inventory moves up into its spot (0.1.17)
  wearTool(p, tool, reply) {
    if (!tool || !G.items[tool] || !G.items[tool].uses || !onBar(p, tool, G)) return;
    const list = wearList(p, tool, G);
    list[0] -= 1;
    p.wear = p.wear || {};
    p.wear[tool] = list;
    if (list[0] <= 0) {
      const spare = onBar(p, tool, G) === 1 && p.carry[tool] > 1;
      takeCarry(p, tool, 1, 0);
      if (spare) p.bar[tool] = 1;
      reply({ t: 'broke', kind: tool });
    }
  },
  // the pond's fish are shared (0.3.4): w.pond = { fish, at }; one comes back every regrowMinutes, worked out when someone fishes
  pondFish(F, now = Date.now()) {
    const w = this.world, per = (F.regrowMinutes || 60) * 60000, max = F.holds || 10;
    let f = w.pond ? w.pond.fish : max, at = w.pond ? w.pond.at : now;
    if (f >= max) { f = max; at = now; }
    else { const n = Math.floor((now - at) / per); if (n > 0) { f = Math.min(max, f + n); at = f >= max ? now : at + n * per; } }
    w.pond = { fish: f, at };
    return f;
  },
  // something cleared from a camp (or anything else gone from the wild that isn't a tree or rock)
  isCleared(what, i, plant) { const c = this.world && this.world.cleared; return !!c && Object.hasOwn(c, clearedKey(what, i, plant)); },
  // apples on apple tree i (0.2.9): w.apples[i] = [count, from] like a bush's berries; none while it's a stump or young
  applesOn(i, t = Date.now()) {
    const w = this.world;
    if (!APPLE_SRC || !this.isApple(i) || (w.trees || {})[i]) return 0;
    const a = (w.apples || {})[i] || [null, null];
    return berriesGrown(a[0], a[1], APPLE_SRC.holds || 4, (APPLE_SRC.regrowHours || 0) * HOUR, t);
  },
  takeApple(i, t = Date.now()) {
    const w = this.world, a = (w.apples = w.apples || {})[i] || [null, null];
    const [count, from] = berryPicked(a[0], a[1], APPLE_SRC.holds || 4, (APPLE_SRC.regrowHours || 0) * HOUR, t);
    w.apples[i] = [count, from];
    this.save();
    this.send({ t: 'apples', idx: i, count, growFrom: from }, null);
  },
  // an apple tree is a tree again (grown back from a stump, or a young tree grown up): its apples grow from now
  applesFromNow(i, now = Date.now()) {
    if (!this.isApple(i)) return;
    const w = this.world;
    (w.apples = w.apples || {})[i] = [0, now];
    this.send({ t: 'apples', idx: i, count: 0, growFrom: now }, null);
  },
  berriesOn(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    if ((w.removed || {})[`bush:${i}`] || this.isCleared('bush', i)) return 0; // the admin took this bush out, or it was dug up
    return berriesGrown(b[0], b[1], w.holds, w.regrowMs, t); // rules.js, the same as in the game
  },
  // n berries picked off a bush at once (one save and one message, however many)
  takeBerries(i, n = 1, t = Date.now()) {
    const w = this.world;
    let [count, from] = w.bushes[i] || [null, null];
    for (let k = 0; k < n; k++) [count, from] = berryPicked(count, from, w.holds, w.regrowMs, t);
    w.bushes[i] = [count, from];
    this.save();
    this.send({ t: 'bush', bush: i, count, growFrom: from }, null);
  },
  view() {
    const w = this.world;
    return w ? { items: w.items, bushes: w.bushes, graves: w.graves || [], trees: w.trees || {}, oldStumps: w.oldStumps || {}, rocks: w.rocks || {}, plants: w.plants || {}, moved: w.moved || {}, removed: w.removed || {},
      cleared: w.cleared || {}, apples: w.apples || {}, placed: this.placedList().map((th) => this.placedView(th)) } : null;
  },
  // the first player into a new world lays it out (everyone's game builds the same starting world)
  // Only things that lie about the world to start with (items with startInWorld), no more of each than that, and inside the world.
  async seed(m, me = {}) {
    const most = (k) => (kindOk(k) && G.items[k] && G.items[k].startInWorld) || 0, edge = (G.worldSize || 100) / 2;
    const inside = (v) => Number.isFinite(v) && Math.abs(v) <= edge, count = {};
    const items = (Array.isArray(m.items) ? m.items : []).slice(0, 3000).filter((it) => it && most(it.kind) > 0 && inside(it.x) && inside(it.z) && (count[it.kind] = (count[it.kind] || 0) + 1) <= most(it.kind));
    const spots = {};
    for (const [k, list] of Object.entries(m.spots || {})) if (most(k) > 0 && Array.isArray(list)) spots[k] = list.slice(0, 500).filter((a) => Array.isArray(a) && inside(a[0]) && inside(a[1])).map(([x, z]) => [num(x), num(z)]);
    const caps = {};
    for (const [k, n] of Object.entries(m.caps || {})) if (most(k) > 0 && Number.isFinite(n)) caps[k] = Math.max(0, Math.min(most(k), Math.floor(n)));
    // How many berries a bush holds, how fast they grow back and how often things top up are the server's own numbers
    // (game-data.json), not the first game's: a changed game that got in first could set them for everyone (0.1.10).
    const respawnMs = (G.respawnMinutes > 0 ? G.respawnMinutes : 10) * MINUTE;
    this.world = {
      format: WORLD_FORMAT, nextId: 1, items: [], bushes: [], graves: [], spots, caps,
      holds: Math.max(1, Math.min(15, Math.floor(BERRY_SRC.holds) || 5)),
      regrowMs: Math.max(0, (Number(BERRY_SRC.regrowHours) || 0) * HOUR),
      respawnMs, nextRespawn: Date.now() + respawnMs,
    };
    this.takeLayout(me, m.layout || {});
    for (const it of items) this.world.items.push({ id: this.world.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) });
    this.applyLive(); // a live berry regrow time wins
    await this.save();
    this.send({ t: 'world', world: this.view() }, null);
  },
  // what tops up and where: { kind: [cap, spots] }. The amount is the item's startInWorld (game-data.json) if it has one,
  // else what the world was made with; the spots are its own, or another item's that turns up in the same place (spawnsNear)
  respawnPlan() {
    const w = this.world, out = {}, spots = w.spots || {};
    const kinds = new Set([...Object.keys(w.caps || {}), ...Object.keys(G.items).filter((k) => G.items[k].startInWorld > 0)]);
    for (const kind of kinds) {
      const it = G.items[kind];
      if (!it) continue;
      const cap = it.startInWorld != null ? it.startInWorld : w.caps[kind];
      const same = spots[kind] || Object.entries(spots).find(([k]) => G.items[k] && it.spawnsNear && G.items[k].spawnsNear === it.spawnsNear)?.[1] || [];
      if (cap > 0 && same.length) out[kind] = [cap, same];
    }
    return out;
  },
  // nature tops up: one of each kind that's below its normal amount, at a spot near a tree or boulder
  async respawn(now) {
    const w = this.world;
    w.nextRespawn = now + (G.respawnMinutes > 0 ? G.respawnMinutes * MINUTE : w.respawnMs || 10 * MINUTE); // settings.respawnMinutes wins, so it can change after the world is made
    const added = [], camps = this.claims(), people = this.peopleSpots();
    // never inside a camp, nor right next to someone (0.2.9, Luke: things popping up in camps): a few tries, else next time
    const free = (x, z) => !camps.some((th) => Math.hypot(th.x - x, th.z - z) <= CLAIM_R) && !people.some(([px, pz]) => Math.hypot(px - x, pz - z) < LOOSE_AWAY);
    for (const [kind, [cap, spots]] of Object.entries(this.respawnPlan())) {
      const have = w.items.filter((it) => it.kind === kind).length;
      if (have >= cap) continue;
      let at = null;
      for (let k = 0; k < 12 && !at; k++) { const s2 = pickRandom(spots); if (s2 && free(s2[0], s2[1])) at = s2; }
      if (!at) continue;
      const [x, z] = at;
      const item = { id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) };
      w.items.push(item);
      added.push(item);
    }
    if (!added.length) return; // nothing new: nothing to save (the next top-up time is only kept in memory)
    await this.save();
    this.send({ t: 'added', items: added }, null);
  },
  // where everyone in the world is (playing or away, awake or asleep): new things never turn up near them
  peopleSpots() { const out = []; for (const p of this.persons.values()) if (this.alive(p) && Number.isFinite(p.x) && Number.isFinite(p.z)) out.push([p.x, p.z]); return out; },
  /* ---------- the wild grows back (0.2.9, Luke: "make sure this all works perfectly in harmony") ----------
     Whatever is gone from the wild comes back at its own laid-out spot, so the wild stays as thick as it was laid out.
     The wild is everywhere outside camps: the more land camps take, the less of it there is, and nothing is squeezed into
     what's left (no fixed total; Luke, 28 Nov 2026, "if there are 18 camps"). Gone means: a broken rock, something cleared
     in a camp that has since ended, or a stump dug up before 0.2.9. The admin's removals (world.removed) stay gone.
     One of each kind every wild.everyHours (rocks: mining.rockBackHours), picked at random from the ones that can, and
     only while the wild has fewer than wild.growsBackTo per cent of that kind. Never inside a camp, never within
     wild.awayFromPeople metres of anyone, never on something placed. A tree comes back young (it grows up in the same time
     as a stump), a berry bush with no berries yet, grass as stubble. The admin's Regrow everything brings back all that can
     at once (all: true, people nearby or not). */
  wildKinds() {
    const w = this.world, L = (w && w.layout) || {}, removed = w.removed || {}, C = G.clearing || {}, every = wild().everyHours;
    const isRock = (i, b) => this.rockKind(i, b ? 'boulder' : 'rock') === (b ? 'boulder' : 'rock');
    const nb = (L.bushes || []).length, bushAt = (i) => (i < nb ? ['bush', i] : ['shrub', i - nb]); // berry bushes first, then the rest
    const out = [
      { kind: 'tree', every: every.tree || 2, n: (L.trees || []).length, r: 1.2,
        gone: (i) => !!(w.trees || {})[i] && w.trees[i][0] === 'gone' && !removed[`tree:${i}`], spot: (i) => this.spotOf('tree', i),
        back: (i, now) => { w.trees = w.trees || {}; w.trees[i] = ['young', now]; delete (w.apples || {})[i]; this.send({ t: 'tree', idx: i, state: 'young', at: now }, null); } },
      ...[false, true].map((b) => ({ kind: b ? 'boulder' : 'rock', every: b ? every.boulder || 12 : (G.mining || {}).rockBackHours || 4, n: (L.rocks || []).length, r: 1.2,
        only: (i) => isRock(i, b), gone: (i) => isRock(i, b) && !!(w.rocks || {})[i] && w.rocks[i][0] === 'gone' && !removed[`rock:${i}`], spot: (i) => this.spotOf('rock', i),
        back: (i) => { delete w.rocks[i]; this.send({ t: 'rock', idx: i, state: 'whole' }, null); } })),
      // berry bushes and bushes with no berries, one kind (both are dug up the same way)
      { kind: 'bush', every: every.bush || 2, n: nb + (L.shrubs || []).length, r: 1,
        gone: (i) => { const [what, j] = bushAt(i); return this.isCleared(what, j) && !removed[`${what}:${j}`]; },
        spot: (i) => { const [what, j] = bushAt(i); return this.spotOf(what, j); },
        back: (i, now) => {
          const [what, j] = bushAt(i);
          delete w.cleared[clearedKey(what, j)];
          this.send({ t: 'cleared', what, idx: j, back: true }, null);
          if (what === 'bush') { w.bushes[j] = [0, now]; this.send({ t: 'bush', bush: j, count: 0, growFrom: now }, null); } // (no berries yet)
        } },
    ];
    for (const kind of Object.keys(G.plants || {})) { // grass, and any plant that can be cleared
      if (!C[kind]) continue;
      const def = G.plants[kind];
      out.push({ kind, every: every[kind] || 1, n: ((L.plants || {})[kind] || []).length, r: 0.6,
        gone: (i) => this.isCleared('plant', i, kind), spot: (i) => this.plantSpot(kind, i),
        back: (i, now) => {
          delete w.cleared[clearedKey('plant', i, kind)];
          const [lo, hi] = Array.isArray(def.regrowHours) ? def.regrowHours : [def.regrowHours || 2, def.regrowHours || 2];
          const ps = ((w.plants = w.plants || {})[kind] = w.plants[kind] || {});
          ps[i] = now + (lo + Math.random() * Math.max(0, hi - lo)) * HOUR; // stubble, growing back
          this.send({ t: 'cleared', what: 'plant', plant: kind, idx: i, back: true }, null);
          this.send({ t: 'plant', plant: kind, i, readyAt: ps[i] }, null);
        } });
    }
    return out;
  },
  // Returns true if anything came back (the world needs saving)
  topUpWild(now = Date.now(), { all = false } = {}) {
    const w = this.world;
    if (!w || !w.layout) return false;
    const camps = this.claims(), people = all ? [] : this.peopleSpots(), placed = this.placedList();
    const inCamp = (at) => camps.some((th) => Math.hypot(th.x - at[0], th.z - at[1]) <= CLAIM_R);
    const W = wild(), nearSomeone = (at) => people.some(([x, z]) => Math.hypot(x - at[0], z - at[1]) < (Number(W.awayFromPeople) || 0));
    const underPlaced = (at, r) => placed.some((th) => placeGap(placeRect(th, PLACEABLES[th.kind]), { x: at[0], z: at[1], rot: 0, hw: r, hd: r }) < 0.2);
    const pct = Math.max(0, Math.min(100, Number(W.growsBackTo ?? 100)));
    w.wildAt = w.wildAt || {};
    let changed = false;
    for (const K of this.wildKinds()) {
      const gone = [];
      for (let i = 0; i < K.n; i++) if (K.gone(i)) { const at = K.spot(i); if (at && !inCamp(at)) gone.push([i, at]); }
      if (!gone.length) { delete w.wildAt[K.kind]; continue; } // nothing to grow back (the wait starts when something goes)
      if (!all) { // one at a time, every so often: the next one's time is kept with the world, so a new build doesn't start the wait again
        if (!w.wildAt[K.kind]) { w.wildAt[K.kind] = now + K.every * HOUR; changed = true; continue; }
        if (now < w.wildAt[K.kind]) continue;
      }
      let wildN = 0; // how much of the wild this kind could fill: its spots outside camps
      for (let i = 0; i < K.n; i++) { if (K.only && !K.only(i)) continue; const at = K.spot(i); if (at && !inCamp(at)) wildN++; }
      const can = gone.filter(([, at]) => !nearSomeone(at) && !underPlaced(at, K.r));
      let missing = gone.length;
      while (can.length && (wildN - missing) * 100 < pct * wildN - 1e-9) {
        const [i] = can.splice(Math.floor(Math.random() * can.length), 1)[0];
        K.back(i, now);
        missing--;
        changed = true;
        if (!all) { w.wildAt[K.kind] = now + K.every * HOUR; break; }
      }
    }
    return changed;
  },
  // Things left lying about fade (Luke, 25 Nov 2026: after 7 days, never inside a camp), so the ground doesn't fill up for
  // ever. G.fadeDays is a live setting (0: nothing fades). Looked at once an hour (the tick in index.js).
  // - Only things with a time on them (laid, shared.js) can fade: what a person dropped, chopped, mined, spilled when
  //   they died or took apart, and what the admin added. The world's own sticks and stones have none and stay.
  // - Anything else found without a time (it was there before this, 0.1.10) starts its days now.
  // - Inside a camp the days don't run: the time is moved up (once a day is enough), so when the camp ends its things
  //   have their days still to come.
  // Returns true if the world changed and needs saving. Games hear 'gone' for each thing, or the whole world if it's a lot
  // (both are messages every build already knows).
  fadeOld(now = Date.now()) {
    const w = this.world, days = Number(G.fadeDays) || 0, hour = laidNow(now), wild = this.respawnPlan(), camps = this.claims();
    const inCamp = (it) => camps.some((th) => Math.hypot(th.x - it.x, th.z - it.z) <= CLAIM_R);
    const gone = [];
    let changed = false;
    w.items = w.items.filter((it) => {
      if (it.laid == null) { if (!wild[it.kind]) { it.laid = hour; changed = true; } return true; }
      if (inCamp(it)) { if (hour - it.laid >= 24) { it.laid = hour; changed = true; } return true; }
      if (days > 0 && hour - it.laid >= days * 24) { gone.push(it.id); return false; }
      return true;
    });
    if (gone.length) {
      this.note('world', `${gone.length} ${gone.length === 1 ? 'thing' : 'things'} left on the ground for ${days} ${days === 1 ? 'day' : 'days'} faded`);
      if (gone.length > 30) this.send({ t: 'world', world: this.view() }, null);
      else for (const id of gone) this.send({ t: 'gone', id }, null);
    }
    return changed || gone.length > 0;
  },
};
