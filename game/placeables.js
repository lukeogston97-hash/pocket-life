/* ---------- placed things: put down from your inventory, built, then used (campfires first) ----------
   The rules for each kind are in game-data.json "placeables"; the item that places one has "places": its id.
   The server holds every placed thing ({ id, kind, x, z, rot, built, fuel, lit }) and tells everyone when one changes.
   A fire's fuel is how many ms of burning are left; it only goes down while lit, so it keeps burning (and goes out
   by itself) whether or not anyone is watching. Everything here is generic: a new placeable is a data entry, and
   only a new kind of behaviour (like fire or seats) needs code. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { game, share } from './links.js';
import {
  berryPicked, claimProblem, cropGrowth, cropStage, cropTree, fireRuleOf, frontSpotOf, fuelLeftAt, fuelRoom, PLACE_GRID,
  placeClash, placeRect, placeSnap, roomClash, seatSpotOf, squaresUsed,
} from './rules.js';
import {
  app, clamp01, DATA, hash, mat, pick, rand, reduceMotion, rr, scene, SETTINGS, smoothstep, sun, V, withOwnRand,
} from './core.js';
import { flatReach, groundUnder, groundY, landAsMade, POND, pondShape, setFlats, WALK_LIMIT } from './land.js';
import { addSpot, BUSH_COLOURS, crownGeoB, interactive, removeSpotNear, roomAt, WALK_THROUGH } from './nature.js';
import { drawPlant, plants } from './plants.js';
import { bushHolds, crownSurface, DETAILS, growEvery, liftNear } from './world-build.js';
import { $, buildItem, campfireModel, countLabel, harvests, ITEMS, RECIPES, shadowsOn, SOURCES } from './items.js';
import { disposeMaterials, HIP_Y, setArm } from './people.js';
import { HIT_BOX, HIT_MAT, itemViews } from './world-items.js';
import {
  addToCarry, carryNo, drawCarry, drawHeld, hasTool, headTop, player, showGain, showTag, takeFromCarry,
  toolNeed, toolWhy, you,
} from './you.js';
import { slowness, spendEnergy } from './needs.js';
import { cantMake, closeBag, closeCraft, drawBag, make, openStore, recipeKnown, recipeName, storeCheck, storeShowing } from './inventory.js';
import { controls } from './camera.js';
import {
  allTasks, approach, clearCellsNear, drawQueue, face, nextTask, queueTask, setLegs, setSleeping, solidAt, startAction, TASK_KINDS,
  tasks, walkFirst, walkTo,
} from './moving.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  get claimCheckAt() { return claimCheckAt; }, set claimCheckAt(v) { claimCheckAt = v; }, endSit,
  get isLit() { return isLit; }, get notMineAt() { return notMineAt; }, get PLACEABLES() { return PLACEABLES; },
  get placed() { return placed; }, get placing() { return placing; }, get roomFor() { return roomFor; }, startPlacing, stationNear,
  bedBetterOf, lieInBed, myFreeBed, outOfBed, // beds (0.2.5, the basic shelter): moving.js and needs.js use these
});

export const PLACEABLES = {};
for (const [kind, raw] of Object.entries(DATA.placeables || {})) {
  const item = Object.keys(ITEMS).find((k) => (DATA.items[k] || {}).places === kind);
  const tool = raw.madeWith && ITEMS[raw.madeWith] && ITEMS[raw.madeWith].uses ? raw.madeWith : null; // dug with a tool instead (0.1.18, the farm field)
  if (!item && !tool) { console.warn(`Placeable "${kind}" has no item that places it, so it's left out.`); continue; }
  const s = raw.seats;
  PLACEABLES[kind] = {
    kind, item: item || null, name: raw.name || (item ? ITEMS[item].name : kind), buildSeconds: Math.max(1, Number(raw.buildSeconds) || 10), buildVerb: raw.buildVerb || 'Building', solid: Number(raw.solid) || 0.5,
    size: raw.size, keepClear: Number(raw.keepClear) || 0, // its squares on the placing grid, and room kept round it (rules.js)
    fire: fireRuleOf(raw.fire, (k) => !!ITEMS[k]), // rules.js: fuels and how long each burns, the most it holds
    seats: s ? { count: Math.max(1, Math.floor(s.count) || 6), distance: Number(s.distance) || 1.2 } : null,
    craftLabel: raw.craftLabel || 'Make', // the tap menu's list of recipes made here (Cook on a campfire)
    // dug with a tool (the farm field): the tool, how long digging and flattening take, only in your camp, and its look
    madeWith: tool, makeSeconds: Math.max(1, Number(raw.makeSeconds) || 8), makeVerb: raw.makeVerb || 'Digging', flattenSeconds: Math.max(1, Number(raw.flattenSeconds) || 4),
    inCamp: !!raw.inCamp, look: raw.look || null, walkOver: !!raw.walkOver, // walkOver: people walk over it (a farm field)
    // it holds things (0.2.2, the small wooden crate): how many squares. noun: the short word for it ("Open crate")
    store: !tool && raw.storage && raw.storage.squares >= 1 ? { squares: Math.floor(raw.storage.squares) } : null,
    noun: String(raw.name || (item ? ITEMS[item].name : kind)).split(' ').pop().toLowerCase(),
    front: Number(raw.front) > 0 ? Number(raw.front) : 0, // where you stand to use it, out from its middle the way it faces (0.2.3, a crate's front)
    // somewhere to sleep (0.2.5, the basic shelter): how many at once, how many times better than the ground, where you lie
    bed: !tool && raw.bed && Number(raw.bed.better) >= 1 ? { sleepers: Math.max(1, Math.floor(raw.bed.sleepers) || 1), better: Number(raw.bed.better),
      at: Array.isArray(raw.bed.at) ? [Number(raw.bed.at[0]) || 0, Number(raw.bed.at[1]) || 0] : [0, 0] } : null,
  };
  if (item) ITEMS[item].places = kind;
}
// Farming (0.1.18): what grows on a farm field. A seed planted there grows by itself (rules.js cropGrowth), then it's
// picked like its "like" source (a berry bush: holds 5, grow back, the knife picks 2). The server has the final say.
export const CROPS = {};
for (const [id, raw] of Object.entries(DATA.crops || {})) {
  const on = raw.on || 'field', like = SOURCES[raw.like];
  if (!ITEMS[raw.seed] || !PLACEABLES[on] || !like || !harvests(like)) continue;
  CROPS[id] = { id, name: raw.name || id, seed: raw.seed, on, growMs: (Number(raw.growHours) || 24) * 3600000, plantSeconds: Math.max(1, Number(raw.plantSeconds) || 3), like,
    // a tree (0.2.9, the apple tree): chopped like a wild one, its stump growing back in backMs; room: squares all round kept empty
    tree: raw.tree ? { backMs: (Number(raw.tree.stumpBackHours) || 24) * 3600000 } : null, room: Math.max(0, Math.floor(Number(raw.room) || 0)) };
}
const CHOPPING = DATA.chopping || {}; // (a tree on a field is chopped with the axe, like a wild one)
export const placed = new Map(); // id -> { id, kind, x, z, rot, built, fuel, lit, at, progress, view }

/* ---------- storage (0.2.2, the small wooden crate) ----------
   A placed thing with storage holds things in its own squares, the same squares and stacks as the inventory (rules.js
   storeRoom, the same as the server). th.store { kind: n } and th.wear { kind: [uses left] } (its tools) come from the
   server. Open on its tap menu walks over and shows its squares at the top of your inventory (inventory.js). Only your
   camp can open it while the camp lasts, anyone once it ends (Luke). Not packed up or taken apart until it's empty. */
export const storedIn = (th) => Object.values(th.store || {}).reduce((n, k) => n + (k > 0 ? k : 0), 0);
export const storeUsed = (th) => squaresUsed(th.store || {}, null, ITEMS, SETTINGS.stackSize);
// what's in it, in words: "Holds 12 sticks and 5 berries", or "Empty"
export function storeWords(th) {
  const words = Object.entries(th.store || {}).filter(([k, n]) => n > 0 && ITEMS[k]).map(([k, n]) => countLabel(k, n).toLowerCase());
  if (!words.length) return 'Empty';
  return `Holds ${words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0]}`;
}
const storeNote = (th) => (storedIn(th) ? `${storeUsed(th)} of ${PLACEABLES[th.kind].store.squares} squares` : 'Empty');

/* ---------- beds (0.2.5, the basic shelter) ----------
   A placed thing with bed { sleepers, better, at } is somewhere to sleep. Sleep in it (its tap menu) walks to its front,
   then you lie down inside along its width, your middle at `at` ([x, z] from its middle, z out the way it faces). Sleep
   there is `better` times as good as on the ground (rules.js needsStep). Only your camp's, while the camp lasts (anyone's
   once it ends), and only `sleepers` at a time. The server keeps who's in which (p.bed) and tells everyone (o.bed);
   while you sleep you're at its front as far as it knows, and every game draws you lying inside. */
// who's asleep in it now: 'you' and the others whose state says so
export function bedSleepers(th) {
  const out = you.sleeping && you.bed === th.id ? ['you'] : [];
  for (const o of game.others.values()) if (o.bed === th.id && (o.state === 'sleeping' || o.state === 'asleep')) out.push(o);
  return out;
}
const bedFull = (th) => bedSleepers(th).filter((x) => x !== 'you').length >= (PLACEABLES[th.kind].bed || {}).sleepers;
// how much better your sleep is in it (1 if it's gone or not built)
export function bedBetterOf(id) { const th = placed.get(id), b = th && th.built && PLACEABLES[th.kind].bed; return b ? b.better : 1; }
// "Twice as good as the ground"
const betterWords = (b) => `${b.better === 2 ? 'Twice' : b.better === 3 ? 'Three times' : `${b.better} times`} as good as the ground`;
// someone (you or another person's marker) lying in it: along its width, face up, their middle at its spot
export function lieInBed(obj, th, body = obj) {
  const b = PLACEABLES[th.kind].bed, r = th.rot || 0, c = Math.cos(r), s = Math.sin(r);
  const cx = th.x + b.at[0] * c + b.at[1] * s, cz = th.z - b.at[0] * s + b.at[1] * c; // its spot, turned with it
  const half = ((body && body.userData.headTop) || 1.7) / 2;
  obj.rotation.order = 'YXZ'; // (turned last, so the head can point along it: lying on the ground keeps the usual order)
  obj.rotation.set(-Math.PI / 2, Math.atan2(-c, s), 0); // head toward its +x
  obj.position.set(cx - c * half, groundY(cx, cz) + 0.2, cz + s * half);
}
// getting up out of it: standing at its front, facing out (null: the usual order, where they are)
export function outOfBed(obj, th) {
  obj.rotation.order = 'XYZ';
  obj.rotation.x = 0;
  if (!th) return;
  const f = frontSpot(th) || [th.x, th.z];
  obj.rotation.y = th.rot || 0;
  obj.position.set(f[0], groundY(f[0], f[1]), f[1]);
}
// your camp's nearest built bed with room in it (autopilot goes to bed there, 0.2.5), or null
export function myFreeBed() {
  if (!player) return null;
  let best = null, bd = Infinity;
  for (const th of placed.values()) {
    if (!PLACEABLES[th.kind].bed || !th.built || bedFull(th)) continue;
    const c = claimAt(th.x, th.z);
    if (!c || !claimMine(c)) continue;
    const d = Math.hypot(th.x - player.position.x, th.z - player.position.z);
    if (d < bd) { bd = d; best = th; }
  }
  return best;
}

