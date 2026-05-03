// GuidedPlacement.tsx — "Toddler mode": hand the user one device at a time,
// in build order, and let them click on the FormboardCanvas to place it.
//
// Pairs with WiringWorkspace / FormboardCanvas. The canvas reports clicks back
// via onCanvasClick(x_pct, y_pct); this component receives them and updates
// the current device's pos_x_pct + pos_y_pct in vehicle_build_manifest.
//
// Build order: the order things get placed during a real harness install.
// Source: docs/wiring/output/K5_PLACEMENT_LOG.md "Build sequence" section.

import React, { useMemo, useState } from 'react';
import type { ManifestDevice } from './overlayCompute';

// Build order — what to place when. Each entry is a substring match against
// device_name (case-insensitive). First-match wins so order matters.
const BUILD_ORDER: Array<{ match: RegExp; label: string; hint: string }> = [
  { match: /^battery$/i,            label: 'Battery',           hint: 'Source of all power. Factory K5: passenger fender well, engine bay forward.' },
  { match: /battery disconnect/i,   label: 'Battery Disconnect',hint: 'Inline on negative cable, ~6" from battery (-) post. Mount on inner fender.' },
  { match: /alternator/i,           label: 'Alternator',        hint: 'Engine accessory bracket (front-left of LS3). Output cable runs to battery (+).' },
  { match: /star ground|^ground/i,  label: 'Star Ground Point', hint: 'Single ground busbar, mounted on cab body near firewall. Battery (-) ties here.' },
  { match: /bulkhead|d38999/i,      label: 'Firewall Bulkhead (D38999)', hint: 'H3 grommet on firewall, driver side. Engine harness passes through here.' },
  { match: /^ECU$/i,                label: 'ECU (M150)',        hint: 'Under dash, driver side. Mount on bracket behind kick panel. Cool, dry, accessible.' },
  { match: /Power Distribution Module \(Secondary\)|PDM15/i, label: 'PDM15 (rear PDM)', hint: 'Behind passenger seat or in cargo area. Feeds tail lights, trailer, accessories.' },
  { match: /Power Distribution Module/i, label: 'PDM30 (primary PDM)', hint: 'Under dash, driver side near ECU. Main body PDM.' },
  { match: /Throttle Body/i,        label: 'Throttle Body',     hint: 'Bolts to intake manifold (LS3 / Gen V truck position).' },
  { match: /Accelerator Pedal/i,    label: 'Accelerator Pedal', hint: 'Floor pan driver side, factory pedal location.' },
  { match: /Ignition Coil/i,        label: 'Ignition Coils',    hint: 'Valve cover (factory) or Delmo central mount. 8 coils, mirror passenger/driver banks.' },
  { match: /Fuel Injector/i,        label: 'Fuel Injectors',    hint: 'In intake manifold runners, 4 per bank.' },
  { match: /Crank Position|Cam Position/i, label: 'CKP / CMP sensors', hint: 'CKP at flywheel/timing cover; CMP at front of cam (LS3) or rear (LS truck).' },
  { match: /MAP Sensor/i,           label: 'MAP Sensor',        hint: 'On intake manifold (Gen V truck intakes have it at front). 5V_REF + GND + signal.' },
  { match: /Coolant Temp Sensor/i,  label: 'Coolant Temp',      hint: 'In cylinder head water passage (LS3 driver-side rear).' },
  { match: /Knock Sensor/i,         label: 'Knock Sensors',     hint: 'In valley (under intake) — 2 sensors, bank 1 and bank 2.' },
  { match: /Wideband O2|LSU/i,      label: 'Wideband O2',       hint: 'Bung in exhaust collector, ~12" downstream of header collector merge.' },
  { match: /iBooster/i,             label: 'iBooster',          hint: 'Replaces vacuum brake booster, mounts to firewall driver side.' },
  { match: /Cluster|VHX|Dakota/i,   label: 'Instrument Cluster', hint: 'Dash binnacle, factory location.' },
  { match: /Head Unit|Hermosa/i,    label: 'Head Unit',         hint: 'Center dash radio bay. CAN connection to ECU + power from PDM30.' },
  { match: /Headlight/i,            label: 'Headlights',        hint: 'Front headlight buckets (driver + passenger). 4-pin if LED conversion.' },
  { match: /Tail Light/i,           label: 'Tail Lights',       hint: 'Rear quarter panel (driver + passenger). Brake/turn/run integrated.' },
  { match: /Fuel Pump/i,            label: 'Fuel Pump',         hint: 'In-tank or external near fuel cell. Walbro 460 typical for LS3.' },
  { match: /Window Switch|Power Window Motor/i, label: 'Window Switches + Motors', hint: 'In each door, master switch in driver door.' },
  { match: /Lock|lock/,             label: 'Door Locks',        hint: 'In each door, controlled by master switch + key fob (if installed).' },
  { match: /Speaker|Subwoofer|Amplifier/i, label: 'Audio (amp + speakers)', hint: 'Amp behind passenger seat or in cargo. Speakers in doors + rear.' },
  { match: /Camera/i,               label: 'Camera',            hint: 'Rear bumper / tailgate handle area. Composite video to head unit.' },
  { match: /Trailer/i,              label: 'Trailer Connector', hint: 'Rear bumper / hitch receiver. 7-way blade.' },
];

