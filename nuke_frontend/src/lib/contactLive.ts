/**
 * Live contact signals (migration 20261020195500_contact_live_signal): a private Realtime broadcast to
 * contact_inbox:<your user id> whenever a contact request of yours is created, answered or gets a message. The
 * broadcast carries only {request_id, kind}; it is a cue to refetch through the readers (my_contact_requests,
 * contact_thread_read), never data. The server admits a signed-in user to their own topic only.
 *
 * One channel per user however many views listen (the /messages page, a thread, a header indicator). The channel
 * closes while the tab is hidden and reopens when it is shown, with a `resync` signal so listeners catch up on what
 * they missed. If Realtime cannot connect, listeners get a `resync` every POLL_MS while the tab is visible instead.
 */
import { supabase } from './supabase';

export type ContactSignalKind = 'request' | 'status' | 'message' | 'resync';
export type ContactSignal = { kind: ContactSignalKind; requestId: string | null };
export type ContactListener = (signal: ContactSignal) => void;

export const POLL_MS = 15_000;
const KINDS = new Set<ContactSignalKind>(['request', 'status', 'message']);
const FAILED = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export interface ChannelLike {
  on(type: 'broadcast', filter: { event: string }, callback: (message: { payload?: unknown }) => void): ChannelLike;
  subscribe(callback?: (status: string) => void): unknown;
}

export interface ContactLiveDeps {
  open(topic: string): ChannelLike;
  close(channel: ChannelLike): void;
  hidden(): boolean;
  onVisibilityChange(callback: () => void): () => void;
  every(ms: number, callback: () => void): () => void;
}

export function parseContactSignal(payload: unknown): ContactSignal {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const kind = typeof p.kind === 'string' && KINDS.has(p.kind as ContactSignalKind) ? p.kind as ContactSignalKind : 'resync';
  const requestId = typeof p.request_id === 'string' && p.request_id ? p.request_id : null;
  return { kind, requestId };
}

export function contactInboxTopic(userId: string): string {
  return `contact_inbox:${userId}`;
}

export function createContactLive(deps: ContactLiveDeps) {
  type Hub = { listeners: Set<ContactListener>; channel: ChannelLike | null; stopPoll: (() => void) | null; stopVisibility: () => void };
  const hubs = new Map<string, Hub>();

  const emit = (hub: Hub, signal: ContactSignal) => { for (const l of [...hub.listeners]) l(signal); };

  const startPoll = (hub: Hub) => {
    if (hub.stopPoll) return;
    hub.stopPoll = deps.every(POLL_MS, () => { if (!deps.hidden()) emit(hub, { kind: 'resync', requestId: null }); });
  };
  const stopPoll = (hub: Hub) => { hub.stopPoll?.(); hub.stopPoll = null; };

  const open = (userId: string, hub: Hub) => {
    if (hub.channel || deps.hidden()) return;
    const channel = deps.open(contactInboxTopic(userId));
    hub.channel = channel;
    channel.on('broadcast', { event: 'contact' }, m => { if (hub.channel === channel) emit(hub, parseContactSignal(m.payload)); })
      .subscribe(status => {
        if (hub.channel !== channel) return;
        if (status === 'SUBSCRIBED') stopPoll(hub);
        else if (FAILED.has(status)) startPoll(hub);
      });
  };
  const close = (hub: Hub) => {
    const channel = hub.channel;
    hub.channel = null;
    stopPoll(hub);
    if (channel) deps.close(channel);
  };

  return function subscribeContactInbox(userId: string, listener: ContactListener): () => void {
    let hub = hubs.get(userId);
    if (!hub) {
      const created: Hub = { listeners: new Set(), channel: null, stopPoll: null, stopVisibility: () => {} };
      created.stopVisibility = deps.onVisibilityChange(() => {
        if (deps.hidden()) { close(created); return; }
        open(userId, created);
        emit(created, { kind: 'resync', requestId: null });
      });
      hubs.set(userId, created);
      hub = created;
    }
    hub.listeners.add(listener);
    open(userId, hub);
    const own = hub;
    return () => {
      own.listeners.delete(listener);
      if (own.listeners.size > 0) return;
      close(own);
      own.stopVisibility();
      hubs.delete(userId);
    };
  };
}

export const subscribeContactInbox = createContactLive({
  open: topic => supabase.channel(topic, { config: { private: true } }) as unknown as ChannelLike,
  close: channel => { void supabase.removeChannel(channel as never); },
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onVisibilityChange: callback => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
  },
  every: (ms, callback) => { const id = window.setInterval(callback, ms); return () => window.clearInterval(id); },
});
