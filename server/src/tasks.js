// Your task list while you're away (0.1.7). The game sends what's left of its list now and then and when you leave
// (actions.js "tasks"); while you're away your person carries on with it here, one task at a time, the way their game
// would: walk over, take the time it takes, then do it with the same handler a player's message uses (actions.js), so
// every rule is the same (reach, camps, tools, weight). Something that has gone or can't be done is skipped, as in the
// game. They still stop to eat and drink and sleep when tired (away.js decide); once the list is done it's the usual away
// routine. Coming back, what's left goes back to their game (index.js hello).
// Kept apart from the away routine so other things (a schedule, later) can hand the server tasks to run too.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { ACTIONS } from './actions.js';
import { PLACEABLES, fireRule, seatAt, CROPS, cropSource, cropGrown, cropBerries } from './placed.js';
import { fuelRoom, recipeWants } from './rules.js';
import { onBar, barOf, addCarry } from './needs.js';
import { G, num, dist, spend } from './shared.js';

export const MAX_TASKS = 30; // the same as the game's list (MAX_QUEUE in game/moving.js)
const TYPES = ['pickup', 'use', 'drop', 'chop', 'cut', 'walk', 'mine', 'fish', 'place', 'build', 'unplace', 'apart', 'tend', 'sit', 'make', 'dig', 'flatten', 'plant', 'harvest'];
const WHATS = ['tree', 'stump', 'oldStump', 'rock', 'boulder'];
// what each kind of task can't do without (one missing: the task is dropped)
const NEEDS = { pickup: ['id'], use: ['source'], drop: ['kind', 'n'], chop: ['what'], cut: ['plant', 'i'], walk: ['x', 'z'], mine: ['idx'], fish: [],
  place: ['item', 'kind', 'x', 'z'], build: ['id'], unplace: ['id'], apart: ['id'], tend: ['id', 'do'], sit: ['id'], make: ['id', 'recipe'],
  dig: ['kind', 'x', 'z'], flatten: ['id'], plant: ['id', 'seed'], harvest: ['id'] }; // farming (0.1.18)
const int = (v, most) => (Number.isInteger(v) && v >= 0 && v < most ? v : undefined);
const has = (obj, k) => typeof k === 'string' && !!obj && Object.hasOwn(obj, k);
// replies that mean "no" (someone got there first, too far, in someone else's camp, too heavy...)
const NO = ['placeNo', 'cutNo', 'sitNo', 'tree', 'rock', 'oldStump', 'placed'];
const refused = (r) => r.ok === false || NO.includes(r.t) || (r.t === 'fished' && /far|heavy|full/i.test(r.why || ''));
// where to stand to use something at `spot`: where they are if that's close enough (reach), else `stop` metres short of it
function toward(at, spot, stop, reach = stop + 0.35) {
  const d = dist(at, spot);
  if (d <= reach) return at;
  return [spot[0] + ((at[0] - spot[0]) / d) * stop, spot[1] + ((at[1] - spot[1]) / d) * stop];
}

// A list from a game, tidied: only kinds of task there are, and only the fields each needs, checked. Anything wrong is
// dropped, so a changed game can't make the server do something its player couldn't.
export function cleanTasks(list) {
  const out = [], edge = (G.worldSize || 100) / 2;
  for (const t of (Array.isArray(list) ? list : []).slice(0, MAX_TASKS)) {
    if (!t || typeof t !== 'object' || !TYPES.includes(t.type)) continue;
    const c = { type: t.type };
    for (const k of ['id', 'from']) { const v = int(t[k], 1e9); if (v !== undefined) c[k] = v; }
    for (const k of ['idx', 'i', 'bush', 'seat']) { const v = int(t[k], 5000); if (v !== undefined) c[k] = v; }
    for (const k of ['n', 'which']) { const v = int(t[k], 100); if (v !== undefined) c[k] = v; }
    for (const k of ['x', 'z']) if (Number.isFinite(t[k]) && Math.abs(t[k]) <= edge) c[k] = num(t[k]);
    for (const k of ['rot', 'top', 'stop']) if (Number.isFinite(t[k]) && Math.abs(t[k]) < 100) c[k] = num(t[k]);
    for (const k of ['kind', 'item', 'fuel', 'seed']) if (has(G.items, t[k]) || (k === 'kind' && has(PLACEABLES, t[k]))) c[k] = t[k];
    if (has(G.recipes, t.recipe)) c.recipe = t.recipe;
    if (has(G.plants, t.plant)) c.plant = t.plant;
    if (has(G.sources, t.source)) c.source = t.source;
    if (WHATS.includes(t.what) || has(G.items, t.what)) c.what = t.what; // (a log being chopped: its kind)
    if (['add', 'light', 'out'].includes(t.do)) c.do = t.do;
    if (t.water === true) c.water = true;
    if (NEEDS[c.type].every((k) => c[k] !== undefined)) out.push(c);
  }
  return out;
}