interface Props {
  devices: ManifestDevice[];
  onPlaceDevice: (deviceId: string, pos_x_pct: number, pos_y_pct: number) => Promise<void> | void;
  onSkipDevice?: (deviceId: string) => void;
  pendingClick?: { x_pct: number; y_pct: number } | null;
  onConsumeClick?: () => void;
}

export function GuidedPlacement({ devices, onPlaceDevice, onSkipDevice, pendingClick, onConsumeClick }: Props) {
  // Find the next device per BUILD_ORDER that doesn't have a position
  const queue = useMemo(() => {
    const queueOut: { device: ManifestDevice; step: typeof BUILD_ORDER[number] }[] = [];
    for (const step of BUILD_ORDER) {
      const matching = devices.filter(d => step.match.test(d.device_name) && (!d.pos_x_pct || !d.pos_y_pct));
      for (const m of matching) queueOut.push({ device: m, step });
    }
    return queueOut;
  }, [devices]);

  const current = queue[0];
  const totalUnplaced = queue.length;
  const totalPlaced = devices.filter(d => d.pos_x_pct && d.pos_y_pct).length;

  // When canvas reports a click, place the current device there
  React.useEffect(() => {
    if (pendingClick && current) {
      void onPlaceDevice(current.device.id, pendingClick.x_pct, pendingClick.y_pct);
      onConsumeClick?.();
    }
  }, [pendingClick, current, onPlaceDevice, onConsumeClick]);

  if (!current) {
    return (
      <div style={panelStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#22c55e', marginBottom: 8 }}>✓ ALL PLACED</div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {totalPlaced} devices have positions. Switch to wire-routing mode to run wires between them.
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={progressStyle}>
        <span style={{ color: '#888' }}>PLACEMENT QUEUE</span>
        <span style={{ color: '#fff' }}>{totalPlaced} placed · {totalUnplaced} remaining</span>
      </div>
      <div style={pieceTitleStyle}>{current.step.label}</div>
      <div style={partStyle}>
        {current.device.manufacturer || '—'} {current.device.part_number || ''}
      </div>
      <div style={hintStyle}>{current.step.hint}</div>
      <div style={buttonRowStyle}>
        <button style={primaryBtn} disabled>
          Click on canvas to place →
        </button>
        {onSkipDevice && (
          <button style={skipBtn} onClick={() => onSkipDevice(current.device.id)}>
            Skip (place later)
          </button>
        )}
      </div>
      <div style={{ marginTop: 12, fontSize: 10, color: '#666' }}>
        Build order is enforced. Power-source first (battery → disconnect → alternator → ground).
        Then ECU/PDM. Then engine. Then dash. Then lighting. Then accessories.
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#16213e',
  border: '2px solid #2a2a5e',
  padding: 14,
  fontFamily: 'Arial, sans-serif',
  color: '#e0e0e8',
  minWidth: 280,
  maxWidth: 380,
};

const progressStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 0.8,
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: '1px solid #2a2a5e',
};

const pieceTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#fff',
  marginBottom: 4,
  letterSpacing: 0.4,
};

const partStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6c8cff',
  fontFamily: 'Courier New, monospace',
  marginBottom: 12,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#aaa',
  lineHeight: 1.5,
  marginBottom: 14,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  background: '#0f3460',
  color: '#6c8cff',
  border: '2px solid #6c8cff',
  padding: '10px 14px',
  fontSize: 11,
  letterSpacing: 0.6,
  fontWeight: 600,
  cursor: 'default',
};

const skipBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#888',
  border: '2px solid #2a2a5e',
  padding: '10px 14px',
  fontSize: 11,
  letterSpacing: 0.6,
  cursor: 'pointer',
};
