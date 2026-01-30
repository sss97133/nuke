import React, { useState } from 'react';
import {
  trackAndOpenAffiliateLink,
  formatPriceRange,
  getSourceColor,
  ClickTrackingParams
} from '../../services/affiliateTrackingService';

interface PartSource {
  name: string;
  price: number | null;
  condition: string;
  url: string;
  affiliateUrl: string;
  inStock: boolean;
  shippingCost: number | null;
  freeShipping: boolean;
}

interface LaborEstimate {
  hoursMin: number;
  hoursMax: number;
  difficulty: string;
  diyPossible: boolean;
}

interface Pricing {
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  newAvg: number | null;
  usedAvg: number | null;
  remanAvg: number | null;
  sourceCount: number;
}

interface PartsListingCardProps {
  partId: string;
  name: string;
  category: string;
  oemPartNumber?: string;
  laborEstimate: LaborEstimate;
  pricing: Pricing;
  sources: PartSource[];
  urgency: string;
  failureRisk: string;
  vehicleId?: string;
  issuePattern?: string;
  userId?: string;
  compact?: boolean;
}

const URGENCY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
  high: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  medium: { bg: '#fefce8', text: '#854d0e', border: '#fef08a' },
  low: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' }
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'DIY Friendly',
  moderate: 'Intermediate',
  hard: 'Advanced',
  expert: 'Pro Only'
};

