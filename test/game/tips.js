/* ---------- first steps: short tips in the pill above your needs, each shown once (0.1.10) ----------
   For someone new. Nothing else says how to walk, how to pick things up, what the rings are, how to eat and drink, or
   where crafting is. Luke picked these five (25 Nov 2026): ask him before adding another. The words are in
   game-data.json (tips.words, in the order they're given); what each one waits for is here (TIP_RULES, by id).
   - One shows at a time. It goes once you've done what it says, or after tips.show seconds.
   - The next one waits tips.gap seconds, or tips.pace seconds if you haven't tried the last one yet.
   - A tip for something you've already done is never shown.
   - Which ones you've seen is kept on this phone (pocket-life:tips), so each shows once. */
import { game, share } from './links.js';
import { DATA } from './core.js';
import { $ } from './items.js';
import { player, ui, you } from './you.js';
// shared for files further down game/main.js, and the variables other files change (game/links.js)
share({
  hideHint, tipDid,
});

const TIP_SET = DATA.tips || {};
const TIP_WORDS = TIP_SET.words || {};
const TIPS_KEY = 'pocket-life:tips';
let tipsSeen = []; // the ids seen on this phone
try { const kept = JSON.parse(localStorage.getItem(TIPS_KEY) || '[]'); if (Array.isArray(kept)) tipsSeen = kept; } catch (err) { /* nothing kept */ }
const tipClock = () => performance.now() / 1000; // seconds, by the phone's clock (the game's own clock stops in maintenance)
// What each tip waits for. b is what was so when you came into the world, and what you've done since (tip.base).
// done: you've done what it says. min: it stays at least this long anyway (two things to read).
const TIP_RULES = {
  walk: { min: 5, done: (b) => Math.hypot(player.position.x - b.x, player.position.z - b.z) > 2 },
  pickup: { done: () => Object.values(you.carry || {}).some((n) => n > 0) },
  rings: { done: (b) => b.rings },
  food: { done: (b) => !!you.stats && (you.stats.hunger > b.hunger + 3 || you.stats.thirst > b.thirst + 3) }, // (needs only ever go up by eating or drinking)
  craft: { done: (b) => b.bag || (you.found || []).length > 0 },
};
const tipOrder = () => Object.keys(TIP_WORDS).filter((id) => TIP_RULES[id]);
export const tip = { id: null, since: 0, hidAt: -999, tried: true, base: null }; // the one showing, when the last one went, and whether it was tried
function saveTips() { try { localStorage.setItem(TIPS_KEY, JSON.stringify(tipsSeen)); } catch (err) { /* not kept: they'll show again next visit */ } }
function markTip(id) { if (!tipsSeen.includes(id)) { tipsSeen.push(id); saveTips(); } }
// coming into the world: what "done" is measured from
export function startTips() {
  hideHint();
  tip.base = { x: player.position.x, z: player.position.z, hunger: null, thirst: null, rings: false, bag: false };
  tip.hidAt = -999;
  tip.tried = true;
}
// something a tip waits for was just done (the rings were opened, the inventory was opened)
export function tipDid(what) { if (tip.base) tip.base[what] = true; }
// the pill is put away: leaving the world, or the rings or the inventory opened over it. Seen, if it had been up a few seconds.
export function hideHint() {
  $('hint').hidden = true;
  if (!tip.id) return;
  if (tipClock() - tip.since >= 3) { markTip(tip.id); tip.hidAt = tipClock(); tip.tried = false; }
  tip.id = null;
}
// is there room for the pill, and is your person up and about?
const tipRoom = () => !game.paused && !you.sleeping && !game.bagOpen() && !$('needs').classList.contains('open') && $('chat').hidden && !game.placing.on
  && !document.querySelector('.modal:not([hidden])') && $('back').hidden;
// once a second while you play (loop.js)
export function tickTips() {
  const b = tip.base;
  if (ui.mode !== 'world' || !player || you.dead || !b) return;
  const now = tipClock();
  if (you.stats) { b.hunger = Math.min(b.hunger ?? Infinity, you.stats.hunger); b.thirst = Math.min(b.thirst ?? Infinity, you.stats.thirst); } // the lowest they've been
  const rule = (id) => TIP_RULES[id] || {};
  const done = (id) => !!(rule(id).done && rule(id).done(b));
  if (tip.id) { // one is showing
    const age = now - tip.since, did = done(tip.id);
    if ((did && age >= (rule(tip.id).min || 0)) || age >= (TIP_SET.show ?? 15)) {
      $('hint').hidden = true;
      markTip(tip.id);
      tip.id = null; tip.hidAt = now; tip.tried = did;
    }
    return;
  }
  const id = tipOrder().find((t) => !tipsSeen.includes(t));
  if (!id) return;
  if (done(id)) { markTip(id); return; } // already done: never shown
  if (now - tip.hidAt < (tip.tried ? TIP_SET.gap ?? 5 : TIP_SET.pace ?? 30) || !tipRoom()) return; // a breather first (longer if the last one hasn't been tried)
  $('hint').textContent = String(TIP_WORDS[id]);
  $('hint').hidden = false;
  tip.id = id;
  tip.since = now;
}
