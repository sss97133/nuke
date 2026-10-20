import { useEffect, useRef } from 'react';
import { subscribeContactInbox, type ContactSignal } from '../lib/contactLive';

/**
 * Calls onSignals with the contact signals for this user (see lib/contactLive), batched: a burst within delayMs
 * (a reply that also changes a count, several tabs) becomes one refetch. Nothing happens without a signed-in user.
 */
export function useContactLive(userId: string | null | undefined, onSignals: (signals: ContactSignal[]) => void, delayMs = 250) {
  const callback = useRef(onSignals);
  callback.current = onSignals;
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: ContactSignal[] = [];
    const unsubscribe = subscribeContactInbox(userId, signal => {
      pending.push(signal);
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = pending;
        pending = [];
        callback.current(batch);
      }, delayMs);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [userId, delayMs]);
}
