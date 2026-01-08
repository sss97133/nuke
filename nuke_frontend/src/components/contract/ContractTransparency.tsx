import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface ContractTransparencyProps {
  contractId: string;
  onBack: () => void;
}

export default function ContractTransparency({ contractId, onBack }: ContractTransparencyProps) {
  const navigate = useNavigate();
  const [contract, setContract] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadContractData();
  }, [contractId]);

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

      // Load assets using transparency view
      const { data: assetsData, error: assetsError } = await supabase
        .from('contract_assets')
        .select(`
          *,
          vehicle:vehicles!contract_assets_asset_id_fkey(id, year, make, model, current_value, location),
          organization:businesses!contract_assets_asset_id_fkey(id, business_name, business_type, city, state, country)
        `)
        .eq('contract_id', contractId);

      if (assetsError) throw assetsError;

      // Fetch detailed asset info based on type
      const enrichedAssets = await Promise.all((assetsData || []).map(async (asset) => {
        let details: any = {};

        switch (asset.asset_type) {
          case 'vehicle':
            const { data: vehicleData } = await supabase
              .from('vehicles')
              .select('id, year, make, model, current_value, location, purchase_location, is_public')
              .eq('id', asset.asset_id)
              .single();
            details = vehicleData;
            break;
          case 'organization':
            const { data: orgData } = await supabase
              .from('businesses')
              .select('id, name, business_type, location')
              .eq('id', asset.asset_id)
              .single();
            details = orgData;
            break;
          case 'bond':
            const { data: bondData } = await supabase
              .from('vehicle_bonds')
              .select('id, principal_amount_cents, interest_rate_pct, term_months, status')
              .eq('id', asset.asset_id)
              .single();
            details = bondData;
            break;
          case 'stake':
            const { data: stakeData } = await supabase
              .from('vehicle_funding_rounds')
              .select('id, target_amount_cents, raised_amount_cents, profit_share_pct, status')
              .eq('id', asset.asset_id)
              .single();
            details = stakeData;
            break;
        }

        return { ...asset, details };
      }));

      setAssets(enrichedAssets);
    } catch (e: any) {
      console.error('Failed to load contract:', e);
      setError(e?.message || 'Failed to load contract details');
    } finally {
      setLoading(false);
    }
  };

  const formatUSD = (cents: number) => cents ? `$${(cents / 100).toLocaleString()}` : '$0';
  const formatPct = (pct: number) => pct ? `${pct.toFixed(2)}%` : '0%';

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

  return (
    <div>
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
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {contract.contract_symbol} • {contract.contract_type.toUpperCase()} • Curated by {contract.curator_name || 'Unknown'}
              </div>
              {contract.contract_description && (
                <div style={{ fontSize: '9pt', color: 'var(--text)', lineHeight: '14px' }}>
                  {contract.contract_description}
                </div>
              )}
            </div>
            <div>
              <button className="button button-primary" onClick={() => navigate(`/market/exchange/${contract.contract_symbol}`)}>
                INVEST NOW
              </button>
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
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(totalValue)}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>Portfolio value</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="heading-3">AUM</h3></div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(contract.total_assets_under_management_cents)}</div>
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
                <strong>Minimum:</strong> {formatUSD(contract.minimum_investment_cents)}<br/>
                {contract.maximum_investment_cents && <><strong>Maximum:</strong> {formatUSD(contract.maximum_investment_cents)}<br/></>}
                <strong>Liquidity:</strong> {contract.liquidity_type}<br/>
                {contract.lockup_period_days && <><strong>Lockup:</strong> {contract.lockup_period_days} days<br/></>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Fee Structure</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '16px' }}>
                <strong>Management:</strong> {contract.management_fee_pct}% annually<br/>
                {contract.performance_fee_pct > 0 && <><strong>Performance:</strong> {contract.performance_fee_pct}%<br/></>}
                <strong>Transaction:</strong> {contract.transaction_fee_pct}%<br/>
                {contract.setup_fee_cents > 0 && <><strong>Setup:</strong> {formatUSD(contract.setup_fee_cents)}<br/></>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Legal Structure</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '16px' }}>
                <strong>Entity:</strong> {contract.legal_entity_type.replace('_', ' ').toUpperCase()}<br/>
                <strong>Jurisdiction:</strong> {contract.jurisdiction}<br/>
                <strong>Regulatory:</strong> {contract.regulatory_status.replace('_', ' ').toUpperCase()}<br/>
                <strong>Transparency:</strong> {contract.transparency_level.toUpperCase()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Underlying Assets - Full Transparency */}
      <div className="card">
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
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '2fr 1fr 1fr 1fr 100px',
                gap: '12px',
                fontSize: '9pt',
                fontWeight: 700,
                padding: '12px 8px',
                borderBottom: '2px solid var(--border)',
                color: 'var(--text-muted)',
                marginBottom: '12px'
              }}>
                <div>ASSET</div>
                <div>VALUE</div>
                <div>ALLOCATION</div>
                <div>PERFORMANCE</div>
                <div>ACTION</div>
              </div>
              
              {assets.map((asset) => {
                const allocationPct = totalValue > 0 ? ((asset.current_value_cents || 0) / totalValue * 100) : 0;
                const assetName = asset.details ? 
                  (asset.asset_type === 'vehicle' ? `${asset.details.year} ${asset.details.make} ${asset.details.model}` :
                   asset.asset_type === 'organization' ? asset.details.name :
                   `${asset.asset_type.toUpperCase()} #${asset.asset_id.slice(-8)}`) :
                  `${asset.asset_type.toUpperCase()} #${asset.asset_id.slice(-8)}`;

                return (
                  <div
                    key={asset.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1fr 1fr 1fr 100px',
                      gap: '12px',
                      fontSize: '9pt',
                      padding: '12px 8px',
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 0.12s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '10pt' }}>{assetName}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '8pt', marginTop: '2px' }}>
                        {asset.asset_type.toUpperCase()} • {asset.curator_notes || 'No notes'}
                      </div>
                    </div>
                    
                    <div style={{ fontWeight: 700 }}>
                      {formatUSD(asset.current_value_cents || 0)}
                    </div>
                    
                    <div>
                      {asset.allocation_pct ? formatPct(asset.allocation_pct) : formatPct(allocationPct)}
                    </div>
                    
                    <div style={{ color: (asset.unrealized_gain_loss_pct || 0) >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                      {formatPct(asset.unrealized_gain_loss_pct || 0)}
                    </div>
                    
                    <div>
                      {asset.asset_type === 'vehicle' && asset.details && (
                        <button
                          onClick={() => navigate(`/vehicle/${asset.asset_id}`)}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid var(--primary)',
                            borderRadius: '2px',
                            background: 'var(--primary)',
                            color: 'var(--white)',
                            fontSize: '8pt',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          VIEW
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '16px' }}>
        <button className="button button-secondary" onClick={onBack}>
          Back to Marketplace
        </button>
      </div>
    </div>
  );
}

