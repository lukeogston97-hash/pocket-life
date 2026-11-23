// GENERATED: a copy of test/game/rules.js, made by `python3 tools/worlds.py test-build`. Don't edit this copy.
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

/* ---------- kinds of item: the buttons in Craft and the admin's item picker ---------- */
export const ITEM_GROUPS = ['Tools', 'Food', 'Building', 'Clothes', 'Materials'];
// it: { uses, eat, places } (a tool wears out, food has eat, a placeable has places)
export function itemGroupOf(it) { return it.uses ? 'Tools' : Object.keys(it.eat || {}).length ? 'Food' : it.places ? 'Building' : 'Materials'; }

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
