/* ---------- societies (0.1.4): groups of players sharing one claim. The server decides everything (server/src/societies.js) ----------
   Your society comes with your person ('me'): you.soc = { id, name, lead, max, members: [{ id, name, lead, state }] }.
   Menu > Society starts one or shows who's in it. The leader taps a person nearby to invite them (inviteAction, used by
   the person's tap menu in input.js); the invite card asks them to Join. Everyone's name tag shows their society
   (others.js drawTag). Its one claim is the leader's lit campfire, th.claim.who 's:<id>' (claimMine in placeables.js). */
const SOCIETY = { maxMembers: 3, nameMax: 20, inviteMinutes: 5, inviteReach: 8, ...(DATA.societies || {}) };
you.soc = null;
const socSend = (m) => { if (!online()) { showTag("You're offline right now", headTop(), 2.5); return false; } net.sock.send(JSON.stringify(m)); return true; };
// news from the server about societies
function societyMessage(m) {
  if (m.t === 'socTag') { const o = others.get(m.id); if (o) { o.soc = m.soc || null; drawTag(o); } }
  else if (m.t === 'socInvite') showInvite(m);
  else if (m.t === 'socNote') showTag(m.text, headTop(), 3.5);
  else if (m.t === 'socNo') { // a no: said where you're looking (the invite card, the Society panel), else over your person
    if (!$('socInvite').hidden && invite && invite.asked) { $('socInviteNote').textContent = m.why; $('socInviteNote').hidden = false; invite.asked = false; }
    else if (!$('society').hidden && !$('socStartForm').hidden) { $('socErr').textContent = m.why; $('socErr').hidden = false; }
    else showTag(m.why, headTop(), 3.5);
  }
}
// 'me' carries your society: the panel, the invite card and the claim rings follow it
function setSociety(soc) {
  const was = JSON.stringify(you.soc);
  you.soc = soc && soc.name ? soc : null;
  if (JSON.stringify(you.soc) === was) return;
  if (!$('society').hidden) drawSociety();
  if (you.soc && invite) hideInvite(); // you joined
  claimCheckAt = 0; // claim rings: yours or theirs (placeables.js)
}

/* ---------- the Society panel (Menu > Society) ---------- */
function openSociety() {
  if (ui.mode !== 'world' || !player || you.dead) return;
  closeMenu();
  paused = true;
  $('socName').value = '';
  drawSociety();
  $('society').hidden = false;
}
function closeSociety() { $('society').hidden = true; paused = false; $('socName').blur(); }
$('socClose').addEventListener('click', closeSociety);
$('society').addEventListener('click', (e) => { if (e.target === $('society')) closeSociety(); });
$('pauseSocietyBtn').addEventListener('click', () => { closePause(); openSociety(); });
// your own claim's fire (lit), if you have one
const myOwnClaim = () => [...placed.values()].find((th) => claimOn(th) && th.claim.who === net.myId) || null;
const STATE_SHORT = { away: 'away', asleep: 'away, asleep', sleeping: 'sleeping', gone: 'no person right now' };
function drawSociety() {
  const s = you.soc, list = $('socMembers');
  $('socErr').hidden = true;
  resetLeave(); // (a Leave tapped once goes back to Leave)
  if (!s) {
    $('socTitle').textContent = 'Society';
    $('socText').textContent = `Start one, then tap people nearby to invite them (up to ${SOCIETY.maxMembers} in all). Members share one claim: ${myOwnClaim() ? 'yours becomes the society\'s' : 'the leader\'s lit campfire'}.`;
    $('socStartForm').hidden = false;
    list.replaceChildren();
    $('socFoot').hidden = true;
    return;
  }
  const leader = s.members.find((x) => x.lead), n = s.members.length;
  $('socTitle').textContent = s.name;
  $('socText').textContent = s.lead
    ? (n < s.max ? `You lead it. Tap a person nearby to invite them (${n} of ${s.max}).` : `You lead it. It's full (${n} of ${s.max}).`)
    : `${leader ? leader.name : 'Someone'} leads it (${n} of ${s.max}). You share its claim.`;
  $('socStartForm').hidden = true;
  list.replaceChildren(...s.members.map((x) => {
    const row = el('div', 'soc-member'), who = el('div', 'soc-who', x.id === net.myId ? `${x.name} (you)` : x.name);
    const sub = [x.lead ? 'Leader' : '', STATE_SHORT[x.state] || ''].filter(Boolean).join(' · ');
    if (sub) who.appendChild(el('small', '', sub));
    row.appendChild(who);
    if (s.lead && x.id !== net.myId) { // the leader can take someone out
      const out = el('button', 'small-btn', 'Remove');
      out.type = 'button';
      twoTaps(out, () => socSend({ t: 'socRemove', id: x.id }), 'Tap again', 400);
      row.appendChild(out);
    }
    return row;
  }));
  const foot = $('socFoot'), leave = $('socLeave'), next = s.lead && n > 1 ? s.members.find((x) => !x.lead) : null;
  foot.hidden = false;
  foot.replaceChildren(el('small', '', s.lead && n === 1 ? 'Leaving ends it' : next ? `${next.name} leads if you leave` : ''), leave);
}
// Leave: two taps (it can't be undone; you'd need a new invite)
const resetLeave = twoTaps($('socLeave'), () => { if (socSend({ t: 'socLeave' })) closeSociety(); }, 'Tap again to leave', 400);
$('socStartForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('socName').value.trim().slice(0, SOCIETY.nameMax);
  if (name.length < 2) { $('socErr').textContent = 'At least 2 letters'; $('socErr').hidden = false; return; }
  $('socErr').hidden = true;
  socSend({ t: 'socStart', name });
});

