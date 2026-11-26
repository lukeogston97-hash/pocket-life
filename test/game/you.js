/* ---------- you: plain data, plus your 3D person ---------- */
import * as THREE from 'three';
import { game, share } from './links.js';
import { bagWeight, barUsed, squaresUsed, stackOf } from './rules.js';
import { app, camera, clamp01, DATA, labelsEl, scene, SETTINGS, V } from './core.js';
import { groundY } from './land.js';
import { interactive } from './nature.js';
import { $, buildItem, fmt, ITEMS, shadowsOn } from './items.js';
import { disposeMaterials, makePerson, setArm } from './people.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  get elapsed() { return elapsed; }, set elapsed(v) { elapsed = v; },
  get menuRegion() { return menuRegion; }, set menuRegion(v) { menuRegion = v; },
  get playerGround() { return playerGround; }, set playerGround(v) { playerGround = v; },
  get tagLabel() { return tagLabel; }, set tagLabel(v) { tagLabel = v; },
});

export const START = { x: 0.6, z: 1.9 };
export const you = { look: null, carry: {}, wear: {}, bar: {}, seen: [], found: [], lastKind: null, lifeStart: 0, stats: null, statsAt: 0, dead: false }; // carry: item id -> how many; bar: the tools on the tool bar (0.1.17); stats: need -> 0 to 100
export const ui = { mode: 'menu' }; // menu (the main menu), creator (making your person) or world (playing)
export let player = null, playerGround = 0, heldView = null;
export const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.54, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#fbf8eb', transparent: true, opacity: 0.7, depthWrite: false }));
scene.add(ring);
export const tapMark = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#fbf8eb', transparent: true, opacity: 0, depthWrite: false }));
scene.add(tapMark);

/* carrying: everything has a weight, and you can carry up to SETTINGS.carryCapacity. Tools on the tool bar (0.1.17,
   rules.js) weigh nothing, and only they get used; a tool you make or pick up goes on the bar while there's room.
   These do the same as the server (server/src/needs.js), which has the final say. */
