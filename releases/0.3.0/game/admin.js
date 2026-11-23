/* ---------- the admin player (Luke) ----------
   Type "/admin" and the code in the Say box once; the phone remembers it. "/admin off" forgets it.
   The code itself is a Cloudflare secret (ADMIN_CODE), so it never sits in the game's files.
   Menu > Admin opens the Admin panel, with tabs: Server (maintenance, messages, speed), Players (find someone and
   open their page), Inbox (feedback and reports), World (counts, regrow, clear, reset) and Settings (live numbers).
   Single things are moved, regrown and removed from their own tap menus, under Admin. */
const ADMIN_KEY = 'pocket-life:admin', ADMIN_TAG_KEY = 'pocket-life:adminTag';
const admin = { on: false, code: '', tag: true, maintenance: false, message: '', live: [] };
try { admin.code = localStorage.getItem(ADMIN_KEY) || ''; admin.tag = localStorage.getItem(ADMIN_TAG_KEY) !== 'off'; } catch (err) { /* none */ }
const adminSend = (msg) => { if (online()) net.sock.send(JSON.stringify(msg)); else showTag("You're offline", headTop(), 2); };
const tagText = (name, badge) => (badge ? `${name} · Admin` : name);
function adminCommand(arg) {
  if (/^off$/i.test(arg)) {
    try { localStorage.removeItem(ADMIN_KEY); } catch (err) { /* none */ }
    admin.code = ''; admin.on = false; drawAdmin();
    showTag('Admin off on this phone', headTop(), 2.5);
    if (net.sock) net.sock.close(); // rejoin as a normal player
    return;
  }
  if (!arg) { showTag(admin.on ? 'You are the admin' : 'Type /admin and your code', headTop(), 2.5); return; }
  admin.code = arg;
  if (online()) net.sock.send(JSON.stringify({ t: 'adminLogin', code: arg }));
  else showTag("You're offline, try again when the dot is green", headTop(), 2.5);
}
function adminMessage(m) {
  if (m.t === 'admin' || m.t === 'adminDone') {
    const was = admin.on;
    Object.assign(admin, { on: true, tag: m.tag, maintenance: m.maintenance, message: m.message || '' });
    if (m.usage) admin.usage = m.usage;
    if (m.live) admin.live = m.live;
    if ('speed' in m) timeSpeed = m.speed && m.speed.until > Date.now() ? m.speed : null;
    try { localStorage.setItem(ADMIN_KEY, admin.code); } catch (err) { /* full */ }
    drawAdmin();
    if (!was) { showTag('Admin on. Open the Menu for admin tools', headTop(), 3); adminSend({ t: 'a.list' }); } // (the list: for the Inbox count on the Admin button)
    if (m.text) showTag(m.text, headTop(), 2.5);
  } else if (m.t === 'adminNo') {
    try { localStorage.removeItem(ADMIN_KEY); } catch (err) { /* none */ }
    admin.code = ''; admin.on = false; drawAdmin();
    showTag("That code didn't work", headTop(), 2.5);
  } else if (m.t === 'adminList') { inboxData = m; drawInbox(); }
  else if (m.t === 'adminPlayers') { playersData = m; drawPlayers(); }
  else if (m.t === 'adminPlayer') { playerData = m; if (adminTab === 'player') drawPlayer(); }
  else if (m.t === 'adminNew') { // new feedback or a report just came in: the Inbox count goes up straight away
    adminSend({ t: 'a.list' });
    if (player && ui.mode === 'world') showTag(m.list === 'reports' ? 'New report in your Inbox' : 'New feedback in your Inbox', headTop(), 3);
  }
  else if (m.t === 'announce') announce(m.text);
  else if (m.t === 'badge') { const o = others.get(m.id); if (o) { o.badge = m.on; drawTag(o); } }
  else if (m.t === 'kicked' || m.t === 'banned') {
    net.stopped = true;
    showMaintenance(m.t === 'kicked' ? 'You were removed from the world by the admin. Reload the page to join again.' : "You can't join this world.",
      m.t === 'kicked' ? 'Removed' : 'Not allowed', '');
  } else if (m.t === 'reset') showTag('The world was reset', headTop(), 3);
}
// a banner across everyone's screen
let bannerTimer = null;
function announce(text) {
  $('announceText').textContent = text;
  $('announce').hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('announce').hidden = true; }, 10000);
}
$('announce').addEventListener('click', () => { $('announce').hidden = true; });
// jump straight somewhere (stops whatever you were doing)
function teleportTo(x, z) {
  stopQueue();
  const L = WALK_LIMIT - 0.5;
  x = Math.max(-L, Math.min(L, x)); z = Math.max(-L, Math.min(L, z));
  [x, z] = onDryLand(x, z);
  player.position.set(x, groundY(x, z), z);
  net.last = null;
}

