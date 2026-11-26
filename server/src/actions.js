// What players do: one small handler for each kind of message from the game. To add a new action (planting a seed,
// placing a campfire...), add an entry here: when is 'any' (works without a person, like feedback), 'alive' (needs your
// person, with their needs caught up to now) or 'world' (also needs the shared world). run gets the message (m), your
// person (p), the world (w), reply() to answer just you, and save() to save your person straight away; `this` is the
// world (index.js), so this.send() tells everyone. Remember a spam limit in LIMITS (shared.js) for anything new.
import { PLACEABLES, fireRule, seatAt, CROPS, cropSource, cropGrown, cropBerries } from './placed.js';
import { SOC, socMax, INVITE_MS } from './societies.js';
import { fuelRoom, placeSnap, placeClash, berryPicked } from './rules.js';
import { FILTER, G, starText, badName, freshStats, addCarry, takeCarry, wearList, applyGives, eatOne, craft, spend, clean, blank, num, kindOk, START, REST, BERRY_SRC, cleanLook, REPORTS_KEEP, laidNow, onBar, equipTool, unequipTool, HOUR } from './shared.js';
const SIT_OPEN = 365 * 24 * 3600000; // sitting has no set time: `until` is far off, and ends when they stand up, do something else, or the fire goes out

export const ACTIONS = {
  // feedback from the Send feedback screen
  feedback: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    await this.addFeedback(m, me.from, me.self);
    if (!m.auto) reply({ t: 'thanks' }); // (auto: a note the game sent by itself about an error)
  } },
  // leaving the world for good (Settings, 0.1.11): their person, past people and feedback are removed (persons.js, forget).
  // It works from the main menu too. The phone's own id (pid) is what proves it's theirs, the same as hello.
  forget: { when: 'any', async run({ ws, me, m, reply }) {
    if (!m.pid) return;
    await this.forget(await this.whoFor(m), ws, me);
    reply({ t: 'forgotten' });
  } },
  // Play on other devices (accounts.js): get a link code, use one, unlink this device; all work from the main menu too
  linkCode: { when: 'any', async run({ m, reply }) { if (m.pid) await this.linkCode(m, reply); } },
  linkUse: { when: 'any', async run({ ws, me, m, reply }) { if (m.pid) await this.linkUse(ws, me, m, reply); } },
  unlink: { when: 'any', async run({ m, reply }) { if (m.pid) await this.unlink(m, reply); } },
  // reporting another player (kept with what they said lately)
  report: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    const them = this.persons.get(m.id), sock = this.socketOf(m.id);
    if (!them) { reply({ t: 'reported', ok: false }); return; }
    if (!this.reportOk(me.from)) { reply({ t: 'slow' }); return; } // too many from one address, however many connections it opens (guard.js)
    const list = (await this.ctx.storage.get('reports')) || [];
    list.push({ at: new Date().toISOString(), by: { name: p ? p.name : '', who: me.who }, about: { name: them.name, who: them.who, v: sock ? sock.p.v : '' },
      reason: clean(m.reason, 30), note: clean(m.note, 500), said: (sock && sock.p.said) || [], x: num(them.x), z: num(them.z) });
    await this.put('reports', list.slice(-REPORTS_KEEP));
    this.tellAdmins({ t: 'adminNew', list: 'reports' });
    reply({ t: 'reported', ok: true });
    return;
  } },
  // their task list (0.1.7): the game sends what's left of it when it changes and when they leave, so their person can
  // carry on with it while they're away (tasks.js). Saved with them; only run while they're away.
  tasks: { when: 'alive', async run({ m, p }) {
    p.tasks = this.cleanTasks(m.list);
    p.took = [];
    this.touchLater(p);
  } },
  // the game asks for its person again (after sending what it did while the connection was down)
  sync: { when: 'alive', async run({ p, reply }) { reply(this.mine(p)); } },
  // making a new person
  create: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    if (this.alive(p)) { reply(this.mine(p)); return; }
    const name = clean(m.name, 20).trim();
    if (!name || blank(name) || (!me.admin && badName(name, FILTER))) { reply({ t: 'badName' }); return; } // (blank: a name nobody could see)
    if (this.nameTaken(name, me.who)) { reply({ t: 'badName', taken: true }); return; } // (names are one of a kind: persons.js)
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
    const np = { who: me.who, state: 'alive', name, look: cleanLook({ ...m.look, name }), age: Math.max(G.age.min, Math.min(G.age.max, Math.round(Number(m.age) || G.age.min))),
      born: Date.now(), x: num(START.x + Math.cos(a) * r), z: num(START.z + Math.sin(a) * r), ry: 0.62,
      stats: freshStats(G), statsAt: Date.now(), carry: {}, bar: {}, lastKind: null, log: { ate: 0, drank: 0, picked: 0 },
      found: (p && Array.isArray(p.found) ? p.found : []).filter((id) => Object.hasOwn(G.recipes || {}, id)) }; // the recipes the last person found carry over (Luke, 0.1.8)
    this.persons.set(me.who, np);
    this.note('world', `New person: ${name}, ${np.age}`);
    me.alive = true;
    this.attach(ws, me);
    this.touch(np);
    await this.flush(np.who);
    reply(this.mine(np));
    this.send({ t: 'join', person: this.pub(np) }, me.id);
    return;
  } },
  // a speech bubble (bad words starred out)
  say: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    const text = starText(clean(m.text, 80).trim(), FILTER);
    if (!text || blank(text) || !this.alive(p)) return;
    me.said = [...(me.said || []), [Date.now(), text]].slice(-8); // kept for reports
    while (me.said.length > 1 && new TextEncoder().encode(JSON.stringify(me)).length > 1800) me.said.shift(); // (what's kept with a connection has to stay under 2 KB)
    this.attach(ws, me);
    if (this.admin.muted.includes(me.who)) reply({ t: 'say', id: me.id, text }); // muted by the admin: only they see it
    else this.send({ t: 'say', id: me.id, text }, null);
    return;
  } },
  // laying out a brand new world
  seed: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    if (!w) await this.seed(m, me); // the first player into a brand new world lays it out
  } },
  // the layout's open spots, shore and bushes (for people strolling while away)
  layout: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    if (w && this.needLayout(me)) { this.takeLayout(me, m); await this.save(); } // where things are: for people away, and for reach (guard.js)
  } },
  // bending, picking, kneeling to drink, chopping: shown to everyone else
  act: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const pose = ['bend', 'kneel', 'pick', 'chop'].includes(m.pose) ? m.pose : 'bend';
    this.send({ t: 'act', id: me.id, pose, seconds: Math.max(0.3, Math.min(25, Number(m.seconds) || 0.5)) }, me.id);
  } },
  // walking: once with where the walk ends, and now and then on the way
  move: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const nx = num(m.x), nz = num(m.z), moved = Math.hypot(nx - p.x, nz - p.z);
    if (!this.moveOk(ws, me, p, nx, nz)) { reply({ t: 'pos', x: num(p.x), z: num(p.z) }); return; } // too far, off the map or asleep: back where they really are (guard.js)
    if (p.sit && moved > 0.4) this.standUp(p); // walked off: no longer sitting
    if (moved < 30) spend(p, 'walkPerMetre', G, moved); // walking takes a little energy
    p.x = nx; p.z = nz; p.ry = num(m.ry);
    this.touch(p);
    // a walk is sent once with where it's going (tx, tz), plus now and then where they've got to; everyone else's game walks them there
    const go = Number.isFinite(m.tx) && Number.isFinite(m.tz) ? { tx: num(m.tx), tz: num(m.tz), sp: Number.isFinite(m.sp) ? Math.min(1, Math.max(0.3, m.sp)) : 1 } : {};
    this.send({ t: 'move', id: me.id, x: p.x, z: p.z, ry: p.ry, ...go }, me.id);
  } },
  // lie down to rest, or get up
  sleep: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    if (!m.on && p.collapsed && p.stats.rest < (REST.wakeAt || 0)) { reply(this.mine(p)); return; } // too tired to get up yet
    p.sleeping = !!m.on;
    if (p.sleeping) { this.standUp(p); p.sleptAt = Date.now(); }
    if (!p.sleeping) p.collapsed = false;
    save();
    reply(this.mine(p));
    this.send({ t: 'state', id: me.id, state: p.sleeping ? 'sleeping' : 'online', x: num(p.x), z: num(p.z) }, me.id);
  } },
  // making something from a recipe; one with "near" (cooking) needs a built one of that close by, a fire lit.
  // The first time someone makes one, it goes in their found recipes (p.found: the Found list on the craft mat, 0.1.8)
  craft: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const r = Object.hasOwn(G.recipes || {}, String(m.id)) ? G.recipes[m.id] : null; // (only a real recipe: a name every object has, like 'constructor', isn't one)
    if (r && r.seconds && (!r.near || this.stationFor(p, r.near)) && !this.worked(ws, me, p, r.seconds)) { reply({ t: 'slow' }); reply(this.mine(p)); return; } // cooking takes time (guard.js)
    if (r && (!r.near || this.stationFor(p, r.near)) && craft(p, r, G)) {
      spend(p, 'craft', G);
      p.found = Array.isArray(p.found) ? p.found : [];
      if (!p.found.includes(m.id)) p.found.push(m.id);
      save();
    }
    reply(this.mine(p));
  } },
  // eating one thing from your inventory
  eat: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    if (eatOne(p, G, m.kind)) save();
    reply(this.mine(p));
  } },
  // the tool bar (0.1.17, Luke): equip a tool from the inventory (m.which: which one, as its place in that tool's wear list;
  // m.out: a tool on the bar to swap it with when the bar is full), or take one off (unequip). No walking, no time.
  equip: { when: 'alive', async run({ m, p, reply, save }) {
    const out = m.out && typeof m.out === 'object' && kindOk(m.out.kind) ? { kind: m.out.kind, which: m.out.which } : null;
    const why = kindOk(m.kind) ? equipTool(p, m.kind, m.which, out, G) : "That isn't in your inventory";
    if (why) reply({ t: 'placeNo', why }); else save();
    reply(this.mine(p));
  } },
  unequip: { when: 'alive', async run({ m, p, reply, save }) {
    const why = kindOk(m.kind) ? unequipTool(p, m.kind, m.which, G) : "That isn't on your tool bar";
    if (why) reply({ t: 'placeNo', why }); else save();
    reply(this.mine(p));
  } },
  // drinking at the pond
  drink: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const src = Object.hasOwn(G.sources || {}, String(m.source)) ? G.sources[m.source] : null;
    if (src && src.gives && src.water && (me.admin || this.nearWater(p))) { applyGives(p, src.gives); spend(p, 'drink', G); save(); }
    reply(this.mine(p));
  } },
  // fishing at the pond (0.3.4): the spear wears, the pond holds a shared number of fish, and some tries catch nothing
  fish: { when: 'alive', async run({ ws, me, p, w, reply, save }) {
    const F = (Object.values(G.sources).find((s) => s.water && s.fish) || {}).fish;
    if (!F || !onBar(p, F.tool, G)) { reply(this.mine(p)); return; } // only a tool on the tool bar gets used (0.1.17)
    if (!me.admin && !this.nearWater(p)) { reply({ t: 'fished', why: 'Too far away' }); reply(this.mine(p)); return; }
    if (!this.worked(ws, me, p, F.seconds)) { reply({ t: 'fished', why: 'Slow down a little' }); reply(this.mine(p)); return; } // a try takes time (guard.js)
    spend(p, 'fish', G);
    this.wearTool(p, F.tool, reply);
    if (this.pondFish(F) < 1) reply({ t: 'fished', why: 'No fish left. Try again later' });
    else if (Math.random() >= F.chance) reply({ t: 'fished', why: 'Nothing bites' });
    else if (!addCarry(p, F.catch, 1, G)) reply({ t: 'fished', why: 'Too heavy' });
    else { w.pond.fish -= 1; reply({ t: 'fished', caught: F.catch }); await this.save(); }
    save();
    reply(this.mine(p));
  } },
  // picking something up off the ground
  take: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const i = w.items.findIndex((it) => it.id === m.id);
    const c = i >= 0 && this.notYours(p, w.items[i].x, w.items[i].z, me.admin);
    if (c) { reply({ t: 'took', id: m.id, ok: false, why: this.claimNo(c) }); return; } // inside someone else's claim
    if (i < 0) { reply({ t: 'took', id: m.id, ok: false }); return; } // someone got there first
    if (!me.admin && !this.near(p, [w.items[i].x, w.items[i].z])) { reply({ t: 'took', id: m.id, ok: false, why: 'Too far away' }); return; }
    const got = w.items[i];
    if (!addCarry(p, got.kind, 1, G, got.uses)) { reply({ t: 'took', id: m.id, ok: false, why: 'Too heavy' }); return; } // (a worn tool stays worn; a tool goes on the tool bar if there's room)
    w.items.splice(i, 1);
    spend(p, 'pickup', G);
    reply({ t: 'took', id: m.id, ok: true }); // (said before saving, so the game always hears it before any other news of what they carry)
    if (G.items[got.kind].uses) reply(this.mine(p)); // a tool: the game shows how worn it is and where it went (the tool bar or the inventory) straight away
    this.send({ t: 'gone', id: m.id }, me.id);
    await this.save();
    save();
  } },
  // putting things down
  drop: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const added = [];
    for (const it of (Array.isArray(m.items) ? m.items : []).slice(0, 60)) {
      if (!it || !kindOk(it.kind) || !Object.hasOwn(G.items, it.kind) || !Object.hasOwn(p.carry, it.kind) || !p.carry[it.kind]) continue; // a real item they really carry
      const full = (G.items[it.kind] || {}).uses, which = Number.isInteger(it.which) && it.which >= 0 && it.which < p.carry[it.kind] ? it.which : undefined; // which tool (0 is the one in use)
      const uses = full ? wearList(p, it.kind, G)[which ?? p.carry[it.kind] - 1] : null;
      if (!takeCarry(p, it.kind, 1, which)) continue;
      const here = Number.isFinite(it.x) && Number.isFinite(it.z) && (me.admin || this.near(p, [it.x, it.z])); // not near them: it lands by their feet
      const item = { id: w.nextId++, kind: it.kind, x: num(here ? it.x : p.x + (Math.random() - 0.5) * 0.8), z: num(here ? it.z : p.z + (Math.random() - 0.5) * 0.8), rot: num(it.rot), laid: laidNow() };
      if (uses != null && uses < full) item.uses = uses; // a worn tool stays worn on the ground
      w.items.push(item);
      added.push(item);
    }
    save();
    reply(this.mine(p));
    if (!added.length) return;
    await this.save();
    this.send({ t: 'added', items: added }, null);
  } },
  // chopping a tree, digging out a stump, or chopping a log into sticks
  chop: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const C = G.chopping || {}, rule = C[m.what === 'oldStump' ? 'stump' : m.what], tool = C.tool;
    if (!rule || (tool && !onBar(p, tool, G))) { reply(this.mine(p)); return; }
    // where it is: a log's own spot, a tree or stump's spot in the layout (guard.js), else what the game says if that's near them
    const laidOut = ['tree', 'stump', 'oldStump'].includes(m.what), log = !laidOut && w.items.find((it) => it.id === m.id && it.kind === m.what);
    if (!laidOut && !log) { reply(this.mine(p)); return; } // the log has gone
    if (laidOut && !this.isThing(m.what === 'oldStump' ? 'oldStump' : 'tree', Math.floor(m.idx))) { reply(this.mine(p)); return; } // no such tree or stump (guard.js)
    const said = Number.isFinite(m.x) && Number.isFinite(m.z) && this.near(p, [m.x, m.z]) ? [num(m.x), num(m.z)] : [p.x, p.z];
    let at = log ? [log.x, log.z] : this.spotOf(m.what === 'oldStump' ? 'oldStump' : 'tree', Math.floor(m.idx)) || said;
    if (!me.admin && !this.near(p, at)) { reply({ t: 'placeNo', why: 'Too far away' }); reply(this.mine(p)); return; }
    const cl = this.notYours(p, at[0], at[1], me.admin);
    if (cl) { reply({ t: 'placeNo', why: this.claimNo(cl) }); reply(this.mine(p)); return; }
    if (!this.worked(ws, me, p, rule.seconds)) { reply({ t: 'slow' }); reply(this.mine(p)); return; } // chopping takes time (guard.js)
    w.trees = w.trees || {};
    if (m.what === 'oldStump') { // an old stump that was already in the world: dug out for good
      const i = Math.floor(m.idx);
      if (!(i >= 0 && i < 5000)) return;
      w.oldStumps = w.oldStumps || {};
      if (w.oldStumps[i]) { reply({ t: 'oldStump', idx: i }); return; }
      w.oldStumps[i] = Date.now();
      this.send({ t: 'oldStump', idx: i }, null);
    } else if (m.what === 'tree' || m.what === 'stump') {
      const i = Math.floor(m.idx);
      if (!(i >= 0 && i < 5000)) return;
      const st = w.trees[i];
      if (m.what === 'tree' && st) { reply({ t: 'tree', idx: i, state: st[0] }); return; } // someone else got it first
      if (m.what === 'stump' && (!st || st[0] !== 'stump')) { reply({ t: 'tree', idx: i, state: st ? st[0] : 'tree' }); return; }
      w.trees[i] = [m.what === 'tree' ? 'stump' : 'gone', Date.now()];
      this.send({ t: 'tree', idx: i, state: w.trees[i][0], at: w.trees[i][1] }, null);
    } else {
      const j = w.items.findIndex((it) => it.id === m.id && it.kind === m.what);
      if (j < 0) { reply(this.mine(p)); return; }
      at = [w.items[j].x, w.items[j].z];
      w.items.splice(j, 1);
      this.send({ t: 'gone', id: m.id }, null);
    }
    // what falls: round where it was chopped
    const out = [];
    let n = 0;
    for (const [kind, count] of Object.entries(rule.gives || {})) for (let k = 0; k < count && n < 20; k++, n++) {
      const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.8;
      out.push({ id: w.nextId++, kind, x: num(at[0] + Math.cos(a) * r), z: num(at[1] + Math.sin(a) * r), rot: num(Math.random() * Math.PI), laid: laidNow() });
    }
    w.items.push(...out);
    if (out.length) this.send({ t: 'added', items: out }, null);
    spend(p, 'chop', G);
    this.wearTool(p, tool, reply);
    await this.save();
    save();
    reply(this.mine(p));
  } },
  // mining (0.2.9): breaking a rock (gone, one comes back now and then) or mining a boulder (it stays, and can be mined again after regrowDays)
  quarry: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const R = G.mining || {}, tool = R.tool, i = Math.floor(m.idx);
    if ((m.what !== 'rock' && m.what !== 'boulder') || !(i >= 0 && i < 2000)) return;
    const what = this.rockKind(i, m.what), rule = R[what]; // a rock or a boulder: the layout's word once it has one, not the game's (guard.js)
    if (!rule) return;
    if (tool && !onBar(p, tool, G)) { reply(this.mine(p)); return; }
    if (!this.isThing('rock', i)) { reply(this.mine(p)); return; } // no such rock (guard.js)
    const rock = this.spotOf('rock', i) || [p.x, p.z]; // where it is (guard.js), else where they're standing, next to it
    if (!me.admin && !this.near(p, rock, 1)) { reply({ t: 'placeNo', why: 'Too far away' }); reply(this.mine(p)); return; }
    const cl = this.notYours(p, rock[0], rock[1], me.admin);
    if (cl) { reply({ t: 'placeNo', why: this.claimNo(cl) }); reply(this.mine(p)); return; }
    w.rocks = w.rocks || {};
    if (w.rocks[i]) { reply({ t: 'rock', idx: i, state: w.rocks[i][0], at: w.rocks[i][1] }); return; } // someone else got it first
    if (!this.worked(ws, me, p, rule.seconds)) { reply({ t: 'slow' }); reply(this.mine(p)); return; } // mining takes time (guard.js)
    w.rocks[i] = [what === 'rock' ? 'gone' : 'mined', Date.now()];
    this.send({ t: 'rock', idx: i, state: w.rocks[i][0], at: w.rocks[i][1] }, null);
    // the stones fall round where you're standing
    const by = Number.isFinite(m.x) && Number.isFinite(m.z) && this.near(p, [m.x, m.z]), ax = by ? num(m.x) : p.x, az = by ? num(m.z) : p.z, out = [];
    for (const [kind, c] of Object.entries(rule.gives || {})) {
      const count = Array.isArray(c) ? c[0] + Math.floor(Math.random() * (c[1] - c[0] + 1)) : c;
      for (let k = 0; k < count && out.length < 20; k++) {
        const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.5;
        out.push({ id: w.nextId++, kind, x: num(ax + Math.cos(a) * r), z: num(az + Math.sin(a) * r), rot: num(Math.random() * Math.PI), laid: laidNow() });
      }
    }
    w.items.push(...out);
    if (out.length) this.send({ t: 'added', items: out }, null);
    spend(p, 'chop', G);
    this.wearTool(p, tool, reply);
    await this.save();
    save();
    reply(this.mine(p));
  } },
  // picking berries (2 at a time with a knife)
  pick: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const i = Math.floor(m.bush);
    if (!(i >= 0 && i < 200)) return;
    if (!this.isThing('bush', i)) { reply({ t: 'picked', bush: i, ok: false }); return; } // no such bush (guard.js)
    const at = this.spotOf('bush', i) || [p.x, p.z], cl = this.notYours(p, at[0], at[1], me.admin);
    if (cl) { reply({ t: 'picked', bush: i, ok: false, why: this.claimNo(cl) }); return; }
    if (!me.admin && !this.near(p, at)) { reply({ t: 'picked', bush: i, ok: false, why: 'Too far away' }); return; }
    // with the bush's tool (a knife) a few come off at once (toolHarvest), and the tool wears
    const many = BERRY_SRC.tool && BERRY_SRC.toolHarvest && onBar(p, BERRY_SRC.tool, G) ? Number(BERRY_SRC.toolHarvest[G.berryKind]) || 1 : 1;
    const n = this.berriesOn(i) >= many ? many : 1;
    if (this.berriesOn(i) < 1 || !addCarry(p, G.berryKind, n, G)) { reply({ t: 'picked', bush: i, ok: false }); return; }
    this.takeBerries(i, n);
    spend(p, 'harvest', G);
    if (n > 1) { this.wearTool(p, BERRY_SRC.tool, reply); reply(this.mine(p)); }
    save();
  } },
  // putting a placeable down (a campfire): it starts as an unbuilt site
  place: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const item = Object.hasOwn(G.items, String(m.kind)) ? G.items[m.kind] : null, kind = item && item.places, rule = kind && Object.hasOwn(PLACEABLES, kind) ? PLACEABLES[kind] : null;
    const { x, z, rot } = placeSnap(num(m.x), num(m.z), num(m.rot), rule); // on the placing grid (rules.js)
    const no = (why) => { reply({ t: 'placeNo', why }); reply(this.mine(p)); };
    if (!rule || !p.carry[m.kind]) return no('You need to carry it');
    if (Math.hypot(x - p.x, z - p.z) > 4) return no('Too far away');
    const cl = this.notYours(p, x, z, me.admin);
    if (cl) return no(this.claimNo(cl));
    if (placeClash(this.placedList(), { x, z, rot }, kind, PLACEABLES)) return no('Too close to something else');
    const land = me.admin ? null : this.cantPlaceAt(x, z); // not in the water, off the land or inside a tree or rock (guard.js)
    if (land) return no(land);
    takeCarry(p, m.kind, 1);
    const th = { id: w.nextId++, kind, x, z, rot, built: false, fuel: 0, lit: false, at: Date.now(), by: p.who }; // by: who built it (only they can pack it up or take it apart)
    this.placedList().push(th);
    spend(p, 'craft', G);
    await this.save();
    save();
    this.sendPlaced(th, reply, { mine: true });
    reply(this.mine(p));
  } },
  // building a site (it took buildSeconds in the game)
  build: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const th = this.placedById(m.id);
    if (!th || th.built || Math.hypot(th.x - p.x, th.z - p.z) > 3 || this.notYours(p, th.x, th.z, me.admin)) { if (th) this.sendPlaced(th, reply, {}); return; }
    if (!this.worked(ws, me, p, (PLACEABLES[th.kind] || {}).buildSeconds)) { this.sendPlaced(th, reply, {}); reply({ t: 'slow' }); return; } // building takes time (guard.js)
    th.built = true;
    th.at = Date.now();
    spend(p, 'build', G);
    await this.save();
    save();
    this.sendPlaced(th, null);
    reply(this.mine(p));
  } },
  // picking an unbuilt site back up (put it in the wrong place)
  // picking it back up: an unbuilt site, or packing up a built one (out, by who built it, nobody else sitting by it)
  unplace: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const list = this.placedList(), i = list.findIndex((th) => th.id === m.id);
    const th = list[i], item = th && PLACEABLES[th.kind] && PLACEABLES[th.kind].item;
    const no = (why) => { reply({ t: 'placeNo', why }); reply(this.mine(p)); };
    if (!th || Math.hypot(th.x - p.x, th.z - p.z) > 3) { reply(this.mine(p)); return; }
    if ((PLACEABLES[th.kind] || {}).madeWith) return no('Flatten it with a hoe'); // a farm field (0.1.18)
    const why = th.built ? this.whyNotTakeDown(th, p, me.admin) : '';
    if (why) return no(why);
    if (!addCarry(p, item, 1, G)) return no('Too heavy');
    if (p.sit && p.sit.fire === th.id) this.standUp(p);
    list.splice(i, 1);
    await this.save();
    save();
    this.send({ t: 'unplaced', id: th.id }, null);
    reply(this.mine(p));
  } },
  // taking a built one apart: what it was made from (its recipe) goes on the ground round it; once a fire has been lit,
  // the parts that burn (sticks, logs) are gone. Same rules as packing it up.
  apart: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const list = this.placedList(), i = list.findIndex((th) => th.id === m.id), th = list[i];
    const no = (why) => { reply({ t: 'placeNo', why }); reply(this.mine(p)); };
    if (!th || !th.built || Math.hypot(th.x - p.x, th.z - p.z) > 3) { reply(this.mine(p)); return; }
    if ((PLACEABLES[th.kind] || {}).madeWith) return no('Flatten it with a hoe'); // a farm field (0.1.18)
    const why = this.whyNotTakeDown(th, p, me.admin);
    if (why) return no(why);
    if (p.sit && p.sit.fire === th.id) this.standUp(p);
    list.splice(i, 1);
    const rule = PLACEABLES[th.kind], f = fireRule(th.kind), r = Object.values(G.recipes || {}).find((x) => x.makes[rule.item]);
    const out = [];
    for (const [kind, n] of Object.entries((r && r.needs) || {})) {
      if (th.burnt && f && f.fuels[kind]) continue;
      for (let k = 0; k < n && out.length < 40; k++) {
        const a = out.length * 2.39996, rad = (rule.solid || 0.5) + 0.35 + (out.length % 3) * 0.15;
        out.push({ id: w.nextId++, kind, x: num(th.x + Math.cos(a) * rad), z: num(th.z + Math.sin(a) * rad), rot: num(Math.random() * Math.PI), laid: laidNow() });
      }
    }
    w.items.push(...out);
    spend(p, 'tend', G);
    await this.save();
    save();
    this.send({ t: 'unplaced', id: th.id }, null);
    if (out.length) this.send({ t: 'added', items: out }, null);
    reply(this.mine(p));
  } },
  // a fire: light it, put it out, or add fuel (n sticks, as many as fit)
  // Farming (0.1.18, Luke): a farm field is dug with its tool (the stone hoe) on the tool bar, only in your own camp, on the
  // placing grid. It's ready straight away (no building) and takes a use of the hoe. m: { kind, x, z, rot }
  dig: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const kind = typeof m.kind === 'string' && Object.hasOwn(PLACEABLES, m.kind) ? m.kind : null, rule = kind && PLACEABLES[kind];
    const no = (why) => { reply({ t: 'placeNo', why }); reply(this.mine(p)); };
    if (!rule || !rule.madeWith) return no("That can't be dug");
    const tool = rule.madeWith, { x, z, rot } = placeSnap(num(m.x), num(m.z), num(m.rot), rule); // on the placing grid (rules.js)
    if (!onBar(p, tool, G)) return no(`You need a ${String((G.items[tool] || {}).name || tool).toLowerCase()} on your tool bar`);
    if (!me.admin && Math.hypot(x - p.x, z - p.z) > 4) return no('Too far away');
    if (rule.inCamp && !me.admin) { const c = this.claimAt(x, z); if (!c || !this.claimIsMine(c, p.who)) return no('Farm fields only go in your camp'); }
    if (placeClash(this.placedList(), { x, z, rot }, kind, PLACEABLES)) return no('Too close to something else');
    const land = me.admin ? null : this.cantPlaceAt(x, z); // not in the water, off the land or inside a tree or rock (guard.js)
    if (land) return no(land);
    if (!this.worked(ws, me, p, rule.makeSeconds)) { reply({ t: 'slow' }); reply(this.mine(p)); return; } // digging takes time (guard.js)
    const th = { id: w.nextId++, kind, x, z, rot, built: true, fuel: 0, lit: false, at: Date.now(), by: p.who };
    this.placedList().push(th);
    spend(p, 'dig', G);
    this.wearTool(p, tool, reply);
    await this.save();
    save();
    this.sendPlaced(th, null);
    reply(this.mine(p));
  } },
  // flattening a farm field with the same tool: back to grass, and whatever grew on it is gone
  flatten: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const list = this.placedList(), i = list.findIndex((th) => th.id === m.id), th = list[i], rule = th && PLACEABLES[th.kind];
    const no = (why) => { reply({ t: 'placeNo', why }); reply(this.mine(p)); };
    if (!th || !rule || !rule.madeWith) { reply(this.mine(p)); return; }
    if (!me.admin && Math.hypot(th.x - p.x, th.z - p.z) > 3 + (rule.solid || 0.5)) return no('Too far away');
    const c = this.notYours(p, th.x, th.z, me.admin);
    if (c) return no(this.claimNo(c));
    if (!onBar(p, rule.madeWith, G)) return no(`You need a ${String((G.items[rule.madeWith] || {}).name || rule.madeWith).toLowerCase()} on your tool bar`);
    if (!this.worked(ws, me, p, rule.flattenSeconds)) { reply({ t: 'slow' }); reply(this.mine(p)); return; }
    list.splice(i, 1);
    spend(p, 'dig', G);
    this.wearTool(p, rule.madeWith, reply);
    await this.save();
    save();
    this.send({ t: 'unplaced', id: th.id }, null);
    reply(this.mine(p));
  } },
  // planting seeds on an empty farm field (m.seed: the seed item): it grows by itself from now (placed.js)
  plant: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const th = this.placedById(m.id), rule = th && PLACEABLES[th.kind];
    const no = (why) => { reply({ t: 'placeNo', why }); if (th) reply({ t: 'placed', thing: this.placedView(th) }); reply(this.mine(p)); };
    if (!th || !rule || !rule.madeWith) { reply(this.mine(p)); return; }
    const kind = Object.keys(CROPS).find((k) => CROPS[k].seed === m.seed && (CROPS[k].on || 'field') === th.kind);
    if (!kind) return no("That doesn't grow here");
    if (th.crop) return no('Something is already growing here');
    if (!p.carry[m.seed]) return no('You have no seeds to plant');
    if (!me.admin && Math.hypot(th.x - p.x, th.z - p.z) > 3 + (rule.solid || 0.5)) return no('Too far away');
    const c = this.notYours(p, th.x, th.z, me.admin);
    if (c) return no(this.claimNo(c));
    if (!this.worked(ws, me, p, CROPS[kind].plantSeconds)) { reply({ t: 'slow' }); reply({ t: 'placed', thing: this.placedView(th) }); reply(this.mine(p)); return; } // (the game showed it planted)
    takeCarry(p, m.seed, 1);
    th.crop = { kind, at: Date.now() };
    spend(p, 'plant', G);
    await this.save();
    save();
    this.sendPlaced(th, null);
    reply(this.mine(p));
  } },
  // picking a grown crop, the same as its "like" source (a berry bush): one at a time, or a few with the knife on the bar
  harvest: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const th = this.placedById(m.id), src = th && th.crop && cropSource(th.crop), rule = th && PLACEABLES[th.kind];
    const no = (why) => { reply({ t: 'placeNo', why }); if (th) reply({ t: 'placed', thing: this.placedView(th) }); reply(this.mine(p)); };
    if (!th || !src || !src.harvest) { reply(this.mine(p)); return; }
    if (!me.admin && Math.hypot(th.x - p.x, th.z - p.z) > 3 + ((rule && rule.solid) || 0.5)) return no('Too far away');
    const c = this.notYours(p, th.x, th.z, me.admin);
    if (c) return no(this.claimNo(c));
    const now = Date.now();
    if (!cropGrown(th.crop, now)) return no('Not grown yet');
    const kind = Object.keys(src.harvest)[0], have = cropBerries(th.crop, now);
    if (have < 1) return no('None to pick yet');
    const many = src.tool && src.toolHarvest && onBar(p, src.tool, G) ? Number(src.toolHarvest[kind]) || 1 : 1;
    const n = have >= many ? many : 1;
    if (!addCarry(p, kind, n, G)) return no('Too heavy');
    let b = th.crop.berries || [null, null];
    for (let k = 0; k < n; k++) b = berryPicked(b[0], b[1], src.holds || 5, (src.regrowHours || 0) * HOUR, now); // (rules.js, the same as a wild bush)
    th.crop.berries = b;
    spend(p, 'harvest', G);
    if (n > 1) this.wearTool(p, src.tool, reply);
    await this.save();
    save();
    this.sendPlaced(th, null);
    reply(this.mine(p));
  } },
  fire: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const th = this.placedById(m.id), f = th && fireRule(th.kind);
    if (!th || !f || !th.built || Math.hypot(th.x - p.x, th.z - p.z) > 3) { if (th) this.sendPlaced(th, reply, {}); reply(this.mine(p)); return; }
    this.burn(th);
    const cl = this.notYours(p, th.x, th.z, me.admin); // only the owner tends a fire in their claim
    if (cl) { reply({ t: 'placeNo', why: this.claimNo(cl) }); this.sendPlaced(th, reply, {}); reply(this.mine(p)); return; }
    let note = '';
    if (m.do === 'add') {
      const kind = typeof m.fuel === 'string' && Object.hasOwn(f.fuels, m.fuel) ? m.fuel : f.fuel, each = f.fuels[kind]; // sticks, or another fuel like logs
      const room = fuelRoom(f, th.fuel, kind); // one that only part fits still goes on (rules.js)
      const n = Math.min(Math.max(1, Math.floor(m.n) || 1), room, p.carry[kind] || 0);
      if (n > 0) { takeCarry(p, kind, n); th.fuel = Math.min(f.max, th.fuel + n * each); }
    } else if (m.do === 'light') {
      if (!th.lit && th.fuel > 0 && !this.worked(ws, me, p, ((G.placeables[th.kind] || {}).fire || {}).lightSeconds)) { reply({ t: 'slow' }); this.sendPlaced(th, reply, {}); reply(this.mine(p)); return; } // lighting takes a moment (guard.js)
      if (!th.lit && th.fuel > 0) { th.lit = true; th.burnt = true; th.at = Date.now(); note = this.tryClaim(th, p); } // burnt: taking it apart then gives back only what doesn't burn; a first fire claims the land
    } else if (m.do === 'out') {
      const soc = this.socOfClaim(th.claim); // a society's fire: putting it out ends the society, so only its leader can
      if (soc && soc.leader !== p.who && !me.admin) { reply({ t: 'placeNo', why: `Only ${this.leaderName(soc)} can put it out` }); this.sendPlaced(th, reply, {}); reply(this.mine(p)); return; }
      th.lit = false; this.burn(th); // putting it out ends a claim (and its society: claims.js claimLost)
    }
    th.at = Date.now();
    spend(p, 'tend', G);
    await this.save();
    save();
    this.sendPlaced(th, null);
    if (note) reply({ t: 'claimNote', text: note });
    reply(this.mine(p));
  } },
  // sitting by a fire (no set time: until they stand up, do something else or the fire goes out; it carries on while they're away), or standing up (off)
  sit: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    if (m.off) { this.standUp(p); save(); return; }
    const th = this.placedById(m.id), seats = th && (PLACEABLES[th.kind] || {}).seats, k = Math.floor(m.seat);
    const no = (why) => { reply({ t: 'sitNo', why }); reply(this.mine(p)); };
    if (!th || !th.built || !seats || !(k >= 0 && k < (seats.count || 6))) return no("Can't sit there");
    const cl = this.notYours(p, th.x, th.z, me.admin);
    if (cl) return no(this.claimNo(cl));
    if (this.sitterAt(th.id, k, Date.now(), p.who)) return no('Someone is sitting there');
    const at = seatAt(th, k);
    if (Math.hypot(at[0] - p.x, at[1] - p.z) > 3) return no('Too far away');
    [p.x, p.z] = at;
    p.sleeping = false;
    p.sit = { fire: th.id, seat: k, until: Date.now() + SIT_OPEN };
    save();
    this.send({ t: 'sit', id: me.id, fire: th.id, seat: k }, me.id);
    reply(this.mine(p));
  } },
  // cutting tall grass: it gives twine and grows back at a random time
  cut: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const def = Object.hasOwn(G.plants || {}, String(m.plant)) ? G.plants[m.plant] : null, i = Math.floor(m.i);
    if (!def || !(i >= 0 && i < (def.count || 0))) return;
    w.plants = w.plants || {};
    const ps = (w.plants[m.plant] = w.plants[m.plant] || {}), now = Date.now();
    if (!this.isPlant(m.plant, i)) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0 }); return; } // no such clump (guard.js)
    const plant = this.plantSpot(m.plant, i) || [p.x, p.z]; // where it is (guard.js), else where they're standing, next to it
    const cl = this.notYours(p, plant[0], plant[1], me.admin);
    if (cl) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0, why: this.claimNo(cl) }); return; }
    if (!me.admin && !this.near(p, plant)) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0, why: 'Too far away' }); return; }
    if (ps[i] && ps[i] > now) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] }); return; } // someone got it first
    if (def.toolNeeded && !(def.tool && onBar(p, def.tool, G))) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0, why: `You need a ${String(((G.items || {})[def.tool] || {}).name || 'tool').toLowerCase()}` }); return; } // can't be done by hand (an ore vein, 0.2.0)
    if (!this.worked(ws, me, p, def.tool && onBar(p, def.tool, G) ? def.toolSeconds || def.seconds : def.seconds)) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0, why: 'Slow down a little' }); return; } // cutting takes time (guard.js)
    let ok = true;
    for (const [k, c] of Object.entries(def.gives || {})) ok = addCarry(p, k, c, G) && ok;
    if (!ok) { reply(this.mine(p)); return; }
    const [lo, hi] = Array.isArray(def.regrowHours) ? def.regrowHours : [def.regrowHours || 2, def.regrowHours || 2];
    ps[i] = Math.round(now + (lo + Math.random() * (hi - lo)) * 3600000);
    for (const [k, at] of Object.entries(ps)) if (at <= now) delete ps[k]; // grown back: nothing to remember
    this.send({ t: 'plant', plant: m.plant, i, readyAt: ps[i] }, null);
    spend(p, 'harvest', G);
    if (def.tool && onBar(p, def.tool, G)) this.wearTool(p, def.tool, reply);
    await this.save();
    save();
    reply(this.mine(p));
  } },

  /* ---------- societies (0.1.4, reworked 0.1.5, societies.js): lighting your first fire starts yours (claims.js tryClaim).
     Invite someone, answer an invite, rename it, leave, take someone out. ---------- */
  // the leader invites someone nearby who is playing; the invite waits on their connection for SOC.inviteMinutes
  socInvite: { when: 'alive', async run({ m, p, reply }) {
    const s = this.socOf(p.who), no = (why) => reply({ t: 'socNo', why });
    if (!s) return no('Light a campfire first: that starts your camp');
    if (s.leader !== p.who) return no('Only the leader can invite people');
    if (s.members.length >= socMax()) return no(`${s.name} is full (${socMax()} people)`);
    const them = this.persons.get(m.id), sock = this.socketOf(m.id);
    if (!this.alive(them) || them.who === p.who) return no("They've gone");
    if (!sock || !sock.p.alive) return no(`${them.name} is away, so they can't answer`);
    if (Math.hypot(them.x - p.x, them.z - p.z) > SOC.inviteReach) return no(`Get closer to ${them.name} first`);
    const theirs = this.socOf(them.who);
    if (theirs === s) return no(`${them.name} is already in ${s.name}`);
    if (theirs && theirs.members.length > 1) return no(`${them.name} is in ${theirs.name}`); // (alone in their own: they can put their fire out to join)
    sock.p.invite = { soc: s.id, by: p.who, at: Date.now() };
    this.attach(sock.ws, sock.p);
    this.tell(them.who, { t: 'socInvite', soc: s.name, by: p.name, ms: INVITE_MS });
    reply({ t: 'socNote', text: `Invite sent to ${them.name}` });
  } },
  // the answer to an invite (yes: join). Alone in your own society, your fire holds your claim: put it out first (that
  // ends it). In one with others: leave it first. Either way the invite stays, so they can come back and join.
  socAnswer: { when: 'alive', async run({ ws, me, m, p, reply }) {
    const inv = me.invite, s = inv && this.socById(inv.soc), late = !inv || Date.now() - inv.at > INVITE_MS;
    const drop = () => { me.invite = null; this.attach(ws, me); };
    if (!m.yes) { if (inv) drop(); if (s && !late) this.tell(inv.by, { t: 'socNote', text: `${p.name} said no thanks` }); return; }
    if (!s || late) { if (inv) drop(); reply({ t: 'socNo', why: 'That invite has run out' }); return; }
    const mine = this.socOf(p.who);
    if (mine === s) { drop(); reply({ t: 'socNo', why: `You're already in ${s.name}` }); return; }
    if (s.members.length >= socMax()) { drop(); reply({ t: 'socNo', why: `${s.name} is full` }); return; }
    if (mine && mine.members.length > 1) { reply({ t: 'socNo', why: `Leave ${mine.name} first` }); return; }
    if (mine || this.claimOf(p.who)) { reply({ t: 'socNo', why: 'Put your fire out first: that ends your camp' }); return; }
    drop();
    this.socJoin(s, p);
    await this.saveSocs();
    this.socTellMembers(s);
    reply({ t: 'socNote', text: `You joined ${s.name}` });
  } },
  // the leader renames it (the same rules as any society name)
  socRename: { when: 'alive', async run({ m, p, reply }) {
    const s = this.socOf(p.who);
    if (!s || s.leader !== p.who) { reply({ t: 'socNo', why: 'Only the leader can rename it' }); return; }
    const name = clean(m.name, SOC.nameMax).trim();
    if (name === s.name) { reply(this.mine(p)); return; }
    const no = this.socNameNo(name, s.id);
    if (no) { reply({ t: 'socNo', why: no }); return; }
    const was = s.name;
    s.name = name;
    await this.saveSocs();
    this.note('world', `${was} is now called ${name}`);
    this.socTagAll(s);
    const th = this.socFire(s);
    if (th) this.sendPlaced(th, null); // (the claim's name)
    this.socTellMembers(s);
    this.socNote(s, `Now called ${name}`);
  } },
  // leave your society (the last one out ends it, and its fire goes out)
  socLeave: { when: 'alive', async run({ p, reply }) {
    const s = this.socOf(p.who);
    if (!s) { reply(this.mine(p)); return; }
    const ends = s.members.length === 1;
    await this.socOut(s, p.who, 'left');
    if (!ends) reply({ t: 'socNote', text: `You left ${s.name}` }); // (when it ends, socEnd says so)
  } },
  // the leader takes a member out
  socRemove: { when: 'alive', async run({ m, p, reply }) {
    const s = this.socOf(p.who);
    if (!s || s.leader !== p.who) { reply({ t: 'socNo', why: 'Only the leader can do that' }); return; }
    const mem = s.members.find((x) => x.who === m.id);
    if (!mem || mem.who === p.who) { reply(this.mine(p)); return; }
    await this.socOut(s, mem.who, 'removed'); // (every member left, the leader too, is told, and gets the new list)
  } },
};
