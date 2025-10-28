/**
 * Mobile Price Editor
 * Quick inline price editing with history
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface MobilePriceEditorProps {
  vehicleId: string;
  initialData: any;
  session: any;
  onClose: () => void;
  onSaved?: () => void;
}

export const MobilePriceEditor: React.FC<MobilePriceEditorProps> = ({
  vehicleId,
  initialData,
  session,
  onClose,
  onSaved
}) => {
  const [prices, setPrices] = useState({
    msrp: initialData?.msrp || '',
    purchase_price: initialData?.purchase_price || '',
    current_value: initialData?.current_value || '',
    asking_price: initialData?.asking_price || '',
    is_for_sale: initialData?.is_for_sale || false
  });
  const [saving, setSaving] = useState(false);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);

  useEffect(() => {
    loadPriceHistory();
  }, [vehicleId]);

  const loadPriceHistory = async () => {
    const { data } = await supabase
      .from('vehicle_price_history')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('as_of', { ascending: false })
      .limit(10);

    setPriceHistory(data || []);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      // Build update payload
      const updates: any = {
        msrp: prices.msrp ? parseFloat(prices.msrp) : null,
        purchase_price: prices.purchase_price ? parseFloat(prices.purchase_price) : null,
        current_value: prices.current_value ? parseFloat(prices.current_value) : null,
        asking_price: prices.asking_price ? parseFloat(prices.asking_price) : null,
        is_for_sale: prices.is_for_sale
      };

      // Update vehicle
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      // Add to price history
      const historyEntries = [];
      const priceTypes: Array<{ key: string; type: string }> = [
        { key: 'msrp', type: 'msrp' },
        { key: 'purchase_price', type: 'purchase' },
        { key: 'current_value', type: 'current' },
        { key: 'asking_price', type: 'asking' }
      ];

      priceTypes.forEach(({ key, type }) => {
        const value = updates[key];
        const oldValue = initialData?.[key];
        if (value && value !== oldValue) {
          historyEntries.push({
            vehicle_id: vehicleId,
            price_type: type,
            value: value,
            source: 'mobile_ui'
          });
        }
      });

      if (historyEntries.length > 0) {
        await supabase.from('vehicle_price_history').insert(historyEntries);
      }

      // Trigger refresh
      window.dispatchEvent(new Event('vehicle_data_updated'));
      
      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save prices. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(val);
  };

  const calculateGain = () => {
    const purchase = prices.purchase_price ? parseFloat(prices.purchase_price) : 0;
    const current = prices.current_value ? parseFloat(prices.current_value) : 0;
    if (!purchase || !current) return null;
    
    const gain = current - purchase;
    const gainPct = (gain / purchase) * 100;
    return { gain, gainPct, isPositive: gain >= 0 };
  };

  const gain = calculateGain();

  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>💰 Edit Prices</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.content}>
          {/* Value Gain Card */}
          {gain && (
            <div style={{
              ...styles.gainCard,
              background: gain.isPositive ? '#d4edda' : '#f8d7da',
              borderColor: gain.isPositive ? '#28a745' : '#dc3545'
            }}>
              <div style={styles.gainLabel}>Current Gain/Loss</div>
              <div style={{
                ...styles.gainValue,
                color: gain.isPositive ? '#28a745' : '#dc3545'
              }}>
                {gain.isPositive ? '+' : ''}{formatPrice(gain.gain)}
              </div>
              <div style={styles.gainPct}>
                {gain.isPositive ? '+' : ''}{gain.gainPct.toFixed(1)}%
              </div>
            </div>
          )}

          {/* Price Fields */}
          <div style={styles.field}>
            <label style={styles.label}>Original MSRP</label>
            <input
              type="number"
              value={prices.msrp}
              onChange={(e) => setPrices({ ...prices, msrp: e.target.value })}
              placeholder="0"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Purchase Price</label>
            <input
              type="number"
              value={prices.purchase_price}
              onChange={(e) => setPrices({ ...prices, purchase_price: e.target.value })}
              placeholder="0"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Current Value Estimate</label>
            <input
              type="number"
              value={prices.current_value}
              onChange={(e) => setPrices({ ...prices, current_value: e.target.value })}
              placeholder="0"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Asking Price (if selling)</label>
            <input
              type="number"
              value={prices.asking_price}
              onChange={(e) => setPrices({ ...prices, asking_price: e.target.value })}
              placeholder="0"
              style={styles.input}
            />
          </div>

          {/* For Sale Toggle */}
          <div style={styles.toggleField}>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={prices.is_for_sale}
                onChange={(e) => setPrices({ ...prices, is_for_sale: e.target.checked })}
                style={styles.checkbox}
              />
              <span style={styles.toggleText}>📋 List for sale</span>
            </label>
          </div>

          {/* Price History */}
          {priceHistory.length > 0 && (
            <div style={styles.historySection}>
              <div style={styles.historyTitle}>📈 Recent Changes</div>
              <div style={styles.historyList}>
                {priceHistory.slice(0, 5).map(h => (
                  <div key={h.id} style={styles.historyItem}>
                    <span style={styles.historyType}>
                      {h.price_type === 'msrp' && 'MSRP'}
                      {h.price_type === 'purchase' && 'Purchase'}
                      {h.price_type === 'current' && 'Current Value'}
                      {h.price_type === 'asking' && 'Asking Price'}
                    </span>
                    <span style={styles.historyValue}>{formatPrice(h.value)}</span>
                    <span style={styles.historyDate}>
                      {new Date(h.as_of).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            style={styles.saveBtn}
          >
            {saving ? 'Saving...' : '✓ Save Prices'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    zIndex: 999999,
    display: 'flex',
    flexDirection: 'column' as const
  },
  modal: {
    background: '#ffffff',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '2px solid #000080',
    background: '#f0f0f0'
  },
  title: {
    margin: 0,
    fontSize: '10px',
    fontFamily: '"MS Sans Serif", sans-serif',
    fontWeight: 'bold'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '10px',
    cursor: 'pointer',
    padding: '0'
  },
  content: {
    padding: '16px',
    overflowY: 'auto' as const,
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  gainCard: {
    border: '2px solid',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center' as const
  },
  gainLabel: {
    fontSize: '10px',
    fontWeight: 'bold',
    marginBottom: '4px'
  },
  gainValue: {
    fontSize: '10px',
    fontWeight: 'bold',
    fontFamily: 'monospace'
  },
  gainPct: {
    fontSize: '10px',
    fontWeight: 'bold',
    marginTop: '4px'
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px'
  },
  label: {
    fontSize: '10px',
    fontWeight: 'bold',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  input: {
    padding: '14px',
    border: '2px inset #c0c0c0',
    borderRadius: '4px',
    fontSize: '10px',
    fontFamily: 'monospace'
  },
  toggleField: {
    padding: '12px',
    background: '#f9f9f9',
    border: '2px solid #c0c0c0',
    borderRadius: '4px'
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer'
  },
  checkbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer'
  },
  toggleText: {
    fontSize: '10px',
    fontWeight: 'bold'
  },
  historySection: {
    marginTop: '8px'
  },
  historyTitle: {
    fontSize: '10px',
    fontWeight: 'bold',
    marginBottom: '8px'
  },
  historyList: {
    background: '#f5f5f5',
    border: '2px solid #c0c0c0',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid #e0e0e0',
    fontSize: '12px'
  },
  historyType: {
    fontWeight: 'bold',
    flex: 1
  },
  historyValue: {
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'right' as const
  },
  historyDate: {
    color: '#666',
    flex: 1,
    textAlign: 'right' as const,
    fontSize: '11px'
  },
  saveBtn: {
    padding: '16px',
    background: '#000080',
    color: '#ffffff',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif',
    marginTop: 'auto'
  }
};

