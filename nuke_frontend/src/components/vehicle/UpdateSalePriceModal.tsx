import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { recordSoldPrice } from '../../services/vehiclePriceTrackingService';

interface UpdateSalePriceModalProps {
  vehicleId: string;
  vehicleName: string;
  currentSalePrice: number | null;
  currentSaleDate: string | null;
  auctionBid: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const UpdateSalePriceModal: React.FC<UpdateSalePriceModalProps> = ({
  vehicleId,
  vehicleName,
  currentSalePrice,
  currentSaleDate,
  auctionBid,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [salePrice, setSalePrice] = useState<string>(currentSalePrice?.toString() || auctionBid?.toString() || '');
  const [saleDate, setSaleDate] = useState<string>(currentSaleDate || new Date().toISOString().split('T')[0]);
  const [saleType, setSaleType] = useState<'auction' | 'post_auction' | 'private'>('post_auction');
  const [buyerName, setBuyerName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const price = parseFloat(salePrice.replace(/[^0-9.]/g, ''));
      if (!price || price <= 0) {
        throw new Error('Please enter a valid sale price');
      }

      if (!saleDate) {
        throw new Error('Please enter a sale date');
      }

      // Build notes
      let saleNotes = notes;
      if (saleType === 'post_auction') {
        saleNotes = `Post-auction sale through negotiations${buyerName ? ` to ${buyerName}` : ' to unknown client'}${notes ? `. ${notes}` : ''}`;
      } else if (saleType === 'private' && buyerName) {
        saleNotes = `Private sale to ${buyerName}${notes ? `. ${notes}` : ''}`;
      }

      // Record the sale price
      const result = await recordSoldPrice(
        vehicleId,
        price,
        saleDate,
        {
          source: saleType === 'post_auction' ? 'post_auction_negotiation' : saleType === 'private' ? 'private_sale' : 'auction',
          buyer_name: buyerName || (saleType === 'post_auction' ? 'Unknown client' : undefined),
          notes: saleNotes
        }
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to update sale price');
      }

      // Also update the vehicle record directly to ensure it's saved
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({
          sale_price: price,
          sale_date: saleDate,
          sale_status: 'sold',
          auction_outcome: 'sold', // Mark as sold so price display logic picks it up
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      // Force a page reload to refresh all data
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.reload();
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update sale price');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          padding: 'var(--space-4)',
          width: '90%',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h3 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
            Update Sale Price
          </h3>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)', margin: 0 }}>
            {vehicleName}
          </p>
        </div>

        {auctionBid && currentSalePrice !== auctionBid && (
          <div style={{
            padding: 'var(--space-2)',
            background: 'var(--warning-bg, #fef3c7)',
            border: '1px solid var(--warning-border, #fbbf24)',
            borderRadius: '4px',
            marginBottom: 'var(--space-3)',
            fontSize: '8pt'
          }}>
            <strong>Note:</strong> Auction bid was ${auctionBid.toLocaleString()}. This update will record the final sale price.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
              Sale Type *
            </label>
            <select
              value={saleType}
              onChange={(e) => setSaleType(e.target.value as any)}
              style={{
                width: '100%',
                padding: 'var(--space-2)',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--white)'
              }}
            >
              <option value="auction">Auction Sale</option>
              <option value="post_auction">Post-Auction Negotiation</option>
              <option value="private">Private Sale</option>
            </select>
          </div>

          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
              Sale Price ($) *
            </label>
            <input
              type="text"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="150000"
              style={{
                width: '100%',
                padding: 'var(--space-2)',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px'
              }}
              required
            />
          </div>

          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
              Sale Date *
            </label>
            <input
              type="date"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              style={{
                width: '100%',
                padding: 'var(--space-2)',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px'
              }}
              required
            />
          </div>

          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
              Buyer Name
            </label>
            <input
              type="text"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder={saleType === 'post_auction' ? 'Unknown client (leave blank if unknown)' : 'Buyer name'}
              style={{
                width: '100%',
                padding: 'var(--space-2)',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px'
              }}
            />
            {saleType === 'post_auction' && (
              <p style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
                Leave blank if buyer is unknown
              </p>
            )}
          </div>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
              Additional Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Sold after auction through negotiations"
              rows={3}
              style={{
                width: '100%',
                padding: 'var(--space-2)',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: 'var(--space-2)',
              background: 'var(--error-bg, #fee2e2)',
              border: '1px solid var(--error-border, #ef4444)',
              borderRadius: '4px',
              marginBottom: 'var(--space-3)',
              fontSize: '8pt',
              color: 'var(--error-text, #dc2626)'
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontSize: '8pt',
                fontWeight: 'bold',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontSize: '8pt',
                fontWeight: 'bold',
                background: 'var(--accent)',
                color: 'var(--white)',
                border: 'none',
                borderRadius: '4px',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1
              }}
            >
              {saving ? 'Saving...' : 'Update Sale Price'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UpdateSalePriceModal;

