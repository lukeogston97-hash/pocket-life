/* ---------- making your person ---------- */
function buildChoice(boxId, list, key, kind) {
  const box = $(boxId);
  for (const o of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = o.id;
    if (kind === 'swatch') {
      b.className = 'swatch';
      b.setAttribute('aria-label', o.label);
      const dot = document.createElement('span');
      dot.style.background = o.hex;
      b.appendChild(dot);
    } else {
      b.className = kind === 'seg' ? 'seg-btn' : 'chip-btn';
      b.textContent = o.label;
    }
    b.addEventListener('click', () => { draft[key] = o.id; syncForm(); refreshPreview(); });
    box.appendChild(b);
  }
}
const CHOICES = [
  ['sexOpts', 'sex', 'seg'], ['buildOpts', 'build', 'chip'], ['skinOpts', 'skin', 'swatch'],
  ['hairOpts', 'hair', 'chip'], ['hairColourOpts', 'hairColour', 'swatch'], ['tunicOpts', 'tunic', 'swatch'],
];
for (const [boxId, key, kind] of CHOICES) buildChoice(boxId, LOOKS[key], key, kind);
function syncForm() {
  for (const [boxId, key] of CHOICES) for (const b of $(boxId).children) b.setAttribute('aria-pressed', String(b.dataset.id === draft[key]));
  $('ageInput').value = String(draft.age);
  $('ageOut').textContent = String(draft.age);
  if ($('nameInput').value !== draft.name) $('nameInput').value = draft.name;
}
$('ageInput').min = String(LOOKS.age.min);
$('ageInput').max = String(LOOKS.age.max);
$('ageInput').addEventListener('input', (e) => { draft.age = Number(e.target.value); $('ageOut').textContent = String(draft.age); refreshPreview(); });
$('nameInput').addEventListener('input', (e) => { draft.name = e.target.value; $('nameErr').hidden = true; });
const pv = $('previewSpace');
pv.addEventListener('pointerdown', (e) => { previewDrag = { x: e.clientX, spin: previewSpin }; pv.setPointerCapture(e.pointerId); });
pv.addEventListener('pointermove', (e) => { if (previewDrag) previewSpin = previewDrag.spin + (e.clientX - previewDrag.x) * 0.012; });
pv.addEventListener('pointerup', () => { previewDrag = null; });
pv.addEventListener('pointercancel', () => { previewDrag = null; });

function enterCreator() {
  ui.mode = 'creator';
  closeMenu();
  closePause();
  keysDown.clear();
  app.classList.remove('is-menu');
  app.classList.add('is-creating');
  $('mainMenu').hidden = true;
  $('creator').hidden = false;
  controls.enabled = false;
  closeBag();
  closeCraft();
  hideHint();
  removeLabel(tagLabel);
  tagLabel = null;
  draft = { ...DEFAULT_LOOK };
  // while testing, a ready-made name so starting is one tap (settings.autoName; you can still change it)
  if (SETTINGS.autoName) {
    const names = DATA.testNames && DATA.testNames.length ? DATA.testNames : ['Alex', 'Sam', 'Jo'];
    draft.name = names[Math.floor(Math.random() * names.length)];
  }
  syncForm();
  refreshPreview();
}
function enterWorld() {
  ui.mode = 'world';
  app.classList.remove('is-creating', 'is-menu');
  $('creator').hidden = true;
  $('mainMenu').hidden = true;
  controls.enabled = true;
  ring.visible = true;
  if (previewPerson) { pscene.remove(previewPerson); disposeMaterials(previewPerson); previewPerson = null; }
  drawHud();
  drawCarry();
  drawNeeds();
  applyDaylight();
  drawQueue();
  placeCamera();
  showHint();
}
$('sheet').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = (draft.name || '').trim().slice(0, 20);
  if (!name || badName(name, FILTER)) {
    $('nameErr').textContent = name ? 'Pick a different name.' : 'Give your person a name to start.';
    $('nameErr').hidden = false; $('nameInput').focus(); return;
  }
  $('nameInput').blur();
  if (!online()) { showJoining(true); return; }
  if (creating) return;
  creating = true;
  you.carry = {};
  you.lastKind = null;
  net.sock.send(JSON.stringify({ t: 'create', name, age: draft.age, look: { ...draft, name } }));
});

/* ---------- the end of a life ----------
   The server decides when someone dies (needs run on the server, even while you're away).
   Everything they carried is left on the ground where they fell, with a small grave for a day. */
