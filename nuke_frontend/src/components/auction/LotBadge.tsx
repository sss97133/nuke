import React, { useState } from 'react';
import '../../styles/unified-design-system.css';

interface LotBadgeProps {
  lotNumber?: string | null;
  date?: string | null;
  location?: string | null;
  auctionHouse?: string | null;
  salePrice?: number | null;
  currency?: string;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  compact?: boolean;
  showDetails?: boolean;
}

const LotBadge: React.FC<LotBadgeProps> = ({
  lotNumber,
  date,
  location,
  auctionHouse,
  salePrice,
  currency = 'USD',
  estimateLow,
  estimateHigh,
  compact = false,
  showDetails = true
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!lotNumber && !date && !location && !auctionHouse && !salePrice) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: compact ? 'row' : 'column',
    gap: compact ? '8px' : '4px',
    padding: compact ? '4px 8px' : '8px 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: compact ? '11px' : '12px',
    cursor: showDetails ? 'pointer' : 'default',
    maxWidth: compact ? 'none' : '280px',
    width: '100%'
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    background: 'var(--accent)',
    color: 'var(--bg)',
    borderRadius: '3px',
    fontWeight: 700,
    fontSize: compact ? '10px' : '11px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase'
  };

  const priceStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    background: salePrice ? 'var(--success)' : 'var(--bg)',
    color: salePrice ? 'var(--bg)' : 'var(--text-muted)',
    border: salePrice ? 'none' : '1px solid var(--border)',
    borderRadius: '3px',
    fontWeight: salePrice ? 700 : 400,
    fontSize: compact ? '10px' : '11px'
  };

  const detailStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '4px',
    paddingTop: '4px',
    borderTop: '1px solid var(--border)',
    fontSize: '11px',
    color: 'var(--text-secondary)'
  };

  const detailRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px'
  };

  const hasEstimates = estimateLow || estimateHigh;

  return (
    <div
      style={containerStyle}
      onClick={() => showDetails && setIsExpanded(!isExpanded)}
      title={showDetails ? (isExpanded ? 'Click to collapse' : 'Click for details') : undefined}
    >
      {/* Header Row */}
      <div style={headerStyle}>
        {/* Auction Badge */}
        {lotNumber && (
          <div style={badgeStyle}>
            <span>Lot</span>
            <span>#{lotNumber}</span>
          </div>
        )}

        {/* Sale Price */}
        <div style={priceStyle}>
          {salePrice ? (
            <>
              <span>Sold</span>
              <span>{formatCurrency(salePrice)}</span>
            </>
          ) : (
            <span>Price TBD</span>
          )}
        </div>

        {/* Auction House shorthand */}
        {auctionHouse && compact && (
          <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
            {auctionHouse.length > 20 ? auctionHouse.substring(0, 20) + '...' : auctionHouse}
          </span>
        )}

        {/* Expand indicator */}
        {showDetails && !compact && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '10px' }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Date/Location Row - always visible in non-compact */}
      {!compact && (date || location) && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
          {date && (
            <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
              📅 {formatDate(date)}
            </span>
          )}
          {location && (
            <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
              📍 {location.length > 25 ? location.substring(0, 25) + '...' : location}
            </span>
          )}
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && showDetails && (
        <div style={detailStyle}>
          {auctionHouse && (
            <div style={detailRowStyle}>
              <span style={{ fontWeight: 600 }}>Auction House</span>
              <span>{auctionHouse}</span>
            </div>
          )}
          {date && (
            <div style={detailRowStyle}>
              <span style={{ fontWeight: 600 }}>Date</span>
              <span>{formatDate(date)}</span>
            </div>
          )}
          {location && (
            <div style={detailRowStyle}>
              <span style={{ fontWeight: 600 }}>Location</span>
              <span>{location}</span>
            </div>
          )}
          {hasEstimates && (
            <div style={detailRowStyle}>
              <span style={{ fontWeight: 600 }}>Estimate</span>
              <span>
                {estimateLow && formatCurrency(estimateLow)}
                {estimateLow && estimateHigh && ' – '}
                {estimateHigh && formatCurrency(estimateHigh)}
              </span>
            </div>
          )}
          {salePrice && (
            <div style={detailRowStyle}>
              <span style={{ fontWeight: 600 }}>Sale Price</span>
              <span style={{ color: 'var(--success)', fontWeight: 700 }}>
                {formatCurrency(salePrice)}
              </span>
            </div>
          )}
          {salePrice && estimateLow && (
            <div style={detailRowStyle}>
              <span style={{ fontWeight: 600 }}>vs. Estimate</span>
              <span style={{
                color: salePrice >= estimateLow ? 'var(--success)' : 'var(--error)',
                fontWeight: 700
              }}>
                {salePrice >= estimateLow ? '+' : ''}
                {((salePrice - estimateLow) / estimateLow * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LotBadge;
