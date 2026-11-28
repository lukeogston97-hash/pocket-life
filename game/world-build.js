/* ---------- build everything collected above ---------- */
import * as THREE from 'three';
import { game, share } from './links.js';
import { berriesGrown, berryPicked, stumpBackMs } from './rules.js';
import { DATA, hash, mat, rr, scene, withOwnRand } from './core.js';
import { CLEAR, flatReach, groundY, landAsMade, pondShape, squareDist, WALK_LIMIT } from './land.js';
import {
  addSpot, berries, berryBushes, buildDetail, buildSet, cattails, drawnTogether, far, IM, interactive, near, oldStumps,
  pads, reeds, refillDetail, removeSpotNear, rocks, takeSpot, trees, tufts, updateLod, WALK_THROUGH, wild, wildBushes,
} from './nature.js';
import { plants, setPlantCleared } from './plants.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  get detailAt() { return detailAt; }, set detailAt(v) { detailAt = v; },
});

export const woodMat = mat('#8a6847');
for (const m of [reeds, cattails, pads, berries]) {
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
/* berry bushes: you pick one berry at a time, and picked berries grow back one by one (hidden ones are shrunk to nothing) */
const berryMatrices = berries.instanceMatrix.array.slice();
const NO_BERRY = new THREE.Matrix4().makeScale(0, 0, 0);
export const bushHolds = (src) => Math.max(1, Math.min(15, src.holds || 5)); // how many berries a full bush has
export const growEvery = (src) => (src.regrowHours * 3600000) / bushHolds(src); // how long one berry takes to grow back
// how many berries are on a bush right now (picked ones come back over time)
// (the maths is berriesGrown and berryPicked in rules.js, the same on the server)
export function berriesOn(b) {
  const src = game.SOURCES[b.userData.source];
  if (!src || !game.harvests(src)) return 0;
  return berriesGrown(b.userData.count, b.userData.growFrom, bushHolds(src), src.regrowHours * 3600000, Date.now());
}
export function pickBerry(b) {
  const src = game.SOURCES[b.userData.source];
  [b.userData.count, b.userData.growFrom] = berryPicked(b.userData.count, b.userData.growFrom, bushHolds(src), src.regrowHours * 3600000, Date.now());
}
export const ripe = (b) => berriesOn(b) >= 1;
export function readyIn(b) {
  const src = game.SOURCES[b.userData.source];
  const mins = Math.max(1, Math.ceil((b.userData.growFrom + growEvery(src) - Date.now()) / 60000));
  return mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`;
}
export function drawBerries(b) {
  const { start, n } = b.userData.berries;
  const src = game.SOURCES[b.userData.source];
  const shown = b.userData.removed || (b.userData.cleared && !game.freshLook) ? 0 : game.freshLook ? n : Math.min(n, src && game.harvests(src) ? berriesOn(b) : n);
  if (b.userData.shown === shown) return;
  b.userData.shown = shown;
  const a = berries.instanceMatrix.array;
  for (let k = 0; k < n; k++) {
    const o = (start + k) * 16;
    if (k < shown) a.set(berryMatrices.subarray(o, o + 16), o);
    else NO_BERRY.toArray(a, o);
  }
  berries.instanceMatrix.needsUpdate = true;
}
for (const set of [...Object.values(far), drawnTogether.bushes, ...drawnTogether.rocks]) buildSet(set);
for (const set of [...Object.values(near), wild.bush, ...wild.boulders, wild.rock, wild.stump, wild.stumpTop, wild.log, wild.logEnd]) {
  interactive.push(...buildSet(set));
}
for (const t of [...trees, ...oldStumps, ...rocks, ...wildBushes]) t.parts = t.parts.map(([m, key, idx]) => ({ ...(m.byKey.get(key) || {}), idx }));
for (const b of berryBushes) b.userData.parts = (b.userData.parts || []).map(([m, key, idx]) => ({ ...(m.byKey.get(key) || {}), idx }));
// which tree or old stump a tapped copy belongs to (the drawn mesh and its copy number)
export const copyOwner = new Map();
trees.forEach((t, i) => { for (const p of t.parts) for (const mesh of [p.full, p.simple]) if (mesh) copyOwner.set(`${mesh.uuid}:${p.idx}`, { kind: 'tree', i }); });
oldStumps.forEach((t, i) => { for (const p of t.parts) if (p.full) copyOwner.set(`${p.full.uuid}:${p.idx}`, { kind: 'oldStump', i }); });
rocks.forEach((t, i) => { for (const p of t.parts) if (p.full) copyOwner.set(`${p.full.uuid}:${p.idx}`, { kind: 'rock', i }); });
wildBushes.forEach((t, i) => { for (const p of t.parts) if (p.full) copyOwner.set(`${p.full.uuid}:${p.idx}`, { kind: 'shrub', i }); }); // (dug up in a camp, 0.2.9)
trees.forEach((t, i) => { t.i = i; });
// a moved thing (admin): its laid-out copy, shifted by t.off
// (and lifted with the ground under it, where that was levelled: t.lift, setLift below)
const shifted = (t, m4) => (t.off || t.lift ? new THREE.Matrix4().makeTranslation((t.off || [0])[0], ((t.off || [0, 0])[1]) + (t.lift || 0), (t.off || [0, 0, 0])[2]).multiply(m4) : m4);
// remember each drawn copy as it was laid out (once, before it's hidden or moved)
function keepParts(t) {
  for (const p of t.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    p.saved = p.saved || {};
    if (!p.saved[mesh.uuid]) { const m4 = new THREE.Matrix4(); mesh.getMatrixAt(p.idx, m4); p.saved[mesh.uuid] = m4; }
  }
}
// hide (or show again) the drawn copies a tree or stump is made of. A young tree (0.2.9) is drawn smaller, growing up
// round the bottom of its trunk
export function showParts(t, show) {
  keepParts(t);
  const k = show && t.state === 'young' && !game.freshLook ? youngSize(t) : 1;
  let grow = null;
  if (k < 1) {
    const base = new THREE.Vector3().setFromMatrixPosition(shifted(t, Object.values(t.parts[0].saved)[0])); // (the trunk starts at the ground)
    grow = new THREE.Matrix4().makeTranslation(base.x, base.y, base.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-base.x, -base.y, -base.z));
  }
  t.drawnSize = show ? k : 0;
  for (const p of t.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    if (!show) mesh.setMatrixAt(p.idx, NO_TREE);
    else if (p.saved[mesh.uuid]) mesh.setMatrixAt(p.idx, grow ? grow.clone().multiply(shifted(t, p.saved[mesh.uuid])) : shifted(t, p.saved[mesh.uuid]));
    mesh.instanceMatrix.needsUpdate = true;
    if (t.off) mesh.computeBoundingSphere(); // so it isn't skipped when its old spot is off screen
  }
}
// an old stump dug out: gone for good
export function removeOldStump(i) {
  const t = oldStumps[i];
  if (!t || t.gone) return;
  t.gone = true;
  showParts(t, false);
  if (t.proxy) { scene.remove(t.proxy); const j = interactive.indexOf(t.proxy); if (j >= 0) interactive.splice(j, 1); }
  removeSpotNear(t.x, t.z);
  game.clearCellsNear(t.x, t.z, 2);
}

/* ---------- chopping trees down (0.1.2): a tree becomes a stump, then grows back, unless the stump is removed ---------- */
export const CHOP = DATA.chopping || {};
const NO_TREE = new THREE.Matrix4().makeScale(0, 0, 0);
const stumpMat = mat('#7a5c40'), stumpTopMat = mat('#cfb48a');
export function setTreeState(i, state, since) {
  const t = trees[i];
  if (t && (state === 'stump' || state === 'young')) t.since = since || t.since || Date.now(); // when it was chopped, or came back young (it grows up regrowDays after: stumpGrowsIn)
  if (!t || t.state === state) { if (t && state === 'young') showParts(t, true); return; }
  const was = t.state, standing = state === 'tree' || state === 'young';
  t.state = state;
  showParts(t, standing || game.freshLook);
  if (t.stump) { scene.remove(t.stump); const j = interactive.indexOf(t.stump); if (j >= 0) interactive.splice(j, 1); t.stump = null; }
  if (state === 'stump') { // a fresh stump where the tree was
    const g = new THREE.Group();
    const k = Math.max(0.6, Math.min(1.3, t.s));
    const body = new THREE.Mesh(wild.stump.geo, stumpMat);
    body.scale.set(0.55 * k, 0.8, 0.55 * k);
    body.position.y = 0.16;
    const top = new THREE.Mesh(wild.stumpTop.geo, stumpTopMat);
    top.scale.set(0.55 * k, 1, 0.55 * k);
    top.position.y = 0.335;
    g.add(body, top);
    g.position.set(t.x, groundY(t.x, t.z) - 0.05, t.z);
    g.userData.label = 'Tree stump';
    g.userData.stump = i;
    g.visible = !game.freshLook;
    game.shadowsOn(g);
    scene.add(g);
    interactive.push(g);
    t.stump = g;
  }
  if (state === 'gone' || (was === 'gone' && standing)) game.clearCellsNear(t.x, t.z, 2.5);
  if (state === 'gone') removeSpotNear(t.x, t.z);
  else if (was === 'gone') addSpot(t.x, t.z, t.s * (t.pine ? 1.3 : 1.35), true); // the wild grew it back (0.2.9): in the way again
  if (APPLES.has(i)) drawApples(i);
}
// how big a young tree is drawn: a sapling growing into a full tree by the time a stump would have grown back
function youngSize(t) {
  const back = stumpBackMs(CHOP.regrowDays, t.i, t.since);
  return Math.max(0.3, Math.min(1, 0.3 + 0.7 * (Date.now() - (t.since || Date.now())) / Math.max(1, back)));
}
// how long until a stump grows back into a tree, like "2 d 5 h" or "40 min" (the same as a fire's fuel)
export const stumpGrowsIn = (i) => { const t = trees[i]; return growsBackIn(t.since, stumpBackMs(CHOP.regrowDays, i, t.since) / 86400000); }; // (each stump its own time, rules.js; a young tree grows up in the same)
export function growsBackIn(since, days) {
  const mins = Math.max(1, Math.ceil(((since || Date.now()) + days * 86400000 - Date.now()) / 60000));
  if (mins < 90) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return `${d} d${rh ? ` ${rh} h` : ''}`;
}
/* ---------- mining rocks and boulders (0.2.9): a rock breaks and is gone (one comes back now and then), a boulder stays and can be mined again ---------- */
export const MINE = DATA.mining || {};
const MINED_SQUASH = new THREE.Matrix4().makeScale(0.92, 0.6, 0.92); // a mined boulder looks worn down
export function drawRock(r) {
  const look = game.freshLook ? 'whole' : r.state;
  for (const p of r.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    p.saved = p.saved || {};
    if (!p.saved[mesh.uuid]) { const m4 = new THREE.Matrix4(); mesh.getMatrixAt(p.idx, m4); p.saved[mesh.uuid] = m4; }
    const m4 = look === 'gone' ? NO_TREE : shifted(r, look === 'mined' ? p.saved[mesh.uuid].clone().multiply(MINED_SQUASH) : p.saved[mesh.uuid]);
    mesh.setMatrixAt(p.idx, m4);
    mesh.instanceMatrix.needsUpdate = true;
    if (r.off) mesh.computeBoundingSphere();
  }
}
export function setRockState(i, state, since) {
  const r = rocks[i];
  if (!r) return;
  if (state === 'mined') r.since = since || r.since || Date.now();
  if (r.state === state) return;
  const was = r.state;
  r.state = state;
  drawRock(r);
  if (state === 'gone' || was === 'gone') {
    if (state === 'gone') removeSpotNear(r.x, r.z); else addSpot(r.x, r.z, r.r);
    if (r.proxy) { const j = interactive.indexOf(r.proxy); if (state === 'gone' && j >= 0) interactive.splice(j, 1); if (state !== 'gone' && j < 0) interactive.push(r.proxy); }
    game.clearCellsNear(r.x, r.z, r.r + 1);
  }
}
// the tree nearest a tap (on its trunk or crown)
export function treeNear(p, maxD = 3) {
  let best = -1, bd = maxD;
  trees.forEach((t, i) => { if (t.state !== 'tree') return; const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
// pebbles and flowers are still laid out (so nothing else moves) but not drawn:
// the pebbles looked like stones you could pick up, and the coloured flowers were distracting
export const DETAILS = [tufts];
DETAILS.forEach(buildDetail);
// grass, flowers and pebbles are drawn round where the camera looks, refilled once that has moved a few metres
let detailAt = null;
export function updateDetails(x, z) {
  if (detailAt && Math.hypot(x - detailAt.x, z - detailAt.z) < 4) return;
  detailAt = { x, z };
  for (const d of DETAILS) refillDetail(d, x, z);
  updateLod(x, z);
}


/* =====================================================================
   Pocket Life
   The game's content lives in game-data.json beside this page:
   settings, items (with weights), recipes, needs, things to use, day
   and night, character looks and body shapes. Adding things later means editing that small file, not this
   code. Everything in the world is also kept as plain data (world.items
   and you), ready to be saved or sent to a server later.
   ===================================================================== */

/* ---------- the admin moving and removing things laid out with the world (trees, rocks, berry bushes) ----------
   The layout itself never changes: a moved thing is drawn shifted from where it was laid out (world.moved on the
   server), and a removed one is hidden (trees and rocks as gone, berry bushes in world.removed). */
function movedThing(what, i) { return what === 'tree' ? trees[i] : what === 'rock' ? rocks[i] : what === 'bush' ? berryBushes[i] : null; }
export function moveLayoutThing(what, i, x, z) {
  const t = movedThing(what, i);
  if (!t || !Number.isFinite(x) || !Number.isFinite(z)) return;
  if (what === 'bush') { moveBush(t, x, z); return; }
  if (!t.from) { keepParts(t); t.from = [t.x, t.z]; t.spot = takeSpot(t.x, t.z) || [what === 'rock' ? t.r : 0.5, what === 'tree']; } // where it was laid out
  else removeSpotNear(t.x, t.z);
  game.clearCellsNear(t.x, t.z, t.spot[0] + 1);
  const was = [t.x, t.z];
  t.off = [x - t.from[0], groundY(x, z, landAsMade) - groundY(t.from[0], t.from[1], landAsMade), z - t.from[1]]; // (the ground as made: setLift adds any levelling)
  t.x = x; t.z = z;
  t.lift = groundMovedUnder(x, z, what === 'tree' ? TRUNK_R : t.r); // (on levelled ground)
  if (t.lift) LIFTED.add(t); else LIFTED.delete(t);
  if (what === 'tree') {
    showParts(t, t.state === 'tree' || t.state === 'young' || game.freshLook);
    if (t.stump) t.stump.position.set(x, groundY(x, z) - 0.05, z);
    if (APPLES.has(i)) drawApples(i);
  } else {
    drawRock(t);
    if (t.proxy) t.proxy.position.set(x, t.proxy.position.y - groundY(was[0], was[1]) + groundY(x, z), z); // (the tap target: roughly on the ground)
  }
  if (t.state !== 'gone') addSpot(x, z, t.spot[0], t.spot[1]);
  game.clearCellsNear(x, z, t.spot[0] + 1);
}
// a berry bush as it was laid out: its place, the ground under it then, and its drawn copies and berries (once)
function bushBase(b) {
  const u = b.userData;
  if (u.from) return;
  keepParts({ parts: u.parts || [] });
  u.from = [b.position.x, b.position.z, groundY(b.position.x, b.position.z, landAsMade)];
  const { start, n } = u.berries;
  u.berryBase = berryMatrices.slice(start * 16, (start + n) * 16);
}
function moveBush(b, x, z) {
  const u = b.userData;
  bushBase(b);
  removeSpotNear(b.position.x, b.position.z);
  game.clearCellsNear(b.position.x, b.position.z, u.r + 1);
  u.off = [x - u.from[0], groundY(x, z, landAsMade) - u.from[2], z - u.from[1]];
  u.lift = groundMovedUnder(x, z, u.r); // (on levelled ground)
  if (u.lift) LIFTED.add(b); else LIFTED.delete(b);
  drawBushAt(b);
  if (!u.removed) addSpot(x, z, u.r, WALK_THROUGH);
  game.clearCellsNear(x, z, u.r + 1);
}
// a berry bush drawn where it is now: moved by the admin (u.off) and lifted with levelled ground (u.lift)
function drawBushAt(b) {
  const u = b.userData, off = u.off || [0, 0, 0], T = new THREE.Matrix4().makeTranslation(off[0], off[1] + (u.lift || 0), off[2]);
  for (const p of u.parts || []) for (const mesh of [p.full, p.simple]) {
    if (!mesh || !p.saved[mesh.uuid]) continue;
    mesh.setMatrixAt(p.idx, u.removed || (u.cleared && !game.freshLook) ? NO_TREE : T.clone().multiply(p.saved[mesh.uuid]));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  const { start, n } = u.berries, m4 = new THREE.Matrix4();
  for (let k = 0; k < n; k++) { m4.fromArray(u.berryBase, k * 16); T.clone().multiply(m4).toArray(berryMatrices, (start + k) * 16); }
  berries.computeBoundingSphere();
  u.shown = -1;
  drawBerries(b);
  b.position.set(u.from[0] + off[0], u.from[2] + off[1] + (u.lift || 0), u.from[1] + off[2]);
}

/* ---------- things on levelled ground (0.1.18 test 2, Luke: "it leaves floating rocks") ----------
   When the ground under placed things is levelled (placeables.js levelPlaced), the trees, rocks and bushes near them go
   up or down with it, by the least the ground under them moved, so no edge is left in the air (where it rose more they
   just sit a little deeper). Only how they're drawn changes; the layout never moves. */
export const LIFTED = new Set(); // everything lifted now (so it can be put back when what levelled it is gone)
const TRUNK_R = 0.35;
// how far the ground under a thing has moved since the world was made, at its least (x, z: its middle, r: how far out it reaches)
export function groundMovedUnder(x, z, r) {
  let least = Infinity;
  for (let k = 0; k <= 16; k++) {
    const a = (k / 8) * Math.PI * 2, d = k === 16 ? 0 : k < 8 ? r : r * 0.55, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    least = Math.min(least, groundY(px, pz) - groundY(px, pz, landAsMade));
  }
  return Math.abs(least) < 0.001 ? 0 : least;
}
function setLift(kind, t, lift) {
  const u = kind === 'bush' ? t.userData : t, was = u.lift || 0;
  if (Math.abs(was - lift) < 0.001) return;
  if (kind === 'bush') { bushBase(t); u.lift = lift; drawBushAt(t); }
  else {
    keepParts(t);
    t.lift = lift;
    if (kind === 'tree') {
      if (t.state === 'tree' || t.state === 'young' || game.freshLook) showParts(t, true);
      if (t.stump) t.stump.position.y = groundY(t.x, t.z) - 0.05;
      if (APPLES.has(t.i)) drawApples(t.i);
    } else if (kind === 'rock') {
      drawRock(t);
      if (t.proxy) t.proxy.position.y += lift - was;
    } else {
      drawShrub(t); // a bush with no berries
    }
  }
  if (lift) LIFTED.add(t); else LIFTED.delete(t);
}
// after levelling: everything near these squares onto the ground as it is now, and anything lifted before back down
export function liftNear(rects) {
  const near = (x, z, r) => rects.some((f) => Math.abs(x - f.x) < flatReach(f) + r + 2.5 && Math.abs(z - f.z) < flatReach(f) + r + 2.5); // (+ a land triangle across)
  const each = (kind, list, at, r) => {
    for (const t of list) {
      const [x, z] = at(t), rr2 = r(t);
      if (near(x, z, rr2)) setLift(kind, t, groundMovedUnder(x, z, rr2));
      else if (LIFTED.has(t)) setLift(kind, t, 0);
    }
  };
  each('tree', trees, (t) => [t.x, t.z], () => TRUNK_R);
  each('rock', rocks, (t) => [t.x, t.z], (t) => t.r);
  each('bush', berryBushes, (b) => [b.position.x, b.position.z], (b) => b.userData.r);
  each('wild', wildBushes, (t) => [t.x, t.z], (t) => t.r);
}
// a berry bush the admin took out: hidden, can't be tapped, and doesn't block the way
export function removeLayoutThing(what, i) {
  if (what !== 'bush') return; // trees and rocks come as gone (setTreeState, setRockState)
  const b = berryBushes[i];
  if (!b || b.userData.removed) return;
  b.userData.removed = true;
  keepParts({ parts: b.userData.parts || [] });
  for (const p of b.userData.parts || []) for (const mesh of [p.full, p.simple]) if (mesh) { mesh.setMatrixAt(p.idx, NO_TREE); mesh.instanceMatrix.needsUpdate = true; }
  b.userData.shown = -1;
  drawBerries(b);
  const j = interactive.indexOf(b);
  if (j >= 0) interactive.splice(j, 1);
  removeSpotNear(b.position.x, b.position.z);
  game.clearCellsNear(b.position.x, b.position.z, b.userData.r + 1);
}
// the world from the server: everything the admin moved or removed
export function useWorldEdits(w) {
  for (const [key, at] of Object.entries(w.moved || {})) { const [what, i] = key.split(':'); moveLayoutThing(what, Number(i), at[0], at[1]); }
  for (const key of Object.keys(w.removed || {})) { const [what, i] = key.split(':'); removeLayoutThing(what, Number(i)); }
}

/* ---------- apple trees (0.2.9, Luke's idea) ----------
   A few of the world's leafy trees grow apples (appleTrees in game-data.json: count, nearStart, their own random seed),
   picked one at a time like a berry bush (sources.appleTree). Which trees they are is the same on every phone, and the
   server takes it from the layout (online.js layoutData). Chopped down, the apples on it fall; once its stump has grown
   back, its apples grow back from then. The apples are one InstancedMesh, hidden one by one as they're picked. */
const AT = DATA.appleTrees || {}, APPLE_RAW = (DATA.sources || {}).appleTree;
const APPLE_HOLDS = APPLE_RAW ? Math.max(1, Math.min(8, Math.floor(APPLE_RAW.holds) || 4)) : 0;
export const APPLES = new Map(); // tree number -> { count, growFrom, start, shown }
// how far out a crown's surface is along dir (the crowns are lumpy), so an apple sits on it, not in the air or inside
const surfaceRay = new THREE.Raycaster(), surfaceMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), zero = new THREE.Vector3();
export function crownSurface(geo, dir) {
  surfaceRay.set(zero, dir.clone().normalize());
  const hit = surfaceRay.intersectObject(new THREE.Mesh(geo, surfaceMat), false)[0];
  return hit ? hit.distance : 1;
}
const appleSource = () => (game.SOURCES || {}).appleTree || null;
if (APPLE_RAW && AT.count > 0) {
  const seed = AT.seed || 5501, cut = WALK_LIMIT - 3;
  // leafy trees you can walk up to (not pines, not the tall ones), in an order of their own
  const order = trees.map((t, i) => i).filter((i) => { const t = trees[i]; return !t.pine && !t.tall && squareDist(t.x, t.z) < cut && pondShape(t.x, t.z) > 1.6; })
    .sort((a, b) => hash(a, seed) - hash(b, seed));
  const chosen = [], apart = (i) => chosen.every((j) => Math.hypot(trees[j].x - trees[i].x, trees[j].z - trees[i].z) > 6);
  for (const i of order) if (chosen.length < (AT.nearStart || 0) && Math.hypot(trees[i].x - CLEAR.x, trees[i].z - CLEAR.z) < 22 && apart(i)) chosen.push(i);
  for (const i of order) if (chosen.length < AT.count && !chosen.includes(i) && apart(i)) chosen.push(i);
  chosen.sort((a, b) => a - b);
  const mesh = IM(new THREE.IcosahedronGeometry(0.1, 1), mat('#c8352a', { roughness: 0.45 }), chosen.length * APPLE_HOLDS);
  mesh.userData.label = 'Tree'; // (a tap on an apple is a tap on its tree: copyOwner)
  const m4 = new THREE.Matrix4(), dir = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), C = new THREE.Color('#ffffff');
  for (const i of chosen) {
    const t = trees[i], crowns = t.parts.slice(1).filter((p) => p.full), start = mesh.count;
    keepParts(t);
    withOwnRand(seed * 31 + i * 7919, () => {
      for (let k = 0; k < APPLE_HOLDS; k++) {
        const p = crowns[k % crowns.length] || t.parts[0], crown = p.saved[p.full.uuid];
        const a = (k / APPLE_HOLDS + rr(-0.08, 0.08)) * Math.PI * 2, ph = rr(0.6, 1.4); // spread round the crown, on its upper side, where they show from above
        dir.set(Math.cos(a) * Math.sin(ph), Math.cos(ph), Math.sin(a) * Math.sin(ph));
        dir.multiplyScalar(crownSurface(p.full.geometry, dir) * 0.96).applyMatrix4(crown); // (just into its leaves)
        m4.compose(dir, q.identity(), one.clone().multiplyScalar(Math.max(0.8, Math.min(1.25, t.s)) * rr(0.9, 1.1)));
        mesh.setMatrixAt(mesh.count, m4);
        mesh.setColorAt(mesh.count, C);
        copyOwner.set(`${mesh.uuid}:${mesh.count}`, { kind: 'tree', i });
        mesh.count++;
      }
    });
    APPLES.set(i, { count: null, growFrom: null, start, shown: -1 });
  }
  mesh.userData.base = mesh.instanceMatrix.array.slice();
  mesh.computeBoundingSphere();
  interactive.push(mesh);
  APPLES.mesh = mesh;
}
export const isApple = (i) => APPLES.has(i);
// apples on tree i right now: none on a stump or a young tree (the same maths as a berry bush, rules.js)
export function applesOn(i) {
  const a = APPLES.get(i), src = appleSource(), t = trees[i];
  if (!a || !src || !t || t.state !== 'tree') return 0;
  return berriesGrown(a.count, a.growFrom, APPLE_HOLDS, src.regrowHours * 3600000, Date.now());
}
export function appleReadyIn(i) {
  const a = APPLES.get(i), src = appleSource();
  const mins = Math.max(1, Math.ceil(((a.growFrom || Date.now()) + (src.regrowHours * 3600000) / APPLE_HOLDS - Date.now()) / 60000));
  return mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`;
}
export function pickApple(i) {
  const a = APPLES.get(i), src = appleSource();
  if (!a || !src) return;
  [a.count, a.growFrom] = berryPicked(a.count, a.growFrom, APPLE_HOLDS, src.regrowHours * 3600000, Date.now());
  drawApples(i);
}
export function setApples(i, count, growFrom) {
  const a = APPLES.get(i);
  if (!a) return;
  a.count = count == null ? null : Number(count);
  a.growFrom = growFrom == null ? null : Number(growFrom);
  drawApples(i);
}
// the apples shown on tree i: as many as are on it, where the tree is now (moved or lifted with levelled ground)
export function drawApples(i) {
  const a = APPLES.get(i), mesh = APPLES.mesh, t = trees[i];
  if (!a || !mesh) return;
  const n = game.freshLook ? APPLE_HOLDS : applesOn(i), moved = !!(t.off || t.lift), key = `${n}|${moved ? `${t.x},${t.z},${t.lift || 0}` : ''}`;
  if (a.shown === key) return;
  a.shown = key;
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < APPLE_HOLDS; k++) {
    const o = (a.start + k) * 16;
    if (k < n) { m4.fromArray(mesh.userData.base, o); shifted(t, m4).toArray(mesh.instanceMatrix.array, o); }
    else NO_TREE.toArray(mesh.instanceMatrix.array, o);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (moved) mesh.computeBoundingSphere();
}

/* ---------- clearing land in your camp (0.2.9, Luke) ----------
   A bush dug up (a berry bush or one with no berries) or grass cleared is gone from there till the wild grows it back
   (the server keeps when: world.cleared). Hidden, not tapped, and out of the way; back = it's there again. Trees and
   rocks have their own states for it (gone). */
export function drawShrub(t) {
  for (const p of t.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    p.saved = p.saved || {};
    if (!p.saved[mesh.uuid]) { const m4 = new THREE.Matrix4(); mesh.getMatrixAt(p.idx, m4); p.saved[mesh.uuid] = m4; }
    mesh.setMatrixAt(p.idx, t.cleared && !game.freshLook ? NO_TREE : shifted(t, p.saved[mesh.uuid]));
    mesh.instanceMatrix.needsUpdate = true;
  }
}
export function setCleared(what, i, plant, on = true) {
  if (what === 'plant') { setPlantCleared(plant, i, on); return; }
  const t = what === 'shrub' ? wildBushes[i] : what === 'bush' ? berryBushes[i] : null;
  if (!t) return;
  const u = what === 'bush' ? t.userData : t, x = what === 'bush' ? t.position.x : t.x, z = what === 'bush' ? t.position.z : t.z, r = u.r;
  if (!!u.cleared === !!on || u.removed) return;
  u.cleared = !!on;
  if (what === 'bush') { bushBase(t); drawBushAt(t); } else drawShrub(t);
  const proxy = what === 'bush' ? t : t.proxy;
  if (proxy) { const j = interactive.indexOf(proxy); if (on && j >= 0) interactive.splice(j, 1); if (!on && j < 0) interactive.push(proxy); }
  if (on) removeSpotNear(x, z); else addSpot(x, z, r, WALK_THROUGH);
  game.clearCellsNear(x, z, r + 1);
}
// the whole world's cleared things from the server ({ 'bush:3': when, 'shrub:12': when, 'tallGrass:7': when })
export function useCleared(list) {
  const on = new Set(Object.keys(list || {}));
  berryBushes.forEach((b, i) => setCleared('bush', i, null, on.has(`bush:${i}`)));
  wildBushes.forEach((t, i) => setCleared('shrub', i, null, on.has(`shrub:${i}`)));
  for (const [kind, P] of Object.entries(plants)) for (const c of P.clumps) setCleared('plant', c.i, kind, on.has(`${kind}:${c.i}`));
}
// every second or so: young trees a little bigger, apples grown back (loop.js); the untouched look shows everything
export function drawNature() {
  for (const t of trees) if (t.state === 'young' && Math.abs((t.drawnSize || 0) - (game.freshLook ? 1 : youngSize(t))) > 0.01) showParts(t, true);
  for (const i of APPLES.keys()) drawApples(i);
}
export function drawClearedLook() {
  for (const b of berryBushes) if (b.userData.cleared) { bushBase(b); drawBushAt(b); }
  for (const t of wildBushes) if (t.cleared) drawShrub(t);
}
