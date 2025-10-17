import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';
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
  sale_price?: number | null;
  current_value?: number | null;
  is_for_sale?: boolean | null;
  uploaded_by?: string;
  profiles?: any;
}

type ViewMode = 'gallery' | 'compact' | 'technical';

const VehiclesPanel: React.FC<VehiclesPanelProps> = ({ orgId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [memberCount, setMemberCount] = useState(0);
  const [weeklyAdditions, setWeeklyAdditions] = useState(0);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load vehicles with extended data
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin, created_at, sale_price, current_value, is_for_sale, uploaded_by, profiles(username, full_name)')
        .eq('owner_shop_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setVehicles((data as VehicleRow[]) || []);
      
      // Get member count
      const { count: memCount } = await supabase
        .from('shop_members')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', orgId);
      setMemberCount(memCount || 0);
      
      // Get weekly additions (vehicles added in the last 7 days)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const { count: weekCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('owner_shop_id', orgId)
        .gte('created_at', oneWeekAgo.toISOString());
      setWeeklyAdditions(weekCount || 0);
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

  const getUserDisplay = (vehicle: VehicleRow) => {
    if (vehicle.profiles?.full_name) return vehicle.profiles.full_name;
    if (vehicle.profiles?.username) return vehicle.profiles.username;
    return 'Unknown';
  };

  if (loading) return <div className="text text-small text-muted">Loading vehicles…</div>;
  if (error) return <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>;
  
  return (
    <div className="space-y-2">
      {/* Stats Header Card */}
      <div className="card">
        <div className="card-body" style={{ padding: '6px 8px' }}>
          <div className="flex items-center justify-between">
            <div className="text-small text-muted">
              {vehicles.length} vehicles • {memberCount} members • {weeklyAdditions} added this week
            </div>
            <div className="flex items-center" style={{ gap: '2px' }}>
              <button
                className={`button ${viewMode === 'gallery' ? 'button-primary' : 'button-secondary'}`}
                onClick={() => setViewMode('gallery')}
                title="Gallery"
                style={{ padding: '3px 6px', fontSize: '8pt', minWidth: '24px', height: '20px' }}
              >
                Gallery
              </button>
              <button
                className={`button ${viewMode === 'compact' ? 'button-primary' : 'button-secondary'}`}
                onClick={() => setViewMode('compact')}
                title="Compact"
                style={{ padding: '3px 6px', fontSize: '8pt', minWidth: '24px', height: '20px' }}
              >
                Compact
              </button>
              <button
                className={`button ${viewMode === 'technical' ? 'button-primary' : 'button-secondary'}`}
                onClick={() => setViewMode('technical')}
                title="Technical"
                style={{ padding: '3px 6px', fontSize: '8pt', minWidth: '24px', height: '20px' }}
              >
                Technical
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="card">
        <div className="card-body" style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          <input className="form-input" placeholder="Search VIN / make / model" value={query} onChange={e=>setQuery(e.target.value)} />
          <button className="button button-small" onClick={search} disabled={busy}>Search</button>
          <button className="button button-small" onClick={()=>{ if (query) window.location.href = `/add-vehicle?vin=${encodeURIComponent(query)}`; }} disabled={!query}>Add by VIN</button>
        </div>
      </div>

      {/* Search Results */}
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

      {/* Vehicles Display */}
      {vehicles.length === 0 ? (
        <div className="text text-small text-muted">No vehicles linked to this organization.</div>
      ) : (
        <>
          {/* Gallery View - Large thumbnails with minimal info */}
          {viewMode === 'gallery' && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8 }}>
              {vehicles.map(v => (
                <Link key={v.id} to={`/vehicle/${v.id}`} className="card" style={{ textDecoration: 'none' }}>
                  <VehicleThumbnail vehicleId={v.id} />
                  <div className="card-body" style={{ padding: '6px 8px' }}>
                    <div className="text text-small text-bold">
                      {v.year} {v.make} {v.model}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Compact View - Medium thumbnails with key info */}
          {viewMode === 'compact' && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:8 }}>
              {vehicles.map(v => (
                <Link key={v.id} to={`/vehicle/${v.id}`} className="card" style={{ textDecoration: 'none' }}>
                  <VehicleThumbnail vehicleId={v.id} />
                  <div className="card-body" style={{ padding: '6px 8px' }}>
                    <div className="text text-small text-bold">
                      {v.year} {v.make} {v.model}
                    </div>
                    <div className="text text-small text-muted" style={{ marginTop: 2 }}>
                      {getUserDisplay(v)}
                    </div>
                    {(v.sale_price || v.current_value) && (
                      <div className="text text-small" style={{ marginTop: 2, color: 'var(--primary)' }}>
                        ${(v.sale_price || v.current_value)?.toLocaleString()}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Technical View - List with all details */}
          {viewMode === 'technical' && (
            <div className="space-y-2">
              {vehicles.map(v => (
                <div key={v.id} className="card">
                  <div className="card-body" style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ width: 120, flexShrink: 0 }}>
                        <Link to={`/vehicle/${v.id}`}>
                          <VehicleThumbnail vehicleId={v.id} />
                        </Link>
                      </div>
                      <div style={{ flex: 1 }}>
                        <Link to={`/vehicle/${v.id}`} className="text text-bold" style={{ textDecoration: 'none' }}>
                          {v.year} {v.make} {v.model}
                        </Link>
                        <div className="text text-small text-muted" style={{ marginTop: 4 }}>
                          VIN: {v.vin || 'Not provided'}
                        </div>
                        <div className="text text-small text-muted" style={{ marginTop: 2 }}>
                          Owner: {getUserDisplay(v)}
                        </div>
                        {(v.sale_price || v.current_value) && (
                          <div className="text text-small" style={{ marginTop: 4, color: 'var(--primary)', fontWeight: 'bold' }}>
                            ${(v.sale_price || v.current_value)?.toLocaleString()}
                            {v.is_for_sale && <span className="text-muted"> • For Sale</span>}
                          </div>
                        )}
                        <div className="text text-small text-muted" style={{ marginTop: 4 }}>
                          Added: {v.created_at ? new Date(v.created_at).toLocaleDateString() : 'Unknown'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VehiclesPanel;
