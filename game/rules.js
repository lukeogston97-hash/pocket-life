/* ---------- rules the game and the server share ----------
   One copy of each rule that both sides have to work out the same way: needs, berries growing back, fires and
   fuel, seats, the chat filter, kinds of item, where a claim can go. Change a rule here and both sides change.
   The server's copy (server/src/rules.js) is made from this file by `python3 tools/worlds.py test-build`;
   never edit that copy. Keep everything here plain: no THREE, no page, nothing from other parts. */

/* ---------- needs ---------- */
// One slice of time: every need moves by perHour, an empty need (atZero) drags others down, and needs marked
// onlyWhenFine (health) only recover while nothing is empty. Asleep: whileAsleep instead (whileAsleepAtNight at
// night, so Rest fills faster at night). Sitting by a fire: whileSitting. floor (asleep while away): needs that
// can empty stop at the floor (or where they were, if lower), and nothing hurts.
// st: { id: 0..100 }, needs: the stats from game-data.json, o: { asleep, night, sitting, floor }
export function needsStep(st, hours, needs, o = {}) {
  const floor = o.floor ?? null, clamp = (v) => Math.max(0, Math.min(100, v));
  const empty = floor != null ? [] : needs.filter((s) => s.atZero && st[s.id] <= 0);
  const change = {}, before = floor != null ? { ...st } : null;
  for (const s of needs) {
    const sleepRate = o.night && Number.isFinite(s.whileAsleepAtNight) ? s.whileAsleepAtNight : s.whileAsleep;
    change[s.id] = s.onlyWhenFine && empty.length ? 0 : o.asleep && Number.isFinite(sleepRate) ? sleepRate : o.sitting && Number.isFinite(s.whileSitting) ? s.whileSitting : s.perHour || 0;
  }
  for (const s of empty) for (const [k, v] of Object.entries(s.atZero)) if (k in change) change[k] += v;
  for (const s of needs) {
    st[s.id] = clamp((st[s.id] ?? 0) + change[s.id] * hours);
    if (before && s.atZero) st[s.id] = Math.max(st[s.id], Math.min(before[s.id] ?? 0, floor));
  }
}

/* ---------- the pond ---------- */
// How far x, z is from the middle of the pond, as a share of the way to its shore in that direction: under 1 is water,
// 1 is the shoreline. The pond isn't round (its edge wobbles). pond: { x, z, r }.
// The land itself is shaped by pondShape in game/land.js, which is this same sum with the game's POND. That one is
// left exactly as it was, because the world's layout must never move; the check `menu` compares the two. The server
// uses this one to see that nothing is placed in the water (server/src/guard.js cantPlaceAt).
export function pondShapeAt(pond, x, z) {
  const dx = x - pond.x, dz = (z - pond.z) * 1.22;
  const a = Math.atan2(dz, dx);
  const r = pond.r * (1 + 0.13 * Math.sin(a * 3 + 1.1) + 0.06 * Math.sin(a * 5 - 0.7));
  return Math.hypot(dx, dz) / r;
}

/* ---------- berry bushes: picked berries grow back one at a time ---------- */
// count, from: how many were left and since when (count null: never picked); holds: a full bush; regrowMs: a whole bush
export function berriesGrown(count, from, holds, regrowMs, t) {
  if (count == null || !regrowMs) return holds;
  return Math.min(holds, count + Math.floor((t - from) / (regrowMs / holds)));
}
// one berry picked at t: the bush's new [count, from]
export function berryPicked(count, from, holds, regrowMs, t) {
  let n = holds, f = t;
  if (count != null && regrowMs) {
    const every = regrowMs / holds, grown = Math.floor((t - from) / every);
    n = Math.min(holds, count + grown);
    f = n >= holds ? t : from + grown * every;
  }
  return [n - 1, f];
}

/* ---------- farming (0.1.18): a crop planted on a farm field grows by itself ---------- */
// how grown it is at t: 0 just planted, 1 grown (at: when it was planted, growMs: how long it takes)
export const cropGrowth = (at, growMs, t) => (growMs > 0 ? Math.max(0, Math.min(1, (t - at) / growMs)) : 1);
// how it looks at that point: a sprout for the first third, then a small bush getting bigger, then grown
export const cropStage = (k) => (k >= 1 ? 'grown' : k < 1 / 3 ? 'sprout' : 'young');