export const taskMethods = {
  cleanTasks,
  // Their next task as a plan: a walk over (then: 'task'), then the work there for as long as it takes (kind 'work').
  // False: nothing left on the list that can be done.
  taskStep(p, t, now, L) {
    for (let guard = 0; guard < MAX_TASKS && p.tasks && p.tasks.length; guard++) {
      const how = this.taskHow(p, p.tasks[0], L, t);
      if (!how) { p.tasks.shift(); this.touch(p); continue; } // gone, or can't be done any more: on to the next (their game does the same)
      const at = [p.x, p.z];
      if (how.to && dist(at, how.to) > 0.3) { this.taskWalk(p, at, how.to, t, now); return true; }
      p.plan = { kind: 'work', start: t, arrive: t + Math.max(300, (how.seconds || 0) * 1000 * this.slowness(p)), then: 'task' };
      if (how.pose && p.plan.arrive > now) this.send({ t: 'act', id: p.who, pose: how.pose, seconds: Math.min(25, (p.plan.arrive - Math.max(t, now)) / 1000) }, null); // anyone watching sees them at it
      return true;
    }
    return false;
  },
  // walking over to it, at walking speed (a stroll is slower); anyone watching sees them go
  taskWalk(p, at, to, t, now) {
    const d = dist(at, to), speed = G.walkSpeed || 2.2;
    p.plan = { kind: 'walk', from: at, to: [num(to[0]), num(to[1])], start: t, arrive: t + (d / speed) * 1000 + 300, then: 'task' };
    spend(p, 'walkPerMetre', G, d);
    if (p.plan.arrive > now) this.send({ t: 'stroll', id: p.who, x: p.plan.to[0], z: p.plan.to[1], speed, ms: Math.round(p.plan.arrive - now) }, null);
  },
  // out of breath: everything takes longer (the same as in the game, needs.js slowness)
  slowness(p) {
    const E = (G.needs || []).find((s) => s.id === 'energy');
    return E && p.stats && p.stats.energy != null && p.stats.energy < (E.slowBelow || 0) ? E.slowBy || 1 : 1;
  },
  // room for these in what they carry: tried on a copy (tools on the tool bar weigh nothing; 0.2.1: a square for each stack too)
  canCarry(p, gives) { const t = { carry: { ...p.carry }, bar: { ...barOf(p, G) }, wear: structuredClone(p.wear || {}) }; return Object.entries(gives || {}).every(([k, n]) => addCarry(t, k, n, G)); },
  // the nearest spot on the shore of the main pond (for drinking and fishing)
  shoreNear(at, L) {
    if (L && L.shore && L.shore.length) return L.shore.reduce((a, b) => (dist(at, a) < dist(at, b) ? a : b));
    const pond = G.pond || { x: 0, z: 0, r: 5 }, d = Math.max(0.01, dist(at, [pond.x, pond.z])), r = (pond.r || 5) + 0.6;
    return [pond.x + ((at[0] - pond.x) / d) * r, pond.z + ((at[1] - pond.z) / d) * r];
  },
  // How a task is done from here: { to: where to stand, seconds, pose }, or null if it can't be done (now or ever)
  taskHow(p, task, L, t) {
    const w = this.world, at = [p.x, p.z];
    if (!w || !task) return null;
    if (task.from != null && !(p.took || []).includes(task.from)) return null; // moving a loose item whose pick-up didn't happen
    const nearThing = (th) => { const s = (PLACEABLES[th.kind] || {}).solid || 0.5; return toward(at, [th.x, th.z], s + 0.35, s + 0.75); };
    switch (task.type) {
      case 'walk': return task.x != null && task.z != null ? { to: [task.x, task.z], seconds: 0 } : null;
      case 'pickup': {
        const it = w.items.find((x) => x.id === task.id);
        if (!it || !G.items[it.kind] || !this.canCarry(p, { [it.kind]: 1 })) return null;
        return { to: toward(at, [it.x, it.z], 0.5, 0.75), seconds: 0.5, pose: 'bend' };
      }
      case 'use': {
        const src = G.sources[task.source];
        if (!src) return null;
        if (src.water) { // a drink: only if they're thirsty (the game says Not thirsty and moves on)
          const helps = Object.entries(src.gives || {}).some(([k, v]) => p.stats[k] != null && (v > 0 ? p.stats[k] < 99.5 : p.stats[k] > 0.5));
          return helps ? { to: this.shoreNear(at, L), seconds: src.seconds || 2, pose: src.pose || 'kneel' } : null;
        }
        const i = task.bush;
        if (i == null || !this.isThing('bush', i) || this.berriesOn(i, t) < 1 || !this.canCarry(p, src.harvest || {})) return null;
        const spot = this.spotOf('bush', i) || (task.x != null ? [task.x, task.z] : null);
        return spot ? { to: toward(at, spot, 1.0, 1.6), seconds: src.seconds || 2, pose: src.pose || 'pick' } : null;
      }
      case 'drop': {
        if (!task.kind || !(p.carry[task.kind] > 0)) return null;
        if (task.x == null || task.z == null) return { seconds: 0.5, pose: 'bend' }; // by their feet
        return { to: toward(at, [task.x, task.z], 1.6, 2.4), seconds: 0.5, pose: 'bend' };
      }
      case 'chop': {
        const C = G.chopping || {}, what = task.what, rule = C[what === 'oldStump' ? 'stump' : what];
        if (!rule || !rule.seconds || (C.tool && !onBar(p, C.tool, G))) return null; // only tools on the tool bar get used
        let spot = null;
        if (what === 'tree' || what === 'stump') {
          const i = task.idx, st = (w.trees || {})[i];
          if (i == null || !this.isThing('tree', i) || (what === 'tree' ? st : !st || st[0] !== 'stump')) return null; // chopped (or grown back) since
          spot = this.spotOf('tree', i);
        } else if (what === 'oldStump') {
          if (task.idx == null || !this.isThing('oldStump', task.idx) || (w.oldStumps || {})[task.idx]) return null;
          spot = this.spotOf('oldStump', task.idx);
        } else { // a log on the ground
          const it = w.items.find((x) => x.id === task.id && x.kind === what);
          if (!it) return null;
          spot = [it.x, it.z];
        }
        spot = spot || (task.x != null ? [task.x, task.z] : null);
        const stop = what === 'tree' ? 0.95 : what === 'stump' || what === 'oldStump' ? 0.85 : 0.6;
        return spot ? { to: toward(at, spot, stop), seconds: rule.seconds, pose: 'chop' } : null;
      }
      case 'cut': {
        const def = (G.plants || {})[task.plant], i = task.i;
        if (!def || i == null || !this.isPlant(task.plant, i) || !this.canCarry(p, def.gives || {})) return null;
        const ready = ((w.plants || {})[task.plant] || {})[i];
        if (ready && ready > Math.max(t, Date.now())) return null; // not grown back yet
        const spot = this.plantSpot(task.plant, i) || (task.x != null ? [task.x, task.z] : null);
        const tool = def.tool && onBar(p, def.tool, G);
        if (def.toolNeeded && !tool) return null; // can't be done by hand (an ore vein, 0.2.0)
        return spot ? { to: toward(at, spot, 0.55, 0.9), seconds: (tool ? def.toolSeconds || def.seconds : def.seconds) || 6, pose: def.pose || 'pick' } : null;
      }
      case 'mine': {
        const R = G.mining || {}, what = task.what, rule = R[what], i = task.idx;
        if ((what !== 'rock' && what !== 'boulder') || !rule || i == null || !this.isThing('rock', i) || (w.rocks || {})[i] || (R.tool && !onBar(p, R.tool, G))) return null;
        const spot = this.spotOf('rock', i) || (task.x != null ? [task.x, task.z] : null);
        return spot ? { to: toward(at, spot, what === 'boulder' ? 1.6 : 1.0), seconds: rule.seconds || 10, pose: 'chop' } : null;
      }
      case 'fish': {
        const F = (Object.values(G.sources).find((s) => s.water && s.fish) || {}).fish;
        if (!F || !onBar(p, F.tool, G) || !this.canCarry(p, { [F.catch]: 1 }) || this.pondFish(F) < 1) return null;
        return { to: this.shoreNear(at, L), seconds: F.seconds || 8, pose: 'kneel' };
      }
      case 'place': {
        const kind = task.item && (G.items[task.item] || {}).places, rule = PLACEABLES[kind];
        if (!rule || !p.carry[task.item] || task.x == null || task.z == null) return null;
        const s = rule.solid || 0.5;
        return { to: toward(at, [task.x, task.z], s + 0.45, s + 0.9), seconds: 0.9, pose: 'bend' };
      }
      case 'build': {
        const th = this.placedById(task.id);
        return th && !th.built ? { to: nearThing(th), seconds: (PLACEABLES[th.kind] || {}).buildSeconds || 10, pose: 'kneel' } : null;
      }
      case 'unplace': {
        const th = this.placedById(task.id), P = th && PLACEABLES[th.kind];
        if (!P || (th.built && fireRule(th.kind) && this.burn(th).lit) || !this.canCarry(p, { [P.item]: 1 })) return null; // a lit fire has to be put out first
        return { to: nearThing(th), seconds: th.built ? 2 : 0.9, pose: 'bend' };
      }
      case 'apart': {
        const th = this.placedById(task.id);
        return th && th.built ? { to: nearThing(th), seconds: 3, pose: 'kneel' } : null;
      }
      case 'tend': {
        const th = this.placedById(task.id), f = th && fireRule(th.kind);
        if (!f || !th.built) return null;
        this.burn(th);
        if (task.do === 'add') {
          const kind = has(f.fuels, task.fuel) ? task.fuel : f.fuel;
          if (Math.min(task.n || 1, p.carry[kind] || 0, fuelRoom(f, th.fuel, kind)) < 1) return null; // none left, or the fire is full
        } else if (task.do === 'light') { if (th.lit || th.fuel <= 0) return null; } // already lit, or nothing to burn
        else if (task.do === 'out') { if (!th.lit) return null; }
        else return null;
        return { to: nearThing(th), seconds: task.do === 'light' ? f.lightSeconds || 3 : 1.2, pose: task.do === 'out' ? 'bend' : 'kneel' };
      }
      case 'sit': {
        const th = this.placedById(task.id), seats = th && (PLACEABLES[th.kind] || {}).seats;
        if (!seats || !th.built || (fireRule(th.kind) && !this.burn(th).lit)) return null; // (only by a lit fire)
        let k = -1;
        for (let s = 0; s < (seats.count || 6) && k < 0; s++) if (!this.sitterAt(th.id, s, Date.now(), p.who)) k = s;
        if (k < 0) return null; // no room
        task.seat = k;
        return { to: seatAt(th, k), seconds: 0.3 };
      }
      case 'make': {
        const th = this.placedById(task.id), r = has(G.recipes, task.recipe) ? G.recipes[task.recipe] : null;
        if (!th || !r || !th.built || (fireRule(th.kind) && !this.burn(th).lit)) return null; // cooking needs the fire lit
        if (Object.entries(recipeWants(r)).some(([k, n]) => (p.carry[k] || 0) < n)) return null; // not got what it takes (tools it keeps too)
        return { to: nearThing(th), seconds: r.seconds || 1.6, pose: 'kneel' };
      }
      // farming (0.1.18): dig a field (its tool on the bar, in their own camp), flatten one, plant seeds, pick what grew
      case 'dig': {
        const rule = PLACEABLES[task.kind];
        if (!rule || !rule.madeWith || !onBar(p, rule.madeWith, G)) return null;
        if (rule.inCamp) { const c = this.claimAt(task.x, task.z); if (!c || !this.claimIsMine(c, p.who)) return null; }
        const s = rule.solid || 0.5;
        return { to: toward(at, [task.x, task.z], s + 0.45, s + 0.9), seconds: rule.makeSeconds || 8, pose: 'chop' };
      }
      case 'flatten': {
        const th = this.placedById(task.id), rule = th && PLACEABLES[th.kind];
        return rule && rule.madeWith && onBar(p, rule.madeWith, G) ? { to: nearThing(th), seconds: rule.flattenSeconds || 4, pose: 'chop' } : null;
      }
      case 'plant': {
        const th = this.placedById(task.id), rule = th && PLACEABLES[th.kind];
        const kind = rule && Object.keys(CROPS).find((k) => CROPS[k].seed === task.seed && (CROPS[k].on || 'field') === th.kind);
        if (!kind || th.crop || !(p.carry[task.seed] > 0)) return null; // something's growing there already, or no seeds left
        return { to: nearThing(th), seconds: CROPS[kind].plantSeconds || 3, pose: 'kneel' };
      }
      case 'harvest': {
        const th = this.placedById(task.id), src = th && th.crop && cropSource(th.crop);
        if (!src || !src.harvest || !cropGrown(th.crop) || cropBerries(th.crop) < 1 || !this.canCarry(p, src.harvest)) return null;
        return { to: nearThing(th), seconds: src.seconds || 2, pose: src.pose || 'pick' };
      }
      default: return null;
    }
  },
  // the message their game would have sent at the end of the task (null: nothing to send, like a walk)
  taskMessage(p, task) {
    switch (task.type) {
      case 'pickup': return { t: 'take', id: task.id };
      case 'use': return G.sources[task.source] && G.sources[task.source].water ? { t: 'drink', source: task.source } : { t: 'pick', bush: task.bush };
      case 'drop': {
        const n = Math.min(task.n || 1, p.carry[task.kind] || 0), items = [];
        for (let i = 0; i < n; i++) {
          if (task.x == null) { items.push({ kind: task.kind }); continue; } // (by their feet: the server picks the spot)
          const a = i * 2.39996, r = i === 0 ? 0 : 0.16 + Math.sqrt(i) * 0.15; // a small pile, the same as the game's
          items.push({ kind: task.kind, x: num(task.x + Math.cos(a) * r), z: num(task.z + Math.sin(a) * r), rot: i === 0 && task.rot != null ? task.rot : num(Math.random() * Math.PI), ...(i === 0 && task.which != null ? { which: task.which } : {}) });
        }
        return { t: 'drop', items };
      }
      case 'chop': return { t: 'chop', what: task.what, idx: task.idx, id: task.id, x: task.x, z: task.z };
      case 'cut': return { t: 'cut', plant: task.plant, i: task.i };
      case 'mine': return { t: 'quarry', what: task.what, idx: task.idx, x: num(p.x), z: num(p.z) };
      case 'fish': return { t: 'fish' };
      case 'place': return { t: 'place', kind: task.item, x: task.x, z: task.z, rot: task.rot || 0 };
      case 'build': return { t: 'build', id: task.id };
      case 'unplace': return { t: 'unplace', id: task.id };
      case 'apart': return { t: 'apart', id: task.id };
      case 'tend': return { t: 'fire', id: task.id, do: task.do, n: task.n || 1, fuel: task.fuel };
      case 'sit': return { t: 'sit', id: task.id, seat: task.seat };
      case 'make': return { t: 'craft', id: task.recipe };
      case 'dig': return { t: 'dig', kind: task.kind, x: task.x, z: task.z, rot: task.rot || 0 };
      case 'flatten': return { t: 'flatten', id: task.id };
      case 'plant': return { t: 'plant', id: task.id, seed: task.seed };
      case 'harvest': return { t: 'harvest', id: task.id };
      default: return null;
    }
  },
  // The work is done: do it, as them, with the same handler their game's message would use (actions.js)
  finishTask(p, t) {
    const task = p.tasks && p.tasks.shift();
    if (!task) return;
    this.touch(p);
    const m = this.taskMessage(p, task);
    if (!m) { if (task.type === 'walk') this.taskDone(p); return; } // a walk is done by getting there
    const got = this.actAs(p, m);
    if (!got || got.some(refused)) return; // someone got there first, or it isn't theirs: on to the next, as in the game
    this.taskDone(p);
    if (task.type === 'pickup') p.took = [...(p.took || []), task.id].slice(-MAX_TASKS); // for moving a loose item (task.from)
    if (task.type === 'place') { // put down: build it next, as their game does (online.js "placed")
      const th = this.placedList().filter((x) => x.by === p.who && !x.built && Math.hypot(x.x - task.x, x.z - task.z) < 0.05).pop();
      if (th) p.tasks.unshift({ type: 'build', id: th.id });
    }
  },
  taskDone(p) { p.log = p.log || {}; p.log.tasks = (p.log.tasks || 0) + 1; },
  // Run an action's handler as this person, with no game connected: what it answers is collected (and checked by finishTask)
  actAs(p, m) {
    const action = Object.hasOwn(ACTIONS, m.t) ? ACTIONS[m.t] : null;
    if (!action || !this.alive(p) || (action.when === 'world' && !this.world)) return null;
    const got = [], me = { id: p.who, who: p.who, admin: false, alive: true };
    const oops = (err) => this.noteError(`a task while away (${m.t})`, err);
    try {
      const done = action.run.call(this, { ws: null, me, m, p, w: this.world, reply: (msg) => got.push(msg), save: () => this.touch(p) });
      if (done && typeof done.catch === 'function') done.catch(oops); // (what it changes happens straight away; saving finishes later)
    } catch (err) { oops(err); return null; }
    return got;
  },
  // what's left of their list, for their game when they come back: a loose item's move goes with it if its pick-up happened
  tasksBack(p) {
    const took = new Set(p.took || []), pending = new Set((p.tasks || []).filter((q) => q.type === 'pickup').map((q) => q.id)), out = [];
    for (const t of p.tasks || []) {
      if (t.from == null) out.push(t);
      else if (took.has(t.from)) { const c = { ...t }; delete c.from; out.push(c); }
      else if (pending.has(t.from)) out.push(t);
    }
    return out;
  },
};
