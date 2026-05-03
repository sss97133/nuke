// FeaturesPanel — interactive accessory-choice toggles that drive the entire
// PDM/harness/BOM derivation. Per Skylar 2026-04-25: "It should be able to
// automatically recalibrate. Choose electric windows vs roller windows, lights
// on the doors or no, electric locks or no — every accessory choice ripples."
//
// Toggle a feature → the deriveBodyConfig function runs → the rest of the
// TECH page (output grids, conditions, CAN bytes, BOM) updates live.

import React from 'react';
import type { K5Features } from './k5Features';
import type { DerivationStats } from './deriveBodyConfig';

const LABEL: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.5px', color: '#e2e8f0',
};
const SUBLABEL: React.CSSProperties = { ...LABEL, color: '#9aa4b2', fontWeight: 500 };
const MONO: React.CSSProperties = { fontFamily: '"Courier New", monospace', fontSize: 11, color: '#d6deeb' };

interface Props {
  features: K5Features;
  baselineStats: DerivationStats;
  currentStats: DerivationStats;
  onChange: (next: K5Features) => void;
  onReset: () => void;
}

type FeatureGroup = {
  title: string;
  flags: { key: keyof K5Features; label: string; type: 'bool' | 'enum'; options?: string[] }[];
};

const GROUPS: FeatureGroup[] = [
  {
    title: 'BODY CONVENIENCE',
    flags: [
      { key: 'power_windows',    label: 'Windows',     type: 'enum', options: ['electric_single_speed','electric_multi_speed','roller'] },
      { key: 'power_locks',      label: 'Power locks', type: 'bool' },
      { key: 'amp_power_steps',  label: 'AMP power steps', type: 'bool' },
      { key: 'reverse_camera',   label: 'Reverse camera', type: 'bool' },
      { key: 'front_camera',     label: 'Front camera', type: 'bool' },
      { key: 'door_puddle_lights', label: 'Door puddle LEDs', type: 'bool' },
      { key: 'cargo_bed_light',  label: 'Cargo/bed light', type: 'bool' },
      { key: 'footwell_lights',  label: 'Footwell lights', type: 'bool' },
      { key: 'under_dash_led',   label: 'Under-dash LED', type: 'bool' },
      { key: 'dome_light',       label: 'Dome light', type: 'bool' },
      { key: 'interior_courtesy_lights', label: 'Interior courtesy', type: 'bool' },
    ],
  },
  {
    title: 'CLIMATE',
    flags: [
      { key: 'hvac_blower',      label: 'HVAC blower', type: 'enum', options: ['single_speed','multi_speed','none'] },
      { key: 'ac_compressor',    label: 'A/C compressor', type: 'bool' },
      { key: 'ac_hp_switch_wired', label: 'A/C HP switch wired', type: 'bool' },
    ],
  },
  {
    title: 'LIGHTING',
    flags: [
      { key: 'headlights',       label: 'Headlights', type: 'enum', options: ['led','halogen','none'] },
      { key: 'high_beam_input',  label: 'High beam input', type: 'enum', options: ['factory_column','ecu_relayed','none'] },
      { key: 'flash_to_pass',    label: 'Flash-to-pass', type: 'bool' },
      { key: 'hazard_via_both_stalks', label: 'Hazard gesture (both stalks)', type: 'bool' },
    ],
  },
  {
    title: 'AUDIO + CLUSTER',
    flags: [
      { key: 'head_unit',        label: 'Head unit', type: 'enum', options: ['retrosound_hermosa','aftermarket_other','none'] },
      { key: 'audio_amp',        label: 'Audio amp', type: 'bool' },
      { key: 'mute_on_reverse',  label: 'Mute on reverse', type: 'bool' },
      { key: 'cluster',          label: 'Cluster', type: 'enum', options: ['dakota_vhx','analog','none'] },
      { key: 'fm_antenna_powered', label: 'FM antenna (powered)', type: 'bool' },
    ],
  },
  {
    title: 'ACCESSORIES',
    flags: [
      { key: 'cigarette_lighter', label: 'Cigarette lighter', type: 'bool' },
      { key: 'usb_charging',     label: 'USB charging (stay-alive)', type: 'bool' },
      { key: 'accessory_outlet_12v', label: '12V accessory outlet', type: 'bool' },
    ],
  },
  {
    title: 'WIPER + BRAKES',
    flags: [
      { key: 'wiper_park_input', label: 'Wiper park switch wired', type: 'bool' },
      { key: 'three_wipe_after_washer', label: '3 wipes after washer', type: 'bool' },
      { key: 'brake_booster',    label: 'Brake booster', type: 'enum', options: ['ibooster','vacuum'] },
      { key: 'parking_brake',    label: 'Parking brake', type: 'enum', options: ['estopp','mechanical'] },
    ],
  },
  {
    title: 'ENGINE + DRIVETRAIN',
    flags: [
      { key: 'ecu',              label: 'ECU', type: 'enum', options: ['M150','M130'] },
      { key: 'drive_by_wire',    label: 'Drive-by-wire throttle', type: 'bool' },
      { key: 'forced_induction', label: 'Forced induction', type: 'bool' },
      { key: 'transmission',     label: 'Transmission', type: 'enum', options: ['PCS_4L60E','PCS_4L80E','manual'] },
      { key: 'transfer_case',    label: 'Transfer case', type: 'enum', options: ['NV241_manual','NV241_electric','none'] },
    ],
  },
];

