import React from 'react';
import { Link } from 'react-router-dom';
import { FaviconIcon } from '../common/FaviconIcon';

const escapeRegExp = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scraped listings sometimes end up with a "listing-ish" title shoved into model/name fields.
// Keep the card title tight: Year Make Model + Series/Trim, and strip platform boilerplate.
const cleanListingishTitle = (raw: string, year?: number | null, make?: string | null): string => {
  let s = String(raw || '').trim();
  if (!s) return s;

  // Drop the trailing site name (often after a pipe)
  s = s.split('|')[0].trim();

  // Remove common BaT boilerplate
  s = s.replace(/\bon\s+BaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBring\s+a\s+Trailer\b/gi, '').trim();
  s = s.replace(/\bending\b[\s\S]*$/i, '').trim();

  // Remove lot number parenthetical
  s = s.replace(/\(\s*Lot\s*#.*?\)\s*/gi, ' ').trim();

  // Remove leading mileage words like "42k-mile"
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\s+/i, '').trim();
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})+\s*[-\s]*mile\s+/i, '').trim();

  // Remove leading year (we render year separately)
  if (typeof year === 'number') {
    const yr = escapeRegExp(String(year));
    s = s.replace(new RegExp(`^\\s*${yr}\\s+`, 'i'), '').trim();
  } else {
    s = s.replace(/^\s*(19|20)\d{2}\s+/, '').trim();
  }

  // Remove leading make if it already exists (avoid "Porsche Porsche ...")
  if (make) {
    const mk = String(make).trim();
    if (mk) s = s.replace(new RegExp(`^\\s*${escapeRegExp(mk)}\\s+`, 'i'), '').trim();
  }

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Trim trailing separators from previous removals
  s = s.replace(/[-–—]\s*$/g, '').trim();
  return s;
};

const appendUnique = (arr: Array<string | number>, part: any) => {
  const p = String(part || '').trim();
  if (!p) return;
  const existing = arr.map(v => String(v).toLowerCase());
  const lower = p.toLowerCase();
  if (existing.some(e => e === lower || e.includes(lower) || lower.includes(e))) return;
  arr.push(p);
};

const isManualTransmission = (transmissionRaw: string): boolean => {
  const t = String(transmissionRaw || '').trim().toLowerCase();
  if (!t) return false;
  // Keep this conservative to avoid false positives like "6-speed automatic".
  return /\b(manual|m\/t|mt|stick|three[-\s]?pedal|3[-\s]?pedal)\b/i.test(t);
};
interface VehicleCardDenseProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    series?: string;
    trim?: string;
    vin?: string;
    mileage?: number;
    image_url?: string;
    image_variants?: {
      thumbnail?: string;
      medium?: string;
      large?: string;
    };
    primary_image_url?: string;
    transmission?: string;
    transmission_model?: string;
    sale_price?: number;
    current_value?: number;
    purchase_price?: number;
    asking_price?: number;
    condition_rating?: number;
    location?: string;
    updated_at?: string;
    created_at?: string;
    is_for_sale?: boolean;
    uploader_name?: string;
    event_count?: number;
    image_count?: number;
    view_count?: number;
    active_viewers?: number;
    is_streaming?: boolean;
    price_change?: number;
    roi_pct?: number;
    hype_reason?: string;
    all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
    tier?: string;
    tier_label?: string;
    profile_origin?: string | null; // 'bat_import', 'url_scraper', 'user_upload', etc.
    activity_7d?: number; // Recent activity (timeline events in last 7 days)
    receipt_count?: number; // Number of receipts (build documentation)
    ownership_verified?: boolean; // Has verified ownership records
    listing_start_date?: string; // When listing went live (for auctions, especially BAT)
    // Optional: precomputed display price (avoid per-card pricing RPCs on feed)
    display_price?: number;
    discovery_url?: string | null;
    discovery_source?: string | null;
  };
  viewMode?: 'list' | 'gallery' | 'grid';
  showSocial?: boolean;
  showPriceChange?: boolean;
  /** Controls whether price badges/overlays are shown on cards */
  showPriceOverlay?: boolean;
  /** Controls whether the semi-transparent detail overlay is shown on image */
  showDetailOverlay?: boolean;
  /** Home feed: compact vs info-dense card details */
  infoDense?: boolean;
  /** Optional URL to use for favicon/source stamp (listing source or org website). */
  sourceStampUrl?: string;
}

