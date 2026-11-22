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
    stickGeos.set(key, mergeGeometries(parts.map((g) => g.toNonIndexed())));
  }
  return stickGeos.get(key);
}
// a stone: a smooth, slightly flat pebble
const pebbleGeos = [1, 2, 3].map((k) => jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.16, 40 + k));
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
  // a knife: a short stick handle with a sharp stone flake lashed into the end
  knife(look) {
    const len = look.length ?? 0.26, t = look.thickness ?? 0.016;
    const g = new THREE.Group();
    const hl = len * 0.55;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(t * 0.9, t * 1.1, hl, 6).rotateZ(Math.PI / 2), tinted(look.colour || '#8a6847', 0.04));
    handle.position.x = -len / 2 + hl / 2;
    g.add(handle);
    const bl = len - hl + 0.02;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.026, bl, 4).rotateZ(-Math.PI / 2).scale(1, 1, 0.35), tinted(look.blade || '#8f8a80', 0.06));
    blade.position.x = len / 2 - bl / 2;
    g.add(blade);
    const lash = new THREE.Mesh(new THREE.CylinderGeometry(t * 1.5, t * 1.5, 0.035, 7).rotateZ(Math.PI / 2), matFor(look.lashing || '#c9b77a'));
    lash.position.x = -len / 2 + hl;
    g.add(lash);
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
  // a log: a short length of trunk with pale cut ends
  log(look) {
    const len = look.length ?? 0.9, r = look.radius ?? 0.12;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, len, 8).rotateZ(Math.PI / 2), tinted(look.colour || '#7a5c40', 0.05)));
    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.012, 8).rotateZ(Math.PI / 2), matFor(look.end || '#cdb085'));
      end.position.x = sx * len / 2;
      g.add(end);
    }
    return { model: g, rest: r, hold: 'none', hit: [len + 0.3, r * 2 + 0.3, r * 2 + 0.3] };
  },
  rod(look) {
    const len = look.length ?? 0.6, t = look.thickness ?? 0.03;
    const g = new THREE.Group();
    const m = new THREE.Mesh(stickGeo(len, t, look.twig), tinted(look.colour, 0.07));
    m.rotation.x = (Math.random() - 0.5) * 0.6;
    g.add(m);
    return { model: g, rest: t, hold: 'rod', hit: [len + 0.3, 0.3, 0.36] };
  },
  rock(look) {
    const s = look.size ?? 0.12;
    const m = new THREE.Mesh(pebbleGeos[Math.floor(Math.random() * pebbleGeos.length)], tinted(look.colour, 0.09));
    m.scale.set(s * (0.85 + Math.random() * 0.3), s * 0.62, s * (0.8 + Math.random() * 0.25));
    m.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 6, (Math.random() - 0.5) * 0.3);
    const g = new THREE.Group();
    g.add(m);
    return { model: g, rest: s * 0.5, hold: 'palm', hitR: Math.max(0.2, s * 1.7) };
  },
  // a berry: shiny and round, with a little green crown on top
  ball(look) {
    const s = look.size ?? 0.08;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat(look.colour, { roughness: 0.35 })));
    if (look.leaf !== false) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry(s * 0.55, s * 0.5, 5), matFor(look.leaf || '#4f7a3a'));
      crown.position.y = s * 0.95;
      crown.rotation.x = Math.PI;
      g.add(crown);
    }
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
    uses: raw.tool && Number.isFinite(raw.tool.uses) ? Math.max(1, Math.floor(raw.tool.uses)) : 0, // a tool wears out after this many uses
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
