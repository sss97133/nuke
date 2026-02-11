import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyFromCents } from '../../utils/currency';

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
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <h3 style={{ margin: 0, fontSize: '12pt', fontWeight: 900 }}>
                          {contract.contract_name}
                        </h3>
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
                      </div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        {contract.contract_symbol} • {contract.contract_type.toUpperCase()}
                      </div>
                      {contract.curator_name && (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          Curated by {contract.curator_name}
                        </div>
                      )}
                      {contract.contract_description && (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '12px' }}>
                          {contract.contract_description.slice(0, 120)}{contract.contract_description.length > 120 ? '...' : ''}
                        </div>
                      )}
                    </div>

                    <div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>AUM</div>
                      <div style={{ fontSize: '12pt', fontWeight: 900 }}>
                        {formatCurrencyFromCents(contract.total_assets_under_management_cents)}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {contract.total_investors || 0} investors
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Performance</div>
                      <div style={{ fontSize: '12pt', fontWeight: 900, color: contract.total_return_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                        {formatPct(contract.total_return_pct)}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {contract.annualized_return_pct ? formatPct(contract.annualized_return_pct) + ' annualized' : 'N/A'}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Terms</div>
                      <div style={{ fontSize: '9pt', fontWeight: 700 }}>
                        Min: {formatCurrencyFromCents(contract.minimum_investment_cents)}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {contract.management_fee_pct}% mgmt fee
                      </div>
                      {contract.transparency_level && (
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase' }}>
                          {contract.transparency_level} transparency
                        </div>
                      )}
                    </div>
                  </div>

                  {contract.tags && contract.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: '12px', flexWrap: 'wrap' }}>
                      {contract.tags.map((tag: string, idx: number) => (
                        <span
                          key={idx}
                          style={{
                            padding: '2px 8px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            fontSize: '7pt',
                            color: 'var(--text-muted)'
                          }}
                        >
                          {tag}
                        </span>
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
