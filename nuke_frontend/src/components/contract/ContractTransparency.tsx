import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { formatCurrencyFromCents } from '../../utils/currency';
import { ChevronDown, ChevronRight, ExternalLink, Shield, AlertTriangle } from 'lucide-react';
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
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  vehicle: 'Vehicle',
  bond: 'Bond',
  stake: 'Stake',
  organization: 'Organization',
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

      // Load investor data if curator
      if (contractData.curator_id) {
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
      <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading contract details...
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="card">
        <div className="card-body" style={{ color: 'var(--danger, #ef4444)', fontSize: '9pt' }}>
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
                <h1 style={{ margin: 0, fontSize: '16pt', fontWeight: 900 }}>
                  {contract.contract_name}
                </h1>
                <span style={{
                  padding: '4px 8px',
                  background: contract.status === 'active' ? 'var(--success, #10b981)' : 'var(--text-muted)',
                  color: 'var(--white)',
                  borderRadius: '4px',
                  fontSize: '8pt',
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  {contract.status}
                </span>
              </div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>{contract.contract_symbol}</span>
                <span>•</span>
                <span
                  data-drill="contract-type"
                  data-value={contract.contract_type}
                  style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
                  title={`Contract type: ${contract.contract_type}. Click to learn more about ${contract.contract_type} structures.`}
                >
                  {contract.contract_type.replace('_', ' ').toUpperCase()}
                </span>
                <span>•</span>
                <span
                  data-drill="regulatory-status"
                  data-value={contract.regulatory_status}
                  style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }}
                  title={`Regulatory: ${contract.regulatory_status?.replace('_', ' ').toUpperCase()}. ${contract.regulatory_status === 'reg_d' ? 'SEC Regulation D — accredited investors only. Exemption from SEC registration for private placements.' : ''}`}
                >
                  {contract.regulatory_status?.replace('_', ' ').toUpperCase() || 'UNREGISTERED'}
                </span>
                <span>•</span>
                <span>Curated by {contract.curator_name || 'Unknown'}</span>
              </div>
              {contract.contract_description && (
                <div style={{ fontSize: '9pt', color: 'var(--text)', lineHeight: '16px' }}>
                  {contract.contract_description}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
              <button className="button button-primary" onClick={() => navigate(`/market/exchange/${contract.contract_symbol}`)}>
                INVEST NOW
              </button>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textAlign: 'right' }}>
                Min: {formatCurrencyFromCents(contract.minimum_investment_cents)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contract Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Total Assets</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{assets.length}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>Underlying assets</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Total Value</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatCurrencyFromCents(totalValue)}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>Portfolio value</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">AUM</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatCurrencyFromCents(contract.total_assets_under_management_cents)}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>Assets under management</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Investors</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{contract.total_investors || 0}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>Active investors</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">Performance</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900, color: contract.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
              {formatPct(contract.total_return_pct)}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>Total return</div>
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
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '9pt' }}
                    formatter={(value: number) => [formatCurrencyFromCents(value), 'NAV']}
                    labelFormatter={(label: string) => label ? new Date(label).toLocaleDateString() : ''}
                  />
                  <Area type="monotone" dataKey="nav_cents" stroke="#3b82f6" fill="url(#navGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '9pt' }}>
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
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Investment Terms</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '16px' }}>
                <strong>Minimum:</strong> {formatCurrencyFromCents(contract.minimum_investment_cents)}<br />
                {contract.maximum_investment_cents && <><strong>Maximum:</strong> {formatCurrencyFromCents(contract.maximum_investment_cents)}<br /></>}
                <strong>Liquidity:</strong> {contract.liquidity_type}<br />
                {contract.lockup_period_days && <><strong>Lockup:</strong> {contract.lockup_period_days} days<br /></>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Fee Structure</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '16px' }}>
                <strong>Management:</strong> {contract.management_fee_pct}% annually<br />
                {contract.performance_fee_pct > 0 && <><strong>Performance:</strong> {contract.performance_fee_pct}%<br /></>}
                <strong>Transaction:</strong> {contract.transaction_fee_pct}%<br />
                {contract.setup_fee_cents > 0 && <><strong>Setup:</strong> {formatCurrencyFromCents(contract.setup_fee_cents)}<br /></>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Legal Structure</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '20px' }}>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Entity:</strong>
                  <span data-drill="entity-type" data-value={contract.legal_entity_type} style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }} title={`Legal entity: ${contract.legal_entity_type?.replace('_', ' ')}. Defines liability, tax treatment, and ownership structure.`}>
                    {contract.legal_entity_type.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Jurisdiction:</strong>
                  <span data-drill="jurisdiction" data-value={contract.jurisdiction} style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }} title={`Jurisdiction: ${contract.jurisdiction}. Governing law for this contract.`}>
                    {contract.jurisdiction}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Regulatory:</strong>
                  <span data-drill="regulatory-status" data-value={contract.regulatory_status} style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)', color: contract.regulatory_status === 'reg_d' ? 'var(--primary)' : undefined }} title={contract.regulatory_status === 'reg_d' ? 'SEC Regulation D — Private placement exemption. Limited to accredited investors (>$1M net worth or >$200k annual income). No SEC registration required.' : `Regulatory status: ${contract.regulatory_status?.replace('_', ' ')}`}>
                    {contract.regulatory_status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                  <strong>Transparency:</strong>
                  <span data-drill="transparency-level" data-value={contract.transparency_level} style={{ cursor: 'help', borderBottom: '1px dotted var(--text-muted)' }} title={`Transparency: ${contract.transparency_level}. ${contract.transparency_level === 'full' ? 'All holdings and positions visible to investors.' : contract.transparency_level === 'partial' ? 'Summary-level holdings visible. Individual positions may be masked.' : 'Holdings not disclosed to investors.'}`}>
                    {contract.transparency_level.toUpperCase()}
                  </span>
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
                      fontSize: '8pt',
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
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '8pt' }}>
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
                fontSize: '9pt',
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
                        fontSize: '9pt',
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
                              color: '#fff', fontSize: '9pt', fontWeight: 900,
                            }}>
                              {asset.asset_type === 'bond' ? 'B' : asset.asset_type === 'stake' ? 'S' :
                               asset.asset_type === 'organization' ? (asset.details?.business_name || 'O').charAt(0).toUpperCase() : '?'}
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '10pt' }}>{assetName}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '8pt', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                              fontSize: '8pt',
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
                        fontSize: '9pt',
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
                fontSize: '7pt',
                fontWeight: 700,
              }}>CURATOR VIEW</span>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Investors</div>
                <div style={{ fontSize: '16pt', fontWeight: 900 }}>{investorData.count}</div>
              </div>
              <div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Shares Outstanding</div>
                <div style={{ fontSize: '16pt', fontWeight: 900 }}>{investorData.totalShares.toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>New (30d)</div>
                <div style={{ fontSize: '16pt', fontWeight: 900 }}>{investorData.recentSubscriptions}</div>
              </div>
            </div>

            {recentTransactions.length > 0 && (
              <>
                <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  Recent Transactions
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {recentTransactions.map((tx: any) => (
                    <div key={tx.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '8pt',
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
      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{
        fontSize: '11pt',
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
            fontSize: '8pt',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', color: 'var(--danger, #ef4444)', fontSize: '8pt', fontWeight: 700 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', color: '#f59e0b', fontSize: '8pt', fontWeight: 700 }}>
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
          <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>No reputation data available</div>
        )}
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
                <div style={{ fontWeight: 900, fontSize: '11pt', marginBottom: '6px' }}>
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
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.bond, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12pt', fontWeight: 900 }}>B</div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '11pt' }}>{d.issuer_name || 'Bond'}</div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{d.issuer_type || 'Fixed Income'}</div>
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
                  <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.stake, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12pt', fontWeight: 900 }}>S</div>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: '11pt' }}>Equity Stake</div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{d.status?.toUpperCase() || 'ACTIVE'}</div>
                  </div>
                </div>
                {d.equity_pct != null && <HoverRow label="Equity" value={`${d.equity_pct}%`} />}
                <HoverRow label="Raised" value={formatCurrencyFromCents(raised)} />
                <HoverRow label="Target" value={formatCurrencyFromCents(target)} />
                {d.profit_share_pct != null && <HoverRow label="Profit Share" value={`${d.profit_share_pct}%`} />}
                <div style={{ marginTop: '6px', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: ASSET_TYPE_COLORS.stake, borderRadius: '2px' }} />
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px', textAlign: 'right' }}>{pct.toFixed(0)}% funded</div>
              </div>
            );
          })()}

          {/* Organization preview */}
          {asset.asset_type === 'organization' && (
            <div style={{ padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: ASSET_TYPE_COLORS.organization, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12pt', fontWeight: 900 }}>
                  {(d.business_name || 'O').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '11pt' }}>{d.business_name || 'Organization'}</div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{d.business_type || 'Business'}</div>
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
        </div>
      )}
    </div>
  );
}

/** Compact row for hover preview cards */
function HoverRow({ label, value, valueColor }: { label: string; value: any; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: '8pt' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, color: valueColor || 'var(--text)' }}>{value}</span>
    </div>
  );
}

/** Reusable detail row */
function DetailRow({ label, value, valueColor }: { label: string; value: any; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '9pt' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor || 'var(--text)' }}>{value}</span>
    </div>
  );
}