/* ---------- fire and fuel ---------- */
export const fuelLeft = (th, now = Date.now()) => fuelLeftAt(th, now); // ms of burning left (rules.js)
export const isLit = (th) => !!th.lit && fuelLeft(th) > 0;
const fuelIn = (th) => (PLACEABLES[th.kind].fire ? fuelLeft(th) / PLACEABLES[th.kind].fire.each : 0); // in sticks (can be part of one)
// how many more sticks fit (one that only part fits still goes on; the server works it out the same way)
const roomFor = (th, kind) => { const f = PLACEABLES[th.kind].fire; return f ? fuelRoom(f, fuelLeft(th), kind) : 0; };
function burnNow(th) { // bring it up to now
  if (!th.lit) return;
  th.fuel = fuelLeft(th);
  th.at = Date.now();
  if (th.fuel <= 0) { th.lit = false; th.fuel = 0; }
}
function timeLeft(ms) {
  const m = Math.ceil(ms / 60000);
  if (ms <= 0) return 'none';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`; // days for a claim's fire (holds 7 days)
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
function fireState(th) {
  const f = PLACEABLES[th.kind].fire;
  if (!th.built) return 'Not built yet';
  if (PLACEABLES[th.kind].store) return notMineAt(th.x, th.z) ? '' : storeWords(th); // what's in it (not for others: their camp's things are theirs)
  if (PLACEABLES[th.kind].bed) return bedSleepers(th).length ? "Someone's asleep in it" : betterWords(PLACEABLES[th.kind].bed); // a bed (0.2.5)
  if (!f) return '';
  const left = fuelLeft(th);
  return `${isLit(th) ? 'Burning' : 'Out'} · ${left > 0 ? `${timeLeft(left)} of fuel (holds ${timeLeft(f.max)})` : 'no fuel'}`;
}
// the tap menu's title: what it is and, for a fire, whether it's lit and how much fuel it has
export const placedName = (th) => {
  const P = PLACEABLES[th.kind];
  if (P.madeWith) { const def = th.crop && CROPS[th.crop.kind]; return def ? `${P.name} · ${def.name.toLowerCase()}` : P.name; } // a farm field: what grows on it
  if (!th.built) return `${P.name} (not built)`;
  if (P.store) return notMineAt(th.x, th.z) ? P.name : `${P.name} · ${storeNote(th).toLowerCase()}`; // how full it is (0.2.2)
  if (P.bed && bedSleepers(th).length) return `${P.name} · someone's asleep in it`; // a bed in use (0.2.5)
  if (!P.fire) return P.name;
  const left = fuelLeft(th);
  if (claimOn(th)) return `${claimName(th)} · ${timeLeft(left)} left`;
  return isLit(th) ? `${P.name} · lit · ${timeLeft(left)} left` : `${P.name} · ${left > 0 ? `${timeLeft(left)} of fuel` : 'no fuel'}`;
};

/* ---------- seats round it, and where you stand to use it ---------- */
export const seatSpot = (th, k) => seatSpotOf(th, PLACEABLES[th.kind].seats, k); // rules.js, the same on the server
// a thing with a front (0.2.3, Luke: the small wooden crate): where your person stands to use it, out from its middle the
// way it faces (rules.js, the same on the server); null for one without (you walk to its nearest side, as before)
export const frontSpot = (th) => (PLACEABLES[th.kind].front ? frontSpotOf(th, PLACEABLES[th.kind].front) : null);
// the spots a circle shows while you choose where to put it: every seat round a campfire, a crate's front
function useSpots(kind, x, z, rot) {
  const P = PLACEABLES[kind], th = { x, z, rot }, out = [];
  if (P.seats) for (let k = 0; k < P.seats.count; k++) out.push(seatSpotOf(th, P.seats, k));
  if (P.front) out.push(frontSpotOf(th, P.front));
  return out;
}
const seatTaken = (th, k) => [...game.others.values()].some((o) => o.sit && o.sit[0] === th.id && o.sit[1] === k);
// the nearest free seat you can stand at, or -1
function freeSeat(th) {
  const s = PLACEABLES[th.kind].seats;
  if (!s || !player) return -1;
  let best = -1, bd = Infinity;
  for (let k = 0; k < s.count; k++) {
    const [x, z] = seatSpot(th, k);
    if (seatTaken(th, k) || pondShape(x, z) < 1 || solidAt(x, z, 0, true) || Math.abs(x) > WALK_LIMIT || Math.abs(z) > WALK_LIMIT) continue; // (not in a bush either)
    const d = Math.hypot(x - player.position.x, z - player.position.z);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
// sitting on the ground, legs out in front, hands on the knees (anyone: you or someone else)
export function sitPose(m, P, ground) {
  m.rotation.x = 0;
  P.legL.rotation.x = -1.38; P.legR.rotation.x = -1.5; P.legL.scale.y = P.legR.scale.y = 1; P.footL.rotation.x = P.footR.rotation.x = 0;
  P.body.rotation.x = P.body.userData.stoop + 0.14;
  setArm(P.armL, -0.75); setArm(P.armR, -0.7);
  m.position.y = ground - (HIP_Y - 0.1) * m.scale.y;
}
export function unsitPose(m, P, ground) {
  setLegs(P, 0);
  P.body.rotation.x = P.body.userData.stoop;
  setArm(P.armL, 0); setArm(P.armR, 0);
  m.position.y = ground;
}

/* ---------- drawing them ---------- */
const flameGeo = new THREE.ConeGeometry(1, 1, 7, 1, true).translate(0, 0.5, 0);
const FLAME_MATS = ['#ff5a14', '#ff9a2e', '#ffe08a'].map((c, i) => {
  const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: [0.55, 0.65, 0.85][i], blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  m.userData.shared = true;
  return m;
});
const emberMat = new THREE.MeshBasicMaterial({ color: '#ff6a24', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
emberMat.userData.shared = true;
const charMat = mat('#2e2a26');
charMat.userData.shared = true;
// one warm light that follows the nearest lit fire (a fixed number of lights, so nothing has to be redrawn from scratch)
export const fireLight = new THREE.PointLight('#ff9a4a', 0, 9, 1.6);
scene.add(fireLight);
/* How a placed thing looks comes from the data: its item's shape (the item's look.shape in game-data.json), the same
   name items are drawn by. A shape can have a builder here that knows how the thing is put together. It gives
     { model, R, pieces: [{ obj, to, from }], fuel: [...], burns: [...] }
   - pieces: they move from a loose pile (from) into place (to), one after another, as it's built
   - fuel: for a fire, the pieces that show how much fuel is in it (the more fuel, the more of them show)
   - burns: what goes black once a fire has been lit in it
   - R: how far it reaches from its middle (for the tap area and a fire's glow)
   A shape with no builder of its own is drawn as its item, set down whole: it slides in from beside the spot as it's
   built. So a new placeable shows up from the data alone, and only gets a builder here when it should be put together
   piece by piece (0.1.10: before this every placed thing was drawn as a campfire). */
// a farm field (0.1.18): a low bed of dug soil with sloped edges, and lumpy rows of earth along it (darker furrows
// between), the size of its squares on the placing grid. Every field of a size shares its shapes. What grows on it is
// drawn in `crop` (drawCrop).
const fieldGeos = new Map();
function fieldGeo(sx, sz) {
  const key = `${sx}|${sz}`;
  if (fieldGeos.has(key)) return fieldGeos.get(key);
  const bed = new THREE.CylinderGeometry(Math.SQRT2 * 0.5, Math.SQRT2 * 0.5, 1, 4, 1).rotateY(Math.PI / 4); // a square, 1 across
  const p = bed.attributes.position;
  for (let i = 0; i < p.count; i++) { // sides sloping in a little towards the top, like heaped earth
    const top = p.getY(i) > 0, inset = top ? 0.07 : 0;
    p.setXYZ(i, Math.sign(p.getX(i)) * Math.max(0, Math.abs(p.getX(i)) * sx - inset), top ? 0.05 : -0.03, Math.sign(p.getZ(i)) * Math.max(0, Math.abs(p.getZ(i)) * sz - inset));
  }
  bed.computeVertexNormals();
  const rows = [], n = Math.max(2, Math.round(sz / 0.3)), len = sx - 0.22, r = Math.min(0.085, (sz / n) * 0.3);
  for (let k = 0; k < n; k++) {
    const g = new THREE.CylinderGeometry(r, r, len, 6, 6).rotateZ(Math.PI / 2), q = g.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i), t = Math.abs(x) / (len / 2), end = t > 0.75 ? 1 - 0.6 * ((t - 0.75) / 0.25) : 1; // rounded off at the ends
      const lump = 1 + (hash(Math.round(x * 97) + k * 31, Math.round(q.getY(i) * 89) + Math.round(q.getZ(i) * 83) * 7) - 0.5) * 0.45;
      q.setXYZ(i, x, Math.max(0, q.getY(i)) * end * lump * 0.6, q.getZ(i) * end);
    }
    g.translate(0, 0.045, -sz / 2 + ((k + 0.5) * sz) / n);
    rows.push(g.toNonIndexed());
  }
  const earth = mergeGeometries(rows);
  earth.computeVertexNormals();
  bed.userData.shared = earth.userData.shared = true;
  const out = { bed, earth, top: 0.045 + r * 0.6 };
  fieldGeos.set(key, out);
  return out;
}
function fieldModel(look, rule) {
  const size = (rule && rule.size) || [1, 1], sx = PLACE_GRID * size[0] - 0.06, sz = PLACE_GRID * size[1] - 0.06, geo = fieldGeo(sx, sz);
  const model = new THREE.Group();
  model.add(new THREE.Mesh(geo.bed, mat(look.colour || '#5a3f2b')), new THREE.Mesh(geo.earth, mat(look.ridge || '#7a5a3d')));
  const crop = new THREE.Group(); // what grows on it, on the middle row
  crop.position.y = geo.top - 0.02;
  model.add(crop);
  return { model, R: Math.max(sx, sz) / 2, pieces: [], fuel: [], burns: [], crop };
}
const PLACED_SHAPES = { campfire: campfireModel, field: fieldModel };
// how a kind of placed thing looks: from its own look (one dug with a tool), else from the item that places it
function placedModelOf(kind) {
  const P = PLACEABLES[kind];
  if (P.look && PLACED_SHAPES[P.look.shape]) return PLACED_SHAPES[P.look.shape](P.look, P);
  return placedModel(P.item);
}
function placedModel(item) {
  const look = ITEMS[item].look;
  if (PLACED_SHAPES[look.shape]) return PLACED_SHAPES[look.shape](look);
  const made = buildItem(item), model = new THREE.Group(), q = made.model.quaternion.clone(), y = made.rest || 0;
  model.add(made.model);
  const rule = PLACEABLES[ITEMS[item].places];
  return { model, R: rule ? rule.solid : 0.5, pieces: [{ obj: made.model, to: { p: [0, y, 0], q }, from: { p: [-0.5, y, 0.3], q } }], fuel: [], burns: [] };
}
// how many of its fuel pieces show right now (a full fire shows them all)
const fuelShown = (th) => {
  const P = PLACEABLES[th.kind], n = th.view.userData.parts.fuel.length;
  return th.built && P.fire && n ? Math.min(n, Math.ceil((fuelIn(th) / Math.min(P.fire.maxFuel, 10)) * n - 0.001)) : 0;
};
function makePlacedView(th) {
  const P = PLACEABLES[th.kind];
  const parts = placedModelOf(th.kind);
  const g = shadowsOn(parts.model);
  g.userData.parts = parts;
  if (P.fire) { // flames (shown while lit) and a glow in the ashes
    const flame = new THREE.Group();
    [[0.17, 0.55], [0.12, 0.42], [0.07, 0.28]].forEach(([r, h], i) => {
      const c = new THREE.Mesh(flameGeo, FLAME_MATS[i]);
      c.scale.set(r, h, r);
      c.userData.base = [r, h];
      c.userData.phase = Math.random() * 6;
      flame.add(c);
    });
    flame.position.y = 0.06;
    flame.visible = false;
    g.add(flame);
    const ember = new THREE.Mesh(new THREE.CircleGeometry(parts.R * 0.62, 14).rotateX(-Math.PI / 2), emberMat);
    ember.position.y = 0.024;
    ember.visible = false;
    g.add(ember);
    Object.assign(parts, { flame, ember });
  }
  const area = new THREE.Mesh(HIT_BOX, HIT_MAT); // easy to tap
  area.scale.set(parts.R * 2 + 0.5, 0.9, parts.R * 2 + 0.5);
  area.position.y = 0.3;
  g.add(area);
  g.position.set(th.x, groundY(th.x, th.z), th.z);
  g.rotation.y = th.rot || 0;
  g.userData.label = P.name;
  g.userData.placedId = th.id;
  return g;
}
// pieces move from the pile into place as it's built; the teepee shows how much fuel is in it; flames while lit
function drawPlaced(th) {
  const parts = th.view.userData.parts, k = th.built ? 1 : th.progress || 0;
  const n = parts.pieces.length;
  parts.pieces.forEach((pc, i) => {
    const t = smoothstep(0, 1, clamp01(k * n - i)); // one after another
    pc.obj.position.set(...pc.from.p).lerp(tmpV.set(...pc.to.p), t);
    if (t > 0 && t < 1) pc.obj.position.y += Math.sin(t * Math.PI) * 0.12; // lifted over
    pc.obj.quaternion.copy(pc.from.q).slerp(pc.to.q, t);
  });
  const show = fuelShown(th);
  parts.fuel.forEach((m, i) => { m.visible = i < show; });
  const lit = th.built && isLit(th);
  for (const obj of parts.burns) obj.traverse((m) => { if (m.isMesh) { if (!m.userData.wood) m.userData.wood = m.material; m.material = th.burnt ? charMat : m.userData.wood; } }); // a campfire's log and sticks go black once burnt
  if (parts.flame) { parts.flame.visible = lit; parts.ember.visible = lit; }
  th.shown = { lit, show };
}
const tmpV = V();
// where it's solid to walk round, [x, z, r] each: one spot in its middle, or one for each of its squares when it's bigger
// than 1 x 1 (the basic shelter's 2 x 2, 0.2.5), so people go round its corners too
function solidSpotsOf(th) {
  const P = PLACEABLES[th.kind], f = placeRect(th, P), across = Math.round((f.hw * 2) / PLACE_GRID), deep = Math.round((f.hd * 2) / PLACE_GRID);
  if (across * deep <= 1) return [[th.x, th.z, P.solid]];
  const c = Math.cos(f.rot), s = Math.sin(f.rot), out = [];
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < deep; j++) {
      const lx = (i - (across - 1) / 2) * PLACE_GRID, lz = (j - (deep - 1) / 2) * PLACE_GRID;
      out.push([th.x + lx * c + lz * s, th.z - lx * s + lz * c, PLACE_GRID * 0.62]);
    }
  }
  return out;
}
export function setPlaced(v) {
  if (!v || !PLACEABLES[v.kind]) return;
  let th = placed.get(v.id);
  if (!th) {
    th = { id: v.id, kind: v.kind, x: Number(v.x) || 0, z: Number(v.z) || 0, rot: Number(v.rot) || 0, progress: 0 };
    th.view = makePlacedView(th);
    th.view.visible = !game.freshLook;
    scene.add(th.view);
    interactive.push(th.view);
    placed.set(th.id, th);
    for (const [x, z, r] of solidSpotsOf(th)) addSpot(x, z, r, PLACEABLES[th.kind].walkOver ? WALK_THROUGH : 0); // walked round, like a rock (a farm field: walked over)
    clearCellsNear(th.x, th.z, PLACEABLES[th.kind].solid + 1);
    flatsDue = true;
    if (digGhost && Math.abs(digGhost.x - th.x) < 0.01 && Math.abs(digGhost.z - th.z) < 0.01) dropDigGhost(); // the field you were digging is there
  }
  const wasBuilt = th.built;
  Object.assign(th, { built: !!v.built, fuel: Math.max(0, Number(v.fuel) || 0), lit: !!v.lit, at: Date.now(), claim: v.claim && v.claim.who ? v.claim : null });
  drawClaimRing(th);
  if (th.lit || v.burnt) th.burnt = true;
  if (th.built && !wasBuilt && !th.progress) th.progress = 0.999; // built by someone else: pieces just settle
  drawPlaced(th);
  if (PLACEABLES[th.kind].store) { // what's in it (0.2.2): kinds and how many, and how worn its tools are
    th.store = {}; th.wear = {};
    for (const [k, n] of Object.entries(v.store || {})) if (ITEMS[k] && n > 0) th.store[k] = Math.floor(n);
    for (const [k, list] of Object.entries(v.wear || {})) if (th.store[k] && Array.isArray(list)) th.wear[k] = list.slice(0, th.store[k]).map((x) => Number(x) || 0);
    if (storeShowing(th.id)) drawBag(); // its squares are open on your screen
  }
  if (PLACEABLES[th.kind].madeWith) { // a farm field: what grows on it, from ages (so phone clocks don't matter)
    const c = v.crop && CROPS[v.crop.kind] ? v.crop : null, now = Date.now();
    th.crop = c ? { kind: c.kind, at: now - (Number(c.age) || 0), berries: Array.isArray(c.berries) ? [Number(c.berries[0]) || 0, now - (Number(c.berries[1]) || 0)] : [null, null],
      stump: Number.isFinite(c.stump) ? now - c.stump : 0 } : null; // (stump: a tree on it was chopped then, 0.2.9)
    drawCrop(th);
  }
}
export function removePlaced(id) {
  const th = placed.get(id);
  if (!th) return;
  scene.remove(th.view);
  disposeMaterials(th.view);
  const i = interactive.indexOf(th.view);
  if (i >= 0) interactive.splice(i, 1);
  for (const [x, z] of solidSpotsOf(th)) removeSpotNear(x, z);
  if (th.treeSpot) removeSpotNear(th.x + TREE_SPOT_OFF, th.z); // (a tree growing on it, 0.2.9)
  clearCellsNear(th.x, th.z, PLACEABLES[th.kind].solid + 1);
  flatsDue = true;
  if (th.ring) { scene.remove(th.ring); th.ring.geometry.dispose(); }
  placed.delete(id);
  if (you.sit && you.sit.fire === id) endSit(false);
}
// the whole list from the server (joining, or the world was reset)
export function usePlaced(list) {
  const ids = new Set((list || []).map((v) => v.id));
  for (const id of [...placed.keys()]) if (!ids.has(id)) removePlaced(id);
  for (const v of list || []) setPlaced(v);
}
// every frame: flames flicker, fires that ran out go out, the light sits on the nearest lit fire
let placedTick = 0;
export function animatePlaced(dt) {
  if (flatsDue) levelPlaced();
  if (digGhost && digGhost.until && Date.now() > digGhost.until) dropDigGhost(); // the server said no, or it's slow
  placedTick += dt;
  const second = placedTick > 1;
  if (second) placedTick = 0;
  let near = null, nd = Infinity;
  const c = controls.target;
  if (second) storeCheck(); // an open crate's squares go when you walk away from it, or it's gone (inventory.js)
  for (const th of placed.values()) {
    if (second && th.shown && (th.shown.lit !== isLit(th) || th.shown.show !== fuelShown(th))) {
      burnNow(th); drawPlaced(th); // burnt down a stick, or out of fuel: the fire goes out by itself
    }
    if (second && th.view.userData.parts.crop) { // a farm field: its crop growing, berries growing back
      if (th.cropShown !== cropShownKey(th)) drawCrop(th);
      if (th.flatAt && Date.now() - th.flatAt > 4000) { th.flatAt = 0; th.view.scale.y = 1; } // flattened, but it's still here: the server said no
    }
    const parts = th.view.userData.parts;
    if (!parts.flame || !parts.flame.visible) continue;
    const size = 0.65 + 0.35 * Math.min(1, fuelIn(th) / 4);
    for (const f of parts.flame.children) {
      const [r, h] = f.userData.base, ph = f.userData.phase;
      const flick = reduceMotion ? 1 : 1 + Math.sin(game.elapsed * 9 + ph) * 0.12 + Math.sin(game.elapsed * 23 + ph * 2) * 0.07;
      f.scale.set(r * size * (2 - flick) * 0.95, h * size * flick, r * size * (2 - flick) * 0.95);
      f.rotation.z = reduceMotion ? 0 : Math.sin(game.elapsed * 3 + ph) * 0.06;
    }
    const d = (th.x - c.x) ** 2 + (th.z - c.z) ** 2;
    if (d < nd) { nd = d; near = th; }
  }
  if (near && nd < 40 * 40) {
    const dark = clamp01(1.45 - sun.intensity / 2); // strong at night, a soft glow by day
    fireLight.position.set(near.x, groundY(near.x, near.z) + 0.6, near.z);
    fireLight.intensity = (5 + (reduceMotion ? 0 : Math.sin(game.elapsed * 11) * 0.6 + Math.sin(game.elapsed * 27) * 0.4)) * dark * (0.7 + 0.3 * Math.min(1, fuelIn(near) / 4));
  } else fireLight.intensity = 0;
}