export function FeaturesPanel({ features, baselineStats, currentStats, onChange, onReset }: Props) {
  const delta = (a: number, b: number) => {
    const d = a - b;
    if (d === 0) return null;
    const sign = d > 0 ? '+' : '';
    return <span style={{ color: d > 0 ? '#22c55e' : '#ef4444', marginLeft: 4 }}>({sign}{d})</span>;
  };

  return (
    <div style={{ marginBottom: 24, border: '2px solid #2a3142', background: '#0f1218' }}>
      <div style={{
        padding: '8px 12px', borderBottom: '2px solid #2a3142',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={LABEL}>FEATURES — flip to recalibrate</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...MONO, fontSize: 10 }}>
          PDM30 {currentStats.pdm30.outputs}/30 outs{delta(currentStats.pdm30.outputs, baselineStats.pdm30.outputs)}
          {' · '}
          PDM15 {currentStats.pdm15.outputs}/15 outs{delta(currentStats.pdm15.outputs, baselineStats.pdm15.outputs)}
          {' · '}
          ~{currentStats.approx_wire_ft}ft{delta(currentStats.approx_wire_ft, baselineStats.approx_wire_ft)}
          {' · '}
          ~${currentStats.approx_cost_usd}{delta(currentStats.approx_cost_usd, baselineStats.approx_cost_usd)}
        </span>
        <button onClick={onReset} style={{
          ...LABEL, padding: '4px 10px', border: '2px solid #82aaff',
          background: 'transparent', color: '#82aaff', cursor: 'pointer', fontSize: 9,
        }}>RESET TO K5</button>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 12,
      }}>
        {GROUPS.map(g => (
          <div key={g.title}>
            <div style={{ ...SUBLABEL, marginBottom: 6, fontSize: 8 }}>{g.title}</div>
            {g.flags.map(flag => {
              const value = features[flag.key] as unknown;
              if (flag.type === 'bool') {
                return (
                  <label key={String(flag.key)} style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                    ...MONO, fontSize: 10, cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={!!value}
                      onChange={(e) => onChange({ ...features, [flag.key]: e.target.checked } as K5Features)}
                      style={{ accentColor: '#82aaff' }}
                    />
                    {flag.label}
                  </label>
                );
              }
              return (
                <div key={String(flag.key)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ ...MONO, fontSize: 10, minWidth: 100 }}>{flag.label}</span>
                  <select
                    value={String(value)}
                    onChange={(e) => onChange({ ...features, [flag.key]: e.target.value } as K5Features)}
                    style={{
                      ...MONO, fontSize: 10, padding: '2px 4px',
                      background: '#0f1218', color: '#d6deeb',
                      border: '2px solid #2a3142',
                    }}
                  >
                    {flag.options?.map(o => (<option key={o} value={o}>{o}</option>))}
                  </select>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
