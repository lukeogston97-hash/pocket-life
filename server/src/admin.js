// The admin player (Luke): every 'a.' message, from maintenance to Reset the world.
// The Admin panel's tabs: Server (maintenance, announce, speed), Players (find someone, their page: stats, bag,
// give and take, past people), Inbox (feedback and reports, marked Done and cleared after 30 days), World (counts,
// regrow everything, clear loose items, restore an earlier time (restore.js), reset the world or everything), Settings (live settings, live.js). Single things in the world
// (trees, rocks, berry bushes, campfires, loose items) are moved, regrown and removed from their tap menus.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { FILTER, G, starText, MINUTE, HOUR, clean, blank, num, kindOk, addCarry, takeCarry, ageOf, pickRandom, laidNow } from './shared.js';
import { fireRule } from './placed.js';
import { CLAIM_KIND } from './claims.js';
import { SOC, freshSocieties } from './societies.js';

const DONE_KEEP_DAYS = 30; // feedback and reports marked Done are deleted after this
const PAST_KEEP = 20; // earlier people each player had
const PLAYERS_SHOWN = 50; // the Players tab shows this many at a time (search to find others)
const CLEAR_NEAR = 10; // Clear loose items near you: within this many metres
const idxOk = (i, most) => Number.isInteger(i) && i >= 0 && i < most;
const MOVABLE = { tree: 5000, rock: 2000, bush: 200 }; // things laid out with the world, by their number in the layout
// What the activity log calls each tool that changes something. Every tool's answer goes in the log under its name
// (also when the answer is that it couldn't be done). Tools that only read aren't here, so they aren't logged.
// A new tool that changes something gets a line here.
const TOOLS = { 'a.maintenance': 'Maintenance', 'a.announce': 'Message to everyone', 'a.speed': 'Speed up time', 'a.kick': 'Kick', 'a.ban': 'Ban', 'a.unban': 'Unban',
  'a.mute': 'Mute', 'a.fill': 'Fill needs', 'a.give': 'Give', 'a.take': 'Take', 'a.wake': 'Wake', 'a.sleep': 'Send to sleep', 'a.movePerson': 'Move person',
  'a.setStats': 'Edit person', 'a.removePerson': 'Remove person', 'a.unlinkAll': 'Unlink all devices', 'a.regrowAll': 'Regrow everything', 'a.clear': 'Clear loose items', 'a.move': 'Move', 'a.regrow': 'Regrow',
  'a.remove': 'Remove', 'a.live': 'Setting', 'a.liveItem': 'Item number', 'a.fire': 'Fire', 'a.claim': 'Claim', 'a.rename': 'Rename', 'a.tell': 'Message',
  'a.socRename': 'Rename society', 'a.socRemove': 'Take out of society', 'a.socEnd': 'End society', 'a.clearTasks': 'Clear task list', 'a.found': 'Found recipes' };
// which thing a tool was used on, when its answer doesn't say (server: the World)
function aboutOf(m, server) {
  const short = (v) => clean(String(v == null ? '' : v), 40);
  if (m.t === 'a.liveItem') return Array.isArray(m.at) ? short(m.at.join(' ')) : '';
  if (m.t === 'a.live') return short(m.id);
  if (m.t === 'a.announce') return `"${clean(m.text, 60).trim()}"`;
  if (m.t === 'a.unban') return short(m.id);
  if (m.t.startsWith('a.soc')) { const soc = server.socById(m.id); return soc ? short(soc.name) : ''; } // a society: by its name
  if (['a.fire', 'a.claim', 'a.move', 'a.regrow', 'a.remove'].includes(m.t)) {
    const th = m.id != null ? server.placedById(m.id) : null; // a campfire: by where it is
    if (th) return `${th.kind} at ${Math.round(th.x)}, ${Math.round(th.z)}`;
    return m.what && m.what !== 'placed' ? `${short(m.what)} ${short(m.idx != null ? m.idx : m.id)}` : '';
  }
  return '';
}
const FIRE_PEOPLE = 200; // Give a claim to: this many people are offered
// 5400000 ms -> '1 h 30 m'
const hoursText = (ms) => { const m = Math.round(ms / MINUTE), h = Math.floor(m / 60); return h && m % 60 ? `${h} h ${m % 60} m` : h ? `${h} h` : `${m} m`; };