/* ---------- placing: pick a spot, then your person goes and puts it down ---------- */
// while choosing (0.2.3, Luke: "to help know where front is"): a circle on the ground at each spot people use it from, the
// seats round a campfire and a crate's front, in the outline's colour (green, or red where it can't go). Only while placing.
const SPOT_GEO = new THREE.RingGeometry(0.2, 0.28, 28).rotateX(-Math.PI / 2), spotRings = [];
function showSpots(list, colour) {
  list.forEach(([x, z], i) => {
    if (!spotRings[i]) {
      const r = new THREE.Mesh(SPOT_GEO, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, depthTest: false }));
      r.renderOrder = 2;
      scene.add(r);
      spotRings.push(r);
    }
    const r = spotRings[i];
    r.position.set(x, groundY(x, z) + 0.04, z);
    r.material.color.set(colour);
    r.visible = true;
  });
  for (let i = list.length; i < spotRings.length; i++) spotRings[i].visible = false;
}
export const placeSpotsShown = () => spotRings.filter((r) => r.visible).map((r) => [r.position.x, r.position.z]); // (for checks)
export const placing = { on: false, item: null, kind: null, x: 0, z: 0, rot: 0, at: null, ghost: null, ok: false, dig: false, picks: [], why: '' }; // at: where you last tapped; dig: choosing farm fields (picks)
// the square it takes on the grid, outlined on the ground (green, or red where it can't go)
const placeRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#9fd88a', transparent: true, opacity: 0.8, depthWrite: false, depthTest: false }));
placeRing.visible = false;
placeRing.renderOrder = 2;
scene.add(placeRing);
// the placing grid's squares, faint on the ground round the spot while you choose where to place or dig (0.2.2, Luke),
// fading out a few metres away, so you can see what lines up. Hidden the rest of the time. The lines bend with the land.
const GRID_FADE = 3.5, GRID_BEND = 0.25; // how far out they show (m); a bend every quarter metre
const gridMost = 4 * (2 * Math.ceil(GRID_FADE / PLACE_GRID) + 1) * Math.ceil((2 * GRID_FADE) / GRID_BEND + 1); // line ends it can need
const gridGeo = new THREE.BufferGeometry();
gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridMost * 3), 3).setUsage(THREE.DynamicDrawUsage));
gridGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gridMost * 4), 4).setUsage(THREE.DynamicDrawUsage)); // (white, see-through as they fade)
export const placeGrid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
placeGrid.frustumCulled = false;
placeGrid.visible = false;
placeGrid.renderOrder = 1;
scene.add(placeGrid);
function showGrid(cx, cz) {
  const pos = gridGeo.attributes.position.array, col = gridGeo.attributes.color.array;
  let n = 0;
  const end = (x, z) => {
    const a = 0.32 * (1 - smoothstep(GRID_FADE * 0.4, GRID_FADE, Math.hypot(x - cx, z - cz)));
    pos.set([x, groundY(x, z) + 0.03, z], n * 3);
    col.set([1, 1, 1, a], n * 4);
    n++;
  };
  const lo = (v) => Math.ceil((v - GRID_FADE) / PLACE_GRID) * PLACE_GRID, hi = (v) => Math.floor((v + GRID_FADE) / PLACE_GRID) * PLACE_GRID;
  for (const across of [true, false]) { // lines along z at each x on the grid, then along x at each z
    const [c, o] = across ? [cx, cz] : [cz, cx];
    for (let g = lo(c); g <= hi(c) + 1e-6; g += PLACE_GRID) {
      const half = Math.sqrt(Math.max(0, GRID_FADE * GRID_FADE - (g - c) * (g - c))); // (only as far as they show)
      for (let t = o - half; t < o + half - 1e-6 && n < gridMost - 1; t += GRID_BEND) {
        const t2 = Math.min(o + half, t + GRID_BEND);
        if (across) { end(g, t); end(g, t2); } else { end(t, g); end(t2, g); }
      }
    }
  }
  gridGeo.setDrawRange(0, n);
  gridGeo.attributes.position.needsUpdate = gridGeo.attributes.color.needsUpdate = true;
  placeGrid.visible = true;
}
export const rectOf = (x, z, rot, kind) => placeRect({ x, z, rot }, PLACEABLES[kind]); // rules.js
// why it can't go here (or null if it can). x, z, rot are already on the grid (placeSnap)
export function cantPlaceAt(x, z, kind, rot = 0) {
  const P = PLACEABLES[kind], f = rectOf(x, z, rot, kind);
  if (P.inCamp) { const c = claimAt(x, z); if (!c || !claimMine(c)) return `${P.name}s only go in your camp`; } // (a farm field, 0.1.18; the server says the same)
  if (Math.abs(x) > WALK_LIMIT - 1 || Math.abs(z) > WALK_LIMIT - 1) return 'Too close to the forest';
  if (pondShape(x, z) < 1.35) return 'Too close to the water';
  if (placeClash([...placed.values()], { x, z, rot }, kind, PLACEABLES)) return 'Too close to another one';
  const tree = roomClash([...placed.values()], { x, z, rot }, kind, PLACEABLES, CROPS); // the squares round a tree on a farm field stay empty (0.2.9)
  if (tree) return `Too close to the ${cropOf(tree).name.toLowerCase()}`;
  if (!roomAt(x, z, Math.max(P.solid, Math.hypot(f.hw, f.hd)) + 0.25, 0.4, placedAt)) return 'Not enough room here'; // (other placed things: placeClash above)
  if (groundUnder(f, 0.5).rise > (SETTINGS.placeMaxRise || 0.5)) return 'Too steep here';
  const c = notMineAt(x, z);
  if (c) return `This belongs to ${c.claim.name}`; // (the server's words for it: claimNo in server/src/claims.js)
  return null;
}
const placedAt = (x, z) => { for (const th of placed.values()) if (Math.abs(th.x - x) < 0.01 && Math.abs(th.z - z) < 0.01) return true; return false; };
// is x, z on a placed thing's square (turned with it), or within `margin` of it?
function inRect(f, x, z, margin = 0) {
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), dx = x - f.x, dz = z - f.z;
  return Math.abs(dx * c - dz * s) < f.hw + margin && Math.abs(dx * s + dz * c) < f.hd + margin;
}
// level the ground under everything placed (land.js), then set things on it: placed things, trees, rocks and bushes
// (0.1.18: they used to keep their ground, but the land's 2 m triangles still tipped it, and rocks floated), loose items
// and the grass
let flatsDue = false, grassMoved = [];
export function levelPlaced() {
  flatsDue = false;
  const rects = [...placed.values()].map((th) => Object.assign(rectOf(th.x, th.z, th.rot, th.kind), { th }));
  const items = [...itemViews.values()].map((v) => [v, groundY(v.position.x, v.position.z)]);
  setFlats(rects);
  liftNear(rects); // trees, rocks and bushes near them sit on the ground as it is now (world-build.js)
  for (const f of rects) f.th.view.position.y = f.y;
  for (const [v, was] of items) v.position.y += groundY(v.position.x, v.position.z) - was;
  for (const [kind, P] of Object.entries(plants)) { // tall grass and other plants: back where they grew, then onto the levelled ground
    if (!P.y0) P.y0 = P.mats.map((M) => Float32Array.from({ length: M.length / 16 }, (_, i) => M[i * 16 + 13]));
    for (const c of P.clumps) {
      const lift = rects.some((f) => Math.hypot(c.x - f.x, c.z - f.z) < flatReach(f) + 0.5) ? groundY(c.x, c.z) - groundY(c.x, c.z, landAsMade) : 0;
      if (Math.abs(lift - (c.lift || 0)) < 0.001) continue;
      c.lift = lift;
      for (let k = 0; k < P.per; k++) { const i = c.i * P.per + k; P.mats.forEach((M, j) => { M[i * 16 + 13] = P.y0[j][i] + lift; }); }
      c.shown = null; drawPlant(kind, c);
    }
  }
  const bare = rects; // no grass grows through a placed thing: dug soil (a farm field), and since 0.2.2 the rest too (it poked out of the crate's lid)
  for (const d of DETAILS) { // grass: back where it grew, then onto the levelled ground
    const m = d.ms;
    if (!d.y0) d.y0 = Float32Array.from(d.xs, (_, i) => m[i * 16 + 13]);
    for (const i of grassMoved) m[i * 16 + 13] = d.y0[i];
    grassMoved = [];
    if (d.hide) d.hide.fill(0); else if (bare.length) d.hide = new Uint8Array(d.xs.length); // (refillDetail in nature.js skips these)
    for (let i = 0; i < d.xs.length; i++) {
      const x = d.xs[i], z = d.zs[i];
      if (!rects.some((f) => Math.abs(x - f.x) < flatReach(f) && Math.abs(z - f.z) < flatReach(f))) continue;
      if (bare.some((f) => inRect(f, x, z, 0.05))) d.hide[i] = 1;
      const lift = groundY(x, z) - groundY(x, z, landAsMade);
      if (Math.abs(lift) > 0.001) { m[i * 16 + 13] = d.y0[i] + lift; grassMoved.push(i); }
    }
  }
  game.detailAt = null; // grass is drawn again next frame
}
export function startPlacing(item) {
  const kind = ITEMS[item] && ITEMS[item].places;
  if (!kind || !player || you.dead || !you.carry[item]) return;
  closeBag(); closeCraft(); game.closeMenu();
  stopPlacing();
  const ghost = placingGhost(placedModel(item).model);
  Object.assign(placing, { on: true, item, kind, ghost, dig: false, picks: [], rot: Math.round(player.rotation.y / (Math.PI / 2)) * (Math.PI / 2) + Math.PI }); // facing one of 4 ways: towards you (0.2.3, so a crate's front is yours)
  const fx = Math.sin(player.rotation.y), fz = Math.cos(player.rotation.y);
  $('placeGo').textContent = 'Place';
  movePlacing(player.position.x + fx * 1.8, player.position.z + fz * 1.8);
  $('placeBar').hidden = false;
  app.classList.add('placing');
}
// a see-through copy that follows taps on the ground while you choose the spot
function placingGhost(model) {
  model.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.userData = {}; m.material.transparent = true; m.material.opacity = 0.55; m.material.depthWrite = false; } });
  scene.add(model);
  return model;
}
// Digging farm fields (0.1.18): the spot you tapped is the first one. Then (test 2, Luke: "build multiple at once") every
// tap on the ground adds another field (a see-through one on its square), a tap on one already chosen takes it off, and
// Dig digs them all, one after another, with the tool on your tool bar.
const MAX_DIGS = 20;
export function startDigging(kind, at) {
  const P = PLACEABLES[kind];
  if (!P || !P.madeWith || !player || you.dead || !at) return;
  closeBag(); closeCraft(); game.closeMenu();
  stopPlacing();
  Object.assign(placing, { on: true, item: null, kind, ghost: null, dig: true, picks: [], why: '', rot: 0, ok: false });
  $('placeBar').hidden = false;
  app.classList.add('placing');
  pickDig(at.x, at.z);
}
function pickDig(x, z) {
  const kind = placing.kind, s = placeSnap(x, z, placing.rot, PLACEABLES[kind]); // rules.js
  showGrid(s.x, s.z);
  const i = placing.picks.findIndex((k) => inRect(rectOf(k.x, k.z, k.rot, kind), x, z)); // a tap on one already chosen takes it off
  if (i >= 0) { dropPick(placing.picks.splice(i, 1)[0]); placing.why = ''; drawDigging(); return; }
  const why = placing.picks.length >= MAX_DIGS ? `Up to ${MAX_DIGS} at a time` : cantPlaceAt(s.x, s.z, kind, s.rot) || (placeClash(placing.picks, s, kind, PLACEABLES) ? 'Too close to another one' : null);
  const f = rectOf(s.x, s.z, s.rot, kind), y = groundUnder(f).y; // the height it'll sit at once the ground is levelled
  if (why) { // where it can't go: the square flashes red for a moment, and the bar says why
    placing.why = why;
    placeRing.position.set(s.x, y + 0.04, s.z);
    placeRing.scale.set(f.hw / Math.SQRT1_2, 1, f.hd / Math.SQRT1_2);
    placeRing.rotation.y = s.rot;
    placeRing.material.color.set('#e07a6a');
    placeRing.visible = true;
    const flash = (placing.flash = (placing.flash || 0) + 1);
    setTimeout(() => { if (placing.flash === flash && placing.dig) placeRing.visible = false; }, 1500);
    drawDigging();
    return;
  }
  const ghost = placingGhost(placedModelOf(kind).model), ring = new THREE.Mesh(placeRing.geometry, placeRing.material.clone());
  ghost.position.set(s.x, y, s.z);
  ghost.rotation.y = s.rot;
  ring.material.color.set('#9fd88a');
  ring.renderOrder = 2;
  ring.position.set(s.x, y + 0.04, s.z);
  ring.scale.set(f.hw / Math.SQRT1_2, 1, f.hd / Math.SQRT1_2);
  ring.rotation.y = s.rot;
  scene.add(ring);
  placing.picks.push({ kind, x: s.x, z: s.z, rot: s.rot, ghost, ring });
  placing.why = '';
  placeRing.visible = false;
  drawDigging();
}
function dropPick(k) {
  scene.remove(k.ghost);
  disposeMaterials(k.ghost);
  scene.remove(k.ring);
  k.ring.material.dispose();
}
// the bar while choosing: why the last tap couldn't go there, or what to do; Dig says how many
function drawDigging() {
  const n = placing.picks.length;
  $('placeText').textContent = placing.why || (n ? 'Tap to add more or take one off' : 'Tap the ground to choose where');
  $('placeGo').textContent = n > 1 ? `Dig ${n}` : 'Dig';
  $('placeGo').disabled = !n;
}
// a tap on the ground: the nearest spot on the grid to it
export function movePlacing(x, z) {
  if (!placing.on) return;
  if (placing.dig) { pickDig(x, z); return; }
  placing.at = [x, z];
  const s = placeSnap(x, z, placing.rot, PLACEABLES[placing.kind]); // rules.js
  placing.x = s.x; placing.z = s.z; placing.rot = s.rot;
  x = s.x; z = s.z;
  const why = cantPlaceAt(x, z, placing.kind, placing.rot);
  placing.ok = !why;
  const f = rectOf(x, z, placing.rot, placing.kind), y = groundUnder(f).y; // the height it'll sit at once the ground is levelled
  placing.ghost.position.set(x, y, z);
  placing.ghost.rotation.y = placing.rot;
  showGrid(x, z);
  placeRing.position.set(x, y + 0.04, z);
  placeRing.scale.set(f.hw / Math.SQRT1_2, 1, f.hd / Math.SQRT1_2);
  placeRing.rotation.y = placing.rot;
  placeRing.material.color.set(why ? '#e07a6a' : '#9fd88a');
  placeRing.visible = true;
  showSpots(useSpots(placing.kind, x, z, placing.rot), why ? '#e07a6a' : '#9fd88a'); // where people sit round it, or stand at its front
  const claim = !why && placing.kind === CLAIMS.placeable ? claimHere(x, z) : null; // would lighting it claim the land?
  showPlaceClaim(why ? null : [x, z], claim);
  $('placeText').textContent = why || (claim ? claim.text : 'Tap the ground to move it');
  $('placeGo').disabled = !!why;
}
// the Turn button: a quarter turn (farm fields: all the ones chosen, so their rows run the other way)
export function turnPlacing() {
  if (!placing.on) return;
  placing.rot += Math.PI / 2;
  if (!placing.dig) { movePlacing(...placing.at); return; }
  for (const k of placing.picks) {
    k.rot = placeSnap(k.x, k.z, placing.rot, PLACEABLES[k.kind]).rot; // (a farm field is square: it stays on the same spot)
    k.ghost.rotation.y = k.ring.rotation.y = k.rot;
  }
}
export function stopPlacing() {
  if (placing.ghost) { scene.remove(placing.ghost); disposeMaterials(placing.ghost); }
  for (const k of placing.picks || []) dropPick(k);
  placing.on = false; placing.ghost = null; placing.dig = false; placing.picks = []; placing.why = '';
  placeRing.visible = false;
  placeGrid.visible = false;
  showSpots([]);
  showPlaceClaim(null);
  $('placeBar').hidden = true;
  app.classList.remove('placing');
}
export function finishPlacing() {
  if (placing.on && placing.dig) { // farm fields: dig every one chosen, in the order they were chosen
    const list = placing.picks.map((k) => ({ type: 'dig', kind: k.kind, x: k.x, z: k.z, rot: k.rot }));
    if (!list.length) return;
    stopPlacing();
    for (const t of list) queueTask(t);
    return;
  }
  if (!placing.on || !placing.ok) return;
  const t = { type: 'place', item: placing.item, kind: placing.kind, x: placing.x, z: placing.z, rot: placing.rot };
  stopPlacing();
  queueTask(t);
}
$('placeTurn').addEventListener('click', turnPlacing);
$('placeGo').addEventListener('click', finishPlacing);
$('placeCancel').addEventListener('click', stopPlacing);