const VehicleCardDense: React.FC<VehicleCardDenseProps> = ({
  vehicle,
  viewMode = 'list',
  showSocial = false,
  showPriceChange = false,
  showPriceOverlay = true,
  showDetailOverlay = true,
  infoDense = false,
  sourceStampUrl
}) => {
  // Local CSS for badge animations. We scope keyframes to avoid collisions
  // (the design system defines multiple `@keyframes pulse` variations).
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = 'nuke-vehicle-card-dense-animations-v1';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes nuke-auction-pulse {
        0%, 100% { transform: scale(1); filter: saturate(1); }
        50% { transform: scale(1.05); filter: saturate(1.15); }
      }
      @keyframes nuke-badge-pop {
        0% { transform: scale(1); }
        35% { transform: scale(1.22); }
        65% { transform: scale(0.96); }
        100% { transform: scale(1); }
      }
      @keyframes nuke-badge-ticker {
        0%, 40% { transform: translateX(0%); }
        50%, 90% { transform: translateX(-50%); }
        100% { transform: translateX(0%); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // PERF: Never do per-card network calls on the feed.
  // Use the already-available vehicle fields (or precomputed display_price) to render pricing synchronously.
  const { displayPrice } = React.useMemo(() => {
    const v: any = vehicle as any;
    const priceValue =
      (typeof v.display_price === 'number' && Number.isFinite(v.display_price) && v.display_price > 0) ? v.display_price :
      (typeof v.sale_price === 'number' && v.sale_price > 0) ? v.sale_price :
      (typeof v.asking_price === 'number' && v.asking_price > 0) ? v.asking_price :
      (typeof v.current_value === 'number' && v.current_value > 0) ? v.current_value :
      (typeof v.purchase_price === 'number' && v.purchase_price > 0) ? v.purchase_price :
      null;

    const formatted = priceValue ? new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(priceValue) : '—';

    return { displayPrice: formatted };
  }, [vehicle]);

  const titleLabel = React.useMemo(() => {
    const v: any = vehicle as any;
    const year = typeof v.year === 'number' ? v.year : (typeof v.year === 'string' ? parseInt(v.year, 10) : undefined);
    const make = typeof v.make === 'string' ? v.make : undefined;
    const displayModel = v.normalized_model || v.model || '';
    const cleanedModel = cleanListingishTitle(String(displayModel || ''), year ?? null, make ?? null);

    const parts: Array<string | number> = [];
    if (year) parts.push(year);
    if (make) parts.push(make);
    appendUnique(parts, cleanedModel);
    appendUnique(parts, v.series);
    appendUnique(parts, v.trim);

    const base = parts.join(' ').trim() || 'Vehicle';
    const transmissionText = String(v.transmission_model || v.transmission || '').trim();
    const manualSignal = transmissionText && isManualTransmission(transmissionText) ? 'Manual' : '';
    return `${base}${manualSignal ? ` • ${manualSignal}` : ''}`;
  }, [vehicle]);

  const formatPrice = (price?: number) => {
    if (!price) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  // Calculate alphabet-based tier (F, E, D, C, B, A, S, SSS)
  // Tier is based on COMPLETENESS and QUALITY of information
  // Tiers increase as users provide more information - NOT locked in
  // S and SSS are ONLY manually assigned (never auto-calculated)
  const calculateVehicleTier = (vehicle: VehicleCardDenseProps['vehicle']): string => {
    // If tier is manually set to S or SSS, use it (never override manual assignments)
    if (vehicle.tier_label === 'S' || vehicle.tier_label === 'SSS') {
      return vehicle.tier_label;
    }
    if (vehicle.tier === 'S' || vehicle.tier === 'SSS') {
      return vehicle.tier;
    }
    
    // Completeness scoring factors (can be extended/modified as requirements evolve)
    const completenessFactors = {
      // Basic identification (required for any tier above F)
      hasVIN: vehicle.vin && vehicle.vin.length === 17,
      hasPrice: !!(vehicle.asking_price || vehicle.current_value || vehicle.sale_price),
      hasYearMakeModel: !!(vehicle.year && vehicle.make && vehicle.model),
      
      // Visual documentation
      imageCount: vehicle.all_images?.length || vehicle.image_count || 0,
      
      // Engagement & activity (shows user investment)
      eventCount: vehicle.event_count || 0,
      recentActivity: vehicle.activity_7d || 0,
      viewCount: vehicle.view_count || 0,
      
      // Documentation quality
      receiptCount: vehicle.receipt_count || 0,
      ownershipVerified: vehicle.ownership_verified || false,
      
      // Source quality
      isBATImport: vehicle.profile_origin === 'bat_import',
      isScraped: vehicle.profile_origin === 'url_scraper' || 
                 vehicle.profile_origin === 'craigslist_scrape' || 
                 vehicle.profile_origin === 'ksl_import',
      isDealer: vehicle.profile_origin === 'url_scraper' || vehicle.profile_origin === 'craigslist_scrape',
      isFlipper: (vehicle.profile_origin === 'url_scraper' || vehicle.profile_origin === 'craigslist_scrape') && vehicle.is_for_sale,
    };
    
    const { hasVIN, hasPrice, hasYearMakeModel, imageCount, eventCount, recentActivity, viewCount, 
            receiptCount, ownershipVerified, isBATImport, isScraped, isDealer, isFlipper } = completenessFactors;
    
    // Calculate completeness score (0-100)
    // This scoring system can be adjusted as requirements evolve
    let completenessScore = 0;
    
    // Basic identification (20 points)
    if (hasYearMakeModel) completenessScore += 5;
    if (hasVIN) completenessScore += 10;
    if (hasPrice) completenessScore += 5;
    
    // Visual documentation (30 points)
    if (imageCount >= 1) completenessScore += 5;
    if (imageCount >= 5) completenessScore += 10;
    if (imageCount >= 10) completenessScore += 10;
    if (imageCount >= 20) completenessScore += 5;
    
    // Engagement & activity (25 points)
    if (eventCount >= 1) completenessScore += 5;
    if (eventCount >= 5) completenessScore += 10;
    if (eventCount >= 10) completenessScore += 10;
    if (recentActivity >= 3) completenessScore += 5;
    if (viewCount >= 50) completenessScore += 5;
    
    // Documentation quality (15 points)
    if (receiptCount >= 1) completenessScore += 5;
    if (receiptCount >= 5) completenessScore += 5;
    if (receiptCount >= 10) completenessScore += 5;
    if (ownershipVerified) completenessScore += 5;
    
    // Source quality adjustments (penalties for dealers/flippers)
    if (isDealer || isFlipper) {
      // Dealers/flippers need to prove quality through engagement
      if (!hasVIN || !hasPrice) completenessScore -= 10;
      if (eventCount < 2 && viewCount < 50) completenessScore -= 5;
    }
    
    // Map completeness score to tier
    // These thresholds can be adjusted as the system evolves
    // Made stricter: C tier requires substantial data (not just basic info)
    if (completenessScore < 10) return 'F'; // No/minimal data
    if (completenessScore < 20) return 'E'; // Very basic (1 image, no VIN/price)
    if (completenessScore < 40) return 'D'; // Has potential, good bones (VIN OR price + some images)
    if (completenessScore < 60) return 'C'; // Vast majority - baseline (VIN + price + 10+ images OR engagement)
    if (completenessScore < 75) return 'B'; // Making an effort / cool BAT cars (engagement + documentation)
    if (completenessScore < 90) return 'A'; // Strong engagement and documentation (comprehensive)
    // 90+ would be S tier, but that's manually assigned only
    
    // Stricter fallback: Don't default to C for basic data
    // Nearly empty profiles should be F/E/D, not C
    if (imageCount === 0) return 'F';
    if (imageCount === 1) return 'E';
    if (imageCount < 5 && !hasVIN && !hasPrice) return 'E';
    if (imageCount < 10 && !hasVIN && !hasPrice && eventCount === 0) return 'D';
    // Only C if has substantial data
    if (hasVIN && hasPrice && imageCount >= 10) return 'C';
    if (hasVIN && hasPrice && imageCount >= 5 && eventCount >= 1) return 'C';
    // Otherwise D or lower
    if (hasVIN || hasPrice) return 'D';
    return 'E';
  };

  const normalizeTierLabel = (raw: any): string | null => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return null;
    // Normalize legacy labels like "Tier C" -> "C"
    const m = s.match(/^tier\s+([a-z]{1,3})$/i);
    if (m?.[1]) return m[1].toUpperCase();
    return s.toUpperCase();
  };

  // Simple image fallback - no complex logic
  const getImageUrl = () => {
    return vehicle.primary_image_url || vehicle.image_url || null;
  };

  const imageUrl = getImageUrl();
  const effectiveSourceStampUrl =
    sourceStampUrl ||
    (vehicle.discovery_url ? String(vehicle.discovery_url) : '') ||
    '';

  const isAuctionSource = React.useMemo(() => {
    const url = effectiveSourceStampUrl.toLowerCase();
    const origin = String((vehicle as any)?.profile_origin || '').toLowerCase();
    const source = String((vehicle as any)?.discovery_source || '').toLowerCase();
    if (origin.includes('bat')) return true;
    if (source.includes('auction')) return true;
    if (url.includes('bringatrailer.com') || url.includes('carsandbids.com') || url.includes('ebay.com')) return true;
    return false;
  }, [effectiveSourceStampUrl, vehicle]);

  const auctionProgress01 = React.useMemo(() => {
    if (!isAuctionSource) return 0;
    const startRaw = (vehicle as any)?.listing_start_date || vehicle.created_at;
    const start = startRaw ? new Date(startRaw).getTime() : NaN;
    if (!Number.isFinite(start)) return 0;
    const elapsedMs = Date.now() - start;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const p = elapsedMs / sevenDaysMs;
    return Math.max(0, Math.min(1, p));
  }, [isAuctionSource, vehicle.created_at, (vehicle as any)?.listing_start_date]);

  const badgePulseSeconds = React.useMemo(() => {
    // Slow -> fast as the auction progresses.
    // 0%: 6.0s, 100%: 1.2s
    if (!isAuctionSource) return null;
    const min = 1.2;
    const max = 6.0;
    return max - (max - min) * auctionProgress01;
  }, [isAuctionSource, auctionProgress01]);

  const auctionHighBidText = React.useMemo(() => {
    const v: any = vehicle as any;
    // Prefer canonical auction fields if present (newer schema)
    const highBid =
      (typeof v.sale_price === 'number' && Number.isFinite(v.sale_price) && v.sale_price > 0 ? v.sale_price : null) ??
      (typeof v.winning_bid === 'number' && Number.isFinite(v.winning_bid) && v.winning_bid > 0 ? v.winning_bid : null) ??
      (typeof v.high_bid === 'number' && Number.isFinite(v.high_bid) && v.high_bid > 0 ? v.high_bid : null);
    if (typeof highBid === 'number' && Number.isFinite(highBid) && highBid > 0) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(highBid);
    }
    const cents =
      (typeof v.current_high_bid_cents === 'number' ? v.current_high_bid_cents : null) ??
      (typeof v.latest_bid_cents === 'number' ? v.latest_bid_cents : null);
    if (typeof cents === 'number' && Number.isFinite(cents) && cents > 0) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
    }
    const bid = typeof v.latest_bid === 'number' ? v.latest_bid : null;
    if (typeof bid === 'number' && Number.isFinite(bid) && bid > 0) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(bid);
    }
    return null;
  }, [vehicle]);

  const auctionBidderDisplay = React.useMemo(() => {
    const v: any = vehicle as any;
    const masked = !!v.latest_bidder_masked;
    const raw =
      typeof v.latest_bidder_display_name === 'string' ? v.latest_bidder_display_name :
      typeof v.latest_bidder_name === 'string' ? v.latest_bidder_name :
      null;
    if (masked) return '***';
    if (raw && raw.trim()) return raw.trim();
    return null;
  }, [vehicle]);

  const badgeExplode = React.useMemo(() => {
    // Hook: set `bid_broke_record=true` on vehicle payload to trigger the pop.
    return !!(vehicle as any)?.bid_broke_record;
  }, [vehicle]);

  const badgeStyle = React.useMemo((): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      top: '6px',
      right: '6px',
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      color: 'white',
      padding: '4px 8px',
      borderRadius: '6px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      maxWidth: '85%',
      border: '1px solid rgba(255,255,255,0.18)',
      transformOrigin: 'center',
    };

    if (!isAuctionSource) return base;

    // Heat: subtle border shift (cold -> hot) as listing ages.
    const border =
      auctionProgress01 > 0.9 ? 'rgba(239,68,68,0.55)' :
      auctionProgress01 > 0.7 ? 'rgba(245,158,11,0.45)' :
      'rgba(59,130,246,0.35)';

    const pulse = badgePulseSeconds ? `nuke-auction-pulse ${badgePulseSeconds.toFixed(2)}s ease-in-out infinite` : '';
    const pop = badgeExplode ? 'nuke-badge-pop 650ms cubic-bezier(0.2, 1.2, 0.2, 1) 1' : '';
    const anim = [pop, pulse].filter(Boolean).join(', ');

    return {
      ...base,
      border,
      animation: anim || undefined,
    };
  }, [isAuctionSource, auctionProgress01, badgePulseSeconds, badgeExplode]);

  const badgeMainText = React.useMemo(() => {
    if (!isAuctionSource) return displayPrice;
    const v: any = vehicle as any;
    const outcome = String(v.auction_outcome || '').toLowerCase();
    const saleStatus = String(v.sale_status || '').toLowerCase();
    const isResult = ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(outcome) || ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(saleStatus);

    if (isResult) {
      if (outcome === 'sold' || saleStatus === 'sold' || (Number(v.sale_price || 0) > 0)) {
        return `SOLD ${auctionHighBidText || ''}`.trim();
      }
      if (outcome === 'reserve_not_met') {
        // Reserve not met still has a meaningful final high bid; don't show a misleading "BID" label.
        return `${auctionHighBidText ? `RESULT ${auctionHighBidText}` : 'RESERVE NOT MET'}`.trim();
      }
      return `${auctionHighBidText ? `ENDED ${auctionHighBidText}` : 'ENDED'}`.trim();
    }

    // Live auction: show the amount if we have it, otherwise a compact placeholder.
    return auctionHighBidText || 'BID';
  }, [isAuctionSource, displayPrice, vehicle, auctionHighBidText]);

  // LIST VIEW: Cursor-style - compact, dense, single row
  if (viewMode === 'list') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 2fr 1fr 1fr 80px 60px',
          gap: '12px',
          alignItems: 'center',
          padding: '6px 8px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '1px',
          fontSize: '8pt',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--grey-50)';
          e.currentTarget.style.borderColor = 'var(--text)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        {/* Compact thumbnail - 60px */}
        <div style={{
          width: '60px',
          height: '60px',
          flexShrink: 0,
          borderRadius: '0px',
          border: '1px solid var(--border)',
          background: (imageUrl || vehicle.primary_image_url) ? `url(${imageUrl || vehicle.primary_image_url}) center/cover` : 'var(--grey-200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}>
          {!(imageUrl || vehicle.primary_image_url) && 'CAR'}
        </div>
        
        {/* Vehicle - single line */}
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, fontSize: '9pt' }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
            {vehicle.uploader_name && `by ${vehicle.uploader_name}`}
          </span>
        </div>
        
        {/* Stats - compact */}
        <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
          {vehicle.mileage ? `${(vehicle.mileage / 1000).toFixed(0)}k mi` : '—'}
          {vehicle.condition_rating && ` • C:${vehicle.condition_rating}`}
          {vehicle.vin && ` • ${vehicle.vin.slice(-4)}`}
        </div>
        
        {/* Counts */}
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          {vehicle.image_count || 0} img • {vehicle.event_count || 0} evt
        </div>
        
        {/* Value */}
        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '9pt' }}>
          {displayPrice}
        </div>
        
        {/* Profit (if valid) */}
        <div style={{ textAlign: 'right', fontSize: '8pt', fontWeight: 600 }}>
          {vehicle.current_value && vehicle.purchase_price && 
           vehicle.purchase_price > 0 && 
           vehicle.purchase_price < vehicle.current_value * 5 ? (
            <span style={{ color: vehicle.current_value > vehicle.purchase_price ? '#10b981' : '#ef4444' }}>
              {vehicle.current_value > vehicle.purchase_price ? '+' : ''}
              {formatPrice(vehicle.current_value - vehicle.purchase_price)}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </div>
      </Link>
    );
  }

  // GALLERY VIEW: card with image and semi-transparent detail overlay
  if (viewMode === 'gallery') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'block',
          background: 'rgba(0, 0, 0, 0.9)',
          borderRadius: '8px',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '8px',
        }}
      >
        {/* Image preview with overlays */}
        <div
          style={{
            width: '100%',
            height: '220px',
            background: (imageUrl || vehicle.primary_image_url) ? `url(${imageUrl || vehicle.primary_image_url}) center/cover` : 'url(/n-zero.png) center/contain',
            backgroundSize: (imageUrl || vehicle.primary_image_url) ? 'cover' : 'contain',
            backgroundColor: '#000',
            position: 'relative',
          }}
        >
          {/* LIVE badge (kept separate) */}
          {vehicle.is_streaming && (
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                background: '#ef4444',
                color: 'white',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '7pt',
                fontWeight: 700,
                letterSpacing: '0.5px',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)',
              }}
            >
              LIVE
            </div>
          )}

          {/* Combined Source + Price/Bid badge */}
          {showPriceOverlay && badgeMainText !== '—' && (
            <div style={{ ...badgeStyle, top: '8px', right: '8px' }}>
              {effectiveSourceStampUrl ? <FaviconIcon url={effectiveSourceStampUrl} size={14} preserveAspectRatio={true} /> : null}
              {isAuctionSource && auctionBidderDisplay ? (
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                  <div
                    style={{
                      display: 'flex',
                      width: '200%',
                      animation: 'nuke-badge-ticker 6s ease-in-out infinite',
                    }}
                  >
                    <div style={{ width: '50%', paddingRight: '10px', fontSize: '9pt', fontWeight: 800 }}>
                      {badgeMainText}
                    </div>
                    <div style={{ width: '50%', paddingRight: '10px', fontSize: '8pt', fontWeight: 700, opacity: 0.95 }}>
                      {auctionBidderDisplay}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '9pt', fontWeight: 800 }}>
                  {badgeMainText}
                </div>
              )}
            </div>
          )}

          {/* Detail overlay along bottom of image */}
          {showDetailOverlay && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '10px 12px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.45))',
                color: '#fff',
              }}
            >
              {/* Vehicle name */}
              <div
                style={{
                  fontSize: '10pt',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  marginBottom: '4px',
                }}
              >
                {vehicle.year} {vehicle.make} {vehicle.model}
              </div>

              {/* Metadata row - clean by default; infoDense adds extras */}
              <div
                style={{
                  fontSize: '7pt',
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  opacity: 0.9,
                }}
              >
                {/* Vehicle Tier - alphabet-based (F, E, D, C, B, A, S, SSS) */}
                {(() => {
                  const tierLabel = normalizeTierLabel(vehicle.tier_label) || normalizeTierLabel(calculateVehicleTier(vehicle));
                  
                  // Color mapping for alphabet tiers
                  const getTierColor = (tier: string) => {
                    switch (tier) {
                      // User-defined core mapping: C=green, F=purple, S=red.
                      case 'SSS': return '#7c3aed'; // purple variant
                      case 'SS': return '#8b5cf6';
                      case 'S': return '#ef4444'; // red
                      case 'A': return '#f59e0b'; // warm
                      case 'B': return '#3b82f6'; // blue
                      case 'C': return '#10b981'; // green
                      case 'D': return '#6b7280'; // gray
                      case 'E': return '#9ca3af'; // light gray
                      case 'F': return '#a855f7'; // purple
                      default: return '#6b7280';
                    }
                  };
                  
                  if (tierLabel) {
                    return (
                      <span style={{ fontWeight: 700 }}>
                        <span style={{ color: getTierColor(tierLabel), fontWeight: 800 }}>
                          {tierLabel}
                        </span>{' '}
                        tier
                      </span>
                    );
                  }
                  return null;
                })()}

                {infoDense && vehicle.uploader_name && (
                  <span style={{ fontWeight: 600 }}>{vehicle.uploader_name}</span>
                )}

                {infoDense && vehicle.view_count !== undefined && vehicle.view_count > 0 && (
                  <span>{vehicle.view_count.toLocaleString()} {vehicle.view_count === 1 ? 'view' : 'views'}</span>
                )}

                {infoDense && vehicle.active_viewers > 0 && (
                  <span>{vehicle.active_viewers.toLocaleString()} watching</span>
                )}

                {infoDense && vehicle.condition_rating && (
                  <span
                      style={{
                        fontWeight: 700,
                        color:
                          vehicle.condition_rating >= 8
                            ? '#10b981'
                            : vehicle.condition_rating >= 6
                            ? '#f59e0b'
                            : '#ef4444',
                      }}
                    >
                      Grade{' '}
                      {vehicle.condition_rating >= 9
                        ? 'A+'
                        : vehicle.condition_rating >= 8
                        ? 'A'
                        : vehicle.condition_rating >= 7
                        ? 'B+'
                        : vehicle.condition_rating >= 6
                        ? 'B'
                        : vehicle.condition_rating >= 5
                        ? 'C'
                        : 'D'}
                  </span>
                )}

                {infoDense && vehicle.hype_reason && <span>{vehicle.hype_reason}</span>}
              </div>
            </div>
          )}

          {/* Active viewers - small pill above overlay */}
          {vehicle.active_viewers > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                background: 'rgba(0, 0, 0, 0.75)',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '12px',
                fontSize: '7pt',
                fontWeight: 600,
              }}
            >
              {vehicle.active_viewers} watching
            </div>
          )}
        </div>
      </Link>
    );
  }

  // GRID VIEW: Mobile-optimized card with horizontal swipeable image carousel
  // Shows multiple images in a grid that user can swipe through
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  const [touchStart, setTouchStart] = React.useState(0);
  
  // Use SAME simple logic as VehicleProfile - just use image_url directly
  // VehicleProfile uses: imageRecords.map((r: any) => r.image_url) (line 1151)
  const vehicleImages: string[] = [];

  const isLikelyImageUrl = (url: string) => {
    const u = String(url || '').trim();
    if (!u) return false;
    // Filter obvious non-image URLs that sometimes sneak in via metadata/link scraping.
    if (u.includes('linkedin.com/shareArticle')) return false;
    if (u.includes('shareArticle?mini=true')) return false;
    // Accept common image extensions.
    if (/\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(u)) return true;
    // Accept Supabase public storage objects (often no extension).
    if (u.includes('/storage/v1/object/public/')) return true;
    // Accept CDN-style image endpoints with width/quality params.
    if (/(image|img|thumb|thumbnail|media)/i.test(u) && /^https?:\/\//i.test(u)) return true;
    return false;
  };
  
  // Use all_images array (which now contains image_url directly)
  if (vehicle.all_images && vehicle.all_images.length > 0) {
    const urls = vehicle.all_images.map(img => img.url).filter((u) => !!u && isLikelyImageUrl(String(u)));
    vehicleImages.push(...urls);
  }
  
  // Fallback to primary_image_url (which is set using large_url || image_url like VehicleProfile)
  if (vehicle.primary_image_url && isLikelyImageUrl(vehicle.primary_image_url) && !vehicleImages.includes(vehicle.primary_image_url)) {
    vehicleImages.push(vehicle.primary_image_url);
  }
  
  // Fallback to image_url
  if (vehicle.image_url && isLikelyImageUrl(vehicle.image_url) && !vehicleImages.includes(vehicle.image_url)) {
    vehicleImages.push(vehicle.image_url);
  }
  
  // Get current image URL
  let currentImageUrl = vehicleImages[currentImageIndex] || vehicleImages[0] || null;
  
  // CRITICAL FIX: If still no URL, check imageUrl from getImageUrl() as last resort
  if (!currentImageUrl) {
    currentImageUrl = imageUrl && isLikelyImageUrl(imageUrl) ? imageUrl : null;
  }

  const hasValidImage = !!(currentImageUrl && isLikelyImageUrl(currentImageUrl));
  
  
  
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    
    if (Math.abs(diff) > 50) {
      e.preventDefault();
      e.stopPropagation();
      
      if (diff > 0 && currentImageIndex < vehicleImages.length - 1) {
        setCurrentImageIndex(currentImageIndex + 1);
      } else if (diff < 0 && currentImageIndex > 0) {
        setCurrentImageIndex(currentImageIndex - 1);
      }
    }
  };
  
  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: 'transparent',
        border: 'none',
        borderRadius: '0',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
        cursor: 'pointer',
        position: 'relative'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.85';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
    >
      {/* Horizontal swipeable image grid (1:1 ratio) */}
      <div 
        style={{
          width: '100%',
          paddingBottom: '100%',
          background: hasValidImage ? `url(${currentImageUrl}) center/cover no-repeat` : 'transparent',
          backgroundSize: hasValidImage ? 'cover' : 'auto',
          backgroundColor: 'transparent',
          position: 'relative',
        }}
        onLoad={() => {
}}
        onError={() => {
}}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* LIVE badge (kept separate) */}
        {vehicle.is_streaming && (
          <div style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            background: '#ef4444',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '3px',
            fontSize: '7pt',
            fontWeight: 700,
            letterSpacing: '0.5px',
            animation: 'pulse 2s ease-in-out infinite'
          }}>
            LIVE
          </div>
        )}

        {/* Combined Source + Price/Bid badge */}
        {showPriceOverlay && badgeMainText !== '—' && (
          <div style={badgeStyle}>
            {effectiveSourceStampUrl ? <FaviconIcon url={effectiveSourceStampUrl} size={14} preserveAspectRatio={true} /> : null}
            {isAuctionSource && auctionBidderDisplay ? (
              <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                <div style={{ display: 'flex', width: '200%', animation: 'nuke-badge-ticker 6s ease-in-out infinite' }}>
                  <div style={{ width: '50%', paddingRight: '10px', fontSize: '8pt', fontWeight: 800 }}>
                    {badgeMainText}
                  </div>
                  <div style={{ width: '50%', paddingRight: '10px', fontSize: '8pt', fontWeight: 700, opacity: 0.95 }}>
                    {auctionBidderDisplay}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '8pt', fontWeight: 800 }}>
                {badgeMainText}
              </div>
            )}
          </div>
        )}
        
      </div>
      
      {/* Detail overlay on image instead of separate panel */}
      {showDetailOverlay && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4))',
            color: '#fff',
          }}
        >
          {/* Vehicle name */}
          <div
            style={{
              fontSize: '9pt',
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: '4px',
            }}
          >
            {titleLabel}
          </div>

          {/* Metadata row - clean by default; infoDense adds extras */}
          <div
            style={{
              fontSize: '7pt',
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              alignItems: 'center',
              opacity: 0.9,
            }}
          >
            {/* Vehicle Tier - alphabet-based (F, E, D, C, B, A, S, SSS) */}
            {(() => {
              const tierLabel = normalizeTierLabel(vehicle.tier_label) || normalizeTierLabel(calculateVehicleTier(vehicle));
              
              // Color mapping for alphabet tiers
              const getTierColor = (tier: string) => {
                switch (tier) {
                  case 'SSS': return '#7c3aed';
                  case 'SS': return '#8b5cf6';
                  case 'S': return '#ef4444';
                  case 'A': return '#f59e0b';
                  case 'B': return '#3b82f6';
                  case 'C': return '#10b981';
                  case 'D': return '#6b7280';
                  case 'E': return '#9ca3af';
                  case 'F': return '#a855f7';
                  default: return '#6b7280';
                }
              };
              
              if (tierLabel) {
                return (
                  <span style={{ fontWeight: 700 }}>
                    <span style={{ color: getTierColor(tierLabel), fontWeight: 800 }}>{tierLabel}</span> tier
                  </span>
                );
              }
              return null;
            })()}

            {infoDense && vehicle.uploader_name && <span style={{ fontWeight: 500 }}>{vehicle.uploader_name}</span>}

            {infoDense && vehicle.view_count !== undefined && vehicle.view_count > 0 && (
              <span>{vehicle.view_count.toLocaleString()} {vehicle.view_count === 1 ? 'view' : 'views'}</span>
            )}

            {infoDense && vehicle.active_viewers > 0 && (
              <span>{vehicle.active_viewers.toLocaleString()} watching</span>
            )}

            {infoDense && vehicle.condition_rating && (
              <span
                style={{
                  fontWeight: 700,
                  color:
                    vehicle.condition_rating >= 8
                      ? '#10b981'
                      : vehicle.condition_rating >= 6
                      ? '#f59e0b'
                      : '#ef4444',
                }}
              >
                {vehicle.condition_rating >= 9
                  ? 'A+'
                  : vehicle.condition_rating >= 8
                  ? 'A'
                  : vehicle.condition_rating >= 7
                  ? 'B+'
                  : vehicle.condition_rating >= 6
                  ? 'B'
                  : vehicle.condition_rating >= 5
                  ? 'C'
                  : 'D'}
              </span>
            )}
          </div>
        </div>
      )}
    </Link>
  );
};

export default VehicleCardDense;

