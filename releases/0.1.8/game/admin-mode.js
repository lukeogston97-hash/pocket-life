/* ---------- admin mode (Luke, 23 Nov 2026): the admin is not a person ----------
   Tap or click the version number on the main menu 5 times, then type the admin password. The game then watches the
   world as the admin: no person, a free camera, and the admin's panels floating over the live world. Nobody playing a
   person is ever the admin (the server checks: server/src/index.js isAdmin).
   The password is asked for every time. It is kept only in this page's memory while admin mode is open (so a dropped
   connection can rejoin by itself), never on the device, and it's forgotten on Exit admin or when the page closes. The
   real check is on the server (the Cloudflare secret ADMIN_CODE); the 5 taps only keep the box out of players' way. */
const adminMode = { on: false, code: '', asking: false, saved: null, follow: null, wait: null }; // follow: the id of the person the camera is following; wait: the timer for no answer to the password
// 5 taps in a row: each within ADMIN_TAP_GAP of the one before (a longer pause starts the count again). It's a gap between
// taps, not a time limit for all five, and a generous one: the main menu is when a phone is busiest (the world is loading
// behind it), and this is the only way in. The taps only keep the box out of players' way; the password is the real lock.
const ADMIN_TAPS = 5, ADMIN_TAP_GAP = 4000;
function fiveTaps(el, allowed, open) {
  const taps = { n: 0, last: 0 };
  el.addEventListener('click', (e) => {
    if (adminMode.on || !allowed()) return;
    const now = e.timeStamp || performance.now(); // when the finger tapped, not when the game got round to it
    taps.n = now - taps.last <= ADMIN_TAP_GAP ? taps.n + 1 : 1;
    taps.last = now;
    if (taps.n < ADMIN_TAPS) return;
    taps.n = 0;
    open();
  });
}
fiveTaps($('menuVer'), () => ui.mode === 'menu', () => openAdminLogin());
// While maintenance is on, the main link shows "Back soon" to everyone and the main menu can't be reached. The admin still
// has to be able to get in (to turn it off): 5 taps on the words "Back soon" open the same password box. (Not on the other
// notices that use this card, like Playing somewhere else: there the game has stopped looking in.)
fiveTaps($('maintTitle'), () => maint.on && !net.stopped, () => { if (ui.mode !== 'menu') toMenu(); openAdminLogin(); });
// A second way to the password box, for a device where five quick taps are awkward: ?admin on the end of the address
// (start.js opens the box once the main menu is up). It only opens the box. The password is the lock, and the server checks it.
const ADMIN_LINK = /[?&]admin(=|&|$)/.test(location.search);
function openAdminLogin(note = 'Enter the admin password.') {
  $('adminLoginNote').textContent = note;
  $('adminLoginCode').value = '';
  $('adminLoginGo').disabled = false;
  $('adminLogin').hidden = false;
  $('adminLoginCode').focus();
}
function closeAdminLogin() { $('adminLogin').hidden = true; $('adminLoginCode').value = ''; $('adminLoginCode').blur(); }
$('adminLoginCancel').addEventListener('click', () => { adminMode.code = ''; adminMode.asking = false; closeAdminLogin(); });
$('adminLogin').addEventListener('click', (e) => { if (e.target === $('adminLogin')) $('adminLoginCancel').click(); });
$('adminLoginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('adminLoginCode').value;
  if (!code) return;
  const open = !!net.sock && net.sock.readyState === 1;
  // Not connected: on the Back soon screen that's normal (the game only looks in every 20 seconds), so it looks in now,
  // with the password. Anywhere else it means the phone is offline.
  if (!open && (!maint.on || net.stopped)) { $('adminLoginNote').textContent = "You're offline. Try again when the dot is green."; return; }
  adminMode.code = code;
  adminMode.asking = true;
  $('adminLoginGo').disabled = true;
  $('adminLoginNote').textContent = 'Checking…';
  net.mode = 'watch';
  if (open) sendHello(); // the same connection asks to watch as the admin (screens.js)
  else goOnline(); // (it says hello by itself once it's through: online.js)
  clearTimeout(adminMode.wait); // no answer at all: say so, and forget the password
  adminMode.wait = setTimeout(() => {
    if (!adminMode.asking || adminMode.on) return;
    adminMode.code = ''; adminMode.asking = false;
    if (!$('adminLogin').hidden) openAdminLogin('No answer from the server. Try again in a moment.');
  }, 20000);
});
// the server's answer to the password: in, or not
function adminLoginAnswer(ok) {
  clearTimeout(adminMode.wait);
  if (ok) {
    adminMode.asking = false;
    closeAdminLogin();
    if (!adminMode.on) enterAdmin();
    return;
  }
  const was = adminMode.on;
  adminMode.code = ''; adminMode.asking = false;
  if (was) { exitAdmin(false); openAdminLogin('The password is needed again.'); return; } // (it stopped being accepted while admin mode was open)
  if (!$('adminLogin').hidden) openAdminLogin("That didn't work. After a few wrong tries you have to wait 15 minutes.");
}