/* ---------- doing things with them: tasks in your queue ---------- */
const sendNow = (msg) => game.sendAct(msg); // where you are first (the server checks you're close); kept for when the connection comes back (online.js)
// walking over to use it: to its front if it has one (a crate, 0.2.3), else to its nearest side
function goNear(th, then) {
  const f = frontSpot(th);
  if (!f) { approach(th.x, th.z, PLACEABLES[th.kind].solid + 0.35, PLACEABLES[th.kind].solid + 0.75, then); return; }
  if (Math.hypot(f[0] - player.position.x, f[1] - player.position.z) < 0.35) then();
  else walkTo(V(f[0], 0, f[1]), then, nextTask);
}
const placedSpot = (t) => { const th = placed.get(t.id); return th ? V(th.x, groundY(th.x, th.z) + 0.8, th.z) : null; };
Object.assign(TASK_KINDS, {
  // putting it down where you chose: then building it straight after (the server says when it's there)
  place: {
    start(t) {
      if (!you.carry[t.item]) { nextTask(); return; }
      const why = cantPlaceAt(t.x, t.z, t.kind, t.rot);
      if (why) { showTag(why, headTop(), 2); nextTask(); return; }
      const putDown = () => {
        face(t.x, t.z);
        startAction({ pose: 'bend', seconds: 0.9, mid: () => {
          if (!you.carry[t.item]) return;
          takeFromCarry(t.item, 1);
          drawHeld(); drawCarry();
          sendNow({ t: 'place', kind: t.item, x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100, rot: Math.round(t.rot * 100) / 100 });
        } });
      };
      const P = PLACEABLES[t.kind], f = P.front ? frontSpotOf(t, P.front) : null; // a crate: put down from in front of it (0.2.3)
      if (!f) approach(t.x, t.z, P.solid + 0.45, P.solid + 0.9, putDown);
      else if (Math.hypot(f[0] - player.position.x, f[1] - player.position.z) < 0.35) putDown();
      else walkTo(V(f[0], 0, f[1]), putDown, nextTask);
    },
    name: (t, now) => (now ? `Putting down the ${PLACEABLES[t.kind].name.toLowerCase()}` : `Place ${PLACEABLES[t.kind].name.toLowerCase()}`),
    spot: (t) => V(t.x, groundY(t.x, t.z) + 0.5, t.z),
  },
  // building a site: the pieces go into place as you work
  build: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || th.built) { nextTask(); return; }
      goNear(th, () => {
        if (!placed.has(th.id) || th.built) { nextTask(); return; }
        const P = PLACEABLES[th.kind];
        face(th.x, th.z);
        showTag(`${P.buildVerb}…`, headTop(), 2, P.buildSeconds * slowness() + 0.3);
        game.tagLabel.busy = true;
        startAction({ pose: 'kneel', seconds: P.buildSeconds,
          tick: (k) => { th.progress = k; drawPlaced(th); },
          cancel: () => { th.progress = 0; drawPlaced(th); },
          end: () => {
            th.built = true; th.progress = 1; th.at = Date.now();
            drawPlaced(th);
            spendEnergy('build');
            showGain(`${P.name} built`);
            sendNow({ t: 'build', id: th.id });
          } });
      });
    },
    name: (t, now) => { const th = placed.get(t.id), n = th ? PLACEABLES[th.kind].name.toLowerCase() : 'it'; return now ? `Building the ${n}` : `Build ${n}`; },
    spot: placedSpot,
  },
  // picking an unbuilt site back up
  // picking up an unbuilt site, or packing up a built one (it has to be out)
  unplace: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || (th.built && PLACEABLES[th.kind].fire && isLit(th))) { nextTask(); return; }
      const P = PLACEABLES[th.kind];
      const no = carryNo({ [P.item]: 1 });
      if (no) { showTag(no, headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        face(th.x, th.z);
        startAction({ pose: 'bend', seconds: th.built ? 2 : 0.9, mid: () => sendNow({ t: 'unplace', id: th.id }) });
      });
    },
    name: (t, now) => { const th = placed.get(t.id); if (!th) return now ? 'Picking it up' : 'Pick it up'; const n = PLACEABLES[th.kind].name.toLowerCase(); return th.built ? (now ? 'Packing up' : 'Pack up') : (now ? `Picking up ${n}` : `Pick up ${n}`); },
    spot: placedSpot,
  },
  // taking a built one apart: its parts land on the ground round it (the server says what)
  apart: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || !th.built) { nextTask(); return; }
      goNear(th, () => {
        face(th.x, th.z);
        startAction({ pose: 'kneel', seconds: 3, mid: () => sendNow({ t: 'apart', id: th.id }) });
      });
    },
    name: (t, now) => (now ? 'Taking apart' : 'Take apart'),
    spot: placedSpot,
  },
  // a fire: add sticks, light it, put it out
  tend: {
    start(t) {
      const th = placed.get(t.id), F = th && PLACEABLES[th.kind].fire;
      if (!th || !th.built || !F) { nextTask(); return; }
      goNear(th, () => {
        burnNow(th);
        let n = 0;
        const kind = t.fuel && F.fuels[t.fuel] ? t.fuel : F.fuel, each = F.fuels[kind]; // sticks, or another fuel like logs
        if (t.do === 'add') {
          n = Math.min(t.n || 1, you.carry[kind] || 0, roomFor(th, kind));
          if (n < 1) { showTag(you.carry[kind] ? 'The fire is full' : `You have no ${ITEMS[kind].plural.toLowerCase()}`, headTop(), 2); nextTask(); return; }
        }
        if (t.do === 'light' && (isLit(th) || fuelLeft(th) <= 0)) { showTag(isLit(th) ? "It's already lit" : 'Add fuel first', headTop(), 2); nextTask(); return; }
        if (t.do === 'out' && !isLit(th)) { nextTask(); return; }
        face(th.x, th.z);
        const secs = t.do === 'light' ? F.lightSeconds : 1.2;
        if (t.do === 'light') { showTag('Lighting the fire…', headTop(), 2, secs * slowness() + 0.3); game.tagLabel.busy = true; }
        startAction({ pose: t.do === 'out' ? 'bend' : 'kneel', seconds: secs, end: () => {
          burnNow(th);
          if (t.do === 'add') {
            n = Math.min(n, you.carry[kind] || 0, roomFor(th, kind));
            if (n < 1) return;
            takeFromCarry(kind, n);
            th.fuel = Math.min(F.max, fuelLeft(th) + n * each);
            showGain(`+${timeLeft(n * each)} of fuel`);
            drawHeld(); drawCarry();
          } else if (t.do === 'light') { if (fuelLeft(th) <= 0) return; th.lit = true; th.burnt = true; th.at = Date.now(); showGain('The fire is lit'); }
          else { th.lit = false; showGain('The fire is out'); }
          spendEnergy('tend');
          drawPlaced(th);
          sendNow({ t: 'fire', id: th.id, do: t.do, n, fuel: kind });
        } });
      });
    },
    name: (t, now) => {
      const th = placed.get(t.id), F = th && PLACEABLES[th.kind].fire, fuel = ITEMS[t.fuel] || (F ? ITEMS[F.fuel] : ITEMS.stick);
      if (t.do === 'light') return now ? 'Lighting the fire' : 'Light fire';
      if (t.do === 'out') return now ? 'Putting out the fire' : 'Put out fire';
      return now ? `Adding ${fuel.plural.toLowerCase()}` : `Add ${countLabel(fuel.id, t.n || 1).toLowerCase()}`;
    },
    spot: placedSpot,
  },
  // opening something that holds things (0.2.2, the small wooden crate): walk over, then its squares show at the top of
  // your inventory (inventory.js openStore). There's nothing to carry on with while you're away, so the server leaves it off.
  open: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || !th.built || !PLACEABLES[th.kind].store) { nextTask(); return; }
      const c = notMineAt(th.x, th.z);
      if (c) { showTag(`This belongs to ${c.claim.name}`, headTop(), 2); nextTask(); return; } // (someone else's camp; the server checks too)
      goNear(th, () => {
        face(th.x, th.z);
        startAction({ pose: 'bend', seconds: 0.5, end: () => { if (placed.has(th.id)) openStore(th.id); } });
      });
    },
    name: (t, now) => { const th = placed.get(t.id), n = th ? PLACEABLES[th.kind].noun : 'it'; return now ? `Opening the ${n}` : `Open ${n}`; },
    spot: placedSpot,
  },
  // sleeping in a bed (0.2.5, the basic shelter): walk to its front, then lie down inside it (moving.js setSleeping).
  // Lying down ends your task list, as Sleep does. It carries on while you're away (server/src/tasks.js).
  bed: {
    start(t) {
      const th = placed.get(t.id), P = th && PLACEABLES[th.kind];
      if (!th || !th.built || !P.bed) { nextTask(); return; }
      const c = notMineAt(th.x, th.z);
      if (c) { showTag(`This belongs to ${c.claim.name}`, headTop(), 2); nextTask(); return; } // (someone else's camp; the server checks too)
      if (bedFull(th)) { showTag("Someone's asleep in it", headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        if (!placed.has(th.id) || bedFull(th)) { showTag("Someone's asleep in it", headTop(), 2); nextTask(); return; }
        setSleeping(true, false, th.id);
      });
    },
    name: (t, now) => { const th = placed.get(t.id), n = th ? PLACEABLES[th.kind].noun : 'shelter'; return now ? `Getting into the ${n}` : `Sleep in ${n}`; },
    spot: placedSpot,
  },
  // sitting by the fire: walk to a free seat and sit until you stand up, do something else or the fire goes out (it carries on while you're away)
  sit: {
    start(t) {
      const th = placed.get(t.id);
      if (you.sit) { drawQueue(); return; } // already sitting (something quick came first, like putting a thing down): carry on
      if (!th || !th.built || !PLACEABLES[th.kind].seats) { nextTask(); return; }
      const k = freeSeat(th);
      if (k < 0) { showTag('No room by the fire', headTop(), 2); nextTask(); return; }
      const [x, z] = seatSpot(th, k);
      const sitDown = () => {
        if (!placed.has(th.id)) { nextTask(); return; }
        if (seatTaken(th, k)) { const again = freeSeat(th); if (again < 0) { showTag('No room by the fire', headTop(), 2); nextTask(); return; } TASK_KINDS.sit.start(t); return; }
        const [sx, sz] = seatSpot(th, k);
        game.playerGround = groundY(sx, sz);
        player.position.set(sx, game.playerGround, sz);
        face(th.x, th.z);
        you.sit = { fire: th.id, seat: k };
        sendNow({ t: 'sit', id: th.id, seat: k });
        showTag('Sitting by the fire', headTop(), 2);
        drawQueue();
      };
      if (Math.hypot(x - player.position.x, z - player.position.z) < 0.2) sitDown();
      else walkTo(V(x, 0, z), sitDown, nextTask);
    },
    stop() { endSit(true, false); },
    name: (t, now) => (now ? 'Sitting by the fire' : 'Sit by the fire'),
    spot: placedSpot,
  },
});
// while sitting (called each frame instead of walking): stay put, stand up if the fire has gone out
export function holdSit(P) {
  const th = placed.get(you.sit.fire);
  if (th) player.rotation.y = Math.atan2(th.x - player.position.x, th.z - player.position.z);
  sitPose(player, P, game.playerGround);
  if (!th || (PLACEABLES[th.kind].fire && !isLit(th))) endSit(true);
}
// standing up: tell the server (unless it already knows), and move on to the next thing in the queue
export function endSit(tell = true, next = true) {
  if (!you.sit) return;
  you.sit = null;
  if (player) unsitPose(player, player.userData.parts, game.playerGround);
  if (tell) sendNow({ t: 'sit', off: true });
  if (next && tasks.current && tasks.current.type === 'sit') nextTask();
}
// back in the game while still sitting (you left the task running): carry on sitting
export function resumeSit(s) {
  const th = s && placed.get(s.fire);
  if (!th || !player) return;
  const [x, z] = seatSpot(th, s.seat);
  game.playerGround = groundY(x, z);
  player.position.set(x, game.playerGround, z);
  tasks.current = { type: 'sit', id: th.id };
  you.sit = { fire: th.id, seat: s.seat };
  drawQueue();
}
// leaving the world (Exit, or your person died): forget the sit here; the server still has it while you're away
export function forgetSit() {
  if (!you.sit) return;
  you.sit = null;
  if (tasks.current && tasks.current.type === 'sit') tasks.current = null;
  if (player) unsitPose(player, player.userData.parts, game.playerGround);
}

