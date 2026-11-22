/* ---------- the admin player (Luke) ----------
   Type "/admin" and the code in the Say box once; the phone remembers it. "/admin off" forgets it.
   The code itself is a Cloudflare secret (ADMIN_CODE), so it never sits in the game's files. */
const ADMIN_KEY = 'pocket-life:admin', ADMIN_TAG_KEY = 'pocket-life:adminTag';
const admin = { on: false, code: '', tag: true, maintenance: false, message: '' };
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
    if ('speed' in m) timeSpeed = m.speed && m.speed.until > Date.now() ? m.speed : null;
    try { localStorage.setItem(ADMIN_KEY, admin.code); } catch (err) { /* full */ }
    drawAdmin();
    if (!was) showTag('Admin on. Open the Menu for admin tools', headTop(), 3);
    if (m.text) showTag(m.text, headTop(), 2.5);
  } else if (m.t === 'adminNo') {
    try { localStorage.removeItem(ADMIN_KEY); } catch (err) { /* none */ }
    admin.code = ''; admin.on = false; drawAdmin();
    showTag("That code didn't work", headTop(), 2.5);
  } else if (m.t === 'adminList') drawAdminList(m);
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
const adminMore = (acts) => (acts.length ? [{ label: 'Admin', sub: acts }] : []);
function adminPersonActions(o) {
  if (!admin.on) return [];
  return [{ label: 'Mute for everyone', note: 'Unmute in the Online list', run: () => adminSend({ t: 'a.mute', id: o.id, on: true }) },
    { label: 'Kick', run: () => adminSend({ t: 'a.kick', id: o.id }) },
    { label: 'Ban', note: 'Keeps this phone out', run: () => adminSend({ t: 'a.ban', id: o.id }) },
    { label: 'Teleport to them', run: () => teleportTo(o.mesh.position.x + 1, o.mesh.position.z) },
    { label: 'Fill their needs', run: () => adminSend({ t: 'a.fill', id: o.id }) },
    ...(o.state === 'asleep' ? [{ label: 'Wake up', run: () => adminSend({ t: 'a.wake', id: o.id }) }] : []),
    ...(o.state === 'away' ? [{ label: 'Send to sleep', run: () => adminSend({ t: 'a.sleep', id: o.id }) }] : []),
    ...(o.state !== 'online' ? [{ label: 'Remove from world', note: 'Drops their things', run: () => adminSend({ t: 'a.removePerson', id: o.id }) }] : [])];
}
function adminGroundActions(p) {
  if (!admin.on || !p) return [];
  return [...Object.values(ITEMS).map((it) => ({ label: `Add ${it.name}`, run: () => adminSend({ t: 'a.add', kind: it.id, x: p.x, z: p.z }) })),
    { label: 'Teleport here', run: () => teleportTo(p.x, p.z) }];
}
// the Admin button in the Menu, and the admin panel
function drawAdmin() {
  $('pauseAdminBtn').hidden = !admin.on;
  $('adminMaintState').textContent = admin.maintenance ? 'On: release-link players see Back soon' : 'Off';
  $('adminMaintBtn').textContent = admin.maintenance ? 'Turn off' : 'Turn on';
  $('adminMaintText').value = admin.message || '';
  $('adminTagBtn').textContent = admin.tag ? 'Admin tag: on' : 'Admin tag: off';
  // today's use of Cloudflare's free plan (it resets at 9:30 am Darwin time); past 80% shows red
  const u = admin.usage;
  if (u) {
    const pct = Math.max(u.requests, u.writes);
    $('adminUsage').textContent = `Server today: ${pct}% of the free limit · ${u.playing}/${u.max} playing${u.waiting ? ` · ${u.waiting} waiting` : ''}`;
    $('adminUsage').classList.toggle('warn', pct >= 80);
  }
  const fast = timeSpeed && timeSpeed.until > Date.now();
  $('adminSpeedBtn').textContent = fast ? `Time ${timeSpeed.x}x: stop` : 'Speed up time';
  if (!admin.on) { $('adminPanel').hidden = true; $('adminList').hidden = true; }
}
function openAdminPanel() { closePause(); paused = true; adminSend({ t: 'a.state' }); drawAdmin(); $('adminPanel').hidden = false; }
function closeAdminPanel() { $('adminPanel').hidden = true; paused = false; resetArm(); }
$('pauseAdminBtn').addEventListener('click', openAdminPanel);
$('adminClose').addEventListener('click', closeAdminPanel);
$('adminMaintBtn').addEventListener('click', () => adminSend({ t: 'a.maintenance', on: !admin.maintenance, text: $('adminMaintText').value }));
$('adminAnnounceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('adminAnnounceText').value.trim();
  if (!text) return;
  adminSend({ t: 'a.announce', text });
  $('adminAnnounceText').value = '';
});
$('adminSpeedBtn').addEventListener('click', () => {
  const fast = timeSpeed && timeSpeed.until > Date.now();
  adminSend({ t: 'a.speed', x: fast ? 1 : 60, minutes: 10 });
});
$('adminTagBtn').addEventListener('click', () => {
  admin.tag = !admin.tag;
  try { localStorage.setItem(ADMIN_TAG_KEY, admin.tag ? 'on' : 'off'); } catch (err) { /* full */ }
  adminSend({ t: 'a.tag', on: admin.tag });
  drawAdmin();
});
// reset needs two taps, a few seconds apart at most
let resetArmed = null;
function resetArm() { clearTimeout(resetArmed); resetArmed = null; $('adminResetBtn').textContent = 'Reset the world'; }
$('adminResetBtn').addEventListener('click', () => {
  if (!resetArmed) { $('adminResetBtn').textContent = 'Tap again to reset everything'; resetArmed = setTimeout(resetArm, 4000); return; }
  resetArm();
  adminSend({ t: 'a.reset' });
  closeAdminPanel();
});
// the list opens in place of the Admin panel, and Close goes back to it
$('adminListBtn').addEventListener('click', () => { adminSend({ t: 'a.list' }); $('adminListBody').textContent = 'Loading…'; $('adminPanel').hidden = true; $('adminList').hidden = false; });
$('adminListClose').addEventListener('click', () => { $('adminList').hidden = true; $('adminPanel').hidden = false; });
let adminData = null, adminTab = 'feedback';
for (const b of document.querySelectorAll('[data-admin-tab]')) b.addEventListener('click', () => { adminTab = b.dataset.adminTab; drawAdminList(); });
const when = (iso) => { try { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (err) { return ''; } };
function drawAdminList(m) {
  if (m) adminData = m;
  const d = adminData || {};
  for (const b of document.querySelectorAll('[data-admin-tab]')) {
    b.setAttribute('aria-pressed', String(b.dataset.adminTab === adminTab));
    const n = (d[b.dataset.adminTab] || []).length;
    b.textContent = `${b.dataset.label} (${n})`;
  }
  const rows = [];
  const row = (head, body, buttons = []) => {
    const el = document.createElement('div');
    el.className = 'admin-entry';
    const h = document.createElement('div'); h.className = 'admin-head'; h.textContent = head; el.appendChild(h);
    if (body) { const b = document.createElement('div'); b.className = 'admin-body'; b.textContent = body; el.appendChild(b); }
    if (buttons.length) {
      const bar = document.createElement('div'); bar.className = 'admin-btns';
      for (const [label, run] of buttons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'small-btn'; b.textContent = label; b.addEventListener('click', run); bar.appendChild(b); }
      el.appendChild(bar);
    }
    rows.push(el);
  };
  const del = (list, at) => ['Delete', () => { adminSend({ t: 'a.delete', list, at }); d[list] = (d[list] || []).filter((x) => x.at !== at); drawAdminList(); }];
  if (adminTab === 'feedback') for (const f of d.feedback || []) row(`${when(f.at)} · ${f.name || 'Someone'} · v${f.v}`, f.text, [del('feedback', f.at)]);
  if (adminTab === 'reports') for (const r of d.reports || []) {
    const said = (r.said || []).map(([, t]) => `"${t}"`).join('  ');
    row(`${when(r.at)} · ${r.by.name} reported ${r.about.name} · ${r.reason}`, [r.note, said && `They said: ${said}`].filter(Boolean).join('\n'),
      [['Mute them', () => adminSend({ t: 'a.mute', who: r.about.who, on: true })], del('reports', r.at)]);
  }
  if (adminTab === 'online') for (const p of d.online || []) {
    if (p.id === net.myId) { row(`${p.name} (you) · v${p.v} · ${p.link} link`); continue; }
    row(`${p.name}${p.muted ? ' · muted' : ''} · v${p.v} · ${p.link} link`, '', [
      ['Teleport to', () => { $('adminList').hidden = true; closeAdminPanel(); teleportTo(p.x + 1, p.z); }],
      ...(p.muted ? [['Unmute', () => { adminSend({ t: 'a.mute', id: p.id, on: false }); p.muted = false; drawAdminList(); }]] : []),
      ['Kick', () => adminSend({ t: 'a.kick', id: p.id })],
      ['Ban', () => adminSend({ t: 'a.ban', id: p.id })]]);
  }
  if (adminTab === 'banned') for (const who of d.banned || []) row(`Phone ${who}`, '', [['Unban', () => { adminSend({ t: 'a.unban', who }); adminSend({ t: 'a.list' }); }]]);
  if (adminTab === 'online' && d.counts) rows.unshift(Object.assign(document.createElement('p'), { className: 'admin-empty', textContent: `People in the world: ${d.counts.online} playing, ${d.counts.away} away, ${d.counts.asleep} asleep` }));
  if (!rows.length) rows.push(Object.assign(document.createElement('p'), { className: 'admin-empty', textContent: 'Nothing here yet.' }));
  $('adminListBody').replaceChildren(...rows);
}
drawAdmin();
