import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { createContactLive, parseContactSignal, POLL_MS, type ChannelLike, type ContactSignal } from './contactLive';

function harness() {
  const channels: { topic: string; closed: boolean; push: (payload: unknown) => void; status: (s: string) => void }[] = [];
  let visibility: (() => void) | null = null;
  let hidden = false;
  const polls: { ms: number; fn: () => void; stopped: boolean }[] = [];
  const live = createContactLive({
    open: topic => {
      const c: (typeof channels)[number] = { topic, closed: false, push: () => {}, status: () => {} };
      channels.push(c);
      const ch: ChannelLike = {
        on: (_type, filter, cb) => { expect(filter).toEqual({ event: 'contact' }); c.push = payload => cb({ payload }); return ch; },
        subscribe: cb => { c.status = s => cb?.(s); return ch; },
      };
      return ch;
    },
    close: () => { const open = channels.filter(c => !c.closed); open[open.length - 1].closed = true; },
    hidden: () => hidden,
    onVisibilityChange: cb => { visibility = cb; return () => { visibility = null; }; },
    every: (ms, fn) => { const p = { ms, fn, stopped: false }; polls.push(p); return () => { p.stopped = true; }; },
  });
  return {
    live, channels, polls,
    setHidden(h: boolean) { hidden = h; visibility?.(); },
    hasVisibilityListener: () => visibility !== null,
  };
}

describe('parseContactSignal', () => {
  it('keeps only kind and request id; anything unexpected becomes a resync', () => {
    expect(parseContactSignal({ request_id: 'r1', kind: 'message', id: 'x', body: 'never' })).toEqual({ kind: 'message', requestId: 'r1' });
    expect(parseContactSignal({ kind: 'delete_everything' })).toEqual({ kind: 'resync', requestId: null });
    expect(parseContactSignal(null)).toEqual({ kind: 'resync', requestId: null });
    expect(parseContactSignal(['message'])).toEqual({ kind: 'resync', requestId: null });
  });
});

describe('createContactLive', () => {
  it('opens one private-topic channel per user however many listeners, and closes it with the last', () => {
    const h = harness();
    const a: ContactSignal[] = [], b: ContactSignal[] = [];
    const offA = h.live('u1', s => a.push(s));
    const offB = h.live('u1', s => b.push(s));
    expect(h.channels.map(c => c.topic)).toEqual(['contact_inbox:u1']);
    h.channels[0].push({ request_id: 'r1', kind: 'message' });
    expect(a).toEqual([{ kind: 'message', requestId: 'r1' }]);
    expect(b).toEqual(a);
    offA();
    expect(h.channels[0].closed).toBe(false);
    offB();
    expect(h.channels[0].closed).toBe(true);
    expect(h.hasVisibilityListener()).toBe(false);
  });

  it('closes while the tab is hidden and reopens with a resync when it returns', () => {
    const h = harness();
    const got: ContactSignal[] = [];
    h.live('u1', s => got.push(s));
    h.setHidden(true);
    expect(h.channels[0].closed).toBe(true);
    h.channels[0].push({ request_id: 'r1', kind: 'message' });
    expect(got).toEqual([]);
    h.setHidden(false);
    expect(h.channels).toHaveLength(2);
    expect(h.channels[1].closed).toBe(false);
    expect(got).toEqual([{ kind: 'resync', requestId: null }]);
  });

  it('does not open a channel for a hidden tab', () => {
    const h = harness();
    h.setHidden(true);
    h.live('u1', () => {});
    expect(h.channels).toHaveLength(0);
  });

  it('falls back to a resync poll while Realtime fails, and stops it once subscribed', () => {
    const h = harness();
    const got: ContactSignal[] = [];
    h.live('u1', s => got.push(s));
    h.channels[0].status('CHANNEL_ERROR');
    expect(h.polls).toHaveLength(1);
    expect(h.polls[0].ms).toBe(POLL_MS);
    h.polls[0].fn();
    expect(got).toEqual([{ kind: 'resync', requestId: null }]);
    h.channels[0].status('TIMED_OUT');
    expect(h.polls).toHaveLength(1);
    h.channels[0].status('SUBSCRIBED');
    expect(h.polls[0].stopped).toBe(true);
  });

  it('ignores a closed channel\'s late messages and statuses', () => {
    const h = harness();
    const got: ContactSignal[] = [];
    h.live('u1', s => got.push(s));
    const first = h.channels[0];
    h.setHidden(true);
    first.status('CLOSED');
    first.push({ request_id: 'r1', kind: 'message' });
    expect(h.polls).toHaveLength(0);
    expect(got).toEqual([]);
  });

  it('keeps users apart', () => {
    const h = harness();
    const a: ContactSignal[] = [];
    h.live('u1', s => a.push(s));
    h.live('u2', () => {});
    expect(h.channels.map(c => c.topic)).toEqual(['contact_inbox:u1', 'contact_inbox:u2']);
    h.channels[1].push({ request_id: 'r9', kind: 'request' });
    expect(a).toEqual([]);
  });
});