function die(m) {
  if (you.dead || !player) return;
  you.dead = true;
  closeMenu();
  closePause();
  forgetSit();
  stopPlacing();
  stopQueue();
  closeBag();
  closeCraft();
  hideHint();
  you.carry = {};
  you.lastKind = null;
  drawHeld();
  drawCarry();
  drawNeeds();
  resetPose();
  player.rotation.x = -Math.PI / 2; // lying where they fell
  player.position.y = playerGround + 0.2;
  $('deathTitle').textContent = `${m.name || you.look.name} has died`;
  $('deathText').textContent = `${m.cause ? `They died of ${m.cause}` : 'They died'} at ${m.age || you.look.age}. What they were carrying is on the ground where they fell.`;
  $('death').hidden = false;
  $('deathBtn').focus();
}
function endLife() {
  stopQueue();
  walk.target = null;
  action = null;
  removePlayer();
  you.look = null;
  you.stats = null;
  you.dead = false;
  enterCreator();
}
/* ---------- the main menu ----------
   The first screen: Play, What's new, Settings and Feedback over a live view of the world, the camera slowly
   circling the main pond. The game joins the world just to watch (no person, not counted as playing);
   Play asks the server for your person on the same connection, and Exit in the pause menu comes back here. */
const menuCam = { angle: deg(26) };
function enterMenu() {
  ui.mode = 'menu';
  closeMenu(); closePause(); closeBag(); closeCraft(); closeSay(); hideHint();
  keysDown.clear();
  app.classList.remove('is-creating');
  app.classList.add('is-menu');
  $('creator').hidden = true;
  $('mainMenu').hidden = false;
  menuJoining = false;
  controls.enabled = false;
  ring.visible = false; // the ring under your person
  if (previewPerson) { pscene.remove(previewPerson); disposeMaterials(previewPerson); previewPerson = null; }
  removeLabel(tagLabel);
  tagLabel = null;
  drawMenu();
}
// what's under Play: who you'll carry on as, or that you'll make a new person
// The worlds (regions in game-data.json): each has its own clock. Only open ones can be played; tapping another shows
// this world's view at that region's time of day, with Play saying it's coming soon.
function drawRegions() {
  const row = $('regions');
  row.hidden = REGIONS.length < 2;
  row.replaceChildren(...REGIONS.map((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'region';
    b.classList.toggle('on', r === menuRegion);
    b.classList.toggle('soon', !r.open);
    b.setAttribute('aria-pressed', r === menuRegion ? 'true' : 'false');
    const name = document.createElement('span'); name.textContent = r.name;
    const n = others.size; // (one world for now, so the open one has everyone)
    const sub = document.createElement('small'); sub.textContent = !r.open ? 'Coming soon' : n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Nobody yet';
    b.append(name, sub);
    b.addEventListener('click', () => { menuRegion = r; shownAt = -1; applyDaylight(); drawMenu(); });
    return b;
  }));
}
// A world nobody has played yet looks untouched: every tree standing, bushes full, grass grown, nothing on the ground,
// no campfires and nobody there. Only how it's drawn changes; going back to the open world shows it as it really is.
function setFresh(on) {
  if (freshLook === on) return;
  freshLook = on;
  trees.forEach((t) => { showParts(t, on || t.state === 'tree'); if (t.stump) t.stump.visible = !on; });
  oldStumps.forEach((t) => showParts(t, on || !t.gone));
  rocks.forEach(drawRock);
  for (const v of itemViews.values()) v.visible = !on;
  showItemBatches(!on);
  for (const th of placed.values()) if (th.view) th.view.visible = !on;
  fireLight.visible = !on;
  for (const b of berryBushes) drawBerries(b);
  drawPlants();
}
function drawMenu() {
  setFresh(ui.mode === 'menu' && !!menuRegion && !menuRegion.open);
  drawRegions();
  if (menuRegion && !menuRegion.open) { // looking at a world that isn't open yet
    $('playText').textContent = `${menuRegion.name} is coming soon`;
    $('playSub').textContent = `${formatTime(worldNow(menuRegion.timeZone))} there now`;
    $('playBtn').disabled = true;
    return drawMenuNet();
  }
  $('playText').textContent = menuLine ? 'World is full' : 'Play';
  $('playSub').textContent = menuLine ? `You're ${ordinal(menuLine)} in line. You'll join by yourself.` : menuYours ? `as ${menuYours.name} · ${menuYours.age}` : menuYours === null ? 'Make your person' : '';
  $('playBtn').disabled = menuJoining || menuLine > 0;
  drawMenuNet();
}
function drawMenuNet() {
  $('menuNet').dataset.state = $('netLine').dataset.state;
  $('menuNetText').textContent = $('netLine').dataset.state !== 'online' ? $('netText').textContent : 'Online'; // how many are in each world shows under its name
}
let menuYours; // undefined until the server says; null when you have no person
let menuLine = 0, menuJoining = false; // your place in line when the world is full; Play was tapped and the server hasn't answered
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
// the camera slowly circles the main pond (it holds still if the phone asks for less motion)
function menuCamera(dt) {
  if (!reduceMotion) menuCam.angle += dt * 0.035; // about three minutes a lap
  const t = V(POND.x, groundY(POND.x, POND.z) + 1.0, POND.z);
  controls.target.copy(t);
  camera.position.copy(t).add(V().setFromSpherical(new THREE.Spherical(30, deg(57), menuCam.angle)));
  camera.lookAt(t);
}
function sendHello() {
  net.sock.send(JSON.stringify({ t: 'hello', proto: 2, watch: net.mode === 'watch', v: VERSION, b: DATA.build || 0, e: DATA.era || 0, link: TEST_BUILD ? 'test' : 'release', pid, adminCode: admin.code || undefined, adminTag: admin.tag }));
}
// Play: the same connection now plays your person (or makes a new one)
function play() {
  if (ui.mode !== 'menu' || (menuRegion && !menuRegion.open)) return;
  setFresh(false);
  net.mode = 'play';
  menuJoining = true; // until the server answers
  drawMenu();
  if (net.sock && net.sock.readyState === 1) sendHello();
  else { showJoining(true); goOnline(); }
}
// back to the main menu: from making a person, or Exit in the pause menu (your person goes away and looks after themselves)
function toMenu() {
  net.mode = 'watch';
  menuLine = 0;
  dropPlayer();
  enterMenu();
  if (net.sock && net.sock.readyState === 1) sendHello();
}
// your person is no longer shown here (the server looks after them now)
function dropPlayer() {
  if (!player) return;
  forgetSit(); // a sit carries on while you're away (the server keeps it)
  stopPlacing();
  stopQueue();
  action = null;
  auto.on = false; $('autoChip').hidden = true;
  removePlayer();
  you.look = null; you.stats = null; you.dead = false; you.sleeping = false;
}
$('playBtn').addEventListener('click', play);
$('creatorBack').addEventListener('click', toMenu);
$('exitBtn').addEventListener('click', () => { closePause(); toMenu(); });
$('menuNewsBtn').addEventListener('click', () => openNews());
$('menuFeedbackBtn').addEventListener('click', () => openFeedback());
$('menuSettingsBtn').addEventListener('click', () => { $('settings').hidden = false; $('settingsClose').focus(); });
// the same three in the pause menu, so you don't have to leave the world for them
$('pauseNewsBtn').addEventListener('click', () => { closePause(); openNews(); });
$('pauseFeedbackBtn').addEventListener('click', () => { closePause(); openFeedback(); });
$('pauseSettingsBtn').addEventListener('click', () => { closePause(); $('settings').hidden = false; $('settingsClose').focus(); });
function closeSettings() { $('settings').hidden = true; }
$('settingsClose').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });
// coming back to a person who died or left while you were away
function showGoneCard(d) {
  const away = d.away ? ' while you were away' : '';
  $('deathTitle').textContent = d.gone ? `${d.name} has left the world` : `${d.name} has died`;
  $('deathText').textContent = d.gone
    ? `They slept for a long time and left the world.${d.had ? ' Their things were left where they slept.' : ''}`
    : `They died of ${d.cause || 'weakness'}${away}, at ${d.age}.${d.had ? ' Their things were left where they fell.' : ''}`;
  $('death').hidden = false;
}
// what your person did while you were away
function showWelcomeBack(a) {
  const hrs = a.ms / 3600000;
  const long = hrs >= 1 ? `${Math.round(hrs)} hour${Math.round(hrs) === 1 ? '' : 's'}` : `${Math.max(1, Math.round(a.ms / 60000))} minutes`;
  const bits = [];
  const fruit = ITEMS[Object.keys((BERRY_SOURCE() || {}).harvest || {})[0]] || { name: 'berry', plural: 'berries' }; // what people away pick and eat
  if (a.ate) bits.push(`ate ${a.ate} ${(a.ate === 1 ? fruit.name : fruit.plural).toLowerCase()}`);
  if (a.picked) bits.push(`picked ${a.picked}`);
  if (a.drank) bits.push(`drank ${a.drank} time${a.drank === 1 ? '' : 's'}`);
  if (a.fed) bits.push('kept the fire going');
  if (a.slept) bits.push('slept');
  if (a.ms < 5 * 60000 && !bits.length) return; // only gone a moment
  const days = Math.round(((AWAY.sleepAfterHours || 24) + (AWAY.goneAfterDays || 1) * 24) / 24); // away this long and they leave the world
  $('backText').textContent = `You were away ${long}.${bits.length ? ` ${you.look.name} ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ` ${you.look.name} rested.`} Come back within ${days} days or they'll leave the world.`;
  $('back').hidden = false;
}
$('backBtn').addEventListener('click', () => { $('back').hidden = true; });
// joining the world, or getting back after the internet dropped
function showJoining(on, inWorld = false) {
  $('joining').hidden = !on;
  $('joiningText').textContent = inWorld ? 'Reconnecting… Your person carries on while you\'re gone.' : 'Joining the world…';
}
$('menuBtn').addEventListener('click', () => openPause());
$('deathBtn').addEventListener('click', () => { $('death').hidden = true; if (player) endLife(); });
