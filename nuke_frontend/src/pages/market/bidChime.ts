// A short synthesized bell for each bid that lands on the live board, pitched by its size (bigger bids ring lower).
// It stays off until the viewer turns it on: browsers let a page play sound only after a gesture.
let ctx: AudioContext | null = null;

/** Called from the viewer's click: opens (or resumes) the audio output. False when the browser has none. */
export function startBidChime(): boolean {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx = ctx ?? new Ctor();
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export function chime(amount: number): void {
  if (!ctx || ctx.state === 'closed') return;
  const t = ctx.currentTime;
  const k = Math.min(1, Math.max(0, (Math.log10(Math.max(1000, amount || 1000)) - 3) / 3));
  const f = 1480 - k * 820;
  for (const [mult, peak, dur] of [[1, 0.16, 0.7], [2.76, 0.035, 0.22], [5.4, 0.012, 0.12]] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

/** Rings one read's new bids in the order they were placed, spread over a few seconds; returns a cancel. */
export function ringBids(bids: readonly { amount: number; bidAt: number }[], spreadMs = 10_000): () => void {
  const list = [...bids].sort((a, b) => a.bidAt - b.bidAt).slice(-16);
  const gap = list.length > 1 ? Math.max(150, spreadMs / list.length) : 0;
  const timers = list.map((b, i) => window.setTimeout(() => chime(b.amount), i * gap));
  return () => timers.forEach((id) => window.clearTimeout(id));
}
