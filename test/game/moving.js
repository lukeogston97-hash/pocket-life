/* ---------- moving about ---------- */
const walk = { target: null, path: null, replanned: false, onArrive: null, onFail: null, phase: 0, side: 0, best: Infinity, bestAt: 0 };
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
// somewhere you can stand: out of the pond (onto the nearest shore) and out of anything solid
function onDryLand(x, z) {
  if (pondShape(x, z) < 0.9) { const s = shorePointToward(V(x, 0, z)); x = s.x; z = s.z; }
  if (solidAt(x, z)) [x, z] = outsideSolid(x, z);
  return [x, z];
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
/* ---------- finding a way round things ----------
   The walkable ground is a grid of half-metre cells (free unless a rock, bush, log, trunk or the pond is there).
   A walk finds a route through it (A*), then cuts corners wherever there's a clear straight line,
   so your person (and people strolling while away) go round obstacles instead of getting stuck on them. */
const PATH_CELL = 0.5, GRID_N = Math.ceil((WALK_LIMIT * 2) / PATH_CELL) + 1;
const cellFree = new Uint8Array(GRID_N * GRID_N); // 0 not checked yet, 1 free, 2 blocked
const toCell = (v) => Math.max(0, Math.min(GRID_N - 1, Math.round((v + WALK_LIMIT) / PATH_CELL)));
const cellPos = (i) => i * PATH_CELL - WALK_LIMIT;
function freeCell(ix, iz) {
  if (ix < 0 || iz < 0 || ix >= GRID_N || iz >= GRID_N) return false;
  const k = iz * GRID_N + ix;
  if (!cellFree[k]) { const x = cellPos(ix), z = cellPos(iz); cellFree[k] = pondShape(x, z) >= 0.9 && !solidAt(x, z) ? 1 : 2; }
  return cellFree[k] === 1;
}
const freeAt = (x, z) => freeCell(toCell(x), toCell(z));
// check these cells again (something that blocked the way has gone)
function clearCellsNear(x, z, r) {
  const n = Math.ceil(r / PATH_CELL) + 1, cx = toCell(x), cz = toCell(z);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const ix = cx + i, iz = cz + j;
    if (ix >= 0 && iz >= 0 && ix < GRID_N && iz < GRID_N) cellFree[iz * GRID_N + ix] = 0;
  }
}
// is the straight line from a to b clear? (checked every quarter metre)
function clearLine(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25);
  for (let i = 1; i <= n; i++) { const t = i / n; if (!freeAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
  return true;
}
// the nearest free cell to a spot (for a goal that's inside a bush, say), within about 3 metres
function nearestFree(x, z) {
  const cx = toCell(x), cz = toCell(z);
  if (freeCell(cx, cz)) return [cx, cz];
  for (let r = 1; r <= 6; r++) {
    let best = null, bd = Infinity;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r || !freeCell(cx + i, cz + j)) continue;
      const dd = Math.hypot(cellPos(cx + i) - x, cellPos(cz + j) - z);
      if (dd < bd) { bd = dd; best = [cx + i, cz + j]; }
    }
    if (best) return best;
  }
  return null;
}
// A route from (ax, az) to (bx, bz) as a list of points to walk through, or null if there's no way
function findPath(ax, az, bx, bz) {
  if (clearLine(ax, az, bx, bz)) return [[bx, bz]];
  const s = nearestFree(ax, az), g = nearestFree(bx, bz);
  if (!s || !g) return null;
  const sk = s[1] * GRID_N + s[0], gk = g[1] * GRID_N + g[0];
  const from = new Map([[sk, -1]]), cost = new Map([[sk, 0]]);
  const heap = [[0, sk]];
  const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const h = (ix, iz) => { const dx = Math.abs(ix - g[0]), dz = Math.abs(iz - g[1]); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };
  let found = false;
  for (let n = 0; heap.length && n < 30000; n++) {
    const [, k] = pop();
    if (k === gk) { found = true; break; }
    const ix = k % GRID_N, iz = (k - ix) / GRID_N, c = cost.get(k);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const nx = ix + di, nz = iz + dj;
      if (!freeCell(nx, nz)) continue;
      if (di && dj && (!freeCell(ix + di, iz) || !freeCell(ix, iz + dj))) continue; // no squeezing past corners
      const nk = nz * GRID_N + nx, nc = c + (di && dj ? Math.SQRT2 : 1);
      if (cost.has(nk) && cost.get(nk) <= nc) continue;
      cost.set(nk, nc); from.set(nk, k);
      push(nc + h(nx, nz), nk);
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = gk; k !== -1; k = from.get(k)) cells.push([cellPos(k % GRID_N), cellPos(Math.floor(k / GRID_N))]);
  cells.reverse();
  cells[cells.length - 1] = freeAt(bx, bz) ? [bx, bz] : cells[cells.length - 1];
  // cut corners: from each point, jump to the furthest point you can walk to in a straight line
  const out = [];
  let cx = ax, cz = az, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !clearLine(cx, cz, cells[j][0], cells[j][1])) j--;
    out.push(cells[j]);
    [cx, cz] = cells[j];
    i = j + 1;
  }
  return out;
}
function walkTo(p, onArrive, onFail) {
  const [ox, oz] = outsideSolid(inWorld(p.x), inWorld(p.z));
  const dest = V(inWorld(ox), 0, inWorld(oz));
  walk.target = dest;
  walk.path = findPath(player.position.x, player.position.z, dest.x, dest.z) || [[dest.x, dest.z]];
  walk.replanned = false;
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
function startAction(a) {
  walk.target = null;
  action = { t0: elapsed, done: false, seconds: 0.5, pose: 'bend', ...a };
  action.seconds *= slowness(); // out of breath: it takes longer
  if (online()) net.sock.send(JSON.stringify({ t: 'act', pose: action.pose, seconds: action.seconds }));
}
// other people's actions, shown the same way as yours: a bend to pick something up, picking berries, kneeling to drink
function animateAct(m, P, ground, act, dt) {
  const t = elapsed - act.t0, dur = act.seconds, k = clamp01(t / dur), stoop = P.body.userData.stoop;
  setLegs(P, 0);
  if (act.pose === 'chop') {
    const sw = (Math.sin(t * 5.5) + 1) / 2, env = clamp01(Math.min(t, dur - t) / 0.3);
    P.body.rotation.x = stoop + (0.08 + 0.22 * sw) * env;
    setArm(P.armR, (-2.5 + sw * 2.0) * env);
    setArm(P.armL, (-2.3 + sw * 1.9) * env);
  } else if (act.pose === 'kneel' || act.pose === 'pick') {
    const env = clamp01(Math.min(t, dur - t) / 0.3), wave = Math.sin(t * 7);
    if (act.pose === 'kneel') {
      P.body.rotation.x = stoop + 1.05 * env;
      m.position.y = ground - 0.12 * env;
      setArm(P.armR, (-0.6 + wave * 0.3) * env);
      setArm(P.armL, (-0.6 + wave * 0.3) * env);
    } else {
      P.body.rotation.x = stoop + 0.15 * env;
      setArm(P.armR, (-1.25 + wave * 0.25) * env);
      setArm(P.armL, (-1.0 - wave * 0.25) * env);
    }
  } else {
    const s = Math.sin(k * Math.PI);
    P.body.rotation.x = stoop + 1.0 * s;
    m.position.y = ground - 0.14 * s;
    setArm(P.armR, -0.55 * s);
    setArm(P.armL, -0.35 * s);
  }
  if (k >= 1) { P.body.rotation.x = stoop; setArm(P.armR, 0); setArm(P.armL, 0); m.position.y = ground; return false; }
  return true;
}

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
  if (!wakeUp()) return;
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
  } else if (t.type === 'chop') {
    if (!['tree', 'stump', 'oldStump'].includes(t.what) && !getItem(t.id)) { nextTask(); return; }
    const stop = t.what === 'tree' ? 0.95 : t.what === 'log' ? 0.6 : 0.85;
    approach(t.x, t.z, stop, stop + 0.35, () => doChop(t));
  } else if (t.type === 'cut') {
    approach(t.x, t.z, 0.55, 0.9, () => doCut(t));
  } else if (t.type === 'drop') doDrop(t);
  else if (t.type === 'walk') walkTo(V(t.x, 0, t.z), nextTask, nextTask);
  else nextTask();
}
/* ---------- autopilot: here but idle ----------
   After away.idleMinutes with no taps and nothing queued, your person carries on by themselves, the same way they
   do while you're away: eat what they carry, pick berries, drink at the pond, and stroll about near where you left off.
   Touch anything and you're back in charge. */
