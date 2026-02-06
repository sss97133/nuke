import React, { useState, useMemo, useEffect } from 'react';
import { FaviconIcon } from '../common/FaviconIcon';
import MiniLineChart from '../charts/MiniLineChart';
import type { DataSeries } from '../charts/MiniLineChart';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

// --- Types ---

export interface OrgInfo {
  website: string;
  business_name: string;
  business_type: string | null;
  logo_url: string | null;
  city: string | null;
  state: string | null;
}

interface RecentlyAddedPanelProps {
  onClose: () => void;
  vehicles: any[];
  orgInfoById: Record<string, OrgInfo>;
  onNavigateToVehicle?: (id: string) => void;
  onFilterMainView?: () => void;
}

type TimeSpan = '1h' | '6h' | '12h' | '24h' | '48h' | '7d';
type SortOption = 'newest' | 'price_desc' | 'price_asc';

const TIME_SPANS: { value: TimeSpan; label: string; ms: number }[] = [
  { value: '1h',  label: '1h',  ms: 1 * 60 * 60 * 1000 },
  { value: '6h',  label: '6h',  ms: 6 * 60 * 60 * 1000 },
  { value: '12h', label: '12h', ms: 12 * 60 * 60 * 1000 },
  { value: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { value: '48h', label: '48h', ms: 48 * 60 * 60 * 1000 },
  { value: '7d',  label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
];

const TIMEZONES = [
  { value: 'Auto', label: 'Auto' },
  { value: 'America/New_York', label: 'US/Eastern' },
  { value: 'America/Chicago', label: 'US/Central' },
  { value: 'America/Denver', label: 'US/Mountain' },
  { value: 'America/Los_Angeles', label: 'US/Pacific' },
  { value: 'UTC', label: 'UTC' },
];

const PRICE_TIERS = [
  { label: '<$10K', min: 0, max: 10000 },
  { label: '$10-25K', min: 10000, max: 25000 },
  { label: '$25-50K', min: 25000, max: 50000 },
  { label: '$50-100K', min: 50000, max: 100000 },
  { label: '$100K+', min: 100000, max: Infinity },
];

// --- Helpers ---

function getDisplayPrice(v: any): number | null {
  const p = v?.display_price ?? v?.sale_price ?? v?.asking_price ?? v?.current_value ?? v?.purchase_price ?? v?.winning_bid ?? v?.high_bid ?? v?.msrp;
  if (typeof p === 'number' && p > 0) return p;
  return null;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function resolveTimezone(tz: string): string {
  return tz === 'Auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
}

function getVehicleImageUrl(v: any): string | null {
  if (v?.primary_image_url) return optimizeImageUrl(v.primary_image_url, 'thumbnail');
  if (v?.image_url) return optimizeImageUrl(v.image_url, 'thumbnail');
  if (Array.isArray(v?.all_images) && v.all_images.length > 0) {
    const primary = v.all_images.find((img: any) => img.is_primary);
    const url = primary?.url || v.all_images[0]?.url;
    if (url) return optimizeImageUrl(url, 'thumbnail');
  }
  return null;
}

function getVehicleTitle(v: any): string {
  const parts = [v?.year, v?.make, v?.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : (v?.title || 'Unknown Vehicle');
}

// --- Component ---

const RecentlyAddedPanel: React.FC<RecentlyAddedPanelProps> = ({
  onClose,
  vehicles,
  orgInfoById,
  onNavigateToVehicle,
  onFilterMainView,
}) => {
  // Persisted state
  const [timezone, setTimezone] = useState<string>(() =>
    localStorage.getItem('nuke_ra_tz') || 'Auto'
  );
  const [timeSpan, setTimeSpan] = useState<TimeSpan>(() =>
    (localStorage.getItem('nuke_ra_span') as TimeSpan) || '24h'
  );
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  useEffect(() => { localStorage.setItem('nuke_ra_tz', timezone); }, [timezone]);
  useEffect(() => { localStorage.setItem('nuke_ra_span', timeSpan); }, [timeSpan]);

  const spanMs = TIME_SPANS.find(s => s.value === timeSpan)?.ms ?? 24 * 60 * 60 * 1000;
  const resolvedTz = resolveTimezone(timezone);

  // 1. Filter vehicles by time span
  const recentVehicles = useMemo(() => {
    const cutoff = Date.now() - spanMs;
    return vehicles.filter(v => {
      const t = new Date(v?.created_at || 0).getTime();
      return t >= cutoff;
    });
  }, [vehicles, spanMs]);

  // 2. Summary stats
  const summaryStats = useMemo(() => {
    let totalValue = 0;
    let priced = 0;
    const tierCounts = PRICE_TIERS.map(() => 0);
    const makeCounts: Record<string, number> = {};

    for (const v of recentVehicles) {
      const price = getDisplayPrice(v);
      if (price !== null) {
        totalValue += price;
        priced++;
        for (let i = 0; i < PRICE_TIERS.length; i++) {
          if (price >= PRICE_TIERS[i].min && price < PRICE_TIERS[i].max) {
            tierCounts[i]++;
            break;
          }
        }
      }
      const make = v?.make;
      if (make) makeCounts[make] = (makeCounts[make] || 0) + 1;
    }

    const topMakes = Object.entries(makeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    return {
      count: recentVehicles.length,
      totalValue,
      avgValue: priced > 0 ? totalValue / priced : 0,
      tierCounts,
      topMakes,
      maxTierCount: Math.max(...tierCounts, 1),
      maxMakeCount: topMakes.length > 0 ? topMakes[0][1] : 1,
    };
  }, [recentVehicles]);

  // 3. Org breakdown
  const orgBreakdown = useMemo(() => {
    const byOrg: Record<string, { count: number; totalValue: number }> = {};
    let unknownCount = 0;
    let unknownValue = 0;

    for (const v of recentVehicles) {
      const orgId = v?.origin_organization_id;
      const price = getDisplayPrice(v) || 0;
      if (orgId && typeof orgId === 'string') {
        if (!byOrg[orgId]) byOrg[orgId] = { count: 0, totalValue: 0 };
        byOrg[orgId].count++;
        byOrg[orgId].totalValue += price;
      } else {
        unknownCount++;
        unknownValue += price;
      }
    }

    const rows = Object.entries(byOrg)
      .map(([orgId, stats]) => ({
        orgId,
        info: orgInfoById[orgId] || null,
        ...stats,
      }))
      .sort((a, b) => b.count - a.count);

    if (unknownCount > 0) {
      rows.push({ orgId: '__unknown__', info: null, count: unknownCount, totalValue: unknownValue });
    }

    return rows;
  }, [recentVehicles, orgInfoById]);

  // 4. Chart series — bucket by hour (<=48h) or day (7d)
  // MiniLineChart sorts date keys alphabetically and filters out value===0 points,
  // so we use ISO-sortable keys and substitute 0.01 for empty buckets to keep the line shape.
  const chartSeries = useMemo((): DataSeries[] => {
    const useHourly = timeSpan !== '7d';
    const bucketMs = useHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const now = Date.now();
    const cutoff = now - spanMs;

    // Build ordered buckets with ISO-sortable keys
    const bucketKeys: string[] = [];
    const bucketCounts: Record<string, number> = {};
    let t = cutoff;
    while (t <= now) {
      // ISO prefix ensures correct alphabetical sort order
      const iso = new Date(t).toISOString().slice(0, useHourly ? 13 : 10);
      if (!bucketCounts.hasOwnProperty(iso)) {
        bucketKeys.push(iso);
        bucketCounts[iso] = 0;
      }
      t += bucketMs;
    }

    // Assign vehicles to buckets
    for (const v of recentVehicles) {
      const vt = new Date(v?.created_at || 0).getTime();
      const iso = new Date(vt).toISOString().slice(0, useHourly ? 13 : 10);
      if (iso in bucketCounts) bucketCounts[iso]++;
    }

    // Convert to DataPoint[] — use 0.01 for empty buckets so MiniLineChart doesn't drop them
    const data = bucketKeys.map(iso => ({
      date: iso,
      value: bucketCounts[iso] || 0.01,
    }));

    return [{
      id: 'imports',
      label: useHourly ? 'per hour' : 'per day',
      data,
      color: '#10b981',
      showArea: true,
    }];
  }, [recentVehicles, timeSpan, spanMs, resolvedTz]);

  // 5. Sorted vehicles
  const sortedVehicles = useMemo(() => {
    const arr = [...recentVehicles];
    switch (sortBy) {
      case 'newest':
        return arr.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      case 'price_desc':
        return arr.sort((a, b) => (getDisplayPrice(b) || 0) - (getDisplayPrice(a) || 0));
      case 'price_asc':
        return arr.sort((a, b) => (getDisplayPrice(a) || 0) - (getDisplayPrice(b) || 0));
      default:
        return arr;
    }
  }, [recentVehicles, sortBy]);

  const spanLabel = TIME_SPANS.find(s => s.value === timeSpan)?.label ?? timeSpan;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 20000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1200px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          marginTop: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface-hover)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: 'var(--fs-10)',
              fontWeight: 700,
              color: 'var(--text)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>Recently Added</span>
            <span style={{
              background: 'rgba(16,185,129,0.15)',
              color: '#10b981',
              fontSize: 'var(--fs-8)',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '999px',
              border: '1px solid rgba(16,185,129,0.3)',
            }}>
              {summaryStats.count}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ×
          </button>
        </div>

        {/* TIME CONTROLS BAR */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>TZ:</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{
                fontSize: 'var(--fs-8)',
                padding: '2px 4px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {TIME_SPANS.map(s => (
              <button
                key={s.value}
                onClick={() => setTimeSpan(s.value)}
                style={{
                  padding: '2px 8px',
                  fontSize: 'var(--fs-8)',
                  fontWeight: 600,
                  border: timeSpan === s.value ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: timeSpan === s.value ? 'var(--accent-dim)' : 'transparent',
                  color: timeSpan === s.value ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div style={{ maxHeight: '75vh', overflowY: 'auto', padding: '16px' }}>

          {/* ROW 1: Stats + Chart */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>

            {/* Left: Summary stats */}
            <div style={{ flex: '1 1 55%', minWidth: '300px' }}>

              {/* Stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                <StatCard label="Count" value={summaryStats.count.toLocaleString()} />
                <StatCard label="Total Value" value={summaryStats.totalValue > 0 ? formatCurrency(summaryStats.totalValue) : '—'} />
                <StatCard label="Avg Value" value={summaryStats.avgValue > 0 ? formatCurrency(summaryStats.avgValue) : '—'} />
              </div>

              {/* Price tiers */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: 'var(--fs-8)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Price Distribution</div>
                {PRICE_TIERS.map((tier, i) => (
                  <HorizontalBar
                    key={tier.label}
                    label={tier.label}
                    count={summaryStats.tierCounts[i]}
                    maxCount={summaryStats.maxTierCount}
                    color="var(--accent)"
                  />
                ))}
              </div>

              {/* Top makes */}
              {summaryStats.topMakes.length > 0 && (
                <div>
                  <div style={{ fontSize: 'var(--fs-8)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Top Makes</div>
                  {summaryStats.topMakes.map(([make, count]) => (
                    <HorizontalBar
                      key={make}
                      label={make}
                      count={count}
                      maxCount={summaryStats.maxMakeCount}
                      color="#10b981"
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: Chart */}
            <div style={{ flex: '1 1 35%', minWidth: '250px' }}>
              <div style={{ fontSize: 'var(--fs-8)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Import Velocity ({timeSpan !== '7d' ? 'per hour' : 'per day'})
              </div>
              <div style={{
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '12px',
              }}>
                <MiniLineChart
                  series={chartSeries}
                  width={380}
                  height={120}
                  showLegend={false}
                  showTrendArrow={true}
                  formatValue={(v) => String(Math.round(v))}
                />
              </div>
            </div>
          </div>

          {/* ROW 2: Sources */}
          {orgBreakdown.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: 'var(--fs-8)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sources</div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '6px',
              }}>
                {orgBreakdown.map(row => (
                  <div key={row.orgId} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    background: 'var(--surface-hover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 'var(--fs-8)',
                  }}>
                    {row.info?.website ? (
                      <FaviconIcon url={row.info.website} size={16} />
                    ) : (
                      <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border)', borderRadius: '2px', fontSize: '9px', color: 'var(--text-secondary)' }}>?</span>
                    )}
                    <span style={{ fontWeight: 600, color: 'var(--text)', flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.info?.business_name || (row.orgId === '__unknown__' ? 'Unknown Source' : row.orgId.slice(0, 8))}
                    </span>
                    {row.info?.business_type && (
                      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8)', opacity: 0.7 }}>{row.info.business_type}</span>
                    )}
                    {(row.info?.city || row.info?.state) && (
                      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8)', opacity: 0.6 }}>
                        {[row.info.city, row.info.state].filter(Boolean).join(', ')}
                      </span>
                    )}
                    <span style={{ fontWeight: 700, color: '#10b981', marginLeft: 'auto', flexShrink: 0 }}>{row.count}</span>
                    {row.totalValue > 0 && (
                      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{formatCurrency(row.totalValue)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ROW 3: Vehicles */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ fontSize: 'var(--fs-8)', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Vehicles</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {([
                  { value: 'newest' as SortOption, label: 'Newest' },
                  { value: 'price_desc' as SortOption, label: 'Price ↓' },
                  { value: 'price_asc' as SortOption, label: 'Price ↑' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSortBy(opt.value)}
                    style={{
                      padding: '2px 6px',
                      fontSize: 'var(--fs-8)',
                      fontWeight: 600,
                      border: sortBy === opt.value ? '1px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: sortBy === opt.value ? 'var(--accent-dim)' : 'transparent',
                      color: sortBy === opt.value ? 'var(--accent)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '6px',
              maxHeight: '400px',
              overflowY: 'auto',
            }}>
              {sortedVehicles.map(v => {
                const imgUrl = getVehicleImageUrl(v);
                const price = getDisplayPrice(v);
                const orgInfo = v?.origin_organization_id ? orgInfoById[v.origin_organization_id] : null;
                return (
                  <div
                    key={v.id}
                    onClick={() => onNavigateToVehicle?.(v.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 8px',
                      background: 'var(--surface-hover)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: onNavigateToVehicle ? 'pointer' : 'default',
                      fontSize: 'var(--fs-8)',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    {/* Thumbnail */}
                    <div style={{
                      width: 48, height: 36,
                      borderRadius: '3px',
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'var(--border)',
                    }}>
                      {imgUrl && (
                        <img
                          src={imgUrl}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      )}
                    </div>

                    {/* Title */}
                    <div style={{ flex: '1 1 auto', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{getVehicleTitle(v)}</span>
                    </div>

                    {/* Price */}
                    {price !== null && (
                      <span style={{ fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                        {formatCurrency(price)}
                      </span>
                    )}

                    {/* Source favicon */}
                    {orgInfo?.website && (
                      <FaviconIcon url={orgInfo.website} size={12} />
                    )}

                    {/* Relative time */}
                    <span style={{ color: 'var(--text-secondary)', opacity: 0.7, flexShrink: 0, fontSize: 'var(--fs-8)' }}>
                      {v?.created_at ? relativeTime(v.created_at) : ''}
                    </span>
                  </div>
                );
              })}
              {sortedVehicles.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
                  No vehicles added in the last {spanLabel}.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderTop: '2px solid var(--border)',
          background: 'var(--surface-hover)',
          fontSize: 'var(--fs-8)',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            Showing {summaryStats.count} vehicle{summaryStats.count !== 1 ? 's' : ''} from the last {spanLabel}
          </span>
          {onFilterMainView && (
            <button
              onClick={onFilterMainView}
              style={{
                padding: '4px 12px',
                fontSize: 'var(--fs-8)',
                fontWeight: 600,
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius)',
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                cursor: 'pointer',
              }}
            >
              Filter main view
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Sub-components ---

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{
    background: 'var(--surface-hover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '8px 10px',
    textAlign: 'center',
  }}>
    <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
  </div>
);

const HorizontalBar: React.FC<{ label: string; count: number; maxCount: number; color: string }> = ({ label, count, maxCount, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
    <span style={{ width: '60px', fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{label}</span>
    <div style={{ flex: 1, height: '12px', background: 'var(--surface)', borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--border)' }}>
      <div style={{
        width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
        height: '100%',
        background: color,
        opacity: 0.6,
        borderRadius: '2px',
        transition: 'width 0.3s ease',
      }} />
    </div>
    <span style={{ width: '28px', fontSize: 'var(--fs-8)', fontWeight: 600, color: 'var(--text)', textAlign: 'right', flexShrink: 0 }}>{count}</span>
  </div>
);

export default RecentlyAddedPanel;
