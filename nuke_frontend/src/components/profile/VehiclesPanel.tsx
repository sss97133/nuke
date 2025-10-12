import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface VehiclesPanelProps {
  orgId: string;
}

interface VehicleRow {
  id: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  created_at?: string;
}

const VehiclesPanel: React.FC<VehiclesPanelProps> = ({ orgId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin, created_at')
        .eq('owner_shop_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setVehicles((data as VehicleRow[]) || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load vehicles');
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId]);

  useEffect(() => {
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) { setIsAdmin(false); return; }
        const { data: prof } = await supabase.from('profiles').select('user_type').eq('id', uid).single();
        setIsAdmin(!!prof && ['admin','moderator'].includes((prof as any).user_type));
      } catch { setIsAdmin(false); }
    })();
  }, []);

  const search = async () => {
    try {
      setBusy(true);
      setError(null);
      const q = query.trim();
      if (!q) { setResults([]); return; }
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin, created_at')
        .or(`vin.ilike.%${q}%,make.ilike.%${q}%,model.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setResults((data as VehicleRow[]) || []);
    } catch (e: any) {
      setResults([]);
      setError(e?.message || 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const linkToOrg = async (vehicleId: string) => {
    try {
      setBusy(true);
      const { error } = await supabase.from('vehicles').update({ owner_shop_id: orgId } as any).eq('id', vehicleId);
      if (error) throw error;
      await load();
      setResults([]);
      setQuery('');
    } catch (e: any) {
      alert(`Link failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const requestLink = async (vehicleId: string) => {
    try {
      const note = window.prompt('Add a note (optional)');
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { alert('Sign in required'); return; }
      const { error } = await supabase.from('vehicle_link_requests').insert({ vehicle_id: vehicleId, shop_id: orgId, requested_by: uid, note } as any);
      if (error) throw error;
      alert('Link request submitted');
    } catch (e: any) {
      alert(`Request failed: ${e?.message || e}`);
    }
  };

  if (loading) return <div className="text text-small text-muted">Loading vehicles…</div>;
  if (error) return <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>;
  return (
    <div className="space-y-2">
      <div className="card">
        <div className="card-body" style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          <input className="form-input" placeholder="Search VIN / make / model" value={query} onChange={e=>setQuery(e.target.value)} />
          <button className="button button-small" onClick={search} disabled={busy}>Search</button>
          <button className="button button-small" onClick={()=>{ if (query) window.location.href = `/add-vehicle?vin=${encodeURIComponent(query)}`; }} disabled={!query}>Add by VIN</button>
        </div>
      </div>
      {results.length > 0 && (
        <div className="card">
          <div className="card-body">
            <div className="text text-small text-muted" style={{ marginBottom:6 }}>Search results</div>
            <div className="space-y-1">
              {results.map(r => (
                <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div className="text text-small">{r.year || ''} {r.make || ''} {r.model || ''} — {r.vin}</div>
                  <div style={{ display:'flex', gap:6 }}>
                    {isAdmin ? (
                      <button className="button button-small" onClick={()=>linkToOrg(r.id)} disabled={busy}>Link to org</button>
                    ) : (
                      <button className="button button-small" title="Sends a request to org admins" onClick={()=>requestLink(r.id)} disabled={busy}>Request link</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {vehicles.length === 0 ? (
        <div className="text text-small text-muted">No vehicles linked to this organization.</div>
      ) : (
        <div className="grid" style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:8 }}>
          {vehicles.map(v => (
            <div key={v.id} className="card">
              <div className="card-body">
                <div className="text text-small text-bold">{v.year || ''} {v.make || ''} {v.model || ''}</div>
                <div className="text text-small text-muted">{v.vin}</div>
                <div className="text text-small" style={{ marginTop: 6 }}>
                  <a href={`/vehicle/${v.id}`}>View profile</a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehiclesPanel;
