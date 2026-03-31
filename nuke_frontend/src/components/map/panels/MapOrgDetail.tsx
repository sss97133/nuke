import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import MiniLineChart from '../../charts/MiniLineChart';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';

const MAP_FONT = 'Arial, Helvetica, sans-serif';

interface Props {
  orgId: string;
  onBack: () => void;
  onNavigate: (view: { type: string; id: string }) => void;
}

interface OrgVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  status: string | null;
  created_at: string;
}

interface OrgData {
  id: string;
  name: string | null;
  entity_type: string | null;
  business_type: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  instagram_handle: string | null;
  website: string | null;
  established_date: string | null;
  vehicles: OrgVehicle[];
}

export default function MapOrgDetail({ orgId, onBack, onNavigate }: Props) {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      // Try by slug first, then by id
      let { data: o } = await supabase
        .from('businesses')
        .select('id, name, entity_type, business_type, city, state, country, instagram_handle, website, established_date')
        .or(`slug.eq.${orgId},id.eq.${orgId}`)
        .limit(1)
        .single();

      if (cancelled) return;

      let vehicles: OrgVehicle[] = [];
      if (o) {
        const { data: vehs } = await supabase
          .from('vehicles')
          .select('id, year, make, model, primary_image_url, sale_price, status, created_at')
          .eq('selling_organization_id', o.id)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!cancelled && vehs) vehicles = vehs as OrgVehicle[];
      }

      if (!cancelled && o) {
        setOrg({ ...o, vehicles } as OrgData);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [orgId]);

  if (loading) {
    return (
      <div style={{ padding: 16, fontFamily: MAP_FONT }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
        <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 16 }}>LOADING...</div>
      </div>
    );
  }

  if (!org) {
    return (
      <div style={{ padding: 16, fontFamily: MAP_FONT }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
        <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 16 }}>ORGANIZATION NOT FOUND</div>
      </div>
    );
  }

  const location = [org.city, org.state, org.country].filter(Boolean).join(', ');
  const soldCount = org.vehicles.filter(v => v.status === 'sold').length;
  const activeCount = org.vehicles.filter(v => v.status === 'active' || v.status === 'pending').length;
  const prices = org.vehicles.filter(v => v.sale_price).map(v => v.sale_price!);
  const medianPrice = prices.length > 0 ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null;

  // Build monthly activity sparkline
  const monthlyData = (() => {
    if (org.vehicles.length === 0) return [];
    const counts: Record<string, number> = {};
    for (const v of org.vehicles) {
      const d = new Date(v.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  })();

  const fmtPrice = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
    return `$${n.toLocaleString()}`;
  };

  return (
    <div style={{ fontFamily: MAP_FONT, fontSize: 11 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
        <button
          onClick={() => window.open(`/org/${orgId}`, '_blank')}
          style={{ ...backBtnStyle, fontSize: 8 }}
          title="Open full profile in new tab"
        >OPEN IN TAB</button>
      </div>

      <div style={{ padding: '12px' }}>
        {/* Name */}
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{org.name || 'Unknown Organization'}</div>

        {/* Type badge */}
        {(org.entity_type || org.business_type) && (
          <div style={{
            display: 'inline-block', fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const,
            padding: '2px 6px', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            letterSpacing: '0.5px', marginBottom: 8,
          }}>
            {org.business_type || org.entity_type}
          </div>
        )}

        {/* Location */}
        {location && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8 }}>{location}</div>
        )}

        {/* Established */}
        {org.established_date && (
          <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginBottom: 8 }}>
            EST. {new Date(org.established_date).getFullYear()}
          </div>
        )}

        {/* Links */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {org.instagram_handle && (
            <a href={`https://instagram.com/${org.instagram_handle}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 9, color: 'var(--text)', border: '1px solid var(--border)', padding: '3px 6px', textDecoration: 'none' }}>
              @{org.instagram_handle}
            </a>
          )}
          {org.website && (
            <a href={org.website} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 9, color: 'var(--text)', border: '1px solid var(--border)', padding: '3px 6px', textDecoration: 'none' }}>
              WEBSITE
            </a>
          )}
        </div>

        {/* Output Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12, padding: '8px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Courier New, monospace', color: 'var(--text)' }}>{org.vehicles.length}</div>
            <div style={{ fontSize: 7, textTransform: 'uppercase' as const, color: 'var(--text-disabled)', letterSpacing: '0.5px' }}>LISTED</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Courier New, monospace', color: soldCount > 0 ? 'var(--success, #16825d)' : 'var(--text-disabled)' }}>{soldCount}</div>
            <div style={{ fontSize: 7, textTransform: 'uppercase' as const, color: 'var(--text-disabled)', letterSpacing: '0.5px' }}>SOLD</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Courier New, monospace', color: 'var(--text)' }}>{activeCount}</div>
            <div style={{ fontSize: 7, textTransform: 'uppercase' as const, color: 'var(--text-disabled)', letterSpacing: '0.5px' }}>ACTIVE</div>
          </div>
        </div>

        {/* Median Price */}
        {medianPrice && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 12 }}>
            MEDIAN: <span style={{ fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--success, #16825d)' }}>{fmtPrice(medianPrice)}</span>
          </div>
        )}

        {/* Activity Timeline Sparkline */}
        {monthlyData.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-secondary)', letterSpacing: '1px', marginBottom: 4 }}>
              LISTING ACTIVITY
            </div>
            <MiniLineChart
              series={[{
                id: 'activity',
                label: 'Listings',
                data: monthlyData,
                color: 'var(--success)',
                showArea: true,
              }]}
              width={280}
              height={50}
              showTrendArrow={true}
              formatValue={(v) => `${v} listed`}
            />
          </div>
        )}

        {/* Inventory */}
        {org.vehicles.length > 0 && (
          <>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, color: 'var(--text-secondary)', letterSpacing: '1px', marginBottom: 6 }}>
              INVENTORY ({org.vehicles.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {org.vehicles.map(v => {
                const title = [v.year, v.make, v.model].filter(Boolean).join(' ');
                return (
                  <div
                    key={v.id}
                    onClick={() => onNavigate({ type: 'vehicle-detail', id: v.id })}
                    style={{
                      display: 'flex', gap: 8, alignItems: 'center', padding: '4px 6px',
                      border: '1px solid var(--border)', cursor: 'pointer',
                    }}
                  >
                    {v.primary_image_url && (
                      <img src={optimizeImageUrl(v.primary_image_url, 'micro') || v.primary_image_url} alt="" loading="lazy" style={{ width: 40, height: 30, objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {title || 'Unknown'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {v.sale_price && (
                          <span style={{ fontSize: 9, fontFamily: 'Courier New, monospace', color: 'var(--success, #16825d)' }}>
                            ${v.sale_price.toLocaleString()}
                          </span>
                        )}
                        {v.status && v.status !== 'active' && (
                          <span style={{ fontSize: 7, textTransform: 'uppercase' as const, color: 'var(--text-disabled)', letterSpacing: '0.3px' }}>
                            {v.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  fontSize: 9, fontWeight: 700, fontFamily: MAP_FONT, cursor: 'pointer', padding: '4px 8px',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
