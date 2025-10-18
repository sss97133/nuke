import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface RecentImage {
  id: string;
  vehicle_id?: string;
  image_url: string;
  created_at: string;
}

interface RecentVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  created_at: string;
  msrp?: number | null;
  current_value?: number | null;
  purchase_price?: number | null;
  asking_price?: number | null;
  sale_price?: number | null;
  is_for_sale?: boolean | null;
}

interface RecentEvent {
  id: string;
  vehicle_id?: string;
  title: string | null;
  event_type: string | null;
  created_at: string;
}

interface ActiveShop {
  provider_id: string;
  name?: string;
  sessions: number;
}

interface HotVehicle {
  vehicle_id: string;
  title: string;
  events: number;
}

const to8pt = { fontSize: '8pt' } as const;

const cardHeaderStyle = { ...to8pt, padding: '4px 6px', borderBottom: '1px solid #c0c0c0', background: '#f3f4f6' } as const;
const cardBodyStyle = { padding: '6px' } as const;
const chipStyle = { ...to8pt, background: '#f3f4f6', border: '1px solid #c0c0c0', padding: '2px 4px', borderRadius: '2px' } as const;
const boxStyle = { border: '1px solid #c0c0c0', borderRadius: '2px', cursor: 'pointer' } as const;

// Helpers for pricing display
const formatCurrency = (value?: number | null) => {
  if (typeof value !== 'number') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(value);
};

const getPriceInfo = (v: RecentVehicle) => {
  if (v.is_for_sale && typeof v.asking_price === 'number') return { label: 'ASK', amount: v.asking_price } as const;
  if (typeof v.sale_price === 'number') return { label: 'SOLD', amount: v.sale_price } as const;
  if (typeof v.current_value === 'number') return { label: 'EST', amount: v.current_value } as const;
  if (typeof v.purchase_price === 'number') return { label: 'PAID', amount: v.purchase_price } as const;
  if (typeof v.msrp === 'number') return { label: 'MSRP', amount: v.msrp } as const;
  return { label: null, amount: null } as const;
};

const getDelta = (v: RecentVehicle) => {
  // Prefer comparing current/ask/sold vs purchase; else vs MSRP
  const primary = (typeof v.current_value === 'number' ? v.current_value
                 : typeof v.asking_price === 'number' ? v.asking_price
                 : typeof v.sale_price === 'number' ? v.sale_price
                 : null);
  const anchor = (typeof v.purchase_price === 'number' ? v.purchase_price
                : typeof v.msrp === 'number' ? v.msrp
                : null);
  if (primary == null || anchor == null || anchor === 0) return null;
  const change = primary - anchor;
  const percent = (change / anchor) * 100;
  return { amount: change, percent, isPositive: change >= 0 } as const;
};

const HotVehicleCard = ({ vehicleId, title, events, onClick }: { vehicleId: string; title: string; events: number; onClick: () => void }) => {
  const [imageUrl, setImageUrl] = useState<string>('');

  useEffect(() => {
    supabase
      .from('vehicle_images')
      .select('image_url')
      .eq('vehicle_id', vehicleId)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.image_url) setImageUrl(data.image_url);
      });
  }, [vehicleId]);

  return (
    <div onClick={onClick} style={{ cursor: 'pointer', border: '1px solid #ddd', overflow: 'hidden' }}>
      <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative' }}>
        {imageUrl ? (
          <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '32px' }}>🚗</div>
        )}
        <div style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          background: 'rgba(255,0,0,0.9)',
          color: '#fff',
          padding: '3px 8px',
          fontSize: '9px',
          fontWeight: 'bold',
          borderRadius: '2px'
        }}>
          {events} UPDATES
        </div>
      </div>
      <div style={{ padding: '8px', background: '#fff' }}>
        <div style={{ fontSize: '10px', fontWeight: 'bold' }}>{title}</div>
      </div>
    </div>
  );
};

