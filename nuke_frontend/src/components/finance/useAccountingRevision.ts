import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const POLL_MS = 5000, HEARTBEAT_MS = 60000;
const LIVE = 'Live ledger · updates arrive as they happen';
const POLLING = 'Live ledger · checks for changes every 5 seconds';
const OFFLINE = 'Live updates unavailable. Refresh before editing.';

/** A book's revision is how many source documents it holds and when one last changed: every admitted run touches
 *  financial_documents.updated_at (trg_fdoc_touch) and originals are never deleted, so count + latest change is a
 *  complete signature that costs two index reads whatever the book's size. Realtime delivers changes as they land;
 *  polling is the fallback and, once subscribed, a heartbeat. RLS applies to the subscription and to both reads. */
export function useAccountingRevision(ownerId: string) {
  const [state, setState] = useState({ revision: '', message: 'Connecting to shared ledger…' });
  useEffect(() => {
    let cancelled = false, busy = false, previous = '', live = false;
    setState({ revision: '', message: ownerId ? 'Connecting to shared ledger…' : 'Sign in to view your ledger.' });
    if (!ownerId) return;
    const check = async () => {
      if (cancelled || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const [latest, total] = await Promise.all([
          supabase.from('financial_documents').select('updated_at').eq('owner_id', ownerId).order('updated_at', { ascending: false }).limit(1),
          supabase.from('financial_documents').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId),
        ]);
        if (cancelled) return;
        if (latest.error || total.error || !Array.isArray(latest.data) || !Number.isSafeInteger(total.count)) throw new Error('sync');
        const revision = `${total.count}:${latest.data[0]?.updated_at ?? ''}`;
        const message = live ? LIVE : POLLING;
        if (revision !== previous) { previous = revision; setState({ revision, message }); }
        else setState(current => ({ ...current, message }));
      } catch { if (!cancelled) setState(current => ({ ...current, message: OFFLINE })); }
      finally { busy = false; }
    };
    void check();
    let timer = window.setInterval(() => { void check(); }, POLL_MS);
    const channel = supabase.channel(`accounting:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_documents', filter: `owner_id=eq.${ownerId}` }, () => { void check(); })
      .subscribe((status: string) => {
        if (cancelled) return;
        const next = status === 'SUBSCRIBED';
        if (next === live) return;
        live = next; window.clearInterval(timer); timer = window.setInterval(() => { void check(); }, live ? HEARTBEAT_MS : POLL_MS);
        void check();
      });
    const focus = () => { void check(); };
    window.addEventListener('focus', focus); window.addEventListener('accounting-saved', focus); document.addEventListener('visibilitychange', focus);
    return () => {
      cancelled = true; window.clearInterval(timer); void supabase.removeChannel(channel);
      window.removeEventListener('focus', focus); window.removeEventListener('accounting-saved', focus); document.removeEventListener('visibilitychange', focus);
    };
  }, [ownerId]);
  return state;
}
