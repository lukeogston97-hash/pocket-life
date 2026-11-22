/* ---------- instanced nature ---------- */
// Many copies of one shape (a tree trunk, a tuft of grass) are drawn together as one InstancedMesh.
// Most are collected into sets first and built once the world is laid out:
// - a set can split its copies into chunks of the map, so the parts you can't see aren't drawn
// - a detail set (grass, flowers, pebbles) only draws the copies near you, refilled as you walk
const dummy = new THREE.Object3D();
// Old stumps and fallen logs were taken out of the world (0.2.8, Luke: only real stumps, from chopped trees). They're
// still worked out the same way so nothing else in the layout moves, then their spots are freed in start.js.
const noLongerHere = [];
const skipPut = () => {};
let DRY = false; // while true, put() works a copy out but doesn't keep it (so the clearing's layout never changes)
let recording = null; // while a tree is being placed: [set, chunk, index] of every copy it's made of (so it can be chopped down)
const trees = []; // every tree you can walk up to: { x, z, s, parts, state }
const oldStumps = []; // the old stumps already in the world when it was made: { x, z, parts, proxy, gone }
function IM(geo, material, n, shadow = true) {
  const m = new THREE.InstancedMesh(geo, material, n);
  m.count = 0;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
// lod: a simpler shape drawn instead when that chunk of the map is far from the camera's focus
function makeSet(geo, material, { shadow = true, chunk = null, label = null, lod = null } = {}) {
  return { isSet: true, geo, material, shadow, chunk, label, lod, groups: new Map(), meshes: [] };
}
function makeDetail(geo, material, { cap, near, far, shadow = false }) {
  return { isDetail: true, geo, material, shadow, cap, near, far, xs: [], zs: [], ms: [], cs: [], mesh: null };
}
function put(m, x, y, z, rx, ry, rz, sx, sy, sz, color) {
  if (DRY) return;
  if (m.isInstancedMesh && m.count >= m.instanceMatrix.count) return;
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  if (m.isInstancedMesh) {
    m.setMatrixAt(m.count, dummy.matrix);
    m.setColorAt(m.count, color);
    m.count++;
    return;
  }
  let g = m;
  if (m.isSet) {
    const key = m.chunk ? m.chunk(x, z) : 0;
    g = m.groups.get(key);
    if (!g) m.groups.set(key, (g = { ms: [], cs: [] }));
  } else {
    m.xs.push(x);
    m.zs.push(z);
  }
  g.ms.push(...dummy.matrix.elements);
  g.cs.push(color.r, color.g, color.b);
  if (recording && m.isSet) recording.push([m, m.chunk ? m.chunk(x, z) : 0, g.cs.length / 3 - 1]);
}
const lodPairs = []; // { x, z, full, simple }: the detailed and simple copies of one chunk
function buildSet(m) {
  for (const [key, g] of m.groups) {
    const make = (geo, shadow) => {
      const mesh = new THREE.InstancedMesh(geo, m.material, g.cs.length / 3);
      mesh.instanceMatrix.array.set(g.ms);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(g.cs), 3);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      if (m.label) mesh.userData.label = m.label;
      scene.add(mesh);
      return mesh;
    };
    const mesh = make(m.geo, m.shadow);
    m.meshes.push(mesh);
    let simple = null;
    if (m.lod) {
      simple = make(m.lod, false);
      simple.visible = false;
      const [x, z] = chunkCentre(key);
      lodPairs.push({ x, z, full: mesh, simple });
    }
    (m.byKey || (m.byKey = new Map())).set(key, { full: mesh, simple });
  }
  m.groups.clear();
  return m.meshes;
}
// square chunks of the map, named so their middle can be worked out again
const chunker = (size) => (x, z) => `${size}:${Math.floor(x / size)}:${Math.floor(z / size)}`;
function chunkCentre(key) {
  const [size, ix, iz] = String(key).split(':').map(Number);
  return [(ix + 0.5) * size, (iz + 0.5) * size];
}
const LOD_NEAR = 45; // chunks whose middle is closer than this to the camera's focus get full detail
function updateLod(x, z) {
  for (const p of lodPairs) {
    const full = Math.hypot(p.x - x, p.z - z) < LOD_NEAR;
    p.full.visible = full;
    p.simple.visible = !full;
  }
}
function buildDetail(d) {
  d.xs = Float32Array.from(d.xs);
  d.zs = Float32Array.from(d.zs);
  d.ms = Float32Array.from(d.ms);
  d.cs = Float32Array.from(d.cs);
  d.us = Float32Array.from(d.xs, (_, i) => hash(i, 4091)); // each copy fades out at its own distance, so there's no hard edge
  const mesh = new THREE.InstancedMesh(d.geo, d.material, d.cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.cap * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.castShadow = d.shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  d.mesh = mesh;
}
function refillDetail(d, px, pz) {
  const M = d.mesh.instanceMatrix.array, C = d.mesh.instanceColor.array;
  const { xs, zs, us, ms, cs, near, far, cap } = d;
  let n = 0;
  for (let i = 0; i < xs.length && n < cap; i++) {
    const dx = xs[i] - px, dz = zs[i] - pz, r = (near + (far - near) * us[i]) * detailScale;
    if (dx * dx + dz * dz > r * r) continue;
    for (let k = 0; k < 16; k++) M[n * 16 + k] = ms[i * 16 + k];
    C[n * 3] = cs[i * 3]; C[n * 3 + 1] = cs[i * 3 + 1]; C[n * 3 + 2] = cs[i * 3 + 2];
    n++;
  }
  d.mesh.count = n;
  if (!n) return;
  for (const a of [d.mesh.instanceMatrix, d.mesh.instanceColor]) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, n * a.itemSize);
    a.needsUpdate = true;
  }
}
// what's already placed where, so new things don't land on top of each other or under a tree
const spots = new Map();
const spotKey = (x, z) => Math.floor(x / 4) * 4096 + Math.floor(z / 4);
// a tree that's been cleared away (stump and all) no longer blocks the way
function removeSpotNear(x, z) {
  const a = spots.get(spotKey(x, z));
  if (!a) return;
  for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - x) < 0.01 && Math.abs(a[k + 1] - z) < 0.01) { a.splice(k, 4); return; }
}
function addSpot(x, z, r, tree = false) {
  const k = spotKey(x, z);
  if (!spots.has(k)) spots.set(k, []);
  spots.get(k).push(x, z, r, tree ? 1 : 0);
}
// is there room at x, z? gap is the space needed; a tree counts as treeScale times its crown
function roomAt(x, z, gap, treeScale = 1) {
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const a = spots.get(spotKey(x + i * 4, z + j * 4));
      if (!a) continue;
      for (let k = 0; k < a.length; k += 4) {
        const r = a[k + 3] ? a[k + 2] * treeScale : a[k + 2];
        if (Math.hypot(a[k] - x, a[k + 1] - z) < r + gap) return false;
      }
    }
  }
  return true;
}
function jitterGeo(g, amt, salt) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = hash(Math.round(x * 997) + salt, Math.round(y * 991) * 31 + Math.round(z * 983) * 17);
    const f = 1 + (k - 0.5) * amt;
    p.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}
