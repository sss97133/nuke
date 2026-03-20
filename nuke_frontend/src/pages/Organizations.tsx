// Organizations Directory - Investment-grade organization commodities
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/env';
import { OrgLogo } from '../components/common/OrgLogo';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Package,
  DollarSign,
  Clock,
  Percent,
  ChevronDown,
  Search,
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  Info,
} from 'lucide-react';

export interface OrgExtractionCoverage {
  org_id: string;
  label: string | null;
  extracted: number | null;
  queue_pending: number | null;
  target: number | null;
  metrics_note?: string;
}

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  business_type: string;
  description?: string;
  logo_url?: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  is_tradable: boolean;
  stock_symbol?: string;
  created_at: string;
  // Core counts
  total_vehicles?: number;
  total_images?: number;
  total_events?: number;
  total_inventory?: number;
  total_listings?: number;
  total_sold?: number;
  // Financial
  total_revenue?: number;
  gmv?: number;
  gross_margin_pct?: number;
  inventory_turnover?: number;
  avg_days_to_sell?: number;
  estimated_value?: number;
  labor_rate?: number;
  // Engagement
  repeat_customer_rate?: number;
  repeat_customer_count?: number;
  total_reviews?: number;
  average_project_rating?: number;
  // Computed
  avg_sale_price?: number;
  sold_count?: number;
  total_gmv_computed?: number;
  data_signal_score?: number;
}

type SortKey = 'vehicles' | 'gmv' | 'revenue' | 'recent' | 'name' | 'signal';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'signal', label: 'Data Signal' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'gmv', label: 'GMV' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'Name' },
];

const TYPE_LABELS: Record<string, string> = {
  auction_house: 'Auction House',
  dealership: 'Dealership',
  collection: 'Collection',
  forum: 'Forum',
  specialty_shop: 'Specialty',
  restoration_shop: 'Restoration',
  performance_shop: 'Performance',
  body_shop: 'Body Shop',
  garage: 'Garage',
  builder: 'Builder',
  marketplace: 'Marketplace',
  dealer: 'Dealer',
  developer: 'Developer',
  motorsport_event: 'Motorsport',
  rally_event: 'Rally',
  fabrication: 'Fabrication',
  detailing: 'Detailing',
  concours: 'Concours',
  automotive_expo: 'Expo',
  club: 'Club',
  media: 'Media',
  registry: 'Registry',
  villa_rental: 'Villa / Rental',
  event_company: 'Event Company',
  restaurant_food: 'Restaurant / Food',
  hotel_lodging: 'Hotel / Lodging',
  property_management: 'Property',
  travel_tourism: 'Travel / Tourism',
  art_creative: 'Art / Creative',
  retail_other: 'Retail',
  health_medical: 'Health / Medical',
  professional_services: 'Professional Services',
  sport_recreation: 'Sport / Recreation',
  marine_nautical: 'Marine / Nautical',
  education: 'Education',
  construction_services: 'Construction',
  car_rental: 'Car Rental',
  other: 'Other',
};

