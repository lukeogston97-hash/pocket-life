/* ---------- plants: things in the world you work for something, that grow back (plants in content/world.json) ----------
   Tall grass for twine, and anything else of the kind: an ore vein to mine, a reed bed, a herb. Each kind is laid out
   on its own random numbers (so nothing else in the world moves), some near the start (nearStart), the rest through
   the wider world or only in its area ({ x, z, r }). A worked one grows back by itself at a random time (the server
   keeps when each one is ready again: world.plants).
   Its look: grass blades (the default: blades, height, width, colour, tips), or look.form "parts", pieces like an
   item's (parts.js), hidden while it grows back (or squashed down, with whenUsed "stub"). Each kind is drawn with
   one InstancedMesh per colour, so hundreds cost very little. A plant that needs its tool (toolNeeded) can't be
   worked by hand. */
import * as THREE from 'three';
import { game } from './links.js';
import { DATA, mat, rand, rr, tint, V, withOwnRand } from './core.js';
import { CLEAR, groundY, pondShape, WALK_LIMIT } from './land.js';
import { dummy, IM, interactive, put, roomAt } from './nature.js';
import { partsGeos } from './parts.js';

export const PLANTS = DATA.plants || {};
export const plants = {}; // kind -> { def, clumps: [{ i, x, z, readyAt }], per, blades, heads, bladeM, headM }
const bladeGeo = new THREE.ConeGeometry(0.02, 1, 3, 1, true).translate(0, 0.5, 0);
const seedGeo = new THREE.IcosahedronGeometry(1, 0);
const WHITE = new THREE.Color('#ffffff'); // (a pieces look keeps its colours in its materials)
// where a clump might go: somewhere in its area if it has one ({ x, z, r }), else near the start or anywhere
function inArea(area, L) {
  const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * area.r;
  return [Math.max(-L, Math.min(L, area.x + Math.cos(a) * d)), Math.max(-L, Math.min(L, area.z + Math.sin(a) * d))];
}
for (const [kind, def] of Object.entries(PLANTS)) {
  if ((def.look || {}).form === 'parts') { layPieces(kind, def); continue; }
  const look = def.look || {}, per = Math.max(3, Math.min(16, look.blades || 9)), count = Math.min(200, def.count || 40);
  const P = plants[kind] = { def, clumps: [], per,
    blades: IM(bladeGeo, mat('#ffffff', { roughness: 1, side: THREE.DoubleSide }), count * per, false),
    heads: IM(seedGeo, mat('#ffffff'), count * per, false) };
  P.blades.userData.plant = kind;
  P.blades.userData.label = def.name || 'Plant'; // so taps find it
  withOwnRand(def.seed || 4127, () => {
    const L = WALK_LIMIT - 2;
    for (let t = 0; t < 6000 && P.clumps.length < count; t++) {
      const near = P.clumps.length < (def.nearStart || 0);
      const a = rand() * Math.PI * 2, d = near ? rr(4, 15) : 0;
      let x = near ? CLEAR.x + Math.cos(a) * d : rr(-L, L), z = near ? CLEAR.z + Math.sin(a) * d : rr(-L, L);
      if (def.area && !near) [x, z] = inArea(def.area, L);
      if (Math.hypot(x - CLEAR.x, z - CLEAR.z) < 2.5 || pondShape(x, z) < 1.4 || !roomAt(x, z, 0.7, 0.7)) continue;
      if (P.clumps.some((c) => Math.hypot(c.x - x, c.z - z) < (near ? 2.2 : 5))) continue;
      const y = groundY(x, z), c = { i: P.clumps.length, x, z, readyAt: 0 };
      for (let k = 0; k < per; k++) {
        const h = (look.height || 0.75) * rr(0.65, 1.15), lx = rr(-0.3, 0.3), lz = rr(-0.3, 0.3);
        const ox = rr(-0.18, 0.18), oz = rr(-0.18, 0.18);
        const wd = (look.width || 0.02) / 0.02;
        put(P.blades, x + ox, y, z + oz, lx, rand() * 6, lz, wd, h, wd, tint(look.colour || '#b7b26a', 0.02, 0.08, 0.06));
        dummy.position.set(0, h, 0); dummy.position.applyEuler(new THREE.Euler(lx, 0, lz)); // the tip of the leaning blade
        put(P.heads, x + ox + dummy.position.x, y + dummy.position.y, z + oz + dummy.position.z, lx, 0, lz, 0.026, 0.08, 0.026, tint(look.tips || '#d8cf8e', 0.02, 0.05, 0.05));
      }
      P.clumps.push(c);
    }
  });
  for (const m of [P.blades, P.heads]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  P.bladeM = P.blades.instanceMatrix.array.slice();
  P.headM = P.heads.instanceMatrix.array.slice();
  P.mats = [P.bladeM, P.headM]; // each clump's place as laid out, for every mesh (placeables.js lifts them onto levelled ground)
  interactive.push(P.blades);
}
// a kind drawn from pieces (look.form "parts"): one InstancedMesh per colour, one copy per clump
function layPieces(kind, def) {
  const look = def.look, count = Math.min(200, def.count || 12), meshes = partsGeos(look).map(({ colour, geo }) => IM(geo, mat(colour), count));
  const P = plants[kind] = { def, clumps: [], per: 1, form: 'parts', meshes };
  for (const m of meshes) { m.userData.plant = kind; m.userData.label = def.name || 'Plant'; }
  withOwnRand(def.seed || 4127, () => {
    const L = WALK_LIMIT - 2, gap = def.spacing || 5;
    for (let t = 0; t < 6000 && P.clumps.length < count; t++) {
      const near = P.clumps.length < (def.nearStart || 0);
      let x, z;
      if (near) { const a = rand() * Math.PI * 2, d = rr(4, 15); x = CLEAR.x + Math.cos(a) * d; z = CLEAR.z + Math.sin(a) * d; }
      else if (def.area) [x, z] = inArea(def.area, L);
      else { x = rr(-L, L); z = rr(-L, L); }
      if (Math.hypot(x - CLEAR.x, z - CLEAR.z) < 2.5 || pondShape(x, z) < 1.4 || !roomAt(x, z, 0.7, 0.7)) continue;
      if (P.clumps.some((c) => Math.hypot(c.x - x, c.z - z) < (near ? 2.2 : gap))) continue;
      const sc = rr(0.85, 1.15), ry = rand() * 6.28, y = groundY(x, z);
      for (const m of meshes) put(m, x, y, z, 0, ry, 0, sc, sc, sc, WHITE);
      P.clumps.push({ i: P.clumps.length, x, z, readyAt: 0 });
    }
  });
  for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  P.mats = meshes.map((m) => m.instanceMatrix.array.slice());
  interactive.push(...meshes);
}
export const plantReady = (c) => !c.readyAt || Date.now() >= c.readyAt;
// a cut clump is short stubble with no seed heads; a grown one is as it was laid out
const STUB = new THREE.Matrix4().makeScale(1, 0.22, 1), NONE = new THREE.Matrix4().makeScale(0, 0, 0), tmpM = new THREE.Matrix4();
export function drawPlant(kind, c) {
  const P = plants[kind], up = game.freshLook || plantReady(c);
  if (c.shown === up) return;
  c.shown = up;
  if (P.form === 'parts') {
    const stub = P.def.look.whenUsed === 'stub', o = c.i * 16;
    P.meshes.forEach((m, j) => {
      if (up) m.instanceMatrix.array.set(P.mats[j].subarray(o, o + 16), o);
      else if (!stub) NONE.toArray(m.instanceMatrix.array, o);
      else { tmpM.fromArray(P.mats[j], o); const base = V().setFromMatrixPosition(tmpM); tmpM.setPosition(0, 0, 0).premultiply(STUB).setPosition(base); tmpM.toArray(m.instanceMatrix.array, o); }
      m.instanceMatrix.needsUpdate = true;
    });
    return;
  }
  for (let k = 0; k < P.per; k++) {
    const o = (c.i * P.per + k) * 16;
    if (up) { P.blades.instanceMatrix.array.set(P.bladeM.subarray(o, o + 16), o); P.heads.instanceMatrix.array.set(P.headM.subarray(o, o + 16), o); }
    else {
      tmpM.fromArray(P.bladeM, o);
      const base = V().setFromMatrixPosition(tmpM);
      tmpM.setPosition(0, 0, 0).premultiply(STUB).setPosition(base); // squash the blade towards the ground where it stands
      tmpM.toArray(P.blades.instanceMatrix.array, o);
      NONE.toArray(P.heads.instanceMatrix.array, o);
    }
  }
  P.blades.instanceMatrix.needsUpdate = P.heads.instanceMatrix.needsUpdate = true;
}
export function setPlant(kind, i, readyAt) {
  const c = plants[kind] && plants[kind].clumps[i];
  if (!c) return;
  c.readyAt = readyAt || 0;
  drawPlant(kind, c);
}
export const drawPlants = () => { for (const [kind, P] of Object.entries(plants)) for (const c of P.clumps) drawPlant(kind, c); };
// the clump nearest a ground point (thin blades are hard to tap exactly)
export function plantNear(gp, within = 0.8) {
  let best = null, bd = within;
  for (const [kind, P] of Object.entries(plants)) for (const c of P.clumps) { const d = Math.hypot(c.x - gp.x, c.z - gp.z); if (d < bd) { bd = d; best = { kind, c }; } }
  return best;
}
export const plantTarget = (kind, c) => ({ kind: 'plant', plant: kind, i: c.i, x: c.x, z: c.z, name: PLANTS[kind].name });
export const growsIn = (c) => { const mins = Math.max(1, Math.ceil((c.readyAt - Date.now()) / 60000)); return mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`; };
