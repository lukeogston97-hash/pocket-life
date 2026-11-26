/* ---------- loop ---------- */
import * as THREE from 'three';
import { game } from './links.js';
import { app, camera, reduceMotion, renderer, scene, sun, SUN_OFFSET } from './core.js';
import { animateWater } from './land.js';
import { berryBushes } from './nature.js';
import { drawPlants } from './plants.js';
import { drawBerries, updateDetails } from './world-build.js';
import { renderCreator } from './people.js';
import { drawHud, player, ui, updateLabels, you } from './you.js';
import { applyDaylight, sky, tickStats } from './needs.js';
import { tickTips } from './tips.js';
import { controls, followPlayer, speed, speedSettled, watchSpeed } from './camera.js';
import { animatePlaced, updateClaims } from './placeables.js';
import { edgePan, fadeTapRing, keyCamera, updateGlow, updatePlayer } from './input.js';
import { drawMenu, menuCamera } from './screens.js';

const clock = new THREE.Clock();
let hudTimer = 0;
let menuWait = 0; // seconds since the main menu's world was last drawn
// One frame. If anything in it goes wrong the game doesn't freeze: the problem is noted for the admin (reportError in
// online.js, each problem once) and the next frame still runs.
export function frame() {
  try { frameStep(); } catch (err) { game.reportError(err, 'frame'); }
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}
function frameStep() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  if (!game.maint.on) game.elapsed += Math.min(raw, 0.25); // (only maintenance stops the clock: the world is closed)
  const w = app.clientWidth, h = app.clientHeight;
  speed.rest = false;
  if (ui.mode === 'creator') {
    if (!game.previewDrag && !reduceMotion) game.previewSpin += dt * 0.35;
    if (game.previewPerson) game.previewPerson.rotation.y = game.previewSpin;
    renderCreator(w, h);
  } else if (ui.mode === 'menu') {
    // Behind the main menu the world is only a backdrop. Once the sharpness has settled (speedSettled in camera.js) it's
    // drawn about 30 times a second, not 60 or 120: half the work for the phone, and the slow camera looks the same.
    // (The speed check is rested meanwhile, or it would take the slower drawing for a slow phone. Never in the first few
    // seconds: the loading screen waits for the world's first frames.)
    menuWait += raw;
    speed.rest = game.elapsed > 5 && speedSettled();
    if (speed.rest && menuWait < 1 / 32) return;
    const step = menuWait;
    menuWait = 0;
    menuCamera(step);
    game.updateOthers(Math.min(step, 0.05));
    renderWorld(w, h, step);
    hudTimer += step;
    if (hudTimer > 1) { hudTimer = 0; drawMenu(); applyDaylight(); for (const b of berryBushes) drawBerries(b); drawPlants(); }
  } else if (ui.mode === 'admin') {
    game.adminFrame(dt, raw, w, h);
  } else if (player) {
    // the Menu, the Camp panel and What's new don't stop your person: the world keeps going, and so does what they're
    // doing (0.1.7). Only taps and keys wait until it's closed (paused). Maintenance stops everything.
    if (!you.dead && !game.maint.on && !you.sleeping) updatePlayer(dt);
    if (!game.paused) { keyCamera(dt); edgePan(dt); }
    game.updateOthers(dt);
    fadeTapRing(dt);
    updateGlow(raw);
    updateClaims(Date.now());
    game.sendMove();
    followPlayer(dt);
    controls.update();
    renderWorld(w, h, raw);
    hudTimer += raw;
    if (hudTimer > 1) { hudTimer = 0; drawHud(); tickStats(); tickTips(); applyDaylight(); for (const b of berryBushes) drawBerries(b); drawPlants(); }
  }
}

// the world as the camera sees it (playing, and behind the main menu)
export function renderWorld(w, h, raw) {
  updateDetails(controls.target.x, controls.target.z);
  animatePlaced(raw); // campfires flicker and burn down
  sun.position.copy(controls.target).add(SUN_OFFSET);
  sun.target.position.copy(controls.target);
  sun.target.updateMatrixWorld();
  if (!reduceMotion) animateWater(game.elapsed);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.setClearColor(sky, 1);
  renderer.render(scene, camera);
  watchSpeed(raw);
  updateLabels();
}