/* ---------- live settings (Settings tab): the server sends the numbers it changed, and the game uses them too ---------- */
const BERRY_SOURCE = () => Object.values(SOURCES).find(harvests);
const LIVE_SET = {
  maxPlaying: (v) => { SETTINGS.maxPlaying = v; },
  respawnMinutes: (v) => { SETTINGS.respawnMinutes = v; },
  berryRegrowHours: (v) => { const s = BERRY_SOURCE(); if (s && s.regrowHours !== v) { s.regrowHours = v; for (const b of berryBushes) { b.userData.shown = -1; drawBerries(b); } } },
  treeRegrowDays: (v) => { CHOP.regrowDays = v; },
  boulderRegrowDays: (v) => { MINE.regrowDays = v; },
  rockBackHours: (v) => { MINE.rockBackHours = v; },
  hungerPerHour: (v) => { if (STAT.hunger) STAT.hunger.perHour = -v; },
  thirstPerHour: (v) => { if (STAT.thirst) STAT.thirst.perHour = -v; },
  restPerHour: (v) => { if (STAT.rest) STAT.rest.perHour = -v; },
};
const LIVE_BASE = { maxPlaying: SETTINGS.maxPlaying, respawnMinutes: SETTINGS.respawnMinutes, berryRegrowHours: (BERRY_SOURCE() || {}).regrowHours,
  treeRegrowDays: CHOP.regrowDays ?? 3, boulderRegrowDays: MINE.regrowDays ?? 3, rockBackHours: MINE.rockBackHours ?? 4,
  hungerPerHour: -((STAT.hunger || {}).perHour || 0), thirstPerHour: -((STAT.thirst || {}).perHour || 0), restPerHour: -((STAT.rest || {}).perHour || 0) };
function applyLive(live) {
  if (you.stats && !you.dead) tickStats(); // needs up to now at the old rate first
  for (const [id, set] of Object.entries(LIVE_SET)) { const v = live && live[id] != null ? live[id] : LIVE_BASE[id]; if (v != null) set(v); }
}

