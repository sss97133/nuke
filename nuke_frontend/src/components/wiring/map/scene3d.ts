// map/scene3d.ts — what the MAP tab's 3D view loads and how it frames it: the harness zones, the layer GLBs other lanes
// publish (and which old zone nodes each one replaces), the true-size parts placed at their ends, and the camera views.
//
// Frames. Twin metres: +x driver, -y forward, +z up. The zone GLBs and the scene are glTF Y-up of the twin:
// scene (X, Y, Z) = twin (x, z, -y), so forward is +Z and the driver side is +X. A part-library GLB is glTF Y-up of its
// own part frame: file (X, Y, Z) = part (x, z, -y) (its pins.json says so).

import * as THREE from 'three';

export type ZoneId = 'bay' | 'cab' | 'rear';
export const ZONES: { id: ZoneId; label: string; short: string; url: string }[] = [
  { id: 'bay', label: 'ENGINE BAY', short: 'BAY', url: '/models/k5-harness-v4-bay.glb' },
  { id: 'cab', label: 'CAB', short: 'CAB', url: '/models/k5-harness-v4-cab.glb' },
  { id: 'rear', label: 'REAR', short: 'REAR', url: '/models/k5-harness-v4-rear.glb' },
];
// which zone holds an end, from its twin station (plan stations: firewall y -1.46, cab rear y 0.1)
export const zoneOfY = (y: number): ZoneId => (y < -1.46 ? 'bay' : y < 0.1 ? 'cab' : 'rear');

// ── Layer GLBs from other lanes. Each loads only if its file is published; while it is shown, the zone GLBs' nodes it
// replaces are hidden by name ("Name*" = every name starting with "Name"). Each file is drawn in the zones' frame.
// Extend `hides` when a layer draws more of the truck; the other v4 engine nodes are listed in ENGINE_NODES_KEPT.
export interface LayerDef { id: string; label: string; url: string; lane: string; hides: string[] }
export const LAYERS: LayerDef[] = [
  {
    id: 'frame', label: 'FRAME', url: '/models/k5-frame.glb', lane: 'chassis-3d',
    hides: ['CTX-frame-rail-web-driver', 'CTX-frame-rail-web-passenger'],
  },
  {
    id: 'engine', label: 'ENGINE', url: '/models/k5-engine-ls3.glb', lane: 'engine-3d',
    hides: [
      // long block
      'E3_Block_Crankcase', 'E3_Block_Bank_L', 'E3_Block_Bank_R', 'E3_Head_L', 'E3_Head_R', 'E3_ValveCover_L', 'E3_ValveCover_R',
      'E3_ValleyCover', 'E3_FrontCover', 'E3_RearCover', 'E3_OilPan_Shallow', 'E3_OilPan_Sump',
      // intake and fuel
      'E3_Intake_Plenum', 'E3_Intake_CarbPad', 'E3_Intake_ValleyPan', 'E3_Intake_Runner_*', 'E3_Intake_PortFlange_*',
      'E3_FuelRail_L', 'E3_FuelRail_R', 'E3_FuelPressReg_asbuilt', 'E3_TB_Adapter',
      // front drive (the pulleys and belt, not the devices on it)
      'E3_CrankPulley', 'E3_Damper', 'E3_Damper_Hub', 'E3_Belt', 'E3_Idler_Lower', 'E3_Tensioner_Body', 'E3_Tensioner_Pulley',
      'E3_WaterPump_Pulley', 'E3_WaterPump_Snout', 'E3_MidMount_WaterPumpManifold', 'E3_PS_Pulley', 'E3_PS_Pump', 'E3_PS_Reservoir',
    ],
  },
];
// v4 engine nodes no layer hides yet: devices that carry a harness end (selectable until a layer names its nodes by end
// code), the exhaust, and the transmission. Move a group into LAYERS' hides when a layer draws it.
export const ENGINE_NODES_KEPT = {
  devices: ['E3_Alternator_197-302', 'E3_Alternator_Fan', 'E3_Alternator_Pulley', 'E3_AC_Compressor_SD7_planned', 'E3_AC_Clutch_planned',
    'E3_Starter_DFSR-8715', 'E3_Starter_Solenoid', 'E3_Injector_*'],
  exhaust: ['E3_Header_*', 'E3_Collector_L', 'E3_Collector_R', 'E3_ExhFlange_*', 'E3_O2_Bung_L', 'E3_O2_Bung_R', 'E3_Exhaust_Tail_L', 'E3_Exhaust_Tail_R'],
  transmission: ['E3_6L90_Bell', 'E3_6L90_Case', 'E3_6L90_Pan'],
};
export const nameMatcher = (pats: string[]) => {
  const exact = new Set(pats.filter(p => !p.endsWith('*'))), pre = pats.filter(p => p.endsWith('*')).map(p => p.slice(0, -1));
  return (name: string) => exact.has(name) || pre.some(p => name.startsWith(p));
};

