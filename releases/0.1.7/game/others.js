/* ---------- other people: joining and leaving, name tags, walking about, speech bubbles and chat ---------- */
// While the game is hidden (another app, the phone locked) it says goodbye, so your person goes "away"
// and starts looking after themselves straight away; coming back reconnects. A ping every 25 seconds
// tells the server the game is still here.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    net.hidden = true;
    try { sendTasks(); } catch (err) { /* closing */ } // what's left of your task list: your person carries on with it (moving.js)
    if (net.sock && net.sock.readyState === 1) { try { net.sock.send(JSON.stringify({ t: 'bye' })); } catch (err) { /* closing */ } }
    if (net.sock) { try { net.sock.close(); } catch (err) { /* closed */ } }
  } else {
    net.hidden = false;
    net.retry = 1000;
    goOnline();
  }
});
setInterval(() => { if (online() && !document.hidden) net.sock.send(JSON.stringify({ t: 'ping' })); }, 25000);
const online = () => net.sock && net.sock.readyState === 1 && net.myId;
// Everyone else in the world is kept as a small marker (where they are and which way they face). Their body is only built
// while they're one of the people being drawn (the nearest few: pickShown) and thrown away again when they aren't, so a
// world with a thousand people costs a phone no more than a world with thirty. (Found in the 23 Nov 2026 growth check:
// every person used to get a full body, about 19 meshes and 77 KB each, drawn or not.)
function addOther(p) {
  if (!p || !p.id || p.id === net.myId) return;
  removeOther(p.id);
  const mesh = new THREE.Group(); // the marker; showBody puts their body inside it
  let x = Number(p.x) || 0, z = Number(p.z) || 0;
  [x, z] = onDryLand(x, z); // never start in the pond or inside a tree or rock
  mesh.position.set(x, groundY(x, z), z);
  mesh.rotation.y = Number(p.ry) || 0;
  mesh.userData.label = p.name || 'Someone';
  mesh.visible = false;
  scene.add(mesh);
  const name = addLabel({ cls: 'name-tag', text: '', anchor: mesh.position, offset: V(0, 2.0, 0), gap: 0 });
  name.off = true; name.el.style.display = 'none'; // until they're picked to be drawn
  const o = { id: p.id, who: p.who || p.id, title: p.name || 'Someone', state: p.state || 'online', look: cleanLook({ ...p.look, name: p.name }), mesh, body: null,
    tx: x, tz: z, tr: mesh.rotation.y, phase: 0, name, bubble: null,
    speed: p.speed || null, due: p.ms ? elapsed + p.ms / 1000 : null, shown: false, sit: Array.isArray(p.sit) ? p.sit : null, soc: p.soc || null };
  shownAt = -1; // work out again who's drawn
  if (p.tx != null) Object.assign(o, { tx: p.tx, tz: p.tz });
  others.set(p.id, o);
  drawTag(o);
  poseOther(o);
}
// what someone is doing when they aren't just playing: the same words on name tags and in the Camp panel (society.js)
const PERSON_STATE_WORDS = { away: 'away', asleep: 'away, asleep', sleeping: 'asleep' };
// a name tag, with their camp (0.1.4) and "away" or "asleep" under it
function drawTag(o) {
  const el = o.name.el;
  o.name.bw = o.name.bh = 0;
  el.textContent = o.title;
  const state = PERSON_STATE_WORDS[o.state] || '';
  const line = [o.soc, state].filter(Boolean).join(' · ');
  if (line) {
    const sub = document.createElement('small');
    sub.className = 'tag-sub';
    sub.textContent = line;
    el.appendChild(sub);
  }
}
// walking along the pond's edge instead of into the water: sideways round its middle, then out onto dry ground
function roundThePond(x, z, ux, uz, step) {
  const rx = x - POND.x, rz = z - POND.z, rd = Math.hypot(rx, rz) || 1;
  let tx = -rz / rd, tz = rx / rd;
  if (tx * ux + tz * uz < 0) { tx = -tx; tz = -tz; }
  let nx = x + tx * step, nz = z + tz * step;
  for (let k = 0; k < 30 && heightAt(nx, nz) < WATER_Y + 0.1; k++) { nx += (rx / rd) * 0.1; nz += (rz / rd) * 0.1; }
  return [nx, nz];
}
// sleepers lie on the ground; people sitting by a fire sit (updateOthers holds them there)
function poseOther(o) {
  const lying = o.state === 'asleep' || o.state === 'sleeping';
  o.mesh.rotation.x = lying ? -Math.PI / 2 : 0;
  o.name.offset.y = lying ? 0.7 : o.sit ? 1.35 : 2.0;
}
// someone sat down by a fire, or got up
function setOtherSit(m) {
  const o = others.get(m.id);
  if (!o) return;
  if (m.off) {
    if (o.sit && o.mesh.userData.parts) unsitPose(o.mesh, o.mesh.userData.parts, groundY(o.mesh.position.x, o.mesh.position.z));
    o.sit = null;
    o.tx = o.mesh.position.x; o.tz = o.mesh.position.z;
  } else {
    o.sit = [m.fire, m.seat];
    o.speed = null; o.act = null; o.path = null;
  }
  poseOther(o);
}
function setOtherState(m) {
  const o = others.get(m.id);
  if (!o) return;
  o.state = m.state;
  if (m.x != null) [o.tx, o.tz] = onDryLand(m.x, m.z);
  if (m.state !== 'away') o.speed = null;
  if (m.state === 'online' && o.bubble) { removeLabel(o.bubble); o.bubble = null; }
  drawTag(o);
  poseOther(o);
}
// build someone's body (they're now one of the people drawn), or take it away again
function showBody(o, on) {
  const m = o.mesh;
  if (on && !o.body) {
    o.body = makePerson(o.look);
    m.scale.copy(o.body.scale); o.body.scale.set(1, 1, 1); // the marker carries their height, which the sitting and lying poses use
    m.userData.parts = o.body.userData.parts;
    m.add(o.body);
  } else if (!on && o.body) {
    m.remove(o.body);
    disposeMaterials(o.body);
    o.body = null;
    m.userData.parts = null;
  }
}
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  scene.remove(o.mesh);
  disposeMaterials(o.mesh);
  removeLabel(o.name);
  if (o.bubble) removeLabel(o.bubble);
  others.delete(id);
}
// other people glide to where the server says they are, legs moving while they walk
// Only the people nearest the middle of the view are drawn (and can be tapped), so a busy world stays smooth on a phone:
// 30 on High graphics, 20 on Medium, 12 on Low (GRAPHICS in camera.js).
const SHOW_PEOPLE = 30;
const peopleDrawn = () => (GRAPHICS[gfx] || {}).people || SHOW_PEOPLE;
let shownAt = -1;
function pickShown() {
  const c = controls.target, d2 = (o) => (o.mesh.position.x - c.x) ** 2 + (o.mesh.position.z - c.z) ** 2;
  const empty = ui.mode === 'menu' && menuRegion && !menuRegion.open; // looking at a world that isn't open yet: nobody there
  [...others.values()].sort((a, b) => d2(a) - d2(b)).forEach((o, i) => {
    const on = !empty && i < peopleDrawn();
    if (o.shown === on) return;
    o.shown = on;
    showBody(o, on);
    o.mesh.visible = on;
    for (const L of [o.name, o.bubble]) if (L) { L.off = !on; L.el.style.display = on ? '' : 'none'; }
  });
}
function updateOthers(dt) {
  if (elapsed - shownAt > 0.5 || elapsed < shownAt) { shownAt = elapsed; pickShown(); }
  for (const o of others.values()) {
    const m = o.mesh;
    if (!o.shown) { m.position.set(o.tx, groundY(o.tx, o.tz), o.tz); continue; } // not drawn: just keep them where they're heading
    // Someone walking (a player, or someone strolling while away) follows a route round things, like you do.
    // With a route they keep strictly to it; without one (none found yet) they try again every second.
    let gx = o.tx, gz = o.tz;
    if (o.speed) {
      const key = `${o.tx},${o.tz}`;
      if (o.pathKey !== key || (!o.path && elapsed > (o.retryAt || 0))) {
        o.pathKey = key;
        o.path = findPath(m.position.x, m.position.z, o.tx, o.tz);
        o.retryAt = elapsed + 1;
      }
      while (o.path && o.path.length > 1 && Math.hypot(o.path[0][0] - m.position.x, o.path[0][1] - m.position.z) < 0.25) o.path.shift();
      if (o.path && o.path.length) [gx, gz] = o.path[0];
      // no way there at all and they should have arrived by now: they're simply there (never through a tree)
      if (!o.path && o.due && elapsed > o.due + 2) { m.position.x = o.tx; m.position.z = o.tz; o.due = null; }
    }
    const dx = gx - m.position.x, dz = gz - m.position.z, d = Math.hypot(dx, dz);
    const P = m.userData.parts;
    if (o.sit && placed.has(o.sit[0]) && o.state !== 'asleep' && o.state !== 'sleeping') { // sitting by a fire
      const th = placed.get(o.sit[0]), [sx, sz] = seatSpot(th, o.sit[1]);
      m.position.x = o.tx = sx; m.position.z = o.tz = sz;
      m.rotation.y = Math.atan2(th.x - sx, th.z - sz);
      if (P) sitPose(m, P, groundY(sx, sz));
      continue;
    }
    if (o.state === 'asleep' || o.state === 'sleeping') { m.position.x = o.tx; m.position.z = o.tz; m.position.y = groundY(m.position.x, m.position.z) + 0.2; continue; }
    if (d > (o.speed ? 120 : 8)) { m.position.x = o.tx; m.position.z = o.tz; } // too far behind: jump there
    else if (d > 0.02) {
      // walkers keep their pace, a little quicker if the server says they're due somewhere (so a long way round
      // doesn't leave them behind); a player standing about is caught up quickly
      let pace = o.speed;
      if (o.speed && o.due) {
        let left = d;
        if (o.path) for (let k = 1; k < o.path.length; k++) left += Math.hypot(o.path[k][0] - o.path[k - 1][0], o.path[k][1] - o.path[k - 1][1]);
        pace = Math.min(o.speed * 2.5, Math.max(o.speed, left / Math.max(0.3, o.due - elapsed)));
      }
      const step = Math.min(d, (o.speed ? pace : Math.max(SETTINGS.walkSpeed * 1.15, d * 3)) * dt);
      const ux = dx / d, uz = dz / d;
      let nx = m.position.x + ux * step, nz = m.position.z + uz * step;
      // with no route yet, step round rocks, bushes and trees rather than through them
      const block = o.speed && !o.path && solidAt(nx, nz);
      if (block) {
        const ax = nx - block.x, az = nz - block.z, ad = Math.hypot(ax, az) || 1;
        let tx = -az / ad, tz = ax / ad;
        if (tx * ux + tz * uz < 0) { tx = -tx; tz = -tz; }
        [nx, nz] = outsideSolid(m.position.x + tx * step, m.position.z + tz * step);
      }
      if (o.speed && !o.path && heightAt(nx, nz) < WATER_Y + 0.1) [nx, nz] = roundThePond(m.position.x, m.position.z, ux, uz, step);
      m.position.x = nx;
      m.position.z = nz;
      m.rotation.y = lerpAngle(m.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
      o.phase += dt * (o.speed ? 6 : 9);
      if (P) setLegs(P, Math.sin(o.phase));
    } else {
      // arrived: someone away who walked to the pond or a bush drinks or picks for a moment
      if (o.then) { o.act = { pose: o.then === 'drink' ? 'kneel' : 'pick', seconds: 4, t0: elapsed }; o.then = null; }
      if (!o.act) m.rotation.y = lerpAngle(m.rotation.y, o.tr, Math.min(1, dt * 6));
      if (P && !o.act) setLegs(P, 0);
    }
    const ground = groundY(m.position.x, m.position.z);
    m.position.y = ground;
    if (o.act && P && !(d > 0.02 && o.speed)) { if (!animateAct(m, P, ground, o.act, dt)) o.act = null; }
  }
}
// Tell the server where you're going: once when a walk starts (with where it ends, tx and tz), every couple of
// seconds while walking, and when you stop or turn. Everyone else's game walks you along the route itself.
// This sends about a tenth of the messages of sending every step, which keeps the server inside Cloudflare's free plan.
function sendMove() {
  if (!online() || !player) return;
  const x = player.position.x, z = player.position.z, ry = player.rotation.y;
  const goal = walk.target ? [Math.round(walk.target.x * 100) / 100, Math.round(walk.target.z * 100) / 100] : null;
  const l = net.last;
  const newGoal = goal && (!l || !l.goal || l.goal[0] !== goal[0] || l.goal[1] !== goal[1] || l.slow !== slowness());
  const stopped = !goal && l && l.goal;
  if (!newGoal && !stopped) {
    if (goal) { if (elapsed - net.sentAt < 2.5) return; } // walking: now and then, where you've got to
    else if (elapsed - net.sentAt < 0.5 || (l && Math.hypot(x - l.x, z - l.z) < 0.05 && Math.abs(ry - l.ry) < 0.15)) return; // standing: only when moved or turned
  }
  net.sentAt = elapsed;
  net.last = { x, z, ry, goal, slow: slowness() };
  net.sock.send(JSON.stringify({ t: 'move', x, z, ry, ...(goal ? { tx: goal[0], tz: goal[1], sp: Math.round(100 / slowness()) / 100 } : {}) }));
}
// Someone else moved. A walk comes with where they're going (tx, tz) and their game walks them there along the
// same kind of route; if they've drifted far from where they really are, they jump there.
function heardMove(o, m) {
  const p = o.mesh.position;
  if (Math.hypot(p.x - m.x, p.z - m.z) > 3) { p.x = m.x; p.z = m.z; o.pathKey = null; }
  if (m.tx != null) Object.assign(o, { tx: m.tx, tz: m.tz, speed: SETTINGS.walkSpeed * (m.sp > 0 && m.sp <= 1 ? m.sp : 1), then: null, act: null });
  else Object.assign(o, { tx: m.x, tz: m.z, tr: m.ry, speed: null });
}
// speech bubbles: what you say shows over your head for everyone nearby
function bubble(o, text) {
  const anchor = o ? o.mesh.position : player.position;
  if (o && o.bubble) removeLabel(o.bubble);
  if (!o && net.myBubble) removeLabel(net.myBubble);
  const L = addLabel({ cls: 'bubble', text, anchor, offset: V(0, o ? 2.35 : 2.0, 0), ttl: 7, gap: 4, who: o || null });
  if (o) o.bubble = L; else net.myBubble = L;
}
// Chat: the Say button opens a chat bar along the bottom (just above the keyboard), with the last few things
// people said above it. Speech bubbles still show over everyone's heads.
const chatLines = [];
function addChat(name, text, mine) {
  chatLines.push({ name, text, mine });
  if (chatLines.length > 30) chatLines.shift();
  if (!$('chat').hidden) drawChat();
}
function drawChat() {
  $('chatLog').replaceChildren(...chatLines.slice(-6).map((l) => {
    const li = document.createElement('li');
    if (l.mine) li.className = 'mine';
    const who = document.createElement('b');
    who.textContent = l.name;
    li.append(who, ` ${l.text}`);
    return li;
  }));
}
// keep the chat bar just above the phone's keyboard
function placeChat() {
  const vv = window.visualViewport;
  const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  $('chat').style.bottom = `calc(${Math.round(lift) + 10}px + env(safe-area-inset-bottom, 0px))`;
}
if (window.visualViewport) { visualViewport.addEventListener('resize', () => { if (!$('chat').hidden) placeChat(); }); visualViewport.addEventListener('scroll', () => { if (!$('chat').hidden) placeChat(); }); }
function openSay() {
  if (ui.mode !== 'world' || !player || you.dead) return;
  closeMenu();
  closeBag();
  closeCraft();
  hideHint();
  drawChat();
  $('chat').hidden = false;
  app.classList.add('chatting');
  placeChat();
  $('sayInput').value = '';
  $('sayInput').focus();
}
function closeSay() { $('chat').hidden = true; app.classList.remove('chatting'); $('sayInput').blur(); }
$('sayBtn').addEventListener('click', () => ($('chat').hidden ? openSay() : closeSay()));
$('sayBox').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('sayInput').value.trim();
  $('sayInput').value = ''; // the chat stays open for the next line; tap the world or Escape to put it away
  const text = raw.slice(0, 80);
  if (!text) { closeSay(); return; }
  if (online()) net.sock.send(JSON.stringify({ t: 'say', text }));
  else bubble(null, starText(text, FILTER)); // offline: you still see it yourself
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ui.mode === 'world' && !paused && !typing(e.target) && $('chat').hidden) { e.preventDefault(); openSay(); }
});
