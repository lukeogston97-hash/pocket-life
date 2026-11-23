// Pocket Life server: what every part of the server shares (the game's rules from game.json, limits, small helpers).
// The world itself is in index.js; its parts are split by topic (persons.js, away.js, nature.js, line.js, admin.js, actions.js).
//
// The whole server: one Durable Object holds the whole world.
// - the shared world: things on the ground, berry bushes, graves
// - every person: needs, inventory and where they are, kept here so they stay in the world 24/7
// - while a player is away their person looks after themselves (wanders, eats, picks berries, drinks),
//   after a day away they lie down asleep (hunger and thirst drop slowly to away.asleepFloor, they can't die),
//   and after away.goneAfterDays asleep they're gone (3 days away in all)
// - at most G.maxPlaying people play at once; anyone else waits in line on the main menu
// - chat, reports, feedback and the admin player's tools
import WORLDS from '../worlds.json'; // minimum version for each link
import FILTER from '../words.json'; // the chat filter, copied from game-data.json by tools/worlds.py
import G from '../game.json'; // needs, items, berry bushes, away rules: copied from game-data.json by tools/worlds.py
import { starText, badName } from './rules.js'; // the rules the game and the server share (a copy of test/game/rules.js)
import { HOUR, MINUTE, freshStats, advanceStats, addCarry, takeCarry, wearList, applyGives, eatOne, posAt, dist, craft, sleepMs, spend, useTimeZone, isNight, morningAfter, ageOf } from './needs.js';

export const PROTOCOL = 2; // bump when the game and server stop understanding each other
export const CORS = { 'Access-Control-Allow-Origin': '*' };
export const WORLD_FORMAT = 1;
// Text from a game, tidied: no control characters, and none of the unseen ones that hide text or make it read backwards
// (a name that looks empty, chat that reverses the line it's in). Found in the 24 Nov 2026 whole-game check. The joiners
// that build one emoji out of several, and the marks other alphabets need, stay.
const UNSEEN = /[\p{Cc}\u00ad\u180e\u200b\u2060\u202a-\u202e\u2066-\u2069\ufeff\ufff9-\ufffb]/gu;
export const clean = (s, n) => String(s ?? '').replace(UNSEEN, '').slice(0, n);
// nothing in it that can be seen: only spaces, joiners and letters that draw as blanks
export const blank = (s) => !/[^\s\u115f\u1160\u2800\u3164\uffa0\u200c-\u200f]/u.test(String(s ?? ''));
export const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
export const kindOk = (k) => typeof k === 'string' && /^[a-z0-9-]{1,24}$/.test(k);
useTimeZone(G.timeZone); // the world's clock (Darwin time) for night and birthdays
export const AWAY = { sleepBelow: 35, wanderMin: 25, wanderMax: 50, strollSpeed: 1.2, eatBelow: 60, drinkBelow: 55, sleepAfterHours: 24, goneAfterDays: 2, asleepFloor: 10, graveHours: 24, ...(G.away || {}) };
export const START = G.start || { x: 0.6, z: 1.9 };
export const REST = (G.needs || []).find((s) => s.id === 'rest');
export const BERRY_SRC = Object.values(G.sources || {}).find((s) => s.harvest) || {}; // the berry bush
// '0.0.6' with build 5 is [0,0,6,5]; a minVersion of '0.0.6' only checks the first three
export const parts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
// era: version numbers were reset lower once (0.3.8 became 0.1.0, 23 Nov 2026). Any game from an older era is too old,
// whatever its numbers. era (e) is in game-data.json; worlds.json keeps the era each link is on.
export function tooOld(v, b, min, e = 0, minEra = 0) {
  if ((Number(e) || 0) !== (Number(minEra) || 0)) return (Number(e) || 0) < (Number(minEra) || 0);
  const have = parts(v), want = parts(min);
  have[3] = Number(b) || 0;
  for (let i = 0; i < want.length; i++) { const a = have[i] || 0; if (a !== want[i]) return a < want[i]; }
  return false;
}
export const FEEDBACK_KEEP = 300, REPORTS_KEEP = 300;
// Spam limits: each kind of message refills at so many a second, up to a small burst. The admin is never limited.
export const LIMITS = { place: [1, 3], build: [1, 3], unplace: [1, 3], apart: [1, 3], fire: [2, 6], sit: [1, 4], chop: [1, 3], quarry: [1, 3], cut: [1, 3], seed: [1 / 10, 2], layout: [1 / 10, 2], sleep: [1, 4], craft: [1, 3], fish: [1 / 2, 3], act: [3, 6], say: [1, 3], take: [5, 10], pick: [5, 10], drop: [2, 6], move: [12, 20], eat: [3, 6], drink: [1, 3], create: [1 / 5, 3],
  feedback: [1 / 30, 3], report: [1 / 30, 3], hello: [1 / 2, 4], sync: [1 / 5, 2],
  socStart: [1 / 10, 3], socInvite: [1 / 3, 4], socAnswer: [1, 3], socLeave: [1 / 5, 2], socRemove: [1 / 2, 3] }; // societies (societies.js)
