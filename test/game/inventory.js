/* ---------- little pictures of things, for the inventory and craft lists ----------
   Drawn once from the real 3D models with a small separate renderer, then that renderer is let go. */
import * as THREE from 'three';
import { game, share } from './links.js';
import { matIs, recipeWants, squaresUsed, storeRoom, tidyBar } from './rules.js';
import { camera, canvas, renderer, SETTINGS, V } from './core.js';
import { terrain } from './land.js';
import { $, buildItem, countLabel, deg, fmt, groupOf, GROUPS, ITEMS, RECIPES } from './items.js';
import { disposeMaterials } from './people.js';
import {
  addToCarry, barRoom, carried, carryNo, drawCarry, drawHeld, drawWeightBar, FULL, hasTool, headTop, invSquares, onBar, player,
  showGain, showTag, squaresTaken, stackOfKind, takeFromCarry, toolSlots, toolWhy, ui, you,
} from './you.js';
import { spendEnergy } from './needs.js';
import { hideHint, tipDid } from './tips.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  get bagDragging() { return bagDragging; }, set bagDragging(v) { bagDragging = v; },
  get bagDrawn() { return bagDrawn; }, set bagDrawn(v) { bagDrawn = v; }, get bagOpen() { return bagOpen; },
  get craftDrawn() { return craftDrawn; }, set craftDrawn(v) { craftDrawn = v; },
  get craftOpen() { return craftOpen; }, get dragPoint() { return dragPoint; }, set dragPoint(v) { dragPoint = v; },
  drawBag, get drawCraft() { return drawCraft; },
  get foundDrawn() { return foundDrawn; }, set foundDrawn(v) { foundDrawn = v; }, wearList,
});

const itemIcons = new Map();
function makeItemIcons() {
  if (itemIcons.size) return;
  let r = null;
  try {
    r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(96, 96);
    r.toneMapping = renderer.toneMapping;
    r.outputColorSpace = renderer.outputColorSpace;
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight('#fffaf0', '#6a6a58', 2.2));
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(1.5, 3, 2);
    sc.add(key);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    const box = new THREE.Box3(), size = V(), mid = V();
    for (const kind of Object.keys(ITEMS)) {
      const { model, iconY } = buildItem(kind);
      model.rotation.y = iconY ?? 0.5; // a shape can turn its picture (a log shows its cut end)
      sc.add(model);
      box.setFromObject(model);
      box.getSize(size); box.getCenter(mid);
      const rad = Math.max(size.x, size.y, size.z) * 0.62;
      const dist = rad / Math.tan(deg(15));
      cam.position.copy(mid).add(V(0.45, 0.75, 0.9).normalize().multiplyScalar(dist));
      cam.lookAt(mid);
      r.render(sc, cam);
      itemIcons.set(kind, r.domElement.toDataURL('image/png'));
      sc.remove(model);
      disposeMaterials(model);
    }
  } catch (err) { console.warn('Item pictures could not be drawn', err); }
  if (r) { r.dispose(); r.forceContextLoss(); }
}
// a picture of the thing (or its colour, if the picture couldn't be drawn)
export function itemPic(kind) {
  makeItemIcons();
  const url = itemIcons.get(kind);
  if (url) { const img = document.createElement('img'); img.className = 'pic'; img.src = url; img.alt = ''; return img; }
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = ITEMS[kind].look.head || ITEMS[kind].look.colour || '#9a948a';
  return dot;
}

