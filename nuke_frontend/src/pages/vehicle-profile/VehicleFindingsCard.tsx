/**
 * VehicleFindingsCard — surfaces the high-signal AI image-analysis findings
 * that the BYOK pass wrote into vehicle_images.ai_scan_metadata.
 *
 * Pulls metadata for the vehicle and rolls it into identity / powertrain /
 * provenance / evidence sections. Renders null if there are no findings.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';

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
}

function inc(map: Record<string, number>, key: string | null | undefined) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

const VehicleFindingsCard: React.FC<Props> = ({ vehicleId }) => {
  const [findings, setFindings] = useState<Findings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata')
        .eq('vehicle_id', vehicleId)
        .limit(5000);
      if (error) return;
      const rows = data || [];
      const total = rows.length;
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
        const m = (r as any).ai_scan_metadata as Record<string, any> | null;
        if (!m) continue;
        if (m.classifier === 'claude-opus-4-7-byok') out.classified++;
        if (m.error) out.errors++;
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

  const criticalEntries = Object.entries(findings.critical).sort((a, b) => b[1] - a[1]);
  const attributionEntries = Object.entries(findings.attribution).sort((a, b) => b[1] - a[1]);
  const privacyEntries = Object.entries(findings.privacy).sort((a, b) => b[1] - a[1]);

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '3px 0', gap: 8 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary, #666)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: 'Courier New, monospace', fontSize: 11, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );

  const list = (arr: string[]) => arr.length === 0 ? '—' : arr.join(', ');

  return (
    <CollapsibleWidget
      variant="profile"
      title="Image-Analysis Findings"
      defaultCollapsed={false}
      badge={<span className="widget__count">{findings.classified}</span>}
    >
      <div style={{ padding: '8px 12px', fontFamily: 'Arial, sans-serif', color: 'var(--text, #1a1a1a)' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>identity</div>
        {findings.vins.length > 0 && row('VIN', list(findings.vins))}
        {findings.plates.length > 0 && row('plate', list(findings.plates))}
        {findings.colors.length > 0 && row('color', list(findings.colors.slice(0, 8)))}
        {findings.interiorTrims.length > 0 && row('interior trim', list(findings.interiorTrims))}

        {(findings.engines.length > 0 || findings.transmissions.length > 0 || findings.odometers.length > 0 || findings.mileageAtListings.length > 0) && (
          <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 10, marginBottom: 4 }}>powertrain & mileage</div>
        )}
        {findings.engines.length > 0 && row('engine', list(findings.engines))}
        {findings.transmissions.length > 0 && row('transmission', list(findings.transmissions))}
        {findings.odometers.length > 0 && row('odometer (image)', list(findings.odometers))}
        {findings.mileageAtListings.length > 0 && row('mileage at listing', list(findings.mileageAtListings))}

        {findings.sources.length > 0 && (
          <>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 10, marginBottom: 4 }}>provenance source</div>
            {row('source', list(findings.sources))}
          </>
        )}

        {criticalEntries.length > 0 && (
          <>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 10, marginBottom: 4 }}>critical evidence ({criticalEntries.reduce((s, [, n]) => s + n, 0)})</div>
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.5 }}>
              {criticalEntries.map(([k, n]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '2px 0' }}>
                  <span>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--text-secondary, #666)' }}>{n}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {attributionEntries.length > 0 && (
          <>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 10, marginBottom: 4, color: 'var(--error, #c00)' }}>attribution concerns ({attributionEntries.reduce((s, [, n]) => s + n, 0)})</div>
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.5 }}>
              {attributionEntries.map(([k, n]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '2px 0' }}>
                  <span>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--error, #c00)' }}>{n}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {privacyEntries.length > 0 && (
          <>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 10, marginBottom: 4 }}>privacy gate ({privacyEntries.reduce((s, [, n]) => s + n, 0)})</div>
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.5 }}>
              {privacyEntries.map(([k, n]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '2px 0' }}>
                  <span>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--text-secondary, #666)' }}>{n}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Deep substrate — the JSONB backbone the gate writes per image */}
        {(() => {
          const phaseEntries = Object.entries(findings.phases).sort((a, b) => b[1] - a[1]);
          const sceneEntries = Object.entries(findings.scenes).sort((a, b) => b[1] - a[1]);
          const makeEntries = Object.entries(findings.makeGuesses).sort((a, b) => b[1] - a[1]);
          const modelEntries = Object.entries(findings.modelGuesses).sort((a, b) => b[1] - a[1]);
          const yearEntries = Object.entries(findings.yearGuesses).sort((a, b) => b[1] - a[1]);
          const colorObsEntries = Object.entries(findings.colorsObserved).sort((a, b) => b[1] - a[1]);
          const avgConfidence = findings.confidenceCount > 0 ? (findings.confidenceSum / findings.confidenceCount) : null;
          const blockHeader = (label: string, total?: number) => (
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 12, marginBottom: 4 }}>
              {label}{total != null ? ` (${total})` : ''}
            </div>
          );
          const distroBlock = (entries: [string, number][], limit = 12, color = 'var(--text-secondary, #666)') => (
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.5 }}>
              {entries.slice(0, limit).map(([k, n]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '2px 0' }}>
                  <span>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color }}>{n}</span>
                </div>
              ))}
              {entries.length > limit && (
                <div style={{ fontSize: 9, color: 'var(--text-secondary, #666)', paddingTop: 4 }}>
                  +{entries.length - limit} more
                </div>
              )}
            </div>
          );
          return (
            <>
              {phaseEntries.length > 0 && (
                <>
                  {blockHeader('build phases', phaseEntries.reduce((s, [, n]) => s + n, 0))}
                  {distroBlock(phaseEntries)}
                </>
              )}

              {sceneEntries.length > 0 && (
                <>
                  {blockHeader('scene classes', sceneEntries.reduce((s, [, n]) => s + n, 0))}
                  {distroBlock(sceneEntries)}
                </>
              )}

              {colorObsEntries.length > 0 && (
                <>
                  {blockHeader('colors observed', colorObsEntries.reduce((s, [, n]) => s + n, 0))}
                  {distroBlock(colorObsEntries, 8)}
                </>
              )}

              {(makeEntries.length > 0 || modelEntries.length > 0 || yearEntries.length > 0) && (
                <>
                  <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginTop: 12, marginBottom: 4, color: makeEntries.length > 1 ? 'var(--error, #c00)' : undefined }}>
                    identity guesses
                    {makeEntries.length > 1 && ' — contamination signal (>1 make)'}
                  </div>
                  {makeEntries.length > 0 && row('makes', makeEntries.map(([k, n]) => `${k} ${n}`).join(', '))}
                  {modelEntries.length > 0 && row('models', modelEntries.map(([k, n]) => `${k} ${n}`).join(', '))}
                  {yearEntries.length > 0 && row('years', yearEntries.map(([k, n]) => `${k} ${n}`).join(', '))}
                </>
              )}

              {findings.partNumbers.length > 0 && (
                <>
                  {blockHeader('part numbers seen', findings.partNumbers.length)}
                  <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.6, color: 'var(--text-secondary, #666)' }}>
                    {findings.partNumbers.slice(0, 30).join(' · ')}
                    {findings.partNumbers.length > 30 && ` … +${findings.partNumbers.length - 30}`}
                  </div>
                </>
              )}
            </>
          );
        })()}

        <div style={{ marginTop: 14, paddingTop: 8, borderTop: '1px solid var(--text-disabled, #ddd)', fontSize: 9, color: 'var(--text-secondary, #666)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{findings.classified}/{findings.total} photos analyzed by claude-opus-4-7-byok</span>
          {findings.confidenceCount > 0 && (
            <span>avg confidence {(findings.confidenceSum / findings.confidenceCount).toFixed(2)}</span>
          )}
          {findings.errors > 0 && (
            <span style={{ color: 'var(--error, #c00)' }}>{findings.errors} fetch errors</span>
          )}
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default VehicleFindingsCard;
