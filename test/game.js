import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const app = document.getElementById('app');
const canvas = document.getElementById('world');
const labelsEl = document.getElementById('labels');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- helpers ---------- */
// Two streams of random numbers: one lays out the starting clearing exactly as it has always looked,
// the other lays out the rest of the world, so changing the world's size never reshuffles the clearing.
let seed = 20261120, seed2 = 52611;
const startRand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const worldRand = () => { seed2 = (seed2 * 16807) % 2147483647; return (seed2 - 1) / 2147483646; };
let useRand = startRand;
const rand = () => useRand();
function withWorldRand(fn) { useRand = worldRand; try { fn(); } finally { useRand = startRand; } }
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, k) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
function hash(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const fbm = (x, z) => vnoise(x, z) * 0.58 + vnoise(x * 2.03 + 17, z * 2.03 + 9) * 0.28 + vnoise(x * 4.1 + 3, z * 4.1 + 31) * 0.14;
const tint = (hex, h = 0.01, s = 0.05, l = 0.035) => new THREE.Color(hex).offsetHSL(rr(-h, h), rr(-s, s), rr(-l, l));
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, flatShading: true, ...o });

/* ---------- renderer, camera, light ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('noGL').hidden = false;
  throw err;
}
const HAZE = '#e3e0c8';
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(HAZE, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HAZE, 36, 96);

const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
const hemi = new THREE.HemisphereLight('#f4f2e1', '#7b8857', 2.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d4', 2.35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 85 }); // just deep enough for the 52 m square round you
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);
const SUN_OFFSET = V(-24, 36, 15);

/* ---------- the game's data: index.html loads it first (always fresh), then this file ---------- */
const DATA = window.GAME_DATA;
const SETTINGS = { carryCapacity: 30, walkSpeed: 2.2, worldSize: 100, needsSpeed: 1, ...(DATA.settings || {}) };
const VERSION = String(DATA.version || '0.0.0');
const TEST_BUILD = location.pathname.includes('/test/'); // the test copy, before it's released
const VERSION_LABEL = TEST_BUILD ? `${VERSION} (test ${DATA.build || 1})` : VERSION;
for (const el of document.querySelectorAll('.ver')) el.textContent = VERSION_LABEL;
document.title = `Game Prototype v${VERSION_LABEL}`;

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
function groundY(x, z) {
  const { p, N, cellOf, start, list } = groundCells;
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

/* ---------- instanced nature ---------- */
// Many copies of one shape (a tree trunk, a tuft of grass) are drawn together as one InstancedMesh.
// Most are collected into sets first and built once the world is laid out:
// - a set can split its copies into chunks of the map, so the parts you can't see aren't drawn
// - a detail set (grass, flowers, pebbles) only draws the copies near you, refilled as you walk
const dummy = new THREE.Object3D();
let DRY = false; // while true, put() works a copy out but doesn't keep it (so the clearing's layout never changes)
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
    if (m.lod) {
      const simple = make(m.lod, false);
      simple.visible = false;
      const [x, z] = chunkCentre(key);
      lodPairs.push({ x, z, full: mesh, simple });
    }
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
    const dx = xs[i] - px, dz = zs[i] - pz, r = near + (far - near) * us[i];
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
function pine(x, z, s, o = {}) {
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
const berries = IM(new THREE.IcosahedronGeometry(0.065, 0), mat('#ffffff', { roughness: 0.5 }), 400, true);
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
function rock(x, z, s, label = 'Boulder', color) {
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
[[1.1, 4.0, 0.17], [1.42, 4.3, 0.13], [0.82, 4.42, 0.12]].forEach(([x, z, s]) => {
  const m = new THREE.Mesh(flintGeo, mat(tint('#6b6a68', 0.02, 0.04, 0.03), { roughness: 0.55 }));
  m.position.set(x, groundY(x, z) + s * 0.35, z);
  m.scale.set(s, s * 0.75, s * 1.2);
  m.rotation.set(rand(), rand() * 6, rand());
  m.castShadow = m.receiveShadow = true;
  m.userData.label = 'Flint';
  scene.add(m);
  drawAlong(drawnTogether.flint, m);
  interactive.push(m);
});
const PEBBLE_COLOURS = ['#a9a397', '#9a948a', '#b5ae9f'];
const pebbles = makeDetail(rockGeos[0], mat('#ffffff'), { cap: 500, near: 18, far: 28, shadow: true });
for (let i = 0; i < 90; i++) {
  const a = rand() * Math.PI * 2, d = 1.5 + Math.sqrt(rand()) * 13;
  const x = CLEAR.x + Math.cos(a) * d, z = CLEAR.z + Math.sin(a) * d;
  if (pondShape(x, z) < 0.95) continue;
  const s = rr(0.06, 0.15);
  put(pebbles, x, heightAt(x, z) + s * 0.25, z, rand(), rand() * 6, rand(), s, s * 0.7, s, tint(pick(PEBBLE_COLOURS)));
}
{
  const g = new THREE.Group();
  const x = -3.6, z = 4.6;
  g.position.set(x, groundY(x, z), z);
  const body = new THREE.Mesh(wild.stump.geo, mat('#7a5c40'));
  body.position.y = 0.17;
  const top = new THREE.Mesh(wild.stumpTop.geo, mat('#cfb48a'));
  top.position.y = 0.39;
  g.add(body, top);
  g.userData.label = 'Tree stump';
  scene.add(g);
  drawAlong(wild.stump, body);
  drawAlong(wild.stumpTop, top);
  addSpot(x, z, 0.5);
  interactive.push(g);
}
{
  const g = new THREE.Group();
  const x = 7.6, z = -6.8;
  g.position.set(x, groundY(x, z) + 0.24, z);
  const log = new THREE.Mesh(wild.log.geo, mat('#76583d'));
  const endM = mat('#cdb085');
  const e1 = new THREE.Mesh(wild.logEnd.geo, endM);
  e1.position.x = 1.71;
  const e2 = e1.clone(); e2.position.x = -1.71;
  g.add(log, e1, e2);
  g.rotation.y = 0.5;
  g.userData.label = 'Fallen log';
  scene.add(g);
  drawAlong(wild.log, log);
  for (const k of [-1, 0, 1]) addSpot(x + Math.cos(0.5) * 1.2 * k, z - Math.sin(0.5) * 1.2 * k, 0.6);
  drawAlong(wild.logEnd, e1);
  drawAlong(wild.logEnd, e2);
  interactive.push(g);
}

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
    for (const [rx, rz, rs] of small) { stone(wild.rock, rx, rz, rs); addSpot(rx, rz, rs * 1.1); }
  }
  // old tree stumps
  for (let i = 0, n = Math.round(area / 1500); i < n; i++) {
    const k = rr(0.8, 1.15);
    const at = findRoom(14, 0.55 * k + 0.3, 0.5);
    if (!at) continue;
    const [x, z] = at, y = groundY(x, z);
    put(wild.stump, x, y + 0.17 * k, z, 0, rand() * 6, 0, k, k, k, tint('#7a5c40', 0.01, 0.04, 0.03));
    put(wild.stumpTop, x, y + 0.39 * k, z, 0, 0, 0, k, k, k, tint('#cfb48a', 0.005, 0.03, 0.03));
    addSpot(x, z, 0.55 * k);
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
      put(wild.log, x, y, z, 0, a, 0, k, k, k, tint('#76583d', 0.01, 0.04, 0.03));
      const endC = tint('#cdb085', 0.005, 0.03, 0.03);
      put(wild.logEnd, x + ex, y, z + ez, 0, a, 0, k, k, k, endC);
      put(wild.logEnd, x - ex, y, z - ez, 0, a, 0, k, k, k, endC);
      for (const [px, pz] of pts) addSpot(px, pz, 0.6);
      break;
    }
  }
});

/* ---------- build everything collected above ---------- */
const woodMat = mat('#8a6847');
const leafSmall = mat('#6f9a4e');
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
for (const set of [...Object.values(far), drawnTogether.bushes, ...drawnTogether.rocks, drawnTogether.flint]) buildSet(set);
for (const set of [...Object.values(near), wild.bush, ...wild.boulders, wild.rock, wild.stump, wild.stumpTop, wild.log, wild.logEnd]) {
  interactive.push(...buildSet(set));
}
const DETAILS = [tufts, flowers, pebbles];
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
   Pocket life prototype
   The game's content lives in game-data.json beside this page:
   settings, items (with weights), recipes, needs, things to use, day
   and night, character looks and body shapes. Adding things later means editing that small file, not this
   code. Everything in the world is also kept as plain data (world.items
   and you), ready to be saved or sent to a server later.
   ===================================================================== */

/* ---------- the game's data (loaded at the top, before the world was built) ---------- */
const LOOKS = DATA.looks;
const BODY_SHAPES = DATA.bodyShapes;
// how a new person starts out (defaultLook in the data; anything missing falls back to the first choice)
const pickId = (list, id) => (list.some((o) => o.id === id) ? id : list[0].id);
const DL = DATA.defaultLook || {};
const DEFAULT_LOOK = {
  name: '',
  age: Math.round(Math.min(LOOKS.age.max, Math.max(LOOKS.age.min, Number(DL.age) || LOOKS.age.start))),
  ...Object.fromEntries(['sex', 'skin', 'build', 'hair', 'hairColour', 'tunic'].map((k) => [k, pickId(LOOKS[k], DL[k])])),
};
const find = (list, id) => list.find((o) => o.id === id) || list[0];
const deg = THREE.MathUtils.degToRad;
const $ = (id) => document.getElementById(id);
const fmt = (n) => String(Math.round(n * 10) / 10);
woodMat.userData.shared = true;

/* ---------- item shapes: the data picks one of these and sets its sizes and colour ---------- */
const matCache = new Map();
function matFor(colour) {
  const key = colour || '#9a948a';
  if (!matCache.has(key)) { const m = mat(key); m.userData.shared = true; matCache.set(key, m); }
  return matCache.get(key);
}
// a stick (with its little side twig) as one shape, made once and shared
const rodGeos = new Map();
function rodGeo(len, t, twig) {
  const key = `${len}|${t}|${!!twig}`;
  if (!rodGeos.has(key)) {
    const parts = [new THREE.CylinderGeometry(t * 0.85, t, len, 5).rotateZ(Math.PI / 2)];
    if (twig) {
      const nub = new THREE.CylinderGeometry(t * 0.5, t * 0.62, len * 0.22, 5);
      nub.applyMatrix4(new THREE.Matrix4().compose(V(len * 0.16, t * 0.5, t * 1.7),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -0.8)), V(1, 1, 1)));
      parts.push(nub);
    }
    rodGeos.set(key, mergeGeometries(parts));
  }
  return rodGeos.get(key);
}
const SHAPES = {
  rod(look) {
    const len = look.length ?? 0.6, t = look.thickness ?? 0.03;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(rodGeo(len, t, look.twig), matFor(look.colour)));
    return { model: g, rest: t, hold: 'rod', hit: [len + 0.3, 0.3, 0.36] };
  },
  rock(look) {
    const s = look.size ?? 0.12;
    const m = new THREE.Mesh(rockGeos[Math.floor(rand() * rockGeos.length)], matFor(look.colour));
    m.scale.set(s, s * 0.72, s * 0.9);
    m.rotation.set(rand(), rand() * 6, rand());
    const g = new THREE.Group();
    g.add(m);
    return { model: g, rest: s * 0.42, hold: 'palm', hitR: Math.max(0.2, s * 1.7) };
  },
  ball(look) {
    const s = look.size ?? 0.08;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), matFor(look.colour)));
    return { model: g, rest: s * 0.95, hold: 'palm', hitR: Math.max(0.18, s * 2.2) };
  },
  box(look) {
    const w = look.width ?? 0.2, h = look.height ?? 0.12, d = look.depth ?? 0.2;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matFor(look.colour)));
    return { model: g, rest: h / 2, hold: 'palm', hit: [w + 0.2, h + 0.2, d + 0.2] };
  },
};

