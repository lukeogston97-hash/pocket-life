// Google sign-in (0.1.12), optional: guests play with no sign-in. Signing in links this phone to a Google account, so the
// same person plays on every phone and computer signed in to it.
// - The game sends Google's signed note (an ID token). The server never takes the game's word for it: it checks Google's
//   signature with Google's public keys (fetched now and then and kept), that the note was made for Pocket Life's client
//   ID (settings.googleClientId in game-data.json), and that it hasn't run out. Only the account's number ("sub") is used,
//   and only in scrambled form (tagOf): no email, no name.
// - Kept in one storage key, 'accounts': links (phone -> account) and accts (account -> the person's id, `who`). The
//   first phone to sign in gives the account its person (the person keeps the id it had). A phone that signs in to an
//   account that already has a person loses its own guest person (the game warns first: "Your guest person here will be
//   removed"). Signing out unlinks this phone, and the game gives it a fresh id, so it's a new guest.
// - whoFor (index.js) turns a phone's id into the person it plays, so everything else (bans, camps, tasks) just works
//   with the account's person. A ban follows the account, as it's on the person's id.
// - Storage writes only at sign-in and sign-out; Google's keys are fetched every few hours at most.
import { G, tagOf } from './shared.js';

const KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const KEYS_KEEP = 6 * 3600000, KEYS_RETRY = 5 * 60000; // keep Google's keys this long; a key we don't know asks again at most this often
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SKEW = 60000; // a minute either way for clocks that are a little out
export const freshAccounts = () => ({ links: {}, accts: {} });

const b64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

export const accountsMethods = {
  googleClient() { return G.googleClientId || ''; },
  // a phone's own id (scrambled), the account it's linked to, and the person it plays
  async whoIs(m) {
    const tag = await tagOf(m.pid || crypto.randomUUID());
    const acct = this.accounts.links[tag] || null;
    return { tag, acct, who: (acct && this.accounts.accts[acct]) || tag };
  },
  saveAccounts() { return this.put('accounts', this.accounts); },
  // the account a person belongs to, if any, and how many phones and computers are signed in to it
  accountOf(who) {
    const acct = Object.keys(this.accounts.accts).find((a) => this.accounts.accts[a] === who) || null;
    return acct ? { acct, phones: Object.values(this.accounts.links).filter((a) => a === acct).length } : null;
  },
  // the account goes (Leave the world for good, the admin's Sign out everywhere): every phone linked to it is unlinked
  dropAccount(acct) {
    delete this.accounts.accts[acct];
    for (const [tag, a] of Object.entries(this.accounts.links)) if (a === acct) delete this.accounts.links[tag];
  },
  async googleKeys(fresh = false) {
    const k = this.gKeys;
    if (k && !fresh && Date.now() - k.at < KEYS_KEEP) return k.keys;
    if (k && fresh && Date.now() - k.at < KEYS_RETRY) return k.keys;
    try {
      const res = await fetch(KEYS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.gKeys = { at: Date.now(), keys: (await res.json()).keys || [] };
    } catch (err) { if (!k) return []; this.gKeys = { ...k, at: Date.now() - KEYS_KEEP + KEYS_RETRY }; } // (Google unreachable: keep the old keys a little longer)
    return this.gKeys.keys;
  },
  // Google's signed note -> the account's number, or null if anything about it is wrong
  async googleSub(token) {
    const cid = this.googleClient();
    if (!cid || typeof token !== 'string' || token.length > 4000) return null;
    try {
      const [h, p, s] = token.split('.');
      if (!s) return null;
      const head = part(h), body = part(p);
      if (head.alg !== 'RS256' || !head.kid) return null;
      let jwk = (await this.googleKeys()).find((x) => x.kid === head.kid);
      if (!jwk) jwk = (await this.googleKeys(true)).find((x) => x.kid === head.kid); // Google changes its keys now and then
      if (!jwk) return null;
      const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`)))) return null;
      const now = Date.now();
      if (!ISSUERS.includes(body.iss) || body.aud !== cid || !(body.exp * 1000 > now - SKEW) || (body.iat && body.iat * 1000 > now + SKEW)) return null;
      return typeof body.sub === 'string' && body.sub ? body.sub : null;
    } catch (err) { return null; }
  },
  // Sign in: m.token is Google's note. Asks first (signInAsk) when this phone's own person would be removed.
  async signIn(ws, me, m, reply) {
    const sub = await this.googleSub(m.token);
    if (!sub) { reply({ t: 'signInNo', text: "Couldn't sign in just now. Try again." }); return; }
    const tag = await tagOf(m.pid), acct = await tagOf(`google:${sub}`);
    const linked = this.accounts.links[tag];
    if (linked && linked !== acct) { reply({ t: 'signInNo', text: 'Sign out first, then sign in with the other account' }); return; }
    if (linked === acct) { reply({ t: 'signedIn' }); return; }
    const theirs = this.accounts.accts[acct];
    if (!theirs) { // the account's first phone: it takes the person this phone already has
      this.accounts.accts[acct] = tag;
      this.accounts.links[tag] = acct;
      await this.saveAccounts();
      this.note('world', 'Someone signed in with Google');
      reply({ t: 'signedIn' });
      return;
    }
    const mine = this.persons.get(tag), them = this.persons.get(theirs);
    if (this.alive(mine) && !m.sure) { reply({ t: 'signInAsk', mine: mine.name, theirs: this.alive(them) ? them.name : '' }); return; }
    if (mine) await this.forget(tag, ws, me, 'signIn'); // this phone's guest person is removed (the game said so first)
    this.accounts.links[tag] = acct;
    await this.saveAccounts();
    this.note('world', 'Someone signed in with Google on another device');
    reply({ t: 'signedIn' });
  },
  // Sign out: this phone is unlinked (the game then gives it a fresh id, so it's a new guest). The account and its person stay.
  async signOut(m, reply) {
    const tag = await tagOf(m.pid);
    if (this.accounts.links[tag]) { delete this.accounts.links[tag]; await this.saveAccounts(); }
    reply({ t: 'signedOut' });
  },
};
