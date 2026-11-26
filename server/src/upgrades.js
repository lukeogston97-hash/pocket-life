// Upgrading saved data (0.2.0). Everything the world keeps in storage (the world, each person, camps, linked devices,
// the admin's settings) was written in some save format. FORMAT is the newest; storage's "format" says which one the
// saved data is in (a world from before 0.2.0 has none: that's format 1). When the server starts, every step newer than
// the saved format runs once, in order, and then everything is saved in the new format.
//
// A change to what's saved (a field renamed, moved or split up) = a new step at the end of STEPS with the next number,
// FORMAT set to it, and a check in tools/tests/upgrades.mjs. A step gets the world (`w`: w.world, w.persons, w.societies,
// w.accounts, w.admin...) and changes it in place. It must cope with any old data: skip what isn't there, and never
// drop what it doesn't understand, and running it twice must be harmless (if a later step fails, they run again next
// start). A restore (restore.js) goes back to data with its own format number, so the steps from there run again by themselves.
//
// Also here: tidy(), which runs every start and makes broken records safe (it never invents game state).
export const FORMAT = 1;

export const STEPS = [
  // { to: 2, what: 'what changed and why', run(w) { for (const p of w.persons.values()) { ... } } },
];

export const upgradeMethods = {
  // runs the steps the saved data hasn't had yet. Returns what ran ([] if nothing), so the constructor can save.
  async upgradeSaved(steps = STEPS, format = FORMAT) {
    const saved = Number(await this.ctx.storage.get('format')) || 1;
    if (saved > format) { // data from a newer server (a rollback?): left as it is, and said in the Inbox
      await this.noteError('reading saved data', new Error(`the saved data is format ${saved}, newer than this server's ${format}. Put the newer server back, or Restore to before it`));
      return { ran: [], newer: saved };
    }
    if (saved === format) return { ran: [] };
    const due = steps.filter((s) => s.to > saved && s.to <= format).sort((a, b) => a.to - b.to);
    for (const s of due) {
      try { s.run(this); } catch (err) { // the format number isn't moved on, so the steps run again next start (write them so that's harmless)
        await this.noteError(`upgrading saved data to format ${s.to} (${s.what})`, err);
        return { ran: due.slice(0, due.indexOf(s)).map((x) => x.to), failed: s.to };
      }
    }
    // everything saved again, in the new format
    for (const p of this.persons.values()) this.touch(p);
    await this.flush(undefined, true);
    if (this.world) await this.save();
    await this.saveSocs();
    await this.put('format', format);
    return { ran: due.map((s) => s.to) };
  },
  // broken records from storage, made safe: a person that isn't a proper record is set aside (kept under bad:<key>, so
  // nothing is lost, and noted in the Inbox), and a world missing one of its lists gets an empty one
  async tidySaved() {
    const notes = [];
    for (const [who, p] of [...this.persons]) {
      if (p && typeof p === 'object' && !Array.isArray(p) && typeof p.who === 'string') {
        if (p.state === 'alive' && (!p.carry || typeof p.carry !== 'object' || Array.isArray(p.carry))) { p.carry = {}; this.touch(p); notes.push(`${who}: inventory reset (it wasn't readable)`); }
        continue;
      }
      this.persons.delete(who);
      await this.put(`bad:p:${who}`, p);
      await this.ctx.storage.delete(`p:${who}`);
      notes.push(`${who}: not a readable person, set aside as bad:p:${who}`);
    }
    const w = this.world;
    if (w && typeof w === 'object') {
      let fixed = false;
      for (const k of ['items', 'bushes', 'graves']) if (!Array.isArray(w[k])) { w[k] = []; fixed = true; notes.push(`world.${k} was missing`); }
      if (fixed) await this.save();
    } else if (w != null) { this.world = null; notes.push('the world was not readable, so a new one will be made'); }
    if (notes.length) await this.noteError('reading saved data', new Error(notes.join('; ')));
    return notes;
  },
};