function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function formatNum(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

/** Compute a 0-100 data signal score based on how much quantitative data an org has */
function computeSignalScore(org: Organization): number {
  let score = 0;
  if ((org.total_vehicles || 0) > 0) score += 25;
  if ((org.total_vehicles || 0) > 100) score += 10;
  if ((org.total_vehicles || 0) > 1000) score += 10;
  if (org.description) score += 10;
  if (org.logo_url || org.website) score += 5;
  if ((org.total_revenue || 0) > 0) score += 15;
  if ((org.gmv || 0) > 0) score += 10;
  if ((org.gross_margin_pct || 0) > 0) score += 5;
  if ((org.total_images || 0) > 0) score += 5;
  if ((org.city && org.state)) score += 5;
  return Math.min(score, 100);
}

/** Get a tier label based on signal score */
function getSignalTier(score: number): { label: string; color: string; bg: string } {
  if (score >= 70) return { label: 'RICH DATA', color: 'var(--success)', bg: 'rgba(22,163,74,0.1)' };
  if (score >= 40) return { label: 'MODERATE', color: '#ca8a04', bg: 'rgba(202,138,4,0.1)' };
  if (score >= 15) return { label: 'SPARSE', color: 'var(--text-disabled)', bg: 'rgba(156,163,175,0.1)' };
  return { label: 'STUB', color: 'var(--text-secondary)', bg: 'rgba(107,114,128,0.08)' };
}

export default function Organizations() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') || '';
  const urlType = searchParams.get('type') || 'all';
  const urlSort = (searchParams.get('sort') as SortKey) || 'signal';

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [typeFilter, setTypeFilter] = useState(urlType);
  const [sortKey, setSortKey] = useState<SortKey>(urlSort);
  const [showFilters, setShowFilters] = useState(false);
  const [coverageByOrg, setCoverageByOrg] = useState<Record<string, OrgExtractionCoverage>>({});

  const loadOrganizations = useCallback(async () => {
    try {
      setLoading(true);

      const { data: orgs, error } = await supabase
        .from('businesses')
        .select(`
          id, business_name, legal_name, business_type, description,
          logo_url, website, city, state, country,
          is_tradable, stock_symbol, created_at,
          total_vehicles, total_images, total_events, total_inventory,
          total_listings, total_sold,
          gmv, gross_margin_pct,
          inventory_turnover, avg_days_to_sell, estimated_value, labor_rate,
          repeat_customer_rate, repeat_customer_count,
          total_reviews, average_project_rating
        `)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(2000);

      if (error) throw error;

      // Compute signal scores
      const enriched = (orgs || []).map(org => ({
        ...org,
        data_signal_score: computeSignalScore(org),
      }));

      setOrganizations(enriched);
    } catch {
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations]);

  // Fetch extraction coverage for all sources (BAT, C&B, Craigslist, etc.) – poll so we show live "loading in"
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/org-extraction-coverage?all=1`, {
          headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { sources?: OrgExtractionCoverage[] };
        const list = data?.sources ?? [];
        const byOrg: Record<string, OrgExtractionCoverage> = {};
        list.forEach((c) => {
          if (c?.org_id && (c.extracted != null || c.target != null)) {
            byOrg[c.org_id] = c;
          }
        });
        setCoverageByOrg(byOrg);
      } catch {
        // Optional: no coverage data
      }
    };
    load();
    const interval = setInterval(load, 45_000);
    return () => clearInterval(interval);
  }, []);

  // Extract available types from data
  const availableTypes = useMemo(() => {
    const types = new Set(organizations.map(o => o.business_type).filter(Boolean));
    return Array.from(types).sort();
  }, [organizations]);

  // Canonical org ids we track for extraction coverage (one row per logical org in the list)
  const coverageOrgIds = useMemo(() => new Set(Object.keys(coverageByOrg)), [coverageByOrg]);

  // Filter + search + sort + dedupe by name (show single canonical org when we have coverage)
  const displayOrgs = useMemo(() => {
    let filtered = organizations;

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter(o => o.business_type === typeFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(o =>
        o.business_name?.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.city?.toLowerCase().includes(q) ||
        o.state?.toLowerCase().includes(q)
      );
    }

    // Dedupe by business_name: when we have coverage for an org_id, show only that canonical row; else keep one with highest total_vehicles
    const byName = new Map<string, Organization[]>();
    for (const o of filtered) {
      const name = (o.business_name || '').trim() || '(unnamed)';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(o);
    }
    filtered = [];
    for (const [, group] of byName) {
      if (group.length === 1) {
        filtered.push(group[0]);
        continue;
      }
      const canonical = group.find(o => coverageOrgIds.has(o.id));
      filtered.push(canonical ?? group.reduce((best, o) => (o.total_vehicles || 0) > (best.total_vehicles || 0) ? o : best));
    }

    // Sort
    const sorted = [...filtered];
    switch (sortKey) {
      case 'vehicles':
        sorted.sort((a, b) => (b.total_vehicles || 0) - (a.total_vehicles || 0));
        break;
      case 'gmv':
        sorted.sort((a, b) => (b.gmv || b.total_revenue || 0) - (a.gmv || a.total_revenue || 0));
        break;
      case 'revenue':
        sorted.sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
        break;
      case 'recent':
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'name':
        sorted.sort((a, b) => (a.business_name || '').localeCompare(b.business_name || ''));
        break;
      case 'signal':
      default:
        sorted.sort((a, b) => (b.data_signal_score || 0) - (a.data_signal_score || 0));
        break;
    }

    return sorted;
  }, [organizations, typeFilter, searchQuery, sortKey, coverageOrgIds]);

  // Aggregate stats (from display list so counts match what we show after dedupe)
  const stats = useMemo(() => {
    const withVehicles = displayOrgs.filter(o => (o.total_vehicles || 0) > 0);
    const totalVehicles = displayOrgs.reduce((sum, o) => sum + (o.total_vehicles || 0), 0);
    const totalGmv = displayOrgs.reduce((sum, o) => sum + (o.gmv || 0), 0);
    const totalRevenue = displayOrgs.reduce((sum, o) => sum + (o.total_revenue || 0), 0);
    return {
      total: displayOrgs.length,
      withVehicles: withVehicles.length,
      totalVehicles,
      totalGmv,
      totalRevenue,
    };
  }, [displayOrgs]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
        Loading organizations...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '19px', fontWeight: 700, marginBottom: '4px', letterSpacing: '-0.02em' }}>
            Organizations
          </h1>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
            Auction houses, dealerships, shops, and collections as investable commodities
          </p>
        </div>
        <button
          onClick={() => navigate('/org/create')}
          className="button button-primary"
          style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Plus size={12} /> Add Organization
        </button>
      </div>

      {/* Market Summary Bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '1px',
        background: 'var(--border)',
        border: '1px solid var(--border)', overflow: 'hidden',
        marginBottom: '16px',
      }}>
        {[
          { label: 'Organizations', value: stats.total.toLocaleString() },
          { label: 'With Vehicles', value: stats.withVehicles.toLocaleString() },
          { label: 'Total Vehicles', value: formatNum(stats.totalVehicles) },
          { label: 'Platform GMV', value: stats.totalGmv > 0 ? formatCompact(stats.totalGmv) : '—' },
          { label: 'Revenue Tracked', value: stats.totalRevenue > 0 ? formatCompact(stats.totalRevenue) : '—' },
        ].map((stat, i) => (
          <div key={i} style={{
            background: 'var(--white)',
            padding: '10px 12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Search + Sort + Filter Bar */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '16px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={13} style={{
            position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, location..."
            className="form-input"
            style={{ fontSize: '12px', paddingLeft: '28px', width: '100%' }}
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="form-select"
          style={{ fontSize: '11px', minWidth: '120px' }}
        >
          <option value="all">All Types</option>
          {availableTypes.map(type => (
            <option key={type} value={type}>
              {TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </option>
          ))}
        </select>

        {/* Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ArrowUpDown size={12} style={{ color: 'var(--text-muted)' }} />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="form-select"
            style={{ fontSize: '11px', minWidth: '100px' }}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Count */}
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {displayOrgs.length} result{displayOrgs.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Organizations Grid */}
      {displayOrgs.length === 0 ? (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)', padding: '60px 20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
            No organizations match your filters
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Try adjusting your search or filters
          </div>
          <button
            onClick={() => { setSearchQuery(''); setTypeFilter('all'); }}
            className="button button-secondary button-small"
            style={{ fontSize: '11px' }}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '12px',
        }}>
          {displayOrgs.map(org => (
            <OrgCard key={org.id} org={org} coverage={coverageByOrg[org.id]} onClick={() => navigate(`/org/${org.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Individual org card - investment commodity style */
function OrgCard({ org, coverage, onClick }: { org: Organization; coverage?: OrgExtractionCoverage | null; onClick: () => void }) {
  const signalScore = org.data_signal_score || 0;
  const signalTier = getSignalTier(signalScore);
  // Prefer extraction coverage count when we have it (e.g. BAT from vehicle_events), else org total
  const vehicles = (coverage?.extracted != null ? coverage.extracted : org.total_vehicles) || 0;
  const gmv = org.gmv || 0;
  const revenue = org.total_revenue || 0;
  const margin = org.gross_margin_pct || 0;
  const turnover = org.inventory_turnover || 0;
  const avgDays = org.avg_days_to_sell || 0;
  const typeLabel = TYPE_LABELS[org.business_type] || org.business_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';

  // Pick the best 3 quantitative metrics to show
  const metrics: { icon: React.ReactNode; value: string; label: string }[] = [];

  // Always show vehicles if > 0
  if (vehicles > 0) {
    metrics.push({ icon: <Package size={10} />, value: formatNum(vehicles), label: 'Vehicles' });
  }

  // GMV
  if (gmv > 0) {
    metrics.push({ icon: <DollarSign size={10} />, value: formatCompact(gmv), label: 'GMV' });
  } else if (revenue > 0) {
    metrics.push({ icon: <DollarSign size={10} />, value: formatCompact(revenue), label: 'Revenue' });
  }

  // Margin
  if (margin > 0) {
    metrics.push({ icon: <Percent size={10} />, value: `${margin.toFixed(1)}%`, label: 'Margin' });
  }

  // Turnover
  if (turnover > 0 && metrics.length < 3) {
    metrics.push({ icon: <BarChart3 size={10} />, value: `${turnover.toFixed(1)}x`, label: 'Turnover' });
  }

  // Avg days to sell
  if (avgDays > 0 && metrics.length < 3) {
    metrics.push({ icon: <Clock size={10} />, value: `${Math.round(avgDays)}d`, label: 'Avg Days' });
  }

  // Images as fallback
  if ((org.total_images || 0) > 0 && metrics.length < 3) {
    metrics.push({ icon: <BarChart3 size={10} />, value: formatNum(org.total_images || 0), label: 'Images' });
  }

  // Events as fallback
  if ((org.total_events || 0) > 0 && metrics.length < 3) {
    metrics.push({ icon: <BarChart3 size={10} />, value: formatNum(org.total_events || 0), label: 'Events' });
  }

  const location = [org.city, org.state].filter(Boolean).join(', ');

  return (
    <div
      onClick={onClick}
      className="hover-lift"
      style={{
        background: 'var(--white)',
        border: '1px solid var(--border)', overflow: 'hidden',
        cursor: 'pointer',
        transition: '0.12s',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Logo / Visual Header */}
      <div style={{ height: '120px', position: 'relative', overflow: 'hidden' }}>
        <OrgLogo
          website={org.website}
          logoUrl={org.logo_url}
          businessType={org.business_type}
          businessName={org.business_name}
          variant="card"
          style={{ width: '100%', height: '100%' }}
        />

        {/* Type badge - top left */}
        <div style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          padding: '2px 7px', fontSize: '9px',
          fontWeight: 600,
          backdropFilter: 'blur(4px)',
        }}>
          {typeLabel}
        </div>

        {/* Stock symbol badge */}
        {org.is_tradable && org.stock_symbol && (
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(0,0,0,0.85)',
            color: '#00ff00',
            padding: '2px 7px', fontSize: '9px',
            fontWeight: 700,
            fontFamily: 'monospace',
          }}>
            ${org.stock_symbol}
          </div>
        )}

        {/* Signal tier badge - bottom right */}
        <div style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          background: 'rgba(0,0,0,0.75)',
          color: signalTier.color,
          padding: '2px 7px', fontSize: '8px',
          fontWeight: 700,
          letterSpacing: '0.05em',
          backdropFilter: 'blur(4px)',
        }}>
          {signalTier.label}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Name + location */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
            <OrgLogo
              website={org.website}
              logoUrl={org.logo_url}
              businessType={org.business_type}
              size={16}
              variant="icon"
              style={{ flexShrink: 0 }}
            />
            <h3 style={{
              fontSize: '12px',
              fontWeight: 700,
              margin: 0,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {org.business_name}
            </h3>
          </div>
          {location && (
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '22px' }}>
              {location}
            </div>
          )}
        </div>

        {/* Description (truncated) */}
        {org.description && (
          <div style={{
            fontSize: '7.5pt',
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
            marginBottom: '8px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {org.description}
          </div>
        )}

        {/* Extraction coverage: what we have + what we're loading in (scraping in real time) */}
        {coverage && (coverage.extracted != null || coverage.target != null) && (
          <div style={{
            fontSize: '6.5pt',
            color: 'var(--text-muted)',
            lineHeight: 1.35,
            marginBottom: '6px',
            padding: '4px 6px',
            background: 'var(--gray-50)', borderLeft: '2px solid var(--blue-500)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <Info size={9} style={{ flexShrink: 0 }} />
              <span>
                {coverage.extracted != null ? `${formatNum(coverage.extracted)} listings` : ''}
                {coverage.queue_pending != null && coverage.queue_pending > 0 && (
                  <span> · {formatNum(coverage.queue_pending)} in queue · <span style={{ color: 'var(--blue-600)', fontWeight: 600 }}>loading in…</span></span>
                )}
              </span>
            </div>
            {coverage.metrics_note && (
              <div style={{ marginLeft: '13px' }}>{coverage.metrics_note}</div>
            )}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Quantitative metrics row */}
        {metrics.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(metrics.length, 3)}, 1fr)`,
            gap: '8px',
            paddingTop: '8px',
            borderTop: '1px solid var(--border-light, #eee)',
          }}>
            {metrics.slice(0, 3).map((m, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                }}>
                  {m.value}
                </div>
                <div style={{
                  fontSize: '6.5pt',
                  color: 'var(--text-muted)',
                  marginTop: '1px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            paddingTop: '8px',
            borderTop: '1px solid var(--border-light, #eee)',
            textAlign: 'center',
            fontSize: '9px',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}>
            Pending data ingestion
          </div>
        )}

        {/* Signal bar */}
        <div style={{ marginTop: '8px' }}>
          <div style={{
            height: '2px',
            background: 'var(--border-light, #eee)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${signalScore}%`,
              background: signalTier.color, transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
