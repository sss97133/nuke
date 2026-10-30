/**
 * FieldEvidencePopup — the click-through terminus for any dossier field.
 *
 * Shows the value, source claims, qualified image citations and related image areas.
 * This is the reusable pattern for the computation surface's "every data point is a query" principle.
 *
 * See: docs/library/technical/design-book/09-click-through-chains.md
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import PrefetchLink from '../../components/PrefetchLink';
import { Button } from '../../components/ui/button';
import { usePopup } from '../../components/popups/usePopup';
import { useVehicleImageEvidence, relatedFieldImages, hasImageAnalysis, webSourceUrl } from './hooks/useVehicleImageEvidence';
import { useFieldProvenance, citedFieldImages, evidenceRelationLabel, provenanceCoverageUnavailable, formatProvenanceValue, groupRepeatedReports, ENGINE_PROPERTY_IDS } from './hooks/useFieldProvenance';
import { useFieldEvidence, type FieldEvidenceGroup } from './hooks/useFieldEvidence';
import FieldProvenanceDrawer from './FieldProvenanceDrawer';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { openVehiclePhoto } from './VehiclePhotoLightbox';
import type { FieldProvenance } from './hooks/useFieldProvenance';
import type { EvidenceImage } from './hooks/useVehicleImageEvidence';
import type { FeedVehicle } from '../../feed/types/feed';
import type { Vehicle } from './types';
import './vehicle-evidence.css';

const VehiclePopup = React.lazy(() => import('../../components/popups/VehiclePopup').then(module => ({ default: module.VehiclePopup })));

type ProfileFieldContext = {
  subject: Pick<Vehicle, 'id' | 'make' | 'model' | 'year'> & Partial<Vehicle>;
  matchField?: string;
};

interface FieldEvidencePopupProps {
  field: string;
  label: string;
  value: string;
  vehicleId: string;
  evidence?: FieldEvidenceGroup;
  /** Optional VIN decode data (passed for VIN field) */
  vinDecode?: Record<string, any> | null;
  context?: ProfileFieldContext;
}

