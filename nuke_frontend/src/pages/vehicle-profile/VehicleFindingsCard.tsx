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

      for (const r of rows) {
        const m = (r as any).ai_scan_metadata as Record<string, any> | null;
        if (!m) continue;
        if (m.classifier === 'claude-opus-4-7-byok') out.classified++;
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
        inc(out.critical, m.critical);
        inc(out.privacy, m.privacy_concern);
        inc(out.attribution, m.attribution_concern);
      }
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

        <div style={{ marginTop: 10, fontSize: 9, color: 'var(--text-secondary, #666)' }}>
          {findings.classified}/{findings.total} photos analyzed by claude-opus-4-7-byok
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default VehicleFindingsCard;