const white = () => mat('#ffffff');
const crownGeoA = jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.34, 1);
const crownGeoB = jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.3, 77);
const crownGeoFar = jitterGeo(new THREE.IcosahedronGeometry(1, 0), 0.25, 5);
const trunkGeo = new THREE.CylinderGeometry(0.09, 0.15, 1, 6);
trunkGeo.translate(0, 0.5, 0);
const coneGeo = new THREE.ConeGeometry(1, 1, 7);
coneGeo.translate(0, 0.5, 0);
const coneGeoJ = jitterGeo(coneGeo, 0.12, 9);

// far-off trees are simpler: their trunk ends and cone bottoms can never be seen
const trunkGeoFar = new THREE.CylinderGeometry(0.09, 0.15, 1, 6, 1, true);
trunkGeoFar.translate(0, 0.5, 0);
const coneGeoFar = jitterGeo(new THREE.ConeGeometry(1, 1, 7, 1, true).translate(0, 0.5, 0), 0.12, 9);

const leafMat = white(), barkMat = white();
// trees you can walk among are split into 20 m squares (far-off squares swap to the simpler trees);
// the forest past the edge is split into 8 slices round the world
const nearChunk = chunker(20);
const farSlice = (x, z) => Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8) % 8;
const near = {
  trunk: makeSet(trunkGeo, barkMat, { chunk: nearChunk, label: 'Tree', lod: trunkGeoFar }),
  crownA: makeSet(crownGeoA, leafMat, { chunk: nearChunk, label: 'Tree', lod: crownGeoFar }),
  crownB: makeSet(crownGeoB, leafMat, { chunk: nearChunk, label: 'Tree', lod: crownGeoFar }),
  cone: makeSet(coneGeoJ, leafMat, { chunk: nearChunk, label: 'Pine tree', lod: coneGeoFar }),
};
const far = {
  trunk: makeSet(trunkGeoFar, barkMat, { shadow: false, chunk: farSlice }),
  crown: makeSet(crownGeoFar, leafMat, { shadow: false, chunk: farSlice }),
  cone: makeSet(coneGeoFar, leafMat, { shadow: false, chunk: farSlice }),
};

const LEAF = ['#6f8f4f', '#7b9858', '#678a4b', '#86a05e', '#5d7d46', '#90a462'];
const AUTUMN = ['#bda64f', '#c8ac58', '#b19443', '#c59a4e'];
const PINE = ['#55724b', '#5d7b51', '#4e6a46', '#617f55'];
const BARK = ['#7a5c40', '#6f543b', '#86664a', '#6a5a48'];

