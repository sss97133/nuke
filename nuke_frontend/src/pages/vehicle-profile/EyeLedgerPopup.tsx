/**
 * EyeLedgerPopup — the ledger behind the Eye's evidence read.
 *
 * The drill target of the value headline: everything the read defends,
 * one layer down. Band + basis, system grades, the findings ledger
 * (every fail/suspect citing its frame), what would change the number,
 * and the if-it-verifies scenario — SEPARATE, never blended (two-band rule).
 *
 * Substrate: appraisal_canon_checks (image × part × canon check × verdict ×
 * evidence) + the appraise-layer vehicle_observations payload. Complete
 * testimony, no top-K curation — the reader sorts.
 *
 * Design system: Nuke utilitarian — Arial, ALL CAPS 7-8px labels,
 * mono for data, 2px borders, zero radius/shadows/gradients.
 */
import React, { useState } from 'react';
import { openVehiclePhoto } from './VehiclePhotoLightbox';
import { freshnessOf, agoLabel } from './valueFreshness';
import { useEyeLedger, type CanonCheck } from './hooks/useEyeLedger';
import { normalizePoints, normalizeStrings, normalizeIiv, normalizeFlipPlan } from './hooks/eyeShape';

interface EyeReadHeader {
  band: [number, number] | null;
  conditionClass: string | null;
  tier: string;
  score: number;
  frames: number | null;
  method: string;
  computedAt: string;
}

interface EyeLedgerPopupProps {
  vehicleId: string;
  eyeRead: EyeReadHeader;
  price?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Tokens                                                             */
/* ------------------------------------------------------------------ */

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
  fontSize: '7px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--vp-pencil, #999)',
};

const MONO: React.CSSProperties = {
  fontFamily: 'var(--vp-font-mono, "Courier New", monospace)',
  fontSize: '9px',
};

const BODY: React.CSSProperties = {
  fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
  fontSize: '9px',
  lineHeight: 1.5,
  color: 'var(--text, #000)',
};

const VERDICT_COLOR: Record<string, string> = {
  fail: 'var(--error, #d13438)',
  suspect: 'var(--warning, #b8860b)',
  pass: 'var(--success, #004225)',
  indeterminate: 'var(--text-secondary, #666)',
  cannot_assess: 'var(--text-secondary, #999)',
};

const fmtUsd = (n: number) => '$' + Math.round(n).toLocaleString();

/* ------------------------------------------------------------------ */
/*  Section shell                                                      */
/* ------------------------------------------------------------------ */

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: '10px' }}>
    <div style={{ ...LABEL, marginBottom: '4px', color: 'var(--text, #000)' }}>{label}</div>
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/*  System grade row (expandable to note + basis)                      */
/* ------------------------------------------------------------------ */

const SYSTEM_ORDER = ['identity', 'structure', 'mechanical', 'interior', 'exterior'];

