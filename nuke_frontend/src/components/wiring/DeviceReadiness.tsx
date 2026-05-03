// DeviceReadiness — inline readiness panel for a single device.
//
// Renders inside WiringDetailPanel when the user clicks a device on the
// FORMBOARD / SCHEMATICS / 3D views. Replaces the separate dashboard tables
// with per-device "is this device ready to ship?" signal — exactly what
// Skylar asked for: "if the points are a button I want to see what it
// looks like IRL."
//
// Pulls live from:
//   - K5_FEATURES (which features gate this device)
//   - generatePdmConfig (which OUT pin, which condition, encoded vs stub)
//   - Static "blockers" list (placeholder FALSE/TRUE conditions, unwired inputs)
//
// Compact: ~3-5 lines per device. Color-coded badges, no tables.

import React, { useMemo } from 'react';
import { K5_FEATURES, type K5Features } from './k5Features';
import { deriveBodyConfig } from './deriveBodyConfig';

type Status = 'done' | 'partial' | 'pending' | 'blocked';

const STATUS_COLOR: Record<Status, string> = {
  done: 'var(--success, #16825d)',
  partial: 'var(--warning, #b05a00)',
  pending: 'var(--text-secondary, #666)',
  blocked: 'var(--error, #d13438)',
};

const STATUS_LABEL: Record<Status, string> = {
  done: 'READY',
  partial: 'PARTIAL',
  pending: 'PENDING',
  blocked: 'BLOCKED',
};

interface Props {
  deviceName: string;       // e.g. "A/C Compressor Clutch"
  modelNumber?: string | null;
  features?: K5Features;    // override K5_FEATURES if you want a what-if view
}

