/* ---------- the land ---------- */
// The world is a square, settings.worldSize metres across, with the clearing and pond in the middle.
// Past its edge is thick forest you can't walk into, and the land carries on into the haze.
const WORLD_HALF = Math.min(300, Math.max(40, Number(SETTINGS.worldSize) || 100)) / 2;
const WALK_LIMIT = WORLD_HALF - 2; // how far from the middle you can walk, along either axis
const WALL_DEPTH = 8;              // the thick forest past the edge, drawn in full detail
const FOREST_END = WORLD_HALF + 62; // after that the forest is simpler, out to here
const LAND_HALF = WORLD_HALF + 80;  // and the land carries on a little further, well into the haze
const squareDist = (x, z) => Math.max(Math.abs(x), Math.abs(z));
const POND = { x: -5.6, z: -0.9, r: 5.0 };
const CLEAR = { x: 0.6, z: 1.6 };
function pondShape(x, z) {
  const dx = x - POND.x, dz = (z - POND.z) * 1.22;
  const a = Math.atan2(dz, dx);
  const r = POND.r * (1 + 0.13 * Math.sin(a * 3 + 1.1) + 0.06 * Math.sin(a * 5 - 0.7));
  return Math.hypot(dx, dz) / r;
}
function baseHeight(x, z) {
  let h = (fbm(x * 0.045 + 12.3, z * 0.045 + 4.1) - 0.5) * 3.4;
  const dc = Math.hypot(x - CLEAR.x, z - CLEAR.z);
  h *= 0.22 + 0.78 * smoothstep(5, 17, dc);
  h += smoothstep(-6, -40, z) * 1.8 + smoothstep(14, 42, Math.abs(x)) * 1.3;
  return h;
}
const POND_BASE = baseHeight(POND.x, POND.z);
const WATER_Y = POND_BASE - 0.32;
function heightAt(x, z) {
  const p = pondShape(x, z);
  let h = baseHeight(x, z);
  h += (POND_BASE - h) * (1 - smoothstep(0.95, 1.7, p));
  h -= 1.3 * (1 - smoothstep(0.3, 1.0, p));
  return h;
}

const CELL = 2, SEG = Math.ceil((LAND_HALF * 2) / CELL), SIZE = SEG * CELL;
let tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
tg.rotateX(-Math.PI / 2);
{
  const p = tg.attributes.position;
  const cell = SIZE / SEG;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i);
    if (Math.abs(x) < SIZE / 2 - 0.1 && Math.abs(z) < SIZE / 2 - 0.1) {
      x += (hash(i, 7) - 0.5) * cell * 0.55;
      z += (hash(i, 13) - 0.5) * cell * 0.55;
    }
    p.setXYZ(i, x, heightAt(x, z), z);
  }
}
tg = tg.toNonIndexed();
tg.computeVertexNormals();
{
  const p = tg.attributes.position;
  const col = new Float32Array(p.count * 3);
  const GR1 = new THREE.Color('#9fb06b'), GR2 = new THREE.Color('#8da15c'), DRY = new THREE.Color('#c2b878');
  const LUSH = new THREE.Color('#7b9956'), MUD = new THREE.Color('#a29470'), BED = new THREE.Color('#6a8466'), DIRT = new THREE.Color('#b2a27a');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const n = fbm(cx * 0.12 + 40, cz * 0.12 - 7);
    c.copy(GR1).lerp(GR2, smoothstep(0.35, 0.7, n));
    c.lerp(DRY, smoothstep(0.56, 0.72, fbm(cx * 0.07 - 21, cz * 0.07 + 55)) * 0.85);
    const pp = pondShape(cx, cz);
    c.lerp(LUSH, (1 - smoothstep(1.0, 1.6, pp)) * 0.8);
    if (cy < WATER_Y + 0.22) c.lerp(MUD, 0.75);
    if (cy < WATER_Y - 0.05) c.copy(BED).lerp(MUD, 0.2);
    const dc = Math.hypot(cx - (CLEAR.x + 0.3), cz - (CLEAR.z + 0.2));
    c.lerp(DIRT, (1 - smoothstep(1.2, 2.7, dc + (n - 0.5) * 1.6)) * 0.7);
    const j = 1 + (hash(i, 99) - 0.5) * 0.07;
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = c.r * j; col[(i + k) * 3 + 1] = c.g * j; col[(i + k) * 3 + 2] = c.b * j;
    }
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
terrain.receiveShadow = true;
scene.add(terrain);
terrain.updateMatrixWorld();

