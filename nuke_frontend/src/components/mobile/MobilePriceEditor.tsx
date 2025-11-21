/**
 * Mobile Price Editor
 * Quick inline price editing with history
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import CursorButton from '../CursorButton';

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

      // Add to price history (best-effort; non-fatal on error)
      try {
        const historyEntries: any[] = [];
        const priceTypes: Array<{ key: string; type: string }> = [
          { key: 'msrp', type: 'msrp' },
          { key: 'purchase_price', type: 'purchase' },
          { key: 'current_value', type: 'current' },
          { key: 'asking_price', type: 'asking' }
        ];

        priceTypes.forEach(({ key, type }) => {
          const value = (updates as any)[key];
          const oldValue = initialData?.[key];
          if (typeof value === 'number' && !Number.isNaN(value) && value !== oldValue) {
            historyEntries.push({
              vehicle_id: vehicleId,
              price_type: type,
              value,
              source: 'mobile_ui'
            });
          }
        });

        if (historyEntries.length > 0) {
          const { error: histErr } = await supabase
            .from('vehicle_price_history')
            .insert(historyEntries);
          if (histErr) console.debug('price history insert skipped:', histErr.message);
        }
      } catch (e) {
        console.debug('price history non-fatal error:', e);
      }

      // Trigger refresh
      window.dispatchEvent(new Event('vehicle_data_updated'));
      
      onSaved?.();
      onClose();
    } catch (error: any) {
      console.error('Save error:', error);
      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      alert(`Failed to save prices: ${errorMsg}\n\nPlease try again or contact support.`);
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
          <h2 style={styles.title}>Edit Prices</h2>
          <CursorButton onClick={onClose} variant="secondary" size="sm">✕</CursorButton>
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
          <CursorButton
            onClick={handleSave}
            disabled={saving}
            variant="primary"
            fullWidth
            size="md"
          >
            {saving ? 'Saving...' : 'Save Prices'}
          </CursorButton>
        </div>
      </div>
    </div>,
    document.body
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    zIndex: 999999,
    display: 'flex',
    flexDirection: 'column'
  },
  modal: {
    background: 'var(--bg)',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--space-4)',
    borderBottom: '2px solid var(--border)',
    background: 'var(--surface)'
  },
  title: {
    margin: 0,
    fontSize: '8pt',
    fontFamily: 'var(--font-family)',
    fontWeight: 700,
    color: 'var(--text)'
  },
  content: {
    padding: 'var(--space-4)',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)'
  },
  gainCard: {
    border: '2px solid',
    borderRadius: 'var(--radius)',
    padding: 'var(--space-4)',
    textAlign: 'center'
  },
  gainLabel: {
    fontSize: '8pt',
    fontWeight: 700,
    marginBottom: 'var(--space-1)',
    color: 'var(--text)'
  },
  gainValue: {
    fontSize: '8pt',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)'
  },
  gainPct: {
    fontSize: '8pt',
    fontWeight: 700,
    marginTop: 'var(--space-1)',
    fontFamily: 'var(--font-mono)'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)'
  },
  label: {
    fontSize: '8pt',
    fontWeight: 700,
    fontFamily: 'var(--font-family)',
    color: 'var(--text)'
  },
  input: {
    padding: 'var(--space-2)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '8pt',
    fontFamily: 'var(--font-mono)',
    background: 'var(--surface)',
    color: 'var(--text)'
  },
  toggleField: {
    padding: 'var(--space-3)',
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)'
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    cursor: 'pointer'
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer'
  },
  toggleText: {
    fontSize: '8pt',
    fontWeight: 700,
    color: 'var(--text)'
  },
  historySection: {
    marginTop: 'var(--space-2)'
  },
  historyTitle: {
    fontSize: '8pt',
    fontWeight: 700,
    marginBottom: 'var(--space-2)',
    color: 'var(--text)'
  },
  historyList: {
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden'
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '2px solid var(--border)',
    fontSize: '8pt'
  },
  historyType: {
    fontWeight: 700,
    flex: 1,
    color: 'var(--text)'
  },
  historyValue: {
    fontFamily: 'var(--font-mono)',
    flex: 1,
    textAlign: 'right',
    color: 'var(--text)'
  },
  historyDate: {
    color: 'var(--text-secondary)',
    flex: 1,
    textAlign: 'right',
    fontSize: '8pt',
    fontFamily: 'var(--font-mono)'
  }
};

