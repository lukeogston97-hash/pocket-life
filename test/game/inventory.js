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
const itemAbout = (kind) => ITEMS[kind].about || (RECIPES.find((r) => r.makes[kind]) || {}).about || '';
// a tool's uses left, one per tool you carry, the one in use first (the server sends a list; before 0.2.6 one number)
function wearList(kind) {
  const n = you.carry[kind] || 0, w = you.wear[kind];
  const list = (Array.isArray(w) ? w : w != null ? [w] : []).slice(0, n);
  while (list.length < n) list.push(ITEMS[kind].uses);
  return list;
}
// what the grid shows: a tile for each kind, but each tool gets its own (Luke's pick), with its own wear: the first
// of a kind is the one in use, the rest are spares. Each can be dropped, and keeps its wear on the ground.
function bagSlots() {
  const out = [];
  for (const kind of bagKinds()) {
    const n = you.carry[kind], it = ITEMS[kind];
    if (!it.uses) { out.push({ kind, key: `${kind}:0`, n }); continue; }
    const worn = wearList(kind);
    for (let i = 0; i < n; i++) out.push({ kind, key: `${kind}:${i}`, n: 1, i, spare: i > 0, spares: n - 1, left: worn[i] });
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
  b.setAttribute('aria-label', it.uses ? `${it.name}, ${s.spare ? `spare, ${s.left} uses` : `${s.left} ${s.left === 1 ? 'use' : 'uses'} left`}` : countLabel(s.kind, s.n));
  b.appendChild(itemPic(s.kind));
  if (s.n > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = s.n; b.appendChild(c); }
  if (it.uses) { const w = document.createElement('span'); w.className = 'wear'; w.style.setProperty('--w', (s.left / it.uses).toFixed(2)); b.appendChild(w); }
  b.addEventListener('click', () => { // tap to show its info, tap again to hide it
    if (Date.now() - bagDragged < 400) return;
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
// grid can still scroll).
let bagDragged = 0; // when the last drag ended (the click after it is ignored)
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
      $('bag').classList.add('dragging');
      bagDragging = true;
      dragPoint = { x: e.clientX, y: e.clientY, armed: false };
      move(e);
    };
    const move = (m) => {
      if (!ghost) return;
      ghost.style.transform = `translate(${m.clientX - 28}px, ${m.clientY - 28}px)`;
      if (dragPoint) { dragPoint.x = m.clientX; dragPoint.y = m.clientY; }
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
      bagDragging = false;
      dragPoint = null;
      bagDragged = Date.now();
      if (m && !over) bagDropAt(s, m);
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
      if (roomFor(th, kind) < 1) say('Fire is full'); else then({ type: 'tend', id: th.id, do: 'add', n: 1, fuel: kind });
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
  if (RECIPES.some((r) => r.needs[kind])) acts.appendChild(smallButton('Craft with ›', () => openCraft(kind)));
  parts.push(acts);
  box.replaceChildren(...parts);
}
let bagDrawn = ''; // what the grid shows now: it's only redrawn when that changes, so a tap in progress isn't lost
function drawBag() {
  const w = carried();
  $('bagWeight').textContent = `${fmt(w)} / ${fmt(SETTINGS.carryCapacity)}`;
  drawWeightBar($('bagBar'), w);
  const slots = bagSlots();
  const picked = slots.find((s) => s.key === bagPick) || null;
  if (!picked) bagPick = null;
  const shows = JSON.stringify([slots.map((s) => [s.key, s.n, s.left || 0, s.spares || 0]), bagPick]);
  if (shows === bagDrawn) return;
  bagDrawn = shows;
  $('bagEmpty').hidden = slots.length > 0;
  const cells = slots.map((s) => { const li = document.createElement('li'); li.appendChild(bagTile(s)); return li; });
  const total = Math.max(BAG_MIN, Math.ceil(slots.length / BAG_COLS) * BAG_COLS);
  while (cells.length < total) { const li = document.createElement('li'); li.className = 'bag-slot'; li.setAttribute('aria-hidden', 'true'); cells.push(li); }
  $('bagList').replaceChildren(...cells);
  drawBagInfo(picked);
}
/* ---------- crafting: its own sheet (the hammer button) ----------
   Each recipe is a card: what it makes, what it needs (with how many you have), and Make. Ones you can make now come first.
   A recipe with "near" (cooking, later) needs that placed thing close by, and a fire has to be lit (stationNear in placeables.js). */
const craftOpen = () => $('craft').classList.contains('open');
let craftWith = null; // Craft with in the inventory: only the recipes that use this item
const recipeName = (r) => r.name || ITEMS[Object.keys(r.makes)[0]].name;
// discovery: a recipe shows once you've had all but one of the things it needs (at least one), so the next step shows
// without giving away what's further on. you.seen is everything you've ever carried (the server keeps it).
function recipeKnown(r) {
  const kinds = Object.keys(r.needs), had = kinds.filter((k) => you.carry[k] || (you.seen || []).includes(k)).length;
  return had >= Math.max(1, kinds.length - 1);
}
// the buttons along the top (Tools, Food, Building...): a recipe's "group", else what it makes says
const CRAFT_GROUPS = ITEM_GROUPS; // rules.js
const recipeGroup = (r) => r.group || itemGroupOf(ITEMS[Object.keys(r.makes)[0]]);
const groupOrder = (g) => (CRAFT_GROUPS.includes(g) ? CRAFT_GROUPS.indexOf(g) : CRAFT_GROUPS.length);
let craftGroup = null, craftQuery = '', craftPick = null; // the button picked (null: All), what's typed in search, the card tapped open
// why a recipe can't be made right now ('' if it can): things missing, too heavy, or not by what it needs
function cantMake(r) {
  for (const [k, n] of Object.entries(r.needs)) if ((you.carry[k] || 0) < n) return 'Need more';
  if (carried() - weightOf(r.needs) + weightOf(r.makes) > SETTINGS.carryCapacity) return 'Too heavy';
  if (r.near && !stationNear(r.near)) return 'Not here';
  return '';
}
const canMake = (r) => !cantMake(r);
// a recipe with "seconds" (cooking) takes that long, and uses its things up when it finishes (if it still can be made)
function make(r) {
  if (!canMake(r)) return;
  const finish = () => {
    if (!canMake(r)) return;
    spendEnergy('craft');
    for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
    for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
    sendAct({ t: 'craft', id: r.id });
    if (bagOpen()) drawBag();
    drawHeld();
    drawCarry();
    showGain(`Made ${recipeName(r)}`);
  };
  if (r.seconds) { startAction({ pose: 'kneel', seconds: r.seconds, end: finish }); return; }
  startAction({ pose: 'kneel', seconds: 1.6 });
  finish();
}
function recipeCard(r) {
  const makes = Object.keys(r.makes)[0], it = ITEMS[makes];
  const li = document.createElement('li');
  li.className = 'craft-card';
  const head = document.createElement('button'); // tap the name to see more about it
  head.type = 'button';
  head.className = 'craft-head';
  head.setAttribute('aria-expanded', String(craftPick === r.id));
  head.addEventListener('click', () => { craftPick = craftPick === r.id ? null : r.id; drawCraft(); });
  const dot = itemPic(makes);
  const title = document.createElement('strong');
  title.textContent = recipeName(r);
  const words = document.createElement('span');
  words.className = 'craft-words';
  words.appendChild(title);
  if (craftPick === r.id) {
    const info = document.createElement('small');
    info.textContent = [`Weight ${fmt(it.weight)}`, it.uses ? `${it.uses} uses` : '', r.about || ''].filter(Boolean).join(' · ');
    words.appendChild(info);
  }
  head.append(dot, words);
  const needs = document.createElement('div');
  needs.className = 'craft-needs';
  for (const [k, n] of Object.entries(r.needs)) {
    const have = you.carry[k] || 0;
    const chip = document.createElement('span');
    chip.className = 'need-chip' + (have >= n ? ' ok' : '');
    chip.textContent = `${ITEMS[k].plural} ${Math.min(have, n)}/${n}`;
    needs.appendChild(chip);
  }
  if (r.near && PLACEABLES[r.near]) { // what it has to be made by, like a lit campfire
    const P = PLACEABLES[r.near], chip = document.createElement('span');
    chip.className = 'need-chip' + (stationNear(r.near) ? ' ok' : '');
    chip.textContent = `By a ${P.fire ? 'lit ' : ''}${P.name.toLowerCase()}`;
    needs.appendChild(chip);
  }
  const why = cantMake(r);
  const b = smallButton(why || 'Make', () => { make(r); drawCraft(); }, !why);
  b.disabled = !!why;
  li.append(head, needs, b);
  return li;
}
let craftDrawn = ''; // the same for the craft list
function drawCraft() {
  const known = RECIPES.filter(recipeKnown), base = known.filter((r) => !craftWith || r.needs[craftWith]);
  // the buttons show once what you know covers 2 or more kinds of thing; search once you know craftSearchFrom recipes
  const groups = [...new Set(base.map(recipeGroup))].sort((a, b) => groupOrder(a) - groupOrder(b));
  const chips = !craftWith && groups.length > 1, search = !craftWith && known.length >= (SETTINGS.craftSearchFrom || 15);
  if (!chips || !groups.includes(craftGroup)) craftGroup = null;
  if (!search) craftQuery = '';
  const q = craftQuery.trim().toLowerCase();
  const list = base.filter((r) => (!craftGroup || recipeGroup(r) === craftGroup)
    && (!q || [recipeName(r), ...Object.keys(r.needs).map((k) => ITEMS[k].plural)].some((s) => s.toLowerCase().includes(q))));
  const unknown = RECIPES.length - known.length;
  const shows = JSON.stringify([craftWith, craftGroup, q, craftPick, unknown, chips, search, list.map((r) => [r.id, cantMake(r), Object.keys(r.needs).map((k) => you.carry[k] || 0), r.near ? !!stationNear(r.near) : 0])]);
  if (shows === craftDrawn) return;
  craftDrawn = shows;
  $('craftSearch').hidden = !search;
  if (search) $('craftQuery').placeholder = `Search your ${known.length} recipes`;
  $('craftChips').hidden = !chips;
  if (chips) {
    const chip = (label, g, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'craft-chip' + (craftGroup === g ? ' on' : '');
      b.setAttribute('aria-pressed', String(craftGroup === g));
      b.textContent = `${label} ${n}`;
      b.addEventListener('click', () => { craftGroup = g; drawCraft(); });
      return b;
    };
    $('craftChips').replaceChildren(chip('All', null, base.length), ...groups.map((g) => chip(g, g, base.filter((r) => recipeGroup(r) === g).length)));
  } else $('craftChips').replaceChildren();
  $('craftMore').hidden = !!craftWith || (known.length > 0 && !unknown);
  $('craftMore').textContent = !known.length ? 'Find new things to unlock recipes' : `${unknown} more to discover as you find new things`;
  const note = $('craftNote');
  note.hidden = !craftWith;
  if (craftWith) {
    const words = document.createElement('span');
    words.textContent = `Recipes that use ${ITEMS[craftWith].plural.toLowerCase()}`;
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'text-btn';
    all.textContent = 'Show all';
    all.addEventListener('click', () => { craftWith = null; drawCraft(); });
    note.replaceChildren(words, all);
  }
  if (q && !list.length) { const li = document.createElement('li'); li.className = 'craft-group'; li.textContent = 'Nothing found'; $('craftList').replaceChildren(li); return; }
  const group = (text, rs) => {
    if (!rs.length) return [];
    const li = document.createElement('li');
    li.className = 'craft-group';
    li.textContent = text;
    return [li, ...rs.map(recipeCard)];
  };
  $('craftList').replaceChildren(...group('Ready to make', list.filter(canMake)), ...group('Need more', list.filter((r) => !canMake(r))));
}
function openCraft(withKind) {
  closeBag();
  craftWith = typeof withKind === 'string' && ITEMS[withKind] ? withKind : null;
  craftDrawn = '';
  drawCraft();
  $('craft').classList.add('open'); $('craftBtn').setAttribute('aria-expanded', 'true'); hideHint();
}
$('craftQuery').addEventListener('input', (e) => { craftQuery = e.target.value; drawCraft(); });
function closeCraft() { craftWith = null; craftGroup = null; craftQuery = ''; craftPick = null; $('craftQuery').value = ''; $('craft').classList.remove('open'); $('craftBtn').setAttribute('aria-expanded', 'false'); }
$('craftBtn').addEventListener('click', () => (craftOpen() ? closeCraft() : openCraft()));
$('craftClose').addEventListener('click', closeCraft);
function openBag() { closeCraft(); bagPick = null; bagDrawn = ''; drawBag(); $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); hideHint(); }
function closeBag() { $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false'); }
$('bagBtn').addEventListener('click', () => (bagOpen() ? closeBag() : openBag()));
$('bagClose').addEventListener('click', closeBag);