export const buckets = new WeakMap(); // per connection, kept in memory only
export const lastHeard = new WeakMap(); // per connection: when it last sent anything (the game pings every 25 seconds)
export const QUIET_MS = 90000; // nothing heard for this long: the phone is asleep or gone, so the person goes away
export const TICK_MS = 20000; // how often the world moves on (needs, people away, sticks and stones)
// Cloudflare's free plan allows 100,000 storage writes and 100,000 requests a day (20 messages from a game count as 1).
// What people do (eat, pick up, craft) is saved straight away; walking about and needs ticking over are saved
// at most every SAVE_EVERY. If the world is shut down in between, people away are simply played forward again.
export const SAVE_EVERY = 5 * MINUTE;
// People away are played forward by the server from their last save, so their strolling and needs ticking over only need
// saving now and then; anything lasting (picked berries, fed their fire, fell asleep, died) is still saved within SAVE_EVERY.
// (Found in the 23 Nov 2026 growth check: saving every away person every 5 minutes used up the free plan at about 170 people a day.)
export const AWAY_SAVE_EVERY = 60 * MINUTE;
export const FREE = { writes: 100000, requests: 100000 };
export const TURN_MS = 60000; // how long someone at the front of the line has to take their spot
export function allowed(ws, me, t) {
  const lim = Object.hasOwn(LIMITS, t) ? LIMITS[t] : null; // (a kind of message called 'constructor' has no limit of its own: it isn't a kind of message)
  if (!lim || (me.admin && me.watch && !me.who)) return true; // (the admin: a connection that only watches, index.js isAdmin)
  const [rate, burst] = lim, now = Date.now() / 1000;
  let b = buckets.get(ws);
  if (!b) buckets.set(ws, (b = {}));
  const k = b[t] || (b[t] = { n: burst, at: now });
  k.n = Math.min(burst, k.n + (now - k.at) * rate);
  k.at = now;
  if (k.n < 1) return false;
  k.n -= 1;
  return true;
}
// a short public tag for a phone, so a person, mutes and reports stick to the same phone across visits
export async function tagOf(pid) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pocket-life:${clean(pid, 40)}`)));
  return [...bytes.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// a look from the game, kept small and plain
export function cleanLook(look) {
  const out = {};
  if (!look || typeof look !== 'object') return out;
  for (const [k, v] of Object.entries(look).slice(0, 30)) {
    if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = clean(v, 30);
    else if (Number.isFinite(v)) out[k] = num(v);
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
export const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

export { WORLDS, FILTER, G, starText, badName, HOUR, MINUTE, freshStats, advanceStats, addCarry, takeCarry, wearList, applyGives, eatOne, posAt, dist, craft, sleepMs, spend, isNight, morningAfter, ageOf };
