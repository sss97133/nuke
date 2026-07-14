/**
 * modeSchedule — the trigger layer for automatic mode switching.
 *
 * The silent-phone lesson (Skylar's geofence-thinks-I'm-always-at-work parable):
 * an invisible inference that silently reshapes what reaches you is the nightmare
 * even when the outcome is pleasant. So automation here has THREE levels, never
 * just on/off:
 *
 *   'off'     — schedules ignored; manual switching only.
 *   'suggest' — when the clock enters a mode's window, PROPOSE it (one-tap);
 *               the user always makes the final flip. (default)
 *   'auto'    — full Focus behavior: apply silently, but with a visible, always-
 *               reversible indicator. Opt-in, knowingly, like setting up a Focus.
 *
 * Schedules live in localStorage for the prototype (they're user prefs, not
 * substrate) keyed by the mode's subjectId. No new DB table for zero users.
 *
 * Runtime app code, so `new Date()` is fine here (unlike workflow scripts).
 */

export type AutoMode = 'off' | 'suggest' | 'auto';

export interface ModeWindow {
  /** Days of week this window applies, 0=Sun..6=Sat. */
  days: number[];
  /** "HH:MM" local. */
  start: string;
  /** "HH:MM" local. end < start wraps past midnight. */
  end: string;
}

const AUTO_KEY = 'nuke:modeAuto';
const SCHED_KEY = 'nuke:modeSchedules';

export function getAutoMode(): AutoMode {
  const v = localStorage.getItem(AUTO_KEY);
  return v === 'suggest' || v === 'auto' || v === 'off' ? v : 'suggest';
}

export function setAutoMode(v: AutoMode) {
  localStorage.setItem(AUTO_KEY, v);
}

export function getSchedules(): Record<string, ModeWindow> {
  try {
    const raw = localStorage.getItem(SCHED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setSchedule(subjectId: string, window: ModeWindow | null) {
  const all = getSchedules();
  if (window === null) delete all[subjectId];
  else all[subjectId] = window;
  localStorage.setItem(SCHED_KEY, JSON.stringify(all));
}

function parseHHMM(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function windowActiveAt(w: ModeWindow, now: Date): boolean {
  const start = parseHHMM(w.start);
  const end = parseHHMM(w.end);
  if (start === null || end === null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  const prevDay = (day + 6) % 7;

  if (start < end) {
    // Same-day window: must be the right day AND in range.
    return w.days.includes(day) && cur >= start && cur < end;
  }
  // Wraps midnight: either today-after-start (today is a listed day),
  // or before-end where the window opened yesterday (yesterday listed).
  if (w.days.includes(day) && cur >= start) return true;
  if (w.days.includes(prevDay) && cur < end) return true;
  return false;
}

/**
 * Which mode subjectId should be active right now, given the user's schedules.
 * `order` is the candidate subjectIds in priority order (first match wins).
 * Returns null if nothing is scheduled for now.
 */
export function suggestedSubjectId(order: string[], now: Date = new Date()): string | null {
  const schedules = getSchedules();
  for (const id of order) {
    const w = schedules[id];
    if (w && windowActiveAt(w, now)) return id;
  }
  return null;
}

/** ms until the next schedule boundary (any start/end of any window), capped. */
export function msUntilNextBoundary(now: Date = new Date()): number {
  const schedules = Object.values(getSchedules());
  if (schedules.length === 0) return 15 * 60 * 1000;
  const cur = now.getHours() * 60 + now.getMinutes();
  let soonest = 24 * 60;
  for (const w of schedules) {
    for (const t of [parseHHMM(w.start), parseHHMM(w.end)]) {
      if (t === null) continue;
      const delta = t > cur ? t - cur : t + 24 * 60 - cur;
      if (delta < soonest) soonest = delta;
    }
  }
  // +1 min cushion so we evaluate just AFTER the boundary, not on it.
  return Math.max(60_000, (soonest + 1) * 60_000);
}
