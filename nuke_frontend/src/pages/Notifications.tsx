import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/unified-design-system.css';

interface NotifRow {
  source: 'user_notifications' | 'notifications' | 'duplicate_notifications';
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  action_url?: string | null;
}

const Notifications: React.FC = () => {
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      if (!user) {
        setRows([]);
        setLoading(false);
        return;
      }
      
      // Load from ALL notification tables
      const [userNotifs, generalNotifs, duplicateNotifs] = await Promise.all([
        supabase
        .from('user_notifications')
        .select('id, type, title, message, is_read, created_at, action_url')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100),
        
        supabase
          .from('notifications')
          .select('id, type, title, message, read, created_at, action_url')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100),
          
        supabase
          .from('duplicate_notifications')
          .select('id, title, message, status, created_at')
          .eq('user_id', user.id)
        .order('created_at', { ascending: false })
          .limit(50)
      ]);
      const failed = [userNotifs, generalNotifs, duplicateNotifs].find(result => result.error);
      if (failed?.error) throw failed.error;
      
      // Combine all notifications
      const combined = [
        ...((userNotifs.data || []).map(n => ({ ...n, source: 'user_notifications' }))),
        ...((generalNotifs.data || []).map(n => ({ ...n, is_read: n.read === true, source: 'notifications' }))),
        ...((duplicateNotifs.data || []).map(n => ({ ...n, is_read: n.status !== 'unread', source: 'duplicate_notifications' })))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setRows(combined as any);
    } catch (e: any) {
      console.error('Failed to load notifications:', e);
      setError(e?.message || 'Failed to load notifications');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (notification: NotifRow) => {
    try {
      if (!userId) return;
      const payload = notification.source === 'notifications' ? { read: true }
        : notification.source === 'duplicate_notifications' ? { status: 'read', read_at: new Date().toISOString() }
        : { is_read: true };
      const { error } = await supabase.from(notification.source).update(payload).eq('id', notification.id).eq('user_id', userId);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(`Failed to mark read: ${e?.message || e}`);
    }
  };

  return (
    <div className="container compact">
        <div className="main">
          <div className="card">
            <div className="card-body">
              {loading && <div className="text text-small text-muted">Loading…</div>}
              {error && <div className="text text-small" style={{ color: 'var(--error)' }}>{error}</div>}
              {!loading && !error && (
                <div className="space-y-2">
                  {rows.length === 0 ? (
                    <div className="text text-small text-muted">No notifications.</div>
                  ) : rows.map(n => (
                    <div key={`${n.source}:${n.id}`} className="card">
                      <div className="card-body" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                        <div>
                          <div className="text text-small" style={{ fontWeight: 600 }}>{n.title || n.type}</div>
                          {n.message && <div className="text text-small text-muted">{n.message}</div>}
                          {n.action_url && (
                            <a href={n.action_url} className="text text-small" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>
                              View &rarr;
                            </a>
                          )}
                          <div className="text text-small text-muted">{new Date(n.created_at).toLocaleString()}</div>
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          {!n.is_read && <button className="button button-small button-secondary" onClick={()=>markRead(n)}>Mark Read</button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  );
};

export default Notifications;
