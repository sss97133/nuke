/**
 * Dealer Transaction Input
 * Log purchase/sale prices with confidence levels
 * Designed for Viva collaborators tracking dealer inventory
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface DealerTransactionInputProps {
  vehicleId: string;
  canEdit: boolean;
}

export const DealerTransactionInput: React.FC<DealerTransactionInputProps> = ({
  vehicleId,
  canEdit
}) => {
  const [expanded, setExpanded] = useState(false);
  const [priceType, setPriceType] = useState<'purchase' | 'sale'>('purchase');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isEstimate, setIsEstimate] = useState(false);
  const [isApproximate, setIsApproximate] = useState(false);
  const [proofURL, setProofURL] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  React.useEffect(() => {
    if (expanded) {
      loadHistory();
    }
  }, [expanded]);

  const loadHistory = async () => {
    const { data } = await supabase
      .from('vehicle_price_history')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('as_of', { ascending: false });
    
    setHistory(data || []);
  };

  const handleSave = async () => {
    if (!amount || !date) {
      alert('Please enter amount and date');
      return;
    }

    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      // Insert into price history
      const { error } = await supabase
        .from('vehicle_price_history')
        .insert({
          vehicle_id: vehicleId,
          price_type: priceType,
          value: parseInt(amount),
          as_of: date,
          source: 'dealer_input',
          confidence: isEstimate ? 30 : isApproximate ? 70 : 95,
          is_estimate: isEstimate,
          is_approximate: isApproximate,
          logged_by: user.id,
          proof_type: proofURL.includes('bringatrailer') ? 'bat_listing' : proofURL ? 'url' : 'verbal',
          proof_url: proofURL || null,
          notes: notes || null
        });

      if (error) throw error;

      // Reset form
      setAmount('');
      setNotes('');
      setProofURL('');
      setIsEstimate(false);
      setIsApproximate(false);
      
      // Reload history
      loadHistory();
      alert('Transaction logged successfully!');

    } catch (err: any) {
      console.error('Save error:', err);
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) return null;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="heading-3">Financial History</h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="button button-small"
        >
          {expanded ? 'Hide' : 'Add'} Transaction
        </button>
      </div>

      {expanded && (
        <div className="card-body">
          {/* Transaction Type */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <div className="text text-small text-bold text-muted" style={{ marginBottom: 'var(--space-1)' }}>
              Transaction Type
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                onClick={() => setPriceType('purchase')}
                className="button button-small"
                style={{
                  flex: 1,
                  background: priceType === 'purchase' ? 'var(--accent)' : 'var(--grey-200)',
                  color: priceType === 'purchase' ? 'var(--white)' : 'var(--text)',
                  border: '2px outset var(--border)'
                }}
              >
                PURCHASE
              </button>
              <button
                onClick={() => setPriceType('sale')}
                className="button button-small"
                style={{
                  flex: 1,
                  background: priceType === 'sale' ? 'var(--accent)' : 'var(--grey-200)',
                  color: priceType === 'sale' ? 'var(--white)' : 'var(--text)',
                  border: '2px outset var(--border)'
                }}
              >
                SALE
              </button>
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <div className="text text-small text-bold text-muted" style={{ marginBottom: 'var(--space-1)' }}>
              Amount (USD)
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g., 10000"
              className="form-input"
              style={{
                width: '100%',
                border: '2px solid var(--border)',
                borderRadius: '0px'
              }}
            />
          </div>

          {/* Date */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <div className="text text-small text-bold text-muted" style={{ marginBottom: 'var(--space-1)' }}>
              Date
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="form-input"
              style={{
                width: '100%',
                border: '2px solid var(--border)',
                borderRadius: '0px'
              }}
            />
          </div>

          {/* Confidence Checkboxes */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              <input
                type="checkbox"
                checked={isEstimate}
                onChange={(e) => {
                  setIsEstimate(e.target.checked);
                  if (e.target.checked) setIsApproximate(false);
                }}
                style={{ width: '18px', height: '18px' }}
              />
              <span className="text text-small">Rough estimate (ballpark)</span>
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={isApproximate}
                onChange={(e) => {
                  setIsApproximate(e.target.checked);
                  if (e.target.checked) setIsEstimate(false);
                }}
                style={{ width: '18px', height: '18px' }}
              />
              <span className="text text-small">Approximate (close to actual)</span>
            </label>
          </div>

          {/* Proof URL */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <div className="text text-small text-bold text-muted" style={{ marginBottom: 'var(--space-1)' }}>
              Proof (Optional)
            </div>
            <input
              type="url"
              value={proofURL}
              onChange={(e) => setProofURL(e.target.value)}
              placeholder="BaT listing, invoice URL, etc."
              className="form-input"
              style={{
                width: '100%',
                border: '2px solid var(--border)',
                borderRadius: '0px'
              }}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <div className="text text-small text-bold text-muted" style={{ marginBottom: 'var(--space-1)' }}>
              Notes (Optional)
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional context..."
              className="form-input"
              rows={2}
              style={{
                width: '100%',
                border: '2px solid var(--border)',
                borderRadius: '0px',
                resize: 'vertical'
              }}
            />
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving || !amount}
            className="button button-primary"
            style={{
              width: '100%',
              background: saving ? 'var(--grey-400)' : 'var(--success)',
              border: '2px outset var(--white)',
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'SAVING...' : 'LOG TRANSACTION'}
          </button>

          {/* History */}
          {history.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className="text text-small text-bold" style={{ marginBottom: 'var(--space-2)' }}>
                Recent Transactions
              </div>
              {history.slice(0, 5).map(t => (
                <div
                  key={t.id}
                  style={{
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: '0px',
                    background: 'var(--white)',
                    marginBottom: 'var(--space-1)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span className="text text-small text-bold">
                      {t.price_type.toUpperCase()}: ${t.value?.toLocaleString()}
                    </span>
                    <span className="text text-tiny text-muted">
                      {new Date(t.as_of).toLocaleDateString()}
                    </span>
                  </div>
                  {(t.is_estimate || t.is_approximate) && (
                    <div className="text text-tiny" style={{ color: 'var(--warning)' }}>
                      {t.is_estimate ? 'Rough estimate' : 'Approximate'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DealerTransactionInput;

