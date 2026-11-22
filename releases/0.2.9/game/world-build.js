/* ---------- build everything collected above ---------- */
const woodMat = mat('#8a6847');
for (const m of [reeds, cattails, pads, berries]) {
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
/* berry bushes: you pick one berry at a time, and picked berries grow back one by one (hidden ones are shrunk to nothing) */
const berryMatrices = berries.instanceMatrix.array.slice();
const NO_BERRY = new THREE.Matrix4().makeScale(0, 0, 0);
const bushHolds = (src) => Math.max(1, Math.min(15, src.holds || 5)); // how many berries a full bush has
const growEvery = (src) => (src.regrowHours * 3600000) / bushHolds(src); // how long one berry takes to grow back
// how many berries are on a bush right now (picked ones come back over time)
function berriesOn(b) {
  const src = SOURCES[b.userData.source];
  if (!src || !harvests(src)) return 0;
  const holds = bushHolds(src);
  if (b.userData.count == null) return holds;
  if (!src.regrowHours) return holds;
  const grown = Math.floor((Date.now() - b.userData.growFrom) / growEvery(src));
  return Math.min(holds, b.userData.count + grown);
}
function pickBerry(b) {
  const src = SOURCES[b.userData.source];
  const holds = bushHolds(src);
  if (b.userData.count == null) { b.userData.count = holds; b.userData.growFrom = Date.now(); }
  else if (src.regrowHours) {
    const grown = Math.floor((Date.now() - b.userData.growFrom) / growEvery(src));
    b.userData.count = Math.min(holds, b.userData.count + grown);
    b.userData.growFrom = b.userData.count >= holds ? Date.now() : b.userData.growFrom + grown * growEvery(src);
  }
  b.userData.count -= 1;
}
const ripe = (b) => berriesOn(b) >= 1;
function readyIn(b) {
  const src = SOURCES[b.userData.source];
  const mins = Math.max(1, Math.ceil((b.userData.growFrom + growEvery(src) - Date.now()) / 60000));
  return mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`;
}
function drawBerries(b) {
  const { start, n } = b.userData.berries;
  const src = SOURCES[b.userData.source];
  const shown = b.userData.removed ? 0 : freshLook ? n : Math.min(n, src && harvests(src) ? berriesOn(b) : n);
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
for (const t of [...trees, ...oldStumps, ...rocks]) t.parts = t.parts.map(([m, key, idx]) => ({ ...(m.byKey.get(key) || {}), idx }));
for (const b of berryBushes) b.userData.parts = (b.userData.parts || []).map(([m, key, idx]) => ({ ...(m.byKey.get(key) || {}), idx }));
// which tree or old stump a tapped copy belongs to (the drawn mesh and its copy number)
const copyOwner = new Map();
trees.forEach((t, i) => { for (const p of t.parts) for (const mesh of [p.full, p.simple]) if (mesh) copyOwner.set(`${mesh.uuid}:${p.idx}`, { kind: 'tree', i }); });
oldStumps.forEach((t, i) => { for (const p of t.parts) if (p.full) copyOwner.set(`${p.full.uuid}:${p.idx}`, { kind: 'oldStump', i }); });
rocks.forEach((t, i) => { for (const p of t.parts) if (p.full) copyOwner.set(`${p.full.uuid}:${p.idx}`, { kind: 'rock', i }); });
// a moved thing (admin): its laid-out copy, shifted by t.off
const shifted = (t, m4) => (t.off ? new THREE.Matrix4().makeTranslation(t.off[0], t.off[1], t.off[2]).multiply(m4) : m4);
// remember each drawn copy as it was laid out (once, before it's hidden or moved)
function keepParts(t) {
  for (const p of t.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    p.saved = p.saved || {};
    if (!p.saved[mesh.uuid]) { const m4 = new THREE.Matrix4(); mesh.getMatrixAt(p.idx, m4); p.saved[mesh.uuid] = m4; }
  }
}
// hide (or show again) the drawn copies a tree or stump is made of
function showParts(t, show) {
  for (const p of t.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    p.saved = p.saved || {};
    if (!show) {
      if (!p.saved[mesh.uuid]) { const m4 = new THREE.Matrix4(); mesh.getMatrixAt(p.idx, m4); p.saved[mesh.uuid] = m4; }
      mesh.setMatrixAt(p.idx, NO_TREE);
    } else if (p.saved[mesh.uuid]) mesh.setMatrixAt(p.idx, shifted(t, p.saved[mesh.uuid]));
    mesh.instanceMatrix.needsUpdate = true;
    if (t.off) mesh.computeBoundingSphere(); // so it isn't skipped when its old spot is off screen
  }
}
// an old stump dug out: gone for good
function removeOldStump(i) {
  const t = oldStumps[i];
  if (!t || t.gone) return;
  t.gone = true;
  showParts(t, false);
  if (t.proxy) { scene.remove(t.proxy); const j = interactive.indexOf(t.proxy); if (j >= 0) interactive.splice(j, 1); }
  removeSpotNear(t.x, t.z);
  clearCellsNear(t.x, t.z, 2);
}

/* ---------- chopping trees down (0.1.2): a tree becomes a stump, then grows back, unless the stump is removed ---------- */
const CHOP = DATA.chopping || {};
const NO_TREE = new THREE.Matrix4().makeScale(0, 0, 0);
const stumpMat = mat('#7a5c40'), stumpTopMat = mat('#cfb48a');
function setTreeState(i, state, since) {
  const t = trees[i];
  if (t && state === 'stump') t.since = since || t.since || Date.now(); // when it was chopped (it grows back regrowDays after)
  if (!t || t.state === state) return;
  const standing = state === 'tree';
  showParts(t, standing || freshLook);
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
    g.visible = !freshLook;
    shadowsOn(g);
    scene.add(g);
    interactive.push(g);
    t.stump = g;
  }
  if (state === 'gone' || (t.state === 'gone' && standing)) clearCellsNear(t.x, t.z, 2.5);
  if (state === 'gone') removeSpotNear(t.x, t.z);
  t.state = state;
}
// how long until a stump grows back into a tree, like "2 days 5 h" or "40 min"
const stumpGrowsIn = (t) => growsBackIn(t.since, CHOP.regrowDays || 3);
function growsBackIn(since, days) {
  const mins = Math.max(1, Math.ceil(((since || Date.now()) + days * 86400000 - Date.now()) / 60000));
  if (mins < 90) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return `${d} ${d === 1 ? 'day' : 'days'}${rh ? ` ${rh} h` : ''}`;
}
/* ---------- mining rocks and boulders (0.2.9): a rock breaks and is gone (one comes back now and then), a boulder stays and can be mined again ---------- */
const MINE = DATA.mining || {};
const MINED_SQUASH = new THREE.Matrix4().makeScale(0.92, 0.6, 0.92); // a mined boulder looks worn down
function drawRock(r) {
  const look = freshLook ? 'whole' : r.state;
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
function setRockState(i, state, since) {
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
    clearCellsNear(r.x, r.z, r.r + 1);
  }
}
// the tree nearest a tap (on its trunk or crown)
function treeNear(p, maxD = 3) {
  let best = -1, bd = maxD;
  trees.forEach((t, i) => { if (t.state !== 'tree') return; const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
// pebbles and flowers are still laid out (so nothing else moves) but not drawn:
// the pebbles looked like stones you could pick up, and the coloured flowers were distracting
const DETAILS = [tufts];
DETAILS.forEach(buildDetail);
// grass, flowers and pebbles are drawn round where the camera looks, refilled once that has moved a few metres
let detailAt = null;
function updateDetails(x, z) {
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
function moveLayoutThing(what, i, x, z) {
  const t = movedThing(what, i);
  if (!t || !Number.isFinite(x) || !Number.isFinite(z)) return;
  if (what === 'bush') { moveBush(t, x, z); return; }
  if (!t.from) { keepParts(t); t.from = [t.x, t.z]; t.spot = takeSpot(t.x, t.z) || [what === 'rock' ? t.r : 0.5, what === 'tree']; } // where it was laid out
  else removeSpotNear(t.x, t.z);
  clearCellsNear(t.x, t.z, t.spot[0] + 1);
  const was = [t.x, t.z];
  t.off = [x - t.from[0], groundY(x, z) - groundY(t.from[0], t.from[1]), z - t.from[1]];
  t.x = x; t.z = z;
  if (what === 'tree') {
    showParts(t, t.state === 'tree' || freshLook);
    if (t.stump) t.stump.position.set(x, groundY(x, z) - 0.05, z);
  } else {
    drawRock(t);
    if (t.proxy) t.proxy.position.set(x, t.proxy.position.y - groundY(was[0], was[1]) + groundY(x, z), z);
  }
  if (t.state !== 'gone') addSpot(x, z, t.spot[0], t.spot[1]);
  clearCellsNear(x, z, t.spot[0] + 1);
}
function moveBush(b, x, z) {
  const u = b.userData;
  if (!u.from) { // where it was laid out, and its drawn copies and berries as they were
    keepParts({ parts: u.parts || [] });
    u.from = [b.position.x, b.position.z, b.position.y];
    const { start, n } = u.berries;
    u.berryBase = berryMatrices.slice(start * 16, (start + n) * 16);
  }
  removeSpotNear(b.position.x, b.position.z);
  clearCellsNear(b.position.x, b.position.z, u.r + 1);
  const off = [x - u.from[0], groundY(x, z) - u.from[2], z - u.from[1]], T = new THREE.Matrix4().makeTranslation(...off);
  u.off = off;
  for (const p of u.parts || []) for (const mesh of [p.full, p.simple]) {
    if (!mesh || !p.saved[mesh.uuid]) continue;
    mesh.setMatrixAt(p.idx, u.removed ? NO_TREE : T.clone().multiply(p.saved[mesh.uuid]));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  const { start, n } = u.berries, m4 = new THREE.Matrix4();
  for (let k = 0; k < n; k++) { m4.fromArray(u.berryBase, k * 16); T.clone().multiply(m4).toArray(berryMatrices, (start + k) * 16); }
  berries.computeBoundingSphere();
  u.shown = -1;
  drawBerries(b);
  b.position.set(x, groundY(x, z), z);
  if (!u.removed) addSpot(x, z, u.r);
  clearCellsNear(x, z, u.r + 1);
}
// a berry bush the admin took out: hidden, can't be tapped, and doesn't block the way
function removeLayoutThing(what, i) {
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
  clearCellsNear(b.position.x, b.position.z, b.userData.r + 1);
}
// the world from the server: everything the admin moved or removed
function useWorldEdits(w) {
  for (const [key, at] of Object.entries(w.moved || {})) { const [what, i] = key.split(':'); moveLayoutThing(what, Number(i), at[0], at[1]); }
  for (const key of Object.keys(w.removed || {})) { const [what, i] = key.split(':'); removeLayoutThing(what, Number(i)); }
}