// The exact height of the ground anywhere. Each 2 m square of the map keeps a list of the land's
// triangles over it, so this stays quick however big the world gets (it runs every step you take).
const groundCells = (() => {
  const p = tg.attributes.position.array, tris = p.length / 9, N = SEG;
  const cellOf = (v) => Math.min(N - 1, Math.max(0, Math.floor((v + SIZE / 2) / CELL)));
  const span = (t, fn) => {
    const o = t * 9;
    const x0 = cellOf(Math.min(p[o], p[o + 3], p[o + 6])), x1 = cellOf(Math.max(p[o], p[o + 3], p[o + 6]));
    const z0 = cellOf(Math.min(p[o + 2], p[o + 5], p[o + 8])), z1 = cellOf(Math.max(p[o + 2], p[o + 5], p[o + 8]));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) fn(cz * N + cx);
  };
  const start = new Uint32Array(N * N + 1);
  for (let t = 0; t < tris; t++) span(t, (c) => { start[c + 1]++; });
  for (let c = 0; c < N * N; c++) start[c + 1] += start[c];
  const list = new Uint32Array(start[N * N]);
  const fill = start.slice(0, N * N);
  for (let t = 0; t < tris; t++) span(t, (c) => { list[fill[c]++] = t; });
  return { p, N, cellOf, start, list };
})();
function groundY(x, z, p = groundCells.p) { // (p: the land's heights to use; landAsMade is the land before any flattening)
  const { N, cellOf, start, list } = groundCells;
  if (Math.abs(x) >= SIZE / 2 || Math.abs(z) >= SIZE / 2) return heightAt(x, z);
  const c = cellOf(z) * N + cellOf(x);
  for (let k = start[c]; k < start[c + 1]; k++) {
    const o = list[k] * 9;
    const ax = p[o], az = p[o + 2], bx = p[o + 3], bz = p[o + 5], cx = p[o + 6], cz = p[o + 8];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) return u * p[o + 1] + v * p[o + 4] + (1 - u - v) * p[o + 7];
  }
  return heightAt(x, z);
}

/* ---------- flat ground under placed things (0.1.17) ----------
   Each placed thing levels the land under it: fully flat out to FLAT_IN metres past its edges, blending back into the
   land by FLAT_OUT. The land's triangles are 2 m, so the flat part reaches past the thing to keep its whole square level.
   Worked out the same in every game from the list of placed things (oldest first, so a new thing next to an old one
   takes the ground the old one left, and never tilts it). It goes back to the land as made when the thing is removed. */
