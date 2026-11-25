/* ---------- the admin's tools (Luke) ----------
   The admin is not a person: admin mode is opened from the main menu (5 taps on the version number, then the password)
   and watches the world with a free camera (game/admin-mode.js). Nobody playing can be the admin, and there is no
   /admin in the Say box any more (23 Nov 2026). The password is a Cloudflare secret (ADMIN_CODE): it never sits in the
   game's files and is never kept on the device.
   This file holds the admin's tools and what the server tells everyone (announcements, being removed, resets). */
// Before 23 Nov 2026 the admin code was kept on the phone that typed /admin. It isn't any more: any copy left behind is deleted.
try { localStorage.removeItem('pocket-life:admin'); localStorage.removeItem('pocket-life:adminTag'); } catch (err) { /* none */ }
const admin = { on: false, maintenance: false, message: '', live: [] }; // on: admin mode is open (adminMode.on) and the server has said yes
// what a tool answers, and short notes: a line under the admin's bar (a note out in the world could sit behind a panel)
let adminToastTimer = null;
function adminSay(text, secs = 2.8) {
  if (!adminMode.on) { showTag(text, headTop(), 3); return; } // (a player hears some of this too, like a reset: a note in the world, as before)
  $('adminToast').textContent = text;
  $('adminToast').hidden = false;
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => { $('adminToast').hidden = true; }, secs * 1000);
}
const adminSend = (msg) => { if (online()) net.sock.send(JSON.stringify(msg)); else adminSay("You're offline"); };
function adminMessage(m) {
  if (m.t.startsWith('admin') && !adminMode.on) return; // admin news only means something while admin mode is open
  if (m.t === 'admin') { // the admin's numbers: sent on the way in, and as every tool's answer (with a few words in text)
    const was = admin.on;
    Object.assign(admin, { on: true, maintenance: m.maintenance, message: m.message || '' });
    if (m.usage) admin.usage = m.usage;
    if (m.live) admin.live = m.live;
    if ('speed' in m) timeSpeed = m.speed && m.speed.until > Date.now() ? m.speed : null;
    drawAdmin();
    if (!was) adminSend({ t: 'a.list' }); // (the list: for the Inbox count)
    if (m.text) adminSay(m.text);
    if (m.text && adminTab === 'log' && !$('adminPanel').hidden) adminSend({ t: 'a.log' }); // the Log is open: the line for what was just done shows
  } else if (m.t === 'adminItems') { itemsData = m.list || []; if (adminTab === 'items') drawItems(); }
  else if (m.t === 'adminFires') { firesData = m; if (adminTab === 'world') drawFires(); }
  else if (m.t === 'adminSocs') { socsData = m.list || []; if (adminTab === 'world') drawSocs(); }
  else if (m.t === 'adminLog') { logData = m.list || []; if (adminTab === 'log') drawLog(); }
  else if (m.t === 'adminList') { inboxData = m; drawInbox(); }
  else if (m.t === 'adminPlayers') { playersData = m; drawPlayers(); }
  else if (m.t === 'adminPlayer') { playerData = m; if (adminTab === 'player') drawPlayer(); }
  else if (m.t === 'adminNew') { // new feedback or a report just came in: the Inbox count goes up straight away
    adminSend({ t: 'a.list' });
    adminSay(m.list === 'reports' ? 'New report in the Inbox' : 'New feedback in the Inbox', 3.5);
  }
  else if (m.t === 'announce') announce(m.text);
  else if (m.t === 'kicked' || m.t === 'banned') {
    net.stopped = true;
    showMaintenance(m.t === 'kicked' ? 'You were removed from the world by the admin. Reload the page to join again.' : "You can't join this world.",
      m.t === 'kicked' ? 'Removed' : 'Not allowed', '');
  } else if (m.t === 'reset') {
    if (m.all) { stopQueue(); outbox.length = 0; } // your person is gone too: nothing left to do or send
    adminSay(m.all ? 'Everything was reset' : 'The world was reset', 4);
  } else if (m.t === 'adminRestore') restoreAnswer(m);
  else if (m.t === 'restoring') { // the admin is restoring the world: it restarts in a moment and everyone rejoins where the server has them
    stopQueue(); outbox.length = 0; net.restored = true;
    announce(m.text);
  }
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

/* ---------- live settings (Settings tab): the server sends the numbers it changed, and the game uses them too ---------- */
const BERRY_SOURCE = () => Object.values(SOURCES).find(harvests);
const LIVE_SET = {
  maxPlaying: (v) => { SETTINGS.maxPlaying = v; },
  societyMax: (v) => { SOCIETY.maxMembers = v; }, // (society.js; members are told the number with their society too)
  respawnMinutes: (v) => { SETTINGS.respawnMinutes = v; },
  berryRegrowHours: (v) => { const s = BERRY_SOURCE(); if (s && s.regrowHours !== v) { s.regrowHours = v; for (const b of berryBushes) { b.userData.shown = -1; drawBerries(b); } } },
  treeRegrowDays: (v) => { CHOP.regrowDays = v; },
  boulderRegrowDays: (v) => { MINE.regrowDays = v; },
  rockBackHours: (v) => { MINE.rockBackHours = v; },
  fadeDays: (v) => { SETTINGS.fadeDays = v; }, // (only the server uses it: server/src/nature.js fadeOld)
  hungerPerHour: (v) => { if (STAT.hunger) STAT.hunger.perHour = -v; },
  thirstPerHour: (v) => { if (STAT.thirst) STAT.thirst.perHour = -v; },
  restPerHour: (v) => { if (STAT.rest) STAT.rest.perHour = -v; },
};
const LIVE_BASE = { maxPlaying: SETTINGS.maxPlaying, societyMax: (DATA.societies || {}).maxMembers ?? 3, respawnMinutes: SETTINGS.respawnMinutes, berryRegrowHours: (BERRY_SOURCE() || {}).regrowHours,
  treeRegrowDays: CHOP.regrowDays ?? 3, boulderRegrowDays: MINE.regrowDays ?? 3, rockBackHours: MINE.rockBackHours ?? 4, fadeDays: SETTINGS.fadeDays ?? 7,
  hungerPerHour: -((STAT.hunger || {}).perHour || 0), thirstPerHour: -((STAT.thirst || {}).perHour || 0), restPerHour: -((STAT.rest || {}).perHour || 0) };
function applyLive(live) {
  if (you.stats && !you.dead) tickStats(); // needs up to now at the old rate first
  for (const [id, set] of Object.entries(LIVE_SET)) { const v = live && live[id] != null ? live[id] : LIVE_BASE[id]; if (v != null) set(v); }
}

/* ---------- live item and recipe numbers: the admin changes them, every game uses them (server/src/live-items.js) ----------
   An item's weight, a tool's uses, what a food fills, and how many of each thing a recipe needs and makes. The admin's
   number wins over game-data.json until it's reset, so the game keeps the file's numbers (LIVE_ITEMS_BASE) to go back to.
   Only numbers that are already there change: a change for something this build doesn't have is ignored. */
const LIVE_ITEMS_BASE = {
  items: Object.fromEntries(Object.entries(ITEMS).map(([k, it]) => [k, { weight: it.weight, uses: it.uses || 0, eat: { ...(it.eat || {}) } }])),
  recipes: Object.fromEntries(RECIPES.map((r) => [r.id, { needs: { ...r.needs }, makes: { ...r.makes } }])),
};
let liveItems = {}; // the admin's changes, as the server sent them
function applyLiveItems(live) {
  liveItems = live && typeof live === 'object' ? live : {};
  const num = (v, base) => (Number.isFinite(v) ? v : base);
  for (const [k, base] of Object.entries(LIVE_ITEMS_BASE.items)) {
    const it = ITEMS[k], mine = (liveItems.items || {})[k] || {};
    it.weight = num(mine.weight, base.weight);
    if (base.uses > 0) it.uses = num(mine.uses, base.uses);
    for (const need of Object.keys(base.eat)) it.eat[need] = num((mine.eat || {})[need], base.eat[need]);
  }
  for (const r of RECIPES) {
    const base = LIVE_ITEMS_BASE.recipes[r.id], mine = (liveItems.recipes || {})[r.id] || {};
    for (const f of ['needs', 'makes']) for (const kind of Object.keys(base[f])) r[f][kind] = num((mine[f] || {})[kind], base[f][kind]);
  }
  // what's on screen that shows these numbers: the weight you carry, the inventory, the craft list
  bagDrawn = ''; craftDrawn = ''; foundDrawn = '';
  if (player) { drawCarry(); if (bagOpen()) drawBag(); if (craftOpen()) drawCraft(); }
}

/* ---------- what the admin can do with the thing they tapped (admin-mode.js adminTap opens these as its menu) ---------- */
const sure = (label, run, note = '') => ({ label, note, sub: [{ label: `Yes, ${label.toLowerCase()}`, run }] }); // asks once more first
function adminPersonActions(o) {
  if (!admin.on) return [];
  return [{ label: 'Open their page', run: () => openPlayerPage(o.id) },
    { label: 'Follow them', run: () => adminFollow(o.id) },
    { label: 'Move them', note: 'Then tap where they go', run: () => startMove({ person: o.id, name: o.title }) },
    { label: 'Fill their needs', run: () => adminSend({ t: 'a.fill', id: o.id }) },
    { label: 'Mute for everyone', note: 'Unmute on their page', run: () => adminSend({ t: 'a.mute', id: o.id, on: true }) },
    { label: 'Kick', run: () => adminSend({ t: 'a.kick', id: o.id }) },
    sure('Ban', () => adminSend({ t: 'a.ban', id: o.id }), 'Keeps this phone out')];
}
function adminGroundActions(p) {
  if (!admin.on || !p) return [];
  return [{ label: 'Add item', note: 'Pick from a list', run: () => openPicker('Add item', (kind, n) => adminSend({ t: 'a.add', kind, n, x: p.x, z: p.z })) },
    { label: 'Fly here', run: () => adminFlyTo(p.x, p.z) }];
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
  const fire = (what) => () => adminSend({ t: 'a.fire', id: th.id, do: what });
  const whose = th.claim ? `Ends ${th.claim.name}` : ''; // (a claim is a society: 0.1.5)
  return [{ label: 'Move', note: 'Then tap where it goes', run: () => startMove({ what: 'placed', id: th.id }) },
    ...(F && th.built ? [{ label: 'Fill with fuel', run: () => adminSend({ t: 'a.regrow', what: 'placed', id: th.id }) },
      th.lit ? (th.claim ? sure('Put out', fire('out'), whose) : { label: 'Put out', run: fire('out') }) : { label: 'Light', run: fire('light') }] : []),
    ...(th.claim ? [sure('End claim', () => adminSend({ t: 'a.claim', id: th.id, do: 'end' }), 'The fire burns on')] : []),
    ...(F ? [{ label: 'Fires and claims', note: 'Set fuel, give a claim', run: () => { openFire = th.id; openAdminPanel(); showAdminTab('world'); } }] : []),
    sure('Remove', () => adminSend({ t: 'a.remove', id: th.id }))];
}
// Move: the next tap on the ground is where it goes (a tap anywhere else stops)
let adminMoving = null;
function startMove(m) { adminMoving = m; if (adminNarrow()) closeAdminPanel(); adminSay(m.person ? `Tap where ${m.name} goes` : 'Tap where it goes', 6); }
function adminMoveTap() {
  const m = adminMoving;
  adminMoving = null;
  ray.setFromCamera(ndc, camera);
  const g = ray.intersectObject(terrain, false)[0];
  if (!g) { adminSay('Move stopped'); return; }
  const L = WALK_LIMIT - 0.5, x = Math.round(Math.max(-L, Math.min(L, g.point.x)) * 100) / 100, z = Math.round(Math.max(-L, Math.min(L, g.point.z)) * 100) / 100;
  if (pondShape(x, z) < 1) { adminSay("Can't go in the pond"); return; }
  if (m.person) adminSend({ t: 'a.movePerson', id: m.person, x, z }); // a person (the server has the last word on where they can stand)
  else adminSend({ t: 'a.move', what: m.what, idx: m.idx, id: m.id, x, z });
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
    .sort((a, b) => (q ? b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q) : 0) || a.name.localeCompare(b.name)); // names that start with what was typed first (stone: Stone before Sharp stone)
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
// a button that needs a second tap within a few seconds (for things that can't be undone). With wait, the second tap
// only counts after that long, so a double tap by mistake does nothing.
function twoTaps(btn, run, again = 'Tap again to be sure', wait = 0) {
  let label = btn.textContent, armed = null, at = 0; // (label: what it said when first tapped, so a label that changes comes back right)
  const reset = () => { if (armed) btn.textContent = label; clearTimeout(armed); armed = null; };
  btn.addEventListener('click', () => {
    if (!armed) { label = btn.textContent; btn.textContent = again; at = performance.now(); armed = setTimeout(reset, 4000 + wait); return; }
    if (performance.now() - at < wait) return;
    reset(); run();
  });
  return reset;
}
const when = (t) => { try { return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (err) { return ''; } };
const minsLeft = (until) => Math.max(1, Math.round((until - Date.now()) / 60000));

/* ---------- the panel and its tabs ---------- */
let adminTab = 'server', playersData = null, playerData = null, inboxData = null, editStats = null; // editStats: whose needs are open as boxes to type in
function openAdminPanel() {
  if (!adminMode.on) return;
  $('adminDashBtn').setAttribute('aria-expanded', 'true');
  app.classList.add('dash-open');
  adminSend({ t: 'a.state' });
  adminSend({ t: 'a.list' }); // for the Inbox count
  $('adminPanel').hidden = false;
  showAdminTab(adminTab === 'player' ? 'players' : adminTab);
}
function closeAdminPanel() { $('adminPanel').hidden = true; $('adminDashBtn').setAttribute('aria-expanded', 'false'); app.classList.remove('dash-open'); resetDanger(); }
function adminEscape() { if (adminTab === 'player') showAdminTab('players'); else closeAdminPanel(); }
function showAdminTab(tab) {
  adminTab = tab;
  for (const b of document.querySelectorAll('[data-admin-tab]')) b.setAttribute('aria-pressed', String(b.dataset.adminTab === (tab === 'player' ? 'players' : tab)));
  for (const p of document.querySelectorAll('[data-admin-page]')) p.hidden = p.dataset.adminPage !== tab;
  if (tab === 'players') findPlayers();
  if (tab === 'inbox') drawInbox();
  if (tab === 'world') { drawCounts(); drawRestore(); adminSend({ t: 'a.fires' }); drawFires(); adminSend({ t: 'a.socs' }); drawSocs(); }
  if (tab === 'log') { adminSend({ t: 'a.log' }); drawLog(); }
  if (tab === 'settings') drawSettings();
  if (tab === 'items') { adminSend({ t: 'a.items' }); drawItems(); }
  if (tab === 'player') drawPlayer();
}
for (const b of document.querySelectorAll('[data-admin-tab]')) b.addEventListener('click', () => showAdminTab(b.dataset.adminTab));
$('adminDashBtn').addEventListener('click', () => ($('adminPanel').hidden ? openAdminPanel() : closeAdminPanel()));
$('adminClose').addEventListener('click', closeAdminPanel);
function drawAdmin() {
  if (!admin.on) { $('adminPanel').hidden = true; $('adminPick').hidden = true; return; }
  $('adminMaintState').textContent = admin.maintenance ? 'On: release-link players see Back soon' : 'Off';
  $('adminMaintBtn').textContent = admin.maintenance ? 'Turn off' : 'Turn on';
  if (document.activeElement !== $('adminMaintText')) $('adminMaintText').value = admin.message || '';
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
    const tags = [STATE_WORDS[r.state] || r.state, r.age != null ? `${r.age} yrs` : '', r.muted ? 'muted' : '', r.banned ? 'banned' : ''].filter(Boolean).join(' · ');
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
  if ($('adminPanel').hidden) { $('adminPanel').hidden = false; $('adminDashBtn').setAttribute('aria-expanded', 'true'); app.classList.add('dash-open'); adminSend({ t: 'a.state' }); }
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
  const out = [], alive = p.state !== 'gone';
  const head = el('div');
  head.append(el('div', 'admin-name', p.name),
    el('div', 'admin-tag', [STATE_WORDS[p.state] || p.state, p.age != null ? `${p.age} yrs` : '', p.v ? `v${p.v} ${p.link} link` : '', p.muted ? 'muted' : '', p.banned ? 'banned' : '',
      p.reports ? `${p.reports} ${p.reports === 1 ? 'report' : 'reports'}` : '', p.linked ? `on ${p.linked + 1} devices` : ''].filter(Boolean).join(' · ')));
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
    if (editStats === p.id) { // the same numbers as boxes to type in (the server keeps them inside what's allowed)
      const grid = el('div', 'admin-edit'), boxes = {};
      const box = (label, value, max) => { const l = el('label', '', label), i = el('input', 'admin-input'); Object.assign(i, { type: 'number', min: '0', max: String(max), step: '1', inputMode: 'decimal', value: String(value) }); l.appendChild(i); grid.appendChild(l); return i; };
      for (const s of STATS) if (p.stats[s.id] != null) boxes[s.id] = box(s.name, Math.round(p.stats[s.id]), 100);
      const age = box('Age', p.age, 120);
      const bar = el('div', 'admin-btns');
      bar.append(button('Save', () => {
        const stats = {};
        for (const [id, i] of Object.entries(boxes)) { const v = parseFloat(i.value); if (Number.isFinite(v) && v !== Math.round(p.stats[id])) stats[id] = v; } // only the ones that were changed
        const a = parseFloat(age.value), msg = { t: 'a.setStats', id: p.id, stats };
        if (Number.isFinite(a) && a !== p.age) msg.age = a;
        editStats = null;
        if (Object.keys(stats).length || msg.age != null) adminSend(msg); else drawPlayer();
      }), button('Cancel', () => { editStats = null; drawPlayer(); }));
      sec.append(grid, bar);
    } else { const bar = el('div', 'admin-btns'); bar.appendChild(button('Edit needs and age', () => { editStats = p.id; drawPlayer(); })); sec.appendChild(bar); }
    out.push(sec);
  }
  if (alive) { // a new name (for one that shouldn't have got past the filter), and a few words only they see
    const talk = el('div', 'admin-entry');
    const line = (holder, most, value, label, run) => {
      const row = el('form', 'admin-inline'), i = el('input', 'admin-input');
      Object.assign(i, { maxLength: most, placeholder: holder, value, autocomplete: 'off' });
      i.setAttribute('aria-label', holder);
      const b = el('button', 'small-btn', label);
      b.type = 'submit';
      row.append(i, b);
      row.addEventListener('submit', (e) => { e.preventDefault(); const text = i.value.trim(); if (text) run(text); });
      talk.appendChild(row);
    };
    line('Name', 20, p.name, 'Rename', (name) => { if (name !== p.name) adminSend({ t: 'a.rename', id: p.id, name }); });
    if (p.state === 'online') line('A message only they see', 140, '', 'Send', (text) => { adminSend({ t: 'a.tell', id: p.id, text }); drawPlayer(); });
    out.push(talk);
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
  if (alive) { // their task list (0.1.7): what their person carries on with while they're away (server/src/tasks.js)
    const list = p.tasks || [], sec = entry('Task list', list.length ? '' : 'Empty');
    list.slice(0, 10).forEach((t, i) => sec.appendChild(el('div', 'admin-row', `${i + 1}. ${taskName(t, false) || t.type}`)));
    if (list.length > 10) sec.appendChild(el('div', 'admin-row', `+${list.length - 10} more`));
    if (list.length) {
      const bar = el('div', 'admin-btns'), clear = button('Clear task list', () => {});
      twoTaps(clear, () => toPlayer({ t: 'a.clearTasks', id: p.id }), 'Tap again', 500);
      bar.appendChild(clear); sec.appendChild(bar);
    }
    out.push(sec);
  }
  if (alive) { // the recipes they've found on the craft mat (0.1.8): give them every one, or clear them to find again
    const found = (p.found || []).filter((id) => RECIPES.some((r) => r.id === id));
    const sec = entry('Recipes found', `${found.length} of ${RECIPES.length}${found.length ? `: ${found.map((id) => recipeName(RECIPES.find((r) => r.id === id)).toLowerCase()).join(', ')}` : ''}`);
    const bar = el('div', 'admin-btns'), none = button('Clear found', () => {});
    if (found.length < RECIPES.length) bar.appendChild(button('Find all', () => toPlayer({ t: 'a.found', id: p.id, all: true })));
    if (found.length) { twoTaps(none, () => toPlayer({ t: 'a.found', id: p.id, all: false }), 'Tap again', 500); bar.appendChild(none); }
    sec.appendChild(bar);
    out.push(sec);
  }
  if (p.soc) { // their society (0.1.4): taking them out is the same as them leaving it
    const sec = entry(el('div', 'admin-name', 'Society'), `${p.soc.name}${p.soc.lead ? ' · leads it' : ''} · ${p.soc.n} in it`), bar = el('div', 'admin-btns');
    const out1 = button('Take out of society', () => {});
    twoTaps(out1, () => toPlayer({ t: 'a.socRemove', id: p.soc.id, who: p.id }), p.soc.n === 1 ? 'Tap again: it ends' : 'Tap again', 500);
    bar.appendChild(out1); sec.appendChild(bar); out.push(sec);
  }
  const acts = [];
  if (alive && p.x != null) acts.push(['Fly to', () => adminFlyTo(p.x, p.z)]);
  if (alive && others.has(p.id)) acts.push(['Follow', () => adminFollow(p.id)]);
  if (alive) acts.push(['Fill needs', () => toPlayer({ t: 'a.fill', id: p.id })]);
  acts.push([p.muted ? 'Unmute' : 'Mute', () => toPlayer({ t: 'a.mute', id: p.id, on: !p.muted })]);
  if (p.state === 'online') acts.push(['Kick', () => toPlayer({ t: 'a.kick', id: p.id })]);
  if (p.state === 'asleep') acts.push(['Wake up', () => toPlayer({ t: 'a.wake', id: p.id })]);
  if (p.state === 'away') acts.push(['Send to sleep', () => toPlayer({ t: 'a.sleep', id: p.id })]);
  if (acts.length) out.push(entry('', '', acts));
  const careful = el('div', 'admin-entry');
  const bar = el('div', 'admin-btns');
  const ban = button(p.banned ? 'Unban' : 'Ban', () => {}); // (a ban keeps that phone from playing; it never keeps anyone out of admin mode)
  if (p.banned) ban.addEventListener('click', () => toPlayer({ t: 'a.unban', who: p.id }));
  else twoTaps(ban, () => toPlayer({ t: 'a.ban', id: p.id }), 'Tap again to ban');
  bar.appendChild(ban);
  if (p.linked) { const so = button('Unlink all devices', () => {}); twoTaps(so, () => toPlayer({ t: 'a.unlinkAll', id: p.id }), 'Tap again: the other devices are guests'); bar.appendChild(so); }
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
  if (adminTab !== 'inbox') return;
  chips($('adminInboxShow'), [['feedback', `Feedback ${newCount('feedback')}`], ['reports', `Reports ${newCount('reports')}`], ['done', inboxDone ? 'Hide done' : 'Show done']],
    inboxList, (v) => { if (v === 'done') inboxDone = !inboxDone; else inboxList = v; drawInbox(); });
  if (!inboxData) { $('adminInbox').replaceChildren(emptyNote('Loading…')); return; }
  const list = (inboxData[inboxList] || []).filter((x) => inboxDone || !x.done);
  const mark = (x) => [x.done ? 'Not done' : 'Done', () => adminSend({ t: 'a.done', list: inboxList, at: x.at, on: !x.done })];
  const del = (x) => ['Delete', () => adminSend({ t: 'a.delete', list: inboxList, at: x.at })];
  const rows = list.map((x) => {
    if (inboxList === 'feedback') return entry(`${when(x.at)} · ${x.name || 'Someone'} · v${x.v}${x.count > 1 ? ` · ${x.count} times, last ${when(x.lastAt)}` : ''}`, x.text, [mark(x), del(x)], x.done ? 'done' : '');
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
$('adminClearNearBtn').addEventListener('click', () => { adminSend({ t: 'a.clear', near: true, x: controls.target.x, z: controls.target.z }); setTimeout(drawCounts, 800); });
const resetClearAll = twoTaps($('adminClearAllBtn'), () => { adminSend({ t: 'a.clear', near: false }); setTimeout(drawCounts, 800); }, 'Tap again: clear everything');
// Reset the world: the land, loose items and placed things start again, people stay. Reset everything: every person,
// everyone's past people and the Inbox go too (settings, bans and maintenance stay). Neither can be undone.
const resetReset = twoTaps($('adminResetBtn'), () => { adminSend({ t: 'a.reset' }); closeAdminPanel(); }, 'Tap again: the land starts again', 1000);
const resetResetAll = twoTaps($('adminResetAllBtn'), () => { adminSend({ t: 'a.reset', all: true }); closeAdminPanel(); }, 'Tap again: deletes every person', 1000);
function resetDanger() { resetClearAll(); resetReset(); resetResetAll(); resetRestore(); resetUndo(); }

/* ---------- Fires and claims (World tab): every fire, its flame and fuel, and whose land it holds ----------
   The server sends the list (a.fires) when the tab opens and after each change. A fire's own tap menu has the quick ones
   (Light, Put out, End claim); here they all are, with the hours of fuel and who a claim goes to. */
let firesData = null, openFire = null; // openFire: the fire whose fuel and claim boxes are showing
const hoursText = (ms) => { const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h && m % 60 ? `${h} h ${m % 60} m` : h ? `${h} h` : `${m} m`; };
function drawFires() {
  const box = $('adminFires'), d = firesData;
  if (!d) { $('adminFiresState').textContent = ''; box.replaceChildren(emptyNote('Loading…')); return; }
  const claims = d.list.filter((f) => f.claim).length;
  $('adminFiresState').textContent = d.list.length ? `${d.list.length} ${d.list.length === 1 ? 'fire' : 'fires'} · ${claims} ${claims === 1 ? 'claim' : 'claims'}` : '';
  if (!d.list.length) { box.replaceChildren(emptyNote('No fires yet')); return; }
  const send = (f, more) => adminSend({ id: f.id, ...more });
  box.replaceChildren(...[...d.list].sort((a, b) => !!b.claim - !!a.claim || b.lit - a.lit).map((f) => { // claims first, then burning ones
    const kind = (PLACEABLES[f.kind] || {}).name || f.kind, head = el('div');
    const state = !f.built ? 'not built yet' : f.lit ? `burning · ${hoursText(f.fuel)} left` : f.fuel > 0 ? `out · ${hoursText(f.fuel)} of fuel` : 'out · no fuel';
    head.append(el('div', 'admin-name', f.claim ? f.claim.name : kind), el('div', 'admin-tag', [f.claim ? 'claim' : '', state, !f.claim && f.by ? `built by ${f.by}` : '', `at ${Math.round(f.x)}, ${Math.round(f.z)}`].filter(Boolean).join(' · ')));
    const e = entry(head), bar = el('div', 'admin-btns');
    e.dataset.fire = f.id;
    bar.appendChild(button('Fly to', () => adminFlyTo(f.x, f.z)));
    if (f.built && f.lit) { const b = button('Put out', () => {}); if (f.claim) twoTaps(b, () => send(f, { t: 'a.fire', do: 'out' }), `Tap again: ends ${f.claim.name}`, 500); else b.addEventListener('click', () => send(f, { t: 'a.fire', do: 'out' })); bar.appendChild(b); }
    if (f.built && !f.lit) bar.appendChild(button('Light', () => send(f, { t: 'a.fire', do: 'light' })));
    if (f.claim) { const b = button('End claim', () => {}); twoTaps(b, () => send(f, { t: 'a.claim', do: 'end' }), 'Tap again: the land is free', 500); bar.appendChild(b); }
    if (f.built) bar.appendChild(button(openFire === f.id ? 'Less' : 'More', () => { openFire = openFire === f.id ? null : f.id; drawFires(); }));
    e.appendChild(bar);
    if (f.built && openFire === f.id) {
      const fuel = el('form', 'admin-inline'), hours = el('input', 'admin-input'), most = Math.round(f.max / 3600000);
      Object.assign(hours, { type: 'number', min: '0', max: String(most), step: '0.5', inputMode: 'decimal', placeholder: `Hours of fuel (up to ${most})` });
      hours.setAttribute('aria-label', 'Hours of fuel');
      const set = el('button', 'small-btn', 'Set fuel');
      set.type = 'submit';
      fuel.append(hours, set);
      fuel.addEventListener('submit', (ev) => { ev.preventDefault(); const h = parseFloat(hours.value); if (Number.isFinite(h) && h >= 0) send(f, { t: 'a.fire', do: 'fuel', hours: h }); else adminSay('Type how many hours'); });
      e.appendChild(fuel);
      if (f.canClaim && f.lit) { // a claim lasts only while its fire burns, so only a burning one can be given
        const give = el('form', 'admin-inline'), who = el('select', 'admin-input');
        who.setAttribute('aria-label', 'Who the claim goes to');
        who.append(...d.people.filter((p) => !f.claim || p.id !== f.claim.who).map((p) => { const o = el('option', '', p.name); o.value = p.id; return o; }));
        const go = el('button', 'small-btn', f.claim ? 'Move claim' : 'Give claim');
        go.type = 'submit';
        give.append(who, go);
        give.addEventListener('submit', (ev) => { ev.preventDefault(); if (who.value) send(f, { t: 'a.claim', do: 'give', to: who.value }); });
        if (who.options.length) e.appendChild(give);
      }
    }
    return e;
  }));
}

/* ---------- Societies (World tab, 0.1.4): every society, who leads it, its members and its claim (server/src/societies.js) ----------
   The server sends the list (a.socs) when the tab opens and after each change. Rename, take someone out, end one. */
let socsData = null, openSoc = null; // openSoc: the society whose members and Rename box are showing
function drawSocs() {
  const box = $('adminSocs'), list = socsData;
  if (!list) { $('adminSocsState').textContent = ''; box.replaceChildren(emptyNote('Loading…')); return; }
  $('adminSocsState').textContent = list.length ? `${list.length} ${list.length === 1 ? 'society' : 'societies'}` : '';
  if (!list.length) { box.replaceChildren(emptyNote('No societies yet')); return; }
  box.replaceChildren(...list.map((s) => {
    const head = el('div'), claim = s.claim ? `claim burning · ${hoursText(s.claim.fuel)} left` : 'no claim';
    head.append(el('div', 'admin-name', s.name), el('div', 'admin-tag', [`led by ${s.leader}`, `${s.members.length} of ${s.max}`, claim].join(' · ')));
    const e = entry(head), bar = el('div', 'admin-btns');
    if (s.claim) bar.appendChild(button('Fly to', () => adminFlyTo(s.claim.x, s.claim.z)));
    bar.appendChild(button(openSoc === s.id ? 'Less' : 'Members', () => { openSoc = openSoc === s.id ? null : s.id; drawSocs(); }));
    const end = button('End', () => {});
    twoTaps(end, () => adminSend({ t: 'a.socEnd', id: s.id }), s.claim ? 'Tap again: the claim goes to the leader' : 'Tap again to end it', 500);
    bar.appendChild(end);
    e.appendChild(bar);
    if (openSoc === s.id) {
      for (const m of s.members) {
        const row = el('div', 'admin-row'), out = button('Take out', () => {});
        row.append(el('span', 'admin-tag', `${m.name}${m.lead ? ' · leader' : ''} · ${STATE_WORDS[m.state] || m.state}`), out);
        twoTaps(out, () => adminSend({ t: 'a.socRemove', id: s.id, who: m.id }), 'Tap again', 500);
        e.appendChild(row);
      }
      const form = el('form', 'admin-inline'), name = el('input', 'admin-input'), go = el('button', 'small-btn', 'Rename');
      Object.assign(name, { maxLength: 20, value: s.name, placeholder: 'Society name', autocomplete: 'off' });
      name.setAttribute('aria-label', 'Society name');
      go.type = 'submit';
      form.append(name, go);
      form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = name.value.trim(); if (v && v !== s.name) adminSend({ t: 'a.socRename', id: s.id, name: v }); });
      e.appendChild(form);
    }
    return e;
  }));
}

/* ---------- Log tab: what happened in the world and what the admin did, newest first (server/src/activity.js) ---------- */
let logData = null, logShow = 'all';
function drawLog() {
  chips($('adminLogShow'), [['all', 'All'], ['world', 'People'], ['admin', 'Admin'], ['guard', 'Refused']], logShow, (v) => { logShow = v; drawLog(); });
  const box = $('adminLog');
  if (!logData) { box.replaceChildren(emptyNote('Loading…')); return; }
  const list = logData.filter((l) => logShow === 'all' || l.kind === logShow);
  if (!list.length) { box.replaceChildren(emptyNote('Nothing yet')); return; }
  // each day gets a heading (Today, Yesterday, then the date), so a line only needs its time and fits a phone
  const dayOf = (t) => new Date(t).toDateString(), today = dayOf(Date.now()), yesterday = dayOf(Date.now() - 86400000);
  const dayName = (t) => (dayOf(t) === today ? 'Today' : dayOf(t) === yesterday ? 'Yesterday' : new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }));
  const out = [];
  let day = '';
  for (const l of list) {
    if (dayOf(l.at) !== day) { day = dayOf(l.at); out.push(el('div', 'admin-logday', dayName(l.at))); }
    const row = el('div', `admin-logline ${['world', 'admin', 'guard'].includes(l.kind) ? l.kind : 'world'}`);
    row.append(el('span', 'admin-logtime', new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), el('span', '', l.n > 1 ? `${l.text} (${l.n} times)` : l.text));
    out.push(row);
  }
  box.replaceChildren(...out);
}

/* ---------- Restore (World tab): the whole world back to an earlier time (server/src/restore.js) ---------- */
// Cloudflare keeps the last 30 days. Everything goes back together (land, people, bags, claims, Inbox, bans, settings),
// so it's for emergencies, like a bad update or a reset by mistake. The server sends back an undo point (the moment
// just before the restore), kept on this phone, so a wrong pick can be put back with Undo.
const RESTORE_KEY = 'pocket-life:restoreUndo', RESTORE_DAYS = 30, DAY_MS = 24 * 3600000;
const RESTORE_PICKS = [[10, '10 min'], [60, '1 hour'], [360, '6 hours'], [1440, '1 day'], ['pick', 'Pick a time']];
const restorePick = { mins: 60 };
let restoreUndo = null;
try { restoreUndo = JSON.parse(localStorage.getItem(RESTORE_KEY) || 'null'); } catch (err) { /* none */ }
const inputTime = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16); // a datetime-local box's value, in this phone's time
function restoreTime() {
  if (restorePick.mins !== 'pick') return Date.now() - restorePick.mins * 60000;
  const t = new Date($('adminRestoreAt').value).getTime();
  return Number.isFinite(t) ? t : 0;
}
function drawRestore() {
  resetRestore(); resetUndo();
  chips($('adminRestoreWhen'), RESTORE_PICKS, restorePick.mins, (v) => {
    restorePick.mins = v;
    if (v === 'pick' && !$('adminRestoreAt').value) $('adminRestoreAt').value = inputTime(Date.now() - 3600000);
    drawRestore();
  });
  const box = $('adminRestoreAt'), now = Date.now();
  box.hidden = restorePick.mins !== 'pick';
  if (document.activeElement !== box) { box.min = inputTime(now - RESTORE_DAYS * DAY_MS + 60000); box.max = inputTime(now); } // (not while picking)
  const t = restoreTime();
  $('adminRestoreBtn').textContent = t ? `Restore to ${when(t)}` : 'Pick a time';
  const u = restoreUndo && restoreUndo.at > now - RESTORE_DAYS * DAY_MS ? restoreUndo : null;
  $('adminRestoreUndo').hidden = !u;
  if (u) $('adminRestoreUndoText').textContent = `Restored ${when(u.at)}, back to ${when(u.to)}`;
}
function doRestore() {
  const t = restoreTime(), now = Date.now();
  if (!t || t > now - 5000) { adminSay('Pick a time in the past'); return; }
  if (t < now - RESTORE_DAYS * DAY_MS + 60000) { adminSay(`Only the last ${RESTORE_DAYS} days can be restored`); return; }
  adminSend({ t: 'a.restore', at: t });
}
const resetRestore = twoTaps($('adminRestoreBtn'), doRestore, 'Tap again: everything after it goes', 1000);
const resetUndo = twoTaps($('adminUndoBtn'), () => { if (restoreUndo) adminSend({ t: 'a.restore', undo: restoreUndo.undo }); }, 'Tap again: back to before it', 1000);
for (const ev of ['input', 'change']) $('adminRestoreAt').addEventListener(ev, drawRestore);
// the server's answer, just before the world restarts and everyone rejoins
function restoreAnswer(m) {
  restoreUndo = m.undone ? null : { undo: m.undo, to: m.to, at: m.at };
  try { if (restoreUndo) localStorage.setItem(RESTORE_KEY, JSON.stringify(restoreUndo)); else localStorage.removeItem(RESTORE_KEY); } catch (err) { /* full */ }
  closeAdminPanel();
  adminSay(m.undone ? 'Undoing the restore…' : 'Restoring the world…', 4);
}

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

