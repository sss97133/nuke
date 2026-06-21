// harnessDerivation.parity.test.ts — parity against the python doctrine engines:
//   scripts/k5_harness_calc.py (toggle/PDM/budget) on docs/wiring/configs/*.toml
//   scripts/generate_connector_build_sheets.py (D38999 cavity allocation)
//   docs/wiring/output/K5_cut_list_v4.txt (162-wire registry incl companions)
//
// Run: npx vitest --run src/components/wiring/__tests__/harnessDerivation.parity.test.ts

import { describe, it, expect } from 'vitest';
import {
  deriveHarness, SUBSYSTEMS, computeLandmarksIn,
  DEFAULT_POSITIONS, LANDMARK_WAYPOINTS,
} from '../harnessDerivation';
import { WIRE_REGISTRY, LANDMARKS_IN } from '../k5LandmarkPaths';
import { K5_SUBSYSTEMS, V4_WIRE_SUBSYSTEMS } from '../k5Subsystems';

const BASELINE = { devices: [], toggles: {} };

// docs/wiring/configs/k5_work_truck.toml — stripped work-truck variant
const WORK_TRUCK = {
  devices: [],
  toggles: {
    AUDIO: false,
    POWER_WINDOWS: false,
    POWER_LOCKS: false,
    AMP_STEPS: false,
    CAMERA_REAR: false,
  },
};

describe('substrate integrity', () => {
  it('registry carries exactly the 162 cut-list v4 wires', () => {
    expect(WIRE_REGISTRY.length).toBe(162);
    expect(new Set(WIRE_REGISTRY.map(w => w.id)).size).toBe(162);
  });

  it('every registry wire has a subsystem assignment (145 v3 + 17 v4)', () => {
    const mapped = new Set<string>();
    for (const sub of Object.values(K5_SUBSYSTEMS)) for (const id of sub.wireIds) mapped.add(id);
    for (const id of Object.keys(V4_WIRE_SUBSYSTEMS)) mapped.add(id);
    const missing = WIRE_REGISTRY.filter(w => !mapped.has(w.id)).map(w => w.id);
    expect(missing).toEqual([]);
    expect(Object.keys(V4_WIRE_SUBSYSTEMS).length).toBe(17);
  });
});

describe('baseline (everything ON — k5_baseline.toml)', () => {
  const h = deriveHarness(BASELINE);

  it('derives 162 wires including companions', () => {
    expect(h.wires.length).toBe(162);
    expect(h.droppedWireIds).toEqual([]);
  });

  it('companion expansion per DOC-05 (contradiction C1 corrected)', () => {
    const byId = new Map(h.wires.map(w => [w.id, w]));
    expect(byId.get('99')?.companions).toEqual(expect.arrayContaining(['99g', '99r', '99s'])); // ecu_crank_cam
    expect(byId.get('110')?.companions).toEqual(['110g']);                                     // analog_temp
    expect(byId.get('108')?.companions).toEqual(expect.arrayContaining(['108g', '108r']));     // analog_5v
    expect(byId.get('103')?.companions).toEqual(expect.arrayContaining(['103g', '103s']));     // piezoelectric
    expect(byId.get('13')?.companions).toContain('INJ_PWR');                                   // low_side_drive rail
    expect(byId.get('5')?.companions).toEqual(expect.arrayContaining(['COIL_PWR', 'COIL_GND'])); // logic_coil_drive rails
    // no DOC-05 doctrine gaps at baseline
    expect(h.budget.warnings.filter(w => w.startsWith('DOC-05 GAP'))).toEqual([]);
  });

  it('PDM30 board: 30 channels, validated ratings 8x20A + 22x8A, none freed', () => {
    expect(h.pdm.length).toBe(30);
    expect(h.pdm[0].rating).toBe(20);
    expect(h.pdm[7].rating).toBe(20);
    expect(h.pdm[8].rating).toBe(8);
    expect(h.pdm[29].rating).toBe(8);
    expect(h.freedChannels).toEqual([]);
  });

  it('budget matches python: nameplate 393.9A, alternator ceil(x1.25) = 493A', () => {
    expect(h.budget.nameplateAmps).toBeCloseTo(393.9, 1);
    expect(h.budget.alternatorRequired).toBe(493);
    expect(h.alternatorRecommendation).toContain('dual alternator');
  });

  it('bulkhead: 61/61 cavities used (42 seed + 19 fill), overflow = 8', () => {
    const used = h.bulkhead.cavities.filter(c => c.wire);
    expect(h.bulkhead.cavities.length).toBe(61);
    expect(used.length).toBe(61);
    expect(used.filter(c => c.source === 'seed').length).toBe(42);
    expect(used.filter(c => c.source === 'fill').length).toBe(19);
    // R6 overflow — exact set from generate_connector_build_sheets.py OVERFLOW
    expect(h.bulkhead.overflow.length).toBe(8);
    expect(new Set(h.bulkhead.overflow.map(w => w.id))).toEqual(
      new Set(['100', '102g', '102r', '112g', '112r', '60', '114', '115']),
    );
  });

  it('bulkhead direct-feed block matches the build-sheet DOES-NOT-PASS list', () => {
    expect(new Set(h.bulkhead.directFeed.map(w => w.id))).toEqual(
      new Set(['21', '22', '25', '51', '48', '49', '85a', '85b', '86a', '86b', 'INJ_PWR', 'COIL_PWR', '6', '59', '63', '52']),
    );
  });

  it('seed cavities land where the build sheets put them', () => {
    const byCavity = new Map(h.bulkhead.cavities.map(c => [c.cavity, c.wire?.id]));
    expect(byCavity.get('A')).toBe('23');   // A/C clutch
    expect(byCavity.get('x')).toBe('99');   // CKP
    expect(byCavity.get('DD')).toBe('102'); // OPS
    expect(byCavity.get('GG')).toBe('4d');  // TPS2
  });

  it('costs and footage are computed', () => {
    expect(h.costUsd).toBeGreaterThan(0);
    expect(h.totalLengthFt).toBeGreaterThan(0);
    expect(Object.keys(h.byGauge)).toContain('22');
    expect(Object.keys(h.bySpec)).toContain('M22759/32-22');
    expect(h.trunkOdIn.ENGINE_LOOM).toBeGreaterThan(0);
  });
});

