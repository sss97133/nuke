import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ContractMarketplaceProps {
  curatorId?: string;
  onSelectContract: (contractId: string) => void;
}

export default function ContractMarketplace({ curatorId, onSelectContract }: ContractMarketplaceProps) {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'draft'>('all');
  const [searchQuery, setSearchQuery] = useState('');

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
    } catch (e: any) {
      console.error('Failed to load contracts:', e);
    } finally {
      setLoading(false);
    }
  };

  const formatUSD = (cents: number) => cents ? `$${(cents / 1000).toLocaleString()}k` : '$0';
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
        <div style={{ display: 'grid', gap: '12px' }}>
          {contracts.map(contract => (
            <div
              key={contract.id}
              className="card"
              style={{ cursor: 'pointer', transition: 'transform 0.12s ease' }}
              onClick={() => onSelectContract(contract.id)}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
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
                        {contract.contract_description.slice(0, 100)}...
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>AUM</div>
                    <div style={{ fontSize: '12pt', fontWeight: 900 }}>
                      {formatUSD(contract.total_assets_under_management_cents)}
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
                      Min: {formatUSD(contract.minimum_investment_cents)}
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
          ))}
        </div>
      )}
    </div>
  );
}

