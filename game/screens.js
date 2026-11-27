/* ---------- making your person ---------- */
import * as THREE from 'three';
import { game, share } from './links.js';
import { badName } from './rules.js';
import { app, camera, DATA, HAZE, reduceMotion, SETTINGS, TEST_BUILD, V, VERSION } from './core.js';
import { groundY, POND } from './land.js';
import { berryBushes, oldStumps, rocks, trees } from './nature.js';
import { drawPlants } from './plants.js';
import { drawBerries, drawRock, showParts } from './world-build.js';
import { $, DEFAULT_LOOK, deg, ITEMS, LOOKS } from './items.js';
import { disposeMaterials, pscene, refreshPreview } from './people.js';
import { itemViews, showItemBatches } from './world-items.js';
import {
  drawCarry, drawHeld, drawHud, formatTime, headTop, player, REGIONS, removeLabel, removePlayer, ring, showTag, ui,
  worldNow, you,
} from './you.js';
import { applyDaylight, drawNeeds, setTheme } from './needs.js';
import { hideHint, startTips } from './tips.js';
import { closeBag, closeCraft } from './inventory.js';
import { controls, placeCamera } from './camera.js';
import { auto, AWAY, drawQueue, resetPose, sendTasks, stopQueue, walk } from './moving.js';
import { fireLight, forgetSit, placed, stopPlacing } from './placeables.js';
import { closeMenu, closePause, keysDown, openPause } from './input.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  closeLeave, closeLink, closeRules, closeSettings,
  get menuJoining() { return menuJoining; }, set menuJoining(v) { menuJoining = v; },
  get menuLine() { return menuLine; }, set menuLine(v) { menuLine = v; },
  get menuYours() { return menuYours; }, set menuYours(v) { menuYours = v; },
});

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
    b.addEventListener('click', () => { game.draft[key] = o.id; syncForm(); refreshPreview(); });
    box.appendChild(b);
  }
}
const CHOICES = [
  ['sexOpts', 'sex', 'seg'], ['buildOpts', 'build', 'chip'], ['skinOpts', 'skin', 'swatch'],
  ['hairOpts', 'hair', 'chip'], ['hairColourOpts', 'hairColour', 'swatch'], ['tunicOpts', 'tunic', 'swatch'],
];
for (const [boxId, key, kind] of CHOICES) buildChoice(boxId, LOOKS[key], key, kind);
function syncForm() {
  for (const [boxId, key] of CHOICES) for (const b of $(boxId).children) b.setAttribute('aria-pressed', String(b.dataset.id === game.draft[key]));
  $('ageInput').value = String(game.draft.age);
  $('ageOut').textContent = String(game.draft.age);
  if ($('nameInput').value !== game.draft.name) $('nameInput').value = game.draft.name;
}
$('ageInput').min = String(LOOKS.age.min);
$('ageInput').max = String(LOOKS.age.max);
$('ageInput').addEventListener('input', (e) => { game.draft.age = Number(e.target.value); $('ageOut').textContent = String(game.draft.age); refreshPreview(); });
$('nameInput').addEventListener('input', (e) => { game.draft.name = e.target.value; $('nameErr').hidden = true; });
const pv = $('previewSpace');
pv.addEventListener('pointerdown', (e) => { game.previewDrag = { x: e.clientX, spin: game.previewSpin }; pv.setPointerCapture(e.pointerId); });
pv.addEventListener('pointermove', (e) => { if (game.previewDrag) game.previewSpin = game.previewDrag.spin + (e.clientX - game.previewDrag.x) * 0.012; });
pv.addEventListener('pointerup', () => { game.previewDrag = null; });
pv.addEventListener('pointercancel', () => { game.previewDrag = null; });

