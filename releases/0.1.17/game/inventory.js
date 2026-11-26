/* ---------- little pictures of things, for the inventory and craft lists ----------
   Drawn once from the real 3D models with a small separate renderer, then that renderer is let go. */
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
function itemPic(kind) {
  makeItemIcons();
  const url = itemIcons.get(kind);
  if (url) { const img = document.createElement('img'); img.className = 'pic'; img.src = url; img.alt = ''; return img; }
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = ITEMS[kind].look.head || ITEMS[kind].look.colour || '#9a948a';
  return dot;
}

/* ---------- your inventory: a grid of what you carry; tap one to see what it is and what you can do with it ---------- */
const bagOpen = () => $('bag').classList.contains('open');
const BAG_COLS = 5, BAG_MIN = 10; // at least two rows of slots, so the sheet keeps its size
let bagPick = null; // the tile tapped in the grid (kind:number; its info shows under it), or null
function smallButton(text, onClick, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'small-btn' + (primary ? ' go' : '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
// food first, then tools, then things you place, then everything else, each in game-data.json order
const ITEM_ORDER = Object.keys(ITEMS);
const bagGroup = (it) => (Object.keys(it.eat || {}).length ? 0 : it.uses ? 1 : it.places ? 2 : 3);
const bagKinds = () => Object.keys(you.carry).filter((k) => ITEMS[k] && you.carry[k] > 0)
  .sort((a, b) => bagGroup(ITEMS[a]) - bagGroup(ITEMS[b]) || ITEM_ORDER.indexOf(a) - ITEM_ORDER.indexOf(b));
// a line about it: its own "about" in game-data.json, else the about of the recipe that makes it
const itemAbout = (kind) => { const a = ITEMS[kind].about || (RECIPES.find((r) => r.makes[kind]) || {}).about || ''; return a && !/[.!?]$/.test(a) ? `${a}.` : a; }; // (a recipe's line has no full stop)
// a tool's uses left, one per tool you carry, the one in use first (the server sends a list; before 0.2.6 one number)
function wearList(kind) {
  const n = you.carry[kind] || 0, w = you.wear[kind];
  const list = (Array.isArray(w) ? w : w != null ? [w] : []).slice(0, n);
  while (list.length < n) list.push(ITEMS[kind].uses);
  return list;
}
// what the grid shows: a tile for each kind, but each tool gets its own (Luke's pick), with its own wear. Tools on the
// tool bar (0.1.17) aren't in the grid: they're the first of each tool's wear list, so the grid's start after them.
// Each can be dropped, and keeps its wear on the ground. i: the tool's place in its wear list (which one, to the server).
function bagSlots() {
  const out = [];
  for (const kind of bagKinds()) {
    const n = you.carry[kind], it = ITEMS[kind];
    if (!it.uses) { out.push({ kind, key: `${kind}:0`, n }); continue; }
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
  b.setAttribute('aria-label', (it.uses ? `${it.name}, ${s.bar ? (s.spare ? `spare, ${s.left} uses` : usesWord(s.left)) : `in your inventory, ${usesWord(s.left)}`}` : countLabel(s.kind, s.n)));
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
  sendAct({ t: 'equip', kind: s.kind, which: s.i, ...(off ? { out: { kind: off.kind, which: off.i } } : {}) });
  bagPick = null;
  drawCarry();
}
function unequipTool(s) {
  if (ui.mode !== 'world' || !player || you.dead || !s || !s.bar || !hasTool(s.kind)) return;
  if (carried() + ITEMS[s.kind].weight > SETTINGS.carryCapacity) { showTag('Too heavy to carry', headTop(), 2.5); return; }
  const b = onBar(s.kind);
  shiftTool(s.kind, s.i, b - 1);
  if (b > 1) you.bar[s.kind] = b - 1; else delete you.bar[s.kind];
  sendAct({ t: 'unequip', kind: s.kind, which: s.i });
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
    const x0 = e.clientX, y0 = e.clientY, touch = e.pointerType !== 'mouse', tool = !!ITEMS[s.kind].uses;
    let ghost = null, timer = null, over = false;
    const start = () => {
      clearTimeout(timer);
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.appendChild(itemPic(s.kind));
      document.body.appendChild(ghost);
      $('bag').classList.add(tool ? 'dragging-tool' : 'dragging'); // a tool: the inventory stays, to drop it on or off the tool bar (0.1.17)
      if (tool) $(s.bar ? 'bagList' : 'toolBar').classList.add('drop-on');
      bagDragging = true;
      dragPoint = { x: e.clientX, y: e.clientY, armed: false };
      move(e);
    };
    const move = (m) => {
      if (!ghost) return;
      ghost.style.transform = `translate(${m.clientX - 28}px, ${m.clientY - 28}px)`;
      if (dragPoint) { dragPoint.x = m.clientX; dragPoint.y = m.clientY; dragPoint.inSheet = tool && pointIn($('bag'), m); } // (the view doesn't slide while over the inventory)
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
      $('toolBar').classList.remove('drop-on'); $('bagList').classList.remove('drop-on');
      bagDragging = false;
      dragPoint = null;
      bagDragged = Date.now();
      if (m && !over) { if (tool && bagOpen() && pointIn($('bag'), m)) toolDropAt(s, m); else bagDropAt(s, m); }
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
function bagDropAt(s, e, loose) {
  const kind = s.kind, it = ITEMS[kind];
  if (ui.mode !== 'world' || !player || you.dead || (!loose && !you.carry[kind])) return;
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return; // let go off the world: nothing
  const t = pickTarget(...toCanvas(e));
  const say = (text) => showTag(text, headTop(), 2);
  const pick = () => {
    if (!loose) return true;
    queueTask({ type: 'pickup', id: loose.id });
    return allTasks().some((q) => q.type === 'pickup' && q.id === loose.id);
  };
  const then = (task) => { if (pick()) queueTask(loose ? { ...task, from: loose.id } : task); };
  if (t && t.kind === 'you') {
    if (loose) pick(); // (picks it up; eat it from the bag)
    else if (it.eat) eatOne(kind); else say(`Can't eat ${it.name.toLowerCase()}`);
    return;
  }
  if (t && t.kind === 'placed' && t.th.built) {
    const th = t.th, P = PLACEABLES[th.kind];
    if (P.fire && P.fire.fuels[kind]) {
      if (roomFor(th, kind) < 1) say('The fire is full'); else then({ type: 'tend', id: th.id, do: 'add', n: 1, fuel: kind });
      return;
    }
    const r2 = RECIPES.find((q) => q.near === th.kind && q.needs[kind] && recipeKnown(q));
    if (r2) {
      if (P.fire && !isLit(th)) { say('Light the fire first'); return; }
      const why = loose ? '' : cantMake(r2);
      if (why && why !== 'Not here') say(why); else then({ type: 'make', id: th.id, recipe: r2.id });
      return;
    }
    // (storage, later: a placed thing that holds items gets a "put in" task here)
  }
  ray.setFromCamera(ndc, camera);
  const gh = ray.intersectObject(terrain, false)[0]; // the ground under your finger (past grass, trees and the like)
  const at = t && t.kind === 'item' ? { x: t.item.x + 0.3, z: t.item.z + 0.3 } : t && t.kind === 'ground' ? { x: t.point.x, z: t.point.z }
    : gh && !['shore', 'use'].includes(t && t.kind) ? { x: gh.point.x, z: gh.point.z } : null;
  if (!at) { say("Can't put it there"); return; } // the pond, a bush
  if (!loose && spareInBag(kind) < 1) { say('Already in your task list'); return; } // every one you carry is already queued to go somewhere
  then({ type: 'drop', kind, n: 1, ...(!loose && it.uses ? { which: s.i } : {}), x: at.x, z: at.z });
}
// the bar under the grid: what it is, and what you can do with it (the main thing in green)
function drawBagInfo(s) {
  const box = $('bagInfo');
  box.hidden = !s;
  if (!s) { box.replaceChildren(); return; }
  const kind = s.kind, it = ITEMS[kind], n = s.n;
  const title = document.createElement('strong');
  title.textContent = it.uses ? it.name : countLabel(kind, n);
  const detail = document.createElement('small');
  detail.textContent = s.bar ? `On your tool bar · ${usesText(s)}` : `Weight ${fmt(it.weight * n)}${it.uses ? ` · ${usesWord(s.left)}` : ''}`; // (on the bar it weighs nothing)
  const words = document.createElement('div');
  words.append(title, detail);
  const head = document.createElement('div');
  head.className = 'info-head';
  head.appendChild(words);
  if (s.bar) head.appendChild(smallButton('Unequip', () => unequipTool(s))); // the tool bar (0.1.17): off it, into the inventory
  else if (it.uses) head.appendChild(smallButton('Equip', () => equipTool(s), true)); // onto the tool bar: only tools there get used
  else if (it.places) head.appendChild(smallButton('Place', () => startPlacing(kind), true)); // a campfire: choose where it goes
  else if (Object.keys(it.eat || {}).length) head.appendChild(smallButton('Eat', () => eatOne(kind), true));
  const parts = [head];
  const about = itemAbout(kind);
  if (about) { const p = document.createElement('p'); p.className = 'info-about'; p.textContent = about; parts.push(p); }
  const acts = document.createElement('div');
  acts.className = 'info-acts';
  acts.appendChild(smallButton(n > 1 ? 'Drop 1' : 'Drop', () => dropItems(kind, 1, it.uses ? s.i : undefined))); // a tool: this one
  if (n > 1) acts.appendChild(smallButton('Drop all', () => dropItems(kind, n)));
  parts.push(acts);
  box.replaceChildren(...parts);
}
let bagDrawn = ''; // what the grid shows now: it's only redrawn when that changes, so a tap in progress isn't lost
// the inventory's two tabs at the top (Luke, 0.1.15: they replaced the Craft button): 'bag' (Inventory, your grid) or
// 'recipes' (Recipes: the craft mat with the list under it)
let bagTab = 'bag';
function drawBag() {
  you.bar = tidyBar(you.bar, you.carry, ITEMS, toolSlots()); // (in step with what you carry, and the number of spots: a live setting)
  const w = carried(), crafting = bagTab === 'recipes';
  $('bagWeight').textContent = `${fmt(w)} / ${fmt(SETTINGS.carryCapacity)}`;
  drawWeightBar($('bagBar'), w);
  $('bag').classList.toggle('crafting', crafting);
  for (const [id, tab] of [['bagTabBag', 'bag'], ['bagTabRecipes', 'recipes']]) { $(id).classList.toggle('on', bagTab === tab); $(id).setAttribute('aria-pressed', String(bagTab === tab)); }
  $('bagPart').hidden = crafting;
  $('bagHeadWeight').hidden = crafting; // (the weight sits in the header on the Inventory tab, 0.1.17)
  $('mat').hidden = !crafting;
  $('found').hidden = !crafting;
  if (crafting) { drawMat(); drawFound(); }
  const slots = bagSlots(), tools = barSlots(), spots = toolSlots();
  const picked = [...tools, ...slots].find((s) => s.key === bagPick) || null;
  if (!picked) bagPick = null;
  const shows = JSON.stringify([slots.map((s) => [s.key, s.n, s.left || 0]), tools.map((s) => [s.key, s.left, s.spares]), spots, bagPick]);
  if (shows === bagDrawn) return;
  bagDrawn = shows;
  $('bagEmpty').hidden = slots.length + tools.length > 0;
  const cells = slots.map((s) => { const li = document.createElement('li'); li.appendChild(bagTile(s)); return li; });
  const total = Math.max(BAG_MIN, Math.ceil(slots.length / BAG_COLS) * BAG_COLS);
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
const craftOpen = () => bagOpen() && bagTab === 'recipes';
const recipeName = (r) => r.name || ITEMS[Object.keys(r.makes)[0]].name;
const madeBy = (r) => Object.keys(r.makes)[0];
const recipeFound = (r) => (you.found || []).includes(r.id);
// known: found, or made at a station like a campfire (cooking: the raw food says so, and the fire's menu lists it)
const recipeKnown = (r) => recipeFound(r) || !!r.near;
const onMat = (kind) => onTheMat[kind] || 0;
const matGoalRecipe = () => (matGoal && RECIPES.find((x) => x.id === matGoal)) || null;
// the mat: as many of each of the tapped recipe's things as you carry. Worked out on every draw, so it keeps up as things
// get picked up, eaten, dropped or used (and when the admin changes the recipe)
function fitMat() {
  const goal = matGoalRecipe();
  onTheMat = {};
  if (goal) for (const [k, n] of Object.entries(recipeWants(goal))) { const have = Math.min(n, (you.carry && you.carry[k]) || 0); if (have > 0) onTheMat[k] = have; }
}
// what Make would make: the tapped recipe, once all of it is there
const matMakes = () => { const goal = matGoalRecipe(); return goal && matIs(onTheMat, goal) ? goal : null; };
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
// there's room, so it weighs nothing: the same as the server, needs.js craft)
function weightAfter(r) {
  const was = { carry: { ...you.carry }, bar: { ...you.bar }, wear: { ...you.wear }, lastKind: you.lastKind };
  for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
  for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
  const w = carried();
  Object.assign(you, was);
  return w;
}
// why a recipe can't be made right now ('' if it can): things missing, too heavy, or not by what it needs
function cantMake(r) {
  if (!hasAll(r)) return 'Need more';
  if (weightAfter(r) > SETTINGS.carryCapacity) return 'Too heavy';
  if (r.near && !stationNear(r.near)) return 'Not here';
  return '';
}
const canMake = (r) => !cantMake(r);
// the recipes made on the mat (and listed in Recipes): not ones made at a station, like cooking at a campfire (Luke, 0.1.9)
const onMatRecipe = (r) => !r.near;
const MAT_RECIPES = RECIPES.filter(onMatRecipe);
// a recipe with "seconds" (cooking) takes that long, and uses its things up when it finishes (if it still can be made).
// What it keeps (a sharp stone) stays. The first time you make one it's found: the mat says "Your first one!".
function make(r) {
  if (!canMake(r)) return;
  const finish = () => {
    if (!canMake(r)) return;
    spendEnergy('craft');
    for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
    for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
    sendAct({ t: 'craft', id: r.id });
    const fresh = !recipeFound(r);
    if (fresh) { you.found = [...(you.found || []), r.id]; matNew = { id: r.id, until: Date.now() + 3500 }; setTimeout(() => { if (craftOpen()) drawBag(); }, 3600); }
    if (bagOpen()) drawBag();
    drawHeld();
    drawCarry();
    showGain(`Made ${fresh ? 'your first ' : ''}${recipeName(r).toLowerCase()}`);
  };
  if (r.seconds) { startAction({ pose: 'kneel', seconds: r.seconds, end: finish }); return; }
  startAction({ pose: 'kneel', seconds: 1.6 });
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
    why = cant === 'Too heavy' ? 'Too heavy to carry' : r.about || '';
    go = !cant; state = 'match';
  } else if (goal) { pic = madeBy(goal); name = recipeName(goal); why = missing.length ? `Still need ${listWords(missing)}` : ''; state = 'goal'; }
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
// the Recipes list: every mat recipe by kind (Tools, Food, Building...). The ones you have everything for come first, with
// what they use; the rest are greyed out, just a picture and a name (Luke, 0.1.10; greyed by what you carry, not by what
// you've made, since 0.1.12). Tap any one to put its things on the mat, as many as it takes (what you don't have shows faded).
const CRAFT_GROUPS = ITEM_GROUPS; // rules.js
const recipeGroup = (r) => r.group || itemGroupOf(ITEMS[madeBy(r)]);
const groupOrder = (g) => (CRAFT_GROUPS.includes(g) ? CRAFT_GROUPS.indexOf(g) : CRAFT_GROUPS.length);
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
    for (const k of Object.keys(r.keeps || {})) chip(`Keeps ${ITEMS[k].name.toLowerCase()}`, (you.carry[k] || 0) >= r.keeps[k]);
    words.appendChild(needs);
  }
  b.append(itemPic(madeBy(r)), words);
  b.addEventListener('click', () => fillMat(r));
  li.appendChild(b);
  return li;
}
function drawFound() {
  const all = MAT_RECIPES;
  const groups = [...new Set(all.map(recipeGroup))].sort((a, b) => groupOrder(a) - groupOrder(b));
  const chips = groups.length > 1, search = all.length >= (SETTINGS.craftSearchFrom || 15);
  if (!chips || !groups.includes(foundGroup)) foundGroup = null;
  if (!search) foundQuery = '';
  const q = foundQuery.trim().toLowerCase();
  const list = all.filter((r) => (!foundGroup || recipeGroup(r) === foundGroup)
    && (!q || [recipeName(r), ...Object.keys(recipeWants(r)).map((k) => ITEMS[k].plural)].some((t) => t.toLowerCase().includes(q))));
  list.sort((a, b) => (hasAll(a) ? 0 : 1) - (hasAll(b) ? 0 : 1)); // the ones you have everything for first, then the greyed out ones (each in game-data.json order)
  const grey = list.filter((r) => !hasAll(r)).length;
  const shows = JSON.stringify([foundGroup, q, chips, search, list.map((r) => [r.id, hasAll(r), recipeWants(r), Object.keys(recipeWants(r)).map((k) => you.carry[k] || 0)])]);
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
  } else $('foundChips').replaceChildren();
  $('foundMore').hidden = !grey; // (nothing greyed out: nothing to explain)
  $('foundMore').textContent = "Greyed out means you don't have everything for it yet. Tap one to see what it needs";
  if (q && !list.length) { const li = document.createElement('li'); li.className = 'found-none'; li.textContent = 'No recipes match'; $('foundList').replaceChildren(li); return; }
  $('foundList').replaceChildren(...list.map(foundRow));
}
const drawCraft = () => drawBag(); // (other parts call this when what you carry changes)
function showBagTab(tab) {
  bagTab = tab === 'recipes' ? 'recipes' : 'bag';
  bagPick = null; bagDrawn = ''; craftDrawn = ''; foundDrawn = '';
  drawBag();
}
$('bagTabBag').addEventListener('click', () => showBagTab('bag'));
$('bagTabRecipes').addEventListener('click', () => showBagTab('recipes'));
$('matClear').addEventListener('click', clearMat);
$('matMake').addEventListener('click', () => { const r = matMakes(); if (r && onMatRecipe(r) && canMake(r)) make(r); });
$('foundQuery').addEventListener('input', (e) => { foundQuery = e.target.value; drawFound(); });
function closeCraft() { if (craftOpen()) closeBag(); }
// the inventory opens on its Inventory tab, with nothing on the mat
function openBag(tab) {
  matGoal = null; matNew = null;
  showBagTab(tab);
  $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); tipDid('bag'); hideHint();
}
function closeBag() {
  $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false');
  bagTab = 'bag'; matGoal = null; matNew = null; foundQuery = ''; $('foundQuery').value = '';
}
$('bagBtn').addEventListener('click', () => (bagOpen() ? closeBag() : openBag()));
$('bagClose').addEventListener('click', closeBag);
