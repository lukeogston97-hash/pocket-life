import * as THREE from 'three';
import { share } from './links.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  get freshLook() { return freshLook; }, set freshLook(v) { freshLook = v; },
});


// true while the main menu shows a world that isn't open yet: it's drawn fresh, as nobody has touched it (screens.js)
let freshLook = false;
export const app = document.getElementById('app');
export const canvas = document.getElementById('world');
export const labelsEl = document.getElementById('labels');
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- helpers ---------- */
// Two streams of random numbers: one lays out the starting clearing exactly as it has always looked,
// the other lays out the rest of the world, so changing the world's size never reshuffles the clearing.
let seed = 20261120, seed2 = 52611;
const startRand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const worldRand = () => { seed2 = (seed2 * 16807) % 2147483647; return (seed2 - 1) / 2147483646; };
let useRand = startRand;
export const rand = () => useRand();
export function withWorldRand(fn) { useRand = worldRand; try { fn(); } finally { useRand = startRand; } }
// things added to the world later get their own random numbers, so nothing already placed moves
export function withOwnRand(start, fn) {
  let s3 = Math.max(1, Math.floor(start) % 2147483646);
  useRand = () => { s3 = (s3 * 16807) % 2147483647; return (s3 - 1) / 2147483646; };
  try { fn(); } finally { useRand = startRand; }
}
export const rr = (a, b) => a + (b - a) * rand();
export const pick = (arr) => arr[Math.floor(rand() * arr.length)];
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerpAngle = (a, b, k) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
export function hash(ix, iz) {
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
export const fbm = (x, z) => vnoise(x, z) * 0.58 + vnoise(x * 2.03 + 17, z * 2.03 + 9) * 0.28 + vnoise(x * 4.1 + 3, z * 4.1 + 31) * 0.14;
export const tint = (hex, h = 0.01, s = 0.05, l = 0.035) => new THREE.Color(hex).offsetHSL(rr(-h, h), rr(-s, s), rr(-l, l));
export const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, flatShading: true, ...o });

/* ---------- renderer, camera, light ---------- */
export let renderer;
try {
  // (no preserveDrawingBuffer: nothing reads the picture back, and keeping every frame costs a phone a full-screen copy each frame)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('noGL').hidden = false;
  throw err;
}
export const HAZE = '#e3e0c8';
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(HAZE, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HAZE, 36, 96);

export const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
export const hemi = new THREE.HemisphereLight('#f4f2e1', '#7b8857', 2.05);
scene.add(hemi);
export const sun = new THREE.DirectionalLight('#fff0d4', 2.35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 85 }); // just deep enough for the 52 m square round you
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);
export const SUN_OFFSET = V(-24, 36, 15);

/* ---------- the game's data: index.html loads it first (always fresh), then this file ---------- */
export const DATA = window.GAME_DATA;
export const SETTINGS = { carryCapacity: 60, walkSpeed: 2.2, worldSize: 100, needsSpeed: 1, ...(DATA.settings || {}) };
export const VERSION = String(DATA.version || '0.0.0');
export const TEST_BUILD = location.pathname.includes('/test/'); // the test copy, before it's released
export const VERSION_LABEL = TEST_BUILD ? `${VERSION} (test ${DATA.build || 1})` : VERSION;
for (const el of document.querySelectorAll('.ver')) el.textContent = VERSION_LABEL;
document.title = `Pocket Life v${VERSION_LABEL}`;