// ── True-size parts from the part library (nuke_frontend/public/models/part-library/, from the index's per-end records), placed
// at their end's spot in k5-positions.json. The part's axes are given in twin directions: z = its mount_normal (set
// against the mounting surface), y = its maker_up; x = y × z. `at` is the part point (mm, part frame) that sits on the
// spot, the origin unless given. `assumed` names what about the orientation is not sourced.
export interface TruePart {
  code: string; url: string; zone: ZoneId; hides: string[];
  z: [number, number, number]; y: [number, number, number]; at?: [number, number, number];
  why: string; assumed?: string;
}
export const TRUE_PARTS: TruePart[] = [
  {
    code: 'HEADLIGHT-L', url: '/models/part-library/HEADLIGHT-L.glb', zone: 'bay', hides: ['HEADLIGHT-L'],
    z: [0, -1, 0], y: [0, 0, 1],
    why: 'flange on the bucket ring at the bucket centre (body model mesh Headlights); lens forward, maker up up',
  },
  {
    code: 'HEADLIGHT-R', url: '/models/part-library/HEADLIGHT-R.glb', zone: 'bay', hides: ['HEADLIGHT-R'],
    z: [0, -1, 0], y: [0, 0, 1],
    why: 'flange on the bucket ring at the bucket centre (body model mesh Headlights); lens forward, maker up up',
  },
  {
    code: 'FAN', url: '/models/part-library/FAN.glb', zone: 'bay', hides: ['FAN'],
    z: [0, 1, 0], y: [0, 0, 1],
    why: 'rear lip on the engine side of the radiator core, axis along the truck (harness-cad v4 hub spot)',
    assumed: 'clocking about the axis (maker up taken as up)',
  },
  {
    code: 'TB', url: '/models/part-library/TB.glb', zone: 'bay',
    hides: ['E3_ThrottleBody_12699160', 'E3_TB_Bore', 'E3_TB_MotorHousing', 'E3_TB_Blade'],
    z: [0, 0, 1], y: [1, 0, 0], at: [-25, -115, 35],
    why: 'stands on the 4-bolt adapter at the 4150 pad, bore vertical (twin engine v3); its plug on the tps anchor',
    assumed: 'which side the electronics housing faces (the twin anchor is an estimate)',
  },
];

const toScene = (v: [number, number, number] | THREE.Vector3Tuple) => new THREE.Vector3(v[0], v[2], -v[1]);

// The truck's envelope and each zone's station box, twin metres (planGeometry: bumper y -2.97, tail lights +1.86,
// firewall -1.46, cab rear +0.1). Views frame these, so a loom that runs the length of a zone GLB never shrinks a view.
type V3 = [number, number, number];
export const TRUCK_TWIN: { min: V3; max: V3 } = { min: [-1.05, -2.97, 0], max: [1.05, 1.86, 2.0] };
export const ZONE_TWIN: Record<ZoneId, { min: V3; max: V3 }> = {
  bay: { min: [-0.95, -2.75, 0.2], max: [0.95, -1.4, 1.45] },
  cab: { min: [-0.95, -1.5, 0.3], max: [0.95, 0.15, 1.75] },
  rear: { min: [-0.95, 0.0, 0.25], max: [0.95, 1.9, 1.6] },
};
export const twinBox = (b: { min: V3; max: V3 }) => new THREE.Box3().setFromPoints([toScene(b.min), toScene(b.max)]);

