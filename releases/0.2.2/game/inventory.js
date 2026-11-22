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

/* ---------- your inventory: see what you're carrying, put things down, make things ---------- */
const bagOpen = () => $('bag').classList.contains('open');
function smallButton(text, onClick, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'small-btn' + (primary ? ' go' : '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
function bagRow(kind, title, detail, buttons) {
  const li = document.createElement('li');
  li.className = 'bag-row';
  const dot = itemPic(kind);
  const what = document.createElement('span');
  what.className = 'what';
  what.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  what.appendChild(small);
  const acts = document.createElement('span');
  acts.className = 'row-actions';
  acts.append(...buttons);
  li.append(dot, what, acts);
  return li;
}
// recipes can be made when you carry what they need and the result still fits your carrying limit
function canMake(r) {
  for (const [k, n] of Object.entries(r.needs)) if ((you.carry[k] || 0) < n) return false;
  return carried() - weightOf(r.needs) + weightOf(r.makes) <= SETTINGS.carryCapacity;
}
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
  showGain(`Made ${r.name || ITEMS[Object.keys(r.makes)[0]].name}`);
}
function drawBag() {
  const w = carried();
  $('bagWeight').textContent = `${fmt(w)} / ${fmt(SETTINGS.carryCapacity)}`;
  drawWeightBar($('bagBar'), w);
  const kinds = Object.keys(you.carry);
  $('bagEmpty').hidden = kinds.length > 0;
  $('bagList').replaceChildren(...kinds.map((kind) => {
    const n = you.carry[kind];
    const buttons = [];
    if (ITEMS[kind].places) buttons.push(smallButton('Place', () => startPlacing(kind), true)); // a campfire: choose where it goes
    if (Object.keys(ITEMS[kind].eat || {}).length) buttons.push(smallButton('Eat', () => eatOne(kind), true));
    buttons.push(smallButton(n > 1 ? 'Drop 1' : 'Drop', () => dropItems(kind, 1)));
    if (n > 1) buttons.push(smallButton('Drop all', () => dropItems(kind, n)));
    const it = ITEMS[kind];
    const left = it.uses ? (you.wear[kind] ?? it.uses) : 0;
    const row = bagRow(kind, countLabel(kind, n), `Weight ${fmt(it.weight * n)}${it.uses ? ` · ${left} ${left === 1 ? 'use' : 'uses'} left` : ''}`, buttons);
    if (it.uses) { // a small wear bar for tools
      const bar = document.createElement('span');
      bar.className = 'wear';
      bar.style.setProperty('--w', (left / it.uses).toFixed(2));
      row.querySelector('.what').appendChild(bar);
    }
    return row;
  }));
}
/* ---------- crafting: its own sheet (the Craft button at the top) ----------
   Each recipe is a card: what it makes, what it needs (with how many you have), and Make. */
const craftOpen = () => $('craft').classList.contains('open');
function drawCraft() {
  $('craftList').replaceChildren(...RECIPES.map((r) => {
    const makes = Object.keys(r.makes)[0], it = ITEMS[makes];
    const li = document.createElement('li');
    li.className = 'craft-card';
    const head = document.createElement('div');
    head.className = 'craft-head';
    const dot = itemPic(makes);
    const title = document.createElement('strong');
    title.textContent = r.name || it.name;
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
    const ok = canMake(r);
    const b = smallButton(ok ? 'Make' : 'Need more', () => { make(r); drawCraft(); }, ok);
    b.disabled = !ok;
    li.append(head, needs, b);
    return li;
  }));
}
function openCraft() { closeBag(); drawCraft(); $('craft').classList.add('open'); $('craftBtn').setAttribute('aria-expanded', 'true'); hideHint(); }
function closeCraft() { $('craft').classList.remove('open'); $('craftBtn').setAttribute('aria-expanded', 'false'); }
$('craftBtn').addEventListener('click', () => (craftOpen() ? closeCraft() : openCraft()));
$('craftClose').addEventListener('click', closeCraft);
function openBag() { closeCraft(); drawBag(); $('bag').classList.add('open'); $('bagBtn').setAttribute('aria-expanded', 'true'); hideHint(); }
function closeBag() { $('bag').classList.remove('open'); $('bagBtn').setAttribute('aria-expanded', 'false'); }
$('bagBtn').addEventListener('click', () => (bagOpen() ? closeBag() : openBag()));
$('bagClose').addEventListener('click', closeBag);