/* ---------- inviting: the leader taps a person (input.js thingActions) ---------- */
function inviteAction(o) {
  const s = you.soc;
  if (!s || !s.lead) return null;
  if (o.soc && o.soc === s.name) return { label: `In ${s.name}`, disabled: true };
  const far = player && Math.hypot(o.mesh.position.x - player.position.x, o.mesh.position.z - player.position.z) > SOCIETY.inviteReach;
  const away = o.state === 'away' || o.state === 'asleep'; // (their player isn't here to answer)
  const why = o.soc ? `In ${o.soc}` : s.members.length >= s.max ? `${s.name} is full` : away ? "Away, so they can't answer" : far ? 'Get closer first' : '';
  return { label: 'Invite to society', note: why || s.name, disabled: !!why, run: () => socSend({ t: 'socInvite', id: o.id }) };
}

/* ---------- the invite card: someone invited you ---------- */
let invite = null, inviteTimer = null; // { soc, by, until, asked }
function showInvite(m) {
  invite = { soc: m.soc, by: m.by, until: Date.now() + (Number(m.ms) || SOCIETY.inviteMinutes * 60000), asked: false };
  $('socInviteText').textContent = `${m.by} invites you to join ${m.soc}`;
  drawInvite();
  $('socInvite').hidden = false;
  clearInterval(inviteTimer);
  inviteTimer = setInterval(() => { if (!invite || Date.now() > invite.until) hideInvite(); else drawInvite(); }, 2000);
}
// your own fire holds your claim: it has to go out first (lighting a fire starts a claim, putting it out ends it)
function drawInvite() {
  if (!invite || invite.asked) return;
  const note = $('socInviteNote'), own = myOwnClaim();
  note.textContent = own ? 'Put your fire out first: it holds your claim' : '';
  note.hidden = !own;
}
function hideInvite() { invite = null; clearInterval(inviteTimer); inviteTimer = null; $('socInvite').hidden = true; $('socInviteNote').hidden = true; }
$('socYes').addEventListener('click', () => { if (invite && socSend({ t: 'socAnswer', yes: true })) invite.asked = true; });
$('socNo').addEventListener('click', () => { if (invite) socSend({ t: 'socAnswer', yes: false }); hideInvite(); });
