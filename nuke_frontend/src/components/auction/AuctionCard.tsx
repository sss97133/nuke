import { useState, useEffect } from 'react';
import { Auction, FlexibleAuctionService } from '../../services/flexibleAuctionService';
import '../../styles/unified-design-system.css';

// Urgency level type for timer coloring (NO YELLOW - BaT uses yellow)
type UrgencyLevel = 'ended' | 'lastMinute' | 'critical' | 'urgent' | 'gettingClose' | 'normal';

const urgencyTimerColors: Record<UrgencyLevel, string> = {
  lastMinute: 'var(--error)',    // Bright red - pulsing
  critical: 'var(--error)',      // Red
  urgent: 'var(--orange)',             // Orange (not yellow!) - intentional unique color
  gettingClose: '#e07960',       // Coral/salmon - intentional unique color
  normal: 'var(--text-secondary)',  // Gray
  ended: 'var(--text-disabled)',    // Light gray
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
        return isEnding ? 'var(--error)' : 'var(--success)';
      case 'scheduled':
        return 'var(--text-secondary)';
      case 'sold':
        return 'var(--accent)';
      case 'unsold':
        return 'var(--text-disabled)';
      default:
        return 'var(--text-secondary)';
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
            fontSize: '13px',
            fontWeight: 'bold',
            marginBottom: '8px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            color: 'var(--text)'
          }}>
            {auction.title}
          </div>

          <div style={{
            fontSize: '15px',
            fontWeight: 'bold',
            color: getStateColor(),
            marginBottom: '6px'
          }}>
            {formatCurrency(auction.current_bid)}
          </div>

          {auction.bid_count > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              🔨 {auction.bid_count} {auction.bid_count === 1 ? 'bid' : 'bids'}
            </div>
          )}
        </div>

        <div>
          {/* Timer bar */}
          <div style={{
            width: '100%',
            height: '4px',
            background: 'var(--border)', overflow: 'hidden',
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
            fontSize: '11px'
          }}>
            <span style={{
              color: urgencyTimerColors[urgencyLevel],
              fontWeight: 'bold',
              opacity: ['lastMinute', 'critical'].includes(urgencyLevel) ? (pulsePhase === 0 ? 1 : 0.6) : 1,
              transition: 'opacity 0.15s',
            }}>
              {timeRemaining}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
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
        background: 'var(--border)',
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
          <div style={{ fontSize: '48px', color: 'var(--text-disabled)' }}>🚗</div>
        )}

        {/* State badge */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: getStateColor(),
            color: 'var(--bg)',
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: 'bold'}}
        >
          {getStateLabel()}
        </div>

        {/* Timer badge with urgency coloring */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'var(--overlay)',
            color: urgencyTimerColors[urgencyLevel],
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: 'bold', opacity: ['lastMinute', 'critical'].includes(urgencyLevel) ? (pulsePhase === 0 ? 1 : 0.7) : 1,
            transition: 'opacity 0.15s',
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
              background: 'var(--overlay)',
              color: 'var(--warning)',
              padding: '2px 6px',
              fontSize: '11px',
              fontWeight: 'bold'}}
          >
            ⚡ Extended {auction.extension_count}x
          </div>
        )}
      </div>

      {/* Details Section */}
      <div style={{ padding: '12px' }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 'bold',
          marginBottom: '8px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          color: 'var(--text)'
        }}>
          {auction.title}
        </div>

        {auction.description && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
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
          background: 'var(--success-dim)',
          padding: '10px',
          marginBottom: '8px', border: '1px solid rgba(16, 185, 129, 0.2)', }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
            Current Bid:
          </div>
          <div style={{
            fontSize: '19px',
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
          fontSize: '11px'
        }}>
          <div style={{ color: 'var(--text-secondary)' }}>
            🔨 <strong>{auction.bid_count}</strong> bids
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            ⚡ <strong>{auction.extension_count}</strong> extensions
          </div>
        </div>

        {/* Timer Progress Bar */}
        <div style={{
          width: '100%',
          height: '6px',
          background: 'var(--border)', overflow: 'hidden',
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
            fontSize: '11px',
            color: 'var(--text-secondary)',
            marginBottom: '4px'
          }}>
            📦 {auction.category}
          </div>
        )}

        {auction.config.reserve_price && auction.current_bid < auction.config.reserve_price && (
          <div style={{
            fontSize: '11px',
            color: 'var(--error)',
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
            color: 'var(--bg)',
            border: 'none', fontSize: '12px',
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