/* ---------- Admin in the tap menus ---------- */
const adminMore = (acts) => (acts.length ? [{ label: 'Admin', admin: true, sub: acts }] : []); // admin: always shown (showActs)
const sure = (label, run, note = '') => ({ label, note, sub: [{ label: `Yes, ${label.toLowerCase()}`, run }] }); // asks once more first
function adminPersonActions(o) {
  if (!admin.on) return [];
  return [{ label: 'Open their page', run: () => openPlayerPage(o.id) },
    { label: 'Teleport to them', run: () => teleportTo(o.mesh.position.x + 1, o.mesh.position.z) },
    { label: 'Fill their needs', run: () => adminSend({ t: 'a.fill', id: o.id }) },
    { label: 'Mute for everyone', note: 'Unmute on their page', run: () => adminSend({ t: 'a.mute', id: o.id, on: true }) },
    { label: 'Kick', run: () => adminSend({ t: 'a.kick', id: o.id }) },
    sure('Ban', () => adminSend({ t: 'a.ban', id: o.id }), 'Keeps this phone out')];
}
function adminGroundActions(p) {
  if (!admin.on || !p) return [];
  return [{ label: 'Add item', note: 'Pick from a list', run: () => openPicker('Add item', (kind, n) => adminSend({ t: 'a.add', kind, n, x: p.x, z: p.z })) },
    { label: 'Teleport here', run: () => teleportTo(p.x, p.z) }];
}
// a tree, rock or berry bush laid out with the world (what: tree | rock | bush, i: its number); grown: there's something to grow back
function adminThingActions(what, i, grown) {
  if (!admin.on) return [];
  const regrow = { tree: 'Grow back into a tree', rock: 'Grow back', bush: 'Fill with berries' }[what];
  return [{ label: 'Move', note: 'Then tap where it goes', run: () => startMove({ what, idx: i }) },
    ...(grown ? [{ label: regrow, run: () => adminSend({ t: 'a.regrow', what, idx: i }) }] : []),
    sure('Remove', () => adminSend({ t: 'a.remove', what, idx: i }), 'Gone for good')];
}
function adminPlacedActions(th) {
  if (!admin.on) return [];
  const F = PLACEABLES[th.kind] && PLACEABLES[th.kind].fire;
  return [{ label: 'Move', note: 'Then tap where it goes', run: () => startMove({ what: 'placed', id: th.id }) },
    ...(F && th.built ? [{ label: 'Fill with fuel', run: () => adminSend({ t: 'a.regrow', what: 'placed', id: th.id }) }] : []),
    sure('Remove', () => adminSend({ t: 'a.remove', id: th.id }))];
}
// Move: the next tap on the ground is where it goes (a tap anywhere else stops)
let adminMoving = null;
function startMove(m) { adminMoving = m; showTag('Tap where it goes', headTop(), 3); }
function adminMoveTap() {
  const m = adminMoving;
  adminMoving = null;
  ray.setFromCamera(ndc, camera);
  const g = ray.intersectObject(terrain, false)[0];
  if (!g) { showTag('Move stopped', headTop(), 2); return; }
  const L = WALK_LIMIT - 0.5, x = Math.max(-L, Math.min(L, g.point.x)), z = Math.max(-L, Math.min(L, g.point.z));
  if (pondShape(x, z) < 1) { showTag("Can't go in the pond", headTop(), 2); return; }
  adminSend({ t: 'a.move', ...m, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
}

/* ---------- the item picker: Add item (on the ground) and Give (into someone's bag) ---------- */
const itemGroup = itemGroupOf; // rules.js: the same kinds as Craft
const picker = { group: 'All', n: 1, onPick: null };
function openPicker(title, onPick) {
  picker.onPick = onPick;
  $('adminPickTitle').textContent = title;
  $('adminPickFind').value = '';
  drawPicker();
  $('adminPick').hidden = false;
}
function closePicker() { $('adminPick').hidden = true; picker.onPick = null; }
function drawPicker() {
  const groups = ['All', ...ITEM_GROUPS.filter((g) => Object.values(ITEMS).some((it) => itemGroup(it) === g))];
  if (!groups.includes(picker.group)) picker.group = 'All';
  chips($('adminPickKinds'), groups.map((g) => [g, g]), picker.group, (g) => { picker.group = g; drawPicker(); });
  chips($('adminPickCount'), [[1, '1'], [5, '5'], [10, '10']], picker.n, (n) => { picker.n = n; drawPicker(); });
  const q = $('adminPickFind').value.trim().toLowerCase();
  const list = Object.values(ITEMS).filter((it) => (picker.group === 'All' || itemGroup(it) === picker.group) && (!q || it.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  $('adminPickList').replaceChildren(...(list.length ? list.map((it) => button(it.name, () => { const f = picker.onPick, n = picker.n; closePicker(); if (f) f(it.id, n); }))
    : [emptyNote('Nothing called that')]));
}
$('adminPickFind').addEventListener('input', drawPicker);
$('adminPickClose').addEventListener('click', closePicker);

/* ---------- small pieces for the panel ---------- */
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (label, run, cls = 'small-btn') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', run); return b; };
const emptyNote = (text) => el('p', 'admin-empty', text);
// a row of choices: options are [value, label]
function chips(box, options, current, choose) {
  box.replaceChildren(...options.map(([v, label]) => {
    const b = button(label, () => choose(v), 'seg-btn');
    b.setAttribute('aria-pressed', String(v === current));
    return b;
  }));
}
// one entry in a list: a heading line, some text, and buttons ([label, run])
function entry(head, body, buttons = [], cls = '') {
  const e = el('div', `admin-entry ${cls}`.trim());
  if (head) e.appendChild(head instanceof Node ? head : el('div', 'admin-head', head));
  if (body) e.appendChild(el('div', 'admin-body', body));
  if (buttons.length) { const bar = el('div', 'admin-btns'); for (const [label, run] of buttons) bar.appendChild(button(label, run)); e.appendChild(bar); }
  return e;
}
// a button that needs a second tap within a few seconds (for things that can't be undone)
function twoTaps(btn, run, again = 'Tap again to be sure') {
  const label = btn.textContent;
  let armed = null;
  const reset = () => { clearTimeout(armed); armed = null; btn.textContent = label; };
  btn.addEventListener('click', () => {
    if (!armed) { btn.textContent = again; armed = setTimeout(reset, 4000); return; }
    reset(); run();
  });
  return reset;
}
const when = (t) => { try { return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (err) { return ''; } };
const minsLeft = (until) => Math.max(1, Math.round((until - Date.now()) / 60000));

/* ---------- the panel and its tabs ---------- */
let adminTab = 'server', playersData = null, playerData = null, inboxData = null;
function openAdminPanel() {
  closePause(); paused = true;
  adminSend({ t: 'a.state' });
  adminSend({ t: 'a.list' }); // for the Inbox count
  $('adminPanel').hidden = false;
  showAdminTab(adminTab === 'player' ? 'players' : adminTab);
}
function closeAdminPanel() { $('adminPanel').hidden = true; paused = false; resetDanger(); }
function adminEscape() { if (adminTab === 'player') showAdminTab('players'); else closeAdminPanel(); }
function showAdminTab(tab) {
  adminTab = tab;
  for (const b of document.querySelectorAll('[data-admin-tab]')) b.setAttribute('aria-pressed', String(b.dataset.adminTab === (tab === 'player' ? 'players' : tab)));
  for (const p of document.querySelectorAll('[data-admin-page]')) p.hidden = p.dataset.adminPage !== tab;
  if (tab === 'players') findPlayers();
  if (tab === 'inbox') drawInbox();
  if (tab === 'world') drawCounts();
  if (tab === 'settings') drawSettings();
  if (tab === 'player') drawPlayer();
}
for (const b of document.querySelectorAll('[data-admin-tab]')) b.addEventListener('click', () => showAdminTab(b.dataset.adminTab));
$('pauseAdminBtn').addEventListener('click', openAdminPanel);
$('adminClose').addEventListener('click', closeAdminPanel);
function drawAdmin() {
  $('pauseAdminBtn').hidden = !admin.on;
  if (!admin.on) { $('adminPanel').hidden = true; $('adminPick').hidden = true; return; }
  $('adminMaintState').textContent = admin.maintenance ? 'On: release-link players see Back soon' : 'Off';
  $('adminMaintBtn').textContent = admin.maintenance ? 'Turn off' : 'Turn on';
  if (document.activeElement !== $('adminMaintText')) $('adminMaintText').value = admin.message || '';
  $('adminTagBtn').textContent = admin.tag ? 'Admin tag: on' : 'Admin tag: off';
  // today's use of Cloudflare's free plan (it resets at 9:30 am Darwin time); past 80% shows red
  const u = admin.usage;
  if (u) {
    const pct = Math.max(u.requests, u.writes);
    $('adminUsage').textContent = `Server today: ${pct}% of the free limit · ${u.playing}/${u.max} playing${u.waiting ? ` · ${u.waiting} waiting` : ''}`;
    $('adminUsage').classList.toggle('warn', pct >= 80);
  }
  drawSpeed();
  // the Settings tab shows the new numbers, unless you're in the middle of typing one
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT' && $('adminSettings').contains(document.activeElement);
  if (adminTab === 'settings' && !$('adminPanel').hidden && !typing) drawSettings();
}

/* ---------- Server tab ---------- */
$('adminMaintBtn').addEventListener('click', () => adminSend({ t: 'a.maintenance', on: !admin.maintenance, text: $('adminMaintText').value }));
$('adminAnnounceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('adminAnnounceText').value.trim();
  if (!text) return;
  adminSend({ t: 'a.announce', text });
  $('adminAnnounceText').value = '';
});
const speedPick = { x: 60, mins: 10 };
function drawSpeed() {
  const fast = timeSpeed && timeSpeed.until > Date.now();
  $('adminSpeedState').textContent = fast ? `${timeSpeed.x}x for ${minsLeft(timeSpeed.until)} more min` : 'Normal';
  chips($('adminSpeedX'), [[10, '10x'], [60, '60x'], [600, '600x']], speedPick.x, (x) => { speedPick.x = x; drawSpeed(); });
  chips($('adminSpeedMins'), [[5, '5 min'], [10, '10 min'], [30, '30 min'], [60, '1 hour']], speedPick.mins, (m) => { speedPick.mins = m; drawSpeed(); });
  $('adminSpeedBtn').textContent = fast ? 'Back to normal' : `Start ${speedPick.x}x for ${speedPick.mins === 60 ? '1 hour' : `${speedPick.mins} min`}`;
}
$('adminSpeedBtn').addEventListener('click', () => {
  const fast = timeSpeed && timeSpeed.until > Date.now();
  adminSend({ t: 'a.speed', x: fast ? 1 : speedPick.x, minutes: speedPick.mins });
});
$('adminTagBtn').addEventListener('click', () => {
  admin.tag = !admin.tag;
  try { localStorage.setItem(ADMIN_TAG_KEY, admin.tag ? 'on' : 'off'); } catch (err) { /* full */ }
  adminSend({ t: 'a.tag', on: admin.tag });
  drawAdmin();
});

/* ---------- Players tab: search by name, filters, tap someone for their page ---------- */
let showPlayers = 'all', findTimer = null;
function findPlayers() { adminSend({ t: 'a.players', q: $('adminFind').value.trim(), show: showPlayers }); drawPlayers(); }
$('adminFind').addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(findPlayers, 300); });
const STATE_WORDS = { online: 'playing', away: 'away', asleep: 'asleep', gone: 'gone' };
function drawPlayers() {
  const d = playersData || { rows: [], counts: {}, total: 0 }, c = d.counts || {};
  chips($('adminShow'), [['all', 'All'], ['online', 'Online'], ['away', 'Away'], ['asleep', 'Asleep'], ['muted', 'Muted'], ['banned', 'Banned']]
    .map(([v, l]) => [v, c[v] != null ? `${l} ${c[v]}` : l]), showPlayers, (v) => { showPlayers = v; findPlayers(); });
  if (!playersData) { $('adminPlayers').replaceChildren(emptyNote('Loading…')); return; }
  const rows = d.rows.map((r) => {
    const tags = [STATE_WORDS[r.state] || r.state, r.age != null ? `${r.age} yrs` : '', r.muted ? 'muted' : '', r.banned ? 'banned' : '', r.id === net.myId ? 'you' : ''].filter(Boolean).join(' · ');
    const head = el('div');
    head.append(el('div', 'admin-name', r.name), el('div', 'admin-tag', tags));
    const e = entry(head, '', [], 'tap');
    e.addEventListener('click', () => openPlayerPage(r.id));
    return e;
  });
  if (d.total > d.rows.length) rows.push(emptyNote(`Showing ${d.rows.length} of ${d.total}. Search to find others.`));
  $('adminPlayers').replaceChildren(...(rows.length ? rows : [emptyNote(d.q ? 'Nobody called that' : 'Nobody here')]));
}

/* ---------- someone's page: stats, bag, give and take, past people, and what can be done ---------- */
function openPlayerPage(id) {
  if ($('adminPanel').hidden) { closePause(); paused = true; $('adminPanel').hidden = false; adminSend({ t: 'a.state' }); }
  if (!playerData || playerData.id !== id) playerData = { id, loading: true };
  adminSend({ t: 'a.player', id });
  showAdminTab('player');
}
const refreshPlayer = () => { if (playerData) adminSend({ t: 'a.player', id: playerData.id }); };
const toPlayer = (msg) => { adminSend(msg); refreshPlayer(); }; // the server answers in order, so the page comes back fresh
$('adminPlayerBack').addEventListener('click', () => showAdminTab('players'));
function drawPlayer() {
  const p = playerData, box = $('adminPlayer');
  if (!p || p.loading) { box.replaceChildren(emptyNote('Loading…')); return; }
  const out = [], alive = p.state !== 'gone', you2 = p.id === net.myId;
  const head = el('div');
  head.append(el('div', 'admin-name', p.name),
    el('div', 'admin-tag', [STATE_WORDS[p.state] || p.state, p.age != null ? `${p.age} yrs` : '', p.v ? `v${p.v} ${p.link} link` : '', p.muted ? 'muted' : '', p.banned ? 'banned' : '',
      p.reports ? `${p.reports} ${p.reports === 1 ? 'report' : 'reports'}` : ''].filter(Boolean).join(' · ')));
  out.push(entry(head));
  if (alive && p.stats) { // needs, as bars
    const sec = el('div', 'admin-entry');
    for (const s of STATS) {
      if (p.stats[s.id] == null) continue;
      const v = Math.round(p.stats[s.id]), row = el('div', 'admin-stat'), bar = el('i'), fill = el('b');
      fill.style.width = `${Math.max(0, Math.min(100, v))}%`; fill.style.background = s.colour;
      bar.appendChild(fill);
      row.append(el('span', '', s.name), bar, el('span', '', String(v)));
      sec.appendChild(row);
    }
    out.push(sec);
  }
  if (alive) { // the bag: take things out, or give more
    const kinds = Object.entries(p.carry || {}).filter(([k, n]) => n > 0 && ITEMS[k]);
    const bag = entry('Bag', kinds.length ? '' : 'Empty');
    for (const [k, n] of kinds) {
      const row = el('div', 'admin-row'), btns = el('div', 'admin-btns');
      btns.append(button('Take 1', () => adminSend({ t: 'a.take', id: p.id, kind: k, n: 1 })), ...(n > 1 ? [button('Take all', () => adminSend({ t: 'a.take', id: p.id, kind: k, n }))] : []));
      row.append(el('span', 'admin-body', countLabel(k, n)), btns);
      bag.appendChild(row);
    }
    const give = el('div', 'admin-btns');
    give.appendChild(button('Give items', () => openPicker(`Give ${p.name}`, (kind, n) => adminSend({ t: 'a.give', id: p.id, kind, n }))));
    bag.appendChild(give);
    out.push(bag);
  }
  const acts = [];
  if (alive && !you2 && p.x != null) acts.push(['Teleport to', () => { closeAdminPanel(); teleportTo(p.x + 1, p.z); }]);
  if (alive) acts.push(['Fill needs', () => toPlayer({ t: 'a.fill', id: p.id })]);
  if (!you2) acts.push([p.muted ? 'Unmute' : 'Mute', () => toPlayer({ t: 'a.mute', id: p.id, on: !p.muted })]);
  if (p.state === 'online' && !you2) acts.push(['Kick', () => toPlayer({ t: 'a.kick', id: p.id })]);
  if (p.state === 'asleep') acts.push(['Wake up', () => toPlayer({ t: 'a.wake', id: p.id })]);
  if (p.state === 'away') acts.push(['Send to sleep', () => toPlayer({ t: 'a.sleep', id: p.id })]);
  if (acts.length) out.push(entry('', '', acts));
  const careful = el('div', 'admin-entry');
  const bar = el('div', 'admin-btns');
  if (!you2) {
    const ban = button(p.banned ? 'Unban' : 'Ban', () => {});
    if (p.banned) ban.addEventListener('click', () => toPlayer({ t: 'a.unban', who: p.id }));
    else twoTaps(ban, () => toPlayer({ t: 'a.ban', id: p.id }), 'Tap again to ban');
    bar.appendChild(ban);
  }
  if (alive && p.state !== 'online') { const rm = button('Remove from world', () => {}); twoTaps(rm, () => toPlayer({ t: 'a.removePerson', id: p.id }), 'Tap again: drops their things'); bar.appendChild(rm); }
  if (bar.children.length) { careful.appendChild(bar); out.push(careful); }
  if ((p.past || []).length) out.push(entry('Past people', p.past.map((q) => `${q.name}, ${q.age} · ${q.cause === 'left' ? 'left' : q.cause ? `died (${q.cause})` : 'died'}${q.until ? ` · ${when(q.until)}` : ''}`).join('\n')));
  box.replaceChildren(...out);
}

/* ---------- Inbox tab: feedback and reports; Done ones are kept 30 days ---------- */
let inboxList = 'feedback', inboxDone = false;
const newCount = (list) => ((inboxData || {})[list] || []).filter((x) => !x.done).length;
function drawInbox() {
  const n = newCount('feedback') + newCount('reports');
  const tab = document.querySelector('[data-admin-tab="inbox"]');
  if (tab) tab.textContent = n ? `Inbox ${n}` : 'Inbox';
  $('pauseAdminBtn').textContent = n ? `Admin · ${n} new` : 'Admin'; // the Menu's Admin button says when there's something new
  if (adminTab !== 'inbox') return;
  chips($('adminInboxShow'), [['feedback', `Feedback ${newCount('feedback')}`], ['reports', `Reports ${newCount('reports')}`], ['done', inboxDone ? 'Hide done' : 'Show done']],
    inboxList, (v) => { if (v === 'done') inboxDone = !inboxDone; else inboxList = v; drawInbox(); });
  if (!inboxData) { $('adminInbox').replaceChildren(emptyNote('Loading…')); return; }
  const list = (inboxData[inboxList] || []).filter((x) => inboxDone || !x.done);
  const mark = (x) => [x.done ? 'Not done' : 'Done', () => adminSend({ t: 'a.done', list: inboxList, at: x.at, on: !x.done })];
  const del = (x) => ['Delete', () => adminSend({ t: 'a.delete', list: inboxList, at: x.at })];
  const rows = list.map((x) => {
    if (inboxList === 'feedback') return entry(`${when(x.at)} · ${x.name || 'Someone'} · v${x.v}`, x.text, [mark(x), del(x)], x.done ? 'done' : '');
    const said = (x.said || []).map(([, t]) => `"${t}"`).join('  ');
    return entry(`${when(x.at)} · ${x.by.name} reported ${x.about.name} · ${x.reason}`, [x.note, said && `They said: ${said}`].filter(Boolean).join('\n'),
      [mark(x), ['Their page', () => openPlayerPage(x.about.who)], del(x)], x.done ? 'done' : '');
  });
  $('adminInbox').replaceChildren(...(rows.length ? rows : [emptyNote(inboxDone ? 'Nothing here yet.' : 'All done')]));
}

/* ---------- World tab: what's in the world, and changes to all of it ---------- */
function drawCounts() {
  const n = (list, f) => list.filter(f).length;
  const bushes = berryBushes.filter((b) => !b.userData.removed);
  const kinds = {};
  for (const it of world.items) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
  const loose = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c} ${c === 1 ? ITEMS[k].name.toLowerCase() : ITEMS[k].plural.toLowerCase()}`);
  const fires = {};
  for (const th of placed.values()) fires[th.kind] = (fires[th.kind] || 0) + 1;
  const lines = [
    ['Trees', `${n(trees, (t) => t.state === 'tree')}`], ['Tree stumps', `${n(trees, (t) => t.state === 'stump')}`],
    ['Boulders', `${n(rocks, (r) => r.boulder && r.state !== 'gone')} (${n(rocks, (r) => r.boulder && r.state === 'mined')} mined)`],
    ['Rocks', `${n(rocks, (r) => !r.boulder && r.state !== 'gone')} (${n(rocks, (r) => !r.boulder && r.state === 'gone')} broken)`],
    ['Berry bushes', `${bushes.length} (${n(bushes, (b) => berriesOn(b) < bushHolds(SOURCES[b.userData.source] || {}))} picked)`],
    ...Object.entries(fires).map(([k, c]) => [PLACEABLES[k] ? `${PLACEABLES[k].name}s` : k, String(c)]),
    ['Loose items', `${world.items.length}`]];
  const box = $('adminCounts');
  box.replaceChildren(...lines.flatMap(([a, b]) => [el('span', '', a), el('b', '', b)]));
  if (loose.length) { const s = el('span', 'admin-tag', loose.join(', ')); s.style.gridColumn = '1 / -1'; box.appendChild(s); }
}
$('adminRegrowBtn').addEventListener('click', () => { adminSend({ t: 'a.regrowAll' }); setTimeout(drawCounts, 800); });
$('adminClearNearBtn').addEventListener('click', () => { adminSend({ t: 'a.clear', near: true, x: player.position.x, z: player.position.z }); setTimeout(drawCounts, 800); });
const resetClearAll = twoTaps($('adminClearAllBtn'), () => { adminSend({ t: 'a.clear', near: false }); setTimeout(drawCounts, 800); }, 'Tap again: clear everything');
const resetReset = twoTaps($('adminResetBtn'), () => { adminSend({ t: 'a.reset' }); closeAdminPanel(); }, 'Tap again to reset everything');
function resetDanger() { resetClearAll(); resetReset(); }

/* ---------- Settings tab: live numbers (they stay until you tap Reset) ---------- */
function drawSettings() {
  const defs = DATA.liveSettings || [], now = Object.fromEntries((admin.live || []).map((s) => [s.id, s]));
  const out = [];
  let group = null;
  for (const d of defs) {
    const s = now[d.id];
    if (!s) continue;
    if (d.group !== group) { group = d.group; out.push(el('div', 'admin-head', group)); }
    const box = el('div', 'admin-entry admin-setting');
    const input = el('input', 'admin-input');
    Object.assign(input, { type: 'number', inputMode: 'decimal', min: d.min, max: d.max, step: d.step || 1, value: String(s.value) });
    const label = el('div');
    label.append(el('div', 'admin-body', d.name), el('div', 'admin-tag', `${s.changed ? 'Changed. ' : ''}Normal: ${s.base} ${d.unit || ''}`));
    const bar = el('div', 'admin-btns');
    bar.append(button('Save', () => { const v = Number(input.value); if (Number.isFinite(v)) adminSend({ t: 'a.live', id: d.id, value: v }); }),
      ...(s.changed ? [button('Reset', () => adminSend({ t: 'a.live', id: d.id, value: null }))] : []));
    box.append(label, input, bar);
    out.push(box);
  }
  $('adminSettings').replaceChildren(...(out.length ? out : [emptyNote('Loading…')]));
}
drawAdmin();
