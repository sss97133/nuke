import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

const MAP_FONT = 'Arial, Helvetica, sans-serif';

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

interface Props {
  vehicleId: string;
  onBack: () => void;
  onNavigate: (view: { type: string; id: string }) => void;
}

interface VehicleData {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  body_style: string | null;
  sale_price: number | null;
  asking_price: number | null;
  current_value: number | null;
  nuke_estimate: number | null;
  mileage: number | null;
  color: string | null;
  interior_color: string | null;
  engine_type: string | null;
  engine_size: string | null;
  horsepower: number | null;
  transmission: string | null;
  drivetrain: string | null;
  condition_rating: number | null;
  deal_score: number | null;
  heat_score: number | null;
  listing_location: string | null;
  description: string | null;
  source: string | null;
  primary_image_url: string | null;
  status: string | null;
  images: { id: string; url: string }[];
}

export default function MapVehicleDetail({ vehicleId, onBack, onNavigate }: Props) {
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: v } = await supabase
        .from('vehicles')
        .select('id, year, make, model, trim, vin, body_style, sale_price, asking_price, current_value, nuke_estimate, mileage, color, interior_color, engine_type, engine_size, horsepower, transmission, drivetrain, condition_rating, deal_score, heat_score, listing_location, description, source, primary_image_url, status')
        .eq('id', vehicleId)
        .single();

      if (cancelled) return;

      let images: { id: string; url: string }[] = [];
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('id, url')
        .eq('vehicle_id', vehicleId)
        .limit(8);
      if (!cancelled && imgs) images = imgs;

      if (!cancelled && v) {
        setVehicle({ ...v, images } as VehicleData);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) {
    return (
      <div style={{ padding: 16, fontFamily: MAP_FONT }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
        <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 16 }}>LOADING...</div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div style={{ padding: 16, fontFamily: MAP_FONT }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
        <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 16 }}>VEHICLE NOT FOUND</div>
      </div>
    );
  }

  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const price = vehicle.sale_price || vehicle.asking_price || vehicle.current_value || vehicle.nuke_estimate;
  const specs = [vehicle.color, vehicle.engine_type, vehicle.horsepower ? `${vehicle.horsepower}hp` : null, vehicle.transmission, vehicle.drivetrain].filter(Boolean);

  return (
    <div style={{ fontFamily: MAP_FONT, fontSize: 11 }}>
      {/* Back + open in new tab */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
        <button
          onClick={() => window.open(`/vehicle/${vehicleId}`, '_blank')}
          style={{ ...backBtnStyle, fontSize: 8 }}
          title="Open full profile in new tab"
        >OPEN IN TAB</button>
      </div>

      {/* Hero image */}
      {vehicle.primary_image_url && (
        <div style={{ width: '100%', height: 200, overflow: 'hidden' }}>
          <img
            src={vehicle.primary_image_url}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}

      <div style={{ padding: '12px' }}>
        {/* Title */}
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{title || 'Unknown Vehicle'}</div>
        {vehicle.trim && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8 }}>{vehicle.trim} {vehicle.body_style ? `· ${vehicle.body_style}` : ''}</div>}

        {/* Price */}
        {price && (
          <div style={{ fontSize: 18, fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--success, #16825d)', marginBottom: 8 }}>
            {fmtPrice(price)}
          </div>
        )}

        {/* Status badge */}
        {vehicle.status && (
          <div style={{
            display: 'inline-block', fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const,
            padding: '2px 6px', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            letterSpacing: '0.5px', marginBottom: 8,
          }}>
            {vehicle.status}
          </div>
        )}

        {/* Mileage */}
        {vehicle.mileage && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {vehicle.mileage.toLocaleString()} miles
          </div>
        )}

        {/* Specs row */}
        {specs.length > 0 && (
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {specs.join(' · ')}
          </div>
        )}

        {/* Interior color */}
        {vehicle.interior_color && (
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Interior: {vehicle.interior_color}
          </div>
        )}

        {/* Score badges */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {vehicle.deal_score != null && <ScoreBadge label="DEAL" value={vehicle.deal_score} max={100} />}
          {vehicle.heat_score != null && <ScoreBadge label="HEAT" value={vehicle.heat_score} max={100} />}
          {vehicle.condition_rating != null && <ScoreBadge label="COND" value={vehicle.condition_rating} max={10} />}
        </div>

        {/* VIN */}
        {vehicle.vin && (
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: 'Courier New, monospace', marginBottom: 8 }}>
            VIN: {vehicle.vin}
          </div>
        )}

        {/* Location */}
        {vehicle.listing_location && (
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {vehicle.listing_location}
          </div>
        )}

        {/* Source */}
        {vehicle.source && (
          <div style={{ fontSize: 8, color: 'var(--text-disabled)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 12 }}>
            SOURCE: {vehicle.source}
          </div>
        )}

        {/* Description */}
        {vehicle.description && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: '1.4', maxHeight: 100, overflow: 'hidden', marginBottom: 12 }}>
            {vehicle.description}
          </div>
        )}

        {/* Photo grid */}
        {vehicle.images.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, marginBottom: 12 }}>
            {vehicle.images.slice(0, 8).map(img => (
              <div key={img.id} style={{ aspectRatio: '1', overflow: 'hidden' }}>
                <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ActionButton label="FOLLOW" onClick={() => {}} />
          <ActionButton label="BUY" onClick={() => {}} />
          <ActionButton label="ADD TO COLLECTION" onClick={() => {}} />
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  const bg = pct >= 70 ? 'var(--success, #16825d)' : pct >= 40 ? 'var(--warning, #b05a00)' : 'var(--error, #d13438)';
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
      padding: '3px 6px', border: '1px solid var(--border)', minWidth: 36,
    }}>
      <div style={{ fontSize: 11, fontFamily: 'Courier New, monospace', fontWeight: 700, color: bg }}>
        {max === 10 ? value.toFixed(1) : Math.round(value)}
      </div>
      <div style={{ fontSize: 7, textTransform: 'uppercase' as const, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
        {label}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'center' as const, padding: '8px',
        background: 'transparent', color: 'var(--text)', cursor: 'pointer',
        fontWeight: 600, fontSize: 9, fontFamily: MAP_FONT,
        border: '1px solid var(--border)', borderRadius: 0,
        textTransform: 'uppercase' as const, letterSpacing: '0.5px',
      }}
    >
      {label}
    </button>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  fontSize: 9, fontWeight: 700, fontFamily: MAP_FONT, cursor: 'pointer', padding: '4px 8px',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