/* ---------- in and out ---------- */
function enterAdmin() {
  adminMode.on = true;
  ui.mode = 'admin';
  setFresh(false); // the world as it really is
  closeMenu(); closePause(); closeBag(); closeCraft(); closeSay(); hideHint();
  keysDown.clear();
  paused = false; // the world is always live under the admin's panels
  app.classList.remove('is-menu', 'is-creating');
  app.classList.add('is-admin');
  $('mainMenu').hidden = true;
  $('adminBar').hidden = false;
  ring.visible = false;
  // a free camera: move it anywhere, further out and nearer overhead than a player's (put back on the way out)
  adminMode.saved = { minDistance: controls.minDistance, maxDistance: controls.maxDistance, minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle,
    enablePan: controls.enablePan, screenSpacePanning: controls.screenSpacePanning, touches: { ...controls.touches }, enabled: controls.enabled };
  // On a phone one finger slides the view over the ground, two fingers pinch to zoom and twist to turn. With a mouse,
  // dragging turns the view and W A S D slide it (a phone has no keys, so its one finger has to be the slide).
  Object.assign(controls, { minDistance: 6, maxDistance: 120, minPolarAngle: deg(4), maxPolarAngle: deg(72), enablePan: true, screenSpacePanning: false, enabled: true });
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const t = V(POND.x, groundY(POND.x, POND.z) + 1.0, POND.z);
  controls.target.copy(t);
  camera.position.copy(t).add(V().setFromSpherical(new THREE.Spherical(34, deg(50), menuCam.angle)));
  controls.update();
  adminHud();
  drawAdminBar();
}
// back to the main menu as an ordinary visitor; the password is forgotten
function exitAdmin(rejoin = true) {
  if (!adminMode.on) return;
  adminMode.on = false; adminMode.code = ''; adminMode.asking = false;
  admin.on = false;
  adminFollow(null);
  $('adminPanel').hidden = true; $('adminPick').hidden = true;
  forgetAdminData(); // (admin.js) what the dashboard held goes with the password
  closeMenu();
  keysDown.clear();
  app.classList.remove('is-admin');
  $('adminBar').hidden = true;
  if (adminMode.saved) { const s = adminMode.saved; Object.assign(controls, { minDistance: s.minDistance, maxDistance: s.maxDistance, minPolarAngle: s.minPolarAngle, maxPolarAngle: s.maxPolarAngle, enablePan: s.enablePan, screenSpacePanning: s.screenSpacePanning, enabled: s.enabled }); controls.touches = s.touches; adminMode.saved = null; }
  for (const th of placed.values()) if (th.ring) th.ring.visible = false; // claim rings shown for the admin: the menu looks as it did
  net.mode = 'watch';
  enterMenu();
  if (rejoin && net.sock && net.sock.readyState === 1) sendHello(); // the server stops treating this connection as the admin
}
$('adminExit').addEventListener('click', () => exitAdmin());
// name tags and notes keep clear of the admin's top bar (the player's HUD isn't there to measure)
function adminHud() {
  const ar = app.getBoundingClientRect(), bar = $('adminBar').getBoundingClientRect();
  hudZone.top = bar.bottom - ar.top;
  hudZone.bottom = hudZone.menuBottom = ar.height;
  document.documentElement.style.setProperty('--below-hud', `${Math.round(hudZone.top + 8)}px`);
}
addEventListener('resize', () => { if (adminMode.on) setTimeout(adminHud, 60); });
function drawAdminBar() {
  const r = REGIONS.find((x) => x.open);
  $('adminWorldName').textContent = r ? r.name : 'World';
  $('adminWorldTime').textContent = formatTime(worldNow());
  const all = [...others.values()], n = (st) => all.filter((o) => o.state === st).length;
  const parts = [`${n('online') + n('sleeping')} online`, `${n('away')} away`, `${n('asleep')} asleep`];
  $('adminCountsBar').replaceChildren(...parts.map((text) => { const s = document.createElement('span'); s.textContent = text; return s; }));
}

