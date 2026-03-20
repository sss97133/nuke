import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { CollapsibleWidget } from '../../ui/CollapsibleWidget';
import MiniLineChart from '../../charts/MiniLineChart';

const MAP_FONT = 'Arial, Helvetica, sans-serif';

interface Props {
  zip: string;
  onClose: () => void;
  onNavigate: (view: { type: string; id: string }) => void;
}

interface ZipStats {
  zip_code: string;
  vehicle_count: number;
  avg_price: number | null;
  median_price: number | null;
  org_count: number;
  gps_only_count: number;
  first_listed: string | null;
  last_listed: string | null;
}

interface ZipVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  primary_image_url: string | null;
  status: string | null;
  created_at: string;
}

export default function ZipSidebarPanel({ zip, onClose, onNavigate }: Props) {
  const [stats, setStats] = useState<ZipStats | null>(null);
  const [vehicles, setVehicles] = useState<ZipVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'price' | 'recent'>('recent');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      // Fetch ZIP stats from materialized view
      const { data: zipStats } = await supabase
        .from('vehicle_zip_stats')
        .select('*')
        .eq('zip_code', zip)
        .single();

      if (cancelled) return;

      // Fetch vehicles in this ZIP
      const { data: vehs } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, primary_image_url, status, created_at')
        .eq('zip_code', zip)
        .not('status', 'in', '("deleted","merged","rejected","duplicate")')
        .order('created_at', { ascending: false })
        .limit(30);

      if (cancelled) return;

      if (zipStats) setStats(zipStats as ZipStats);
      if (vehs) setVehicles(vehs as ZipVehicle[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [zip]);

  const fmtPrice = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
    return `$${n.toLocaleString()}`;
  };

  const verified = stats ? stats.vehicle_count - stats.gps_only_count : 0;
  const verifiedPct = stats && stats.vehicle_count > 0
    ? Math.round((verified / stats.vehicle_count) * 100)
    : 100;

  const sortedVehicles = [...vehicles].sort((a, b) => {
    if (sortBy === 'price') return (b.sale_price || 0) - (a.sale_price || 0);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Build a simple monthly listing count sparkline from vehicle created_at dates
  const monthlyData = (() => {
    if (vehicles.length === 0) return [];
    const counts: Record<string, number> = {};
    for (const v of vehicles) {
      const d = new Date(v.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  })();

  return (
    <div style={{ fontFamily: MAP_FONT, fontSize: 11 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onClose} style={btnStyle}>CLOSE</button>
        <span style={{ fontFamily: 'Courier New, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          ZIP {zip}
        </span>
        <div style={{ width: 50 }} />
      </div>

      {loading ? (
        <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 10 }}>LOADING...</div>
      ) : !stats ? (
        <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 10 }}>NO DATA FOR THIS ZIP</div>
      ) : (
        <div style={{ padding: '0' }}>
          {/* Data quality badge */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {stats.vehicle_count.toLocaleString()} VEHICLES
            </span>
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '2px 6px', border: '1px solid var(--border)',
              color: verifiedPct >= 80 ? 'var(--success, #16825d)' : verifiedPct >= 50 ? 'var(--warning, #b05a00)' : 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              {verifiedPct}% VERIFIED
            </span>
          </div>

          {/* Market section */}
          <CollapsibleWidget title="MARKET" badge={<span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{stats.org_count} sellers</span>}>
            <div style={{ padding: '6px 0' }}>
              {monthlyData.length > 1 && (
                <MiniLineChart
                  series={[{
                    id: 'listings',
                    label: 'Listings',
                    data: monthlyData,
                    color: 'var(--success)',
                    showArea: true,
                  }]}
                  width={280}
                  height={60}
                  showTrendArrow={true}
                  formatValue={(v) => `${v} listed`}
                />
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: 'var(--text-secondary)' }}>
                <div>{stats.org_count} <span style={{ fontSize: 8, color: 'var(--text-disabled)' }}>SELLERS</span></div>
                <div>{stats.vehicle_count} <span style={{ fontSize: 8, color: 'var(--text-disabled)' }}>TOTAL</span></div>
              </div>
            </div>
          </CollapsibleWidget>

          {/* Financial section */}
          <CollapsibleWidget title="FINANCIAL" badge={stats.median_price ? <span style={{ fontSize: 9, fontFamily: 'Courier New, monospace', color: 'var(--success, #16825d)' }}>{fmtPrice(stats.median_price)}</span> : undefined}>
            <div style={{ padding: '6px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: 2 }}>MEDIAN</div>
                  <div style={{ fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--success, #16825d)' }}>
                    {stats.median_price ? fmtPrice(stats.median_price) : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: 2 }}>AVERAGE</div>
                  <div style={{ fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {stats.avg_price ? fmtPrice(stats.avg_price) : '—'}
                  </div>
                </div>
              </div>
              {stats.first_listed && (
                <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginTop: 8 }}>
                  Data since {new Date(stats.first_listed).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          </CollapsibleWidget>

          {/* Top Vehicles */}
          <CollapsibleWidget title="VEHICLES" badge={<span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{vehicles.length}</span>}>
            <div style={{ padding: '6px 0' }}>
              {/* Sort toggles */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {(['recent', 'price'] as const).map(s => (
                  <button key={s} onClick={() => setSortBy(s)} style={{
                    ...btnStyle,
                    fontSize: 8,
                    background: sortBy === s ? 'var(--text)' : 'transparent',
                    color: sortBy === s ? 'var(--bg)' : 'var(--text-secondary)',
                  }}>
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Vehicle list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sortedVehicles.slice(0, 15).map(v => {
                  const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
                  return (
                    <div
                      key={v.id}
                      onClick={() => onNavigate({ type: 'vehicle-detail', id: v.id })}
                      style={{
                        display: 'flex', gap: 6, alignItems: 'center', padding: '4px 4px',
                        border: '1px solid var(--border)', cursor: 'pointer',
                      }}
                    >
                      {v.primary_image_url && (
                        <img src={v.primary_image_url} alt="" style={{ width: 36, height: 27, objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {title}
                        </div>
                      </div>
                      {v.sale_price && (
                        <span style={{ fontSize: 9, fontFamily: 'Courier New, monospace', color: 'var(--success, #16825d)', flexShrink: 0 }}>
                          {fmtPrice(v.sale_price)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {vehicles.length > 15 && (
                <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginTop: 6, textAlign: 'center' }}>
                  +{vehicles.length - 15} more
                </div>
              )}
            </div>
          </CollapsibleWidget>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  fontSize: 9, fontWeight: 700, fontFamily: 'Arial, Helvetica, sans-serif', cursor: 'pointer', padding: '4px 8px',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
