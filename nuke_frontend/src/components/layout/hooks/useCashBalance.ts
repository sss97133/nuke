import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

export interface CashBalance {
  available_cents: number;
  pending_cents: number;
}

export function useCashBalance(userId: string | undefined) {
  const [balance, setBalance] = useState<CashBalance | null>(null);

  useEffect(() => {
    if (!userId) { setBalance(null); return; }

    // Defer balance load to avoid blocking first paint
    const timer = setTimeout(() => loadBalance(userId), 100);

    const channel = supabase
      .channel(`balance:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_cash_balances',
        filter: `user_id=eq.${userId}`
      }, () => loadBalance(userId))
      .subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const loadBalance = async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('user_cash_balances')
        .select('available_cents, reserved_cents')
        .eq('user_id', uid)
        .maybeSingle();

      if (error) {
        setBalance({ available_cents: 0, pending_cents: 0 });
        return;
      }

      setBalance({
        available_cents: data?.available_cents ?? 0,
        pending_cents: data?.reserved_cents ?? 0
      });
    } catch {
      setBalance({ available_cents: 0, pending_cents: 0 });
    }
  };

  return balance;
}
