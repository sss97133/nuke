import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVehicleProfile } from './VehicleProfileContext';
import { PopupStackContext } from '../../components/popups/PopupStack';
import { useAuctionCommentStats } from '../../hooks/useAuctionComments';
import { CommentsPopup } from '../../components/popups/CommentsPopup';
import { BidsPopup } from '../../components/popups/BidsPopup';
import { WatchersPopup } from '../../components/popups/WatchersPopup';
import {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveVettedIdentityMarks,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
} from '../familyFacetsAndEmblems';

export function resolveVehicleMarketFamily(
  vehicle: Record<string, any> | null | undefined,
  markFamily?: string | null,
): string | null {
  if (markFamily && markFamily.trim()) {
    const trimmedMarkFamily = markFamily.trim();
    return isPickupFamilyLabel(trimmedMarkFamily) ? 'Pickup' : trimmedMarkFamily;
  }
  if (!vehicle || typeof vehicle !== 'object') return null;

  const explicitFamily =
    (typeof vehicle.family === 'string' && vehicle.family.trim()) ||
    (typeof vehicle.model_family === 'string' && vehicle.model_family.trim()) ||
    null;
  if (explicitFamily) {
    return isPickupFamilyLabel(explicitFamily) ? 'Pickup' : explicitFamily;
  }

  const rawModel =
    (typeof vehicle.normalized_model === 'string' && vehicle.normalized_model.trim()) ||
    (typeof vehicle.model === 'string' && vehicle.model.trim()) ||
    '';
  const rawSeries = typeof vehicle.series === 'string' ? vehicle.series.trim() : '';

  if (isPickupFamilyLabel(rawModel) || isPickupFamilyLabel(rawSeries)) {
    return 'Pickup';
  }

  const composite = [
    vehicle.normalized_model,
    vehicle.model,
    vehicle.series,
    vehicle.trim,
    vehicle.listing_title,
    vehicle.title,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ');
  const makeLower = typeof vehicle.make === 'string' ? vehicle.make.trim().toLowerCase() : '';

  if (/\b(?:K\/?5\s+Blazer|Blazer)\b/i.test(composite)) return 'Blazer';
  if (/\b(?:K\/?5\s+Jimmy|Jimmy)\b/i.test(composite)) return 'Jimmy';
  if (/\bSuburban\b/i.test(composite)) return 'Suburban';

  if (
    /\b(?:C[-\s]?10|K[-\s]?10|C[-\s]?20|K[-\s]?20|C[-\s]?30|K[-\s]?30|R[-\s]?10|V[-\s]?10|3100|3600|3800|Apache|Cameo|C[-\s]?1500|K[-\s]?1500|C[-\s]?2500|K[-\s]?2500|C[-\s]?3500|K[-\s]?3500|454\s*SS|S[-\s]?10|Syclone|Sonoma|S[-\s]?15|Caballero|F[-\s]?100|F[-\s]?150|F[-\s]?250|F[-\s]?350|F[-\s]?450|F[-\s]?[123]|Power\s+Wagon|WM[-\s]?300|D[-\s]?100|D[-\s]?150|W[-\s]?100|W[-\s]?150|W[-\s]?200|Pickup)\b/i.test(
      composite,
    ) ||
    ((makeLower === 'chevrolet' || makeLower === 'gmc') &&
      /\b(?:Silverado|Sierra|Cheyenne|Scottsdale|Custom\s+Deluxe|Stepside|Fleetside)\b/i.test(composite))
  ) {
    return 'Pickup';
  }

  if (/\bBel\s+Air\b/i.test(composite)) return 'Bel Air';
  if (/\bLand\s+Cruiser\b|\b(?:FJ|BJ|HJ|FZJ|UZJ|URJ)[-\s]?(?:4[02357]|55|6[02]|80|100|200)\b/i.test(composite)) {
    return 'Land Cruiser';
  }
  if (/\bCorvette\b|\bSting\s*Ray\b/i.test(composite)) return 'Corvette';
  if (/\bMustang\b|\bShelby\s+GT(?:350|500)\w*\b|\bBoss\s+(?:302|429)\b/i.test(composite)) return 'Mustang';
  if (/\bCamaro\b/i.test(composite)) return 'Camaro';
  if (/\bChevelle\b/i.test(composite)) return 'Chevelle';
  if (/\bBronco\b/i.test(composite)) return 'Bronco';
  if (makeLower === 'porsche' && /\b(?:911|930|964|993|996|997|991|992|Carrera\s+RS)\b/i.test(composite)) return '911';
  if (makeLower === 'porsche' && /\b356[ABC]?\b/i.test(composite)) return '356';
  if (makeLower.startsWith('mercedes') && /\b(?:190|230|250|280|300|380|450|500|560)\s*SL\b|\bSL\b/i.test(composite)) {
    return 'SL';
  }
  if (makeLower === 'bmw' && /\b(?:E30|E36|E46|E90|E92|E93|F80|G80)?\s*M3\b/i.test(composite)) return 'M3';
  if (makeLower === 'bmw' && /\b(?:E28|E34|E39|E60|F10|F90)?\s*M5\b/i.test(composite)) return 'M5';
  if (makeLower === 'bmw' && /\b2002(?:tii|turbo)?\b/i.test(composite)) return '2002';
  if (/\bE-Type\b|\bXKE\b/i.test(composite)) return 'E-Type';
  if (/\bRoad\s+Runner\b/i.test(composite)) return 'Road Runner';
  if (/\bCharger\b/i.test(composite)) return 'Charger';
  if (/\bChallenger\b/i.test(composite)) return 'Challenger';
  if (/\bGTO\b/i.test(composite)) return 'GTO';
  if (/\bFirebird\b|\bTrans\s+Am\b/i.test(composite)) return 'Firebird';

  if (rawModel) {
    return rawModel.split(' · ')[0].trim();
  }
  return null;
}

export function buildFacetDrilldownUrl(params: {
  make: string;
  family: string;
  axis: Exclude<FamilyFacetAxis, 'raw'>;
  facet: string;
}): string {
  const sp = new URLSearchParams();
  sp.set('make', params.make.trim());
  sp.set('family', params.family.trim());
  sp.set('axis', params.axis);
  sp.set('facet', params.facet.trim());
  return `/?${sp.toString()}`;
}

export function resolveIdentityMarkFacetTarget(
  mark: VehicleIdentityMark,
  vehicleFacets: VehicleFacetClassification,
  make: string,
  family: string,
  year?: number | null,
): { axis: Exclude<FamilyFacetAxis, 'raw'>; facet: string; family: string } {
  const targetFamily = mark.family
    ? isPickupFamilyLabel(mark.family)
      ? 'Pickup'
      : mark.family
    : family;

  if (mark.trimPackage) {
    const cls = classifyVehicleFacets(make, targetFamily, mark.trimPackage, year ?? mark.yearStart);
    return {
      axis: 'trim',
      facet: cls.trim ?? mark.trimPackage,
      family: targetFamily,
    };
  }

  if (mark.bodyStyle) {
    const canonicalBody =
      vehicleFacets.body && vehicleFacets.body.toLowerCase().includes(mark.bodyStyle.toLowerCase())
        ? vehicleFacets.body
        : classifyVehicleFacets(make, targetFamily, mark.bodyStyle, year ?? mark.yearStart).body ?? mark.bodyStyle;
    return {
      axis: 'body',
      facet: canonicalBody,
      family: targetFamily,
    };
  }

  if (mark.seriesCode) {
    const matchesVehicleSeries =
      vehicleFacets.series &&
      (vehicleFacets.series.toLowerCase().includes(mark.seriesCode.toLowerCase()) ||
        (mark.id === 'mustang-boss-69-70' && vehicleFacets.series.toLowerCase().startsWith('boss')));
    const canonicalSeries = matchesVehicleSeries
      ? vehicleFacets.series!
      : classifyVehicleFacets(make, targetFamily, mark.seriesCode, year ?? mark.yearStart).series ?? mark.seriesCode;
    return {
      axis: 'series',
      facet: canonicalSeries,
      family: targetFamily,
    };
  }

  if (mark.id === 'corvette-c2-sting-ray-63-67') {
    return { axis: 'series', facet: 'Sting Ray (C2)', family: 'Corvette' };
  }
  if (mark.id === 'corvette-c3-stingray-68-82') {
    return { axis: 'series', facet: 'Stingray', family: 'Corvette' };
  }
  if (mark.id === 'chevy-bel-air-55-57') {
    return { axis: 'series', facet: vehicleFacets.series ?? 'Bel Air (2400 Series)', family: 'Bel Air' };
  }

  if (vehicleFacets.series) {
    return { axis: 'series', facet: vehicleFacets.series, family: targetFamily };
  }
  if (vehicleFacets.trim) {
    return { axis: 'trim', facet: vehicleFacets.trim, family: targetFamily };
  }
  if (vehicleFacets.body) {
    return { axis: 'body', facet: vehicleFacets.body, family: targetFamily };
  }

  return { axis: 'series', facet: mark.displayLabel, family: targetFamily };
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '--';
  return `$${n.toLocaleString()}`;
}

/**
 * Supplementary badge bar -- shows engagement metrics that VehicleHeader doesn't display.
 * VehicleHeader already renders: SOLD, source, price, seller, buyer, location, mileage, time.
 * This bar adds: BIDS, COMMENTS, WATCHERS.
 *
 * Engagement badges open full-data popups.
 */
const VehicleBadgeBar: React.FC = () => {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const navigate = useNavigate();
  const popupCtx = useContext(PopupStackContext);
  const v = vehicle as any;

  // Engagement stats — prefer live count from auction_comments over stale snapshots
  const bidCount = auctionPulse?.bid_count || v.bid_count;
  const { data: commentStats } = useAuctionCommentStats(v?.id);
  const commentCount = commentStats?.commentCount || auctionPulse?.comment_count || v.comment_count;
  const watcherCount = auctionPulse?.watcher_count || v.bat_watchers;
  const highBid = v.high_bid || auctionPulse?.current_bid;
  const listingUrl = (auctionPulse as any)?.listing_url || v.bat_auction_url || v.discovery_url || null;

  const { identityMarks, facets, marketFamily } = useMemo(() => {
    if (!v?.make) return { identityMarks: [], facets: { series: null, trim: null, body: null }, marketFamily: null };
    const descriptor = [
      v.model,
      v.series,
      v.trim,
      v.body_style,
      v.listing_title,
      v.title,
    ]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join(' · ');
    const yr = typeof v.year === 'number' ? v.year : null;
    const resolvedFamily = resolveVehicleMarketFamily(v);
    const f = classifyVehicleFacets(v.make, resolvedFamily || v.normalized_model || v.model, descriptor, yr);
    const marks = resolveVettedIdentityMarks({
      make: v.make,
      familyLabel: resolvedFamily || v.normalized_model || v.model,
      model: descriptor,
      year: yr,
    });
    return { identityMarks: marks.slice(0, 4), facets: f, marketFamily: resolvedFamily };
  }, [v?.make, v?.model, v?.normalized_model, v?.family, v?.model_family, v?.series, v?.trim, v?.body_style, v?.listing_title, v?.title, v?.year]);

  const hasBadges = (bidCount != null && bidCount > 0) ||
    (commentCount != null && commentCount > 0) ||
    (watcherCount != null && watcherCount > 0) ||
    identityMarks.length > 0 ||
    !!(facets.series || facets.trim || facets.body);

  if (!hasBadges) return null;

  const handleDrilldownClick = (href: string, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      if ('metaKey' in e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) {
        return;
      }
      e.preventDefault();
    }
    navigate(href);
  };

  const handleBidsClick = () => {
    if (!popupCtx || !v.id) return;
    popupCtx.push(
      <BidsPopup vehicleId={v.id} bidCount={bidCount} highBid={highBid} listingUrl={listingUrl} />,
      `BID HISTORY (${bidCount})`,
      420,
    );
  };

  const handleCommentsClick = () => {
    if (!popupCtx || !v.id) return;
    popupCtx.push(
      <CommentsPopup vehicleId={v.id} expectedCount={commentCount} />,
      `COMMENTS (${commentCount})`,
      460,
    );
  };

  const handleWatchersClick = () => {
    if (!popupCtx || !v.id) return;
    popupCtx.push(
      <WatchersPopup
        vehicleId={v.id}
        watcherCount={watcherCount}
        viewCount={v.bat_views || (auctionPulse as any)?.view_count || null}
        make={v.make || null}
        model={v.model || null}
      />,
      `WATCHERS (${watcherCount?.toLocaleString()})`,
      380,
      false,
    );
  };

  const badgeStyle: React.CSSProperties = {
    cursor: 'pointer',
    transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  };

  return (
    <div className="vehicle-sub__badges" data-testid="vehicle-badge-bar" style={{ padding: '4px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', borderBottom: '1px solid var(--vp-ghost, #e0e0e0)' }}>
      <style>{`
        .vp-identity-mark {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 6px;
          border: 1px solid var(--border, #333);
          background: var(--bg, #0d0d0d);
          color: inherit;
          text-decoration: none;
          cursor: pointer;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          font-family: 'Courier New', monospace;
          transition: border-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .vp-identity-mark:hover {
          border-color: var(--text, #fff);
        }
        .vp-identity-mark__svg {
          display: inline-flex;
          align-items: center;
          height: 15px;
          width: 54px;
        }
        .vp-facet-chip {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: inherit;
          text-decoration: none;
          cursor: pointer;
          transition: border-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .vp-facet-chip:hover {
          border-color: var(--text, #fff);
        }
      `}</style>
      {/* VETTED ERA & TRIM EMBLEMS */}
      {identityMarks.map((mark) => {
        const yr = typeof v?.year === 'number' ? v.year : null;
        const target = resolveIdentityMarkFacetTarget(
          mark,
          facets,
          v?.make || mark.brand,
          marketFamily || mark.family || v?.normalized_model || v?.model || '',
          yr,
        );
        const href = buildFacetDrilldownUrl({
          make: v?.make || mark.brand,
          family: target.family,
          axis: target.axis,
          facet: target.facet,
        });
        return (
          <a
            key={mark.id}
            href={href}
            className="vp-identity-mark"
            data-testid={`vehicle-identity-mark-${mark.id}`}
            data-facet-axis={target.axis}
            data-facet-value={target.facet}
            title={`${mark.displayLabel} — ${mark.subLabel}${mark.rpoCode ? ` (${mark.rpoCode})` : ''} · Explore ${v?.make || mark.brand} ${target.family} (${target.facet}) on Market`}
            onClick={(e) => handleDrilldownClick(href, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleDrilldownClick(href, e);
              }
            }}
          >
            <span
              aria-hidden="true"
              className="vp-identity-mark__svg"
              dangerouslySetInnerHTML={{ __html: mark.svgMarkup }}
            />
            <span>{mark.displayLabel}</span>
          </a>
        );
      })}

      {/* ORTHOGONAL SERIES / TRIM / BODY STYLE FACET CHIPS */}
      {facets.series && v?.make && marketFamily && (() => {
        const href = buildFacetDrilldownUrl({
          make: v.make,
          family: marketFamily,
          axis: 'series',
          facet: facets.series,
        });
        return (
          <a
            href={href}
            className="badge vp-facet-chip"
            data-testid="vehicle-facet-series"
            data-facet-axis="series"
            data-facet-value={facets.series}
            title={`Explore ${v.make} ${marketFamily} · ${facets.series} on Market`}
            onClick={(e) => handleDrilldownClick(href, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleDrilldownClick(href, e);
              }
            }}
          >
            SERIES · {facets.series}
          </a>
        );
      })()}
      {facets.trim && v?.make && marketFamily && (() => {
        const href = buildFacetDrilldownUrl({
          make: v.make,
          family: marketFamily,
          axis: 'trim',
          facet: facets.trim,
        });
        return (
          <a
            href={href}
            className="badge vp-facet-chip"
            data-testid="vehicle-facet-trim"
            data-facet-axis="trim"
            data-facet-value={facets.trim}
            title={`Explore ${v.make} ${marketFamily} · ${facets.trim} on Market`}
            onClick={(e) => handleDrilldownClick(href, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleDrilldownClick(href, e);
              }
            }}
          >
            TRIM · {facets.trim}
          </a>
        );
      })()}
      {facets.body && v?.make && marketFamily && (() => {
        const href = buildFacetDrilldownUrl({
          make: v.make,
          family: marketFamily,
          axis: 'body',
          facet: facets.body,
        });
        return (
          <a
            href={href}
            className="badge vp-facet-chip"
            data-testid="vehicle-facet-body"
            data-facet-axis="body"
            data-facet-value={facets.body}
            title={`Explore ${v.make} ${marketFamily} · ${facets.body} on Market`}
            onClick={(e) => handleDrilldownClick(href, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleDrilldownClick(href, e);
              }
            }}
          >
            BODY · {facets.body}
          </a>
        );
      })()}

      {/* BIDS */}
      {bidCount != null && bidCount > 0 && (
        <span
          className="badge badge--bids"
          role="button"
          tabIndex={0}
          style={badgeStyle}
          onClick={handleBidsClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBidsClick(); } }}
        >
          BIDS {bidCount}
          <span className="badge__tooltip">
            {bidCount} total bids<br />
            {highBid && <>High bid: {formatPrice(highBid)}<br /></>}
            Click to view bid history
          </span>
        </span>
      )}

      {/* COMMENTS */}
      {commentCount != null && commentCount > 0 && (
        <span
          className="badge badge--comments"
          role="button"
          tabIndex={0}
          style={badgeStyle}
          onClick={handleCommentsClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCommentsClick(); } }}
        >
          COMMENTS {commentCount}
          <span className="badge__tooltip">
            {commentCount} total comments<br />
            Click to read comments
          </span>
        </span>
      )}

      {/* WATCHERS */}
      {watcherCount != null && watcherCount > 0 && (
        <span
          className="badge badge--watchers"
          role="button"
          tabIndex={0}
          style={badgeStyle}
          onClick={handleWatchersClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWatchersClick(); } }}
        >
          WATCHERS {watcherCount}
          <span className="badge__tooltip">
            {watcherCount} watchers<br />
            {v.bat_views && <>{Number(v.bat_views).toLocaleString()} page views<br /></>}
            Click to see watcher analysis
          </span>
        </span>
      )}


    </div>
  );
};

export default VehicleBadgeBar;
