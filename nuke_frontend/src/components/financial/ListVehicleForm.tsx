import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';
import ConfirmModal from '../ui/ConfirmModal';

interface ListVehicleFormProps {
  vehicleId: string;
  vehicleName: string;
  currentValue?: number;
  onSuccess?: () => void;
}

export default function ListVehicleForm({ vehicleId, vehicleName, currentValue, onSuccess }: ListVehicleFormProps) {
  const { showToast } = useToast();
  const [saleType, setSaleType] = useState<'fixed_price' | 'auction' | 'best_offer'>('fixed_price');
  const [listPrice, setListPrice] = useState(currentValue ? (currentValue / 100).toString() : '');
  const [reservePrice, setReservePrice] = useState('');
  const [acceptOffers, setAcceptOffers] = useState(true);
  const [auctionDays, setAuctionDays] = useState('7');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async () => {
    setShowConfirm(false);
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showToast('Please log in to list a vehicle', 'error');
        return;
      }

      const auctionEnd = saleType === 'auction' ? new Date() : null;
      if (auctionEnd) {
        auctionEnd.setDate(auctionEnd.getDate() + parseInt(auctionDays));
      }

      const { data, error } = await supabase
        .from('vehicle_listings')
        .insert({
          vehicle_id: vehicleId,
          seller_id: user.id,
          sale_type: saleType,
          list_price_cents: listPrice ? Math.floor(parseFloat(listPrice) * 100) : null,
          reserve_price_cents: reservePrice ? Math.floor(parseFloat(reservePrice) * 100) : null,
          accept_offers: acceptOffers,
          auction_end_date: auctionEnd?.toISOString(),
          status: 'active',
          description: description || `${vehicleName} for sale`,
          metadata: {
            listed_from: 'builder_dashboard',
            listing_date: new Date().toISOString()
          }
        })
        .select()
        .single();

      if (error) throw error;

      showToast('Vehicle listed for sale successfully!', 'success');
      if (onSuccess) onSuccess();
      
      // Reset form
      setListPrice('');
      setReservePrice('');
      setDescription('');

    } catch (error: any) {
      console.error('Failed to list vehicle:', error);
      showToast(error.message || 'Failed to list vehicle', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '4px',
      padding: '20px'
    }}>
      <h3 style={{
        fontSize: '10px',
        fontWeight: 600,
        marginBottom: '4px'
      }}>
        List Vehicle for Sale
      </h3>
      <p style={{
        fontSize: '8px',
        color: 'var(--text-secondary)',
        marginBottom: '16px'
      }}>
        Sell {vehicleName} on the marketplace
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Sale Type */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Sale Type
          </label>
          <select
            value={saleType}
            onChange={(e) => setSaleType(e.target.value as any)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit'
            }}
          >
            <option value="fixed_price">Fixed Price</option>
            <option value="auction">Auction</option>
            <option value="best_offer">Best Offer</option>
          </select>
        </div>

        {/* List Price */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            {saleType === 'auction' ? 'Starting Bid (USD)' : 'List Price (USD)'}
          </label>
          <input
            type="number"
            value={listPrice}
            onChange={(e) => setListPrice(e.target.value)}
            min="100"
            step="100"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Reserve Price (for auctions) */}
        {saleType === 'auction' && (
          <div>
            <label style={{
              display: 'block',
              fontSize: '9px',
              fontWeight: 600,
              marginBottom: '6px',
              color: 'var(--text)'
            }}>
              Reserve Price (USD) - Optional
            </label>
            <input
              type="number"
              value={reservePrice}
              onChange={(e) => setReservePrice(e.target.value)}
              min="100"
              step="100"
              placeholder="Minimum acceptable price"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '9px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: 'inherit'
              }}
            />
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginTop: '4px'
            }}>
              Won't sell below this price
            </div>
          </div>
        )}

        {/* Auction Duration */}
        {saleType === 'auction' && (
          <div>
            <label style={{
              display: 'block',
              fontSize: '9px',
              fontWeight: 600,
              marginBottom: '6px',
              color: 'var(--text)'
            }}>
              Auction Duration
            </label>
            <select
              value={auctionDays}
              onChange={(e) => setAuctionDays(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '9px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: 'inherit'
              }}
            >
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="10">10 days</option>
              <option value="14">14 days</option>
            </select>
          </div>
        )}

        {/* Accept Offers */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <input
            type="checkbox"
            id="accept-offers"
            checked={acceptOffers}
            onChange={(e) => setAcceptOffers(e.target.checked)}
            style={{
              width: '16px',
              height: '16px',
              cursor: 'pointer'
            }}
          />
          <label
            htmlFor="accept-offers"
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: 'var(--text)',
              cursor: 'pointer'
            }}
          >
            Accept Offers
          </label>
        </div>

        {/* Description */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 600,
            marginBottom: '6px',
            color: 'var(--text)'
          }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the vehicle condition, features, recent work, etc."
            rows={4}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '9px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Preview */}
        <div style={{
          background: 'var(--accent-dim)',
          border: '2px solid var(--accent)',
          borderRadius: '4px',
          padding: '12px'
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Listing Preview
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text)', lineHeight: 1.5 }}>
            • Type: <strong>{saleType === 'fixed_price' ? 'Fixed Price' : saleType === 'auction' ? 'Auction' : 'Best Offer'}</strong><br />
            • Price: <strong>${parseFloat(listPrice || '0').toLocaleString()}</strong><br />
            {saleType === 'auction' && reservePrice && (
              <>• Reserve: <strong>${parseFloat(reservePrice).toLocaleString()}</strong><br /></>
            )}
            {saleType === 'auction' && (
              <>• Duration: <strong>{auctionDays} days</strong><br /></>
            )}
            • Offers: <strong>{acceptOffers ? 'Accepted' : 'Not accepted'}</strong>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => setShowConfirm(true)}
          disabled={loading || !listPrice}
          style={{
            border: '2px solid var(--accent)',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            padding: '10px 16px',
            fontSize: '9px',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: '0.12s',
            borderRadius: '4px',
            opacity: loading ? 0.5 : 1
          }}
        >
          {loading ? 'Listing...' : 'List Vehicle'}
        </button>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        title="List Vehicle for Sale?"
        message={`You're about to list ${vehicleName} for $${parseFloat(listPrice || '0').toLocaleString()}. The listing will be visible to all buyers on the marketplace.`}
        amount={listPrice ? Math.floor(parseFloat(listPrice) * 100) : undefined}
        onConfirm={handleSubmit}
        onCancel={() => setShowConfirm(false)}
        confirmLabel="List Vehicle"
        type="info"
      />
    </div>
  );
}