function broadleaf(x, z, s, o = {}) {
  if (!DRY && !o.far) recording = [];
  try { broadleafParts(x, z, s, o); } finally { if (recording) { trees.push({ x, z, s, parts: recording, state: 'tree' }); recording = null; } }
}
function pine(x, z, s, o = {}) {
  if (!DRY && !o.far) recording = [];
  try { pineParts(x, z, s, o); } finally { if (recording) { trees.push({ x, z, s, parts: recording, state: 'tree', pine: true }); recording = null; } }
}
function broadleafParts(x, z, s, o = {}) {
  const set = o.far ? far : near;
  const y = heightAt(x, z) - 0.12;
  const tall = !!o.tall;
  const th = (tall ? rr(3.8, 6.2) : rr(1.0, 1.8)) * s;
  const bw = s * (tall ? 0.85 : 1.05);
  put(set.trunk, x, y, z, 0, rand() * 6.28, 0, bw, th + 0.15, bw, tint(pick(BARK)));
  const base = new THREE.Color(rand() < (o.autumn ?? 0.1) ? pick(AUTUMN) : pick(LEAF));
  const blobs = tall ? 2 : (rand() < 0.55 ? 2 : 1);
  for (let i = 0; i < blobs; i++) {
    const cs = s * (tall ? rr(0.95, 1.3) : rr(1.05, 1.5)) * (i ? 0.8 : 1);
    const ox = (i ? rr(-0.5, 0.5) : rr(-0.15, 0.15)) * s;
    const oz = (i ? rr(-0.5, 0.5) : rr(-0.15, 0.15)) * s;
    const oy = th + cs * (tall ? 1.05 : 0.72) + (i ? cs * 0.55 : 0);
    const c = base.clone().offsetHSL(rr(-0.01, 0.01), rr(-0.04, 0.04), rr(-0.03, 0.03) + (i ? 0.02 : 0));
    const crown = o.far ? far.crown : (rand() < 0.5 ? near.crownA : near.crownB);
    put(crown, x + ox, y + oy, z + oz, rr(-0.3, 0.3), rand() * 6.28, rr(-0.3, 0.3),
      cs * rr(0.95, 1.12), cs * (tall ? rr(1.35, 1.75) : rr(0.86, 1.08)), cs * rr(0.95, 1.12), c);
  }
  if (!DRY && !o.far) addSpot(x, z, s * 1.35, true);
}
function pineParts(x, z, s, o = {}) {
  const set = o.far ? far : near;
  const y = heightAt(x, z) - 0.12;
  put(set.trunk, x, y, z, 0, 0, 0, s * 0.75, 1.1 * s, s * 0.75, tint(pick(BARK)));
  const base = new THREE.Color(pick(PINE));
  for (let i = 0; i < 3; i++) {
    const w = (1.3 - i * 0.32) * s;
    put(set.cone, x, y + (0.75 + i * 0.95) * s, z, 0, rand() * 6.28, 0, w, 1.65 * s, w, base.clone().offsetHSL(0, rr(-0.03, 0.03), i * 0.018));
  }
  if (!DRY && !o.far) addSpot(x, z, s * 1.3, true);
}
// the woods round the clearing, laid out exactly as they always have been (out to OLD_WOODS metres)
const OLD_WOODS = 30;
const oldWoods = (gx, gz) => Math.hypot(gx - CLEAR.x, gz - CLEAR.z) < OLD_WOODS;
for (let gx = -64; gx <= 64; gx += 2.5) {
  for (let gz = -64; gz <= 64; gz += 2.5) {
    const x = gx + rr(-1.1, 1.1), z = gz + rr(-1.1, 1.1);
    const d = Math.hypot(x - CLEAR.x, z - CLEAR.z);
    if (d > 68 || d < 11.5 || pondShape(x, z) < 1.45) continue;
    const glade = fbm(x * 0.08 + 90, z * 0.08 - 40);
    const pr = smoothstep(11.5, 22, d) * (0.45 + 0.55 * smoothstep(0.3, 0.55, glade));
    if (rand() > pr * 0.92) continue;
    const isFar = d > 30;
    DRY = !oldWoods(gx, gz); // further out, the bigger world below has its own trees
    const r = rand();
    if (z < -14 && r < 0.22) broadleaf(x, z, rr(0.85, 1.15), { tall: true, far: isFar });
    else if (r < 0.66) broadleaf(x, z, rr(0.8, 1.35), { far: isFar });
    else pine(x, z, rr(0.85, 1.35), { far: isFar });
    DRY = false;
  }
}
// a few trees framing the clearing
broadleaf(9.4, 4.8, 1.15); broadleaf(-10.2, -7.4, 1.25); pine(10.6, -4.6, 1.2);
broadleaf(-8.6, 8.6, 1.05, { autumn: 1 }); pine(4.6, -10.4, 1.1); broadleaf(-2.2, -10.8, 1.2);
// The rest of the world: woods with open meadows further out, then thick forest past the edge,
// and simpler forest beyond that, fading into the haze.
withWorldRand(() => {
  const plant = (x, z, isFar, k = 1) => {
    const r = rand();
    if (z < -14 && r < 0.22) broadleaf(x, z, rr(0.85, 1.15) * k, { tall: true, far: isFar });
    else if (r < 0.66) broadleaf(x, z, rr(0.8, 1.35) * k, { far: isFar });
    else pine(x, z, rr(0.85, 1.35) * k, { far: isFar });
  };
  const wallOut = WORLD_HALF + WALL_DEPTH;
  const from = -64 - 2.5 * Math.ceil((wallOut - 64) / 2.5); // same 2.5 m grid as the old woods
  for (let gx = from; gx <= wallOut + 1.1; gx += 2.5) {
    for (let gz = from; gz <= wallOut + 1.1; gz += 2.5) {
      const x = gx + rr(-1.1, 1.1), z = gz + rr(-1.1, 1.1);
      if (oldWoods(gx, gz) || squareDist(x, z) > wallOut || pondShape(x, z) < 1.45) continue;
      const d = Math.hypot(x - CLEAR.x, z - CLEAR.z);
      const woods = 0.45 + 0.55 * smoothstep(0.3, 0.55, fbm(x * 0.08 + 90, z * 0.08 - 40));
      const meadow = smoothstep(34, 46, d) * smoothstep(0.4, 0.58, fbm(x * 0.03 + 310, z * 0.03 - 125));
      const wall = smoothstep(WORLD_HALF - 3, WORLD_HALF - 0.5, squareDist(x, z));
      // open woods you can see through (not as thick as round the clearing), thick forest at the edge
      if (rand() > Math.max(woods * (1 - 0.94 * meadow) * 0.55, wall * 0.98)) continue;
      plant(x, z, false);
    }
  }
  for (let gx = -FOREST_END; gx <= FOREST_END; gx += 3.5) {
    for (let gz = -FOREST_END; gz <= FOREST_END; gz += 3.5) {
      const x = gx + rr(-1.5, 1.5), z = gz + rr(-1.5, 1.5);
      if (squareDist(x, z) <= wallOut + 0.5 || squareDist(x, z) > FOREST_END) continue;
      const woods = smoothstep(0.3, 0.55, fbm(x * 0.08 + 90, z * 0.08 - 40));
      if (rand() > 0.8 + 0.14 * woods) continue;
      plant(x, z, true, 1.15);
    }
  }
});

