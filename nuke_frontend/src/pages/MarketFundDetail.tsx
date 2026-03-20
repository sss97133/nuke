import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { CashBalanceService } from '../services/cashBalanceService';

type FundRow = {
  id: string;
  symbol: string;
  nav_share_price: number;
  total_shares_outstanding: number;
  total_aum_usd: number;
  segment_id: string;
  segment?: {
    name: string;
    description: string | null;
    manager_type: string;
    year_min: number | null;
    year_max: number | null;
    makes: string[] | null;
    model_keywords: string[] | null;
  };
  stats?: {
    vehicle_count: number;
    market_cap_usd: number;
    change_7d_pct: number | null;
    change_30d_pct: number | null;
    stats_updated_at: string | null;
  };
};

type HoldingVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  sale_price: number | null;
  thumbnail: string | null;
};

const EXCHANGE_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-v1-exchange`;

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

const formatLargeUSD = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

function SkeletonBlock({ width = '100%', height = '16px' }: { width?: string; height?: string }) {
  return (
    <div style={{
      width,
      height,
      background: 'var(--border)',
      animation: 'pulse 1.5s ease-in-out infinite',
    }} />
  );
}

export default function MarketFundDetail() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const { session, user } = useAuth();

  const [fund, setFund] = useState<FundRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cashCents, setCashCents] = useState<number>(0);
  const [amount, setAmount] = useState<string>('100');
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<HoldingVehicle[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  const parsedAmountUSD = useMemo(() => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }, [amount]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setNotFound(false);
        setError(null);
        setSuccess(null);

        if (!symbol) {
          setNotFound(true);
          return;
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`${EXCHANGE_API}?action=fund&symbol=${encodeURIComponent(symbol)}`, { headers });
        if (!res.ok) throw new Error(`Exchange API error: ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        if (!json.fund) {
          setNotFound(true);
          return;
        }

        setFund(json.fund);
        if (user?.id) {
          const bal = await CashBalanceService.getUserBalance(user.id);
          setCashCents(bal?.available_cents || 0);
        }

        // Fetch representative vehicles from the segment universe
        if (json.fund?.segment) {
          fetchHoldings(json.fund.segment).catch(() => {});
        }
      } catch (e: any) {
        console.error('Failed to load market fund:', e);
        setError('Unable to load fund data. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [symbol, session]);

  const fetchHoldings = async (seg: NonNullable<FundRow['segment']>) => {
    setHoldingsLoading(true);
    try {
      const { makes, year_min, year_max, model_keywords } = seg;

      // Build query for vehicles matching segment criteria
      let q = supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, vehicle_images(url, is_primary)')
        .not('sale_price', 'is', null)
        .order('sale_price', { ascending: false })
        .limit(48);

      if (makes && makes.length > 0) q = q.in('make', makes);
      if (year_min) q = q.gte('year', year_min);
      if (year_max) q = q.lte('year', year_max);
      if (model_keywords && model_keywords.length > 0) {
        const orFilter = model_keywords.map(kw => `model.ilike.%${kw}%`).join(',');
        q = q.or(orFilter);
      }

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;

      const processed: HoldingVehicle[] = (data || []).map((v: any) => {
        const images: { url: string; is_primary: boolean }[] = v.vehicle_images || [];
        const primary = images.find(i => i.is_primary);
        const thumbnail = primary?.url || images[0]?.url || null;
        return { id: v.id, year: v.year, make: v.make, model: v.model, sale_price: v.sale_price, thumbnail };
      });

      setHoldings(processed.slice(0, 12));
    } catch (e) {
      console.error('Failed to load holdings:', e);
    } finally {
      setHoldingsLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!fund) return;
    if (!parsedAmountUSD) {
      setError('Enter a valid dollar amount');
      return;
    }

    const amountCents = Math.round(parsedAmountUSD * 100);
    if (amountCents > cashCents) {
      setError(`Insufficient balance. You have ${formatUSD2(cashCents / 100)} available.`);
      return;
    }

    try {
      setBuying(true);
      setError(null);
      setSuccess(null);

      const { data, error: rpcError } = await supabase.rpc('market_fund_buy', {
        p_fund_id: fund.id,
        p_amount_cents: amountCents,
      });
      if (rpcError) throw rpcError;

      const first = Array.isArray(data) ? data[0] : data;
      const sharesIssued = Number(first?.shares_issued || 0).toFixed(6);
      setSuccess(
        `Invested ${formatUSD2(amountCents / 100)} into ${fund.symbol}. ${sharesIssued} shares issued at NAV ${fund.nav_share_price.toFixed(4)}.`
      );

      if (user?.id) {
        const bal = await CashBalanceService.getUserBalance(user.id);
        setCashCents(bal?.available_cents || 0);
      }
    } catch (e: any) {
      console.error('Fund buy failed:', e);
      setError(e?.message || 'Investment failed. Please try again.');
    } finally {
      setBuying(false);
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: '8px', width: '300px' }}>
              <SkeletonBlock height="28px" width="160px" />
              <SkeletonBlock height="14px" width="220px" />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <SkeletonBlock width="80px" height="34px" />
              <SkeletonBlock width="90px" height="34px" />
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <SkeletonBlock height="80px" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {[1, 2].map(i => (
              <div key={i} className="card">
                <div className="card-body" style={{ display: 'grid', gap: '10px' }}>
                  <SkeletonBlock height="14px" width="60%" />
                  <SkeletonBlock height="12px" />
                  <SkeletonBlock height="12px" width="80%" />
                  <SkeletonBlock height="12px" width="70%" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Not found
  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--fs-11)', fontWeight: 800, marginBottom: '10px' }}>
            Fund Not Found
          </div>
          <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', marginBottom: '24px' }}>
            The fund "{symbol}" doesn't exist or is no longer active.
          </div>
          <button className="button button-primary" onClick={() => navigate('/market/segments')}>
            Back to Exchange
          </button>
        </div>
      </div>
    );
  }

  // Error with no fund loaded
  if (error && !fund) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--fs-11)', fontWeight: 800, marginBottom: '10px' }}>
            Unable to Load Fund
          </div>
          <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', marginBottom: '24px' }}>
            {error}
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button className="button button-primary" onClick={() => window.location.reload()}>
              Try Again
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/segments')}>
              Back to Exchange
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!fund) return null;

  const seg = fund.segment;
  const pct7d = fund.stats?.change_7d_pct ?? null;
  const pct30d = fund.stats?.change_30d_pct ?? null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gap: '14px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 'var(--fs-12)', fontWeight: 900 }}>{fund.symbol}</h1>
              <span style={{
                fontSize: 'var(--fs-8)',
                color: 'var(--text-secondary)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                padding: '2px 6px',
              }}>
                {seg?.manager_type ? seg.manager_type.toUpperCase() : 'AI'} ETF
              </span>
            </div>
            <div style={{ marginTop: '6px', fontWeight: 800, fontSize: 'var(--fs-11)' }}>{seg?.name || 'Market Fund'}</div>
            {seg?.description && (
              <div style={{ marginTop: '6px', fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', maxWidth: '500px' }}>
                {seg.description}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/segments')}>
              Back
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              Portfolio
            </button>
          </div>
        </div>

        {/* NAV hero strip */}
        <div style={{
          padding: '20px',
          border: '2px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          gap: '32px',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}>
          <div>
            <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>NAV per Share</div>
            <div style={{ fontSize: 'var(--fs-12)', fontWeight: 900 }}>${fund.nav_share_price.toFixed(4)}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>7-Day</div>
            <div style={{
              fontSize: 'var(--fs-12)',
              fontWeight: 800,
              color: pct7d === null ? 'var(--text-secondary)' : pct7d > 0 ? 'var(--success)' : pct7d < 0 ? 'var(--error)' : 'var(--text)',
            }}>
              {formatPct(pct7d)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>30-Day</div>
            <div style={{
              fontSize: 'var(--fs-12)',
              fontWeight: 800,
              color: pct30d === null ? 'var(--text-secondary)' : pct30d > 0 ? 'var(--success)' : pct30d < 0 ? 'var(--error)' : 'var(--text)',
            }}>
              {formatPct(pct30d)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Market Cap</div>
            <div style={{ fontSize: 'var(--fs-12)', fontWeight: 800 }}>
              {formatLargeUSD(fund?.stats?.market_cap_usd || 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Vehicles</div>
            <div style={{ fontSize: 'var(--fs-12)', fontWeight: 800 }}>
              {(fund?.stats?.vehicle_count || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Holdings section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: 'var(--fs-10)', fontWeight: 800 }}>Fund Holdings</span>
              <span style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginLeft: '10px' }}>
                {fund.stats?.vehicle_count
                  ? `${fund.stats.vehicle_count.toLocaleString()} vehicles tracked in index`
                  : 'Representative sample'}
              </span>
            </div>
            {holdings.length > 0 && (
              <span style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>
                Showing top {holdings.length} by sale price
              </span>
            )}
          </div>

          {holdingsLoading ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '10px',
            }}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} style={{
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  background: 'var(--surface)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}>
                  <div style={{ height: '120px', background: 'var(--border)' }} />
                  <div style={{ padding: '10px', display: 'grid', gap: '6px' }}>
                    <div style={{ height: '12px', background: 'var(--border)', width: '80%' }} />
                    <div style={{ height: '10px', background: 'var(--border)', width: '50%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : holdings.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '10px',
            }}>
              {holdings.map(v => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/vehicle/${v.id}`)}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    background: 'var(--surface)',
                    padding: 0,
                    display: 'block',
                    width: '100%',
                    transition: 'border-color 0.12s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--primary)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  {/* Image */}
                  <div style={{
                    height: '120px',
                    background: 'var(--bg)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}>
                    {v.thumbnail ? (
                      <img
                        src={v.thumbnail}
                        alt={`${v.year} ${v.make} ${v.model}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--fs-9)',
                        color: 'var(--text-secondary)',
                        fontWeight: 700,
                      }}>
                        {v.year} {v.make}
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div style={{ padding: '10px' }}>
                    <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, lineHeight: 1.3, marginBottom: '4px' }}>
                      {v.year} {v.make} {v.model}
                    </div>
                    {v.sale_price ? (
                      <div style={{ fontSize: 'var(--fs-9)', color: 'var(--success)', fontWeight: 800 }}>
                        {formatUSD0(v.sale_price)}
                      </div>
                    ) : (
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>—</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 'var(--fs-9)',
              color: 'var(--text-secondary)',
            }}>
              No vehicles currently match this segment's criteria.
            </div>
          )}
        </div>

        {/* Cards row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>

          {/* Fund Composition */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Fund Composition</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '10px', fontSize: 'var(--fs-9)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Year Range</span>
                <span style={{ fontWeight: 600 }}>
                  {seg?.year_min && seg?.year_max
                    ? `${seg.year_min} – ${seg.year_max}`
                    : seg?.year_min ? `${seg.year_min}+`
                    : seg?.year_max ? `up to ${seg.year_max}`
                    : 'All years'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Makes</span>
                <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>
                  {seg?.makes?.length ? seg.makes.join(', ') : 'All makes'}
                </span>
              </div>
              {seg?.model_keywords && seg.model_keywords.length > 0 && (
                <div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>Keywords</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {seg.model_keywords.map(kw => (
                      <span key={kw} style={{
                        padding: '2px 6px',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        fontSize: 'var(--fs-8)',
                      }}>
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Management</span>
                <span style={{ fontWeight: 600 }}>
                  {seg?.manager_type === 'ai' ? 'AI-managed' : seg?.manager_type || 'AI-managed'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Fund AUM</span>
                <span style={{ fontWeight: 600 }}>{formatUSD0(fund.total_aum_usd)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Shares Outstanding</span>
                <span style={{ fontWeight: 600 }}>{fund.total_shares_outstanding.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Invest */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Invest in {fund.symbol}</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '12px' }}>
              {user ? (
                <>
                  <div style={{ fontSize: 'var(--fs-9)', display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Your cash balance</span>
                    <strong>{formatUSD2(cashCents / 100)}</strong>
                  </div>
                  <div style={{ display: 'grid', gap: '6px' }}>
                    <label style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Amount (USD)
                    </label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      style={{
                        border: '2px solid var(--border)',
                        padding: '10px',
                        background: 'var(--white)',
                        color: 'var(--text)',
                        fontSize: 'var(--fs-9)',
                      }}
                      inputMode="decimal"
                      placeholder="100"
                    />
                    {parsedAmountUSD && (
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>
                        ≈ {(parsedAmountUSD / fund.nav_share_price).toFixed(6)} shares at NAV ${fund.nav_share_price.toFixed(4)}
                      </div>
                    )}
                  </div>
                  <button
                    className="button button-primary"
                    disabled={buying || !parsedAmountUSD}
                    onClick={handleBuy}
                    style={{ width: '100%' }}
                  >
                    {buying ? 'Processing...' : `Invest ${parsedAmountUSD ? formatUSD2(parsedAmountUSD) : ''}`}
                  </button>
                  {error && (
                    <div style={{ fontSize: 'var(--fs-9)', color: 'var(--error)', padding: '10px', background: 'var(--error-dim)' }}>
                      {error}
                    </div>
                  )}
                  {success && (
                    <div style={{ fontSize: 'var(--fs-9)', color: 'var(--success)', padding: '10px', background: 'var(--success-dim)' }}>
                      {success}
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
                    Sign in to invest in {fund.symbol}. Shares are priced at current NAV, updated every 15 minutes from verified auction data.
                  </div>
                  <button
                    className="button button-primary"
                    onClick={() => navigate('/login')}
                    style={{ width: '100%' }}
                  >
                    Sign In to Invest
                  </button>
                </div>
              )}
              <div style={{
                fontSize: 'var(--fs-8)',
                color: 'var(--text-secondary)',
                paddingTop: '10px',
                borderTop: '1px solid var(--border)',
                lineHeight: 1.5,
              }}>
                Beta — pending SEC Reg A+ approval. Positions are tracked in your portfolio.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