/* ---------- items and recipes from the data, checked so a typo can't break the game ---------- */
const ITEMS = {};
for (const [id, raw] of Object.entries(DATA.items || {})) {
  const look = { ...(raw.look || {}) };
  if (!SHAPES[look.shape]) { console.warn(`Item "${id}" has an unknown shape "${look.shape}", so it's drawn as a rock.`); look.shape = 'rock'; }
  const name = raw.name || id;
  ITEMS[id] = {
    id,
    name,
    plural: raw.plural || name + 's',
    weight: Number.isFinite(raw.weight) ? raw.weight : 1,
    look,
    startInWorld: Math.max(0, Math.floor(raw.startInWorld || 0)),
    startNear: Math.max(0, Math.floor(raw.startNear ?? 4)),
  };
  ITEMS[id].startNear = Math.min(ITEMS[id].startNear, ITEMS[id].startInWorld);
}
const RECIPES = (DATA.recipes || []).filter((r) => {
  const ok = r && r.id && r.needs && r.makes && [...Object.keys(r.needs), ...Object.keys(r.makes)].every((k) => ITEMS[k]);
  if (!ok) console.warn('Skipping a recipe that names an item that does not exist:', r);
  return ok;
});
const buildItem = (kind) => SHAPES[ITEMS[kind].look.shape](ITEMS[kind].look);
const countLabel = (kind, n) => `${n} ${n === 1 ? ITEMS[kind].name : ITEMS[kind].plural}`;
const shadowsOn = (obj) => { obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return obj; };

/* ---------- needs (health, hunger, thirst...) and things you can use, from the data ---------- */
const STATS = (DATA.stats || []).filter((s) => s && s.id).map((s) => ({ name: s.id, colour: '#8a8a7a', start: 100, perHour: 0, ...s }));
const STAT = Object.fromEntries(STATS.map((s) => [s.id, s]));
// food you carry: what eating one gives, like { "hunger": 5 }
for (const [id, raw] of Object.entries(DATA.items || {})) {
  if (ITEMS[id]) ITEMS[id].eat = Object.fromEntries(Object.entries(raw.eat || {}).filter(([k, v]) => STAT[k] && Number.isFinite(v)));
}
const SOURCES = {};
for (const [id, raw] of Object.entries(DATA.sources || {})) {
  const gives = Object.fromEntries(Object.entries(raw.gives || {}).filter(([k, v]) => STAT[k] && Number.isFinite(v)));
  // harvest: what picking it puts in your inventory; regrowHours: how long until it can be picked again
  const harvest = Object.fromEntries(Object.entries(raw.harvest || {}).filter(([k, v]) => ITEMS[k] && v >= 1).map(([k, v]) => [k, Math.floor(v)]));
  SOURCES[id] = { id, name: raw.name || id, action: raw.action || '', verb: raw.verb || 'Using', seconds: Math.max(0.3, Number(raw.seconds) || 1), pose: raw.pose || 'pick',
    gives, harvest, holds: Math.floor(Number(raw.holds) || 0), regrowHours: Math.max(0, Number(raw.regrowHours) || 0) };
}
const harvests = (src) => Object.keys(src.harvest).length > 0;
// a thing in the world becomes usable when a source has its name, like "Pond" or "Berry bush"
for (const obj of interactive) {
  const src = Object.values(SOURCES).find((s) => s.name === obj.userData.label);
  if (src) obj.userData.source = src.id;
}
for (const b of berryBushes) drawBerries(b);

/* ---------- people ---------- */
const HIP_Y = 0.86, WAIST_Y = 1.08;
const headGeo = new THREE.IcosahedronGeometry(0.16, 1);
const capGeo = new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
const longHairGeo = new THREE.CylinderGeometry(0.168, 0.188, 0.34, 10, 1, true, Math.PI * 0.5, Math.PI);
const bunGeo = new THREE.IcosahedronGeometry(0.078, 0);
const eyeGeo = new THREE.IcosahedronGeometry(0.018, 0);
const handGeo = new THREE.IcosahedronGeometry(0.05, 0);
const footGeo = new THREE.BoxGeometry(0.11, 0.07, 0.21).translate(0, -0.035, 0.035);
const yokeGeo = new THREE.IcosahedronGeometry(1, 1);
const footMat = mat('#5b4636');
footMat.userData.shared = true;
const eyeMat = mat('#2a2420');
eyeMat.userData.shared = true;
const greyHair = new THREE.Color('#aaa59d');
function hairColourFor(look) {
  const c = new THREE.Color(find(LOOKS.hairColour, look.hairColour).hex);
  return c.lerp(greyHair, clamp01((look.age - 50) / 30) * 0.85);
}
const own = (geo) => { geo.userData.perPerson = true; return geo; };
function makePerson(look) {
  const B = BODY_SHAPES[find(LOOKS.sex, look.sex).id] || Object.values(BODY_SHAPES)[0];
  const w = find(LOOKS.build, look.build).w;
  const tunic = find(LOOKS.tunic, look.tunic);
  const skin = mat(find(LOOKS.skin, look.skin).hex);
  const hair = mat(hairColourFor(look), { side: THREE.DoubleSide });
  const cloth = mat(tunic.hex);
  const cord = mat(tunic.cord);
  const g = new THREE.Group();
  const parts = {};

  // legs hang from the hips
  const legGeo = own(new THREE.CylinderGeometry(B.leg[0] * w, B.leg[1] * w, 0.8, 6).translate(0, -0.4, 0));
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(B.hipGap * w * side, HIP_Y, 0);
    const f = new THREE.Mesh(footGeo, footMat);
    f.position.y = -0.8;
    hip.add(new THREE.Mesh(legGeo, skin), f);
    g.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
  }

  // everything above the hips hangs off one group, so older people can stoop
  const body = new THREE.Group();
  body.position.y = HIP_Y;
  g.add(body);
  const waistY = WAIST_Y - HIP_Y;
  const topY = waistY + B.torsoLength;
  const skirt = new THREE.Mesh(own(new THREE.CylinderGeometry(B.waist * w + 0.006, B.hem * w, B.tunicLength, 8)), cloth);
  skirt.position.y = waistY - B.tunicLength / 2;
  const torso = new THREE.Mesh(own(new THREE.CylinderGeometry(B.chest * w, B.waist * w, B.torsoLength, 8)), cloth);
  torso.position.y = waistY + B.torsoLength / 2;
  const belt = new THREE.Mesh(own(new THREE.CylinderGeometry(B.waist * w + 0.014, B.waist * w + 0.014, 0.05, 8)), cord);
  belt.position.y = waistY;
  // rounded shoulders that cover where the arms join
  const yoke = new THREE.Mesh(yokeGeo, cloth);
  yoke.position.y = topY - 0.01;
  yoke.scale.set((B.shoulder + B.arm[0]) * w * 1.03, 0.07, B.chest * w * 0.98);
  const neck = new THREE.Mesh(own(new THREE.CylinderGeometry(B.neck, B.neck * 1.12, 0.14, 6)), skin);
  neck.position.y = topY + 0.06;
  body.add(skirt, torso, belt, yoke, neck);
  parts.torso = torso;

  // head and hair
  const headG = new THREE.Group();
  headG.position.y = topY + 0.13 + 0.15 * B.head;
  headG.scale.setScalar(B.head);
  body.add(headG);
  const head = new THREE.Mesh(headGeo, skin);
  head.scale.set(0.95, 1.08, 1);
  headG.add(head);
  if (look.hair !== 'shaved') {
    const cap = new THREE.Mesh(capGeo, hair);
    cap.position.set(0, 0.012, -0.012);
    cap.rotation.x = -0.3;
    headG.add(cap);
  }
  if (look.hair === 'long') {
    const back = new THREE.Mesh(longHairGeo, hair);
    back.position.set(0, -0.13, -0.012);
    headG.add(back);
  }
  if (look.hair === 'tied') {
    const bun = new THREE.Mesh(bunGeo, hair);
    bun.position.set(0, 0.1, -0.17);
    headG.add(bun);
  }
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(0.055 * s, 0, 0.148);
    headG.add(e);
  }

  // arms hang from the shoulders, angled out so hands clear the tunic
  const armGeo = own(new THREE.CylinderGeometry(B.arm[0] * w, B.arm[1] * w, 0.58, 6).translate(0, -0.29, 0));
  const sleeveGeo = own(new THREE.CylinderGeometry(B.arm[0] * w + 0.02, B.arm[0] * w + 0.014, 0.17, 6).translate(0, -0.06, 0));
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(B.shoulder * w * side, topY - 0.045, 0);
    sh.userData.spread = B.armSpread * side;
    sh.rotation.z = sh.userData.spread;
    const hand = new THREE.Mesh(handGeo, skin);
    hand.position.y = -0.6;
    sh.add(new THREE.Mesh(armGeo, skin), new THREE.Mesh(sleeveGeo, cloth), hand);
    body.add(sh);
    parts[side < 0 ? 'armL' : 'armR'] = sh;
    parts[side < 0 ? 'handL' : 'handR'] = hand;
  }

  body.userData.stoop = clamp01((look.age - 62) / 25) * 0.12;
  body.rotation.x = body.userData.stoop;
  parts.body = body;
  g.scale.setScalar(B.height);
  g.userData.parts = parts;
  g.userData.headTop = (topY + 0.13 + 0.15 * B.head + 0.2 * B.head + HIP_Y) * B.height;
  return shadowsOn(g);
}
// arm pose: x swings forward/back, the outward spread stays the same
function setArm(arm, x) { arm.rotation.set(x, 0, arm.userData.spread); }
function disposeMaterials(obj) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (x && !x.userData.shared) x.dispose();
    if (m.geometry && m.geometry.userData.perPerson) m.geometry.dispose();
  });
}

