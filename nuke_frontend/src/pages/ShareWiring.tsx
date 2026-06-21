// ShareWiring.tsx — BUILDER SHARE VIEW: public /share/wiring/:vehicleId
// Receipt: docs/wiring/receipts/2026-06-11_builder-share-view.md
//
// Skylar texts this link to his pro harness builder — a PDF-by-text
// traditionalist who must be won in two seconds. Zero chrome: no nav, no
// sidebar, no tabs, no login. A DOCUMENT, not an app — the PAPER-colorway
// connector sheet + pin schedule + cut summary, top-to-bottom like a print
// package, "looks like the PDF he's used to, except it answers back."
//
// Data path (anon-verified, receipt §Data path):
//   vehicles (vehicles_public_select, is_public=true) +
//   vehicle_build_manifest (Public read) → deriveHarness →
//   buildConnectorModels — the exact chain the CONNECTORS tab runs.
// Reuses ConnectorInspector internals wholesale (FaceSkin / TableSkin /
// PAPER colorway via ColorwayContext). Does NOT touch HarnessWorkbench /
// PlanView2D / harnessDerivation internals.
//
// Verdict bar: one-tap YES/NO + optional comment → existing
// ingest-observation edge function (anon JWT accepted; service-role insert
// inside) as source 'shop' / kind 'comment' with
// structured_data.kind_detail='professional_review'. Testimony, never deleted.

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ManifestDevice } from '../components/wiring/overlayCompute';
import { deriveHarness, SUBSYSTEMS, type DerivationInput } from '../components/wiring/harnessDerivation';
import { buildConnectorModels } from '../components/wiring/connector-inspector/buildConnectorModels';
import { COLORWAYS, ColorwayContext, frame, rule, textOn } from '../components/wiring/connector-inspector/colorways';
import { FaceSkin } from '../components/wiring/connector-inspector/FaceSkin';
import { TableSkin } from '../components/wiring/connector-inspector/TableSkin';
import { useBuildState } from '../components/wiring/connector-inspector/useBuildState';

// PAPER forced — the builder sees the printed sheet, never the app theme.
const cw = COLORWAYS.paper;

// Verdict write path constants (receipt §Data path (write)).
const SOURCE_SLUG = 'shop';
const OBSERVATION_KIND = 'comment';

interface VehicleInfo { year: number | null; make: string | null; model: string | null; vin: string | null }

