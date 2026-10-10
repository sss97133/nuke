import React, { useRef, useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { OdometerBadge } from '../../components/vehicle/OdometerBadge';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { profileFacetValue, type ProfileFacet } from '../stacks/bidPopulationReader';
import { VehiclePerformance } from '../stacks/VehicleCohort';

function toTitleCase(s: string): string {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMileage(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
  if (isNaN(n)) return String(value);
  return n.toLocaleString('en-US') + ' mi';
}

function resolveLocation(vehicle: any): string | null {
  const city  = vehicle?.city  ?? vehicle?.seller_city  ?? vehicle?.sellerCity ?? vehicle?.location;
  const state = vehicle?.state ?? vehicle?.seller_state ?? vehicle?.sellerState;
  const zip   = vehicle?.zip   ?? vehicle?.seller_zip   ?? vehicle?.sellerZip;
  const parts: string[] = [];
  if (city) parts.push(String(city));
  if (state) parts.push(String(state));
  if (zip) parts.push(String(zip));
  return parts.length > 0 ? parts.join(', ') : null;
}

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

const TOKEN = {
  fontBody: 'Arial, sans-serif' as const,
  ink:      'var(--text, var(--ink, #1a1a1a))',
  surface:  'var(--surface, #ffffff)',
  borderPrimary: '2px solid var(--border, #1a1a1a)',
};

// ---------------------------------------------------------------------------
// VehicleSubHeader — dimension badges only (year, make, model, mileage,
// body style, transmission, drivetrain, location).
// Auction/engagement data (price, bids, comments, watchers, status) is
// shown exclusively in the ExternalAuctionLiveBanner below.
// ---------------------------------------------------------------------------

const VehicleSubHeader: React.FC = () => {
  const { vehicle } = useVehicleProfile();
  const [activeFacet, setActiveFacet] = useState<ProfileFacet | null>(null);
  const triggerBoundary = useRef<HTMLDivElement>(null);
  React.useEffect(() => setActiveFacet(null), [vehicle?.id]);
  if (!vehicle) return null;

  const year         = vehicle.year ?? (vehicle as any).model_year ?? '';
  const mileage      = vehicle.mileage ?? (vehicle as any).odometer ?? (vehicle as any).miles;
  const bodyStyle    = (vehicle as any).canonical_body_style ?? (vehicle as any).body_style ?? (vehicle as any).bodyStyle ?? '';
  const transmission = (vehicle as any).transmission ?? '';
  const drivetrain   = (vehicle as any).drivetrain ?? (vehicle as any).drive_type ?? '';
  const engineSize   = (vehicle as any).engine_size ?? (vehicle as any).displacement ?? '';
  const location     = profileFacetValue(vehicle as any, 'location') ?? resolveLocation(vehicle);
  const facets = ([
    { dimension: 'body_style', value: String(bodyStyle), label: toTitleCase(String(bodyStyle)) },
    { dimension: 'engine', value: String(engineSize), label: String(engineSize) },
    { dimension: 'transmission', value: String(transmission), label: toTitleCase(String(transmission)) },
    { dimension: 'drivetrain', value: String(drivetrain), label: String(drivetrain) },
    { dimension: 'location', value: location ?? '', label: location ?? '' },
  ] satisfies { dimension: ProfileFacet; value: string; label: string }[]).filter(facet => facet.value.trim());
  const selectedFacet = facets.find(facet => facet.dimension === activeFacet);

  // --- Styles ---
  const containerStyle: React.CSSProperties = {
    height:          36,
    backgroundColor: TOKEN.surface,
    borderBottom:    TOKEN.borderPrimary,
    display:         'flex',
    alignItems:      'center',
    padding:         '0 12px',
    gap:             10,
    overflow:        'visible',
    fontFamily:      TOKEN.fontBody,
    position:        'relative',
  };

  const leftStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    flexShrink: 0,
    minWidth:   0,
  };

  const dividerStyle: React.CSSProperties = {
    width:       1,
    height:      16,
    background:  'var(--border, var(--border-subtle, #dddddd))',
    flexShrink:  0,
  };

  const badgesWrapStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    flex:       1,
    overflowX:  'auto',
    overflowY:  'visible',
    minWidth:   0,
    scrollbarWidth: 'none',
    msOverflowStyle: 'none' as any,
  };

  return (
    <div ref={triggerBoundary} className="vp-sub-header" style={containerStyle}>
      {/* Configuration doors remain in place while the stack opens below the strip. */}
      <div className="vp-sub-header__left" style={leftStyle}>
        {mileage != null && mileage !== '' && (
          <OdometerBadge
            mileage={typeof mileage === 'number' ? mileage : parseFloat(String(mileage).replace(/[^0-9.]/g, ''))}
            year={year ? Number(year) : null}
          />
        )}
      </div>

      {/* Divider (only if there's something to the left of it) */}
      {mileage != null && mileage !== '' && <div style={dividerStyle} />}

      {/* Dimension badges — every badge is clickable per design spec */}
      <div className="vp-sub-header__badges" style={badgesWrapStyle}>
        {facets.map(facet => <button key={facet.dimension} type="button"
          className="vp-facet-button" aria-label={`${facet.label} performance stack`}
          aria-haspopup="dialog" aria-expanded={activeFacet === facet.dimension}
          onClick={() => setActiveFacet(current => current === facet.dimension ? null : facet.dimension)}>
          {facet.label}<span aria-hidden="true"> ▾</span>
        </button>)}
      </div>
      {selectedFacet && <HeaderPopover open onClose={() => setActiveFacet(null)}
        title={selectedFacet.label} width={360} dismissBoundaryRef={triggerBoundary}>
        <VehiclePerformance key={`${vehicle.id}:${selectedFacet.dimension}`} vehicleId={vehicle.id} facet={selectedFacet} />
      </HeaderPopover>}
    </div>
  );
};

export default VehicleSubHeader;
