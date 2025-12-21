import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';

type SegmentIndexRow = {
  segment_id: string;
  slug: string;
  name: string;
  description: string | null;
  manager_type: 'ai' | 'human';
  vehicle_count: number;
  market_cap_usd: number;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  fund_id: string | null;
  fund_symbol: string | null;
  nav_share_price: number | null;
  total_aum_usd: number | null;
};

type VehicleInvestment = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  current_value: number | null;
  has_funding_round: boolean;
  has_shares: boolean;
  has_bonds: boolean;
  is_for_sale: boolean;
};

type MarketOverview = {
  total_segments: number;
  total_vehicles: number;
  total_market_cap: number;
  total_etf_aum: number;
  avg_change_7d: number | null;
  avg_change_30d: number | null;
};

const formatUSD0 = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

const formatUSD2 = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

export default function MarketDashboard() {
  const navigate = useNavigate();
  const [segments, setSegments] = useState<SegmentIndexRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleInvestment[]>([]);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'etfs' | 'vehicles'>('overview');
  const [cashCents, setCashCents] = useState<number>(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const bal = await CashBalanceService.getUserBalance(session.user.id);
        setCashCents(bal?.available_cents || 0);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Load segments
        const { data: segmentData, error: segmentError } = await supabase
          .from('market_segments_index')
          .select('*')
          .order('market_cap_usd', { ascending: false });

        if (segmentError) throw segmentError;

        const normalizedSegments = (segmentData || []).map((r: any) => ({
          segment_id: r.segment_id,
          slug: r.slug,
          name: r.name,
          description: r.description ?? null,
          manager_type: r.manager_type,
          vehicle_count: Number(r.vehicle_count || 0),
          market_cap_usd: Number(r.market_cap_usd || 0),
          change_7d_pct: r.change_7d_pct === null ? null : Number(r.change_7d_pct),
          change_30d_pct: r.change_30d_pct === null ? null : Number(r.change_30d_pct),
          fund_id: r.fund_id ?? null,
          fund_symbol: r.fund_symbol ?? null,
          nav_share_price: r.nav_share_price === null ? null : Number(r.nav_share_price),
          total_aum_usd: r.total_aum_usd === null ? null : Number(r.total_aum_usd)
        })) as SegmentIndexRow[];

        setSegments(normalizedSegments);

        // Calculate overview
        const totalSegments = normalizedSegments.length;
        const totalVehicles = normalizedSegments.reduce((sum, s) => sum + s.vehicle_count, 0);
        const totalMarketCap = normalizedSegments.reduce((sum, s) => sum + s.market_cap_usd, 0);
        const totalEtfAum = normalizedSegments.reduce((sum, s) => sum + (s.total_aum_usd || 0), 0);
        
        const changes7d = normalizedSegments.map(s => s.change_7d_pct).filter((v): v is number => v !== null);
        const changes30d = normalizedSegments.map(s => s.change_30d_pct).filter((v): v is number => v !== null);
        
        const avgChange7d = changes7d.length > 0 ? changes7d.reduce((sum, v) => sum + v, 0) / changes7d.length : null;
        const avgChange30d = changes30d.length > 0 ? changes30d.reduce((sum, v) => sum + v, 0) / changes30d.length : null;

        setOverview({
          total_segments: totalSegments,
          total_vehicles: totalVehicles,
          total_market_cap: totalMarketCap,
          total_etf_aum: totalEtfAum,
          avg_change_7d: avgChange7d,
          avg_change_30d: avgChange30d
        });

        // Load vehicles with investment opportunities
        const { data: vehicleData, error: vehicleError } = await supabase
          .from('vehicles')
          .select(`
            id,
            make,
            model,
            year,
            current_value,
            is_public
          `)
          .eq('is_public', true)
          .not('current_value', 'is', null)
          .order('current_value', { ascending: false })
          .limit(50);

        if (vehicleError) throw vehicleError;

        const vehicleIds = (vehicleData || []).map((v: any) => v.id);

        // Check for active funding rounds
        const { data: fundingRoundsData } = await supabase
          .from('vehicle_funding_rounds')
          .select('vehicle_id')
          .in('vehicle_id', vehicleIds)
          .in('status', ['fundraising', 'active', 'funded', 'building']);

        const vehiclesWithFundingRounds = new Set(
          (fundingRoundsData || []).map((r: any) => r.vehicle_id)
        );

        // Check for active bonds
        const { data: bondsData } = await supabase
          .from('vehicle_bonds')
          .select('vehicle_id')
          .in('vehicle_id', vehicleIds)
          .eq('status', 'active');

        const vehiclesWithBonds = new Set(
          (bondsData || []).map((b: any) => b.vehicle_id)
        );

        // Check for active listings (for sale)
        const { data: listingsData } = await supabase
          .from('market_listings')
          .select('vehicle_id')
          .in('vehicle_id', vehicleIds)
          .eq('status', 'active');

        const vehiclesForSale = new Set(
          (listingsData || []).map((l: any) => l.vehicle_id)
        );

        // Map vehicles with investment opportunities
        const vehiclesWithInvestments = (vehicleData || []).map((v: any) => ({
          id: v.id,
          make: v.make || 'Unknown',
          model: v.model || 'Unknown',
          year: v.year,
          current_value: Number(v.current_value || 0),
          has_funding_round: vehiclesWithFundingRounds.has(v.id),
          has_shares: false, // TODO: check vehicle_shares table if it exists
          has_bonds: vehiclesWithBonds.has(v.id),
          is_for_sale: vehiclesForSale.has(v.id)
        })) as VehicleInvestment[];

        setVehicles(vehiclesWithInvestments);
      } catch (e: any) {
        console.error('Failed to load market dashboard:', e);
        setError(e?.message || 'Failed to load market dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredSegments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.fund_symbol || '').toLowerCase().includes(q)
    );
  }, [segments, query]);

  const filteredVehicles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      v.make.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q) ||
      `${v.year}`.includes(q)
    );
  }, [vehicles, query]);

  const tileBg = (pct: number | null) => {
    if (pct === null) return 'rgba(0,0,0,0.03)';
    if (pct > 0) return 'rgba(16, 185, 129, 0.14)';
    if (pct < 0) return 'rgba(220, 38, 38, 0.14)';
    return 'rgba(0,0,0,0.03)';
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading market dashboard...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '16pt', fontWeight: 900 }}>Market Dashboard</h1>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              View all submarkets, invest in ETFs, and discover individual vehicle opportunities
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              Portfolio
            </button>
            <button className="button button-secondary" onClick={() => navigate('/')}>
              Back
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: '16px', padding: '12px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 800, marginBottom: '6px' }}>Error</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{error}</div>
          </div>
        )}

        {/* Market Overview Stats */}
        {overview && (
          <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">Total Segments</h3>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '20pt', fontWeight: 900 }}>{overview.total_segments}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Active submarkets</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">Total Vehicles</h3>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '20pt', fontWeight: 900 }}>{overview.total_vehicles.toLocaleString()}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>In market</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">Market Cap</h3>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '20pt', fontWeight: 900 }}>{formatUSD0(overview.total_market_cap)}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Total value</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">ETF AUM</h3>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '20pt', fontWeight: 900 }}>{formatUSD0(overview.total_etf_aum)}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Assets under management</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">7d Change</h3>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '20pt', fontWeight: 900 }}>{formatPct(overview.avg_change_7d)}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Average segment</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">30d Change</h3>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '20pt', fontWeight: 900 }}>{formatPct(overview.avg_change_30d)}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Average segment</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', borderBottom: '2px solid var(--border)' }}>
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'overview' ? '2px solid var(--primary)' : '2px solid transparent',
              color: activeTab === 'overview' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'overview' ? 800 : 400,
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('etfs')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'etfs' ? '2px solid var(--primary)' : '2px solid transparent',
              color: activeTab === 'etfs' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'etfs' ? 800 : 400,
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            ETFs ({segments.filter(s => s.fund_symbol).length})
          </button>
          <button
            onClick={() => setActiveTab('vehicles')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'vehicles' ? '2px solid var(--primary)' : '2px solid transparent',
              color: activeTab === 'vehicles' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'vehicles' ? 800 : 400,
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            Individual Vehicles ({vehicles.length})
          </button>
        </div>

        {/* Search */}
        <div style={{ marginBottom: '16px' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={activeTab === 'vehicles' ? 'Search vehicles...' : 'Search segments/ETFs...'}
            style={{
              border: '2px solid var(--border)',
              borderRadius: '4px',
              padding: '8px 12px',
              width: '100%',
              maxWidth: '400px',
              background: 'var(--white)',
              color: 'var(--text)'
            }}
          />
        </div>

        {/* Cash Balance */}
        <div style={{ marginBottom: '16px', padding: '10px', background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: '4px', fontSize: '9pt' }}>
          <strong>Available Cash:</strong> {formatUSD2(cashCents / 100)}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div>
            <h2 style={{ fontSize: '12pt', marginBottom: '16px', fontWeight: 800 }}>All Submarkets</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {filteredSegments.map((s) => (
                <button
                  key={s.segment_id}
                  onClick={() => navigate(`/market/segments/${s.slug}`)}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '14px',
                    border: '2px solid var(--border)',
                    borderRadius: '4px',
                    background: tileBg(s.change_7d_pct),
                    transition: 'transform 0.12s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 900, fontSize: '11pt' }}>{s.name}</div>
                    <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{s.manager_type.toUpperCase()}</div>
                  </div>
                  {s.fund_symbol && (
                    <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                      ETF: <strong style={{ color: 'var(--text)' }}>{s.fund_symbol}</strong>
                      {s.nav_share_price && ` @ ${formatUSD2(s.nav_share_price)}`}
                    </div>
                  )}
                  <div style={{ marginTop: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                    {s.vehicle_count.toLocaleString()} vehicles • {formatUSD0(s.market_cap_usd)} market cap
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>7d</div>
                    <div style={{ fontWeight: 900 }}>{formatPct(s.change_7d_pct)}</div>
                  </div>
                  <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>30d</div>
                    <div style={{ fontWeight: 900 }}>{formatPct(s.change_30d_pct)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'etfs' && (
          <div>
            <h2 style={{ fontSize: '12pt', marginBottom: '16px', fontWeight: 800 }}>Available ETFs</h2>
            {filteredSegments.filter(s => s.fund_symbol).length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No ETFs available
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {filteredSegments.filter(s => s.fund_symbol).map((s) => (
                  <button
                    key={s.segment_id}
                    onClick={() => navigate(`/market/exchange/${s.fund_symbol}`)}
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '14px',
                      border: '2px solid var(--border)',
                      borderRadius: '4px',
                      background: tileBg(s.change_7d_pct),
                      transition: 'transform 0.12s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 900, fontSize: '12pt' }}>{s.fund_symbol}</div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{s.manager_type.toUpperCase()}</div>
                    </div>
                    <div style={{ marginTop: '6px', fontWeight: 700 }}>{s.name}</div>
                    {s.nav_share_price && (
                      <div style={{ marginTop: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                        NAV: <strong style={{ color: 'var(--text)' }}>{formatUSD2(s.nav_share_price)}</strong>
                      </div>
                    )}
                    {s.total_aum_usd && (
                      <div style={{ marginTop: '4px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                        AUM: {formatUSD0(s.total_aum_usd)}
                      </div>
                    )}
                    <div style={{ marginTop: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                      {s.vehicle_count.toLocaleString()} vehicles • {formatUSD0(s.market_cap_usd)} market cap
                    </div>
                    <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>7d</div>
                      <div style={{ fontWeight: 900 }}>{formatPct(s.change_7d_pct)}</div>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>30d</div>
                      <div style={{ fontWeight: 900 }}>{formatPct(s.change_30d_pct)}</div>
                    </div>
                    <div style={{ marginTop: '10px', padding: '8px', background: 'var(--primary)', color: 'var(--white)', borderRadius: '4px', textAlign: 'center', fontSize: '9pt', fontWeight: 800 }}>
                      INVEST
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'vehicles' && (
          <div>
            <h2 style={{ fontSize: '12pt', marginBottom: '16px', fontWeight: 800 }}>Individual Vehicle Investments</h2>
            {filteredVehicles.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No vehicles available
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {filteredVehicles.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => navigate(`/vehicle/${v.id}`)}
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '14px',
                      border: '2px solid var(--border)',
                      borderRadius: '4px',
                      background: 'var(--white)',
                      transition: 'transform 0.12s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                  >
                    <div style={{ fontWeight: 900, fontSize: '11pt' }}>
                      {v.year} {v.make} {v.model}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '12pt', fontWeight: 800 }}>
                      {formatUSD0(v.current_value)}
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                      {v.has_funding_round && <div>• Funding Round Available</div>}
                      {v.has_shares && <div>• Shares Trading</div>}
                      {v.has_bonds && <div>• Bonds Available</div>}
                      {v.is_for_sale && <div>• For Sale</div>}
                      {!v.has_funding_round && !v.has_shares && !v.has_bonds && !v.is_for_sale && (
                        <div style={{ color: 'var(--text-muted)' }}>View vehicle for investment options</div>
                      )}
                    </div>
                    <div style={{ marginTop: '10px', padding: '8px', background: 'var(--primary)', color: 'var(--white)', borderRadius: '4px', textAlign: 'center', fontSize: '9pt', fontWeight: 800 }}>
                      VIEW VEHICLE
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