/* ---------- your inventory: a grid of what you carry; tap one to see what it is and what you can do with it ---------- */
export const bagOpen = () => $('bag').classList.contains('open');
let bagPick = null; // the tile tapped in the grid (kind:number; its info shows under it), or null
function smallButton(text, onClick, primary, off) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'small-btn' + (primary ? ' go' : '');
  b.textContent = text;
  b.disabled = !!off;
  b.addEventListener('click', onClick);
  return b;
}
// food first, then tools, then things you place, then everything else, each in game-data.json order
const ITEM_ORDER = Object.keys(ITEMS);
const bagGroup = (it) => (Object.keys(it.eat || {}).length ? 0 : it.uses ? 1 : it.places ? 2 : 3);
const kindOrder = (a, b) => bagGroup(ITEMS[a]) - bagGroup(ITEMS[b]) || ITEM_ORDER.indexOf(a) - ITEM_ORDER.indexOf(b);
const bagKinds = () => Object.keys(you.carry).filter((k) => ITEMS[k] && you.carry[k] > 0).sort(kindOrder);
// a line about it: its own "about" in game-data.json, else the about of the recipe that makes it
const itemAbout = (kind) => { const a = ITEMS[kind].about || (RECIPES.find((r) => r.makes[kind]) || {}).about || ''; return a && !/[.!?]$/.test(a) ? `${a}.` : a; }; // (a recipe's line has no full stop)
// a tool's uses left, one per tool you carry, the one in use first (the server sends a list; before 0.2.6 one number)
function wearList(kind) {
  const n = you.carry[kind] || 0, w = you.wear[kind];
  const list = (Array.isArray(w) ? w : w != null ? [w] : []).slice(0, n);
  while (list.length < n) list.push(ITEMS[kind].uses);
  return list;
}
// what the grid shows: a square for each stack (0.2.1, Luke: up to settings.stackSize of one thing, so 15 sticks are a
// square of 10 and a square of 5), and each tool gets its own (Luke's pick), with its own wear. Tools on the
// tool bar (0.1.17) aren't in the grid: they're the first of each tool's wear list, so the grid's start after them.
// Each can be dropped, and keeps its wear on the ground. i: the tool's place in its wear list (which one, to the server).
function bagSlots() {
  const out = [];
  for (const kind of bagKinds()) {
    const n = you.carry[kind], it = ITEMS[kind];
    if (!it.uses) { const size = stackOfKind(kind); for (let j = 0, left = n; left > 0; j++, left -= size) out.push({ kind, key: `${kind}:${j}`, n: Math.min(size, left) }); continue; }
    const worn = wearList(kind);
    for (let i = onBar(kind); i < n; i++) out.push({ kind, key: `${kind}:${i}`, n: 1, i, left: worn[i] });
  }
  return out;
}
// the tool bar (0.1.17, Luke): the tools on it, in game-data.json order. The first of a kind is the one in use, the rest spares
function barSlots() {
  const out = [];
  for (const kind of ITEM_ORDER) {
    const b = Math.min(onBar(kind), you.carry[kind] || 0), worn = b ? wearList(kind) : [];
    for (let i = 0; i < b; i++) out.push({ kind, key: `bar:${kind}:${i}`, n: 1, i, bar: true, spare: i > 0, spares: b - 1, left: worn[i] });
  }
  return out;
}
const usesWord = (n) => `${n} ${n === 1 ? 'use' : 'uses'} left`;
const usesText = (s) => (s.spare ? `spare · ${s.left} uses` : `${s.spares ? 'in use · ' : ''}${usesWord(s.left)}`);
function bagTile(s) {
  const it = ITEMS[s.kind];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = (s.bar ? 'bag-tile tool-tile' : 'bag-tile') + (bagPick === s.key ? ' on' : '');
  b.dataset.kind = s.kind;
  b.dataset.key = s.key;
  if (s.bar) b.dataset.barKey = s.key;
  b.setAttribute('aria-pressed', String(bagPick === s.key));
  b.setAttribute('aria-label', s.store ? `${it.uses ? `${it.name}, ${usesWord(s.left)}` : countLabel(s.kind, s.n)}, in the ${storeNoun()}`
    : (it.uses ? `${it.name}, ${s.bar ? (s.spare ? `spare, ${s.left} uses` : usesWord(s.left)) : `in your inventory, ${usesWord(s.left)}`}` : countLabel(s.kind, s.n)));
  b.appendChild(itemPic(s.kind));
  if (s.n > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = s.n; b.appendChild(c); }
  if (it.uses) { const w = document.createElement('span'); w.className = 'wear'; w.style.setProperty('--w', (s.left / it.uses).toFixed(2)); b.appendChild(w); }
  b.addEventListener('click', () => { // tap to show its info, tap again to hide it
    if (Date.now() - bagDragged < 400) return;
    bagPick = bagPick === s.key ? null : s.key;
    drawBag();
    const again = $('bag').querySelector(`[data-key="${s.key}"]`);
    if (again) again.focus({ preventScroll: true });
  });
  bagDragOn(b, s);
  return b;
}
// equipping (0.1.17, Luke): a tool from the inventory onto the tool bar; out: a tool on the bar to swap it with (only when
// the bar is full). Unequip: off the bar, into the inventory, where it weighs. Straight away, like the server does it.
function shiftTool(kind, from, to) { const list = wearList(kind), [x] = list.splice(from, 1); list.splice(to, 0, x); you.wear[kind] = list; }
function equipTool(s, out) {
  if (ui.mode !== 'world' || !player || you.dead || !s || s.bar || !you.carry[s.kind]) return;
  const off = barRoom() < 1 ? out : null, say = (text) => showTag(text, headTop(), 2.5);
  if (barRoom() < 1 && !off) { say('Your tool bar is full: drag it onto a tool there to swap them'); return; }
  const heavier = (off ? ITEMS[off.kind].weight : 0) - ITEMS[s.kind].weight;
  if (heavier > 0 && carried() + heavier > SETTINGS.carryCapacity) { say('Too heavy to carry'); return; }
  if (off) { const ob = onBar(off.kind); shiftTool(off.kind, off.i, ob - 1); if (ob > 1) you.bar[off.kind] = ob - 1; else delete you.bar[off.kind]; }
  const b = onBar(s.kind); // (one less if it swapped with one of its own kind; the one to equip hasn't moved)
  shiftTool(s.kind, s.i, b);
  you.bar[s.kind] = b + 1;
  game.sendAct({ t: 'equip', kind: s.kind, which: s.i, ...(off ? { out: { kind: off.kind, which: off.i } } : {}) });
  bagPick = null;
  drawCarry();
}
function unequipTool(s) {
  if (ui.mode !== 'world' || !player || you.dead || !s || !s.bar || !hasTool(s.kind)) return;
  if (carried() + ITEMS[s.kind].weight > SETTINGS.carryCapacity) { showTag('Too heavy to carry', headTop(), 2.5); return; }
  if (squaresTaken() + 1 > invSquares()) { showTag(FULL, headTop(), 2.5); return; } // a tool takes a square of its own (0.2.1)
  const b = onBar(s.kind);
  shiftTool(s.kind, s.i, b - 1);
  if (b > 1) you.bar[s.kind] = b - 1; else delete you.bar[s.kind];
  game.sendAct({ t: 'unequip', kind: s.kind, which: s.i });
  bagPick = null;
  drawCarry();
}
// a tool dragged and let go on the inventory itself: from the inventory onto the tool bar (onto a tool there to swap
// them when it's full), or from the bar onto the inventory
const pointIn = (el, e) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
function toolDropAt(s, e) {
  const onTheBar = pointIn($('toolBar'), e);
  if (s.bar) { if (!onTheBar) unequipTool(s); return; }
  if (!onTheBar) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY), tile = hit && hit.closest('[data-bar-key]');
  equipTool(s, tile ? barSlots().find((x) => x.key === tile.dataset.barKey) : null);
}
// dragging a tile out of the bag onto the world: your person eats it, a campfire takes fuel or cooks it, anywhere else drops
// one. The bag fades while you drag and comes back after. Mouse: drag after a few pixels. Touch: hold a moment first (so the
// grid can still scroll).
let bagDragged = 0; // when the last drag ended (the click after it is ignored)
function bagDragOn(b, s) {
  b.addEventListener('dragstart', (e) => e.preventDefault()); // the browser's own picture-drag would cancel ours
  b.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY, touch = e.pointerType !== 'mouse', tool = !!ITEMS[s.kind].uses, storing = storeOn(), stay = tool || storing;
    let ghost = null, timer = null, over = false;
    const start = () => {
      clearTimeout(timer);
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.appendChild(itemPic(s.kind));
      document.body.appendChild(ghost);
      $('bag').classList.add(stay ? 'dragging-tool' : 'dragging'); // a tool: the inventory stays, to drop it on or off the tool bar (0.1.17); a crate open too (0.2.2)
      if (storing) { $(s.store ? 'bagList' : 'storeList').classList.add('drop-on'); if (s.store && tool) $('toolBar').classList.add('drop-on'); } // into the crate, or out of it
      else if (tool) $(s.bar ? 'bagList' : 'toolBar').classList.add('drop-on');
      bagDragging = true;
      dragPoint = { x: e.clientX, y: e.clientY, armed: false };
      move(e);
    };
    const move = (m) => {
      if (!ghost) return;
      ghost.style.transform = `translate(${m.clientX - 28}px, ${m.clientY - 28}px)`;
      if (dragPoint) { dragPoint.x = m.clientX; dragPoint.y = m.clientY; dragPoint.inSheet = stay && pointIn($('bag'), m); } // (the view doesn't slide while over the inventory)
    };
    const onMove = (m) => {
      if (!ghost) {
        const far = Math.hypot(m.clientX - x0, m.clientY - y0) > (touch ? 10 : 8);
        if (far && !touch) start(); else if (far) end(null);
        return;
      }
      move(m);
    };
    const end = (m) => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (!ghost) return;
      ghost.remove();
      $('bag').classList.remove('dragging', 'dragging-tool');
      $('toolBar').classList.remove('drop-on'); $('bagList').classList.remove('drop-on'); $('storeList').classList.remove('drop-on');
      bagDragging = false;
      dragPoint = null;
      bagDragged = Date.now();
      if (m && !over) {
        if (storing && storeOn() && pointIn($('bag'), m)) storeDropAt(s, m); // a crate open: into it or out of it (0.2.2)
        else if (s.store) { /* a crate's square let go off the inventory: it stays in the crate */ }
        else if (tool && bagOpen() && pointIn($('bag'), m)) toolDropAt(s, m);
        else bagDropAt(s, m);
      }
      if (!bagOpen()) openBag();
    };
    const up = (m) => { end(m); }, cancel = () => { over = true; end(null); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    if (touch) timer = setTimeout(start, 260);
  });
}
let bagDragging = false;
let dragPoint = null; // where a drag is now ({x, y}): near the edge of the screen the view slides that way (edgePan in input.js)
document.addEventListener('touchmove', (e) => { if (bagDragging && e.cancelable) e.preventDefault(); }, { passive: false });
// where a drag let go decides what happens, as a task at the end of your list. s: the tile ({kind, i}); loose: a lone item
// lying on the ground (picked up first; what comes after only happens if that pick-up does)
export function bagDropAt(s, e, loose) {
  const kind = s.kind, it = ITEMS[kind];
  if (ui.mode !== 'world' || !player || you.dead || (!loose && !you.carry[kind])) return;
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return; // let go off the world: nothing
  const t = game.pickTarget(...game.toCanvas(e));
  const say = (text) => showTag(text, headTop(), 2);
  const pick = () => {
    if (!loose) return true;
    game.queueTask({ type: 'pickup', id: loose.id });
    return game.allTasks().some((q) => q.type === 'pickup' && q.id === loose.id);
  };
  const then = (task) => { if (pick()) game.queueTask(loose ? { ...task, from: loose.id } : task); };
  if (t && t.kind === 'you') {
    if (loose) pick(); // (picks it up; eat it from the bag)
    else if (it.eat) game.eatOne(kind); else say(`Can't eat ${it.name.toLowerCase()}`);
    return;
  }
  if (t && t.kind === 'placed' && t.th.built) {
    const th = t.th, P = game.PLACEABLES[th.kind];
    if (P.fire && P.fire.fuels[kind]) {
      if (game.roomFor(th, kind) < 1) say('The fire is full'); else then({ type: 'tend', id: th.id, do: 'add', n: 1, fuel: kind });
      return;
    }
    const r2 = RECIPES.find((q) => q.near === th.kind && q.needs[kind] && recipeKnown(q));
    if (r2) {
      if (P.fire && !game.isLit(th)) { say('Light the fire first'); return; }
      const why = loose ? '' : cantMake(r2);
      if (why && why !== 'Not here') say(why); else then({ type: 'make', id: th.id, recipe: r2.id });
      return;
    }
    if (P.store) { say(`Open the ${P.noun} to put things in`); return; } // storage (0.2.2): its squares, at the top of your inventory
  }
  game.ray.setFromCamera(game.ndc, camera);
  const gh = game.ray.intersectObject(terrain, false)[0]; // the ground under your finger (past grass, trees and the like)
  const at = t && t.kind === 'item' ? { x: t.item.x + 0.3, z: t.item.z + 0.3 } : t && t.kind === 'ground' ? { x: t.point.x, z: t.point.z }
    : gh && !['shore', 'use'].includes(t && t.kind) ? { x: gh.point.x, z: gh.point.z } : null;
  if (!at) { say("Can't put it there"); return; } // the pond, a bush
  if (!loose && game.spareInBag(kind) < 1) { say('Already in your task list'); return; } // every one you carry is already queued to go somewhere
  then({ type: 'drop', kind, n: 1, ...(!loose && it.uses ? { which: s.i } : {}), x: at.x, z: at.z });
}
// the bar under the grid: what it is, and what you can do with it (the main thing in green)
function drawBagInfo(s) {
  const box = $('bagInfo');
  box.hidden = !s;
  if (!s) { box.replaceChildren(); return; }
  if (s.store) { drawStoreInfo(s); return; } // a square in the crate (0.2.2)
  const kind = s.kind, it = ITEMS[kind], n = s.n, th = storeOn() ? storeThing() : null;
  const title = document.createElement('strong');
  title.textContent = it.uses ? it.name : countLabel(kind, n);
  const detail = document.createElement('small');
  detail.textContent = s.bar ? `On your tool bar · ${usesText(s)}` : `Weight ${fmt(it.weight * n)}${it.uses ? ` · ${usesWord(s.left)}` : ''}`; // (on the bar it weighs nothing)
  const words = document.createElement('div');
  words.append(title, detail);
  const head = document.createElement('div');
  head.className = 'info-head';
  head.appendChild(words);
  const fit = th ? putFit(th, kind, n) : 0; // a crate is open (0.2.2): Put in is the main thing (Luke's pick: tap, then Put in or Take)
  if (th) {
    head.appendChild(smallButton(n > 1 ? (fit >= n || fit < 1 ? 'Put in all' : `Put in ${fit}`) : 'Put in', () => putIn(s, n), true, fit < 1));
    if (fit < 1) detail.textContent = putWhy(th, kind);
  } else if (s.bar) head.appendChild(smallButton('Unequip', () => unequipTool(s))); // the tool bar (0.1.17): off it, into the inventory
  else if (it.uses) head.appendChild(smallButton('Equip', () => equipTool(s), true)); // onto the tool bar: only tools there get used
  else if (it.places) head.appendChild(smallButton('Place', () => game.startPlacing(kind), true)); // a campfire: choose where it goes
  else if (Object.keys(it.eat || {}).length) head.appendChild(smallButton('Eat', () => game.eatOne(kind), true));
  const parts = [head];
  const about = itemAbout(kind);
  if (about) { const p = document.createElement('p'); p.className = 'info-about'; p.textContent = about; parts.push(p); }
  const acts = document.createElement('div');
  acts.className = 'info-acts';
  if (th && n > 1 && fit > 0) acts.appendChild(smallButton('Put in 1', () => putIn(s, 1)));
  acts.appendChild(smallButton(n > 1 ? 'Drop 1' : 'Drop', () => game.dropItems(kind, 1, it.uses ? s.i : undefined))); // a tool: this one
  if (n > 1) acts.appendChild(smallButton('Drop all', () => game.dropItems(kind, n)));
  parts.push(acts);
  box.replaceChildren(...parts);
}
let bagDrawn = ''; // what the grid shows now: it's only redrawn when that changes, so a tap in progress isn't lost
// the inventory's two tabs at the top (Luke, 0.1.15: they replaced the Craft button): 'bag' (Inventory, your grid) or
// 'recipes' (Recipes: the craft mat with the list under it)
let bagTab = 'bag';
export function drawBag() {
  you.bar = tidyBar(you.bar, you.carry, ITEMS, toolSlots()); // (in step with what you carry, and the number of spots: a live setting)
  const w = carried(), crafting = bagTab === 'recipes';
  $('bagWeight').textContent = `${fmt(w)} / ${fmt(SETTINGS.carryCapacity)}`;
  drawWeightBar($('bagBar'), w);
  $('bag').classList.toggle('crafting', crafting);
  for (const [id, tab] of [['bagTabBag', 'bag'], ['bagTabRecipes', 'recipes']]) { $(id).classList.toggle('on', bagTab === tab); $(id).setAttribute('aria-pressed', String(bagTab === tab)); }
  $('bagPart').hidden = crafting;
  $('bagHeadWeight').hidden = crafting; // (the weight sits in the header on the Inventory tab, 0.1.17)
  const crate = crafting ? null : storeThing(), inCrate = crate ? storeSlots(crate) : []; // a crate open (0.2.2): its squares at the top
  $('store').hidden = !crate;
  $('bag').classList.toggle('storing', !!crate);
  $('mat').hidden = !crafting;
  $('found').hidden = !crafting;
  if (crafting) { drawMat(); drawFound(); }
  const slots = bagSlots(), tools = barSlots(), spots = toolSlots();
  const picked = [...tools, ...slots, ...inCrate].find((s) => s.key === bagPick) || null;
  if (!picked) bagPick = null;
  const shows = JSON.stringify([slots.map((s) => [s.key, s.n, s.left || 0]), tools.map((s) => [s.key, s.left, s.spares]), spots, bagPick,
    crate ? [crate.id, inCrate.map((s) => [s.key, s.n, s.left || 0]), carried(), squaresTaken()] : null]);
  if (shows === bagDrawn) return;
  bagDrawn = shows;
  if (crate) drawStore(crate, inCrate);
  $('bagEmpty').hidden = slots.length + tools.length > 0;
  const cells = slots.map((s) => { const li = document.createElement('li'); li.appendChild(bagTile(s)); return li; });
  const total = Math.max(invSquares(), slots.length); // the inventory's squares (0.2.1: locked, a live setting); empty ones dashed
  while (cells.length < total) { const li = document.createElement('li'); li.className = 'bag-slot'; li.setAttribute('aria-hidden', 'true'); cells.push(li); }
  $('bagList').replaceChildren(...cells);
  // the tool bar: its tools, then empty spots (up to 7 across, more spots go on another row)
  const bar = tools.map((s) => { const li = document.createElement('li'); li.appendChild(bagTile(s)); return li; });
  while (bar.length < spots) { const li = document.createElement('li'); li.className = 'tool-slot'; li.setAttribute('aria-hidden', 'true'); bar.push(li); }
  $('toolBar').style.gridTemplateColumns = `repeat(${Math.min(spots, 7)}, minmax(0, 1fr))`;
  $('toolBar').setAttribute('aria-label', `Tool bar, ${tools.length} of ${spots}`);
  $('toolBar').replaceChildren(...bar);
  drawBagInfo(picked);
}