export function enterCreator() {
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
  removeLabel(game.tagLabel);
  game.tagLabel = null;
  game.draft = { ...DEFAULT_LOOK };
  setTheme(HAZE); // (the stage's own pale background, whatever the time of day)
  // while testing, a ready-made name so starting is one tap (settings.autoName; you can still change it)
  if (SETTINGS.autoName) {
    const names = DATA.testNames && DATA.testNames.length ? DATA.testNames : ['Alex', 'Sam', 'Jo'];
    game.draft.name = names[Math.floor(Math.random() * names.length)];
  }
  syncForm();
  refreshPreview();
}
export function enterWorld() {
  ui.mode = 'world';
  app.classList.remove('is-creating', 'is-menu');
  $('creator').hidden = true;
  $('mainMenu').hidden = true;
  controls.enabled = true;
  ring.visible = true;
  if (game.previewPerson) { pscene.remove(game.previewPerson); disposeMaterials(game.previewPerson); game.previewPerson = null; }
  drawHud();
  drawCarry();
  drawNeeds();
  applyDaylight();
  drawQueue();
  placeCamera();
  startTips(); // (tips.js)
}
$('sheet').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = (game.draft.name || '').trim().slice(0, 20);
  if (!name || badName(name, game.FILTER)) {
    $('nameErr').textContent = name ? 'Pick a different name.' : 'Give your person a name to start.';
    $('nameErr').hidden = false; $('nameInput').focus(); return;
  }
  $('nameInput').blur();
  if (!game.online()) { showJoining(true); return; }
  if (game.creating) return;
  game.creating = true;
  you.carry = {};
  you.bar = {};
  you.lastKind = null;
  game.net.sock.send(JSON.stringify({ t: 'create', name, age: game.draft.age, look: { ...game.draft, name } }));
});

/* ---------- the end of a life ----------
   The server decides when someone dies (needs run on the server, even while you're away).
   Everything they carried is left on the ground where they fell, with a small grave for a day. */
