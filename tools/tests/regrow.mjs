// Stumps and mined boulders growing back (0.1.16, Luke's times), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node regrow.mjs   (exit 0: all as it should be)
// What it checks: each stump grows back at its own time between chopping.regrowDays' soonest and latest (1 to 2 days),
// worked out the same way by the game (rules.js stumpBackMs); a mined boulder is back after mining.regrowDays (1 day);
// both ends of the stump time are live settings, and Reset puts them back.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';
import { stumpBackMs } from '../../test/game/rules.js';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const DAY = 24 * 3600000;
const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {} };
}
const ctx = { storage: storageOn(new Map()), getWebSockets() { return []; }, acceptWebSocket() {}, async blockConcurrencyWhile(f) { await f(); } };
const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
await new Promise((r) => setTimeout(r, 30));
const fresh = () => ({ format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: {}, caps: {}, holds: 5, regrowMs: 4 * 3600000, placed: [], trees: {}, rocks: {} });

// the game file's numbers
expect(JSON.stringify(DATA.chopping.regrowDays) === '[1,2]' && DATA.mining.regrowDays === 1, 'game file: stumps 1 to 2 days, boulders 1 day');
const span = (id) => w.liveView().find((x) => x.id === id) || {};
expect(span('treeRegrowDays').base === 1 && span('treeRegrowDaysMost').base === 2, 'live settings: a stump grows back in, soonest 1 and latest 2', `${span('treeRegrowDays').base}, ${span('treeRegrowDaysMost').base}`);

// every stump's own time is inside the span, and the same each time it's worked out
const now = Date.now(), times = [];
for (let i = 0; i < 400; i++) times.push(stumpBackMs([1, 2], i, now - i * 7919) / DAY);
expect(Math.min(...times) >= 1 && Math.max(...times) <= 2, 'each stump grows back between 1 and 2 days', `${Math.min(...times).toFixed(2)} to ${Math.max(...times).toFixed(2)}`);
expect(Math.max(...times) - Math.min(...times) > 0.8, 'stumps take different times, not all the same');
expect(stumpBackMs([1, 2], 7, 1764070000123) === stumpBackMs([1, 2], 7, 1764070000123) && stumpBackMs(3, 7, now) === 3 * DAY, 'the same stump gets the same time, and a plain number still works');

// the tick: stumps 0.9 days old stay, 2.1 days old grow back, and at 1.5 days only those whose time has come
w.world = fresh();
for (let i = 0; i < 40; i++) w.world.trees[i] = ['stump', now - 0.9 * DAY];
for (let i = 40; i < 80; i++) w.world.trees[i] = ['stump', now - 2.1 * DAY];
for (let i = 80; i < 200; i++) w.world.trees[i] = ['stump', now - 1.5 * DAY];
const due = [];
for (let i = 80; i < 200; i++) if (stumpBackMs([1, 2], i, now - 1.5 * DAY) < 1.5 * DAY) due.push(i);
w.world.rocks = { 1: ['mined', now - 1.1 * DAY], 2: ['mined', now - 0.9 * DAY] };
await w.alarm();
const T = w.world.trees;
expect([...Array(40).keys()].every((i) => T[i] && T[i][0] === 'stump'), 'a stump chopped under a day ago is still a stump');
expect([...Array(40).keys()].every((i) => !T[i + 40]), 'a stump chopped over 2 days ago is a tree again');
const grew = [];
for (let i = 80; i < 200; i++) if (!T[i]) grew.push(i);
expect(grew.length > 10 && grew.length < 110 && JSON.stringify(grew) === JSON.stringify(due), 'at a day and a half, only the stumps whose own time has come grew back (the same ones the game works out)', `${grew.length} of 120`);
expect(!w.world.rocks[1] && w.world.rocks[2] && w.world.rocks[2][0] === 'mined', 'a boulder mined over a day ago can be mined again, under a day ago it can\'t');

// both ends are live settings: 0.4 to 0.5 days, then Reset
await w.setLive('treeRegrowDays', 0.4);
await w.setLive('treeRegrowDaysMost', 0.5);
w.world = fresh();
w.world.trees = { 5: ['stump', now - 0.55 * DAY], 6: ['stump', now - 0.3 * DAY] };
await w.alarm();
expect(!w.world.trees[5] && w.world.trees[6], 'the admin\'s soonest and latest are used', JSON.stringify(w.world.trees));
await w.setLive('treeRegrowDays', null);
await w.setLive('treeRegrowDaysMost', null);
expect(span('treeRegrowDays').value === 1 && span('treeRegrowDaysMost').value === 2 && !span('treeRegrowDays').changed, 'Reset puts both back to the game file');

const bad = results.filter((r) => !r).length;
console.log(bad ? `${bad} of ${results.length} failed` : `All ${results.length} passed`);
process.exit(bad ? 1 : 0);