/* ---------- storage: a crate's squares at the top of the Inventory tab (0.2.2, the small wooden crate) ----------
   Open on a crate's tap menu walks over, then openStore shows its squares above your tool bar (Luke's pick: tap a square,
   then Put in or Take). In the crate: Take all and Take 1; in your inventory or on the tool bar: Put in all and Put in 1.
   Dragging a square across does the same. It happens straight away, like the server does it (actions.js putIn and
   takeOut), and the server's answer has the last word. The squares go when the inventory closes, you switch to Recipes,
   or you walk away from the crate (storeCheck, once a second). The same squares and stacks as the inventory (rules.js). */
let storeId = null; // the placed thing whose squares show, or null
const storeThing = () => (storeId != null && game.placed && game.placed.get(storeId)) || null;
const storeOn = () => !!storeThing() && bagOpen() && bagTab === 'bag';
const storeNoun = () => { const th = storeThing(); return th ? game.PLACEABLES[th.kind].noun : 'crate'; };
export const storeShowing = (id) => storeId != null && storeId === id && bagOpen();
export function openStore(id) { storeId = id; bagPick = null; openBag('bag'); }
// still by it? Its squares go once you're more than a couple of metres away, it's gone, or it's someone else's camp now
export function storeCheck() {
  if (storeId == null) return;
  const th = storeThing(), P = th && game.PLACEABLES[th.kind];
  const near = th && player && Math.hypot(th.x - player.position.x, th.z - player.position.z) <= P.solid + 2.6 && !game.notMineAt(th.x, th.z);
  if (near && bagOpen()) return;
  storeId = null; bagPick = null;
  if (bagOpen()) drawBag();
}
// the uses left of each tool of a kind in it (the server sends a list; missing ones are new)
function storeWear(th, kind) {
  const n = (th.store || {})[kind] || 0, list = ((th.wear || {})[kind] || []).slice(0, n);
  while (list.length < n) list.push(ITEMS[kind].uses);
  return list;
}
// a square for each stack, like your inventory (bagSlots); each tool its own, with its wear
function storeSlots(th) {
  const out = [], st = th.store || {};
  for (const kind of Object.keys(st).filter((k) => ITEMS[k] && st[k] > 0).sort(kindOrder)) {
    const n = st[kind];
    if (!ITEMS[kind].uses) { const size = stackOfKind(kind); for (let j = 0, left = n; left > 0; j++, left -= size) out.push({ kind, key: `store:${kind}:${j}`, n: Math.min(size, left), store: true }); continue; }
    const worn = storeWear(th, kind);
    for (let i = 0; i < n; i++) out.push({ kind, key: `store:${kind}:t${i}`, n: 1, i, left: worn[i], store: true });
  }
  return out;
}
function drawStore(th, inCrate) {
  const P = game.PLACEABLES[th.kind], squares = P.store.squares, used = squaresUsed(th.store, null, ITEMS, SETTINGS.stackSize);
  $('storeName').textContent = P.name;
  $('storeUsed').textContent = inCrate.length ? `${used} of ${squares} squares` : 'Empty';
  $('storeList').setAttribute('aria-label', `In the ${P.noun}, ${used} of ${squares} squares`);
  const cells = inCrate.map((s) => { const li = document.createElement('li'); li.appendChild(bagTile(s)); return li; });
  while (cells.length < Math.max(squares, inCrate.length)) { const li = document.createElement('li'); li.className = 'bag-slot'; li.setAttribute('aria-hidden', 'true'); cells.push(li); }
  $('storeList').replaceChildren(...cells);
}
// something that holds things can't go in one (a crate in a crate; the server says the same)
const storable = (kind) => { const pl = ITEMS[kind].places; return !(pl && game.PLACEABLES[pl] && game.PLACEABLES[pl].store); };
// how many of these fit in it (up to n), and why none do
const putFit = (th, kind, n) => (storable(kind) ? Math.min(ITEMS[kind].uses ? 1 : n, storeRoom(th.store, kind, ITEMS, SETTINGS.stackSize, game.PLACEABLES[th.kind].store.squares)) : 0);
const putWhy = (th, kind) => (storable(kind) ? `The ${game.PLACEABLES[th.kind].noun} is full` : `${ITEMS[kind].plural} can't go in a ${game.PLACEABLES[th.kind].noun}`);
// how many you can take of these (up to n): as many as you can carry
function takeFit(kind, n) { let k = ITEMS[kind].uses ? 1 : n; while (k > 0 && carryNo({ [kind]: k })) k--; return k; }
const takeWhy = (kind) => (carryNo({ [kind]: 1 }) === FULL ? FULL : 'Too heavy to carry');
// from your inventory (or tool bar) into the crate: n of that square (a tool: that one)
function putIn(s, n) {
  const th = storeOn() ? storeThing() : null;
  if (!th || ui.mode !== 'world' || !player || you.dead || !you.carry[s.kind]) return;
  const tool = !!ITEMS[s.kind].uses, k = Math.min(putFit(th, s.kind, n), you.carry[s.kind]);
  if (k < 1) { showTag(putWhy(th, s.kind), headTop(), 2.5); return; }
  const uses = tool ? wearList(s.kind)[s.i] : null, worn = tool ? storeWear(th, s.kind) : null;
  takeFromCarry(s.kind, k, tool ? s.i : undefined);
  th.store[s.kind] = (th.store[s.kind] || 0) + k;
  if (tool) th.wear[s.kind] = [...worn, uses];
  game.sendAct({ t: 'putIn', id: th.id, kind: s.kind, n: k, ...(tool ? { which: s.i } : {}) });
  bagPick = null;
  drawHeld();
  drawCarry();
}
// out of the crate into your inventory (a tool onto the tool bar if there's room, like one picked up)
function takeOut(s, n) {
  const th = storeOn() ? storeThing() : null;
  if (!th || ui.mode !== 'world' || !player || you.dead || !((th.store || {})[s.kind] > 0)) return;
  const tool = !!ITEMS[s.kind].uses, k = Math.min(takeFit(s.kind, n), th.store[s.kind]);
  if (k < 1) { showTag(takeWhy(s.kind), headTop(), 2.5); return; }
  let uses;
  if (tool) { const worn = storeWear(th, s.kind); uses = worn.splice(s.i, 1)[0]; th.wear[s.kind] = worn; }
  th.store[s.kind] -= k;
  if (th.store[s.kind] < 1) { delete th.store[s.kind]; delete th.wear[s.kind]; }
  addToCarry(s.kind, k, uses);
  game.sendAct({ t: 'takeOut', id: th.id, kind: s.kind, n: k, ...(tool ? { which: s.i } : {}) });
  showGain(`+${countLabel(s.kind, k).toLowerCase()}`);
  bagPick = null;
  drawHeld();
  drawCarry();
}
// a square dragged and let go on the inventory while a crate is open: onto the crate's squares puts it in, a crate's
// square anywhere else on the inventory takes it out; a tool from the inventory still goes on or off the tool bar
function storeDropAt(s, e) {
  const onCrate = pointIn($('storeList'), e);
  if (s.store) { if (!onCrate) takeOut(s, s.n); return; }
  if (onCrate) { putIn(s, s.n); return; }
  if (ITEMS[s.kind].uses) toolDropAt(s, e);
}
// the info bar for a square in the crate: Take all (as many as you can carry) and Take 1
function drawStoreInfo(s) {
  const box = $('bagInfo'), kind = s.kind, it = ITEMS[kind], n = s.n, fit = takeFit(kind, n);
  const title = document.createElement('strong');
  title.textContent = it.uses ? it.name : countLabel(kind, n);
  const detail = document.createElement('small');
  detail.textContent = fit < 1 ? takeWhy(kind) : `In the ${storeNoun()} · ${it.uses ? usesWord(s.left) : `Weight ${fmt(it.weight * n)}`}`;
  const words = document.createElement('div');
  words.append(title, detail);
  const head = document.createElement('div');
  head.className = 'info-head';
  head.append(words, smallButton(n > 1 ? (fit >= n || fit < 1 ? 'Take all' : `Take ${fit}`) : 'Take', () => takeOut(s, n), true, fit < 1));
  const parts = [head];
  const about = itemAbout(kind);
  if (about) { const p = document.createElement('p'); p.className = 'info-about'; p.textContent = about; parts.push(p); }
  if (n > 1 && fit > 0) { const acts = document.createElement('div'); acts.className = 'info-acts'; acts.appendChild(smallButton('Take 1', () => takeOut(s, 1))); parts.push(acts); }
  box.replaceChildren(...parts);
}