/* ---------- stumps growing back into trees ---------- */
// chopping.regrowDays: a number of days, or [soonest, latest] (Luke, 0.1.16: 1 to 2 days). As [first, second], unsorted.
export function daysSpan(v, dflt = 3) {
  const [a, b] = Array.isArray(v) ? v : [v, v];
  const lo = Number.isFinite(a) ? a : dflt;
  return [lo, Number.isFinite(b) ? b : lo];
}
// How long after it was chopped (since, in ms) stump i grows back, in ms: each stump gets its own time in the span,
// worked out from the stump and when it was chopped, so the game and the server agree without saying so.
export function stumpBackMs(days, i, since) {
  const [a, b] = daysSpan(days), lo = Math.min(a, b), hi = Math.max(a, b);
  let h = Math.imul((i | 0) + 1, 2654435761) ^ Math.floor((since || 0) / 1000);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (lo + (hi - lo) * (((h ^ (h >>> 16)) >>> 0) / 4294967296)) * 86400000;
}

/* ---------- fires and fuel (placeables with "fire" in game-data.json) ---------- */
// the fire's rules in ms: each fuel it takes and how long one burns, and the most it holds (maxHours of burning,
// or maxFuel of its main fuel). isItem(kind): is that an item in the game?
export function fireRuleOf(f, isItem) {
  if (!f) return null;
  const fuel = isItem(f.fuel) ? f.fuel : 'stick', each = Math.max(1, Number(f.secondsEach) || 300) * 1000, fuels = { [fuel]: each };
  for (const [k, s] of Object.entries(f.otherFuels || {})) if (isItem(k) && s > 0) fuels[k] = s * 1000;
  const maxFuel = Math.max(1, Math.floor(f.maxFuel) || 10);
  return { fuel, each, fuels, maxFuel, max: f.maxHours > 0 ? f.maxHours * 3600000 : each * maxFuel, lightSeconds: Math.max(0.5, Number(f.lightSeconds) || 3) };
}
// ms of burning left: fuel only goes down while lit, counted from `at`
export function fuelLeftAt(th, now) { return th.lit ? Math.max(0, (th.fuel || 0) - (now - (th.at || now))) : th.fuel || 0; }
// how many more of a fuel fit (one that only part fits still goes on)
export function fuelRoom(rule, left, kind) { return Math.max(0, Math.ceil((rule.max - left) / (rule.fuels[kind] || rule.each) - 0.05)); }

/* ---------- seats round a placed thing ---------- */
export function seatSpotOf(th, seats, k) {
  const n = Math.max(1, Math.floor((seats || {}).count) || 6), d = Number((seats || {}).distance) || 1.2, a = (th.rot || 0) + (k * Math.PI * 2) / n;
  return [th.x + Math.sin(a) * d, th.z + Math.cos(a) * d];
}

/* ---------- the placing grid (0.1.17; 1 m squares since 0.2.2, Luke: half a metre was too fiddly to line up) ----------
   Placed things go on an invisible grid of PLACE_GRID metre squares and face one of 4 ways. Each placeable's size is
   in squares ([across, deep], from game-data.json; 1 x 1 if it doesn't say), so its size is in metres too. Things can
   sit side by side, but nothing comes within keepClear metres of one that has it (a campfire keeps room for its seats). */