/* grass, flowers */
const tuftGeo = (() => {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(0.045, 0.38, 3, 1, true);
    c.translate(0, 0.19, 0);
    c.rotateZ((i - 1.5) * 0.28);
    c.rotateY(i * 1.7);
    c.translate((i - 1.5) * 0.035, 0, ((i % 2) - 0.5) * 0.05);
    parts.push(c);
  }
  return mergeGeometries(parts);
})();
const TUFT_COLOURS = ['#a9b86f', '#9caf66', '#b7b873', '#8fa35c'];
const FLOWER_COLOURS = ['#f3efe1', '#ecd36a', '#e2a8b4', '#b8a5d9', '#f3efe1'];
// grass and flowers are only drawn near you: full grass out to 26 m, thinning out by 40 m
const tufts = makeDetail(tuftGeo, mat('#ffffff', { roughness: 1, side: THREE.DoubleSide }), { cap: 4200, near: 26, far: 40 });
for (let i = 0; i < 2400; i++) {
  const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 34;
  const x = CLEAR.x + Math.cos(a) * d, z = CLEAR.z + Math.sin(a) * d;
  const pp = pondShape(x, z);
  if (pp < 0.86) continue;
  if (Math.hypot(x - CLEAR.x - 0.3, z - CLEAR.z - 0.2) < 2.0) continue;
  const s = rr(0.7, 1.35) * (pp < 1.3 ? 1.35 : 1);
  put(tufts, x, heightAt(x, z) - 0.03, z, 0, rand() * 6.28, 0, s, s * rr(0.8, 1.3), s,
    tint(pick(TUFT_COLOURS), 0.008, 0.05, 0.04));
}
const flowers = makeDetail(new THREE.IcosahedronGeometry(0.055, 0), mat('#ffffff', { roughness: 0.8 }), { cap: 1400, near: 22, far: 34 });
for (let i = 0; i < 320; i++) {
  const a = rand() * Math.PI * 2, d = 2.2 + Math.sqrt(rand()) * 15;
  const x = CLEAR.x + Math.cos(a) * d, z = CLEAR.z + Math.sin(a) * d;
  if (pondShape(x, z) < 1.05) continue;
  put(flowers, x, heightAt(x, z) + 0.13, z, 0, 0, 0, 1, 1, 1, tint(pick(FLOWER_COLOURS)));
}