/* ---------- the camera: W A S D move, Q and E turn, R and F tilt (round where the camera looks, as there's no person) ---------- */
function adminCamera(dt) {
  const t = controls.target;
  camVel.turn += (keyAxis('KeyE', 'KeyQ') * 1.5 - camVel.turn) * Math.min(1, dt * 5);
  if (Math.abs(camVel.turn) < 0.002 && !keysDown.has('KeyE') && !keysDown.has('KeyQ')) camVel.turn = 0;
  camVel.tilt += (keyAxis('KeyF', 'KeyR') * 0.8 - camVel.tilt) * Math.min(1, dt * 5);
  if (Math.abs(camVel.tilt) < 0.002 && !keysDown.has('KeyF') && !keysDown.has('KeyR')) camVel.tilt = 0;
  if (camVel.turn || camVel.tilt) {
    const off = camera.position.clone().sub(t), sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= camVel.turn * dt;
    sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi + camVel.tilt * dt));
    camera.position.copy(t).add(off.setFromSpherical(sph));
  }
  const f = keyAxis('KeyW', 'KeyS'), r = keyAxis('KeyD', 'KeyA');
  if ((f || r) && adminMode.follow) adminFollow(null); // moving the view yourself stops following (turning and tilting don't)
  if (!f && !r && panVel.lengthSq() < 1e-4) panVel.set(0, 0, 0);
  else {
    const fwd = V(t.x - camera.position.x, 0, t.z - camera.position.z);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); // looking straight down: forward is up the screen
    fwd.normalize();
    const right = V(-fwd.z, 0, fwd.x), speed = camera.position.distanceTo(t) * 0.6;
    panVel.lerp(fwd.multiplyScalar(f * speed).add(right.multiplyScalar(r * speed)), Math.min(1, dt * 4));
    adminPanBy(panVel.x * dt, panVel.z * dt);
  }
  // the camera's focus sits on the ground it is over
  const dy = (groundY(t.x, t.z) + 1.0 - t.y) * Math.min(1, dt * 4);
  t.y += dy; camera.position.y += dy;
}
// Follow: the camera keeps someone in the middle of the view as they walk about, until you move the view yourself, tap
// the chip, or they leave the world. You can still turn, tilt and zoom round them.
const followAt = { x: 0, z: 0 }; // where following last put the view (if it's somewhere else, you moved it)
function adminFollow(id) {
  const o = id ? others.get(id) : null;
  adminMode.follow = o ? id : null;
  $('adminFollow').hidden = !o;
  if (!o) return;
  $('adminFollow').textContent = `Following ${o.title} · tap to stop`;
  if (adminNarrow()) closeAdminPanel();
  adminFlyTo(o.mesh.position.x, o.mesh.position.z);
  followAt.x = controls.target.x; followAt.z = controls.target.z;
}
$('adminFollow').addEventListener('click', () => adminFollow(null));
function adminFollowStep(dt) {
  if (!adminMode.follow) return;
  const o = others.get(adminMode.follow), t = controls.target;
  if (!o) { adminFollow(null); adminSay("They've left the world"); return; }
  if (Math.hypot(t.x - followAt.x, t.z - followAt.z) > 0.6) { adminFollow(null); return; } // the view was slid away by hand (a finger or the mouse)
  const k = Math.min(1, dt * 4);
  adminPanBy((o.mesh.position.x - t.x) * k, (o.mesh.position.z - t.z) * k);
  followAt.x = t.x; followAt.z = t.z;
}
// Fly to: the camera goes to look at a spot, from the same height and angle. On a phone the dashboard is put away first,
// as it covers the lower half of the screen, where the spot would be.
const adminNarrow = () => app.clientWidth <= 700;
function adminFlyTo(x, z) {
  if (!adminMode.on || !Number.isFinite(x) || !Number.isFinite(z)) return;
  if (adminNarrow()) closeAdminPanel();
  const t = controls.target;
  adminPanBy(x - t.x, z - t.z);
  const dy = groundY(t.x, t.z) + 1.0 - t.y;
  t.y += dy; camera.position.y += dy;
  panVel.set(0, 0, 0);
}
// slide the view over the ground, kept inside the world (and a little past its edge)
function adminPanBy(mx, mz) {
  const t = controls.target, lim = WORLD_HALF + 4;
  const dx = Math.max(-lim, Math.min(lim, t.x + mx)) - t.x, dz = Math.max(-lim, Math.min(lim, t.z + mz)) - t.z;
  t.x += dx; t.z += dz;
  camera.position.x += dx; camera.position.z += dz;
}
// Claims: every lit claim's ring shows, wherever the camera is (a player only sees the ones near them: updateClaims in
// placeables.js does nothing without a person). Checked every half second, so a fire that went out loses its ring.
let adminClaimsAt = 0;
function adminClaims(now) {
  if (now - adminClaimsAt < 500) return;
  adminClaimsAt = now;
  for (const th of placed.values()) { drawClaimRing(th); if (th.ring) th.ring.visible = true; }
}
// one frame of admin mode (loop.js): the live world, everyone in it, nothing of a player's
let adminBarTimer = 0;
function adminFrame(dt, raw, w, h) {
  adminCamera(dt);
  updateOthers(dt);
  adminClaims(Date.now());
  controls.update();
  adminPanBy(0, 0); // a finger can slide the view too: it stays inside the world as well
  adminFollowStep(dt); // (after the controls: what's left of a slide by hand shows up as the view having moved)
  renderWorld(w, h, raw);
  adminBarTimer += raw;
  if (adminBarTimer > 1) { adminBarTimer = 0; drawAdminBar(); applyDaylight(); for (const b of berryBushes) drawBerries(b); drawPlants(); }
}

