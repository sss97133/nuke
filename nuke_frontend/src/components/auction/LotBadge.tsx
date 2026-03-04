import React, { useState } from 'react';
import '../../styles/unified-design-system.css';

interface LotBadgeProps {
  lotNumber?: string | null;
  date?: string | null;
  location?: string | null;
  salePrice?: number | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  listingUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * LotBadge - Clickable badge showing lot number, date, and location for live auctions (e.g., Mecum)
 * Clicking reveals additional auction details
 */
export const LotBadge: React.FC<LotBadgeProps> = ({
  lotNumber,
  date,
  location,
  salePrice,
  estimateLow,
  estimateHigh,
  listingUrl,
  className,
  style,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render if we don't have the essential data
  if (!lotNumber && !date && !location) {
    return null;
  }

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (!Number.isFinite(date.getTime())) return dateString;
      
      const options: Intl.DateTimeFormatOptions = { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      };
      const formattedDate = date.toLocaleDateString('en-US', options);
      const day = date.getDate();
      
      // Add ordinal suffix
      let suffix = 'th';
      if (day === 1 || day === 21 || day === 31) {
        suffix = 'st';
      } else if (day === 2 || day === 22) {
        suffix = 'nd';
      } else if (day === 3 || day === 23) {
        suffix = 'rd';
      }
      
      // Replace the day number with day + suffix
      return formattedDate.replace(/\d+/, `${day}${suffix}`);
    } catch {
      return dateString;
    }
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    if (!amount || !Number.isFinite(amount)) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formattedDate = formatDate(date);
  const hasDetails = salePrice || estimateLow || estimateHigh || listingUrl || lotNumber || date || location;
  
  // Determine if auction is upcoming (date is in the future)
  const isUpcoming = date ? new Date(date) > new Date() : false;
  const isPast = salePrice !== null && salePrice !== undefined;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style,
      }}
    >
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (hasDetails) {
            setIsExpanded(!isExpanded);
          }
        }}
        style={{
          background: isPast ? 'var(--success-dim)' : isUpcoming ? 'var(--info-bg, var(--accent-dim, #dbeafe))' : 'var(--warning-dim)',
          border: `1px solid ${isPast ? 'var(--success)' : isUpcoming ? 'var(--accent)' : 'var(--warning)'}`,
          borderRadius: '3px',
          padding: '2px 6px',
          cursor: hasDetails ? 'pointer' : 'default',
          fontFamily: 'inherit',
          fontSize: '9px',
          color: isPast ? 'var(--success)' : isUpcoming ? 'var(--accent)' : 'var(--warning)',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          transition: 'all 0.12s ease',
          textAlign: 'left',
          whiteSpace: 'nowrap',
          lineHeight: '1.2'
        }}
        onMouseEnter={(e) => {
          if (hasDetails) {
            e.currentTarget.style.opacity = '0.85';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        title={hasDetails ? 'Click for auction details' : undefined}
      >
        {isPast ? 'SOLD' : isUpcoming ? 'UPCOMING' : 'AUCTION'}
        {hasDetails && (
          <span style={{ 
            fontSize: '8px',
            transition: 'transform 0.12s ease',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            lineHeight: '1'
          }}>
            ▼
          </span>
        )}
      </button>

      {isExpanded && hasDetails && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '8px 10px',
            minWidth: '180px',
            maxWidth: '250px',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            fontSize: '11px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {lotNumber && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                Lot Number
              </div>
              <div style={{ fontWeight: 600, fontSize: '12px' }}>
                {lotNumber}
              </div>
            </div>
          )}
          {formattedDate && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                Date
              </div>
              <div style={{ fontWeight: 600, fontSize: '12px' }}>
                {formattedDate}
              </div>
            </div>
          )}
          {location && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                Location
              </div>
              <div style={{ fontWeight: 600, fontSize: '12px' }}>
                {location}
              </div>
            </div>
          )}
          {salePrice && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                Sold For
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--success)' }}>
                {formatCurrency(salePrice)}
              </div>
            </div>
          )}
          {(estimateLow || estimateHigh) && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                Estimate
              </div>
              <div style={{ fontWeight: 600, fontSize: '12px' }}>
                {estimateLow && estimateHigh
                  ? `${formatCurrency(estimateLow)} - ${formatCurrency(estimateHigh)}`
                  : estimateLow
                  ? `From ${formatCurrency(estimateLow)}`
                  : estimateHigh
                  ? `Up to ${formatCurrency(estimateHigh)}`
                  : ''}
              </div>
            </div>
          )}
          {listingUrl && (
            <div>
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.textDecoration = 'none';
                }}
              >
                View Listing →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

