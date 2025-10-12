import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import '../design-system.css';

interface NotifRow {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const Notifications: React.FC = () => {
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('user_notifications')
        .select('id, type, title, message, is_read, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setRows((data as any[]) || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load notifications');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id: string) => {
    try {
      const { error } = await supabase.from('user_notifications').update({ is_read: true } as any).eq('id', id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(`Failed to mark read: ${e?.message || e}`);
    }
  };

  return (
    <AppLayout title="Notifications">
      <div className="container compact">
        <div className="main">
          <div className="card">
            <div className="card-body">
              {loading && <div className="text text-small text-muted">Loading…</div>}
              {error && <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>}
              {!loading && !error && (
                <div className="space-y-2">
                  {rows.length === 0 ? (
                    <div className="text text-small text-muted">No notifications.</div>
                  ) : rows.map(n => (
                    <div key={n.id} className="card">
                      <div className="card-body" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                        <div>
                          <div className="text text-small" style={{ fontWeight: 600 }}>{n.title || n.type}</div>
                          {n.message && <div className="text text-small text-muted">{n.message}</div>}
                          <div className="text text-small text-muted">{new Date(n.created_at).toLocaleString()}</div>
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          {!n.is_read && <button className="button button-small button-secondary" onClick={()=>markRead(n.id)}>Mark Read</button>}
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
    </AppLayout>
  );
};

export default Notifications;


