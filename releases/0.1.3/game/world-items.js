/* ---------- the world's items: plain data plus what's drawn for each ---------- */
const world = { items: [] }; // { id, kind, x, z, rot }
const itemViews = new Map();
let nextItemId = 1;
// every thing on the ground has an invisible hit area round it, a bit bigger than it is, so it's easy to tap or click
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
HIT_MAT.userData.shared = true;
const HIT_BOX = new THREE.BoxGeometry(1, 1, 1), HIT_BALL = new THREE.SphereGeometry(1, 8, 6);
/* ---------- drawn together ----------
   Things whose shapes are shared (sticks, stones, logs, berries: sharedGeo in items.js) are drawn as copies of one
   mesh per shape (an InstancedMesh), so a thousand sticks cost about the same to draw as one. Each copy keeps its own
   place, turn, size and colour, so they look just as they did. Anything else (tools, a campfire) is drawn one by one. */
const itemBatches = new Map(); // shape and surface -> { geo, material, mesh, n, cap, owners }
function batchFor(geo, src) {
  const key = `${geo.uuid}|${src.roughness}|${src.metalness}|${src.flatShading ? 1 : 0}`;
  let b = itemBatches.get(key);
  if (!b) {
    const material = src.clone(); // the same surface, in white: each copy brings its own colour
    material.color.set('#ffffff');
    material.userData = { shared: true };
    itemBatches.set(key, (b = { geo, material, mesh: null, n: 0, cap: 0, owners: [] }));
  }
  if (b.n >= b.cap) { // full: a bigger mesh with the same copies in it
    const cap = Math.max(64, b.cap * 2), mesh = new THREE.InstancedMesh(geo, b.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (b.mesh) {
      mesh.instanceMatrix.array.set(b.mesh.instanceMatrix.array);
      mesh.instanceColor.array.set(b.mesh.instanceColor.array);
      scene.remove(b.mesh);
      b.mesh.dispose();
    }
    mesh.count = b.n;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false; // they're all over the world, so there's nothing to gain from checking
    mesh.visible = !freshLook;
    scene.add(mesh);
    b.mesh = mesh; b.cap = cap;
  }
  return b;
}
function batchTouched(b) { b.mesh.count = b.n; b.mesh.instanceMatrix.needsUpdate = true; b.mesh.instanceColor.needsUpdate = true; }
// one more copy: where it is (matrix), its colour, and whose it is (owner.slots is told if the copy moves to another slot)
function batchAdd(b, matrix, color, owner) {
  const i = b.n++;
  b.mesh.setMatrixAt(i, matrix);
  b.mesh.setColorAt(i, color);
  b.owners[i] = owner;
  batchTouched(b);
  return i;
}
// take a copy out: the last copy moves into its slot
const batchM4 = new THREE.Matrix4(), batchCol = new THREE.Color();
function batchRemove(b, i) {
  const last = --b.n;
  if (i !== last) {
    b.mesh.getMatrixAt(last, batchM4); b.mesh.setMatrixAt(i, batchM4);
    b.mesh.getColorAt(last, batchCol); b.mesh.setColorAt(i, batchCol);
    const o = (b.owners[i] = b.owners[last]);
    o.slots.find((s) => s[0] === b && s[1] === last)[1] = i;
  }
  b.owners.length = b.n;
  batchTouched(b);
}
const showItemBatches = (on) => { for (const b of itemBatches.values()) if (b.mesh) b.mesh.visible = on; };
function addWorldItem(kind, x, z, rot, id, uses) { // uses: a worn tool's uses left (none means new)
  if (id != null && itemViews.has(id)) return getItem(id); // already here
  const item = { id: id ?? nextItemId++, kind, x, z, rot, ...(uses != null ? { uses } : {}) };
  if (id != null) nextItemId = Math.max(nextItemId, id + 1);
  world.items.push(item);
  const { model, rest, hit, hitR } = buildItem(kind);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  let view;
  if (meshes.length && meshes.every((o) => o.geometry.userData.shared && !Array.isArray(o.material))) { // drawn together
    model.position.set(x, groundY(x, z) + rest, z);
    model.rotation.y = rot;
    model.updateMatrixWorld(true);
    const drawn = { slots: [] };
    for (const o of meshes) { const b = batchFor(o.geometry, o.material); drawn.slots.push([b, batchAdd(b, o.matrixWorld, o.material.color, drawn)]); }
    disposeMaterials(model); // its own tinted materials aren't needed: each copy keeps its colour
    view = new THREE.Group(); // what's tapped and found: the hit area below
    view.userData.drawn = drawn;
  } else view = shadowsOn(model);
  const area = new THREE.Mesh(hit ? HIT_BOX : HIT_BALL, HIT_MAT);
  if (hit) area.scale.set(...hit); else area.scale.setScalar(hitR || 0.2);
  view.add(area);
  view.position.set(x, groundY(x, z) + rest, z);
  view.rotation.y = rot;
  view.userData.label = ITEMS[kind].name;
  view.userData.itemId = item.id;
  view.visible = !freshLook;
  scene.add(view);
  interactive.push(view);
  itemViews.set(item.id, view);
  return item;
}
function removeWorldItem(id) {
  const i = world.items.findIndex((it) => it.id === id);
  if (i >= 0) world.items.splice(i, 1);
  const view = itemViews.get(id);
  if (view) {
    scene.remove(view);
    if (view.userData.drawn) for (const s of view.userData.drawn.slots) batchRemove(s[0], s[1]);
    disposeMaterials(view); // each item has its own slightly different colour
    const j = interactive.indexOf(view);
    if (j >= 0) interactive.splice(j, 1);
    itemViews.delete(id);
  }
}
const getItem = (id) => world.items.find((it) => it.id === id);
// a see-through copy of a model (where a queued drop will land)
function seeThrough(model, opacity = 0.45) {
  const fade = (x) => { const c = x.clone(); if (!x.userData.shared) x.dispose(); c.userData = {}; c.transparent = true; c.opacity = opacity; c.depthWrite = false; return c; };
  model.traverse((m) => {
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(fade) : fade(m.material);
    m.castShadow = false;
  });
  return model;
}
const KEEP_CLEAR = [[4.3, -1.9, 1.2], [5.9, 0.5, 1.1], [3.0, -4.2, 1.2], [-0.9, -4.9, 1.1], [6.6, -3.4, 1], [-3.2, 6.9, 1], [5.8, 4.7, 1.5],
  [6.7, 5.4, 1], [5.1, 5.6, 0.8], [-2.6, -3.9, 1], [-10.4, 2.1, 1.2], [-1.6, 6.6, 0.8], [8.2, -1.2, 0.9], [-3.6, 4.6, 0.9],
  [7.6, -6.8, 2.2], [1.1, 4.2, 0.6], [0.6, 1.9, 1.6]];
// a few close to where you start
function scatterNear(kind, n) {
  for (let tries = 0, made = 0; made < n && tries < 1200; tries++) {
    const a = rand() * Math.PI * 2, d = 2.2 + Math.sqrt(rand()) * 10;
    const x = CLEAR.x + Math.cos(a) * d, z = CLEAR.z + Math.sin(a) * d;
    if (pondShape(x, z) < 1.2) continue;
    if (KEEP_CLEAR.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
    if (world.items.some((it) => Math.hypot(it.x - x, it.z - z) < 1.2)) continue;
    addWorldItem(kind, x, z, rand() * Math.PI);
    made++;
  }
}
// the rest anywhere you can walk, out in the open (not hidden under a tree or bush)
function scatterWide(kind, n) {
  const L = WALK_LIMIT - 0.8;
  withWorldRand(() => {
    for (let tries = 0, made = 0; made < n && tries < n * 60; tries++) {
      const x = rr(-L, L), z = rr(-L, L);
      if (Math.hypot(x - CLEAR.x, z - CLEAR.z) < 13 || pondShape(x, z) < 1.3 || !roomAt(x, z, 0.35)) continue;
      if (world.items.some((it) => Math.hypot(it.x - x, it.z - z) < 2.5)) continue;
      addWorldItem(kind, x, z, rand() * Math.PI);
      made++;
    }
  });
}
for (const it of Object.values(ITEMS)) {
  if (!it.startInWorld) continue;
  scatterNear(it.id, it.startNear);
  scatterWide(it.id, it.startInWorld - it.startNear);
}
// the starting layout, kept so a new (or reset) shared world always starts the same way
const START_ITEMS = world.items.map(({ kind, x, z, rot }) => ({ kind, x, z, rot }));