/* ---------- the little stage you see while making your person ---------- */
const pscene = new THREE.Scene();
pscene.fog = new THREE.Fog(HAZE, 9, 22);
const pcam = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
pcam.position.set(1.75, 1.75, 5.4);
pcam.lookAt(0, 0.95, 0);
pscene.add(new THREE.HemisphereLight('#f4f2e1', '#7b8857', 2.05));
const psun = new THREE.DirectionalLight('#fff0d4', 2.3);
psun.position.set(-3.5, 6, 3.2);
psun.castShadow = true;
psun.shadow.mapSize.set(1024, 1024);
Object.assign(psun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
psun.shadow.bias = -0.0008;
psun.shadow.normalBias = 0.02;
pscene.add(psun);
{
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.6, 0.28, 11), [mat('#9d8c68'), mat('#9fb06b'), mat('#9d8c68')]);
  disc.position.y = -0.14;
  disc.receiveShadow = true;
  pscene.add(disc);
  const tuftMat = mat('#a9b86f', { side: THREE.DoubleSide });
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, d = 0.6 + Math.sqrt(rand()) * 0.75;
    const t = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, rr(0.22, 0.34), 3, 1, true), tuftMat);
      c.position.set((k - 1) * 0.03, 0.13, (k % 2) * 0.03);
      c.rotation.z = (k - 1) * 0.3;
      t.add(c);
    }
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.rotation.y = rand() * 6;
    pscene.add(t);
  }
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2, d = 0.6 + rand() * 0.75;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(pick(['#f3efe1', '#ecd36a', '#e2a8b4', '#b8a5d9'])));
    f.position.set(Math.cos(a) * d, 0.09, Math.sin(a) * d);
    pscene.add(f);
  }
  const stone = new THREE.Mesh(rockGeos[0], mat('#a9a397'));
  stone.position.set(-1.0, 0.05, -0.55);
  stone.scale.set(0.26, 0.18, 0.22);
  stone.castShadow = stone.receiveShadow = true;
  pscene.add(stone);
}
let draft = { ...DEFAULT_LOOK };
let previewPerson = null, previewSpin = 0.3, previewDrag = null;
function refreshPreview() {
  if (previewPerson) { pscene.remove(previewPerson); disposeMaterials(previewPerson); }
  previewPerson = makePerson(draft);
  previewPerson.rotation.y = previewSpin;
  pscene.add(previewPerson);
}
function renderCreator(w, h) {
  renderer.setClearColor(HAZE, 1);
  const appTop = app.getBoundingClientRect().top;
  const top = Math.max(0, $('creatorHead').getBoundingClientRect().bottom - appTop);
  const bottom = Math.min(h, $('sheet').getBoundingClientRect().top - appTop + 24);
  const ah = Math.max(80, bottom - top);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();
  renderer.setScissorTest(true);
  renderer.setScissor(0, h - bottom, w, ah);
  renderer.setViewport(0, h - bottom, w, ah);
  pcam.aspect = w / ah;
  pcam.updateProjectionMatrix();
  renderer.render(pscene, pcam);
  renderer.setScissorTest(false);
}

