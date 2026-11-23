/* ---------- placed things: put down from your inventory, built, then used (campfires first) ----------
   The rules for each kind are in game-data.json "placeables"; the item that places one has "places": its id.
   The server holds every placed thing ({ id, kind, x, z, rot, built, fuel, lit }) and tells everyone when one changes.
   A fire's fuel is how many ms of burning are left; it only goes down while lit, so it keeps burning (and goes out
   by itself) whether or not anyone is watching. Everything here is generic: a new placeable is a data entry, and
   only a new kind of behaviour (like fire or seats) needs code. */
const PLACEABLES = {};
for (const [kind, raw] of Object.entries(DATA.placeables || {})) {
  const item = Object.keys(ITEMS).find((k) => (DATA.items[k] || {}).places === kind);
  if (!item) { console.warn(`Placeable "${kind}" has no item that places it, so it's left out.`); continue; }
  const s = raw.seats;
  PLACEABLES[kind] = {
    kind, item, name: raw.name || ITEMS[item].name, buildSeconds: Math.max(1, Number(raw.buildSeconds) || 10), buildVerb: raw.buildVerb || 'Building', solid: Number(raw.solid) || 0.5,
    fire: fireRuleOf(raw.fire, (k) => !!ITEMS[k]), // rules.js: fuels and how long each burns, the most it holds
    seats: s ? { count: Math.max(1, Math.floor(s.count) || 6), distance: Number(s.distance) || 1.2 } : null,
    craftLabel: raw.craftLabel || 'Make', // the tap menu's list of recipes made here (Cook on a campfire)
  };
  ITEMS[item].places = kind;
}
const placed = new Map(); // id -> { id, kind, x, z, rot, built, fuel, lit, at, progress, view }

