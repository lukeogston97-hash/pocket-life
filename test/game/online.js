/* ---------- online: other people in the same world, and speech bubbles ---------- */
// The server (game-data.json "server") passes everyone's moves and speech to everyone else in the
// same world. The test link joins the test world, the release joins the live world. If the server
// can't be reached, the game carries on as normal and keeps trying quietly.
const SERVER = typeof DATA.server === 'string' ? DATA.server : '';
const others = new Map(); // id -> { mesh, tx, tz, tr, phase, name, bubble }
const net = { sock: null, myId: null, wanted: false, retry: 1000, sentAt: 0, last: null, mode: 'watch' }; // mode: watch (main menu) or play
function cleanLook(look) {
  const l = { ...DEFAULT_LOOK, ...(look || {}) };
  for (const k of ['sex', 'skin', 'build', 'hair', 'hairColour', 'tunic']) l[k] = pickId(LOOKS[k], l[k]);
  l.age = Math.round(Math.min(LOOKS.age.max, Math.max(LOOKS.age.min, Number(l.age) || LOOKS.age.start)));
  l.name = String(l.name || 'Someone').slice(0, 20);
  return l;
}
// Chat filter (the same code is in the game and on the server): bad words become stars, bad names are refused.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
const leet = (s) => s.toLowerCase().replace(/[0134578@$!|+]/g, (c) => LEET[c]);
const ENDINGS = ['', 's', 'es', 'ed', 'ing', 'y', 'er', 'ers'];
function badWord(token, F) {
  const n = leet(token).replace(/[^a-z]/g, '');
  if (!n) return false;
  for (const f of new Set([n, n.replace(/(.)\1+/g, '$1')])) { // also with doubled letters squashed (fuuuck)
    if ((F.anywhere || []).some((r) => f.includes(r))) return true;
    if ((F.words || []).some((w) => ENDINGS.some((e) => f === w + e))) return true;
  }
  return false;
}
function starText(text, F) {
  let out = String(text).replace(/\S+/g, (tok) => (badWord(tok, F) ? '*'.repeat(tok.length) : tok));
  for (const p of F.phrases || []) {
    const re = new RegExp(`\\b${p.split(/\s+/).map((w) => w.replace(/[^a-z]/gi, '')).join('[\\s\\W_]+')}\\b`, 'gi');
    out = out.replace(re, (m) => m.replace(/\S/g, '*'));
  }
  return out;
}
const badNameIn = (name, F) => String(name).split(/[\s._-]+/).some((t) => badWord(t, F))
  || (F.anywhere || []).some((r) => leet(name).replace(/[^a-z]/g, '').includes(r)) || starText(name, F) !== String(name);