/* reeds and lily pads */
const reedGeo = new THREE.ConeGeometry(0.03, 1, 4, 1, true);
reedGeo.translate(0, 0.5, 0);
const reeds = IM(reedGeo, mat('#ffffff', { roughness: 1, side: THREE.DoubleSide }), 300, false);
const cattails = IM(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 5), mat('#ffffff'), 90, false);
reeds.userData.label = 'Reeds';
for (let tries = 0, placed = 0; tries < 3000 && placed < 36; tries++) {
  const a = rand() * Math.PI * 2, rad = rr(0.7, 0.98);
  const baseR = POND.r * (1 + 0.13 * Math.sin(a * 3 + 1.1) + 0.06 * Math.sin(a * 5 - 0.7));
  const x = POND.x + Math.cos(a) * baseR * rad, z = POND.z + Math.sin(a) * baseR * rad / 1.22;
  const y = heightAt(x, z);
  if (y < WATER_Y - 0.25 || y > WATER_Y + 0.32) continue;
  const n = 3 + Math.floor(rand() * 5);
  for (let k = 0; k < n; k++) {
    const cx = x + rr(-0.32, 0.32), cz = z + rr(-0.32, 0.32);
    const h = rr(0.7, 1.35);
    const by = Math.max(heightAt(cx, cz), WATER_Y - 0.12);
    const tx = rr(-0.12, 0.12), tz = rr(-0.12, 0.12);
    put(reeds, cx, by, cz, tx, rand() * 6, tz, 1, h, 1, tint(pick(['#8e9d55', '#7f9150', '#a3a95f'])));
    if (rand() < 0.3) put(cattails, cx + tz * -h * 0.85, by + h * 0.86, cz + tx * h * 0.85, tx, 0, tz, 1, 1, 1, tint('#6d4d34'));
  }
  placed++;
}
const padGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.03, 8, 1, false, 0.5, Math.PI * 1.8);
const pads = IM(padGeo, mat('#ffffff', { roughness: 0.7 }), 12, false);
for (let tries = 0, placed = 0; tries < 400 && placed < 9; tries++) {
  const x = POND.x + rr(-4, 4), z = POND.z + rr(-3.5, 3.5);
  if (heightAt(x, z) > WATER_Y - 0.3 || pondShape(x, z) > 0.62) continue;
  const s = rr(0.7, 1.15);
  put(pads, x, WATER_Y + 0.075, z, 0, rand() * 6.28, 0, s, 1, s, tint(pick(['#6c9a50', '#77a356', '#5f8c48'])));
  placed++;
}

