// People live on the server: their needs, what they carry and where they are.
// G is server/game.json (copied from the game's game-data.json by tools/worlds.py).

export const HOUR = 3600000, MINUTE = 60000;
const clampStat = (v) => Math.max(0, Math.min(100, v));

// how long a sleep takes to fill rest, in ms (at normal speed)
export function sleepMs(p, G) {
  const r = G.needs.find((s) => s.id === 'rest');
  if (!r || !r.whileAsleep) return 0;
  return Math.max(60000, ((100 - (p.stats.rest ?? 0)) / r.whileAsleep) * HOUR);
}
export function freshStats(G) {
  const st = {};
  for (const s of G.needs) st[s.id] = clampStat(s.start ?? 100);
  return st;
}
// one slice of time, the same as in the game: every need moves by perHour, an empty need (atZero)
// drags others down, and needs marked onlyWhenFine (health) only recover while nothing is empty
// (asleep: needs with whileAsleep, like Rest, change by that instead)
function step(st, hours, G, asleep) {
  const empty = G.needs.filter((s) => s.atZero && st[s.id] <= 0);
  const change = {};
  for (const s of G.needs) change[s.id] = s.onlyWhenFine && empty.length ? 0 : asleep && s.whileAsleep != null ? s.whileAsleep : s.perHour;
  for (const s of empty) for (const [k, v] of Object.entries(s.atZero)) if (k in change) change[k] += v;
  for (const s of G.needs) st[s.id] = clampStat((st[s.id] ?? 0) + change[s.id] * hours);
}
// what they died of: the empty need that hurts most
function causeOf(st, G) {
  const c = G.needs.filter((s) => s.atZero && st[s.id] <= 0).sort((a, b) => (a.atZero.health ?? 0) - (b.atZero.health ?? 0))[0];
  return c ? c.name.toLowerCase() : 'weakness';
}
// Move a person's needs on to time `to`, a minute at a time. speed: the admin's "speed up time" ({ x, until }).
// Returns { at, cause } if they died on the way.
export function advanceStats(p, to, G, speed) {
  let t = p.statsAt || to;
  while (t < to) {
    const next = Math.min(to, t + MINUTE);
    const fast = speed && t < speed.until ? speed.x : 1;
    step(p.stats, ((next - t) / HOUR) * fast, G, !!p.sleeping);
    t = next;
    if (G.needs.some((s) => s.deadAtZero && p.stats[s.id] <= 0)) { p.statsAt = t; return { at: t, cause: causeOf(p.stats, G) }; }
  }
  p.statsAt = Math.max(p.statsAt || 0, to);
  return null;
}
export const weightOf = (carry, G) => Object.entries(carry || {}).reduce((sum, [k, n]) => sum + ((G.items[k] && G.items[k].weight) || 0) * n, 0);
export function addCarry(p, kind, n, G) {
  if (!G.items[kind] || weightOf(p.carry, G) + G.items[kind].weight * n > G.carryCapacity + 1e-6) return false;
  p.carry[kind] = (p.carry[kind] || 0) + n;
  p.lastKind = kind;
  return true;
}
export function takeCarry(p, kind, n) {
  const have = p.carry[kind] || 0, taken = Math.min(have, n);
  if (taken <= 0) return 0;
  if (have - taken > 0) p.carry[kind] = have - taken; else { delete p.carry[kind]; if (p.wear) delete p.wear[kind]; } // a tool's wear goes with the last one
  if (!p.carry[p.lastKind]) p.lastKind = Object.keys(p.carry)[0] || null;
  return taken;
}
export function applyGives(p, gives) {
  for (const [k, v] of Object.entries(gives || {})) if (k in p.stats) p.stats[k] = clampStat(p.stats[k] + v);
}
// eat the first food they carry; true if they ate
export function eatOne(p, G, kind) {
  const k = kind || Object.keys(p.carry).find((x) => G.items[x] && G.items[x].eat);
  if (!k || !p.carry[k] || !G.items[k] || !G.items[k].eat) return false;
  takeCarry(p, k, 1);
  applyGives(p, G.items[k].eat);
  return true;
}
// where a walking person is at time t
export function posAt(p, t) {
  const pl = p.plan;
  if (!pl || pl.kind !== 'walk') return [p.x, p.z];
  const k = Math.max(0, Math.min(1, (t - pl.start) / Math.max(1, pl.arrive - pl.start)));
  return [pl.from[0] + (pl.to[0] - pl.from[0]) * k, pl.from[1] + (pl.to[1] - pl.from[1]) * k];
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// make something from a recipe: true if it was made
export function craft(p, r, G) {
  if (!r) return false;
  for (const [k, n] of Object.entries(r.needs)) if ((p.carry[k] || 0) < n) return false;
  if (weightOf(p.carry, G) - weightOf(r.needs, G) + weightOf(r.makes, G) > G.carryCapacity + 1e-6) return false;
  for (const [k, n] of Object.entries(r.needs)) takeCarry(p, k, n);
  for (const [k, n] of Object.entries(r.makes)) {
    p.carry[k] = (p.carry[k] || 0) + n;
    p.lastKind = k;
    const it = G.items[k];
    if (it && it.uses) { p.wear = p.wear || {}; if (p.wear[k] == null) p.wear[k] = it.uses; }
  }
  return true;
}
// tasks take a little energy (energyCosts in game-data.json); never below zero
export function spend(p, what, G, amount = 1) {
  const c = ((G.energyCosts || {})[what] || 0) * amount;
  if (c && p.stats && p.stats.energy != null) p.stats.energy = Math.max(0, p.stats.energy - c);
}
