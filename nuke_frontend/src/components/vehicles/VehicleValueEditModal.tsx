import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleValueEditModalProps {
  vehicleId: string;
  vehicleName: string;
  currentPurchasePrice: number | null;
  currentValue: number | null;
  onClose: () => void;
  onSave: () => void;
}

const VehicleValueEditModal: React.FC<VehicleValueEditModalProps> = ({
  vehicleId,
  vehicleName,
  currentPurchasePrice,
  currentValue,
  onClose,
  onSave
}) => {
  const [purchasePrice, setPurchasePrice] = useState<string>(
    currentPurchasePrice ? currentPurchasePrice.toString() : ''
  );
  const [currentPrice, setCurrentPrice] = useState<string>(
    currentValue ? currentValue.toString() : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const parseCurrency = (value: string): number | null => {
    // Remove currency symbols, commas, and whitespace
    const cleaned = value.replace(/[$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      const purchasePriceNum = purchasePrice ? parseCurrency(purchasePrice) : null;
      const currentPriceNum = currentPrice ? parseCurrency(currentPrice) : null;

      // Get current user for source attribution
      const { data: { user } } = await supabase.auth.getUser();

      // Use price source service if available, otherwise direct update
      try {
        const { updatePriceWithSource } = await import('../../services/priceSourceService');
        
        if (purchasePriceNum !== null && purchasePriceNum !== currentPurchasePrice) {
          await updatePriceWithSource(
            vehicleId,
            'purchase_price',
            purchasePriceNum,
            {
              source: 'user_input',
              updated_at: new Date().toISOString()
            },
            user?.id
          );
        }

        if (currentPriceNum !== null && currentPriceNum !== currentValue) {
          await updatePriceWithSource(
            vehicleId,
            'current_value',
            currentPriceNum,
            {
              source: 'user_input',
              updated_at: new Date().toISOString()
            },
            user?.id
          );
        }
      } catch (serviceError) {
        // Fallback to direct update if service not available
        const updates: any = {};
        if (purchasePriceNum !== null) updates.purchase_price = purchasePriceNum;
        if (currentPriceNum !== null) updates.current_value = currentPriceNum;
        updates.updated_at = new Date().toISOString();

        const { error: updateError } = await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicleId);

        if (updateError) throw updateError;
      }

      onSave();
      onClose();
    } catch (err: any) {
      console.error('Error saving vehicle value:', err);
      setError(err.message || 'Failed to save values');
    } finally {
      setSaving(false);
    }
  };

  const purchasePriceNum = purchasePrice ? parseCurrency(purchasePrice) : null;
  const currentPriceNum = currentPrice ? parseCurrency(currentPrice) : null;
  const roi = purchasePriceNum && currentPriceNum 
    ? currentPriceNum - purchasePriceNum 
    : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          border: '2px solid var(--border)', maxWidth: '480px',
          width: '100%', overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px',
            background: 'var(--accent)',
            color: 'var(--bg)',
            fontSize: '13px',
            fontWeight: 700
          }}
        >
          Set Value: {vehicleName}
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          <div style={{ marginBottom: '20px', fontSize: '11px', color: 'var(--text-muted)' }}>
            Track your investment by setting purchase price and current value. This helps calculate ROI over time.
          </div>

          {/* Purchase Price */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                marginBottom: '6px',
                color: 'var(--text)'
              }}
            >
              Purchase Price
            </label>
            <input
              type="text"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="Enter purchase price"
              className="input"
              style={{ width: '100%' }}
              onFocus={(e) => e.target.select()}
            />
            {purchasePriceNum !== null && (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {formatCurrency(purchasePriceNum)}
              </div>
            )}
          </div>

          {/* Current Value */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                marginBottom: '6px',
                color: 'var(--text)'
              }}
            >
              Current Value
            </label>
            <input
              type="text"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(e.target.value)}
              placeholder="Enter current value"
              className="input"
              style={{ width: '100%' }}
              onFocus={(e) => e.target.select()}
            />
            {currentPriceNum !== null && (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {formatCurrency(currentPriceNum)}
              </div>
            )}
          </div>

          {/* ROI Preview */}
          {roi !== null && (
            <div
              style={{
                padding: '12px',
                background: roi >= 0 ? 'var(--success-dim)' : 'var(--error-dim)',
                border: `2px solid ${roi >= 0 ? 'var(--success)' : 'var(--error)'}`, marginBottom: '16px'
              }}
            >
              <div style={{ fontSize: '9px', fontWeight: 600, marginBottom: '4px', color: roi >= 0 ? 'var(--success)' : 'var(--error)' }}>
                ROI Preview
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: roi >= 0 ? 'var(--success)' : 'var(--error)' }}>
                {roi >= 0 ? '+' : ''}{formatCurrency(roi)}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '10px',
                background: 'var(--error-dim)',
                border: '1px solid var(--error)', color: 'var(--error)',
                fontSize: '11px',
                marginBottom: '16px'
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Values'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleValueEditModal;

