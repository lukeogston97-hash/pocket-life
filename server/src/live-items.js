// Live items and recipes (Luke, 23 Nov 2026): the admin changes an item's weight, a tool's uses, how much a food gives, or
// how many of each thing a recipe needs and makes, from admin mode, without a new build.
//
// What wins (the source of truth): game-data.json is where every number starts. An admin's change sits on top of it and
// wins, even over a new build, until the admin resets it. So if the file says a tool weighs 3 and the admin makes it 5, it
// stays 5; if a later build changes the file to 4 it is still 5 until Reset. A change that's the same as the file's number
// isn't kept at all, so once the file catches up the "changed" mark goes away by itself. The admin's "Copy my changes"
// gives the list to write into game-data.json.
//
// Only numbers that are already there can be changed: not new items, new ingredients, names or looks (those are
// game-data.json's job). A change for an item, recipe or ingredient that a later build took out is ignored and dropped.
// Saved in storage as 'liveItems' = { items: { knife: { weight: 2 } }, recipes: { knife: { needs: { stick: 2 } } } }.
// Every game is sent them (welcome, and a 'liveItems' message when one changes) and uses the same numbers.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G } from './shared.js';

const whole = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));
const number = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) * 10) / 10));
// the numbers from game-data.json, kept as they were before any change
const BASE = {
  items: Object.fromEntries(Object.entries(G.items || {}).map(([k, it]) => [k, { weight: it.weight ?? 1, uses: it.uses || 0, eat: { ...(it.eat || {}) } }])),
  recipes: Object.fromEntries(Object.entries(G.recipes || {}).map(([k, r]) => [k, { needs: { ...(r.needs || {}) }, makes: { ...(r.makes || {}) } }])),
};
// What one change may be, tidied, or undefined if it isn't allowed. where: ['items', kind, 'weight'], ['items', kind, 'eat', need],
// ['recipes', id, 'needs' | 'makes', kind]. Weights are whole numbers (Luke: no .1 or .5).
function tidy(where, value) {
  const [what, id, field, sub] = where, base = (BASE[what] || {})[id];
  if (!base || !Number.isFinite(Number(value))) return undefined;
  if (what === 'items') {
    if (field === 'weight' && sub == null) return whole(value, 0, 100);
    if (field === 'uses' && sub == null && base.uses > 0) return whole(value, 1, 10000); // only a tool has uses
    if (field === 'eat' && base.eat[sub] != null) return number(value, 0, 100); // only what the food already fills
  } else if ((field === 'needs' || field === 'makes') && base[field][sub] != null) return whole(value, 1, 99); // only what the recipe already has
  return undefined;
}
const baseAt = ([what, id, field, sub]) => (sub == null ? BASE[what][id][field] : BASE[what][id][field][sub]);
// every number that can be changed, as a flat list of places
function places() {
  const out = [];
  for (const [k, it] of Object.entries(BASE.items)) {
    out.push(['items', k, 'weight']);
    if (it.uses > 0) out.push(['items', k, 'uses']);
    for (const need of Object.keys(it.eat)) out.push(['items', k, 'eat', need]);
  }
  for (const [k, r] of Object.entries(BASE.recipes)) for (const f of ['needs', 'makes']) for (const kind of Object.keys(r[f])) out.push(['recipes', k, f, kind]);
  return out;
}
const read = (obj, [what, id, field, sub]) => { const a = ((obj || {})[what] || {})[id]; const b = a && a[field]; return sub == null ? b : b && b[sub]; };
function write(obj, [what, id, field, sub], value) {
  const a = ((obj[what] = obj[what] || {})[id] = obj[what][id] || {});
  if (sub == null) a[field] = value; else (a[field] = a[field] || {})[sub] = value;
}

export const liveItemsMethods = {
  // the changes that still mean something (an item or ingredient a later build took out is dropped), tidied
  cleanLiveItems(raw) {
    const out = {};
    for (const at of places()) {
      const v = tidy(at, read(raw, at));
      if (v !== undefined && Number.isFinite(read(raw, at)) && v !== baseAt(at)) write(out, at, v);
    }
    return out;
  },
  // put every number where the rules read it: the admin's if there is one, else game-data.json's
  applyLiveItems() {
    this.liveItems = this.cleanLiveItems(this.liveItems);
    for (const at of places()) {
      const [what, id, field, sub] = at, v = read(this.liveItems, at) ?? baseAt(at);
      const target = what === 'items' ? G.items[id] : G.recipes[id];
      if (sub == null) target[field] = v; else (target[field] = target[field] || {})[sub] = v;
    }
  },
  // for the admin's Items page: every number, what it started as, and whether it's been changed
  liveItemsView() {
    return places().map((at) => ({ at, value: read(this.liveItems, at) ?? baseAt(at), base: baseAt(at), changed: read(this.liveItems, at) != null }));
  },
  // value null: back to game-data.json's number. Returns what it was set to (or null for reset), or undefined if it isn't allowed.
  async setLiveItem(at, value) {
    if (!Array.isArray(at) || at.length < 3 || at.length > 4 || !at.every((x) => typeof x === 'string' && x.length <= 30)) return undefined;
    const known = places().some((p) => p.length === at.length && p.every((x, i) => x === at[i]));
    if (!known) return undefined;
    const v = value == null ? null : tidy(at, value);
    if (v === undefined) return undefined;
    const next = structuredClone(this.liveItems || {});
    if (v == null || v === baseAt(at)) { // back to the file's number: nothing is kept
      const [what, id, field, sub] = at, a = (next[what] || {})[id];
      if (a) { if (sub == null) delete a[field]; else if (a[field]) delete a[field][sub]; }
    } else write(next, at, v);
    this.liveItems = next;
    this.applyLiveItems();
    await this.put('liveItems', this.liveItems);
    this.send({ t: 'liveItems', liveItems: this.liveItems }, null);
    return v;
  },
};
