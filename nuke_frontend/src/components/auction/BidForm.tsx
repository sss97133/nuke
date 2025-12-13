import { useState, useEffect } from 'react';
import { Auction, FlexibleAuctionService } from '../../services/flexibleAuctionService';
import '../../design-system.css';

interface BidFormProps {
  auction: Auction;
  onBidSubmitted?: (auction: Auction) => void;
  onCancel?: () => void;
}

const BidForm: React.FC<BidFormProps> = ({ auction, onBidSubmitted, onCancel }) => {
  const [bidAmount, setBidAmount] = useState<string>('');
  const [suggestedBid, setSuggestedBid] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');

  useEffect(() => {
    // Calculate suggested bid
    calculateSuggestedBid();
  }, [auction]);

  const calculateSuggestedBid = () => {
    let suggested = auction.current_bid;

    if (auction.config.increment_amount) {
      suggested += auction.config.increment_amount;
    } else if (auction.config.increment_percent) {
      suggested = auction.current_bid * (1 + auction.config.increment_percent / 100);
    } else {
      // Default 5% increment
      suggested = auction.current_bid * 1.05;
    }

    setSuggestedBid(Math.ceil(suggested * 100) / 100);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const validateBid = (amount: number): { valid: boolean; message?: string } => {
    if (amount <= auction.current_bid) {
      return {
        valid: false,
        message: `Bid must be higher than ${formatCurrency(auction.current_bid)}`
      };
    }

    if (auction.config.increment_amount && amount < auction.current_bid + auction.config.increment_amount) {
      return {
        valid: false,
        message: `Minimum increment is ${formatCurrency(auction.config.increment_amount)}`
      };
    }

    if (auction.config.increment_percent) {
      const minBid = auction.current_bid * (1 + auction.config.increment_percent / 100);
      if (amount < minBid) {
        return {
          valid: false,
          message: `Bid must be at least ${formatCurrency(minBid)}`
        };
      }
    }

    return { valid: true };
  };

  const handleBidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setBidAmount(value);
    setError('');

    if (value) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        const validation = validateBid(numValue);
        if (!validation.valid) {
          setError(validation.message || 'Invalid bid');
        }
      }
    }
  };

  const handleQuickBid = (multiplier: number) => {
    const amount = auction.current_bid * multiplier;
    setBidAmount(amount.toString());
    setError('');
  };

  const handleSubmitBid = async () => {
    if (!bidAmount) {
      setError('Please enter a bid amount');
      return;
    }

    const numAmount = parseFloat(bidAmount);
    const validation = validateBid(numAmount);
    if (!validation.valid) {
      setError(validation.message || 'Invalid bid');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      // Get current user (you'll need to import from auth context)
      const user = { id: 'user-placeholder' }; // Replace with actual auth

      const result = await FlexibleAuctionService.submitBid(
        auction.id,
        user.id,
        numAmount
      );

      if (result.success) {
        setSuccessMessage(
          result.extended
            ? '🎉 Bid placed! Auction extended!'
            : '✅ Bid placed successfully!'
        );
        setBidAmount('');
        setTimeout(() => {
          onBidSubmitted?.(result.auction!);
        }, 1000);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: 'white',
        border: '2px solid #2563eb',
        padding: '16px',
        borderRadius: '4px',
        maxWidth: '400px'
      }}
    >
      <h3 style={{
        fontSize: '11pt',
        fontWeight: 'bold',
        marginBottom: '12px',
        color: '#1f2937'
      }}>
        Place a Bid
      </h3>

      {/* Current Bid Info */}
      <div
        style={{
          background: '#f3f4f6',
          padding: '8px',
          marginBottom: '12px',
          borderRadius: '2px',
          fontSize: '9pt'
        }}
      >
        <div style={{ color: '#6b7280', marginBottom: '4px' }}>
          Current Bid:
        </div>
        <div
          style={{
            fontSize: '12pt',
            fontWeight: 'bold',
            color: '#2563eb'
          }}
        >
          {formatCurrency(auction.current_bid)}
        </div>
      </div>

      {/* Auction Status */}
      <div
        style={{
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          padding: '8px',
          marginBottom: '12px',
          borderRadius: '2px',
          fontSize: '8pt',
          color: '#78350f'
        }}
      >
        {auction.bid_count} bids • {auction.extension_count} extensions
      </div>

      {/* Bid Input */}
      <div style={{ marginBottom: '12px' }}>
        <label
          style={{
            display: 'block',
            fontSize: '9pt',
            fontWeight: 'bold',
            color: '#1f2937',
            marginBottom: '4px'
          }}
        >
          Your Bid Amount:
        </label>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
          }}
        >
          <span style={{ fontSize: '10pt', color: '#6b7280' }}>$</span>
          <input
            type="number"
            value={bidAmount}
            onChange={handleBidChange}
            placeholder={formatCurrency(suggestedBid)}
            style={{
              flex: 1,
              padding: '8px',
              border: error ? '2px solid #dc2626' : '1px solid #bdbdbd',
              borderRadius: '2px',
              fontSize: '10pt',
              fontFamily: 'monospace'
            }}
            min={auction.current_bid + 1}
            step="0.01"
          />
        </div>
        {error && (
          <div style={{
            fontSize: '8pt',
            color: '#dc2626',
            marginTop: '4px'
          }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* Quick Bid Buttons */}
      <div style={{ marginBottom: '12px' }}>
        <div
          style={{
            fontSize: '8pt',
            fontWeight: 'bold',
            color: '#6b7280',
            marginBottom: '6px'
          }}
        >
          Quick Bids:
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px'
          }}
        >
          {[1.1, 1.25, 1.5].map((multiplier) => (
            <button
              key={multiplier}
              onClick={() => handleQuickBid(multiplier)}
              style={{
                padding: '6px',
                background: '#e5e7eb',
                border: '1px solid #bdbdbd',
                borderRadius: '2px',
                fontSize: '8pt',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.12s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#d1d5db';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#e5e7eb';
              }}
            >
              +{Math.round((multiplier - 1) * 100)}% = {formatCurrency(auction.current_bid * multiplier)}
            </button>
          ))}
        </div>
      </div>

      {/* Suggested Bid */}
      <div
        style={{
          background: '#dbeafe',
          border: '1px solid #93c5fd',
          padding: '8px',
          marginBottom: '12px',
          borderRadius: '2px',
          fontSize: '8pt',
          color: '#1e40af'
        }}
      >
        💡 <strong>Suggested Bid:</strong> {formatCurrency(suggestedBid)}
      </div>

      {/* Success Message */}
      {successMessage && (
        <div
          style={{
            background: '#d1fae5',
            border: '1px solid #6ee7b7',
            padding: '8px',
            marginBottom: '12px',
            borderRadius: '2px',
            fontSize: '8pt',
            color: '#065f46'
          }}
        >
          {successMessage}
        </div>
      )}

      {/* Action Buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px'
        }}
      >
        <button
          onClick={handleSubmitBid}
          disabled={isSubmitting || !bidAmount || error !== ''}
          style={{
            padding: '10px',
            background: !bidAmount || error !== '' ? '#9ca3af' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '2px',
            fontSize: '9pt',
            fontWeight: 'bold',
            cursor: isSubmitting ? 'wait' : 'pointer',
            transition: 'all 0.12s ease',
            opacity: isSubmitting ? 0.7 : 1
          }}
        >
          {isSubmitting ? 'Submitting...' : 'PLACE BID'}
        </button>
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          style={{
            padding: '10px',
            background: '#e5e7eb',
            color: '#1f2937',
            border: '1px solid #bdbdbd',
            borderRadius: '2px',
            fontSize: '9pt',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
        >
          Cancel
        </button>
      </div>

      {/* Auction Extension Info */}
      <div
        style={{
          marginTop: '12px',
          padding: '8px',
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: '2px',
          fontSize: '8pt',
          color: '#6b7280'
        }}
      >
        ℹ️ If you bid in the final {auction.config.minimum_seconds_remaining}s, the auction will be extended by{' '}
        {auction.config.extension_time_seconds}s
      </div>
    </div>
  );
};

export default BidForm;
