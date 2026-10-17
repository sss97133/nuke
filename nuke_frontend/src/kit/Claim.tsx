import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HeaderPopover } from '../components/vehicle/HeaderPopover';
import type { Claim, Role } from './types';
import { Text } from './Text';
import { day, formatMeasure } from './format';

const SOURCE_KIND_LABEL: Record<Claim['source']['kind'], string> = {
  listing: 'Listing',
  owner: 'Owner',
  image: 'Image',
  document: 'Document',
  agent: 'Agent',
  model: 'Model',
  legacy: 'Legacy record',
};

const SOURCE_LOGO_PATTERNS: Array<{ pattern: RegExp; logo: string }> = [
  { pattern: /\bmecum\b|mecum\.com/i, logo: '/source-logos/mecum.png' },
  { pattern: /\bbring\s*a\s*trailer\b|\bbat\b|bringatrailer\.com/i, logo: '/source-logos/bat.png' },
  { pattern: /\bbarrett[\s-]*jackson\b|barrett-jackson\.com/i, logo: '/source-logos/barrett-jackson.png' },
  { pattern: /\bcars\s*(?:&|and)\s*bids\b|cars_and_bids|carsandbids\.com/i, logo: '/source-logos/cars-and-bids.png' },
  { pattern: /\brm\s*sotheby|rm_sothebys|rmsothebys\.com/i, logo: '/source-logos/rm-sothebys.png' },
  { pattern: /\bgooding\b|goodingco\.com/i, logo: '/source-logos/gooding.png' },
  { pattern: /\bbonhams\b|bonhams\.com/i, logo: '/source-logos/bonhams.png' },
  { pattern: /\bbroad\s*arrow\b|broad_arrow|broadarrowauctions\.com/i, logo: '/source-logos/broad-arrow.png' },
  { pattern: /\bpcarmarket\b|pcarmarket\.com/i, logo: '/source-logos/pcarmarket.png' },
  { pattern: /\bcollecting\s*cars\b|collectingcars\.com/i, logo: '/source-logos/collecting-cars.png' },
  { pattern: /\bsbx\b|sbxcars\.com/i, logo: '/source-logos/sbx-cars.png' },
  { pattern: /\bclassiccars\b|classiccars\.com/i, logo: '/source-logos/classiccars-com.png' },
  { pattern: /\bclassic\.com\b|classic-com/i, logo: '/source-logos/classic-com.png' },
  { pattern: /\bebay\b|ebay\.com/i, logo: '/source-logos/ebay_motors.png' },
  { pattern: /\bfacebook\b|facebook\.com/i, logo: '/source-logos/facebook_marketplace.png' },
  { pattern: /\bcraigslist\b|craigslist\.org/i, logo: '/source-logos/craigslist.png' },
  { pattern: /\bksl\b|ksl\.com/i, logo: '/source-logos/ksl.png' },
  { pattern: /\bhemmings\b|hemmings\.com/i, logo: '/source-logos/hemmings.png' },
  { pattern: /\bhagerty\b|hagerty\.com/i, logo: '/source-logos/hagerty-marketplace.png' },
  { pattern: /\bjames\s*edition\b|jamesedition\.com/i, logo: '/source-logos/jamesedition.png' },
  { pattern: /\bbarn\s*finds?\b|barnfinds\.com/i, logo: '/source-logos/barnfinds.png' },
  { pattern: /\bbeverly\s*hills\s*car\s*club\b|beverlyhillscarclub\.com/i, logo: '/source-logos/beverlyhillscarclub.png' },
  { pattern: /\bmotorious\b|motorious\.com/i, logo: '/source-logos/motorious.png' },
  { pattern: /\bstreetside\s*classics\b|streetsideclassics\.com/i, logo: '/source-logos/streetside-classics.png' },
  { pattern: /\bgrand\s*prix\s*classics\b|grandprixclassics\.com/i, logo: '/source-logos/grand-prix-classics.png' },
  { pattern: /\bvelocity\s*restorations\b|velocityrestorations\.com/i, logo: '/source-logos/velocity-restorations.png' },
  { pattern: /\bvanguard\s*motor\s*sales\b|vanguardmotorsales\.com/i, logo: '/source-logos/vanguard-motor-sales.png' },
  { pattern: /\bgateway\s*classic\s*cars\b|gatewayclassiccars\.com/i, logo: '/source-logos/gateway-classic-cars.png' },
  { pattern: /\bcar\s*(?:&|and)\s*classic\b|carandclassic\.com/i, logo: '/source-logos/carandclassic.png' },
  { pattern: /\bclassic\s*driver\b|classicdriver\.com/i, logo: '/source-logos/classicdriver.png' },
  { pattern: /\bautotrader\s*classics\b|classics\.autotrader\.com/i, logo: '/source-logos/autotrader-classics.png' },
  { pattern: /\bconceptcarz\b|conceptcarz\.com/i, logo: '/source-logos/conceptcarz.png' },
  { pattern: /\bavant[\s-]*garde\s*collection\b|a-gc\.com/i, logo: '/source-logos/avant-garde-collection.png' },
  { pattern: /\b1600\s*veloce\b|1600veloce\.com/i, logo: '/source-logos/1600veloce.png' },
  { pattern: /\bfantasy\s*junction\b|fantasyjunction\.com/i, logo: '/source-logos/fantasy-junction.png' },
  { pattern: /\bgaa\s*classic\s*cars\b|gaaclassiccars\.com/i, logo: '/source-logos/gaa-classic-cars.png' },
];