const FLAT_IN = 1.4, FLAT_OUT = 2.8;
const landAsMade = groundCells.p.slice();
const flatLock = new Float32Array(landAsMade.length / 3); // how flat each corner already is (1: under something placed)
let flatTouched = [];
// how far x, z is outside a placed thing's square (0 inside): f is { x, z, rot, hw, hd }
function outsideRect(f, x, z) {
  const dx = x - f.x, dz = z - f.z, c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - f.hw), Math.max(0, Math.abs(lz) - f.hd));
}
const flatWeight = (f, x, z) => { const d = outsideRect(f, x, z); return d <= FLAT_IN ? 1 : 1 - smoothstep(FLAT_IN, FLAT_OUT, d); };
const flatReach = (f) => Math.hypot(f.hw, f.hd) + FLAT_OUT;
// the ground over a placed thing's square (and a margin): its average height, and highest minus lowest
function groundUnder(f, margin = 0) {
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  const ex = f.hw + margin, ez = f.hd + margin, c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
  const stepsX = Math.max(1, Math.ceil(ex / 0.25)), stepsZ = Math.max(1, Math.ceil(ez / 0.25));
  for (let i = -stepsX; i <= stepsX; i++) for (let j = -stepsZ; j <= stepsZ; j++) {
    const lx = (i / stepsX) * ex, lz = (j / stepsZ) * ez;
    const h = groundY(f.x + lx * c + lz * s, f.z - lx * s + lz * c);
    sum += h; n++; lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return { y: sum / n, rise: hi - lo };
}
// every land corner near x, z (each copy of a corner, as the land's triangles don't share them)
function landCornersNear(x, z, r, fn) {
  const { N, cellOf, start, list } = groundCells, seen = new Set();
  for (let cz = cellOf(z - r); cz <= cellOf(z + r); cz++) for (let cx = cellOf(x - r); cx <= cellOf(x + r); cx++) {
    const c = cz * N + cx;
    for (let k = start[c]; k < start[c + 1]; k++) for (let q = 0; q < 3; q++) { const v = list[k] * 3 + q; if (!seen.has(v)) { seen.add(v); fn(v); } }
  }
}
// level the land under these things (all of them, every time the list changes); gives each one its height, f.y.
// keep(x, z, from, to) can say how much of the way from its height to `to` the land corner at x, z may go (0 to 1).
// Trees, rocks and bushes go up or down with the ground instead (liftNear in game/world-build.js).
function setFlats(list, keep = () => 1) {
  const p = groundCells.p;
  for (const v of flatTouched) { p[v * 3 + 1] = landAsMade[v * 3 + 1]; flatLock[v] = 0; }
  flatTouched = [];
  for (const f of [...list].sort((a, b) => a.id - b.id)) {
    f.y = groundUnder(f).y;
    landCornersNear(f.x, f.z, flatReach(f), (v) => {
      if (landAsMade[v * 3 + 1] < WATER_Y + 0.25) return; // the pond's bank and bed stay as they are
      const w = flatWeight(f, p[v * 3], p[v * 3 + 2]) * (1 - flatLock[v]) * keep(p[v * 3], p[v * 3 + 2], p[v * 3 + 1], f.y);
      if (w <= 0) return;
      if (!flatLock[v]) flatTouched.push(v);
      p[v * 3 + 1] += (f.y - p[v * 3 + 1]) * w;
      flatLock[v] = Math.min(1, flatLock[v] + w);
    });
  }
  tg.attributes.position.needsUpdate = true;
  tg.computeBoundingSphere();
}

/* water */
const waterGeo = new THREE.PlaneGeometry(15, 12.5, 30, 25);
waterGeo.rotateX(-Math.PI / 2);
// keep only the water inside the pond's outline, so low bits of the bank never show water
const waterTris = (() => {
  const g = waterGeo.toNonIndexed(), a = g.attributes.position.array, keep = [];
  for (let i = 0; i < a.length; i += 9) {
    const inPond = [0, 3, 6].some((k) => pondShape(a[i + k] + POND.x, a[i + k + 2] + POND.z) < 0.98);
    if (inPond) for (let k = 0; k < 9; k++) keep.push(a[i + k]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  out.computeVertexNormals();
  return out;
})();
const water = new THREE.Mesh(waterTris, new THREE.MeshStandardMaterial({ color: '#86bdb7', roughness: 0.16, metalness: 0, transparent: true, opacity: 0.86, flatShading: true }));
water.position.set(POND.x, WATER_Y, POND.z);
water.receiveShadow = true;
water.userData.label = 'Pond';
scene.add(water);
const waterBase = water.geometry.attributes.position.array.slice();
function animateWater(t) {
  const a = water.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i += 3) {
    const x = waterBase[i], z = waterBase[i + 2];
    a[i + 1] = Math.sin(x * 1.35 + t * 0.55) * 0.012 + Math.sin(z * 1.8 - t * 0.45 + x * 0.4) * 0.01; // a gentle ripple
  }
  water.geometry.attributes.position.needsUpdate = true;
  water.geometry.computeVertexNormals();
}
animateWater(0);
