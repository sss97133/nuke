/** Experimental layout of the existing vehicle profile, backed by its canonical readers. */
import React, { useState } from 'react';
import PrefetchLink from '../../components/PrefetchLink';
import { useVehicleProfile } from './VehicleProfileContext';
import FieldEvidencePopup from './FieldEvidencePopup';
import { useVehicleImageEvidence, hasImageAnalysis, hasImageZone, relatedFieldImages } from './hooks/useVehicleImageEvidence';
import { useFieldProvenance, citedFieldImages, provenanceCoverageUnavailable } from './hooks/useFieldProvenance';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import './vehicle-evidence.css';
const ObservationTimeline = React.lazy(() => import('./ObservationTimeline'));

const FIELDS = [
  { field: 'color', label: 'EXTERIOR COLOR' },
  { field: 'interior_color', label: 'INTERIOR COLOR' },
  { field: 'transmission', label: 'TRANSMISSION' },
  { field: 'drivetrain', label: 'DRIVETRAIN' },
  { field: 'fuel_type', label: 'FUEL' },
] as const;
function date(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const VehicleEvidenceView: React.FC = () => {
  const { vehicle, leadImageUrl, observationCount } = useVehicleProfile();
  const inventory = useVehicleImageEvidence(vehicle?.id);
  const [field, setField] = useState<(typeof FIELDS)[number]['field']>('interior_color');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unanalyzed' | 'related' | 'cited'>('all');
  const [showHistory, setShowHistory] = useState(false);
  const provenance = useFieldProvenance(vehicle?.id || '', field);
  if (!vehicle) return null;
  const images = inventory.data?.images || [];
  const analyzed = images.filter(hasImageAnalysis).length;
  const zoned = images.filter(hasImageZone).length;
  const captureDated = images.filter(image => image.taken_at).length;
  const citations = citedFieldImages(provenance.data, images);
  const citationsUnavailable = provenanceCoverageUnavailable(provenance.data);
  const related = relatedFieldImages(images, field);
  const visible = filter === 'unanalyzed' ? images.filter(image => !hasImageAnalysis(image))
    : filter === 'related' ? related : filter === 'cited' ? citations : images;
  const selected = images.find(image => image.id === selectedId);
  const lead = selected || images.find(image => image.image_url === leadImageUrl || image.medium_url === leadImageUrl);
  const hero = selected?.image_url || leadImageUrl;
  const imported = images.map(image => image.created_at).filter((time): time is string => !!time).sort();
  const label = FIELDS.find(item => item.field === field)!.label;
  const value = vehicle[field] || 'Unknown';

  return (
    <main className="evidence-view" aria-label="Vehicle evidence view">
      <div className="ev-topline">
        <span className="ev-label">VEHICLE RECORD / EVIDENCE VIEW · EXPERIMENTAL</span>
        <PrefetchLink to={`/vehicle/${vehicle.id}`}>Full profile ↗</PrefetchLink>
      </div>
      <header className="ev-heading">
        <div><div className="ev-label">{vehicle.year} · {vehicle.make}</div><h1>{vehicle.model}{vehicle.body_style ? <span> / {vehicle.body_style}</span> : null}</h1></div>
        <div className="ev-identity"><span className="ev-label">VEHICLE IDENTITY</span><span>{vehicle.vin || 'VIN unknown'}</span>{inventory.data && <div className="ev-record-counts"><button type="button" onClick={() => document.querySelector('.ev-library')?.scrollIntoView({ block: 'start' })}>{inventory.data.total ?? images.length} images</button><button type="button" onClick={() => document.querySelector('.ev-coverage')?.scrollIntoView({ block: 'center' })}>{analyzed}/{images.length} completed</button><button type="button" onClick={() => { setShowHistory(true); document.querySelector('.ev-history')?.scrollIntoView({ block: 'start' }); }}>{observationCount} observations</button></div>}</div>
      </header>
      <div className="ev-main-grid">
        <section className="ev-image-section" aria-label="Vehicle images">
          <figure className="ev-hero">
            {hero ? <img src={optimizeImageUrl(hero, 'large') || hero} width={1200} height={800} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}, ${selectedId ? 'image selected for inspection' : 'profile image'}`} /> : <div className="ev-hero-unavailable">{inventory.isLoading ? 'Reading vehicle images…' : 'No eligible profile image returned.'}</div>}
            <figcaption><span className="ev-label">{selectedId ? 'SELECTED FOR INSPECTION' : lead?.is_primary ? 'MARKED PRIMARY IN IMAGE LEDGER' : 'PROFILE IMAGE SELECTION'}</span><span>{lead?.vehicle_zone && hasImageZone(lead) ? lead.vehicle_zone.replace(/_/g, ' ') : 'Image classification unknown'}</span></figcaption>
          </figure>
          <div className="ev-image-meta"><span>Image {lead ? lead.id.slice(0, 8) : 'reference pending'}</span><span>Captured {date(lead?.taken_at)}</span><span>Imported {date(lead?.created_at)}</span></div>
          <div className="ev-contact-strip">
            {images.slice(0, 7).map((image, i) => <button key={image.id} type="button" aria-label={`Inspect image ${i + 1}`} aria-pressed={lead?.id === image.id} onClick={() => setSelectedId(image.id)}><img src={image.thumbnail_url || optimizeImageUrl(image.image_url, 'thumbnail') || image.image_url} width={150} height={100} alt={`Vehicle image ${i + 1}`} loading="lazy" /></button>)}
          </div>
          {inventory.data && <section className="ev-coverage" aria-label="Image analysis coverage">
            <div className="ev-section-heading"><h2>What the images can tell us</h2><span className="ev-label">{images.length} RECORDS READ</span></div>
            <p>{analyzed === 0 ? 'Image processing is not marked complete. Field-specific image reviews appear in the source drill.' : 'Analysis coverage in the visible image records.'}</p>
            <div className="ev-coverage-dots" role="img" aria-label={`${analyzed} of ${images.length} image records have a processing completion receipt`}>{images.map(image => <span key={image.id} className={hasImageAnalysis(image) ? 'analyzed' : ''} title={`${image.id.slice(0, 8)}: ${hasImageAnalysis(image) ? 'analysis receipt present' : 'no analysis receipt'}`} />)}</div>
            <div className="ev-coverage-stats"><button onClick={() => setFilter('unanalyzed')}><strong>{analyzed}<small> / {images.length}</small></strong><span className="ev-label">PROCESSING COMPLETED</span></button><div><strong>{zoned}<small> / {images.length}</small></strong><span className="ev-label">CLASSIFIED AREAS</span></div><div><strong>{captureDated}<small> / {images.length}</small></strong><span className="ev-label">CAPTURE DATES</span></div></div>
            <p className="ev-footnote">Import chronology: {date(imported[0])} — {date(imported[imported.length - 1])}. Import dates do not establish when a photo was taken.</p>
            {!inventory.data.complete && <p role="status">Partial inventory: {images.length} of {inventory.data.total ?? 'unknown total'} visible image records. Coverage describes only the records read.</p>}
          </section>}
          {inventory.error && <p role="alert">Image metadata could not be read. Coverage is unknown.</p>}
        </section>
        <section className="ev-record" aria-label="Specification evidence">
          <div className="ev-label">RECORDED SPECIFICATIONS</div>
          <h2>Follow a value to its sources.</h2>
          <p>A listing claim, an image citation and a related photo carry different kinds of evidence.</p>
          <div className="ev-fields">{FIELDS.filter(item => vehicle[item.field]).map(item => <button type="button" key={item.field} aria-pressed={field === item.field} onClick={() => { setField(item.field); setFilter('all'); }}><span className="ev-label">{item.label}</span><strong>{vehicle[item.field]}</strong><span aria-hidden="true">↗</span></button>)}</div>
          <div className="ev-detail" aria-live="polite">
            <FieldEvidencePopup key={field} vehicleId={vehicle.id} field={field} label={label} value={value} />
          </div>
          <div className="ev-source-note"><span className="ev-label">HOW TO READ THE EVIDENCE</span><p>Image citations identify the material used for a claim. Area matches help you inspect it. Neither alone establishes that the recorded value is correct.</p></div>
        </section>
      </div>
      {inventory.data && <section className="ev-library" aria-label="Image evidence library">
        <div className="ev-section-heading"><h2>Inspect the material</h2><span className="ev-label">{inventory.data.total ?? images.length} VISIBLE IMAGE RECORDS</span></div>
        <div className="ev-library-controls">
          {([['all', 'All material', images.length], ['unanalyzed', 'Processing incomplete', images.length - analyzed], ['cited', `Cited for ${label.toLowerCase()}`, citations.length], ['related', 'Related area', related.length]] as const).map(([key, title, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{title} <span>{key === 'cited' && provenance.isLoading ? '…' : key === 'cited' && citationsUnavailable ? '?' : count}</span></button>)}
          <span className="ev-footnote">Labels describe database records. Unclassified material may include photos or documents.</span>
        </div>
        {visible.length === 0 ? <p className="ev-empty">{provenance.error ? 'Field citations could not be read.' : filter === 'cited' && citationsUnavailable ? 'Field citations are unavailable. Coverage is unknown.' : filter === 'cited' ? `No validated image citation returned for ${label.toLowerCase()}.` : 'No matching records in this inventory.'}</p> : <div className="ev-library-grid">{visible.map((image, i) => <button type="button" key={image.id} data-image-id={image.id} aria-pressed={lead?.id === image.id} onClick={() => { setSelectedId(image.id); document.querySelector('.ev-hero')?.scrollIntoView({ behavior: 'instant', block: 'center' }); }}><img src={image.thumbnail_url || optimizeImageUrl(image.image_url, 'small') || image.image_url} width={300} height={200} alt={`Source image ${i + 1}; ${image.vehicle_zone || 'area unknown'}`} loading="lazy" /><span className="ev-label">{String(i + 1).padStart(2, '0')} · {image.is_document === true ? 'DOCUMENT FLAG' : hasImageZone(image) ? image.vehicle_zone!.replace(/_/g, ' ') : 'UNCLASSIFIED'}</span><span>{image.source?.replace(/_/g, ' ') || 'Source unknown'}</span></button>)}</div>}
      </section>}
      {observationCount > 0 && <section className="ev-history"><button type="button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}><h2>Observation history</h2><span>{observationCount} in the record · {showHistory ? 'Close −' : 'Inspect +'}</span></button>{showHistory && <React.Suspense fallback={null}><ObservationTimeline /></React.Suspense>}</section>}
      <footer className="ev-footer"><span>Read-only evidence view · same vehicle record</span><span>Image metadata read {inventory.data ? new Date(inventory.data.readAt).toLocaleTimeString() : 'pending'}</span></footer>
    </main>
  );
};
export default VehicleEvidenceView;
