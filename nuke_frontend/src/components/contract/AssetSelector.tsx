import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface AssetSelectorProps {
  selectedAssets: any[];
  onAssetsChange: (assets: any[]) => void;
  onBack: () => void;
  onNext: () => void;
}

type AssetType = 'vehicle' | 'organization' | 'bond' | 'stake' | 'listing' | 'fund';

export default function AssetSelector({ selectedAssets, onAssetsChange, onBack, onNext }: AssetSelectorProps) {
  const [assetType, setAssetType] = useState<AssetType>('vehicle');
  const [searchQuery, setSearchQuery] = useState('');
  const [availableAssets, setAvailableAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [allocationMode, setAllocationMode] = useState<'percentage' | 'fixed'>('percentage');

  useEffect(() => {
    loadAssets();
  }, [assetType, searchQuery]);

  const loadAssets = async () => {
    setLoading(true);
    try {
      let query: any;

      switch (assetType) {
        case 'vehicle':
          query = supabase
            .from('vehicles')
            .select('id, year, make, model, current_value, location, is_public')
            .eq('is_public', true)
            .not('current_value', 'is', null)
            .order('current_value', { ascending: false })
            .limit(50);
          break;
        case 'organization':
          query = supabase
            .from('businesses')
            .select('id, name, business_type, location')
            .limit(50);
          break;
        case 'bond':
          query = supabase
            .from('vehicle_bonds')
            .select('id, vehicle_id, principal_amount_cents, interest_rate_pct, status')
            .eq('status', 'open')
            .limit(50);
          break;
        case 'stake':
          query = supabase
            .from('vehicle_funding_rounds')
            .select('id, vehicle_id, target_amount_cents, raised_amount_cents, status')
            .eq('status', 'fundraising')
            .limit(50);
          break;
        default:
          setAvailableAssets([]);
          setLoading(false);
          return;
      }

      if (searchQuery) {
        if (assetType === 'vehicle') {
          query = query.or(`make.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`);
        } else if (assetType === 'organization') {
          query = query.ilike('name', `%${searchQuery}%`);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      setAvailableAssets(data || []);
    } catch (e: any) {
      console.error('Failed to load assets:', e);
    } finally {
      setLoading(false);
    }
  };

  const addAsset = (asset: any) => {
    const valueCents = asset.current_value ? Math.round(asset.current_value * 100) : 
                      asset.principal_amount_cents || 
                      asset.target_amount_cents || 
                      0;

    const newAsset = {
      id: asset.id,
      type: assetType,
      name: assetType === 'vehicle' ? `${asset.year} ${asset.make} ${asset.model}` :
            assetType === 'organization' ? asset.name :
            `${assetType} #${asset.id.slice(-8)}`,
      value_cents: valueCents,
      allocation_pct: null,
      allocation_cents: null,
      notes: ''
    };

    onAssetsChange([...selectedAssets, newAsset]);
  };

  const removeAsset = (assetId: string) => {
    onAssetsChange(selectedAssets.filter(a => a.id !== assetId));
  };

  const updateAssetAllocation = (assetId: string, field: 'allocation_pct' | 'allocation_cents' | 'notes', value: any) => {
    onAssetsChange(selectedAssets.map(a => 
      a.id === assetId ? { ...a, [field]: value } : a
    ));
  };

  const formatUSD = (cents: number) => `$${(cents / 100).toLocaleString()}`;
  const totalValue = selectedAssets.reduce((sum, a) => sum + (a.value_cents || 0), 0);

  return (
    <div>
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <h3 className="heading-3">Select Assets for Contract</h3>
        </div>
        <div className="card-body">
          {/* Asset Type Selector */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              Asset Type
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(['vehicle', 'organization', 'bond', 'stake'] as AssetType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setAssetType(type)}
                  style={{
                    padding: '8px 16px',
                    border: `2px solid ${assetType === type ? 'var(--primary)' : 'var(--border)'}`,
                    background: assetType === type ? 'var(--primary)' : 'transparent',
                    color: assetType === type ? 'var(--white)' : 'var(--text)',
                    borderRadius: '4px',
                    fontSize: '9pt',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${assetType}s...`}
              style={{ width: '100%', padding: '8px', border: '2px solid var(--border)', borderRadius: '4px' }}
            />
          </div>

          {/* Available Assets */}
          <div style={{ maxHeight: '400px', overflowY: 'auto', border: '2px solid var(--border)', borderRadius: '4px', padding: '12px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                Loading {assetType}s...
              </div>
            ) : availableAssets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                No {assetType}s found
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {availableAssets.map(asset => {
                  const isSelected = selectedAssets.some(a => a.id === asset.id && a.type === assetType);
                  const valueCents = asset.current_value ? Math.round(asset.current_value * 100) : 
                                    asset.principal_amount_cents || 
                                    asset.target_amount_cents || 
                                    0;

                  return (
                    <div
                      key={asset.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: isSelected ? 'var(--surface)' : 'transparent'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                          {assetType === 'vehicle' ? `${asset.year} ${asset.make} ${asset.model}` :
                           assetType === 'organization' ? asset.name :
                           `${assetType.toUpperCase()} #${asset.id.slice(-8)}`}
                        </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {valueCents > 0 ? formatUSD(valueCents) : 'Value not set'}
                          {asset.location && ` • ${asset.location}`}
                        </div>
                      </div>
                      <button
                        onClick={() => isSelected ? removeAsset(asset.id) : addAsset(asset)}
                        style={{
                          padding: '6px 12px',
                          border: `2px solid ${isSelected ? 'var(--danger, #ef4444)' : 'var(--primary)'}`,
                          background: isSelected ? 'var(--danger, #ef4444)' : 'var(--primary)',
                          color: 'var(--white)',
                          borderRadius: '4px',
                          fontSize: '8pt',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {isSelected ? 'REMOVE' : 'ADD'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected Assets with Allocation */}
      {selectedAssets.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h3 className="heading-3">Selected Assets ({selectedAssets.length})</h3>
          </div>
          <div className="card-body">
            <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '9pt', fontWeight: 700 }}>Allocation Mode:</span>
              <button
                onClick={() => setAllocationMode('percentage')}
                style={{
                  padding: '4px 12px',
                  border: `2px solid ${allocationMode === 'percentage' ? 'var(--primary)' : 'var(--border)'}`,
                  background: allocationMode === 'percentage' ? 'var(--primary)' : 'transparent',
                  color: allocationMode === 'percentage' ? 'var(--white)' : 'var(--text)',
                  borderRadius: '4px',
                  fontSize: '8pt',
                  fontWeight: 700
                }}
              >
                PERCENTAGE
              </button>
              <button
                onClick={() => setAllocationMode('fixed')}
                style={{
                  padding: '4px 12px',
                  border: `2px solid ${allocationMode === 'fixed' ? 'var(--primary)' : 'var(--border)'}`,
                  background: allocationMode === 'fixed' ? 'var(--primary)' : 'transparent',
                  color: allocationMode === 'fixed' ? 'var(--white)' : 'var(--text)',
                  borderRadius: '4px',
                  fontSize: '8pt',
                  fontWeight: 700
                }}
              >
                FIXED AMOUNT
              </button>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              {selectedAssets.map(asset => (
                <div
                  key={`${asset.type}-${asset.id}`}
                  style={{
                    padding: '12px',
                    border: '2px solid var(--border)',
                    borderRadius: '4px',
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    gap: '12px',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '9pt', fontWeight: 700 }}>{asset.name}</div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {formatUSD(asset.value_cents)}
                    </div>
                  </div>

                  {allocationMode === 'percentage' ? (
                    <div>
                      <input
                        type="number"
                        value={asset.allocation_pct || ''}
                        onChange={(e) => updateAssetAllocation(asset.id, 'allocation_pct', parseFloat(e.target.value) || null)}
                        placeholder="%"
                        min="0"
                        max="100"
                        step="0.1"
                        style={{ width: '100%', padding: '6px', border: '2px solid var(--border)', borderRadius: '4px', fontSize: '9pt' }}
                      />
                    </div>
                  ) : (
                    <div>
                      <input
                        type="number"
                        value={asset.allocation_cents ? asset.allocation_cents / 100 : ''}
                        onChange={(e) => updateAssetAllocation(asset.id, 'allocation_cents', Math.round((parseFloat(e.target.value) || 0) * 100))}
                        placeholder="$"
                        min="0"
                        step="100"
                        style={{ width: '100%', padding: '6px', border: '2px solid var(--border)', borderRadius: '4px', fontSize: '9pt' }}
                      />
                    </div>
                  )}

                  <div>
                    <input
                      type="text"
                      value={asset.notes || ''}
                      onChange={(e) => updateAssetAllocation(asset.id, 'notes', e.target.value)}
                      placeholder="Curator notes..."
                      style={{ width: '100%', padding: '6px', border: '2px solid var(--border)', borderRadius: '4px', fontSize: '8pt' }}
                    />
                  </div>

                  <div>
                    <button
                      onClick={() => removeAsset(asset.id)}
                      style={{
                        padding: '6px 12px',
                        border: '2px solid var(--danger, #ef4444)',
                        background: 'transparent',
                        color: 'var(--danger, #ef4444)',
                        borderRadius: '4px',
                        fontSize: '8pt',
                        fontWeight: 700,
                        cursor: 'pointer',
                        width: '100%'
                      }}
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--surface)', borderRadius: '4px', fontSize: '9pt' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700 }}>Total Portfolio Value:</span>
                <span style={{ fontWeight: 700 }}>{formatUSD(totalValue)}</span>
              </div>
              {allocationMode === 'percentage' && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Total Allocation: {selectedAssets.reduce((sum, a) => sum + (a.allocation_pct || 0), 0).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
        <button className="button button-secondary" onClick={onBack}>
          BACK
        </button>
        <button
          className="button button-primary"
          onClick={onNext}
          disabled={selectedAssets.length === 0}
        >
          NEXT: TERMS & FEES
        </button>
      </div>
    </div>
  );
}