export function die(m) {
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
  you.bar = {};
  you.lastKind = null;
  drawHeld();
  drawCarry();
  drawNeeds();
  resetPose();
  player.rotation.x = -Math.PI / 2; // lying where they fell
  player.position.y = game.playerGround + 0.2;
  $('deathTitle').textContent = `${m.name || you.look.name} has died`;
  $('deathText').textContent = `${m.cause ? `They died of ${m.cause}` : 'They died'} at ${m.age || you.look.age}. Their things are on the ground where they fell.`;
  $('death').hidden = false;
  $('deathBtn').focus();
}
function endLife() {
  stopQueue();
  walk.target = null;
  game.action = null;
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
export const menuCam = { angle: deg(26) };
export function enterMenu() {
  ui.mode = 'menu';
  closeMenu(); closePause(); closeBag(); closeCraft(); game.closeSay(); hideHint();
  keysDown.clear();
  app.classList.remove('is-creating');
  app.classList.add('is-menu');
  $('creator').hidden = true;
  $('mainMenu').hidden = false;
  menuJoining = false;
  controls.enabled = false;
  ring.visible = false; // the ring under your person
  if (game.previewPerson) { pscene.remove(game.previewPerson); disposeMaterials(game.previewPerson); game.previewPerson = null; }
  removeLabel(game.tagLabel);
  game.tagLabel = null;
  applyDaylight(); // the right time of day from the first frame (it's otherwise only brought up to date once a second)
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
    b.classList.toggle('on', r === game.menuRegion);
    b.classList.toggle('soon', !r.open);
    b.setAttribute('aria-pressed', r === game.menuRegion ? 'true' : 'false');
    const name = document.createElement('span'); name.textContent = r.name;
    const n = game.others.size; // (one world for now, so the open one has everyone)
    const sub = document.createElement('small'); sub.textContent = !r.open ? 'Coming soon' : n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Nobody yet';
    b.append(name, sub);
    b.addEventListener('click', () => { game.menuRegion = r; game.shownAt = -1; applyDaylight(); drawMenu(); });
    return b;
  }));
}
// A world nobody has played yet looks untouched: every tree standing, bushes full, grass grown, nothing on the ground,
// no campfires and nobody there. Only how it's drawn changes; going back to the open world shows it as it really is.
export function setFresh(on) {
  if (game.freshLook === on) return;
  game.freshLook = on;
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
export function drawMenu() {
  setFresh(ui.mode === 'menu' && !!game.menuRegion && !game.menuRegion.open);
  drawRegions();
  if (game.menuRegion && !game.menuRegion.open) { // looking at a world that isn't open yet
    $('playText').textContent = `${game.menuRegion.name} is coming soon`;
    $('playSub').textContent = `${formatTime(worldNow(game.menuRegion.timeZone))} there now`;
    $('playBtn').disabled = true;
    return drawMenuNet();
  }
  $('playText').textContent = menuLine ? 'World is full' : 'Play';
  $('playSub').textContent = menuLine ? `You're ${ordinal(menuLine)} in line. You'll join automatically.` : menuYours ? `as ${menuYours.name} · ${menuYours.age}` : menuYours === null ? 'Make your person' : '';
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
export function menuCamera(dt) {
  if (!reduceMotion) menuCam.angle += dt * 0.035; // about three minutes a lap
  const t = V(POND.x, groundY(POND.x, POND.z) + 1.0, POND.z);
  controls.target.copy(t);
  camera.position.copy(t).add(V().setFromSpherical(new THREE.Spherical(30, deg(57), menuCam.angle)));
  camera.lookAt(t);
}
export function sendHello() {
  game.net.sock.send(JSON.stringify({ t: 'hello', proto: 2, watch: game.net.mode === 'watch', v: VERSION, b: DATA.build || 0, e: DATA.era || 0, link: TEST_BUILD ? 'test' : 'release', pid: game.pid,
    ...(game.adminMode.code && game.net.mode === 'watch' ? { admin: true, adminCode: game.adminMode.code } : {}) })); // admin mode: only ever while watching, never with a person (admin-mode.js)
}
// Play: the same connection now plays your person (or makes a new one)
function play() {
  if (ui.mode !== 'menu' || (game.menuRegion && !game.menuRegion.open)) return;
  setFresh(false);
  game.net.mode = 'play';
  menuJoining = true; // until the server answers
  drawMenu();
  if (game.net.sock && game.net.sock.readyState === 1) sendHello();
  else { showJoining(true); game.goOnline(); }
}
// back to the main menu: from making a person, or Exit in the pause menu (your person goes away and looks after themselves)
export function toMenu() {
  sendTasks(); // what's left of your task list: your person carries on with it while you're away (moving.js)
  game.net.mode = 'watch';
  menuLine = 0;
  dropPlayer();
  enterMenu();
  if (game.net.sock && game.net.sock.readyState === 1) sendHello();
}
// your person is no longer shown here (the server looks after them now)
export function dropPlayer() {
  if (!player) return;
  forgetSit(); // a sit carries on while you're away (the server keeps it)
  stopPlacing();
  stopQueue();
  game.action = null;
  auto.on = false;
  removePlayer();
  you.look = null; you.stats = null; you.dead = false; you.sleeping = false; you.bed = null;
}
$('playBtn').addEventListener('click', play);
$('creatorBack').addEventListener('click', toMenu);
$('exitBtn').addEventListener('click', () => { closePause(); toMenu(); });
$('menuNewsBtn').addEventListener('click', () => game.openNews());
$('menuFeedbackBtn').addEventListener('click', () => game.openFeedback());
function openSettings() {
  $('settings').hidden = false;
  $('settingsClose').focus();
}
$('menuSettingsBtn').addEventListener('click', openSettings);
// the same three in the pause menu, so you don't have to leave the world for them
$('pauseNewsBtn').addEventListener('click', () => { closePause(); game.openNews(); });
$('pauseFeedbackBtn').addEventListener('click', () => { closePause(); game.openFeedback(); });
$('pauseSettingsBtn').addEventListener('click', () => { closePause(); openSettings(); });
function closeSettings() { $('settings').hidden = true; }
/* ---------- Play on other devices (Settings): link codes ----------
   No accounts (Luke, 25 Nov 2026: Google sign-in was too much to set up). The device with the person taps Get a code
   (6 letters, 10 minutes, works once); the other device types it in and plays that person from then on
   (server/src/accounts.js). If the other device has its own guest person, the game says it will be removed, and asks.
   Linking or unlinking starts the page again, so the game rejoins as the right person. net.linked comes from the server. */
const LINK_NOTE_KEY = 'pocket-life:linkNote';
let linkWanted = '';
export function drawLinkRow() { $('linkLbl').textContent = game.net.linked ? 'Playing on other devices' : 'Play on other devices'; }
function hasPerson() { return !!((you.look && !you.dead && ui.mode === 'world') || menuYours); }
function openLink() {
  closeSettings();
  game.paused = true;
  $('link').hidden = false;
  $('linkSure').hidden = true; $('linkSure').disabled = false;
  $('linkCode').hidden = true;
  $('linkUseBox').hidden = false;
  $('linkInput').value = '';
  $('linkGet').hidden = !hasPerson();
  $('linkUnlink').hidden = !game.net.linked;
  $('linkTitle').textContent = 'Play on other devices';
  $('linkText').textContent = hasPerson()
    ? 'Get a code here and type it on your other device, to play the same person on both. Or type a code from your other device below.'
    : 'Type the code from your other device to play your person here.';
  $('linkCancel').focus();
}
function closeLink() { $('link').hidden = true; game.paused = false; linkWanted = ''; }
function linkSay(text) { $('linkText').textContent = text; }
function linkSend(msg) {
  if (!game.online()) { linkSay('You need to be online to do this.'); return false; }
  game.net.sock.send(JSON.stringify({ ...msg, pid: game.pid }));
  return true;
}
// the server's answers (online.js)
export function linkGotCode(m) {
  if ($('link').hidden) return;
  $('linkCode').textContent = m.code; $('linkCode').hidden = false;
  $('linkGet').hidden = true; $('linkUseBox').hidden = true; $('linkUnlink').hidden = true;
  linkSay(`On your other device, open Settings, tap Play on other devices and type this code. It works once, for ${m.minutes} minutes.`);
}
export function linkAsk(m) {
  if ($('link').hidden) return;
  $('linkTitle').textContent = `Play as ${m.theirs}?`;
  linkSay(`You'll play as ${m.theirs} on this device. Your guest person here, ${m.mine}, will be removed. This can't be undone.`);
  $('linkUseBox').hidden = true; $('linkGet').hidden = true; $('linkUnlink').hidden = true;
  $('linkSure').textContent = 'Play as ' + m.theirs; $('linkSure').hidden = false;
}
export function linkNo(m) { if (!$('link').hidden) { linkSay(m.text || "That didn't work. Try again."); $('linkSure').hidden = true; $('linkUseBox').hidden = false; } }
export function linked() { location.reload(); }
export function unlinked() { forgotten(); }
$('linkBtn').addEventListener('click', openLink);
$('linkCancel').addEventListener('click', closeLink);
$('link').addEventListener('click', (e) => { if (e.target === $('link')) closeLink(); });
$('linkGet').addEventListener('click', () => { if (linkSend({ t: 'linkCode' })) linkSay('Getting a code…'); });
$('linkUseBox').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('linkInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { linkSay('The code has 6 letters and numbers.'); return; }
  linkWanted = code;
  if (linkSend({ t: 'linkUse', code })) linkSay('Checking the code…');
});
$('linkUnlink').addEventListener('click', () => {
  $('linkTitle').textContent = 'Unlink this device?';
  linkSay('Your person stays on your other devices. This device starts again as a new guest.');
  $('linkUseBox').hidden = true; $('linkGet').hidden = true; $('linkUnlink').hidden = true;
  linkWanted = ''; $('linkSure').textContent = 'Unlink'; $('linkSure').hidden = false;
});
$('linkSure').addEventListener('click', () => {
  const ok = linkWanted ? linkSend({ t: 'linkUse', code: linkWanted, sure: true }) : linkSend({ t: 'unlink' });
  if (ok) $('linkSure').disabled = true;
});
// once per device, a minute after making a person: you can play on your other devices too
export function linkNoteLater() {
  if (game.net.linked) return;
  try { if (localStorage.getItem(LINK_NOTE_KEY)) return; localStorage.setItem(LINK_NOTE_KEY, '1'); } catch (err) { return; }
  setTimeout(() => { if (ui.mode === 'world' && !game.net.linked) showTag('Play on your other devices too: Settings, Play on other devices', headTop(), 4); }, 60000);
}
/* ---------- Leave the world for good (Settings) ----------
   A warning, then hold the button for 2 seconds. The server drops their things where they stand, takes them out of their
   camp and removes their person, past people and feedback (server/src/persons.js, forget). Then this phone gets a new id
   and the page starts again, so it's a fresh start. A guest and (later) a signed-in player leave the same way. */
const HOLD_MS = 2000;
let holdStart = 0, holdTimer = 0;
function openLeave() {
  closeSettings();
  game.paused = true;
  const name = (you.look && !you.dead && you.look.name) || (menuYours && menuYours.name) || '';
  $('leaveText').textContent = `${name ? `${name} and everything` : 'Everything'} about you will be removed: your person, past people and feedback. The things you carry drop where you stand. This can't be undone.`;
  $('leave').hidden = false;
  $('leaveCancel').focus();
}
function closeLeave() { holdStop(); $('leave').hidden = true; game.paused = false; }
function holdStop() { cancelAnimationFrame(holdTimer); holdStart = 0; $('leaveHold').style.setProperty('--hold', 0); }
function holdStep() {
  if (!holdStart) return;
  const f = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
  $('leaveHold').style.setProperty('--hold', f);
  if (f < 1) { holdTimer = requestAnimationFrame(holdStep); return; }
  holdStart = 0;
  if (!game.online()) { holdStop(); showTag('You need to be online to leave the world', headTop(), 2.5); return; }
  game.net.sock.send(JSON.stringify({ t: 'forget', pid: game.pid }));
  $('leaveHold').disabled = true;
  $('leaveHold').firstElementChild.textContent = 'Leaving…';
}
$('leaveBtn').addEventListener('click', openLeave);
$('leaveCancel').addEventListener('click', closeLeave);
$('leave').addEventListener('click', (e) => { if (e.target === $('leave')) closeLeave(); });
$('leaveHold').addEventListener('pointerdown', (e) => { e.preventDefault(); holdStart = performance.now(); holdStep(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('leaveHold').addEventListener(ev, () => { if (holdStart) holdStop(); });
$('leaveHold').addEventListener('contextmenu', (e) => e.preventDefault());
// the server says they're gone: a new id for this phone, and the game starts again from the top
export function forgotten() {
  try { localStorage.setItem(game.PID_KEY, crypto.randomUUID()); } catch (err) { /* not kept: the page makes one anyway */ }
  location.reload();
}
$('settingsClose').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });
/* ---------- Privacy and rules (Settings): what the game keeps, and how to play nicely ----------
   The words live in one place, privacy.html (a page of its own, for links from outside the game). The panel fetches
   that page the first time it's opened and shows everything inside its #words. Edit the words there.
   Like What's new it's for reading, so taps and keys wait until it's closed (paused); the world carries on. */
let rulesLoaded = false;
async function openRules() {
  closeSettings();
  game.paused = true;
  $('rules').hidden = false;
  $('rulesClose').focus();
  if (rulesLoaded) return;
  const body = $('rulesBody');
  body.replaceChildren(game.el('p', 'admin-empty', 'Loading…'));
  try {
    const res = await fetch(`privacy.html?v=${VERSION}.${DATA.build || 0}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const words = new DOMParser().parseFromString(await res.text(), 'text/html').getElementById('words');
    if (!words || !words.children.length) throw new Error('no words');
    for (const bad of words.querySelectorAll('script, style, iframe, img')) bad.remove(); // (words only)
    body.replaceChildren(...[...words.children].map((n) => document.importNode(n, true)));
    for (const a of body.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener'; } // a link never takes you out of the game
    body.scrollTop = 0;
    rulesLoaded = true;
  } catch (err) { // offline, or the page didn't arrive: say so, with the way to it
    const p = game.el('p', '', "Couldn't load this just now. Check your connection, or ");
    const a = game.el('a', '', 'open the page');
    a.href = 'privacy.html'; a.target = '_blank'; a.rel = 'noopener';
    p.append(a, '.');
    body.replaceChildren(p);
  }
}
export function closeRules() { if ($('rules').hidden) return; $('rules').hidden = true; game.paused = false; }
$('rulesBtn').addEventListener('click', openRules);
$('rulesClose').addEventListener('click', closeRules);
$('rules').addEventListener('click', (e) => { if (e.target === $('rules')) closeRules(); });
// coming back to a person who died or left while you were away
export function showGoneCard(d) {
  const away = d.away ? ' while you were away' : '';
  $('deathTitle').textContent = d.gone ? `${d.name} has left the world` : `${d.name} has died`;
  $('deathText').textContent = d.gone
    ? `They slept for a long time and left the world.${d.had ? ' Their things are where they slept.' : ''}`
    : `They died of ${d.cause || 'weakness'} at ${d.age}${away}.${d.had ? ' Their things are on the ground where they fell.' : ''}`;
  $('death').hidden = false;
}
// what your person did while you were away
export function showWelcomeBack(a) {
  const hrs = a.ms / 3600000;
  const mins = Math.max(1, Math.round(a.ms / 60000));
  const long = hrs >= 1 ? `${Math.round(hrs)} hour${Math.round(hrs) === 1 ? '' : 's'}` : `${mins} minute${mins === 1 ? '' : 's'}`;
  const bits = [];
  const fruit = ITEMS[Object.keys((game.BERRY_SOURCE() || {}).harvest || {})[0]] || { name: 'berry', plural: 'berries' }; // what people away pick
  const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`); // (they eat whatever they carry, so no food is named)
  if (a.tasks) bits.push(`did ${a.tasks} ${a.tasks === 1 ? 'thing' : 'things'} on your task list`); // (server/src/tasks.js)
  if (a.picked) bits.push(`picked ${a.picked} ${(a.picked === 1 ? fruit.name : fruit.plural).toLowerCase()}`);
  if (a.ate) bits.push(`ate ${times(a.ate)}`);
  if (a.drank) bits.push(`drank ${times(a.drank)}`);
  if (a.fed) bits.push('kept the fire going');
  if (a.slept) bits.push('slept');
  if (a.ms < 5 * 60000 && !bits.length) return; // only gone a moment
  const days = Math.round(((AWAY.sleepAfterHours || 24) + (AWAY.goneAfterDays || 1) * 24) / 24); // away this long and they leave the world
  $('backText').textContent = `You were away for ${long}.${bits.length ? ` ${you.look.name} ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ` ${you.look.name} rested.`} Come back within ${days} days or they'll leave the world.`;
  $('back').hidden = false;
}
$('backBtn').addEventListener('click', () => { $('back').hidden = true; });
// joining the world, or getting back after the internet dropped
export function showJoining(on, inWorld = false) {
  $('joining').hidden = !on;
  const stuck = game.net.fails >= 2; // a couple of tries and still no answer: say so, and what to check (the game keeps trying by itself)
  $('joiningText').textContent = inWorld ? `${stuck ? "Can't reach the world. Check your connection." : 'Reconnecting…'} Your person carries on while you're gone.`
    : stuck ? "Can't reach the world. Check your connection. Still trying…" : 'Joining the world…';
}
$('menuBtn').addEventListener('click', () => openPause());
$('deathBtn').addEventListener('click', () => { $('death').hidden = true; if (player) endLife(); });
