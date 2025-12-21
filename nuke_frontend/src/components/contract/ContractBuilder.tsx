import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import AssetSelector from './AssetSelector';
import TermsEditor from './TermsEditor';

interface ContractBuilderProps {
  onContractCreated: (contractId: string) => void;
}

interface ContractData {
  // Basic Info
  contract_name: string;
  contract_symbol: string;
  contract_description: string;
  contract_type: string;
  
  // Curator Info
  curator_name: string;
  curator_bio: string;
  curator_credentials: string[];
  
  // Legal Structure
  legal_entity_type: string;
  legal_entity_name: string;
  jurisdiction: string;
  regulatory_status: string;
  
  // Investment Terms
  minimum_investment_cents: number;
  maximum_investment_cents: number | null;
  share_structure: string;
  total_shares_authorized: number | null;
  initial_share_price_cents: number | null;
  
  // Fees
  management_fee_pct: number;
  performance_fee_pct: number;
  performance_fee_hurdle_pct: number;
  transaction_fee_pct: number;
  setup_fee_cents: number;
  early_exit_fee_pct: number;
  
  // Liquidity
  liquidity_type: string;
  lockup_period_days: number | null;
  redemption_frequency: string;
  redemption_notice_days: number;
  
  // Strategy
  investment_strategy: string;
  target_returns_pct: number | null;
  risk_level: string;
  rebalancing_frequency: string;
  
  // Transparency
  transparency_level: string;
  reporting_frequency: string;
  audit_required: boolean;
  custodian_name: string | null;
  
  // Status
  status: string;
  tags: string[];
}

