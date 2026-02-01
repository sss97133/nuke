/**
 * Order Confirmation Modal
 * 
 * Professional order confirmation with:
 * - Order details breakdown
 * - Commission disclosure
 * - Risk warnings
 * - Terms acceptance
 * - Execution feedback
 */

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { TradingService } from '../../services/tradingService';
import '../../design-system.css';

interface OrderConfirmationModalProps {
  vehicleId: string;
  offeringId: string;
  orderType: 'buy' | 'sell';
  shares: number;
  pricePerShare: number;
  vehicleName?: string;
  onClose: () => void;
  onSuccess: (orderId: string) => void;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  vehicleId,
  offeringId,
  orderType,
  shares,
  pricePerShare,
  vehicleName = 'Vehicle',
  onClose,
  onSuccess
}) => {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Calculate costs
  const { subtotal, commission, total } = TradingService.calculateOrderCost(shares, pricePerShare, orderType);

  const handleConfirm = async () => {
    if (!termsAccepted) {
      setError('You must accept the terms to continue');
      return;
    }

    setAccepting(true);
    setError(null);

    try {
      const response = await TradingService.placeOrder({
        offeringId,
        orderType,
        sharesRequested: shares,
        pricePerShare,
        timeInForce: 'day'
      });

      if (response.success && response.orderId) {
        onSuccess(response.orderId);
        onClose();
      } else {
        setError(response.error || 'Failed to place order');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAccepting(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '2px',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '2px solid var(--border)',
            background: 'var(--grey-100)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h3 style={{ margin: 0, fontSize: '10pt', fontWeight: 'bold' }}>
            Confirm {orderType === 'buy' ? 'Buy' : 'Sell'} Order
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '16pt',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px' }}>
          {/* Vehicle Info */}
          <div
            style={{
              padding: '12px',
              background: 'var(--grey-50)',
              border: '1px solid var(--border)',
              marginBottom: '16px'
            }}
          >
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Vehicle
            </div>
            <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>{vehicleName}</div>
          </div>

          {/* Order Details */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-muted)' }}>
              ORDER DETAILS
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '9pt' }}>Type:</span>
              <span style={{ fontSize: '9pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {orderType}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '9pt' }}>Shares:</span>
              <span style={{ fontSize: '9pt', fontWeight: 'bold' }}>
                {shares.toLocaleString()}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '9pt' }}>Price per Share:</span>
              <span style={{ fontSize: '9pt', fontWeight: 'bold' }}>
                ${pricePerShare.toFixed(2)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '9pt' }}>Subtotal:</span>
              <span style={{ fontSize: '9pt' }}>
                ${subtotal.toFixed(2)}
              </span>
            </div>

            {orderType === 'buy' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '9pt' }}>Commission (2%):</span>
                <span style={{ fontSize: '9pt' }}>
                  ${commission.toFixed(2)}
                </span>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: '8px',
                borderTop: '1px solid var(--border)',
                marginTop: '8px'
              }}
            >
              <span style={{ fontSize: '10pt', fontWeight: 'bold' }}>Total:</span>
              <span style={{ fontSize: '10pt', fontWeight: 'bold' }}>
                ${total.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Risk Disclosures */}
          <div
            style={{
              padding: '12px',
              background: '#fff9e6',
              border: '1px solid #fbbf24',
              borderRadius: '2px',
              marginBottom: '16px'
            }}
          >
            <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '6px' }}>
              ⚠️ IMPORTANT DISCLOSURES
            </div>
            <ul style={{ fontSize: '8pt', margin: '0', paddingLeft: '16px', lineHeight: 1.5 }}>
              <li>Fractional vehicle ownership is highly speculative and risky</li>
              <li>You may lose your entire investment</li>
              <li>No guarantee of liquidity - you may not be able to sell your shares</li>
              <li>Vehicle values can fluctuate significantly</li>
              <li>This is not a regulated security - no SEC/FINRA protections</li>
              <li>All sales are final - no refunds</li>
            </ul>
          </div>

          {/* Terms Acceptance */}
          <div
            style={{
              padding: '12px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              marginBottom: '16px'
            }}
          >
            <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', fontSize: '8pt' }}>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                style={{ marginRight: '8px', marginTop: '2px' }}
              />
              <span>
                I understand and accept the risks. I confirm that I have read and agree to the{' '}
                <a href="/terms" target="_blank" style={{ color: 'var(--accent)' }}>
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/trading-agreement" target="_blank" style={{ color: 'var(--accent)' }}>
                  Trading Agreement
                </a>.
              </span>
            </label>
          </div>

          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '12px',
                background: '#fee',
                border: '1px solid #f00',
                borderRadius: '2px',
                marginBottom: '16px',
                fontSize: '8pt',
                color: '#c00'
              }}
            >
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="button button-secondary"
              onClick={onClose}
              disabled={accepting}
              style={{
                flex: 1,
                fontSize: '9pt',
                padding: '10px'
              }}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={handleConfirm}
              disabled={!termsAccepted || accepting}
              style={{
                flex: 1,
                fontSize: '9pt',
                padding: '10px',
                fontWeight: 'bold'
              }}
            >
              {accepting ? 'Placing Order...' : `Confirm ${orderType === 'buy' ? 'Buy' : 'Sell'}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

