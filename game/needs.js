/* ---------- needs: they change with real time, even while you're away ---------- */
const clampStat = (v) => Math.max(0, Math.min(100, v));
const freshStats = () => Object.fromEntries(STATS.map((s) => [s.id, clampStat(s.start)]));
// Needs are small rings (how full) with an icon; tap them to see the names and numbers.
const NEED_ICONS = {
  heart: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6z"/>',
  food: '<path d="M12 7c1-2 3-3 5-3"/><path d="M12 8c-2.5-1.5-7-1-7 4.5C5 17 8 21 10 21c1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-4 5-8.5C19 7 14.5 6.5 12 8z"/>',
  drop: '<path d="M12 3.5 6.5 11a6.5 6.5 0 1 0 11 0z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
};
const iconFor = (s) => NEED_ICONS[s.icon] || NEED_ICONS[{ health: 'heart', hunger: 'food', thirst: 'drop', rest: 'moon', energy: 'bolt' }[s.id]] || NEED_ICONS.heart;
// Energy is short-term stamina: every task and every metre walked takes a little (energyCosts in game-data.json),
// and it comes back quickly by itself. Below slowBelow your person slows down (slowBy) instead of stopping.
const COSTS = DATA.energyCosts || {};
const ENERGY = STATS.find((s) => s.id === 'energy');
const slowness = () => (ENERGY && you.stats && you.stats.energy != null && you.stats.energy < (ENERGY.slowBelow || 0) ? ENERGY.slowBy || 1 : 1);
function spendEnergy(what, amount = 1) {
  const c = (COSTS[what] || 0) * amount;
  if (c && you.stats && you.stats.energy != null) { you.stats.energy = Math.max(0, you.stats.energy - c); }
}
function buildNeeds() {
  $('needs').replaceChildren(...STATS.map((s) => {
    const row = document.createElement('div');
    row.className = 'need';
    row.style.setProperty('--c', s.colour);
    const ring = document.createElement('span');
    ring.className = 'ring';
    ring.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconFor(s)}</svg>`;
    const label = document.createElement('span');
    label.className = 'need-label';
    const warn = document.createElement('span');
    warn.className = 'warn';
    warn.hidden = true;
    row.append(ring, label, warn);
    s.view = { row, fill: row, warn, label };
    return row;
  }));
}
$('needs').addEventListener('click', () => { $('needs').classList.toggle('open'); tipDid('rings'); hideHint(); drawNeeds(); setTimeout(measureHud, 50); });
buildNeeds();
function drawNeeds() {
  if (!you.stats) return;
  for (const s of STATS) {
    const v = you.stats[s.id];
    s.view.fill.style.setProperty('--v', (v / 100).toFixed(3));
    s.view.label.textContent = `${s.name} ${Math.round(v)}`;
    s.view.warn.hidden = !(s.lowAt != null && v <= s.lowAt);
    s.view.row.classList.toggle('low', !s.view.warn.hidden); // a low need pulses red
    s.view.row.classList.toggle('critical', v <= 10); // under 10%: it flashes
    s.view.row.setAttribute('aria-label', `${s.name} ${Math.round(v)} out of 100`);
  }
}
// one slice of time: every need moves by perHour, an empty need (atZero) drags others down,
// and needs marked onlyWhenFine (health) only recover while nothing is empty
// (asleep: whileAsleep instead, and whileAsleepAtNight at night, so Rest fills faster at night; sitting by a fire: whileSitting)
// (the maths is needsStep in rules.js, the same on the server)
function stepStats(hours) {
  needsStep(you.stats, hours, STATS, { asleep: !!you.sleeping, night: !!you.sleeping && nightNow(), sitting: !!you.sit });
}
// the admin's "speed up time" for testing ({ x, until }), told by the server
let timeSpeed = null;
function setSpeed(sp) { timeSpeed = sp && sp.until > Date.now() ? sp : null; tickStats(); if (admin.on) drawAdmin(); }
function tickStats() {
  if (!you.stats || you.dead) return;
  const now = Date.now();
  const fast = timeSpeed && now < timeSpeed.until ? timeSpeed.x : 1;
  let hours = ((now - you.statsAt) / 3600000) * SETTINGS.needsSpeed * fast;
  you.statsAt = now;
  const before = { ...you.stats };
  // a game minute at a time (the server does the same, and has the final say on dying)
  while (hours > 0) {
    const h = Math.min(hours, 1 / 60);
    stepStats(h);
    hours -= h;
  }
  const low = STATS.find((s) => s.lowAt != null && s.lowLabel && before[s.id] > s.lowAt && you.stats[s.id] <= s.lowAt);
  if (low && !action) showTag(low.lowLabel, headTop(), 2);
  // Rest ran out: collapse asleep where you stand (the server does the same and tells everyone)
  if (REST && REST.collapseAtZero && you.stats.rest <= 0 && !you.sleeping && player) {
    stopQueue();
    you.collapsed = true;
    setSleeping(true, true);
    showTag('Collapsed from tiredness', headTop(), 3);
  }
  drawNeeds();
}

/* ---------- day and night follow your real local time ---------- */
const DAYLIGHT = (DATA.daylight || []).filter((k) => k && Number.isFinite(k.hour)).sort((a, b) => a.hour - b.hour);
const SUN_DIR = V(SUN_OFFSET.x, 0, SUN_OFFSET.z).normalize();
const SUN_DIST = SUN_OFFSET.length();
const sky = new THREE.Color(HAZE);
const colA = new THREE.Color(), colB = new THREE.Color(), srgb = {};
const lerpNum = (a, b, t) => (Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : null);
let hourOverride = null; // lets a test pick the time of day
// the colour the phone's browser draws its own bars in (theme-color in index.html) follows the sky, so the game runs
// right up into them: the pale haze by day, deep blue at night, and the plain haze while making your person
const themeMeta = document.querySelector('meta[name="theme-color"]');
function setTheme(hex) { if (themeMeta && themeMeta.getAttribute('content') !== hex) themeMeta.setAttribute('content', hex); }
// night in the world's clock (night in game-data.json: from and to, in hours): Rest fills faster asleep, and autopilot goes to bed
const NIGHT = DATA.night || null;
function nightNow() {
  if (!NIGHT) return false;
  let h = hourOverride;
  if (h == null) { const d = worldNow(); h = d.getUTCHours() + d.getUTCMinutes() / 60; }
  return NIGHT.from > NIGHT.to ? h >= NIGHT.from || h < NIGHT.to : h >= NIGHT.from && h < NIGHT.to;
}
function localHour() {
  if (hourOverride != null) return hourOverride;
  const d = worldNow(ui.mode === 'menu' && menuRegion ? menuRegion.timeZone : WORLD_TZ); // on the main menu, the region being looked at
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}
function applyDaylight() {
  const n = DAYLIGHT.length;
  if (n < 2) return;
  const hour = localHour();
  let j = DAYLIGHT.findIndex((k) => k.hour > hour);
  if (j < 0) j = 0;
  const a = DAYLIGHT[(j - 1 + n) % n], b = DAYLIGHT[j];
  let span = b.hour - a.hour;
  if (span <= 0) span += 24;
  let into = hour - a.hour;
  if (into < 0) into += 24;
  const t = smoothstep(0, 1, into / span);
  const mix = (key, out) => { if (a[key] && b[key]) out.copy(colA.set(a[key])).lerp(colB.set(b[key]), t); };
  mix('sky', sky);
  scene.fog.color.copy(sky);
  mix('skyLight', hemi.color);
  mix('groundLight', hemi.groundColor);
  hemi.intensity = lerpNum(a.brightness, b.brightness, t) ?? hemi.intensity;
  mix('sun', sun.color);
  sun.intensity = lerpNum(a.sunStrength, b.sunStrength, t) ?? sun.intensity;
  const el = deg(lerpNum(a.sunHeight, b.sunHeight, t) ?? 52);
  SUN_OFFSET.set(SUN_DIR.x * Math.cos(el), Math.sin(el), SUN_DIR.z * Math.cos(el)).multiplyScalar(SUN_DIST);
  // the mist at the top of the screen and the text colour follow the sky
  sky.getRGB(srgb, THREE.SRGBColorSpace);
  const lum = 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b;
  app.style.setProperty('--mist', [srgb.r, srgb.g, srgb.b].map((c) => Math.round((c + (1 - c) * 0.25 * lum) * 255)).join(', '));
  app.classList.toggle('night', lum < 0.5);
  if (ui.mode !== 'creator') setTheme(`#${sky.getHexString()}`);
}
