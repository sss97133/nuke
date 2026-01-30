import React, { useState } from 'react';
import { trackAndOpenAffiliateLink, ClickTrackingParams } from '../../services/affiliateTrackingService';

interface SponsoredBannerProps {
  id: string;
  sponsorName: string;
  sponsorLogoUrl?: string | null;
  headline: string;
  description?: string | null;
  ctaText: string;
  destinationUrl: string;
  vehicleId?: string;
  issuePattern?: string;
  userId?: string;
  variant?: 'default' | 'compact' | 'inline';
}

export const SponsoredBanner: React.FC<SponsoredBannerProps> = ({
  id,
  sponsorName,
  sponsorLogoUrl,
  headline,
  description,
  ctaText,
  destinationUrl,
  vehicleId,
  issuePattern,
  userId,
  variant = 'default'
}) => {
  const [isClicking, setIsClicking] = useState(false);

  const handleClick = async () => {
    setIsClicking(true);

    const params: ClickTrackingParams = {
      sourceName: sponsorName,
      destinationUrl: destinationUrl,
      affiliateUrl: destinationUrl,
      userId,
      vehicleId,
      issuePattern,
      sponsoredPlacementId: id
    };

    await trackAndOpenAffiliateLink(params);
    setIsClicking(false);
  };

  if (variant === 'compact') {
    return (
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
          border: '1px solid #bae6fd',
          borderRadius: '6px',
          cursor: isClicking ? 'wait' : 'pointer',
          opacity: isClicking ? 0.8 : 1,
          transition: 'all 0.15s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '6pt',
              fontWeight: 600,
              color: '#0369a1',
              textTransform: 'uppercase',
              background: '#bae6fd',
              padding: '2px 4px',
              borderRadius: '2px'
            }}
          >
            AD
          </span>
          {sponsorLogoUrl && (
            <img src={sponsorLogoUrl} alt="" style={{ height: '16px', opacity: 0.9 }} />
          )}
          <span style={{ fontSize: '9pt', fontWeight: 600 }}>{headline}</span>
        </div>
        <span
          style={{
            padding: '4px 10px',
            fontSize: '8pt',
            fontWeight: 600,
            background: '#0284c7',
            color: 'white',
            borderRadius: '4px'
          }}
        >
          {ctaText}
        </span>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <span
        onClick={handleClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '4px',
          cursor: isClicking ? 'wait' : 'pointer',
          fontSize: '8pt',
          color: '#0369a1'
        }}
      >
        <span style={{ fontSize: '6pt', fontWeight: 600 }}>AD</span>
        {headline}
      </span>
    );
  }

  // Default variant
  return (
    <div
      onClick={handleClick}
      style={{
        padding: '14px 16px',
        background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
        border: '1px solid #bae6fd',
        borderRadius: '8px',
        cursor: isClicking ? 'wait' : 'pointer',
        opacity: isClicking ? 0.8 : 1,
        transition: 'all 0.15s ease'
      }}
    >
      {/* Sponsored label */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '8px'
        }}
      >
        <span
          style={{
            fontSize: '6pt',
            fontWeight: 600,
            color: '#0369a1',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}
        >
          Sponsored
        </span>
        {sponsorLogoUrl && (
          <img
            src={sponsorLogoUrl}
            alt={sponsorName}
            style={{
              height: '20px',
              maxWidth: '80px',
              objectFit: 'contain',
              opacity: 0.9
            }}
          />
        )}
      </div>

      {/* Headline */}
      <div
        style={{
          fontSize: '11pt',
          fontWeight: 700,
          color: '#0c4a6e',
          marginBottom: '6px',
          lineHeight: 1.3
        }}
      >
        {headline}
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            fontSize: '9pt',
            color: '#475569',
            marginBottom: '12px',
            lineHeight: 1.4
          }}
        >
          {description}
        </div>
      )}

      {/* CTA Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            fontSize: '9pt',
            fontWeight: 600,
            background: '#0284c7',
            color: 'white',
            borderRadius: '6px',
            boxShadow: '0 2px 4px rgba(2, 132, 199, 0.3)'
          }}
        >
          {ctaText}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 6h10M7 2l4 4-4 4" />
          </svg>
        </span>
        <span style={{ fontSize: '7pt', color: '#64748b' }}>
          {sponsorName}
        </span>
      </div>
    </div>
  );
};

export default SponsoredBanner;
