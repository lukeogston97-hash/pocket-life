// Nature and the shared world: berry bushes, tools wearing out, the world as players see it, laying out a new world, sticks and stones topping up.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, MINUTE, takeCarry, WORLD_FORMAT, num, kindOk, pickRandom } from './shared.js';

export const natureMethods = {
  // a tool wears with each use; a worn-out one breaks (and the next one you carry takes over)
  wearTool(p, tool, reply) {
    if (!tool || !p.carry[tool] || !G.items[tool] || !G.items[tool].uses) return;
    p.wear = p.wear || {};
    p.wear[tool] = (p.wear[tool] ?? G.items[tool].uses) - 1;
    if (p.wear[tool] <= 0) {
      takeCarry(p, tool, 1);
      if (p.carry[tool]) p.wear[tool] = G.items[tool].uses;
      reply({ t: 'broke', kind: tool });
    }
  },
  berriesOn(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    if (b[0] == null || !w.regrowMs) return w.holds;
    const every = w.regrowMs / w.holds;
    return Math.min(w.holds, b[0] + Math.floor((t - b[1]) / every));
  },
  takeBerry(i, t = Date.now()) {
    const w = this.world, b = w.bushes[i] || [null, null];
    const every = w.regrowMs / w.holds;
    let count = w.holds, from = t;
    if (b[0] != null && w.regrowMs) {
      const grown = Math.floor((t - b[1]) / every);
      count = Math.min(w.holds, b[0] + grown);
      from = count >= w.holds ? t : b[1] + grown * every;
    }
    count -= 1;
    w.bushes[i] = [count, from];
    this.save();
    this.send({ t: 'bush', bush: i, count, growFrom: from }, null);
  },
  view() {
    const w = this.world;
    return w ? { items: w.items, bushes: w.bushes, graves: w.graves || [], trees: w.trees || {}, oldStumps: w.oldStumps || {}, plants: w.plants || {}, placed: this.placedList().map((th) => this.placedView(th)) } : null;
  },
  cleanLayout(m) {
    const pts = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).filter((a) => Array.isArray(a)).map(([x, z]) => [num(x), num(z)]);
    return { bushes: pts(m.bushes, 200), shore: pts(m.shore, 200), open: pts(m.open, 1000) };
  },
  // the first player into a new world lays it out (everyone's game builds the same starting world)
  async seed(m) {
    const items = (Array.isArray(m.items) ? m.items : []).slice(0, 3000).filter((it) => it && kindOk(it.kind));
    const spots = {};
    for (const [k, list] of Object.entries(m.spots || {})) if (kindOk(k) && Array.isArray(list)) spots[k] = list.slice(0, 500).map(([x, z]) => [num(x), num(z)]);
    const caps = {};
    for (const [k, n] of Object.entries(m.caps || {})) if (kindOk(k) && Number.isFinite(n)) caps[k] = Math.max(0, Math.min(2000, Math.floor(n)));
    const respawnMs = Math.max(MINUTE, Number(m.respawnMs) || 10 * MINUTE);
    this.world = {
      format: WORLD_FORMAT, nextId: 1, items: [], bushes: [], graves: [], spots, caps,
      holds: Math.max(1, Math.min(15, Math.floor(m.holds) || 5)),
      regrowMs: Math.max(0, Number(m.regrowMs) || 0),
      respawnMs, nextRespawn: Date.now() + respawnMs,
      layout: this.cleanLayout(m.layout || {}),
    };
    for (const it of items) this.world.items.push({ id: this.world.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) });
    await this.save();
    this.send({ t: 'world', world: this.view() }, null);
  },
  // nature tops up: one of each kind that's below its normal amount, at a spot near a tree or boulder
  async respawn(now) {
    const w = this.world;
    w.nextRespawn = now + (w.respawnMs || 10 * MINUTE);
    const added = [];
    for (const [kind, cap] of Object.entries(w.caps || {})) {
      const have = w.items.filter((it) => it.kind === kind).length;
      const spots = (w.spots || {})[kind] || [];
      if (have >= cap || !spots.length) continue;
      const [x, z] = pickRandom(spots);
      const item = { id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) };
      w.items.push(item);
      added.push(item);
    }
    await this.save();
    if (added.length) this.send({ t: 'added', items: added }, null);
  },
};
