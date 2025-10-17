import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import BlueGlowIcon from '../ui/BlueGlowIcon';
import '../../design-system.css';

interface RecentImage {
  id: string;
  vehicle_id?: string;
  image_url: string;
  created_at: string;
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
  const [priceSignal, setPriceSignal] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<string>('');

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

    // Fetch price signal
    supabase
      .from('vehicle_price_signal_view')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .single()
      .then(({ data }) => {
        if (data) setPriceSignal(data);
      })
      .catch(() => {
        supabase.rpc('vehicle_price_signal', { vehicle_ids: [vehicleId] })
          .then(({ data }) => {
            if (data && data[0]) setPriceSignal(data[0]);
          });
      });

    // Get most recent activity
    supabase
      .from('timeline_events')
      .select('event_type, created_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          const hoursAgo = Math.floor((Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60));
          setRecentActivity(hoursAgo < 1 ? 'Updated just now' : `Updated ${hoursAgo}h ago`);
        }
      });
  }, [vehicleId]);

  const handleViewTimeline = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`/vehicle/${vehicleId}?tab=timeline`, '_blank');
  };

  const primaryPrice = priceSignal?.primary_value;
  const priceLabel = priceSignal?.primary_label;

  return (
    <div style={{ cursor: 'pointer', border: '1px solid #c0c0c0', overflow: 'hidden', position: 'relative' }}>
      <div onClick={onClick} style={{ aspectRatio: '16/9', background: '#000', position: 'relative' }}>
        {imageUrl ? (
          <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
            <BlueGlowIcon size={32} />
          </div>
        )}
        <div style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          background: 'rgba(220, 38, 38, 0.95)',
          color: '#fff',
          padding: '3px 8px',
          fontSize: '8pt',
          fontWeight: 'bold',
          borderRadius: '2px',
          border: '1px solid #fff'
        }}>
          <BlueGlowIcon size={12} style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
          {events} UPDATES
        </div>
        {recentActivity && (
          <div style={{
            position: 'absolute',
            bottom: '6px',
            left: '6px',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '2px 6px',
            fontSize: '8pt',
            borderRadius: '2px'
          }}>
            {recentActivity}
          </div>
        )}
      </div>
      <div style={{ padding: '8px', background: '#fff' }}>
        <div onClick={onClick} style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '4px' }}>{title}</div>
        
        {primaryPrice && (
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontSize: '12pt', fontWeight: 'bold', fontFamily: 'monospace' }}>
              {formatCurrency(primaryPrice)}
              {priceLabel && (
                <span style={{ fontSize: '7pt', color: '#666', marginLeft: '4px', fontWeight: 600 }}>
                  {priceLabel}
                </span>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={onClick}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: '8pt',
              background: '#3b82f6',
              color: '#fff',
              border: '1px solid #2563eb',
              borderRadius: '2px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            View Build
          </button>
          <button
            onClick={handleViewTimeline}
            style={{
              padding: '4px 8px',
              fontSize: '8pt',
              background: '#fff',
              color: '#333',
              border: '1px solid #c0c0c0',
              borderRadius: '2px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          title="View Timeline"
        >
          <BlueGlowIcon size={12} />
        </button>
        </div>
      </div>
    </div>
  );
};

const DiscoveryHighlights = () => {
  const [activeShops, setActiveShops] = useState<ActiveShop[]>([]);
  const [hotVehicles, setHotVehicles] = useState<HotVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);

        // Base datasets
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const [vehRes, evtRes, sessRes] = await Promise.all([
          supabase
            .from('vehicles')
            .select('id, year, make, model, created_at, vin, color, msrp, current_value, purchase_price, asking_price, sale_price, is_for_sale')
            .order('created_at', { ascending: false })
            .limit(200),
          supabase
            .from('timeline_events')
            .select('id, vehicle_id, created_at')
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
            .slice(0, 6);
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
    </div>
  );
};

export default DiscoveryHighlights;
