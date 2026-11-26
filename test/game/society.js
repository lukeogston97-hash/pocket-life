/* ---------- societies (0.1.4, reworked 0.1.5): your claim is your society, and players see both as a camp (0.1.6,
   docs/design/wording.md). The server decides everything (server/src/societies.js) ----------
   Lighting your first campfire starts yours ("<name>'s camp"); the fire going out ends it. It comes with your person
   ('me'): you.soc = { id, name, lead, max, members: [{ id, name, lead, state }] }. Menu > Society shows who's in it, and
   the leader can rename it. The leader taps a person nearby to invite them (inviteAction, used by the person's tap menu
   in input.js); the invite card asks them to Join. Name tags show it once it has 2 or more people (others.js drawTag).
   Its claim is th.claim.who 's:<id>' (claimMine in placeables.js). */
import { game, share } from './links.js';
import { DATA } from './core.js';
import { $ } from './items.js';
import { headTop, player, showTag, ui, you } from './you.js';
import { claimOn, placed } from './placeables.js';
import { closeMenu, closePause } from './input.js';
import { net, others } from './online.js';
import { el, twoTaps } from './admin.js';
import { drawTag, online, PERSON_STATE_WORDS } from './others.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  closeSociety, inviteAction, setSociety, get SOCIETY() { return SOCIETY; }, societyMessage,
});

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
    else if (!$('society').hidden && !$('socNameForm').hidden) { $('socErr').textContent = m.why; $('socErr').hidden = false; }
    else showTag(m.why, headTop(), 3.5);
  }
}
// 'me' carries your society: the panel, the invite card and the claim rings follow it
function setSociety(soc) {
  const was = JSON.stringify(you.soc);
  you.soc = soc && soc.name ? soc : null;
  if (JSON.stringify(you.soc) === was) return;
  if (!$('society').hidden) drawSociety();
  if (you.soc && invite && you.soc.name === invite.soc) hideInvite(); // you joined
  game.claimCheckAt = 0; // claim rings: yours or theirs (placeables.js)
}

/* ---------- the Society panel (Menu > Society) ---------- */
export function openSociety() {
  if (ui.mode !== 'world' || !player || you.dead) return;
  closeMenu();
  game.paused = true;
  drawSociety();
  $('society').hidden = false;
}
function closeSociety() { $('society').hidden = true; game.paused = false; $('socName').blur(); }
$('socClose').addEventListener('click', closeSociety);
$('society').addEventListener('click', (e) => { if (e.target === $('society')) closeSociety(); });
$('pauseSocietyBtn').addEventListener('click', () => { closePause(); openSociety(); });
// your own claim's fire from before 0.1.5 (lit), if you have one
const myOwnClaim = () => [...placed.values()].find((th) => claimOn(th) && th.claim.who === net.myId) || null;
const STATE_SHORT = { ...PERSON_STATE_WORDS, gone: 'not in the world' }; // (others.js)
export function drawSociety() {
  const s = you.soc, list = $('socMembers');
  $('socErr').hidden = true;
  resetLeave(); // (a Leave tapped once goes back to Leave)
  if (!s) { // lighting your first campfire starts your society (0.1.5)
    $('socTitle').textContent = 'Camp';
    $('socText').textContent = `Light a campfire away from the pond to start your own camp. The land round the fire is yours while it burns, and you can invite up to ${SOCIETY.maxMembers - 1} more people. Or join someone else's camp when they invite you.`;
    $('socNameForm').hidden = true;
    list.replaceChildren();
    $('socFoot').hidden = true;
    return;
  }
  const leader = s.members.find((x) => x.lead), n = s.members.length;
  $('socTitle').textContent = s.name;
  $('socText').textContent = s.lead
    ? (n < s.max ? `You lead this camp. Tap someone nearby to invite them (${n} of ${s.max}).` : `You lead this camp. It's full (${n} of ${s.max}).`)
    : `${leader ? leader.name : 'Someone'} leads this camp (${n} of ${s.max}). You can use everything in it.`;
  $('socNameForm').hidden = !s.lead; // the leader can rename it
  if (s.lead && document.activeElement !== $('socName')) $('socName').value = s.name;
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
  // Leave (two taps). Alone, leaving ends it and its fire goes out (Luke: the claim and the society end together)
  const foot = $('socFoot'), leave = $('socLeave'), next = s.lead && n > 1 ? s.members.find((x) => !x.lead) : null;
  foot.hidden = false;
  leave.textContent = n === 1 ? 'End camp' : 'Leave';
  foot.replaceChildren(el('small', '', n === 1 ? 'Its fire goes out' : next ? `${next.name} leads if you leave` : ''), leave);
}
const resetLeave = twoTaps($('socLeave'), () => { if (socSend({ t: 'socLeave' })) closeSociety(); }, 'Tap again', 400);
$('socNameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('socName').value.trim().slice(0, SOCIETY.nameMax);
  if (name.length < 2) { $('socErr').textContent = 'At least 2 letters'; $('socErr').hidden = false; return; }
  $('socErr').hidden = true;
  $('socName').blur();
  if (you.soc && name !== you.soc.name) socSend({ t: 'socRename', name });
});

/* ---------- inviting: the leader taps a person (input.js thingActions) ---------- */
export function inviteAction(o) {
  const s = you.soc;
  if (!s || !s.lead) return null;
  if (o.soc && o.soc === s.name) return { label: `In ${s.name}`, disabled: true }; // (o.soc shows only with 2 or more: someone alone in their own can be invited)
  const far = player && Math.hypot(o.mesh.position.x - player.position.x, o.mesh.position.z - player.position.z) > SOCIETY.inviteReach;
  const away = o.state === 'away' || o.state === 'asleep'; // (their player isn't here to answer)
  const why = o.soc ? `In ${o.soc}` : s.members.length >= s.max ? `${s.name} is full` : away ? "Away, so they can't answer" : far ? 'Get closer first' : '';
  return { label: 'Invite to camp', note: why || s.name, disabled: !!why, run: () => socSend({ t: 'socInvite', id: o.id }) };
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
// alone in your own society, your fire holds your claim: it has to go out first (that ends it). In one with others: leave it first
function drawInvite() {
  if (!invite || invite.asked) return;
  const note = $('socInviteNote'), s = you.soc;
  const why = s ? (s.members.length > 1 ? `Leave ${s.name} first` : 'Put your fire out first: that ends your camp') : myOwnClaim() ? 'Put your fire out first: that ends your camp' : '';
  note.textContent = why;
  note.hidden = !why;
}
function hideInvite() { invite = null; clearInterval(inviteTimer); inviteTimer = null; $('socInvite').hidden = true; $('socInviteNote').hidden = true; }
$('socYes').addEventListener('click', () => { if (invite && socSend({ t: 'socAnswer', yes: true })) invite.asked = true; });
$('socNo').addEventListener('click', () => { if (invite) socSend({ t: 'socAnswer', yes: false }); hideInvite(); });