/* ---------- the world's items: plain data plus what's drawn for each ---------- */
const world = { items: [] }; // { id, kind, x, z, rot }
const itemViews = new Map();
let nextItemId = 1;
// every thing on the ground has an invisible hit area round it, a bit bigger than it is, so it's easy to tap or click
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const HIT_BOX = new THREE.BoxGeometry(1, 1, 1), HIT_BALL = new THREE.SphereGeometry(1, 8, 6);
function addWorldItem(kind, x, z, rot) {
  const item = { id: nextItemId++, kind, x, z, rot };
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

/* ---------- you: plain data, plus your 3D person ---------- */
const START = { x: 0.6, z: 1.9 };
const you = { look: null, carry: {}, lastKind: null, lifeStart: 0, stats: null, statsAt: 0, dead: false }; // carry: item id -> how many; stats: need -> 0 to 100
const ui = { mode: 'creator' };
let player = null, playerGround = 0, heldView = null;
const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.54, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#fbf8eb', transparent: true, opacity: 0.7, depthWrite: false }));
scene.add(ring);
const tapMark = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#fbf8eb', transparent: true, opacity: 0, depthWrite: false }));
scene.add(tapMark);

/* carrying: everything has a weight, and you can carry up to SETTINGS.carryCapacity */
const weightOf = (counts) => Object.entries(counts).reduce((sum, [k, n]) => sum + (ITEMS[k] ? ITEMS[k].weight * n : 0), 0);
const carried = () => weightOf(you.carry);
const carryingAnything = () => Object.keys(you.carry).length > 0;
function addToCarry(kind, n = 1) {
  you.carry[kind] = (you.carry[kind] || 0) + n;
  you.lastKind = kind;
}
function takeFromCarry(kind, n = 1) {
  const have = you.carry[kind] || 0;
  const taken = Math.min(have, n);
  if (taken <= 0) return 0;
  if (have - taken > 0) you.carry[kind] = have - taken;
  else delete you.carry[kind];
  if (!you.carry[you.lastKind]) you.lastKind = Object.keys(you.carry)[0] || null;
  return taken;
}
// the thing you picked up last is shown in your hand
function drawHeld() {
  if (heldView) { if (heldView.parent) heldView.parent.remove(heldView); heldView = null; }
  if (!player || !you.lastKind || !you.carry[you.lastKind]) return;
  const { model, hold } = buildItem(you.lastKind);
  const wrap = new THREE.Group();
  if (hold === 'rod') { model.rotation.y = -Math.PI / 2; wrap.rotation.x = 0.25; wrap.position.set(0, -0.02, 0.12); }
  else wrap.position.set(0, -0.07, 0.03);
  wrap.add(model);
  heldView = shadowsOn(wrap);
  player.userData.parts.handR.add(heldView);
}
function spawnPlayer(look) {
  you.look = look;
  player = makePerson(look);
  player.userData.label = 'You';
  playerGround = groundY(START.x, START.z);
  player.position.set(START.x, playerGround, START.z);
  player.rotation.y = 0.62;
  scene.add(player);
  interactive.push(player);
  drawHeld();
}
function removePlayer() {
  goOffline();
  if (!player) return;
  scene.remove(player);
  disposeMaterials(player);
  const i = interactive.indexOf(player);
  if (i >= 0) interactive.splice(i, 1);
  player = null;
  heldView = null;
}

/* ---------- labels over the world ---------- */
const labels = [];
let elapsed = 0, tagLabel = null;
function addLabel(o) {
  const el = document.createElement('div');
  el.className = 'lbl3d ' + o.cls;
  el.textContent = o.text;
  labelsEl.appendChild(el);
  const L = { el, born: elapsed, ttl: Infinity, gap: 10, rise: 0, offset: V(), ...o };
  labels.push(L);
  return L;
}
function removeLabel(L) {
  if (!L) return;
  const i = labels.indexOf(L);
  if (i >= 0) labels.splice(i, 1);
  L.el.remove();
}
function showTag(text, pos, gap = 10, ttl = 2.2) {
  removeLabel(tagLabel);
  tagLabel = addLabel({ cls: 'tag3d', text, anchor: pos.clone(), ttl, gap });
}
function showGain(text) { addLabel({ cls: 'gain', text, anchor: headTop(), ttl: 1.3, rise: 0.5, gap: 4 }); }
const headTop = () => V(player.position.x, playerGround + player.userData.headTop + 0.1, player.position.z);
const tmp = V();
function updateLabels() {
  const w = app.clientWidth, h = app.clientHeight;
  for (let i = labels.length - 1; i >= 0; i--) {
    const L = labels[i];
    const age = elapsed - L.born;
    if (age > L.ttl) { removeLabel(L); if (L === tagLabel) tagLabel = null; continue; }
    tmp.copy(L.anchor).add(L.offset);
    tmp.y += L.rise * age;
    tmp.project(camera);
    const sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h;
    const bw = L.bw || (L.bw = L.el.offsetWidth), bh = L.bh || (L.bh = L.el.offsetHeight);
    const left = Math.max(8, Math.min(w - bw - 8, sx - bw / 2));
    L.el.style.transform = `translate(${left.toFixed(1)}px, ${(sy - bh - L.gap).toFixed(1)}px)`;
    const fade = Math.min(Math.min(1, age / 0.2), clamp01((L.ttl - age) / 0.4));
    L.el.style.opacity = tmp.z < 1 ? fade.toFixed(2) : '0';
  }
}

/* ---------- the clock and the info at the edges ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDate = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const formatTime = (d) => `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
function drawHud() {
  if (!you.look) return;
  $('hudName').textContent = you.look.name;
  $('hudAge').textContent = String(you.look.age);
  const now = new Date(); // the world runs on real time
  $('hudTime').textContent = `${formatDate(now)} · ${formatTime(now)}`;
}
function drawWeightBar(bar, w) {
  bar.style.width = `${Math.min(100, (w / SETTINGS.carryCapacity) * 100)}%`;
  bar.parentElement.classList.toggle('full', w >= SETTINGS.carryCapacity);
}
function drawCarry() {
  const w = carried();
  $('carryWeight').textContent = fmt(w);
  $('carryMax').textContent = fmt(SETTINGS.carryCapacity);
  if (bagOpen()) drawBag();
}
let hintTimer = 0;
function showHint() { $('hint').hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 15000); }
function hideHint() { $('hint').hidden = true; }

/* ---------- needs: they change with real time, even while you're away ---------- */
const clampStat = (v) => Math.max(0, Math.min(100, v));
const freshStats = () => Object.fromEntries(STATS.map((s) => [s.id, clampStat(s.start)]));
function buildNeeds() {
  $('needs').replaceChildren(...STATS.map((s) => {
    const row = document.createElement('div');
    row.className = 'need';
    row.setAttribute('role', 'img');
    const name = document.createElement('span');
    name.textContent = s.name;
    const bar = document.createElement('span');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.setProperty('--c', s.colour);
    bar.appendChild(fill);
    const warn = document.createElement('span');
    warn.className = 'warn';
    warn.textContent = s.lowLabel || 'Low';
    warn.hidden = true;
    row.append(name, bar, warn);
    s.view = { row, fill, warn };
    return row;
  }));
}
buildNeeds();
function drawNeeds() {
  if (!you.stats) return;
  for (const s of STATS) {
    const v = you.stats[s.id];
    s.view.fill.style.setProperty('--v', (v / 100).toFixed(3));
    s.view.warn.hidden = !(s.lowAt != null && v <= s.lowAt);
    s.view.row.setAttribute('aria-label', `${s.name} ${Math.round(v)} out of 100`);
  }
}
// one slice of time: every need moves by perHour, an empty need (atZero) drags others down,
// and needs marked onlyWhenFine (health) only recover while nothing is empty
function stepStats(hours) {
  const st = you.stats;
  const empty = STATS.filter((s) => s.atZero && st[s.id] <= 0);
  const change = {};
  for (const s of STATS) change[s.id] = s.onlyWhenFine && empty.length ? 0 : s.perHour;
  for (const s of empty) for (const [k, v] of Object.entries(s.atZero)) if (k in change) change[k] += v;
  for (const s of STATS) st[s.id] = clampStat(st[s.id] + change[s.id] * hours);
}
function tickStats() {
  if (!you.stats || you.dead) return;
  const now = Date.now();
  let hours = ((now - you.statsAt) / 3600000) * SETTINGS.needsSpeed;
  you.statsAt = now;
  const before = { ...you.stats };
  // a game minute at a time, so a long time away adds up properly
  while (hours > 0 && !you.dead) {
    const h = Math.min(hours, 1 / 60);
    stepStats(h);
    hours -= h;
    if (STATS.some((s) => s.deadAtZero && you.stats[s.id] <= 0)) die();
  }
  if (you.dead) return;
  const low = STATS.find((s) => s.lowAt != null && s.lowLabel && before[s.id] > s.lowAt && you.stats[s.id] <= s.lowAt);
  if (low && !action) showTag(low.lowLabel, headTop(), 2);
  drawNeeds();
}

/* ---------- day and night follow your real local time ---------- */
const DAYLIGHT = (DATA.daylight || []).filter((k) => k && Number.isFinite(k.hour)).sort((a, b) => a.hour - b.hour);
const SUN_DIR = V(SUN_OFFSET.x, 0, SUN_OFFSET.z).normalize();
const SUN_DIST = SUN_OFFSET.length();
const sky = new THREE.Color(HAZE);
const colA = new THREE.Color(), colB = new THREE.Color(), srgb = {};
const lerpNum = (a, b, t) => (Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : null);
let hourOverride = null; // lets a test pick the time of day
function localHour() {
  if (hourOverride != null) return hourOverride;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
function applyDaylight() {
  const n = DAYLIGHT.length;
  if (n < 2) return;
  const hour = localHour();
  let j = DAYLIGHT.findIndex((k) => k.hour > hour);
  if (j < 0) j = 0;
  const a = DAYLIGHT[(j - 1 + n) % n], b = DAYLIGHT[j];
  let span = b.hour - a.hour;
  if (span <= 0) span += 24;
  let into = hour - a.hour;
  if (into < 0) into += 24;
  const t = smoothstep(0, 1, into / span);
  const mix = (key, out) => { if (a[key] && b[key]) out.copy(colA.set(a[key])).lerp(colB.set(b[key]), t); };
  mix('sky', sky);
  scene.fog.color.copy(sky);
  mix('skyLight', hemi.color);
  mix('groundLight', hemi.groundColor);
  hemi.intensity = lerpNum(a.brightness, b.brightness, t) ?? hemi.intensity;
  mix('sun', sun.color);
  sun.intensity = lerpNum(a.sunStrength, b.sunStrength, t) ?? sun.intensity;
  const el = deg(lerpNum(a.sunHeight, b.sunHeight, t) ?? 52);
  SUN_OFFSET.set(SUN_DIR.x * Math.cos(el), Math.sin(el), SUN_DIR.z * Math.cos(el)).multiplyScalar(SUN_DIST);
  // the mist at the top of the screen and the text colour follow the sky
  sky.getRGB(srgb, THREE.SRGBColorSpace);
  const lum = 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b;
  app.style.setProperty('--mist', [srgb.r, srgb.g, srgb.b].map((c) => Math.round((c + (1 - c) * 0.25 * lum) * 255)).join(', '));
  app.classList.toggle('night', lum < 0.5);
}

/* ---------- your inventory: see what you're carrying, put things down, make things ---------- */
const bagOpen = () => $('bag').classList.contains('open');
function smallButton(text, onClick, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'small-btn' + (primary ? ' go' : '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
function bagRow(colour, title, detail, buttons) {
  const li = document.createElement('li');
  li.className = 'bag-row';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = colour || '#9a948a';
  const what = document.createElement('span');
  what.className = 'what';
  what.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  what.appendChild(small);
  const acts = document.createElement('span');
  acts.className = 'row-actions';
  acts.append(...buttons);
  li.append(dot, what, acts);
  return li;
}
// recipes can be made when you carry what they need and the result still fits your carrying limit
function canMake(r) {
  for (const [k, n] of Object.entries(r.needs)) if ((you.carry[k] || 0) < n) return false;
  return carried() - weightOf(r.needs) + weightOf(r.makes) <= SETTINGS.carryCapacity;
}
function make(r) {
  if (!canMake(r)) return;
  for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
  for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
  drawHeld();
  drawCarry();
  showGain(`Made ${r.name || ITEMS[Object.keys(r.makes)[0]].name}`);
}
function drawBag() {
  const w = carried();
  $('bagWeight').textContent = `${fmt(w)} / ${fmt(SETTINGS.carryCapacity)}`;
  drawWeightBar($('bagBar'), w);
  const kinds = Object.keys(you.carry);
  $('bagEmpty').hidden = kinds.length > 0;
  $('bagList').replaceChildren(...kinds.map((kind) => {
    const n = you.carry[kind];
    const buttons = [];
    if (Object.keys(ITEMS[kind].eat || {}).length) buttons.push(smallButton('Eat', () => eatOne(kind), true));
    buttons.push(smallButton(n > 1 ? 'Drop 1' : 'Drop', () => dropItems(kind, 1)));
    if (n > 1) buttons.push(smallButton('Drop all', () => dropItems(kind, n)));
    return bagRow(ITEMS[kind].look.colour, countLabel(kind, n), `Weight ${fmt(ITEMS[kind].weight * n)}`, buttons);
  }));
  $('makeSection').hidden = RECIPES.length === 0;
  $('makeList').replaceChildren(...RECIPES.map((r) => {
    const makes = Object.keys(r.makes)[0];
    const needs = Object.entries(r.needs).map(([k, n]) => countLabel(k, n)).join(' + ');
    const b = smallButton('Make', () => make(r), true);
    b.disabled = !canMake(r);
    return bagRow(ITEMS[makes].look.colour, r.name || ITEMS[makes].name, `Needs ${needs}`, [b]);
  }));
}
function openBag() { drawBag(); $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); hideHint(); }
function closeBag() { $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false'); }
$('bagBtn').addEventListener('click', () => (bagOpen() ? closeBag() : openBag()));
$('bagClose').addEventListener('click', closeBag);

/* ---------- camera: follows you, drag to turn, pinch to zoom ---------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 9;
controls.maxDistance = 40;
controls.minPolarAngle = deg(28);
controls.maxPolarAngle = deg(64);
controls.rotateSpeed = 0.6;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.enabled = false;
// the camera looks at a point 1 m above the ground where you stand, so it rises and falls with the land
function placeCamera() {
  camFree = false;
  controls.target.set(player.position.x, playerGround + 1.0, player.position.z);
  camera.position.copy(controls.target).add(V().setFromSpherical(new THREE.Spherical(24, deg(55), deg(26))));
  controls.update();
}
function followPlayer(dt) {
  if (walk.target && !wasWalking) camFree = false; // your person set off: glide back to them
  wasWalking = !!walk.target;
  const k = Math.min(1, dt * 4);
  const fx = camFree ? controls.target.x : player.position.x, fz = camFree ? controls.target.z : player.position.z;
  const gy = camFree ? groundY(fx, fz) : playerGround;
  const dx = (fx - controls.target.x) * k, dz = (fz - controls.target.z) * k;
  const dy = (gy + 1.0 - controls.target.y) * k;
  controls.target.x += dx;
  controls.target.y += dy;
  controls.target.z += dz;
  camera.position.x += dx;
  camera.position.y += dy;
  camera.position.z += dz;
}
// If the phone is struggling, draw a little less sharp (a step at a time, never back up in one visit)
const PIXEL_STEPS = [Math.min(window.devicePixelRatio || 1, 2), 1.5, 1.25, 1].filter((v, i, a) => i === 0 || v < a[0]);
const speed = { step: 0, time: 0, frames: 0, warm: 0 };
function watchSpeed(raw) {
  if (document.hidden || raw > 0.5) return;
  if (speed.warm < 3) { speed.warm += raw; return; } // let it settle after starting
  speed.time += raw;
  speed.frames++;
  if (speed.time < 2) return;
  const fps = speed.frames / speed.time;
  speed.time = speed.frames = 0;
  if (fps < 45 && speed.step < PIXEL_STEPS.length - 1) {
    speed.step++;
    renderer.setPixelRatio(PIXEL_STEPS[speed.step]);
    resize();
  }
}
function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(app);
resize();

/* ---------- moving about ---------- */
const walk = { target: null, onArrive: null, onFail: null, phase: 0, side: 0, best: Infinity, bestAt: 0 };
let action = null; // what your person is doing right now: bending to pick up or put down, drinking, eating
function setLegs(P, s) { P.legL.rotation.x = s * 0.55; P.legR.rotation.x = -s * 0.55; }
function shorePointToward(from) {
  const a = Math.atan2((from.z - POND.z) * 1.22, from.x - POND.x);
  for (let k = 0.6; k < 2; k += 0.02) {
    const baseR = POND.r * (1 + 0.13 * Math.sin(a * 3 + 1.1) + 0.06 * Math.sin(a * 5 - 0.7));
    const x = POND.x + Math.cos(a) * baseR * k, z = POND.z + (Math.sin(a) * baseR * k) / 1.22;
    if (heightAt(x, z) > WATER_Y + 0.12) return V(x, 0, z);
  }
  return V(from.x, 0, from.z);
}
const inWorld = (v) => Math.max(-WALK_LIMIT, Math.min(WALK_LIMIT, v)); // the forest past the edge is too thick to walk into
// Solid things your person walks round: rocks, bushes, logs, stumps and tree trunks.
// Returns the thing you'd be standing in at x, z (or null), and how far into it.
const BODY_R = 0.22;
function solidAt(x, z) {
  let best = null;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const a = spots.get(spotKey(x + i * 4, z + j * 4));
      if (!a) continue;
      for (let k = 0; k < a.length; k += 4) {
        const r = (a[k + 3] ? 0.3 : a[k + 2] * 0.8) + BODY_R; // a tree's trunk, not its crown
        const d = Math.hypot(a[k] - x, a[k + 1] - z);
        if (d < r && (!best || r - d > best.depth)) best = { x: a[k], z: a[k + 1], r, depth: r - d };
      }
    }
  }
  return best;
}
// a spot you tapped inside something solid moves to just outside it
function outsideSolid(x, z) {
  for (let n = 0; n < 3; n++) {
    const s = solidAt(x, z);
    if (!s) break;
    const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) || 1;
    x = s.x + (dx / d) * (s.r + 0.05);
    z = s.z + (dz / d) * (s.r + 0.05);
  }
  return [x, z];
}
function walkTo(p, onArrive, onFail) {
  const [ox, oz] = outsideSolid(inWorld(p.x), inWorld(p.z));
  const dest = V(inWorld(ox), 0, inWorld(oz));
  walk.target = dest;
  walk.onArrive = onArrive || null;
  walk.onFail = onFail || null;
  walk.side = 0;
  walk.best = Infinity;
  walk.bestAt = elapsed;
  tapMark.position.set(dest.x, groundY(dest.x, dest.z) + 0.05, dest.z);
  tapMark.userData.born = elapsed;
}
const face = (x, z) => { player.rotation.y = Math.atan2(x - player.position.x, z - player.position.z); };
function resetPose() {
  if (!player) return;
  const P = player.userData.parts;
  player.rotation.x = 0;
  player.position.y = playerGround;
  P.body.rotation.x = P.body.userData.stoop;
  setLegs(P, 0);
}
function startAction(a) { walk.target = null; action = { t0: elapsed, done: false, seconds: 0.5, pose: 'bend', ...a }; }

/* ---------- your queue: tap several things and your person does them in turn ---------- */
const tasks = { current: null, list: [] }; // { type: 'pickup', id } | { type: 'use', source, ... } | { type: 'drop', kind, n }
const MAX_QUEUE = 30;
const allTasks = () => (tasks.current ? [tasks.current, ...tasks.list] : [...tasks.list]);
const shownTasks = () => allTasks().filter((t) => t.type !== 'drop');
// the weight you'll be carrying once everything queued is picked up or harvested
const plannedWeight = () => carried() + allTasks().reduce((sum, t) => {
  if (t.type === 'pickup') { const it = getItem(t.id); return sum + (it ? ITEMS[it.kind].weight : 0); }
  if (t.type === 'use' && SOURCES[t.source]) return sum + weightOf(SOURCES[t.source].harvest);
  return sum;
}, 0);
const useHelps = (src) => Object.entries(src.gives).some(([k, v]) => (v > 0 ? you.stats[k] < 99.5 : you.stats[k] > 0.5));
const fullLabel = (src) => { const s = STAT[Object.keys(src.gives)[0]]; return s ? s.fullLabel || `${s.name} is full` : 'Not needed'; };
// why you can't use something right now (or null if you can)
function cantUse(t, planning) {
  const src = SOURCES[t.source];
  if (!src) return 'Nothing to do here';
  if (harvests(src)) {
    const b = berryBushes[t.bush];
    // berries you've already queued to pick count as gone
    const queued = planning && b ? allTasks().filter((q) => q.type === 'use' && q.bush === t.bush).length : 0;
    if (b && berriesOn(b) - queued < 1) return queued ? 'No more berries' : `Next ${ITEMS[Object.keys(src.harvest)[0]].name.toLowerCase()} in ${readyIn(b)}`;
    if ((planning ? plannedWeight() : carried()) + weightOf(src.harvest) > SETTINGS.carryCapacity) return 'Inventory full';
    return null;
  }
  return useHelps(src) ? null : fullLabel(src);
}
function queueTask(t) {
  if (t.type === 'pickup') {
    if (allTasks().some((q) => q.type === 'pickup' && q.id === t.id)) return;
    const w = ITEMS[getItem(t.id).kind].weight;
    if (w > SETTINGS.carryCapacity) { showTag('Too heavy to carry', headTop(), 2); return; }
    if (plannedWeight() + w > SETTINGS.carryCapacity) { showTag('Inventory full', headTop(), 2); return; }
  }
  if (t.type === 'use') {
    const why = cantUse(t, true);
    if (why) { showTag(why, headTop(), 2); return; }
  }
  if (allTasks().length >= MAX_QUEUE) { showTag('Your queue is full', headTop(), 2); return; }
  hideHint();
  tasks.list.push(t);
  if (!tasks.current) nextTask();
  else drawQueue();
}
function stopQueue() {
  tasks.list = [];
  tasks.current = null;
  walk.target = null;
  walk.onArrive = walk.onFail = null;
  if (action) {
    action = null;
    resetPose();
    if (tagLabel && tagLabel.busy) { removeLabel(tagLabel); tagLabel = null; }
  }
  drawQueue();
}
// walk up to a spot, then do something there (if you can't get there, move on to the next thing)
function approach(x, z, stopAt, reach, then) {
  const dx = x - player.position.x, dz = z - player.position.z, d = Math.hypot(dx, dz);
  if (d <= reach) { then(); return; }
  walkTo(V(x - (dx / d) * stopAt, 0, z - (dz / d) * stopAt), then, nextTask);
}
function nextTask() {
  tasks.current = tasks.list.shift() || null;
  drawQueue();
  const t = tasks.current;
  if (!t || !player || you.dead) return;
  if (t.type === 'pickup') {
    const item = getItem(t.id);
    if (!item) { nextTask(); return; }
    if (carried() + ITEMS[item.kind].weight > SETTINGS.carryCapacity) { showTag('Inventory full', headTop(), 2); stopQueue(); return; }
    approach(item.x, item.z, 0.5, 0.75, () => doPickup(item));
  } else if (t.type === 'use') {
    if (t.water) {
      const shore = shorePointToward(player.position);
      if (Math.hypot(shore.x - player.position.x, shore.z - player.position.z) < 0.35) doUse(t);
      else walkTo(shore, () => doUse(t), nextTask);
    } else approach(t.x, t.z, t.stop, t.stop + 0.3, () => doUse(t));
  } else if (t.type === 'drop') doDrop(t);
  else if (t.type === 'walk') walkTo(V(t.x, 0, t.z), nextTask, nextTask);
  else nextTask();
}
// a walk joins the end of the queue, so it never interrupts anything
function walkFirst(p) {
  const t = { type: 'walk', x: p.x, z: p.z };
  const last = tasks.list[tasks.list.length - 1];
  if (last && last.type === 'walk') tasks.list.pop(); // a new walk replaces one still waiting at the end
  else if (!tasks.list.length && tasks.current && tasks.current.type === 'walk' && !action) {
    // only walking, nothing else queued: change course straight away
    walk.target = null;
    walk.onArrive = walk.onFail = null;
    tasks.current = null;
  }
  if (allTasks().length >= MAX_QUEUE) { showTag('Your queue is full', headTop(), 2); return; }
  hideHint();
  tasks.list.push(t);
  if (!tasks.current && !action) nextTask();
  else drawQueue();
}
function doPickup(item) {
  if (!getItem(item.id)) { nextTask(); return; }
  face(item.x, item.z);
  startAction({ pose: 'bend', mid: () => {
    if (!getItem(item.id)) return;
    removeWorldItem(item.id);
    addToCarry(item.kind);
    drawHeld();
    drawCarry();
    showGain(`+1 ${ITEMS[item.kind].name}`);
    drawQueue();
  } });
}
function doUse(t) {
  const src = SOURCES[t.source];
  const why = cantUse(t, false);
  if (why) { showTag(why, headTop(), 2); nextTask(); return; }
  if (t.water) face(POND.x, POND.z); else face(t.x, t.z);
  showTag(`${src.verb}…`, headTop(), 2, src.seconds + 0.3);
  tagLabel.busy = true;
  startAction({ pose: src.pose, seconds: src.seconds, end: () => {
    if (harvests(src)) harvestFrom(src, t);
    else applyGives(src.gives);
  } });
}
function applyGives(gives) {
  const shown = [];
  for (const [k, v] of Object.entries(gives)) {
    const before = you.stats[k];
    you.stats[k] = clampStat(before + v);
    const d = Math.round(you.stats[k] - before);
    if (d) shown.push(`${d > 0 ? '+' : ''}${d} ${STAT[k].name}`);
  }
  if (shown.length) showGain(shown.join(', '));
  drawNeeds();
}
// picking a berry bush: one berry into your inventory, and that berry starts growing back
function harvestFrom(src, t) {
  const b = berryBushes[t.bush];
  if ((b && !ripe(b)) || carried() + weightOf(src.harvest) > SETTINGS.carryCapacity) return;
  for (const [k, n] of Object.entries(src.harvest)) addToCarry(k, n);
  if (b) { pickBerry(b); drawBerries(b); }
  drawHeld();
  drawCarry();
  showGain(Object.entries(src.harvest).map(([k, n]) => `+${countLabel(k, n)}`).join(', '));
}
// eating food you carry happens straight away, one at a time
function eatOne(kind) {
  if (ui.mode !== 'world' || !player || you.dead || !you.carry[kind]) return;
  const gives = ITEMS[kind].eat || {};
  if (!useHelps({ gives })) { showTag(fullLabel({ gives }), headTop(), 2); return; }
  takeFromCarry(kind, 1);
  applyGives(gives);
  drawHeld();
  drawCarry();
}
// where dropped things land: one in front of you, more in a small pile around it
function dropSpot(i) {
  const fx = Math.sin(player.rotation.y), fz = Math.cos(player.rotation.y);
  const a = i * 2.39996, r = i === 0 ? 0 : 0.16 + Math.sqrt(i) * 0.15;
  let x = player.position.x + fx * 0.6 + Math.cos(a) * r, z = player.position.z + fz * 0.6 + Math.sin(a) * r;
  if (pondShape(x, z) < 0.95) { x = player.position.x - fx * 0.5 + Math.cos(a) * r; z = player.position.z - fz * 0.5 + Math.sin(a) * r; }
  return { x, z };
}
function doDrop(t) {
  if (!you.carry[t.kind]) { nextTask(); return; }
  startAction({ pose: 'bend', mid: () => {
    const taken = takeFromCarry(t.kind, t.n);
    for (let i = 0; i < taken; i++) {
      const s = dropSpot(i);
      addWorldItem(t.kind, s.x, s.z, rand() * Math.PI);
    }
    drawHeld();
    drawCarry();
  } });
}
// dropping from your inventory happens straight away, then your person carries on with the queue
function dropItems(kind, n) {
  if (ui.mode !== 'world' || !player || you.dead || !you.carry[kind]) return;
  closeBag();
  const t = { type: 'drop', kind, n };
  if (action) { tasks.list.unshift(t); return; }
  if (tasks.current) tasks.list.unshift(tasks.current);
  walk.target = null;
  walk.onArrive = walk.onFail = null;
  tasks.list.unshift(t);
  tasks.current = null;
  nextTask();
}
// numbers over the things you've queued, and the "in queue · Stop" chip
let badges = [];
function taskSpot(t) {
  if (t.type === 'pickup') { const v = itemViews.get(t.id); return v ? V(v.position.x, v.position.y + 0.22, v.position.z) : null; }
  if (t.type === 'use') return t.water ? V(POND.x, WATER_Y + 0.5, POND.z) : V(t.x, t.top + 0.15, t.z);
  if (t.type === 'walk') return V(t.x, groundY(t.x, t.z) + 0.3, t.z);
  return null;
}
// what a task is called in the queue list: "Pick up Stick" next, "Picking up Stick" now
function taskName(t, now) {
  if (t.type === 'pickup') { const it = getItem(t.id); const n = it ? ITEMS[it.kind].name : 'item'; return now ? `Picking up ${n}` : `Pick up ${n}`; }
  if (t.type === 'use') {
    const src = SOURCES[t.source];
    if (!src) return 'Use';
    if (now) return src.verb;
    return harvests(src) ? `Harvest ${ITEMS[Object.keys(src.harvest)[0]].name}` : src.action || `Use ${src.name.toLowerCase()}`;
  }
  if (t.type === 'drop') return now ? 'Putting down' : `Drop ${countLabel(t.kind, t.n)}`;
  if (t.type === 'walk') return now ? 'Walking' : 'Walk there';
  return '';
}
// the list above the bottom bar: what your person is doing now, then what's next
let queueOpen = false; // the full list is showing
function drawQueue() {
  for (const b of badges) removeLabel(b);
  badges = [];
  const show = ui.mode === 'world' && !!player && !you.dead;
  $('queue').hidden = !show;
  if (!show) return;
  const cur = tasks.current;
  $('queueNow').textContent = cur ? taskName(cur, true) : 'Waiting for something to do';
  $('queueNowRow').classList.toggle('idle', !cur);
  const next = tasks.list.map((t, i) => ({ t, i })).filter(({ t }) => t.type !== 'drop');
  const shown = queueOpen ? 25 : 2; // folded: the next 2; tap the list to see them all
  const rows = next.slice(0, shown).map(({ t, i }, k) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    const num = document.createElement('span');
    num.className = 'n';
    num.textContent = `${k + 1}.`;
    name.append(num, taskName(t, false));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'q-x';
    x.textContent = '\u00d7';
    x.setAttribute('aria-label', `Remove ${taskName(t, false)}`);
    x.addEventListener('click', () => { const j = tasks.list.indexOf(t); if (j >= 0) tasks.list.splice(j, 1); drawQueue(); });
    li.append(name, x);
    return li;
  });
  if (next.length > 2) {
    const li = document.createElement('li');
    li.className = 'more';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'q-more';
    b.textContent = queueOpen ? 'Show less' : `+${next.length - shown} more`;
    b.addEventListener('click', () => { queueOpen = !queueOpen; drawQueue(); });
    li.appendChild(b);
    rows.push(li);
  } else queueOpen = false;
  $('queueList').replaceChildren(...rows);
  $('queueList').hidden = rows.length === 0;
  $('queueStop').hidden = !cur && !next.length;
  // numbers over the things you've queued
  const list = shownTasks();
  if (list.length < 2) return;
  const used = new Set();
  list.forEach((t, i) => {
    const p = taskSpot(t);
    if (!p) return;
    const key = `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
    if (used.has(key)) return;
    used.add(key);
    badges.push(addLabel({ cls: 'qnum', text: String(i + 1), anchor: p, gap: 2, born: elapsed - 1 }));
  });
}
$('queueStop').addEventListener('click', stopQueue);

/* ---------- tapping and clicking the world ---------- */
// Left-click or tap: walk there, or pick up or use what's there. Right-click, or hold a finger down
// on a phone, opens a small menu of what you can do with that thing.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmp2 = V();
let down = null, multi = false, pressTimer = null, swallowTap = false, lastPointer = 'mouse';
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  return [e.clientX - r.left, e.clientY - r.top];
}
const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
canvas.addEventListener('pointerdown', (e) => {
  lastPointer = e.pointerType;
  if (bagOpen()) closeBag();
  cancelPress();
  if (!e.isPrimary) { multi = true; return; }
  multi = false;
  if (swallowTap) { swallowTap = false; down = null; return; } // that press only closed the menu
  if (e.button !== 0) { down = null; return; } // right and middle buttons don't walk
  down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  if (e.pointerType !== 'mouse') {
    const at = { clientX: e.clientX, clientY: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!down || multi) return;
      const [px, py] = toCanvas(at);
      if (openMenuAt(px, py)) down = null;
    }, 480);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (pressTimer && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) cancelPress();
});
canvas.addEventListener('pointercancel', cancelPress);
canvas.addEventListener('pointerup', (e) => {
  cancelPress();
  if (!e.isPrimary || multi || !down) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12 || e.timeStamp - down.t > 550) return;
  down = null;
  const [px, py] = toCanvas(e);
  handleTap(px, py);
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (lastPointer !== 'mouse') return; // on a phone, holding a finger down opens the menu instead
  const [px, py] = toCanvas(e);
  openMenuAt(px, py);
});
function labelOf(o) {
  while (o && !o.userData.label && o.parent) o = o.parent;
  return o && o.userData.label ? o : null;
}
// sticks and stones are small, so a tap close to one counts
function itemNear(px, py, maxPx) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  let best = null, bd = maxPx;
  for (const it of world.items) {
    const v = itemViews.get(it.id);
    if (!v) continue;
    tmp2.copy(v.position).project(camera);
    if (tmp2.z > 1) continue;
    const d = Math.hypot((tmp2.x * 0.5 + 0.5) * w - px, (-tmp2.y * 0.5 + 0.5) * h - py);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
function itemCloseTo(x, z, maxM) {
  let best = null, bd = maxM;
  for (const it of world.items) {
    const d = Math.hypot(it.x - x, it.z - z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
// What's under a tap or click. Something you can pick up or use wins over a tree or rock in front of it,
// and a near miss only picks up a stick or stone when the tap didn't land on something else useful.
function pickTarget(px, py) {
  ray.setFromCamera(ndc, camera);
  const groundHit = ray.intersectObject(terrain, false)[0];
  const limit = groundHit ? groundHit.distance + 0.6 : Infinity;
  const hits = [];
  for (const h of ray.intersectObjects(interactive, true)) {
    if (h.distance > limit) break;
    if (h.object === water && groundY(h.point.x, h.point.z) > WATER_Y + 0.02) continue; // that bit of the pond is under the grass
    const o = labelOf(h.object);
    if (o) hits.push({ h, o });
  }
  const useful = hits.find(({ o }) => o === player || o.userData.itemId || o.userData.source);
  const { h: hit = null, o: owner = null } = useful || hits[0] || {};
  if (owner === player) return { kind: 'you' };
  const gp = groundHit && groundHit.point;
  // a near miss still counts: within a finger's width on screen, or within about a metre on the ground
  const item = (owner && owner.userData.itemId && getItem(owner.userData.itemId))
    || (useful ? null : itemNear(px, py, lastPointer === 'mouse' ? 34 : 46))
    || (useful || !gp ? null : itemCloseTo(gp.x, gp.z, 0.9));
  if (item) return { kind: 'item', item, name: ITEMS[item.kind].name };
  const isWater = owner === water || (!hit && gp && (pondShape(gp.x, gp.z) < 0.86 || gp.y < WATER_Y + 0.1));
  const srcId = isWater ? water.userData.source : owner && owner.userData.source;
  if (srcId && SOURCES[srcId]) {
    const t = { type: 'use', source: srcId, water: isWater };
    if (!isWater && owner.isInstancedMesh) Object.assign(t, { x: hit.point.x, z: hit.point.z, stop: 0.9, top: hit.point.y });
    else if (!isWater) {
      const box = new THREE.Box3().setFromObject(owner);
      Object.assign(t, { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, top: box.max.y,
        stop: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.3 });
    }
    if (owner && owner.userData.bushId != null) t.bush = owner.userData.bushId;
    return { kind: 'use', task: t, name: SOURCES[srcId].name };
  }
  if (isWater) return { kind: 'shore' };
  if (owner) return { kind: 'thing', owner, hit };
  if (gp) return { kind: 'ground', point: gp };
  return null;
}
function handleTap(px, py) {
  if (ui.mode !== 'world' || !player || you.dead || paused) return;
  const t = pickTarget(px, py);
  if (!t) return;
  if (t.kind === 'you') { showTag('You', headTop(), 2); return; }
  // a stick, stone, berry bush or the pond: open the menu of what you can do with it
  if (t.kind === 'item' || t.kind === 'use') { openMenuAt(px, py, t); return; }
  // anything else: walk there (after anything already queued)
  if (t.kind === 'shore') { walkFirst(shorePointToward(player.position)); return; }
  if (t.kind === 'thing') {
    const { owner, hit } = t;
    const top = hit.point.clone();
    if (!owner.isInstancedMesh) {
      const box = new THREE.Box3().setFromObject(owner);
      top.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    }
    top.y += 0.3;
    showTag(owner.userData.label, top);
    const p = hit.point;
    const dx = p.x - player.position.x, dz = p.z - player.position.z, d = Math.hypot(dx, dz) || 1;
    const stopAt = owner.isInstancedMesh ? 1.1 : 0.9;
    walkFirst(V(p.x - (dx / d) * stopAt, 0, p.z - (dz / d) * stopAt));
    return;
  }
  walkFirst(t.point);
}
// the small menu: Gather Sticks, Gather Stones, Harvest Berries
function menuActions(t) {
  if (!t) return [];
  if (t.kind === 'item') {
    const it = t.item;
    return [{ label: `Pick up ${ITEMS[it.kind].name}`, run: () => queueTask({ type: 'pickup', id: it.id }) },
      { label: 'Walk here', run: () => walkFirst(V(it.x, 0, it.z)) }];
  }
  if (t.kind === 'use') {
    const src = SOURCES[t.task.source], task = t.task;
    const walkHere = { label: 'Walk here', run: () => {
      if (task.water) { walkFirst(shorePointToward(player.position)); return; }
      const dx = task.x - player.position.x, dz = task.z - player.position.z, d = Math.hypot(dx, dz) || 1;
      walkFirst(V(task.x - (dx / d) * task.stop, 0, task.z - (dz / d) * task.stop));
    } };
    if (harvests(src)) {
      const b = berryBushes[task.bush];
      const ready = !b || ripe(b);
      return [{ label: `Harvest ${ITEMS[Object.keys(src.harvest)[0]].plural}`, note: ready ? (b ? `${berriesOn(b)} left` : '') : `Next in ${readyIn(b)}`,
        disabled: !ready, run: () => queueTask(task) }, walkHere];
    }
    return [{ label: src.action || `Use ${src.name.toLowerCase()}`, run: () => queueTask(task) }, walkHere];
  }
  return [];
}
function openMenuAt(px, py, known) {
  if (ui.mode !== 'world' || !player || you.dead || paused) return false;
  const t = known || pickTarget(px, py);
  const acts = menuActions(t);
  if (!acts.length) { closeMenu(); return false; }
  const menu = $('actMenu');
  $('actTitle').textContent = t.name;
  $('actList').replaceChildren(...acts.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act-btn';
    b.setAttribute('role', 'menuitem');
    b.textContent = a.label;
    if (a.note) { const small = document.createElement('small'); small.textContent = a.note; b.appendChild(small); }
    b.disabled = !!a.disabled;
    b.addEventListener('click', () => { closeMenu(); a.run(); });
    return b;
  }));
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.round(Math.min(Math.max(8, px + 8), app.clientWidth - w - 8))}px`;
  menu.style.top = `${Math.round(Math.min(Math.max(8, py + 8), app.clientHeight - h - 8))}px`;
  return true;
}
function closeMenu() { $('actMenu').hidden = true; }
// pressing anywhere else closes the menu (and that press doesn't also walk)
document.addEventListener('pointerdown', (e) => {
  if ($('actMenu').hidden || $('actMenu').contains(e.target)) return;
  closeMenu();
  if (e.target === canvas) swallowTap = true;
}, true);

/* ---------- pause menu (Escape on a computer): your person waits, the real-time clock keeps going ---------- */
let paused = false;
function openPause() {
  if (ui.mode !== 'world' || !player || you.dead) return;
  closeMenu();
  closeBag();
  keysDown.clear();
  paused = true;
  $('pause').hidden = false;
  $('resumeBtn').focus();
}
function closePause() { paused = false; $('pause').hidden = true; }
$('resumeBtn').addEventListener('click', closePause);
$('pauseBagBtn').addEventListener('click', () => { closePause(); openBag(); });
$('pauseNewBtn').addEventListener('click', () => { closePause(); $('confirm').hidden = false; $('keepBtn').focus(); });
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) closePause(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || ui.mode !== 'world') return;
  e.preventDefault();
  if (!$('sayBox').hidden) closeSay();
  else if (!$('actMenu').hidden) closeMenu();
  else if (!$('confirm').hidden) $('confirm').hidden = true;
  else if (!$('death').hidden) return;
  else if (bagOpen()) closeBag();
  else if (paused) closePause();
  else openPause();
});

