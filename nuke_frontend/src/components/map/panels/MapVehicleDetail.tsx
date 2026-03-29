import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { getPlatformDisplayName } from '../../../services/platformNomenclature';
import { getConfidenceTier, getConfidenceLabel } from '../types';
import { thumbUrl } from '../mapService';

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
  listing_source: string | null;
  discovery_source: string | null;
  auction_source: string | null;
  listing_url: string | null;
  discovery_url: string | null;
  primary_image_url: string | null;
  status: string | null;
  images: { id: string; image_url: string }[];
}

interface VLORecord {
  id: string;
  source_platform: string | null;
  source_type: string | null;
  confidence: number | null;
  precision: string | null;
  location_text_raw: string | null;
  city: string | null;
  region_code: string | null;
  county_name: string | null;
  observed_at: string | null;
}

interface ComparableVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  primary_image_url: string | null;
}

export default function MapVehicleDetail({ vehicleId, onBack, onNavigate }: Props) {
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [vloRecords, setVloRecords] = useState<VLORecord[]>([]);
  const [comparables, setComparables] = useState<ComparableVehicle[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: v } = await supabase
        .from('vehicles')
        .select('id, year, make, model, trim, vin, body_style, sale_price, asking_price, current_value, nuke_estimate, mileage, color, interior_color, engine_type, engine_size, horsepower, transmission, drivetrain, condition_rating, deal_score, heat_score, listing_location, description, source, listing_source, discovery_source, auction_source, listing_url, discovery_url, primary_image_url, status')
        .eq('id', vehicleId)
        .single();

      if (cancelled) return;

      let images: { id: string; image_url: string }[] = [];
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('id, image_url')
        .eq('vehicle_id', vehicleId)
        .limit(8);
      if (!cancelled && imgs) images = imgs;

      if (!cancelled && v) {
        setVehicle({ ...v, images } as VehicleData);

        // Fetch VLO records for location provenance
        const { data: vlos } = await supabase
          .from('vehicle_location_observations')
          .select('id, source_platform, source_type, confidence, precision, location_text_raw, city, region_code, county_name, observed_at')
          .eq('vehicle_id', vehicleId)
          .order('confidence', { ascending: false })
          .limit(5);
        if (!cancelled && vlos) setVloRecords(vlos);

        // Fetch comparables (same make, +/-5 years, with price)
        if (v.make && v.year) {
          const { data: comps } = await supabase
            .from('vehicles')
            .select('id, year, make, model, sale_price, primary_image_url')
            .eq('make', v.make)
            .gte('year', v.year - 5)
            .lte('year', v.year + 5)
            .not('sale_price', 'is', null)
            .neq('id', vehicleId)
            .order('sale_price')
            .limit(50);
          if (!cancelled && comps) setComparables(comps);
        }
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

  // Smart source resolution — same chain as VehicleBasicInfo
  const sourceLabel = useMemo(() => {
    const raw = (vehicle.listing_source || vehicle.discovery_source || vehicle.auction_source || '').toString().trim();
    const internalMarkers = ['auction_extractor', 'live_auction_extractor', 'intelligent_extractor', 'url_scraper', 'comment_extraction', 'auto_import'];
    const isInternal = internalMarkers.some(m => raw.toLowerCase().includes(m));

    let key = raw;
    if (isInternal || !raw) {
      // Fall back to hostname from URL
      try {
        const url = vehicle.listing_url || vehicle.discovery_url || '';
        if (url) {
          const host = new URL(url).hostname;
          key = host.startsWith('www.') ? host.slice(4) : host;
        }
      } catch { /* ignore */ }
    }

    if (!key) return null;
    const label = getPlatformDisplayName(key);
    if (label === 'Unknown') return null;
    return label;
  }, [vehicle.listing_source, vehicle.discovery_source, vehicle.auction_source, vehicle.listing_url, vehicle.discovery_url]);

  // Price context — only when >= 3 comparables with prices
  const priceContext = useMemo(() => {
    if (comparables.length < 3 || !price) return null;
    const prices = comparables.map(c => c.sale_price!).sort((a, b) => a - b);
    const min = prices[0];
    const max = prices[prices.length - 1];
    const rank = prices.filter(p => p <= price).length;
    return { count: prices.length, min, max, rank };
  }, [comparables, price]);

  // Best VLO for provenance display
  const bestVlo = vloRecords.length > 0 ? vloRecords[0] : null;

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
            src={thumbUrl(vehicle.primary_image_url) || vehicle.primary_image_url}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
        {sourceLabel && (
          <div style={{ fontSize: 8, color: 'var(--text-disabled)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 12 }}>
            {sourceLabel}
          </div>
        )}

        {/* Location provenance — epistemological layer */}
        {bestVlo && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 6 }}>
              LOCATION PROVENANCE
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Primary VLO */}
              <div style={{ fontSize: 10, color: 'var(--text)' }}>
                {bestVlo.location_text_raw || bestVlo.city || 'Unknown location'}
                {bestVlo.region_code ? `, ${bestVlo.region_code}` : ''}
                {bestVlo.county_name ? ` (${bestVlo.county_name} Co.)` : ''}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
                {bestVlo.source_platform && (
                  <span style={{ fontSize: 8, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)', textTransform: 'uppercase' as const }}>
                    {getPlatformDisplayName(bestVlo.source_platform)}
                  </span>
                )}
                {bestVlo.confidence != null && (
                  <span style={{
                    fontSize: 7, fontWeight: 700, padding: '1px 4px', border: '1px solid var(--border)',
                    color: bestVlo.confidence >= 0.85 ? 'var(--success, #16825d)' : bestVlo.confidence >= 0.7 ? 'var(--warning, #b05a00)' : 'var(--text-secondary)',
                    textTransform: 'uppercase' as const, letterSpacing: '0.3px',
                  }}>
                    {getConfidenceLabel(getConfidenceTier(bestVlo.confidence))}
                  </span>
                )}
                {bestVlo.precision && (
                  <span style={{ fontSize: 7, fontFamily: 'Courier New, monospace', color: 'var(--text-disabled)' }}>
                    {bestVlo.precision}
                  </span>
                )}
              </div>
              {/* Additional VLOs */}
              {vloRecords.length > 1 && (
                <div style={{ fontSize: 8, color: 'var(--text-disabled)', marginTop: 2 }}>
                  {vloRecords.length} location observations from {new Set(vloRecords.map(v => v.source_platform).filter(Boolean)).size} source{new Set(vloRecords.map(v => v.source_platform).filter(Boolean)).size !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Regional context — similar vehicles nearby */}
        {comparables.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 4 }}>
              SIMILAR VEHICLES IN DB
            </div>
            <div style={{ fontSize: 10, color: 'var(--text)' }}>
              {comparables.length} similar {vehicle.make} ({vehicle.year! - 5}–{vehicle.year! + 5}) in database
            </div>
          </div>
        )}

        {/* Price context — only >= 3 comparables */}
        {priceContext && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 4 }}>
              PRICE CONTEXT
            </div>
            <div style={{ fontSize: 10, color: 'var(--text)', marginBottom: 4 }}>
              {title} at {fmtPrice(price!)} — {priceContext.count} comparable{priceContext.count !== 1 ? 's' : ''} priced {fmtPrice(priceContext.min)}–{fmtPrice(priceContext.max)}
            </div>
            {/* Price bar visualization */}
            <div style={{ position: 'relative', height: 6, background: 'var(--bg-secondary, #1a1a1a)', border: '1px solid var(--border)', marginBottom: 4 }}>
              {/* Range fill */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: '0%', right: '0%',
                background: 'var(--border)',
              }} />
              {/* This vehicle's position */}
              <div style={{
                position: 'absolute', top: -1, bottom: -1,
                left: `${Math.min(99, Math.max(1, ((price! - priceContext.min) / (priceContext.max - priceContext.min || 1)) * 100))}%`,
                width: 2, background: 'var(--success, #16825d)',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, fontFamily: 'Courier New, monospace', color: 'var(--text-disabled)' }}>
              <span>{fmtPrice(priceContext.min)}</span>
              <span>#{priceContext.rank} of {priceContext.count}</span>
              <span>{fmtPrice(priceContext.max)}</span>
            </div>
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
                <img src={thumbUrl(img.image_url) || img.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            ))}
          </div>
        )}

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
        border: '1px solid var(--border)', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
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