export const weightOf = (counts) => Object.entries(counts).reduce((sum, [k, n]) => sum + (ITEMS[k] ? ITEMS[k].weight * n : 0), 0);
export const toolSlots = () => Math.max(1, Math.floor(Number(SETTINGS.toolSlots) || 7));
export const carried = () => bagWeight(you.carry, you.bar, ITEMS);
export const onBar = (kind) => you.bar[kind] || 0;
export const hasTool = (kind) => onBar(kind) > 0;
export const barRoom = () => Math.max(0, toolSlots() - barUsed(you.bar));
// what adding these would weigh (a tool going on the bar weighs nothing)
export const addWeight = (kind, n = 1) => (ITEMS[kind] ? ITEMS[kind].weight * (n - (ITEMS[kind].uses ? Math.min(n, barRoom()) : 0)) : 0);
// The inventory's squares (0.2.1, Luke: lock it at 10, and the 30 weight still counts): one square holds a stack of one kind
// (rules.js stackOf: settings.stackSize, or 1 for a tool or something you place). Tools on the tool bar take none.
// Both are live settings, like the tool bar's spots.
export const invSquares = () => Math.max(1, Math.floor(Number(SETTINGS.inventorySquares) || 10));
export const stackOfKind = (kind) => stackOf(ITEMS[kind], SETTINGS.stackSize);
export const squaresTaken = (carry = you.carry, bar = you.bar) => squaresUsed(carry, bar, ITEMS, SETTINGS.stackSize);
export const FULL = 'Your inventory is full';
// why these can't go in your inventory now ('' if they can): gives { kind: n }. Too heavy, or no square for them. A tool goes
// on the tool bar while there's room (no weight, no square). planned: weight already promised to tasks on your list.
// Someone over the squares already (from before 0.2.1) can still top up a stack. The server does the same (needs.js carryNo).
export function carryNo(gives, planned = 0) {
  const carry = { ...you.carry }, bar = { ...you.bar };
  let room = barRoom(), w = carried() + planned;
  for (const [k, n] of Object.entries(gives || {})) {
    const it = ITEMS[k];
    if (!it || !(n > 0)) continue;
    const up = it.uses ? Math.min(n, room) : 0;
    room -= up;
    w += it.weight * (n - up);
    carry[k] = (carry[k] || 0) + n;
    if (up) bar[k] = (bar[k] || 0) + up;
  }
  if (w > SETTINGS.carryCapacity + 1e-6) return 'Too heavy';
  const after = squaresTaken(carry, bar);
  return after > invSquares() && after > squaresTaken() ? FULL : '';
}
// a task needs a tool that isn't on your tool bar: what to say (in your inventory: equip it; else you need one)
export const toolNeed = (kind) => (you.carry[kind] > 0 ? `Equip your ${ITEMS[kind].name.toLowerCase()}` : `Needs a ${ITEMS[kind].name.toLowerCase()}`);
export const toolWhy = (kind) => (you.carry[kind] > 0 ? `Equip your ${ITEMS[kind].name.toLowerCase()} first` : `You need a ${ITEMS[kind].name.toLowerCase()}`);
export function addToCarry(kind, n = 1, uses) {
  const it = ITEMS[kind];
  if (it && it.uses) { // the bar's come first in the tool's wear list
    const up = Math.min(n, barRoom()), list = game.wearList(kind), b = onBar(kind), left = uses ?? it.uses;
    list.splice(b, 0, ...Array(up).fill(left));
    for (let i = up; i < n; i++) list.push(left);
    you.wear[kind] = list;
    if (up) you.bar[kind] = b + up;
  }
  you.carry[kind] = (you.carry[kind] || 0) + n;
  you.lastKind = kind;
}
// which: for a tool, which one (its place in the wear list; the bar's come first). Else spares in the inventory go first
export function takeFromCarry(kind, n = 1, which) {
  const have = you.carry[kind] || 0;
  const taken = Math.min(have, n);
  if (taken <= 0) return 0;
  if (ITEMS[kind] && ITEMS[kind].uses) {
    const list = game.wearList(kind), b = onBar(kind), one = taken === 1 && Number.isInteger(which) && which >= 0 && which < have;
    if (one) list.splice(which, 1);
    list.length = Math.min(list.length, have - taken);
    you.wear[kind] = list;
    const nb = Math.min(one && which < b ? b - 1 : b, have - taken);
    if (nb > 0) you.bar[kind] = nb; else delete you.bar[kind];
  }
  if (have - taken > 0) you.carry[kind] = have - taken;
  else delete you.carry[kind];
  if (!you.carry[you.lastKind]) you.lastKind = Object.keys(you.carry)[0] || null;
  return taken;
}
// your hands are empty unless you're using a tool right now (chopping with the axe, cutting with the knife) (Luke, 0.2.1)
const heldKind = () => (you.using && hasTool(you.using) ? you.using : null);
export function drawHeld() {
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
export function spawnPlayer(look) {
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
export function removePlayer() {
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
export function addLabel(o) {
  const el = document.createElement('div');
  el.className = 'lbl3d ' + o.cls;
  el.textContent = o.text;
  labelsEl.appendChild(el);
  const L = { el, born: elapsed, ttl: Infinity, gap: 10, rise: 0, offset: V(), ...o };
  labels.push(L);
  return L;
}
export function removeLabel(L) {
  if (!L) return;
  const i = labels.indexOf(L);
  if (i >= 0) labels.splice(i, 1);
  L.el.remove();
}
export function showTag(text, pos, gap = 10, ttl = 2.2) {
  removeLabel(tagLabel);
  tagLabel = addLabel({ cls: 'tag3d', text, anchor: pos.clone(), ttl, gap });
}
export function showGain(text) { addLabel({ cls: 'gain', text, anchor: headTop(), ttl: 1.3, rise: 0.5, gap: 4 }); }
export const headTop = () => (player ? V(player.position.x, playerGround + player.userData.headTop + 0.1, player.position.z) : game.controls.target.clone()); // on the main menu: the middle of the view
const tmp = V();
// The free space between the info at the top and the bars at the bottom, measured (big phone text makes the HUD taller).
// Name tags fade out where they'd run into the HUD, and menus and pop-ups stay inside the free space.
export const hudZone = { top: 0, bottom: 1e9, menuBottom: 1e9 };
export function measureHud() {
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
export function updateLabels() {
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
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The world has one clock for everyone: settings.worldTimeZone (Darwin time for the Oceania world). worldNow() gives
// a Date whose UTC fields read as the time there, so the date, the time and day and night are the same on every phone.
export const WORLD_TZ = SETTINGS.worldTimeZone || 'Australia/Darwin';
const tzFormats = new Map();
// the time now in a time zone (the world's own unless another is asked for), as a Date whose UTC fields read as that time
export function worldNow(tz = WORLD_TZ) {
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
export const REGIONS = (DATA.regions || []).filter((r) => r && r.id && r.name);
let menuRegion = REGIONS.find((r) => r.open) || null;
const formatDate = (d) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const formatTime = (d) => `${((d.getUTCHours() + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')} ${d.getUTCHours() < 12 ? 'am' : 'pm'}`;
export function drawHud() {
  if (!you.look) return;
  $('hudName').textContent = you.look.name;
  $('hudAge').textContent = String(you.look.age);
  const now = worldNow(); // the world runs on real time, on its own clock
  $('hudTime').textContent = `${formatDate(now)} · ${formatTime(now)}`;
  measureHud();
}
export function drawWeightBar(bar, w) {
  bar.style.width = `${Math.min(100, (w / SETTINGS.carryCapacity) * 100)}%`;
  bar.parentElement.classList.toggle('full', w >= SETTINGS.carryCapacity);
}
export function drawCarry() {
  if (typeof game.craftOpen === 'function' && game.craftOpen()) game.drawCraft();
  const w = carried();
  $('carryWeight').textContent = fmt(w);
  $('carryMax').textContent = fmt(SETTINGS.carryCapacity);
  $('bagBtn').classList.toggle('full', w >= SETTINGS.carryCapacity);
  if (game.bagOpen()) game.drawBag();
}