/* ---------- camera keys on a computer: W A S D move the view, Q and E turn round your person, R and F tilt ---------- */
const CAM_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF']);
const keysDown = new Set();
let camFree = false, wasWalking = false; // camFree: you've moved the view off your person (it glides back when they walk)
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
document.addEventListener('keydown', (e) => {
  if (!CAM_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (ui.mode !== 'world' || paused || typing(e.target)) return;
  e.preventDefault();
  keysDown.add(e.code);
  closeMenu();
});
document.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());
const panVel = V();
const camVel = { turn: 0, tilt: 0 }; // turning and tilting speed, eased so keys start and stop smoothly
const keyAxis = (plus, minus) => (keysDown.has(plus) ? 1 : 0) - (keysDown.has(minus) ? 1 : 0);
function keyCamera(dt) {
  const t = controls.target;
  // Q and E: turn round your person
  camVel.turn += (keyAxis('KeyE', 'KeyQ') * 1.5 - camVel.turn) * Math.min(1, dt * 5);
  if (Math.abs(camVel.turn) < 0.002 && !keysDown.has('KeyE') && !keysDown.has('KeyQ')) camVel.turn = 0;
  const turn = camVel.turn * dt;
  if (turn && player) {
    const c = Math.cos(turn), s = Math.sin(turn), px = player.position.x, pz = player.position.z;
    for (const v of [camera.position, t]) {
      const dx = v.x - px, dz = v.z - pz;
      v.x = px + dx * c + dz * s;
      v.z = pz - dx * s + dz * c;
    }
  }
  // R and F: R swings the camera up to look down from above, F brings it down toward the horizon
  camVel.tilt += (keyAxis('KeyF', 'KeyR') * 0.8 - camVel.tilt) * Math.min(1, dt * 5);
  if (Math.abs(camVel.tilt) < 0.002 && !keysDown.has('KeyF') && !keysDown.has('KeyR')) camVel.tilt = 0;
  const tilt = camVel.tilt * dt;
  if (tilt) {
    const off = camera.position.clone().sub(t);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi + tilt));
    camera.position.copy(t).add(off.setFromSpherical(sph));
  }
  // W A S D: move the view smoothly, forward being the way the camera faces
  const f = keyAxis('KeyW', 'KeyS'), r = keyAxis('KeyD', 'KeyA');
  if (!f && !r && panVel.lengthSq() < 1e-4) { panVel.set(0, 0, 0); return; }
  const fwd = V(t.x - camera.position.x, 0, t.z - camera.position.z).normalize();
  const right = V(-fwd.z, 0, fwd.x);
  const speed = camera.position.distanceTo(t) * 0.6;
  panVel.lerp(fwd.multiplyScalar(f * speed).add(right.multiplyScalar(r * speed)), Math.min(1, dt * 4));
  if (f || r) camFree = true;
  const lim = WORLD_HALF + 4;
  const dx = Math.max(-lim, Math.min(lim, t.x + panVel.x * dt)) - t.x, dz = Math.max(-lim, Math.min(lim, t.z + panVel.z * dt)) - t.z;
  t.x += dx;
  t.z += dz;
  camera.position.x += dx;
  camera.position.z += dz;
}
function updatePlayer(dt) {
  const P = player.userData.parts;
  const carrying = !!heldView;
  const holdX = -0.25; // how far forward the arm holds something
  const stoop = P.body.userData.stoop;
  if (action) {
    const t = elapsed - action.t0, dur = action.seconds, k = clamp01(t / dur);
    setLegs(P, 0);
    if (action.pose === 'kneel' || action.pose === 'pick') {
      // ease in, keep going, ease out
      const env = clamp01(Math.min(t, dur - t) / 0.3), wave = Math.sin(t * 7);
      if (action.pose === 'kneel') {
        P.body.rotation.x = stoop + 1.05 * env;
        player.position.y = playerGround - 0.12 * env;
        setArm(P.armR, (-0.6 + wave * 0.3) * env + (carrying ? holdX * (1 - env) : 0));
        setArm(P.armL, (-0.6 + wave * 0.3) * env);
      } else {
        P.body.rotation.x = stoop + 0.15 * env;
        setArm(P.armR, (-1.25 + wave * 0.25) * env + (carrying ? holdX * (1 - env) : 0));
        setArm(P.armL, (-1.0 - wave * 0.25) * env);
      }
    } else {
      // a quick bend from the hips to pick up or put down
      const s = Math.sin(k * Math.PI);
      P.body.rotation.x = stoop + 1.0 * s;
      player.position.y = playerGround - 0.14 * s;
      setArm(P.armR, -0.55 * s + (carrying ? holdX * (1 - s) : 0));
      setArm(P.armL, -0.35 * s);
    }
    if (k >= 0.5 && !action.done) { action.done = true; if (action.mid) action.mid(); }
    if (k >= 1) {
      const a = action;
      action = null;
      resetPose();
      if (a.end) a.end();
      nextTask();
    }
  } else if (walk.target) {
    const dx = walk.target.x - player.position.x, dz = walk.target.z - player.position.z;
    const d = Math.hypot(dx, dz);
    const stop = (message) => {
      walk.target = null;
      setLegs(P, 0);
      player.position.y = playerGround;
      const ok = walk.onArrive, fail = walk.onFail;
      walk.onArrive = walk.onFail = null;
      if (message) { showTag(message, headTop(), 2); if (fail) fail(); }
      else if (ok) ok();
    };
    if (d < walk.best - 0.05) { walk.best = d; walk.bestAt = elapsed; }
    if (d < 0.06) stop();
    else if (elapsed - walk.bestAt > 2.5) stop("Can't get there");
    else {
      // head straight there, or curve round the pond if it's in the way
      const step = Math.min(d, SETTINGS.walkSpeed * dt);
      const base = Math.atan2(dx, dz);
      const tries = walk.side < 0 ? [0, -0.5, -1, -1.5, -2, 0.5, 1, 1.5, 2] : [0, 0.5, 1, 1.5, 2, -0.5, -1, -1.5, -2];
      let nx = 0, nz = 0, heading = base, ok = false;
      for (const off of tries) {
        nx = inWorld(player.position.x + Math.sin(base + off) * step);
        nz = inWorld(player.position.z + Math.cos(base + off) * step);
        const hitNow = solidAt(player.position.x, player.position.z), hitNext = solidAt(nx, nz);
        const blocked = hitNext && (!hitNow || hitNext.depth > hitNow.depth - 1e-4); // you can always step out of something
        if (pondShape(nx, nz) >= 0.86 && !blocked) { ok = true; heading = base + off; if (off && !walk.side) walk.side = Math.sign(off); break; }
      }
      if (!ok) stop("Can't get there");
      else {
        playerGround = groundY(nx, nz);
        player.position.set(nx, playerGround, nz);
        player.rotation.y = lerpAngle(player.rotation.y, heading, Math.min(1, dt * 10));
        walk.phase += dt * 9;
        const sw = Math.sin(walk.phase);
        setLegs(P, sw);
        setArm(P.armL, -sw * 0.45);
        setArm(P.armR, carrying ? holdX + sw * 0.1 : sw * 0.45);
        player.position.y += Math.abs(sw) * 0.05;
      }
    }
  } else {
    P.torso.scale.y = 1 + Math.sin(elapsed * 2.2) * 0.012;
    setArm(P.armL, 0);
    setArm(P.armR, carrying ? holdX : 0);
  }
  ring.position.set(player.position.x, playerGround + 0.04, player.position.z);
  const age = elapsed - (tapMark.userData.born ?? -9);
  tapMark.material.opacity = age < 0.8 ? 0.85 * (1 - age / 0.8) : 0;
  tapMark.scale.setScalar(1 + age * 1.2);
}

