import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

interface BettingWallet {
  balance: number;
  total_deposited: number;
  total_wagered: number;
  total_won: number;
}

export function useBettingWallet() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchWallet = useCallback(async () => {
    if (!user) {
      setBalance(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('betting-deposit', {
        body: { action: 'get_wallet' },
      });

      if (!error && data?.wallet) {
        setBalance(data.wallet.balance ?? 0);
      }
    } catch {
      // Silent failure - wallet will show 0
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  return { balance, loading, refetch: fetchWallet };
}