const DiscoveryHighlights = () => {
  const [images, setImages] = useState<RecentImage[]>([]);
  const [vehicles, setVehicles] = useState<RecentVehicle[]>([]);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [activeShops, setActiveShops] = useState<ActiveShop[]>([]);
  const [hotVehicles, setHotVehicles] = useState<HotVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [signalsById, setSignalsById] = useState<Record<string, any>>({});

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);

        // Base datasets
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const [imgRes, vehRes, evtRes, sessRes] = await Promise.all([
          supabase
            .from('vehicle_images')
            .select('id, vehicle_id, image_url, created_at')
            .order('created_at', { ascending: false })
            .limit(24),
          supabase
            .from('vehicles')
            .select('id, year, make, model, created_at, msrp, current_value, purchase_price, asking_price, sale_price, is_for_sale')
            .order('created_at', { ascending: false })
            .limit(200),
          supabase
            .from('timeline_events')
            .select('id, title, event_type, created_at, vehicle_id')
            .gte('created_at', weekAgo)
            .order('created_at', { ascending: false })
            .limit(400),
          supabase
            .from('vehicle_work_sessions')
            .select('id, service_provider_id, created_at')
            .gte('created_at', monthAgo)
            .order('created_at', { ascending: false })
            .limit(500)
        ]);

        if (!imgRes.error && imgRes.data) setImages(imgRes.data as any);
        if (!vehRes.error && vehRes.data) setVehicles(vehRes.data as any);

        // Try to fetch price signals from materialized view first; fallback to RPC for misses
        try {
          const ids = (vehRes.data as any[] | null)?.map(v => v.id) || [];
          if (ids.length > 0) {
            const have: Record<string, any> = {};
            const { data: cached, error: mvErr } = await supabase
              .from('vehicle_price_signal_view')
              .select('*')
              .in('vehicle_id', ids);
            if (!mvErr && Array.isArray(cached)) {
              (cached as any[]).forEach((s: any) => { if (s?.vehicle_id) have[s.vehicle_id] = s; });
            }
            const missing = ids.filter(id => !have[id]);
            if (missing.length > 0) {
              const { data: fresh, error: rpcErr } = await supabase.rpc('vehicle_price_signal', { vehicle_ids: missing });
              if (!rpcErr && Array.isArray(fresh)) {
                (fresh as any[]).forEach((s: any) => { if (s?.vehicle_id) have[s.vehicle_id] = s; });
              }
            }
            setSignalsById(have);
          }
        } catch (e) {
          console.debug('price signal enrichment skipped in highlights:', e);
        }
        if (!evtRes.error && evtRes.data) setEvents((evtRes.data as any).map((e: any) => ({ id: e.id, vehicle_id: e.vehicle_id, title: e.title, event_type: e.event_type, created_at: e.created_at })));

        // Compute Active Shops (client-side reduce)
        if (!sessRes.error && sessRes.data) {
          const byProvider: Record<string, number> = {};
          (sessRes.data as any[]).forEach(s => {
            if (!s.service_provider_id) return;
            byProvider[s.service_provider_id] = (byProvider[s.service_provider_id] || 0) + 1;
          });
          const topProviders = Object.entries(byProvider)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([provider_id, sessions]) => ({ provider_id, sessions }));

          // Try to resolve provider names from service_providers (best-effort)
          try {
            const ids = topProviders.map(p => p.provider_id);
            if (ids.length > 0) {
              const { data: providers } = await supabase
                .from('service_providers')
                .select('id, full_name')
                .in('id', ids);
              const nameMap: Record<string, string> = {};
              (providers || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });
              setActiveShops(topProviders.map(p => ({ ...p, name: nameMap[p.provider_id] })));
            } else {
              setActiveShops(topProviders);
            }
          } catch {
            setActiveShops(topProviders);
          }
        }

        

        // Compute Hot Vehicles: most events in last 7 days
        if (!evtRes.error && evtRes.data) {
          const eventsData = evtRes.data as any[];
          const byVehicle: Record<string, number> = {};
          eventsData.forEach(e => { if (e.vehicle_id) byVehicle[e.vehicle_id] = (byVehicle[e.vehicle_id] || 0) + 1; });
          const topVehicles = Object.entries(byVehicle)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);
          const ids = topVehicles.map(([id]) => id);
          if (ids.length > 0) {
            const { data: vehs } = await supabase
              .from('vehicles')
              .select('id, year, make, model')
              .in('id', ids);
            const titleMap: Record<string, string> = {};
            (vehs || []).forEach((v: any) => { titleMap[v.id] = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'; });
            setHotVehicles(topVehicles.map(([vehicle_id, events]) => ({ vehicle_id, events, title: titleMap[vehicle_id] || 'Vehicle' })));
          }
        }
      } catch (e) {
        console.debug('Highlights load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const go = (path: string) => { window.location.href = path; };

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: '8px', border: '1px solid #c0c0c0' }}>
        <div className="card-body" style={{ ...cardBodyStyle }}>
          <div className="text text-muted" style={to8pt}>Loading highlights...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Active Shops */}
      {activeShops.length > 0 && (
        <div className="card" style={{ border: '1px solid #c0c0c0' }}>
          <div className="card-header" style={cardHeaderStyle}>Active Shops (last 30 days)</div>
          <div className="card-body" style={cardBodyStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '6px' }}>
              {activeShops.map(s => (
                <div key={s.provider_id} className="text" style={{ ...boxStyle, padding: '6px' }} onClick={() => go(`/browse-professionals?provider_id=${s.provider_id}`)}>
                  <div className="text text-bold" style={to8pt}>{s.name || s.provider_id}</div>
                  <div className="text text-muted" style={to8pt}>{s.sessions} work sessions</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      

      {/* Hot Right Now - WITH IMAGES */}
      {hotVehicles.length > 0 && (
        <div className="card" style={{ border: '1px solid #c0c0c0' }}>
          <div className="card-header" style={cardHeaderStyle}>Hot Right Now</div>
          <div className="card-body" style={cardBodyStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
              {hotVehicles.map(h => (
                <HotVehicleCard 
                  key={h.vehicle_id} 
                  vehicleId={h.vehicle_id}
                  title={h.title}
                  events={h.events}
                  onClick={() => go(`/vehicle/${h.vehicle_id}`)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Images */}
      {images.length > 0 && (
        <div className="card" style={{ border: '1px solid #c0c0c0' }}>
          <div className="card-header" style={cardHeaderStyle}>Recent Images</div>
          <div className="card-body" style={{ ...cardBodyStyle, overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {images.map(img => (
                <div key={img.id} style={{ width: '110px', height: '74px', overflow: 'hidden', ...boxStyle }} onClick={() => go(img.vehicle_id ? `/vehicle/${img.vehicle_id}` : `/discover`)}>
                  <img src={img.image_url} alt={img.id} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recently Added Vehicles */}
      {vehicles.length > 0 && (
        <div className="card" style={{ border: '1px solid #c0c0c0' }}>
          <div className="card-header" style={cardHeaderStyle}>Recently Added Vehicles</div>
          <div className="card-body" style={cardBodyStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px' }}>
              {vehicles.slice(0, 8).map(v => {
                const sig = signalsById[v.id];
                const pi = sig && sig.primary_label && typeof sig.primary_value === 'number'
                  ? { label: sig.primary_label as 'ASK' | 'SOLD' | 'EST' | 'PAID' | 'MSRP', amount: sig.primary_value as number }
                  : getPriceInfo(v);
                const delta = sig && typeof sig.delta_pct === 'number' && typeof sig.delta_amount === 'number'
                  ? { amount: sig.delta_amount as number, percent: sig.delta_pct as number, isPositive: (sig.delta_amount as number) >= 0 }
                  : getDelta(v);
                return (
                  <div key={v.id} className="text" style={{ ...boxStyle, padding: '6px' }} onClick={() => go(`/vehicle/${v.id}`)}>
                    <div className="text text-bold" style={to8pt}>
                      {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}
                    </div>
                    <div className="text text-muted" style={to8pt}>{new Date(v.created_at).toLocaleString()}</div>

                    {/* Price + Delta Chips */}
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px', alignItems: 'center' }}>
                      {pi.label && typeof pi.amount === 'number' && (
                        <span style={chipStyle} title={Array.isArray(sig?.sources) ? `Sources: ${sig.sources.join(', ')}` : undefined}>
                          {pi.label}: {formatCurrency(pi.amount)}
                        </span>
                      )}
                      {delta && (
                        <span style={{ ...chipStyle, color: delta.isPositive ? '#006400' : '#800000' }} title={Array.isArray(sig?.sources) ? `Sources: ${sig.sources.join(', ')}` : undefined}>
                          {delta.isPositive ? '↑' : '↓'} {Math.abs(delta.percent).toFixed(1)}%
                        </span>
                      )}
                      {typeof sig?.confidence === 'number' && (
                        <span style={chipStyle} title="Signal confidence">conf {sig.confidence}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {events.length > 0 && (
        <div className="card" style={{ border: '1px solid #c0c0c0' }}>
          <div className="card-header" style={cardHeaderStyle}>Recent Activity</div>
          <div className="card-body" style={cardBodyStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px' }}>
              {events.map(e => (
                <div key={e.id} className="text" style={{ ...boxStyle, padding: '6px' }} onClick={() => go(e.vehicle_id ? `/vehicle/${e.vehicle_id}?t=timeline&event=${e.id}` : `/discover`)}>
                  <div className="text text-bold" style={to8pt}>{e.title || (e.event_type || 'Event').replace('_', ' ')}</div>
                  <div className="text text-muted" style={to8pt}>{new Date(e.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiscoveryHighlights;
