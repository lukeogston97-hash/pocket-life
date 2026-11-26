// Items taken out of the game (game-data.json "retired", 0.1.21: twigs become sticks), tried against the server's own code
// with no browser. Run: cd tools/tests && python3 -c "import lib; lib.bundle()" && node retire.mjs   (exit 0: all as it should be)
// Luke, 26 Nov 2026: twigs aren't needed any more. When the world starts, any still in someone's inventory or on the
// ground become what "retired" says, so the game and the server never meet a thing they don't know.
import { readFileSync } from 'node:fs';
import { World } from './build/server.mjs';

const DATA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8'));
const results = [];
const expect = (ok, what, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail !== '' ? ` (${detail})` : ''}`); };
function storageOn(store) {
  return { async get(k) { return structuredClone(store.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    async delete(k) { for (const key of [].concat(k)) store.delete(key); },
    async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }, // (copies, as Cloudflare gives)
    async getAlarm() { return 1; }, async setAlarm() {} };
}
async function start(store) {
  const socks = [], ctx = { storage: storageOn(store), getWebSockets() { return socks; }, acceptWebSocket(ws) { socks.push(ws); }, async blockConcurrencyWhile(f) { await f(); } };
  const w = new World(ctx, { ADMIN_CODE: 'secret123456' });
  await new Promise((r) => setTimeout(r, 30));
  return w;
}

console.log('A. game-data.json');
expect(DATA.retired && DATA.retired.twig === 'stick' && !DATA.items.twig, 'twigs are out of the game and become sticks');
expect(!DATA.recipes.some((r) => JSON.stringify(r).includes('"twig"')) && !JSON.stringify(DATA.placeables).includes('"twig"'), 'no recipe or fire uses twigs any more');

console.log('B. a world saved before 0.1.21, with twigs about');
const now = Date.now(), store = new Map();
const person = (who, carry, more = {}) => ({ who, state: 'alive', name: who, look: {}, age: 30, born: now, x: 30, z: 30, ry: 0, stats: { health: 100, rest: 80, hunger: 50, thirst: 65, energy: 100 }, statsAt: now, carry, log: {}, ...more });
store.set('world', { format: 1, nextId: 100, items: [{ id: 7, kind: 'twig', x: 12, z: 3, rot: 1, laid: 5 }, { id: 8, kind: 'stone', x: 4, z: 4, rot: 0 }], bushes: [], graves: [], spots: {}, caps: {}, placed: [] });
store.set('p:cam', person('cam', { twig: 3, stick: 2, twine: 1 }, { found: ['sharp-stone', 'twig', 'knife'], lastKind: 'twig' }));
store.set('p:dee', person('dee', { twig: 1 }, { lastKind: 'twig' }));
store.set('p:eve', person('eve', { stone: 2 }, { found: ['sharp-stone'], lastKind: 'stone' }));
const w = await start(store);
const cam = w.persons.get('cam'), dee = w.persons.get('dee'), eve = w.persons.get('eve');
expect(JSON.stringify(cam.carry) === JSON.stringify({ stick: 5, twine: 1 }), "Cam's 3 twigs are 3 more sticks (the same weight, so no one ends up too heavy)", JSON.stringify(cam.carry));
expect(JSON.stringify(cam.found) === '["sharp-stone","knife"]' && cam.lastKind === 'stick', "the twig recipe leaves Cam's found recipes, and what they last had in hand is now a stick", `${JSON.stringify(cam.found)} ${cam.lastKind}`);
expect(JSON.stringify(dee.carry) === '{"stick":1}' && dee.lastKind === 'stick', "Dee's only twig is a stick", JSON.stringify(dee.carry));
expect(JSON.stringify(eve.carry) === '{"stone":2}' && !w.dirty.has('eve'), 'Eve had no twigs: nothing about her changes and she is not saved again');
expect(w.dirty.has('cam') && w.dirty.has('dee'), 'Cam and Dee are saved with the next save');
const ground = w.world.items.find((it) => it.id === 7);
expect(ground && ground.kind === 'stick' && ground.x === 12 && ground.z === 3 && ground.laid === 5, 'the twig on the ground is a stick, in the same spot, fading on the same timer', JSON.stringify(ground));
expect(!store.get('world').items.some((it) => it.kind === 'twig'), 'the world was saved without twigs');
expect(w.mine(cam).carry.stick === 5 && !('twig' in w.mine(cam).carry), "what Cam's game is told has no twigs in it");

console.log('C. once saved, starting again (after a deploy or a restore) changes nothing more');
await w.flush(undefined, true); // (the world's next save)
const w2 = await start(store);
expect(JSON.stringify(w2.persons.get('cam').carry) === JSON.stringify({ stick: 5, twine: 1 }) && w2.dirty.size === 0, 'nothing left to turn into sticks, and nobody is saved again');

const bad = results.filter((x) => !x).length;
console.log(bad ? `${bad} of ${results.length} FAILED` : `all ${results.length} as they should be`);
process.exit(bad ? 1 : 0);