/** The selected attribute remains framed by this vehicle; peer matches never replace its evidence. */
function FieldContext({ field, label, value, context, reports, images, details }: {
  field: string; label: string; value: string; context: ProfileFieldContext;
  reports: FieldProvenance['observations']; images: EvidenceImage[]; details: React.ReactNode;
}) {
  const { openPopup } = usePopup();
  const subject = context.subject;
  const canScope = !!subject.make && !!subject.model && field !== 'make';
  const [sameModel, setSameModel] = useState(true);
  const [showPeers, setShowPeers] = useState(false);
  const matchField = context.matchField || field;
  const allowed = ['year', 'make', 'model', 'series', 'trim', 'body_style', 'drivetrain', 'transmission', 'transmission_model'];
  const subjectValue = (key: string) => subject[key as keyof Vehicle];
  const filters: [string, string | number][] = allowed.includes(matchField)
    ? [[matchField, matchField === 'year' ? Number(value) : String(subjectValue(matchField) || value)]]
    : field === 'location'
      ? ['city', 'state'].flatMap(key => typeof subjectValue(key) === 'string' && subjectValue(key) ? [[key, subjectValue(key) as string] as [string, string]] : [])
      : field === 'engine_type'
        ? ['engine_type', 'engine_size'].flatMap(key => typeof subjectValue(key) === 'string' && subjectValue(key) ? [[key, subjectValue(key) as string] as [string, string]] : []) : [];
  if (filters.length && canScope && sameModel) {
    filters.push(['make', subject.make!], ['model', subject.model!]);
    if (subject.year) filters.push(['year', subject.year]);
  }
  if (field === 'model' && subject.make) filters.push(['make', subject.make]);
  const peers = useQuery({
    queryKey: ['profile-field-matches', subject.id, filters],
    enabled: showPeers && filters.length > 0,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      let query = supabase.from('vehicles').select('id,year,make,model,trim,thumbnail_url:primary_image_url,transmission,transmission_model,drivetrain,engine_size,body_style,created_at')
        .eq('is_public', true).is('deleted_at', null).or('listing_kind.is.null,listing_kind.neq.non_vehicle_item').neq('id', subject.id);
      for (const [column, filterValue] of filters) query = query.eq(column, filterValue);
      const { data, error } = await query.order('updated_at', { ascending: false }).limit(8).abortSignal(signal);
      if (error) throw error;
      return (data || []) as Pick<FeedVehicle, 'id' | 'year' | 'make' | 'model' | 'trim' | 'thumbnail_url' | 'created_at' | 'transmission' | 'transmission_model' | 'drivetrain' | 'engine_size' | 'body_style'>[];
    },
  });
  const specific = reports.filter((report, index) => reports.findIndex(other => other.id === report.id) === index).filter(report => report.value?.trim().toLowerCase() === value.trim().toLowerCase()
    || (field === 'drivetrain' && /\bNP\d{3}\b|transfer case|t-case/i.test(report.content || '')));
  return <div className="vp-field-context">
    <p className="vp-field-context__scope">{label.replace(/^./, c => c.toUpperCase())} · this vehicle</p>
    {specific.slice(0, 2).map(report => <article key={report.id} className="vp-field-context__report">
      {report.content && <p>{report.content}</p>}
      <small>{(report.source_slug || 'Retained report').replace(/_/g, ' ')}{report.observed_at && <> · {new Date(report.observed_at).toLocaleDateString('en-US', { timeZone: 'UTC' })}</>}</small>
    </article>)}
    {images.length > 0 && <section aria-label={`${value} related photographs`}>
      <h3>Related photographs</h3>
      <div className="vp-field-context__images">{images.slice(0, 6).map(image => <button key={image.id} type="button" onClick={() => openVehiclePhoto(image.id)} aria-label={`Inspect ${image.vehicle_zone?.replace(/_/g, ' ') || label}`}>
        <img src={image.thumbnail_url || image.medium_url || image.image_url} alt="" width={160} height={110} loading="lazy" />
      </button>)}</div>
      <p className="vp-field-context__note">Related views help inspection; they do not establish the specific configuration.</p>
    </section>}
    {filters.length > 0 && <section aria-label={`${value} data segment`}>
      <div className="vp-field-context__segment-head"><button type="button" aria-expanded={showPeers} onClick={() => setShowPeers(current => !current)}>Other profiles with this configuration</button>
        {showPeers && canScope && <button type="button" onClick={() => setSameModel(current => !current)}>{sameModel ? 'Wider scope' : `Within ${subject.year || ''} ${subject.model}`}</button>}
      </div>
      {showPeers && <>
      <p className="vp-field-context__note">{canScope && sameModel ? `${subject.year || ''} ${subject.make} ${subject.model} · ` : ''}Exact recorded labels · up to 8 other public profiles</p>
      {peers.isPending && <p role="status">Reading related profiles…</p>}
      {peers.isError && <p role="status">Related profiles could not be read. <button type="button" onClick={() => void peers.refetch()}>Retry</button></p>}
      {peers.data?.length === 0 && <p>No other profiles returned in this scope.</p>}
      <div className="vp-field-context__peers">{peers.data?.map(peer => <button type="button" key={peer.id} onClick={() => openPopup(
        <React.Suspense fallback={<p role="status">Reading profile…</p>}><VehiclePopup vehicle={peer} showRelatedSales={false} /></React.Suspense>,
        [peer.year, peer.make, peer.model, peer.trim].filter(Boolean).join(' '), 560,
        false,
      )}>
        {peer.thumbnail_url && <img src={optimizeImageUrl(peer.thumbnail_url, 'thumbnail') || peer.thumbnail_url} alt="" width={56} height={42} loading="lazy" />}
        <span>{[peer.year, peer.make, peer.model, peer.trim].filter(Boolean).join(' ')}</span>
      </button>)}</div>
      </>}
    </section>}
    <details className="vp-field-context__evidence"><summary>Sources & observations for this vehicle</summary>{details}</details>
  </div>;
}

const SOURCE_LABELS: Record<string, string> = {
  vin_decode: 'VIN decode (NHTSA)',
  nhtsa: 'NHTSA',
  bat: 'Bring a Trailer',
  bat_import: 'Bring a Trailer',
  ai_extraction: 'AI extraction',
  vision: 'Vision analysis',
  user: 'User input',
  enrichment: 'Data enrichment',
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
  return sourceType.replace(/_/g, ' ');
}