export const adminMethods = {
  adminState(me) {
    return { t: 'admin', on: true, maintenance: this.admin.maintenance, message: this.admin.message, speed: this.speed, usage: this.usageNow(), live: this.liveView() };
  },
  // a person who died or left, kept short for their player's page (Past people)
  async rememberPast(p) {
    if (!p || !p.who || !p.name) return;
    const key = `past:${p.who}`, list = (await this.ctx.storage.get(key)) || [];
    list.unshift({ name: p.name, age: ageOf(p, p.diedAt || Date.now()), born: p.born || 0, until: p.diedAt || Date.now(), cause: p.state === 'gone' ? 'left' : p.cause || '' });
    await this.put(key, list.slice(0, PAST_KEEP));
  },
  // how a person shows in the Players tab: online, away or asleep (sleeping by choice counts as online or away)
  playerRow(p) {
    const st = this.stateOf(p), state = st === 'sleeping' ? (this.isOnline(p.who) ? 'online' : 'away') : st;
    return { id: p.who, name: p.name, state, age: ageOf(p), muted: this.admin.muted.includes(p.who), banned: this.admin.banned.includes(p.who) };
  },
  async playerPage(who) {
    const p = this.persons.get(who), s = this.socketOf(who);
    if (this.alive(p)) this.catchUp(p);
    const past = [...((await this.ctx.storage.get(`past:${who}`)) || [])];
    if (p && !this.alive(p)) past.unshift({ name: p.name, age: ageOf(p, p.diedAt || Date.now()), born: p.born || 0, until: p.diedAt || 0, cause: p.state === 'gone' ? 'left' : p.cause || '' });
    const reports = ((await this.ctx.storage.get('reports')) || []).filter((r) => r.about && r.about.who === who).length;
    const acc = this.accountOf(who);
    const out = { t: 'adminPlayer', id: who, linked: acc ? acc.phones : 0, muted: this.admin.muted.includes(who), banned: this.admin.banned.includes(who), reports, past, v: s ? s.p.v : '', link: s ? s.p.link : '' };
    if (this.alive(p)) Object.assign(out, this.playerRow(p), { born: p.born || 0, stats: p.stats, carry: p.carry || {}, x: num(p.x), z: num(p.z), tasks: p.tasks || [], // tasks: their task list as the server has it (tasks.js)
      found: (p.found || []).filter((id) => Object.hasOwn(G.recipes || {}, id)) }); // found: the recipes they've made at least once (the craft mat's Found list)
    else Object.assign(out, { name: past[0] ? past[0].name : `Phone ${who}`, state: 'gone' });
    const soc = this.socOf(who);
    if (soc) out.soc = { id: soc.id, name: soc.name, lead: soc.leader === who, n: soc.members.length }; // their society (societies.js)
    return out;
  },
  // feedback and reports, newest first; ones marked Done over 30 days ago are deleted
  async inbox() {
    const out = {}, old = Date.now() - DONE_KEEP_DAYS * 24 * HOUR;
    for (const key of ['feedback', 'reports']) {
      const list = (await this.ctx.storage.get(key)) || [];
      const keep = list.filter((x) => !x.done || !x.doneAt || x.doneAt > old);
      if (keep.length !== list.length) await this.put(key, keep);
      out[key] = keep.slice(-100).reverse();
    }
    return out;
  },
  // every fire, for the World tab: where it is, whether it burns, how long its fuel lasts (ms) and whose land it holds.
  // people: everyone a claim could be given to.
  firesView(now = Date.now()) {
    const list = this.placedList().filter((th) => fireRule(th.kind)).map((th) => {
      this.burn(th, now);
      const by = th.by ? this.persons.get(th.by) : null;
      return { id: th.id, kind: th.kind, x: num(th.x), z: num(th.z), built: !!th.built, lit: !!th.lit, fuel: Math.round(th.fuel || 0), max: fireRule(th.kind).max,
        canClaim: th.kind === CLAIM_KIND, claim: th.claim ? { who: th.claim, name: this.ownerName(th) } : null, by: by ? by.name : '' };
    });
    const people = [...this.persons.values()].filter((p) => this.alive(p)).map((p) => ({ id: p.who, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, FIRE_PEOPLE);
    return { t: 'adminFires', list, people };
  },
  // sticks and stones back up to their normal amount, round the spots they turn up at
  topUp() {
    const w = this.world;
    for (const [kind, [cap, spots]] of Object.entries(this.respawnPlan())) {
      let have = w.items.filter((it) => it.kind === kind).length;
      for (; have < cap; have++) {
        const [x, z] = pickRandom(spots);
        w.items.push({ id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) });
      }
    }
  },
  // Each admin message starts with 'a.' and only works for the admin.
  async adminDo(ws, me, m) {
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    // what a tool answers: the fresh admin numbers with a few words in `text`. (It goes out as t: 'admin', not 'adminDone':
    // adminState's own t wins the spread, and the game has always read it that way. Checks should listen for 'admin'.)
    const about = TOOLS[m.t] ? aboutOf(m, this) : ''; // (worked out first: the thing may be gone by the time the tool answers)
    const done = (text) => {
      if (TOOLS[m.t] && text) this.note('admin', `${TOOLS[m.t]}${about ? ` (${about})` : ''}: ${text}`); // the activity log (activity.js)
      reply({ t: 'adminDone', text, ...this.adminState(me) });
    };
    const w = this.world;
    const them = m.id ? this.persons.get(m.id) : null;
    const sock = m.id ? this.socketOf(m.id) : null;
    const everyoneSees = async () => { await this.save(); this.send({ t: 'world', world: this.view() }, null); }; // big changes: the whole world again
    switch (m.t) {
      case 'a.state': return reply(this.adminState(me)); // the Admin panel was opened: fresh numbers
      case 'a.maintenance': { // on: release-link players see Back soon, and everyone not playing is paused (persons.js paused, thaw)
        const on = !!m.on, was = !!this.admin.maintenance, now = Date.now();
        if (on && !was) { // everyone and every fire brought up to now, then the pause starts
          for (const p of this.persons.values()) if (this.alive(p)) { this.catchUp(p); this.touch(p); }
          for (const th of this.placedList()) this.burn(th, now);
          await this.flush(null, true);
          if (w) await this.save();
          this.admin.maintAt = now;
        }
        if (!on && was) { // the pause ends: clocks carry on from where they stopped
          for (const p of this.persons.values()) if (this.alive(p) && !this.isOnline(p.who)) this.thaw(p, now);
          for (const th of this.placedList()) this.burn(th, now);
        }
        this.admin.maintenance = on;
        this.admin.message = clean(m.text, 200).trim();
        await this.saveAdmin();
        if (!on && was) {
          await this.flush(null, true);
          if (w) { await this.save(); for (const th of this.placedList()) if (th.lit) this.sendPlaced(th, null); }
        }
        if (on) for (const { ws: s, p } of this.sockets()) if (!this.isAdmin(p) && p.link !== 'test') this.boot(s, { t: 'maintenance', text: this.admin.message });
        return done(on ? 'Maintenance on' : 'Maintenance off');
      }
      case 'a.announce': {
        const text = starText(clean(m.text, 140).trim(), FILTER);
        if (text) this.send({ t: 'announce', text }, null);
        return done('Message sent');
      }
      case 'a.speed': { // needs run x times faster for a few minutes, to test people looking after themselves
        const x = Math.max(1, Math.min(600, Number(m.x) || 1));
        for (const p of this.persons.values()) this.catchUp(p);
        this.speed = x > 1 ? { x, until: Date.now() + Math.max(1, Math.min(60, Number(m.minutes) || 10)) * MINUTE } : null;
        if (this.speed) await this.put('speed', this.speed); else await this.ctx.storage.delete('speed');
        this.send({ t: 'speed', speed: this.speed }, null);
        return done(this.speed ? `Time ${x}x faster for ${Math.round((this.speed.until - Date.now()) / MINUTE)} minutes` : 'Time back to normal');
      }

      /* ---------- Inbox: feedback and reports ---------- */
      case 'a.list': return reply({ t: 'adminList', ...(await this.inbox()) });
      case 'a.done': case 'a.delete': { // mark one Done (or not), or delete it
        const key = m.list === 'reports' ? 'reports' : 'feedback';
        const list = (await this.ctx.storage.get(key)) || [];
        if (m.t === 'a.delete') await this.put(key, list.filter((x) => x.at !== m.at));
        else {
          const x = list.find((y) => y.at === m.at);
          if (x) { if (m.on === false) { delete x.done; delete x.doneAt; } else { x.done = true; x.doneAt = Date.now(); } await this.put(key, list); }
        }
        return reply({ t: 'adminList', ...(await this.inbox()) });
      }

      /* ---------- Players: the list, someone's page, and what can be done to them ---------- */
      case 'a.players': {
        const q = clean(m.q, 30).trim().toLowerCase(), show = ['online', 'away', 'asleep', 'muted', 'banned'].includes(m.show) ? m.show : 'all';
        const rows = [...this.persons.values()].filter((p) => this.alive(p)).map((p) => this.playerRow(p));
        for (const who of this.admin.banned) { // banned phones whose person has gone
          if (rows.some((r) => r.id === who)) continue;
          const past = (await this.ctx.storage.get(`past:${who}`)) || [];
          rows.push({ id: who, name: past[0] ? past[0].name : `Phone ${who}`, state: 'gone', muted: this.admin.muted.includes(who), banned: true });
        }
        const counts = { all: rows.filter((r) => r.state !== 'gone').length };
        for (const k of ['online', 'away', 'asleep']) counts[k] = rows.filter((r) => r.state === k).length;
        counts.muted = rows.filter((r) => r.muted).length;
        counts.banned = rows.filter((r) => r.banned).length;
        const order = { online: 0, away: 1, asleep: 2, gone: 3 };
        const found = rows.filter((r) => (show === 'all' ? r.state !== 'gone' : ['muted', 'banned'].includes(show) ? r[show] : r.state === show) && (!q || String(r.name).toLowerCase().includes(q)))
          .sort((a, b) => order[a.state] - order[b.state] || String(a.name).localeCompare(String(b.name)));
        return reply({ t: 'adminPlayers', rows: found.slice(0, PLAYERS_SHOWN), total: found.length, counts, q, show });
      }
      case 'a.player': return reply(await this.playerPage(clean(m.id, 40)));
      case 'a.kick': case 'a.ban': {
        if (!them && !sock && m.t === 'a.kick') return done("They've left");
        if (m.t === 'a.ban' && !this.admin.banned.includes(m.id)) { this.admin.banned.push(clean(m.id, 40)); await this.saveAdmin(); }
        if (sock) this.boot(sock.ws, { t: m.t === 'a.ban' ? 'banned' : 'kicked' });
        return done(`${them ? them.name : 'They'} ${m.t === 'a.ban' ? 'banned' : 'kicked'}`);
      }
      case 'a.unban':
        this.admin.banned = this.admin.banned.filter((x) => x !== (m.who || m.id)); await this.saveAdmin();
        return done('Unbanned');
      case 'a.mute': {
        const who = m.who || m.id;
        if (!who) return done("They've left");
        this.admin.muted = this.admin.muted.filter((x) => x !== who);
        if (m.on) this.admin.muted.push(who);
        await this.saveAdmin();
        return done(m.on ? 'Muted for everyone' : 'Unmuted for everyone');
      }
      case 'a.found': { // someone's found recipes (the craft mat's Found list, 0.1.8): all of them, or none
        if (!this.alive(them)) return done("They've gone");
        them.found = m.all ? Object.keys(G.recipes || {}) : [];
        this.touch(them); await this.flush(them.who);
        this.tell(them.who, this.mine(them));
        reply(await this.playerPage(them.who));
        return done(m.all ? `${them.name} has found every recipe` : `${them.name}'s found recipes are cleared`);
      }
      case 'a.clearTasks': // empty someone's task list (tasks.js); their game stops too, if they're playing
        if (!this.alive(them)) return done("They've gone");
        them.tasks = []; them.took = [];
        if (them.plan && them.plan.then === 'task') them.plan = null; // part way through one while away: they stop there
        this.touch(them); await this.flush(them.who);
        this.tell(them.who, { t: 'stopTasks' });
        reply(await this.playerPage(them.who));
        return done(`${them.name}'s task list is empty`);
      case 'a.fill': // top up someone's needs
        if (!this.alive(them)) return done("They've gone");
        this.catchUp(them);
        for (const s of G.needs) them.stats[s.id] = 100;
        them.statsAt = Date.now();
        this.touch(them); await this.flush(them.who);
        this.tell(them.who, this.mine(them));
        return done(`${them.name} fed and watered`);
      case 'a.give': case 'a.take': { // put things in someone's bag, or take them out
        if (!this.alive(them)) return done("They've gone");
        if (!kindOk(m.kind) || !G.items[m.kind]) return done('No such thing');
        const n = Math.max(1, Math.min(50, Math.floor(Number(m.n) || 1)));
        this.catchUp(them);
        let text;
        if (m.t === 'a.give') {
          if (!addCarry(them, m.kind, n, G)) return done('Too heavy for them to carry');
          text = `Gave ${them.name} ${n}`;
        } else text = takeCarry(them, m.kind, n) ? `Took from ${them.name}` : 'They had none';
        this.touch(them); await this.flush(them.who);
        this.tell(them.who, this.mine(them));
        reply(await this.playerPage(them.who));
        return done(text);
      }
      case 'a.wake': // a sleeper gets up and starts another day away
        if (!this.alive(them) || !them.asleep) return done("They're not asleep");
        Object.assign(them, { asleep: false, leftAt: Date.now(), simAt: Date.now(), statsAt: Date.now(), plan: null, home: [them.x, them.z] });
        this.touch(them); await this.flush(them.who);
        this.send({ t: 'state', id: them.who, state: 'away', x: num(them.x), z: num(them.z) }, null);
        return done(`${them.name} woke up`);
      case 'a.sleep': // send someone away to sleep now (for testing)
        if (!this.alive(them) || sock) return done('Only for people who are away');
        Object.assign(them, { asleep: true, sleepAt: Date.now(), plan: null });
        this.touch(them); await this.flush(them.who);
        this.send({ t: 'state', id: them.who, state: 'asleep', x: num(them.x), z: num(them.z) }, null);
        return done(`${them.name} is asleep`);
      case 'a.movePerson': { // put someone somewhere else (admin mode has no person of its own to teleport)
        if (!this.alive(them)) return done("They've gone");
        const edge = (G.worldSize || 100) / 2 - 2, x = num(m.x), z = num(m.z), pond = G.pond || { x: 0, z: 0, r: 5 };
        if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || Math.abs(x) > edge || Math.abs(z) > edge) return done("That's outside the world");
        if (Math.hypot(x - pond.x, z - pond.z) < (pond.r || 5)) return done("Can't put them in the pond");
        this.catchUp(them); // needs and any stroll up to now, at the old spot
        if (!this.alive(them)) return done("They've gone");
        this.standUp(them); // a seat belongs to a fire
        // Someone away isn't pinned there: what they were doing is dropped and they decide again from the new spot on the next
        // tick (away.js decide). At night, or if tired, they lie down and sleep where they were put; otherwise they go for
        // water or berries if they need them, or stroll back toward their claim's fire or the pond. Their away clock isn't
        // restarted. home only matters if away.near is ever not 'pond'.
        Object.assign(them, { x, z, plan: null, home: [x, z] });
        if (them.leftAt) them.simAt = Date.now();
        this.touch(them); await this.flush(them.who);
        if (sock) { try { sock.ws.send(JSON.stringify({ t: 'pos', x, z })); } catch (err) { /* gone */ } } // their own game goes there
        this.send({ t: 'state', id: them.who, state: this.stateOf(them), x, z }, them.who);
        return done(sock ? `${them.name} moved` : `${them.name} moved. They're away, so they'll carry on by themselves from there`);
      }
      case 'a.setStats': { // type someone's needs and age directly
        if (!this.alive(them)) return done("They've gone");
        this.catchUp(them);
        if (!this.alive(them)) return done("They've gone");
        for (const s of G.needs) {
          const v = (m.stats || {})[s.id];
          if (!Number.isFinite(v)) continue;
          them.stats[s.id] = Math.max(s.deadAtZero ? 1 : 0, Math.min(100, Math.round(v * 10) / 10)); // (never to death: Remove from world is its own button)
        }
        them.statsAt = Date.now();
        if (Number.isFinite(m.age)) { // age is the age they started at plus birthdays since (ageOf), so the starting age moves
          const want = Math.max(G.age.min, Math.min(120, Math.round(m.age)));
          them.age = want - (ageOf(them) - them.age);
        }
        this.collapse(them); // Rest typed down to nothing: they drop asleep, as they would
        this.touch(them); await this.flush(them.who);
        this.tell(them.who, this.mine(them));
        reply(await this.playerPage(them.who));
        return done(`${them.name} changed`);
      }
      case 'a.unlinkAll': { // Play on other devices: every device linked to them is a guest again (the person stays with the device it started on)
        const acc = this.accountOf(m.id);
        if (!acc) return done("They're not linked to other devices");
        this.dropAccount(acc.acct); await this.saveAccounts();
        for (const s of this.sockets()) if (s.p.who === m.id && !s.p.admin) this.boot(s.ws, { t: 'kicked' });
        reply(await this.playerPage(m.id));
        return done('Unlinked all devices');
      }
      case 'a.removePerson': // take someone out of the world; their things drop where they are
        if (!this.alive(them)) return done("They've gone");
        if (sock) return done("They're playing right now");
        them.state = 'gone'; them.diedAt = Date.now();
        this.spill(them);
        this.touch(them); await this.flush(them.who);
        this.send({ t: 'leave', id: them.who }, null);
        return done(`${them.name} removed`);

      /* ---------- World: the whole world at once ---------- */
      case 'a.regrowAll': { // stumps back to trees, mined boulders and broken rocks back, bushes full, grass grown, sticks and stones topped up
        if (!w) return;
        const removed = w.removed || {};
        for (const [i, st] of Object.entries(w.trees || {})) if (st[0] === 'stump') delete w.trees[i];
        for (const [i, st] of Object.entries(w.rocks || {})) if (st[0] === 'mined' || (st[0] === 'gone' && !removed[`rock:${i}`])) delete w.rocks[i];
        w.nextRockBack = 0;
        w.bushes = [];
        w.plants = {};
        delete w.pond; // the pond is full of fish again
        this.topUp();
        await everyoneSees();
        return done('Everything grown back');
      }
      case 'a.clear': { // loose items off the ground: near you, or everywhere
        if (!w) return;
        const x = num(m.x), z = num(m.z), before = w.items.length;
        w.items = m.near ? w.items.filter((it) => Math.hypot(it.x - x, it.z - z) > CLEAR_NEAR) : [];
        const n = before - w.items.length;
        if (n) await everyoneSees();
        return done(n ? `Cleared ${n} ${n === 1 ? 'thing' : 'things'}` : 'Nothing to clear');
      }
      case 'a.reset': // the land starts again. With all: so does everyone (every person, their past people, the Inbox, bans and mutes go too)
        if (m.all) {
          this.persons.clear(); this.dirty.clear(); this.savedAt.clear();
          this.admin.banned = []; this.admin.muted = []; await this.saveAdmin(); // (maintenance and its message stay)
          this.societies = freshSocieties(); // (societies.js)
          this.accounts = { links: {}, accts: {} }; // (accounts.js: linked devices go too)
          const gone = ['feedback', 'reports', 'societies', 'accounts'];
          for (const prefix of ['p:', 'past:']) gone.push(...(await this.ctx.storage.list({ prefix })).keys());
          this.use('writes', gone.length);
          for (let i = 0; i < gone.length; i += 100) await this.ctx.storage.delete(gone.slice(i, i + 100));
          this.activity = []; // the log starts again too (it would only name people who are gone)
        }
        this.world = null;
        await this.ctx.storage.delete('world');
        this.note('admin', m.all ? 'Reset everything: the land and every person start again' : 'Reset the world: the land starts again');
        for (const { ws: s, p: them } of this.sockets()) { // everyone rejoins and the first one lays it out fresh
          if (m.all) { them.alive = false; this.attach(s, them); } // nobody has a person any more
          this.boot(s, { t: 'reset', all: !!m.all });
        }
        return;

      /* ---------- single things: add, move, regrow, remove ---------- */
      case 'a.add': { // n of an item, round where you tapped
        if (!w || !kindOk(m.kind) || !G.items[m.kind]) return;
        const n = Math.max(1, Math.min(50, Math.floor(Number(m.n) || 1))), out = [];
        for (let k = 0; k < n; k++) {
          const a = k * 2.39996, r = k ? 0.3 + Math.sqrt(k) * 0.25 : 0;
          out.push({ id: w.nextId++, kind: m.kind, x: num(num(m.x) + Math.cos(a) * r), z: num(num(m.z) + Math.sin(a) * r), rot: num(Math.random() * Math.PI), laid: laidNow() });
        }
        w.items.push(...out);
        await this.save();
        this.send({ t: 'added', items: out }, null);
        this.note('admin', `Add item: ${n} ${m.kind} at ${Math.round(num(m.x))}, ${Math.round(num(m.z))}`);
        return;
      }
      case 'a.move': {
        if (!w) return;
        const x = num(m.x), z = num(m.z);
        if (m.what === 'placed') { // a campfire: it goes and comes back at the new spot
          const th = this.placedById(m.id);
          if (!th) return done("It's gone");
          const now = Date.now();
          if ([...this.persons.values()].some((o) => this.alive(o) && o.sit && o.sit.fire === th.id && o.sit.until > now)) return done('Someone is sitting by it');
          Object.assign(th, { x, z });
          await this.save();
          this.send({ t: 'unplaced', id: th.id }, null);
          this.sendPlaced(th);
          return done('Moved');
        }
        const most = MOVABLE[m.what], i = Math.floor(m.idx);
        if (!most || !idxOk(i, most)) return;
        w.moved = w.moved || {};
        w.moved[`${m.what}:${i}`] = [x, z];
        if (m.what === 'bush' && w.layout && Array.isArray(w.layout.bushes) && w.layout.bushes[i]) w.layout.bushes[i] = [x, z]; // people away find it there
        await this.save();
        this.send({ t: 'moved', what: m.what, idx: i, x, z }, null);
        return done('Moved');
      }
      case 'a.regrow': { // one thing back to how it started: a stump to a tree, a boulder or rock back, a bush full, a campfire full of fuel
        if (!w) return;
        if (m.what === 'placed') {
          const th = this.placedById(m.id), rule = th && fireRule(th.kind);
          if (!rule) return done('Nothing to refill');
          this.burn(th);
          th.fuel = rule.max; th.at = Date.now();
          await this.save();
          this.sendPlaced(th);
          return done('Full of fuel');
        }
        const i = Math.floor(m.idx);
        if (m.what === 'tree' && idxOk(i, MOVABLE.tree) && (w.trees || {})[i] && w.trees[i][0] === 'stump') {
          delete w.trees[i];
          this.send({ t: 'tree', idx: i, state: 'tree' }, null);
        } else if (m.what === 'rock' && idxOk(i, MOVABLE.rock) && (w.rocks || {})[i] && !(w.removed || {})[`rock:${i}`]) {
          delete w.rocks[i];
          this.send({ t: 'rock', idx: i, state: 'whole' }, null);
        } else if (m.what === 'bush' && idxOk(i, MOVABLE.bush)) {
          w.bushes[i] = [null, null];
          this.send({ t: 'bush', bush: i, count: null, growFrom: null }, null);
        } else return done('Already grown');
        await this.save();
        return done('Grown back');
      }
      case 'a.remove': { // a loose item or campfire (by id), or a tree, rock or berry bush from the layout (for good)
        if (!w) return;
        if (MOVABLE[m.what]) {
          const i = Math.floor(m.idx);
          if (!idxOk(i, MOVABLE[m.what])) return;
          w.removed = w.removed || {};
          w.removed[`${m.what}:${i}`] = 1;
          if (m.what === 'tree') { w.trees = w.trees || {}; w.trees[i] = ['gone', Date.now()]; this.send({ t: 'tree', idx: i, state: 'gone' }, null); }
          else if (m.what === 'rock') { w.rocks = w.rocks || {}; w.rocks[i] = ['gone', Date.now()]; this.send({ t: 'rock', idx: i, state: 'gone' }, null); }
          else this.send({ t: 'removed', what: m.what, idx: i }, null);
          await this.save();
          return done('Removed');
        }
        const i = w.items.findIndex((it) => it.id === m.id);
        if (i < 0) { // not an item: a placed thing (a campfire)
          const list = this.placedList(), j = list.findIndex((th) => th.id === m.id);
          if (j < 0) return;
          for (const o of this.persons.values()) if (o.sit && o.sit.fire === m.id) this.standUp(o);
          this.note('admin', `Remove: ${list[j].kind} at ${Math.round(list[j].x)}, ${Math.round(list[j].z)}`);
          list.splice(j, 1);
          await this.save();
          this.send({ t: 'unplaced', id: m.id }, null);
          return;
        }
        this.note('admin', `Remove: loose ${w.items[i].kind} at ${Math.round(w.items[i].x)}, ${Math.round(w.items[i].z)}`);
        w.items.splice(i, 1);
        await this.save();
        this.send({ t: 'gone', id: m.id }, null);
        return;
      }

      /* ---------- the activity log (activity.js) ---------- */
      case 'a.log': return reply(this.activityView());

      /* ---------- one person: a new name, or a few words only they see ---------- */
      case 'a.rename': { // (the admin picks any name: this is how a bad one that got past the filter is fixed)
        if (!this.alive(them)) return done("They've gone");
        const name = clean(m.name, 20).trim(), was = them.name;
        if (!name || blank(name)) return done('Type a name');
        if (name === was) return done("That's already their name");
        them.name = name;
        if (them.look && them.look.name != null) them.look = { ...them.look, name };
        this.touch(them);
        await this.flush(them.who);
        this.send({ t: 'join', person: this.pub(them) }, them.who); // everyone else sees the new name (their game adds the person again)
        this.tell(them.who, this.mine(them));
        reply(await this.playerPage(them.who));
        return done(`${was} is now ${name}`);
      }
      case 'a.tell': { // a few words on one player's screen, shown like a message to everyone
        const text = clean(m.text, 140).trim();
        if (!text) return done('Type a message');
        if (!this.alive(them)) return done("They've gone");
        if (!sock) return done(`${them.name} is away, so they wouldn't see it`);
        this.tell(them.who, { t: 'announce', text });
        return done(`Sent to ${them.name}`);
      }

      case 'a.fires': return reply(this.firesView());
      case 'a.fire': { // any fire's flame and fuel: light it, put it out, or set how many hours it has left
        if (!w) return;
        const th = this.placedById(m.id), rule = th && fireRule(th.kind);
        if (!rule) return done("That fire is gone");
        if (!th.built) return done("It isn't built yet");
        this.burn(th);
        const whose = th.claim ? this.ownerName(th) : '', was = th.claim, wasSoc = this.socOfClaim(was);
        let text;
        if (m.do === 'out') {
          if (!th.lit) return done("It's already out");
          th.lit = false;
          text = 'Put out';
        } else if (m.do === 'light') {
          if (th.lit) return done("It's already burning");
          if (!(th.fuel > 0)) return done('It has no fuel. Set its fuel first');
          th.lit = true; th.burnt = true; // (burnt: taking it apart gives back only what doesn't burn, as when a player lights it)
          text = `Lit, with ${hoursText(th.fuel)} of fuel. It's nobody's claim unless you give it to someone`;
        } else if (m.do === 'fuel') {
          const h = m.hours; // (a real number only: nothing typed arrives as null, and must never count as 0 and put a fire out)
          if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return done('How many hours?');
          th.fuel = Math.min(rule.max, Math.round(h * HOUR));
          if (th.fuel <= 0) th.lit = false;
          text = th.fuel <= 0 ? 'No fuel left' : `${hoursText(th.fuel)} of fuel${th.fuel >= rule.max && h * HOUR > rule.max ? ' (the most it holds)' : ''}`;
        } else return;
        th.at = Date.now();
        this.burn(th); // out: a claim on it ends with it
        if (was && !th.claim) { text += wasSoc ? `. ${whose} ended with it` : `. ${whose}'s claim ended with it`; if (!wasSoc) this.tellClaim(was, 'The fire is out, so your camp has ended'); } // (a society's members are told when it ends: societies.js)
        await this.save();
        this.sendPlaced(th);
        reply(this.firesView());
        return done(text);
      }
      case 'a.claim': { // whose land a burning campfire holds: end the claim (the fire burns on), or give it to someone
        if (!w) return;
        const th = this.placedById(m.id);
        if (!th) return done("That fire is gone");
        this.burn(th);
        const whose = th.claim ? this.ownerName(th) : '', was = th.claim, wasSoc = this.socOfClaim(was);
        let text;
        if (m.do === 'end') { // the claim ends and the fire burns on; a society ends with its claim (societies.js)
          if (!th.claim) return done("It's nobody's claim");
          const soc = this.socOfClaim(th.claim);
          th.claim = null; // the fire is still its builder's to pack up (th.by)
          if (soc) this.socEnd(soc, `${soc.name} has ended: the admin ended it`);
          text = soc ? `${whose} ended. The fire burns on` : `${whose}'s claim ended. The fire burns on`;
        } else if (m.do === 'give') { // the same as them lighting it: a new society, theirs (one claim each)
          const to = this.persons.get(clean(m.to, 40));
          if (!to || !this.alive(to)) return done("They've left");
          if (th.kind !== CLAIM_KIND) return done("That can't hold a claim");
          const theirs = this.socOf(to.who);
          if (theirs) return done(theirs.leader === to.who && theirs.members.length === 1 ? `${to.name} already has a claim` : `${to.name} is in ${theirs.name}, which has its own claim`);
          if (!th.built || !th.lit) return done('Light it first: a claim lasts only while its fire burns');
          const no = this.claimFit(th, to); // the same rules as lighting a first fire: one claim each, clear of the pond and of other claims
          if (no) return done(no.why === 'has' ? `${to.name} already has a claim` : no.why === 'pond' ? "It's too close to the pond to be a claim" : `It's too close to ${no.name}`);
          if (wasSoc) { th.claim = null; this.socEnd(wasSoc, `${wasSoc.name} has ended: the admin gave its fire to someone else`); } // (its fire burns on, for them)
          const made = this.socNew(to, th);
          text = `Now ${to.name}'s claim, as ${made.name}${whose ? ` (it was ${whose})` : ''}`;
          this.tell(to.who, { t: 'claimNote', text: 'This fire is now your camp, while it burns' });
          this.tell(to.who, this.mine(to));
        } else return;
        if (was && was !== th.claim && !wasSoc) this.tellClaim(was, 'Your camp has ended');
        await this.save();
        this.sendPlaced(th);
        reply(this.firesView());
        return done(text);
      }

      /* ---------- Societies (World tab, societies.js): see them, rename one, take someone out, end one ---------- */
      case 'a.socs': return reply({ t: 'adminSocs', list: this.socsView() });
      case 'a.socRename': {
        const soc = this.socById(m.id);
        if (!soc) return done("That society has ended");
        const name = clean(m.name, SOC.nameMax).trim(), was = soc.name;
        if (name === was) return done("That's already its name");
        const no = this.socNameNo(name, soc.id, true); // (any name, as with people: this is how a bad one is fixed)
        if (no) return done(no);
        soc.name = name;
        await this.saveSocs();
        for (const mem of soc.members) this.socTag(mem.who); // the line under their name tags
        this.socTellMembers(soc);
        this.socNote(soc, `Your camp is now called ${name}`);
        const th = this.socFire(soc);
        if (th) this.sendPlaced(th); // the claim's name
        reply({ t: 'adminSocs', list: this.socsView() });
        return done(`${was} is now ${name}`);
      }
      case 'a.socRemove': {
        const soc = this.socById(m.id), mem = soc && soc.members.find((x) => x.who === m.who);
        if (!soc) return done("That society has ended");
        if (!mem) return done("They're not in it any more");
        const name = this.memberName(mem), ends = soc.members.length === 1;
        await this.socOut(soc, mem.who, 'removed');
        reply({ t: 'adminSocs', list: this.socsView() });
        return done(`${name} is out of ${soc.name}${ends ? `, so it has ended` : ''}`);
      }
      case 'a.socEnd': {
        const soc = this.socById(m.id);
        if (!soc) return done("That society has ended");
        this.socEnd(soc, `${soc.name} was ended by the admin, and its fire is out`); // (Luke: its fire goes out)
        await this.saveSocs();
        reply({ t: 'adminSocs', list: this.socsView() });
        return done(`${soc.name} ended and its fire is out`);
      }

      /* ---------- Restore: the whole world back to an earlier time, or undo the last restore (restore.js) ---------- */
      case 'a.restore': return this.restore(me, m, reply);

      /* ---------- Settings: live numbers (live.js) ---------- */
      case 'a.live':
        if (!(await this.setLive(m.id, m.value))) return done("That didn't work");
        return done(m.value == null ? 'Back to normal' : 'Changed');

      /* ---------- Items: an item's or a recipe's numbers, changed live (live-items.js) ---------- */
      case 'a.items': return reply({ t: 'adminItems', list: this.liveItemsView() }); // every number, what it started as, and whether it's changed
      case 'a.liveItem': {
        const v = await this.setLiveItem(m.at, m.value);
        reply({ t: 'adminItems', list: this.liveItemsView() });
        if (v === undefined) return done("That can't be changed");
        return done(v == null ? 'Back to what the game file says' : `Changed to ${v}`);
      }
    }
  },
};
