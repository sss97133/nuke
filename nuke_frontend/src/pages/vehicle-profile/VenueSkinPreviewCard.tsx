/**
 * VenueSkinPreviewCard.tsx
 * Profile-side wrapper: "Preview as venue" — renders the vehicle through a
 * venue's real design language via <VenueSkin>. Owner/lead-contributor only.
 * Self-guards (returns null) when there's no vehicle or no list access.
 *
 * The venue list comes from the seeded skin specs (canonical home:
 * organizations.brand_design_language). v1 ships the two reverse-engineered
 * poles — BaT (clean camp) and Bonhams (apex/spa camp).
 */

import React, { useMemo, useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import VenueSkin from '../../components/listing/VenueSkin';
import { SKIN_SEEDS } from '../../services/skinSeeds';

const VenueSkinPreviewCard: React.FC = () => {
  const { vehicle, isRowOwner, isVerifiedOwner, hasContributorAccess } = useVehicleProfile();
  const venues = useMemo(() => Object.values(SKIN_SEEDS), []);
  const [venueSlug, setVenueSlug] = useState<string>(venues[0]?.venue ?? 'bring-a-trailer-4');
  const [collapsed, setCollapsed] = useState(false);

  const canList = isRowOwner || isVerifiedOwner || hasContributorAccess;
  if (!vehicle?.id || !canList) return null;

  const atoms: Record<string, any> = {
    year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: (vehicle as any).trim,
    vin: vehicle.vin, mileage: vehicle.mileage,
    engine_type: (vehicle as any).engine_type, transmission: (vehicle as any).transmission,
    city: (vehicle as any).city, state: (vehicle as any).state,
    description: (vehicle as any).description,
    seller_handle: (vehicle as any).seller_username,
  };
  const images = [vehicle.primary_image_url, ...(((vehicle as any).image_urls as string[]) || [])].filter(Boolean) as string[];
  const av = vehicle as any;
  const valuation = av.nuke_estimate
    ? { estimate: av.nuke_estimate, low: av.nuke_estimate_low, high: av.nuke_estimate_high, confidence: av.nuke_confidence }
    : null;

  return (
    <div className={`widget ${collapsed ? 'widget--collapsed' : ''}`} id="widgetVenueSkin">
      <div className="widget__header">
        <div className="widget__header-left">
          <span className="widget__label">Preview as Venue</span>
        </div>
        <div className="widget__controls" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={venueSlug}
            onChange={(e) => setVenueSlug(e.target.value)}
            style={{ fontSize: 11, fontFamily: 'Arial, sans-serif', padding: '2px 4px' }}
            aria-label="Choose venue skin"
          >
            {venues.map((s) => (
              <option key={s.venue} value={s.venue}>{s.displayName}</option>
            ))}
          </select>
          <button className="widget__toggle" onClick={() => setCollapsed(!collapsed)} title="Toggle">
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="widget__body">
          <VenueSkin venueSlug={venueSlug} atoms={atoms} images={images} valuation={valuation} />
        </div>
      )}
    </div>
  );
};

export default VenueSkinPreviewCard;
