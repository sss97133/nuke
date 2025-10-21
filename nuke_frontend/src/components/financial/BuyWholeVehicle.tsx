import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CashBalanceService } from '../../services/cashBalanceService';

interface BuyWholeVehicleProps {
  vehicleId: string;
  vehicleName: string;
  vehicleValue: number;
}

export default function BuyWholeVehicle({ vehicleId, vehicleName, vehicleValue }: BuyWholeVehicleProps) {
  const [offerAmount, setOfferAmount] = useState(vehicleValue.toString());
  const [message, setMessage] = useState('');
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadListing();
  }, [vehicleId]);

  const loadListing = async () => {
    try {
      const { data } = await supabase
        .from('vehicle_listings')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active')
        .single();

      if (data) {
        setListing(data);
        setOfferAmount((data.list_price_cents / 100).toString());
      }
    } catch (error) {
      console.error('Failed to load listing:', error);
    }
  };

  const handleMakeOffer = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please sign in to make an offer');
        return;
      }

      const amountCents = Math.floor(parseFloat(offerAmount) * 100);
      if (!amountCents || amountCents <= 0) {
        alert('Please enter a valid amount');
        return;
      }

      setLoading(true);

      const { error } = await supabase
        .from('vehicle_offers')
        .insert({
          listing_id: listing.id,
          buyer_id: user.id,
          offer_amount_cents: amountCents,
          message: message || null,
          financing_type: 'cash'
        });

      if (error) throw error;

      alert(`Offer submitted: ${CashBalanceService.formatCurrency(amountCents)}`);
      setMessage('');
      await loadListing();

    } catch (error) {
      console.error('Offer error:', error);
      alert('Failed to submit offer: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!listing) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '9px'
      }}>
        Vehicle not currently listed for sale
      </div>
    );
  }

  const listPrice = listing.list_price_cents / 100;
  const reservePrice = listing.reserve_price_cents ? listing.reserve_price_cents / 100 : null;

  return (
    <div>
      {/* Listing Details */}
      <div style={{
        background: 'var(--accent-dim)',
        border: '2px solid var(--accent)',
        borderRadius: '4px',
        padding: '12px',
        marginBottom: '12px'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '8px'
        }}>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              List Price
            </div>
            <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
              ${listPrice.toLocaleString()}
            </div>
          </div>
          {reservePrice && (
            <div>
              <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                Reserve
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                ${reservePrice.toLocaleString()}
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
          Sale Type: {listing.sale_type.replace('_', ' ').toUpperCase()}
          {listing.accept_offers && ' · Accepts offers'}
        </div>
      </div>

      {/* Offer Amount */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{
          display: 'block',
          fontSize: '8px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: '4px',
          textTransform: 'uppercase'
        }}>
          Your Offer (USD)
        </label>

        <input
          type="number"
          value={offerAmount}
          onChange={(e) => setOfferAmount(e.target.value)}
          placeholder="Enter amount"
          min="1000"
          step="100"
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '10px',
            fontFamily: 'var(--font-mono, monospace)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--bg)',
            color: 'var(--text)',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Message */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          fontSize: '8px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: '4px',
          textTransform: 'uppercase'
        }}>
          Message to Seller (optional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="I'm interested in this vehicle..."
          maxLength={500}
          rows={3}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '9px',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--bg)',
            color: 'var(--text)',
            boxSizing: 'border-box',
            resize: 'vertical'
          }}
        />
      </div>

      {/* Submit Button */}
      <button
        onClick={handleMakeOffer}
        disabled={loading || !offerAmount}
        style={{
          width: '100%',
          padding: '10px',
          border: '2px solid var(--accent)',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          fontSize: '10px',
          fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer',
          borderRadius: '4px',
          opacity: !offerAmount ? 0.5 : 1
        }}
      >
        {loading ? 'Submitting...' : listing.sale_type === 'auction' ? 'Place Bid' : 'Make Offer'}
      </button>

      {/* Info */}
      <div style={{
        marginTop: '10px',
        padding: '10px',
        background: 'var(--accent-dim)',
        border: '2px solid var(--accent)',
        borderRadius: '4px',
        fontSize: '8px',
        color: 'var(--text-secondary)',
        lineHeight: 1.5
      }}>
        <strong style={{ color: 'var(--accent)' }}>Whole Vehicle Purchase</strong>
        <br />
        • Own 100% of vehicle
        <br />
        • Title transfer upon payment
        <br />
        • {listing.sale_type === 'auction' ? 'Auction closes at end time' : 'Seller reviews offers'}
        <br />
        • Platform fee: 2% of sale price
      </div>
    </div>
  );
}

