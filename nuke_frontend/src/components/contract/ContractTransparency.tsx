import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { formatCurrencyFromCents } from '../../utils/currency';
import { ChevronDown, ChevronRight, ExternalLink, Shield, AlertTriangle, User, Bot, Code, Briefcase } from 'lucide-react';
import DrillDown from './DrillDown';
import HoverCard, { HoverStat } from './HoverCard';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

interface ContractTransparencyProps {
  contractId: string;
  onBack: () => void;
}

// Asset type colors
const ASSET_TYPE_COLORS: Record<string, string> = {
  vehicle: '#3b82f6',
  bond: '#10b981',
  stake: '#f59e0b',
  organization: '#8b5cf6',
  real_estate: '#ef4444',
  event: '#ec4899',
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  vehicle: 'Vehicle',
  bond: 'Bond',
  stake: 'Stake',
  organization: 'Organization',
  real_estate: 'Real Estate',
  event: 'Event',
};

export default function ContractTransparency({ contractId, onBack }: ContractTransparencyProps) {
  const navigate = useNavigate();
  const [contract, setContract] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [performanceData, setPerformanceData] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [investorData, setInvestorData] = useState<any>(null);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [curatorProfile, setCuratorProfile] = useState<any>(null);
  const [curatorContracts, setCuratorContracts] = useState<any[]>([]);
  const [curatorStats, setCuratorStats] = useState<any>(null);
  const [agentInfo, setAgentInfo] = useState<any>(null);

  useEffect(() => {
    loadContractData();
    loadCurrentUser();
  }, [contractId]);

  const loadCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUser(user);
  };

  const loadContractData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load contract
      const { data: contractData, error: contractError } = await supabase
        .from('custom_investment_contracts')
        .select('*')
        .eq('id', contractId)
        .single();

      if (contractError) throw contractError;
      setContract(contractData);

      // Load assets
      const { data: assetsData, error: assetsError } = await supabase
        .from('contract_assets')
        .select('*')
        .eq('contract_id', contractId);

      if (assetsError) throw assetsError;

      // Batch-fetch asset details by type (fix N+1)
      const enrichedAssets = await batchEnrichAssets(assetsData || []);
      setAssets(enrichedAssets);

      // Load performance data
      loadPerformanceData(contractId);

      // Load curator profile + their other contracts
      if (contractData.curator_id) {
        loadCuratorProfile(contractData.curator_id, contractId);
        loadInvestorData(contractId, contractData.curator_id);
      }
    } catch (e: any) {
      console.error('Failed to load contract:', e);
      setError(e?.message || 'Failed to load contract details');
    } finally {
      setLoading(false);
    }
  };

  /** Batch-enrich assets: group by type, one query per type */
  const batchEnrichAssets = async (rawAssets: any[]): Promise<any[]> => {
    // Group asset IDs by type
    const byType: Record<string, string[]> = {};
    for (const asset of rawAssets) {
      if (!byType[asset.asset_type]) byType[asset.asset_type] = [];
      byType[asset.asset_type].push(asset.asset_id);
    }

    // One query per asset type
    const detailsMap: Record<string, any> = {};

    const fetches: Promise<void>[] = [];

    if (byType.vehicle?.length) {
      fetches.push(
        supabase
          .from('vehicles')
          .select('id, year, make, model, current_value, location, purchase_location, city, state, country, is_public, vin, purchase_price_cents, image_count, receipt_count, primary_image_url')
          .in('id', byType.vehicle)
          .then(({ data }) => {
            (data || []).forEach((v: any) => { detailsMap[v.id] = v; });
          })
      );
    }

    if (byType.organization?.length) {
      fetches.push(
        supabase
          .from('businesses')
          .select('id, business_name, business_type, city, state, country, employee_count, reputation_score')
          .in('id', byType.organization)
          .then(({ data }) => {
            (data || []).forEach((o: any) => { detailsMap[o.id] = o; });
          })
      );
    }

    if (byType.bond?.length) {
      fetches.push(
        supabase
          .from('vehicle_bonds')
          .select('id, principal_amount_cents, interest_rate_pct, term_months, status, maturity_date, issuer_name, issuer_type, collateral_description, coupon_rate_pct, payments_on_time')
          .in('id', byType.bond)
          .then(({ data }) => {
            (data || []).forEach((b: any) => { detailsMap[b.id] = b; });
          })
      );
    }

    if (byType.stake?.length) {
      fetches.push(
        supabase
          .from('vehicle_funding_rounds')
          .select('id, target_amount_cents, raised_amount_cents, profit_share_pct, status, equity_pct, target_sale_price_cents, expected_profit_cents, vehicle_id')
          .in('id', byType.stake)
          .then(({ data }) => {
            (data || []).forEach((s: any) => { detailsMap[s.id] = s; });
          })
      );
    }

    if (byType.real_estate?.length) {
      fetches.push(
        supabase
          .from('properties')
          .select('id, name, property_type, description, city, region, country, base_price, specs, metadata, status')
          .in('id', byType.real_estate)
          .then(({ data }) => {
            (data || []).forEach((p: any) => { detailsMap[p.id] = p; });
          })
      );
    }

    if (byType.event?.length) {
      fetches.push(
        supabase
          .from('community_events')
          .select('id, event_name, event_type, description, start_date, end_date, recurring, venue_name, city, state, max_capacity, registered_count, vehicle_spots, ticket_price_cents, vip_price_cents, total_revenue_cents, net_profit_cents, status')
          .in('id', byType.event)
          .then(({ data }) => {
            (data || []).forEach((e: any) => { detailsMap[e.id] = e; });
          })
      );
    }

    await Promise.all(fetches);

    return rawAssets.map(asset => ({
      ...asset,
      details: detailsMap[asset.asset_id] || null,
    }));
  };

  const loadPerformanceData = async (cId: string) => {
    try {
      const { data } = await supabase
        .from('contract_performance')
        .select('*')
        .eq('contract_id', cId)
        .order('recorded_at', { ascending: true });
      setPerformanceData(data || []);
    } catch {
      // Performance data may not exist yet
    }
  };

  const loadCuratorProfile = async (curatorId: string, currentContractId: string) => {
    try {
      const [profileRes, contractsRes, statsRes, agentRes] = await Promise.all([
        // Curator's profile
        supabase
          .from('profiles')
          .select('id, username, full_name, bio, avatar_url, location, user_type, is_verified, created_at, verification_level')
          .eq('id', curatorId)
          .single(),
        // Their other contracts
        supabase
          .from('custom_investment_contracts')
          .select('id, contract_name, contract_symbol, contract_type, status, total_assets_under_management_cents, total_return_pct')
          .eq('curator_id', curatorId)
          .neq('id', currentContractId)
          .order('created_at', { ascending: false })
          .limit(10),
        // Profile stats
        supabase
          .from('profile_stats')
          .select('total_vehicles, total_images, total_contributions, reputation_score, followers_count, profile_views')
          .eq('user_id', curatorId)
          .single(),
        // Check if curator matches an agent (by name or profile user_type)
        supabase
          .from('agent_registry')
          .select('id, name, focus, capabilities, prompt_template')
          .then(({ data: agents }) => {
            // Match by curator name or by profile later
            const match = (agents || []).find((a: any) =>
              a.name.toLowerCase() === (contractData.curator_name || '').toLowerCase() ||
              a.id.toLowerCase() === (contractData.curator_name || '').toLowerCase()
            );
            return { data: match || null, error: null };
          }) as any,
      ]);

      if (profileRes.data) setCuratorProfile(profileRes.data);
      if (contractsRes.data) setCuratorContracts(contractsRes.data);
      if (statsRes.data) setCuratorStats(statsRes.data);
      // Agent check: if the curator's profile username matches an agent or if curator_name matches
      if (agentRes.data) setAgentInfo(agentRes.data);
    } catch {
      // Non-critical — curator info is supplemental
    }
  };

  const loadInvestorData = async (cId: string, curatorId: string) => {
    // Only load if current user is curator
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== curatorId) return;

    try {
      const [investorsRes, txRes] = await Promise.all([
        supabase
          .from('contract_investors')
          .select('*')
          .eq('contract_id', cId)
          .order('created_at', { ascending: false }),
        supabase
          .from('contract_transactions')
          .select('*')
          .eq('contract_id', cId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (investorsRes.data) {
        const investors = investorsRes.data;
        const totalShares = investors.reduce((s: number, i: any) => s + (i.shares_owned || 0), 0);
        const recentSubs = investors.filter((i: any) => {
          const d = new Date(i.created_at);
          return d > new Date(Date.now() - 30 * 86400000);
        }).length;
        setInvestorData({
          count: investors.length,
          totalShares,
          recentSubscriptions: recentSubs,
        });
      }

      setRecentTransactions(txRes.data || []);
    } catch {
      // Investor tables may not exist yet
    }
  };

  const formatPct = (pct: number) => pct ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '0.00%';

  const maskVin = (vin: string | null) => {
    if (!vin || vin.length < 6) return vin || '—';
    return vin.slice(0, 3) + '***' + vin.slice(-4);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: '12px' }}>
        Loading contract details...
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="card">
        <div className="card-body" style={{ color: 'var(--danger, #ef4444)', fontSize: '12px' }}>
          {error || 'Contract not found'}
          <div style={{ marginTop: '12px' }}>
            <button className="button button-secondary" onClick={onBack}>
              Back to Marketplace
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalValue = assets.reduce((sum, a) => sum + (a.current_value_cents || 0), 0);

  // Compute allocation breakdown by asset type
  const allocationByType: Record<string, number> = {};
  for (const asset of assets) {
    const t = asset.asset_type;
    allocationByType[t] = (allocationByType[t] || 0) + (asset.current_value_cents || 0);
  }

  const isCurator = currentUser && contract.curator_id === currentUser.id;

  return (
    <div
      data-contract-id={contract.id}
      data-contract-symbol={contract.contract_symbol}
      data-contract-type={contract.contract_type}
      data-contract-status={contract.status}
      data-regulatory={contract.regulatory_status}
      data-transparency={contract.transparency_level}
      data-curator-id={contract.curator_id}
      role="main"
      aria-label={`Contract: ${contract.contract_name}`}
    >
      {/* Contract Header */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <h1 style={{ margin: 0, fontSize: '21px', fontWeight: 900 }}>
                  {contract.contract_name}
                </h1>
                <span style={{
                  padding: '4px 8px',
                  background: contract.status === 'active' ? 'var(--success, #10b981)' : 'var(--text-muted)',
                  color: 'var(--white)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  {contract.status}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>{contract.contract_symbol}</span>
                <span>•</span>
                <DrillDown concept={contract.contract_type} value={contract.contract_type}>
                  {contract.contract_type.replace('_', ' ').toUpperCase()}
                </DrillDown>
                <span>•</span>
                <DrillDown concept={contract.regulatory_status} value={contract.regulatory_status}>
                  {contract.regulatory_status?.replace('_', ' ').toUpperCase() || 'UNREGISTERED'}
                </DrillDown>
                <span>•</span>
                <DrillDown concept={contract.risk_level || 'moderate'} value={contract.risk_level}>
                  {(contract.risk_level || 'moderate').toUpperCase()} RISK
                </DrillDown>
                <span>•</span>
                <span>Curated by {contract.curator_name || 'Unknown'}</span>
              </div>
              {contract.contract_description && (
                <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: '16px' }}>
                  {contract.contract_description}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
              <button className="button button-primary" onClick={() => navigate(`/market/exchange/${contract.contract_symbol}`)}>
                INVEST NOW
              </button>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right' }}>
                Min: {formatCurrencyFromCents(contract.minimum_investment_cents)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Management — Who's Behind This Contract */}
      <CuratorPanel
        contract={contract}
        curatorProfile={curatorProfile}
        curatorContracts={curatorContracts}
        curatorStats={curatorStats}
        agentInfo={agentInfo}
        onSelectContract={(id: string) => { navigate(`/market/contracts/${id}`); window.scrollTo(0, 0); }}
      />

      {/* Contract Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Total Assets</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '24px', fontWeight: 900 }}>{assets.length}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Underlying assets</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Total Value</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '24px', fontWeight: 900 }}>{formatCurrencyFromCents(totalValue)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Portfolio value</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">AUM</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '24px', fontWeight: 900 }}>{formatCurrencyFromCents(contract.total_assets_under_management_cents)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Assets under management</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Investors</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '24px', fontWeight: 900 }}>{contract.total_investors || 0}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Active investors</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Performance</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '24px', fontWeight: 900, color: contract.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
              {formatPct(contract.total_return_pct)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Total return</div>
          </div>
        </div>
      </div>

      {/* Performance Chart */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Performance History</h3>
        </div>
        <div className="card-body">
          {performanceData.length > 1 ? (
            <>
              <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {contract.daily_return_pct != null && (
                  <MetricPill label="Daily" value={formatPct(contract.daily_return_pct)} positive={contract.daily_return_pct >= 0} />
                )}
                {contract.ytd_return_pct != null && (
                  <MetricPill label="YTD" value={formatPct(contract.ytd_return_pct)} positive={contract.ytd_return_pct >= 0} />
                )}
                {contract.annualized_return_pct != null && (
                  <MetricPill label="Annualized" value={formatPct(contract.annualized_return_pct)} positive={contract.annualized_return_pct >= 0} />
                )}
                {contract.volatility_pct != null && (
                  <MetricPill label="Volatility" value={`${contract.volatility_pct.toFixed(2)}%`} />
                )}
                {contract.sharpe_ratio != null && (
                  <MetricPill label="Sharpe" value={contract.sharpe_ratio.toFixed(2)} />
                )}
                {contract.max_drawdown_pct != null && (
                  <MetricPill label="Max Drawdown" value={`${contract.max_drawdown_pct.toFixed(2)}%`} positive={false} />
                )}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={performanceData}>
                  <defs>
                    <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="recorded_at"
                    tick={{ fill: '#71717a', fontSize: 9 }}
                    tickFormatter={(d: string) => d ? d.slice(5, 10) : ''}
                  />
                  <YAxis
                    tick={{ fill: '#71717a', fontSize: 9 }}
                    tickFormatter={(v: number) => formatCurrencyFromCents(v, { maximumFractionDigits: 0 })}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '12px' }}
                    formatter={(value: number) => [formatCurrencyFromCents(value), 'NAV']}
                    labelFormatter={(label: string) => label ? new Date(label).toLocaleDateString() : ''}
                  />
                  <Area type="monotone" dataKey="nav_cents" stroke="#3b82f6" fill="url(#navGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '12px' }}>
              Performance tracking begins when contract goes active.
            </div>
          )}
        </div>
      </div>

      {/* Contract Terms */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Contract Terms</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>Investment Terms</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '16px' }}>
                <strong>Minimum:</strong> {formatCurrencyFromCents(contract.minimum_investment_cents)}<br />
                {contract.maximum_investment_cents && <><strong>Maximum:</strong> {formatCurrencyFromCents(contract.maximum_investment_cents)}<br /></>}
                <strong>Liquidity:</strong> {contract.liquidity_type}<br />
                {contract.lockup_period_days && <><strong>Lockup:</strong> {contract.lockup_period_days} days<br /></>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>Fee Structure</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '16px' }}>
                <strong>Management:</strong> {contract.management_fee_pct}% annually<br />
                {contract.performance_fee_pct > 0 && <><strong>Performance:</strong> {contract.performance_fee_pct}%<br /></>}
                <strong>Transaction:</strong> {contract.transaction_fee_pct}%<br />
                {contract.setup_fee_cents > 0 && <><strong>Setup:</strong> {formatCurrencyFromCents(contract.setup_fee_cents)}<br /></>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>Legal Structure</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '20px' }}>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Entity:</strong>
                  <DrillDown concept={contract.legal_entity_type} value={contract.legal_entity_type}>
                    {contract.legal_entity_type.replace('_', ' ').toUpperCase()}
                  </DrillDown>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Jurisdiction:</strong>
                  <span>{contract.jurisdiction}</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Regulatory:</strong>
                  <DrillDown concept={contract.regulatory_status} value={contract.regulatory_status}>
                    {contract.regulatory_status.replace('_', ' ').toUpperCase()}
                  </DrillDown>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Transparency:</strong>
                  <DrillDown concept={contract.transparency_level} value={contract.transparency_level}>
                    {contract.transparency_level.toUpperCase()}
                  </DrillDown>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Allocation Visualization */}
      {assets.length > 0 && totalValue > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h3 className="heading-3">Asset Allocation</h3>
          </div>
          <div className="card-body">
            {/* Stacked bar */}
            <div style={{ display: 'flex', height: '32px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
              {Object.entries(allocationByType).map(([type, valueCents]) => {
                const pct = (valueCents / totalValue) * 100;
                if (pct < 0.5) return null;
                return (
                  <div
                    key={type}
                    style={{
                      width: `${pct}%`,
                      background: ASSET_TYPE_COLORS[type] || '#6b7280',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: '11px',
                      fontWeight: 700,
                      minWidth: pct > 8 ? undefined : '0',
                    }}
                    title={`${ASSET_TYPE_LABELS[type] || type}: ${pct.toFixed(1)}%`}
                  >
                    {pct > 8 ? `${pct.toFixed(0)}%` : ''}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {Object.entries(allocationByType).map(([type, valueCents]) => {
                const pct = (valueCents / totalValue) * 100;
                return (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: ASSET_TYPE_COLORS[type] || '#6b7280' }} />
                    <span style={{ color: 'var(--text-muted)' }}>
                      {ASSET_TYPE_LABELS[type] || type} — {pct.toFixed(1)}% ({formatCurrencyFromCents(valueCents)})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Underlying Assets - Full Transparency */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Underlying Assets - Full Transparency</h3>
        </div>
        <div className="card-body">
          {assets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No assets in this contract yet.
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '24px 2fr 1fr 1fr 1fr 80px',
                gap: '12px',
                fontSize: '12px',
                fontWeight: 700,
                padding: '12px 8px',
                borderBottom: '2px solid var(--border)',
                color: 'var(--text-muted)',
                marginBottom: '4px'
              }}>
                <div></div>
                <div>ASSET</div>
                <div>VALUE</div>
                <div>ALLOCATION</div>
                <div>PERFORMANCE</div>
                <div>ACTION</div>
              </div>

              {assets.map((asset) => {
                const allocationPct = totalValue > 0 ? ((asset.current_value_cents || 0) / totalValue * 100) : 0;
                const assetName = getAssetName(asset);
                const isExpanded = expandedAssetId === asset.id;

                return (
                  <div key={asset.id}>
                    {/* Asset Row */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 2fr 1fr 1fr 1fr 80px',
                        gap: '12px',
                        fontSize: '12px',
                        padding: '12px 8px',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease',
                        background: isExpanded ? 'var(--surface)' : 'transparent',
                      }}
                      onClick={() => setExpandedAssetId(isExpanded ? null : asset.id)}
                      onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'var(--surface)'; }}
                      onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      <AssetHoverPreview asset={asset}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {/* Inline thumbnail for vehicles */}
                          {asset.asset_type === 'vehicle' && asset.details?.primary_image_url ? (
                            <div style={{
                              width: '36px', height: '27px', borderRadius: '3px', overflow: 'hidden',
                              flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)',
                            }}>
                              <img
                                src={asset.details.primary_image_url.includes('/storage/v1/object/public/')
                                  ? asset.details.primary_image_url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=100&quality=60'
                                  : asset.details.primary_image_url}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </div>
                          ) : (
                            <div style={{
                              width: '27px', height: '27px', borderRadius: '3px', flexShrink: 0,
                              background: ASSET_TYPE_COLORS[asset.asset_type] || '#6b7280',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontSize: '12px', fontWeight: 900,
                            }}>
                              {asset.asset_type === 'bond' ? 'B' : asset.asset_type === 'stake' ? 'S' :
                               asset.asset_type === 'organization' ? (asset.details?.business_name || 'O').charAt(0).toUpperCase() :
                               asset.asset_type === 'real_estate' ? '\u2302' : asset.asset_type === 'event' ? '\u2605' : '?'}
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13px' }}>{assetName}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{
                                display: 'inline-block',
                                width: '8px',
                                height: '8px',
                                borderRadius: '2px',
                                background: ASSET_TYPE_COLORS[asset.asset_type] || '#6b7280',
                              }} />
                              {asset.asset_type.toUpperCase()} • {asset.curator_notes || 'No notes'}
                            </div>
                          </div>
                        </div>
                      </AssetHoverPreview>

                      <div style={{ fontWeight: 700 }}>
                        {formatCurrencyFromCents(asset.current_value_cents || 0)}
                      </div>

                      <div>
                        {asset.allocation_pct ? `${asset.allocation_pct.toFixed(1)}%` : `${allocationPct.toFixed(1)}%`}
                      </div>

                      <div style={{ color: (asset.unrealized_gain_loss_pct || 0) >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                        {formatPct(asset.unrealized_gain_loss_pct || 0)}
                      </div>

                      <div>
                        {asset.asset_type === 'vehicle' && asset.details && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/vehicle/${asset.asset_id}`); }}
                            style={{
                              padding: '4px 8px',
                              border: '1px solid var(--primary)',
                              borderRadius: '2px',
                              background: 'var(--primary)',
                              color: 'var(--white)',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            VIEW <ExternalLink size={10} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Detail Panel */}
                    {isExpanded && (
                      <div style={{
                        padding: '16px 16px 16px 44px',
                        background: 'var(--surface)',
                        borderBottom: '1px solid var(--border)',
                        fontSize: '12px',
                      }}>
                        <AssetDetailPanel asset={asset} navigate={navigate} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Curator: Investor Position Summary */}
      {isCurator && investorData && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={14} />
              <h3 className="heading-3" style={{ margin: 0 }}>Investor Position Summary</h3>
              <span style={{
                padding: '2px 6px',
                background: 'var(--primary)',
                color: 'var(--white)',
                borderRadius: '4px',
                fontSize: '9px',
                fontWeight: 700,
              }}>CURATOR VIEW</span>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Investors</div>
                <div style={{ fontSize: '21px', fontWeight: 900 }}>{investorData.count}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Shares Outstanding</div>
                <div style={{ fontSize: '21px', fontWeight: 900 }}>{investorData.totalShares.toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>New (30d)</div>
                <div style={{ fontSize: '21px', fontWeight: 900 }}>{investorData.recentSubscriptions}</div>
              </div>
            </div>

            {recentTransactions.length > 0 && (
              <>
                <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  Recent Transactions
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {recentTransactions.map((tx: any) => (
                    <div key={tx.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                    }}>
                      <span style={{
                        color: tx.transaction_type === 'subscription' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}>
                        {tx.transaction_type}
                      </span>
                      <span>{formatCurrencyFromCents(tx.amount_cents)}</span>
                      <span>{tx.shares_amount?.toLocaleString() || '—'} shares</span>
                      <span>{new Date(tx.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <button className="button button-secondary" onClick={onBack}>
          Back to Marketplace
        </button>
      </div>
    </div>
  );
}

/** Small metric pill for performance stats */
function MetricPill({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{
        fontSize: '15px',
        fontWeight: 900,
        color: positive === undefined ? 'var(--text)' : positive ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
      }}>
        {value}
      </div>
    </div>
  );
}

/** Get human-readable name for an asset */
function getAssetName(asset: any): string {
  if (!asset.details) return `${asset.asset_type.toUpperCase()} #${asset.asset_id.slice(-8)}`;

  switch (asset.asset_type) {
    case 'vehicle':
      return `${asset.details.year} ${asset.details.make} ${asset.details.model}`;
    case 'organization':
      return asset.details.business_name || `Org #${asset.asset_id.slice(-8)}`;
    case 'bond':
      return asset.details.issuer_name
        ? `${asset.details.issuer_name} Bond`
        : `Bond #${asset.asset_id.slice(-8)}`;
    case 'stake':
      return `Equity Stake #${asset.asset_id.slice(-8)}`;
    case 'real_estate':
      return asset.details.name || `Property #${asset.asset_id.slice(-8)}`;
    case 'event':
      return asset.details.event_name || `Event #${asset.asset_id.slice(-8)}`;
    default:
      return `${asset.asset_type.toUpperCase()} #${asset.asset_id.slice(-8)}`;
  }
}

/** Type-specific detail panel for expanded asset rows */
function AssetDetailPanel({ asset, navigate }: { asset: any; navigate: any }) {
  const d = asset.details;
  if (!d) {
    return <div style={{ color: 'var(--text-muted)' }}>No detailed information available for this asset.</div>;
  }

  switch (asset.asset_type) {
    case 'vehicle':
      return <VehicleDetail asset={asset} d={d} navigate={navigate} />;
    case 'bond':
      return <BondDetail asset={asset} d={d} />;
    case 'stake':
      return <StakeDetail asset={asset} d={d} />;
    case 'organization':
      return <OrgDetail asset={asset} d={d} />;
    case 'real_estate':
      return <RealEstateDetail asset={asset} d={d} />;
    case 'event':
      return <EventDetail asset={asset} d={d} />;
    default:
      return <div style={{ color: 'var(--text-muted)' }}>Unknown asset type.</div>;
  }
}

function VehicleDetail({ asset, d, navigate }: { asset: any; d: any; navigate: any }) {
  const entryPrice = d.purchase_price_cents || asset.entry_price_cents;
  const currentVal = asset.current_value_cents || (d.current_value ? d.current_value * 100 : 0);
  const gainLoss = entryPrice && currentVal ? currentVal - entryPrice : null;
  const gainLossPct = entryPrice && gainLoss ? (gainLoss / entryPrice) * 100 : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Vehicle Details</div>
        <DetailRow label="Year/Make/Model" value={`${d.year} ${d.make} ${d.model}`} />
        <DetailRow label="VIN" value={d.vin ? (d.vin.slice(0, 3) + '***' + d.vin.slice(-4)) : '—'} />
        <DetailRow label="Location" value={[d.city, d.state, d.country].filter(Boolean).join(', ') || d.location || '—'} />
        {d.image_count != null && <DetailRow label="Images" value={d.image_count} />}
        {d.receipt_count != null && <DetailRow label="Receipts" value={d.receipt_count} />}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Valuation</div>
        {entryPrice && <DetailRow label="Entry Price" value={formatCurrencyFromCents(entryPrice)} />}
        <DetailRow label="Current Value" value={formatCurrencyFromCents(currentVal)} />
        {gainLoss !== null && (
          <DetailRow
            label="Gain/Loss"
            value={`${formatCurrencyFromCents(gainLoss)} (${gainLossPct !== null ? (gainLossPct >= 0 ? '+' : '') + gainLossPct.toFixed(1) + '%' : ''})`}
            valueColor={gainLoss >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'}
          />
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Actions</div>
        <button
          onClick={() => navigate(`/vehicle/${asset.asset_id}`)}
          style={{
            padding: '6px 12px',
            border: '1px solid var(--primary)',
            borderRadius: '4px',
            background: 'var(--primary)',
            color: 'var(--white)',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          Full Vehicle Page <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
}

function BondDetail({ asset, d }: { asset: any; d: any }) {
  const isHealthy = d.status === 'active' || d.status === 'current';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Issuer</div>
        <DetailRow label="Name" value={d.issuer_name || '—'} />
        <DetailRow label="Type" value={d.issuer_type || '—'} />
        <DetailRow label="Status" value={d.status?.toUpperCase() || '—'} valueColor={isHealthy ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'} />
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Terms</div>
        <DetailRow label="Principal" value={formatCurrencyFromCents(d.principal_amount_cents)} />
        <DetailRow label="Coupon Rate" value={d.coupon_rate_pct != null ? `${d.coupon_rate_pct}%` : (d.interest_rate_pct != null ? `${d.interest_rate_pct}%` : '—')} />
        <DetailRow label="Term" value={d.term_months ? `${d.term_months} months` : '—'} />
        <DetailRow label="Maturity" value={d.maturity_date ? new Date(d.maturity_date).toLocaleDateString() : '—'} />
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Health</div>
        {d.payments_on_time != null && <DetailRow label="On-Time Payments" value={d.payments_on_time} />}
        {d.collateral_description && <DetailRow label="Collateral" value={d.collateral_description} />}
        {!isHealthy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', color: 'var(--danger, #ef4444)', fontSize: '11px', fontWeight: 700 }}>
            <AlertTriangle size={12} /> Risk indicator: bond not in active status
          </div>
        )}
      </div>
    </div>
  );
}

function StakeDetail({ asset, d }: { asset: any; d: any }) {
  const raised = d.raised_amount_cents || 0;
  const target = d.target_amount_cents || 0;
  const fundingPct = target > 0 ? (raised / target * 100) : 0;
  const isFundraising = d.status === 'fundraising' || d.status === 'open';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Equity Position</div>
        {d.equity_pct != null && <DetailRow label="Equity %" value={`${d.equity_pct}%`} />}
        <DetailRow label="Amount Invested" value={formatCurrencyFromCents(raised)} />
        <DetailRow label="Profit Share" value={d.profit_share_pct != null ? `${d.profit_share_pct}%` : '—'} />
        <DetailRow label="Status" value={d.status?.toUpperCase() || '—'} />
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Funding</div>
        <DetailRow label="Target" value={formatCurrencyFromCents(target)} />
        <DetailRow label="Raised" value={formatCurrencyFromCents(raised)} />
        <DetailRow label="Progress" value={`${fundingPct.toFixed(0)}%`} />
        {/* Mini progress bar */}
        <div style={{ marginTop: '8px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(fundingPct, 100)}%`, height: '100%', background: isFundraising ? '#f59e0b' : 'var(--success, #10b981)', borderRadius: '3px' }} />
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Projections</div>
        {d.target_sale_price_cents && <DetailRow label="Target Sale" value={formatCurrencyFromCents(d.target_sale_price_cents)} />}
        {d.expected_profit_cents && <DetailRow label="Expected Profit" value={formatCurrencyFromCents(d.expected_profit_cents)} />}
        {d.expected_profit_cents && d.profit_share_pct && (
          <DetailRow label="Investor's Share" value={formatCurrencyFromCents(Math.round(d.expected_profit_cents * d.profit_share_pct / 100))} />
        )}
        {isFundraising && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', color: '#f59e0b', fontSize: '11px', fontWeight: 700 }}>
            <AlertTriangle size={12} /> Still fundraising — not yet active
          </div>
        )}
      </div>
    </div>
  );
}

function OrgDetail({ asset, d }: { asset: any; d: any }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Business Info</div>
        <DetailRow label="Name" value={d.business_name || '—'} />
        <DetailRow label="Type" value={d.business_type || '—'} />
        <DetailRow label="Location" value={[d.city, d.state, d.country].filter(Boolean).join(', ') || '—'} />
        {d.employee_count != null && <DetailRow label="Employees" value={d.employee_count} />}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Reputation</div>
        {d.reputation_score != null && (
          <>
            <DetailRow label="Score" value={`${d.reputation_score}/100`} />
            <div style={{ marginTop: '8px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                width: `${d.reputation_score}%`,
                height: '100%',
                background: d.reputation_score >= 70 ? 'var(--success, #10b981)' : d.reputation_score >= 40 ? '#f59e0b' : 'var(--danger, #ef4444)',
                borderRadius: '3px'
              }} />
            </div>
          </>
        )}
        {d.reputation_score == null && (
          <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>No reputation data available</div>
        )}
      </div>
    </div>
  );
}

function RealEstateDetail({ asset, d }: { asset: any; d: any }) {
  const specs = d.specs || {};
  const meta = d.metadata || {};
  const annualRev = meta.annual_revenue ? `$${(meta.annual_revenue / 1).toLocaleString()}` : null;
  const capRate = meta.cap_rate_pct;
  const occupancy = meta.occupancy_pct;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Property</div>
        <DetailRow label="Name" value={d.name || '—'} />
        <DetailRow label="Type" value={(d.property_type || '—').replace('_', ' ')} />
        <DetailRow label="Location" value={[d.city, d.region, d.country].filter(Boolean).join(', ') || '—'} />
        <DetailRow label="Status" value={(d.status || '—').replace('_', ' ').toUpperCase()} />
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Specs</div>
        {specs.square_feet && <DetailRow label="Square Feet" value={specs.square_feet.toLocaleString()} />}
        {specs.vehicle_capacity && <DetailRow label="Vehicle Capacity" value={`${specs.vehicle_capacity} cars`} />}
        {specs.lift_count && <DetailRow label="Lifts" value={specs.lift_count} />}
        {specs.climate_controlled && <DetailRow label="Climate Control" value="Yes" valueColor="var(--success, #10b981)" />}
        {specs.security && <DetailRow label="Security" value={specs.security.replace('_', ' ').toUpperCase()} />}
        {specs.amenities && (
          <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {specs.amenities.map((a: string, i: number) => (
              <span key={i} style={{ padding: '1px 6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '9px', color: 'var(--text-muted)' }}>
                {a.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Financials</div>
        <DetailRow label="Purchase Price" value={d.base_price ? `$${Number(d.base_price).toLocaleString()}` : formatCurrencyFromCents(asset.entry_price_cents)} />
        <DetailRow label="Current Value" value={formatCurrencyFromCents(asset.current_value_cents)} />
        {annualRev && <DetailRow label="Annual Revenue" value={annualRev} />}
        {capRate && <DetailRow label="Cap Rate" value={`${capRate}%`} />}
        {occupancy != null && (
          <>
            <DetailRow label="Occupancy" value={`${occupancy}%`} />
            <div style={{ marginTop: '4px', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ width: `${occupancy}%`, height: '100%', background: occupancy >= 80 ? 'var(--success, #10b981)' : '#f59e0b', borderRadius: '2px' }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EventDetail({ asset, d }: { asset: any; d: any }) {
  const revenueFormatted = d.total_revenue_cents ? formatCurrencyFromCents(d.total_revenue_cents) : '—';
  const profitFormatted = d.net_profit_cents ? formatCurrencyFromCents(d.net_profit_cents) : '—';
  const fillPct = d.max_capacity && d.registered_count ? Math.round((d.registered_count / d.max_capacity) * 100) : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Event</div>
        <DetailRow label="Name" value={d.event_name || '—'} />
        <DetailRow label="Type" value={(d.event_type || '—').replace('_', ' ')} />
        <DetailRow label="Venue" value={d.venue_name || [d.city, d.state].filter(Boolean).join(', ') || '—'} />
        <DetailRow label="Date" value={d.start_date ? new Date(d.start_date).toLocaleDateString() : '—'} />
        {d.recurring && d.recurring !== 'once' && (
          <DetailRow label="Recurring" value={d.recurring.toUpperCase()} valueColor="var(--primary)" />
        )}
        <DetailRow label="Status" value={(d.status || '—').replace('_', ' ').toUpperCase()} />
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Capacity</div>
        {d.max_capacity && <DetailRow label="Max Capacity" value={d.max_capacity.toLocaleString()} />}
        {d.registered_count != null && <DetailRow label="Registered" value={d.registered_count.toLocaleString()} />}
        {d.vehicle_spots && <DetailRow label="Vehicle Spots" value={d.vehicle_spots} />}
        {fillPct > 0 && (
          <>
            <div style={{ marginTop: '4px', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(fillPct, 100)}%`, height: '100%', background: fillPct >= 90 ? 'var(--danger, #ef4444)' : fillPct >= 60 ? '#f59e0b' : 'var(--success, #10b981)', borderRadius: '2px' }} />
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', textAlign: 'right' }}>{fillPct}% filled</div>
          </>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Revenue</div>
        {d.ticket_price_cents > 0 && <DetailRow label="Ticket" value={formatCurrencyFromCents(d.ticket_price_cents)} />}
        {d.vip_price_cents && <DetailRow label="VIP" value={formatCurrencyFromCents(d.vip_price_cents)} />}
        <DetailRow label="Total Revenue" value={revenueFormatted} />
        <DetailRow label="Net Profit" value={profitFormatted} valueColor={d.net_profit_cents > 0 ? 'var(--success, #10b981)' : undefined} />
      </div>
    </div>
  );
}

/** Curator / Agent profile panel — shows who manages the contract */
function CuratorPanel({
  contract, curatorProfile, curatorContracts, curatorStats, agentInfo, onSelectContract,
}: {
  contract: any;
  curatorProfile: any;
  curatorContracts: any[];
  curatorStats: any;
  agentInfo: any;
  onSelectContract: (id: string) => void;
}) {
  const isAgent = !!(agentInfo || curatorProfile?.user_type === 'agent');
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isAgent ? <Bot size={14} /> : <User size={14} />}
          <h3 className="heading-3" style={{ margin: 0 }}>Management</h3>
          <span style={{
            padding: '2px 6px',
            background: isAgent ? '#8b5cf6' : '#3b82f6',
            color: '#fff',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: 700,
          }}>
            {isAgent ? 'AGENT' : 'HUMAN'}
          </span>
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: curatorContracts.length > 0 ? '1fr 1fr' : '1fr', gap: '20px' }}>
          {/* Left: Curator identity */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              {/* Avatar */}
              {curatorProfile?.avatar_url ? (
                <img
                  src={curatorProfile.avatar_url}
                  alt=""
                  style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }}
                />
              ) : (
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: isAgent ? '#8b5cf6' : 'var(--primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '21px', fontWeight: 900,
                  border: '2px solid var(--border)',
                }}>
                  {isAgent ? <Bot size={20} /> : (contract.curator_name || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <div style={{ fontWeight: 900, fontSize: '16px' }}>
                  {curatorProfile?.full_name || contract.curator_name || 'Unknown'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {curatorProfile?.username && <span>@{curatorProfile.username}</span>}
                  {curatorProfile?.is_verified && (
                    <span style={{ color: 'var(--success, #10b981)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <Shield size={10} /> VERIFIED
                    </span>
                  )}
                  {curatorProfile?.user_type && curatorProfile.user_type !== 'user' && (
                    <HoverCard content={
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>{curatorProfile.user_type.toUpperCase()}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {curatorProfile.user_type === 'professional' ? 'Verified automotive professional with industry credentials.' :
                           curatorProfile.user_type === 'dealer' ? 'Licensed dealer with transactional history on the platform.' :
                           curatorProfile.user_type === 'admin' ? 'Platform administrator with elevated access.' : ''}
                        </div>
                      </div>
                    } width={220}>
                      <span style={{
                        padding: '1px 6px', background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: '3px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', cursor: 'default',
                      }}>
                        {curatorProfile.user_type}
                      </span>
                    </HoverCard>
                  )}
                </div>
              </div>
            </div>

            {/* Bio */}
            {(curatorProfile?.bio || contract.curator_bio) && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '15px', marginBottom: '10px' }}>
                {curatorProfile?.bio || contract.curator_bio}
              </div>
            )}

            {/* Credentials */}
            {contract.curator_credentials?.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {contract.curator_credentials.map((cred: string, i: number) => (
                  <HoverCard key={i} content={
                    <div style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>{cred}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Professional credential held by this curator. Credentials are self-reported — verify independently.
                      </div>
                    </div>
                  } width={200}>
                    <span style={{
                      padding: '2px 8px', background: 'var(--primary)', color: '#fff',
                      borderRadius: '3px', fontSize: '9px', fontWeight: 700, cursor: 'default',
                    }}>
                      {cred}
                    </span>
                  </HoverCard>
                ))}
              </div>
            )}

            {/* Operations overview */}
            {(() => {
              const allContracts = [contract, ...curatorContracts];
              const totalAum = allContracts.reduce((s: number, c: any) => s + (c.total_assets_under_management_cents || 0), 0);
              const withReturns = allContracts.filter((c: any) => c.total_return_pct != null);
              const avgReturn = withReturns.length > 0
                ? withReturns.reduce((s: number, c: any) => s + c.total_return_pct, 0) / withReturns.length
                : null;
              const activeCount = allContracts.filter((c: any) => c.status === 'active' || c.status === 'approved').length;

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '8px' }}>
                  <HoverCard content={
                    <div style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>Total AUM</div>
                      <HoverStat label="All contracts" value={formatCurrencyFromCents(totalAum)} />
                      <HoverStat label="This contract" value={formatCurrencyFromCents(contract.total_assets_under_management_cents)} />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Total assets under management across all contracts curated by this manager.
                      </div>
                    </div>
                  } width={240}>
                    <div style={{ textAlign: 'center', padding: '6px', background: 'var(--surface)', borderRadius: '4px', cursor: 'default' }}>
                      <div style={{ fontSize: '16px', fontWeight: 900 }}>{formatCurrencyFromCents(totalAum)}</div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Total AUM</div>
                    </div>
                  </HoverCard>
                  {avgReturn != null && (
                    <HoverCard content={
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Average Return</div>
                        {withReturns.map((c: any, i: number) => (
                          <HoverStat key={i} label={c.contract_symbol || c.contract_name} value={`${c.total_return_pct >= 0 ? '+' : ''}${c.total_return_pct.toFixed(2)}%`}
                            color={c.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'} />
                        ))}
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Unweighted average across {withReturns.length} contract{withReturns.length !== 1 ? 's' : ''}.
                        </div>
                      </div>
                    } width={240}>
                      <div style={{ textAlign: 'center', padding: '6px', background: 'var(--surface)', borderRadius: '4px', cursor: 'default' }}>
                        <div style={{ fontSize: '16px', fontWeight: 900, color: avgReturn >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                          {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(2)}%
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Avg Return</div>
                      </div>
                    </HoverCard>
                  )}
                  <HoverCard content={
                    <div style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>Contracts</div>
                      <HoverStat label="Total" value={allContracts.length} />
                      <HoverStat label="Active" value={activeCount} />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Investment contracts managed by this curator.
                      </div>
                    </div>
                  } width={200}>
                    <div style={{ textAlign: 'center', padding: '6px', background: 'var(--surface)', borderRadius: '4px', cursor: 'default' }}>
                      <div style={{ fontSize: '16px', fontWeight: 900 }}>{allContracts.length}</div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{activeCount} Active</div>
                    </div>
                  </HoverCard>
                  {curatorStats?.total_vehicles != null && (
                    <HoverCard content={
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Personal Vehicles</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Vehicles this curator owns on the platform. Skin in the game — direct ownership experience informs curation.
                        </div>
                      </div>
                    } width={220}>
                      <div style={{ textAlign: 'center', padding: '6px', background: 'var(--surface)', borderRadius: '4px', cursor: 'default' }}>
                        <div style={{ fontSize: '16px', fontWeight: 900 }}>{curatorStats.total_vehicles}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Vehicles</div>
                      </div>
                    </HoverCard>
                  )}
                  {curatorStats?.reputation_score != null && (
                    <HoverCard content={
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Reputation</div>
                        <HoverStat label="Score" value={`${curatorStats.reputation_score}/100`} />
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Computed from contributions, verifications, community activity, and transaction history.
                        </div>
                      </div>
                    } width={220}>
                      <div style={{ textAlign: 'center', padding: '6px', background: 'var(--surface)', borderRadius: '4px', cursor: 'default' }}>
                        <div style={{ fontSize: '16px', fontWeight: 900, color: curatorStats.reputation_score >= 70 ? 'var(--success, #10b981)' : curatorStats.reputation_score >= 40 ? '#f59e0b' : 'var(--danger, #ef4444)' }}>
                          {curatorStats.reputation_score}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Reputation</div>
                      </div>
                    </HoverCard>
                  )}
                </div>
              );
            })()}

            {/* Member since */}
            {curatorProfile?.created_at && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Member since {new Date(curatorProfile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                {curatorProfile.location && ` • ${curatorProfile.location}`}
              </div>
            )}

            {/* Agent Info — "Read Their Code" */}
            {isAgent && agentInfo && (
              <div style={{ marginTop: '12px', padding: '10px', background: '#8b5cf620', border: '1px solid #8b5cf640', borderRadius: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Bot size={14} color="#8b5cf6" />
                    <span style={{ fontWeight: 900, fontSize: '12px', color: '#8b5cf6' }}>AGENT: {agentInfo.name}</span>
                  </div>
                  <button
                    onClick={() => setShowCode(!showCode)}
                    style={{
                      padding: '2px 8px', border: '1px solid #8b5cf6', borderRadius: '3px',
                      background: showCode ? '#8b5cf6' : 'transparent', color: showCode ? '#fff' : '#8b5cf6',
                      fontSize: '9px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    }}
                  >
                    <Code size={10} /> {showCode ? 'HIDE CODE' : 'READ CODE'}
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  <strong>Focus:</strong> {agentInfo.focus}
                </div>
                {agentInfo.capabilities?.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    {agentInfo.capabilities.map((cap: string, i: number) => (
                      <HoverCard key={i} content={
                        <div style={{ padding: '8px' }}>
                          <div style={{ fontWeight: 700, marginBottom: '4px' }}>{cap}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            This agent is capable of performing {cap.toLowerCase()} operations autonomously.
                          </div>
                        </div>
                      } width={200}>
                        <span style={{
                          padding: '1px 6px', background: '#8b5cf620', border: '1px solid #8b5cf640',
                          borderRadius: '3px', fontSize: '9px', color: '#8b5cf6', fontWeight: 600, cursor: 'default',
                        }}>
                          {cap}
                        </span>
                      </HoverCard>
                    ))}
                  </div>
                )}
                {showCode && agentInfo.prompt_template && (
                  <div style={{
                    marginTop: '8px', padding: '10px', background: '#0d1117', color: '#c9d1d9',
                    borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', lineHeight: '14px',
                    maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {agentInfo.prompt_template}
                  </div>
                )}
                {showCode && !agentInfo.prompt_template && (
                  <div style={{ marginTop: '8px', padding: '10px', background: '#0d1117', color: '#8b949e', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>
                    // Agent prompt template not published.{'\n'}
                    // Agent ID: {agentInfo.id}{'\n'}
                    // Capabilities: [{agentInfo.capabilities?.join(', ')}]{'\n'}
                    // Focus: {agentInfo.focus}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Other contracts by this curator */}
          {curatorContracts.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <Briefcase size={12} />
                <span style={{ fontWeight: 700, fontSize: '12px' }}>Other Contracts by This Curator</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {curatorContracts.map((c: any) => (
                  <HoverCard key={c.id} content={
                    <div style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 900, marginBottom: '6px' }}>{c.contract_name}</div>
                      <HoverStat label="Symbol" value={c.contract_symbol} />
                      <HoverStat label="Type" value={c.contract_type?.replace('_', ' ')} />
                      <HoverStat label="Status" value={c.status?.toUpperCase()} />
                      <HoverStat label="AUM" value={c.total_assets_under_management_cents ? formatCurrencyFromCents(c.total_assets_under_management_cents) : '—'} />
                      {c.total_return_pct != null && (
                        <HoverStat label="Return" value={`${c.total_return_pct >= 0 ? '+' : ''}${c.total_return_pct.toFixed(2)}%`}
                          color={c.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'} />
                      )}
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                        Click to view this contract
                      </div>
                    </div>
                  } width={240}>
                    <div
                      onClick={(e) => { e.stopPropagation(); onSelectContract(c.id); }}
                      style={{
                        padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: '4px', cursor: 'pointer', transition: 'border-color 0.12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '12px' }}>{c.contract_name}</div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'flex', gap: '4px', marginTop: '2px' }}>
                            <span>{c.contract_symbol}</span>
                            <span>•</span>
                            <span>{c.contract_type?.replace('_', ' ')}</span>
                            <span>•</span>
                            <span style={{
                              color: c.status === 'active' ? 'var(--success, #10b981)' : 'var(--text-muted)',
                              fontWeight: 700,
                            }}>
                              {c.status?.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {c.total_assets_under_management_cents ? (
                            <div style={{ fontWeight: 700, fontSize: '12px' }}>
                              {formatCurrencyFromCents(c.total_assets_under_management_cents)}
                            </div>
                          ) : null}
                          {c.total_return_pct != null && (
                            <div style={{
                              fontSize: '11px', fontWeight: 700,
                              color: c.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                            }}>
                              {c.total_return_pct >= 0 ? '+' : ''}{c.total_return_pct.toFixed(2)}%
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </HoverCard>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hover preview card for asset rows — shows snapshot on 300ms hover */
function AssetHoverPreview({ asset, children }: { asset: any; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEnter = useCallback((e: React.MouseEvent) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      let top = rect.bottom + 8;
      // Card is ~340px wide, ~auto height
      if (left + 340 > vw) left = vw - 352;
      if (left < 8) left = 8;
      if (top + 260 > vh) top = rect.top - 268;
      if (top < 8) top = 8;
      setPos({ top, left });
    }
    timeoutRef.current = setTimeout(() => setShow(true), 300);
  }, []);

  const handleLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  }, []);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  const d = asset.details;

  return (
    <div ref={containerRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave} style={{ position: 'relative' }}>
      {children}
      {show && d && (
        <div
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 10000,
            width: '340px',
            background: 'var(--bg, #fff)',
            border: '2px solid var(--border)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          {/* Vehicle preview with thumbnail */}
          {asset.asset_type === 'vehicle' && (
            <>
              {d.primary_image_url && (
                <div style={{ width: '100%', height: '140px', overflow: 'hidden', background: 'var(--surface)' }}>
                  <img
                    src={d.primary_image_url.includes('/storage/v1/object/public/')
                      ? d.primary_image_url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=400&quality=75'
                      : d.primary_image_url}
                    alt={`${d.year} ${d.make} ${d.model}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              <div style={{ padding: '12px' }}>
                <div style={{ fontWeight: 900, fontSize: '15px', marginBottom: '6px' }}>
                  {d.year} {d.make} {d.model}
                </div>
                <HoverRow label="Location" value={[d.city, d.state].filter(Boolean).join(', ') || d.location || '—'} />
                <HoverRow label="Value" value={formatCurrencyFromCents(asset.current_value_cents || 0)} />
                {d.purchase_price_cents && (
                  <HoverRow label="Entry" value={formatCurrencyFromCents(d.purchase_price_cents)} />
                )}
                {d.image_count != null && <HoverRow label="Photos" value={d.image_count} />}
                {d.vin && <HoverRow label="VIN" value={d.vin.slice(0, 3) + '***' + d.vin.slice(-4)} />}
              </div>
            </>
          )}

          {/* Bond preview */}
          {asset.asset_type === 'bond' && (
            <div style={{ padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.bond, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 900 }}>B</div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '15px' }}>{d.issuer_name || 'Bond'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.issuer_type || 'Fixed Income'}</div>
                </div>
              </div>
              <HoverRow label="Principal" value={formatCurrencyFromCents(d.principal_amount_cents)} />
              <HoverRow label="Rate" value={d.coupon_rate_pct != null ? `${d.coupon_rate_pct}%` : d.interest_rate_pct != null ? `${d.interest_rate_pct}%` : '—'} />
              <HoverRow label="Term" value={d.term_months ? `${d.term_months}mo` : '—'} />
              <HoverRow label="Status" value={d.status?.toUpperCase() || '—'} valueColor={d.status === 'active' || d.status === 'current' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'} />
              {d.maturity_date && <HoverRow label="Maturity" value={new Date(d.maturity_date).toLocaleDateString()} />}
            </div>
          )}

          {/* Stake preview */}
          {asset.asset_type === 'stake' && (() => {
            const raised = d.raised_amount_cents || 0;
            const target = d.target_amount_cents || 0;
            const pct = target > 0 ? (raised / target * 100) : 0;
            return (
              <div style={{ padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.stake, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 900 }}>S</div>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: '15px' }}>Equity Stake</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.status?.toUpperCase() || 'ACTIVE'}</div>
                  </div>
                </div>
                {d.equity_pct != null && <HoverRow label="Equity" value={`${d.equity_pct}%`} />}
                <HoverRow label="Raised" value={formatCurrencyFromCents(raised)} />
                <HoverRow label="Target" value={formatCurrencyFromCents(target)} />
                {d.profit_share_pct != null && <HoverRow label="Profit Share" value={`${d.profit_share_pct}%`} />}
                <div style={{ marginTop: '6px', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: ASSET_TYPE_COLORS.stake, borderRadius: '2px' }} />
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', textAlign: 'right' }}>{pct.toFixed(0)}% funded</div>
              </div>
            );
          })()}

          {/* Organization preview */}
          {asset.asset_type === 'organization' && (
            <div style={{ padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.organization, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 900 }}>
                  {(d.business_name || 'O').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '15px' }}>{d.business_name || 'Organization'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.business_type || 'Business'}</div>
                </div>
              </div>
              <HoverRow label="Location" value={[d.city, d.state, d.country].filter(Boolean).join(', ') || '—'} />
              {d.employee_count != null && <HoverRow label="Employees" value={d.employee_count} />}
              {d.reputation_score != null && (
                <>
                  <HoverRow label="Reputation" value={`${d.reputation_score}/100`} valueColor={d.reputation_score >= 70 ? 'var(--success, #10b981)' : d.reputation_score >= 40 ? '#f59e0b' : 'var(--danger, #ef4444)'} />
                  <div style={{ marginTop: '4px', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${d.reputation_score}%`, height: '100%', background: d.reputation_score >= 70 ? 'var(--success, #10b981)' : d.reputation_score >= 40 ? '#f59e0b' : 'var(--danger, #ef4444)', borderRadius: '2px' }} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Real estate preview */}
          {asset.asset_type === 'real_estate' && (
            <div style={{ padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.real_estate, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '19px', fontWeight: 900 }}>
                  {'\u2302'}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '15px' }}>{d.name || 'Property'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{(d.property_type || '').replace('_', ' ')}</div>
                </div>
              </div>
              <HoverRow label="Location" value={[d.city, d.region].filter(Boolean).join(', ') || '—'} />
              {d.specs?.square_feet && <HoverRow label="Size" value={`${d.specs.square_feet.toLocaleString()} sqft`} />}
              {d.specs?.vehicle_capacity && <HoverRow label="Capacity" value={`${d.specs.vehicle_capacity} cars`} />}
              {d.specs?.lift_count && <HoverRow label="Lifts" value={d.specs.lift_count} />}
              <HoverRow label="Value" value={formatCurrencyFromCents(asset.current_value_cents || 0)} />
              {d.metadata?.cap_rate_pct && <HoverRow label="Cap Rate" value={`${d.metadata.cap_rate_pct}%`} />}
            </div>
          )}

          {/* Event preview */}
          {asset.asset_type === 'event' && (
            <div style={{ padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.event, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 900 }}>
                  {'\u2605'}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '15px' }}>{d.event_name || 'Event'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{(d.event_type || '').replace('_', ' ')} {d.recurring && d.recurring !== 'once' ? `• ${d.recurring}` : ''}</div>
                </div>
              </div>
              <HoverRow label="Venue" value={d.venue_name || [d.city, d.state].filter(Boolean).join(', ') || '—'} />
              <HoverRow label="Date" value={d.start_date ? new Date(d.start_date).toLocaleDateString() : '—'} />
              {d.max_capacity && <HoverRow label="Capacity" value={d.max_capacity.toLocaleString()} />}
              {d.vehicle_spots && <HoverRow label="Car Spots" value={d.vehicle_spots} />}
              {d.total_revenue_cents > 0 && <HoverRow label="Revenue" value={formatCurrencyFromCents(d.total_revenue_cents)} valueColor="var(--success, #10b981)" />}
              {d.net_profit_cents > 0 && <HoverRow label="Profit" value={formatCurrencyFromCents(d.net_profit_cents)} valueColor="var(--success, #10b981)" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact row for hover preview cards */
function HoverRow({ label, value, valueColor }: { label: string; value: any; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: '11px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, color: valueColor || 'var(--text)' }}>{value}</span>
    </div>
  );
}

/** Reusable detail row */
function DetailRow({ label, value, valueColor }: { label: string; value: any; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '12px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor || 'var(--text)' }}>{value}</span>
    </div>
  );
}
