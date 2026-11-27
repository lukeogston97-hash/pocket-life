// People live on the server: their needs, what they carry and where they are.
// G is server/game.json (copied from the game's game-data.json by tools/worlds.py).

import { needsStep, recipeWants, barUsed, bagWeight, tidyBar, squaresUsed } from './rules.js';

export const HOUR = 3600000, MINUTE = 60000;
const clampStat = (v) => Math.max(0, Math.min(100, v));

// how long a sleep takes to fill rest, in ms (at normal speed)
export function sleepMs(p, G, better = 1) { // better: asleep in a bed (the basic shelter, 0.2.5) fills Rest that many times faster
  const r = G.needs.find((s) => s.id === 'rest');
  if (!r || !r.whileAsleep) return 0;
  return Math.max(60000, ((100 - (p.stats.rest ?? 0)) / (r.whileAsleep * Math.max(1, Number(better) || 1))) * HOUR);
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
// floor: asleep while away (needs stop at the floor and they can't die). better: asleep in a bed (the basic shelter, 0.2.5:
// the world's bedBetter). Returns { at, cause } if they died on the way.
export function advanceStats(p, to, G, speed, floor = null, better = 1) {
  let t = p.statsAt || to;
  const asleep = floor != null || !!p.sleeping;
  while (t < to) {
    const next = Math.min(to, t + MINUTE);
    const fast = speed && t < speed.until ? speed.x : 1;
    needsStep(p.stats, ((next - t) / HOUR) * fast, G.needs, { asleep, night: asleep && isNight(t, G), floor, sitting: !asleep && !!p.sit && t < p.sit.until, better }); // rules.js, the same as in the game
    t = next;
    if (floor == null && G.needs.some((s) => s.deadAtZero && p.stats[s.id] <= 0)) { p.statsAt = t; return { at: t, cause: causeOf(p.stats, G) }; }
  }
  p.statsAt = Math.max(p.statsAt || 0, to);
  return null;
}
export const weightOf = (carry, G) => Object.entries(carry || {}).reduce((sum, [k, n]) => sum + ((G.items[k] && G.items[k].weight) || 0) * n, 0);
// The tool bar (0.1.17, rules.js): p.bar = { kind: n }, the tools on it. They're in p.carry too, and they're the first
// p.bar[kind] of that tool's wear list. Someone from before the tool bar gets their tools put on it the first time.
export const toolSlots = (G) => Math.max(1, Math.floor(Number(G.toolSlots) || 7));
export function barOf(p, G) {
  const had = p.bar && typeof p.bar === 'object' && !Array.isArray(p.bar), tidy = tidyBar(had ? p.bar : null, p.carry || {}, G.items, toolSlots(G));
  if (!had) { p.bar = tidy; return p.bar; }
  for (const k of Object.keys(p.bar)) if (!(k in tidy)) delete p.bar[k]; // tidied in place: code holding p.bar keeps the same one
  return Object.assign(p.bar, tidy);
}
export const onBar = (p, kind, G) => barOf(p, G)[kind] || 0;
// what counts toward carryCapacity: everything but the tools on the bar
export const carriedWeight = (p, G) => bagWeight(p.carry, barOf(p, G), G.items);
// The inventory's squares (0.2.1, Luke: 10, and the 30 weight still counts): G.inventorySquares and G.stackSize are live
// settings, so they're read each time. rules.js squaresUsed: a square holds a stack of one kind; tools on the bar take none.
export const invSquares = (G) => Math.max(1, Math.floor(Number(G.inventorySquares) || 10));
export const squaresOf = (p, G) => squaresUsed(p.carry, barOf(p, G), G.items, G.stackSize);
// why n more of a kind can't go in what someone carries ('' if they can), in words for the player: too heavy, or no square
// for them. A tool goes on the tool bar while there's room (no weight, no square). Someone over the squares already (from
// before 0.2.1) can still top up a stack that has room.
export function carryNo(p, kind, n, G) {
  const it = Object.hasOwn(G.items, kind) ? G.items[kind] : null;
  if (!it) return "That can't be carried";
  const bar = barOf(p, G), up = it.uses ? Math.max(0, Math.min(n, toolSlots(G) - barUsed(bar))) : 0;
  if (carriedWeight(p, G) + it.weight * (n - up) > G.carryCapacity + 1e-6) return 'Too heavy to carry';
  const after = squaresUsed({ ...p.carry, [kind]: (p.carry[kind] || 0) + n }, up ? { ...bar, [kind]: (bar[kind] || 0) + up } : bar, G.items, G.stackSize);
  if (after > invSquares(G) && after > squaresOf(p, G)) return 'Your inventory is full';
  return '';
}
// putting things in what someone carries: a tool goes on the tool bar while there's room (Luke, 0.1.17), else in the
// inventory, where it weighs. uses: how worn the new ones are (a worn tool picked up), else new. False if too heavy or
// there's no square for them (carryNo says which).
export function addCarry(p, kind, n, G, uses) {
  const it = Object.hasOwn(G.items, kind) ? G.items[kind] : null;
  if (!it || carryNo(p, kind, n, G)) return false;
  const bar = barOf(p, G), up = it.uses ? Math.max(0, Math.min(n, toolSlots(G) - barUsed(bar))) : 0;
  if (it.uses) {
    const list = wearList(p, kind, G), b = bar[kind] || 0, left = uses ?? it.uses;
    list.splice(b, 0, ...Array(up).fill(left)); // the bar's come first in the list
    for (let i = up; i < n; i++) list.push(left);
    p.wear = p.wear || {};
    p.wear[kind] = list;
    if (up) bar[kind] = b + up;
  }
  p.carry[kind] = (p.carry[kind] || 0) + n;
  p.lastKind = kind;
  return true;
}
// moving one tool within its wear list (on or off the bar)
function shiftWear(p, kind, from, to, G) {
  const list = wearList(p, kind, G), [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  p.wear = p.wear || {};
  p.wear[kind] = list;
}
// Equip: a tool from the inventory onto the bar (Luke, 0.1.17). which: its place in the tool's wear list (the bar's come
// first, so it's at least p.bar[kind]); out: { kind, which } a tool on the bar to swap it with, when the bar is full.
// Returns '' when done, else why not, in words for the player.
export function equipTool(p, kind, which, out, G) {
  const it = Object.hasOwn(G.items, kind) ? G.items[kind] : null;
  if (!it || !it.uses) return "That isn't in your inventory"; // (only a real tool: a name every object has, like 'constructor', isn't one)
  const bar = barOf(p, G), have = p.carry[kind] || 0, b = (Object.hasOwn(bar, kind) && bar[kind]) || 0;
  if (have - b < 1) return "That isn't in your inventory";
  const w = Number.isInteger(which) && which >= b && which < have ? which : b;
  let off = null; // the one it swaps with
  if (barUsed(bar) >= toolSlots(G)) {
    const ob = out && Object.hasOwn(G.items, out.kind) ? bar[out.kind] || 0 : 0;
    if (!ob) return 'Your tool bar is full';
    off = { kind: out.kind, which: Number.isInteger(out.which) && out.which >= 0 && out.which < ob ? out.which : ob - 1 };
  }
  const heavier = (off ? G.items[off.kind].weight : 0) - it.weight;
  if (heavier > 0 && carriedWeight(p, G) + heavier > G.carryCapacity + 1e-6) return 'Too heavy to carry';
  if (off) { // off the bar first: it goes back to the inventory (its own kind's spares come after it)
    const ob = bar[off.kind];
    shiftWear(p, off.kind, off.which, ob - 1, G);
    if (ob > 1) bar[off.kind] = ob - 1; else delete bar[off.kind];
  }
  const b2 = bar[kind] || 0; // (one less if it swapped with one of its own kind; the one to equip hasn't moved)
  shiftWear(p, kind, w, b2, G);
  bar[kind] = b2 + 1;
  return '';
}
// Unequip: a tool off the bar, into the inventory, where it weighs. which: its place in the wear list (under p.bar[kind])
export function unequipTool(p, kind, which, G) {
  const it = Object.hasOwn(G.items, kind) ? G.items[kind] : null;
  const bar = barOf(p, G), b = (it && bar[kind]) || 0;
  if (b < 1) return "That isn't on your tool bar";
  if (carriedWeight(p, G) + it.weight > G.carryCapacity + 1e-6) return 'Too heavy to carry';
  if (squaresOf(p, G) + 1 > invSquares(G)) return 'Your inventory is full'; // (a tool takes a square of its own)
  shiftWear(p, kind, Number.isInteger(which) && which >= 0 && which < b ? which : b - 1, b - 1, G);
  if (b > 1) bar[kind] = b - 1; else delete bar[kind];
  return '';
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
  const w = p.wear && p.wear[kind], one = taken === 1 && Number.isInteger(which) && which >= 0 && which < have;
  if (w != null) { // keep the wear list in step: the taken tool's number goes with it
    const list = (Array.isArray(w) ? w : [w]).slice(0, have);
    if (one) list.splice(which, 1);
    list.length = Math.min(list.length, have - taken);
    if (list.length) p.wear[kind] = list; else delete p.wear[kind];
  }
  const b = p.bar && p.bar[kind]; // the tool bar (0.1.17): that one comes off it if it was on it, else spares in the inventory go first
  if (b > 0) { const nb = Math.min(one && which < b ? b - 1 : b, have - taken); if (nb > 0) p.bar[kind] = nb; else delete p.bar[kind]; }
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
  // tried on a copy first: a tool it makes goes on the bar if there's room (addCarry), so only the rest has to fit
  const t = { carry: { ...p.carry }, bar: { ...barOf(p, G) }, wear: structuredClone(p.wear || {}), lastKind: p.lastKind };
  for (const [k, n] of Object.entries(r.needs)) takeCarry(t, k, n);
  for (const [k, n] of Object.entries(r.makes)) if (!addCarry(t, k, n, G)) return false;
  Object.assign(p, t);
  return true;
}
// tasks take a little energy (energyCosts in game-data.json); never below zero
export function spend(p, what, G, amount = 1) {
  const c = ((G.energyCosts || {})[what] || 0) * amount;
  if (c && p.stats && p.stats.energy != null) p.stats.energy = Math.max(0, p.stats.energy - c);
}
