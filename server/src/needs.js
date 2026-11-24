// People live on the server: their needs, what they carry and where they are.
// G is server/game.json (copied from the game's game-data.json by tools/worlds.py).

import { needsStep, recipeWants } from './rules.js';

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
// The world's clock (G.timeZone, Darwin time): the hour of the day at time t, and night (G.night: from, to)
const G_TZ = { tz: 'Australia/Darwin' };
let tzFormat = null;
const offsets = new Map(); // the time zone's offset from UTC, worked out once per hour
function offsetAt(t) {
  const key = Math.floor(t / HOUR);
  if (offsets.has(key)) return offsets.get(key);
  let off = 9.5 * HOUR; // Darwin is UTC+9:30 all year
  try {
    tzFormat = tzFormat || new Intl.DateTimeFormat('en-US', { timeZone: G_TZ.tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const p = Object.fromEntries(tzFormat.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(t / MINUTE) * MINUTE;
  } catch (err) { /* no time zone data: Darwin */ }
  if (offsets.size > 200) offsets.clear();
  offsets.set(key, off);
  return off;
}
export function useTimeZone(tz) { if (tz && tz !== G_TZ.tz) { G_TZ.tz = tz; tzFormat = null; offsets.clear(); } }
// a Date whose UTC fields read as the world's local time at t
export const localDate = (t) => new Date(t + offsetAt(t));
export const hourAt = (t) => { const d = localDate(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };
export function isNight(t, G) {
  const n = G.night;
  if (!n) return false;
  const h = hourAt(t);
  return n.from > n.to ? h >= n.from || h < n.to : h >= n.from && h < n.to;
}
// the next morning (night.to) after t
export function morningAfter(t, G) {
  let dh = G.night.to - hourAt(t);
  if (dh <= 0) dh += 24;
  return t + dh * HOUR;
}
// how old a person is now: the age they started at, plus a year on each birthday (the day they were made)
export function ageOf(p, now = Date.now()) {
  if (!p.born) return p.age;
  const b = localDate(p.born), n = localDate(now);
  let years = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) years--;
  return p.age + Math.max(0, years);
}
// what they died of: the empty need that hurts most
function causeOf(st, G) {
  const c = G.needs.filter((s) => s.atZero && st[s.id] <= 0).sort((a, b) => (a.atZero.health ?? 0) - (b.atZero.health ?? 0))[0];
  return c ? c.name.toLowerCase() : 'weakness';
}
// Move a person's needs on to time `to`, a minute at a time. speed: the admin's "speed up time" ({ x, until }).
// floor: asleep while away (needs stop at the floor and they can't die). Returns { at, cause } if they died on the way.
export function advanceStats(p, to, G, speed, floor = null) {
  let t = p.statsAt || to;
  const asleep = floor != null || !!p.sleeping;
  while (t < to) {
    const next = Math.min(to, t + MINUTE);
    const fast = speed && t < speed.until ? speed.x : 1;
    needsStep(p.stats, ((next - t) / HOUR) * fast, G.needs, { asleep, night: asleep && isNight(t, G), floor, sitting: !asleep && !!p.sit && t < p.sit.until }); // rules.js, the same as in the game
    t = next;
    if (floor == null && G.needs.some((s) => s.deadAtZero && p.stats[s.id] <= 0)) { p.statsAt = t; return { at: t, cause: causeOf(p.stats, G) }; }
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
// A tool's wear is a list of uses left, one per tool carried, the one in use first; tools past the end of the list
// are new (saves from before 0.2.6 kept one number, for the one in use). wearList gives the whole list.
export function wearList(p, kind, G) {
  const n = p.carry[kind] || 0, full = (G.items[kind] || {}).uses || 0, w = (p.wear || {})[kind];
  const list = (Array.isArray(w) ? w : w != null ? [w] : []).slice(0, n);
  while (list.length < n) list.push(full);
  return list;
}
// taking things out of what someone carries; for a tool, which says which one (0 is the one in use), else spares go first
export function takeCarry(p, kind, n, which) {
  const have = p.carry[kind] || 0, taken = Math.min(have, n);
  if (taken <= 0) return 0;
  const w = p.wear && p.wear[kind];
  if (w != null) { // keep the wear list in step: the taken tool's number goes with it
    const list = (Array.isArray(w) ? w : [w]).slice(0, have);
    if (taken === 1 && Number.isInteger(which) && which >= 0 && which < have) list.splice(which, 1);
    list.length = Math.min(list.length, have - taken);
    if (list.length) p.wear[kind] = list; else delete p.wear[kind];
  }
  if (have - taken > 0) p.carry[kind] = have - taken; else delete p.carry[kind];
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
// (keeps: tools the recipe needs but doesn't use up, like a sharp stone: they have to be carried, and stay)
export function craft(p, r, G) {
  if (!r) return false;
  for (const [k, n] of Object.entries(recipeWants(r))) if ((p.carry[k] || 0) < n) return false;
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