export const PLACE_GRID = 1;
const placeSizeOf = (rule) => (Array.isArray(rule && rule.size) && rule.size.length === 2 ? rule.size.map((n) => Math.max(1, Math.round(Number(n) || 1))) : [1, 1]);
// the nearest spot on the grid, and the nearest of the 4 ways to face
export function placeSnap(x, z, rot, rule) {
  const q = ((Math.round((Number(rot) || 0) / (Math.PI / 2)) % 4) + 4) % 4;
  const [w, d] = placeSizeOf(rule), [across, deep] = q % 2 ? [d, w] : [w, d];
  const snap = (v, n) => Math.round((Math.round((Number(v) || 0) / PLACE_GRID - n / 2) + n / 2) * PLACE_GRID * 100) / 100;
  return { x: snap(x, across), z: snap(z, deep), rot: Math.round(q * (Math.PI / 2) * 100) / 100 };
}
// a placed thing's square: { x, z, rot, hw, hd } (half its size across and deep, before turning)
export function placeRect(th, rule) {
  const [w, d] = placeSizeOf(rule);
  return { id: th.id, x: Number(th.x) || 0, z: Number(th.z) || 0, rot: Number(th.rot) || 0, hw: (w * PLACE_GRID) / 2, hd: (d * PLACE_GRID) / 2 };
}
// the gap between two squares in metres (below 0 when they overlap). Turned ones count as the box round them.
export function placeGap(a, b) {
  const box = (f) => { const c = Math.abs(Math.cos(f.rot)), s = Math.abs(Math.sin(f.rot)); return [c * f.hw + s * f.hd, s * f.hw + c * f.hd]; };
  const [ax, az] = box(a), [bx, bz] = box(b);
  const gx = Math.abs(a.x - b.x) - ax - bx, gz = Math.abs(a.z - b.z) - az - bz;
  if (gx < 0 && gz < 0) return Math.max(gx, gz);
  return Math.hypot(Math.max(0, gx), Math.max(0, gz));
}
// the first placed thing in the way of putting `kind` at th (null if none): rules is the placeables from game-data.json
export function placeClash(list, th, kind, rules) {
  const me = placeRect(th, rules[kind]), myClear = Number((rules[kind] || {}).keepClear) || 0;
  for (const o of list) {
    if (o.id != null && o.id === th.id) continue;
    const need = Math.max(myClear, Number((rules[o.kind] || {}).keepClear) || 0);
    if (placeGap(me, placeRect(o, rules[o.kind])) < need - 0.001) return o;
  }
  return null;
}

/* ---------- crafting on the craft mat (0.1.8): put things together and see what they make ---------- */
// everything a recipe wants on the mat: what it uses up (needs) and the tools it keeps (keeps, like a sharp stone)
export function recipeWants(r) {
  const out = { ...(r.needs || {}) };
  for (const [k, n] of Object.entries(r.keeps || {})) out[k] = (out[k] || 0) + n;
  return out;
}
// mat: what's on the mat { kind: how many }. Is it exactly what the recipe wants (the same things, the same number of each)?
export function matIs(mat, r) {
  const want = recipeWants(r), on = Object.entries(mat).filter(([, n]) => n > 0);
  return on.length === Object.keys(want).length && on.every(([k, n]) => want[k] === n);
}

/* ---------- kinds of item: the headings in Recipes and in the admin's item lists ----------
   The list and its order come from itemGroups in game-data.json (Luke, 26 Nov 2026); this one is only the fallback. */
export const ITEM_GROUPS = ['Materials', 'Parts', 'Tools', 'Food', 'Building', 'Clothing', 'Decoration', 'Misc'];
// it: { group, uses, eat, places }: its own group if it has one (the tool heads are Parts), else a tool is Tools, food
// Food, a placeable Building, anything else Materials (or the last heading, if the list has no such one)
export function itemGroupOf(it, groups = ITEM_GROUPS) {
  if (it.group && groups.includes(it.group)) return it.group;
  const g = it.uses ? 'Tools' : Object.keys(it.eat || {}).length ? 'Food' : it.places ? 'Building' : 'Materials';
  return groups.includes(g) ? g : groups[groups.length - 1];
}

/* ---------- the tool bar (0.1.17, Luke) ----------
   Tools sit on a bar of settings.toolSlots spots above the inventory. Only tools on the bar get used (by themselves, no
   picking), and they weigh nothing; a tool in the inventory squares is carried like anything else and has to be equipped
   first. A tool you make or pick up goes on the bar while there's room. carry: { kind: n }, everything carried; bar:
   { kind: n }, the tools on the bar (they're part of carry too, the first ones in each tool's wear list). items: the item
   rules (ITEMS in the game, G.items on the server), each with weight and uses (a tool has uses). */
export const barUsed = (bar) => Object.values(bar || {}).reduce((s, n) => s + (n > 0 ? n : 0), 0);
// the weight that counts toward carryCapacity: everything but the tools on the bar
export const bagWeight = (carry, bar, items) => Object.entries(carry || {})
  .reduce((s, [k, n]) => s + ((items[k] && items[k].weight) || 0) * Math.max(0, n - ((bar || {})[k] || 0)), 0);