describe('work-truck config (k5_work_truck.toml)', () => {
  const h = deriveHarness(WORK_TRUCK);

  it('drops 24 wires (AUDIO 13 + WINDOWS 4 + LOCKS 3 + STEPS 3 + CAMERA 1)', () => {
    expect(h.droppedWireIds.length).toBe(24);
    expect(h.wires.length).toBe(162 - 24);
  });

  it('frees 8 PDM channels; OUT15 NOT freed (backup lights still on it)', () => {
    expect(h.freedChannels).toEqual([3, 4, 9, 10, 11, 20, 21, 22]);
    expect(h.freedChannels).not.toContain(15);
    expect(h.pdm.find(c => c.channel === 15)?.devices.length).toBeGreaterThan(0);
  });
});

describe('cross-dependency keeps (python cross_keep)', () => {
  it('#53 brake switch survives BRAKES_IBOOSTER off while lighting/trans on', () => {
    const h = deriveHarness({ devices: [], toggles: { BRAKES_IBOOSTER: false } });
    const ids = new Set(h.wires.map(w => w.id));
    expect(ids.has('53')).toBe(true);   // kept by LIGHTING_EXTERIOR / TRANS_6L80E
    expect(ids.has('52')).toBe(false);  // iBooster feed drops
    expect(ids.has('95')).toBe(false);  // iBooster relay drops
  });

  it('#57 reverse switch survives TRANS_6L80E off while camera on', () => {
    const h = deriveHarness({ devices: [], toggles: { TRANS_6L80E: false } });
    const ids = new Set(h.wires.map(w => w.id));
    expect(ids.has('57')).toBe(true);
    expect(ids.has('58')).toBe(false);  // controller drops
    expect(ids.has('125')).toBe(false); // v4 T43 CAN stub drops with the subsystem
  });
});

