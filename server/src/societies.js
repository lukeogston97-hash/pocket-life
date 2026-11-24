// Societies (built 0.1.4; reworked 0.1.5 with Luke 24 Nov 2026: "lighting starts society", claim and society the same).
// Your claim IS your society. Lighting your first campfire starts both (named "<your name>'s camp" until the leader renames
// it), and the fire going out ends both, whoever or whatever puts it out (claimLost in claims.js). One claim each: your own
// society's, or the one you're in; any other fire is just a fire. The leader taps someone nearby who is playing to invite
// them, and they tap Join. Someone alone in their own society puts their fire out first (that ends it); someone in a
// society with others leaves it first. The invite waits on their connection (its attachment), so it needs no storage
// write. Members can do everything in the claim and keep its fire fed; only the leader can put the fire out. Anyone can
// leave; the leader can take people out and rename it. If the leader leaves or is gone, the member who joined first leads
// and the fire burns on; when the last one leaves, its fire goes out. Up to societies.maxMembers (game-data.json, also a
// live setting). Membership is by player (who), so it stays when your person dies and you start again; a player with no
// person in the world for 3 days (the away timer) leaves. Away members stay in the claim and feed its fire from their bags
// (away.js, via claimOf), so a society lasts only while someone keeps playing. Its name shows under members' name tags
// once there are 2 or more. A claim is th.claim 's:<id>'. Kept in storage under 'societies' { next, list }, saved only
// when something changes. These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, MINUTE, AWAY, FILTER, badName, blank, clean } from './shared.js';

export const SOC = { maxMembers: 3, nameMax: 20, inviteMinutes: 5, inviteReach: 8, ...(G.societies || {}) };
export const socKey = (s) => `s:${s.id}`;
// how many people a society can have right now (a live setting too: Admin > Settings, live.js)
export const socMax = () => Math.max(1, Math.round(Number((G.societies || {}).maxMembers)) || SOC.maxMembers);
// no person in the world for this long and you leave your society: the same as being away too long
export const SOC_GONE_MS = ((AWAY.sleepAfterHours || 24) + (AWAY.goneAfterDays || 2) * 24) * HOUR;
export const INVITE_MS = SOC.inviteMinutes * MINUTE;
export const freshSocieties = () => ({ next: 1, list: [] });