/* ---------- props you can tap ---------- */
const interactive = [water, reeds]; // trees, bushes and rocks spread over the world are added once they're built
const rockGeos = [
  jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.45, 3),
  jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.5, 41),
  jitterGeo(new THREE.IcosahedronGeometry(1, 0), 0.4, 19),
];
const flintGeo = jitterGeo(new THREE.TetrahedronGeometry(1, 0), 0.3, 5);
const ROCK_COLOURS = ['#a9a397', '#9a948a', '#b5ae9f', '#8f8a80'];
const BUSH_COLOURS = ['#5f8146', '#668a4b', '#58783f'];
const propMat = white();
const wild = {
  bush: makeSet(crownGeoB, propMat, { label: 'Bush', chunk: chunker(40) }),
  boulders: rockGeos.map((g) => makeSet(g, propMat, { label: 'Boulder' })),
  rock: makeSet(rockGeos[0], propMat, { label: 'Rock' }),
  stump: makeSet(new THREE.CylinderGeometry(0.36, 0.44, 0.42, 8), propMat, { label: 'Tree stump' }),
  stumpTop: makeSet(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 8), propMat, { label: 'Tree stump' }),
  log: makeSet(new THREE.CylinderGeometry(0.28, 0.31, 3.4, 8).rotateZ(Math.PI / 2), propMat, { label: 'Fallen log' }),
  logEnd: makeSet(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 8).rotateZ(Math.PI / 2), propMat, { label: 'Fallen log' }),
};
// The things round the clearing keep their own invisible shapes for tapping, but are drawn
// together with others like them (far fewer separate draws for the phone).
const drawnTogether = {
  bushes: makeSet(crownGeoB, propMat),
  rocks: rockGeos.map((g) => makeSet(g, propMat)),
  flint: makeSet(flintGeo, mat('#ffffff', { roughness: 0.55 })),
};
const drawAlong = (set, m) => {
  m.updateWorldMatrix(true, false);
  const p = V(), q = new THREE.Quaternion(), sc = V();
  m.matrixWorld.decompose(p, q, sc);
  const e = new THREE.Euler().setFromQuaternion(q);
  put(set, p.x, p.y, p.z, e.x, e.y, e.z, sc.x, sc.y, sc.z, m.material.color);
  m.visible = false;
};
const berries = IM(new THREE.IcosahedronGeometry(0.065, 0), mat('#ffffff', { roughness: 0.5 }), 900, true);
const berryBushes = [];
function bush(x, z, s = 1, withBerries = true) {
  const g = new THREE.Group();
  const y = groundY(x, z);
  g.position.set(x, y, z);
  const base = new THREE.Color(pick(BUSH_COLOURS));
  const blobs = [];
  for (let i = 0; i < 3; i++) {
    const r = s * rr(0.48, 0.7) * (i ? 0.85 : 1);
    const m = new THREE.Mesh(crownGeoB, mat(base.clone().offsetHSL(0, rr(-0.03, 0.03), rr(-0.03, 0.03))));
    const ox = i ? rr(-0.45, 0.45) * s : 0, oz = i ? rr(-0.45, 0.45) * s : 0;
    m.position.set(ox, r * 0.6, oz);
    m.scale.set(r, r * 0.8, r);
    m.rotation.y = rand() * 6;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    blobs.push({ ox, oz, r, y: r * 0.6 });
  }
  scene.add(g);
  for (const m of g.children) drawAlong(drawnTogether.bushes, m);
  if (withBerries) {
    // each berry bush remembers which berries are its own, so they can be picked and grow back
    g.userData.berries = { start: berries.count, n: 15 };
    g.userData.pickedAt = null;
    g.userData.bushId = berryBushes.length;
    berryBushes.push(g);
    for (let k = 0; k < 15; k++) {
      const b = pick(blobs);
      const th = rand() * Math.PI * 2, ph = rr(0.25, 1.25);
      const dx = Math.cos(th) * Math.sin(ph), dy = Math.cos(ph), dz = Math.sin(th) * Math.sin(ph);
      put(berries, x + b.ox + dx * b.r * 0.97, y + b.y + dy * b.r * 0.78, z + b.oz + dz * b.r * 0.97, 0, rand() * 6, 0, 1, 1, 1, tint('#c4483a', 0.01, 0.06, 0.05));
    }
  }
  g.userData.label = withBerries ? 'Berry bush' : 'Bush';
  addSpot(x, z, s * 0.85);
  interactive.push(g);
  return g;
}
const ROCK_MIN = 0.45;
function rock(x, z, s, label = 'Boulder', color) {
  s = Math.max(s, ROCK_MIN);
  const m = new THREE.Mesh(pick(rockGeos), mat(color || tint(pick(ROCK_COLOURS))));
  m.position.set(x, groundY(x, z) + s * 0.16, z);
  m.scale.set(s * rr(0.9, 1.3), s * rr(0.55, 0.8), s * rr(0.9, 1.2));
  m.rotation.set(rr(-0.2, 0.2), rand() * 6, rr(-0.2, 0.2));
  m.castShadow = m.receiveShadow = true;
  m.userData.label = label;
  scene.add(m);
  drawAlong(drawnTogether.rocks[rockGeos.indexOf(m.geometry)], m);
  addSpot(x, z, s * 1.1);
  interactive.push(m);
  return m;
}
bush(4.3, -1.9, 1.05); bush(5.9, 0.5, 0.9); bush(3.0, -4.2, 1.0); bush(-0.9, -4.9, 0.95); bush(6.6, -3.4, 0.85, false); bush(-3.2, 6.9, 0.8, false);
rock(5.8, 4.7, 0.95); rock(6.7, 5.4, 0.55); rock(5.1, 5.6, 0.38, 'Rock');
rock(-2.6, -3.9, 0.7); rock(-10.4, 2.1, 0.85); rock(-1.6, 6.6, 0.45, 'Rock'); rock(8.2, -1.2, 0.5, 'Rock');
// Three little flint stones used to sit here. They looked like stones you could pick up, so they're gone,
// but their random numbers are still used up so the rest of the clearing stays exactly where it was.
for (let i = 0; i < 3; i++) { tint('#6b6a68', 0.02, 0.04, 0.03); rand(); rand(); rand(); }
const PEBBLE_COLOURS = ['#a9a397', '#9a948a', '#b5ae9f'];
const pebbles = makeDetail(rockGeos[0], mat('#ffffff'), { cap: 500, near: 18, far: 28, shadow: true });
for (let i = 0; i < 90; i++) {
  const a = rand() * Math.PI * 2, d = 1.5 + Math.sqrt(rand()) * 13;
  const x = CLEAR.x + Math.cos(a) * d, z = CLEAR.z + Math.sin(a) * d;
  if (pondShape(x, z) < 0.95) continue;
  const s = rr(0.06, 0.15);
  put(pebbles, x, heightAt(x, z) + s * 0.25, z, rand(), rand() * 6, rand(), s, s * 0.7, s, tint(pick(PEBBLE_COLOURS)));
}
// the old stump and fallen log by the clearing are gone too; their spots stay until start.js so nothing moves
addSpot(-3.6, 4.6, 0.5);
noLongerHere.push([-3.6, 4.6]);
for (const k of [-1, 0, 1]) { const x = 7.6 + Math.cos(0.5) * 1.2 * k, z = -6.8 - Math.sin(0.5) * 1.2 * k; addSpot(x, z, 0.6); noLongerHere.push([x, z]); }
/* ---------- the rest of the world: grass, flowers, pebbles, bushes, boulders, stumps and logs ---------- */
withWorldRand(() => {
  const L = WALK_LIMIT, area = 4 * L * L;
  const fromStart = (x, z) => Math.hypot(x - CLEAR.x, z - CLEAR.z);
  // somewhere with room, at least minStart metres from where you start
  const findRoom = (minStart, gap, treeScale) => {
    for (let t = 0; t < 80; t++) {
      const x = rr(-L + 0.5, L - 0.5), z = rr(-L + 0.5, L - 0.5);
      if (fromStart(x, z) >= minStart && pondShape(x, z) >= 1.5 && roomAt(x, z, gap, treeScale)) return [x, z];
    }
    return null;
  };
  // grass everywhere you can walk (and a little way under the trees at the edge), as thick as round the clearing
  const G = WORLD_HALF + 4;
  for (let i = 0, n = Math.round(0.66 * 4 * G * G); i < n; i++) {
    const x = rr(-G, G), z = rr(-G, G);
    const pp = pondShape(x, z);
    if (fromStart(x, z) < 34 || pp < 0.86) continue;
    const s = rr(0.7, 1.35) * (pp < 1.3 ? 1.35 : 1);
    put(tufts, x, heightAt(x, z) - 0.03, z, 0, rand() * 6.28, 0, s, s * rr(0.8, 1.3), s, tint(pick(TUFT_COLOURS), 0.008, 0.05, 0.04));
  }
  // flowers, mostly in patches
  for (let i = 0, n = Math.round(0.3 * area); i < n; i++) {
    const x = rr(-L, L), z = rr(-L, L);
    if (fromStart(x, z) < 17.2 || pondShape(x, z) < 1.05) continue;
    if (rand() > 0.08 + 0.92 * smoothstep(0.5, 0.66, fbm(x * 0.07 + 500, z * 0.07 - 200))) continue;
    put(flowers, x, heightAt(x, z) + 0.13, z, 0, 0, 0, 1, 1, 1, tint(pick(FLOWER_COLOURS)));
  }
  for (let i = 0, n = Math.round(0.035 * area); i < n; i++) {
    const x = rr(-L, L), z = rr(-L, L);
    if (fromStart(x, z) < 14.5 || pondShape(x, z) < 0.95) continue;
    const s = rr(0.06, 0.15);
    put(pebbles, x, heightAt(x, z) + s * 0.25, z, rand(), rand() * 6, rand(), s, s * 0.7, s, tint(pick(PEBBLE_COLOURS)));
  }
  // bushes (no berries), sometimes in pairs
  const wildBush = (x, z, s) => {
    const y = groundY(x, z);
    const base = new THREE.Color(pick(BUSH_COLOURS));
    for (let k = 0; k < 3; k++) {
      const r = s * rr(0.48, 0.7) * (k ? 0.85 : 1);
      const ox = k ? rr(-0.45, 0.45) * s : 0, oz = k ? rr(-0.45, 0.45) * s : 0;
      put(wild.bush, x + ox, y + r * 0.6, z + oz, 0, rand() * 6, 0, r, r * 0.8, r, base.clone().offsetHSL(0, rr(-0.03, 0.03), rr(-0.03, 0.03)));
    }
    addSpot(x, z, s * 0.9);
  };
  for (let i = 0, n = Math.round(area / 125); i < n; i++) {
    const s = rr(0.75, 1.1);
    const at = findRoom(13, s * 0.9 + 0.3, 0.45);
    if (!at) continue;
    let pair = null;
    if (rand() < 0.35) {
      const a = rand() * Math.PI * 2, s2 = s * rr(0.7, 0.95), d = (s + s2) * 0.75;
      const x = at[0] + Math.cos(a) * d, z = at[1] + Math.sin(a) * d;
      if (squareDist(x, z) < L && pondShape(x, z) >= 1.5 && roomAt(x, z, s2 * 0.9 + 0.3, 0.45)) pair = [x, z, s2];
    }
    wildBush(at[0], at[1], s);
    if (pair) wildBush(...pair);
  }
  // boulders, sometimes with a smaller rock or two beside them
  const stone = (set, x, z, s) => put(set, x, groundY(x, z) + s * 0.16, z, rr(-0.2, 0.2), rand() * 6, rr(-0.2, 0.2),
    s * rr(0.9, 1.3), s * rr(0.55, 0.8), s * rr(0.9, 1.2), tint(pick(ROCK_COLOURS)));
  for (let i = 0, n = Math.round(area / 260); i < n; i++) {
    const s = rr(0.5, 1.2);
    const at = findRoom(14, s * 1.1 + 0.4, 0.5);
    if (!at) continue;
    const [x, z] = at, small = [];
    for (let k = 0, extra = rand() < 0.5 ? 1 + Math.floor(rand() * 2) : 0; k < extra; k++) {
      const a = rand() * Math.PI * 2, rs = s * rr(0.32, 0.55), d = s * 1.1 + rs + rr(0.05, 0.4);
      const rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d;
      if (small.some(([ox, oz, os]) => Math.hypot(ox - rx, oz - rz) < (os + rs) * 1.1)) continue;
      if (squareDist(rx, rz) < L && pondShape(rx, rz) >= 1.3 && roomAt(rx, rz, rs * 1.1, 0.5)) small.push([rx, rz, rs]);
    }
    stone(wild.boulders[Math.floor(rand() * 3)], x, z, s);
    addSpot(x, z, s * 1.1);
    // small rocks are drawn at least ROCK_MIN across, so they can't be mistaken for stones you pick up
    for (const [rx, rz, rs] of small) { const r2 = Math.max(rs, ROCK_MIN); stone(wild.rock, rx, rz, r2); addSpot(rx, rz, r2 * 1.1); }
  }
  // old tree stumps
  for (let i = 0, n = Math.round(area / 1500); i < n; i++) {
    const k = rr(0.8, 1.15);
    const at = findRoom(14, 0.55 * k + 0.3, 0.5);
    if (!at) continue;
    const [x, z] = at, y = groundY(x, z);
    skipPut(wild.stump, x, y + 0.17 * k, z, 0, rand() * 6, 0, k, k, k, tint('#7a5c40', 0.01, 0.04, 0.03));
    skipPut(wild.stumpTop, x, y + 0.39 * k, z, 0, 0, 0, k, k, k, tint('#cfb48a', 0.005, 0.03, 0.03));
    addSpot(x, z, 0.55 * k);
    noLongerHere.push([x, z]);
  }
  // fallen logs, on fairly flat ground
  for (let i = 0, n = Math.round(area / 2300); i < n; i++) {
    const k = rr(0.8, 1.1), a = rand() * Math.PI * 2, ex = Math.cos(a) * 1.71 * k, ez = -Math.sin(a) * 1.71 * k;
    for (let t = 0; t < 80; t++) {
      const x = rr(-L + 2.5, L - 2.5), z = rr(-L + 2.5, L - 2.5);
      const pts = [[x, z], [x + ex, z + ez], [x - ex, z - ez]];
      if (fromStart(x, z) < 15 || pts.some(([px, pz]) => pondShape(px, pz) < 1.5 || !roomAt(px, pz, 0.7, 0.45))) continue;
      const gs = pts.map(([px, pz]) => groundY(px, pz));
      if (Math.max(...gs) - Math.min(...gs) > 0.35) continue;
      const y = Math.max(...gs) - 0.04 + 0.24 * k;
      skipPut(wild.log, x, y, z, 0, a, 0, k, k, k, tint('#76583d', 0.01, 0.04, 0.03));
      const endC = tint('#cdb085', 0.005, 0.03, 0.03);
      skipPut(wild.logEnd, x + ex, y, z + ez, 0, a, 0, k, k, k, endC);
      skipPut(wild.logEnd, x - ex, y, z - ez, 0, a, 0, k, k, k, endC);
      for (const [px, pz] of pts) { addSpot(px, pz, 0.6); noLongerHere.push([px, pz]); }
      break;
    }
  }
});

// More berry bushes out in the wider world (berryBushes.extra in game-data.json), on their own random numbers
const BB = DATA.berryBushes || {};
withOwnRand(BB.seed || 7331, () => {
  const L = WALK_LIMIT - 2;
  let made = 0;
  for (let t = 0; t < 4000 && made < (BB.extra || 0); t++) {
    const x = rr(-L, L), z = rr(-L, L);
    if (Math.hypot(x - CLEAR.x, z - CLEAR.z) < 16 || pondShape(x, z) < 1.6 || !roomAt(x, z, 1.4, 0.8)) continue;
    if (berryBushes.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < 9)) continue;
    bush(x, z, rr(0.85, 1.05));
    made++;
  }
});
