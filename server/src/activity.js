// The activity log (built with admin mode): a short list of what happened in the world and what the admin did, for the
// admin's Log tab. Lines are rare by design (a new person, a death, someone back after a while, a claim, an admin tool,
// wrong admin passwords), never one per ordinary action, so it costs a handful of storage writes a day. Only the newest
// LOG_KEEP lines are kept, all under one key ('activity'). The same line again within a few minutes is counted, not
// repeated. Reset everything empties it; a Restore puts it back to how it was then, like everything else.
// These are methods of the World (index.js adds them to it), so `this` is the world.
import { MINUTE, HOUR } from './shared.js';

const LOG_KEEP = 200, TEXT_MAX = 160, SAME_WITHIN = 10 * MINUTE;
export const BACK_AFTER = 10 * MINUTE; // someone back after at least this long away gets a line (a short break in the connection doesn't)
// 5400000 -> '1 h 30 m', 200000000 -> '2 days'
export function longText(ms) {
  const m = Math.max(1, Math.round(ms / MINUTE)), h = Math.floor(m / 60), d = Math.round(ms / (24 * HOUR));
  if (ms >= 36 * HOUR) return `${d} days`;
  return h && m % 60 ? `${h} h ${m % 60} m` : h ? `${h} h` : `${m} m`;
}

export const activityMethods = {
  // add a line. kind: 'world' (something happened to someone), 'admin' (a tool was used) or 'guard' (something was refused)
  note(kind, text) {
    if (!this.activity) this.activity = [];
    const now = Date.now(), line = String(text).slice(0, TEXT_MAX), last = this.activity[this.activity.length - 1];
    const again = !!last && last.kind === kind && last.text === line && now - last.at < SAME_WITHIN;
    if (again) { last.n = (last.n || 1) + 1; last.at = now; }
    else this.activity.push({ at: now, kind, text: line });
    if (this.activity.length > LOG_KEEP) this.activity.splice(0, this.activity.length - LOG_KEEP);
    if (this.activityQueued || (again && now - (this.activitySavedAt || 0) < MINUTE)) return; // (a line repeated over and over, like wrong passwords, is saved once a minute at most)
    this.activitySavedAt = now;
    this.activityQueued = true; // several lines at once (a tick, a reset) are one write
    queueMicrotask(() => { this.activityQueued = false; Promise.resolve(this.put('activity', this.activity)).catch(() => { /* the next line saves it */ }); });
  },
  activityView() { return { t: 'adminLog', list: [...(this.activity || [])].reverse() }; }, // newest first
};