export default function ShareWiring() {
  const { vehicleId } = useParams();
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null);
  const [devices, setDevices] = useState<ManifestDevice[]>([]);
  const [revDate, setRevDate] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // build_state badges — anon read of vehicle_wiring_overlays / vehicle_custom_circuits
  const build = useBuildState(vehicleId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!vehicleId) { setLoadState('notfound'); return; }
      const [vehicleRes, manifestRes] = await Promise.all([
        supabase.from('vehicles').select('year, make, model, vin').eq('id', vehicleId).maybeSingle(),
        supabase.from('vehicle_build_manifest')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('device_category')
          .order('device_name'),
      ]);
      if (cancelled) return;
      if (!vehicleRes.data || !manifestRes.data || manifestRes.data.length === 0) {
        setLoadState('notfound');
        return;
      }
      setVehicle(vehicleRes.data as VehicleInfo);
      const rows = manifestRes.data as (ManifestDevice & { updated_at?: string })[];
      setDevices(rows);
      const maxUpdated = rows.reduce<string>((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), '');
      setRevDate(maxUpdated ? maxUpdated.slice(0, 10) : null);
      setLoadState('ready');
    }
    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

  // Same derivation chain as the CONNECTORS tab — all subsystems on, defaults.
  const harness = useMemo(() => {
    const toggles: Record<string, boolean> = {};
    for (const s of SUBSYSTEMS) toggles[s.id] = true;
    const input: DerivationInput = { devices, toggles, mechanicalGauges: false };
    return deriveHarness(input);
  }, [devices]);

  const models = useMemo(() => buildConnectorModels(harness), [harness]);
  const firewall = models.FIREWALL;

  // TableSkin fills its container; in document flow give it exactly the
  // height its rows need (row ≈ 32px + filter bar ≈ 50 + header ≈ 36).
  const tableRowCount = useMemo(() => {
    let n = firewall.overflow.length;
    for (const c of firewall.cavities) n += Math.max(1, c.wires.length);
    return n;
  }, [firewall]);

  if (loadState === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', background: cw.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: cw.fontMono, fontSize: 14, color: cw.inkFaint,
      }}>
        LOADING CONNECTOR SHEET…
      </div>
    );
  }
  if (loadState === 'notfound' || !vehicle) {
    return (
      <div style={{
        minHeight: '100vh', background: cw.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: cw.fontMono, fontSize: 14, color: cw.ink,
      }}>
        NO HARNESS PACKAGE AT THIS LINK.
      </div>
    );
  }

  const vehicleLine = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ').toUpperCase();
  // local date, not UTC — a sheet printed tonight must not say tomorrow
  const today = new Date().toLocaleDateString('sv-SE');

  return (
    <ColorwayContext.Provider value={cw}>
    <div style={{ minHeight: '100vh', background: cw.bg, color: cw.ink, fontFamily: cw.fontBody, paddingBottom: 96 }}>
      {/* Texted-link reality: first open is usually a PHONE. FaceSkin's fixed
          320px detail card would crush the face on a 390px screen — hide it
          below 720px; tapping a cavity still highlights its row in the pin
          schedule (shared selectedKey). FaceSkin internals untouched. */}
      <style>{`
        @media (max-width: 720px) {
          .share-face-wrap > div > div:last-child { display: none; }
          /* legend (canvas overlay, 3rd child after svg + zoom controls)
             collides with FIT/+/- at phone width — drop it a row */
          .share-face-wrap > div > div:first-child > div:first-child > div:nth-child(3) { top: 48px !important; }
        }
      `}</style>

      {/* ── title block — one header line, like the top of a print ── */}
      <div style={{ borderBottom: `3px double ${cw.ink}`, padding: '14px 20px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1 }}>{vehicleLine}</span>
          {vehicle.vin && (
            <span style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.inkMuted }}>VIN {vehicle.vin}</span>
          )}
        </div>
        <div style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.inkMuted, marginTop: 2 }}>
          ENGINE HARNESS — REV {revDate || 'UNDATED'} — PRINTED {today}
          <span style={{ color: cw.inkFaint }}> — {harness.wires.length} CIRCUITS — {harness.totalLengthFt} FT TEFZEL</span>
        </div>
      </div>

      {/* ── sheet 1: the 61-way face (zoom/pan live, click a cavity) ── */}
      <SectionLabel n="1" label={firewall.title} sub={firewall.subTitle} />
      <div className="share-face-wrap" style={{ height: '72vh', minHeight: 480, borderBottom: frame(cw) }}>
        <FaceSkin model={firewall} buildStates={build.states} selectedKey={selectedKey} onSelect={setSelectedKey} />
      </div>

      {/* ── sheet 2: pin schedule — every cavity, every wire ── */}
      <SectionLabel n="2" label="PIN SCHEDULE" sub="ALL 61 CAVITIES + OVERFLOW — SORT / FILTER LIVE" />
      <div style={{ height: tableRowCount * 32 + 100, borderBottom: frame(cw) }}>
        <TableSkin model={firewall} buildStates={build.states} selectedKey={selectedKey} onSelect={setSelectedKey} />
      </div>

      {/* ── sheet 3: cut summary by gauge ── */}
      <SectionLabel n="3" label="CUT SUMMARY" sub="DERIVED FOOTAGE BY GAUGE — SPEC ROWS BELOW" />
      <CutSummary byGauge={harness.byGauge} bySpec={harness.bySpec} totalLengthFt={harness.totalLengthFt} />

      {/* ── fixed verdict bar — builder-grade plain ── */}
      <VerdictBar vehicleId={vehicleId!} vehicleLine={vehicleLine} wireCount={harness.wires.length} totalFt={harness.totalLengthFt} />
    </div>
    </ColorwayContext.Provider>
  );
}

// ── section label — sheet divider register ─────────────────────────────
function SectionLabel({ n, label, sub }: { n: string; label: string; sub?: string }) {
  return (
    <div style={{ padding: '12px 20px 8px', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: cw.fontMono, fontSize: 14, fontWeight: 700, color: cw.onAccent, background: cw.ink, padding: '1px 8px' }}>
        SHEET {n}
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>{label}</span>
      {sub && <span style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.inkFaint }}>{sub}</span>}
    </div>
  );
}

