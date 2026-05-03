// K5MissionControl — the one-screen view of where everything stands.
//
// Per Skylar 2026-04-25: "The chat box masks productivity. Where is the actual
// progress solidifying? Part of our job is to enable seeing all of this on one
// screen space, with click-through completion."
//
// This is that screen. Live audits, file inventory, open questions, readiness
// gates, hardware checklist, next action. No prose, no chat — just signal.
//
// Sections (top to bottom):
//   1. Mission header — vehicle + date + audit pills
//   2. Artifacts grid — every spec/emitter/receipt/.pdm with status + last mod
//   3. Live audits — PDM30, PDM15, drift (re-run live)
//   4. Open questions — 12 Dave/Skylar decisions, click to track
//   5. Subsystem readiness — DBW / sensors / lights / audio / locks / etc.
//   6. Hardware on hand — checkbox tracker
//   7. Next physical action — literal next thing to do

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { K5_FEATURES } from './k5Features';
import { deriveBodyConfig } from './deriveBodyConfig';
import { auditPdmConfig } from './generatePdmConfig';
import { auditPdm15Config } from './generatePdm15Config';
import { pdmConfigToXml } from './generatePdmXml';

const LABEL: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.5px', color: '#e2e8f0',
};
const SUBLABEL: React.CSSProperties = { ...LABEL, color: '#9aa4b2', fontWeight: 500 };
const MONO: React.CSSProperties = { fontFamily: '"Courier New", monospace', fontSize: 11, color: '#d6deeb' };
const DIM: React.CSSProperties = { ...MONO, color: '#637488' };

type Status = 'done' | 'partial' | 'pending' | 'blocked';
const STATUS_COLOR: Record<Status, string> = {
  done: '#22c55e', partial: '#eab308', pending: '#637488', blocked: '#ef4444',
};
const STATUS_SYMBOL: Record<Status, string> = {
  done: '✓', partial: '◐', pending: '○', blocked: '✗',
};

