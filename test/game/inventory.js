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
// what the grid shows: a tile for each kind, but each tool gets its own (Luke's pick), with its own wear: the first
// of a kind is the one in use, the rest are spares. Each can be dropped, and keeps its wear on the ground.
// With the craft mat open, what's on the mat isn't shown here (it's still carried: it only leaves your bag on Make).
function bagSlots() {
  const out = [];
  for (const kind of bagKinds()) {
    const all = you.carry[kind], n = all - (matOn ? onMat(kind) : 0), it = ITEMS[kind];
    if (n <= 0) continue;
    if (!it.uses) { out.push({ kind, key: `${kind}:0`, n }); continue; }
    const worn = wearList(kind);
    for (let i = all - n; i < all; i++) out.push({ kind, key: `${kind}:${i}`, n: 1, i, spare: i > 0, spares: all - 1, left: worn[i] });
  }
  return out;
}
const usesText = (s) => (s.spare ? `spare · ${s.left} uses` : `${s.spares ? 'in use · ' : ''}${s.left} ${s.left === 1 ? 'use' : 'uses'} left`);
function bagTile(s) {
  const it = ITEMS[s.kind];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bag-tile' + (bagPick === s.key ? ' on' : '');
  b.dataset.kind = s.kind;
  b.dataset.key = s.key;
  b.setAttribute('aria-pressed', String(bagPick === s.key));
  b.setAttribute('aria-label', (it.uses ? `${it.name}, ${s.spare ? `spare, ${s.left} uses` : `${s.left} ${s.left === 1 ? 'use' : 'uses'} left`}` : countLabel(s.kind, s.n)) + (matOn ? ', tap to put one on the mat' : ''));
  b.appendChild(itemPic(s.kind));
  if (s.n > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = s.n; b.appendChild(c); }
  if (it.uses) { const w = document.createElement('span'); w.className = 'wear'; w.style.setProperty('--w', (s.left / it.uses).toFixed(2)); b.appendChild(w); }
  b.addEventListener('click', () => { // tap to show its info, tap again to hide it (crafting: tap puts one on the mat)
    if (Date.now() - bagDragged < 400) return;
    if (matOn) { putOnMat(s.kind); return; }
    bagPick = bagPick === s.key ? null : s.key;
    drawBag();
    const again = $('bagList').querySelector(`[data-key="${s.key}"]`);
    if (again) again.focus({ preventScroll: true });
  });
  bagDragOn(b, s);
  return b;
}
// dragging a tile out of the bag onto the world: your person eats it, a campfire takes fuel or cooks it, anywhere else drops
// one. The bag fades while you drag and comes back after. Mouse: drag after a few pixels. Touch: hold a moment first (so the
// grid can still scroll). With the craft mat open the bag stays: let go on the mat to put one there.
let bagDragged = 0; // when the last drag ended (the click after it is ignored)
const isOver = (el, e) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
function bagDragOn(b, s) {
  b.addEventListener('dragstart', (e) => e.preventDefault()); // the browser's own picture-drag would cancel ours
  b.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY, touch = e.pointerType !== 'mouse';
    let ghost = null, timer = null, over = false;
    const start = () => {
      clearTimeout(timer);
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.appendChild(itemPic(s.kind));
      document.body.appendChild(ghost);
      if (matOn) $('mat').classList.add('drop-here'); else $('bag').classList.add('dragging');
      bagDragging = true;
      dragPoint = { x: e.clientX, y: e.clientY, armed: false };
      move(e);
    };
    const move = (m) => {
      if (!ghost) return;
      ghost.style.transform = `translate(${m.clientX - 28}px, ${m.clientY - 28}px)`;
      if (dragPoint) { dragPoint.x = m.clientX; dragPoint.y = m.clientY; }
      if (matOn) $('matSpot').classList.toggle('over', isOver($('matSpot'), m));
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
      $('bag').classList.remove('dragging');
      $('mat').classList.remove('drop-here');
      $('matSpot').classList.remove('over');
      bagDragging = false;
      dragPoint = null;
      bagDragged = Date.now();
      const crafting = matOn;
      if (m && !over) {
        if (crafting && isOver($('matSpot'), m)) putOnMat(s.kind); // onto the mat
        else if (!(crafting && isOver($('bag'), m))) bagDropAt(s, m); // (let go somewhere else on the sheet: nothing)
      }
      if (!bagOpen()) openBag(crafting);
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
  detail.textContent = `Weight ${fmt(it.weight * n)}${it.uses ? ` · ${usesText(s)}` : ''}`;
  const words = document.createElement('div');
  words.append(title, detail);
  const head = document.createElement('div');
  head.className = 'info-head';
  head.appendChild(words);
  if (it.places) head.appendChild(smallButton('Place', () => startPlacing(kind), true)); // a campfire: choose where it goes
  else if (Object.keys(it.eat || {}).length) head.appendChild(smallButton('Eat', () => eatOne(kind), true));
  const parts = [head];
  const about = itemAbout(kind);
  if (about) { const p = document.createElement('p'); p.className = 'info-about'; p.textContent = about; parts.push(p); }
  const acts = document.createElement('div');
  acts.className = 'info-acts';
  acts.appendChild(smallButton(n > 1 ? 'Drop 1' : 'Drop', () => dropItems(kind, 1, it.uses ? s.i : undefined))); // a tool: this one
  if (n > 1) acts.appendChild(smallButton('Drop all', () => dropItems(kind, n)));
  acts.appendChild(smallButton('Craft with ›', () => openCraft(kind))); // the craft mat, with one of these on it
  parts.push(acts);
  box.replaceChildren(...parts);
}
let bagDrawn = ''; // what the grid shows now: it's only redrawn when that changes, so a tap in progress isn't lost
function drawBag() {
  fitMat();
  const w = carried();
  $('bagWeight').textContent = `${fmt(w)} / ${fmt(SETTINGS.carryCapacity)}`;
  drawWeightBar($('bagBar'), w);
  $('bag').classList.toggle('crafting', matOn);
  $('mat').hidden = !matOn;
  $('bagCraft').classList.toggle('on', matOn);
  $('bagCraft').setAttribute('aria-pressed', String(matOn));
  $('craftBtn').setAttribute('aria-expanded', String(craftOpen()));
  $('bagPart').hidden = matOn && matTab !== 'bag';
  $('found').hidden = !matOn || matTab !== 'found';
  if (matOn) { drawMat(); if (matTab === 'found') drawFound(); }
  const slots = bagSlots();
  const picked = matOn ? null : slots.find((s) => s.key === bagPick) || null;
  if (!picked) bagPick = null;
  const shows = JSON.stringify([matOn, slots.map((s) => [s.key, s.n, s.left || 0, s.spares || 0]), bagPick]);
  if (shows === bagDrawn) return;
  bagDrawn = shows;
  $('bagEmpty').hidden = slots.length > 0 || (matOn && matCount() > 0); // (crafting with everything on the mat: not empty)
  const cells = slots.map((s) => { const li = document.createElement('li'); li.appendChild(bagTile(s)); return li; });
  const total = Math.max(BAG_MIN, Math.ceil(slots.length / BAG_COLS) * BAG_COLS);
  while (cells.length < total) { const li = document.createElement('li'); li.className = 'bag-slot'; li.setAttribute('aria-hidden', 'true'); cells.push(li); }
  $('bagList').replaceChildren(...cells);
  drawBagInfo(picked);
}

/* ---------- the craft mat (0.1.8, Luke's idea): put things together and see what they make ----------
   Craft (the hammer, or Craft in the inventory) shows the mat above your bag. Tap a thing in your bag, or drag it, to put
   one on the mat; tap it on the mat to take it back. When what's on the mat is exactly a recipe's things (matIs in
   rules.js), Make lights up. One you've never made shows as "Something new" until you make it; then it's in your Found
   list (the server keeps p.found, and your next person keeps them too). Under the mat: your Bag, or Found, where tapping a
   recipe puts its things on the mat (what's missing shows faded). A recipe's "keeps" are tools it needs on the mat but
   doesn't use up, like the sharp stone. Nothing on the mat leaves your bag until you Make. */
let matOn = false; // the inventory is showing the craft mat
let onTheMat = {}; // what's on the mat: kind -> how many (never more than you carry: fitMat)
let matGoal = null; // the found recipe tapped to fill the mat (its missing things show faded), or null
let matTab = 'bag'; // under the mat: 'bag' or 'found'
let matNew = null; // just discovered: { id, until } (the mat shows it for a moment)
let foundGroup = null, foundQuery = ''; // the Found list's button picked (null: All) and what's typed in its search
const craftOpen = () => bagOpen() && matOn;
const recipeName = (r) => r.name || ITEMS[Object.keys(r.makes)[0]].name;
const madeBy = (r) => Object.keys(r.makes)[0];
const recipeFound = (r) => (you.found || []).includes(r.id);
// known: found, or made at a station like a campfire (cooking: the raw food says so, and the fire's menu lists it)
const recipeKnown = (r) => recipeFound(r) || !!r.near;
const onMat = (kind) => onTheMat[kind] || 0;
const matCount = () => Object.values(onTheMat).reduce((a, n) => a + n, 0);
function fitMat() { // things get eaten, dropped or used while the mat is open
  for (const k of Object.keys(onTheMat)) { onTheMat[k] = Math.min(onTheMat[k], (you.carry && you.carry[k]) || 0); if (!(onTheMat[k] > 0)) delete onTheMat[k]; }
}
const matRecipe = () => (matCount() ? RECIPES.find((r) => matIs(onTheMat, r)) || null : null);
function putOnMat(kind) {
  fitMat();
  if (!ITEMS[kind] || (you.carry[kind] || 0) - onMat(kind) < 1) return false;
  onTheMat[kind] = onMat(kind) + 1;
  matGoal = null; matNew = null;
  drawBag();
  return true;
}
function takeOffMat(kind) {
  if (!onMat(kind)) return;
  if (--onTheMat[kind] < 1) delete onTheMat[kind];
  matGoal = null; matNew = null;
  drawBag();
}
function clearMat() { onTheMat = {}; matGoal = null; matNew = null; drawBag(); }
// a found recipe tapped: its things go on the mat, as many as you have
function fillMat(r) {
  onTheMat = {};
  for (const [k, n] of Object.entries(recipeWants(r))) { const have = Math.min(n, you.carry[k] || 0); if (have > 0) onTheMat[k] = have; }
  matGoal = r.id; matNew = null;
  drawBag();
  $('mat').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// why a recipe can't be made right now ('' if it can): things missing, too heavy, or not by what it needs
function cantMake(r) {
  for (const [k, n] of Object.entries(recipeWants(r))) if ((you.carry[k] || 0) < n) return 'Need more';
  if (carried() - weightOf(r.needs) + weightOf(r.makes) > SETTINGS.carryCapacity) return 'Too heavy';
  if (r.near && !stationNear(r.near)) return 'Not here';
  return '';
}
const canMake = (r) => !cantMake(r);
const stationWords = (r) => { const P = PLACEABLES[r.near]; return P ? `${P.craftLabel || 'Make'} it by a ${P.fire ? 'lit ' : ''}${P.name.toLowerCase()}` : 'Not here'; };
// a recipe with "seconds" (cooking) takes that long, and uses its things up when it finishes (if it still can be made).
// What it keeps (a sharp stone) stays. The first time you make one, it's a discovery: it goes in your Found list.
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
    showGain(`${fresh ? 'Discovered' : 'Made'} ${recipeName(r).toLowerCase()}`);
  };
  if (r.seconds) { startAction({ pose: 'kneel', seconds: r.seconds, end: finish }); return; }
  startAction({ pose: 'kneel', seconds: 1.6 });
  finish();
}
function matTile(kind, n, need) { // a thing on the mat (tap: take one off), or one a found recipe still needs (faded)
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bag-tile mat-tile' + (need ? ' need' : '');
  b.dataset.kind = kind;
  b.setAttribute('aria-label', need ? `Still need ${countLabel(kind, n).toLowerCase()}` : `${countLabel(kind, n)} on the mat, tap to take one off`);
  b.appendChild(itemPic(kind));
  const c = document.createElement('span');
  c.className = 'count';
  c.textContent = need ? `+${n}` : n > 1 ? n : '';
  if (c.textContent) b.appendChild(c);
  if (need) b.disabled = true; else b.addEventListener('click', () => takeOffMat(kind));
  return b;
}
const listWords = (things) => things.map(([k, n]) => countLabel(k, n).toLowerCase()).join(', ');
let craftDrawn = ''; // what the mat and Found show now (only redrawn when it changes)
function drawMat() {
  const r = matRecipe(), goal = matGoal ? RECIPES.find((x) => x.id === matGoal) || null : null, now = Date.now();
  const fresh = matNew && matNew.until > now ? RECIPES.find((x) => x.id === matNew.id) || null : null;
  const missing = goal && !r ? Object.entries(recipeWants(goal)).map(([k, n]) => [k, n - onMat(k)]).filter(([, n]) => n > 0) : [];
  let pic = '', name = '', why = '', go = false, state = '';
  if (fresh) { pic = madeBy(fresh); name = recipeName(fresh); why = "New! It's in your Found list now"; state = 'new'; go = !!r && !cantMake(r); } // (enough for another: Make stays lit)
  else if (r) {
    const known = recipeKnown(r), cant = cantMake(r);
    pic = known ? madeBy(r) : '?';
    name = known ? recipeName(r) : 'Something new';
    why = cant === 'Too heavy' ? 'Too heavy to carry' : cant === 'Not here' ? stationWords(r) : known ? r.about || '' : 'Make it to find out what it is';
    go = !cant; state = 'match';
  } else if (goal) { pic = madeBy(goal); name = recipeName(goal); why = `Still need ${listWords(missing)}`; state = 'goal'; }
  else if (matCount()) {
    const part = RECIPES.some((x) => matPartOf(onTheMat, x));
    name = part ? "Something's missing" : 'Nothing happens';
    why = part ? 'These go with something else' : "These don't make anything together";
  }
  const shows = JSON.stringify([onTheMat, missing, pic, name, why, go, state, matTab, (you.found || []).length]);
  if (shows === craftDrawn) return;
  craftDrawn = shows;
  const tiles = [...Object.entries(onTheMat).map(([k, n]) => matTile(k, n, false)), ...missing.map(([k, n]) => matTile(k, n, true))]
    .map((b) => { const li = document.createElement('li'); li.appendChild(b); return li; });
  $('matList').replaceChildren(...tiles);
  $('matEmpty').hidden = tiles.length > 0;
  $('matSpot').classList.toggle('match', state === 'match' || state === 'new');
  const out = $('matPic');
  out.className = `mat-pic${state ? ` ${state}` : ''}`;
  if (!pic) out.replaceChildren();
  else if (pic === '?') { const q = document.createElement('span'); q.className = 'mat-q'; q.textContent = '?'; out.replaceChildren(q); }
  else out.replaceChildren(itemPic(pic));
  $('matOut').hidden = !name; // (an empty mat just says what to do)
  $('matName').textContent = name;
  $('matWhy').textContent = why;
  $('matWhy').hidden = !why;
  $('matClear').hidden = !tiles.length;
  $('matMake').disabled = !go;
  $('matMake').classList.toggle('glow', go && state === 'match' && !recipeKnown(r));
  const n = RECIPES.filter(recipeFound).length;
  $('matTabFound').textContent = n ? `Found ${n}` : 'Found';
  for (const [id, tab] of [['matTabBag', 'bag'], ['matTabFound', 'found']]) { $(id).classList.toggle('on', matTab === tab); $(id).setAttribute('aria-pressed', String(matTab === tab)); }
}
// the Found list: recipes you've made, by kind (Tools, Food, Building...); tap one to put its things on the mat
const CRAFT_GROUPS = ITEM_GROUPS; // rules.js
const recipeGroup = (r) => r.group || itemGroupOf(ITEMS[madeBy(r)]);
const groupOrder = (g) => (CRAFT_GROUPS.includes(g) ? CRAFT_GROUPS.indexOf(g) : CRAFT_GROUPS.length);
let foundDrawn = '';
function foundRow(r) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'found-row';
  b.dataset.recipe = r.id;
  b.setAttribute('aria-label', `${recipeName(r)}: put its things on the mat`);
  const words = document.createElement('span');
  words.className = 'found-words';
  const title = document.createElement('strong');
  title.textContent = recipeName(r);
  const needs = document.createElement('span');
  needs.className = 'craft-needs';
  const chip = (text, ok) => { const c = document.createElement('span'); c.className = 'need-chip' + (ok ? ' ok' : ''); c.textContent = text; needs.appendChild(c); };
  for (const [k, n] of Object.entries(r.needs)) { const have = you.carry[k] || 0; chip(`${ITEMS[k].plural} ${Math.min(have, n)}/${n}`, have >= n); }
  for (const k of Object.keys(r.keeps || {})) chip(`Keeps ${ITEMS[k].name.toLowerCase()}`, (you.carry[k] || 0) >= r.keeps[k]);
  if (r.near && PLACEABLES[r.near]) { const P = PLACEABLES[r.near]; chip(`By a ${P.fire ? 'lit ' : ''}${P.name.toLowerCase()}`, !!stationNear(r.near)); }
  words.append(title, needs);
  b.append(itemPic(madeBy(r)), words);
  b.addEventListener('click', () => fillMat(r));
  li.appendChild(b);
  return li;
}
function drawFound() {
  const found = RECIPES.filter(recipeFound);
  const groups = [...new Set(found.map(recipeGroup))].sort((a, b) => groupOrder(a) - groupOrder(b));
  const chips = groups.length > 1, search = found.length >= (SETTINGS.craftSearchFrom || 15);
  if (!chips || !groups.includes(foundGroup)) foundGroup = null;
  if (!search) foundQuery = '';
  const q = foundQuery.trim().toLowerCase();
  const list = found.filter((r) => (!foundGroup || recipeGroup(r) === foundGroup)
    && (!q || [recipeName(r), ...Object.keys(recipeWants(r)).map((k) => ITEMS[k].plural)].some((t) => t.toLowerCase().includes(q))));
  const ready = (r) => ['', 'Not here'].includes(cantMake(r)); // you have everything (cooking: walk to the fire)
  list.sort((a, b) => ready(b) - ready(a));
  const left = RECIPES.length - found.length;
  const shows = JSON.stringify([foundGroup, q, chips, search, left, list.map((r) => [r.id, ready(r), recipeWants(r), Object.keys(recipeWants(r)).map((k) => you.carry[k] || 0), r.near ? !!stationNear(r.near) : 0])]);
  if (shows === foundDrawn) return;
  foundDrawn = shows;
  $('foundSearch').hidden = !search;
  if (search) $('foundQuery').placeholder = `Search your ${found.length} recipes`;
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
    $('foundChips').replaceChildren(chip('All', null, found.length), ...groups.map((g) => chip(g, g, found.filter((r) => recipeGroup(r) === g).length)));
  } else $('foundChips').replaceChildren();
  $('foundMore').hidden = false;
  $('foundMore').textContent = !found.length ? 'Nothing found yet. Put things together on the mat to discover what they make'
    : left ? `${left} more to discover` : "You've found every recipe";
  if (q && !list.length) { const li = document.createElement('li'); li.className = 'found-none'; li.textContent = 'Nothing found'; $('foundList').replaceChildren(li); return; }
  $('foundList').replaceChildren(...list.map(foundRow));
}
const drawCraft = () => drawBag(); // (other parts call this when what you carry changes)
function showMatTab(tab) { matTab = tab; drawBag(); }
$('matTabBag').addEventListener('click', () => showMatTab('bag'));
$('matTabFound').addEventListener('click', () => showMatTab('found'));
$('matClear').addEventListener('click', clearMat);
$('matMake').addEventListener('click', () => { const r = matRecipe(); if (r && canMake(r)) make(r); });
$('foundQuery').addEventListener('input', (e) => { foundQuery = e.target.value; drawFound(); });
// the mat on or off, in the open inventory (what was on it goes back in the bag)
function setMat(on) {
  matOn = !!on;
  onTheMat = {}; matGoal = null; matNew = null; matTab = 'bag';
  bagPick = null; bagDrawn = ''; craftDrawn = ''; foundDrawn = '';
  drawBag();
}
// the inventory with the craft mat showing; withKind: put one of these on it (Craft with › in the inventory)
function openCraft(withKind) {
  openBag(true);
  if (typeof withKind === 'string' && ITEMS[withKind]) putOnMat(withKind);
}
function closeCraft() { if (craftOpen()) closeBag(); }
function openBag(crafting) {
  matOn = !!crafting;
  onTheMat = {}; matGoal = null; matNew = null; matTab = 'bag';
  bagPick = null; bagDrawn = ''; craftDrawn = ''; foundDrawn = '';
  drawBag();
  $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); $('craftBtn').setAttribute('aria-expanded', String(matOn)); hideHint();
}
function closeBag() {
  $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false'); $('craftBtn').setAttribute('aria-expanded', 'false');
  matOn = false; onTheMat = {}; matGoal = null; matNew = null; foundQuery = ''; $('foundQuery').value = '';
}
// the bag and hammer buttons work like two tabs of one sheet: the other one switches, the same one closes it
$('bagBtn').addEventListener('click', () => (!bagOpen() ? openBag(false) : matOn ? setMat(false) : closeBag()));
$('craftBtn').addEventListener('click', () => (!bagOpen() ? openCraft() : !matOn ? setMat(true) : closeBag()));
$('bagCraft').addEventListener('click', () => setMat(!matOn));
$('bagClose').addEventListener('click', closeBag);
