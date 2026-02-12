import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyFromCents } from '../../utils/currency';
import HoverCard, { HoverStat } from './HoverCard';
import DrillDown from './DrillDown';

interface ContractMarketplaceProps {
  curatorId?: string;
  onSelectContract: (contractId: string) => void;
}

export default function ContractMarketplace({ curatorId, onSelectContract }: ContractMarketplaceProps) {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'draft'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [contractImages, setContractImages] = useState<Record<string, string[]>>({});

  useEffect(() => {
    loadContracts();
  }, [curatorId, filter, searchQuery]);

  const loadContracts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('custom_investment_contracts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (curatorId) {
        query = query.eq('curator_id', curatorId);
      }

      if (filter === 'active') {
        query = query.in('status', ['active', 'approved']);
      } else if (filter === 'draft') {
        query = query.eq('status', 'draft');
      }

      if (searchQuery) {
        query = query.or(`contract_name.ilike.%${searchQuery}%,contract_symbol.ilike.%${searchQuery}%,contract_description.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setContracts(data || []);

      // Fetch vehicle thumbnails for all contracts
      if (data && data.length > 0) {
        loadContractImages(data.map((c: any) => c.id));
      }
    } catch (e: any) {
      console.error('Failed to load contracts:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadContractImages = async (contractIds: string[]) => {
    try {
      // Get vehicle assets for all contracts
      const { data: assets } = await supabase
        .from('contract_assets')
        .select('contract_id, asset_id, asset_type, allocation_pct')
        .in('contract_id', contractIds)
        .eq('asset_type', 'vehicle')
        .order('allocation_pct', { ascending: false });

      if (!assets || assets.length === 0) return;

      // Group by contract, take top 5 per contract
      const byContract: Record<string, string[]> = {};
      for (const a of assets) {
        if (!byContract[a.contract_id]) byContract[a.contract_id] = [];
        if (byContract[a.contract_id].length < 5) {
          byContract[a.contract_id].push(a.asset_id);
        }
      }

      // Get all unique vehicle IDs
      const allVehicleIds = [...new Set(assets.map(a => a.asset_id))];

      // Batch-fetch primary_image_url
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, primary_image_url')
        .in('id', allVehicleIds);

      if (!vehicles) return;

      const imageMap: Record<string, string> = {};
      for (const v of vehicles) {
        if (v.primary_image_url) {
          // Use render transform for smaller thumbnails
          imageMap[v.id] = v.primary_image_url.includes('/storage/v1/object/public/')
            ? v.primary_image_url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=300&quality=70'
            : v.primary_image_url;
        }
      }

      // Build final map: contract_id -> image urls
      const result: Record<string, string[]> = {};
      for (const [contractId, vehicleIds] of Object.entries(byContract)) {
        result[contractId] = vehicleIds
          .map(vid => imageMap[vid])
          .filter(Boolean);
      }

      setContractImages(result);
    } catch {
      // Non-critical - cards still work without images
    }
  };

  const formatPct = (pct: number) => pct ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '0.00%';

  return (
    <div>
      {/* Filters */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search contracts..."
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['all', 'active', 'draft'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: '8px 16px',
                    border: `2px solid ${filter === f ? 'var(--primary)' : 'var(--border)'}`,
                    background: filter === f ? 'var(--primary)' : 'transparent',
                    color: filter === f ? 'var(--white)' : 'var(--text)',
                    borderRadius: '4px',
                    fontSize: '9pt',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Contracts List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: '9pt' }}>
          Loading contracts...
        </div>
      ) : contracts.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '8px' }}>No contracts found</div>
            <div style={{ fontSize: '9pt' }}>
              {curatorId ? 'You haven\'t created any contracts yet.' : 'No contracts match your search criteria.'}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {contracts.map(contract => {
            const images = contractImages[contract.id] || [];
            return (
              <div
                key={contract.id}
                className="card"
                style={{ cursor: 'pointer', transition: 'transform 0.12s ease, box-shadow 0.12s ease', overflow: 'hidden' }}
                onClick={() => onSelectContract(contract.id)}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
                data-contract-id={contract.id}
                data-contract-symbol={contract.contract_symbol}
                data-contract-type={contract.contract_type}
                data-contract-status={contract.status}
                data-aum-cents={contract.total_assets_under_management_cents}
                data-min-investment-cents={contract.minimum_investment_cents}
                data-return-pct={contract.total_return_pct}
                data-regulatory={contract.regulatory_status}
                role="article"
                aria-label={`${contract.contract_name} — ${contract.contract_type} — ${formatCurrencyFromCents(contract.total_assets_under_management_cents)} AUM`}
              >
                {/* Compact asset avatars — hover for full images */}
                {images.length > 0 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}>
                    {images.slice(0, 6).map((url, i) => (
                      <div key={i} style={{
                        width: '40px', height: '30px', borderRadius: '3px', overflow: 'hidden',
                        border: '1px solid var(--border)', flexShrink: 0,
                      }}>
                        <img
                          src={url}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                    ))}
                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontWeight: 700, marginLeft: '4px' }}>
                      {images.length} vehicle{images.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '16px', alignItems: 'center' }}>
                    {/* Identity */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <h3 style={{ margin: 0, fontSize: '12pt', fontWeight: 900 }}>
                          {contract.contract_name}
                        </h3>
                        <HoverCard content={
                          <div style={{ padding: '10px' }}>
                            <div style={{ fontWeight: 900, marginBottom: '4px', textTransform: 'uppercase' }}>{contract.status}</div>
                            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                              {contract.status === 'active' ? 'Accepting subscriptions. NAV updated daily.' :
                               contract.status === 'approved' ? 'Approved and ready for investment.' :
                               contract.status === 'draft' ? 'Not yet published. Only visible to curator.' :
                               'Contract is ' + contract.status}
                            </div>
                          </div>
                        } width={220}>
                          <span style={{
                            padding: '2px 8px',
                            background: contract.status === 'active' ? 'var(--success, #10b981)' :
                                       contract.status === 'draft' ? 'var(--text-muted)' : 'var(--border)',
                            color: 'var(--white)',
                            borderRadius: '4px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            textTransform: 'uppercase'
                          }}>
                            {contract.status}
                          </span>
                        </HoverCard>
                      </div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700 }}>{contract.contract_symbol}</span>
                        <span>•</span>
                        <DrillDown concept={contract.contract_type} value={contract.contract_type}>
                          {contract.contract_type.replace('_', ' ').toUpperCase()}
                        </DrillDown>
                        {contract.regulatory_status && (
                          <>
                            <span>•</span>
                            <DrillDown concept={contract.regulatory_status} value={contract.regulatory_status}>
                              {contract.regulatory_status.replace('_', ' ').toUpperCase()}
                            </DrillDown>
                          </>
                        )}
                      </div>
                      {contract.curator_name && (
                        <HoverCard content={
                          <div style={{ padding: '10px' }}>
                            <div style={{ fontWeight: 900, marginBottom: '4px' }}>{contract.curator_name}</div>
                            <HoverStat label="Role" value="Curator / Manager" />
                            <HoverStat label="Contracts" value={contracts.filter(c => c.curator_name === contract.curator_name).length} />
                            {contract.curator_bio && <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '6px' }}>{contract.curator_bio}</div>}
                            {contract.curator_credentials?.length > 0 && (
                              <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {contract.curator_credentials.map((c: string, i: number) => (
                                  <span key={i} style={{ padding: '1px 6px', background: 'var(--primary)', color: '#fff', borderRadius: '3px', fontSize: '7pt', fontWeight: 700 }}>{c}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        } width={240}>
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', cursor: 'default', borderBottom: '1px dotted var(--text-muted)', display: 'inline' }}>
                            Curated by {contract.curator_name}
                          </div>
                        </HoverCard>
                      )}
                      {contract.contract_description && (
                        <HoverCard content={
                          <div style={{ padding: '10px' }}>
                            <div style={{ fontWeight: 700, marginBottom: '6px' }}>{contract.contract_name}</div>
                            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                              {contract.contract_description}
                            </div>
                          </div>
                        } width={380}>
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '12px', cursor: 'default' }}>
                            {contract.contract_description.slice(0, 100)}{contract.contract_description.length > 100 ? '...' : ''}
                          </div>
                        </HoverCard>
                      )}
                    </div>

                    {/* AUM */}
                    <HoverCard content={
                      <div style={{ padding: '10px' }}>
                        <div style={{ fontWeight: 900, marginBottom: '6px' }}>Assets Under Management</div>
                        <HoverStat label="Total AUM" value={formatCurrencyFromCents(contract.total_assets_under_management_cents)} />
                        <HoverStat label="Investors" value={contract.total_investors || 0} />
                        <HoverStat label="NAV/Share" value={contract.current_nav_cents ? formatCurrencyFromCents(contract.current_nav_cents) : '—'} />
                        <HoverStat label="Shares Outstanding" value={contract.total_shares_authorized?.toLocaleString() || '—'} />
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                          AUM = total value of all underlying assets managed by this contract.
                        </div>
                      </div>
                    } width={260}>
                      <div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>AUM</div>
                        <div style={{ fontSize: '12pt', fontWeight: 900 }}>
                          {formatCurrencyFromCents(contract.total_assets_under_management_cents)}
                        </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {contract.total_investors || 0} investors
                        </div>
                      </div>
                    </HoverCard>

                    {/* Performance */}
                    <HoverCard content={
                      <div style={{ padding: '10px' }}>
                        <div style={{ fontWeight: 900, marginBottom: '6px' }}>Performance Metrics</div>
                        <HoverStat label="Total Return" value={formatPct(contract.total_return_pct)} color={contract.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'} />
                        <HoverStat label="Annualized" value={contract.annualized_return_pct ? formatPct(contract.annualized_return_pct) : '—'} />
                        {contract.volatility_pct != null && <HoverStat label="Volatility" value={`${contract.volatility_pct.toFixed(2)}%`} />}
                        {contract.sharpe_ratio != null && <HoverStat label="Sharpe Ratio" value={contract.sharpe_ratio.toFixed(2)} />}
                        {contract.max_drawdown_pct != null && <HoverStat label="Max Drawdown" value={`${contract.max_drawdown_pct.toFixed(2)}%`} color="var(--danger, #ef4444)" />}
                        {contract.target_returns_pct && <HoverStat label="Target Return" value={`${contract.target_returns_pct}%`} />}
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                          Past performance does not guarantee future results.
                        </div>
                      </div>
                    } width={260}>
                      <div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Performance</div>
                        <div style={{ fontSize: '12pt', fontWeight: 900, color: contract.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                          {formatPct(contract.total_return_pct)}
                        </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {contract.annualized_return_pct ? formatPct(contract.annualized_return_pct) + ' ann.' : 'N/A'}
                        </div>
                      </div>
                    </HoverCard>

                    {/* Terms */}
                    <HoverCard content={
                      <div style={{ padding: '10px' }}>
                        <div style={{ fontWeight: 900, marginBottom: '6px' }}>Investment Terms</div>
                        <HoverStat label="Minimum" value={formatCurrencyFromCents(contract.minimum_investment_cents)} />
                        {contract.maximum_investment_cents && <HoverStat label="Maximum" value={formatCurrencyFromCents(contract.maximum_investment_cents)} />}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0', paddingTop: '4px' }}>
                          <div style={{ fontWeight: 700, fontSize: '7pt', textTransform: 'uppercase', marginBottom: '4px', color: 'var(--text-muted)' }}>Fee Structure</div>
                          <HoverStat label="Management" value={`${contract.management_fee_pct}% annually`} />
                          {contract.performance_fee_pct > 0 && <HoverStat label="Performance" value={`${contract.performance_fee_pct}%`} />}
                          <HoverStat label="Transaction" value={`${contract.transaction_fee_pct}%`} />
                          {contract.setup_fee_cents > 0 && <HoverStat label="Setup" value={formatCurrencyFromCents(contract.setup_fee_cents)} />}
                          {contract.early_exit_fee_pct > 0 && <HoverStat label="Early Exit" value={`${contract.early_exit_fee_pct}%`} color="var(--danger, #ef4444)" />}
                        </div>
                        <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0', paddingTop: '4px' }}>
                          <HoverStat label="Liquidity" value={contract.liquidity_type?.replace('_', ' ')} />
                          {contract.lockup_period_days && <HoverStat label="Lockup" value={`${contract.lockup_period_days} days`} />}
                          {contract.redemption_notice_days > 0 && <HoverStat label="Notice Period" value={`${contract.redemption_notice_days} days`} />}
                        </div>
                        {contract.risk_level && (
                          <HoverStat label="Risk Level" value={contract.risk_level.toUpperCase()} color={
                            contract.risk_level === 'conservative' ? 'var(--success, #10b981)' :
                            contract.risk_level === 'moderate' ? '#f59e0b' :
                            'var(--danger, #ef4444)'
                          } />
                        )}
                      </div>
                    } width={260}>
                      <div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Terms</div>
                        <div style={{ fontSize: '9pt', fontWeight: 700 }}>
                          Min: {formatCurrencyFromCents(contract.minimum_investment_cents)}
                        </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {contract.management_fee_pct}% mgmt{contract.performance_fee_pct > 0 ? ` / ${contract.performance_fee_pct}% perf` : ''}
                        </div>
                        {contract.risk_level && (
                          <div style={{ fontSize: '7pt', marginTop: '2px', fontWeight: 700, textTransform: 'uppercase',
                            color: contract.risk_level === 'conservative' ? 'var(--success, #10b981)' : contract.risk_level === 'moderate' ? '#f59e0b' : 'var(--danger, #ef4444)' }}>
                            {contract.risk_level}
                          </div>
                        )}
                      </div>
                    </HoverCard>
                  </div>

                  {/* Tags with hovers */}
                  {contract.tags && contract.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: '12px', flexWrap: 'wrap' }}>
                      {contract.tags.map((tag: string, idx: number) => (
                        <HoverCard key={idx} content={
                          <div style={{ padding: '8px' }}>
                            <div style={{ fontWeight: 700, marginBottom: '4px' }}>#{tag}</div>
                            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                              {contracts.filter(c => c.tags?.includes(tag)).length} contract{contracts.filter(c => c.tags?.includes(tag)).length !== 1 ? 's' : ''} with this tag
                            </div>
                          </div>
                        } width={180} delay={200}>
                          <span
                            style={{
                              padding: '2px 8px',
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              fontSize: '7pt',
                              color: 'var(--text-muted)',
                              cursor: 'default',
                            }}
                          >
                            {tag}
                          </span>
                        </HoverCard>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
