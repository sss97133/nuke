import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface LinkRequestsPanelProps {
  shopId: string;
}

const LinkRequestsPanel: React.FC<LinkRequestsPanelProps> = ({ shopId }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('vehicle_link_requests')
        .select('id, vehicle_id, requested_by, note, created_at')
        .eq('shop_id', shopId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setRows((data as any[]) || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [shopId]);

  const decide = async (id: string, approve: boolean, vehicleId: string) => {
    try {
      if (approve) {
        const { error: upErr } = await supabase.from('vehicles').update({ owner_shop_id: shopId } as any).eq('id', vehicleId);
        if (upErr) throw upErr;
      }
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      const { error } = await supabase
        .from('vehicle_link_requests')
        .update({ status: approve ? 'approved' : 'denied', decided_by: uid || null, decided_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(e?.message || e);
    }
  };

  return (
    <div className="card">
      <div className="card-header">Link Requests</div>
      <div className="card-body">
        {loading && <div className="text text-small text-muted">Loading…</div>}
        {error && <div className="text text-small" style={{ color:'#b91c1c' }}>{error}</div>}
        {!loading && !error && (
          rows.length === 0 ? <div className="text text-small text-muted">No pending requests</div> : (
            <div className="space-y-1">
              {rows.map(r => (
                <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div className="text text-small">Vehicle {r.vehicle_id} — requested by {r.requested_by}{r.note ? ` — ${r.note}` : ''}</div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="button button-small" onClick={()=>decide(r.id, true, r.vehicle_id)}>Approve</button>
                    <button className="button button-small button-secondary" onClick={()=>decide(r.id, false, r.vehicle_id)}>Deny</button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default LinkRequestsPanel;


