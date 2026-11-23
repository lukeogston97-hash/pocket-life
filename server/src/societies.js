// Societies (built 0.1.4, decided with Luke 24 Nov 2026): groups of players inside the main world. A society has a name,
// a leader and up to societies.maxMembers members (game-data.json). It holds one claim: the leader's lit campfire, whose
// th.claim is 's:<id>' instead of a player's who (claims.js). Members can do everything inside it and any member can feed
// its fire; members' own fires are just fires. Joining is by invite: the leader taps someone nearby who is playing, and
// they tap Join, after putting out their own claim's fire (lighting a fire starts a claim, putting it out ends it). The
// invite waits on their connection (its attachment), so it needs no storage write. Anyone can leave, and the leader can
// remove members. If the leader leaves or is gone, the member who joined first takes over. When the last one leaves, the
// society ends and its claim becomes theirs. Membership is by player (who), so it stays when your person dies and you
// start again; a player with no person in the world for as long as the away timer (3 days: away too long, or dead and
// not back) leaves. Away members stay in the society's claim and feed its fire from their bags (away.js, via claimOf),
// so a society lasts only while someone keeps playing. Kept in storage under 'societies' { next, list }, saved only when
// something changes. These are methods of the World (index.js adds them to it), so `this` is the world.
import { G, HOUR, MINUTE, AWAY, FILTER, badName, blank } from './shared.js';

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
  // the society a claim belongs to ('s:<id>'), or null for a player's own claim
  socOfClaim(key) { return typeof key === 'string' && key.startsWith('s:') ? this.socById(key.slice(2)) : null; },
  saveSocs() { return this.put('societies', this.societies); },
  // a member's name: their person's, or the last one they had
  memberName(m) { const p = this.persons.get(m.who); if (this.alive(p)) m.name = p.name; return m.name || 'Someone'; },
  leaderName(s) { const m = s.members.find((x) => x.who === s.leader); return m ? this.memberName(m) : 'Someone'; },
  // the society's claim: its burning campfire, or null
  socClaim(s) { return this.claims().find((th) => th.claim === socKey(s)) || null; },
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
  // everyone sees a member's society under their name tag
  socTag(who) { this.send({ t: 'socTag', id: who, soc: (this.socOf(who) || {}).name || null }, null); },
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
  // start a society: they lead it, and their own claim (if they have one) becomes the society's
  socStart(p, name) {
    const own = this.claimOf(p.who); // (worked out before they're in it: their own claim)
    const s = { id: this.societies.next++, name, leader: p.who, members: [{ who: p.who, name: p.name, at: Date.now() }], made: Date.now() };
    this.societies.list.push(s);
    if (own) { own.claim = socKey(s); this.save(); this.sendPlaced(own, null); }
    this.note('world', `${p.name} started ${name}`);
    return s;
  },
  // someone joins (their invite was checked)
  socJoin(s, p) {
    s.members.push({ who: p.who, name: p.name, at: Date.now() });
    this.note('world', `${p.name} joined ${s.name}`);
    this.socNote(s, `${p.name} joined ${s.name}`, p.who);
  },
  // someone is out of their society: they left (how 'left'), the leader or the admin took them out ('removed'), or they
  // had no person in the world for too long ('gone'). The member who joined first takes over from a leader; the last
  // one out ends it, and its claim becomes theirs.
  async socOut(s, who, how = 'left') {
    const m = s.members.find((x) => x.who === who);
    if (!m) return;
    const name = this.memberName(m);
    s.members = s.members.filter((x) => x.who !== who);
    this.note('world', how === 'gone' ? `${name} left ${s.name} (not in the world for 3 days)` : how === 'removed' ? `${name} was taken out of ${s.name}` : `${name} left ${s.name}`);
    if (!s.members.length) this.socEnd(s, who);
    else {
      const newLeader = s.leader === who;
      if (newLeader) { s.leader = [...s.members].sort((a, b) => a.at - b.at)[0].who; this.note('world', `${this.leaderName(s)} leads ${s.name} now`); }
      this.socNote(s, `${name} ${how === 'removed' ? 'is out of' : 'left'} ${s.name}${newLeader ? `. ${this.leaderName(s)} leads it now` : ''}`);
      this.socTellMembers(s);
    }
    await this.saveSocs();
    this.socTag(who);
    if (how === 'removed') this.tell(who, { t: 'socNote', text: `You're no longer in ${s.name}` });
    const p = this.persons.get(who);
    if (this.alive(p) && this.isOnline(who)) this.tell(who, this.mine(p));
  },
  // a society ends: its claim becomes `heir`'s own (its last member, or its leader when the admin ends it)
  socEnd(s, heir) {
    this.societies.list = this.societies.list.filter((x) => x !== s);
    const th = this.socClaim(s);
    if (th) {
      th.claim = heir && !this.claims().some((o) => o.claim === heir) ? heir : null; // (only ever one claim each)
      this.save();
      this.sendPlaced(th, null);
    }
    this.note('world', `${s.name} ended`);
  },
  // the admin ends a society: everyone is out, and its claim becomes the leader's
  async socEndAll(s) {
    const was = [...s.members];
    this.socEnd(s, s.leader);
    await this.saveSocs();
    for (const m of was) {
      this.socTag(m.who);
      this.tell(m.who, { t: 'socNote', text: `${s.name} has ended` });
      const p = this.persons.get(m.who);
      if (this.alive(p) && this.isOnline(m.who)) this.tell(m.who, this.mine(p));
    }
  },
  // the tick: a player with no person in the world (gone, or dead and not back) for too long leaves their society
  async socGone(p, now = Date.now()) {
    if (this.alive(p) || !(p.state === 'gone' || now - (p.diedAt || now) > SOC_GONE_MS)) return;
    const s = this.socOf(p.who);
    if (s) await this.socOut(s, p.who, 'gone');
  },
  // the admin's list (World tab, Societies)
  socsView(now = Date.now()) {
    return this.societies.list.map((s) => {
      const th = this.socClaim(s);
      return { id: s.id, name: s.name, made: s.made, max: socMax(), leader: this.leaderName(s),
        members: this.socMembers(s).map((m) => ({ id: m.who, name: this.memberName(m), lead: m.who === s.leader, state: this.memberState(m.who) })),
        claim: th ? { id: th.id, x: th.x, z: th.z, fuel: Math.round(this.burn(th, now).fuel || 0) } : null };
    });
  },
};
