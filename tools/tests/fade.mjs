// Old things left on the ground fade (server/src/nature.js fadeOld), tried against the server's own code with no browser.
// Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node fade.mjs   (exit 0: all as it should be)
// Luke, 25 Nov 2026: after 7 days, never inside a camp, and the number of days is a live setting.
// What it checks: only things people (or the admin) put down can fade; the world's own sticks and stones stay; things
// inside a camp stay, and get their full days once the camp ends; 0 days means nothing fades; and games are told with
// messages every build already understands ('gone', or the whole world when it's a lot).
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const HOUR = 3600000, DAY = 24 * HOUR;
const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
const tick = () => new Promise((r) => setTimeout(r, 5));
function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return 1; }, async setAlarm() {} };
}
const hours = (ms) => Math.floor(ms / HOUR);
async function start() {
  const store = new Map(), socks = [];
  const ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await new Promise((r) => setTimeout(r, 30));
  // a world with a spot where sticks turn up and one for stones (so they're the world's own), and a camp at 50, 50
  w.world = { format: 1, nextId: 100, items: [], bushes: [], graves: [], spots: { stick: [[10, 10]], stone: [[5, 5]] }, caps: {}, holds: 5, regrowMs: 4 * HOUR,
    placed: [{ id: 1, kind: 'campfire', x: 50, z: 50, rot: 0, built: true, fuel: 6 * HOUR, lit: true, at: Date.now(), by: 'cam', claim: 'cam' }] };
  const p = { who: 'cam', state: 'alive', name: 'Cam', look: {}, age: 30, born: Date.now(), x: 30, z: 30, ry: 0, stats: { health: 100, rest: 80, hunger: 50, thirst: 65, energy: 100 }, statsAt: Date.now(), carry: { log: 2, twig: 1 }, log: {} };
  w.persons.set('cam', p);
  const sock = (att) => { const s = { att, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {}, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return structuredClone(this.att); } }; socks.push(s); return s; };
  const me = sock({ id: 'cam', who: 'cam', watch: false, admin: false, alive: true, from: 'a', v: DATA.version, b: DATA.build, e: DATA.era, link: 'test' });
  const admin = sock({ id: 'w:1', who: null, watch: true, admin: true, from: 'addr-admin' });
  const ask = async (s, m) => { const from = s.got.length; await w.webSocketMessage(s, JSON.stringify(m)); await tick(); return s.got.slice(from); };
  let id = 1000;
  const put = (kind, x, z, laid, more = {}) => { const it = { id: id++, kind, x, z, rot: 0, ...(laid == null ? {} : { laid }), ...more }; w.world.items.push(it); return it; };
  const has = (it) => w.world.items.some((x) => x.id === it.id);
  return { w, p, me, admin, ask, put, has };
}

const now = Date.now(), H = hours(now);

console.log('A. what fades after 7 days, and what stays');
let S = await start();
expect(S.w.respawnPlan().stick && S.w.respawnPlan().stone && !S.w.respawnPlan().log, 'in this world sticks and stones are the world\'s own (they top up); logs are not');
const wildStick = S.put('stick', 10, 10, null);            // the world's own: no time on it
const oldStick = S.put('stick', 20, 20, H - 8 * 24);        // dropped 8 days ago, outside any camp
const newStone = S.put('stone', 21, 20, H - 6 * 24);        // dropped 6 days ago
const oldAxe = S.put('stone-axe', 22, 20, H - 8 * 24, { uses: 3 }); // a worn tool left for 8 days
const campLog = S.put('log', 51, 50, H - 8 * 24);           // 8 days old, but inside the camp
const edgeLog = S.put('log', 50, 61, H - 8 * 24);           // 8 days old, a metre outside the camp's 10 m
const legacy = S.put('twig', 30, 30, null);                 // from before fading: no time on it, and twigs don't top up
S.me.got.length = 0;
let changed = S.w.fadeOld(now);
expect(changed === true, 'the sweep says the world changed (so it gets saved)');
expect(!S.has(oldStick) && !S.has(oldAxe) && !S.has(edgeLog), 'things left outside a camp for 8 days are gone: a stick, a worn axe, a log just past the camp\'s edge');
expect(S.has(newStone), 'a stone left for 6 days stays');
expect(S.has(wildStick) && wildStick.laid == null, 'the world\'s own stick stays, and still has no time on it');
expect(S.has(campLog) && campLog.laid === H, 'a log inside a camp stays, however old, and its days start again', `laid ${H - campLog.laid} h ago`);
expect(S.has(legacy) && legacy.laid === H, 'something from before fading (no time on it, not the world\'s own) starts its 7 days now');
const told = S.me.got.filter((m) => m.t === 'gone').map((m) => m.id).sort();
expect(JSON.stringify(told) === JSON.stringify([oldStick.id, oldAxe.id, edgeLog.id].sort()) && !S.me.got.some((m) => m.t === 'world'), 'a game playing is told each one is gone, in the message every build knows', JSON.stringify(told));
const log = (await S.ask(S.admin, { t: 'a.log' })).find((x) => x.t === 'adminLog').list;
expect(log.some((e) => /3 things left on the ground for 7 days faded/.test(e.text)), 'the admin\'s Log says how many faded', log.map((e) => e.text).slice(0, 2).join(' | '));
changed = S.w.fadeOld(now);
expect(changed === false && S.w.world.items.length === 4, 'a second look straight after changes nothing (nothing to save)');