/* ---------- making your person ---------- */
function buildChoice(boxId, list, key, kind) {
  const box = $(boxId);
  for (const o of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = o.id;
    if (kind === 'swatch') {
      b.className = 'swatch';
      b.setAttribute('aria-label', o.label);
      const dot = document.createElement('span');
      dot.style.background = o.hex;
      b.appendChild(dot);
    } else {
      b.className = kind === 'seg' ? 'seg-btn' : 'chip-btn';
      b.textContent = o.label;
    }
    b.addEventListener('click', () => { draft[key] = o.id; syncForm(); refreshPreview(); });
    box.appendChild(b);
  }
}
const CHOICES = [
  ['sexOpts', 'sex', 'seg'], ['buildOpts', 'build', 'chip'], ['skinOpts', 'skin', 'swatch'],
  ['hairOpts', 'hair', 'chip'], ['hairColourOpts', 'hairColour', 'swatch'], ['tunicOpts', 'tunic', 'swatch'],
];
for (const [boxId, key, kind] of CHOICES) buildChoice(boxId, LOOKS[key], key, kind);
function syncForm() {
  for (const [boxId, key] of CHOICES) for (const b of $(boxId).children) b.setAttribute('aria-pressed', String(b.dataset.id === draft[key]));
  $('ageInput').value = String(draft.age);
  $('ageOut').textContent = String(draft.age);
  if ($('nameInput').value !== draft.name) $('nameInput').value = draft.name;
}
$('ageInput').min = String(LOOKS.age.min);
$('ageInput').max = String(LOOKS.age.max);
$('ageInput').addEventListener('input', (e) => { draft.age = Number(e.target.value); $('ageOut').textContent = String(draft.age); refreshPreview(); });
$('nameInput').addEventListener('input', (e) => { draft.name = e.target.value; $('nameErr').hidden = true; });
const pv = $('previewSpace');
pv.addEventListener('pointerdown', (e) => { previewDrag = { x: e.clientX, spin: previewSpin }; pv.setPointerCapture(e.pointerId); });
pv.addEventListener('pointermove', (e) => { if (previewDrag) previewSpin = previewDrag.spin + (e.clientX - previewDrag.x) * 0.012; });
pv.addEventListener('pointerup', () => { previewDrag = null; });
pv.addEventListener('pointercancel', () => { previewDrag = null; });

