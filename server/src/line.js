// The line: at most MAX_PLAYING people play at once; anyone else watches from the main menu and is called in when a spot opens.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { MAX_PLAYING, TURN_MS } from './shared.js';

export const lineMethods = {
  line() { return this.sockets().filter(({ p }) => p.watch && p.queued).sort((a, b) => a.p.queued - b.p.queued); },
  placeOf(ws) { return this.line().findIndex((s) => s.ws === ws) + 1; },
  // can this connection play now? Only if there's a free spot that nobody ahead of them in the line is waiting for
  mayPlay(ws, me, who) {
    const spots = MAX_PLAYING - this.playing(who); // (the same person reconnecting doesn't count twice)
    if (spots <= 0) return false;
    const ahead = this.line().filter((s) => s.ws !== ws && (!me.queued || s.p.queued < me.queued)).length;
    return ahead < spots;
  },
  // tell everyone waiting where they are; those at the front whose spot is free are asked to come in
  callLine() {
    const now = Date.now(), free = Math.max(0, MAX_PLAYING - this.playing());
    let spots = free;
    for (const [i, s] of this.line().entries()) {
      if (spots > 0) {
        spots -= 1;
        if (!s.p.turnAt) { s.p.turnAt = now; s.ws.serializeAttachment(s.p); }
        if (now - s.p.turnAt > TURN_MS) { s.p.queued = 0; s.ws.serializeAttachment(s.p); try { s.ws.send(JSON.stringify({ t: 'line', place: 0, missed: true })); } catch (err) { /* gone */ } continue; } // didn't come: out of the line
        try { s.ws.send(JSON.stringify({ t: 'turn' })); } catch (err) { /* gone */ }
      } else {
        try { s.ws.send(JSON.stringify({ t: 'line', place: i + 1 - free })); } catch (err) { /* gone */ }
      }
    }
  },
};