console.log('B. when the camp ends, its things have their days still to come');
const fire = S.w.world.placed[0];
fire.lit = false; fire.fuel = 0; // the fire goes out: the camp is over
S.w.fadeOld(now + HOUR);
expect(S.has(campLog), 'an hour after the camp ended the log is still there');
S.w.fadeOld(now + 6 * DAY);
expect(S.has(campLog), 'and after 6 days');
S.w.fadeOld(now + 7 * DAY + HOUR);
expect(!S.has(campLog), 'after 7 days it fades like anything else');
expect(S.has(wildStick), 'the world\'s own stick is still there');

console.log('C. the number of days is a live setting: 0 means nothing fades');
S = await start();
const ancient = S.put('log', 20, 20, H - 400 * 24), twoDays = S.put('twig', 21, 20, H - 2 * 24);
expect((await S.ask(S.admin, { t: 'a.live', id: 'fadeDays', value: 0 })).some((m) => m.t === 'admin'), 'the admin sets Things left on the ground fade after: 0');
S.w.fadeOld(now);
expect(S.has(ancient) && S.has(twoDays), 'with 0 days, a log left for over a year stays');
await S.ask(S.admin, { t: 'a.live', id: 'fadeDays', value: 1 });
S.w.fadeOld(now);
expect(!S.has(ancient) && !S.has(twoDays), 'with 1 day, a thing left for 2 days fades');
await S.ask(S.admin, { t: 'a.live', id: 'fadeDays', value: null });
const live = S.w.liveView().find((x) => x.id === 'fadeDays');
expect(live && live.value === 7 && live.base === 7 && !live.changed, 'Reset puts it back to 7 days', JSON.stringify(live));

console.log('D. things get their time when they are put down, however that happens');
S = await start();
await S.ask(S.me, { t: 'drop', items: [{ kind: 'log' }, { kind: 'twig' }] });
const dropped = S.w.world.items.filter((it) => it.kind === 'log' || it.kind === 'twig');
expect(dropped.length === 2 && dropped.every((it) => it.laid === hours(Date.now())), 'dropping: both things have the time on them', JSON.stringify(dropped.map((it) => it.laid)));
await S.ask(S.admin, { t: 'a.add', kind: 'stone', n: 3, x: 40, z: 40 });
const added = S.w.world.items.filter((it) => it.kind === 'stone');
expect(added.length === 3 && added.every((it) => it.laid === hours(Date.now())), 'the admin adding stones: they have it too (they fade like anything left there)');
S.p.carry = { berry: 2 };
S.w.spill(S.p);
const spilt = S.w.world.items.filter((it) => it.kind === 'berry');
expect(spilt.length === 2 && spilt.every((it) => it.laid != null), 'a person\'s things spilling where they died: they have it');
S.w.world.items = [];
S.w.topUp();
const grown = S.w.world.items;
expect(grown.length > 50 && grown.every((it) => it.laid == null), 'what the world tops up by itself has none', `${grown.length} sticks and stones`);
await S.w.respawn(Date.now());
expect(S.w.world.items.every((it) => it.laid == null), 'nor does what turns up every few minutes');
S.w.fadeOld(now + 30 * DAY);
expect(S.w.world.items.length === grown.length, 'so a month later every one of them is still there');

console.log('E. a lot fading at once is sent as the whole world, once');
S = await start();
for (let k = 0; k < 45; k++) S.put('twig', 20 + k * 0.1, 20, H - 9 * 24);
S.me.got.length = 0;
S.w.fadeOld(now);
expect(S.w.world.items.length === 0 && S.me.got.filter((m) => m.t === 'world').length === 1 && !S.me.got.some((m) => m.t === 'gone'), '45 things fade: one message with the world as it is now', `${S.me.got.length} messages`);

console.log('F. the tick looks once an hour');
S = await start();
const stale = S.put('twig', 20, 20, H - 9 * 24);
await S.w.alarm();
expect(!S.has(stale) && S.w.fadeAt > Date.now() + 59 * 60000, 'the first tick looks, and sets the next look for an hour on');
const later = S.put('twig', 20, 20, H - 9 * 24);
await S.w.alarm();
expect(S.has(later), 'the next tick, a minute later, doesn\'t look again');

const bad = results.filter((r) => !r).length;
console.log(bad ? `${bad} of ${results.length} failed` : `All ${results.length} passed`);
process.exit(bad ? 1 : 0);
