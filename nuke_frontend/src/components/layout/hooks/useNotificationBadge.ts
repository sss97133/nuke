import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

export function useNotificationBadge(userId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!userId) { setUnreadCount(0); return; }

    // Defer initial load to avoid blocking first paint
    const timer = setTimeout(() => loadCount(userId), 100);

    const channel = supabase
      .channel(`notification_badge:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
        () => loadCount(userId)
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const loadCount = async (uid: string) => {
    try {
      const { data, error } = await supabase.rpc('get_unread_notification_count', { p_user_id: uid });
      if (error) throw error;
      setUnreadCount(data || 0);
    } catch {
      setUnreadCount(0);
    }
  };

  return unreadCount;
}