/* ---------- Items tab: an item's and a recipe's numbers, changed live (server/src/live-items.js) ----------
   The list comes from the server (every number that can be changed, what the game file says, and whether it's been
   changed), so a new item or recipe shows up here by itself. A changed number wins over the game file until Reset.
   One short line per item, A to Z, with the Craft kinds as chips and a search (Luke, 25 Nov 2026: the list of every
   number was way too long). Tap a line to open its numbers, one item open at a time. */
let itemsData = null, itemsKind = 'All', itemsOpen = null, itemsQ = ''; // itemsOpen: the heading that's open
// which heading a number sits under, its kind, what it's called there, and (an item's own numbers) how its line sums it up
function itemPlace(at) {
  const [what, id, field, sub] = at, name = (k) => (ITEMS[k] ? ITEMS[k].name.toLowerCase() : k);
  if (what === 'items') {
    const it = ITEMS[id], head = it ? it.name : id, kind = it ? itemGroup(it) : 'Materials';
    if (field === 'weight') return { head, kind, label: 'Weight', step: 1, sum: (v) => `weighs ${v}` };
    if (field === 'uses') return { head, kind, label: 'Uses', step: 1, sum: (v) => `${v} uses` };
    const st = STAT[sub] || { name: sub };
    return { head, kind, label: `Fills ${st.name.toLowerCase()} by`, step: 0.1, sum: (v) => `+${v} ${st.gainLabel || st.name.toLowerCase()}` }; // "+10 food", as the game says it
  }
  const r = RECIPES.find((x) => x.id === id), head = r ? recipeName(r) : id, kind = r ? recipeGroup(r) : 'Materials';
  return { head, kind, recipe: id, step: 1, label: field === 'needs' ? `Needs ${name(sub)}` : r && sub === madeBy(r) ? 'Makes' : `Makes ${name(sub)}` };
}
// redraw after a tap on a line or a chip (a box left focused would hold the redraw back)
function redrawItems() { if ($('adminItems').contains(document.activeElement)) document.activeElement.blur(); drawItems(); }
function drawItems() {
  const box = $('adminItems');
  if (!itemsData) { box.replaceChildren(emptyNote('Loading…')); return; }
  const q = $('adminItemsFind').value.trim().toLowerCase(), changed = itemsData.filter((e) => e.changed);
  $('adminItemsState').textContent = changed.length ? `${changed.length} changed from the game file` : 'All as the game file has them';
  $('adminItemsCopy').disabled = !changed.length;
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT' && box.contains(document.activeElement);
  if (typing) return; // (not while a number is being typed: the list would lose it)
  // an item's own numbers and its recipe's sit together under one heading, headings in A to Z order
  const groups = new Map();
  for (const r of itemsData.map((e, i) => ({ e, i, pl: itemPlace(e.at) })).sort((a, b) => a.pl.head.localeCompare(b.pl.head) || a.i - b.i)) {
    if (!groups.has(r.pl.head)) groups.set(r.pl.head, { head: r.pl.head, kind: r.pl.kind, rows: [] });
    groups.get(r.pl.head).rows.push(r);
  }
  const all = [...groups.values()], kinds = ['All', ...ITEM_GROUPS.filter((g) => all.some((x) => x.kind === g))];
  if (!kinds.includes(itemsKind)) itemsKind = 'All';
  chips($('adminItemsKinds'), kinds.map((g) => [g, g]), itemsKind, (g) => { itemsKind = g; redrawItems(); });
  const shown = all.filter((x) => (itemsKind === 'All' || x.kind === itemsKind) && (!q || x.head.toLowerCase().includes(q)))
    .sort((a, b) => (q ? b.head.toLowerCase().startsWith(q) - a.head.toLowerCase().startsWith(q) : 0)); // (stone: Stone before Sharp stone, as in Add item)
  if (q && q !== itemsQ && shown.length === 1) itemsOpen = shown[0].head; // a search that finds one item opens it
  itemsQ = q;
  const out = [];
  for (const x of shown) {
    const open = x.head === itemsOpen, own = x.rows.filter((r) => r.pl.sum);
    const line = button('', () => {
      itemsOpen = open ? null : x.head; redrawItems();
      const now = $('adminItems').querySelector('.admin-fold[aria-expanded="true"]'); // its numbers in view (on a phone the last line's open below the sheet), and its line too
      if (now && now.nextElementSibling) { now.nextElementSibling.scrollIntoView({ block: 'nearest' }); now.scrollIntoView({ block: 'nearest' }); }
    }, 'admin-fold');
    line.setAttribute('aria-expanded', String(open));
    line.append(el('span', 'admin-fold-name', x.head), ...(x.rows.some((r) => r.e.changed) ? [el('span', 'admin-fold-changed', 'Changed')] : []),
      el('span', 'admin-fold-sum', own.length ? own.map((r) => r.pl.sum(r.e.value)).join(' · ') : 'recipe'));
    out.push(line);
    if (!open) continue;
    const body = el('div', 'admin-fold-body'), recipes = [...new Set(x.rows.map((r) => r.pl.recipe).filter(Boolean))];
    let recipe = null;
    for (const r of x.rows) {
      if (recipes.length > 1 && r.pl.recipe && r.pl.recipe !== recipe) body.append(el('div', 'admin-num-sub', `Recipe ${recipes.indexOf(r.pl.recipe) + 1}`)); // (an item with two ways to make it)
      recipe = r.pl.recipe;
      body.append(itemNumber(x.head, r));
    }
    out.push(body);
  }
  box.replaceChildren(...(out.length ? out : [emptyNote(q ? 'Nothing called that' : 'Nothing to change yet')]));
}
// one number in an open item: its name, its box, and Save once the box is changed, or Reset once it has been
function itemNumber(head, { e, pl }) {
  const row = el('div', 'admin-num'), input = el('input', 'admin-input'), slot = el('span', 'admin-num-btn'), label = el('span', 'admin-num-label', pl.label);
  Object.assign(input, { type: 'number', inputMode: 'decimal', min: 0, step: pl.step, value: String(e.value) });
  input.setAttribute('aria-label', `${head}: ${pl.label}`);
  if (e.changed) label.append(el('small', '', `was ${e.base}`));
  const save = () => { const v = Number(input.value); if (input.value === '' || !Number.isFinite(v)) return; input.blur(); adminSend({ t: 'a.liveItem', at: e.at, value: v }); };
  const btn = () => {
    const edited = input.value !== '' && Number(input.value) !== e.value;
    slot.replaceChildren(...(edited ? [button('Save', save, 'small-btn go')] : e.changed ? [button('Reset', () => adminSend({ t: 'a.liveItem', at: e.at, value: null }))] : []));
  };
  input.addEventListener('input', btn);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
  btn();
  row.append(label, input, slot);
  return row;
}
$('adminItemsFind').addEventListener('input', drawItems);
// Copy my changes: a plain list of what's been changed, to paste so it can be written into game-data.json
// (after that the file and the admin agree, and the changes clear by themselves).
function itemsChangesText() {
  const lines = (itemsData || []).filter((e) => e.changed).map((e) => `${e.at.join('.')}: ${e.base} -> ${e.value}`);
  return lines.length ? `Pocket Life admin changes (${VERSION_LABEL})\n${lines.join('\n')}` : '';
}
$('adminItemsCopy').addEventListener('click', async () => {
  const text = itemsChangesText(), box = $('adminItemsText');
  if (!text) return;
  box.value = text; box.hidden = false; // shown as well, in case this phone won't let a page copy by itself
  try { await navigator.clipboard.writeText(text); adminSay('Copied. Paste it to have the game file updated'); } catch (err) { box.focus(); box.select(); adminSay('Select the text and copy it'); }
});

/* ---------- leaving admin mode: nothing the dashboard was showing stays on the page (names, feedback, reports, the Log) ---------- */
function forgetAdminData() {
  playersData = null; playerData = null; inboxData = null; itemsData = null; firesData = null; logData = null; editStats = null; openFire = null; socsData = null; openSoc = null;
  for (const id of ['adminPlayers', 'adminPlayer', 'adminInbox', 'adminItems', 'adminFires', 'adminSocs', 'adminLog']) $(id).replaceChildren();
  $('adminItemsText').value = ''; $('adminItemsText').hidden = true;
}

