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
      const { model } = buildItem(kind);
      model.rotation.y = 0.5;
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
    bagPick = bagPick === s.key ? null : s.key;
    drawBag();
    const again = $('bagList').querySelector(`[data-key="${s.key}"]`);
    if (again) again.focus({ preventScroll: true });
  });
  return b;
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
// why a recipe can't be made right now ('' if it can): things missing, too heavy, or not by what it needs
function cantMake(r) {
  for (const [k, n] of Object.entries(r.needs)) if ((you.carry[k] || 0) < n) return 'Need more';
  if (carried() - weightOf(r.needs) + weightOf(r.makes) > SETTINGS.carryCapacity) return 'Too heavy';
  if (r.near && !stationNear(r.near)) return 'Not here';
  return '';
}
const canMake = (r) => !cantMake(r);
function make(r) {
  if (!canMake(r)) return;
  spendEnergy('craft');
  for (const [k, n] of Object.entries(r.needs)) takeFromCarry(k, n);
  for (const [k, n] of Object.entries(r.makes)) addToCarry(k, n);
  if (online()) net.sock.send(JSON.stringify({ t: 'craft', id: r.id }));
  startAction({ pose: 'kneel', seconds: 1.6 });
  if (bagOpen()) drawBag();
  drawHeld();
  drawCarry();
  showGain(`Made ${recipeName(r)}`);
}
function recipeCard(r) {
  const makes = Object.keys(r.makes)[0], it = ITEMS[makes];
  const li = document.createElement('li');
  li.className = 'craft-card';
  const head = document.createElement('div');
  head.className = 'craft-head';
  const dot = itemPic(makes);
  const title = document.createElement('strong');
  title.textContent = recipeName(r);
  const info = document.createElement('small');
  info.textContent = [`Weight ${fmt(it.weight)}`, it.uses ? `${it.uses} uses` : '', r.about || ''].filter(Boolean).join(' · ');
  const words = document.createElement('span');
  words.className = 'craft-words';
  words.append(title, info);
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
  const list = RECIPES.filter((r) => !craftWith || r.needs[craftWith]);
  const shows = JSON.stringify([craftWith, list.map((r) => [r.id, cantMake(r), Object.keys(r.needs).map((k) => you.carry[k] || 0), r.near ? !!stationNear(r.near) : 0])]);
  if (shows === craftDrawn) return;
  craftDrawn = shows;
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
function closeCraft() { craftWith = null; $('craft').classList.remove('open'); $('craftBtn').setAttribute('aria-expanded', 'false'); }
$('craftBtn').addEventListener('click', () => (craftOpen() ? closeCraft() : openCraft()));
$('craftClose').addEventListener('click', closeCraft);
function openBag() { closeCraft(); bagPick = null; bagDrawn = ''; drawBag(); $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); hideHint(); }
function closeBag() { $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false'); }
$('bagBtn').addEventListener('click', () => (bagOpen() ? closeBag() : openBag()));
$('bagClose').addEventListener('click', closeBag);
