import React, { useState } from 'react';
import { createVehicleTransaction } from '../services/vehicleTransactionService';
import { toast } from 'react-hot-toast';

interface BuyVehicleButtonProps {
  vehicleId: string;
  salePrice: number;
  vehicleName: string;
  disabled?: boolean;
}

export const BuyVehicleButton: React.FC<BuyVehicleButtonProps> = ({
  vehicleId,
  salePrice,
  vehicleName,
  disabled = false
}) => {
  const [loading, setLoading] = useState(false);
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [phone, setPhone] = useState('');

  const handleBuyClick = async () => {
    if (!showPhoneInput) {
      setShowPhoneInput(true);
      return;
    }

    if (!phone || phone.length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setLoading(true);

    try {
      const { checkoutUrl } = await createVehicleTransaction(
        vehicleId,
        salePrice,
        2.0, // 2% facilitation fee
        phone
      );

      // Redirect to Stripe checkout
      window.location.href = checkoutUrl;
    } catch (error: any) {
      console.error('Failed to create transaction:', error);
      toast.error(error.message || 'Failed to start purchase');
      setLoading(false);
    }
  };

  const facilitationFee = (salePrice * 0.02).toFixed(2);

  return (
    <div style={{ display: 'inline-block' }}>
      {!showPhoneInput ? (
        <button
          onClick={handleBuyClick}
          disabled={disabled || loading}
          style={{
            padding: '12px 24px',
            border: '2px solid #000',
            background: '#000',
            color: '#fff',
            fontSize: '10pt',
            fontWeight: 700,
            cursor: disabled ? 'not-allowed' : 'pointer',
            borderRadius: '0px',
            opacity: disabled ? 0.5 : 1
          }}
        >
          🚗 Buy This Vehicle
        </button>
      ) : (
        <div style={{ 
          padding: '16px', 
          border: '2px solid var(--border)', 
          borderRadius: '0px',
          background: 'var(--surface)',
          minWidth: '300px'
        }}>
          <h4 style={{ fontSize: '10pt', marginBottom: '12px', margin: 0 }}>
            Purchase {vehicleName}
          </h4>
          
          <div style={{ fontSize: '9pt', marginBottom: '12px', color: 'var(--text-secondary)' }}>
            <div>Sale Price: <strong>${salePrice.toLocaleString()}</strong></div>
            <div>Facilitation Fee (2%): <strong>${facilitationFee}</strong></div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '8pt', 
              fontWeight: 700,
              marginBottom: '4px'
            }}>
              Your Phone Number (for SMS notifications):
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid var(--border)',
                borderRadius: '0px',
                fontSize: '9pt'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowPhoneInput(false)}
              disabled={loading}
              style={{
                flex: 1,
                padding: '8px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '9pt',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: '0px'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleBuyClick}
              disabled={loading}
              style={{
                flex: 2,
                padding: '8px',
                border: '2px solid #000',
                background: '#000',
                color: '#fff',
                fontSize: '9pt',
                fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
                borderRadius: '0px'
              }}
            >
              {loading ? 'Processing...' : `Pay $${facilitationFee} to Start`}
            </button>
          </div>

          <p style={{ fontSize: '7pt', color: 'var(--text-secondary)', marginTop: '8px', margin: 0 }}>
            You'll pay ${facilitationFee} now for paperwork & facilitation.
            The ${salePrice.toLocaleString()} purchase price is paid directly to seller after signing.
          </p>
        </div>
      )}
    </div>
  );
};

export default BuyVehicleButton;

