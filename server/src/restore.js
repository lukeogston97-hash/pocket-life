// Restore (0.3.2, Luke 23 Nov 2026): the admin puts the whole world back to how it was at an earlier time, for when an
// update goes wrong or something is reset by mistake. It uses Cloudflare's point-in-time recovery, which keeps the last
// 30 days of this Durable Object's storage, so everything goes back together: the land, every person and their bag,
// claims, the Inbox, bans, maintenance and live settings. The world then restarts into the restored copy (ctx.abort),
// and every game reconnects by itself a moment later. The admin's phone is sent an undo point (the moment just before
// the restore), so a wrong pick can be put back with Undo. There's no history on a computer running the server for tests,
// so tools/tests/server.mjs keeps its own. These are methods of the World (index.js adds them to it), so `this` is the world.
import { HOUR, MINUTE, clean } from './shared.js';

export const RESTORE_DAYS = 30; // how far back Cloudflare keeps the world's history
const RESTART_MS = 1500; // the messages go out first, then the world restarts into the restored copy

export const restoreMethods = {
  // m.at: the time to go back to (ms since 1970), or m.undo: the undo point the admin's phone kept from the last restore
  async restore(me, m, reply) {
    const done = (text) => reply({ t: 'adminDone', text, ...this.adminState(me) });
    if (this.restoring) return done('Already restoring, back in a moment');
    const now = Date.now(), undoing = m.undo != null, to = Math.floor(Number(m.at));
    let mark;
    if (undoing) {
      mark = clean(m.undo, 300);
      if (!mark) return done('Nothing to undo');
    } else {
      if (!Number.isFinite(to) || to > now - 5000) return done('Pick a time in the past');
      if (to < now - RESTORE_DAYS * 24 * HOUR + MINUTE) return done(`Only the last ${RESTORE_DAYS} days can be restored`);
    }
    let undo;
    try {
      if (!undoing) mark = await this.ctx.storage.getBookmarkForTime(to);
      undo = await this.ctx.storage.onNextSessionRestoreBookmark(mark); // takes effect when the world restarts
    } catch (err) { // (nothing was changed)
      await this.noteError('restoring the world', err);
      return done("Couldn't restore, nothing changed. The Inbox has the details");
    }
    this.restoring = true; // from now on nothing else is done (it would be lost anyway): index.js
    reply({ t: 'adminRestore', ...(undoing ? { undone: true } : { undo, to, at: now }) });
    this.send({ t: 'restoring', text: undoing ? 'Undoing the restore. Back in a moment.' : 'The world is going back to an earlier time. Back in a moment.' }, null);
    setTimeout(() => this.ctx.abort('restoring the world'), RESTART_MS);
  },
};