/* ---------- the tap menu for a placed thing ---------- */
// the tap menu: what you'll most likely want first, putting the fire out last, Inspect and Walk here small along the bottom
export function placedActions(th) {
  const P = PLACEABLES[th.kind], name = P.name.toLowerCase();
  if (P.madeWith) return fieldActions(th); // a farm field (0.1.18)
  const walkHere = { label: 'Walk here', foot: true, run: () => walkFirst(V(th.x + P.solid + 0.8, 0, th.z)) };
  if (!th.built) {
    return [{ label: `Build ${name}`, note: `${P.buildSeconds} s`, run: () => queueTask({ type: 'build', id: th.id }) },
      { label: `Pick up ${name}`, note: 'Not built yet', run: () => queueTask({ type: 'unplace', id: th.id }) }, walkHere];
  }
  const out = [];
  const F = P.fire, lit = !!F && isLit(th);
  if (F && !lit) out.push({ label: 'Light fire', disabled: fuelLeft(th) <= 0, note: fuelLeft(th) > 0 ? `${F.lightSeconds} s` : 'Add fuel first', run: () => queueTask({ type: 'tend', id: th.id, do: 'light' }) });
  if (F) { // Add fuel: one list of every fuel it takes that you carry (sticks, logs), one or as many as fit
    const fuels = [];
    let carrying = false;
    for (const [kind, each] of Object.entries(F.fuels)) {
      const have = you.carry[kind] || 0, n = Math.min(have, roomFor(th, kind));
      if (have) carrying = true;
      if (n < 1) continue;
      fuels.push({ label: `Add ${countLabel(kind, 1).toLowerCase()}`, note: `+${timeLeft(each)}`, run: () => queueTask({ type: 'tend', id: th.id, do: 'add', n: 1, fuel: kind }) });
      if (n > 1) fuels.push({ label: `Add ${countLabel(kind, n).toLowerCase()}`, note: `+${timeLeft(n * each)}`, run: () => queueTask({ type: 'tend', id: th.id, do: 'add', n, fuel: kind }) });
    }
    if (fuels.length) out.push({ label: 'Add fuel', sub: fuels });
    else if (carrying) out.push({ label: 'Add fuel', note: 'Full', disabled: true, run: () => {} });
  }
  // recipes made here ("near" in a recipe), like cooking on a fire: craftLabel names the list (Cook)
  const here = RECIPES.filter((r) => r.near === th.kind && recipeKnown(r));
  if (here.length && (!F || lit)) {
    out.push({ label: P.craftLabel, sub: here.map((r) => {
      const why = cantMake(r) === 'Not here' ? '' : cantMake(r); // not here yet is fine: you walk over first
      return { label: recipeName(r), note: why, disabled: !!why, run: () => queueTask({ type: 'make', id: th.id, recipe: r.id }) };
    }) });
  }
  if (P.seats && (!F || lit)) out.push({ label: F ? 'Sit by the fire' : `Sit by the ${name}`, run: () => queueTask({ type: 'sit', id: th.id }) });
  if (P.store) out.push({ label: `Open ${P.noun}`, note: storeNote(th), run: () => queueTask({ type: 'open', id: th.id }) }); // its squares at the top of your inventory (0.2.2)
  const inIt = P.bed && bedSleepers(th).length > 0; // a bed someone's asleep in (0.2.5), you or another
  if (P.bed && !(you.sleeping && you.bed === th.id)) {
    out.push({ label: `Sleep in ${P.noun}`, note: bedFull(th) ? "Someone's asleep in it" : betterWords(P.bed), disabled: bedFull(th), run: () => queueTask({ type: 'bed', id: th.id }) });
  }
  if (lit) { // a society's fire (0.1.5): putting it out ends the society, so only its leader can (the server checks too)
    const lead = you.soc && th.claim && th.claim.who === `s:${you.soc.id}` ? you.soc.members.find((x) => x.lead) : null, notLeader = lead && lead.id !== game.net.myId;
    out.push({ label: 'Put out fire', note: notLeader ? `Only ${lead.name} can put it out` : th.claim && claimMine(th) ? `Ends ${you.soc ? you.soc.name : 'your camp'}` : '', disabled: !!notLeader,
      run: () => queueTask({ type: 'tend', id: th.id, do: 'out' }) });
  }
  else { // once it's out: pack it into your inventory, or take it apart for what it's made of (only who built it; the server checks)
    const full = !!P.store && storedIn(th) > 0; // something in it: empty it first (0.2.2; the server says the same)
    const busy = inIt ? (you.sleeping && you.bed === th.id ? 'Get up first' : "Someone's asleep in it") : ''; // a bed (0.2.5)
    const no = full ? 'Empty it first' : busy || carryNo({ [P.item]: 1 }); // too heavy, or no square for it (0.2.1)
    out.push({ label: 'Pack up', disabled: !!no, note: no || (F && fuelLeft(th) > 0 ? 'Fuel left is lost' : 'Into your inventory'), run: () => queueTask({ type: 'unplace', id: th.id }) });
    out.push({ label: 'Take apart', disabled: full || !!busy, note: full ? 'Empty it first' : busy || takeApartNote(th), run: () => queueTask({ type: 'apart', id: th.id }) });
  }
  out.push({ label: 'Inspect', foot: true, run: () => showTag(fireState(th) || P.name, V(th.x, groundY(th.x, th.z) + 1.1, th.z), 2, 5) }, walkHere);
  return out;
}
// what taking it apart gives back: its recipe's parts, less what burns once a fire has been lit
function takeApartNote(th) {
  const P = PLACEABLES[th.kind], r = RECIPES.find((x) => x.makes[P.item]);
  if (!r) return '';
  const back = Object.entries(r.needs).filter(([k]) => !(th.burnt && P.fire && P.fire.fuels[k]));
  if (!back.length) return 'Nothing left to keep';
  return back.length === Object.keys(r.needs).length ? 'Get back its parts' : `Get back ${back.map(([k, n]) => countLabel(k, n).toLowerCase()).join(', ')}`;
}
/* ---------- stations: recipes that need a placed thing close by ----------
   A recipe with "near": "campfire" can only be made by a built one (a fire has to be lit), so cooking is just recipes.
   The server checks the same with a little more room (stationFor in server/src/placed.js). */
