import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

export function useAdminStatus(userId: string | undefined) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) { setIsAdmin(false); return; }

    // Defer admin check — not needed for first paint
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('admin_users')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .single();
        setIsAdmin(!error && !!data);
      } catch {
        setIsAdmin(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [userId]);

  return isAdmin;
}