// keep a bar in step with what's carried: only tools that are carried, never more than slots in all (in items order).
// bar null (someone from before the tool bar): their tools go on it, as many as fit
export function tidyBar(bar, carry, items, slots) {
  const out = {};
  let room = slots;
  for (const k of Object.keys(items)) {
    const want = bar ? (bar[k] || 0) : carry[k] || 0;
    const n = items[k].uses ? Math.min(Math.floor(want) || 0, carry[k] || 0, room) : 0;
    if (n > 0) { out[k] = n; room -= n; }
  }
  return out;
}

/* ---------- inventory squares and stacks (0.2.1, Luke: "Lock in 10 squares for inventory, keep the 30 weight") ----------
   The inventory has settings.inventorySquares squares. One square holds a stack of one kind of thing: up to
   settings.stackSize, or the item's own "stack"; a tool or something you place is 1 a square (Luke). Tools on the tool
   bar don't use squares. The carryCapacity weight still counts as well (bagWeight). items: each with uses (a tool),
   places (something you place) and stack. size: settings.stackSize. */
export const stackOf = (it, size) => (!it || it.uses || it.places ? 1 : Math.max(1, Math.floor(Number(it.stack) || Number(size) || 10)));
// how many squares what's carried takes (the tools on the bar take none)
export const squaresUsed = (carry, bar, items, size) => Object.entries(carry || {})
  .reduce((s, [k, n]) => s + Math.ceil(Math.max(0, n - ((bar || {})[k] || 0)) / stackOf(items[k], size)), 0);
/* ---------- storage (0.2.2, the small wooden crate) ----------
   A placed thing with storage holds things in its own squares, the same squares and stacks as the inventory. store:
   { kind: n } what's in it, squares: how many it has. How many more of `kind` fit: the squares the other kinds leave
   free, as stacks of it, less what's already in. */
export function storeRoom(store, kind, items, size, squares) {
  const others = squaresUsed({ ...(store || {}), [kind]: 0 }, null, items, size);
  return Math.max(0, (squares - others) * stackOf(items[kind], size) - ((store || {})[kind] || 0));
}

/* ---------- claims: can a fire lit at x, z claim the land round it? ---------- */
// o: { radius, spawnRadius, pond: { x, z }, hasClaim, claims: [{ x, z, name }] } (claims: every other claim's fire)
// Returns null if it can, else why not: { why: 'has' | 'pond' | 'near', name }
export function claimProblem(x, z, o) {
  if (o.hasClaim) return { why: 'has' };
  if (Math.hypot(x - o.pond.x, z - o.pond.z) < o.spawnRadius + o.radius) return { why: 'pond' };
  const near = (o.claims || []).find((c) => Math.hypot(c.x - x, c.z - z) < o.radius * 2);
  return near ? { why: 'near', name: near.name } : null;
}

/* ---------- the chat filter: bad words become stars, bad names are refused (chatFilter in game-data.json) ---------- */
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
const leet = (s) => s.toLowerCase().replace(/[0134578@$!|+]/g, (c) => LEET[c]);
const ENDINGS = ['', 's', 'es', 'ed', 'ing', 'y', 'er', 'ers'];
function badWord(token, F) {
  const n = leet(token).replace(/[^a-z]/g, '');
  if (!n) return false;
  for (const f of new Set([n, n.replace(/(.)\1+/g, '$1')])) { // also with doubled letters squashed (fuuuck)
    if ((F.anywhere || []).some((r) => f.includes(r))) return true;
    if ((F.words || []).some((w) => ENDINGS.some((e) => f === w + e))) return true;
  }
  return false;
}
export function starText(text, F) {
  let out = String(text).replace(/\S+/g, (tok) => (badWord(tok, F) ? '*'.repeat(tok.length) : tok));
  for (const p of F.phrases || []) {
    const re = new RegExp(`\\b${p.split(/\s+/).map((w) => w.replace(/[^a-z]/gi, '')).join('[\\s\\W_]+')}\\b`, 'gi');
    out = out.replace(re, (m) => m.replace(/\S/g, '*'));
  }
  return out;
}
const badNameIn = (name, F) => String(name).split(/[\s._-]+/).some((t) => badWord(t, F))
  || (F.anywhere || []).some((r) => leet(name).replace(/[^a-z]/g, '').includes(r)) || starText(name, F) !== String(name);
export const badName = (name, F) => badNameIn(name, F) || (!!F.names && badNameIn(name, F.names)); // names also can't say admin, mod and so on