export function resolveSourceLogo(label?: string | null, url?: string | null): string | null {
  const combined = `${label ?? ''} ${url ?? ''}`.trim();
  if (!combined) return null;
  for (const entry of SOURCE_LOGO_PATTERNS) {
    if (entry.pattern.test(combined)) return entry.logo;
  }
  return null;
}

function buildYoutubeEmbedUrl(rawUrl?: string | null, startSeconds?: number | null, endSeconds?: number | null): string | null {
  if (!rawUrl) return null;
  let videoId: string | null = null;
  const ytMatch = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) {
    videoId = ytMatch[1];
  } else if (/^[A-Za-z0-9_-]{11}$/.test(rawUrl.trim())) {
    videoId = rawUrl.trim();
  }
  if (!videoId) return null;
  const params = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (startSeconds != null && Number.isFinite(startSeconds) && startSeconds > 0) {
    params.set('start', String(Math.floor(startSeconds)));
  }
  if (endSeconds != null && Number.isFinite(endSeconds) && endSeconds > 0) {
    params.set('end', String(Math.floor(endSeconds)));
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function formatTimestamp(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The evidence behind a claim: when it was observed, who said it, how far it is trusted, where to read it. */
export function SourceView({ claim }: { claim: Claim }) {
  const [videoOpen, setVideoOpen] = useState(false);
  const url = claim.source.url && /^https?:\/\//i.test(claim.source.url) ? claim.source.url : null;
  const sourceName = claim.source.label ?? SOURCE_KIND_LABEL[claim.source.kind];
  const logoUrl = claim.source.logoUrl ?? resolveSourceLogo(claim.source.label, url);
  const lotNumber = claim.source.lotNumber ?? claim.source.video?.lotNumber ?? null;
  const auctionName = claim.source.auctionName ?? claim.source.video?.auctionName ?? null;
  const lotLine = [lotNumber ? `Lot ${lotNumber}` : null, auctionName].filter(Boolean).join(' · ');

  const isAuctionSaleClaim =
    !!claim.source.video ||
    (!!logoUrl && (claim.source.method === 'sold' || claim.unit === 'USD'));

  const embedUrl = buildYoutubeEmbedUrl(
    claim.source.video?.url,
    claim.source.video?.startSeconds,
    claim.source.video?.endSeconds,
  );
  const directVideoUrl = claim.source.video?.url && /^https?:\/\//i.test(claim.source.video.url)
    ? claim.source.video.url
    : null;
  const fallbackSearchQuery =
    claim.source.video?.searchQuery ||
    [
      sourceName,
      auctionName,
      lotNumber ? `Lot ${lotNumber}` : null,
      claim.source.video?.title,
      'auction sold',
    ]
      .filter(Boolean)
      .join(' ');
  const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackSearchQuery)}`;
  const startLabel = formatTimestamp(claim.source.video?.startSeconds);
  const priceDisplay =
    claim.source.video?.priceText ??
    (typeof claim.value === 'number' && claim.unit === 'USD' ? formatMeasure(claim.value, 'USD') : String(claim.value));

  return (
    <div className="k-claim__source">
      <p>
        <Text role="label">Observed</Text>
        <Text role="body">{day(claim.observed_at)}</Text>
      </p>
      <p className="k-claim__source-row">
        <Text role="label">Source</Text>
        <span className="k-claim__source-identity">
          {logoUrl && <img className="k-claim__logo" src={logoUrl} alt={sourceName} />}
          <Text role="body">{sourceName}{claim.source.method ? ` · ${claim.source.method}` : ''}</Text>
        </span>
      </p>
      {lotLine && (
        <p>
          <Text role="label">Lot</Text>
          <Text role="body">{lotLine}</Text>
        </p>
      )}
      <p>
        <Text role="label">Trust</Text>
        <Text role="body">{Math.round(Math.min(1, Math.max(0, claim.trust)) * 100)}%</Text>
      </p>
      {(url || isAuctionSaleClaim) && (
        <div className="k-claim__actions">
          {isAuctionSaleClaim && (
            <button
              type="button"
              className="k-claim__play-btn"
              onClick={() => setVideoOpen(true)}
              aria-label="Watch sale moment"
            >
              <span className="k-claim__play-icon" aria-hidden="true">▶</span>
              <span>Watch sale moment{startLabel ? ` (${startLabel})` : ''}</span>
            </button>
          )}
          {url && (
            <a className="k-body k-claim__link" href={url} target="_blank" rel="noreferrer">
              {lotNumber ? `Open Lot ${lotNumber} ↗` : 'Open source ↗'}
            </a>
          )}
        </div>
      )}
      {videoOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="k-video-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Sale moment broadcast"
          onClick={() => setVideoOpen(false)}
        >
          <div className="k-video-modal" onClick={(e) => e.stopPropagation()}>
            <div className="k-video-modal__head">
              <div className="k-video-modal__brand">
                {logoUrl && <img className="k-video-modal__logo" src={logoUrl} alt={sourceName} />}
                <div className="k-video-modal__titles">
                  <Text role="label">
                    {[sourceName, auctionName, lotNumber ? `LOT ${lotNumber}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  <Text role="entity" dense>
                    {claim.source.video?.title || `${sourceName} Sale Moment`}
                  </Text>
                </div>
              </div>
              <div className="k-video-modal__meta">
                <Text role="measure">{priceDisplay}</Text>
                <button
                  type="button"
                  className="k-video-modal__close"
                  aria-label="Close sale video popup"
                  onClick={() => setVideoOpen(false)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="k-video-modal__body">
              {embedUrl ? (
                <div className="k-video-modal__player">
                  <iframe
                    className="k-video-modal__iframe"
                    src={embedUrl}
                    title={claim.source.video?.title || 'Auction sale broadcast'}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="k-video-modal__stage">
                  {claim.source.video?.imageUrl && (
                    <img
                      className="k-video-modal__hero"
                      src={claim.source.video.imageUrl}
                      alt={claim.source.video?.title || sourceName}
                    />
                  )}
                  <div className="k-video-modal__overlay">
                    {logoUrl && <img className="k-video-modal__stage-logo" src={logoUrl} alt={sourceName} />}
                    <Text role="label">
                      {[lotLine || sourceName, day(claim.observed_at)].filter(Boolean).join(' · ')}
                    </Text>
                    <Text role="figure">{priceDisplay}</Text>
                    <div className="k-video-modal__cta-row">
                      <a
                        className="k-video-modal__watch-btn"
                        href={directVideoUrl ?? youtubeSearchUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span aria-hidden="true">▶</span>
                        <span>{directVideoUrl ? 'Play Broadcast Video ↗' : 'Watch Sale Broadcast on YouTube ↗'}</span>
                      </a>
                      {url && (
                        <a
                          className="k-video-modal__lot-btn"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {lotNumber ? `Open Official Lot ${lotNumber} ↗` : 'Open Official Lot Record ↗'}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

type ClaimViewProps = {
  claim: Claim;
  label?: string;
  role?: Role;
  format?: (value: Claim['value']) => string;
  /** Rendered under the source, for a drill the caller owns (a stack link, a note). */
  extra?: React.ReactNode;
};

/** A fact on the page. Its value is a button into its evidence; it cannot render without a source. */
export function ClaimView({ claim, label, role = 'measure', format, extra }: ClaimViewProps) {
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLSpanElement>(null);
  const text = format ? format(claim.value) : String(claim.value);
  return <span ref={boundary} className="k-claim">
    {label && <Text role="label">{label}</Text>}
    <button type="button" className="k-claim__value" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Inspect the source of ${label ?? text}`} onClick={() => setOpen(value => !value)}>
      <Text role={role}>{text}</Text>
    </button>
    <HeaderPopover open={open} title="Source" width={300} align="right" dismissBoundaryRef={boundary} onClose={() => setOpen(false)}>
      <SourceView claim={claim} />
      {extra}
    </HeaderPopover>
  </span>;
}
