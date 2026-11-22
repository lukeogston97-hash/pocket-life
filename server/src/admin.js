// The admin player (Luke): every 'a.' message, from maintenance to Reset the world.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { FILTER, G, starText, MINUTE, clean, num, kindOk } from './shared.js';

export const adminMethods = {
  adminState(me) {
    return { t: 'admin', on: true, tag: !!me.tag, maintenance: this.admin.maintenance, message: this.admin.message, speed: this.speed, usage: this.usageNow() };
  },
  // Each admin message starts with 'a.' and only works for the admin.
  async adminDo(ws, me, m) {
    const reply = (msg) => { try { ws.send(JSON.stringify(msg)); } catch (err) { /* gone */ } };
    const done = (text) => reply({ t: 'adminDone', text, ...this.adminState(me) });
    const w = this.world;
    const them = m.id ? this.persons.get(m.id) : null;
    const sock = m.id ? this.socketOf(m.id) : null;
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
      case 'a.list': {
        const feedback = ((await this.ctx.storage.get('feedback')) || []).slice(-100).reverse();
        const reports = ((await this.ctx.storage.get('reports')) || []).slice(-100).reverse();
        const online = this.sockets().filter(({ p }) => p.who).map(({ p }) => {
          const per = this.persons.get(p.who);
          return { id: p.who, name: per && this.alive(per) ? per.name : '(making a person)', v: p.v, link: p.link, x: per ? per.x : 0, z: per ? per.z : 0, muted: this.admin.muted.includes(p.who) };
        });
        const all = [...this.persons.values()].filter((p) => this.alive(p));
        const counts = { online: all.filter((p) => this.isOnline(p.who)).length, away: all.filter((p) => !this.isOnline(p.who) && !p.asleep).length, asleep: all.filter((p) => p.asleep).length };
        return reply({ t: 'adminList', feedback, reports, online, banned: this.admin.banned, counts });
      }
      case 'a.delete': { // delete one feedback note or report
        const key = m.list === 'reports' ? 'reports' : 'feedback';
        const list = (await this.ctx.storage.get(key)) || [];
        await this.put(key, list.filter((x) => x.at !== m.at));
        return done('Deleted');
      }
      case 'a.announce': {
        const text = starText(clean(m.text, 140).trim(), FILTER);
        if (text) this.send({ t: 'announce', text }, null);
        return done('Message sent');
      }
      case 'a.kick': case 'a.ban': {
        if (!them && !sock) return done("They've left");
        if (sock && sock.p.admin) return done("That's you");
        if (m.t === 'a.ban' && !this.admin.banned.includes(m.id)) { this.admin.banned.push(m.id); await this.saveAdmin(); }
        if (sock) this.boot(sock.ws, { t: m.t === 'a.ban' ? 'banned' : 'kicked' });
        return done(`${them ? them.name : 'They'} ${m.t === 'a.ban' ? 'banned' : 'kicked'}`);
      }
      case 'a.unban':
        this.admin.banned = this.admin.banned.filter((x) => x !== m.who); await this.saveAdmin();
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
      case 'a.speed': { // needs run x times faster for a few minutes, to test people looking after themselves
        const x = Math.max(1, Math.min(600, Number(m.x) || 1));
        for (const p of this.persons.values()) this.catchUp(p);
        this.speed = x > 1 ? { x, until: Date.now() + Math.max(1, Math.min(60, Number(m.minutes) || 10)) * MINUTE } : null;
        if (this.speed) await this.put('speed', this.speed); else await this.ctx.storage.delete('speed');
        this.send({ t: 'speed', speed: this.speed }, null);
        return done(this.speed ? `Time ${x}x faster for ${Math.round((this.speed.until - Date.now()) / MINUTE)} minutes` : 'Time back to normal');
      }
      case 'a.reset':
        this.world = null;
        await this.ctx.storage.delete('world');
        for (const { ws: s } of this.sockets()) this.boot(s, { t: 'reset' }); // everyone rejoins and the first one lays it out fresh
        return;
      case 'a.add': {
        if (!w || !kindOk(m.kind)) return;
        const item = { id: w.nextId++, kind: m.kind, x: num(m.x), z: num(m.z), rot: num(Math.random() * Math.PI) };
        w.items.push(item);
        await this.save();
        this.send({ t: 'added', items: [item] }, null);
        return;
      }
      case 'a.remove': {
        if (!w) return;
        const i = w.items.findIndex((it) => it.id === m.id);
        if (i < 0) return;
        w.items.splice(i, 1);
        await this.save();
        this.send({ t: 'gone', id: m.id }, null);
        return;
      }
    }
  },
};
