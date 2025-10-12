import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

const NotificationBell: React.FC = () => {
  const [count, setCount] = useState<number>(0);
  const navigate = useNavigate();

  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    let mounted = true;
    let channel: any = null;
    const init = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (mounted) setCount(0); return; }
        userIdRef.current = user.id;
        const { count: unread } = await supabase
          .from('user_notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_read', false);
        if (mounted) setCount(unread || 0);

        // Realtime: new notifications and read updates
        channel = supabase.channel('user-notifications-bell')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, (_payload) => {
            setCount((c) => c + 1);
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, (payload: any) => {
            const before = payload.old as any;
            const after = payload.new as any;
            if (before && after && before.is_read === false && after.is_read === true) {
              setCount((c) => Math.max(0, c - 1));
            }
          })
          .subscribe();
      } catch {
        if (mounted) setCount(0);
      }
    };
    init();
    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <button className="button button-small" onClick={() => navigate('/notifications')} title="Notifications">
      🔔
      {count > 0 && <span className="badge" style={{ marginLeft: 6 }}>{count}</span>}
    </button>
  );
};

export default NotificationBell;