const STATION_REACH = 3; // metres from its edge
export function stationNear(kind) {
  const P = PLACEABLES[kind];
  if (!P || !player) return null;
  for (const th of placed.values()) {
    if (th.kind === kind && th.built && (!P.fire || isLit(th)) && !notMineAt(th.x, th.z) && Math.hypot(th.x - player.position.x, th.z - player.position.z) <= STATION_REACH + P.solid) return th;
  }
  return null;
}
Object.assign(TASK_KINDS, {
  // making a recipe here, like cooking on the fire: walk over, then make it
  make: {
    start(t) {
      const th = placed.get(t.id), r = RECIPES.find((x) => x.id === t.recipe);
      if (!th || !r) { nextTask(); return; }
      goNear(th, () => {
        const why = cantMake(r);
        if (why) { showTag(why === 'Not here' ? `The ${PLACEABLES[th.kind].name.toLowerCase()} has to be lit` : why, headTop(), 2); nextTask(); return; }
        face(th.x, th.z);
        make(r);
      });
    },
    name: (t, now) => { const r = RECIPES.find((x) => x.id === t.recipe), n = r ? recipeName(r).toLowerCase() : 'it'; return now ? `Making ${n}` : `Make ${n}`; },
    spot: placedSpot,
  },
});

/* ---------- farming (0.1.18): farm fields and what grows on them ----------
   A farm field is a placed thing dug with its tool (the stone hoe, on the tool bar), only in your own camp, with no
   building. Seeds planted on it grow by themselves (rules.js cropGrowth, the same on the server): a sprout, then a young
   bush that gets bigger, then a grown one, picked like its "like" source (a wild berry bush: holds 5, grow back, the
   knife picks 2). Flatten field (the hoe again) takes the field away, and whatever grew on it. The server decides
   (dig, flatten, plant and harvest in server/src/actions.js); the game shows it straight away and is put right if not. */
const cropOf = (th) => (th.crop && CROPS[th.crop.kind]) || null;
export const cropK = (th) => { const def = cropOf(th); return def ? cropGrowth(th.crop.at, def.growMs, Date.now()) : 0; }; // how grown, 0 to 1
// berries on a grown crop right now (picked ones grow back one by one, like a wild bush's: rules.js)
// A tree on a farm field (0.2.9, the apple tree): chopped, it's a stump till it grows back, its fruit growing back from
// then (rules.js cropTree, the same as the server). { stump, back, fruit }
function cropTreeNow(th) {
  const def = cropOf(th), src = def.like;
  return cropTree(th.crop.berries || [null, null], th.crop.stump || 0, def.tree ? def.tree.backMs : 0, bushHolds(src), src.regrowHours * 3600000, Date.now());
}
export const cropIsStump = (th) => { const def = cropOf(th); return !!(def && def.tree && th.crop.stump) && cropTreeNow(th).stump; };
// what's been picked, as it is now: [count, from] (a tree that grew back starts again from then)
function cropPickFrom(th) {
  const b = th.crop.berries || [null, null];
  if (!th.crop.stump) return b;
  const back = cropTreeNow(th).back;
  if (Date.now() < back) return b;
  th.crop.stump = 0;
  return b[1] == null || b[1] < back ? [0, back] : b;
}
export function cropBerriesNow(th) {
  const def = cropOf(th);
  if (!def || cropK(th) < 1) return 0;
  return cropTreeNow(th).fruit;
}
const cropGrownIn = (th) => timeLeft(th.crop.at + cropOf(th).growMs - Date.now()); // "5 h 20 min"
const stumpBackIn = (th) => timeLeft(cropTreeNow(th).back - Date.now()); // (a tree on a field, chopped)
// the next berry grows back in (a grown crop with none left)
function cropNextIn(th) {
  const src = cropOf(th).like, b = cropPickFrom({ crop: { ...th.crop } }); // (a copy: only working it out)
  return b[1] == null ? '1 min' : timeLeft(Math.max(60000, b[1] + growEvery(src) - Date.now()));
}
// what it is right now, for Inspect: "Berry bush sprout · grown in 18 h", "Berry bush · 3 berries"
export function fieldState(th) {
  const def = cropOf(th);
  if (!def) return 'Dug and ready for seeds';
  const stage = cropStage(cropK(th)), name = def.name, kind = Object.keys(def.like.harvest)[0];
  if (stage !== 'grown') return `${stage === 'sprout' ? `${name} sprout` : `Young ${name.toLowerCase()}`} · grown in ${cropGrownIn(th)}`;
  if (cropIsStump(th)) return `${name} stump · grows back in ${stumpBackIn(th)}`;
  const n = cropBerriesNow(th);
  return n ? `${name} · ${countLabel(kind, n).toLowerCase()}` : `${name} · next ${ITEMS[kind].name.toLowerCase()} in ${cropNextIn(th)}`;
}

