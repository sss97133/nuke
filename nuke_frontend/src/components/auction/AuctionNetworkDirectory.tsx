import React from 'react';
import { FaviconIcon } from '../common/FaviconIcon';
import {
  auctionPlatforms,
  tierLabels,
  getPlatformsByTier,
  type AuctionPlatform,
} from '../../data/auctionPlatforms';

interface AuctionNetworkDirectoryProps {
  expanded?: boolean;
}

function PlatformCard({ platform }: { platform: AuctionPlatform }) {
  return (
    <a
      href={platform.auctionsUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        border: '2px solid var(--border)',
        background: 'var(--surface)',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
    >
      <div style={{ flexShrink: 0, marginTop: '1px' }}>
        <FaviconIcon
          url={`https://${platform.domain}`}
          size={20}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            fontFamily: 'Arial, sans-serif',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {platform.name}
          </span>
          {platform.specialty && (
            <span style={{
              fontSize: '7px',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              padding: '1px 4px',
              flexShrink: 0,
            }}>
              {platform.specialty}
            </span>
          )}
          {platform.region && (
            <span style={{
              fontSize: '7px',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              padding: '1px 4px',
              flexShrink: 0,
            }}>
              {platform.region}
            </span>
          )}
          <span style={{
            marginLeft: 'auto',
            fontSize: '10px',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            ↗
          </span>
        </div>
        <div style={{
          fontSize: '8px',
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text-muted)',
          marginTop: '3px',
          lineHeight: '1.3',
        }}>
          {platform.description}
        </div>
      </div>
    </a>
  );
}

function TierSection({ tier }: { tier: 1 | 2 | 3 }) {
  const platforms = getPlatformsByTier(tier);
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{
        fontSize: '8px',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: 'var(--text-muted)',
        marginBottom: '8px',
      }}>
        {tierLabels[tier]}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '8px',
      }}>
        {platforms.map((p) => (
          <PlatformCard key={p.id} platform={p} />
        ))}
      </div>
    </div>
  );
}

function CollapsedBar() {
  const tier1 = getPlatformsByTier(1);
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        fontSize: '8px',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: 'var(--text-muted)',
        marginBottom: '6px',
      }}>
        AUCTION NETWORK
      </div>
      <div style={{
        display: 'flex',
        gap: '6px',
        overflowX: 'auto',
        paddingBottom: '4px',
      }}>
        {auctionPlatforms.map((p) => (
          <a
            key={p.id}
            href={p.auctionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={p.name}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: '9px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 600,
              color: 'var(--text)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            <FaviconIcon
              url={`https://${p.domain}`}
              size={12}
            />
            {p.shortName}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function AuctionNetworkDirectory({ expanded = true }: AuctionNetworkDirectoryProps) {
  if (!expanded) {
    return <CollapsedBar />;
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{
        fontSize: '9px',
        fontFamily: 'Arial, sans-serif',
        color: 'var(--text-muted)',
        marginBottom: '16px',
      }}>
        {auctionPlatforms.length} platforms tracked across online auctions, live auction houses, and aggregators.
      </div>
      <TierSection tier={1} />
      <TierSection tier={2} />
      <TierSection tier={3} />
    </div>
  );
}