/* ---------- the craft mat, on the inventory's Recipes tab ----------
   The mat (0.1.8, Luke's idea) sits at the top of the Recipes tab with the list under it. Since 0.1.15 (Luke) it only shows
   a recipe tapped in the list: the Craft button, putting things on it by hand (tap or drag), Craft with › and the
   "Something's missing" and "Nothing happens" lines all went, as every recipe is listed anyway. The mat shows the tapped
   recipe's things, as many of each as you carry, and the rest faded (+n) with "Still need ..."; when they're all there,
   Make lights up and makes that recipe (never another one the part you have would make: Luke, 0.1.12, 2 stones for a
   campfire said sharp stone). Recipes lists every mat recipe: the ones you have everything for first, the rest greyed
   out (Luke, 0.1.12). What you've made (found: the server keeps p.found, and your next person keeps it too) only says
   "Your first one!". A recipe's "keeps" are tools it needs but doesn't use up, like the sharp stone. Nothing leaves your
   inventory until you Make. Food is made at stations, never on the mat (Luke, 0.1.9), so Recipes lists mat recipes only. */
let onTheMat = {}; // what the mat shows: kind -> how many (fitMat works it out from the recipe tapped and what you carry)
let matGoal = null; // the recipe tapped in Recipes, or null (an empty mat)
let matNew = null; // just made for the first time: { id, until } (the mat shows it for a moment)
let foundGroup = null, foundQuery = ''; // the Recipes list's button picked (null: All) and what's typed in its search
export const craftOpen = () => bagOpen() && bagTab === 'recipes';
export const recipeName = (r) => r.name || ITEMS[Object.keys(r.makes)[0]].name;
export const madeBy = (r) => Object.keys(r.makes)[0];
const recipeFound = (r) => (you.found || []).includes(r.id);
// known: found, or made at a station like a campfire (cooking: the raw food says so, and the fire's menu lists it)
export const recipeKnown = (r) => recipeFound(r) || !!r.near;
const onMat = (kind) => onTheMat[kind] || 0;
const matGoalRecipe = () => (matGoal && RECIPES.find((x) => x.id === matGoal)) || null;
// the mat: as many of each of the tapped recipe's things as you carry. Worked out on every draw, so it keeps up as things
// get picked up, eaten, dropped or used (and when the admin changes the recipe)
function fitMat() {
  const goal = matGoalRecipe();
  onTheMat = {};
  if (goal) for (const [k, n] of Object.entries(recipeWants(goal))) { const have = Math.min(n, (you.carry && you.carry[k]) || 0); if (have > 0) onTheMat[k] = have; }
}
// what Make would make: the tapped recipe, once all of it is there (not one made at a station, like cooked fish: the mat
// says where to make it, and Make stays off)
const matMakes = () => { const goal = matGoalRecipe(); return goal && !goal.near && matIs(onTheMat, goal) ? goal : null; };
function clearMat() { matGoal = null; matNew = null; drawBag(); }
// a recipe tapped in Recipes (greyed out or not): the mat shows it
function fillMat(r) {
  matGoal = r.id; matNew = null;
  drawBag();
  $('mat').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// you carry everything the recipe takes, kept tools too (Recipes greys out the ones you don't: Luke, 0.1.12)
const hasAll = (r) => Object.entries(recipeWants(r)).every(([k, n]) => (you.carry[k] || 0) >= n);
// what you'd carry after making it: tried on what you carry now, then put back (a tool it makes goes on the tool bar if
// there's room, so it weighs nothing: the same as the server, needs.js craft). w: the weight, sq: the squares (0.2.1)
function afterMaking(r) {
  const was = { carry: { ...you.carry }, bar: { ...you.bar }, wear: { ...you.wear }, lastKind: you.lastKind }, sq0 = squaresTaken();
  for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
  for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
  const out = { w: carried(), sq: squaresTaken(), sq0 };
  Object.assign(you, was);
  return out;
}
// why a recipe can't be made right now ('' if it can): things missing, too heavy, no square for it, or not by what it needs
export function cantMake(r) {
  if (!hasAll(r)) return 'Need more';
  const off = Object.keys(r.keeps || {}).find((k) => ITEMS[k].uses && !hasTool(k)); // a tool it keeps is used: it has to be on the tool bar (0.2.4)
  if (off) return toolWhy(off);
  const a = afterMaking(r);
  if (a.w > SETTINGS.carryCapacity) return 'Too heavy';
  if (a.sq > invSquares() && a.sq > a.sq0) return FULL; // (0.2.1: someone over already can still make what fits)
  if (r.near && !game.stationNear(r.near)) return 'Not here';
  return '';
}
const canMake = (r) => !cantMake(r);
// the mat makes everything but the ones made at a station, like cooking at a campfire (Luke, 0.1.9). Recipes lists those
// too since 0.1.20 (Luke: Food "not hidden"), marked "At a campfire", and the mat says where to make it.
const stationWords = (r) => { const P = game.PLACEABLES[r.near]; return P ? `${P.craftLabel || 'Make'} it at a${P.fire ? ' lit' : ''} ${P.name.toLowerCase()}` : ''; }; // "Cook it at a lit campfire"
// a recipe with "seconds" (cooking) takes that long, and uses its things up when it finishes (if it still can be made).
// What it keeps (a sharp stone) stays. The first time you make one it's found: the mat says "Your first one!".
export function make(r) {
  if (!canMake(r)) return;
  const finish = () => {
    if (!canMake(r)) return;
    spendEnergy('craft');
    for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
    for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
    game.sendAct({ t: 'craft', id: r.id });
    const fresh = !recipeFound(r);
    if (fresh) { you.found = [...(you.found || []), r.id]; matNew = { id: r.id, until: Date.now() + 3500 }; setTimeout(() => { if (craftOpen()) drawBag(); }, 3600); }
    if (bagOpen()) drawBag();
    drawHeld();
    drawCarry();
    showGain(`Made ${fresh ? 'your first ' : ''}${recipeName(r).toLowerCase()}`);
  };
  if (r.seconds) { game.startAction({ pose: 'kneel', seconds: r.seconds, end: finish }); return; }
  game.startAction({ pose: 'kneel', seconds: 1.6 });
  finish();
}
function matTile(kind, n, need) { // a thing on the mat, or one the recipe still needs (faded, +n). Just to look at
  const b = document.createElement('span');
  b.className = 'bag-tile mat-tile' + (need ? ' need' : '');
  b.dataset.kind = kind;
  b.setAttribute('role', 'img');
  b.setAttribute('aria-label', need ? `Still need ${countLabel(kind, n).toLowerCase()}` : `${countLabel(kind, n)} on the mat`);
  b.appendChild(itemPic(kind));
  const c = document.createElement('span');
  c.className = 'count';
  c.textContent = need ? `+${n}` : n > 1 ? n : '';
  if (c.textContent) b.appendChild(c);
  return b;
}
const listWords = (things) => things.map(([k, n]) => countLabel(k, n).toLowerCase()).join(', ');
let craftDrawn = ''; // what the mat shows now (only redrawn when it changes)
function drawMat() {
  fitMat();
  const r = matMakes(), goal = matGoalRecipe(), now = Date.now();
  const fresh = matNew && matNew.until > now ? RECIPES.find((x) => x.id === matNew.id) || null : null;
  const missing = goal && !r ? Object.entries(recipeWants(goal)).map(([k, n]) => [k, n - onMat(k)]).filter(([, n]) => n > 0) : [];
  let pic = '', name = '', why = '', go = false, state = '';
  if (fresh) { pic = madeBy(fresh); name = recipeName(fresh); why = 'Your first one!'; state = 'new'; go = !!r && !cantMake(r); } // (enough for another: Make stays lit)
  else if (r) { // all there: what it makes, made before or not (no mystery: Luke, 0.1.10)
    const cant = cantMake(r);
    pic = madeBy(r); name = recipeName(r);
    why = cant === 'Too heavy' ? 'Too heavy to carry' : cant === FULL || /^Equip /.test(cant) ? cant : r.about || '';
    go = !cant; state = 'match';
  } else if (goal) { // the things it takes, and what's still missing; made at a station: where (the mat can't make it)
    pic = madeBy(goal); name = recipeName(goal); state = 'goal';
    const at = goal.near ? stationWords(goal) : ''; // "Still need 1 fish, then cook it at a lit campfire"
    why = missing.length ? `Still need ${listWords(missing)}${at ? `, then ${at.charAt(0).toLowerCase()}${at.slice(1)}` : ''}` : at;
  }
  const shows = JSON.stringify([onTheMat, missing, pic, name, why, go, state, (you.found || []).length]);
  if (shows === craftDrawn) return;
  craftDrawn = shows;
  const tiles = [...Object.entries(onTheMat).map(([k, n]) => matTile(k, n, false)), ...missing.map(([k, n]) => matTile(k, n, true))]
    .map((b) => { const li = document.createElement('li'); li.appendChild(b); return li; });
  $('matList').replaceChildren(...tiles);
  $('matEmpty').hidden = tiles.length > 0;
  $('matEmpty').textContent = `Tap a recipe to put its things here${(you.found || []).length ? '' : '. Try a sharp stone first'}`; // (a tip until you first make something)
  $('matSpot').classList.toggle('match', state === 'match' || state === 'new');
  const out = $('matPic');
  out.className = `mat-pic${state ? ` ${state}` : ''}`;
  if (!pic) out.replaceChildren();
  else out.replaceChildren(itemPic(pic));
  $('matOut').hidden = !name; // (an empty mat just says what to do)
  $('matName').textContent = name;
  $('matWhy').textContent = why;
  $('matWhy').hidden = !why;
  $('matClear').hidden = !tiles.length;
  $('matMake').disabled = !go;
}
// the Recipes list: every recipe under its heading (Materials, Parts, Tools, Food...: itemGroups in game-data.json, 0.1.20).
// The ones you have everything for come first, with what they use; the rest are greyed out, just a picture and a name
// (Luke, 0.1.10; greyed by what you carry, not by what you've made, since 0.1.12). Each part goes simple to advanced (Luke,
// 0.1.20: by how many steps it is from things found lying about). Tap any one to put its things on the mat, as many as it
// takes (what you don't have shows faded).
const CRAFT_GROUPS = GROUPS; // items.js
export const recipeGroup = (r) => (r.group && CRAFT_GROUPS.includes(r.group) ? r.group : groupOf(ITEMS[madeBy(r)]));
const groupOrder = (g) => (CRAFT_GROUPS.includes(g) ? CRAFT_GROUPS.indexOf(g) : CRAFT_GROUPS.length);
// how many steps a thing is from what's found lying about (0: no recipe makes it): a sharp stone 1, a stone axe 3
const STEPS = {};
function stepsOf(kind, seen = new Set()) {
  if (kind in STEPS) return STEPS[kind];
  if ((ITEMS[kind] || {}).startInWorld > 0) return (STEPS[kind] = 0); // found lying about, even if a recipe makes it too (sticks from a log, 0.2.6)
  if (seen.has(kind)) return 0;
  seen.add(kind);
  const r = RECIPES.find((x) => madeBy(x) === kind);
  STEPS[kind] = r ? 1 + Math.max(0, ...Object.keys(recipeWants(r)).map((k) => stepsOf(k, seen))) : 0;
  return STEPS[kind];
}
// a recipe's own steps: one more than what it takes (the same as what it makes, but for sticks, which lie about too but
// need a knife to cut from a log: 3, not 0)
const recipeSteps = (r) => 1 + Math.max(0, ...Object.keys(recipeWants(r)).map((k) => stepsOf(k)));
let foundDrawn = '';
function foundRow(r) {
  const has = hasAll(r);
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'found-row' + (has ? '' : ' missing');
  b.dataset.recipe = r.id;
  b.setAttribute('aria-label', `${recipeName(r)}${has ? '' : ", you don't have everything for it yet"}: put its things on the mat`);
  const words = document.createElement('span');
  words.className = 'found-words';
  const title = document.createElement('strong');
  title.textContent = recipeName(r);
  words.appendChild(title);
  if (has) {
    const needs = document.createElement('span');
    needs.className = 'craft-needs';
    const chip = (text, ok) => { const c = document.createElement('span'); c.className = 'need-chip' + (ok ? ' ok' : ''); c.textContent = text; needs.appendChild(c); };
    for (const [k, n] of Object.entries(r.needs)) { const have = you.carry[k] || 0; chip(`${ITEMS[k].plural} ${Math.min(have, n)}/${n}`, have >= n); }
    for (const k of Object.keys(r.keeps || {})) { // what it keeps: a tool takes a use, from the tool bar (0.2.4, Luke)
      if (ITEMS[k].uses) chip(`${ITEMS[k].name} (1 use)`, hasTool(k)); else chip(`Keeps ${ITEMS[k].name.toLowerCase()}`, (you.carry[k] || 0) >= r.keeps[k]);
    }
    if (r.near && game.PLACEABLES[r.near]) chip(`At a ${game.PLACEABLES[r.near].name.toLowerCase()}`, !!game.stationNear(r.near)); // (made there, not on the mat)
    words.appendChild(needs);
  }
  b.append(itemPic(madeBy(r)), words);
  b.addEventListener('click', () => fillMat(r));
  li.appendChild(b);
  return li;
}
function drawFound() {
  const all = RECIPES; // (the ones made at a station too, like cooked fish at a campfire)
  const groups = [...new Set(all.map(recipeGroup))].sort((a, b) => groupOrder(a) - groupOrder(b));
  const chips = groups.length > 1, search = all.length >= (SETTINGS.craftSearchFrom || 15);
  if (!chips || !groups.includes(foundGroup)) foundGroup = null;
  if (!search) foundQuery = '';
  const q = foundQuery.trim().toLowerCase();
  const list = all.filter((r) => (!foundGroup || recipeGroup(r) === foundGroup)
    && (!q || [recipeName(r), ...Object.keys(recipeWants(r)).map((k) => ITEMS[k].plural)].some((t) => t.toLowerCase().includes(q))));
  list.sort((a, b) => (hasAll(a) ? 0 : 1) - (hasAll(b) ? 0 : 1) || recipeSteps(a) - recipeSteps(b) || RECIPES.indexOf(a) - RECIPES.indexOf(b)); // the ones you have everything for first, then the greyed out ones, each simple to advanced
  const grey = list.filter((r) => !hasAll(r)).length;
  const shows = JSON.stringify([foundGroup, q, chips, search, list.map((r) => [r.id, hasAll(r), recipeWants(r), Object.keys(recipeWants(r)).map((k) => you.carry[k] || 0), r.near ? !!game.stationNear(r.near) : 0])]); // (the "At a campfire" chip lights up by a lit one)
  if (shows === foundDrawn) return;
  foundDrawn = shows;
  $('foundSearch').hidden = !search;
  if (search) $('foundQuery').placeholder = `Search ${all.length} recipes`;
  $('foundChips').hidden = !chips;
  if (chips) {
    const chip = (label, g, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'craft-chip' + (foundGroup === g ? ' on' : '');
      b.setAttribute('aria-pressed', String(foundGroup === g));
      b.textContent = `${label} ${n}`;
      b.addEventListener('click', () => { foundGroup = g; drawFound(); });
      return b;
    };
    $('foundChips').replaceChildren(chip('All', null, all.length), ...groups.map((g) => chip(g, g, all.filter((r) => recipeGroup(r) === g).length)));
    // the picked one stays in sight in the sliding row (say Misc, picked last time, when the Recipes tab opens again)
    const row = $('foundChips').getBoundingClientRect(), on = $('foundChips').querySelector('.on').getBoundingClientRect();
    if (on.left < row.left) $('foundChips').scrollLeft -= row.left - on.left + 12;
    else if (on.right > row.right) $('foundChips').scrollLeft += on.right - row.right + 12;
  } else $('foundChips').replaceChildren();
  $('foundMore').hidden = !grey; // (nothing greyed out: nothing to explain)
  $('foundMore').textContent = "Greyed out means you don't have everything for it yet. Tap one to see what it needs";
  if (q && !list.length) { const li = document.createElement('li'); li.className = 'found-none'; li.textContent = 'No recipes match'; $('foundList').replaceChildren(li); return; }
  $('foundList').replaceChildren(...list.map(foundRow));
}
export const drawCraft = () => drawBag(); // (other parts call this when what you carry changes)
function showBagTab(tab) {
  bagTab = tab === 'recipes' ? 'recipes' : 'bag';
  bagPick = null; bagDrawn = ''; craftDrawn = ''; foundDrawn = '';
  drawBag();
}
$('bagTabBag').addEventListener('click', () => showBagTab('bag'));
$('bagTabRecipes').addEventListener('click', () => showBagTab('recipes'));
$('matClear').addEventListener('click', clearMat);
$('matMake').addEventListener('click', () => { const r = matMakes(); if (r && canMake(r)) make(r); });
$('foundQuery').addEventListener('input', (e) => { foundQuery = e.target.value; drawFound(); });
export function closeCraft() { if (craftOpen()) closeBag(); }
// the inventory opens on its Inventory tab, with nothing on the mat
function openBag(tab) {
  matGoal = null; matNew = null;
  showBagTab(tab);
  $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); tipDid('bag'); hideHint();
}
export function closeBag() {
  storeId = null; // (a crate's squares go with it, 0.2.2)
  $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false');
  bagTab = 'bag'; matGoal = null; matNew = null; foundQuery = ''; $('foundQuery').value = '';
}
$('bagBtn').addEventListener('click', () => (bagOpen() ? closeBag() : openBag()));
$('bagClose').addEventListener('click', closeBag);
