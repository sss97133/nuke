import React from 'react';

interface TermsEditorProps {
  contract: any;
  onContractUpdate: (updates: any) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function TermsEditor({ contract, onContractUpdate, onBack, onNext }: TermsEditorProps) {
  const updateField = (field: string, value: any) => {
    onContractUpdate({ [field]: value });
  };

  const formatCents = (cents: number) => cents ? `$${(cents / 100).toLocaleString()}` : '';

  return (
    <div>
      {/* Investment Terms */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Investment Terms</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Minimum Investment ($)
              </label>
              <input
                type="number"
                value={contract.minimum_investment_cents ? contract.minimum_investment_cents / 100 : ''}
                onChange={(e) => updateField('minimum_investment_cents', Math.round((parseFloat(e.target.value) || 0) * 100))}
                min="0"
                step="100"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Maximum Investment ($) - Optional
              </label>
              <input
                type="number"
                value={contract.maximum_investment_cents ? contract.maximum_investment_cents / 100 : ''}
                onChange={(e) => updateField('maximum_investment_cents', e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null)}
                min="0"
                step="1000"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Share Structure
              </label>
              <select
                value={contract.share_structure || 'shares'}
                onChange={(e) => updateField('share_structure', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="shares">Shares</option>
                <option value="units">Units</option>
                <option value="tokens">Tokens</option>
                <option value="stakes">Stakes</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Initial Share Price ($) - Optional
              </label>
              <input
                type="number"
                value={contract.initial_share_price_cents ? contract.initial_share_price_cents / 100 : ''}
                onChange={(e) => updateField('initial_share_price_cents', e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null)}
                min="0"
                step="0.01"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Fee Structure */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Fee Structure</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Management Fee (% annually)
              </label>
              <input
                type="number"
                value={contract.management_fee_pct || 0}
                onChange={(e) => updateField('management_fee_pct', parseFloat(e.target.value) || 0)}
                min="0"
                max="10"
                step="0.01"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Performance Fee (% of gains)
              </label>
              <input
                type="number"
                value={contract.performance_fee_pct || 0}
                onChange={(e) => updateField('performance_fee_pct', parseFloat(e.target.value) || 0)}
                min="0"
                max="20"
                step="0.1"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Performance Fee Hurdle (%)
              </label>
              <input
                type="number"
                value={contract.performance_fee_hurdle_pct || 0}
                onChange={(e) => updateField('performance_fee_hurdle_pct', parseFloat(e.target.value) || 0)}
                min="0"
                step="0.1"
                placeholder="Only charge if return > hurdle"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Transaction Fee (%)
              </label>
              <input
                type="number"
                value={contract.transaction_fee_pct || 0}
                onChange={(e) => updateField('transaction_fee_pct', parseFloat(e.target.value) || 0)}
                min="0"
                max="5"
                step="0.01"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Setup Fee ($)
              </label>
              <input
                type="number"
                value={contract.setup_fee_cents ? contract.setup_fee_cents / 100 : 0}
                onChange={(e) => updateField('setup_fee_cents', Math.round((parseFloat(e.target.value) || 0) * 100))}
                min="0"
                step="10"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Early Exit Fee (%)
              </label>
              <input
                type="number"
                value={contract.early_exit_fee_pct || 0}
                onChange={(e) => updateField('early_exit_fee_pct', parseFloat(e.target.value) || 0)}
                min="0"
                max="10"
                step="0.1"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Liquidity Terms */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Liquidity Terms</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Liquidity Type
              </label>
              <select
                value={contract.liquidity_type || 'daily'}
                onChange={(e) => updateField('liquidity_type', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
                <option value="lockup_period">Lockup Period</option>
                <option value="at_maturity">At Maturity</option>
                <option value="illiquid">Illiquid</option>
              </select>
            </div>

            {contract.liquidity_type === 'lockup_period' && (
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Lockup Period (days)
                </label>
                <input
                  type="number"
                  value={contract.lockup_period_days || ''}
                  onChange={(e) => updateField('lockup_period_days', e.target.value ? parseInt(e.target.value) : null)}
                  min="0"
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Redemption Frequency
              </label>
              <select
                value={contract.redemption_frequency || 'daily'}
                onChange={(e) => updateField('redemption_frequency', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Redemption Notice (days)
              </label>
              <input
                type="number"
                value={contract.redemption_notice_days || 0}
                onChange={(e) => updateField('redemption_notice_days', parseInt(e.target.value) || 0)}
                min="0"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Legal Structure */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Legal Structure</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Entity Type
              </label>
              <select
                value={contract.legal_entity_type || 'limited_partnership'}
                onChange={(e) => updateField('legal_entity_type', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="limited_partnership">Limited Partnership</option>
                <option value="llc">LLC</option>
                <option value="trust">Trust</option>
                <option value="corporation">Corporation</option>
                <option value="spv">Special Purpose Vehicle (SPV)</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Legal Entity Name
              </label>
              <input
                type="text"
                value={contract.legal_entity_name || ''}
                onChange={(e) => updateField('legal_entity_name', e.target.value)}
                placeholder="e.g., Vintage Fund LP"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Jurisdiction
              </label>
              <input
                type="text"
                value={contract.jurisdiction || 'Delaware, USA'}
                onChange={(e) => updateField('jurisdiction', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Regulatory Status
              </label>
              <select
                value={contract.regulatory_status || 'private_placement'}
                onChange={(e) => updateField('regulatory_status', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="private_placement">Private Placement</option>
                <option value="reg_d">Reg D</option>
                <option value="reg_a">Reg A+</option>
                <option value="reg_cf">Reg CF</option>
                <option value="public">Public</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Investment Strategy */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Investment Strategy</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Investment Strategy Description
              </label>
              <textarea
                value={contract.investment_strategy || ''}
                onChange={(e) => updateField('investment_strategy', e.target.value)}
                placeholder="Describe your investment strategy, target market, and approach..."
                rows={4}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Target Returns (% annually)
                </label>
                <input
                  type="number"
                  value={contract.target_returns_pct || ''}
                  onChange={(e) => updateField('target_returns_pct', e.target.value ? parseFloat(e.target.value) : null)}
                  min="0"
                  step="0.1"
                  placeholder="Optional"
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Risk Level
                </label>
                <select
                  value={contract.risk_level || 'moderate'}
                  onChange={(e) => updateField('risk_level', e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                >
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="speculative">Speculative</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                  Rebalancing Frequency
                </label>
                <select
                  value={contract.rebalancing_frequency || 'quarterly'}
                  onChange={(e) => updateField('rebalancing_frequency', e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Transparency Settings */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Transparency & Reporting</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Transparency Level
              </label>
              <select
                value={contract.transparency_level || 'full'}
                onChange={(e) => updateField('transparency_level', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="full">Full (All assets visible, real-time)</option>
                <option value="partial">Partial (Aggregated data, periodic)</option>
                <option value="minimal">Minimal (High-level only)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Reporting Frequency
              </label>
              <select
                value={contract.reporting_frequency || 'monthly'}
                onChange={(e) => updateField('reporting_frequency', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={contract.audit_required || false}
                  onChange={(e) => updateField('audit_required', e.target.checked)}
                />
                Audit Required
              </label>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Custodian Name (Optional)
              </label>
              <input
                type="text"
                value={contract.custodian_name || ''}
                onChange={(e) => updateField('custodian_name', e.target.value)}
                placeholder="e.g., Bank of America, Fidelity"
                style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
        <button className="button button-secondary" onClick={onBack}>
          BACK
        </button>
        <button className="button button-primary" onClick={onNext}>
          NEXT: REVIEW
        </button>
      </div>
    </div>
  );
}

