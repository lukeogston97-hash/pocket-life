// Nature and the shared world: berry bushes, tools wearing out, the world as players see it, laying out a new world, sticks and stones topping up.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, MINUTE, takeCarry, wearList, WORLD_FORMAT, num, kindOk, pickRandom } from './shared.js';
import { berriesGrown, berryPicked } from './rules.js';

export const natureMethods = {
  // a tool wears with each use; a worn-out one breaks (and the next one you carry takes over)
  wearTool(p, tool, reply) {
    if (!tool || !p.carry[tool] || !G.items[tool] || !G.items[tool].uses) return;
    const list = wearList(p, tool, G);
    list[0] -= 1;
    p.wear = p.wear || {};
    p.wear[tool] = list;
    if (list[0] <= 0) {
      takeCarry(p, tool, 1, 0); // the next one you carry takes over, with its own wear
      reply({ t: 'broke', kind: tool });
    }
  },
  berriesOn(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    if ((w.removed || {})[`bush:${i}`]) return 0; // the admin took this bush out
    return berriesGrown(b[0], b[1], w.holds, w.regrowMs, t); // rules.js, the same as in the game
  },
  takeBerry(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    const [count, from] = berryPicked(b[0], b[1], w.holds, w.regrowMs, t);
    w.bushes[i] = [count, from];
    this.save();
    this.send({ t: 'bush', bush: i, count, growFrom: from }, null);
  },
  view() {
    const w = this.world;
    return w ? { items: w.items, bushes: w.bushes, graves: w.graves || [], trees: w.trees || {}, oldStumps: w.oldStumps || {}, rocks: w.rocks || {}, plants: w.plants || {}, moved: w.moved || {}, removed: w.removed || {}, placed: this.placedList().map((th) => this.placedView(th)) } : null;
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
    const respawnMs = Math.max(MINUTE, Number(m.respawnMs) || 10 * MINUTE);
    this.world = {
      format: WORLD_FORMAT, nextId: 1, items: [], bushes: [], graves: [], spots, caps,
      holds: Math.max(1, Math.min(15, Math.floor(m.holds) || 5)),
      regrowMs: Math.max(0, Number(m.regrowMs) || 0),
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
    const added = [];
    for (const [kind, [cap, spots]] of Object.entries(this.respawnPlan())) {
      const have = w.items.filter((it) => it.kind === kind).length;
      if (have >= cap) continue;
      const [x, z] = pickRandom(spots);
      const item = { id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) };
      w.items.push(item);
      added.push(item);
    }
    if (!added.length) return; // nothing new: nothing to save (the next top-up time is only kept in memory)
    await this.save();
    this.send({ t: 'added', items: added }, null);
  },
};