function enterCreator() {
  ui.mode = 'creator';
  closeMenu();
  closePause();
  keysDown.clear();
  app.classList.add('is-creating');
  $('creator').hidden = false;
  controls.enabled = false;
  closeBag();
  hideHint();
  removeLabel(tagLabel);
  tagLabel = null;
  draft = { ...DEFAULT_LOOK };
  // while testing, a ready-made name so starting is one tap (settings.autoName; you can still change it)
  if (SETTINGS.autoName) {
    const names = DATA.testNames && DATA.testNames.length ? DATA.testNames : ['Alex', 'Sam', 'Jo'];
    draft.name = names[Math.floor(Math.random() * names.length)];
  }
  syncForm();
  refreshPreview();
}
function enterWorld() {
  ui.mode = 'world';
  app.classList.remove('is-creating');
  $('creator').hidden = true;
  controls.enabled = true;
  if (previewPerson) { pscene.remove(previewPerson); disposeMaterials(previewPerson); previewPerson = null; }
  drawHud();
  drawCarry();
  drawNeeds();
  applyDaylight();
  drawQueue();
  placeCamera();
  showHint();
  goOnline();
}
$('sheet').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = (draft.name || '').trim().slice(0, 20);
  if (!name) { $('nameErr').hidden = false; $('nameInput').focus(); return; }
  $('nameInput').blur();
  you.lifeStart = Date.now();
  you.stats = freshStats();
  you.statsAt = Date.now();
  you.dead = false;
  you.carry = {};
  you.lastKind = null;
  spawnPlayer({ ...draft, name });
  enterWorld();
  saveGame();
});

