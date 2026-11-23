/* ---------- loop ---------- */
const clock = new THREE.Clock();
let hudTimer = 0;
// One frame. If anything in it goes wrong the game doesn't freeze: the problem is noted for the admin (reportError in
// online.js, each problem once) and the next frame still runs.
function frame() {
  try { frameStep(); } catch (err) { reportError(err, 'frame'); }
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}
function frameStep() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  if (!paused) elapsed += Math.min(raw, 0.25);
  const w = app.clientWidth, h = app.clientHeight;
  if (ui.mode === 'creator') {
    if (!previewDrag && !reduceMotion) previewSpin += dt * 0.35;
    if (previewPerson) previewPerson.rotation.y = previewSpin;
    renderCreator(w, h);
  } else if (ui.mode === 'menu') {
    menuCamera(raw);
    updateOthers(dt);
    renderWorld(w, h, raw);
    hudTimer += raw;
    if (hudTimer > 1) { hudTimer = 0; drawMenu(); applyDaylight(); for (const b of berryBushes) drawBerries(b); drawPlants(); }
  } else if (player) {
    if (!you.dead && !paused && !you.sleeping) updatePlayer(dt);
    if (!paused) { keyCamera(dt); edgePan(dt); }
    updateOthers(dt);
    fadeTapRing(dt);
    updateGlow(raw);
    updateClaims(Date.now());
    sendMove();
    followPlayer(dt);
    controls.update();
    renderWorld(w, h, raw);
    hudTimer += raw;
    if (hudTimer > 1) { hudTimer = 0; drawHud(); tickStats(); applyDaylight(); for (const b of berryBushes) drawBerries(b); drawPlants(); }
  }
}

// the world as the camera sees it (playing, and behind the main menu)
function renderWorld(w, h, raw) {
  updateDetails(controls.target.x, controls.target.z);
  animatePlaced(raw); // campfires flicker and burn down
  sun.position.copy(controls.target).add(SUN_OFFSET);
  sun.target.position.copy(controls.target);
  sun.target.updateMatrixWorld();
  if (!reduceMotion) animateWater(elapsed);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.setClearColor(sky, 1);
  renderer.render(scene, camera);
  watchSpeed(raw);
  updateLabels();
}