function StatusPill({ s, label }: { s: Status; label: string }) {
  return (
    <span style={{
      ...LABEL, fontSize: 9, padding: '2px 8px', border: '2px solid',
      borderColor: STATUS_COLOR[s], color: STATUS_COLOR[s],
    }}>{STATUS_SYMBOL[s]} {label}</span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Status overrides — clicking a status symbol cycles it, persisted in
// localStorage. Keys are stable per-item identifiers; values are Status.
// Reset by clearing localStorage key 'k5_status_overrides'.
// ──────────────────────────────────────────────────────────────────────
const OVERRIDES_KEY = 'k5_status_overrides_v1';
const STATUS_CYCLE: Status[] = ['pending', 'partial', 'done', 'blocked'];

function useStatusOverrides() {
  const [overrides, setOverrides] = useState<Record<string, Status>>(() => {
    try {
      const raw = localStorage.getItem(OVERRIDES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); } catch {}
  }, [overrides]);
  const get = useCallback((key: string, dflt: Status): Status => overrides[key] ?? dflt, [overrides]);
  const cycle = useCallback((key: string, current: Status) => {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
    setOverrides(o => ({ ...o, [key]: next }));
  }, []);
  const reset = useCallback(() => setOverrides({}), []);
  return { get, cycle, reset, count: Object.keys(overrides).length };
}

function ClickableStatus({ s, onClick, size = 14 }: { s: Status; onClick: () => void; size?: number }) {
  return (
    <span
      onClick={onClick}
      style={{
        color: STATUS_COLOR[s], fontWeight: 700, fontSize: size,
        cursor: 'pointer', userSelect: 'none',
        display: 'inline-block', minWidth: size + 4, textAlign: 'center',
      }}
      title="Click to cycle status: pending → partial → done → blocked"
    >{STATUS_SYMBOL[s]}</span>
  );
}

function copyPath(path: string) {
  if (path && navigator.clipboard) {
    navigator.clipboard.writeText(path).catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────
// Data — every claim about reality, in one place. Edit when state changes.
// ──────────────────────────────────────────────────────────────────────

interface Artifact { name: string; path: string; status: Status; note?: string }
const ARTIFACTS: { group: string; items: Artifact[] }[] = [
  {
    group: 'SPEC DOCS', items: [
      { name: 'K5 Project State (bird\'s-eye)', path: 'docs/wiring/K5_PROJECT_STATE.md', status: 'done' },
      { name: 'PDM30 config spec', path: 'docs/wiring/output/K5_PDM30_config_spec.md', status: 'done', note: '447 lines, validated 2026-04-22' },
      { name: 'PDM30 channel plan', path: 'docs/wiring/output/K5_pdm30_channel_plan.md', status: 'done' },
      { name: 'ECU calibration spec (M150 / M130)', path: 'docs/wiring/output/K5_ECU_calibration_spec.md', status: 'done', note: 'M150 vs M130 decision still open' },
      { name: 'PDM15 spec', path: '(derived from PDM30 spec + DB)', status: 'partial', note: 'no standalone doc' },
      { name: 'Wiring tech packet (12 files)', path: 'wiring/renders/K5_tech_*.txt', status: 'done', note: 'reproducible via generate_k5_tech_packet.py' },
    ],
  },
  {
    group: 'CODE EMITTERS', items: [
      { name: 'PDM30 in-memory config', path: 'nuke_frontend/src/components/wiring/generatePdmConfig.ts', status: 'done', note: '96 conditions, 30 outputs, 17 keypad — audit OK' },
      { name: 'PDM15 in-memory config', path: 'nuke_frontend/src/components/wiring/generatePdm15Config.ts', status: 'done', note: '17 conditions, 10 outputs — audit OK' },
      { name: 'XML emitter (PDM Manager .pdm)', path: 'nuke_frontend/src/components/wiring/generatePdmXml.ts', status: 'partial', note: '8/14 operators decoded; 53/96 conditions emit as stubs' },
      { name: 'Features → Config derivation', path: 'nuke_frontend/src/components/wiring/deriveBodyConfig.ts', status: 'done', note: '30+ feature flags drive entire config' },
      { name: 'Features panel UI', path: 'nuke_frontend/src/components/wiring/FeaturesPanel.tsx', status: 'done' },
      { name: 'Drift audit (features ↔ DB)', path: 'scripts/verify-features-vs-db.sh', status: 'done', note: '1 drift item: front_camera in features, missing from DB' },
    ],
  },
  {
    group: 'OUTPUT FILES', items: [
      { name: 'K5_PDM30.pdm (XML for PDM Manager)', path: '~/Library/.../m1/.../Desktop/K5_PDM30.pdm', status: 'partial', note: 'opens in PDM Manager; 53 conditions need GUI operator pick' },
      { name: 'K5_PDM15.pdm', path: 'same location', status: 'partial' },
      { name: 'PDM Manager YAML (human spec)', path: 'TECH page → ↓ YAML button', status: 'done' },
    ],
  },
  {
    group: 'TOOLCHAIN INSTALLED', items: [
      { name: 'PDM Manager v1.9.1.0096', path: '~/Library/.../m1/Program Files (x86)/MoTeC/PDM Manager/1.9/', status: 'done' },
      { name: 'M1 Tune 1.5', path: 'same bottle', status: 'done' },
      { name: 'M1 Build (not on K5 path)', path: 'downloaded but unused', status: 'done', note: 'GPR V8 covers all needs' },
      { name: 'MoTeC Utilities (CAN Inspector, refsync)', path: 'same bottle', status: 'partial', note: 'user-space tools work; UTC kernel driver does NOT — needs real Windows for live bus' },
      { name: 'PDM User Manual PN 63029', path: '~/Downloads/PDM_User_Manual_3a926f869d.pdf', status: 'done' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────
// Open questions tracker
// ──────────────────────────────────────────────────────────────────────
interface OpenQuestion { question: string; owner: 'Skylar' | 'Dave' | 'Either'; impact: string; status: Status }
const OPEN_QUESTIONS: OpenQuestion[] = [
  { question: 'M150 (120-pin) or M130 (60-pin) ECU?', owner: 'Skylar', impact: 'Pin map, BOM, harness scope. PDM agnostic.', status: 'pending' },
  { question: 'ECU CAN broadcast bit layout for fan/pump/AC requests', owner: 'Dave', impact: 'PDM bit positions on byte 6 of 0x100 currently placeholder', status: 'pending' },
  { question: 'Hazard via both-stalks gesture — keep or drop?', owner: 'Skylar', impact: 'Soft UX choice', status: 'pending' },
  { question: 'engine_running RPM threshold (200/400/500)', owner: 'Dave', impact: 'Cold-crank detection vs idle stability', status: 'pending' },
  { question: 'Window switches — PDM30 inputs or PDM15 B1/B2?', owner: 'Either', impact: 'Failure isolation', status: 'pending' },
  { question: 'High-beam detent + flash-to-pass routing path', owner: 'Either', impact: 'Both placeholders FALSE today', status: 'pending' },
  { question: 'A/C HP cutout switch input pin', owner: 'Skylar', impact: 'A/C disabled until wired (safety FALSE today)', status: 'pending' },
  { question: 'Wiper park switch input pin', owner: 'Either', impact: 'Park-hold logic is no-op without it', status: 'pending' },
  { question: 'Hermosa mute pin wire color', owner: 'Skylar', impact: 'Mute-on-reverse only works once wired', status: 'pending' },
  { question: 'AMP step stall current (bench measurement)', owner: 'Dave', impact: 'Tunes Output Pin max-current', status: 'pending' },
  { question: 'E-Stopp pulse width (bench measurement)', owner: 'Dave', impact: 'Tunes estopp_pulse PULSE width', status: 'pending' },
  { question: 'Final keypad button labels (italics in §7)', owner: 'Dave', impact: 'Cosmetic; valet mode, fan max etc.', status: 'pending' },
];

// ──────────────────────────────────────────────────────────────────────
// Subsystem readiness — per-domain checklists
// ──────────────────────────────────────────────────────────────────────
interface ChecklistItem { item: string; status: Status }
interface Subsystem { name: string; items: ChecklistItem[] }
const SUBSYSTEMS: Subsystem[] = [
  {
    name: 'PDM30 BODY ELECTRONICS', items: [
      { item: 'Spec doc complete', status: 'done' },
      { item: '16/16 input pins authored', status: 'done' },
      { item: '30/30 output pins assigned', status: 'done' },
      { item: '96/96 conditions defined (audit clean)', status: 'done' },
      { item: '11 counters (washer reset fixed)', status: 'done' },
      { item: '17 keypad bindings (page 1 + 2)', status: 'done' },
      { item: '12 CAN extractions configured', status: 'done' },
      { item: '.pdm XML generation', status: 'partial' },
      { item: 'PDM Manager file loads + Check Channels passes', status: 'pending' },
      { item: '53 stub conditions filled in PDM Manager GUI', status: 'pending' },
      { item: 'Bench Send + Test Outputs', status: 'blocked' },
    ],
  },
  {
    name: 'PDM15 CABIN/CARGO', items: [
      { item: '10/15 outputs assigned', status: 'done' },
      { item: '17 conditions (CAN follower)', status: 'done' },
      { item: '.pdm file generation', status: 'partial' },
      { item: 'Bench Send + Test Outputs', status: 'blocked' },
    ],
  },
  {
    name: 'ECU (M150 OR M130)', items: [
      { item: 'M150 vs M130 decision', status: 'pending' },
      { item: 'GPR V8 firmware license purchased', status: 'pending' },
      { item: 'Calibration spec doc', status: 'done' },
      { item: 'Sensor curves (CLT/IAT/MAP/TPS/pedal)', status: 'pending' },
      { item: 'Pin assignments (canned by GPR V8)', status: 'partial' },
      { item: 'Drive-by-wire calibration', status: 'pending' },
      { item: 'Knock thresholds per cylinder', status: 'pending' },
      { item: 'Idle / cold-start curves', status: 'pending' },
      { item: 'CAN broadcast contract authored in M1 Tune', status: 'pending' },
      { item: 'First flash + bench fire', status: 'blocked' },
    ],
  },
  {
    name: 'KEYPAD', items: [
      { item: '17 bindings authored', status: 'done' },
      { item: 'Final button labels confirmed by Dave', status: 'pending' },
      { item: 'Bus speed reprogrammed 1Mbps→500kbps', status: 'pending' },
    ],
  },
  {
    name: 'CAN BUS PHYSICAL', items: [
      { item: 'Bus topology designed (PDM30/PDM15/ECU/iBooster/PCS)', status: 'done' },
      { item: '500kbps + 100Ω termination spec', status: 'done' },
      { item: 'Physical CAN harness with terminators', status: 'pending' },
      { item: 'Bench bus assembled', status: 'blocked' },
    ],
  },
  {
    name: 'DAKOTA DIGITAL VHX CLUSTER', items: [
      { item: 'Power output assigned (PDM15 OUT4)', status: 'done' },
      { item: 'CAN map from Dakota docs', status: 'pending' },
      { item: 'M1 Tune broadcast config', status: 'pending' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────
// Hardware checklist
// ──────────────────────────────────────────────────────────────────────
const HARDWARE: ChecklistItem[] = [
  { item: 'PDM30 unit (in hand)', status: 'pending' },
  { item: 'PDM15 unit (in hand)', status: 'pending' },
  { item: 'MoTeC 8-button keypad', status: 'pending' },
  { item: 'MoTeC UTC USB-to-CAN PN 61059', status: 'pending' },
  { item: '100Ω CAN terminators (2x)', status: 'pending' },
  { item: 'Bench battery + 30A fuse', status: 'pending' },
  { item: 'M150 or M130 ECU unit', status: 'pending' },
  { item: 'GPR V8 firmware license', status: 'pending' },
  { item: 'Real Windows machine OR VM with USB passthrough', status: 'blocked', },
];

// ──────────────────────────────────────────────────────────────────────
// Next action — the single literal thing to do next
// ──────────────────────────────────────────────────────────────────────
const NEXT_ACTIONS = [
  '1. Decide M150 vs M130 — blocks the engine spec finalization',
  '2. Walk through the 53 PDM30 stub conditions in PDM Manager (open K5_PDM30.pdm — most are PULSE / SET_RESET / TOGGLE / Equal_to picks from the Operator dropdown)',
  '3. File → Save in PDM Manager once stubs are filled — produces a complete .pdm',
  '4. Order MoTeC UTC PN 61059 if not already on hand (~$200)',
  '5. Set up a Windows VM with USB passthrough (UTM-Win11 or Parallels) for bench Send',
];

// ──────────────────────────────────────────────────────────────────────
// Top-level component
// ──────────────────────────────────────────────────────────────────────
interface Props {
  vehicleId: string | undefined;
  vehicleName: string;
}

export function K5MissionControl({ vehicleId: _v, vehicleName }: Props) {
  const ov = useStatusOverrides();

  // Live audits — re-run on every render (cheap, in-memory)
  const derived = useMemo(() => deriveBodyConfig(K5_FEATURES, vehicleName), [vehicleName]);
  const pdm30Audit = auditPdmConfig(derived.pdm30);
  const pdm15Audit = auditPdm15Config(derived.pdm15);

  const xmlStats = useMemo(() => {
    const xml = pdmConfigToXml(derived.pdm30);
    const matches = (xml.match(/TODO operator not yet decoded/g) || []).length;
    const total = derived.pdm30.conditions.length;
    return { encoded: total - matches, total };
  }, [derived.pdm30]);

  // Compute effective status: override if present, else default
  const effective = useCallback((key: string, dflt: Status) => ov.get(key, dflt), [ov]);

  const completion = useMemo(() => {
    const all: { key: string; dflt: Status }[] = [
      ...ARTIFACTS.flatMap(g => g.items.map(i => ({ key: `art:${g.group}:${i.name}`, dflt: i.status }))),
      ...SUBSYSTEMS.flatMap(s => s.items.map(i => ({ key: `sub:${s.name}:${i.item}`, dflt: i.status }))),
      ...HARDWARE.map(h => ({ key: `hw:${h.item}`, dflt: h.status })),
      ...OPEN_QUESTIONS.map(q => ({ key: `q:${q.question}`, dflt: q.status })),
    ];
    const counts: Record<Status, number> = { done: 0, partial: 0, pending: 0, blocked: 0 };
    for (const a of all) counts[effective(a.key, a.dflt)]++;
    return { ...counts, total: all.length };
  }, [effective]);

  const pct = Math.round((completion.done / completion.total) * 100);

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto', background: '#0a0d12', color: '#d6deeb' }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', border: '2px solid #2a3142', background: '#12161e',
        marginBottom: 16, position: 'sticky', top: 0, zIndex: 5,
      }}>
        <span style={{ ...LABEL, fontSize: 12 }}>{vehicleName} — MISSION CONTROL</span>
        <span style={DIM}>{new Date().toISOString().slice(0, 10)}</span>
        <span style={{ flex: 1 }} />
        <StatusPill s={pdm30Audit.ok ? 'done' : 'blocked'} label={`PDM30 audit ${pdm30Audit.ok ? 'OK' : 'FAIL'}`} />
        <StatusPill s={pdm15Audit.ok ? 'done' : 'blocked'} label={`PDM15 audit ${pdm15Audit.ok ? 'OK' : 'FAIL'}`} />
        <StatusPill s={xmlStats.encoded === xmlStats.total ? 'done' : 'partial'} label={`XML ${xmlStats.encoded}/${xmlStats.total}`} />
        <span style={{ ...MONO, fontSize: 11 }}>
          <span style={{ color: STATUS_COLOR.done }}>{completion.done}</span>/
          <span style={{ color: STATUS_COLOR.partial }}>{completion.partial}</span>/
          <span style={{ color: STATUS_COLOR.pending }}>{completion.pending}</span>/
          <span style={{ color: STATUS_COLOR.blocked }}>{completion.blocked}</span>
          <span style={DIM}> ({pct}% done)</span>
        </span>
        {ov.count > 0 && (
          <button
            onClick={ov.reset}
            style={{
              ...LABEL, padding: '2px 8px', border: '2px solid #637488',
              background: 'transparent', color: '#9aa4b2', cursor: 'pointer', fontSize: 8,
            }}
            title={`${ov.count} status overrides saved locally — clear to revert`}
          >RESET {ov.count}</button>
        )}
      </div>

      {/* (Artifacts grid removed — was dense and duplicated codebase navigation.
          Click a device on the FORMBOARD/SCHEMATICS/3D tabs to see its data
          inline instead of in a tabular list here.) */}

      {/* OPEN QUESTIONS */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ ...LABEL, marginBottom: 6 }}>
          OPEN QUESTIONS · {OPEN_QUESTIONS.filter(q => effective(`q:${q.question}`, q.status) === 'pending').length} pending
        </div>
        <div style={{ border: '2px solid #2a3142', background: '#0f1218' }}>
          {OPEN_QUESTIONS.map((q, i) => {
            const key = `q:${q.question}`;
            const s = effective(key, q.status);
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '32px 60px 2fr 1.5fr', gap: 8,
                padding: '6px 12px', borderBottom: i < OPEN_QUESTIONS.length - 1 ? '1px solid #1a1f2c' : 'none',
                background: i % 2 ? '#0f1218' : '#12161e',
              }}>
                <ClickableStatus s={s} onClick={() => ov.cycle(key, s)} />
                <span style={{ ...MONO, color: q.owner === 'Skylar' ? '#82aaff' : q.owner === 'Dave' ? '#c792ea' : '#9aa4b2' }}>{q.owner}</span>
                <span style={MONO}>{q.question}</span>
                <span style={DIM}>{q.impact}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Subsystem-readiness grid + hardware checklist were removed — those
          belong attached to actual devices on the FORMBOARD view, not in a
          giant table here. Per-device readiness is the next refactor:
          click an output on FORMBOARD → side panel shows status + checklist. */}

      {/* NEXT ACTIONS */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ ...LABEL, marginBottom: 6 }}>NEXT ACTIONS — physical world, in order</div>
        <div style={{ border: '2px solid #82aaff', background: '#0f1218', padding: 12 }}>
          {NEXT_ACTIONS.map((a, i) => (
            <div key={i} style={{ ...MONO, marginBottom: 6, color: '#d6deeb' }}>{a}</div>
          ))}
        </div>
      </div>

    </div>
  );
}

export default K5MissionControl;