/* ---------- the end of a life: starting over, or dying ---------- */
// everything you were carrying stays where you were
function dropEverything() {
  if (!player) return;
  let i = 0;
  for (const [kind, n] of Object.entries(you.carry)) for (let k = 0; k < n; k++, i++) {
    const a = i * 2.39996, r = 0.3 + Math.sqrt(i) * 0.16;
    addWorldItem(kind, player.position.x + Math.cos(a) * r, player.position.z + Math.sin(a) * r, rand() * Math.PI);
  }
  you.carry = {};
  you.lastKind = null;
  drawHeld();
}
function endLife() {
  stopQueue();
  dropEverything();
  walk.target = null;
  action = null;
  removePlayer();
  you.look = null;
  you.stats = null;
  you.dead = false;
  enterCreator();
  saveGame();
}
function die() {
  if (you.dead || !player) return;
  you.dead = true;
  closeMenu();
  closePause();
  const cause = STATS.filter((s) => s.atZero && you.stats[s.id] <= 0).sort((a, b) => (a.atZero.health ?? 0) - (b.atZero.health ?? 0))[0];
  const had = carryingAnything();
  stopQueue();
  closeBag();
  hideHint();
  $('confirm').hidden = true;
  dropEverything();
  drawCarry();
  drawNeeds();
  resetPose();
  player.rotation.x = -Math.PI / 2; // lying where they fell
  player.position.y = playerGround + 0.2;
  $('deathTitle').textContent = `${you.look.name} has died`;
  $('deathText').textContent = `${cause ? `They died of ${cause.name.toLowerCase()}` : 'They died'} at ${you.look.age}.${had ? ' What they were carrying is on the ground where they fell.' : ''}`;
  $('death').hidden = false;
  $('deathBtn').focus();
}
$('menuBtn').addEventListener('click', () => openPause());
$('keepBtn').addEventListener('click', () => { $('confirm').hidden = true; });
$('newBtn').addEventListener('click', () => { $('confirm').hidden = true; endLife(); });
$('deathBtn').addEventListener('click', () => { $('death').hidden = true; endLife(); });

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let hudTimer = 0;
function frame() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  if (!paused) elapsed += Math.min(raw, 0.25);
  const w = app.clientWidth, h = app.clientHeight;
  if (ui.mode === 'creator') {
    if (!previewDrag && !reduceMotion) previewSpin += dt * 0.35;
    if (previewPerson) previewPerson.rotation.y = previewSpin;
    renderCreator(w, h);
  } else if (player) {
    if (!you.dead && !paused) updatePlayer(dt);
    if (!paused) keyCamera(dt);
    updateOthers(dt);
    sendMove();
    followPlayer(dt);
    controls.update();
    updateDetails(controls.target.x, controls.target.z);
    sun.position.copy(controls.target).add(SUN_OFFSET);
    sun.target.position.copy(controls.target);
    sun.target.updateMatrixWorld();
    if (!reduceMotion) animateWater(elapsed);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.setClearColor(sky, 1);
    renderer.render(scene, camera);
    watchSpeed(raw);
    updateLabels();
    hudTimer += raw;
    if (hudTimer > 1) { hudTimer = 0; drawHud(); tickStats(); applyDaylight(); for (const b of berryBushes) drawBerries(b); }
  }
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}

/* ---------- online: other people in the same world, and speech bubbles ---------- */
// The server (game-data.json "server") passes everyone's moves and speech to everyone else in the
// same world. The test link joins the test world, the release joins the live world. If the server
// can't be reached, the game carries on as normal and keeps trying quietly.
const SERVER = typeof DATA.server === 'string' ? DATA.server : '';
const others = new Map(); // id -> { mesh, tx, tz, tr, phase, name, bubble }
const net = { sock: null, myId: null, wanted: false, retry: 1000, sentAt: 0, last: null };
function cleanLook(look) {
  const l = { ...DEFAULT_LOOK, ...(look || {}) };
  for (const k of ['sex', 'skin', 'build', 'hair', 'hairColour', 'tunic']) l[k] = pickId(LOOKS[k], l[k]);
  l.age = Math.round(Math.min(LOOKS.age.max, Math.max(LOOKS.age.min, Number(l.age) || LOOKS.age.start)));
  l.name = String(l.name || 'Someone').slice(0, 20);
  return l;
}
function goOnline() {
  net.wanted = true;
  if (!SERVER || net.sock || !player) return;
  let sock;
  try { sock = new WebSocket(`${SERVER}?world=${TEST_BUILD ? 'test' : 'live'}`); } catch (err) { return; }
  net.sock = sock;
  sock.onopen = () => {
    net.retry = 1000;
    net.last = null;
    sock.send(JSON.stringify({ t: 'hello', name: you.look.name, look: you.look, x: player.position.x, z: player.position.z, ry: player.rotation.y, v: VERSION }));
  };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.t === 'welcome') { net.myId = m.id; for (const p of m.people || []) addOther(p); }
    else if (m.t === 'join') addOther(m.person);
    else if (m.t === 'leave') removeOther(m.id);
    else if (m.t === 'move') { const o = others.get(m.id); if (o) Object.assign(o, { tx: m.x, tz: m.z, tr: m.ry }); }
    else if (m.t === 'say') {
      if (m.id === net.myId) { if (player) bubble(null, m.text); }
      else if (others.has(m.id)) bubble(others.get(m.id), m.text);
    }
  };
  sock.onclose = () => {
    if (net.sock === sock) net.sock = null;
    net.myId = null;
    for (const id of [...others.keys()]) removeOther(id);
    if (net.wanted) { setTimeout(goOnline, net.retry); net.retry = Math.min(30000, net.retry * 2); }
  };
  sock.onerror = () => {};
}
function goOffline() {
  net.wanted = false;
  if (net.sock) { try { net.sock.close(); } catch (err) { /* already closed */ } }
  net.sock = null;
}
const online = () => net.sock && net.sock.readyState === 1 && net.myId;
function addOther(p) {
  if (!p || !p.id || p.id === net.myId) return;
  removeOther(p.id);
  const mesh = makePerson(cleanLook({ ...p.look, name: p.name }));
  const x = Number(p.x) || 0, z = Number(p.z) || 0;
  mesh.position.set(x, groundY(x, z), z);
  mesh.rotation.y = Number(p.ry) || 0;
  mesh.userData.label = p.name || 'Someone';
  scene.add(mesh);
  const name = addLabel({ cls: 'name-tag', text: p.name || 'Someone', anchor: mesh.position, offset: V(0, 2.0, 0), gap: 0 });
  others.set(p.id, { mesh, tx: x, tz: z, tr: mesh.rotation.y, phase: 0, name, bubble: null });
}
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  scene.remove(o.mesh);
  disposeMaterials(o.mesh);
  removeLabel(o.name);
  if (o.bubble) removeLabel(o.bubble);
  others.delete(id);
}
// other people glide to where the server says they are, legs moving while they walk
function updateOthers(dt) {
  for (const o of others.values()) {
    const m = o.mesh, dx = o.tx - m.position.x, dz = o.tz - m.position.z, d = Math.hypot(dx, dz);
    const P = m.userData.parts;
    if (d > 8) { m.position.x = o.tx; m.position.z = o.tz; } // too far behind: jump there
    else if (d > 0.02) {
      const step = Math.min(d, Math.max(SETTINGS.walkSpeed * 1.15, d * 3) * dt);
      m.position.x += (dx / d) * step;
      m.position.z += (dz / d) * step;
      m.rotation.y = lerpAngle(m.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
      o.phase += dt * 9;
      if (P) setLegs(P, Math.sin(o.phase));
    } else {
      m.rotation.y = lerpAngle(m.rotation.y, o.tr, Math.min(1, dt * 6));
      if (P) setLegs(P, 0);
    }
    m.position.y = groundY(m.position.x, m.position.z);
  }
}
// tell the server where you are, a few times a second while you move
function sendMove() {
  if (!online() || !player || elapsed - net.sentAt < 0.2) return;
  const x = player.position.x, z = player.position.z, ry = player.rotation.y;
  const l = net.last;
  if (l && Math.hypot(x - l.x, z - l.z) < 0.03 && Math.abs(ry - l.ry) < 0.05) return;
  net.sentAt = elapsed;
  net.last = { x, z, ry };
  net.sock.send(JSON.stringify({ t: 'move', x, z, ry, doing: tasks.current ? taskName(tasks.current, true) : '' }));
}
// speech bubbles: what you say shows over your head for everyone nearby
function bubble(o, text) {
  const anchor = o ? o.mesh.position : player.position;
  if (o && o.bubble) removeLabel(o.bubble);
  if (!o && net.myBubble) removeLabel(net.myBubble);
  const L = addLabel({ cls: 'bubble', text, anchor, offset: V(0, o ? 2.35 : 2.0, 0), ttl: 7, gap: 4 });
  if (o) o.bubble = L; else net.myBubble = L;
}
function openSay() {
  if (ui.mode !== 'world' || !player || you.dead) return;
  closeMenu();
  $('sayBox').hidden = false;
  $('sayInput').value = '';
  $('sayInput').focus();
}
function closeSay() { $('sayBox').hidden = true; $('sayInput').blur(); }
$('sayBtn').addEventListener('click', () => ($('sayBox').hidden ? openSay() : closeSay()));
$('sayBox').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('sayInput').value.trim().slice(0, 80);
  closeSay();
  if (!text) return;
  if (online()) net.sock.send(JSON.stringify({ t: 'say', text }));
  else bubble(null, text); // offline: you still see it yourself
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ui.mode === 'world' && !paused && !typing(e.target) && $('sayBox').hidden) { e.preventDefault(); openSay(); }
});

/* ---------- saving on this phone ---------- */
// The test link and the release each keep their own save, so testing never touches your real game.
// Everything saved is plain data, ready to move to a server when the world goes online.
const SAVE_KEY = `pocket-life:${TEST_BUILD ? 'test' : 'release'}`;
const SAVE_FORMAT = 1;
function saveGame() {
  try {
    const alive = player && !you.dead;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      format: SAVE_FORMAT, worldSize: WORLD_HALF * 2, savedAt: Date.now(),
      items: world.items.map(({ kind, x, z, rot }) => [kind, +x.toFixed(2), +z.toFixed(2), +rot.toFixed(2)]),
      bushes: berryBushes.map((b) => [b.userData.count ?? null, b.userData.growFrom ?? null]),
      you: alive ? { look: you.look, carry: you.carry, lastKind: you.lastKind, lifeStart: you.lifeStart, stats: you.stats, statsAt: you.statsAt,
        x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +player.rotation.y.toFixed(2) } : null,
    }));
  } catch (err) { /* private browsing or storage full: the game still plays, it just won't remember */ }
}
function loadGame() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (err) { d = null; }
  if (!d || d.format !== SAVE_FORMAT) return false;
  // the world: where things lie, and how far each berry bush has grown back
  if (d.worldSize === WORLD_HALF * 2 && Array.isArray(d.items)) {
    for (const it of [...world.items]) removeWorldItem(it.id);
    for (const [kind, x, z, rot] of d.items) if (ITEMS[kind] && Number.isFinite(x) && Number.isFinite(z)) addWorldItem(kind, x, z, rot || 0);
  }
  (d.bushes || []).forEach(([count, growFrom], i) => {
    const b = berryBushes[i];
    if (b && Number.isFinite(count) && Number.isFinite(growFrom)) { b.userData.count = count; b.userData.growFrom = growFrom; drawBerries(b); }
  });
  // your person, if they were alive when you left
  const y = d.you;
  if (!y || !y.look || !y.stats) return false;
  const look = { ...DEFAULT_LOOK, ...y.look };
  for (const k of ['sex', 'skin', 'build', 'hair', 'hairColour', 'tunic']) look[k] = pickId(LOOKS[k], look[k]);
  look.age = Math.round(Math.min(LOOKS.age.max, Math.max(LOOKS.age.min, Number(look.age) || LOOKS.age.start)));
  look.name = String(look.name || 'You').slice(0, 20);
  you.lifeStart = y.lifeStart || Date.now();
  you.stats = { ...freshStats(), ...y.stats };
  you.statsAt = y.statsAt || Date.now();
  you.dead = false;
  you.carry = Object.fromEntries(Object.entries(y.carry || {}).filter(([k, n]) => ITEMS[k] && n > 0));
  you.lastKind = ITEMS[y.lastKind] ? y.lastKind : Object.keys(you.carry)[0] || null;
  spawnPlayer(look);
  const px = inWorld(Number(y.x) || START.x), pz = inWorld(Number(y.z) || START.z);
  playerGround = groundY(px, pz);
  player.position.set(px, playerGround, pz);
  player.rotation.y = Number(y.ry) || 0;
  enterWorld();
  tickStats(); // needs carry on while you're away
  return true;
}
setInterval(() => { if (player || ui.mode === 'world') saveGame(); }, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
window.addEventListener('pagehide', saveGame);

if (!loadGame()) enterCreator();
requestAnimationFrame(frame);