const FieldEvidencePopup: React.FC<FieldEvidencePopupProps> = ({
  field, label, value, vehicleId, evidence, vinDecode, context,
}) => {
  const { closeTop } = usePopup();
  const inventory = useVehicleImageEvidence(vehicleId, context ? field : undefined);
  const provenance = useFieldProvenance(vehicleId, field);
  const drivetrainContext = useFieldProvenance(context && field === 'drivetrain' ? vehicleId : '', 'transmission');
  const claims = useFieldEvidence(vehicleId);
  const claimGroup = evidence || claims.evidence[field];
  const rows = inventory.data?.images || [];
  const images = relatedFieldImages(rows, field);
  const citations = citedFieldImages(provenance.data, rows);
  const imagesLoading = inventory.isLoading || provenance.isLoading;
  const awaiting = rows.filter(image => !hasImageAnalysis(image)).length;
  const imageReadFailed = !!inventory.error || !!provenance.error || (!provenance.isLoading && provenance.data === null);
  const imageObservations = provenance.data?.image_observations || [];
  const isEngineProperty = !!ENGINE_PROPERTY_IDS[field];
  const resolvedValue = isEngineProperty
    ? (provenance.data?.canonical?.status === 'resolved' ? provenance.data.canonical.value : null)
    : provenance.data?.value;
  const hasClaimImageReference = !!claimGroup?.sources.some(source => source.source_image_id);
  const hasRecordedImageReference = hasClaimImageReference || imageObservations.length > 0 || !!provenance.data?.source_image_url || (provenance.data?.evidence || []).some(source => source.image_id && (source.source !== 'field_evidence' || source.verified === true));

  const sources = claimGroup?.sources || (provenance.data?.evidence || [])
    .filter(source => source.source !== 'field_evidence' || source.verified === true)
    .map((source, index) => ({ id: `${source.source}-${index}`, source_type: source.source_type || source.source, field_value: source.value, created_at: source.at }));
  const sortedSources = [...sources].sort((a, b) => trustRank(a.source_type) - trustRank(b.source_type));

  if (!context && !provenance.isLoading && provenance.data === null && !provenance.error) {
    return <div className="field-evidence-popup"><p role="status">Field evidence is unavailable or this record is private.</p></div>;
  }
  if (!context && provenanceCoverageUnavailable(provenance.data)) {
    return <div className="field-evidence-popup"><p role="status">Source evidence could not be loaded completely for this field. Coverage is unknown.</p>
      <Button type="button" variant="secondary" disabled={provenance.isFetching} onClick={() => void provenance.refetch()}>Retry source evidence</Button>
    </div>;
  }

  const evidenceContent = (
    <div className="field-evidence-popup">
      <header className="field-evidence-heading">
        <div className="ev-label">{label}</div>
        {!isEngineProperty && <div className={`field-evidence-value${field === 'vin' ? ' field-evidence-value--identifier' : ''}`}>{value}</div>}
      </header>

      {provenance.data && <div style={{ marginBottom: 8 }}>
        <span className="ev-label">{isEngineProperty ? 'RESOLVED SOURCE CLAIM' : 'RECORDED VEHICLE VALUE'}</span>{' '}
        <strong>{resolvedValue ? formatProvenanceValue(field, resolvedValue) : 'Unknown'}</strong>
        {isEngineProperty && provenance.data.canonical?.status === 'unavailable'
          ? <p role="status">The resolved value could not be read. Source reports below remain attributed claims.</p>
          : !resolvedValue && <p>The canonical value is unknown. Source reports below remain attributed claims.</p>}
        {isEngineProperty && resolvedValue && <p>Resolved from retained reports; this does not establish factory or current physical configuration.</p>}
        {field === 'vin' && (provenance.data as any).identifier_consensus?.citation_summary && <p role="status" data-testid="identifier-consensus">
          {(provenance.data as any).identifier_consensus.status === 'resolved' ? 'Corroborated by ' : 'Claimed by '}
          {(provenance.data as any).identifier_consensus.citation_summary}
          {(provenance.data as any).identifier_consensus.status === 'conflict' ? ' · sources disagree' : ''}
        </p>}
        {claimGroup?.hasConflict && claimGroup.conflictType === 'genuine'
          ? <p role="status">Source claims differ. No resolution is established by this display.</p>
          : sortedSources.length > 1 && <p role="status">Multiple source claims are shown. This display does not establish whether differences have been resolved.</p>}
      </div>}

      {/* VIN decode section */}
      {field === 'vin' && vinDecode && Object.keys(vinDecode).length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div className="field-evidence-section-title">
            NHTSA decode
          </div>
          <div className="field-evidence-decode">
            {Object.entries(vinDecode)
              .filter(([, v]) => v != null && v !== '' && v !== 'Not Applicable')
              .slice(0, 12)
              .map(([k, v]) => (
                <React.Fragment key={k}>
                  <span className="field-evidence-term">
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
      {claimGroup && claimGroup.sources.length > 0 ? <FieldProvenanceDrawer
        fieldName={field} fieldLabel={label} group={claimGroup} isOpen onToggle={() => {}} onNavigate={closeTop}
        drawerId={`popup-provenance-${field}`}
      /> : sortedSources.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div className="field-evidence-section-title">
            {sortedSources.length} source claim{sortedSources.length !== 1 ? 's' : ''}
          </div>
          {sortedSources.map((src, i) => (
            <div key={src.id || i} className="field-evidence-source-claim">
              <span className="field-evidence-term">{sourceLabel(src.source_type)}</span>
              <span>{src.field_value || '\u2014'}</span>
            </div>
          ))}
        </div>
      )}
      {claims.error && <p role="status">Claim details and correction history could not be read.</p>}
      {claims.loading && <p role="status">Reading claim details and correction history…</p>}

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
      {groupRepeatedReports((provenance.data?.observations || []).filter(obs => !imageObservations.some(imageObs => imageObs.observation_id === obs.id)),
        provenance.data?.canonical?.observation_id).map(({ report: obs, repeats }) => (
        <div key={obs.id} className="field-evidence-report">
          <div className="ev-label">SOURCE REPORT · <PrefetchLink to={`/vehicle/${vehicleId}/observation/${obs.id}`} onClick={closeTop}>Inspect observation {obs.id}</PrefetchLink></div>
          {isEngineProperty && provenance.data?.canonical?.observation_id === obs.id && <div className="ev-label">RESOLVED REPORT</div>}
          {webSourceUrl(obs.source_url) ? <a href={webSourceUrl(obs.source_url)!} target="_blank" rel="noopener noreferrer">{obs.source_slug || 'Source observation'} ↗</a> : <span>{obs.source_slug || 'Source observation'} · Link unavailable</span>}
          <span> · {obs.value ? formatProvenanceValue(field, obs.value) : 'Value not recorded'}</span>
          {repeats.length > 0 && <details>
            <summary>Same claim captured {repeats.length + 1} times from this page</summary>
            <p>Repeated captures of one listing page are one source claim, not corroboration.</p>
            {repeats.map(repeat => (
              <div key={repeat.id}>
                <PrefetchLink to={`/vehicle/${vehicleId}/observation/${repeat.id}`} onClick={closeTop}>Inspect observation {repeat.id}</PrefetchLink>
                <span> · Observation time: {repeat.observed_at ? new Date(repeat.observed_at).toLocaleString() : 'Unknown'}</span>
              </div>
            ))}
          </details>}
          {(obs.content || obs.source_observation_id) && <details>
            <summary>Read retained evidence</summary>
            {obs.content && <div className="ev-proof-limitation" style={{ whiteSpace: 'pre-wrap' }}>
              <span className="ev-label">OBSERVATION EXCERPT · UP TO 400 CHARACTERS</span>
              <p>{obs.content}</p>
            </div>}
            {obs.source_observation_id && <>
              {/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obs.source_observation_id)
                && <PrefetchLink to={`/vehicle/${vehicleId}/observation/${obs.source_observation_id}`} onClick={closeTop}>Inspect retained source record</PrefetchLink>}
              <div>Source observation time: {obs.source_observed_at || 'Unknown'} · Source record time: {obs.source_recorded_at || 'Unknown'}</div>
              {obs.source_event_time_status === 'unknown' && <div>Source event time: Unknown</div>}
              {obs.independent_source === false && <p>This report derives from the retained source record; it is not an independent confirmation.</p>}
              {obs.identity_resolution_status === 'unverified' && <p>This report leaves vehicle identity unverified.</p>}
              {obs.factory_configuration_status === 'unknown' && obs.current_configuration_status === 'unknown'
                && <p>Factory and current configuration are unknown in this report.</p>}
            </>}
          </details>}
          <div style={{ color: 'var(--text-secondary)' }}>Observation time: {obs.observed_at ? new Date(obs.observed_at).toLocaleString() : 'Unknown'} · Ingest time: {obs.ingested_at ? new Date(obs.ingested_at).toLocaleString() : 'Unavailable'}</div>
          <div style={{ color: 'var(--text-secondary)' }}>Method: {obs.extraction_method || 'Unavailable'} · Model self-score (not corroboration): {obs.confidence == null ? 'Unavailable' : obs.confidence}</div>
        </div>
      ))}
      {/* A zone match identifies an area to inspect; it does not support a particular claim. */}
      {!imagesLoading && images.length > 0 && (
        <div>
          <div className="field-evidence-section-title">
            Related images · Area match ({images.length})
          </div>
          <p>Area matches help inspection; they do not confirm {value}.</p>
          <div className="field-evidence-related-images">
            {images.map(img => (
              <a href={img.image_url} target="_blank" rel="noopener noreferrer" key={img.id} aria-label={`Inspect related image: ${(img.vehicle_zone || field).replace(/_/g, ' ')}`}>
                <img
                  src={img.thumbnail_url || optimizeImageUrl(img.image_url, 'thumbnail') || img.image_url}
                  alt={img.vehicle_zone || field}
                  width={150} height={150}
                  loading="lazy"
                />
                {img.vehicle_zone && (
                  <span>
                    {img.vehicle_zone.replace(/_/g, ' ')}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {provenance.isLoading && <p role="status">Reading source evidence…</p>}
      {inventory.isLoading && <p role="status">Reading image evidence…</p>}
      {provenance.error && <div className="field-evidence-read-status">
        <p role="alert">Source evidence could not be read. Its absence has not been established.</p>
        <Button type="button" variant="secondary" disabled={provenance.isFetching} onClick={() => void provenance.refetch()}>Retry source evidence</Button>
      </div>}
      {inventory.error && <div className="field-evidence-read-status">
        <p role="alert">Image evidence could not be read. Its absence has not been established.</p>
        <Button type="button" variant="secondary" disabled={inventory.isFetching} onClick={() => void inventory.refetch()}>Retry image evidence</Button>
      </div>}
      {!imagesLoading && !imageReadFailed && citations.length === 0 && (
        <div className="field-evidence-gap">
          <div className="ev-label">{hasRecordedImageReference ? 'IMAGE CITATION OUTSIDE CURRENT GALLERY' : 'IMAGE CITATION MISSING'}</div>
          <p>{hasClaimImageReference ? 'The claim records an image reference above. Inspect that record for its attribution and supersession history.' : hasRecordedImageReference ? 'An image reference exists but could not be validated in the visible inventory.' : `No image citation is recorded for ${label.toLowerCase()}.`}</p>
          {awaiting > 0 && <p><strong>{awaiting}</strong> of {rows.length} visible image records are not marked complete by the image-processing pipeline. They may contain relevant evidence.</p>}
          {images.length === 0 && awaiting === 0 && <p>No matching image area is indexed in the records read.</p>}
          {inventory.data && !inventory.data.complete && <p>Showing {rows.length} of {inventory.data.total ?? 'an unknown number of'} visible records. This is a partial inventory.</p>}
        </div>
      )}
      {!imagesLoading && !imageReadFailed && sortedSources.length === 0 && citations.length === 0 && !provenance.data?.observations.length && <p>No source claim was returned for this field. The displayed value needs a source.</p>}
    </div>
  );
  return context ? <FieldContext field={field} label={label} value={value} context={context}
    reports={[
      ...(provenanceCoverageUnavailable(provenance.data) ? [] : provenance.data?.observations || []),
      ...(context && field === 'drivetrain' && !provenanceCoverageUnavailable(drivetrainContext.data)
        ? (drivetrainContext.data?.observations || []).filter(report => /\bNP\d{3}\b|transfer case|t-case/i.test(report.content || '')) : []),
    ]}
    images={[...citations, ...images.filter(image => !citations.some(citation => citation.id === image.id))]}
    details={provenanceCoverageUnavailable(provenance.data)
      ? <p role="status">Source evidence could not be loaded completely for this field. <Button type="button" variant="secondary" disabled={provenance.isFetching} onClick={() => void provenance.refetch()}>Retry source evidence</Button></p>
      : !provenance.isLoading && provenance.data === null && !provenance.error
        ? <p role="status">Field evidence is unavailable or this record is private.</p> : evidenceContent} /> : evidenceContent;
};

export default FieldEvidencePopup;
