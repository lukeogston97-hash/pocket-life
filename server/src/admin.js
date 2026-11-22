// The admin player (Luke): every 'a.' message, from maintenance to Reset the world.
// The Admin panel's tabs: Server (maintenance, announce, speed), Players (find someone, their page: stats, bag,
// give and take, past people), Inbox (feedback and reports, marked Done and cleared after 30 days), World (counts,
// regrow everything, clear loose items, reset), Settings (live settings, live.js). Single things in the world
// (trees, rocks, berry bushes, campfires, loose items) are moved, regrown and removed from their tap menus.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { FILTER, G, starText, MINUTE, HOUR, clean, num, kindOk, addCarry, takeCarry, ageOf, pickRandom } from './shared.js';
import { fireRule } from './placed.js';

const DONE_KEEP_DAYS = 30; // feedback and reports marked Done are deleted after this
const PAST_KEEP = 20; // earlier people each player had
const PLAYERS_SHOWN = 50; // the Players tab shows this many at a time (search to find others)
const CLEAR_NEAR = 10; // Clear loose items near you: within this many metres
const idxOk = (i, most) => Number.isInteger(i) && i >= 0 && i < most;
const MOVABLE = { tree: 5000, rock: 2000, bush: 200 }; // things laid out with the world, by their number in the layout

export const adminMethods = {
  adminState(me) {
    return { t: 'admin', on: true, tag: !!me.tag, maintenance: this.admin.maintenance, message: this.admin.message, speed: this.speed, usage: this.usageNow(), live: this.liveView() };
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
    const out = { t: 'adminPlayer', id: who, muted: this.admin.muted.includes(who), banned: this.admin.banned.includes(who), reports, past, v: s ? s.p.v : '', link: s ? s.p.link : '' };
    if (this.alive(p)) Object.assign(out, this.playerRow(p), { born: p.born || 0, stats: p.stats, carry: p.carry || {}, x: num(p.x), z: num(p.z) });
    else Object.assign(out, { name: past[0] ? past[0].name : `Phone ${who}`, state: 'gone' });
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
  // sticks and stones back up to their normal amount, round the spots they turn up at
  topUp() {
    const w = this.world;
    for (const [kind, cap] of Object.entries(w.caps || {})) {
      const spots = (w.spots || {})[kind] || [];
      let have = w.items.filter((it) => it.kind === kind).length;
      for (; have < cap && spots.length; have++) {
        const [x, z] = pickRandom(spots);
        w.items.push({ id: w.nextId++, kind, x: num(x + (Math.random() - 0.5) * 0.8), z: num(z + (Math.random() - 0.5) * 0.8), rot: num(Math.random() * Math.PI) });
      }
    }
  },
  // Each admin message starts with 'a.' and only works for the admin.
  async adminDo(ws, me, m) {
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    const done = (text) => reply({ t: 'adminDone', text, ...this.adminState(me) });
    const w = this.world;
    const them = m.id ? this.persons.get(m.id) : null;
    const sock = m.id ? this.socketOf(m.id) : null;
    const everyoneSees = async () => { await this.save(); this.send({ t: 'world', world: this.view() }, null); }; // big changes: the whole world again
    switch (m.t) {
      case 'a.state': return reply(this.adminState(me)); // the Admin panel was opened: fresh numbers
      case 'a.tag':
        me.tag = !!m.on; ws.serializeAttachment(me);
        this.send({ t: 'badge', id: me.id, on: me.tag }, me.id);
        return done(me.tag ? 'Admin tag on' : 'Admin tag off');
      case 'a.maintenance':
        this.admin.maintenance = !!m.on;
        this.admin.message = clean(m.text, 200).trim();
        await this.saveAdmin();
        if (this.admin.maintenance) for (const { ws: s, p } of this.sockets()) if (!p.admin && p.link !== 'test') this.boot(s, { t: 'maintenance', text: this.admin.message });
        return done(this.admin.maintenance ? 'Maintenance on' : 'Maintenance off');
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
        if (sock && sock.p.admin) return done("That's you");
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
      case 'a.reset':
        this.world = null;
        await this.ctx.storage.delete('world');
        for (const { ws: s } of this.sockets()) this.boot(s, { t: 'reset' }); // everyone rejoins and the first one lays it out fresh
        return;

      /* ---------- single things: add, move, regrow, remove ---------- */
      case 'a.add': { // n of an item, round where you tapped
        if (!w || !kindOk(m.kind) || !G.items[m.kind]) return;
        const n = Math.max(1, Math.min(50, Math.floor(Number(m.n) || 1))), out = [];
        for (let k = 0; k < n; k++) {
          const a = k * 2.39996, r = k ? 0.3 + Math.sqrt(k) * 0.25 : 0;
          out.push({ id: w.nextId++, kind: m.kind, x: num(num(m.x) + Math.cos(a) * r), z: num(num(m.z) + Math.sin(a) * r), rot: num(Math.random() * Math.PI) });
        }
        w.items.push(...out);
        await this.save();
        this.send({ t: 'added', items: out }, null);
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
          list.splice(j, 1);
          await this.save();
          this.send({ t: 'unplaced', id: m.id }, null);
          return;
        }
        w.items.splice(i, 1);
        await this.save();
        this.send({ t: 'gone', id: m.id }, null);
        return;
      }

      /* ---------- Settings: live numbers (live.js) ---------- */
      case 'a.live':
        if (!(await this.setLive(m.id, m.value))) return done("That didn't work");
        return done(m.value == null ? 'Back to normal' : 'Changed');
    }
  },
};