export default function ContractBuilder({ onContractCreated }: ContractBuilderProps) {
  const [step, setStep] = useState<'basic' | 'assets' | 'terms' | 'review'>('basic');
  const [contract, setContract] = useState<Partial<ContractData>>({
    contract_type: 'etf',
    legal_entity_type: 'limited_partnership',
    jurisdiction: 'Delaware, USA',
    regulatory_status: 'private_placement',
    minimum_investment_cents: 10000,
    share_structure: 'shares',
    management_fee_pct: 0.10,
    performance_fee_pct: 0.00,
    transaction_fee_pct: 0.05,
    liquidity_type: 'daily',
    redemption_frequency: 'daily',
    risk_level: 'moderate',
    rebalancing_frequency: 'quarterly',
    transparency_level: 'full',
    reporting_frequency: 'monthly',
    status: 'draft',
    tags: []
  });
  const [selectedAssets, setSelectedAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
  };

  const updateContract = (updates: Partial<ContractData>) => {
    setContract(prev => ({ ...prev, ...updates }));
  };

  const handleSaveDraft = async () => {
    if (!user) {
      setError('You must be logged in to create contracts');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from('custom_investment_contracts')
        .insert({
          ...contract,
          curator_id: user.id,
          curator_credentials: contract.curator_credentials || [],
          tags: contract.tags || [],
          metadata: {}
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Save assets if any selected
      if (selectedAssets.length > 0) {
        const assetsToInsert = selectedAssets.map(asset => ({
          contract_id: data.id,
          asset_type: asset.type,
          asset_id: asset.id,
          allocation_pct: asset.allocation_pct || null,
          allocation_cents: asset.allocation_cents || null,
          curator_notes: asset.notes || null,
          current_value_cents: asset.value_cents || null
        }));

        const { error: assetsError } = await supabase
          .from('contract_assets')
          .insert(assetsToInsert);

        if (assetsError) throw assetsError;
      }

      onContractCreated(data.id);
    } catch (e: any) {
      console.error('Failed to save contract:', e);
      setError(e?.message || 'Failed to save contract');
    } finally {
      setLoading(false);
    }
  };

  const formatCents = (cents: number) => `$${(cents / 100).toLocaleString()}`;

  return (
    <div>
      {/* Progress Steps */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {(['basic', 'assets', 'terms', 'review'] as const).map((s, idx) => (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '9pt',
              color: step === s ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: step === s ? 700 : 400
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: `2px solid ${step === s ? 'var(--primary)' : 'var(--border)'}`,
                background: step === s ? 'var(--primary)' : 'transparent',
                color: step === s ? 'var(--white)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '8pt',
                fontWeight: 700
              }}
            >
              {idx + 1}
            </div>
            <span style={{ textTransform: 'uppercase' }}>
              {s === 'basic' ? 'Basic Info' : s === 'assets' ? 'Select Assets' : s === 'terms' ? 'Terms & Fees' : 'Review'}
            </span>
            {idx < 3 && (
              <span style={{ color: 'var(--border)', margin: '0 4px' }}>→</span>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '16px', border: '2px solid var(--danger, #ef4444)' }}>
          <div className="card-body" style={{ color: 'var(--danger, #ef4444)', fontSize: '9pt' }}>
            {error}
          </div>
        </div>
      )}

      {/* Step Content */}
      {step === 'basic' && (
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Contract Basic Information</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Contract Name *
                </label>
                <input
                  type="text"
                  value={contract.contract_name || ''}
                  onChange={(e) => updateContract({ contract_name: e.target.value })}
                  placeholder="e.g., Vintage Squarebody Collection Fund"
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Contract Symbol (Ticker) *
                </label>
                <input
                  type="text"
                  value={contract.contract_symbol || ''}
                  onChange={(e) => updateContract({ contract_symbol: e.target.value.toUpperCase() })}
                  placeholder="e.g., SQBD, VINT, CLASSIC"
                  maxLength={10}
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px', textTransform: 'uppercase' }}
                />
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                  2-10 characters, uppercase letters/numbers
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Description
                </label>
                <textarea
                  value={contract.contract_description || ''}
                  onChange={(e) => updateContract({ contract_description: e.target.value })}
                  placeholder="Describe this investment contract, its strategy, and target investors..."
                  rows={4}
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px', fontFamily: 'inherit' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Contract Type *
                </label>
                <select
                  value={contract.contract_type || 'etf'}
                  onChange={(e) => updateContract({ contract_type: e.target.value })}
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                >
                  <option value="etf">ETF (Exchange-Traded Fund)</option>
                  <option value="bond_fund">Bond Fund</option>
                  <option value="equity_fund">Equity Fund (Profit-Sharing Stakes)</option>
                  <option value="hybrid">Hybrid (Mixed Assets)</option>
                  <option value="project_fund">Project Fund</option>
                  <option value="organization_fund">Organization Fund</option>
                  <option value="custom">Custom Structure</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Your Name (Curator) *
                  </label>
                  <input
                    type="text"
                    value={contract.curator_name || ''}
                    onChange={(e) => updateContract({ curator_name: e.target.value })}
                    placeholder="John Smith"
                    style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                    Bio / Credentials
                  </label>
                  <textarea
                    value={contract.curator_bio || ''}
                    onChange={(e) => updateContract({ curator_bio: e.target.value })}
                    placeholder="Your background, credentials, investment experience..."
                    rows={2}
                    style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px', fontFamily: 'inherit' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={contract.tags?.join(', ') || ''}
                  onChange={(e) => updateContract({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                  placeholder="vintage, trucks, restoration, classic"
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                />
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="button button-primary"
                onClick={() => setStep('assets')}
                disabled={!contract.contract_name || !contract.contract_symbol || !contract.curator_name}
              >
                NEXT: SELECT ASSETS
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'assets' && (
        <AssetSelector
          selectedAssets={selectedAssets}
          onAssetsChange={setSelectedAssets}
          onBack={() => setStep('basic')}
          onNext={() => setStep('terms')}
        />
      )}

      {step === 'terms' && (
        <TermsEditor
          contract={contract}
          onContractUpdate={updateContract}
          onBack={() => setStep('assets')}
          onNext={() => setStep('review')}
        />
      )}

      {step === 'review' && (
        <div>
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header">
              <h3 className="heading-3">Review Contract</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Contract Details</div>
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '16px' }}>
                    <strong>Name:</strong> {contract.contract_name}<br/>
                    <strong>Symbol:</strong> {contract.contract_symbol}<br/>
                    <strong>Type:</strong> {contract.contract_type?.toUpperCase()}<br/>
                    <strong>Curator:</strong> {contract.curator_name}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Selected Assets</div>
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                    {selectedAssets.length} assets selected
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Investment Terms</div>
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '16px' }}>
                    <strong>Minimum Investment:</strong> {contract.minimum_investment_cents ? formatCents(contract.minimum_investment_cents) : 'Not set'}<br/>
                    <strong>Management Fee:</strong> {contract.management_fee_pct}%<br/>
                    <strong>Transaction Fee:</strong> {contract.transaction_fee_pct}%<br/>
                    <strong>Liquidity:</strong> {contract.liquidity_type}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
            <button
              className="button button-secondary"
              onClick={() => setStep('terms')}
            >
              BACK
            </button>
            <button
              className="button button-primary"
              onClick={handleSaveDraft}
              disabled={loading || !contract.contract_name || !contract.contract_symbol}
            >
              {loading ? 'SAVING...' : 'SAVE CONTRACT'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

