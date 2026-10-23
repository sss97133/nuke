import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Poll bounded source metadata, not the transaction history. RLS applies to both reviewers. */
export function useAccountingRevision(ownerId: string) {
  const [state, setState] = useState({ revision: '', message: 'Connecting to shared ledger…' });
  useEffect(() => {
    let cancelled = false, busy = false, previous = '';
    setState({ revision: '', message: ownerId ? 'Connecting to shared ledger…' : 'Sign in to view your ledger.' });
    const check = async () => {
      if (!ownerId || cancelled || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const result = await supabase.from('financial_documents').select('id, updated_at').eq('owner_id', ownerId).order('id').limit(1000);
        if (cancelled) return;
        if (result.error || !Array.isArray(result.data) || result.data.length >= 1000) throw new Error('sync');
        const revision = JSON.stringify(result.data);
        if (revision !== previous) { previous = revision; setState({ revision, message: 'Live ledger · checks for changes every 5 seconds' }); }
        else setState(current => ({ ...current, message: 'Live ledger · checks for changes every 5 seconds' }));
      } catch { if (!cancelled) setState(current => ({ ...current, message: 'Live updates unavailable. Refresh before editing.' })); }
      finally { busy = false; }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 5000);
    const focus = () => { void check(); };
    window.addEventListener('focus', focus); window.addEventListener('accounting-saved', focus); document.addEventListener('visibilitychange', focus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('accounting-saved', focus); document.removeEventListener('visibilitychange', focus); };
  }, [ownerId]);
  return state;
}
