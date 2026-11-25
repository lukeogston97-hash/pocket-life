/* ---------- you: plain data, plus your 3D person ---------- */
const START = { x: 0.6, z: 1.9 };
const you = { look: null, carry: {}, wear: {}, seen: [], found: [], lastKind: null, lifeStart: 0, stats: null, statsAt: 0, dead: false }; // carry: item id -> how many; stats: need -> 0 to 100
const ui = { mode: 'menu' }; // menu (the main menu), creator (making your person) or world (playing)
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
// your hands are empty unless you're using a tool right now (chopping with the axe, cutting with the knife) (Luke, 0.2.1)
const heldKind = () => (you.using && you.carry[you.using] ? you.using : null);
function drawHeld() {
  if (heldView) { if (heldView.parent) heldView.parent.remove(heldView); heldView = null; }
  const kind = player && heldKind();
  if (!kind) return;
  const { model, hold, grip } = buildItem(kind);
  if (hold === 'none') return; // too big to hold in one hand (a log)
  const wrap = new THREE.Group();
  if (hold === 'axe') {
    // Held at the end of the handle. Worked out in the person's
    // own frame (forward, up), then turned into the hand's frame, so it looks right however the arm is built.
    const P = player.userData.parts;
    const saved = P.armR.rotation.clone();
    setArm(P.armR, 0);
    player.updateMatrixWorld(true);
    const qHand = P.handR.getWorldQuaternion(new THREE.Quaternion());
    const qMe = player.getWorldQuaternion(new THREE.Quaternion());
    P.armR.rotation.copy(saved);
    player.updateMatrixWorld(true);
    const handInMe = qMe.invert().multiply(qHand);
    // the handle carries on down the line of the arm, head at the far end and the blade facing forward,
    // so raising the arm lifts the axe overhead and swinging down brings the blade down onto the tree
    const along = V(0, -1, 0.18).normalize(), blade = V(0, 0.18, 1).normalize(), side = V().crossVectors(blade, along);
    const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, side, blade));
    wrap.quaternion.copy(handInMe.invert().multiply(want));
    model.position.x = grip || 0.2;
    model.rotation.x = Math.PI; // turned over on the handle so the cutting edge faces the other way (Luke, 0.1.6)
    wrap.add(model);
    wrap.position.set(0, -0.05, 0);
  } else {
    if (hold === 'rod') { model.rotation.y = -Math.PI / 2; wrap.rotation.x = 0.25; wrap.position.set(0, -0.02, 0.12); }
    else wrap.position.set(0, -0.07, 0.03);
    wrap.add(model);
  }
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
const headTop = () => (player ? V(player.position.x, playerGround + player.userData.headTop + 0.1, player.position.z) : controls.target.clone()); // on the main menu: the middle of the view
const tmp = V();
// The free space between the info at the top and the bars at the bottom, measured (big phone text makes the HUD taller).
// Name tags fade out where they'd run into the HUD, and menus and pop-ups stay inside the free space.
const hudZone = { top: 0, bottom: 1e9, menuBottom: 1e9 };
function measureHud() {
  const ar = app.getBoundingClientRect();
  const who = document.querySelector('.hud-top .who'), menuBtn = $('menuBtn');
  hudZone.top = Math.max(who ? who.getBoundingClientRect().bottom : 0, menuBtn.getBoundingClientRect().bottom) - ar.top;
  const bars = [...document.querySelectorAll('.hud-bottom > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
  hudZone.bottom = (bars.length ? Math.min(...bars.map((r) => r.top)) : ar.bottom) - ar.top;
  const q = $('queue');
  hudZone.menuBottom = q.hidden ? hudZone.bottom : Math.min(hudZone.bottom, q.getBoundingClientRect().top - ar.top);
  document.documentElement.style.setProperty('--below-hud', `${Math.round(hudZone.top + 8)}px`);
}
addEventListener('resize', () => setTimeout(measureHud, 50));
function updateLabels() {
  const w = app.clientWidth, h = app.clientHeight;
  for (let i = labels.length - 1; i >= 0; i--) {
    const L = labels[i];
    const age = elapsed - L.born;
    if (age > L.ttl) { removeLabel(L); if (L === tagLabel) tagLabel = null; continue; }
    if (L.off || (L.who && !L.who.shown)) { L.el.style.opacity = '0'; continue; } // someone who isn't drawn
    tmp.copy(L.anchor).add(L.offset);
    tmp.y += L.rise * age;
    tmp.project(camera);
    const sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h;
    const bw = L.bw || (L.bw = L.el.offsetWidth), bh = L.bh || (L.bh = L.el.offsetHeight);
    const left = Math.max(8, Math.min(w - bw - 8, sx - bw / 2));
    const top = sy - bh - L.gap;
    L.el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    const clear = clamp01(Math.min(top - hudZone.top, hudZone.bottom - (top + bh)) / 16 + 1); // fade out under the HUD
    const fade = clear * Math.min(Math.min(1, age / 0.2), clamp01((L.ttl - age) / 0.4));
    L.el.style.opacity = tmp.z < 1 ? fade.toFixed(2) : '0';
  }
}

/* ---------- the clock and the info at the edges ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The world has one clock for everyone: settings.worldTimeZone (Darwin time for the Oceania world). worldNow() gives
// a Date whose UTC fields read as the time there, so the date, the time and day and night are the same on every phone.
const WORLD_TZ = SETTINGS.worldTimeZone || 'Australia/Darwin';
// The world's clock is its own, not your phone's (someone in Sydney would think the game's clock was wrong), so the Menu
// says where it's from: "Australia/Darwin" reads as Darwin.
const WORLD_PLACE = WORLD_TZ.split('/').pop().replace(/_/g, ' ');
$('pauseNote').textContent = `The world keeps going while this is open. It runs on ${WORLD_PLACE} time.`;
const tzFormats = new Map();
// the time now in a time zone (the world's own unless another is asked for), as a Date whose UTC fields read as that time
function worldNow(tz = WORLD_TZ) {
  const now = new Date();
  if (!tzFormats.has(tz)) {
    let f = null;
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); } catch (err) { /* very old browser */ }
    tzFormats.set(tz, f);
  }
  const f = tzFormats.get(tz);
  if (!f) return new Date(now.getTime() + 9.5 * 3600000); // Darwin is UTC+9:30 all year
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second));
}
// the worlds (regions) shown on the main menu; menuRegion is the one being looked at there (see screens.js)
const REGIONS = (DATA.regions || []).filter((r) => r && r.id && r.name);
let menuRegion = REGIONS.find((r) => r.open) || null;
const formatDate = (d) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const formatTime = (d) => `${((d.getUTCHours() + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')} ${d.getUTCHours() < 12 ? 'am' : 'pm'}`;
function drawHud() {
  if (!you.look) return;
  $('hudName').textContent = you.look.name;
  $('hudAge').textContent = String(you.look.age);
  const now = worldNow(); // the world runs on real time, on its own clock
  $('hudTime').textContent = `${formatDate(now)} · ${formatTime(now)}`;
  measureHud();
}
function drawWeightBar(bar, w) {
  bar.style.width = `${Math.min(100, (w / SETTINGS.carryCapacity) * 100)}%`;
  bar.parentElement.classList.toggle('full', w >= SETTINGS.carryCapacity);
}
function drawCarry() {
  if (typeof craftOpen === 'function' && craftOpen()) drawCraft();
  const w = carried();
  $('carryWeight').textContent = fmt(w);
  $('carryMax').textContent = fmt(SETTINGS.carryCapacity);
  $('bagBtn').classList.toggle('full', w >= SETTINGS.carryCapacity);
  if (bagOpen()) drawBag();
}
let hintTimer = 0;
function showHint() { $('hint').hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 15000); }
function hideHint() { $('hint').hidden = true; }