// ── cut summary — per-gauge footage + total ────────────────────────────
function CutSummary({ byGauge, bySpec, totalLengthFt }: {
  byGauge: Record<string, number>;
  bySpec: Record<string, number>;
  totalLengthFt: number;
}) {
  const gauges = Object.entries(byGauge).sort((a, b) => Number(a[0]) - Number(b[0]));
  const specs = Object.entries(bySpec).sort((a, b) => a[0].localeCompare(b[0]));
  const th: React.CSSProperties = {
    textAlign: 'left', padding: '6px 12px', fontFamily: cw.fontBody, fontSize: 14,
    fontWeight: 700, letterSpacing: 0.5, color: cw.inkMuted, borderBottom: frame(cw),
  };
  const td: React.CSSProperties = {
    padding: '6px 12px', fontFamily: cw.fontMono, fontSize: 14, color: cw.ink, borderBottom: rule(cw),
  };
  return (
    <div style={{ padding: '0 20px 28px', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <table style={{ borderCollapse: 'collapse', border: frame(cw), minWidth: 260 }}>
        <thead>
          <tr><th style={th}>GAUGE (AWG)</th><th style={{ ...th, textAlign: 'right' }}>FEET</th></tr>
        </thead>
        <tbody>
          {gauges.map(([g, ft]) => (
            <tr key={g}>
              <td style={td}>{g}</td>
              <td style={{ ...td, textAlign: 'right' }}>{Math.round(ft)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>TOTAL</td>
            <td style={{ ...td, fontWeight: 700, textAlign: 'right', borderBottom: 'none' }}>{Math.round(totalLengthFt)} FT</td>
          </tr>
        </tbody>
      </table>
      <table style={{ borderCollapse: 'collapse', border: frame(cw), minWidth: 320 }}>
        <thead>
          <tr><th style={th}>WIRE SPEC</th><th style={{ ...th, textAlign: 'right' }}>FEET</th></tr>
        </thead>
        <tbody>
          {specs.map(([s, ft]) => (
            <tr key={s}>
              <td style={td}>{s}</td>
              <td style={{ ...td, textAlign: 'right' }}>{Math.round(ft)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── verdict bar — "Ready to build?" one tap, no account ────────────────
type Verdict = 'yes' | 'no';

function VerdictBar({ vehicleId, vehicleLine, wireCount, totalFt }: {
  vehicleId: string; vehicleLine: string; wireCount: number; totalFt: number;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [comment, setComment] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const submit = async (v: Verdict) => {
    setVerdict(v);
    setPhase('sending');
    setErrMsg('');
    const now = new Date().toISOString();
    const trimmed = comment.trim();
    const { data, error } = await supabase.functions.invoke('ingest-observation', {
      body: {
        source_slug: SOURCE_SLUG,
        kind: OBSERVATION_KIND,
        observed_at: now,
        vehicle_id: vehicleId,
        source_url: typeof window !== 'undefined' ? window.location.href : undefined,
        source_identifier: `share-wiring-${vehicleId}-${Date.now()}`,
        content_text: `PROFESSIONAL REVIEW — READY TO BUILD: ${v.toUpperCase()}${trimmed ? ` — ${trimmed}` : ''}`,
        structured_data: {
          kind_detail: 'professional_review',
          verdict: v,
          comment: trimmed || null,
          share_route: `/share/wiring/${vehicleId}`,
          connector: 'FIREWALL',
          vehicle: vehicleLine,
          wire_count: wireCount,
          total_length_ft: totalFt,
          submitted_at: now,
        },
      },
    });
    const result = data as { success?: boolean; observation_id?: string; error?: string } | null;
    if (error || !result?.success) {
      setPhase('error');
      setErrMsg(error?.message || result?.error || 'write failed');
    } else {
      setPhase('done');
    }
  };

  const btn = (v: Verdict, label: string): React.CSSProperties => ({
    background: verdict === v && phase !== 'idle' ? cw.ink : cw.bg,
    color: verdict === v && phase !== 'idle' ? textOn(cw.ink) : cw.ink,
    border: `2px solid ${cw.ink}`,
    fontFamily: cw.fontBody, fontSize: 16, fontWeight: 700, letterSpacing: 1,
    padding: '10px 22px', cursor: phase === 'sending' || phase === 'done' ? 'default' : 'pointer',
    opacity: phase === 'done' && verdict !== v ? 0.35 : 1,
  });

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
      background: cw.surface, borderTop: `3px double ${cw.ink}`,
      padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      {phase === 'done' ? (
        <span style={{ fontFamily: cw.fontMono, fontSize: 15, fontWeight: 700, color: cw.ok }}>
          VERDICT RECORDED — {verdict?.toUpperCase()}. THANK YOU.
        </span>
      ) : (
        <>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>READY TO BUILD?</span>
          <button disabled={phase === 'sending'} onClick={() => submit('yes')} style={btn('yes', 'YES')}>👍 YES</button>
          <button disabled={phase === 'sending'} onClick={() => submit('no')} style={btn('no', 'NO')}>👎 NO</button>
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="One line for the owner (optional)…"
            maxLength={500}
            style={{
              flex: 1, minWidth: 220, background: cw.bg, color: cw.ink, border: frame(cw),
              fontFamily: cw.fontMono, fontSize: 14, padding: '9px 12px',
            }}
          />
          {phase === 'sending' && (
            <span style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.inkFaint }}>SENDING…</span>
          )}
          {phase === 'error' && (
            <span style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.danger }}>NOT SAVED — {errMsg}. TAP AGAIN.</span>
          )}
        </>
      )}
    </div>
  );
}
