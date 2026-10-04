/**
 * FieldEvidencePopup — the click-through terminus for any dossier field.
 *
 * Shows the value, source claims, qualified image citations and related image areas.
 * This is the reusable pattern for the computation surface's "every data point is a query" principle.
 *
 * See: docs/library/technical/design-book/09-click-through-chains.md
 */
import React from 'react';
import PrefetchLink from '../../components/PrefetchLink';
import { usePopup } from '../../components/popups/usePopup';
import { useVehicleImageEvidence, relatedFieldImages, hasImageAnalysis, webSourceUrl } from './hooks/useVehicleImageEvidence';
import { useFieldProvenance, citedFieldImages, evidenceRelationLabel } from './hooks/useFieldProvenance';
import type { FieldEvidenceGroup } from './hooks/useFieldEvidence';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import './vehicle-evidence.css';

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

const FieldEvidencePopup: React.FC<FieldEvidencePopupProps> = ({
  field, label, value, vehicleId, evidence, vinDecode,
}) => {
  const { closeTop } = usePopup();
  const inventory = useVehicleImageEvidence(vehicleId);
  const provenance = useFieldProvenance(vehicleId, field);
  const rows = inventory.data?.images || [];
  const images = relatedFieldImages(rows, field);
  const citations = citedFieldImages(provenance.data, rows);
  const imagesLoading = inventory.isLoading || provenance.isLoading;
  const awaiting = rows.filter(image => !hasImageAnalysis(image)).length;
  const imageReadFailed = !!inventory.error || !!provenance.error || (!provenance.isLoading && provenance.data === null);
  const imageObservations = provenance.data?.image_observations || [];
  const hasRecordedImageReference = imageObservations.length > 0 || !!provenance.data?.source_image_url || (provenance.data?.evidence || []).some(source => source.image_id && (source.source !== 'field_evidence' || source.verified === true));

  const sources = evidence?.sources || (provenance.data?.evidence || [])
    .filter(source => source.source !== 'field_evidence' || source.verified === true)
    .map((source, index) => ({ id: `${source.source}-${index}`, source_type: source.source_type || source.source, field_value: source.value, created_at: source.at }));
  const sortedSources = [...sources].sort((a, b) => trustRank(a.source_type) - trustRank(b.source_type));

  if (!provenance.isLoading && provenance.data === null && !provenance.error) {
    return <p role="status">Field evidence is unavailable or this record is private.</p>;
  }

  return (
    <div className="field-evidence-popup" style={{ fontFamily: 'Arial, sans-serif', fontSize: '9px', lineHeight: 1.6, padding: '8px' }}>
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

      {provenance.data && <div style={{ marginBottom: 8 }}>
        <span className="ev-label">CANONICAL VALUE</span>{' '}
        <strong>{provenance.data.value || 'Unknown'}</strong>
        {!provenance.data.value && <p>The canonical value is unknown. Source reports below remain attributed claims.</p>}
        {evidence?.hasConflict && evidence.conflictType === 'genuine' && <p role="status">Source claims differ. No resolution is established by this display.</p>}
      </div>}

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
            {sortedSources.length} SOURCE CLAIM{sortedSources.length !== 1 ? 'S' : ''}
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

      {/* Claim-specific references from the existing provenance reader. */}
      {!imagesLoading && citations.length > 0 && (
        <div className="field-image-citations">
          <div className="ev-label">IMAGE-CITED OBSERVATIONS · {citations.length} IMAGE{citations.length !== 1 ? 'S' : ''}</div>
          <p>Ordered by coded specification, visible appearance/control, then component inference. This is an inspection order, not a probability of correctness.</p>
          <div className="ev-citation-grid">
            {citations.map(image => (
              <article key={image.id} className="ev-image-proof">
                <a href={image.image_url} target="_blank" rel="noopener noreferrer">
                  <img src={image.medium_url || optimizeImageUrl(image.image_url, 'medium') || image.image_url} alt={`Cited source for ${label.toLowerCase()}`} width={900} height={675} loading="lazy" />
                  <span>Inspect source image {image.id.slice(0, 8)} ↗</span>
                </a>
                {imageObservations.filter(obs => obs.image_id === image.id).map(obs => (
                  <div key={obs.observation_id} className="ev-image-assessment">
                    <span className="ev-label">{evidenceRelationLabel(obs.visual_relation)}</span>
                    <strong>{obs.value || 'Value not recorded'}</strong>
                    {obs.image_region?.label && <p>Visible region: {obs.image_region.label}</p>}
                    {obs.limitation && <p className="ev-proof-limitation">{obs.limitation}</p>}
                    {obs.reference?.url && /^https:\/\//.test(obs.reference.url) && <a href={`${obs.reference.url}#page=${obs.reference.pdf_page || 1}`} target="_blank" rel="noopener noreferrer">Manufacturer reference · PDF page {obs.reference.pdf_page || 'unknown'} ↗</a>}
                    <p className="ev-footnote">Agent review · {obs.observed_at ? new Date(obs.observed_at).toLocaleDateString('en-US', { timeZone: 'UTC' }) : 'Review time unknown'} · Capture time unknown{obs.agent_model ? ` · ${obs.agent_model}` : ' · Model identifier not recorded'}</p>
                  </div>
                ))}
                {imageObservations.every(obs => obs.image_id !== image.id) && <p>Legacy recorded image citation. Its observation detail is not available here.</p>}
              </article>
            ))}
          </div>
          {imageObservations.length > 1 && imageObservations.every(obs => obs.source_family && obs.source_family === imageObservations[0].source_family) && <p className="ev-footnote">These photographs come from the same source family. Multiple views are not independent source confirmations.</p>}
        </div>
      )}
      {(provenance.data?.observations || []).filter(obs => obs.source_url && !imageObservations.some(imageObs => imageObs.observation_id === obs.id)).map(obs => (
        <div key={obs.id} style={{ padding: '6px 0', overflowWrap: 'anywhere' }}>
          <div className="ev-label">SOURCE REPORT · <PrefetchLink to={`/vehicle/${vehicleId}/observation/${obs.id}`} onClick={closeTop}>Inspect observation {obs.id}</PrefetchLink></div>
          {webSourceUrl(obs.source_url) ? <a href={webSourceUrl(obs.source_url)!} target="_blank" rel="noopener noreferrer">{obs.source_slug || 'Source observation'} ↗</a> : <span>{obs.source_slug || 'Source observation'} · Link unavailable</span>}
          <span> · {obs.value || 'Value not recorded'}</span>
          <div style={{ color: 'var(--text-secondary)' }}>Observation time: {obs.observed_at ? new Date(obs.observed_at).toLocaleString() : 'Unknown'} · Ingest time: {obs.ingested_at ? new Date(obs.ingested_at).toLocaleString() : 'Unavailable'}</div>
          <div style={{ color: 'var(--text-secondary)' }}>Method: {obs.extraction_method || 'Unavailable'} · Stored confidence: {obs.confidence == null ? 'Unavailable' : obs.confidence}</div>
        </div>
      ))}
      {/* A zone match identifies an area to inspect; it does not support a particular claim. */}
      {!imagesLoading && images.length > 0 && (
        <div>
          <div style={{
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border)', paddingBottom: '2px', marginBottom: '4px',
          }}>
            RELATED IMAGES · AREA MATCH ({images.length})
          </div>
          <p>Area matches help inspection; they do not confirm {value}.</p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '4px',
          }}>
            {images.map(img => (
              <a href={img.image_url} target="_blank" rel="noopener noreferrer" key={img.id} style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
                <img
                  src={img.thumbnail_url || optimizeImageUrl(img.image_url, 'thumbnail') || img.image_url}
                  alt={img.vehicle_zone || field}
                  width={150} height={150}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {img.vehicle_zone && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    fontSize: '6px', fontFamily: "'Courier New', monospace",
                    background: 'rgba(0,0,0,0.6)', color: 'var(--bg)',
                    padding: '1px 2px', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {img.vehicle_zone.replace(/_/g, ' ')}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {imagesLoading && <p aria-live="polite">Reading image evidence…</p>}
      {imageReadFailed && <p role="alert">Image evidence could not be read. Its absence has not been established.</p>}
      {!imagesLoading && !imageReadFailed && citations.length === 0 && (
        <div className="field-evidence-gap">
          <div className="ev-label">IMAGE CITATION MISSING</div>
          <p>{hasRecordedImageReference ? 'An image reference exists but could not be validated in the visible inventory.' : `No image citation is recorded for ${label.toLowerCase()}.`}</p>
          {awaiting > 0 && <p><strong>{awaiting}</strong> of {rows.length} visible image records are not marked complete by the image-processing pipeline. They may contain relevant evidence.</p>}
          {images.length === 0 && awaiting === 0 && <p>No matching image area is indexed in the records read.</p>}
          {inventory.data && !inventory.data.complete && <p>Showing {rows.length} of {inventory.data.total ?? 'an unknown number of'} visible records. This is a partial inventory.</p>}
        </div>
      )}
      {!imagesLoading && !imageReadFailed && sortedSources.length === 0 && citations.length === 0 && !provenance.data?.observations.length && <p>No source claim was returned for this field. The displayed value needs a source.</p>}
    </div>
  );
};

export default FieldEvidencePopup;
