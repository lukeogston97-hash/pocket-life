/* ---------- looks made of pieces (0.2.0) ----------
   A look in the data can be a list of simple pieces instead of one of the hand-made shapes, so a new item or a new
   thing in the world needs no code: items use it as the "parts" shape (items.js), and plants as look.form "parts"
   (plants.js). Each piece: form (box, cylinder, cone or ball), size, at (where, in metres) and turn (degrees).
   Pieces of one colour are joined into one shape, made once per look and shared by every copy. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// the pieces of a "parts" look, joined by colour (made once per look: every copy shares them)
export const PART_FORMS = {
  box: (z) => new THREE.BoxGeometry(...three(z, 0.1)),
  cylinder: (z, sides) => { const [r, len, r2] = Array.isArray(z) ? z : [z, z * 4]; return new THREE.CylinderGeometry(r2 ?? r, r, len ?? r * 4, sides || 7); },
  cone: (z, sides) => { const [r, h] = Array.isArray(z) ? z : [z, z * 2]; return new THREE.ConeGeometry(r, h ?? r * 2, sides || 6); },
  ball: (z, sides) => new THREE.IcosahedronGeometry(Array.isArray(z) ? z[0] : z, sides === 1 ? 1 : 0),
};
function three(v, d) { const a = Array.isArray(v) ? v : [v, v, v]; return [0, 1, 2].map((i) => (Number.isFinite(a[i]) ? a[i] : d)); }
const partsCache = new Map();
export function partsGeos(look) {
  const list = Array.isArray(look.parts) ? look.parts : [];
  const key = JSON.stringify([list, look.colour || '']);
  if (partsCache.has(key)) return partsCache.get(key);
  const byColour = new Map();
  for (const pc of list) {
    const make = pc && PART_FORMS[pc.form];
    if (!make) continue;
    const geo = make(pc.size ?? 0.05, pc.sides).toNonIndexed();
    geo.deleteAttribute('uv');
    const turn = three(pc.turn, 0).map((d) => THREE.MathUtils.degToRad(d));
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...three(pc.at, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(...turn)), new THREE.Vector3(1, 1, 1)));
    const c = pc.colour || look.colour || '#9a948a';
    if (!byColour.has(c)) byColour.set(c, []);
    byColour.get(c).push(geo);
  }
  const out = [...byColour].map(([colour, geos]) => { const geo = mergeGeometries(geos); geo.userData.shared = true; return { colour, geo }; });
  partsCache.set(key, out);
  return out;
}
