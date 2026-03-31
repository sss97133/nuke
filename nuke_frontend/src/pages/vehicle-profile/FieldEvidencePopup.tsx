/**
 * FieldEvidencePopup — the click-through terminus for any dossier field.
 *
 * Shows: value → all evidence sources → tagged photos → "No visual evidence" honestly.
 * This is the reusable pattern for the computation surface's "every data point is a query" principle.
 *
 * See: docs/library/technical/design-book/09-click-through-chains.md
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { FieldEvidenceGroup } from './hooks/useFieldEvidence';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

interface FieldEvidencePopupProps {
  field: string;
  label: string;
  value: string;
  vehicleId: string;
  evidence?: FieldEvidenceGroup;
  /** Optional VIN decode data (passed for VIN field) */
  vinDecode?: Record<string, any> | null;
}

const SOURCE_LABELS: Record<string, string> = {
  vin_decode: 'VIN DECODE (NHTSA)',
  nhtsa: 'NHTSA',
  bat: 'BRING A TRAILER',
  bat_import: 'BRING A TRAILER',
  ai_extraction: 'AI EXTRACTION',
  vision: 'VISION ANALYSIS',
  user: 'USER INPUT',
  enrichment: 'DATA ENRICHMENT',
};

const TRUST_ORDER = ['vin_decode', 'nhtsa', 'bat', 'user', 'ai_extraction', 'vision', 'enrichment'];

function trustRank(sourceType: string): number {
  const s = sourceType.toLowerCase();
  for (let i = 0; i < TRUST_ORDER.length; i++) {
    if (s.includes(TRUST_ORDER[i])) return i;
  }
  return TRUST_ORDER.length;
}

function sourceLabel(sourceType: string): string {
  const s = sourceType.toLowerCase();
  for (const [key, label] of Object.entries(SOURCE_LABELS)) {
    if (s.includes(key)) return label;
  }
  return sourceType.toUpperCase().replace(/_/g, ' ');
}

interface TaggedImage {
  id: string;
  url: string;
  zone: string | null;
  category: string | null;
  caption: string | null;
}

const FieldEvidencePopup: React.FC<FieldEvidencePopupProps> = ({
  field, label, value, vehicleId, evidence, vinDecode,
}) => {
  const [images, setImages] = useState<TaggedImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);

  // Fetch images tagged with this field's zone/category
  useEffect(() => {
    let cancelled = false;
    const fieldToZone: Record<string, string[]> = {
      engine_type: ['engine_bay', 'engine'],
      engine_size: ['engine_bay', 'engine'],
      fuel_system_type: ['engine_bay'],
      vin: ['vin', 'vin_plate', 'door_jamb', 'dash'],
      color: ['exterior', 'front_three_quarter', 'rear_three_quarter', 'side'],
      interior_color: ['interior', 'dashboard', 'seats'],
      transmission: ['engine_bay', 'undercarriage'],
      drivetrain: ['undercarriage', 'axle'],
      mileage: ['odometer', 'instrument_cluster', 'dashboard'],
      body_style: ['exterior', 'front', 'rear', 'side'],
    };

    const zones = fieldToZone[field] || [];
    if (zones.length === 0) {
      setImagesLoading(false);
      return;
    }

    supabase
      .from('vehicle_images')
      .select('id, url, vehicle_zone, category, caption')
      .eq('vehicle_id', vehicleId)
      .in('vehicle_zone', zones)
      .order('sort_order', { ascending: true })
      .limit(12)
      .then(({ data }) => {
        if (!cancelled && data) {
          setImages(data.map(d => ({
            id: d.id,
            url: d.url,
            zone: d.vehicle_zone,
            category: d.category,
            caption: d.caption,
          })));
        }
        if (!cancelled) setImagesLoading(false);
      });
    return () => { cancelled = true; };
  }, [vehicleId, field]);

  const sources = evidence?.sources || [];
  const sortedSources = [...sources].sort((a, b) => trustRank(a.source_type) - trustRank(b.source_type));

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '9px', lineHeight: 1.6, padding: '8px' }}>
      {/* Field value header */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{
          fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '2px',
        }}>
          {label}
        </div>
        <div style={{
          fontFamily: field === 'vin' ? "'Courier New', monospace" : 'Arial, sans-serif',
          fontSize: field === 'vin' ? '12px' : '11px',
          fontWeight: 700,
          letterSpacing: field === 'vin' ? '1.5px' : 'normal',
        }}>
          {value}
        </div>
      </div>

      {/* VIN decode section */}
      {field === 'vin' && vinDecode && Object.keys(vinDecode).length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border)', paddingBottom: '2px', marginBottom: '4px',
          }}>
            NHTSA DECODE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '1px 8px', fontSize: '8px' }}>
            {Object.entries(vinDecode)
              .filter(([, v]) => v != null && v !== '' && v !== 'Not Applicable')
              .slice(0, 12)
              .map(([k, v]) => (
                <React.Fragment key={k}>
                  <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span>{String(v)}</span>
                </React.Fragment>
              ))
            }
          </div>
        </div>
      )}

      {/* Evidence sources */}
      {sortedSources.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border)', paddingBottom: '2px', marginBottom: '4px',
          }}>
            {sortedSources.length} SOURCE{sortedSources.length !== 1 ? 'S' : ''}
          </div>
          {sortedSources.map((src, i) => (
            <div key={src.id || i} style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr',
              gap: '0 8px', padding: '2px 0',
              borderBottom: i < sortedSources.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: '7px', fontWeight: 700,
                letterSpacing: '0.5px', color: 'var(--text-secondary)',
              }}>
                {sourceLabel(src.source_type)}
              </span>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: '9px' }}>
                {src.field_value || '\u2014'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tagged images */}
      {!imagesLoading && images.length > 0 && (
        <div>
          <div style={{
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border)', paddingBottom: '2px', marginBottom: '4px',
          }}>
            VISUAL EVIDENCE ({images.length})
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '4px',
          }}>
            {images.map(img => (
              <div key={img.id} style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
                <img
                  src={optimizeImageUrl(img.url, 'thumbnail') || img.url}
                  alt={img.caption || img.zone || field}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {img.zone && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    fontSize: '6px', fontFamily: "'Courier New', monospace",
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    padding: '1px 2px', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {img.zone.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No evidence state */}
      {!imagesLoading && images.length === 0 && sortedSources.length === 0 && (
        <div style={{ color: 'var(--text-disabled)', fontSize: '8px', fontStyle: 'italic' }}>
          No source evidence available for this field.
        </div>
      )}

      {!imagesLoading && images.length === 0 && sortedSources.length > 0 && (
        <div style={{ color: 'var(--text-disabled)', fontSize: '8px' }}>
          No visual evidence tagged for {label.toLowerCase()}.
        </div>
      )}
    </div>
  );
};

export default FieldEvidencePopup;
