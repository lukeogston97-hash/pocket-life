// What players do: one small handler for each kind of message from the game. To add a new action (planting a seed,
// placing a campfire...), add an entry here: when is 'any' (works without a person, like feedback), 'alive' (needs your
// person, with their needs caught up to now) or 'world' (also needs the shared world). run gets the message (m), your
// person (p), the world (w), reply() to answer just you, and save() to save your person straight away; `this` is the
// world (index.js), so this.send() tells everyone. Remember a spam limit in LIMITS (shared.js) for anything new.
import { FILTER, G, starText, badName, freshStats, addCarry, takeCarry, applyGives, eatOne, craft, spend, clean, num, kindOk, START, REST, BERRY_SRC, cleanLook, REPORTS_KEEP } from './shared.js';

export const ACTIONS = {
  // feedback from the Send feedback screen
  feedback: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    await this.addFeedback(m); reply({ t: 'thanks' });
  } },
  // typing /admin and the code in the Say box
  adminLogin: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    me.tries = (me.tries || 0) + 1;
    if (me.tries > 5 || !this.codeOk(m.code)) { ws.serializeAttachment(me); reply({ t: 'adminNo' }); return; }
    me.admin = true;
    ws.serializeAttachment(me);
    reply(this.adminState(me));
    if (me.alive) this.send({ t: 'badge', id: me.id, on: !!me.tag }, me.id);
    return;
  } },
  // reporting another player (kept with what they said lately)
  report: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    const them = this.persons.get(m.id), sock = this.socketOf(m.id);
    if (!them) { reply({ t: 'reported', ok: false }); return; }
    const list = (await this.ctx.storage.get('reports')) || [];
    list.push({ at: new Date().toISOString(), by: { name: p ? p.name : '', who: me.who }, about: { name: them.name, who: them.who, v: sock ? sock.p.v : '' },
      reason: clean(m.reason, 30), note: clean(m.note, 500), said: (sock && sock.p.said) || [], x: num(them.x), z: num(them.z) });
    await this.put('reports', list.slice(-REPORTS_KEEP));
    reply({ t: 'reported', ok: true });
    return;
  } },
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
    ws.serializeAttachment(me);
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
    ws.serializeAttachment(me);
    if (this.admin.muted.includes(me.who)) reply({ t: 'say', id: me.id, text }); // muted by the admin: only they see it
    else this.send({ t: 'say', id: me.id, text }, null);
    return;
  } },
  // laying out a brand new world
  seed: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    if (!w) await this.seed(m); // the first player into a brand new world lays it out
  } },
  // the layout's open spots, shore and bushes (for people strolling while away)
  layout: { when: 'any', async run({ ws, me, m, p, w, reply, save }) {
    if (w && !w.layout) { w.layout = this.cleanLayout(m); await this.save(); } // where away people can stroll (sent once)
  } },
  // bending, picking, kneeling to drink, chopping: shown to everyone else
  act: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const pose = ['bend', 'kneel', 'pick', 'chop'].includes(m.pose) ? m.pose : 'bend';
    this.send({ t: 'act', id: me.id, pose, seconds: Math.max(0.3, Math.min(25, Number(m.seconds) || 0.5)) }, me.id);
  } },
  // walking: once with where the walk ends, and now and then on the way
  move: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    const nx = num(m.x), nz = num(m.z), moved = Math.hypot(nx - p.x, nz - p.z);
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
    if (!p.sleeping) p.collapsed = false;
    save();
    reply(this.mine(p));
    this.send({ t: 'state', id: me.id, state: p.sleeping ? 'sleeping' : 'online', x: num(p.x), z: num(p.z) }, me.id);
  } },
  // making something from a recipe
  craft: { when: 'alive', async run({ ws, me, m, p, w, reply, save }) {
    if (craft(p, (G.recipes || {})[m.id], G)) { spend(p, 'craft', G); save(); }
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
    if (src && src.gives && src.water) { applyGives(p, src.gives); spend(p, 'drink', G); save(); }
    reply(this.mine(p));
  } },
  // picking something up off the ground
  take: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const i = w.items.findIndex((it) => it.id === m.id);
    if (i < 0 || !addCarry(p, w.items[i].kind, 1, G)) { reply({ t: 'took', id: m.id, ok: false }); return; }
    w.items.splice(i, 1);
    spend(p, 'pickup', G);
    await this.save();
    save();
    reply({ t: 'took', id: m.id, ok: true });
    this.send({ t: 'gone', id: m.id }, me.id);
  } },
  // putting things down
  drop: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const added = [];
    for (const it of (Array.isArray(m.items) ? m.items : []).slice(0, 60)) {
      if (!it || !kindOk(it.kind) || !takeCarry(p, it.kind, 1)) continue;
      const item = { id: w.nextId++, kind: it.kind, x: num(it.x), z: num(it.z), rot: num(it.rot) };
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
    w.trees = w.trees || {};
    let at = [num(m.x), num(m.z)];
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
      this.send({ t: 'tree', idx: i, state: w.trees[i][0] }, null);
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
  // picking berries (2 at a time with a knife)
  pick: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const i = Math.floor(m.bush);
    if (!(i >= 0 && i < 200)) return;
    // with the bush's tool (a knife) a few come off at once (toolHarvest), and the tool wears
    const many = BERRY_SRC.tool && BERRY_SRC.toolHarvest && p.carry[BERRY_SRC.tool] ? Number(BERRY_SRC.toolHarvest[G.berryKind]) || 1 : 1;
    const n = this.berriesOn(i) >= many ? many : 1;
    if (this.berriesOn(i) < 1 || !addCarry(p, G.berryKind, n, G)) { reply({ t: 'picked', bush: i, ok: false }); return; }
    for (let k = 0; k < n; k++) this.takeBerry(i);
    spend(p, 'harvest', G);
    if (n > 1) { this.wearTool(p, BERRY_SRC.tool, reply); reply(this.mine(p)); }
    save();
  } },
  // cutting tall grass: it gives twine and grows back at a random time
  cut: { when: 'world', async run({ ws, me, m, p, w, reply, save }) {
    const def = (G.plants || {})[m.plant], i = Math.floor(m.i);
    if (!def || !(i >= 0 && i < (def.count || 0))) return;
    w.plants = w.plants || {};
    const ps = (w.plants[m.plant] = w.plants[m.plant] || {}), now = Date.now();
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
