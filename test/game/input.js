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
  if (craftOpen()) closeCraft();
  if (!$('chat').hidden) closeSay(); // tapping the world puts the chat away
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
// another person close to a tap on screen (their middle, about a metre up)
function personNear(px, py, maxPx = 42) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  let best = null, bd = maxPx;
  for (const o of others.values()) {
    if (!o.shown) continue; // not drawn (too many people about)
    tmp2.copy(o.mesh.position); tmp2.y += 0.9;
    tmp2.project(camera);
    if (tmp2.z > 1) continue;
    const d = Math.hypot((tmp2.x * 0.5 + 0.5) * w - px, (-tmp2.y * 0.5 + 0.5) * h - py);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function pickTarget(px, py) {
  const someone = personNear(px, py);
  if (someone) return { kind: 'person', person: someone, name: someone.title };
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
  const useful = hits.find(({ o }) => o === player || o.userData.itemId || o.userData.source || o.userData.placedId != null);
  const { h: hit = null, o: owner = null } = useful || hits[0] || {};
  if (owner === player) return { kind: 'you' };
  const gp = groundHit && groundHit.point;
  // a near miss still counts: within a finger's width on screen, or within about a metre on the ground
  const item = (owner && owner.userData.itemId && getItem(owner.userData.itemId))
    || (useful ? null : itemNear(px, py, lastPointer === 'mouse' ? 34 : 46))
    || (useful || !gp ? null : itemCloseTo(gp.x, gp.z, 0.9));
  if (item) return { kind: 'item', item, name: ITEMS[item.kind].name };
  if (owner && owner.userData.placedId != null && placed.has(owner.userData.placedId)) { const th = placed.get(owner.userData.placedId); return { kind: 'placed', th, name: placedName(th) }; }
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
  if (isWater) return { kind: 'shore', name: 'Pond' };
  if (owner && owner.userData.grave) return { kind: 'grave', name: owner.userData.label, x: owner.position.x, z: owner.position.z };
  if (owner && owner.userData.stump != null) return { kind: 'stump', idx: owner.userData.stump, name: 'Tree stump', x: owner.position.x, z: owner.position.z };
  if (owner && owner.userData.oldStump != null) { const o = oldStumps[owner.userData.oldStump]; return { kind: 'oldStump', idx: owner.userData.oldStump, name: 'Tree stump', x: o.x, z: o.z }; }
  const copy = hit && hit.object && hit.object.isInstancedMesh && hit.instanceId != null ? copyOwner.get(`${hit.object.uuid}:${hit.instanceId}`) : null;
  const rk = owner && owner.userData.rock != null ? owner.userData.rock : copy && copy.kind === 'rock' ? copy.i : -1;
  if (rk >= 0 && rocks[rk].state !== 'gone') { const r = rocks[rk]; return { kind: 'rock', idx: rk, name: r.boulder ? (r.state === 'mined' ? 'Mined boulder' : 'Boulder') : 'Rock', x: r.x, z: r.z }; }
  if (copy && copy.kind === 'oldStump' && !oldStumps[copy.i].gone) { const o = oldStumps[copy.i]; return { kind: 'oldStump', idx: copy.i, name: 'Tree stump', x: o.x, z: o.z }; }
  if (copy && copy.kind === 'tree' && trees[copy.i].state === 'tree') { const tr = trees[copy.i]; return { kind: 'tree', idx: copy.i, name: tr.pine ? 'Pine tree' : 'Tree', x: tr.x, z: tr.z, hit }; }
  if (owner && (owner.userData.label === 'Tree' || owner.userData.label === 'Pine tree')) {
    const i = treeNear(hit.point);
    if (i >= 0) return { kind: 'tree', idx: i, name: owner.userData.label, x: trees[i].x, z: trees[i].z, hit };
  }
  if (hit && hit.object && hit.object.userData.plant && hit.instanceId != null) {
    const P = plants[hit.object.userData.plant], c = P && P.clumps[Math.floor(hit.instanceId / P.per)];
    if (c) return plantTarget(hit.object.userData.plant, c);
  }
  if (owner) return { kind: 'thing', owner, hit, name: owner.userData.label || '' };
  const pl = gp && plantNear(gp);
  if (pl) return plantTarget(pl.kind, pl.c);
  if (gp) return { kind: 'ground', point: gp, name: '' };
  return null;
}
// Walking needs a double tap (or double-click), so a stray tap doesn't send you off.
// The first tap leaves a faint ring where you'd go; tap again near it, quickly, to walk.
const DOUBLE_MS = 420, DOUBLE_PX = 45;
let firstTap = null;
const tapRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
tapRing.rotation.x = -Math.PI / 2;
tapRing.visible = false;
tapRing.renderOrder = 2;
scene.add(tapRing);
function showTapRing(p) {
  tapRing.position.set(p.x, groundY(p.x, p.z) + 0.05, p.z);
  tapRing.userData.age = 0;
  tapRing.visible = true;
}
function fadeTapRing(dt) {
  if (!tapRing.visible) return;
  const age = (tapRing.userData.age += dt), life = DOUBLE_MS / 1000;
  tapRing.material.opacity = 0.55 * Math.max(0, 1 - age / life);
  tapRing.scale.setScalar(1 + age * 0.6);
  if (age >= life) tapRing.visible = false;
}
function handleTap(px, py) {
  if (ui.mode !== 'world' || !player || you.dead || paused) return;
  if (!online()) { showTag('Reconnecting…', headTop(), 1.5); return; }
  if (adminMoving) { adminMoveTap(); return; } // the admin moving something: this tap says where it goes
  if (placing.on) { // choosing where to put something: a tap moves it there
    ray.setFromCamera(ndc, camera);
    const g = ray.intersectObject(terrain, false)[0];
    if (g) movePlacing(g.point.x, g.point.z);
    return;
  }
  const t = pickTarget(px, py);
  if (!t) return;
  if (t.kind === 'you') { firstTap = null; openMenuAt(px, py, { kind: 'self', name: 'You' }); return; }
  // a stick, stone, berry bush or the pond: open the menu of what you can do with it
  if (['item', 'use', 'person', 'grave', 'tree', 'stump', 'oldStump', 'rock', 'plant', 'placed'].includes(t.kind)) { firstTap = null; openMenuAt(px, py, t); return; }
  // the ground (or a rock, tree or log): one tap opens Walk here, a quick double-tap walks straight there
  const now = performance.now();
  if (!firstTap || now - firstTap.t > DOUBLE_MS || Math.hypot(px - firstTap.px, py - firstTap.py) > DOUBLE_PX) {
    firstTap = { t: now, px, py };
    const p = t.point || (t.hit && t.hit.point);
    if (p) showTapRing(p);
    openMenuAt(px, py, t);
    return;
  }
  firstTap = null;
  tapRing.visible = false;
  closeMenu();
  walkToTarget(t);
}
// walk to the ground, the shore, or up to a rock, tree or log (after anything already queued)
function walkToTarget(t) {
  if (t.kind === 'shore') { walkFirst(shorePointToward(player.position)); return; }
  if (t.kind === 'thing') {
    const { owner, hit } = t;
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
  if (t.kind === 'person') {
    const o = t.person, isMuted = muted.has(o.who);
    return [{ label: isMuted ? 'Unmute' : 'Mute', note: isMuted ? '' : 'Hide what they say', run: () => {
        setMuted(o.who, !isMuted);
        if (!isMuted && o.bubble) { removeLabel(o.bubble); o.bubble = null; }
        showTag(isMuted ? `${o.title} unmuted` : `${o.title} muted`, headTop(), 2);
      } },
      { label: 'Report', run: () => openReport(o) },
      { label: 'Walk here', foot: true, run: () => walkFirst(V(o.mesh.position.x, 0, o.mesh.position.z)) }, ...adminMore(adminPersonActions(o))];
  }
  if (t.kind === 'ground' || t.kind === 'thing' || t.kind === 'shore') {
    return [{ label: 'Walk here', run: () => walkToTarget(t) }, ...adminMore(adminGroundActions(t.point || (t.hit && t.hit.point)))];
  }
  if (t.kind === 'tree' || t.kind === 'stump' || t.kind === 'oldStump') {
    const what = t.kind;
    const rule = CHOP[what === 'oldStump' ? 'stump' : what] || {}, tool = CHOP.tool && ITEMS[CHOP.tool];
    const has = !tool || you.carry[CHOP.tool];
    return [{ label: what === 'tree' ? 'Chop tree' : 'Remove stump', note: has ? `${rule.seconds || 15} s` : `Needs a ${tool.name.toLowerCase()}`, disabled: !has,
      run: () => queueTask({ type: 'chop', what, idx: t.idx, x: t.x, z: t.z }) },
      ...(what === 'stump' && trees[t.idx] ? [{ label: `Grows back in ${stumpGrowsIn(trees[t.idx])}`, disabled: true }] : []),
      { label: 'Walk here', foot: true, run: () => walkFirst(V(t.x + 1.2, 0, t.z)) },
      ...(what !== 'oldStump' ? adminMore(adminThingActions('tree', t.idx, what === 'stump')) : [])];
  }
  if (t.kind === 'rock') {
    const r = rocks[t.idx], rule = MINE[r.boulder ? 'boulder' : 'rock'] || {}, tool = MINE.tool && ITEMS[MINE.tool];
    const has = !tool || you.carry[MINE.tool];
    const walk = { label: 'Walk here', foot: true, run: () => walkFirst(V(r.x + r.r + 0.6, 0, r.z)) };
    const adm = adminMore(adminThingActions('rock', t.idx, r.state === 'mined'));
    if (r.state === 'mined') return [{ label: `Mine again in ${growsBackIn(r.since, MINE.regrowDays || 3)}`, disabled: true }, walk, ...adm];
    return [{ label: r.boulder ? 'Mine boulder' : 'Break rock', note: has ? `${rule.seconds || 10} s` : `Needs a ${tool.name.toLowerCase()}`, disabled: !has,
      run: () => queueTask({ type: 'mine', idx: t.idx, x: r.x, z: r.z }) }, walk, ...adm];
  }
  if (t.kind === 'self') {
    const rest = you.stats && you.stats.rest != null ? Math.round(you.stats.rest) : null;
    if (you.sit) return [{ label: 'Stand up', run: () => endSit(true) }];
    return [you.sleeping ? { label: 'Wake up', note: tooTiredToWake() ? `Rest ${Math.floor(you.stats.rest)} of ${REST.wakeAt}` : '', run: wakeUp } : { label: 'Sleep', note: rest != null ? `Rest ${rest}` : '', run: () => setSleeping(true) },
      ...adminMore(admin.on ? [{ label: 'Fill my needs', run: () => adminSend({ t: 'a.fill', id: net.myId }) }] : [])];
  }
  if (t.kind === 'placed') return placedActions(t.th);
  if (t.kind === 'grave') return [{ label: 'Walk here', run: () => walkFirst(V(t.x + 0.8, 0, t.z)) }];
  if (t.kind === 'plant') {
    const def = PLANTS[t.plant], c = plants[t.plant].clumps[t.i], fast = def.tool && you.carry[def.tool];
    const ready = plantReady(c);
    return [{ label: def.action || 'Cut', disabled: !ready,
      note: !ready ? `Grows back in ${growsIn(c)}` : fast ? `${def.toolSeconds || def.seconds} s` : `${def.seconds} s${def.tool ? ` · faster with a ${ITEMS[def.tool].name.toLowerCase()}` : ''}`,
      run: () => queueTask({ type: 'cut', plant: t.plant, i: t.i, x: t.x, z: t.z }) },
      { label: 'Walk here', foot: true, run: () => walkFirst(V(t.x + 0.7, 0, t.z)) }];
  }
  if (t.kind === 'item') {
    const it = t.item;
    const chopIt = CHOP[it.kind] && CHOP.tool;
    return [{ label: `Pick up ${ITEMS[it.kind].name}`, note: it.uses != null ? `${it.uses} ${it.uses === 1 ? 'use' : 'uses'} left` : '', run: () => queueTask({ type: 'pickup', id: it.id }) },
      ...(chopIt ? [{ label: 'Chop into sticks', note: you.carry[CHOP.tool] ? `${CHOP[it.kind].seconds || 8} s` : `Needs a ${ITEMS[CHOP.tool].name.toLowerCase()}`, disabled: !you.carry[CHOP.tool],
        run: () => queueTask({ type: 'chop', what: it.kind, id: it.id, x: it.x, z: it.z }) }] : []),
      { label: 'Walk here', foot: true, run: () => walkFirst(V(it.x, 0, it.z)) },
      ...adminMore(admin.on ? [{ label: 'Remove', run: () => adminSend({ t: 'a.remove', id: it.id }) }] : [])];
  }
  if (t.kind === 'use') {
    const src = SOURCES[t.task.source], task = t.task;
    const walkHere = { label: 'Walk here', foot: true, run: () => {
      if (task.water) { walkFirst(shorePointToward(player.position)); return; }
      const dx = task.x - player.position.x, dz = task.z - player.position.z, d = Math.hypot(dx, dz) || 1;
      walkFirst(V(task.x - (dx / d) * task.stop, 0, task.z - (dz / d) * task.stop));
    } };
    if (harvests(src)) {
      const b = berryBushes[task.bush];
      const ready = !b || ripe(b);
      return [{ label: `Harvest ${ITEMS[Object.keys(src.harvest)[0]].plural}`, note: ready ? (b ? `${berriesOn(b)} left` : '') : `Next in ${readyIn(b)}`,
        disabled: !ready, run: () => queueTask(task) }, walkHere, ...(b ? adminMore(adminThingActions('bush', task.bush, berriesOn(b) < bushHolds(src))) : [])];
    }
    return [{ label: src.action || `Use ${src.name.toLowerCase()}`, run: () => queueTask(task) }, walkHere];
  }
  return [];
}
function openMenuAt(px, py, known) {
  if (ui.mode !== 'world' || !player || you.dead || paused || placing.on) return false;
  const t = known || pickTarget(px, py);
  const acts = menuActions(t);
  hideHint(); // the tip has done its job once you've tapped something
  if (!acts.length) { closeMenu(); return false; }
  const menu = $('actMenu');
  $('actTitle').textContent = t.name;
  showActs(acts);
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  measureHud();
  menu.style.left = `${Math.round(Math.min(Math.max(8, px + 8), app.clientWidth - w - 8))}px`;
  const lo = hudZone.top + 6, hi = Math.min(app.clientHeight, hudZone.menuBottom) - h - 6;
  menu.style.top = `${Math.round(Math.max(lo, Math.min(hi, py + 8)))}px`;
  return true;
}
// a list of buttons in the small menu; an item with a "sub" list opens it in place, with Back.
// Ones marked foot (Inspect, Walk here) sit small along the bottom. Past MENU_MAX others, the rest go under More,
// so a menu never gets long as things are added; Admin always shows.
const MENU_MAX = 5;
function showActs(acts, back) {
  const actBtn = (a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act-btn';
    b.setAttribute('role', 'menuitem');
    b.textContent = a.label;
    if (a.note) { const small = document.createElement('small'); small.textContent = a.note; b.appendChild(small); }
    b.disabled = !!a.disabled;
    if (a.sub) b.classList.add('act-more');
    if (a.back) b.classList.add('act-back');
    b.addEventListener('click', () => {
      if (a.sub) { showActs(a.sub, () => showActs(acts, back)); return; }
      if (a.back) { a.run(); return; }
      closeMenu(); a.run();
    });
    return b;
  };
  let foot = acts.filter((a) => a.foot), main = acts.filter((a) => !a.foot && !a.admin);
  if (!main.length) { main = foot; foot = []; } // only Walk here: then it's the menu
  if (main.length > MENU_MAX) main = [...main.slice(0, MENU_MAX - 1), { label: 'More', sub: main.slice(MENU_MAX - 1) }];
  const list = [...(back ? [{ label: '‹ Back', back: true, run: back }] : []), ...main, ...acts.filter((a) => a.admin)];
  const rows = list.map(actBtn);
  if (foot.length) {
    const row = document.createElement('div');
    row.className = 'act-foot';
    row.setAttribute('role', 'group');
    row.append(...foot.map(actBtn));
    rows.push(row);
  }
  $('actList').replaceChildren(...rows);
}
function closeMenu() { $('actMenu').hidden = true; }
// pressing anywhere else closes the menu (and that press doesn't also walk)
document.addEventListener('pointerdown', (e) => {
  if ($('actMenu').hidden || $('actMenu').contains(e.target)) return;
  closeMenu();
  if (e.target !== canvas) return;
  const r = canvas.getBoundingClientRect();
  const second = firstTap && performance.now() - firstTap.t <= DOUBLE_MS && Math.hypot(e.clientX - r.left - firstTap.px, e.clientY - r.top - firstTap.py) <= DOUBLE_PX;
  if (!second) swallowTap = true; // that press only closed the menu
}, true);

/* ---------- pause menu (Escape on a computer): your person waits, the real-time clock keeps going ---------- */
let paused = false;
function openPause() {
  if (ui.mode !== 'world' || !player || you.dead) return;
  closeMenu();
  closeBag();
  closeCraft();
  keysDown.clear();
  paused = true;
  $('pause').hidden = false;
  $('resumeBtn').focus();
}
function closePause() { paused = false; $('pause').hidden = true; }
$('resumeBtn').addEventListener('click', closePause);
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) closePause(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.mode === 'menu') { closeNews(); closeFeedback(); closeSettings(); return; }
  if (e.key !== 'Escape' || ui.mode !== 'world') return;
  e.preventDefault();
  if (maint.on) return;
  if (placing.on) stopPlacing();
  else if (!$('news').hidden) closeNews();
  else if (!$('back').hidden) $('back').hidden = true;
  else if (!$('adminPick').hidden) closePicker();
  else if (!$('adminPanel').hidden) adminEscape(); // the player page goes back to Players, else the panel closes
  else if (!$('report').hidden) closeReport();
  else if (!$('feedback').hidden) closeFeedback();
  else if (!$('chat').hidden) closeSay();
  else if (!$('actMenu').hidden) closeMenu();
  else if (!$('death').hidden) return;
  else if (craftOpen()) closeCraft();
  else if (bagOpen()) closeBag();
  else if (paused && !$('pause').hidden) closePause();
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
    if (action.tick) action.tick(k); // building shows its progress
    setLegs(P, 0);
    if (action.pose === 'chop') {
      const sw = (Math.sin(t * 5.5) + 1) / 2, env = clamp01(Math.min(t, dur - t) / 0.3);
      P.body.rotation.x = stoop + (0.08 + 0.22 * sw) * env;
      setArm(P.armR, (-2.5 + sw * 2.0) * env);
      setArm(P.armL, (-2.3 + sw * 1.9) * env);
    } else if (action.pose === 'kneel' || action.pose === 'pick') {
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
  } else if (you.sit) holdSit(P); // sitting by a fire until the time's up (placeables.js)
  else if (walk.target) {
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
    // the next point on the route (the last one is where you're going)
    while (walk.path && walk.path.length > 1 && Math.hypot(walk.path[0][0] - player.position.x, walk.path[0][1] - player.position.z) < 0.25) {
      walk.path.shift(); walk.best = Infinity; walk.bestAt = elapsed;
    }
    const aim = walk.path && walk.path.length > 1 ? walk.path[0] : [walk.target.x, walk.target.z];
    const ax = aim[0] - player.position.x, az = aim[1] - player.position.z, ad = Math.hypot(ax, az);
    if (ad < walk.best - 0.05) { walk.best = ad; walk.bestAt = elapsed; }
    if (d < 0.06) stop();
    else if (elapsed - walk.bestAt > 1.5) {
      // not getting any closer: look for a new way round once, then give up
      if (!walk.replanned) {
        walk.replanned = true;
        walk.path = findPath(player.position.x, player.position.z, walk.target.x, walk.target.z);
        walk.best = Infinity; walk.bestAt = elapsed;
        if (!walk.path) stop("Can't get there");
      } else stop("Can't get there");
    }
    else {
      // head for the next point, stepping round anything small in the way
      const step = Math.min(ad, (SETTINGS.walkSpeed / slowness()) * dt); // out of breath: slower
      const base = Math.atan2(ax, az);
      const tries = walk.side < 0 ? [0, -0.5, -1, -1.5, -2, 0.5, 1, 1.5, 2] : [0, 0.5, 1, 1.5, 2, -0.5, -1, -1.5, -2];
      let nx = 0, nz = 0, heading = base, ok = false;
      for (const off of tries) {
        nx = inWorld(player.position.x + Math.sin(base + off) * step);
        nz = inWorld(player.position.z + Math.cos(base + off) * step);
        const hitNow = solidAt(player.position.x, player.position.z), hitNext = solidAt(nx, nz);
        const blocked = hitNext && (!hitNow || hitNext.depth > hitNow.depth - 1e-4); // you can always step out of something
        const wet = pondShape(nx, nz) < 0.86 && pondShape(nx, nz) <= pondShape(player.position.x, player.position.z); // you can always wade out of the pond
        if (!wet && !blocked) { ok = true; heading = base + off; if (off && !walk.side) walk.side = Math.sign(off); break; }
      }
      if (!ok) stop("Can't get there");
      else {
        spendEnergy('walkPerMetre', Math.hypot(nx - player.position.x, nz - player.position.z));
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