export const PartsListingCard: React.FC<PartsListingCardProps> = ({
  partId,
  name,
  category,
  oemPartNumber,
  laborEstimate,
  pricing,
  sources,
  urgency,
  failureRisk,
  vehicleId,
  issuePattern,
  userId,
  compact = false
}) => {
  const [expandedSources, setExpandedSources] = useState(false);
  const [trackingSource, setTrackingSource] = useState<string | null>(null);

  const urgencyStyle = URGENCY_COLORS[urgency] || URGENCY_COLORS.medium;

  const handleBuyClick = async (source: PartSource) => {
    setTrackingSource(source.name);

    const params: ClickTrackingParams = {
      sourceName: source.name,
      destinationUrl: source.url,
      affiliateUrl: source.affiliateUrl,
      userId,
      vehicleId,
      partId,
      issuePattern
    };

    await trackAndOpenAffiliateLink(params);
    setTrackingSource(null);
  };

  const formatPrice = (price: number | null): string => {
    if (price === null) return 'Check Price';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const formatLaborHours = (): string => {
    if (laborEstimate.hoursMin === laborEstimate.hoursMax) {
      return `${laborEstimate.hoursMin}hr`;
    }
    return `${laborEstimate.hoursMin}-${laborEstimate.hoursMax}hrs`;
  };

  const visibleSources = expandedSources ? sources : sources.slice(0, 3);

  if (compact) {
    return (
      <div
        style={{
          padding: '8px 12px',
          background: 'white',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '2px' }}>{name}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {pricing.minPrice !== null && pricing.maxPrice !== null
              ? formatPriceRange(pricing.minPrice * 100, pricing.maxPrice * 100)
              : 'Price varies'}
          </div>
        </div>
        {sources.length > 0 && (
          <button
            onClick={() => handleBuyClick(sources[0])}
            disabled={trackingSource !== null}
            style={{
              padding: '4px 10px',
              fontSize: '8pt',
              fontWeight: 600,
              background: getSourceColor(sources[0].name),
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: trackingSource ? 'wait' : 'pointer',
              opacity: trackingSource ? 0.7 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            {trackingSource === sources[0].name ? '...' : `Buy @ ${sources[0].name}`}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'white',
        border: `1px solid ${urgencyStyle.border}`,
        borderRadius: '6px',
        overflow: 'hidden'
      }}
    >
      {/* Header with urgency indicator */}
      <div
        style={{
          padding: '10px 12px',
          background: urgencyStyle.bg,
          borderBottom: `1px solid ${urgencyStyle.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '8px'
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '10pt', fontWeight: 700 }}>{name}</span>
            <span
              style={{
                fontSize: '7pt',
                fontWeight: 600,
                padding: '2px 6px',
                background: urgencyStyle.border,
                color: urgencyStyle.text,
                borderRadius: '3px',
                textTransform: 'uppercase'
              }}
            >
              {urgency}
            </span>
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {category}
            {oemPartNumber && <span> | OEM: {oemPartNumber}</span>}
          </div>
        </div>

        {/* Price range */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11pt', fontWeight: 700, color: '#166534' }}>
            {pricing.minPrice !== null && pricing.maxPrice !== null
              ? formatPriceRange(pricing.minPrice * 100, pricing.maxPrice * 100)
              : 'Check Prices'}
          </div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
            {pricing.sourceCount} source{pricing.sourceCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Failure risk warning */}
      {failureRisk && (
        <div
          style={{
            padding: '8px 12px',
            background: '#fef3c7',
            borderBottom: '1px solid #fcd34d',
            fontSize: '8pt',
            color: '#92400e'
          }}
        >
          <strong>Risk:</strong> {failureRisk}
        </div>
      )}

      {/* Body with sources and labor */}
      <div style={{ padding: '12px' }}>
        {/* Condition pricing breakdown */}
        {(pricing.newAvg || pricing.usedAvg || pricing.remanAvg) && (
          <div
            style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '12px',
              fontSize: '8pt',
              color: 'var(--text-secondary)'
            }}
          >
            {pricing.newAvg && (
              <span>
                New: <strong>${pricing.newAvg.toFixed(0)}</strong>
              </span>
            )}
            {pricing.usedAvg && (
              <span>
                Used: <strong>${pricing.usedAvg.toFixed(0)}</strong>
              </span>
            )}
            {pricing.remanAvg && (
              <span>
                Reman: <strong>${pricing.remanAvg.toFixed(0)}</strong>
              </span>
            )}
          </div>
        )}

        {/* Source buttons */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '6px', color: 'var(--text-muted)' }}>
            Buy From:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {visibleSources.map((source, idx) => (
              <button
                key={idx}
                onClick={() => handleBuyClick(source)}
                disabled={trackingSource !== null}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  fontSize: '8pt',
                  fontWeight: 500,
                  background: 'white',
                  color: getSourceColor(source.name),
                  border: `1px solid ${getSourceColor(source.name)}`,
                  borderRadius: '4px',
                  cursor: trackingSource ? 'wait' : 'pointer',
                  opacity: trackingSource && trackingSource !== source.name ? 0.6 : 1,
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  if (!trackingSource) {
                    e.currentTarget.style.background = getSourceColor(source.name);
                    e.currentTarget.style.color = 'white';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.color = getSourceColor(source.name);
                }}
              >
                <span>{source.name}</span>
                {source.price !== null && (
                  <span style={{ fontWeight: 700 }}>{formatPrice(source.price)}</span>
                )}
                {source.freeShipping && (
                  <span
                    style={{
                      fontSize: '6pt',
                      background: '#dcfce7',
                      color: '#166534',
                      padding: '1px 4px',
                      borderRadius: '2px'
                    }}
                  >
                    FREE SHIP
                  </span>
                )}
                {trackingSource === source.name && <span>...</span>}
              </button>
            ))}

            {sources.length > 3 && (
              <button
                onClick={() => setExpandedSources(!expandedSources)}
                style={{
                  padding: '6px 10px',
                  fontSize: '8pt',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {expandedSources ? 'Show Less' : `+${sources.length - 3} more`}
              </button>
            )}
          </div>
        </div>

        {/* Labor estimate */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 10px',
            background: 'var(--bg-secondary)',
            borderRadius: '4px',
            fontSize: '8pt'
          }}
        >
          <div style={{ display: 'flex', gap: '12px' }}>
            <span>
              <strong>Labor:</strong> {formatLaborHours()}
            </span>
            <span
              style={{
                padding: '1px 6px',
                background: laborEstimate.diyPossible ? '#dcfce7' : '#fef3c7',
                color: laborEstimate.diyPossible ? '#166534' : '#92400e',
                borderRadius: '2px',
                fontSize: '7pt',
                fontWeight: 600
              }}
            >
              {DIFFICULTY_LABELS[laborEstimate.difficulty] || laborEstimate.difficulty}
            </span>
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            Est. $100-150/hr shop rate
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartsListingCard;
