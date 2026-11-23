// Live settings: numbers the admin changes from the Admin panel (Settings tab) without a new build: the player limit,
// respawn times and how fast needs drop. Their names and limits are liveSettings in game-data.json (copied to game.json);
// how each one reads and changes the rules is RULES below. A live number wins over game-data.json until the admin
// taps Reset, so a new build doesn't undo it. Saved in storage as 'live' = { id: value }.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, BERRY_SRC } from './shared.js';

const need = (id) => (G.needs || []).find((s) => s.id === id) || {};
const inside = (key) => (G[key] = G[key] || {});
// needs drop, so "drops 4.2 per hour" is a perHour of -4.2
const drop = (id) => ({ get: () => -(need(id).perHour || 0), set: (v) => { need(id).perHour = -v; }, needs: true });
const RULES = {
  maxPlaying: { get: () => G.maxPlaying, set: (v) => { G.maxPlaying = v; } },
  societyMax: { get: () => inside('societies').maxMembers || 3, set: (v) => { inside('societies').maxMembers = v; } }, // (societies.js socMax)
  respawnMinutes: { get: () => G.respawnMinutes, set: (v) => { G.respawnMinutes = v; } },
  berryRegrowHours: { get: () => BERRY_SRC.regrowHours || 0, set: (v, world) => { BERRY_SRC.regrowHours = v; if (world.world) world.world.regrowMs = v * HOUR; } },
  treeRegrowDays: { get: () => inside('chopping').regrowDays || 3, set: (v) => { inside('chopping').regrowDays = v; } },
  boulderRegrowDays: { get: () => inside('mining').regrowDays || 3, set: (v) => { inside('mining').regrowDays = v; } },
  rockBackHours: { get: () => inside('mining').rockBackHours || 4, set: (v) => { inside('mining').rockBackHours = v; } },
  hungerPerHour: drop('hunger'),
  thirstPerHour: drop('thirst'),
  restPerHour: drop('rest'),
};
export const LIVE_LIST = (G.liveSettings || []).filter((d) => RULES[d.id]);
const BASE = Object.fromEntries(LIVE_LIST.map((d) => [d.id, RULES[d.id].get()])); // the numbers from game-data.json
// the player limit, as it is right now (a live setting)
export const maxPlaying = () => Math.max(1, Number(G.maxPlaying) || 20);
// a number from the admin, kept inside the setting's limits and rounded to its step
function tidy(d, v) {
  v = Math.max(d.min ?? 0, Math.min(d.max ?? 1e6, Number(v)));
  const step = d.step || 1;
  return Math.round(Math.round(v / step) * step * 1000) / 1000;
}

export const liveMethods = {
  applyLive() { for (const d of LIVE_LIST) RULES[d.id].set(this.live[d.id] != null ? this.live[d.id] : BASE[d.id], this); },
  liveView() { return LIVE_LIST.map((d) => ({ id: d.id, value: RULES[d.id].get(), base: BASE[d.id], changed: this.live[d.id] != null })); },
  // value null: back to game-data.json's number
  async setLive(id, value) {
    const d = LIVE_LIST.find((x) => x.id === id);
    if (!d) return false;
    const v = value == null ? null : tidy(d, value);
    if (v != null && !Number.isFinite(v)) return false;
    if (RULES[id].needs) for (const p of this.persons.values()) this.catchUp(p); // needs up to now at the old rate first
    if (v == null || v === BASE[id]) delete this.live[id]; else this.live[id] = v;
    this.applyLive();
    await this.put('live', this.live);
    if (this.world) await this.save(); // the bush's regrow time is kept in the world
    this.send({ t: 'live', live: this.live }, null);
    if (id === 'maxPlaying') { this.sendCount(); this.callLine(); }
    return true;
  },
};
