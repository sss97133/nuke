/**
 * PlatformPreview.tsx
 * Tab-based preview showing how a listing will look on each selected platform.
 * Renders inside the ListingComposerModal preview tab.
 */

import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListingData {
  title: string;
  description: string;
  highlights: string;
  equipment: string;
  modifications: string;
  knownFlaws: string;
  price: number;
  photos: Array<{ url: string; zone: string | null; quality: number | null; caption: string | null }>;
  platforms: string[];
  identity: Record<string, unknown>;
  ars_score: number | null;
  tier: string | null;
}

interface PlatformPreviewProps {
  listing: ListingData;
  vehicleId: string;
  onCopy: (platform: string) => void;
  copiedPlatform: string | null;
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const FONT_BODY = 'Arial, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";

const LABEL: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text-secondary, #666666)',
  fontFamily: FONT_BODY,
};

const BUTTON: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  padding: '6px 12px',
  border: '2px solid var(--border, #bdbdbd)',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text, #2a2a2a)',
};

// ---------------------------------------------------------------------------
// Platform-specific previews
// ---------------------------------------------------------------------------

function BaTPreview({ listing }: { listing: ListingData }) {
  return (
    <div style={{ fontFamily: FONT_BODY, fontSize: '13px', lineHeight: 1.6, color: '#333' }}>
      {/* Hero image */}
      {listing.photos[0] && (
        <div style={{ marginBottom: 16, border: '1px solid #ddd' }}>
          <img
            src={listing.photos[0].url}
            alt="Hero"
            style={{ width: '100%', maxHeight: 400, objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      <h2 style={{ fontFamily: FONT_BODY, fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0' }}>
        {listing.title}
      </h2>

      {/* Story description */}
      <div style={{ whiteSpace: 'pre-wrap', marginBottom: 16 }}>
        {listing.description}
      </div>

      {listing.highlights && (
        <div style={{ marginBottom: 16 }}>
          <strong style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>Highlights</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{listing.highlights}</div>
        </div>
      )}

      {listing.equipment && (
        <div style={{ marginBottom: 16 }}>
          <strong style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>Equipment</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{listing.equipment}</div>
        </div>
      )}

      {listing.modifications && (
        <div style={{ marginBottom: 16 }}>
          <strong style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>Modifications</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{listing.modifications}</div>
        </div>
      )}

      {listing.knownFlaws && (
        <div style={{ marginBottom: 16 }}>
          <strong style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>Known Flaws</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{listing.knownFlaws}</div>
        </div>
      )}

      {/* Photo grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 16 }}>
        {listing.photos.slice(1, 13).map((p, i) => (
          <img
            key={p.url}
            src={p.url}
            alt={`Photo ${i + 2}`}
            style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', border: '1px solid #ddd' }}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}

function EbayPreview({ listing }: { listing: ListingData }) {
  const specs = listing.identity;
  return (
    <div style={{ fontFamily: FONT_BODY, fontSize: '12px', color: '#333' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 12px 0', color: '#0654ba' }}>
        {listing.title}
      </h2>

      <div style={{ fontFamily: FONT_MONO, fontSize: '20px', fontWeight: 700, color: '#333', marginBottom: 12 }}>
        ${listing.price.toLocaleString()}
      </div>

      {listing.photos[0] && (
        <div style={{ marginBottom: 12 }}>
          <img src={listing.photos[0].url} alt="Main" style={{ width: '100%', maxHeight: 300, objectFit: 'cover', display: 'block' }} />
        </div>
      )}

      {/* Specs table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: '11px' }}>
        <tbody>
          {Object.entries(specs).filter(([_, v]) => v != null && v !== '').map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '4px 8px', fontWeight: 700, textTransform: 'capitalize', width: '30%', backgroundColor: '#f8f8f8' }}>
                {k.replace(/_/g, ' ')}
              </td>
              <td style={{ padding: '4px 8px' }}>{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {listing.description}
      </div>
    </div>
  );
}

function CraigslistPreview({ listing }: { listing: ListingData }) {
  return (
    <div style={{
      fontFamily: FONT_MONO,
      fontSize: '12px',
      color: '#111',
      backgroundColor: '#f5f5f5',
      padding: 16,
      border: '2px solid var(--border, #bdbdbd)',
      whiteSpace: 'pre-wrap',
      lineHeight: 1.6,
    }}>
      <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: 8 }}>
        {listing.title} - ${listing.price.toLocaleString()}
      </div>
      <div>{listing.description}</div>
      {listing.highlights && <div>{'\n'}Highlights:{'\n'}{listing.highlights}</div>}
      {listing.modifications && <div>{'\n'}Modifications:{'\n'}{listing.modifications}</div>}
      {listing.knownFlaws && <div>{'\n'}Known Flaws:{'\n'}{listing.knownFlaws}</div>}
      <div style={{ marginTop: 12 }}>
        Location: {(listing.identity.location as string) || 'N/A'}
      </div>
      <div style={{ marginTop: 4 }}>
        Serious inquiries only. No trades.
      </div>
    </div>
  );
}

function FacebookPreview({ listing }: { listing: ListingData }) {
  return (
    <div style={{ fontFamily: FONT_BODY, fontSize: '13px', color: '#1c1e21', maxWidth: 500 }}>
      {listing.photos[0] && (
        <div style={{ marginBottom: 8 }}>
          <img src={listing.photos[0].url} alt="Main" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
      <div style={{ padding: '0 8px' }}>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#1877f2' }}>
          ${listing.price.toLocaleString()}
        </div>
        <div style={{ fontSize: '15px', fontWeight: 600, marginTop: 4 }}>
          {listing.title}
        </div>
        <div style={{ fontSize: '12px', color: '#65676b', marginTop: 2 }}>
          {(listing.identity.location as string) || 'Location not set'}
        </div>
        <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: '12px', color: '#444' }}>
          {listing.description?.slice(0, 300)}
          {(listing.description?.length || 0) > 300 ? '...' : ''}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform Preview Tabs
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
  bat: 'BRING A TRAILER',
  carsandbids: 'CARS & BIDS',
  ebay: 'EBAY MOTORS',
  facebook: 'FB MARKETPLACE',
  craigslist: 'CRAIGSLIST',
  hemmings: 'HEMMINGS',
  hagerty: 'HAGERTY',
};

const PLATFORM_URLS: Record<string, string> = {
  bat: 'https://bringatrailer.com/submit/',
  ebay: 'https://www.ebay.com/sl/sell',
  craigslist: 'https://post.craigslist.org/',
  facebook: 'https://www.facebook.com/marketplace/create/vehicle/',
  carsandbids: 'https://carsandbids.com/sell/',
  hemmings: 'https://www.hemmings.com/classifieds/sell',
};

export default function PlatformPreview({ listing, vehicleId, onCopy, copiedPlatform }: PlatformPreviewProps) {
  const [activePlatform, setActivePlatform] = useState(listing.platforms[0] || 'bat');

  const renderPreview = () => {
    switch (activePlatform) {
      case 'bat':
      case 'carsandbids':
      case 'hemmings':
      case 'hagerty':
        return <BaTPreview listing={listing} />;
      case 'ebay':
        return <EbayPreview listing={listing} />;
      case 'craigslist':
        return <CraigslistPreview listing={listing} />;
      case 'facebook':
        return <FacebookPreview listing={listing} />;
      default:
        return <BaTPreview listing={listing} />;
    }
  };

  return (
    <div>
      {/* Platform tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid var(--border, #bdbdbd)',
        marginBottom: 12,
      }}>
        {listing.platforms.map(p => (
          <button
            key={p}
            onClick={() => setActivePlatform(p)}
            style={{
              ...LABEL,
              fontSize: '9px',
              padding: '6px 12px',
              border: 'none',
              borderBottom: activePlatform === p ? '2px solid var(--text, #2a2a2a)' : '2px solid transparent',
              backgroundColor: activePlatform === p ? 'var(--bg, #f5f5f5)' : 'transparent',
              cursor: 'pointer',
              color: activePlatform === p ? 'var(--text, #2a2a2a)' : 'var(--text-secondary, #666666)',
            }}
          >
            {PLATFORM_LABELS[p] || p.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Preview area */}
      <div style={{
        border: '2px solid var(--border, #bdbdbd)',
        padding: 16,
        backgroundColor: '#fff',
        minHeight: 300,
      }}>
        {renderPreview()}
      </div>

      {/* Actions for this platform */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={() => onCopy(activePlatform)}
          style={{
            ...BUTTON,
            backgroundColor: copiedPlatform === activePlatform ? 'var(--success, #16825d)' : 'transparent',
            color: copiedPlatform === activePlatform ? 'var(--bg, #f5f5f5)' : 'var(--text, #2a2a2a)',
            borderColor: copiedPlatform === activePlatform ? 'var(--success, #16825d)' : 'var(--border, #bdbdbd)',
          }}
        >
          {copiedPlatform === activePlatform ? 'COPIED!' : `COPY FOR ${(PLATFORM_LABELS[activePlatform] || activePlatform).toUpperCase()}`}
        </button>
        {PLATFORM_URLS[activePlatform] && (
          <button
            onClick={() => window.open(PLATFORM_URLS[activePlatform], '_blank')}
            style={BUTTON}
          >
            OPEN {(PLATFORM_LABELS[activePlatform] || activePlatform).toUpperCase()} SUBMIT FORM
          </button>
        )}
      </div>
    </div>
  );
}