// ──────────────────────────────────────────────────────────────────────
// Match a device by name to its PDM output assignment + driving condition
// ──────────────────────────────────────────────────────────────────────
function matchDevice(deviceName: string, features: K5Features) {
  const derived = deriveBodyConfig(features, 'K5');

  // Match against PDM30 output_pins.device first
  const pdm30 = derived.pdm30.output_pins.find(o => o.device.toLowerCase().includes(deviceName.toLowerCase().split(' ')[0]) || deviceName.toLowerCase().includes(o.device.toLowerCase().split(' ')[0]));
  const pdm15 = !pdm30 ? derived.pdm15.output_pins.find(o => o.device.toLowerCase().includes(deviceName.toLowerCase().split(' ')[0]) || deviceName.toLowerCase().includes(o.device.toLowerCase().split(' ')[0])) : undefined;

  const pdmOut = pdm30 || pdm15;
  const pdmName = pdm30 ? 'PDM30' : pdm15 ? 'PDM15' : null;

  if (!pdmOut) return null;

  // Find the condition that drives this output
  const conditions = pdm30 ? derived.pdm30.conditions : derived.pdm15.conditions;
  const baseChan = pdmOut.driven_by.replace(/\.(Status|Voltage|rising_edge|falling_edge|expired)$/, '');
  const condition = conditions.find(c => c.name === baseChan);

  // Check for known placeholder conditions that mean "not ready"
  const isPlaceholderFalse = condition?.expression === 'FALSE';
  const isPlaceholderTrue = condition?.expression === 'TRUE';

  return {
    pdmName,
    pin: `OUT${pdmOut.out}`,
    pinDetails: pdmOut.pins.join('+'),
    maxAmps: pdmOut.max_amps,
    stayAlive: pdmOut.stay_alive,
    drivenBy: pdmOut.driven_by,
    condition,
    isPlaceholder: isPlaceholderFalse || isPlaceholderTrue,
    isPlaceholderFalse,
    isPlaceholderTrue,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Hardcoded blockers — known issues per device (from the spec receipts).
// Eventually these would be derived from a live source; for now they're
// the curated list of "this device has a known issue."
// ──────────────────────────────────────────────────────────────────────
const KNOWN_BLOCKERS: Record<string, string[]> = {
  'A/C Compressor Clutch': ['HP cutout switch wire pending — A/C disabled until wired (safety)'],
  'Rear Backup Camera': [],
  'AMP Step Motor Left': ['Stall current bench measurement pending'],
  'AMP Step Motor Right': ['Stall current bench measurement pending'],
  'E-Stopp Actuator': ['Pulse width bench measurement pending'],
  'Bosch V4 Electric Brake Booster': ['Mute pin wire color TBD'],
  'Window Switch Master Driver': ['Cabin window switch routing not finalized (PDM30 vs PDM15 input)'],
  'Window Switch Passenger': ['Cabin window switch routing not finalized'],
};

const RELATED_OPEN_QUESTIONS: Record<string, string[]> = {
  'A/C Compressor Clutch': ['HP switch input pin?'],
  'AMP Step Motor Left': ['Stall current bench measurement'],
  'AMP Step Motor Right': ['Stall current bench measurement'],
  'E-Stopp Actuator': ['Pulse width bench measurement'],
  'Headlight Left': ['high_beam_detent_sw routing'],
  'Headlight Right': ['high_beam_detent_sw routing'],
  'Wiper Motor': ['wiper_park_sw input pin'],
};

export function DeviceReadiness({ deviceName, modelNumber, features = K5_FEATURES }: Props) {
  const match = useMemo(() => matchDevice(deviceName, features), [deviceName, features]);
  const blockers = KNOWN_BLOCKERS[deviceName] || [];
  const questions = RELATED_OPEN_QUESTIONS[deviceName] || [];

  // Compute overall status
  let status: Status = 'pending';
  if (match) {
    if (match.isPlaceholderFalse) status = 'blocked';
    else if (match.isPlaceholder || blockers.length > 0) status = 'partial';
    else status = 'done';
  }

  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: '2px solid var(--text, #2a2a2a)',
      background: 'var(--bg-secondary, #fafafa)',
      fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--text-secondary, #666)',
        }}>READINESS</span>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 6px',
          border: '2px solid', borderColor: STATUS_COLOR[status],
          color: STATUS_COLOR[status], textTransform: 'uppercase', letterSpacing: '0.3px',
        }}>{STATUS_LABEL[status]}</span>
      </div>

      {match ? (
        <>
          <div style={{
            fontSize: 11, fontFamily: '"Courier New", monospace',
            color: 'var(--text, #2a2a2a)', marginBottom: 3,
          }}>
            <strong>{match.pdmName}:{match.pin}</strong> · pin {match.pinDetails} · max {match.maxAmps}A
            {match.stayAlive && <span style={{ color: 'var(--warning, #b05a00)', marginLeft: 6 }}>·STAY-ALIVE</span>}
          </div>
          <div style={{
            fontSize: 11, fontFamily: '"Courier New", monospace',
            color: 'var(--text-secondary, #666)', marginBottom: 6,
          }}>
            ← <span style={{ color: 'var(--accent, #2563eb)' }}>{match.drivenBy}</span>
          </div>
          {match.condition && (
            <div style={{
              fontSize: 10, fontFamily: '"Courier New", monospace',
              padding: '4px 6px', background: 'var(--bg, #f5f5f5)',
              border: '1px solid var(--border, #bdbdbd)', marginBottom: 6,
              wordBreak: 'break-word',
            }}>
              {match.condition.name} = {match.condition.expression}
              {match.condition.note && (
                <div style={{ marginTop: 3, color: 'var(--text-secondary, #666)' }}>// {match.condition.note}</div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-secondary, #666)', fontStyle: 'italic' }}>
          Not assigned to a PDM output (likely sensor / wired direct to ECU / passive component).
        </div>
      )}

      {blockers.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: 'var(--error, #d13438)', marginBottom: 2 }}>BLOCKERS</div>
          {blockers.map((b, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text, #2a2a2a)', paddingLeft: 6 }}>
              ✗ {b}
            </div>
          ))}
        </div>
      )}

      {questions.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary, #666)', marginBottom: 2 }}>OPEN QUESTIONS</div>
          {questions.map((q, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary, #666)', paddingLeft: 6 }}>
              ? {q}
            </div>
          ))}
        </div>
      )}

      {modelNumber && (
        <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-secondary, #666)', fontFamily: '"Courier New", monospace' }}>
          part: {modelNumber}
        </div>
      )}
    </div>
  );
}

export default DeviceReadiness;