const AWAY = { idleMinutes: 3, wanderMin: 25, wanderMax: 50, eatBelow: 60, drinkBelow: 55, ...(DATA.away || {}) };
const auto = { on: false, home: null, nextAt: 0, drinking: false };
let lastInput = performance.now();
function tookInput() {
  lastInput = performance.now();
  if (!auto.on) return;
  auto.on = false;
  stopQueue();
  $('autoChip').hidden = true;
}
for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, tookInput, true);
function busy() { return !!(tasks.current || tasks.list.length || action || walk.target); }
function autopilot() {
  const now = performance.now();
  if (ui.mode !== 'world' || !player || you.dead || paused || !online() || !you.stats) return;
  if (!auto.on) {
    if (busy() || now - lastInput < AWAY.idleMinutes * 60000) return;
    auto.on = true;
    auto.home = AWAY.near === 'pond' ? [POND.x, POND.z] : [player.position.x, player.position.z];
    auto.nextAt = now;
    $('autoChip').hidden = false;
  }
  if (busy() || now < auto.nextAt) return;
  const st = you.stats;
  // tired: lie down until rested
  if (you.sleeping) { if (st.rest != null && st.rest >= 99) setSleeping(false); return; }
  if (st.rest != null && st.rest < (AWAY.sleepBelow || 35)) { setSleeping(true); return; }
  // eat what you carry when hungry
  for (let n = 0; n < 6 && st.hunger < AWAY.eatBelow; n++) {
    const food = Object.keys(you.carry).find((k) => ITEMS[k] && ITEMS[k].eat);
    if (!food) break;
    eatOne(food);
  }
  const water = Object.values(SOURCES).find((src) => !harvests(src) && src.gives.thirst);
  if (water && (st.thirst < AWAY.drinkBelow || (auto.drinking && st.thirst < 90))) {
    auto.drinking = true;
    queueTask({ type: 'use', source: water.id, water: true });
    return;
  }
  auto.drinking = false;
  const hasFood = Object.keys(you.carry).some((k) => ITEMS[k] && ITEMS[k].eat);
  if (!hasFood && st.hunger < AWAY.eatBelow + 20) { // getting peckish with nothing to eat: go and pick some
    const near = berryBushes.filter((b) => ripe(b)).sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
    if (near) { queueTask(bushTask(near)); return; }
  }
  // rest a little, then stroll somewhere near where you left off
  if (!auto.rested) { auto.rested = true; auto.nextAt = now + 15000 + Math.random() * 45000; return; }
  auto.rested = false;
  for (let t = 0; t < 40; t++) {
    const a = Math.random() * Math.PI * 2, r = AWAY.wanderMin + Math.random() * (AWAY.wanderMax - AWAY.wanderMin);
    const x = auto.home[0] + Math.cos(a) * r, z = auto.home[1] + Math.sin(a) * r;
    if (Math.abs(x) > WALK_LIMIT - 1 || Math.abs(z) > WALK_LIMIT - 1 || pondShape(x, z) < 1.3 || !roomAt(x, z, 0.5, 0.5)) continue;
    walkFirst(V(x, 0, z));
    return;
  }
  auto.nextAt = now + 10000;
}
// the task for picking a berry from a bush (the same as tapping it)
function bushTask(b) {
  const box = new THREE.Box3().setFromObject(b);
  return { type: 'use', source: b.userData.source, bush: b.userData.bushId, x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, top: box.max.y,
    stop: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.3 };
}
setInterval(autopilot, 2000);
// Sleeping: lie down where you are (Rest fills up); giving your person anything to do wakes them
function setSleeping(on, fromServer = false) {
  on = !!on;
  if (!player || you.dead) { you.sleeping = on; return; }
  const was = !!you.sleeping;
  you.sleeping = on;
  if (on) {
    stopQueue();
    player.rotation.x = -Math.PI / 2;
    player.position.y = playerGround + 0.2;
    if (!was) showTag('Zzz…', headTop(), 2.5);
  } else if (was) {
    resetPose();
    you.collapsed = false;
    if (!fromServer) showTag('Awake', headTop(), 1.5);
  }
  if (!fromServer && online()) net.sock.send(JSON.stringify({ t: 'sleep', on }));
  drawNeeds();
}
// Waking: any task wakes your person, unless they collapsed from no Rest and it isn't back to wakeAt yet.
const REST = STATS.find((s) => s.id === 'rest');
const tooTiredToWake = () => !!(you.collapsed && REST && you.stats && you.stats.rest < (REST.wakeAt || 0));
function wakeUp() {
  if (!you.sleeping) return true;
  if (tooTiredToWake()) { showTag(`Too tired to get up yet (Rest ${Math.floor(you.stats.rest)}%)`, headTop(), 2.5); return false; }
  setSleeping(false);
  return true;
}
// a walk joins the end of the queue, so it never interrupts anything
function walkFirst(p) {
  if (!wakeUp()) return;
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
    spendEnergy('pickup');
    shareTake(item); // online: tell the world (if someone beat you to it, it comes back out of your inventory)
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
    else {
      applyGives(src.gives);
      spendEnergy('drink');
      if (online()) net.sock.send(JSON.stringify({ t: 'drink', source: src.id }));
    }
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
// With the source's tool (a knife) you cut a few at once (toolHarvest); the server works it out the same way.
function harvestFrom(src, t) {
  const b = berryBushes[t.bush];
  const many = src.tool && src.toolHarvest && you.carry[src.tool] && b && berriesOn(b) >= Object.values(src.toolHarvest).reduce((a, n) => a + n, 0);
  const got = many ? src.toolHarvest : src.harvest;
  if ((b && !ripe(b)) || carried() + weightOf(got) > SETTINGS.carryCapacity) return;
  for (const [k, n] of Object.entries(got)) addToCarry(k, n);
  you.lastPick = Object.values(got).reduce((a, n) => a + n, 0);
  if (many) you.tool = src.tool;
  spendEnergy('harvest');
  if (b) { for (let k = 0; k < you.lastPick; k++) pickBerry(b); drawBerries(b); sharePick(t.bush); }
  drawHeld();
  drawCarry();
  showGain(Object.entries(got).map(([k, n]) => `+${countLabel(k, n)}`).join(', '));
}
// eating food you carry happens straight away, one at a time
function eatOne(kind) {
  if (ui.mode !== 'world' || !player || you.dead || !you.carry[kind]) return;
  const gives = ITEMS[kind].eat || {};
  if (!useHelps({ gives })) { showTag(fullLabel({ gives }), headTop(), 2); return; }
  takeFromCarry(kind, 1);
  applyGives(gives);
  if (online()) net.sock.send(JSON.stringify({ t: 'eat', kind }));
  drawHeld();
  drawCarry();
}
// cutting a plant (tall grass): by hand it takes a while, with the right tool (a knife) it's quick. What it gives goes
// straight into your inventory; the server has the final say (if someone cut it first, it's taken back)
function doCut(t) {
  const def = PLANTS[t.plant], c = plants[t.plant] && plants[t.plant].clumps[t.i];
  if (!def || !c) { nextTask(); return; }
  if (!plantReady(c)) { showTag(`Grows back in ${growsIn(c)}`, headTop(), 2); nextTask(); return; }
  if (carried() + weightOf(def.gives) > SETTINGS.carryCapacity) { showTag('Inventory full', headTop(), 2); stopQueue(); return; }
  const tool = def.tool && you.carry[def.tool] ? def.tool : null;
  if (tool) { you.tool = tool; drawHeld(); }
  const secs = tool ? def.toolSeconds || def.seconds : def.seconds || 6;
  face(t.x, t.z);
  showTag(`${def.verb || 'Cutting'}…`, headTop(), 2, secs * slowness() + 0.3);
  tagLabel.busy = true;
  startAction({ pose: def.pose || 'pick', seconds: secs, end: () => {
    if (!plantReady(c)) { showTag('Someone cut it first', headTop(), 2); return; }
    for (const [k, n] of Object.entries(def.gives || {})) addToCarry(k, n);
    setPlant(t.plant, t.i, Date.now() + 2 * 3600000); // the server sends the real time it grows back
    spendEnergy('harvest');
    if (online()) net.sock.send(JSON.stringify({ t: 'cut', plant: t.plant, i: t.i }));
    drawHeld();
    drawCarry();
    showGain(Object.entries(def.gives || {}).map(([k, n]) => `+${countLabel(k, n)}`).join(', '));
  } });
}
// chopping: swing the axe for a while, then the server says what came of it
function doChop(t) {
  const rule = CHOP[t.what === 'oldStump' ? 'stump' : t.what] || {};
  if (t.what === 'oldStump' && oldStumps[t.idx] && oldStumps[t.idx].gone) { nextTask(); return; }
  if (CHOP.tool && !you.carry[CHOP.tool]) { showTag(`You need a ${ITEMS[CHOP.tool].name.toLowerCase()}`, headTop(), 2); nextTask(); return; }
  if (CHOP.tool) { you.tool = CHOP.tool; drawHeld(); }
  if ((t.what === 'tree' && trees[t.idx] && trees[t.idx].state !== 'tree') || (t.what === 'stump' && trees[t.idx] && trees[t.idx].state !== 'stump')) { nextTask(); return; }
  face(t.x, t.z);
  showTag(t.what === 'tree' ? 'Chopping…' : t.what === 'stump' || t.what === 'oldStump' ? 'Digging out the stump…' : 'Chopping…', headTop(), 2, (rule.seconds || 10) + 0.3);
  tagLabel.busy = true;
  startAction({ pose: 'chop', seconds: rule.seconds || 10, end: () => {
    spendEnergy('chop');
    if (online()) net.sock.send(JSON.stringify({ t: 'chop', what: t.what, idx: t.idx, id: t.id, x: t.x, z: t.z }));
  } });
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
    const out = [];
    for (let i = 0; i < taken; i++) { const s = dropSpot(i); out.push({ kind: t.kind, x: s.x, z: s.z, rot: rand() * Math.PI }); }
    placeItems(out);
    drawHeld();
    drawCarry();
  } });
}
// dropping from your inventory happens straight away, then your person carries on with the queue
function dropItems(kind, n) {
  if (ui.mode !== 'world' || !player || you.dead || !you.carry[kind]) return;
  closeBag();
  closeCraft();
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
  if (t.type === 'cut') return now ? `${(PLANTS[t.plant] || {}).verb || 'Cutting'}` : (PLANTS[t.plant] || {}).action || 'Cut';
  if (t.type === 'chop') return t.what === 'tree' ? (now ? 'Chopping a tree' : 'Chop tree') : t.what === 'stump' || t.what === 'oldStump' ? (now ? 'Removing a stump' : 'Remove stump') : (now ? 'Chopping a log' : 'Chop log');
  if (t.type === 'walk') return now ? 'Walking' : 'Walk there';
  return '';
}
// the list above the bottom bar: what your person is doing now, then what's next
let queueOpen = false; // the full list is showing
function drawQueue() {
  for (const b of badges) removeLabel(b);
  badges = [];
  const cur = tasks.current;
  // only shown while your person has something to do
  const show = ui.mode === 'world' && !!player && !you.dead && !!(cur || tasks.list.some((t) => t.type !== 'drop'));
  $('queue').hidden = !show;
  if (!show) return;
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