/* ---------- fire and fuel ---------- */
const fuelLeft = (th, now = Date.now()) => fuelLeftAt(th, now); // ms of burning left (rules.js)
const isLit = (th) => !!th.lit && fuelLeft(th) > 0;
const fuelIn = (th) => (PLACEABLES[th.kind].fire ? fuelLeft(th) / PLACEABLES[th.kind].fire.each : 0); // in sticks (can be part of one)
// how many more sticks fit (one that only part fits still goes on; the server works it out the same way)
const roomFor = (th, kind) => { const f = PLACEABLES[th.kind].fire; return f ? fuelRoom(f, fuelLeft(th), kind) : 0; };
function burnNow(th) { // bring it up to now
  if (!th.lit) return;
  th.fuel = fuelLeft(th);
  th.at = Date.now();
  if (th.fuel <= 0) { th.lit = false; th.fuel = 0; }
}
function timeLeft(ms) {
  const m = Math.ceil(ms / 60000);
  if (ms <= 0) return 'none';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`; // days for a claim's fire (holds 3 days)
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
function fireState(th) {
  const f = PLACEABLES[th.kind].fire;
  if (!th.built) return 'Not built yet';
  if (!f) return '';
  const left = fuelLeft(th);
  return `${isLit(th) ? 'Burning' : 'Out'} · ${left > 0 ? `${timeLeft(left)} of fuel (holds ${timeLeft(f.max)})` : 'no fuel'}`;
}
// the tap menu's title: what it is and, for a fire, whether it's lit and how much fuel it has
const placedName = (th) => {
  const P = PLACEABLES[th.kind];
  if (!th.built) return `${P.name} (not built)`;
  if (!P.fire) return P.name;
  const left = fuelLeft(th);
  if (claimOn(th)) return `${claimName(th)} · ${timeLeft(left)} left`;
  return isLit(th) ? `${P.name} · lit · ${timeLeft(left)} left` : `${P.name} · ${left > 0 ? `${timeLeft(left)} of fuel` : 'no fuel'}`;
};

/* ---------- seats round it ---------- */
const seatSpot = (th, k) => seatSpotOf(th, PLACEABLES[th.kind].seats, k); // rules.js, the same on the server
const seatTaken = (th, k) => [...others.values()].some((o) => o.sit && o.sit[0] === th.id && o.sit[1] === k);
// the nearest free seat you can stand at, or -1
function freeSeat(th) {
  const s = PLACEABLES[th.kind].seats;
  if (!s || !player) return -1;
  let best = -1, bd = Infinity;
  for (let k = 0; k < s.count; k++) {
    const [x, z] = seatSpot(th, k);
    if (seatTaken(th, k) || pondShape(x, z) < 1 || solidAt(x, z) || Math.abs(x) > WALK_LIMIT || Math.abs(z) > WALK_LIMIT) continue;
    const d = Math.hypot(x - player.position.x, z - player.position.z);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
// sitting on the ground, legs out in front, hands on the knees (anyone: you or someone else)
function sitPose(m, P, ground) {
  m.rotation.x = 0;
  P.legL.rotation.x = -1.38; P.legR.rotation.x = -1.5;
  P.body.rotation.x = P.body.userData.stoop + 0.14;
  setArm(P.armL, -0.75); setArm(P.armR, -0.7);
  m.position.y = ground - (HIP_Y - 0.1) * m.scale.y;
}
function unsitPose(m, P, ground) {
  P.legL.rotation.x = 0; P.legR.rotation.x = 0;
  P.body.rotation.x = P.body.userData.stoop;
  setArm(P.armL, 0); setArm(P.armR, 0);
  m.position.y = ground;
}

/* ---------- drawing them ---------- */
const flameGeo = new THREE.ConeGeometry(1, 1, 7, 1, true).translate(0, 0.5, 0);
const FLAME_MATS = ['#ff5a14', '#ff9a2e', '#ffe08a'].map((c, i) => {
  const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: [0.55, 0.65, 0.85][i], blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  m.userData.shared = true;
  return m;
});
const emberMat = new THREE.MeshBasicMaterial({ color: '#ff6a24', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
emberMat.userData.shared = true;
const charMat = mat('#2e2a26');
charMat.userData.shared = true;
// one warm light that follows the nearest lit fire (a fixed number of lights, so nothing has to be redrawn from scratch)
const fireLight = new THREE.PointLight('#ff9a4a', 0, 9, 1.6);
scene.add(fireLight);
function makePlacedView(th) {
  const P = PLACEABLES[th.kind], look = ITEMS[P.item].look;
  const parts = campfireModel(look);
  const g = shadowsOn(parts.model);
  g.userData.parts = parts;
  if (P.fire) { // flames (shown while lit) and a glow in the ashes
    const flame = new THREE.Group();
    [[0.17, 0.55], [0.12, 0.42], [0.07, 0.28]].forEach(([r, h], i) => {
      const c = new THREE.Mesh(flameGeo, FLAME_MATS[i]);
      c.scale.set(r, h, r);
      c.userData.base = [r, h];
      c.userData.phase = Math.random() * 6;
      flame.add(c);
    });
    flame.position.y = 0.06;
    flame.visible = false;
    g.add(flame);
    const ember = new THREE.Mesh(new THREE.CircleGeometry(parts.R * 0.62, 14).rotateX(-Math.PI / 2), emberMat);
    ember.position.y = 0.024;
    ember.visible = false;
    g.add(ember);
    Object.assign(parts, { flame, ember });
  }
  const area = new THREE.Mesh(HIT_BOX, HIT_MAT); // easy to tap
  area.scale.set(parts.R * 2 + 0.5, 0.9, parts.R * 2 + 0.5);
  area.position.y = 0.3;
  g.add(area);
  g.position.set(th.x, groundY(th.x, th.z), th.z);
  g.rotation.y = th.rot || 0;
  g.userData.label = P.name;
  g.userData.placedId = th.id;
  return g;
}
// pieces move from the pile into place as it's built; the teepee shows how much fuel is in it; flames while lit
function drawPlaced(th) {
  const parts = th.view.userData.parts, k = th.built ? 1 : th.progress || 0;
  const n = parts.pieces.length;
  parts.pieces.forEach((pc, i) => {
    const t = smoothstep(0, 1, clamp01(k * n - i)); // one after another
    pc.obj.position.set(...pc.from.p).lerp(tmpV.set(...pc.to.p), t);
    if (t > 0 && t < 1) pc.obj.position.y += Math.sin(t * Math.PI) * 0.12; // lifted over
    pc.obj.quaternion.copy(pc.from.q).slerp(pc.to.q, t);
  });
  const P = PLACEABLES[th.kind];
  const show = th.built && P.fire ? Math.min(FUEL_STICKS, Math.ceil((fuelIn(th) / Math.min(P.fire.maxFuel, 10)) * FUEL_STICKS - 0.001)) : 0;
  parts.fuel.forEach((m, i) => { m.visible = i < show; });
  const lit = th.built && isLit(th);
  for (const pc of parts.pieces.slice(-4)) pc.obj.traverse((m) => { if (m.isMesh) { if (!m.userData.wood) m.userData.wood = m.material; m.material = th.burnt ? charMat : m.userData.wood; } }); // the log and sticks go black once burnt
  if (parts.flame) { parts.flame.visible = lit; parts.ember.visible = lit; }
  th.shown = { lit, show };
}
const tmpV = V();
function setPlaced(v) {
  if (!v || !PLACEABLES[v.kind]) return;
  let th = placed.get(v.id);
  if (!th) {
    th = { id: v.id, kind: v.kind, x: Number(v.x) || 0, z: Number(v.z) || 0, rot: Number(v.rot) || 0, progress: 0 };
    th.view = makePlacedView(th);
    th.view.visible = !freshLook;
    scene.add(th.view);
    interactive.push(th.view);
    placed.set(th.id, th);
    addSpot(th.x, th.z, PLACEABLES[th.kind].solid); // walked round, like a rock
    clearCellsNear(th.x, th.z, PLACEABLES[th.kind].solid + 1);
  }
  const wasBuilt = th.built;
  Object.assign(th, { built: !!v.built, fuel: Math.max(0, Number(v.fuel) || 0), lit: !!v.lit, at: Date.now(), claim: v.claim && v.claim.who ? v.claim : null });
  drawClaimRing(th);
  if (th.lit || v.burnt) th.burnt = true;
  if (th.built && !wasBuilt && !th.progress) th.progress = 0.999; // built by someone else: pieces just settle
  drawPlaced(th);
}
function removePlaced(id) {
  const th = placed.get(id);
  if (!th) return;
  scene.remove(th.view);
  disposeMaterials(th.view);
  const i = interactive.indexOf(th.view);
  if (i >= 0) interactive.splice(i, 1);
  removeSpotNear(th.x, th.z);
  clearCellsNear(th.x, th.z, PLACEABLES[th.kind].solid + 1);
  if (th.ring) { scene.remove(th.ring); th.ring.geometry.dispose(); }
  placed.delete(id);
  if (you.sit && you.sit.fire === id) endSit(false);
}
// the whole list from the server (joining, or the world was reset)
function usePlaced(list) {
  const ids = new Set((list || []).map((v) => v.id));
  for (const id of [...placed.keys()]) if (!ids.has(id)) removePlaced(id);
  for (const v of list || []) setPlaced(v);
}
// every frame: flames flicker, fires that ran out go out, the light sits on the nearest lit fire
let placedTick = 0;
function animatePlaced(dt) {
  placedTick += dt;
  const second = placedTick > 1;
  if (second) placedTick = 0;
  let near = null, nd = Infinity;
  const c = controls.target;
  for (const th of placed.values()) {
    if (second && th.shown && (th.shown.lit !== isLit(th) || (th.built && PLACEABLES[th.kind].fire && th.shown.show !== Math.min(FUEL_STICKS, Math.ceil((fuelIn(th) / Math.min(PLACEABLES[th.kind].fire.maxFuel, 10)) * FUEL_STICKS - 0.001))))) {
      burnNow(th); drawPlaced(th); // burnt down a stick, or out of fuel: the fire goes out by itself
    }
    const parts = th.view.userData.parts;
    if (!parts.flame || !parts.flame.visible) continue;
    const size = 0.65 + 0.35 * Math.min(1, fuelIn(th) / 4);
    for (const f of parts.flame.children) {
      const [r, h] = f.userData.base, ph = f.userData.phase;
      const flick = reduceMotion ? 1 : 1 + Math.sin(elapsed * 9 + ph) * 0.12 + Math.sin(elapsed * 23 + ph * 2) * 0.07;
      f.scale.set(r * size * (2 - flick) * 0.95, h * size * flick, r * size * (2 - flick) * 0.95);
      f.rotation.z = reduceMotion ? 0 : Math.sin(elapsed * 3 + ph) * 0.06;
    }
    const d = (th.x - c.x) ** 2 + (th.z - c.z) ** 2;
    if (d < nd) { nd = d; near = th; }
  }
  if (near && nd < 40 * 40) {
    const dark = clamp01(1.45 - sun.intensity / 2); // strong at night, a soft glow by day
    fireLight.position.set(near.x, groundY(near.x, near.z) + 0.6, near.z);
    fireLight.intensity = (5 + (reduceMotion ? 0 : Math.sin(elapsed * 11) * 0.6 + Math.sin(elapsed * 27) * 0.4)) * dark * (0.7 + 0.3 * Math.min(1, fuelIn(near) / 4));
  } else fireLight.intensity = 0;
}

/* ---------- placing: pick a spot, then your person goes and puts it down ---------- */
const placing = { on: false, item: null, kind: null, x: 0, z: 0, rot: 0, ghost: null, ok: false };
const placeRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 36).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#9fd88a', transparent: true, opacity: 0.8, depthWrite: false }));
placeRing.visible = false;
placeRing.renderOrder = 2;
scene.add(placeRing);
// why it can't go here (or null if it can)
function cantPlaceAt(x, z, kind) {
  const r = PLACEABLES[kind].solid;
  if (Math.abs(x) > WALK_LIMIT - 1 || Math.abs(z) > WALK_LIMIT - 1) return 'Too close to the forest';
  if (pondShape(x, z) < 1.35) return 'Too close to the water';
  if (!roomAt(x, z, r + 0.25, 0.4)) return 'Not enough room here';
  if ([...placed.values()].some((th) => Math.hypot(th.x - x, th.z - z) < r + PLACEABLES[th.kind].solid + 1)) return 'Too close to another one';
  const c = notMineAt(x, z);
  if (c) return `That's ${c.claim.name}'s claim`;
  return null;
}
function startPlacing(item) {
  const kind = ITEMS[item] && ITEMS[item].places;
  if (!kind || !player || you.dead || !you.carry[item]) return;
  closeBag(); closeCraft(); closeMenu();
  stopPlacing();
  const ghost = campfireModel(ITEMS[item].look).model;
  ghost.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.userData = {}; m.material.transparent = true; m.material.opacity = 0.55; m.material.depthWrite = false; } });
  scene.add(ghost);
  Object.assign(placing, { on: true, item, kind, ghost, rot: player.rotation.y });
  const fx = Math.sin(player.rotation.y), fz = Math.cos(player.rotation.y);
  movePlacing(player.position.x + fx * 1.8, player.position.z + fz * 1.8);
  $('placeBar').hidden = false;
  app.classList.add('placing');
}
function movePlacing(x, z) {
  if (!placing.on) return;
  placing.x = x; placing.z = z;
  const why = cantPlaceAt(x, z, placing.kind);
  placing.ok = !why;
  placing.ghost.position.set(x, groundY(x, z), z);
  placing.ghost.rotation.y = placing.rot;
  placeRing.position.set(x, groundY(x, z) + 0.04, z);
  placeRing.material.color.set(why ? '#e07a6a' : '#9fd88a');
  placeRing.visible = true;
  const claim = !why && placing.kind === CLAIMS.placeable ? claimHere(x, z) : null; // would lighting it claim the land?
  showPlaceClaim(why ? null : [x, z], claim);
  $('placeText').textContent = why || (claim ? claim.text : 'Tap the ground to move it');
  $('placeGo').disabled = !!why;
}
function stopPlacing() {
  if (placing.ghost) { scene.remove(placing.ghost); disposeMaterials(placing.ghost); }
  placing.on = false; placing.ghost = null;
  placeRing.visible = false;
  showPlaceClaim(null);
  $('placeBar').hidden = true;
  app.classList.remove('placing');
}
function finishPlacing() {
  if (!placing.on || !placing.ok) return;
  const t = { type: 'place', item: placing.item, kind: placing.kind, x: placing.x, z: placing.z, rot: placing.rot };
  stopPlacing();
  queueTask(t);
}
$('placeGo').addEventListener('click', finishPlacing);
$('placeCancel').addEventListener('click', stopPlacing);

/* ---------- doing things with them: tasks in your queue ---------- */
const sendNow = (msg) => sendAct(msg); // where you are first (the server checks you're close); kept for when the connection comes back (online.js)
const goNear = (th, then) => approach(th.x, th.z, PLACEABLES[th.kind].solid + 0.35, PLACEABLES[th.kind].solid + 0.75, then);
const placedSpot = (t) => { const th = placed.get(t.id); return th ? V(th.x, groundY(th.x, th.z) + 0.8, th.z) : null; };
Object.assign(TASK_KINDS, {
  // putting it down where you chose: then building it straight after (the server says when it's there)
  place: {
    start(t) {
      if (!you.carry[t.item]) { nextTask(); return; }
      const why = cantPlaceAt(t.x, t.z, t.kind);
      if (why) { showTag(why, headTop(), 2); nextTask(); return; }
      approach(t.x, t.z, PLACEABLES[t.kind].solid + 0.45, PLACEABLES[t.kind].solid + 0.9, () => {
        face(t.x, t.z);
        startAction({ pose: 'bend', seconds: 0.9, mid: () => {
          if (!you.carry[t.item]) return;
          takeFromCarry(t.item, 1);
          drawHeld(); drawCarry();
          sendNow({ t: 'place', kind: t.item, x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100, rot: Math.round(t.rot * 100) / 100 });
        } });
      });
    },
    name: (t, now) => (now ? `Putting down the ${PLACEABLES[t.kind].name.toLowerCase()}` : `Place ${PLACEABLES[t.kind].name.toLowerCase()}`),
    spot: (t) => V(t.x, groundY(t.x, t.z) + 0.5, t.z),
  },
  // building a site: the pieces go into place as you work
  build: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || th.built) { nextTask(); return; }
      goNear(th, () => {
        if (!placed.has(th.id) || th.built) { nextTask(); return; }
        const P = PLACEABLES[th.kind];
        face(th.x, th.z);
        showTag(`${P.buildVerb}…`, headTop(), 2, P.buildSeconds * slowness() + 0.3);
        tagLabel.busy = true;
        startAction({ pose: 'kneel', seconds: P.buildSeconds,
          tick: (k) => { th.progress = k; drawPlaced(th); },
          cancel: () => { th.progress = 0; drawPlaced(th); },
          end: () => {
            th.built = true; th.progress = 1; th.at = Date.now();
            drawPlaced(th);
            spendEnergy('build');
            showGain(`${P.name} built`);
            sendNow({ t: 'build', id: th.id });
          } });
      });
    },
    name: (t, now) => { const th = placed.get(t.id), n = th ? PLACEABLES[th.kind].name.toLowerCase() : 'it'; return now ? `Building the ${n}` : `Build ${n}`; },
    spot: placedSpot,
  },
  // picking an unbuilt site back up
  // picking up an unbuilt site, or packing up a built one (it has to be out)
  unplace: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || (th.built && PLACEABLES[th.kind].fire && isLit(th))) { nextTask(); return; }
      const P = PLACEABLES[th.kind];
      if (carried() + ITEMS[P.item].weight > SETTINGS.carryCapacity) { showTag('Too heavy', headTop(), 2); nextTask(); return; }
      goNear(th, () => {
        face(th.x, th.z);
        startAction({ pose: 'bend', seconds: th.built ? 2 : 0.9, mid: () => sendNow({ t: 'unplace', id: th.id }) });
      });
    },
    name: (t, now) => { const th = placed.get(t.id); return th && th.built ? (now ? 'Packing it up' : 'Pack it up') : (now ? 'Picking it up' : 'Pick it up'); },
    spot: placedSpot,
  },
  // taking a built one apart: its parts land on the ground round it (the server says what)
  apart: {
    start(t) {
      const th = placed.get(t.id);
      if (!th || !th.built) { nextTask(); return; }
      goNear(th, () => {
        face(th.x, th.z);
        startAction({ pose: 'kneel', seconds: 3, mid: () => sendNow({ t: 'apart', id: th.id }) });
      });
    },
    name: (t, now) => (now ? 'Taking it apart' : 'Take it apart'),
    spot: placedSpot,
  },
  // a fire: add sticks, light it, put it out
  tend: {
    start(t) {
      const th = placed.get(t.id), F = th && PLACEABLES[th.kind].fire;
      if (!th || !th.built || !F) { nextTask(); return; }
      goNear(th, () => {
        burnNow(th);
        let n = 0;
        const kind = t.fuel && F.fuels[t.fuel] ? t.fuel : F.fuel, each = F.fuels[kind]; // sticks, or another fuel like logs
        if (t.do === 'add') {
          n = Math.min(t.n || 1, you.carry[kind] || 0, roomFor(th, kind));
          if (n < 1) { showTag(you.carry[kind] ? 'The fire is full' : `You have no ${ITEMS[kind].plural.toLowerCase()}`, headTop(), 2); nextTask(); return; }
        }
        if (t.do === 'light' && (isLit(th) || fuelLeft(th) <= 0)) { showTag(isLit(th) ? "It's already lit" : 'Add fuel first', headTop(), 2); nextTask(); return; }
        if (t.do === 'out' && !isLit(th)) { nextTask(); return; }
        face(th.x, th.z);
        const secs = t.do === 'light' ? F.lightSeconds : 1.2;
        if (t.do === 'light') { showTag('Lighting the fire…', headTop(), 2, secs * slowness() + 0.3); tagLabel.busy = true; }
        startAction({ pose: t.do === 'out' ? 'bend' : 'kneel', seconds: secs, end: () => {
          burnNow(th);
          if (t.do === 'add') {
            n = Math.min(n, you.carry[kind] || 0, roomFor(th, kind));
            if (n < 1) return;
            takeFromCarry(kind, n);
            th.fuel = Math.min(F.max, fuelLeft(th) + n * each);
            showGain(`+${timeLeft(n * each)} of fuel`);
            drawHeld(); drawCarry();
          } else if (t.do === 'light') { if (fuelLeft(th) <= 0) return; th.lit = true; th.burnt = true; th.at = Date.now(); showGain('The fire is lit'); }
          else { th.lit = false; showGain('Fire put out'); }
          spendEnergy('tend');
          drawPlaced(th);
          sendNow({ t: 'fire', id: th.id, do: t.do, n, fuel: kind });
        } });
      });
    },
    name: (t, now) => {
      const th = placed.get(t.id), F = th && PLACEABLES[th.kind].fire, fuel = ITEMS[t.fuel] || (F ? ITEMS[F.fuel] : ITEMS.stick);
      if (t.do === 'light') return now ? 'Lighting the fire' : 'Light fire';
      if (t.do === 'out') return now ? 'Putting out the fire' : 'Put out fire';
      return now ? `Adding ${fuel.plural.toLowerCase()}` : `Add ${t.n > 1 ? `${t.n} ${fuel.plural.toLowerCase()}` : fuel.name.toLowerCase()}`;
    },
    spot: placedSpot,
  },
  // sitting by the fire: walk to a free seat and sit until you stand up, do something else or the fire goes out (it carries on while you're away)
  sit: {
    start(t) {
      const th = placed.get(t.id);
      if (you.sit) { drawQueue(); return; } // already sitting (something quick came first, like putting a thing down): carry on
      if (!th || !th.built || !PLACEABLES[th.kind].seats) { nextTask(); return; }
      const k = freeSeat(th);
      if (k < 0) { showTag('No room by the fire', headTop(), 2); nextTask(); return; }
      const [x, z] = seatSpot(th, k);
      const sitDown = () => {
        if (!placed.has(th.id)) { nextTask(); return; }
        if (seatTaken(th, k)) { const again = freeSeat(th); if (again < 0) { showTag('No room by the fire', headTop(), 2); nextTask(); return; } TASK_KINDS.sit.start(t); return; }
        const [sx, sz] = seatSpot(th, k);
        playerGround = groundY(sx, sz);
        player.position.set(sx, playerGround, sz);
        face(th.x, th.z);
        you.sit = { fire: th.id, seat: k };
        sendNow({ t: 'sit', id: th.id, seat: k });
        showTag('Sitting by the fire', headTop(), 2);
        drawQueue();
      };
      if (Math.hypot(x - player.position.x, z - player.position.z) < 0.2) sitDown();
      else walkTo(V(x, 0, z), sitDown, nextTask);
    },
    stop() { endSit(true, false); },
    name: (t, now) => (now ? 'Sitting by the fire' : 'Sit by the fire'),
    spot: placedSpot,
  },
});
// while sitting (called each frame instead of walking): stay put, stand up if the fire has gone out
function holdSit(P) {
  const th = placed.get(you.sit.fire);
  if (th) player.rotation.y = Math.atan2(th.x - player.position.x, th.z - player.position.z);
  sitPose(player, P, playerGround);
  if (!th || (PLACEABLES[th.kind].fire && !isLit(th))) endSit(true);
}
// standing up: tell the server (unless it already knows), and move on to the next thing in the queue
function endSit(tell = true, next = true) {
  if (!you.sit) return;
  you.sit = null;
  if (player) unsitPose(player, player.userData.parts, playerGround);
  if (tell) sendNow({ t: 'sit', off: true });
  if (next && tasks.current && tasks.current.type === 'sit') nextTask();
}
// back in the game while still sitting (you left the task running): carry on sitting
function resumeSit(s) {
  const th = s && placed.get(s.fire);
  if (!th || !player) return;
  const [x, z] = seatSpot(th, s.seat);
  playerGround = groundY(x, z);
  player.position.set(x, playerGround, z);
  tasks.current = { type: 'sit', id: th.id };
  you.sit = { fire: th.id, seat: s.seat };
  drawQueue();
}
// leaving the world (Exit, or your person died): forget the sit here; the server still has it while you're away
function forgetSit() {
  if (!you.sit) return;
  you.sit = null;
  if (tasks.current && tasks.current.type === 'sit') tasks.current = null;
  if (player) unsitPose(player, player.userData.parts, playerGround);
}

/* ---------- the tap menu for a placed thing ---------- */
// the tap menu: what you'll most likely want first, putting the fire out last, Inspect and Walk here small along the bottom
function placedActions(th) {
  const P = PLACEABLES[th.kind], name = P.name.toLowerCase();
  const walkHere = { label: 'Walk here', foot: true, run: () => walkFirst(V(th.x + P.solid + 0.8, 0, th.z)) };
  if (!th.built) {
    return [{ label: `Build ${name}`, note: `${P.buildSeconds} s`, run: () => queueTask({ type: 'build', id: th.id }) },
      { label: `Pick up ${name}`, note: 'Not built yet', run: () => queueTask({ type: 'unplace', id: th.id }) }, walkHere];
  }
  const out = [];
  const F = P.fire, lit = !!F && isLit(th);
  if (F && !lit) out.push({ label: 'Light fire', disabled: fuelLeft(th) <= 0, note: fuelLeft(th) > 0 ? `${F.lightSeconds} s` : 'Add fuel first', run: () => queueTask({ type: 'tend', id: th.id, do: 'light' }) });
  if (F) { // Add fuel: one list of every fuel it takes that you carry (sticks, logs), one or as many as fit
    const fuels = [];
    let carrying = false;
    for (const [kind, each] of Object.entries(F.fuels)) {
      const have = you.carry[kind] || 0, n = Math.min(have, roomFor(th, kind));
      if (have) carrying = true;
      if (n < 1) continue;
      fuels.push({ label: `Add ${countLabel(kind, 1).toLowerCase()}`, note: `+${timeLeft(each)}`, run: () => queueTask({ type: 'tend', id: th.id, do: 'add', n: 1, fuel: kind }) });
      if (n > 1) fuels.push({ label: `Add ${countLabel(kind, n).toLowerCase()}`, note: `+${timeLeft(n * each)}`, run: () => queueTask({ type: 'tend', id: th.id, do: 'add', n, fuel: kind }) });
    }
    if (fuels.length) out.push({ label: 'Add fuel', sub: fuels });
    else if (carrying) out.push({ label: 'Add fuel', note: 'Full', disabled: true, run: () => {} });
  }
  // recipes made here ("near" in a recipe), like cooking on a fire: craftLabel names the list (Cook)
  const here = RECIPES.filter((r) => r.near === th.kind && recipeKnown(r));
  if (here.length && (!F || lit)) {
    out.push({ label: P.craftLabel, sub: here.map((r) => {
      const why = cantMake(r) === 'Not here' ? '' : cantMake(r); // not here yet is fine: you walk over first
      return { label: recipeName(r), note: why, disabled: !!why, run: () => queueTask({ type: 'make', id: th.id, recipe: r.id }) };
    }) });
  }
  if (P.seats && (!F || lit)) out.push({ label: `Sit by ${name}`, run: () => queueTask({ type: 'sit', id: th.id }) });
  if (lit) out.push({ label: 'Put out fire', run: () => queueTask({ type: 'tend', id: th.id, do: 'out' }) });
  else { // once it's out: pack it into your inventory, or take it apart for what it's made of (only who built it; the server checks)
    const heavy = carried() + ITEMS[P.item].weight > SETTINGS.carryCapacity;
    out.push({ label: 'Pack up', disabled: heavy, note: heavy ? 'Too heavy' : F && fuelLeft(th) > 0 ? 'Fuel left is lost' : 'Into your inventory', run: () => queueTask({ type: 'unplace', id: th.id }) });
    out.push({ label: 'Take apart', note: takeApartNote(th), run: () => queueTask({ type: 'apart', id: th.id }) });
  }
  out.push({ label: 'Inspect', foot: true, run: () => showTag(fireState(th) || P.name, V(th.x, groundY(th.x, th.z) + 1.1, th.z), 2, 5) }, walkHere);
  return out;
}
// what taking it apart gives back: its recipe's parts, less what burns once a fire has been lit
function takeApartNote(th) {
  const P = PLACEABLES[th.kind], r = RECIPES.find((x) => x.makes[P.item]);
  if (!r) return '';
  const back = Object.entries(r.needs).filter(([k]) => !(th.burnt && P.fire && P.fire.fuels[k]));
  if (!back.length) return 'Nothing left to keep';
  return back.length === Object.keys(r.needs).length ? 'Get back its parts' : `Get back ${back.map(([k, n]) => countLabel(k, n).toLowerCase()).join(', ')}`;
}
/* ---------- stations: recipes that need a placed thing close by ----------
   A recipe with "near": "campfire" can only be made by a built one (a fire has to be lit), so cooking is just recipes.
   The server checks the same with a little more room (stationFor in server/src/placed.js). */
const STATION_REACH = 3; // metres from its edge
function stationNear(kind) {
  const P = PLACEABLES[kind];
  if (!P || !player) return null;
  for (const th of placed.values()) {
    if (th.kind === kind && th.built && (!P.fire || isLit(th)) && !notMineAt(th.x, th.z) && Math.hypot(th.x - player.position.x, th.z - player.position.z) <= STATION_REACH + P.solid) return th;
  }
  return null;
}
Object.assign(TASK_KINDS, {
  // making a recipe here, like cooking on the fire: walk over, then make it
  make: {
    start(t) {
      const th = placed.get(t.id), r = RECIPES.find((x) => x.id === t.recipe);
      if (!th || !r) { nextTask(); return; }
      goNear(th, () => {
        const why = cantMake(r);
        if (why) { showTag(why === 'Not here' ? `The ${PLACEABLES[th.kind].name.toLowerCase()} has to be lit` : why, headTop(), 2); nextTask(); return; }
        face(th.x, th.z);
        make(r);
      });
    },
    name: (t, now) => { const r = RECIPES.find((x) => x.id === t.recipe), n = r ? recipeName(r).toLowerCase() : 'it'; return now ? `Making ${n}` : `Make ${n}`; },
    spot: placedSpot,
  },
});

/* ---------- claims (0.3.0): your first lit campfire claims the land round it while it burns ----------
   The server decides (server/src/claims.js) and says whose claim a fire is (th.claim: { who, name }); a claim only
   counts while its fire is lit. Inside someone else's claim you can only walk through: the tap menus say so
   (menuActions in input.js), placing there is refused, and autopilot leaves their things alone. */
const CLAIMS = { radius: 10, spawnRadius: 16, placeable: 'campfire', ringShowsWithin: 25, ...(DATA.claims || {}) };
const claimOn = (th) => !!th.claim && isLit(th);
const claimName = (th) => (th.claim.who === net.myId ? 'Your claim' : `${th.claim.name}'s claim`);
const claimAt = (x, z) => { for (const th of placed.values()) if (claimOn(th) && Math.hypot(th.x - x, th.z - z) <= CLAIMS.radius) return th; return null; };
// someone else's claim at x, z (the admin can do anything anywhere)
const notMineAt = (x, z) => { const c = claimAt(x, z); return c && c.claim.who !== net.myId ? c : null; };
// placing a campfire: would lighting it there claim the land? { ok, text } (the server has the final say)
function claimHere(x, z) {
  const all = [...placed.values()].filter(claimOn);
  const no = claimProblem(x, z, { radius: CLAIMS.radius, spawnRadius: CLAIMS.spawnRadius, pond: POND, hasClaim: all.some((th) => th.claim.who === net.myId),
    claims: all.map((th) => ({ x: th.x, z: th.z, name: th.claim.name })) }); // rules.js, the same on the server
  if (!no) return { ok: true, text: 'Light it to claim the land round it' };
  return { ok: false, text: no.why === 'has' ? 'Just a fire: you already have a claim' : no.why === 'pond' ? 'Just a fire: too close to the pond to claim' : `Just a fire: too close to ${no.name}'s claim` };
}
// a soft ring on the ground at a claim's edge, following the hills
const ringMats = { mine: new THREE.MeshBasicMaterial({ color: '#9fd88a', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  theirs: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
  maybe: new THREE.MeshBasicMaterial({ color: '#9fd88a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  no: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }) };
for (const m of Object.values(ringMats)) m.userData.shared = true;
function claimRingMesh(x, z, material) {
  const n = 120, w = 0.12, R = CLAIMS.radius, pos = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const r of [R - w, R]) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; pos.push(px, groundY(px, pz) + 0.06, pz); }
  }
  const idx = [];
  for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return mesh;
}
function drawClaimRing(th) {
  const want = claimOn(th) ? (th.claim.who === net.myId ? 'mine' : 'theirs') : null;
  if (th.ring && th.ring.userData.kind === want && th.ring.userData.x === th.x && th.ring.userData.z === th.z) return;
  if (th.ring) { scene.remove(th.ring); th.ring.geometry.dispose(); th.ring = null; }
  if (!want) return;
  th.ring = claimRingMesh(th.x, th.z, ringMats[want]);
  Object.assign(th.ring.userData, { kind: want, x: th.x, z: th.z });
}
let placeClaim = null;
function showPlaceClaim(at, claim) {
  if (placeClaim) { scene.remove(placeClaim); placeClaim.geometry.dispose(); placeClaim = null; }
  if (at && claim) placeClaim = claimRingMesh(at[0], at[1], claim.ok ? ringMats.maybe : ringMats.no);
}
// every half second: rings near you show, fires that went out lose theirs, and walking into a claim says whose it is
let claimCheckAt = 0, inClaim = null;
function updateClaims(now) {
  if (now - claimCheckAt < 500 || !player) return;
  claimCheckAt = now;
  for (const th of placed.values()) {
    drawClaimRing(th);
    if (th.ring) th.ring.visible = Math.hypot(th.x - player.position.x, th.z - player.position.z) <= CLAIMS.radius + CLAIMS.ringShowsWithin;
  }
  const c = claimAt(player.position.x, player.position.z), id = c ? c.id : null;
  if (id !== inClaim) { inClaim = id; if (c) showTag(claimName(c), headTop(), 2.5); }
}
