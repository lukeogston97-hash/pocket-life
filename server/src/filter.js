// Chat filter (the same code is in the game and on the server): bad words become stars, bad names are refused.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
const leet = (s) => s.toLowerCase().replace(/[0134578@$!|+]/g, (c) => LEET[c]);
const ENDINGS = ['', 's', 'es', 'ed', 'ing', 'y', 'er', 'ers'];
function badWord(token, F) {
  const n = leet(token).replace(/[^a-z]/g, '');
  if (!n) return false;
  for (const f of new Set([n, n.replace(/(.)\1+/g, '$1')])) { // also with doubled letters squashed (fuuuck)
    if ((F.anywhere || []).some((r) => f.includes(r))) return true;
    if ((F.words || []).some((w) => ENDINGS.some((e) => f === w + e))) return true;
  }
  return false;
}
export function starText(text, F) {
  let out = String(text).replace(/\S+/g, (tok) => (badWord(tok, F) ? '*'.repeat(tok.length) : tok));
  for (const p of F.phrases || []) {
    const re = new RegExp(`\\b${p.split(/\s+/).map((w) => w.replace(/[^a-z]/gi, '')).join('[\\s\\W_]+')}\\b`, 'gi');
    out = out.replace(re, (m) => m.replace(/\S/g, '*'));
  }
  return out;
}
const badNameIn = (name, F) => String(name).split(/[\s._-]+/).some((t) => badWord(t, F))
  || (F.anywhere || []).some((r) => leet(name).replace(/[^a-z]/g, '').includes(r)) || starText(name, F) !== String(name);
export const badName = (name, F) => badNameIn(name, F) || (!!F.names && badNameIn(name, F.names)); // names also can't say admin, mod and so on