export const societiesMethods = {
  socById(id) { return this.societies.list.find((s) => s.id === Number(id)) || null; },
  socOf(who) { return who ? this.societies.list.find((s) => s.members.some((m) => m.who === who)) || null : null; },
  // the society a claim belongs to ('s:<id>'), or null
  socOfClaim(key) { return typeof key === 'string' && key.startsWith('s:') ? this.socById(key.slice(2)) : null; },
  saveSocs() { return this.put('societies', this.societies); },
  // a member's name: their person's, or the last one they had
  memberName(m) { const p = this.persons.get(m.who); if (this.alive(p)) m.name = p.name; return m.name || 'Someone'; },
  leaderName(s) { const m = s.members.find((x) => x.who === s.leader); return m ? this.memberName(m) : 'Someone'; },
  // the society's fire (its claim), as stored: no burning here, so it's safe to call from burn() itself
  socFire(s) { return this.placedList().find((th) => th.claim === socKey(s)) || null; },
  // the leader first, then in the order they joined
  socMembers(s) { return [...s.members].sort((a, b) => (b.who === s.leader) - (a.who === s.leader) || a.at - b.at); },
  memberState(who) { const p = this.persons.get(who); return this.alive(p) ? this.stateOf(p) : 'gone'; },
  // what a member's game is told, in 'me' (persons.js mine)
  socView(who) {
    const s = this.socOf(who);
    if (!s) return null;
    return { id: s.id, name: s.name, lead: s.leader === who, max: socMax(),
      members: this.socMembers(s).map((m) => ({ id: m.who, name: this.memberName(m), lead: m.who === s.leader, state: this.memberState(m.who) })) };
  },
  // the name under a member's name tag: only once a society has 2 or more people (pub in persons.js)
  socTagName(who) { const s = this.socOf(who); return s && s.members.length > 1 ? s.name : null; },
  socTag(who) { this.send({ t: 'socTag', id: who, soc: this.socTagName(who) }, null); },
  socTagAll(s) { for (const m of s.members) this.socTag(m.who); },
  // members playing right now get their person, with the society in it, again
  socTellMembers(s) { for (const m of s.members) { const p = this.persons.get(m.who); if (this.alive(p) && this.isOnline(m.who)) this.tell(m.who, this.mine(p)); } },
  // a few words for every member playing right now
  socNote(s, text, except = null) { for (const m of s.members) if (m.who !== except && this.isOnline(m.who)) this.tell(m.who, { t: 'socNote', text }); },
  // why a society can't have this name ('' if it can). The admin can pick a name the filter would refuse.
  socNameNo(name, exceptId = null, admin = false) {
    if (!name || blank(name)) return 'Type a name';
    if (name.length < 2) return 'At least 2 letters';
    if (!admin && badName(name, FILTER)) return 'Pick a different name';
    if (this.societies.list.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase())) return 'That name is taken';
    return '';
  },
  // "<name>'s camp", with a number on the end if another society has that name already
  socFirstName(name) {
    const base = `${clean(name, 20).trim() || 'Someone'}'s camp`;
    for (let k = 1; k < 1000; k++) { const n = k === 1 ? base : `${base} ${k}`; if (!this.socNameNo(n, null, true)) return n; }
    return `${base} ${Date.now() % 100000}`;
  },
  // lighting their first fire: a new society, theirs, holding the land round it (tryClaim in claims.js)
  socNew(p, th) {
    const s = { id: this.societies.next++, name: this.socFirstName(p.name), leader: p.who, members: [{ who: p.who, name: p.name, at: Date.now() }], made: Date.now() };
    this.societies.list.push(s);
    th.claim = socKey(s);
    th.by = p.who; // theirs to pack up later
    this.saveSocs();
    this.note('world', `${p.name} lit a fire and started ${s.name}`);
    return s;
  },
  // someone joins (their invite was checked)
  socJoin(s, p) {
    s.members.push({ who: p.who, name: p.name, at: Date.now() });
    this.note('world', `${p.name} joined ${s.name}`);
    this.socNote(s, `${p.name} joined ${s.name}`, p.who);
    this.socTagAll(s); // (with 2 or more, the name shows under everyone's tags)
  },
  // someone is out of their society: they left (how 'left'), the leader or the admin took them out ('removed'), or they
  // had no person in the world for too long ('gone'). The member who joined first takes over from a leader. The last one
  // out ends it, and its fire goes out.
  async socOut(s, who, how = 'left') {
    const m = s.members.find((x) => x.who === who);
    if (!m) return;
    const name = this.memberName(m);
    this.note('world', how === 'gone' ? `${name} left ${s.name} (not in the world for 3 days)` : how === 'removed' ? `${name} was taken out of ${s.name}` : `${name} left ${s.name}`);
    if (s.members.length === 1) { this.socEnd(s, `${s.name} has ended and its fire is out`); await this.saveSocs(); return; }
    s.members = s.members.filter((x) => x.who !== who);
    const newLeader = s.leader === who;
    if (newLeader) { s.leader = [...s.members].sort((a, b) => a.at - b.at)[0].who; this.note('world', `${this.leaderName(s)} leads ${s.name} now`); }
    this.socNote(s, `${name} ${how === 'removed' ? 'is out of' : 'left'} ${s.name}${newLeader ? `. ${this.leaderName(s)} leads it now` : ''}`);
    this.socTellMembers(s);
    await this.saveSocs();
    this.socTag(who);
    this.socTagAll(s); // (down to one: the name leaves their tag)
    if (how === 'removed') this.tell(who, { t: 'socNote', text: `You're no longer in ${s.name}` });
    const p = this.persons.get(who);
    if (this.alive(p) && this.isOnline(who)) this.tell(who, this.mine(p));
  },
  // A society ends: everyone's out, and its fire goes out if it still burns (the claim and the society end together).
  // Called when its fire goes out by itself or is put out (claimLost), when the last one leaves, and by the admin.
  socEnd(s, text) {
    if (!this.societies.list.includes(s)) return;
    this.societies.list = this.societies.list.filter((x) => x !== s);
    const th = this.socFire(s);
    if (th) { // (not when its fire already went out: claimLost has let go of it)
      th.claim = null; th.by = null; // the cold fire is anyone's, as when any claim's fire goes out
      if (th.lit) { this.burn(th); th.lit = false; th.at = Date.now(); }
      this.save();
      this.sendPlaced(th, null);
    }
    for (const m of s.members) {
      this.socTag(m.who);
      const p = this.persons.get(m.who);
      if (this.alive(p) && this.isOnline(m.who)) { this.tell(m.who, this.mine(p)); if (text) this.tell(m.who, { t: 'socNote', text }); }
    }
    this.saveSocs();
    this.note('world', `${s.name} ended`);
  },
  // its fire went out (burnt out, or put out): the society ends with its claim (claimLost in claims.js)
  socFireOut(key) { const s = this.socOfClaim(key); if (s) this.socEnd(s, `${s.name} has ended: its fire went out`); },
  // the tick: a player with no person in the world (gone, or dead and not back) for too long leaves their society
  async socGone(p, now = Date.now()) {
    if (this.alive(p) || !(p.state === 'gone' || now - (p.diedAt || now) > SOC_GONE_MS)) return;
    const s = this.socOf(p.who);
    if (s) await this.socOut(s, p.who, 'gone');
  },
  // Starting up: claims from before 0.1.5 (a player's who) become their owner's society, and a society with no burning
  // fire (0.1.4 could start one from the Menu without a fire) ends. Says whether anything changed, to be saved.
  socTidy() {
    let changed = false;
    for (const th of this.placedList()) {
      if (!th.claim || String(th.claim).startsWith('s:')) continue;
      const p = this.persons.get(th.claim);
      if (th.lit && this.alive(p) && !this.socOf(p.who)) this.socNew(p, th); else { th.claim = null; th.by = null; }
      changed = true;
    }
    for (const s of [...this.societies.list]) {
      if (this.placedList().some((th) => th.claim === socKey(s) && th.lit)) continue;
      this.societies.list = this.societies.list.filter((x) => x !== s);
      changed = true;
    }
    return changed;
  },
  // the admin's list (World tab, Societies)
  socsView(now = Date.now()) {
    return this.societies.list.map((s) => {
      const th = this.socFire(s);
      if (th) this.burn(th, now);
      return { id: s.id, name: s.name, made: s.made, max: socMax(), leader: this.leaderName(s),
        members: this.socMembers(s).map((m) => ({ id: m.who, name: this.memberName(m), lead: m.who === s.leader, state: this.memberState(m.who) })),
        claim: th && th.claim ? { id: th.id, x: th.x, z: th.z, fuel: Math.round(th.fuel || 0) } : null };
    }).filter((x) => this.socById(x.id)); // (a fire that just burnt out ended its society)
  },
};
