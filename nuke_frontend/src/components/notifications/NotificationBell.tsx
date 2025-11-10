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
        // Count unread from ALL notification tables
        const [userNotifs, generalNotifs, duplicateNotifs] = await Promise.all([
          supabase
          .from('user_notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
            .eq('is_read', false),
          supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'unread'),
          supabase
            .from('duplicate_notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'unread')
        ]);
        
        const totalUnread = (userNotifs.count || 0) + (generalNotifs.count || 0) + (duplicateNotifs.count || 0);
        if (mounted) setCount(totalUnread);

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
    <button 
      onClick={() => navigate('/notifications')} 
      title="Notifications"
      className="relative p-2 hover:bg-gray-100 rounded transition-colors"
    >
      {/* Simple red dot, no bell icon bullshit */}
      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
};

export default NotificationBell;