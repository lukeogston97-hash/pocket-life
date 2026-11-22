/* ---------- the world's items: plain data plus what's drawn for each ---------- */
const world = { items: [] }; // { id, kind, x, z, rot }
const itemViews = new Map();
let nextItemId = 1;
// every thing on the ground has an invisible hit area round it, a bit bigger than it is, so it's easy to tap or click
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
HIT_MAT.userData.shared = true;
const HIT_BOX = new THREE.BoxGeometry(1, 1, 1), HIT_BALL = new THREE.SphereGeometry(1, 8, 6);
function addWorldItem(kind, x, z, rot, id) {
  if (id != null && itemViews.has(id)) return getItem(id); // already here
  const item = { id: id ?? nextItemId++, kind, x, z, rot };
  if (id != null) nextItemId = Math.max(nextItemId, id + 1);
  world.items.push(item);
  const { model, rest, hit, hitR } = buildItem(kind);
  const view = shadowsOn(model);
  const area = new THREE.Mesh(hit ? HIT_BOX : HIT_BALL, HIT_MAT);
  if (hit) area.scale.set(...hit); else area.scale.setScalar(hitR || 0.2);
  view.add(area);
  view.position.set(x, groundY(x, z) + rest, z);
  view.rotation.y = rot;
  view.userData.label = ITEMS[kind].name;
  view.userData.itemId = item.id;
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
    disposeMaterials(view); // each item has its own slightly different colour
    const j = interactive.indexOf(view);
    if (j >= 0) interactive.splice(j, 1);
    itemViews.delete(id);
  }
}
const getItem = (id) => world.items.find((it) => it.id === id);
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
