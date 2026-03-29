import React from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { BadgePortal } from '../../components/badges/BadgePortal';
import { OdometerBadge } from '../../components/vehicle/OdometerBadge';

/** Capitalize first letter of each word for display (e.g. "K5 JIMMY" -> "K5 Jimmy") */
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
  fontBody: 'Arial, Helvetica, sans-serif' as const,
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
  if (!vehicle) return null;

  const year      = vehicle.year   ?? vehicle.model_year   ?? '';
  const make      = vehicle.make   ?? vehicle.make_name    ?? '';
  const model     = vehicle.model  ?? vehicle.model_name   ?? '';
  const rawTrim   = vehicle.trim   ?? vehicle.trim_name    ?? '';
  // Suppress trim badge when it's already contained in the model string (e.g. "K2500 Sierra Classic" already includes "Sierra Classic")
  const trim      = rawTrim && model && String(model).toLowerCase().includes(String(rawTrim).toLowerCase()) ? '' : rawTrim;
  const titleParts = [year, make, model, rawTrim].filter(Boolean);
  const titleStr  = titleParts.map((p) => (typeof p === 'number' ? String(p) : toTitleCase(String(p)))).join(' ');

  const mileage      = vehicle.mileage    ?? vehicle.odometer   ?? vehicle.miles;
  const bodyStyle    = (vehicle as any).body_style ?? (vehicle as any).bodyStyle ?? '';
  const transmission = (vehicle as any).transmission ?? '';
  const drivetrain   = (vehicle as any).drivetrain ?? (vehicle as any).drive_type ?? '';
  const engineSize   = (vehicle as any).engine_size ?? (vehicle as any).displacement ?? '';
  const location     = resolveLocation(vehicle);

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
  };

  const leftStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    flexShrink: 0,
    minWidth:   0,
  };

  const titleStyle: React.CSSProperties = {
    fontFamily:     TOKEN.fontBody,
    fontSize:       11,
    fontWeight:     700,
    textTransform:  'uppercase',
    letterSpacing:  '0.04em',
    color:          TOKEN.ink,
    whiteSpace:     'nowrap',
    overflow:       'hidden',
    textOverflow:   'ellipsis',
    maxWidth:       280,
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
    <div className="vp-sub-header" style={containerStyle}>
      {/* Left: YMM (+ trim) as BadgePortal -- click expands cluster inline */}
      <div className="vp-sub-header__left" style={leftStyle}>
        {titleStr ? (
          <>
            {year && (
              <BadgePortal
                dimension="year"
                value={year}
                label={String(year)}
                variant="source"
              />
            )}
            {make && (
              <BadgePortal
                dimension="make"
                value={make}
                label={toTitleCase(String(make))}
                variant="source"
              />
            )}
            {model && (
              <BadgePortal
                dimension="model"
                value={model}
                label={toTitleCase(String(model))}
                variant="source"
              />
            )}
            {trim && (
              <BadgePortal
                dimension="model"
                value={trim}
                label={toTitleCase(String(trim))}
                variant="source"
              />
            )}
          </>
        ) : (
          <span className="vp-sub-header__title" style={titleStyle}>VEHICLE</span>
        )}

        {mileage != null && mileage !== '' && (
          <OdometerBadge
            mileage={typeof mileage === 'number' ? mileage : parseFloat(String(mileage).replace(/[^0-9.]/g, ''))}
            year={year ? Number(year) : null}
          />
        )}
      </div>

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Dimension badges — every badge is clickable per design spec */}
      <div className="vp-sub-header__badges" style={badgesWrapStyle}>
        {bodyStyle && (
          <BadgePortal dimension="body" value={bodyStyle} label={toTitleCase(String(bodyStyle))} variant="dimension" />
        )}
        {engineSize && (
          <BadgePortal dimension="engine" value={engineSize} label={String(engineSize)} variant="dimension" />
        )}
        {transmission && (
          <BadgePortal dimension="trans" value={transmission} label={toTitleCase(String(transmission))} variant="dimension" />
        )}
        {drivetrain && (
          <BadgePortal dimension="drive" value={drivetrain} label={toTitleCase(String(drivetrain))} variant="dimension" />
        )}
        {location && (
          <BadgePortal dimension="source" value={location} label={location} variant="dimension" />
        )}
        {/* THIN badge — sparse vehicle indicator */}
        {(() => {
          const v = vehicle as any;
          const specFields = [
            v?.mileage ?? v?.odometer ?? v?.miles,
            v?.engine ?? v?.engine_size ?? v?.displacement,
            v?.transmission,
            v?.drivetrain ?? v?.drive_type,
            v?.body_style ?? v?.bodyStyle,
            v?.vin,
            v?.exterior_color ?? v?.color,
            v?.interior_color,
            v?.fuel_type,
            v?.sale_price ?? v?.sold_price ?? v?.price,
            v?.description,
            v?.city ?? v?.seller_city ?? v?.location,
          ];
          const populated = specFields.filter((f) => f != null && String(f).trim() !== '').length;
          return populated < 5 ? (
            <span style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 7,
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: '#999',
              padding: '1px 4px',
              border: '2px solid #ccc',
              marginLeft: 4,
            }}>THIN</span>
          ) : null;
        })()}
      </div>
    </div>
  );
};

export default VehicleSubHeader;