/* ---------- tapping the world: what the admin can do with what's there ---------- */
// A tap on a person, a tree, a rock, a berry bush, a campfire, a loose item or the ground opens the same small menu the
// players get, holding the admin's options for it. While moving something, the tap says where it goes instead.
function adminTap(px, py) {
  if (!online()) { adminSay('Reconnecting…', 1.5); return; }
  if (adminMoving) { adminMoveTap(); return; }
  const t = pickTarget(px, py);
  if (!t) { closeMenu(); return; }
  const acts = adminActionsFor(t);
  if (!acts.length) { closeMenu(); return; }
  $('actTitle').textContent = t.name || (t.kind === 'ground' ? 'Ground' : '');
  showActs(acts);
  const menu = $('actMenu');
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.round(Math.min(Math.max(8, px + 8), app.clientWidth - w - 8))}px`;
  menu.style.top = `${Math.round(Math.max(hudZone.top + 6, Math.min(app.clientHeight - h - 8, py + 8)))}px`;
}
function adminActionsFor(t) {
  if (t.kind === 'person') return adminPersonActions(t.person);
  if (t.kind === 'placed') return adminPlacedActions(t.th);
  if (t.kind === 'item') return [{ label: `Remove ${ITEMS[t.item.kind].name.toLowerCase()}`, run: () => adminSend({ t: 'a.remove', id: t.item.id }) }, ...adminGroundActions({ x: t.item.x, z: t.item.z })];
  if (t.kind === 'tree') return adminThingActions('tree', t.idx, false);
  if (t.kind === 'stump') return adminThingActions('tree', t.idx, true);
  if (t.kind === 'rock') return adminThingActions('rock', t.idx, rocks[t.idx].state === 'mined');
  if (t.kind === 'use' && t.task.bush != null) { const b = berryBushes[t.task.bush], src = SOURCES[t.task.source]; return adminThingActions('bush', t.task.bush, !!b && berriesOn(b) < bushHolds(src)); }
  const p = t.point || (t.hit && t.hit.point) || (Number.isFinite(t.x) ? { x: t.x, z: t.z } : null);
  return p ? adminGroundActions(p) : []; // the ground, the shore, a grave, an old stump, tall grass: what can be done at that spot
}
