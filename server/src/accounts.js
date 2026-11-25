// Play on other devices with a link code (0.1.12; Luke picked codes over Google sign-in, 25 Nov 2026: no setup, no
// accounts). On the device that has the person: Get a code (6 letters, lasts LINK_MINUTES, works once). On the other
// device: type it in, and that device plays the same person from then on.
// - Kept in one storage key, 'accounts': links (device -> group) and accts (group -> the person's id, `who`). The first
//   device keeps its own id as the person's id, so it needs no link. Codes live in memory only (a restart just means
//   getting a new one).
// - A device that already has its own guest person loses it (the game warns first: "Your guest person here will be
//   removed"). Unlink this device: it's unlinked, and the game gives it a fresh id, so it's a new guest.
// - whoFor (index.js) turns a device's id into the person it plays, so bans, camps and tasks just work, and a ban covers
//   every linked device.
// - Storage writes only when a device is linked or unlinked. Wrong codes are counted per address (CODE_TRIES an hour),
//   so codes can't be guessed.
import { tagOf } from './shared.js';

export const LINK_MINUTES = 10;
const CODE_TRIES = 10, HOUR = 3600000;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, which look alike
export const freshAccounts = () => ({ links: {}, accts: {} });
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export const accountsMethods = {
  // a device's own id (scrambled), the group it's linked to, and the person it plays
  async whoIs(m) {
    const tag = await tagOf(m.pid || crypto.randomUUID());
    const acct = this.accounts.links[tag] || null;
    return { tag, acct, who: (acct && this.accounts.accts[acct]) || tag };
  },
  saveAccounts() { return this.put('accounts', this.accounts); },
  // the group a person belongs to, if any, and how many other devices are linked to it
  accountOf(who) {
    const acct = Object.keys(this.accounts.accts).find((a) => this.accounts.accts[a] === who) || null;
    return acct ? { acct, phones: Object.values(this.accounts.links).filter((a) => a === acct).length } : null;
  },
  // the group goes (Leave the world for good, the admin's Unlink all devices): every device linked to it is unlinked
  dropAccount(acct) {
    delete this.accounts.accts[acct];
    for (const [tag, a] of Object.entries(this.accounts.links)) if (a === acct) delete this.accounts.links[tag];
  },
  // Get a code: for the person this device plays (it must have one)
  async linkCode(m, reply) {
    const { who } = await this.whoIs(m);
    if (!this.alive(this.persons.get(who))) { reply({ t: 'linkNo', text: 'Make your person first' }); return; }
    if (!this.codes) this.codes = new Map();
    const now = Date.now();
    for (const [c, v] of this.codes) if (v.until < now || v.who === who) this.codes.delete(c); // (old ones, and this person's last one)
    let code = '';
    do { code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => LETTERS[b % LETTERS.length]).join(''); } while (this.codes.has(code));
    this.codes.set(code, { who, until: now + LINK_MINUTES * 60000 });
    reply({ t: 'linkCode', code, minutes: LINK_MINUTES });
  },
  // Use a code: this device plays that person from now on. Asks first (linkAsk) when this device's own person would be removed.
  async linkUse(ws, me, m, reply) {
    const now = Date.now(), from = me.from || '';
    if (!this.codeFails) this.codeFails = new Map();
    const fails = (this.codeFails.get(from) || []).filter((t) => now - t < HOUR);
    if (fails.length >= CODE_TRIES) { reply({ t: 'linkNo', text: 'Too many wrong codes. Try again in an hour' }); return; }
    const code = cleanCode(m.code), c = this.codes && this.codes.get(code);
    if (!c || c.until < now || !this.alive(this.persons.get(c.who))) {
      fails.push(now); this.codeFails.set(from, fails);
      reply({ t: 'linkNo', text: "That code didn't work. Check it, or get a new one" });
      return;
    }
    const { tag, who: playing } = await this.whoIs(m);
    if (playing === c.who) { reply({ t: 'linked' }); return; } // (already this person)
    if (this.accounts.links[tag]) { reply({ t: 'linkNo', text: 'Unlink this device first' }); return; }
    const mine = this.persons.get(tag), theirs = this.persons.get(c.who);
    if (this.alive(mine) && !m.sure) { reply({ t: 'linkAsk', mine: mine.name, theirs: theirs.name }); return; }
    if (mine) await this.forget(tag, ws, me, 'link'); // this device's guest person is removed (the game said so first)
    const acct = (this.accountOf(c.who) || {}).acct || `c:${c.who}`;
    this.accounts.accts[acct] = c.who;
    this.accounts.links[tag] = acct;
    this.codes.delete(code);
    await this.saveAccounts();
    this.note('world', `${theirs.name} is now playing on another device too`);
    reply({ t: 'linked' });
  },
  // Unlink this device: it's a new guest (the game gives it a fresh id). The person stays with their other devices.
  async unlink(m, reply) {
    const tag = await tagOf(m.pid);
    if (this.accounts.links[tag]) { delete this.accounts.links[tag]; await this.saveAccounts(); }
    reply({ t: 'unlinked' });
  },
};