const GradeRow: React.FC<{ system: string; g: any }> = ({ system, g }) => {
  const [open, setOpen] = useState(false);
  const grade = Number(g?.grade);
  const coverage = g?.coverage != null ? Math.round(Number(g.coverage) * 100) : null;
  return (
    <div style={{ borderBottom: '1px solid var(--border, #eee)' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'grid',
          gridTemplateColumns: '80px 1fr auto auto',
          gap: '6px',
          alignItems: 'center',
          padding: '3px 0',
          cursor: 'pointer',
        }}
      >
        <span style={{ ...LABEL, color: 'var(--text, #000)' }}>{system}</span>
        <span style={{ ...MONO, letterSpacing: '2px' }}>
          {Number.isFinite(grade)
            ? '▮'.repeat(grade) + '▯'.repeat(Math.max(0, 5 - grade))
            : '—'}
        </span>
        <span style={{ ...MONO, fontWeight: 700 }}>{Number.isFinite(grade) ? `${grade}/5` : '—'}</span>
        <span style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #666)' }}>
          {coverage != null ? `COV ${coverage}%` : ''} {open ? '▲' : '▼'}
        </span>
      </div>
      {open && (
        <div style={{ ...BODY, padding: '2px 0 6px 8px', borderLeft: '2px solid var(--border, #ddd)', marginBottom: '4px' }}>
          {g?.note && <div style={{ marginBottom: '3px' }}>{g.note}</div>}
          {Array.isArray(g?.basis) && g.basis.map((b: string, i: number) => (
            <div key={i} style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #555)' }}>· {b}</div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Finding row — one canon check citing its frame                     */
/* ------------------------------------------------------------------ */

const FindingRow: React.FC<{ c: CanonCheck }> = ({ c }) => {
  const drill = () => { if (c.image_id) openVehiclePhoto(c.image_id); };
  return (
    <div
      onClick={drill}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 54px 1fr 28px',
        gap: '6px',
        alignItems: 'start',
        padding: '4px 0',
        borderBottom: '1px solid var(--border, #eee)',
        cursor: c.image_id ? 'pointer' : 'default',
      }}
      title={c.image_id ? 'Open the frame this finding cites' : undefined}
    >
      {c.image_url ? (
        <img src={c.image_url} alt="" width={36} height={27} style={{ width: 36, height: 27, objectFit: 'cover' }} loading="lazy" />
      ) : (
        <div style={{ width: 36, height: 27, background: 'var(--surface-elevated, #f5f5f5)' }} />
      )}
      <span style={{ ...LABEL, color: VERDICT_COLOR[c.verdict] || 'var(--text)', paddingTop: '2px' }}>
        {c.verdict}
      </span>
      <div>
        <div style={{ ...LABEL, color: 'var(--text-secondary, #666)' }}>{c.canon_ref} · {c.part}</div>
        <div style={BODY}>{c.evidence}</div>
      </div>
      <span style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #666)', paddingTop: '2px' }}>
        {c.confidence != null ? Number(c.confidence).toFixed(2) : ''}
      </span>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main popup                                                         */
/* ------------------------------------------------------------------ */

const EyeLedgerPopup: React.FC<EyeLedgerPopupProps> = ({ vehicleId, eyeRead, price }) => {
  const { payload, loaded, findings, counts, totalChecks, refused } = useEyeLedger(vehicleId);

  const band = eyeRead.band;
  const readFresh = freshnessOf(eyeRead.computedAt);
  const bandUsd = payload?.band_usd;
  const iiv = normalizeIiv(payload?.if_it_verifies);
  const wwctn = normalizeStrings(payload?.what_would_change_the_number);
  const drivers = normalizePoints(payload?.top_value_drivers, 'driver');
  const risks = normalizePoints(payload?.top_value_risks, 'risk');
  const flipPlan = normalizeFlipPlan(payload?.flip_plan);
  const grades = payload?.system_grades || null;

  if (!loaded) {
    return <div style={{ ...BODY, padding: '12px' }}>Opening the ledger…</div>;
  }

  return (
    <div style={{ maxHeight: '65vh', overflowY: 'auto', padding: '8px 10px' }}>
      {/* THE BAND — what the evidence defends */}
      <div style={{ borderBottom: '2px solid var(--text, #000)', paddingBottom: '6px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ ...MONO, fontSize: '13px', fontWeight: 700 }}>
            {band ? `${fmtUsd(band[0])}–${fmtUsd(band[1])}` : 'NOT PRICED YET'}
          </span>
          <span style={LABEL}>AS-IS</span>
          {eyeRead.conditionClass && <span style={{ ...BODY, fontWeight: 700 }}>{eyeRead.conditionClass}</span>}
          {price && price > 0 && (
            <span style={{ ...MONO, color: 'var(--text-secondary, #666)' }}>
              vs {fmtUsd(price)} {band ? (price <= band[1] ? (price < band[0] ? 'BELOW BAND' : 'IN BAND') : `+${fmtUsd(price - band[1])} ABOVE`) : ''}
            </span>
          )}
        </div>
        <div style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #666)', marginTop: '2px' }}>
          READ {new Date(eyeRead.computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' '}(<span style={{ color: readFresh && readFresh.tier !== 'fresh' ? readFresh.color : 'inherit' }}>{agoLabel(eyeRead.computedAt)}</span>)
          {eyeRead.frames ? ` · ${eyeRead.frames} FRAMES` : ''}
          {totalChecks > 0 ? ` · ${totalChecks} CHECKS` : ''}
          {payload?.confidence != null ? ` · CONF ${Number(payload.confidence).toFixed(2)}` : ''}
          {` · ${eyeRead.method}`}
        </div>
        {readFresh && readFresh.tier !== 'fresh' && (
          <div style={{ ...MONO, fontSize: '8px', color: readFresh.color, marginTop: '3px' }}>
            {readFresh.tier === 'stale'
              ? `⚠ This read is ${readFresh.label} old — the market may have moved. Re-run the Eye before trusting the band.`
              : `This read is ${readFresh.label} old — confidence decays with age; a fresh read tightens it.`}
          </div>
        )}
        <a
          href={`/vehicle/${vehicleId}/dossier`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...MONO, fontSize: '8px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text, #000)', textDecoration: 'none', display: 'inline-block', marginTop: '4px', borderBottom: '1px solid var(--text, #000)' }}
        >
          OPEN FULL DOSSIER ↗ (printable / shareable)
        </a>
      </div>

      {!payload && totalChecks === 0 && (
        <div style={{ ...BODY, color: 'var(--text-secondary, #666)' }}>
          The read exists but its atom ledger hasn't been materialized for drill yet —
          our gap, not a verdict on the car.
        </div>
      )}

      {/* WHY THIS BAND — the appraiser's defensibility basis */}
      {bandUsd?.basis && (
        <Section label="Why this band">
          <div style={{ ...BODY, borderLeft: '2px solid var(--border, #ddd)', paddingLeft: '8px' }}>{bandUsd.basis}</div>
        </Section>
      )}

      {/* SYSTEM GRADES */}
      {grades && (
        <Section label="System grades">
          {SYSTEM_ORDER.filter((s) => grades[s]).map((s) => (
            <GradeRow key={s} system={s} g={grades[s]} />
          ))}
        </Section>
      )}

      {/* THE FINDINGS LEDGER */}
      {findings.length > 0 && (
        <Section
          label={`Findings — ${counts['fail'] || 0} fail · ${counts['suspect'] || 0} suspect · ${counts['pass'] || 0} pass · ${refused} refused of ${totalChecks}`}
        >
          {findings.map((c, i) => (
            <FindingRow key={`${c.observation_id}-${i}`} c={c} />
          ))}
        </Section>
      )}

      {/* WHAT WOULD CHANGE THE NUMBER */}
      {wwctn.length > 0 && (
        <Section label="What would change the number">
          {wwctn.map((w, i) => (
            <div key={i} style={{ ...BODY, padding: '2px 0' }}>{i + 1}. {w}</div>
          ))}
        </Section>
      )}

      {/* IF IT VERIFIES — separate scenario, never blended */}
      {iiv && (
        <div style={{ border: '2px solid var(--border, #ccc)', padding: '6px 8px', marginBottom: '10px' }}>
          <div style={{ ...LABEL, color: 'var(--text, #000)', marginBottom: '3px' }}>
            If it verifies — separate scenario, never blended
          </div>
          {iiv.low != null && (
            <div style={{ ...MONO, fontWeight: 700, marginBottom: '3px' }}>
              {fmtUsd(iiv.low)}–{fmtUsd(iiv.high ?? iiv.low)}
            </div>
          )}
          {iiv.note && <div style={{ ...BODY, marginBottom: '3px' }}>{iiv.note}</div>}
          {iiv.precedents.map((p, i) => (
            <div key={i} style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #555)' }}>{i + 1}. {p}</div>
          ))}
        </div>
      )}

      {/* DRIVERS / RISKS */}
      {(drivers.length > 0 || risks.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: risks.length > 0 && drivers.length > 0 ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: '10px' }}>
          {drivers.length > 0 && (
            <div>
              <div style={{ ...LABEL, color: 'var(--text, #000)', marginBottom: '4px' }}>Value drivers</div>
              {drivers.map((d, i) => (
                <div key={i} style={{ ...BODY, padding: '2px 0', borderBottom: '1px solid var(--border, #f0f0f0)' }}>{d.text}</div>
              ))}
            </div>
          )}
          {risks.length > 0 && (
            <div>
              <div style={{ ...LABEL, color: 'var(--text, #000)', marginBottom: '4px' }}>Value risks</div>
              {risks.map((r, i) => (
                <div key={i} style={{ ...BODY, padding: '2px 0', borderBottom: '1px solid var(--border, #f0f0f0)' }}>{r.text}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FLIP PLAN */}
      {flipPlan.length > 0 && (
        <Section label="Flip plan">
          {flipPlan.map((f, i) => (
            <div key={i} style={BODY}>
              {f.label && <span style={{ ...LABEL, color: 'var(--text-secondary, #666)', marginRight: '6px' }}>{f.label}</span>}{f.value}
            </div>
          ))}
        </Section>
      )}

      {/* Provenance footer */}
      <div style={{ ...MONO, fontSize: '7px', color: 'var(--text-secondary, #999)', borderTop: '1px solid var(--border, #eee)', paddingTop: '4px' }}>
        SOURCE NUKE-VISION · VIA INGEST-OBSERVATION · {payload?.canon ? String(payload.canon).toUpperCase() + ' · ' : ''}
        TESTIMONY IS NEVER DELETED — NEW METHOD VERSIONS SUPERSEDE
      </div>
    </div>
  );
};

export default EyeLedgerPopup;
