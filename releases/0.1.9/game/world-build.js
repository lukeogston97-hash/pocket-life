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
  const shown = Math.min(n, src && harvests(src) ? berriesOn(b) : n);
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
for (const t of [...trees, ...oldStumps]) t.parts = t.parts.map(([m, key, idx]) => ({ ...(m.byKey.get(key) || {}), idx }));
// which tree or old stump a tapped copy belongs to (the drawn mesh and its copy number)
const copyOwner = new Map();
trees.forEach((t, i) => { for (const p of t.parts) for (const mesh of [p.full, p.simple]) if (mesh) copyOwner.set(`${mesh.uuid}:${p.idx}`, { kind: 'tree', i }); });
oldStumps.forEach((t, i) => { for (const p of t.parts) if (p.full) copyOwner.set(`${p.full.uuid}:${p.idx}`, { kind: 'oldStump', i }); });
// hide (or show again) the drawn copies a tree or stump is made of
function showParts(t, show) {
  for (const p of t.parts) for (const mesh of [p.full, p.simple]) {
    if (!mesh) continue;
    p.saved = p.saved || {};
    if (!show) {
      if (!p.saved[mesh.uuid]) { const m4 = new THREE.Matrix4(); mesh.getMatrixAt(p.idx, m4); p.saved[mesh.uuid] = m4; }
      mesh.setMatrixAt(p.idx, NO_TREE);
    } else if (p.saved[mesh.uuid]) mesh.setMatrixAt(p.idx, p.saved[mesh.uuid]);
    mesh.instanceMatrix.needsUpdate = true;
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
function setTreeState(i, state) {
  const t = trees[i];
  if (!t || t.state === state) return;
  const standing = state === 'tree';
  showParts(t, standing);
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
    shadowsOn(g);
    scene.add(g);
    interactive.push(g);
    t.stump = g;
  }
  if (state === 'gone' || (t.state === 'gone' && standing)) clearCellsNear(t.x, t.z, 2.5);
  if (state === 'gone') removeSpotNear(t.x, t.z);
  t.state = state;
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
