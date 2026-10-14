/**
 * VehicleFindingsCard — surfaces the high-signal AI image-analysis findings
 * that the BYOK pass wrote into vehicle_images.ai_scan_metadata.
 *
 * Pulls metadata for the vehicle and rolls it into identity / powertrain /
 * provenance / evidence sections, rendered through the kit: a Section with its
 * coverage (images analyzed of images read, as of the newest analysis clock),
 * Rows of label/value claims, no inline style. Renders null with no findings.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Section, Rows, Row, Text } from '../../kit';
import { useVehicleProfile } from './VehicleProfileContext';

interface Props { vehicleId: string }

interface Findings {
  total: number;
  classified: number;
  vins: string[];
  plates: string[];
  engines: string[];
  transmissions: string[];
  colors: string[];
  interiorTrims: string[];
  odometers: string[];
  mileageAtListings: string[];
  sources: string[];
  critical: Record<string, number>;
  privacy: Record<string, number>;
  attribution: Record<string, number>;
  // Deep substrate from ai_scan_metadata — the JSONB backbone
  phases: Record<string, number>;        // build/restoration phases (sealer_pre_topcoat, bodywork, paint_correction…)
  scenes: Record<string, number>;        // scene_class (detail, document, exterior, engine_bay…)
  makeGuesses: Record<string, number>;   // contamination signal if >1 (other agent saw 6 makes guessed for Mustang bucket)
  modelGuesses: Record<string, number>;
  yearGuesses: Record<string, number>;
  colorsObserved: Record<string, number>;
  partNumbers: string[];
  errors: number;                        // images that failed to fetch / classify
  confidenceSum: number;
  confidenceCount: number;
  latestAnalyzedAt: string | null;   // the newest vision_analyzed_at among the rows read: the coverage clock
}

// The projection this card sent before vehicle_image_findings existed; used only while that function is not deployed.
const LEGACY_FINDINGS_SELECT =
  'classifier:ai_scan_metadata->classifier, error:ai_scan_metadata->error, vin:ai_scan_metadata->vin, license_plate:ai_scan_metadata->license_plate, engine:ai_scan_metadata->engine, engine_guess:ai_scan_metadata->engine_guess, engine_badge:ai_scan_metadata->engine_badge, transmission:ai_scan_metadata->transmission, color_visible:ai_scan_metadata->color_visible, interior_trim:ai_scan_metadata->interior_trim, odometer:ai_scan_metadata->odometer, mileage_at_listing:ai_scan_metadata->mileage_at_listing, source:ai_scan_metadata->source, part_number:ai_scan_metadata->part_number, critical:ai_scan_metadata->critical, privacy_concern:ai_scan_metadata->privacy_concern, attribution_concern:ai_scan_metadata->attribution_concern, phase:ai_scan_metadata->phase, scene_class:ai_scan_metadata->scene_class, make_guess:ai_scan_metadata->make_guess, model_guess:ai_scan_metadata->model_guess, year_guess:ai_scan_metadata->year_guess, confidence:ai_scan_metadata->confidence, byok_scene_type:ai_scan_metadata->byok_deep_analysis->scene_type, byok_build_phase_guess:ai_scan_metadata->byok_deep_analysis->build_phase_guess, byok_confidence:ai_scan_metadata->byok_deep_analysis->confidence, vision_analyzed_at';

const isMissingFunction = (error: { code?: string; message?: string } | null | undefined): boolean =>
  !!error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? ''));

function inc(map: Record<string, number>, key: string | null | undefined) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

const VehicleFindingsCard: React.FC<Props> = ({ vehicleId }) => {
  const [findings, setFindings] = useState<Findings | null>(null);
  // A plate read off a photo is personal data: masked for anyone but the owner (privacy is masking, not hiding).
  const { isRowOwner, isVerifiedOwner, hasContributorAccess } = useVehicleProfile();
  const canSeeIdentity = isRowOwner || isVerifiedOwner || hasContributorAccess;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // One pass in the database over the frames this viewer may read (vehicle_image_findings, SECURITY INVOKER, so the
      // image row policies still decide which). It replaces 26 arrow projections of ai_scan_metadata, each of which
      // detoasted every frame's blob again (K5, anon, 2026-10-14: 534-624 ms and 239,000 buffer hits, now about 160 ms).
      // `rows` holds each frame's non-null keys under the same names as before; `total` counts every frame read.
      let rows: any[] = [];
      let total = 0;
      const read = await supabase.rpc('vehicle_image_findings', { p_vehicle_id: vehicleId });
      if (!read.error && read.data) {
        rows = Array.isArray((read.data as any).rows) ? (read.data as any).rows : [];
        total = typeof (read.data as any).total === 'number' ? (read.data as any).total : rows.length;
      } else if (isMissingFunction(read.error)) {
        // The reader's migration has not been applied yet: read the frames the way this card always did.
        const legacy = await supabase.from('vehicle_images').select(LEGACY_FINDINGS_SELECT).eq('vehicle_id', vehicleId).limit(5000);
        if (legacy.error) return;
        rows = legacy.data || [];
        total = rows.length;
      } else {
        return;
      }
      const out: Findings = {
        total,
        classified: 0,
        vins: [],
        plates: [],
        engines: [],
        transmissions: [],
        colors: [],
        interiorTrims: [],
        odometers: [],
        mileageAtListings: [],
        sources: [],
        critical: {},
        privacy: {},
        attribution: {},
        phases: {},
        scenes: {},
        makeGuesses: {},
        modelGuesses: {},
        yearGuesses: {},
        colorsObserved: {},
        partNumbers: [],
        errors: 0,
        confidenceSum: 0,
        confidenceCount: 0,
        latestAnalyzedAt: null,
      };
      const vins = new Set<string>();
      const plates = new Set<string>();
      const engines = new Set<string>();
      const transmissions = new Set<string>();
      const colors = new Set<string>();
      const interiors = new Set<string>();
      const odos = new Set<string>();
      const mils = new Set<string>();
      const sources = new Set<string>();
      const parts = new Set<string>();

      for (const r of rows) {
        // Arrow projections land the keys flat on the row, same names as before.
        const m = r as Record<string, any>;
        // Canonical T1 marker: the BYOK deep pass writes a NESTED byok_deep_analysis
        // object, NOT the flat `classifier` string the old code looked for (which no
        // writer emits — so this card read 0 analyzed for every byok vehicle). Its
        // scalar subfields are projected flat as byok_* (see select above) so the
        // multi-MB blobs stay server-side while the canonical marker still counts.
        const hasByokDeep = m.byok_scene_type != null || m.byok_build_phase_guess != null || m.byok_confidence != null;
        if (hasByokDeep || m.classifier === 'claude-opus-4-7-byok' || m.classifier === 'caller-byok-cascade') out.classified++;
        if (m.byok_scene_type) inc(out.scenes, String(m.byok_scene_type));
        if (m.byok_build_phase_guess) inc(out.phases, String(m.byok_build_phase_guess));
        if (typeof m.byok_confidence === 'number') { out.confidenceSum += m.byok_confidence; out.confidenceCount++; }
        if (m.error) out.errors++;
        if (m.vision_analyzed_at && (!out.latestAnalyzedAt || String(m.vision_analyzed_at) > out.latestAnalyzedAt)) out.latestAnalyzedAt = String(m.vision_analyzed_at);
        if (m.vin) vins.add(String(m.vin));
        if (m.license_plate) plates.add(String(m.license_plate));
        if (m.engine) engines.add(String(m.engine));
        if (m.engine_guess) engines.add(String(m.engine_guess));
        if (m.engine_badge) engines.add(String(m.engine_badge));
        if (m.transmission) transmissions.add(String(m.transmission));
        if (m.color_visible) colors.add(String(m.color_visible));
        if (m.interior_trim) interiors.add(String(m.interior_trim));
        if (m.odometer) odos.add(String(m.odometer));
        if (m.mileage_at_listing) mils.add(String(m.mileage_at_listing));
        if (m.source) sources.add(String(m.source));
        if (m.part_number) parts.add(String(m.part_number));
        inc(out.critical, m.critical);
        inc(out.privacy, m.privacy_concern);
        inc(out.attribution, m.attribution_concern);
        // Deep substrate rollup — the JSONB backbone
        if (m.phase) inc(out.phases, String(m.phase));
        if (m.scene_class) inc(out.scenes, String(m.scene_class));
        if (m.make_guess) inc(out.makeGuesses, String(m.make_guess));
        if (m.model_guess) inc(out.modelGuesses, String(m.model_guess));
        if (m.year_guess != null) inc(out.yearGuesses, String(m.year_guess));
        if (m.color_visible) inc(out.colorsObserved, String(m.color_visible));
        if (typeof m.confidence === 'number') {
          out.confidenceSum += m.confidence;
          out.confidenceCount++;
        }
      }
      out.partNumbers = Array.from(parts);
      out.vins = Array.from(vins);
      out.plates = Array.from(plates);
      out.engines = Array.from(engines);
      out.transmissions = Array.from(transmissions);
      out.colors = Array.from(colors);
      out.interiorTrims = Array.from(interiors);
      out.odometers = Array.from(odos);
      out.mileageAtListings = Array.from(mils);
      out.sources = Array.from(sources);
      if (!cancelled) setFindings(out);
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (!findings || findings.classified === 0) return null;

  const humanize = (value: string) => value.replace(/_/g, ' ');
  const list = (arr: string[], limit = 8) => arr.slice(0, limit).map(humanize).join(', ') + (arr.length > limit ? ` +${arr.length - limit}` : '');
  const entries = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]);
  const total = (m: Record<string, number>) => Object.values(m).reduce((sum, n) => sum + n, 0);
  const counted = (m: Record<string, number>) => entries(m).map(([k, n]) => `${humanize(k)} ${n}`).join(', ');
  const distribution = (m: Record<string, number>, limit = 12) => {
    const rows = entries(m);
    if (rows.length === 0) return null;
    return <>
      {rows.slice(0, limit).map(([k, n]) => <Row key={k} label={humanize(k)} role="measure">{n.toLocaleString('en-US')}</Row>)}
      {rows.length > limit && <Text role="caption">+{rows.length - limit} more</Text>}
    </>;
  };
  const makeEntries = entries(findings.makeGuesses);
  const meanConfidence = findings.confidenceCount > 0 ? findings.confidenceSum / findings.confidenceCount : null;
  const coverage = { n: findings.classified, of: findings.total, grain: 'images analyzed', as_of: findings.latestAnalyzedAt };

  return (
    <Section title="Image analysis" coverage={coverage} ariaLabel="Image-analysis findings">
      <Rows title="Identity">
        {findings.vins.length > 0 && <Row label="VIN" role="measure">{list(findings.vins)}</Row>}
        {findings.plates.length > 0 && <Row label="Plate" role="measure">{canSeeIdentity ? list(findings.plates) : <span title="Visible to the owner">••••</span>}</Row>}
        {findings.colors.length > 0 && <Row label="Color">{list(findings.colors)}</Row>}
        {findings.interiorTrims.length > 0 && <Row label="Interior trim">{list(findings.interiorTrims)}</Row>}
      </Rows>
      <Rows title="Powertrain and mileage">
        {findings.engines.length > 0 && <Row label="Engine">{list(findings.engines)}</Row>}
        {findings.transmissions.length > 0 && <Row label="Transmission">{list(findings.transmissions)}</Row>}
        {findings.odometers.length > 0 && <Row label="Odometer in image" role="measure">{list(findings.odometers)}</Row>}
        {findings.mileageAtListings.length > 0 && <Row label="Mileage at listing" role="measure">{list(findings.mileageAtListings)}</Row>}
      </Rows>
      <Rows title="Provenance source">
        {findings.sources.length > 0 && <Row label="Source">{list(findings.sources)}</Row>}
      </Rows>
      <Rows title="Build phases" count={total(findings.phases)}>{distribution(findings.phases)}</Rows>
      <Rows title="Scene classes" count={total(findings.scenes)}>{distribution(findings.scenes)}</Rows>
      <Rows title="Colors observed" count={total(findings.colorsObserved)}>{distribution(findings.colorsObserved, 8)}</Rows>
      <Rows title="Part numbers seen" count={findings.partNumbers.length}>
        {findings.partNumbers.length > 0 && <Text role="caption">{findings.partNumbers.slice(0, 30).join(' · ')}{findings.partNumbers.length > 30 ? ` … +${findings.partNumbers.length - 30}` : ''}</Text>}
      </Rows>
      {/* Pipeline diagnostics describe the analysis run, not the vehicle. They stay with the people who can act on them. */}
      {canSeeIdentity && (
        <Rows title="Pipeline diagnostics, owner view">
          {entries(findings.critical).length > 0 && <Row label="Critical evidence" role="measure">{counted(findings.critical)}</Row>}
          {entries(findings.attribution).length > 0 && <Row label="Attribution concerns" role="measure">{counted(findings.attribution)}</Row>}
          {entries(findings.privacy).length > 0 && <Row label="Privacy gate" role="measure">{counted(findings.privacy)}</Row>}
          {makeEntries.length > 0 && <Row label={makeEntries.length > 1 ? 'Makes guessed, more than one: contamination signal' : 'Makes guessed'} role="measure">{makeEntries.map(([k, n]) => `${k} ${n}`).join(', ')}</Row>}
          {entries(findings.modelGuesses).length > 0 && <Row label="Models guessed" role="measure">{entries(findings.modelGuesses).map(([k, n]) => `${k} ${n}`).join(', ')}</Row>}
          {entries(findings.yearGuesses).length > 0 && <Row label="Years guessed" role="measure">{entries(findings.yearGuesses).map(([k, n]) => `${k} ${n}`).join(', ')}</Row>}
          {meanConfidence != null && <Row label="Mean reported confidence" role="measure">{meanConfidence.toFixed(2)}</Row>}
          {findings.errors > 0 && <Row label="Images that failed to classify" role="measure">{findings.errors}</Row>}
        </Rows>
      )}
    </Section>
  );
};

export default VehicleFindingsCard;
