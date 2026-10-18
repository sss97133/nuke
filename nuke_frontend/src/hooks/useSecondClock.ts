import { useSyncExternalStore } from 'react';

// One 1-second clock for every live countdown on a page: a single interval, started by the first subscriber and
// stopped when the last one leaves, so a board of 1,000 rows ticks on one timer, not 1,000.

let now = Date.now();
let timer: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer == null) {
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

const idle = () => () => {};
const read = () => now;

// Epoch ms, re-rendering the caller every second. `enabled = false` keeps the caller off the clock.
export function useSecondClock(enabled = true): number {
  return useSyncExternalStore(enabled ? subscribe : idle, read, read);
}

// Time to close: seconds under 24 h ("2h 19m 04s", "7m 03s"), days and hours beyond ("3d 4h").
export function timeLeft(ms: number): string {
  if (ms <= 0) return 'ENDED';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s % 60)}s`;
  return `${m}m ${pad(s % 60)}s`;
}
