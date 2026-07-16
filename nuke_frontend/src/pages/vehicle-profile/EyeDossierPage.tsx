/**
 * EyeDossierPage — the due-diligence dossier as a shareable, printable page.
 *
 * The same Eye read the profile shows in its drill popup, rendered as a full
 * standalone report a buyer can save as PDF or a seller can hand over: the band
 * the evidence defends vs the price, the appraiser's basis, system grades, the
 * findings ledger with the frame each cites, what would change the number, and
 * the if-it-verifies scenario (separate, never blended).
 *
 * NOT a parallel data surface — a print/share view of the canonical substrate
 * (vehicle_condition_scores + appraisal_canon_checks + the appraise payload),
 * via the same hooks the in-app drill uses. Route: /vehicle/:id/dossier.
 *
 * Design system: Nuke utilitarian — Arial, ALL CAPS labels, mono data, 2px
 * borders, zero radius/shadow/gradient. Print CSS isolates the dossier so
 * "Save as PDF" produces the clean deliverable regardless of site chrome.
 */
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useEyeRead } from './hooks/useEyeRead';
import { useEyeLedger, type CanonCheck } from './hooks/useEyeLedger';
import { freshnessOf, agoLabel } from './valueFreshness';
import { normalizePoints, normalizeStrings, normalizeIiv, normalizeFlipPlan } from './hooks/eyeShape';

const SANS = 'Arial, sans-serif';
const MONO = '"Courier New", monospace';
const fmtUsd = (n: number) => '$' + Math.round(n).toLocaleString();

const LABEL: React.CSSProperties = {
  fontFamily: SANS, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: '#888',
};
const BODY: React.CSSProperties = { fontFamily: SANS, fontSize: 11, lineHeight: 1.5, color: '#111' };

const VERDICT_COLOR: Record<string, string> = {
  fail: '#d13438', suspect: '#b8860b', pass: '#004225',
  indeterminate: '#666', cannot_assess: '#999',
};
const SYSTEM_ORDER = ['identity', 'structure', 'mechanical', 'interior', 'exterior'];

interface VehicleBasics {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  price: number | null;
  heroUrl: string | null;
}

function useVehicleBasics(vehicleId: string | undefined): VehicleBasics | null | 'missing' {
  const [v, setV] = useState<VehicleBasics | null | 'missing'>(null);
  useEffect(() => {
    if (!vehicleId) return;
    let alive = true;
    Promise.all([
      supabase
        .from('vehicles')
        .select('id, year, make, model, vin, sale_price, sold_price, asking_price, price')
        .eq('id', vehicleId)
        .maybeSingle(),
      supabase
        .from('vehicle_images')
        .select('image_url, large_url')
        .eq('vehicle_id', vehicleId)
        .order('is_primary', { ascending: false })
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true, nullsFirst: false })
        .limit(1),
    ]).then(([veh, img]) => {
      if (!alive) return;
      const data = veh.data;
      if (!data) { setV('missing'); return; }
      const hero = img.data?.[0];
      setV({
        id: data.id, year: data.year, make: data.make, model: data.model, vin: data.vin,
        price: data.sale_price || data.sold_price || data.asking_price || data.price || null,
        heroUrl: hero?.large_url || hero?.image_url || null,
      });
    });
    return () => { alive = false; };
  }, [vehicleId]);
  return v;
}

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section style={{ marginBottom: 18, breakInside: 'avoid' }}>
    <div style={{ ...LABEL, color: '#111', marginBottom: 6, borderBottom: '2px solid #111', paddingBottom: 3 }}>{label}</div>
    {children}
  </section>
);

const GradeRow: React.FC<{ system: string; g: any }> = ({ system, g }) => {
  const grade = Number(g?.grade);
  const coverage = g?.coverage != null ? Math.round(Number(g.coverage) * 100) : null;
  return (
    <div style={{ borderBottom: '1px solid #eee', padding: '6px 0', breakInside: 'avoid' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 70px auto 1fr', gap: 8, alignItems: 'baseline' }}>
        <span style={{ ...LABEL, color: '#111' }}>{system}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2 }}>
          {Number.isFinite(grade) ? '▮'.repeat(grade) + '▯'.repeat(Math.max(0, 5 - grade)) : '—'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>{Number.isFinite(grade) ? `${grade}/5` : '—'}</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: '#666', textAlign: 'right' }}>{coverage != null ? `COVERAGE ${coverage}%` : ''}</span>
      </div>
      {g?.note && <div style={{ ...BODY, fontSize: 10, marginTop: 3, color: '#333' }}>{g.note}</div>}
    </div>
  );
};

