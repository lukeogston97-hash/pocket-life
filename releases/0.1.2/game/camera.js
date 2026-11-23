/* ---------- camera: follows you, drag to turn, pinch to zoom ---------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 9;
controls.maxDistance = 40;
controls.minPolarAngle = deg(28);
controls.maxPolarAngle = deg(64);
controls.rotateSpeed = 0.6;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.enabled = false;
// the camera looks at a point 1 m above the ground where you stand, so it rises and falls with the land
function placeCamera() {
  camFree = false;
  controls.target.set(player.position.x, playerGround + 1.0, player.position.z);
  camera.position.copy(controls.target).add(V().setFromSpherical(new THREE.Spherical(24, deg(55), deg(26))));
  controls.update();
}
function followPlayer(dt) {
  if (walk.target && !wasWalking && !dragPoint) camFree = false; // your person set off: glide back to them (not mid-drag)
  wasWalking = !!walk.target;
  const k = Math.min(1, dt * 4);
  const fx = camFree ? controls.target.x : player.position.x, fz = camFree ? controls.target.z : player.position.z;
  const gy = camFree ? groundY(fx, fz) : playerGround;
  const dx = (fx - controls.target.x) * k, dz = (fz - controls.target.z) * k;
  const dy = (gy + 1.0 - controls.target.y) * k;
  controls.target.x += dx;
  controls.target.y += dy;
  controls.target.z += dz;
  camera.position.x += dx;
  camera.position.y += dy;
  camera.position.z += dz;
}
/* ---------- graphics: High, Medium or Low, chosen in the Menu and kept on this device ---------- */
const GRAPHICS = {
  high: { label: 'High', pixels: 2, shadows: 2048, detail: 1, people: 30 },
  medium: { label: 'Medium', pixels: 1.5, shadows: 1024, detail: 0.8, people: 20 },
  low: { label: 'Low', pixels: 1, shadows: 0, detail: 0.6, people: 12 }, // people: how many others are drawn at once (the nearest; each costs about 38 draws with shadows)
};
const GFX_KEY = 'pocket-life:graphics';
let gfx = (() => { try { return localStorage.getItem(GFX_KEY); } catch (err) { return null; } })();
if (!GRAPHICS[gfx]) gfx = matchMedia('(pointer: coarse)').matches ? 'medium' : 'high'; // phones start on Medium
let detailScale = 1;
function applyGraphics(level) {
  gfx = level;
  try { localStorage.setItem(GFX_KEY, level); } catch (err) { /* not kept */ }
  const g = GRAPHICS[level];
  PIXEL_STEPS = [Math.min(window.devicePixelRatio || 1, g.pixels), 1.5, 1.25, 1].filter((v, i, a) => i === 0 || v < a[0]);
  speed.step = 0;
  renderer.setPixelRatio(PIXEL_STEPS[0]);
  sun.castShadow = g.shadows > 0;
  if (g.shadows && sun.shadow.mapSize.x !== g.shadows) {
    sun.shadow.mapSize.set(g.shadows, g.shadows);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  detailScale = g.detail;
  detailAt = null; // redraw the grass at the new amount
  resize();
  for (const b of document.querySelectorAll('[data-gfx]')) b.setAttribute('aria-pressed', String(b.dataset.gfx === level));
}
// If the phone is still struggling, draw a little less sharp (a step at a time, never back up in one visit)
let PIXEL_STEPS = [Math.min(window.devicePixelRatio || 1, 2), 1.5, 1.25, 1].filter((v, i, a) => i === 0 || v < a[0]);
const speed = { step: 0, time: 0, frames: 0, warm: 0 };
function watchSpeed(raw) {
  if (document.hidden || raw > 0.5) return;
  if (speed.warm < 3) { speed.warm += raw; return; } // let it settle after starting
  speed.time += raw;
  speed.frames++;
  if (speed.time < 2) return;
  const fps = speed.frames / speed.time;
  speed.time = speed.frames = 0;
  if (fps < 45 && speed.step < PIXEL_STEPS.length - 1) {
    speed.step++;
    renderer.setPixelRatio(PIXEL_STEPS[speed.step]);
    resize();
  }
}
function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(app);
resize();
