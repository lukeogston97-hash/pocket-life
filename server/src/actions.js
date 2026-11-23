// What players do: one small handler for each kind of message from the game. To add a new action (planting a seed,
// placing a campfire...), add an entry here: when is 'any' (works without a person, like feedback), 'alive' (needs your
// person, with their needs caught up to now) or 'world' (also needs the shared world). run gets the message (m), your
// person (p), the world (w), reply() to answer just you, and save() to save your person straight away; `this` is the
// world (index.js), so this.send() tells everyone. Remember a spam limit in LIMITS (shared.js) for anything new.
import { PLACEABLES, fireRule, seatAt } from './placed.js';
import { fuelRoom } from './rules.js';
import { FILTER, G, starText, badName, freshStats, addCarry, takeCarry, wearList, applyGives, eatOne, craft, spend, clean, num, kindOk, START, REST, BERRY_SRC, cleanLook, REPORTS_KEEP } from './shared.js';
const SIT_OPEN = 365 * 24 * 3600000; // sitting has no set time: `until` is far off, and ends when they stand up, do something else, or the fire goes out

export const ACTIONS = {
  // feedback from the Send feedback screen
  feedback: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    await this.addFeedback(m, me.from);
    if (!m.auto) reply({ t: 'thanks' }); // (auto: a note the game sent by itself about an error)
  } },
  // reporting another player (kept with what they said lately)
  report: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    const them = this.persons.get(m.id), sock = this.socketOf(m.id);
    if (!them) { reply({ t: 'reported', ok: false }); return; }
    const list = (await this.ctx.storage.get('reports')) || [];
    list.push({ at: new Date().toISOString(), by: { name: p ? p.name : '', who: me.who }, about: { name: them.name, who: them.who, v: sock ? sock.p.v : '' },
      reason: clean(m.reason, 30), note: clean(m.note, 500), said: (sock && sock.p.said) || [], x: num(them.x), z: num(them.z) });
    await this.put('reports', list.slice(-REPORTS_KEEP));
    this.tellAdmins({ t: 'adminNew', list: 'reports' });
    reply({ t: 'reported', ok: true });
    return;
  } },
  // the game asks for its person again (after sending what it did while the connection was down)
  sync: { when: 'alive', async run({ p, reply }) { reply(this.mine(p)); } },
  // making a new person
  create: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    if (this.alive(p)) { reply(this.mine(p)); return; }
    const name = clean(m.name, 20).trim();
    if (!name || (!me.admin && badName(name, FILTER))) { reply({ t: 'badName' }); return; }
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
    const np = { who: me.who, state: 'alive', name, look: cleanLook({ ...m.look, name }), age: Math.max(G.age.min, Math.min(G.age.max, Math.round(Number(m.age) || G.age.min))),
      born: Date.now(), x: num(START.x + Math.cos(a) * r), z: num(START.z + Math.sin(a) * r), ry: 0.62,
      stats: freshStats(G), statsAt: Date.now(), carry: {}, lastKind: null, log: { ate: 0, drank: 0, picked: 0 } };
    this.persons.set(me.who, np);
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
    if (!text || !this.alive(p)) return;
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
  // making something from a recipe; one with "near" (cooking) needs a built one of that close by, a fire lit
  craft: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const r = (G.recipes || {})[m.id];
    if (r && (!r.near || this.stationFor(p, r.near)) && craft(p, r, G)) { spend(p, 'craft', G); save(); }
    reply(this.mine(p));
  } },
  // eating one thing from your inventory
  eat: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    if (eatOne(p, G, m.kind)) save();
    reply(this.mine(p));
  } },
  // drinking at the pond
  drink: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const src = G.sources[m.source];
    if (src && src.gives && src.water && (me.admin || this.nearWater(p))) { applyGives(p, src.gives); spend(p, 'drink', G); save(); }
    reply(this.mine(p));
  } },
  // fishing at the pond (0.3.4): the spear wears, the pond holds a shared number of fish, and some tries catch nothing
  fish: { when: 'alive', async run({ me, p, w, reply, save }) {
    const F = (Object.values(G.sources).find((s) => s.water && s.fish) || {}).fish;
    if (!F || !p.carry[F.tool]) { reply(this.mine(p)); return; }
    if (!me.admin && !this.nearWater(p)) { reply({ t: 'fished', why: 'Too far away' }); reply(this.mine(p)); return; }
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
    if (!addCarry(p, w.items[i].kind, 1, G)) { reply({ t: 'took', id: m.id, ok: false, why: 'Too heavy' }); return; }
    const got = w.items[i];
    if (got.uses != null) { const list = wearList(p, got.kind, G); list[list.length - 1] = got.uses; p.wear = p.wear || {}; p.wear[got.kind] = list; } // a worn tool stays worn
    w.items.splice(i, 1);
    spend(p, 'pickup', G);
    reply({ t: 'took', id: m.id, ok: true }); // (said before saving, so the game always hears it before any other news of what they carry)
    if (got.uses != null) reply(this.mine(p)); // a worn tool: the game shows how worn straight away
    this.send({ t: 'gone', id: m.id }, me.id);
    await this.save();
    save();
  } },
  // putting things down
  drop: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const added = [];
    for (const it of (Array.isArray(m.items) ? m.items : []).slice(0, 60)) {
      if (!it || !kindOk(it.kind) || !p.carry[it.kind]) continue;
      const full = (G.items[it.kind] || {}).uses, which = Number.isInteger(it.which) && it.which >= 0 && it.which < p.carry[it.kind] ? it.which : undefined; // which tool (0 is the one in use)
      const uses = full ? wearList(p, it.kind, G)[which ?? p.carry[it.kind] - 1] : null;
      if (!takeCarry(p, it.kind, 1, which)) continue;
      const here = Number.isFinite(it.x) && Number.isFinite(it.z) && (me.admin || this.near(p, [it.x, it.z])); // not near them: it lands by their feet
      const item = { id: w.nextId++, kind: it.kind, x: num(here ? it.x : p.x + (Math.random() - 0.5) * 0.8), z: num(here ? it.z : p.z + (Math.random() - 0.5) * 0.8), rot: num(it.rot) };
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
    if (!rule || (tool && !p.carry[tool])) { reply(this.mine(p)); return; }
    // where it is: a log's own spot, a tree or stump's spot in the layout (guard.js), else what the game says if that's near them
    const laidOut = ['tree', 'stump', 'oldStump'].includes(m.what), log = !laidOut && w.items.find((it) => it.id === m.id && it.kind === m.what);
    if (!laidOut && !log) { reply(this.mine(p)); return; } // the log has gone
    const said = Number.isFinite(m.x) && Number.isFinite(m.z) && this.near(p, [m.x, m.z]) ? [num(m.x), num(m.z)] : [p.x, p.z];
    let at = log ? [log.x, log.z] : this.spotOf(m.what === 'oldStump' ? 'oldStump' : 'tree', Math.floor(m.idx)) || said;
    if (!me.admin && !this.near(p, at)) { reply({ t: 'placeNo', why: 'Too far away' }); reply(this.mine(p)); return; }
    const cl = this.notYours(p, at[0], at[1], me.admin);
    if (cl) { reply({ t: 'placeNo', why: this.claimNo(cl) }); reply(this.mine(p)); return; }
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
      out.push({ id: w.nextId++, kind, x: num(at[0] + Math.cos(a) * r), z: num(at[1] + Math.sin(a) * r), rot: num(Math.random() * Math.PI) });
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
  quarry: { when: 'world', async run({ me, m, p, w, reply, save }) {
    const R = G.mining || {}, rule = R[m.what], tool = R.tool, i = Math.floor(m.idx);
    if (!rule || (m.what !== 'rock' && m.what !== 'boulder') || !(i >= 0 && i < 2000)) return;
    if (tool && !p.carry[tool]) { reply(this.mine(p)); return; }
    const rock = this.spotOf('rock', i) || [p.x, p.z]; // where it is (guard.js), else where they're standing, next to it
    if (!me.admin && !this.near(p, rock, 1)) { reply({ t: 'placeNo', why: 'Too far away' }); reply(this.mine(p)); return; }
    const cl = this.notYours(p, rock[0], rock[1], me.admin);
    if (cl) { reply({ t: 'placeNo', why: this.claimNo(cl) }); reply(this.mine(p)); return; }
    w.rocks = w.rocks || {};
    if (w.rocks[i]) { reply({ t: 'rock', idx: i, state: w.rocks[i][0], at: w.rocks[i][1] }); return; } // someone else got it first
    w.rocks[i] = [m.what === 'rock' ? 'gone' : 'mined', Date.now()];
    this.send({ t: 'rock', idx: i, state: w.rocks[i][0], at: w.rocks[i][1] }, null);
    // the stones fall round where you're standing
    const by = Number.isFinite(m.x) && Number.isFinite(m.z) && this.near(p, [m.x, m.z]), ax = by ? num(m.x) : p.x, az = by ? num(m.z) : p.z, out = [];
    for (const [kind, c] of Object.entries(rule.gives || {})) {
      const count = Array.isArray(c) ? c[0] + Math.floor(Math.random() * (c[1] - c[0] + 1)) : c;
      for (let k = 0; k < count && out.length < 20; k++) {
        const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.5;
        out.push({ id: w.nextId++, kind, x: num(ax + Math.cos(a) * r), z: num(az + Math.sin(a) * r), rot: num(Math.random() * Math.PI) });
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
    const at = this.spotOf('bush', i) || [p.x, p.z], cl = this.notYours(p, at[0], at[1], me.admin);
    if (cl) { reply({ t: 'picked', bush: i, ok: false, why: this.claimNo(cl) }); return; }
    if (!me.admin && !this.near(p, at)) { reply({ t: 'picked', bush: i, ok: false, why: 'Too far away' }); return; }
    // with the bush's tool (a knife) a few come off at once (toolHarvest), and the tool wears
    const many = BERRY_SRC.tool && BERRY_SRC.toolHarvest && p.carry[BERRY_SRC.tool] ? Number(BERRY_SRC.toolHarvest[G.berryKind]) || 1 : 1;
    const n = this.berriesOn(i) >= many ? many : 1;
    if (this.berriesOn(i) < 1 || !addCarry(p, G.berryKind, n, G)) { reply({ t: 'picked', bush: i, ok: false }); return; }
    this.takeBerries(i, n);
    spend(p, 'harvest', G);
    if (n > 1) { this.wearTool(p, BERRY_SRC.tool, reply); reply(this.mine(p)); }
    save();
  } },
  // putting a placeable down (a campfire): it starts as an unbuilt site
  place: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const item = G.items[m.kind], kind = item && item.places, rule = PLACEABLES[kind];
    const x = num(m.x), z = num(m.z);
    const no = (why) => { reply({ t: 'placeNo', why }); reply(this.mine(p)); };
    if (!rule || !p.carry[m.kind]) return no('You need to carry it');
    if (Math.hypot(x - p.x, z - p.z) > 4) return no('Too far away');
    const cl = this.notYours(p, x, z, me.admin);
    if (cl) return no(this.claimNo(cl));
    if (this.placedList().some((th) => Math.hypot(th.x - x, th.z - z) < (rule.solid || 0.5) + 1)) return no('Too close to something else');
    takeCarry(p, m.kind, 1);
    const th = { id: w.nextId++, kind, x, z, rot: num(m.rot), built: false, fuel: 0, lit: false, at: Date.now(), by: p.who }; // by: who built it (only they can pack it up or take it apart)
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
        out.push({ id: w.nextId++, kind, x: num(th.x + Math.cos(a) * rad), z: num(th.z + Math.sin(a) * rad), rot: num(Math.random() * Math.PI) });
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
  fire: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const th = this.placedById(m.id), f = th && fireRule(th.kind);
    if (!th || !f || !th.built || Math.hypot(th.x - p.x, th.z - p.z) > 3) { if (th) this.sendPlaced(th, reply, {}); reply(this.mine(p)); return; }
    this.burn(th);
    const cl = this.notYours(p, th.x, th.z, me.admin); // only the owner tends a fire in their claim
    if (cl) { reply({ t: 'placeNo', why: this.claimNo(cl) }); this.sendPlaced(th, reply, {}); reply(this.mine(p)); return; }
    let note = '';
    if (m.do === 'add') {
      const kind = m.fuel && f.fuels[m.fuel] ? m.fuel : f.fuel, each = f.fuels[kind]; // sticks, or another fuel like logs
      const room = fuelRoom(f, th.fuel, kind); // one that only part fits still goes on (rules.js)
      const n = Math.min(Math.max(1, Math.floor(m.n) || 1), room, p.carry[kind] || 0);
      if (n > 0) { takeCarry(p, kind, n); th.fuel = Math.min(f.max, th.fuel + n * each); }
    } else if (m.do === 'light') {
      if (!th.lit && th.fuel > 0) { th.lit = true; th.burnt = true; th.at = Date.now(); note = this.tryClaim(th, p); } // burnt: taking it apart then gives back only what doesn't burn; a first fire claims the land
    } else if (m.do === 'out') { th.lit = false; this.burn(th); } // putting it out ends a claim
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
    const def = (G.plants || {})[m.plant], i = Math.floor(m.i);
    if (!def || !(i >= 0 && i < (def.count || 0))) return;
    w.plants = w.plants || {};
    const ps = (w.plants[m.plant] = w.plants[m.plant] || {}), now = Date.now();
    const plant = this.plantSpot(m.plant, i) || [p.x, p.z]; // where it is (guard.js), else where they're standing, next to it
    const cl = this.notYours(p, plant[0], plant[1], me.admin);
    if (cl) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0, why: this.claimNo(cl) }); return; }
    if (!me.admin && !this.near(p, plant)) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] || 0, why: 'Too far away' }); return; }
    if (ps[i] && ps[i] > now) { reply({ t: 'cutNo', plant: m.plant, i, readyAt: ps[i] }); return; } // someone got it first
    let ok = true;
    for (const [k, c] of Object.entries(def.gives || {})) ok = addCarry(p, k, c, G) && ok;
    if (!ok) { reply(this.mine(p)); return; }
    const [lo, hi] = Array.isArray(def.regrowHours) ? def.regrowHours : [def.regrowHours || 2, def.regrowHours || 2];
    ps[i] = Math.round(now + (lo + Math.random() * (hi - lo)) * 3600000);
    for (const [k, at] of Object.entries(ps)) if (at <= now) delete ps[k]; // grown back: nothing to remember
    this.send({ t: 'plant', plant: m.plant, i, readyAt: ps[i] }, null);
    spend(p, 'harvest', G);
    if (def.tool && p.carry[def.tool]) this.wearTool(p, def.tool, reply);
    await this.save();
    save();
    reply(this.mine(p));
  } },
};