/** The matrix that draws a part-library GLB at its end: file → part frame → twin → scene. */
export function partMatrix(p: TruePart, spot: [number, number, number]): THREE.Matrix4 {
  const zS = toScene(p.z).normalize(), yS = toScene(p.y).normalize(), xS = new THREE.Vector3().crossVectors(yS, zS);
  const at = p.at ?? [0, 0, 0];
  // the spot minus where the `at` point sits relative to the part origin, in twin metres
  const off = new THREE.Vector3().addScaledVector(xS, at[0] / 1000).addScaledVector(yS, at[1] / 1000).addScaledVector(zS, at[2] / 1000);
  // file X = part x, file Y = part z, file Z = -(part y)
  const m = new THREE.Matrix4().makeBasis(xS, zS, yS.clone().negate());
  m.setPosition(toScene(spot).sub(off));
  return m;
}

// ── Camera views. `dir` points from the target to the camera (scene frame); a zone view frames that zone.
export type ViewId = 'front' | 'rear' | 'driver' | 'passenger' | 'top' | 'bay' | 'cab' | 'rearbody' | 'home';
export const VIEWS: { id: ViewId; label: string; dir: [number, number, number]; zone?: ZoneId }[] = [
  { id: 'front', label: 'FRONT', dir: [0, 0.08, 1] },
  { id: 'rear', label: 'REAR', dir: [0, 0.08, -1] },
  { id: 'driver', label: 'DRIVER SIDE', dir: [1, 0.08, 0] },
  { id: 'passenger', label: 'PASSENGER SIDE', dir: [-1, 0.08, 0] },
  { id: 'top', label: 'TOP', dir: [0.02, 1, 0] },          // front to the left, driver side down, as on the plan
  { id: 'bay', label: 'ENGINE BAY', dir: [0.55, 0.9, 1], zone: 'bay' },
  { id: 'cab', label: 'CAB', dir: [-0.8, 0.9, -0.35], zone: 'cab' },
  { id: 'rearbody', label: 'REAR BODY', dir: [0.7, 0.9, -1], zone: 'rear' },
];
export const HOME_DIR: [number, number, number] = [1, 0.75, 1.1];

/** Camera distance that fits `box` in view from `dir` (perspective camera), with a margin. */
export function fitDistance(box: THREE.Box3, dir: THREE.Vector3, cam: THREE.PerspectiveCamera, margin = 1.12): number {
  const d = dir.clone().normalize(), up = new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, d); if (x.lengthSq() < 1e-8) x.set(1, 0, 0); x.normalize();
  const y = new THREE.Vector3().crossVectors(d, x).normalize();
  const c = box.getCenter(new THREE.Vector3());
  let hw = 0, hh = 0, hd = 0;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
    hw = Math.max(hw, Math.abs(p.dot(x))); hh = Math.max(hh, Math.abs(p.dot(y))); hd = Math.max(hd, Math.abs(p.dot(d)));
  }
  const vt = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), ht = vt * cam.aspect;
  return Math.max(hw / ht, hh / vt, 0.25) * margin + hd;
}

/** A scene node's name as a visitor may read it: no lane prefixes, no working words ("planned", "candidate"). */
export function objectLabel(name: string): string {
  return name.replace(/^(E3|CTX)[_-]/, '').replace(/_fill$/, '').replace(/[_-]+/g, ' ')
    .replace(/\b(planned|proposed|candidate|concept|asbuilt|placeholder|seg\d+)\b/gi, '').replace(/\s{2,}/g, ' ').trim() || name;
}