const FindingRow: React.FC<{ c: CanonCheck }> = ({ c }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '64px 60px 1fr 34px', gap: 8, alignItems: 'start', padding: '6px 0', borderBottom: '1px solid #eee', breakInside: 'avoid' }}>
    {c.image_url
      ? <img src={c.image_url} alt="" width={64} height={48} style={{ width: 64, height: 48, objectFit: 'cover', border: '1px solid #ddd' }} loading="lazy" />
      : <div style={{ width: 64, height: 48, background: '#f5f5f5' }} />}
    <span style={{ ...LABEL, color: VERDICT_COLOR[c.verdict] || '#111', paddingTop: 2 }}>{c.verdict}</span>
    <div>
      <div style={{ ...LABEL, color: '#666' }}>{c.canon_ref} · {c.part}</div>
      <div style={{ ...BODY, fontSize: 10 }}>{c.evidence}</div>
    </div>
    <span style={{ fontFamily: MONO, fontSize: 9, color: '#666', textAlign: 'right', paddingTop: 2 }}>
      {c.confidence != null ? Number(c.confidence).toFixed(2) : ''}
    </span>
  </div>
);

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #eye-dossier, #eye-dossier * { visibility: visible !important; }
  #eye-dossier { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
  #eye-dossier .no-print { display: none !important; }
  @page { margin: 16mm; }
}
`;

const EyeDossierPage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const vehicle = useVehicleBasics(vehicleId);
  const eyeRead = useEyeRead(vehicleId);
  const { payload, loaded, findings, counts, totalChecks, refused } = useEyeLedger(vehicleId);

  const title = vehicle && vehicle !== 'missing'
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'
    : 'Vehicle';

  useEffect(() => { document.title = `Dossier — ${title}`; }, [title]);

  const band = eyeRead?.band ?? null;
  const readFresh = eyeRead ? freshnessOf(eyeRead.computedAt) : null;
  const price = vehicle && vehicle !== 'missing' ? vehicle.price : null;
  const bandUsd = payload?.band_usd;
  const iiv = normalizeIiv(payload?.if_it_verifies);
  const wwctn = normalizeStrings(payload?.what_would_change_the_number);
  const drivers = normalizePoints(payload?.top_value_drivers, 'driver');
  const risks = normalizePoints(payload?.top_value_risks, 'risk');
  const flipPlan = normalizeFlipPlan(payload?.flip_plan);
  const grades = payload?.system_grades || null;

  const notReady = loaded && !eyeRead && totalChecks === 0;

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <style>{PRINT_CSS}</style>
      <div id="eye-dossier" style={{ maxWidth: 780, margin: '0 auto', padding: '24px 20px', background: '#fff' }}>
        {/* Masthead */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111', paddingBottom: 8, marginBottom: 12 }}>
          <div>
            <div style={{ ...LABEL, color: '#111' }}>Due-Diligence Dossier · The Eye</div>
            <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 700, color: '#111', marginTop: 2 }}>{title}</div>
            {vehicle && vehicle !== 'missing' && vehicle.vin && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: '#666' }}>VIN {vehicle.vin}</div>
            )}
          </div>
          <div className="no-print" style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.print()} style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '6px 10px', border: '2px solid #111', background: '#fff', cursor: 'pointer' }}>
              PRINT / SAVE PDF
            </button>
            <Link to={`/vehicle/${vehicleId}`} style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '6px 10px', border: '2px solid #ccc', color: '#333', textDecoration: 'none' }}>
              ← PROFILE
            </Link>
          </div>
        </div>

        {/* Lead photo — the car this dossier is about */}
        {vehicle && vehicle !== 'missing' && vehicle.heroUrl && (
          <img
            src={vehicle.heroUrl}
            alt={title}
            style={{ width: '100%', maxHeight: 320, objectFit: 'cover', border: '2px solid #111', marginBottom: 14, breakInside: 'avoid' }}
            loading="eager"
          />
        )}

        {!loaded && <div style={BODY}>Assembling the dossier…</div>}

        {notReady && (
          <div style={{ ...BODY, border: '2px solid #ccc', padding: 12 }}>
            No evidence-graded read exists for this vehicle yet. A dossier is generated once the Eye
            has read the car — this is our intake gap, not a verdict on the vehicle.
          </div>
        )}

        {loaded && (eyeRead || totalChecks > 0) && (
          <>
            {/* THE BAND */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700 }}>
                  {band ? `${fmtUsd(band[0])}–${fmtUsd(band[1])}` : 'NOT PRICED YET'}
                </span>
                <span style={LABEL}>AS-IS BAND</span>
                {eyeRead?.conditionClass && <span style={{ ...BODY, fontWeight: 700 }}>{eyeRead.conditionClass}</span>}
                {price && price > 0 && (
                  <span style={{ fontFamily: MONO, fontSize: 12, color: '#666' }}>
                    vs {fmtUsd(price)} {band ? (price <= band[1] ? (price < band[0] ? 'BELOW BAND' : 'IN BAND') : `${fmtUsd(price - band[1])} ABOVE`) : ''}
                  </span>
                )}
              </div>
              {eyeRead && (
                <div style={{ fontFamily: MONO, fontSize: 9, color: '#666', marginTop: 4 }}>
                  READ {new Date(eyeRead.computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' '}(<span style={{ color: readFresh && readFresh.tier !== 'fresh' ? readFresh.color : 'inherit' }}>{agoLabel(eyeRead.computedAt)}</span>)
                  {eyeRead.frames ? ` · ${eyeRead.frames} FRAMES` : ''}
                  {totalChecks > 0 ? ` · ${totalChecks} CANON CHECKS` : ''}
                  {payload?.confidence != null ? ` · CONFIDENCE ${Number(payload.confidence).toFixed(2)}` : ''}
                  {eyeRead.method ? ` · ${eyeRead.method}` : ''}
                </div>
              )}
              {readFresh && readFresh.tier !== 'fresh' && (
                <div style={{ fontFamily: MONO, fontSize: 9, color: readFresh.color, marginTop: 3 }}>
                  {readFresh.tier === 'stale'
                    ? `This read is ${readFresh.label} old — the market may have moved; re-run the Eye before trusting the band.`
                    : `This read is ${readFresh.label} old — confidence decays with age.`}
                </div>
              )}
            </div>

            {bandUsd?.basis && (
              <Section label="Why this band">
                <div style={{ ...BODY, borderLeft: '2px solid #ddd', paddingLeft: 10 }}>{bandUsd.basis}</div>
              </Section>
            )}

            {grades && (
              <Section label="System grades">
                {SYSTEM_ORDER.filter((s) => grades[s]).map((s) => <GradeRow key={s} system={s} g={grades[s]} />)}
              </Section>
            )}

            {findings.length > 0 && (
              <Section label={`Findings — ${counts['fail'] || 0} fail · ${counts['suspect'] || 0} suspect · ${counts['pass'] || 0} pass · ${refused} refused of ${totalChecks}`}>
                {findings.map((c, i) => <FindingRow key={`${c.observation_id}-${i}`} c={c} />)}
              </Section>
            )}

            {wwctn.length > 0 && (
              <Section label="What would change the number">
                {wwctn.map((w, i) => <div key={i} style={{ ...BODY, padding: '2px 0' }}>{i + 1}. {w}</div>)}
              </Section>
            )}

            {iiv && (
              <Section label="If it verifies — separate scenario, never blended">
                {iiv.low != null && (
                  <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                    {fmtUsd(iiv.low)}–{fmtUsd(iiv.high ?? iiv.low)}
                  </div>
                )}
                {iiv.note && <div style={{ ...BODY, marginBottom: 4 }}>{iiv.note}</div>}
                {iiv.precedents.map((p, i) => (
                  <div key={i} style={{ fontFamily: MONO, fontSize: 9, color: '#555' }}>{i + 1}. {p}</div>
                ))}
              </Section>
            )}

            {(drivers.length > 0 || risks.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: drivers.length && risks.length ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 16, breakInside: 'avoid' }}>
                {drivers.length > 0 && (
                  <div>
                    <div style={{ ...LABEL, color: '#111', marginBottom: 5 }}>Value drivers</div>
                    {drivers.map((d, i) => <div key={i} style={{ ...BODY, fontSize: 10, padding: '3px 0', borderBottom: '1px solid #f0f0f0' }}>{d.text}</div>)}
                  </div>
                )}
                {risks.length > 0 && (
                  <div>
                    <div style={{ ...LABEL, color: '#111', marginBottom: 5 }}>Value risks</div>
                    {risks.map((r, i) => <div key={i} style={{ ...BODY, fontSize: 10, padding: '3px 0', borderBottom: '1px solid #f0f0f0' }}>{r.text}</div>)}
                  </div>
                )}
              </div>
            )}

            {flipPlan.length > 0 && (
              <Section label="Flip plan">
                {flipPlan.map((f, i) => (
                  <div key={i} style={{ ...BODY, padding: '2px 0' }}>
                    {f.label && <span style={{ ...LABEL, color: '#666', marginRight: 6 }}>{f.label}</span>}{f.value}
                  </div>
                ))}
              </Section>
            )}

            <div style={{ fontFamily: MONO, fontSize: 8, color: '#999', borderTop: '1px solid #eee', paddingTop: 6, marginTop: 8 }}>
              SOURCE NUKE-VISION · VIA INGEST-OBSERVATION{payload?.canon ? ` · ${String(payload.canon).toUpperCase()}` : ''} ·
              THE EYE — EVIDENCE-GRADED APPRAISAL · AS-IS AND IF-IT-VERIFIES NEVER BLENDED ·
              TESTIMONY IS NEVER DELETED, NEW METHOD VERSIONS SUPERSEDE ·
              GENERATED {new Date(eyeRead?.computedAt || Date.now()).getFullYear()} NUKE
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EyeDossierPage;