// drawing a crop: built once per field (the same look every time, from its own random numbers), then shown as it grows
const keepMat = (c, o) => { const m = mat(c, o); m.userData.shared = true; return m; }; // shared by every field, never freed
const CROP_MATS = { leaves: BUSH_COLOURS.map((c) => keepMat(c)), stem: keepMat('#6f8f45'), berry: keepMat('#c4483a', { roughness: 0.5 }) };
const cropLeafGeo = new THREE.IcosahedronGeometry(1, 0), cropStemGeo = new THREE.CylinderGeometry(0.6, 1, 1, 5).translate(0, 0.5, 0), cropBerryGeo = new THREE.IcosahedronGeometry(0.065, 0);
const CROP_GROWN = 0.75; // a grown bush, a little smaller than a wild one so it stays on its field
function cropParts(th) {
  const g = th.view.userData.parts.crop, def = cropOf(th), out = { kind: th.crop.kind, sprout: new THREE.Group(), bush: new THREE.Group(), fruit: new THREE.Group(), berries: [] };
  g.clear();
  withOwnRand(9001 + th.id * 7919, () => {
    const stem = new THREE.Mesh(cropStemGeo, CROP_MATS.stem); // a sprout: a little stem with a few leaves
    stem.scale.set(0.02, 0.26, 0.02);
    out.sprout.add(stem);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rr(-0.3, 0.3), up = 0.09 + (i / 4) * 0.15;
      const leaf = new THREE.Mesh(cropLeafGeo, CROP_MATS.leaves[i % CROP_MATS.leaves.length]);
      leaf.scale.set(0.1, 0.022, 0.055);
      leaf.position.set(Math.cos(a) * 0.08, up, -Math.sin(a) * 0.08);
      leaf.rotation.set(0, a, 0.45); // out from the stem and a little up
      out.sprout.add(leaf);
    }
    // the bush: three blobs, like a wild berry bush. Since 0.2.2 (1 m fields; Luke worried smaller bushes would look
    // odd) they're the same size as before on average, just less spread out sideways, so the bush sits on its bed
    const blobs = [];
    for (let i = 0; i < 3; i++) {
      const r = rr(0.52, 0.64) * (i ? 0.85 : 1), ox = i ? rr(-0.17, 0.17) : 0, oz = i ? rr(-0.17, 0.17) : 0;
      const m = new THREE.Mesh(crownGeoB, pick(CROP_MATS.leaves));
      m.position.set(ox, r * 0.6, oz);
      m.scale.set(r, r * 0.8, r);
      m.rotation.y = rand() * 6;
      out.bush.add(m);
      blobs.push({ ox, oz, r, y: r * 0.6 });
    }
    for (let k = 0; k < bushHolds(def.like); k++) { // its berries, on the grown bush (the same size as a wild bush's)
      const b = blobs[k % blobs.length], a = rand() * Math.PI * 2, ph = rr(0.3, 1.15);
      const m = new THREE.Mesh(cropBerryGeo, CROP_MATS.berry);
      m.position.set((b.ox + Math.cos(a) * Math.sin(ph) * b.r * 0.97) * CROP_GROWN, (b.y + Math.cos(ph) * b.r * 0.78) * CROP_GROWN, (b.oz + Math.sin(a) * Math.sin(ph) * b.r * 0.97) * CROP_GROWN);
      m.rotation.y = rand() * 6;
      out.fruit.add(m);
      out.berries.push(m);
    }
  });
  g.add(out.sprout, out.bush, out.fruit);
  if (def.tree) { out.bush.visible = out.fruit.visible = false; g.add(...treeCropParts(th, out)); } // (an apple tree, 0.2.9: its own tree look)
  shadowsOn(g);
  return out;
}
// A tree on a field (0.2.9): a sprout, then a young tree getting bigger, then a full tree with its apples (the same size
// as a wild one: the squares round it are kept empty), or its stump once it's chopped. Built once per field.
const TREE_MATS = { bark: keepMat('#7a5c40'), leaves: ['#6f8f4f', '#7b9858', '#678a4b'].map((c) => keepMat(c)), apple: keepMat('#c8352a', { roughness: 0.45 }), stumpTop: keepMat('#cfb48a') };
const treeTrunkGeo = new THREE.CylinderGeometry(0.09, 0.15, 1, 6).translate(0, 0.5, 0), treeAppleGeo = new THREE.IcosahedronGeometry(0.1, 1);
const treeStumpGeo = new THREE.CylinderGeometry(0.36, 0.44, 0.42, 8), treeStumpTopGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.02, 8);
const TREE_SPOT_OFF = 0.02; // (the tree's spot sits beside the field's own, so each can be taken off by itself)
function treeCropParts(th, out) {
  out.tree = new THREE.Group(); out.stump = new THREE.Group(); out.apples = [];
  withOwnRand(7001 + th.id * 104729, () => {
    const h = rr(1.25, 1.55), bw = 1.05;
    const trunk = new THREE.Mesh(treeTrunkGeo, TREE_MATS.bark);
    trunk.scale.set(bw, h + 0.15, bw);
    out.tree.add(trunk);
    const leaves = pick(TREE_MATS.leaves), crowns = [];
    for (let i = 0; i < 2; i++) {
      const cs = rr(1.05, 1.3) * (i ? 0.8 : 1), ox = i ? rr(-0.45, 0.45) : rr(-0.12, 0.12), oz = i ? rr(-0.45, 0.45) : rr(-0.12, 0.12);
      const m = new THREE.Mesh(crownGeoB, leaves);
      m.position.set(ox, h + cs * 0.72 + (i ? cs * 0.55 : 0), oz);
      m.scale.set(cs * rr(0.95, 1.1), cs * rr(0.86, 1.05), cs * rr(0.95, 1.1));
      m.rotation.y = rand() * 6;
      out.tree.add(m);
      crowns.push(m);
    }
    const holds = bushHolds(cropOf(th).like);
    for (let k = 0; k < holds; k++) { // its apples, spread round the crown about its middle (the same as a wild apple tree's)
      const c = crowns[k % crowns.length], a = (k / holds + rr(-0.08, 0.08)) * Math.PI * 2, ph = rr(0.6, 1.4);
      const m = new THREE.Mesh(treeAppleGeo, TREE_MATS.apple);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(ph), Math.cos(ph), Math.sin(a) * Math.sin(ph));
      m.position.copy(dir.multiplyScalar(crownSurface(crownGeoB, dir) * 0.96).multiply(c.scale).applyEuler(c.rotation).add(c.position)); // (on its lumpy leaves)
      out.tree.add(m);
      out.apples.push(m);
    }
    const body = new THREE.Mesh(treeStumpGeo, TREE_MATS.bark), top = new THREE.Mesh(treeStumpTopGeo, TREE_MATS.stumpTop);
    body.scale.set(0.55, 0.8, 0.55); body.position.y = 0.16;
    top.scale.set(0.55, 1, 0.55); top.position.y = 0.335;
    out.stump.add(body, top);
  });
  return [out.tree, out.stump];
}
// a tree on a field is in the way like a wild one: its trunk (a tree's spot), or its stump; a sprout isn't (fields are walked over)
function setTreeSpot(th, want) {
  if ((th.treeSpot || null) === want) return;
  if (th.treeSpot) removeSpotNear(th.x + TREE_SPOT_OFF, th.z);
  if (want) addSpot(th.x + TREE_SPOT_OFF, th.z, want === 'tree' ? 1.3 : 0.45, want === 'tree' ? 1 : 0);
  th.treeSpot = want;
  clearCellsNear(th.x, th.z, 2);
}
// what's shown changes when it grows a step, or a berry is picked or grows back
const cropShownKey = (th) => { if (!cropOf(th)) return ''; const k = cropK(th); return `${th.crop.kind}|${Math.floor(k * 40)}|${k >= 1 ? cropBerriesNow(th) : 0}|${cropIsStump(th) ? 'stump' : ''}`; };
export function drawCrop(th) {
  const parts = th.view.userData.parts;
  if (!parts.crop) return;
  th.cropShown = cropShownKey(th);
  if (!cropOf(th)) { if (parts.cropParts) { parts.crop.clear(); parts.cropParts = null; } setTreeSpot(th, null); return; }
  if (!parts.cropParts || parts.cropParts.kind !== th.crop.kind) parts.cropParts = cropParts(th);
  const c = parts.cropParts, k = cropK(th), stage = cropStage(k);
  if (c.tree) { // a tree on the field (0.2.9)
    const stump = cropIsStump(th);
    c.sprout.visible = stage === 'sprout';
    c.sprout.scale.setScalar(0.75 + 1.2 * k);
    c.tree.visible = stage !== 'sprout' && !stump;
    c.tree.scale.setScalar(stage === 'grown' ? 1 : 0.2 + 0.6 * clamp01((k - 1 / 3) * 1.5));
    c.stump.visible = stump;
    const n = stage === 'grown' && !stump ? cropBerriesNow(th) : 0;
    c.apples.forEach((m, i) => { m.visible = i < n; });
    setTreeSpot(th, stump ? 'stump' : stage === 'sprout' ? null : 'tree');
    return;
  }
  c.sprout.visible = stage === 'sprout';
  c.sprout.scale.setScalar(0.75 + 1.2 * k); // (a third of the way: 1.15)
  c.bush.visible = stage !== 'sprout';
  c.bush.scale.setScalar(CROP_GROWN * (stage === 'grown' ? 1 : 0.3 + 0.6 * clamp01((k - 1 / 3) * 1.5)));
  c.fruit.visible = stage === 'grown';
  const n = stage === 'grown' ? cropBerriesNow(th) : 0;
  c.berries.forEach((m, i) => { m.visible = i < n; });
}