describe('positional derivation (digital-twin waypoint contract)', () => {
  const base = deriveHarness(BASELINE);
  // Wires whose effective paths route through the battery power spine
  // (L14 BAT→ALT / L15 BAT→STARTER) per WIRE_PATHS.
  const SPINE_IDS = ['21', '22', '52', '59', '6', '60', '63', '80', '82', '83', '84', '85a', '85b', '86a', '86b'];

  it('all 30 landmarks carry waypoint polylines, node-anchored, method documented', () => {
    expect(Object.keys(LANDMARK_WAYPOINTS).sort()).toEqual(Object.keys(LANDMARKS_IN).sort());
    for (const wp of Object.values(LANDMARK_WAYPOINTS)) {
      expect(typeof wp.points[0]).toBe('string'); // first endpoint is a node anchor
      expect(['waypoint_exact', 'endpoint_calibrated']).toContain(wp.method);
      // All 30 were recovered from the 2026-06-09 Blender session — the
      // calibration offset is pure 1-decimal rounding residue.
      if (wp.method === 'waypoint_exact') expect(Math.abs(wp.calibrationIn)).toBeLessThanOrEqual(0.06);
    }
  });

  it('DEFAULT_POSITIONS reproduces the baked landmark table EXACTLY (parity gate)', () => {
    expect(computeLandmarksIn(DEFAULT_POSITIONS)).toEqual(LANDMARKS_IN);
    expect(computeLandmarksIn(undefined)).toEqual(LANDMARKS_IN);
  });

  it('positions=DEFAULT_POSITIONS derives an identical harness to no positions', () => {
    expect(deriveHarness({ ...BASELINE, positions: DEFAULT_POSITIONS })).toEqual(base);
  });

  it('battery +1m changes L14/L15 only; spine rows flagged; all else identical', () => {
    const bat = DEFAULT_POSITIONS.BAT;
    const positions = { ...DEFAULT_POSITIONS, BAT: { x: bat.x + 1, y: bat.y, z: bat.z } };
    const lm = computeLandmarksIn(positions);
    expect(lm.L14).toBeGreaterThan(LANDMARKS_IN.L14 + 30); // +36.6" via first segment
    expect(lm.L15).toBeGreaterThan(LANDMARKS_IN.L15 + 30); // +32.6"
    for (const k of Object.keys(LANDMARKS_IN)) {
      if (k !== 'L14' && k !== 'L15') expect(lm[k]).toBeCloseTo(LANDMARKS_IN[k], 6);
    }

    const h = deriveHarness({ ...BASELINE, positions });
    const baseById = new Map(base.wires.map(w => [w.id, w]));
    const flagged: string[] = [];
    for (const w of h.wires) {
      const b = baseById.get(w.id)!;
      if (w.powerSpineAffected) {
        flagged.push(w.id);
        expect(w.lengthFt).toBeGreaterThan(b.lengthFt);
      } else {
        expect(w).toEqual(b); // every non-spine row is bit-identical
      }
    }
    expect(flagged.sort()).toEqual([...SPINE_IDS].sort());
    expect(h.budget.warnings.some(w => w.startsWith('POWER SPINE: battery position moved'))).toBe(true);

    // Structure unmoved: PDM loading, cavity map, overflow/direct-feed sets,
    // budget numbers, dropped set.
    expect(h.pdm).toEqual(base.pdm);
    expect(h.freedChannels).toEqual(base.freedChannels);
    expect(h.bulkhead.cavities.map(c => [c.cavity, c.wire?.id ?? null, c.source]))
      .toEqual(base.bulkhead.cavities.map(c => [c.cavity, c.wire?.id ?? null, c.source]));
    expect(new Set(h.bulkhead.overflow.map(w => w.id))).toEqual(new Set(base.bulkhead.overflow.map(w => w.id)));
    expect(new Set(h.bulkhead.directFeed.map(w => w.id))).toEqual(new Set(base.bulkhead.directFeed.map(w => w.id)));
    expect(h.budget.nameplateAmps).toBe(base.budget.nameplateAmps);
    expect(h.budget.alternatorRequired).toBe(base.budget.alternatorRequired);
    expect(h.droppedWireIds).toEqual(base.droppedWireIds);
    expect(h.totalLengthFt).toBeGreaterThan(base.totalLengthFt);
  });

  it('gauge re-derives at new lengths: 12A fan passes 12 AWG at default, flags 10 AWG after battery +1m', () => {
    const devices = [{ device_name: 'Radiator Fan 1', power_draw_amps: 12 } as never];
    const def = deriveHarness({ devices, toggles: {} });
    const w0 = def.wires.find(w => w.id === '21')!; // path L16+L14 → 7.54 ft, vdrop 0.3597V ≤ 0.36V
    expect(w0.gaugeChangedFromSpec).toBe(false);
    expect(w0.effectiveGauge).toBe(12);

    const bat = DEFAULT_POSITIONS.BAT;
    const positions = { ...DEFAULT_POSITIONS, BAT: { x: bat.x + 1, y: bat.y, z: bat.z } };
    const h = deriveHarness({ devices, toggles: {}, positions });
    const w1 = h.wires.find(w => w.id === '21')!; // ~10.9 ft, vdrop 0.52V → needs 10 AWG
    expect(w1.gaugeChangedFromSpec).toBe(true);
    expect(w1.effectiveGauge).toBe(10);
    expect(w1.powerSpineAffected).toBe(true);
    // footage buckets follow the effective gauge
    expect(h.byGauge['10']).toBeGreaterThan(0);
  });
});

describe('toggle surface', () => {
  it('non-toggleable subsystems cannot be switched off', () => {
    const h = deriveHarness({ devices: [], toggles: { CORE_ENGINE: false, CHARGING_STARTING: false } });
    expect(h.wires.length).toBe(162); // nothing dropped
  });

  it('SUBSYSTEMS UI surface matches K5_SUBSYSTEMS', () => {
    expect(SUBSYSTEMS.length).toBe(Object.keys(K5_SUBSYSTEMS).length);
    expect(SUBSYSTEMS.filter(s => !s.toggleable).map(s => s.id).sort()).toEqual(
      ['CHARGING_STARTING', 'CORE_ENGINE', 'HARNESS_INFRA'],
    );
  });
});