const badName = (name, F) => badNameIn(name, F) || (!!F.names && badNameIn(name, F.names)); // names also can't say admin, mod and so on
const FILTER = DATA.chatFilter || {};
// a random id for this phone, so mutes and reports stick to the same person (others only see a scrambled tag)
const PID_KEY = 'pocket-life:pid', MUTE_KEY = 'pocket-life:muted';
let pid = '';
try { pid = localStorage.getItem(PID_KEY) || ''; if (!pid) { pid = crypto.randomUUID(); localStorage.setItem(PID_KEY, pid); } } catch (err) { pid = crypto.randomUUID(); }
let muted = new Set();
try { muted = new Set(JSON.parse(localStorage.getItem(MUTE_KEY) || '[]')); } catch (err) { /* none */ }
function setMuted(who, on) {
  if (on) muted.add(who); else muted.delete(who);
  try { localStorage.setItem(MUTE_KEY, JSON.stringify([...muted])); } catch (err) { /* full */ }
}
function goOnline() {
  net.wanted = true;
  if (!SERVER || net.sock || net.stopped || net.hidden) return;
  let sock;
  try { sock = new WebSocket(`${SERVER}?world=live`); } catch (err) { return; }
  net.sock = sock;
  setNet('connecting');
  sock.onopen = () => {
    net.retry = 1000;
    net.last = null;
    sendHello();
  };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.t === 'count') setNet('online', m.n);
    else if (m.t === 'update') getUpdate(m.min);
    else if (m.t === 'maintenance') showMaintenance(m.text);
    else if (m.t === 'thanks') showTag('Thanks for the feedback!', headTop(), 2.5);
    else if (m.t.startsWith('admin') || ['announce', 'kicked', 'banned', 'badge', 'reset'].includes(m.t)) adminMessage(m);
    else if (m.t === 'slow') { menuJoining = false; if (ui.mode === 'menu') drawMenu(); showTag('Slow down a little', headTop(), 2); }
    else if (m.t === 'reported') showTag(m.ok ? 'Thanks, your report was sent' : "They've left, so it couldn't be sent", headTop(), 2.5);
    else if (m.t === 'welcome') welcome(m);
    else if (m.t === 'line') { menuLine = m.place || 0; if (m.missed) { net.mode = 'watch'; menuJoining = false; } if (ui.mode === 'menu') drawMenu(); }
    else if (m.t === 'turn') { if (net.mode === 'play' && ui.mode === 'menu') { menuLine = 0; menuJoining = true; drawMenu(); sendHello(); } } // a spot opened: in we go
    else if (m.t === 'me') { const fresh = !player; applyMe(m); if (fresh) enterWorld(); }
    else if (m.t === 'died') die(m);
    else if (m.t === 'badName') { $('nameErr').textContent = 'Pick a different name.'; $('nameErr').hidden = false; creating = false; }
    else if (m.t === 'elsewhere') { net.stopped = true; showMaintenance('Your person is being played in another tab or window. Reload this page to play here instead.', 'Playing somewhere else', ''); }
    else if (m.t === 'state') setOtherState(m);
    else if (m.t === 'stroll') { const o = others.get(m.id); if (o) Object.assign(o, { tx: m.x, tz: m.z, speed: m.speed || null, due: m.ms ? elapsed + m.ms / 1000 : null, then: m.then || null, act: null }); }
    else if (m.t === 'act') { const o = others.get(m.id); if (o && ['bend', 'kneel', 'pick', 'chop'].includes(m.pose)) o.act = { pose: m.pose, seconds: Math.min(25, Number(m.seconds) || 0.5), t0: elapsed }; }
    else if (m.t === 'tree') setTreeState(m.idx, m.state || 'tree', m.at);
    else if (m.t === 'plant') setPlant(m.plant, m.i, m.readyAt);
    else if (m.t === 'cutNo') { // someone cut it first: what you got is taken back
      setPlant(m.plant, m.i, m.readyAt);
      let back = false;
      for (const [k, n] of Object.entries((PLANTS[m.plant] || {}).gives || {})) back = takeFromCarry(k, n) || back;
      if (back) { drawHeld(); drawCarry(); }
      showTag('Someone cut it first', headTop(), 2);
    }
    else if (m.t === 'oldStump') removeOldStump(m.idx);
    else if (m.t === 'rock') setRockState(m.idx, m.state || 'whole', m.at);
    else if (m.t === 'broke') { showTag(`Your ${(ITEMS[m.kind] || { name: 'tool' }).name.toLowerCase()} broke`, headTop(), 3); drawHeld(); }
    else if (m.t === 'graves') drawGraves(m.graves);
    else if (m.t === 'speed') setSpeed(m.speed);
    else if (m.t === 'live') applyLive(m.live);
    else if (m.t === 'moved') moveLayoutThing(m.what, m.idx, m.x, m.z);
    else if (m.t === 'removed') removeLayoutThing(m.what, m.idx);
    else if (m.t === 'world') useSharedWorld(m.world);
    else if (m.t === 'gone') removeWorldItem(m.id);
    else if (m.t === 'placed') { setPlaced(m.thing); if (m.mine && m.thing && !m.thing.built) { tasks.list.unshift({ type: 'build', id: m.thing.id }); if (!tasks.current && !action) nextTask(); else drawQueue(); } } // put it down: build it next
    else if (m.t === 'unplaced') removePlaced(m.id);
    else if (m.t === 'placeNo' || m.t === 'sitNo') { showTag(m.why || "Can't do that", headTop(), 2.5); if (m.t === 'sitNo') endSit(false); }
    else if (m.t === 'sit') setOtherSit(m);
    else if (m.t === 'added') for (const it of m.items || []) { if (ITEMS[it.kind]) addWorldItem(it.kind, it.x, it.z, it.rot, it.id, it.uses); }
    else if (m.t === 'took') tookBack(m);
    else if (m.t === 'bush') { const b = berryBushes[m.bush]; if (b) { b.userData.count = m.count; b.userData.growFrom = m.growFrom; drawBerries(b); } }
    else if (m.t === 'picked' && !m.ok) {
      if (takeFromCarry('berry', you.lastPick || 1)) { drawHeld(); drawCarry(); }
      showTag('Someone picked it first', headTop(), 2);
    }
    else if (m.t === 'join') addOther(m.person);
    else if (m.t === 'leave') removeOther(m.id);
    else if (m.t === 'move') { const o = others.get(m.id); if (o) heardMove(o, m); }
    else if (m.t === 'say') {
      if (m.id === net.myId) { if (player) { bubble(null, m.text); addChat(you.look.name, m.text, true); } }
      else if (others.has(m.id) && !muted.has(others.get(m.id).who)) { const o = others.get(m.id); const t = starText(m.text, FILTER); bubble(o, t); addChat(o.title, t, false); }
    }
  };
  sock.onclose = () => {
    if (net.sock === sock) net.sock = null;
    net.myId = null;
    setNet(net.wanted ? 'connecting' : 'offline');
    if (!maint.on && !net.stopped && ui.mode !== 'menu') showJoining(true, !!player);
    menuJoining = false; menuLine = 0;
    if (ui.mode === 'menu') drawMenu();
    shared.on = false;
    for (const id of [...others.keys()]) removeOther(id);
    if (net.wanted && !net.stopped) { setTimeout(goOnline, maint.on ? 20000 : net.retry); net.retry = Math.min(30000, net.retry * 2); }
  };
  sock.onerror = () => {};
}
// Graves: a small stone where someone died, for a day
const graves = [];
const graveGeo = new THREE.BoxGeometry(0.34, 0.46, 0.1);
const graveMat = mat('#a39e92');
function drawGraves(list) {
  for (const g of graves.splice(0)) { scene.remove(g); const i = interactive.indexOf(g); if (i >= 0) interactive.splice(i, 1); }
  for (const g of list || []) {
    const m = new THREE.Mesh(graveGeo, graveMat);
    m.position.set(g.x, groundY(g.x, g.z) + 0.2, g.z);
    m.rotation.set(-0.08, (g.at % 628) / 100, 0);
    m.castShadow = m.receiveShadow = true;
    m.userData.label = `Grave of ${g.name}`;
    m.userData.grave = true;
    scene.add(m);
    interactive.push(m);
    graves.push(m);
  }
}
// The server's welcome: the world, everyone in it, and your person (or how they got on while you were away)
let creating = false;
function welcome(m) {
  net.myId = m.id;
  hideMaintenance();
  showJoining(false);
  setNet('online', m.count);
  setSpeed(m.speed);
  applyLive(m.live);
  for (const id of [...others.keys()]) removeOther(id);
  for (const p of m.people || []) addOther(p);
  if (m.watch) { // watching from the main menu (or waiting in line because the world is full)
    if (m.world) useSharedWorld(m.world);
    menuYours = m.yours || null;
    menuLine = m.line || 0;
    if (ui.mode !== 'menu') { dropPlayer(); enterMenu(); }
    menuJoining = false;
    if (menuLine) net.mode = 'play'; // still wanting to play: the server calls us in when there's a spot
    drawMenu();
    return;
  }
  menuLine = 0;
  if (m.world) { useSharedWorld(m.world); if (m.needLayout) sendLayout(); }
  else if (m.needSeed) seedWorld();
  if (m.me) {
    forgetSit(); // the server says whether you're still sitting (below)
    if (!player) { applyMe(m.me, true); enterWorld(); }
    else {
      applyMe(m.me);
      if (m.away && Number.isFinite(m.me.x)) { // they may have strolled off while you were gone
        stopQueue();
        let bx = inWorld(m.me.x), bz = inWorld(m.me.z);
        if (heightAt(bx, bz) < WATER_Y + 0.1) { const sp = shorePointToward(V(bx + (bx - POND.x), 0, bz + (bz - POND.z))); bx = sp.x; bz = sp.z; }
        [bx, bz] = outsideSolid(bx, bz);
        playerGround = groundY(bx, bz);
        player.position.set(bx, playerGround, bz);
        net.last = null;
      }
    }
    if (m.me.sit) resumeSit(m.me.sit); // left sitting by the fire, and the time isn't up yet
    else if (!tasks.current && tasks.list.length && !action) nextTask();
    if (m.away) showWelcomeBack(m.away);
  } else if (!(player && you.dead)) {
    // no person yet (or the world was reset): make one
    removePlayer();
    if (ui.mode !== 'creator') enterCreator();
  }
  if (m.dead) showGoneCard(m.dead);
}
// what the server says about your person: needs, what you carry, and (when joining) who and where you are
function applyMe(m, spawn = false) {
  if (spawn || !player) {
    const look = { ...DEFAULT_LOOK, ...(m.look || {}) };
    for (const k of ['sex', 'skin', 'build', 'hair', 'hairColour', 'tunic']) look[k] = pickId(LOOKS[k], look[k]);
    look.age = Math.round(Math.max(LOOKS.age.min, Number(m.age) || LOOKS.age.start)); // can go past the max with birthdays
    look.name = String(m.name || look.name || 'You').slice(0, 20);
    you.lifeStart = m.born || Date.now();
    you.dead = false;
    spawnPlayer(look);
    const [px, pz] = onDryLand(inWorld(Number(m.x) || START.x), inWorld(Number(m.z) || START.z)); // never back in the pond or a tree
    playerGround = groundY(px, pz);
    player.position.set(px, playerGround, pz);
    player.rotation.y = Number(m.ry) || 0;
    creating = false;
  }
  // a birthday while you're playing: a year older (once a real year, on the day you made your person)
  if (you.look && Number(m.age) > you.look.age) { you.look.age = Math.round(Number(m.age)); drawHud(); if (player) showTag(`Happy birthday! ${you.look.age} today`, headTop(), 4); }
  you.stats = { ...freshStats(), ...(m.stats || {}) };
  you.statsAt = m.statsAt || Date.now();
  // what you carry: the server's word, plus anything you're picking up that it hasn't confirmed yet
  const carry = Object.fromEntries(Object.entries(m.carry || {}).filter(([k, n]) => ITEMS[k] && n > 0));
  for (const kind of shared.taking.values()) carry[kind] = (carry[kind] || 0) + 1;
  you.carry = carry;
  you.wear = m.wear || {};
  you.seen = m.seen || you.seen || [];
  if (!!m.sleeping !== !!you.sleeping) setSleeping(m.sleeping, true);
  you.collapsed = !!m.collapsed;
  you.lastKind = carry[you.lastKind] ? you.lastKind : (ITEMS[m.lastKind] && carry[m.lastKind] ? m.lastKind : Object.keys(carry)[0] || null);
  tickStats();
  drawNeeds();
  drawCarry();
  drawHeld();
}
// the starting layout of things the server needs to look after people while they're away
function layoutData() {
  const shore = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const p = shorePointToward(V(POND.x + Math.cos(a) * 20, 0, POND.z + Math.sin(a) * 20));
    if (!solidAt(p.x, p.z)) shore.push([+p.x.toFixed(2), +p.z.toFixed(2)]);
  }
  const open = [];
  for (let t = 0; t < 6000 && open.length < 600; t++) {
    const x = (hash(t, 11) * 2 - 1) * (WALK_LIMIT - 1), z = (hash(t, 29) * 2 - 1) * (WALK_LIMIT - 1);
    if (pondShape(x, z) < 1.3 || !roomAt(x, z, 0.6, 0.5)) continue;
    open.push([+x.toFixed(2), +z.toFixed(2)]);
  }
  return { bushes: berryBushes.map((b) => [+b.position.x.toFixed(2), +b.position.z.toFixed(2)]), shore, open };
}
function sendLayout() { if (net.sock) net.sock.send(JSON.stringify({ t: 'layout', ...layoutData() })); }
// The shared world: what lies on the ground and how far each berry bush has grown back.
const shared = { on: false, taking: new Map() }; // taking: item id -> kind, while the server confirms
function useSharedWorld(w) {
  shared.on = true;
  for (const it of [...world.items]) removeWorldItem(it.id);
  for (const it of w.items || []) if (ITEMS[it.kind]) addWorldItem(it.kind, it.x, it.z, it.rot, it.id, it.uses);
  drawGraves(w.graves || []);
  usePlaced(w.placed || []);
  const ts = w.trees || {};
  trees.forEach((t, i) => setTreeState(i, ts[i] ? ts[i][0] : 'tree', ts[i] && ts[i][1]));
  for (const i of Object.keys(w.oldStumps || {})) removeOldStump(Number(i));
  const rs = w.rocks || {};
  rocks.forEach((r, i) => setRockState(i, rs[i] ? rs[i][0] : 'whole', rs[i] && rs[i][1]));
  for (const [kind, P] of Object.entries(plants)) for (const c of P.clumps) setPlant(kind, c.i, ((w.plants || {})[kind] || {})[c.i] || 0);
  berryBushes.forEach((b, i) => {
    const s = (w.bushes || [])[i];
    b.userData.count = s && s[0] != null ? s[0] : null;
    b.userData.growFrom = s && s[1] != null ? s[1] : null;
    drawBerries(b);
  });
  useWorldEdits(w); // what the admin moved or took out
  for (const t of allTasks()) if (t.type === 'pickup' && !getItem(t.id)) t.gone = true; // queued things that aren't there any more get skipped
}
// the first player into a brand new world lays it out: the starting sticks and stones, plus where new ones can turn up
function seedWorld() {
  const caps = {}, spotsFor = { stick: [], stone: [] };
  for (const it of Object.values(ITEMS)) if (it.startInWorld) caps[it.id] = it.startInWorld;
  let n = 0;
  for (const a of spots.values()) {
    for (let k = 0; k < a.length; k += 4, n++) {
      const tree = a[k + 3], r = a[k + 2];
      const kind = tree ? 'stick' : r > 0.45 ? 'stone' : null; // sticks fall under trees, stones turn up by boulders
      if (!kind || !spotsFor[kind] || spotsFor[kind].length >= 400) continue;
      const ang = hash(n, 77) * Math.PI * 2, d = tree ? r + 0.4 : r + 0.35;
      const x = a[k] + Math.cos(ang) * d, z = a[k + 1] + Math.sin(ang) * d;
      if (squareDist(x, z) > WALK_LIMIT - 1 || pondShape(x, z) < 1.3 || solidAt(x, z)) continue;
      spotsFor[kind].push([x, z]);
    }
  }
  const src = Object.values(SOURCES).find(harvests);
  net.sock.send(JSON.stringify({
    t: 'seed', items: START_ITEMS, spots: spotsFor, caps,
    holds: src ? bushHolds(src) : 5, regrowMs: src ? src.regrowHours * 3600000 : 0, respawnMs: (SETTINGS.respawnMinutes || 10) * 60000,
    layout: layoutData(),
  }));
}
function shareTake(item) {
  if (!online() || !shared.on) return;
  shared.taking.set(item.id, item.kind);
  net.sock.send(JSON.stringify({ t: 'take', id: item.id }));
}
function tookBack(m) {
  const kind = shared.taking.get(m.id);
  shared.taking.delete(m.id);
  if (m.ok || !kind) return;
  if (takeFromCarry(kind, 1)) { drawHeld(); drawCarry(); }
  showTag('Someone got there first', headTop(), 2);
}
function sharePick(bush) {
  if (online() && shared.on) net.sock.send(JSON.stringify({ t: 'pick', bush }));
}
// putting things on the ground: online, the world adds them (for everyone, you included)
function placeItems(list) {
  if (!list.length) return;
  if (online() && shared.on) net.sock.send(JSON.stringify({ t: 'drop', items: list }));
}
// The server can close the world for maintenance, and send out-of-date games to the newest version.
// The new version can take a minute or two to reach the link, so if a reload still gets the old one,
// wait 20 seconds and try again rather than reloading over and over.
const UPDATE_KEY = 'pocket-life:updating';
const maint = { on: false };
function getUpdate(min) {
  let last = 0;
  try { last = Number(sessionStorage.getItem(UPDATE_KEY)) || 0; } catch (err) { /* private mode */ }
  const wait = Date.now() - last < 90000 ? 20000 : 0; // reloaded a moment ago and still old: give the link time
  try { sessionStorage.setItem(UPDATE_KEY, String(Date.now() + wait)); } catch (err) { /* private mode */ }
  if (wait) showMaintenance(`Getting the newest version (${min})…`);
  setTimeout(() => {
    const url = new URL(location.href);
    url.searchParams.set('v', `${min}.${Date.now() % 100000}`);
    location.replace(url.href);
  }, wait);
}
function showMaintenance(text, title = 'Back soon', note = 'Your person is safe. This page checks again by itself.') {
  maint.on = true;
  showJoining(false);
  $('maintTitle').textContent = title;
  $('maintNote').textContent = note;
  $('adminPanel').hidden = true; $('adminPick').hidden = true;
  closeFeedback(); closeReport(); closeSay(); closeMenu(); $('pause').hidden = true;
  paused = true; // needs don't drain while the world is closed
  $('maintText').textContent = text || 'Pocket Life is being updated. It will be back in a few minutes.';
  $('maint').hidden = false;
}
function hideMaintenance() {
  if (!maint.on) return;
  maint.on = false; paused = false; $('maint').hidden = true;
}
// the dot by the time: green online (with how many), orange connecting, grey offline
function setNet(state, n) {
  $('netLine').dataset.state = state;
  $('netText').textContent = state === 'online' ? `${n || 1} online` : state === 'connecting' ? 'Connecting…' : 'Offline';
  if (ui.mode === 'menu') drawMenu();
}
// feedback from the Menu: goes to the server (and on to the admin page), with the version and device
const HTTP_BASE = SERVER.replace(/^ws/, 'http').replace(/\/world$/, '');
function openFeedback() { closePause(); $('feedback').hidden = false; $('feedbackText').value = ''; $('feedbackText').focus(); }
function closeFeedback() { $('feedback').hidden = true; $('feedbackText').blur(); }
$('feedbackCancel').addEventListener('click', closeFeedback);
$('feedbackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('feedbackText').value.trim().slice(0, 1000);
  closeFeedback();
  if (!text) return;
  const note = { t: 'feedback', text, v: `${VERSION}${TEST_BUILD ? ` test ${DATA.build}` : ''}`, device: navigator.userAgent.slice(0, 200),
    x: player ? Math.round(player.position.x) : null, z: player ? Math.round(player.position.z) : null, name: you.look ? you.look.name : '' };
  if (online()) { net.sock.send(JSON.stringify(note)); return; }
  try {
    await fetch(`${HTTP_BASE}/feedback?world=live`, { method: 'POST', body: JSON.stringify(note), headers: { 'Content-Type': 'text/plain' } });
    showTag('Thanks for the feedback!', headTop(), 2.5);
  } catch (err) { showTag("Couldn't send it, try again later", headTop(), 2.5); }
});
// What's new: the dev log from game-data.json, newest first
function openNews() {
  closePause();
  paused = true;
  const rows = (DATA.devlog || []).map((v, i) => {
    const el = document.createElement('details');
    el.className = 'admin-entry news-entry';
    el.open = i === 0;
    const h = document.createElement('summary');
    h.className = 'admin-head';
    const date = v.date ? new Date(`${v.date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
    h.textContent = `v${v.version}${date ? ` · ${date}` : ''}${i ? ` · ${(v.notes || []).length} changes` : ''}`;
    const ul = document.createElement('ul');
    for (const n of v.notes || []) { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); }
    el.append(h, ul);
    return el;
  });
  $('newsBody').replaceChildren(...rows);
  $('news').hidden = false;
  $('newsBody').scrollTop = 0;
}
function closeNews() { $('news').hidden = true; paused = false; }
$('newsClose').addEventListener('click', closeNews);
for (const b of document.querySelectorAll('[data-gfx]')) b.addEventListener('click', () => applyGraphics(b.dataset.gfx));
// Report: pick a reason, add a note if you like. It goes to the server with what they said lately.
let reporting = null;
function openReport(o) {
  reporting = o;
  $('reportTitle').textContent = `Report ${o.title}`;
  $('reportNote').value = '';
  for (const b of document.querySelectorAll('[data-reason]')) b.setAttribute('aria-pressed', 'false');
  $('reportSend').disabled = true;
  $('report').hidden = false;
}
function closeReport() { $('report').hidden = true; reporting = null; $('reportNote').blur(); }
for (const b of document.querySelectorAll('[data-reason]')) b.addEventListener('click', () => {
  for (const x of document.querySelectorAll('[data-reason]')) x.setAttribute('aria-pressed', String(x === b));
  $('reportSend').disabled = false;
});
$('reportCancel').addEventListener('click', closeReport);
$('reportForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pick = document.querySelector('[data-reason][aria-pressed="true"]');
  const o = reporting;
  closeReport();
  if (!o || !pick) return;
  if (!online()) { showTag("You're offline, so it couldn't be sent", headTop(), 2.5); return; }
  net.sock.send(JSON.stringify({ t: 'report', id: o.id, reason: pick.dataset.reason, note: $('reportNote').value.trim().slice(0, 500) }));
});