// the field taking shape while you dig it, till the server says it's there (or 4 s after, if it doesn't)
let digGhost = null;
function showDigGhost(t, k) {
  if (!digGhost) digGhost = { model: placingGhost(placedModelOf(t.kind).model), x: t.x, z: t.z, until: 0 };
  const f = rectOf(t.x, t.z, t.rot || 0, t.kind), m = digGhost.model;
  m.position.set(t.x, groundUnder(f).y, t.z);
  m.rotation.y = t.rot || 0;
  m.scale.y = 0.25 + 0.75 * k;
  m.traverse((o) => { if (o.isMesh) o.material.opacity = 0.3 + 0.6 * k; });
}
function dropDigGhost() {
  if (!digGhost) return;
  scene.remove(digGhost.model);
  disposeMaterials(digGhost.model);
  digGhost = null;
}
// knife on the tool bar and enough berries: a few at once (the server works it out the same way)
function cropPickCount(th) {
  const src = cropOf(th).like, kind = Object.keys(src.harvest)[0], have = cropBerriesNow(th);
  const many = src.tool && src.toolHarvest && hasTool(src.tool) ? src.toolHarvest[kind] || 1 : 1;
  return have >= many ? many : Math.min(have, 1);
}
Object.assign(TASK_KINDS, {
  // digging a farm field where you chose, with the hoe on your tool bar (the server says when it's there)
  dig: {
    start(t) {
      const P = PLACEABLES[t.kind];
      if (!P || !P.madeWith) { nextTask(); return; }
      if (!hasTool(P.madeWith)) { showTag(toolWhy(P.madeWith), headTop(), 2); nextTask(); return; }
      const why = cantPlaceAt(t.x, t.z, t.kind, t.rot || 0);
      if (why) { showTag(why, headTop(), 2); nextTask(); return; }
      approach(t.x, t.z, P.solid + 0.45, P.solid + 0.9, () => {
        const now = cantPlaceAt(t.x, t.z, t.kind, t.rot || 0); // (something may have been put there on the way)
        if (now) { showTag(now, headTop(), 2); nextTask(); return; }
        face(t.x, t.z);
        showTag(`${P.makeVerb}…`, headTop(), 2, P.makeSeconds * slowness() + 0.3);
        game.tagLabel.busy = true;
        startAction({ pose: 'chop', seconds: P.makeSeconds, tool: P.madeWith,
          tick: (k) => showDigGhost(t, k),
          cancel: dropDigGhost,
          end: () => {
            showDigGhost(t, 1);
            digGhost.until = Date.now() + 4000;
            spendEnergy('dig');
            showGain(`${P.name} dug`);
            sendNow({ t: 'dig', kind: t.kind, x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100, rot: Math.round((t.rot || 0) * 100) / 100 });
          } });
      });
    },
    name: (t, now) => { const P = PLACEABLES[t.kind]; return now ? (P ? P.makeVerb : 'Digging') : `Dig ${P ? P.name.toLowerCase() : 'here'}`; },
    spot: (t) => V(t.x, groundY(t.x, t.z) + 0.5, t.z),
  },
  // flattening it again: back to grass, and whatever grew on it is gone
  flatten: {
    start(t) {
      const th = placed.get(t.id), P = th && PLACEABLES[th.kind];
      if (!P || !P.madeWith) { nextTask(); return; }
      if (!hasTool(P.madeWith)) { showTag(toolWhy(P.madeWith), headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        if (!placed.has(th.id)) { nextTask(); return; }
        face(th.x, th.z);
        showTag('Flattening the field…', headTop(), 2, P.flattenSeconds * slowness() + 0.3);
        game.tagLabel.busy = true;
        startAction({ pose: 'chop', seconds: P.flattenSeconds, tool: P.madeWith,
          tick: (k) => { th.view.scale.y = 1 - 0.6 * k; },
          cancel: () => { th.view.scale.y = 1; },
          end: () => { th.flatAt = Date.now(); spendEnergy('dig'); sendNow({ t: 'flatten', id: th.id }); } });
      });
    },
    name: (t, now) => (now ? 'Flattening the field' : 'Flatten field'),
    spot: placedSpot,
  },
  // planting seeds on an empty field: it starts growing straight away
  plant: {
    start(t) {
      const th = placed.get(t.id), def = th && Object.values(CROPS).find((c) => c.seed === t.seed && c.on === th.kind);
      if (!def) { nextTask(); return; }
      const no = () => (th.crop ? 'Something is already growing here' : !you.carry[t.seed] ? 'You have no seeds to plant'
        : def.room && roomClash([...placed.values()], th, th.kind, PLACEABLES, CROPS, def.room) ? 'It needs the squares round it empty' : ''); // (a tree, 0.2.9)
      if (no()) { showTag(no(), headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        if (!placed.has(th.id) || no()) { if (placed.has(th.id)) showTag(no(), headTop(), 2); nextTask(); return; }
        face(th.x, th.z);
        const what = ITEMS[t.seed].plural.toLowerCase();
        showTag(`Planting ${what}…`, headTop(), 2, def.plantSeconds * slowness() + 0.3);
        game.tagLabel.busy = true;
        startAction({ pose: 'kneel', seconds: def.plantSeconds, end: () => {
          if (!placed.has(th.id) || no()) return;
          takeFromCarry(t.seed, 1);
          th.crop = { kind: def.id, at: Date.now(), berries: [null, null], stump: 0 };
          drawCrop(th);
          spendEnergy('plant');
          showGain(`${ITEMS[t.seed].plural} planted`);
          drawHeld(); drawCarry();
          sendNow({ t: 'plant', id: th.id, seed: t.seed });
        } });
      });
    },
    name: (t, now) => { const n = ITEMS[t.seed] ? ITEMS[t.seed].plural.toLowerCase() : 'seeds'; return now ? `Planting ${n}` : `Plant ${n}`; },
    spot: placedSpot,
  },
  // picking a grown crop, the same as a wild bush: one at a time, or a few with the knife on your tool bar
  harvest: {
    start(t) {
      const th = placed.get(t.id), def = th && cropOf(th);
      if (!def) { nextTask(); return; }
      const src = def.like, kind = Object.keys(src.harvest)[0];
      const no = () => (cropK(th) < 1 ? 'Not grown yet' : cropIsStump(th) ? "It's a stump, growing back" : cropBerriesNow(th) < 1 ? `Next ${ITEMS[kind].name.toLowerCase()} in ${cropNextIn(th)}` : carryNo({ [kind]: 1 }));
      if (no()) { showTag(no(), headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        if (!placed.has(th.id) || !cropOf(th) || no()) { if (cropOf(th)) showTag(no(), headTop(), 2); nextTask(); return; }
        face(th.x, th.z);
        showTag(`${src.verb}…`, headTop(), 2, src.seconds * slowness() + 0.3);
        game.tagLabel.busy = true;
        startAction({ pose: src.pose, seconds: src.seconds, tool: cropPickCount(th) > 1 ? src.tool : null, end: () => {
          if (!placed.has(th.id) || !cropOf(th) || no()) return;
          const n = cropPickCount(th);
          const full = carryNo({ [kind]: n });
          if (full) { showTag(full, headTop(), 2); return; } // (the same as a wild bush)
          addToCarry(kind, n);
          let b = cropPickFrom(th); // (a tree that grew back: its fruit counts from then, 0.2.9)
          for (let i = 0; i < n; i++) b = berryPicked(b[0], b[1], bushHolds(src), src.regrowHours * 3600000, Date.now()); // (rules.js)
          th.crop.berries = b;
          drawCrop(th);
          spendEnergy('harvest');
          drawHeld(); drawCarry();
          showGain(`+${countLabel(kind, n).toLowerCase()}`);
          sendNow({ t: 'harvest', id: th.id });
        } });
      });
    },
    name: (t, now) => { const def = cropOf(placed.get(t.id) || {}), src = def ? def.like : null; return now ? (src ? src.verb : 'Picking') : (src && src.action) || 'Pick'; },
    spot: placedSpot,
  },
  // a tree on a field (0.2.9): chop it down with the axe (its apples fall, the stump grows back), or dig up its stump
  treeCrop: {
    start(t) {
      const th = placed.get(t.id), def = th && cropOf(th), rule = CHOPPING[t.do === 'dig' ? 'stump' : 'tree'] || {};
      if (!def || !def.tree) { nextTask(); return; }
      if (CHOPPING.tool && !hasTool(CHOPPING.tool)) { showTag(toolWhy(CHOPPING.tool), headTop(), 2); nextTask(); return; }
      const no = () => (!placed.has(th.id) || !cropOf(th) ? 'gone' : t.do === 'dig' ? (cropIsStump(th) ? '' : 'Chop it down first')
        : cropK(th) < 1 ? 'Not grown yet' : cropIsStump(th) ? "It's a stump, growing back" : '');
      if (no()) { if (no() !== 'gone') showTag(no(), headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        if (no()) { if (no() !== 'gone') showTag(no(), headTop(), 2); nextTask(); return; }
        face(th.x, th.z);
        showTag(`${TASK_KINDS.treeCrop.name(t, true)}…`, headTop(), 2, (rule.seconds || 10) * slowness() + 0.3);
        game.tagLabel.busy = true;
        startAction({ pose: 'chop', seconds: rule.seconds || 10, tool: CHOPPING.tool, end: () => { spendEnergy('chop'); sendNow({ t: 'treeCrop', id: th.id, do: t.do }); } });
      });
    },
    name: (t, now) => (t.do === 'dig' ? (now ? 'Digging up a stump' : 'Dig up stump') : (now ? 'Chopping a tree' : 'Chop tree')),
    spot: placedSpot,
  },
});
// a farm field's tap menu: plant seeds, how long it has to grow, or pick what grew; flatten it; Inspect and Walk here
export function fieldActions(th) {
  const P = PLACEABLES[th.kind], def = cropOf(th), out = [];
  if (!def) { // seeds that grow here: one Plant for each kind you carry (or one that says you have none)
    const all = Object.values(CROPS).filter((c) => c.on === th.kind), mine = all.filter((c) => you.carry[c.seed] > 0);
    for (const c of mine) {
      const cramped = c.room && roomClash([...placed.values()], th, th.kind, PLACEABLES, CROPS, c.room); // a tree needs the squares round it empty (0.2.9)
      out.push({ label: `Plant ${ITEMS[c.seed].plural.toLowerCase()}`, note: cramped ? 'Needs the squares round it empty' : `${c.plantSeconds} s`, disabled: !!cramped,
        run: () => queueTask({ type: 'plant', id: th.id, seed: c.seed }) });
    }
    if (!mine.length && all.length) out.push({ label: all.length === 1 ? `Plant ${ITEMS[all[0].seed].plural.toLowerCase()}` : 'Plant seeds', note: 'You have no seeds', disabled: true, run: () => {} });
  } else if (cropK(th) < 1) out.push({ label: `Grown in ${cropGrownIn(th)}`, disabled: true, run: () => {} });
  else if (def.tree && cropIsStump(th)) { // a tree on it, chopped down (0.2.9): dig up its stump (your camp only), or let it grow back
    const c = claimAt(th.x, th.z), mine = !!c && claimMine(c), axe = !CHOPPING.tool || hasTool(CHOPPING.tool);
    out.push({ label: 'Dig up stump', note: !mine ? 'Only in your camp' : axe ? `${(CHOPPING.stump || {}).seconds || 10} s` : toolNeed(CHOPPING.tool), disabled: !mine || !axe,
      run: () => queueTask({ type: 'treeCrop', id: th.id, do: 'dig' }) },
    { label: `Grows back in ${stumpBackIn(th)}`, disabled: true, run: () => {} });
  } else {
    const src = def.like, kind = Object.keys(src.harvest)[0], n = cropBerriesNow(th);
    const queued = allTasks().filter((q) => q.type === 'harvest' && q.id === th.id).length;
    out.push({ label: src.action || `Pick ${ITEMS[kind].plural.toLowerCase()}`, note: n ? `${n} left` : `Next in ${cropNextIn(th)}`, disabled: n - queued < 1,
      run: () => queueTask({ type: 'harvest', id: th.id }) });
    if (def.tree) { const axe = !CHOPPING.tool || hasTool(CHOPPING.tool); out.push({ label: 'Chop tree', note: axe ? `${(CHOPPING.tree || {}).seconds || 10} s` : toolNeed(CHOPPING.tool), disabled: !axe, run: () => queueTask({ type: 'treeCrop', id: th.id, do: 'chop' }) }); }
  }
  const has = hasTool(P.madeWith);
  out.push({ label: 'Flatten field', note: !has ? toolNeed(P.madeWith) : def ? `The ${def.name.toLowerCase()} is lost` : `${P.flattenSeconds} s`, disabled: !has,
    run: () => queueTask({ type: 'flatten', id: th.id }) });
  out.push({ label: 'Inspect', foot: true, run: () => showTag(fieldState(th), V(th.x, groundY(th.x, th.z) + 1.1, th.z), 2, 5) },
    { label: 'Walk here', foot: true, run: () => walkFirst(P.walkOver ? V(th.x, 0, th.z) : V(th.x + P.solid + 0.8, 0, th.z)) }); // (onto it: it's walked over)
  return out;
}
// Dig farm field, on the ground's tap menu (input.js): carrying a hoe, in your own camp. Outside your camp it isn't
// there at all (Luke, 0.2.6); in your camp with the hoe only in your inventory it's greyed out (Equip your stone hoe)
export function digActions(at) {
  const out = [];
  for (const P of Object.values(PLACEABLES)) {
    if (!P.madeWith || !(you.carry[P.madeWith] > 0)) continue;
    const c = P.inCamp ? claimAt(at.x, at.z) : null;
    if (P.inCamp && !(c && claimMine(c))) continue;
    const why = !hasTool(P.madeWith) ? toolNeed(P.madeWith) : '';
    out.push({ label: `Dig ${P.name.toLowerCase()}`, note: why || `${P.makeSeconds} s`, disabled: !!why, run: () => startDigging(P.kind, at) });
  }
  return out;
}

/* ---------- claims (0.3.0): your first lit campfire claims the land round it while it burns. Since 0.1.5 your claim is
   your society: lighting your first fire starts both and the fire going out ends both (society.js) ----------
   The server decides (server/src/claims.js) and says whose claim a fire is (th.claim: { who, name }); a claim only
   counts while its fire is lit. Inside someone else's claim you can only walk through: the tap menus say so
   (menuActions in input.js), placing there is refused, and autopilot leaves their things alone. */
const CLAIMS = { radius: 10, spawnRadius: 16, placeable: 'campfire', ringShowsWithin: 25, ...(DATA.claims || {}) };
export const claimOn = (th) => !!th.claim && isLit(th);
// yours to use: your society's claim ('s:<id>', society.js), or one from before 0.1.5 (your own id)
export const claimMine = (th) => !!th.claim && (th.claim.who === game.net.myId || (!!you.soc && th.claim.who === `s:${you.soc.id}`));
// what a claim is called: yours, or by its society's name ("Luke's camp", "Rivers"). Players see a claim as a camp (0.1.6)
const claimName = (th) => (claimMine(th) ? 'Your camp' : th.claim.name);
export const claimAt = (x, z) => { for (const th of placed.values()) if (claimOn(th) && Math.hypot(th.x - x, th.z - z) <= CLAIMS.radius) return th; return null; };
// someone else's claim at x, z (the admin can do anything anywhere)
export const notMineAt = (x, z) => { const c = claimAt(x, z); return c && !claimMine(c) ? c : null; };
// placing a campfire: would lighting it there claim the land? { ok, text } (the server has the final say)
export function claimHere(x, z) {
  const soc = you.soc; // one claim each: your society's (0.1.5)
  if (soc) return { ok: false, text: soc.lead ? 'You have a camp, so this is just a fire' : `You're in ${soc.name}, so this is just a fire` };
  const all = [...placed.values()].filter(claimOn);
  const no = claimProblem(x, z, { radius: CLAIMS.radius, spawnRadius: CLAIMS.spawnRadius, pond: POND, hasClaim: all.some(claimMine),
    claims: all.map((th) => ({ x: th.x, z: th.z, name: th.claim.name })) }); // rules.js, the same on the server
  if (!no) return { ok: true, text: 'Light it to start your camp here' };
  return { ok: false, text: no.why === 'has' ? 'You have a camp, so this is just a fire' : no.why === 'pond' ? 'Too close to the pond to start your camp' : `Too close to ${no.name} to start your own` };
}
// a soft ring on the ground at a claim's edge, following the hills
const ringMats = { mine: new THREE.MeshBasicMaterial({ color: '#9fd88a', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  theirs: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
  maybe: new THREE.MeshBasicMaterial({ color: '#9fd88a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  no: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }) };
for (const m of Object.values(ringMats)) m.userData.shared = true;
function claimRingMesh(x, z, material) {
  const n = 120, w = 0.12, R = CLAIMS.radius, pos = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const r of [R - w, R]) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; pos.push(px, groundY(px, pz) + 0.06, pz); }
  }
  const idx = [];
  for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return mesh;
}
export function drawClaimRing(th) {
  const want = claimOn(th) ? (claimMine(th) ? 'mine' : 'theirs') : null;
  if (th.ring && th.ring.userData.kind === want && th.ring.userData.x === th.x && th.ring.userData.z === th.z) return;
  if (th.ring) { scene.remove(th.ring); th.ring.geometry.dispose(); th.ring = null; }
  if (!want) return;
  th.ring = claimRingMesh(th.x, th.z, ringMats[want]);
  Object.assign(th.ring.userData, { kind: want, x: th.x, z: th.z });
}
let placeClaim = null;
function showPlaceClaim(at, claim) {
  if (placeClaim) { scene.remove(placeClaim); placeClaim.geometry.dispose(); placeClaim = null; }
  if (at && claim) placeClaim = claimRingMesh(at[0], at[1], claim.ok ? ringMats.maybe : ringMats.no);
}
// every half second: rings near you show, fires that went out lose theirs, and walking into a claim says whose it is
let claimCheckAt = 0, inClaim = null;
export function updateClaims(now) {
  if (now - claimCheckAt < 500 || !player) return;
  claimCheckAt = now;
  for (const th of placed.values()) {
    drawClaimRing(th);
    if (th.ring) th.ring.visible = Math.hypot(th.x - player.position.x, th.z - player.position.z) <= CLAIMS.radius + CLAIMS.ringShowsWithin;
  }
  const c = claimAt(player.position.x, player.position.z), id = c ? c.id : null;
  if (id !== inClaim) { inClaim = id; if (c) showTag(claimName(c), headTop(), 2.5); }
}
