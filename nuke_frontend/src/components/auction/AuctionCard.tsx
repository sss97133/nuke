import { useState, useEffect } from 'react';
import { Auction, FlexibleAuctionService } from '../../services/flexibleAuctionService';
import '../../design-system.css';

// Urgency level type for timer coloring (NO YELLOW - BaT uses yellow)
type UrgencyLevel = 'ended' | 'lastMinute' | 'critical' | 'urgent' | 'gettingClose' | 'normal';

const urgencyTimerColors: Record<UrgencyLevel, string> = {
  lastMinute: '#dc2626',    // Bright red - pulsing
  critical: '#dc2626',      // Red
  urgent: '#ea580c',        // Orange (not yellow!)
  gettingClose: '#e07960',  // Coral/salmon - warmer
  normal: '#6b7280',        // Gray
  ended: '#9ca3af',         // Light gray
};

interface AuctionCardProps {
  auction: Auction;
  onBidClick?: (auction: Auction) => void;
  compact?: boolean;
}

const AuctionCard: React.FC<AuctionCardProps> = ({ auction, onBidClick, compact = false }) => {
  const [timeRemaining, setTimeRemaining] = useState<string>('--:--');
  const [timePercentage, setTimePercentage] = useState<number>(100);
  const [isEnding, setIsEnding] = useState<boolean>(false);
  const [urgencyLevel, setUrgencyLevel] = useState<UrgencyLevel>('normal');
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    const updateTimer = () => {
      const time = FlexibleAuctionService.getTimeRemaining(auction);
      setTimeRemaining(time.formatted);

      // Calculate percentage of time remaining
      const totalSeconds = auction.config.initial_duration_seconds;
      const remainingSeconds = time.seconds;
      const percentage = Math.max(0, (remainingSeconds / totalSeconds) * 100);
      setTimePercentage(percentage);

      // Show warning if < 60 seconds
      setIsEnding(remainingSeconds < 60 && remainingSeconds > 0);

      // Calculate urgency level (NO YELLOW - BaT uses yellow)
      let newUrgency: UrgencyLevel = 'normal';
      if (remainingSeconds <= 0) newUrgency = 'ended';
      else if (remainingSeconds <= 60) newUrgency = 'lastMinute';           // < 1 min
      else if (remainingSeconds <= 300) newUrgency = 'critical';            // < 5 min
      else if (remainingSeconds <= 900) newUrgency = 'urgent';              // < 15 min
      else if (remainingSeconds <= 3600) newUrgency = 'gettingClose';       // < 1 hour
      setUrgencyLevel(newUrgency);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [auction]);

  // Pulsing effect for critical urgency
  useEffect(() => {
    if (urgencyLevel === 'lastMinute') {
      const pulseInterval = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 2);
      }, 300);
      return () => clearInterval(pulseInterval);
    } else if (urgencyLevel === 'critical') {
      const pulseInterval = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 2);
      }, 500);
      return () => clearInterval(pulseInterval);
    }
    setPulsePhase(0);
  }, [urgencyLevel]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getStateColor = () => {
    switch (auction.state) {
      case 'active':
      case 'ending_soon':
        return isEnding ? '#dc2626' : '#10b981';
      case 'scheduled':
        return '#6b7280';
      case 'sold':
        return '#2563eb';
      case 'unsold':
        return '#9ca3af';
      default:
        return '#6b7280';
    }
  };

  const getStateLabel = () => {
    switch (auction.state) {
      case 'active':
        return isEnding ? '⏰ ENDING SOON' : '🔨 LIVE';
      case 'ending_soon':
        return '⏰ ENDING SOON';
      case 'scheduled':
        return '📅 SCHEDULED';
      case 'sold':
        return '✅ SOLD';
      case 'unsold':
        return '❌ UNSOLD';
      default:
        return auction.state.toUpperCase();
    }
  };

  if (compact) {
    return (
      <div
        style={{
          background: 'var(--surface)',
          border: `2px solid ${getStateColor()}`,
          padding: '12px',
          cursor: 'pointer',
          transition: 'all 0.12s ease',
          minHeight: '180px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}
        onClick={() => onBidClick?.(auction)}
      >
        <div>
          <div style={{
            fontSize: '10pt',
            fontWeight: 'bold',
            marginBottom: '8px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            color: '#1f2937'
          }}>
            {auction.title}
          </div>

          <div style={{
            fontSize: '11pt',
            fontWeight: 'bold',
            color: getStateColor(),
            marginBottom: '6px'
          }}>
            {formatCurrency(auction.current_bid)}
          </div>

          {auction.bid_count > 0 && (
            <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '4px' }}>
              🔨 {auction.bid_count} {auction.bid_count === 1 ? 'bid' : 'bids'}
            </div>
          )}
        </div>

        <div>
          {/* Timer bar */}
          <div style={{
            width: '100%',
            height: '4px',
            background: '#e5e7eb',
            borderRadius: '2px',
            overflow: 'hidden',
            marginBottom: '6px'
          }}>
            <div
              style={{
                height: '100%',
                background: getStateColor(),
                width: `${timePercentage}%`,
                transition: 'width 0.1s linear'
              }}
            />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '8pt'
          }}>
            <span style={{
              color: urgencyTimerColors[urgencyLevel],
              fontWeight: 'bold',
              opacity: ['lastMinute', 'critical'].includes(urgencyLevel) ? (pulsePhase === 0 ? 1 : 0.6) : 1,
              transition: 'opacity 0.15s',
            }}>
              {timeRemaining}
            </span>
            <span style={{ color: '#6b7280' }}>
              {getStateLabel()}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Full-size card
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `2px solid ${getStateColor()}`,
        padding: '0',
        cursor: 'pointer',
        transition: 'all 0.12s ease',
        display: 'flex',
        flexDirection: 'column'
      }}
      onClick={() => onBidClick?.(auction)}
    >
      {/* Image Section */}
      <div style={{
        height: '200px',
        background: '#e5e7eb',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}>
        {auction.images && auction.images.length > 0 ? (
          <img
            src={auction.images[0]}
            alt={auction.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />
        ) : (
          <div style={{ fontSize: '48px', color: '#9ca3af' }}>🚗</div>
        )}

        {/* State badge */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: getStateColor(),
            color: 'white',
            padding: '4px 8px',
            fontSize: '8pt',
            fontWeight: 'bold',
            borderRadius: '2px'
          }}
        >
          {getStateLabel()}
        </div>

        {/* Timer badge with urgency coloring */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: urgencyTimerColors[urgencyLevel],
            padding: '4px 8px',
            fontSize: '9pt',
            fontWeight: 'bold',
            borderRadius: '2px',
            opacity: ['lastMinute', 'critical'].includes(urgencyLevel) ? (pulsePhase === 0 ? 1 : 0.7) : 1,
            boxShadow: urgencyLevel === 'lastMinute' ? `0 0 8px ${urgencyTimerColors[urgencyLevel]}` : 'none',
            transition: 'opacity 0.15s, box-shadow 0.15s',
          }}
        >
          {timeRemaining}
        </div>

        {/* Extension indicator */}
        {auction.extension_count > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: '#fbbf24',
              padding: '2px 6px',
              fontSize: '8pt',
              fontWeight: 'bold',
              borderRadius: '2px'
            }}
          >
            ⚡ Extended {auction.extension_count}x
          </div>
        )}
      </div>

      {/* Details Section */}
      <div style={{ padding: '12px' }}>
        <div style={{
          fontSize: '10pt',
          fontWeight: 'bold',
          marginBottom: '8px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          color: '#1f2937'
        }}>
          {auction.title}
        </div>

        {auction.description && (
          <div style={{
            fontSize: '8pt',
            color: '#6b7280',
            marginBottom: '6px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}>
            {auction.description}
          </div>
        )}

        {/* Current Bid Section - with visual accent */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.03) 100%)',
          padding: '10px',
          marginBottom: '8px',
          borderRadius: '4px',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
        }}>
          <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '2px' }}>
            Current Bid:
          </div>
          <div style={{
            fontSize: '14pt',
            fontWeight: 'bold',
            color: getStateColor()
          }}>
            {formatCurrency(auction.current_bid)}
          </div>
        </div>

        {/* Bid Information */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '8px',
          fontSize: '8pt'
        }}>
          <div style={{ color: '#6b7280' }}>
            🔨 <strong>{auction.bid_count}</strong> bids
          </div>
          <div style={{ color: '#6b7280' }}>
            ⚡ <strong>{auction.extension_count}</strong> extensions
          </div>
        </div>

        {/* Timer Progress Bar */}
        <div style={{
          width: '100%',
          height: '6px',
          background: '#e5e7eb',
          borderRadius: '2px',
          overflow: 'hidden',
          marginBottom: '6px'
        }}>
          <div
            style={{
              height: '100%',
              background: getStateColor(),
              width: `${timePercentage}%`,
              transition: 'width 0.1s linear'
            }}
          />
        </div>

        {/* Category and reserve */}
        {auction.category && (
          <div style={{
            fontSize: '8pt',
            color: '#6b7280',
            marginBottom: '4px'
          }}>
            📦 {auction.category}
          </div>
        )}

        {auction.config.reserve_price && auction.current_bid < auction.config.reserve_price && (
          <div style={{
            fontSize: '8pt',
            color: '#dc2626',
            marginBottom: '4px'
          }}>
            ⚠️ Reserve not met
          </div>
        )}

        {/* Bid Button */}
        <button
          style={{
            width: '100%',
            padding: '8px',
            background: getStateColor(),
            color: 'white',
            border: 'none',
            borderRadius: '2px',
            fontSize: '9pt',
            fontWeight: 'bold',
            cursor: ['active', 'ending_soon'].includes(auction.state) ? 'pointer' : 'not-allowed',
            opacity: ['active', 'ending_soon'].includes(auction.state) ? 1 : 0.5,
            transition: 'all 0.12s ease'
          }}
          disabled={!['active', 'ending_soon'].includes(auction.state)}
        >
          {['active', 'ending_soon'].includes(auction.state) ? 'Place Bid' : getStateLabel()}
        </button>
      </div>
    </div>
  );
};

export default AuctionCard;
