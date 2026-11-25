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
// Things you can carry. Each look gets a little variety of its own (Math.random, never the world's random numbers,
// so the layout of the world never shifts).
const tinted = (hex, l = 0.05) => { const m = mat(new THREE.Color(hex).offsetHSL(0, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * l)); return m; };
// A shape built once and used by every copy of it. Things made only of shared shapes are drawn together on the
// ground (world-items.js), so hundreds of them cost about the same to draw as one. Use it for anything that lies about.
const sharedGeos = new Map();
function sharedGeo(key, make) {
  if (!sharedGeos.has(key)) { const g = make(); g.userData.shared = true; sharedGeos.set(key, g); }
  return sharedGeos.get(key);
}
// a stick: two gently bent pieces of wood with a short side twig, a little thinner at the tip
const stickGeos = new Map();
function stickGeo(len, t, twig) {
  const key = `${len}|${t}|${!!twig}`;
  if (!stickGeos.has(key)) {
    const half = len / 2;
    const a = new THREE.CylinderGeometry(t * 0.92, t, half + t * 0.6, 6).rotateZ(Math.PI / 2 + 0.07).translate(-half / 2, -0.004, 0);
    const b = new THREE.CylinderGeometry(t * 0.62, t * 0.92, half + t * 0.6, 6).rotateZ(Math.PI / 2 - 0.07).translate(half / 2, -0.004, 0);
    const parts = [a, b];
    if (twig) {
      const nub = new THREE.CylinderGeometry(t * 0.35, t * 0.55, len * 0.24, 5);
      nub.applyMatrix4(new THREE.Matrix4().compose(V(len * 0.12, t * 0.3, t * 1.9), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -0.75)), V(1, 1, 1)));
      parts.push(nub);
    }
    const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    merged.userData.shared = true;
    stickGeos.set(key, merged);
  }
  return stickGeos.get(key);
}
// the stone axe: a handle that's thicker at the grip, a wedge of stone with a sharp edge, and a lashing where they meet
// A stone axe head seen from the side: a narrow neck where it's lashed to the handle, flaring out to a wide curved
// cutting edge, with a short stub (the poll) behind the handle. It's flat and thins to a sharp edge.
// Built along x (the handle), out along +z (the blade) and thin in y.
const axeHeadGeo = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-0.028, -0.05); sh.lineTo(0.028, -0.05); // the poll, behind the handle
  sh.lineTo(0.032, 0.035);
  sh.quadraticCurveTo(0.05, 0.1, 0.085, 0.16); // flaring out to the edge
  sh.quadraticCurveTo(0, 0.205, -0.085, 0.16); // the curved cutting edge
  sh.quadraticCurveTo(-0.05, 0.1, -0.032, 0.035);
  sh.closePath();
  const depth = 0.05;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 5 }).translate(0, 0, -depth / 2).rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { // thinner towards the edge
    const k = Math.min(1, Math.max(0, (p.getZ(i) - 0.02) / 0.17));
    p.setY(i, p.getY(i) * (1 - 0.85 * k));
  }
  g.computeVertexNormals();
  return g;
})();
// A stone pick head, the same way as the axe head: seen from the side it's a long crescent across the end of the
// handle, coming to a point at each end and curving back a little. Thick in the middle where it's lashed on,
// thinning to the points. Built along x (the handle), across along z and thick in y.
const pickHeadGeo = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-0.06, -0.17); // one point
  sh.quadraticCurveTo(0.065, -0.11, 0.045, 0); // the front, curving out
  sh.quadraticCurveTo(0.065, 0.11, -0.06, 0.17); // round to the other point
  sh.quadraticCurveTo(-0.02, 0.08, -0.035, 0); // the back, behind the handle
  sh.quadraticCurveTo(-0.02, -0.08, -0.06, -0.17);
  const depth = 0.055;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -depth / 2).rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { // thinner towards the points
    const k = Math.min(1, Math.abs(p.getZ(i)) / 0.17);
    p.setY(i, p.getY(i) * (1 - 0.7 * k * k));
  }
  g.computeVertexNormals();
  return g;
})();
// A stone knife blade, a flake of stone shaped like a leaf: wide near the handle, narrowing to a point, with a
// sharp edge all round. Built along x (out from the handle), wide along z and thin in y.
const knifeBladeGeo = (() => {
  const L = 0.13, sh = new THREE.Shape();
  sh.moveTo(0, -0.016); // the back of the blade, where it goes into the handle
  sh.quadraticCurveTo(L * 0.35, -0.038, L, 0.004); // the cutting edge, curving out then in to the point
  sh.quadraticCurveTo(L * 0.55, 0.024, 0, 0.014); // the back edge
  sh.closePath();
  const depth = 0.016;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 5 }).translate(0, 0, -depth / 2).rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { // thin at the edges and the point, thickest down the middle
    const k = Math.min(1, Math.abs(p.getZ(i) + 0.004) / 0.03), t = Math.min(1, p.getX(i) / L);
    p.setY(i, p.getY(i) * (1 - 0.75 * k) * (1 - 0.6 * t * t));
  }
  g.computeVertexNormals();
  return g;
})();
// A campfire: a ring of stones round a bed of ash, a log and a few sticks laid in the middle, and a little teepee of
// sticks stood up over them (the fuel: more sticks, more teepee). Each building piece knows where it sits when the
// campfire is built (to) and where it lies in a loose pile before then (from), so building can move them into place.
// Only Math.random here, never the world's random numbers, so the world's layout never shifts.
const fireStoneGeo = jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.2, 91);
const FUEL_STICKS = 5; // the teepee: how many sticks it shows when the fire is full
function campfireModel(look = {}) {
  const R = look.size ?? 0.36, g = new THREE.Group(), pieces = [], fuel = [];
  const wood = look.colour || '#8a6847';
  const piece = (obj, to, from) => { obj.position.set(...to.p); obj.quaternion.copy(to.q); g.add(obj); pieces.push({ obj, to, from }); };
  const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.84, 0.02, 14), matFor(look.ash || '#4a443d'));
  ash.position.y = 0.01;
  g.add(ash);
  const N = 9;
  for (let i = 0; i < N; i++) { // the stone ring
    const a = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.2, s = R * 0.27 * (0.85 + Math.random() * 0.35);
    const m = new THREE.Mesh(fireStoneGeo, tinted(look.stone || '#8f8a80', 0.1));
    m.scale.set(s * 1.15, s * 0.72, s);
    const pa = Math.random() * Math.PI * 2, pr = Math.random() * 0.22;
    piece(m, { p: [Math.cos(a) * R, s * 0.45, Math.sin(a) * R], q: Q(0, -a, 0) },
      { p: [-0.55 + Math.cos(pa) * pr, s * 0.45, 0.3 + Math.sin(pa) * pr], q: Q(0, pa, 0) });
  }
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, R * 1.15, 7).rotateZ(Math.PI / 2), tinted(look.log || '#7a5c40', 0.05));
  piece(log, { p: [0, 0.06, 0], q: Q(0, 0.5, 0) }, { p: [0.5, 0.06, -0.25], q: Q(0, 1.2, 0) });
  for (let i = 0; i < 3; i++) { // the recipe's sticks, laid across the ash
    const m = new THREE.Mesh(stickGeo(R * 1.2, 0.02, false), tinted(wood, 0.07));
    piece(m, { p: [Math.cos(i * 2.1) * 0.06, 0.03, Math.sin(i * 2.1) * 0.06], q: Q(0, 2 + i * 1.05, 0) },
      { p: [0.42 + i * 0.05, 0.03 + i * 0.03, 0.1 + i * 0.04], q: Q(0, 0.3 + i * 0.25, 0) });
  }
  const top = V(0, R * 1.05, 0), X = V(1, 0, 0);
  for (let i = 0; i < FUEL_STICKS; i++) { // the teepee of fuel
    const a = (i / FUEL_STICKS) * Math.PI * 2 + 0.3, base = V(Math.cos(a) * R * 0.55, 0.02, Math.sin(a) * R * 0.55);
    const d = top.clone().sub(base), m = new THREE.Mesh(stickGeo(d.length() * 1.08, 0.02, i % 2 === 0), tinted(wood, 0.08));
    m.position.copy(base).add(top).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(X, d.normalize());
    g.add(m);
    fuel.push(m);
  }
  return { model: g, pieces, fuel, ash, R };
}
// a branch you pick up (the stick item): one gently arched piece of wood, thicker where it snapped (a pale cut end) and
// thinner at the tip, with two short side twigs. The campfire's sticks keep the older stickGeo above.
const branchCache = new Map();
function branchGeos(len, t, twig) {
  const key = `${len}|${t}|${!!twig}`;
  if (!branchCache.has(key)) {
    const half = len / 2, arch = len * 0.035, lean = len * 0.02, lift = (u) => arch * (1 - u * u);
    const main = new THREE.CylinderGeometry(t * 0.6, t * 1.15, len, 6, 5).rotateZ(Math.PI / 2); // tip at -x, snapped end at +x
    const p = main.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / half; p.setY(i, p.getY(i) + lift(u)); p.setZ(i, p.getZ(i) + lean * u); }
    main.computeVertexNormals();
    const parts = [main.toNonIndexed()];
    if (twig) for (const [u, side, size, rz] of [[0.2, 1, 0.27, -0.8], [-0.32, -1, 0.18, 0.8]]) {
      const l = len * size, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(side * 0.9, 0, rz));
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const at = new THREE.Vector3(u * half, lift(u), side * t * 0.5).addScaledVector(dir, l / 2 - t * 0.3);
      parts.push(new THREE.CylinderGeometry(t * 0.26, t * 0.5, l, 5).applyMatrix4(new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1))).toNonIndexed());
    }
    const wood = mergeGeometries(parts); wood.userData.shared = true;
    const cut = new THREE.CylinderGeometry(t * 1.1, t * 1.1, 0.014, 6).rotateZ(Math.PI / 2).translate(half + 0.003, 0, lean); cut.userData.shared = true;
    branchCache.set(key, { wood, cut });
  }
  return branchCache.get(key);
}
// stones you carry: chunky angular pieces (a few kinds), flatter than they are wide
const chunkGeos = [1, 2, 3, 4].map((k) => { const g = jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.26, 70 + k * 13); g.userData.shared = true; return g; });
// a log: a trunk length with a little irregularity, bark ridges along it, a stub of a branch, and cut ends with growth rings
const logCache = new Map();
function logGeos(r, len) {
  const key = `${r}|${len}`;
  if (!logCache.has(key)) {
    const half = len / 2, flat = (g) => g.toNonIndexed(), shared = (g) => { g.userData.shared = true; return g; };
    const body = new THREE.CylinderGeometry(r, r * 1.07, len, 9, 4).rotateZ(Math.PI / 2);
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) { // a slightly lumpy trunk: the radius wanders a little, the ends stay round
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = 1 + (hash(Math.round(x * 997) + 11, Math.round(y * 991) * 31 + Math.round(z * 983) * 17) - 0.5) * 0.16;
      p.setY(i, y * f); p.setZ(i, z * f);
    }
    body.computeVertexNormals();
    const stubQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, -1.25)), stubDir = new THREE.Vector3(0, 1, 0).applyQuaternion(stubQ), stubL = r * 0.8;
    const stubAt = new THREE.Vector3(len * 0.17, r * 0.78, r * 0.1).addScaledVector(stubDir, stubL / 2);
    const stub = new THREE.CylinderGeometry(r * 0.2, r * 0.3, stubL, 6).applyMatrix4(new THREE.Matrix4().compose(stubAt, stubQ, new THREE.Vector3(1, 1, 1)));
    const stubTip = new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.01, 6).applyMatrix4(new THREE.Matrix4().compose(stubAt.clone().addScaledVector(stubDir, stubL / 2 + 0.002), stubQ, new THREE.Vector3(1, 1, 1)));
    const disc = (rad, thick, sx, out) => new THREE.CylinderGeometry(rad, rad, thick, 9).rotateZ(Math.PI / 2).translate(sx * (half + out), 0, 0);
    const ridges = [];
    for (let k = 0; k < 8; k++) {
      const a = k * 0.785 + 0.3;
      ridges.push(flat(new THREE.BoxGeometry(len * (0.22 + (k % 3) * 0.06), r * 0.07, r * 0.16).applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3((((k * 7) % 5) - 2) * len * 0.17, Math.cos(a) * r * 0.99, Math.sin(a) * r * 0.99), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)), new THREE.Vector3(1, 1, 1)))));
    }
    logCache.set(key, {
      bark: shared(mergeGeometries([flat(body), flat(stub)])),
      pale: shared(mergeGeometries([flat(disc(r * 0.94, 0.012, 1, 0)), flat(disc(r * 0.94, 0.012, -1, 0)), flat(stubTip)])),
      ring: shared(mergeGeometries([flat(disc(r * 0.64, 0.012, 1, 0.003)), flat(disc(r * 0.64, 0.012, -1, 0.003))])),
      heart: shared(mergeGeometries([flat(disc(r * 0.28, 0.012, 1, 0.006)), flat(disc(r * 0.28, 0.012, -1, 0.006))])),
      ridges: shared(mergeGeometries(ridges)),
    });
  }
  return logCache.get(key);
}
const SHAPES = {
  // the campfire you carry (and see in the Inventory): built-looking, with a full teepee
  campfire(look) {
    const { model, R } = campfireModel(look);
    return { model, rest: 0, hold: 'none', hit: [R * 2 + 0.4, 0.6, R * 2 + 0.4] };
  },
  axe(look) {
    const len = look.length ?? 0.55, t = look.thickness ?? 0.025;
    const g = new THREE.Group();
    const wood = tinted(look.colour || '#8a6847', 0.04);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(t * 0.9, t * 1.1, len, 6).rotateZ(Math.PI / 2), wood)); // the handle
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.35, t * 1.1, 0.03, 6).rotateZ(Math.PI / 2), wood); // a little flare at the end you hold
    knob.position.x = -len / 2 + 0.015;
    g.add(knob);
    const hx = len / 2 - 0.05;
    const head = new THREE.Mesh(axeHeadGeo, tinted(look.head || '#8f8a80', 0.06));
    head.position.set(hx, 0, 0);
    g.add(head);
    const twine = matFor(look.lashing || '#c9b77a');
    for (const dx of [-0.042, 0.042]) { // twine wrapped round the handle either side of the head
      const lash = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.5, t * 1.5, 0.026, 7).rotateZ(Math.PI / 2), twine);
      lash.position.set(hx + dx, 0, 0);
      g.add(lash);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, t * 2.6, 0.012), twine); // and across the neck
    cross.position.set(hx, 0, 0.022);
    cross.rotation.y = 0.5;
    g.add(cross);
    return { model: g, rest: 0.04, hold: 'axe', grip: len / 2 - 0.06, hit: [len + 0.3, 0.3, 0.42] };
  },
  // a stone pickaxe: the axe's handle, with a long pointed stone across its end, lashed on the same way
  pickaxe(look) {
    const len = look.length ?? 0.6, t = look.thickness ?? 0.025;
    const g = new THREE.Group();
    const wood = tinted(look.colour || '#8a6847', 0.04);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(t * 0.9, t * 1.1, len, 6).rotateZ(Math.PI / 2), wood)); // the handle
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.35, t * 1.1, 0.03, 6).rotateZ(Math.PI / 2), wood); // a little flare at the end you hold
    knob.position.x = -len / 2 + 0.015;
    g.add(knob);
    const hx = len / 2 - 0.05;
    const head = new THREE.Mesh(pickHeadGeo, tinted(look.head || '#8f8a80', 0.06));
    head.position.set(hx, 0, 0);
    g.add(head);
    const twine = matFor(look.lashing || '#c9b77a');
    for (const dx of [-0.045, 0.048]) { // twine wrapped round the handle either side of the head
      const lash = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.5, t * 1.5, 0.026, 7).rotateZ(Math.PI / 2), twine);
      lash.position.set(hx + dx, 0, 0);
      g.add(lash);
    }
    for (const r of [0.55, -0.55]) { // and crossed over the head
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, t * 2.6, 0.012), twine);
      cross.position.set(hx, 0, 0);
      cross.rotation.y = r;
      g.add(cross);
    }
    return { model: g, rest: 0.04, hold: 'axe', grip: len / 2 - 0.06, hit: [len + 0.3, 0.3, 0.42] };
  },
  // a fishing spear: a long thin shaft with a flat pointed stone tip, lashed on with twine
  spear(look) {
    const len = look.length ?? 1.0, t = look.thickness ?? 0.024;
    const g = new THREE.Group();
    const wood = tinted(look.colour || '#8a6847', 0.04);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(t * 0.85, t * 1.05, len, 6).rotateZ(Math.PI / 2), wood)); // the shaft
    const tx = len / 2 - 0.02;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(t * 3.4, 0.24, 4).rotateZ(-Math.PI / 2), tinted(look.head || '#8f8a80', 0.06)); // the stone point
    tip.scale.z = 0.5;
    tip.position.set(tx + 0.1, 0, 0);
    g.add(tip);
    const twine = matFor(look.lashing || '#c9b77a');
    for (const dx of [-0.04, 0.0]) { // twine wrapped round where the point is tied on
      const lash = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.5, t * 1.5, 0.02, 7).rotateZ(Math.PI / 2), twine);
      lash.position.set(tx + dx, 0, 0);
      g.add(lash);
    }
    return { model: g, rest: 0.03, hold: 'axe', grip: len / 2 - 0.2, hit: [len + 0.3, 0.25, 0.3] };
  },
  // a fish: a flattened oval body with a paler belly, a fin on top, a tail and a dark eye (raw is silvery, cooked is browned)
  fish(look) {
    const len = look.length ?? 0.3, h = len * 0.4, g = new THREE.Group();
    const skin = tinted(look.colour || '#8fa7b0', 0.05);
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    part(new THREE.SphereGeometry(1, 10, 7).scale(len * 0.4, h * 0.3, h * 0.17), skin, 0, 0, 0);
    part(new THREE.SphereGeometry(1, 10, 7).scale(len * 0.34, h * 0.15, h * 0.16), tinted(look.belly || '#dfe2d6', 0.04), 0.01, -h * 0.12, 0);
    part(new THREE.ConeGeometry(h * 0.3, len * 0.24, 3).rotateZ(-Math.PI / 2).scale(1, 1, 0.3), skin, -len * 0.46, 0, 0); // the tail
    part(new THREE.ConeGeometry(h * 0.16, len * 0.18, 3).scale(1, 1, 0.3), skin, -len * 0.04, h * 0.3, 0); // the fin on its back
    const eye = matFor('#26292b');
    for (const z of [h * 0.11, -h * 0.11]) part(new THREE.SphereGeometry(h * 0.035, 6, 5), eye, len * 0.27, h * 0.05, z);
    return { model: g, rest: h * 0.2, hold: 'palm', hit: [len + 0.2, h * 0.7 + 0.2, h * 0.5 + 0.2] };
  },
  // a stone knife: a short handle that flares at the end you hold, a leaf-shaped stone blade set into the other end,
  // lashed on with twine (the same way as the axe)
  knife(look) {
    const len = look.length ?? 0.26, t = look.thickness ?? 0.016;
    const g = new THREE.Group();
    const wood = tinted(look.colour || '#8a6847', 0.04);
    const hl = len * 0.55;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.05, t * 0.9, hl, 6).rotateZ(Math.PI / 2), wood);
    handle.position.x = -len / 2 + hl / 2;
    g.add(handle);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.3, t * 1.05, 0.02, 6).rotateZ(Math.PI / 2), wood);
    knob.position.x = -len / 2 + 0.01;
    g.add(knob);
    const bx = -len / 2 + hl - 0.025;
    const blade = new THREE.Mesh(knifeBladeGeo, tinted(look.blade || '#8f8a80', 0.06));
    blade.scale.x = (len - hl + 0.025) / 0.13;
    blade.position.x = bx;
    g.add(blade);
    const twine = matFor(look.lashing || '#c9b77a');
    for (const dx of [-0.012, 0.012]) { // twine wrapped round where the blade goes in
      const lash = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.45, t * 1.45, 0.016, 7).rotateZ(Math.PI / 2), twine);
      lash.position.x = bx + dx;
      g.add(lash);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.05, t * 2.4, 0.008), twine); // and across it
    cross.position.set(bx, 0, 0.012);
    cross.rotation.y = 0.5;
    g.add(cross);
    return { model: g, rest: 0.02, hold: 'axe', grip: len / 2 - 0.035, hit: [len + 0.3, 0.25, 0.3] };
  },
  // a coil of twine: thin cord wound round in loose loops, tied across with a short wrap and a loose end
  coil(look) {
    const r = look.size ?? 0.05, g = new THREE.Group();
    const base = new THREE.Color(look.colour || '#c9b77a');
    const cord = (k) => mat(base.clone().offsetHSL(0, 0, (k % 2 ? -1 : 1) * 0.035));
    const loops = [[1, 0, 0.05], [0.9, 0.007, -0.04], [1.05, 0.013, 0.03], [0.95, 0.019, -0.03], [1, 0.025, 0.02]];
    loops.forEach(([k, y, tilt], n) => {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(r * k, r * 0.11, 4, 16).rotateX(Math.PI / 2), cord(n));
      loop.position.y = y + r * 0.09;
      loop.rotation.set(tilt, n * 1.3, tilt * 0.6);
      g.add(loop);
    });
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(r * 0.22, r * 0.08, 4, 10), cord(1)); // tied across the coil
    wrap.scale.set(1, 1.2, 1);
    wrap.position.set(r, r * 0.2, 0);
    wrap.rotation.y = Math.PI / 2;
    g.add(wrap);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.07, r * 0.9, 4).rotateZ(Math.PI / 2), cord(0)); // the loose end
    tail.position.set(r * 1.35, r * 0.06, r * 0.25);
    tail.rotation.y = -0.5;
    g.add(tail);
    return { model: g, rest: 0.002, hit: [r * 2 + 0.3, 0.25, r * 2 + 0.3] };
  },
  // a log: a short length of trunk with bark ridges, a stub of a branch and cut ends with growth rings
  log(look) {
    const len = look.length ?? 0.9, r = look.radius ?? 0.12, G = logGeos(r, len);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.bark, tinted(look.colour || '#7a5c40', 0.05)));
    g.add(new THREE.Mesh(G.ridges, matFor(look.ridge || '#6a4e36')));
    g.add(new THREE.Mesh(G.pale, matFor(look.end || '#cdb085')));
    g.add(new THREE.Mesh(G.ring, matFor(look.ring || '#b8955f')));
    g.add(new THREE.Mesh(G.heart, matFor(look.heart || '#9d7646')));
    return { model: g, rest: r, hold: 'none', iconY: -0.8, hit: [len + 0.3, r * 2 + 0.3, r * 2 + 0.3] };
  },
  rod(look) {
    const len = look.length ?? 0.6, t = look.thickness ?? 0.03;
    const g = new THREE.Group();
    const { wood, cut } = branchGeos(len, t, look.twig), lean = new THREE.Group();
    lean.rotation.x = (Math.random() - 0.5) * 0.6;
    lean.add(new THREE.Mesh(wood, tinted(look.colour, 0.07)), new THREE.Mesh(cut, matFor(look.cut || '#d6bf92')));
    if (look.lashing) { // a long stick: two sticks tied together in the middle with twine
      for (const dx of [-0.035, 0.035]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.3, t * 1.3, 0.026, 7).rotateZ(Math.PI / 2), matFor(look.lashing));
        band.position.x = dx;
        lean.add(band);
      }
    }
    g.add(lean);
    return { model: g, rest: t, hold: 'rod', hit: [len + 0.3, 0.3, 0.36] };
  },
  // a sharp stone: a flake knocked off a stone, shaped like a leaf with a sharp edge all round (the knife's blade, chunkier)
  flake(look) {
    const s = look.size ?? 0.11, g = new THREE.Group();
    const m = new THREE.Mesh(knifeBladeGeo, tinted(look.colour || '#8f8a80', 0.09));
    m.scale.set(s / 0.13, 2.4, 1.7);
    m.position.x = -s / 2;
    g.add(m);
    return { model: g, rest: 0.02, hold: 'palm', hitR: Math.max(0.2, s * 1.7) };
  },
  // a stone tool head on its own, before it's tied to a handle: look.head 'axe' or 'pick' (the same stone as on the tool)
  head(look) {
    const pick = look.head === 'pick', g = new THREE.Group();
    const m = new THREE.Mesh(pick ? pickHeadGeo : axeHeadGeo, tinted(look.colour || '#8f8a80', 0.06));
    m.position.z = pick ? 0 : -0.075; // (the axe head sticks out along +z from where the handle goes)
    g.add(m);
    if (look.lashing) { // twine wrapped round where it will meet the handle (0.1.9: the heads are made with twine)
      const band = new THREE.Mesh(new THREE.BoxGeometry(pick ? 0.11 : 0.078, pick ? 0.066 : 0.058, 0.018), matFor(look.lashing));
      band.position.set(pick ? 0.005 : 0, 0, pick ? 0 : -0.065);
      g.add(band);
    }
    return { model: g, rest: 0.028, hold: 'palm', hitR: 0.26 };
  },
  rock(look) {
    const s = look.size ?? 0.12;
    const m = new THREE.Mesh(chunkGeos[Math.floor(Math.random() * chunkGeos.length)], tinted(look.colour, 0.09));
    m.scale.set(s * (1 + Math.random() * 0.25), s * 0.62, s * (0.85 + Math.random() * 0.25));
    m.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 6, (Math.random() - 0.5) * 0.3);
    const g = new THREE.Group();
    g.add(m);
    return { model: g, rest: s * 0.5, hold: 'palm', hitR: Math.max(0.2, s * 1.7) };
  },
  // berries: shiny and round, a few together (look.berries, 1 to 3) with small green caps and a leaf
  ball(look) {
    const s = look.size ?? 0.08, g = new THREE.Group(), n = Math.max(1, Math.min(3, look.berries || 1));
    const spots = n === 1 ? [[0, 0, 0, 1]] : [[-0.85, 0.3, 0, 0.84], [0.8, 0.35, 0, 0.8], [0.0, -0.7, 0, 0.76]].slice(0, n).map(([x, z, y, k]) => [x, z, y, k]);
    for (const [x, z, , k] of spots) {
      const berry = new THREE.Mesh(sharedGeo(`ball|${s}|${k}`, () => new THREE.IcosahedronGeometry(s * k, 1)), mat(look.colour, { roughness: 0.35 }));
      berry.position.set(x * s, 0, z * s);
      berry.scale.set(1, 0.94, 1);
      g.add(berry);
      if (look.leaf !== false) {
        const cap = new THREE.Mesh(sharedGeo(`cap|${s}|${k}`, () => new THREE.ConeGeometry(s * k * 0.5, s * k * 0.22, 5).translate(0, s * k * 0.11, 0)), matFor(look.leaf || '#4f7a3a'));
        cap.position.set(x * s, s * k * 0.85, z * s);
        g.add(cap);
      }
    }
    if (look.leaf !== false && n === 1) { // a single berry: a short brown stem above the cap
      const stem = new THREE.Mesh(sharedGeo(`stem|${s}`, () => new THREE.CylinderGeometry(s * 0.06, s * 0.08, s * 0.42, 4)), matFor('#6b5638'));
      stem.position.set(s * 0.05, s * 1.12, 0);
      stem.rotation.z = -0.4;
      g.add(stem);
    }
    if (look.leaf !== false && n > 1) { // one leaf lying behind the bunch
      const leaf = new THREE.Mesh(sharedGeo(`leaf|${s}`, () => new THREE.ConeGeometry(s * 0.45, s * 1.5, 4).rotateZ(-Math.PI / 2).scale(1, 0.16, 1)), matFor(look.leaf || '#4f7a3a'));
      leaf.position.set(s * 0.2, s * 0.62, s * -1.05);
      leaf.rotation.y = 2.6;
      g.add(leaf);
    }
    return { model: g, rest: s * 0.8, hold: 'palm', hitR: Math.max(0.18, s * 2.4) };
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
    uses: raw.tool && Number.isFinite(raw.tool.uses) ? Math.max(1, Math.floor(raw.tool.uses)) : 0, // a tool wears out after this many uses
    about: typeof raw.about === 'string' ? raw.about : '', // a short line shown when you tap it in the inventory
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
    gives, harvest, holds: Math.floor(Number(raw.holds) || 0), regrowHours: Math.max(0, Number(raw.regrowHours) || 0),
    // fish: fishing here with a tool (the pond): how long a try takes and what it catches; the server holds the fish
    fish: raw.fish && ITEMS[raw.fish.tool] && ITEMS[raw.fish.catch] ? { action: raw.fish.action || 'Fish', verb: raw.fish.verb || 'Fishing', seconds: Math.max(1, Number(raw.fish.seconds) || 8), tool: raw.fish.tool, catch: raw.fish.catch } : null };
}
const harvests = (src) => Object.keys(src.harvest).length > 0;
// a thing in the world becomes usable when a source has its name, like "Pond" or "Berry bush"
for (const obj of interactive) {
  const src = Object.values(SOURCES).find((s) => s.name === obj.userData.label);
  if (src) obj.userData.source = src.id;
}
for (const b of berryBushes) drawBerries(b);
