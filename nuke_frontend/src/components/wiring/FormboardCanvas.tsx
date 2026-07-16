// FormboardCanvas.tsx — Interactive 1:1 scale pegboard formboard
// Drag-and-drop connectors onto a 1" grid. True physical dimensions.
// Saves positions to vehicle_build_manifest.pos_x_pct / pos_y_pct.

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { computeOverlay, type WireSpec } from './overlayCompute';
import { routeWiresAlongHarness, computeTrunkSegments, type HarnessRoutedWire } from './harnessRouting';
import { buildK5Obstacles, routeAroundObstacles, type Bbox as ObstacleBbox, type Pt as ObstaclePt } from './obstacleRouting';
import { TOP_DOWN, type VehicleLayer, type VehicleSilhouette } from './vehicleSilhouettes';
import { placeDeviceLabels, computeLabelText, type DeviceLabelInput } from './deviceLabelPlacer';
import { WIRE_COLOR_HEX, wireColorHex, ZONE_COLORS } from './wiringTheme';

// ── Sub-loom definitions ──────────────────────────────────────────────
const SUB_LOOMS = [
  { id: 'all', label: 'ALL', zones: null },
  { id: 'engine', label: 'ENGINE', zones: ['engine_bay', 'firewall'] },
  { id: 'dash', label: 'DASH', zones: ['dash'] },
  { id: 'rear', label: 'REAR', zones: ['rear', 'underbody'] },
  { id: 'audio', label: 'AUDIO', zones: ['dash', 'doors', 'rear'] },
  { id: 'door_l', label: 'DOOR L', zones: ['doors'] },
  { id: 'door_r', label: 'DOOR R', zones: ['doors'] },
  { id: 'can', label: 'CAN BUS', zones: null },
] as const;

// ── Physical constants (inches) ──────────────────────────────────────
const GRID_INCH = 1; // 1" between peg holes
const BOARD_W = 200; // board width in inches
const BOARD_H = 96;  // board height in inches
const VEH_L = 184.8; // vehicle length
const VEH_W = 79.6;  // vehicle width
const VEH_OX = (BOARD_W - VEH_L) / 2; // vehicle offset X
const VEH_OY = (BOARD_H - VEH_W) / 2; // vehicle offset Y

// ── Connector physical dimensions (inches) from datasheets ───────────
const CONNECTOR_DIMS: Record<string, { w: number; h: number }> = {
  superseal_34pin: { w: 2.4, h: 1.2 },
  'superseal_34pin+26pin': { w: 2.4, h: 1.2 },
  superseal_26pin: { w: 2.0, h: 1.0 },
  mil_spec_D38999_26WA98SN: { w: 1.8, h: 1.8 },
  dakota_digital_control_box: { w: 3.5, h: 2.0 },
  ev6_uscar_2pin: { w: 0.7, h: 0.5 },
  weatherpack_2pin: { w: 0.6, h: 0.4 },
  metri_pack_2pin: { w: 0.5, h: 0.3 },
  metri_pack_3pin: { w: 0.6, h: 0.4 },
  metri_pack_3pin_gray: { w: 0.6, h: 0.4 },
  deutsch_dt_2pin: { w: 0.8, h: 0.5 },
  deutsch_dt_3pin: { w: 0.9, h: 0.5 },
  deutsch_dt_12: { w: 1.6, h: 0.8 },
  h4_3blade: { w: 1.2, h: 0.8 },
  '1157_bay15d': { w: 0.8, h: 0.8 },
  '1156_ba15s': { w: 0.8, h: 0.8 },
  iso_din_plug_a_b: { w: 1.5, h: 0.6 },
  set_screw_rca: { w: 2.0, h: 1.2 },
  rca_composite: { w: 0.5, h: 0.5 },
  gm_coil_4pin: { w: 0.8, h: 0.6 },
  gm_column_multipin: { w: 1.5, h: 1.0 },
  inline_9pin: { w: 1.3, h: 0.8 },
  inline_7pin: { w: 1.1, h: 0.7 },
  gm_window_switch: { w: 1.0, h: 0.6 },
  speaker_quick_connect: { w: 0.5, h: 0.3 },
  iso_mini_relay_5pin: { w: 1.0, h: 1.0 },
  blade_terminal: { w: 0.5, h: 0.3 },
  blade_terminal_1: { w: 0.4, h: 0.3 },
  blade_terminal_2pin: { w: 0.5, h: 0.3 },
  blade_terminal_3: { w: 0.6, h: 0.3 },
  ring_terminal: { w: 0.5, h: 0.5 },
  ring_terminal_m8: { w: 0.5, h: 0.5 },
  ring_terminal_stud: { w: 0.8, h: 0.5 },
  spade_terminal: { w: 0.4, h: 0.3 },
  spade_terminals: { w: 2.0, h: 1.2 },
  gm_4pin_rect: { w: 1.5, h: 0.8 },
  'gm_4pin_rect+bat_stud': { w: 1.5, h: 0.8 },
  autosport_12pin: { w: 1.4, h: 0.8 },
  'autosport_26pin+usb': { w: 1.5, h: 1.2 },
  bosch_26pin: { w: 2.2, h: 1.5 },
  bosch_map_3pin: { w: 0.7, h: 0.4 },
  gm_oil_press_3pin_oval: { w: 0.7, h: 0.4 },
  'ring_terminal+polarized_plug': { w: 1.2, h: 1.2 },
  dual_post_sae: { w: 1.5, h: 1.0 },
  'dual_post_sae+gm': { w: 1.5, h: 1.0 },
  twisted_pair: { w: 0.8, h: 0.4 },
  gm_dbw_6pin: { w: 1.0, h: 0.6 },
  sealed_2pin: { w: 0.5, h: 0.3 },
  bosch_lsu49: { w: 0.8, h: 0.5 },
  proprietary_amp: { w: 1.2, h: 0.8 },
  gm_blower_5pin: { w: 1.0, h: 0.6 },
  gm_iat_2pin: { w: 0.5, h: 0.3 },
  gm_lock_switch_5pin: { w: 0.8, h: 0.5 },
  male_blade: { w: 0.5, h: 0.3 },
  direct_harness: { w: 0.7, h: 0.5 },
  push_button: { w: 1.0, h: 1.0 },
  festoon_or_bayonet: { w: 0.6, h: 0.3 },
  soldered_inline: { w: 0.5, h: 0.3 },
  sma_connector: { w: 0.4, h: 0.4 },
  motorola_plug: { w: 0.5, h: 0.5 },
  blade_or_weatherpack: { w: 0.6, h: 0.4 },
  weatherpack_or_bare: { w: 0.6, h: 0.4 },
  deutsch_dt_3pin: { w: 0.9, h: 0.5 },
  '2pin_flasher': { w: 0.6, h: 0.4 },
  dash_multipin: { w: 1.0, h: 0.6 },
  grommet: { w: 1.5, h: 1.5 },
  splice_junction: { w: 1.0, h: 0.5 },
};


// ── COMPONENT VECTORS ────────────────────────────────────────────────
// Rough shapes of physical parts at true dimensions (inches).
// Source documents noted for each. These are sloppy-fast outlines —
// enough to show where connectors sit on the hardware.
//
// Coordinates are vehicle-relative (X from front bumper, Y from driver side).
// Each shape is a closed polygon or set of primitives.

interface ComponentVector {
  name: string;
  source: string; // document that gave us the dimensions
  fill: string;
  stroke: string;
  opacity: number;
  // Shapes: array of drawing ops in vehicle coordinates (inches)
  shapes: VectorShape[];
}

type VectorShape =
  | { type: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { type: 'poly'; points: [number, number][] }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'label'; x: number; y: number; text: string; size: number };

// All dims from datasheets, install docs, or GM service manual measurements
const ENGINE_VECTORS: ComponentVector[] = [
  // ── LS3 BLOCK (top-down footprint) ──
  // GM LS3: deck-to-deck ~20", front-to-rear ~22", bore spacing 4.4"
  {
    name: 'LS3 Block',
    source: 'GM LS3 service manual',
    fill: '#8B8B8B', stroke: '#666', opacity: 0.12,
    shapes: [
      { type: 'rect', x: 6, y: 30, w: 22, h: 20, r: 1 },  // block footprint
      // Label sits in the narrow band between intake manifold (y=33-47) and the
      // block bottom edge, front-side corner — so it doesn't collide with the
      // "HOLLEY 300-131 / INTAKE MANIFOLD" stack in the center.
      { type: 'label', x: 8, y: 49, text: 'LS3', size: 1.3 },
    ],
  },
  // ── VALVE COVERS ──
  // GM LS valve cover: ~20" long × 4.5" wide
  {
    name: 'Valve Cover Driver',
    source: 'GM LS3 dims',
    fill: '#999', stroke: '#777', opacity: 0.10,
    shapes: [
      { type: 'rect', x: 7, y: 25.5, w: 20, h: 4.5 },
      { type: 'label', x: 17, y: 28, text: 'VALVE COVER (D)', size: 1.5 },
    ],
  },
  {
    name: 'Valve Cover Passenger',
    source: 'GM LS3 dims',
    fill: '#999', stroke: '#777', opacity: 0.10,
    shapes: [
      { type: 'rect', x: 7, y: 50, w: 20, h: 4.5 },
      { type: 'label', x: 17, y: 52.5, text: 'VALVE COVER (P)', size: 1.5 },
    ],
  },
  // ── HOLLEY 300-131 INTAKE MANIFOLD ──
  // Single-plane, top-down footprint ~18" × 10" on LS heads
  // Source: Holley install doc IMG_9324/9325, tightening sequence diagram
  {
    name: 'Holley 300-131 Intake',
    source: 'Holley 300-131 install doc (IMG_9324)',
    fill: '#C0A060', stroke: '#8B7040', opacity: 0.15,
    shapes: [
      // Main manifold body (the X-pattern runner casting)
      { type: 'rect', x: 8, y: 33, w: 18, h: 14, r: 1 },
      // Plenum opening (center cavity in tightening diagram)
      { type: 'rect', x: 12, y: 37, w: 6, h: 6 },
      // Single-line label — stacking two labels at the same point just creates
      // an unreadable blob over the plenum.
      { type: 'label', x: 15, y: 40, text: 'HOLLEY 300-131 INTAKE', size: 1.3 },
    ],
  },
  // ── THROTTLE BODY ──
  // GM 90mm DBW throttle body: ~3.8" × 3.5" flange, mounts rear of manifold
  // Source: Holley doc says "at the rear of the carb flange"
  {
    name: 'Throttle Body (90mm)',
    source: 'Holley 300-131 doc + GM 12605109 dims',
    fill: '#A0A0A0', stroke: '#666', opacity: 0.18,
    shapes: [
      // TB body (roughly circular bore with rectangular flange)
      { type: 'rect', x: 24, y: 38, w: 3.8, h: 4 },
      { type: 'circle', cx: 25.9, cy: 40, r: 1.8 },  // bore opening
      { type: 'label', x: 25.9, y: 43, text: 'ETB 90mm', size: 1.3 },
    ],
  },
  // ── FUEL RAILS ──
  // Holley fuel rail kit 534-219: ~18" long × 1.2" wide each, run along heads
  {
    name: 'Fuel Rail Driver',
    source: 'Holley 534-219 fuel rail kit',
    fill: '#3366AA', stroke: '#2244AA', opacity: 0.15,
    shapes: [
      { type: 'rect', x: 8, y: 31, w: 18, h: 1.2 },
      { type: 'label', x: 17, y: 32, text: 'FUEL RAIL (D)', size: 1.2 },
    ],
  },
  {
    name: 'Fuel Rail Passenger',
    source: 'Holley 534-219 fuel rail kit',
    fill: '#3366AA', stroke: '#2244AA', opacity: 0.15,
    shapes: [
      { type: 'rect', x: 8, y: 47.8, w: 18, h: 1.2 },
      { type: 'label', x: 17, y: 48.8, text: 'FUEL RAIL (P)', size: 1.2 },
    ],
  },
  // ── COIL RELOCATION BRACKET ──
  // Behind intake, between manifold rear and firewall
  // 8 × D510C coils: each 4.287" × 2.248"
  // Bracket assumed ~12" wide × 5" tall (4+4 layout, 2 rows of 4)
  // Positioned at vehicle X ≈ 26-28 (between intake rear at 26 and firewall at 32)
  {
    name: 'Coil Bracket (custom)',
    source: 'D510C 4.287×2.248 × 8, HEI-style relocation',
    fill: '#333', stroke: '#222', opacity: 0.12,
    shapes: [
      // Bracket plate
      { type: 'rect', x: 26, y: 34, w: 4, h: 12 },
      // Individual coil outlines (4+4, two columns)
      // Driver bank coils (left column)
      { type: 'rect', x: 26.2, y: 34.3, w: 1.8, h: 2.5 },   // coil 1
      { type: 'rect', x: 26.2, y: 37.0, w: 1.8, h: 2.5 },   // coil 3
      { type: 'rect', x: 26.2, y: 39.7, w: 1.8, h: 2.5 },   // coil 5
      { type: 'rect', x: 26.2, y: 42.4, w: 1.8, h: 2.5 },   // coil 7
      // Passenger bank coils (right column)
      { type: 'rect', x: 28.2, y: 34.3, w: 1.8, h: 2.5 },   // coil 2
      { type: 'rect', x: 28.2, y: 37.0, w: 1.8, h: 2.5 },   // coil 4
      { type: 'rect', x: 28.2, y: 39.7, w: 1.8, h: 2.5 },   // coil 6
      { type: 'rect', x: 28.2, y: 42.4, w: 1.8, h: 2.5 },   // coil 8
      { type: 'label', x: 28, y: 46.8, text: 'COIL BRACKET', size: 1.3 },
    ],
  },
  // ── RADIATOR ──
  // Typical K5 radiator: ~28" wide × 18" tall (at front of engine bay)
  {
    name: 'Radiator',
    source: 'K5 Blazer radiator dims',
    fill: '#55AAAA', stroke: '#338888', opacity: 0.08,
    shapes: [
      { type: 'rect', x: 0, y: 18, w: 3, h: 44 },
      { type: 'label', x: 1.5, y: 40, text: 'RAD', size: 1.5 },
    ],
  },
  // ── ALTERNATOR ──
  // Mechman 220A: ~7" dia × 6" deep. On LS3 with Mechman 403210 bracket,
  // mounts FRONT-DRIVER side low off the driver cylinder head.
  {
    name: 'Alternator',
    source: 'Mechman 403210 dims',
    fill: '#AA8844', stroke: '#886633', opacity: 0.12,
    shapes: [
      { type: 'circle', cx: 8.5, cy: 28, r: 2.8 },
      { type: 'label', x: 8.5, y: 28, text: 'ALT', size: 1.1 },
    ],
  },
  // ── A/C COMPRESSOR ──
  // Sanden 508 style: ~6" dia. Mounts FRONT-PASSENGER side low off the
  // passenger head bracket (mirrors alternator).
  {
    name: 'A/C Compressor',
    source: 'Sanden 508 dims',
    fill: '#88AA88', stroke: '#668866', opacity: 0.10,
    shapes: [
      { type: 'circle', cx: 8.5, cy: 52, r: 2.5 },
      { type: 'label', x: 8.5, y: 52, text: 'A/C', size: 1.1 },
    ],
  },
  // ── STARTER ──
  // ~7" long × 3.5" dia. On LS3, mounts at REAR-PASSENGER bell housing —
  // behind the block deck, between block rear and transmission.
  {
    name: 'Starter Motor',
    source: 'Denso DFSR-8715',
    fill: '#AA6644', stroke: '#885533', opacity: 0.10,
    shapes: [
      { type: 'ellipse', cx: 29, cy: 50, rx: 2.8, ry: 1.5 },
      { type: 'label', x: 29, y: 50, text: 'STRT', size: 1.0 },
    ],
  },
  // ── BATTERY ──
  // Optima 8004-003: 10" × 6.9" × 7.8"
  {
    name: 'Battery',
    source: 'Optima 8004-003',
    fill: '#CC4444', stroke: '#AA2222', opacity: 0.12,
    shapes: [
      { type: 'rect', x: 24, y: 60, w: 6.9, h: 10 },
      { type: 'label', x: 27.5, y: 65, text: 'BATTERY', size: 1.5 },
    ],
  },
];

// ── Layer toggle state type ──
type LayerName = 'grid' | 'vehicle' | 'components' | 'connectors' | 'trunks' | 'labels';

interface Device {
  id: string;
  device_name: string;
  device_category: string;
  connector_type: string | null;
  pin_count: number | null;
  power_draw_amps: number | null;
  location_zone: string | null;
  pos_x_pct: number | null; // stored as board inches (0-200)
  pos_y_pct: number | null; // stored as board inches (0-96)
}

interface Props {
  vehicleId: string;
  devices: Device[];
  onDeviceMove?: (id: string, x: number, y: number) => void;
  selectedDeviceId?: string | null;
  selectedWireId?: string | null;
  focusDeviceId?: string | null;
  onSelectDevice?: (id: string | null) => void;
  drcMap?: Map<string, import('./useDRC').DRCDeviceResult>;
  /**
   * Drawing mode:
   * - 'formboard' — IPC/WHMA-A-620 assembly drawing. Harness flat, 1:1 scale.
   *   No vehicle silhouette, no engine organs. Just trunks, connectors, breakouts.
   * - 'routing' — physical routing view. Vehicle silhouette + engine/dash/body
   *   components + harness overlay, so you can see where it physically runs.
   */
  mode?: 'formboard' | 'routing';
}

export function FormboardCanvas({ vehicleId, devices, onDeviceMove, selectedDeviceId, selectedWireId, focusDeviceId, onSelectDevice, drcMap, mode = 'formboard' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport state
  const [zoom, setZoom] = useState(3.5); // pixels per board inch
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Interaction state
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Layer visibility — defaults depend on drawing mode.
  //
  // FORMBOARD mode = IPC/WHMA-A-620 assembly drawing. The harness only, flat
  // and scaled. Vehicle and component organs must be OFF or it's not a
  // formboard, it's a hybrid routing map.
  //
  // ROUTING mode = physical vehicle view. Silhouette + engine + body components
  // ON by default so the installer can see where the harness actually runs.
  const isRouting = mode === 'routing';
  const [layers, setLayers] = useState<Record<LayerName, boolean>>({
    grid: true,
    vehicle: isRouting,
    components: isRouting,
    connectors: true,
    trunks: true,
    labels: true,
  });
  const toggleLayer = (name: LayerName) => setLayers(prev => ({ ...prev, [name]: !prev[name] }));

  // Vehicle silhouette layer visibility (from vehicleSilhouettes.ts)
  const silhouette = TOP_DOWN;
  const [vehLayers, setVehLayers] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const l of silhouette.layers) init[l.id] = l.defaultVisible;
    init['zones'] = true;  // zone boundaries on by default
    init['frame'] = true;  // frame rails on by default — wiring reference
    return init;
  });
  const toggleVehLayer = (id: string) => setVehLayers(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Real 3D geometry from Blender ────────────────────────────────────
  // Loads /data/k5-geometry.json (copied from docs/wiring/output/formboard/model_analysis.json).
  // Blender axes: +X=driver, −X=passenger, −Y=front, +Y=rear, +Z=up. Units: meters.
  // Projected onto the board: blender Y→board X (length), blender X→board Y (width).
  type K5GeomObj = {
    center: [number, number, number];
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    verts?: number;
    notes?: string;
  };
  const [k5Geom, setK5Geom] = useState<Record<string, K5GeomObj> | null>(null);
  // Per-device 3D positions extracted from blender-harness-router.py
  // (134 devices). Used by autoPlace so devices land at their real anchor
  // points instead of being grid-packed inside a zone bounding box.
  const [k5DevicePos, setK5DevicePos] = useState<Record<string, [number, number, number]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/data/k5-geometry.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/data/k5-device-positions.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([g, p]) => {
      if (cancelled) return;
      if (g) setK5Geom(g);
      if (p) setK5DevicePos(p);
    });
    return () => { cancelled = true; };
  }, []);

  // Blender-meters → board-inches transform, referenced to Exterior_Body_Blazer.
  // The body bbox defines the vehicle envelope. The truck is placed inside the
  // formboard's vehicle area (VEH_L × VEH_W centered on the board).
  const geomToBoard = useMemo(() => {
    if (!k5Geom) return null;
    const body = k5Geom['Exterior_Body_Blazer'];
    if (!body) return null;
    const bodyYLen = body.max[1] - body.min[1];  // front→rear extent in Blender Y
    const bodyXLen = body.max[0] - body.min[0];  // driver→passenger extent in Blender X
    // Use factory target dimensions for board placement (184.8 × 79.6),
    // scaling the body bbox to fit precisely so ±1% model error doesn't drift.
    const scaleX = VEH_L / bodyYLen;  // in per Blender-meter along board-X axis
    const scaleY = VEH_W / bodyXLen;  // in per Blender-meter along board-Y axis
    // Project a single blender world point (x, y, z) to board inches (bx, by).
    const proj = (bx: number, by: number): [number, number] => {
      const boardX = VEH_OX + (by - body.min[1]) * scaleX;
      const boardY = VEH_OY + (body.max[0] - bx) * scaleY;
      return [boardX, boardY];
    };
    return { body, bodyYLen, bodyXLen, scaleX, scaleY, proj };
  }, [k5Geom]);

  // 2D obstacles from Blender bboxes — used by pigtail routing to detour
  // around solid mass (engine, dash, wheels). Wires can't pass through metal.
  const obstacles = useMemo<ObstacleBbox[]>(() => {
    if (!geomToBoard || !k5Geom) return [];
    return buildK5Obstacles(k5Geom, geomToBoard.proj);
  }, [k5Geom, geomToBoard]);

  // Sub-loom tab state
  const [activeLoom, setActiveLoom] = useState<string>('all');

  // Wire hover state
  const [hoveredWireIdx, setHoveredWireIdx] = useState<number | null>(null);

  // Tool mode: 'select' | 'move' | 'lasso-freehand' | 'lasso-polygon'
  type ToolMode = 'select' | 'move' | 'lasso-freehand' | 'lasso-polygon';
  const [toolMode, setToolMode] = useState<ToolMode>('select');

  // Multi-select + lasso state
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [lassoPath, setLassoPath] = useState<{ x: number; y: number }[] | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<{ x: number; y: number }[]>([]);
  const [lassoCursor, setLassoCursor] = useState<{ x: number; y: number } | null>(null);

  // Device positions in board inches — initialize from DB or defaults
  // Declared BEFORE undo hooks to avoid TDZ on `positions` reference in pushUndo deps
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Undo stack for device positions
  const undoStackRef = useRef<Record<string, { x: number; y: number }>[]>([]);
  const pushUndo = useCallback(() => {
    undoStackRef.current.push(JSON.parse(JSON.stringify(positions)));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
  }, [positions]);
  const popUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (prev) setPositions(prev);
  }, []);

  // Compute wire overlay from devices for wire routing
  const overlay = useMemo(() => computeOverlay(devices as any), [devices]);

  // Ruler marks
  const [showRuler, setShowRuler] = useState(true);

  // Filter devices by active sub-loom
  const filteredDevices = useMemo(() => {
    const loom = SUB_LOOMS.find(l => l.id === activeLoom);
    if (!loom || !loom.zones) return devices;

    // CAN BUS loom: filter by device_category containing 'can' or 'bus'
    if (activeLoom === 'can') {
      return devices.filter(d =>
        (d.device_category || '').toLowerCase().includes('can') ||
        (d.device_name || '').toLowerCase().includes('can bus') ||
        (d.connector_type || '').toLowerCase().includes('twisted'),
      );
    }

    // Door L/R: filter by zone + approximate position
    if (activeLoom === 'door_l') {
      return devices.filter(d =>
        d.location_zone === 'doors' && (d.pos_y_pct == null || d.pos_y_pct < BOARD_H / 2),
      );
    }
    if (activeLoom === 'door_r') {
      return devices.filter(d =>
        d.location_zone === 'doors' && (d.pos_y_pct == null || d.pos_y_pct >= BOARD_H / 2),
      );
    }

    // Audio: filter by category
    if (activeLoom === 'audio') {
      return devices.filter(d =>
        (d.device_category || '').toLowerCase().includes('audio') ||
        (d.device_category || '').toLowerCase().includes('speaker') ||
        (d.device_name || '').toLowerCase().includes('speaker') ||
        (d.device_name || '').toLowerCase().includes('amp') ||
        (d.device_name || '').toLowerCase().includes('subwoofer') ||
        (d.connector_type || '').toLowerCase().includes('rca'),
      );
    }

    return devices.filter(d => loom.zones!.includes(d.location_zone || ''));
  }, [devices, activeLoom]);

  // Print formboard at actual 1:1 scale
  const handlePrint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const printWin = window.open('', '_blank');
    if (!printWin) return;
    printWin.document.write(`
      <!DOCTYPE html><html><head><title>Formboard Print</title>
      <style>
        @page { size: landscape; margin: 0.25in; }
        body { margin: 0; }
        img { width: 100%; height: auto; }
      </style>
      </head><body>
      <img src="${dataUrl}" />
      </body></html>
    `);
    printWin.document.close();
    printWin.focus();
    printWin.print();
  }, []);

  // Keyboard shortcuts for loom tabs (1-7) and zoom (+/-/0)
  // Note: fitToView referenced via ref to avoid circular dependency
  const fitToViewRef = useRef<() => void>(() => {});
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= SUB_LOOMS.length) {
        setActiveLoom(SUB_LOOMS[num - 1].id);
      }
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        handlePrint();
      }
      // Zoom keyboard shortcuts
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(z => Math.min(30, z * 1.2));
      }
      if (e.key === '-') {
        e.preventDefault();
        setZoom(z => Math.max(0.5, z / 1.2));
      }
      if (e.key === '0') {
        e.preventDefault();
        fitToViewRef.current();
      }
      // Cmd+Z / Ctrl+Z → undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        popUndo();
      }
      // V → select mode, M → move mode, L → freehand lasso, P → polygon lasso
      if (e.key === 'v' || e.key === 'V') {
        setToolMode('select');
      }
      if (e.key === 'm' || e.key === 'M') {
        setToolMode('move');
      }
      if (e.key === 'l' || e.key === 'L') {
        if (!(e.metaKey || e.ctrlKey)) {
          setToolMode('lasso-freehand');
          setLassoPath(null);
          setPolygonVertices([]);
        }
      }
      if (e.key === 'p' || e.key === 'P') {
        if (!(e.metaKey || e.ctrlKey)) {
          setToolMode('lasso-polygon');
          setPolygonVertices([]);
          setLassoPath(null);
        }
      }
      // Escape: cancel lasso / deselect all
      if (e.key === 'Escape') {
        setLassoPath(null);
        setPolygonVertices([]);
        setLassoCursor(null);
        setSelectedDevices(new Set());
        setSelected(null);
        onSelectDevice?.(null);
      }
      // Cmd/Ctrl+A: select all visible (filtered) devices
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const ids = new Set(filteredDevices.map(d => d.id));
        setSelectedDevices(ids);
        if (ids.size > 0) {
          const first = filteredDevices[0].id;
          setSelected(first);
          onSelectDevice?.(first);
        }
      }
      // Delete: remove selection from positions (move mode only)
      if ((e.key === 'Delete' || e.key === 'Backspace') && toolMode === 'move') {
        if (selectedDevices.size > 0) {
          e.preventDefault();
          pushUndo();
          setPositions(prev => {
            const next = { ...prev };
            for (const id of selectedDevices) delete next[id];
            return next;
          });
          setSelectedDevices(new Set());
          setSelected(null);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handlePrint, popUndo, filteredDevices, onSelectDevice, selectedDevices, toolMode, pushUndo]);

  // Initialize positions from device data.
  // Re-runs when geometry/positions load asynchronously so devices migrate
  // from zone-grid placement to real Blender coordinates once available.
  useEffect(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    for (const d of devices) {
      if (d.pos_x_pct != null && d.pos_y_pct != null) {
        pos[d.id] = { x: d.pos_x_pct, y: d.pos_y_pct };
      } else {
        pos[d.id] = autoPlace(d, Object.values(pos));
      }
    }
    setPositions(pos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, k5DevicePos, geomToBoard]);

  // Zoom-to-fit: bounding box of filtered devices (or vehicle bounds if no filter)
  const fitToView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Use filtered device positions if a sub-loom is active, else all
    const relevantDevices = filteredDevices.length > 0 ? filteredDevices : devices;
    const posValues = relevantDevices.map(d => positions[d.id]).filter(Boolean);
    if (posValues.length === 0) {
      // No devices — show full board
      const rect = canvas.getBoundingClientRect();
      const zx = rect.width / (BOARD_W + 20);
      const zy = rect.height / (BOARD_H + 20);
      const z = Math.min(zx, zy) * 0.9;
      setZoom(z);
      setPanX((rect.width - BOARD_W * z) / 2);
      setPanY((rect.height - BOARD_H * z) / 2);
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of posValues) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // Add 10% margin
    const margin = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 10);
    minX -= margin; maxX += margin; minY -= margin; maxY += margin;
    const rect = canvas.getBoundingClientRect();
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const z = Math.min(rect.width / spanX, rect.height / spanY);
    setZoom(Math.max(0.5, Math.min(30, z)));
    setPanX((rect.width - spanX * z) / 2 - minX * z);
    setPanY((rect.height - spanY * z) / 2 - minY * z);
  }, [positions, filteredDevices, devices]);

  // Keep ref in sync for keyboard handler
  fitToViewRef.current = fitToView;

  // Auto zoom-to-fit on initial mount (use rAF to ensure canvas has dimensions)
  const [didInitialFit, setDidInitialFit] = useState(false);
  useEffect(() => {
    if (didInitialFit) return;
    if (Object.keys(positions).length === 0) return;
    // Wait one frame for layout to settle
    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.getBoundingClientRect().width === 0) return;
      fitToView();
      setDidInitialFit(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [positions, didInitialFit, fitToView]);

  // Re-fit when switching sub-looms
  const prevLoom = useRef(activeLoom);
  useEffect(() => {
    if (prevLoom.current !== activeLoom) {
      prevLoom.current = activeLoom;
      requestAnimationFrame(() => fitToView());
    }
  }, [activeLoom, fitToView]);

  // Cross-view focus: when focusDeviceId changes from external nav (side panel),
  // just select the device — don't recenter or change zoom
  useEffect(() => {
    if (!focusDeviceId) return;
    setSelected(focusDeviceId);
  }, [focusDeviceId]);

  // Auto-placement by zone — wider zones that use the full 200×96" board
  function autoPlace(d: Device, existing: { x: number; y: number }[]): { x: number; y: number } {
    // ── 1. Real Blender 3D position (preferred) ───────────────────────
    // 134 devices have known 3D coords in k5-device-positions.json
    // (extracted from scripts/blender-harness-router.py DEVICE_POSITIONS).
    // Project (x_blender, y_blender) → board inches via geomToBoard.proj.
    if (k5DevicePos && geomToBoard) {
      const tryNames = [
        d.device_name,
        // Common alias normalizations seen in the build manifest
        d.device_name?.replace(/\s+\(.*?\)$/, ''),  // strip "(ECU)" etc.
        d.model_number,
      ].filter(Boolean) as string[];
      for (const name of tryNames) {
        const pos3d = k5DevicePos[name];
        if (pos3d) {
          const [bx, by] = geomToBoard.proj(pos3d[0], pos3d[1]);
          // Nudge if collision with existing placement
          let x = bx, y = by;
          let nudge = 0;
          while (existing.some(p => Math.abs(p.x - x) < 1.5 && Math.abs(p.y - y) < 1.5) && nudge < 8) {
            nudge++;
            x = bx + nudge * 0.8;
            y = by + (nudge % 2 ? 0.6 : -0.6);
          }
          return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
        }
      }
    }

    // ── 2. Fallback — zone-based grid packing ─────────────────────────
    const zone = d.location_zone || 'dash';
    const zoneDefaults: Record<string, { xMin: number; xMax: number; yMin: number; yMax: number }> = {
      engine_bay: { xMin: 8, xMax: 42, yMin: 10, yMax: 70 },
      firewall:   { xMin: 44, xMax: 50, yMin: 10, yMax: 70 },
      dash:       { xMin: 52, xMax: 90, yMin: 8, yMax: 72 },
      doors:      { xMin: 55, xMax: 85, yMin: 2, yMax: 78 },
      rear:       { xMin: 100, xMax: 185, yMin: 10, yMax: 70 },
      underbody:  { xMin: 55, xMax: 160, yMin: 30, yMax: 50 },
      audio:      { xMin: 60, xMax: 110, yMin: 15, yMax: 65 },
    };
    let bounds = zoneDefaults[zone] || zoneDefaults.dash;

    // Category sub-grouping: offset within zone by device_category
    const cat = (d.device_category || '').toLowerCase();
    let yBias = 0;
    const zoneH = bounds.yMax - bounds.yMin;
    if (cat.includes('sensor') || cat.includes('temp') || cat.includes('pressure')) {
      yBias = 0; // top of zone
    } else if (cat.includes('light') || cat.includes('lamp') || cat.includes('led')) {
      yBias = zoneH * 0.7; // bottom of zone
    } else if (cat.includes('audio') || cat.includes('speaker')) {
      yBias = zoneH * 0.2; // upper-left cluster
    } else if (cat.includes('motor') || cat.includes('actuator') || cat.includes('relay')) {
      yBias = zoneH * 0.5; // mid-right cluster
    } else {
      yBias = zoneH * 0.35; // default: upper-middle
    }

    // Grid packing with larger step (5") and collision radius (4")
    const step = 5;
    const collisionR = 4;
    const startY = bounds.yMin + yBias;

    // Try from category-biased Y first, then wrap around
    for (let x = bounds.xMin; x < bounds.xMax; x += step) {
      for (let yOff = 0; yOff < zoneH; yOff += step) {
        const y = bounds.yMin + ((startY - bounds.yMin + yOff) % zoneH);
        if (y < bounds.yMin || y >= bounds.yMax) continue;
        const collision = existing.some(p => Math.abs(p.x - x) < collisionR && Math.abs(p.y - y) < collisionR);
        if (!collision) return { x: Math.round(x), y: Math.round(y) };
      }
    }

    // Overflow: expand bounds by 20% and retry once
    const expandX = (bounds.xMax - bounds.xMin) * 0.1;
    const expandY = (bounds.yMax - bounds.yMin) * 0.1;
    bounds = {
      xMin: Math.max(2, bounds.xMin - expandX),
      xMax: Math.min(BOARD_W - 2, bounds.xMax + expandX),
      yMin: Math.max(2, bounds.yMin - expandY),
      yMax: Math.min(BOARD_H - 2, bounds.yMax + expandY),
    };
    for (let x = bounds.xMin; x < bounds.xMax; x += step) {
      for (let y = bounds.yMin; y < bounds.yMax; y += step) {
        const collision = existing.some(p => Math.abs(p.x - x) < collisionR && Math.abs(p.y - y) < collisionR);
        if (!collision) return { x: Math.round(x), y: Math.round(y) };
      }
    }

    // Last resort: place along board edge instead of piling at origin
    for (let x = 2; x < BOARD_W - 2; x += step) {
      const collision = existing.some(p => Math.abs(p.x - x) < collisionR && Math.abs(p.y - 2) < collisionR);
      if (!collision) return { x: Math.round(x), y: 2 };
    }
    return { x: Math.round(bounds.xMin + Math.random() * 20), y: Math.round(bounds.yMin + Math.random() * 20) };
  }

  // Build wire connections: device name → position for routing
  const wireConnections = useMemo(() => {
    const devicePosMap = new Map<string, { x: number; y: number }>();
    for (const d of devices) {
      const pos = positions[d.id];
      if (pos) devicePosMap.set(d.device_name, pos);
    }
    // Also build a lookup for ECU/engine_management devices
    const ecuPos = devices.find(d =>
      d.device_category === 'engine_management' || /^M1[35]0/i.test(d.device_name)
    );
    const ecuFallbackPos = ecuPos && positions[ecuPos.id] ? positions[ecuPos.id] : undefined;

    return overlay.wires
      .map((w, wi) => {
        const toPos = devicePosMap.get(w.to);
        // Exact device lookup first, fuzzy fallback, then ECU fallback
        const fromDevName = w.from.split(':')[0];
        let fromPos = devicePosMap.get(fromDevName);
        if (!fromPos) {
          for (const d of devices) {
            if (d.device_name.includes(fromDevName) && positions[d.id]) {
              fromPos = positions[d.id];
              break;
            }
          }
        }
        // 'ECU' doesn't match device name 'M130' — use engine_management fallback
        if (!fromPos && (fromDevName === 'ECU' || fromDevName === 'ecu')) {
          fromPos = ecuFallbackPos;
        }
        if (!fromPos || !toPos) return null;
        return { wire: w, from: fromPos, to: toPos, index: wi };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }, [overlay.wires, devices, positions]);

  // Compute trunk-routed wire paths through harness graph + trunk render segments
  const { routedWirePaths, trunkRenderSegments } = useMemo(() => {
    const empty = {
      routedWirePaths: new Map<number, { x: number; y: number }[]>(),
      trunkRenderSegments: [] as { x1: number; y1: number; x2: number; y2: number; wireCount: number; zone: string }[],
    };
    if (wireConnections.length === 0) return empty;
    const requests = wireConnections.map(c => ({
      wireNumber: c.wire.wireNumber,
      // Convert board inches to 0-1000 canvas space for harnessRouting
      fromX: (c.from.x / BOARD_W) * 1000,
      fromY: (c.from.y / BOARD_H) * 1000,
      toX: (c.to.x / BOARD_W) * 1000,
      toY: (c.to.y / BOARD_H) * 1000,
    }));
    const routed = routeWiresAlongHarness(requests);

    // Convert waypoints back to board inches
    const pathMap = new Map<number, { x: number; y: number }[]>();
    for (const r of routed) {
      pathMap.set(r.wireNumber, r.path.map(p => ({
        x: (p.x / 1000) * BOARD_W,
        y: (p.y / 1000) * BOARD_H,
      })));
    }

    // Aggregate per-segment wire counts (authoritative) and convert to inches
    const segs = computeTrunkSegments(routed).map(s => ({
      x1: (s.x1 / 1000) * BOARD_W,
      y1: (s.y1 / 1000) * BOARD_H,
      x2: (s.x2 / 1000) * BOARD_W,
      y2: (s.y2 / 1000) * BOARD_H,
      wireCount: s.wireCount,
      zone: s.zone,
    }));

    return { routedWirePaths: pathMap, trunkRenderSegments: segs };
  }, [wireConnections]);

  // Compute collision-free device label placements (board inches)
  const labelPlacements = useMemo(() => {
    if (zoom <= 2 || !layers.labels) return new Map<string, import('./deviceLabelPlacer').DeviceLabelPlacement>();
    const useAbbrev = true; // Zuken/industry convention: always compact device codes (TPS, FGR, BDI). Full names overwhelm the drawing.
    const fontSize = useAbbrev
      ? Math.max(8, zoom * 1.5) / zoom  // convert px fontSize to board inches
      : Math.min(14, Math.max(9, zoom * 1.5)) / zoom;

    const inputs: DeviceLabelInput[] = filteredDevices.map(d => {
      const pos = positions[d.id];
      if (!pos) return null;
      const dims = getConnDims(d);
      return {
        id: d.id,
        name: d.device_name,
        cx: pos.x,
        cy: pos.y,
        hw: dims.w / 2,
        hh: dims.h / 2,
        pinCount: d.pin_count || 0,
        zone: d.location_zone || 'dash',
        selected: selected === d.id || selectedDeviceId === d.id,
        hovered: hovering === d.id,
      };
    }).filter((x): x is DeviceLabelInput => x !== null);

    return placeDeviceLabels(inputs, fontSize, zoom, useAbbrev);
  }, [filteredDevices, positions, zoom, layers.labels, selected, selectedDeviceId, hovering]);

  // Board inches to canvas pixels
  const toCanvas = useCallback((bx: number, by: number): [number, number] => {
    return [(bx * zoom) + panX, (by * zoom) + panY];
  }, [zoom, panX, panY]);

  // Canvas pixels to board inches
  const toBoard = useCallback((cx: number, cy: number): [number, number] => {
    return [(cx - panX) / zoom, (cy - panY) / zoom];
  }, [zoom, panX, panY]);

  // Snap to 1" grid
  function snap(v: number): number {
    return Math.round(v / GRID_INCH) * GRID_INCH;
  }

  // Get connector dimensions for a device
  function getConnDims(d: Device): { w: number; h: number } {
    if (d.connector_type && CONNECTOR_DIMS[d.connector_type]) {
      return CONNECTOR_DIMS[d.connector_type];
    }
    // Fallback based on pin count
    const pc = d.pin_count || 2;
    if (pc <= 2) return { w: 0.5, h: 0.3 };
    if (pc <= 4) return { w: 0.8, h: 0.5 };
    if (pc <= 8) return { w: 1.2, h: 0.7 };
    if (pc <= 15) return { w: 1.6, h: 0.9 };
    return { w: 2.0, h: 1.2 };
  }

  // ── RENDER ───────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Background — plotter-print off-white (ASME Y14.2 convention).
    // Real formboards are drawn on light paper; dark mode reads as IDE, not drawing.
    ctx.fillStyle = '#F5F5F0';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // ── PEG GRID ─────────────────────────────────────────────────────
    const gridStep = GRID_INCH * zoom;
    if (layers.grid && gridStep > 2) { // only draw if pegs would be visible
      const [startBx] = toBoard(0, 0);
      const [endBx] = toBoard(rect.width, rect.height);
      const [, startBy] = toBoard(0, 0);
      const [, endBy] = toBoard(0, rect.height);

      const xMin = Math.max(0, Math.floor(startBx));
      const xMax = Math.min(BOARD_W, Math.ceil(endBx));
      const yMin = Math.max(0, Math.floor(startBy));
      const yMax = Math.min(BOARD_H, Math.ceil(endBy));

      for (let xi = xMin; xi <= xMax; xi += GRID_INCH) {
        for (let yi = yMin; yi <= yMax; yi += GRID_INCH) {
          const [px, py] = toCanvas(xi, yi);
          if (px < -1 || px > rect.width + 1 || py < -1 || py > rect.height + 1) continue;

          const isMajor = xi % 12 === 0 && yi % 12 === 0;
          const isMedium = xi % 4 === 0 && yi % 4 === 0;

          if (isMajor) {
            ctx.fillStyle = '#A0A099';
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1.5, zoom * 0.15), 0, Math.PI * 2);
            ctx.fill();
          } else if (isMedium && gridStep > 4) {
            ctx.fillStyle = '#C8C8C0';
            ctx.beginPath();
            ctx.arc(px, py, Math.max(0.8, zoom * 0.08), 0, Math.PI * 2);
            ctx.fill();
          } else if (gridStep > 10) {
            ctx.fillStyle = '#D8D8D0';
            ctx.beginPath();
            ctx.arc(px, py, Math.max(0.5, zoom * 0.05), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Grid coordinate labels (every 12")
      if (gridStep > 3) {
        ctx.fillStyle = '#333';
        ctx.font = `${Math.max(8, zoom * 1.5)}px monospace`;
        ctx.textAlign = 'center';
        for (let xi = 0; xi <= BOARD_W; xi += 12) {
          const [px, py] = toCanvas(xi, 0);
          if (px > 0 && px < rect.width) {
            ctx.fillText(`${xi}"`, px, py - zoom * 0.5);
          }
        }
        ctx.textAlign = 'right';
        for (let yi = 0; yi <= BOARD_H; yi += 12) {
          const [px, py] = toCanvas(0, yi);
          if (py > 0 && py < rect.height) {
            ctx.fillText(`${yi}"`, px - zoom * 0.5, py + zoom * 0.3);
          }
        }
      }
    }

    // ── RULER MARKS (1" intervals along edges) — light plotter-print ─
    if (showRuler) {
      ctx.save();
      ctx.lineWidth = 0.5;

      // Top ruler
      const rulerH = 14;
      const [r0x, r0y] = toCanvas(0, 0);
      const [r1x] = toCanvas(BOARD_W, 0);
      ctx.fillStyle = '#EAEAE4';
      ctx.fillRect(r0x, r0y, r1x - r0x, rulerH);

      for (let xi = 0; xi <= BOARD_W; xi += GRID_INCH) {
        const [px, py] = toCanvas(xi, 0);
        if (px < 0 || px > rect.width) continue;
        const isMajor = xi % 12 === 0;
        const isMedium = xi % 6 === 0;
        const tickH = isMajor ? rulerH : isMedium ? rulerH * 0.6 : rulerH * 0.3;

        if (zoom * GRID_INCH > 3 || isMajor || (isMedium && zoom > 1)) {
          ctx.strokeStyle = isMajor ? '#333' : '#888';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + tickH);
          ctx.stroke();
        }

        if (isMajor && zoom > 1) {
          ctx.fillStyle = '#111';
          ctx.font = `${Math.max(6, Math.min(9, zoom * 1.5))}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(`${xi}"`, px, py + rulerH - 1);
        }
      }

      // Left ruler
      const rulerW = 14;
      const [l0x, l0y] = toCanvas(0, 0);
      const [, l1y] = toCanvas(0, BOARD_H);
      ctx.fillStyle = '#EAEAE4';
      ctx.fillRect(l0x, l0y, rulerW, l1y - l0y);

      for (let yi = 0; yi <= BOARD_H; yi += GRID_INCH) {
        const [px, py] = toCanvas(0, yi);
        if (py < 0 || py > rect.height) continue;
        const isMajor = yi % 12 === 0;
        const isMedium = yi % 6 === 0;
        const tickW = isMajor ? rulerW : isMedium ? rulerW * 0.6 : rulerW * 0.3;

        if (zoom * GRID_INCH > 3 || isMajor || (isMedium && zoom > 1)) {
          ctx.strokeStyle = isMajor ? '#333' : '#888';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + tickW, py);
          ctx.stroke();
        }

        if (isMajor && zoom > 1) {
          ctx.fillStyle = '#111';
          ctx.font = `${Math.max(6, Math.min(9, zoom * 1.5))}px monospace`;
          ctx.textAlign = 'right';
          ctx.fillText(`${yi}"`, px + rulerW - 1, py + 3);
        }
      }

      ctx.restore();
    }

    // ── VEHICLE OUTLINE ──────────────────────────────────────────────
    // Direct board-coordinate drawing — no ctx.transform() or axis swap.
    // All coordinates in board inches, rendered via toCanvas().
    if (layers.vehicle) {
      // Helpers for board-inch drawing
      const drawBoardPoly = (points: [number, number][], fill: string, stroke: string, alpha: number, lineW = 1) => {
        if (points.length < 2) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        const [sx, sy] = toCanvas(points[0][0], points[0][1]);
        ctx.moveTo(sx, sy);
        for (let i = 1; i < points.length; i++) {
          const [px, py] = toCanvas(points[i][0], points[i][1]);
          ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (fill !== 'none') { ctx.fillStyle = fill; ctx.fill(); }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineW;
        ctx.stroke();
        ctx.restore();
      };
      const drawBoardRect = (x: number, y: number, w: number, h: number, fill: string, stroke: string, alpha: number, lineW = 1) => {
        const [cx, cy] = toCanvas(x, y);
        const [cx2, cy2] = toCanvas(x + w, y + h);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (fill !== 'none') { ctx.fillStyle = fill; ctx.fillRect(cx, cy, cx2 - cx, cy2 - cy); }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineW;
        ctx.strokeRect(cx, cy, cx2 - cx, cy2 - cy);
        ctx.restore();
      };
      const drawBoardLabel = (x: number, y: number, text: string, color: string, size: number, alpha = 0.6) => {
        const [lx, ly] = toCanvas(x, y);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lx, ly);
        ctx.restore();
      };

      const ox = VEH_OX;
      const oy = VEH_OY;
      const vl = VEH_L; // 184.8"
      const vw = VEH_W; // 79.6"

      // ── Zone backgrounds ──
      // Subtle tonal differentiation: near-black gradations of the workspace
      // bg (#1a1a28) so the zones read as faint regions, not color wash.
      // Painted at high opacity so they replace the bg rather than tint it.
      if (vehLayers['zones']) {
        // Engine bay — slightly lighter
        drawBoardRect(ox, oy, 48, vw, '#ECE8DF', '#C8C4BC', 1.0);
        drawBoardLabel(ox + 24, oy + vw / 2, 'ENGINE BAY', '#666', 10, 0.55);

        // Firewall — same as bg
        drawBoardRect(ox + 48, oy, 7, vw, '#E4DED0', '#BFB8A8', 1.0);
        drawBoardLabel(ox + 51.5, oy + vw / 2, 'FIREWALL', '#666', 8, 0.55);

        // Dash — slightly darker
        drawBoardRect(ox + 55, oy + 5, 25, vw - 10, '#EAE6DC', '#C8C2B6', 1.0);
        drawBoardLabel(ox + 67.5, oy + vw / 2, 'DASH', '#666', 10, 0.55);

        // Doors — neutral
        drawBoardRect(ox + 55, oy, 50, 12, '#ECE6D8', '#CAC3B0', 1.0);
        drawBoardLabel(ox + 80, oy + 6, 'DOOR L', '#666', 8, 0.55);
        drawBoardRect(ox + 55, oy + vw - 12, 50, 12, '#ECE6D8', '#CAC3B0', 1.0);
        drawBoardLabel(ox + 80, oy + vw - 6, 'DOOR R', '#666', 8, 0.55);

        // Rear — darkest
        drawBoardRect(ox + 105, oy, vl - 105, vw, '#E6E2D4', '#C2BCAE', 1.0);
        drawBoardLabel(ox + 145, oy + vw / 2, 'REAR', '#666', 10, 0.55);

        // Underbody band — subtle, very slightly warmer
        drawBoardRect(ox, oy + vw / 2 - 6, vl, 12, '#E8E4D6', '#BFB8A8', 0.6);
        drawBoardLabel(ox + vl / 2, oy + vw / 2, 'UNDERBODY', '#666', 8, 0.4);
      }

      // ── Vehicle silhouette — REAL Blender 3D geometry projected to 2D ──
      // Source: /data/k5-geometry.json (exported from K5_anatomy.blend, 81 objects).
      // Projects world-space bounding boxes (meters) onto the board (inches)
      // via geomToBoard.proj. Body bbox defines the envelope; all other parts
      // are placed in the same coordinate system. Falls back to nothing if
      // the geometry hasn't loaded yet (blank board = better than a fake outline).
      if (geomToBoard) {
        const { proj } = geomToBoard;

        // Helper: draw an axis-aligned bbox (top-down projection of a 3D part)
        const drawBboxProj = (
          obj: K5GeomObj,
          fill: string | null,
          stroke: string | null,
          alpha: number,
          lineW = 1,
        ) => {
          // Corners of the top-down projection are the XY extents in Blender
          // (X is vehicle width, Y is vehicle length). Z is height, ignored.
          const [bxA, byA] = proj(obj.min[0], obj.min[1]);
          const [bxB, byB] = proj(obj.max[0], obj.max[1]);
          const [xA, yA] = toCanvas(Math.min(bxA, bxB), Math.min(byA, byB));
          const [xB, yB] = toCanvas(Math.max(bxA, bxB), Math.max(byA, byB));
          ctx.globalAlpha = alpha;
          if (fill) {
            ctx.fillStyle = fill;
            ctx.fillRect(xA, yA, xB - xA, yB - yA);
          }
          if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineW;
            ctx.globalAlpha = Math.min(1, alpha * 2);
            ctx.strokeRect(xA, yA, xB - xA, yB - yA);
          }
          ctx.globalAlpha = 1;
        };

        // Helper: draw a circle in Blender XY plane (for wheels)
        const drawWheelTop = (obj: K5GeomObj, stroke: string, alpha: number) => {
          // Wheel is oriented vertically in 3D; top-down it appears as a
          // rectangle (tire contact footprint). Render as the projected bbox.
          drawBboxProj(obj, '#111', stroke, alpha, 1.5);
        };

        // 1. BODY SHELL — outer envelope
        if (vehLayers['body'] !== false) {
          const body = k5Geom!['Exterior_Body_Blazer'];
          if (body) drawBboxProj(body, '#222233', '#888', 0.35, 1.5);
          // Rear cap / tailgate area if present
          const rear = k5Geom!['Exterior_Body_Blazer_Rear'];
          if (rear) drawBboxProj(rear, null, '#777', 0.4, 1);
        }

        // 2. FRAME — draw frame bbox outline + derived rail strips
        // Frame rails on a squarebody K5 sit at X ≈ ±0.45m (~34" apart),
        // Z ≈ 0.19-0.25m. From above the rails are two parallel bands
        // running the length of the frame.
        if (vehLayers['frame'] !== false) {
          const frame = k5Geom!['Under_Frame_Blazer'];
          if (frame) {
            // Outer chassis envelope, subtle
            drawBboxProj(frame, null, '#4a4a55', 0.35, 1);

            // Frame rails: two strips at X = ±0.45m, 0.05m wide, full frame length
            const railHalfWidth = 0.45;
            const railThickness = 0.055;
            const yFront = frame.min[1];
            const yRear = frame.max[1];
            for (const railX of [railHalfWidth, -railHalfWidth]) {
              const [bxA, byA] = proj(railX - railThickness / 2, yFront);
              const [bxB, byB] = proj(railX + railThickness / 2, yRear);
              const [xA, yA] = toCanvas(Math.min(bxA, bxB), Math.min(byA, byB));
              const [xB, yB] = toCanvas(Math.max(bxA, bxB), Math.max(byA, byB));
              ctx.fillStyle = '#3a3a48';
              ctx.globalAlpha = 0.85;
              ctx.fillRect(xA, yA, xB - xA, yB - yA);
              ctx.strokeStyle = '#666';
              ctx.globalAlpha = 1;
              ctx.lineWidth = 0.8;
              ctx.strokeRect(xA, yA, xB - xA, yB - yA);
            }
            // Crossmembers: rough positions along frame (front, mid-front,
            // mid, mid-rear, rear). Standard K5 crossmember spacing.
            const yL = frame.min[1];
            const yR = frame.max[1];
            const crossYs = [
              yL + (yR - yL) * 0.05,
              yL + (yR - yL) * 0.25,
              yL + (yR - yL) * 0.50,
              yL + (yR - yL) * 0.72,
              yL + (yR - yL) * 0.92,
            ];
            for (const cy of crossYs) {
              const thickness = 0.04;
              const [bxA, byA] = proj(railHalfWidth, cy - thickness / 2);
              const [bxB, byB] = proj(-railHalfWidth, cy + thickness / 2);
              const [xA, yA] = toCanvas(Math.min(bxA, bxB), Math.min(byA, byB));
              const [xB, yB] = toCanvas(Math.max(bxA, bxB), Math.max(byA, byB));
              ctx.fillStyle = '#3a3a48';
              ctx.globalAlpha = 0.65;
              ctx.fillRect(xA, yA, xB - xA, yB - yA);
            }
            ctx.globalAlpha = 1;

            // Label
            if (zoom > 4 && layers.labels) {
              const [lx, ly] = toCanvas((
                proj(0, (frame.min[1] + frame.max[1]) / 2)[0]
              ), proj(0, (frame.min[1] + frame.max[1]) / 2)[1]);
              ctx.fillStyle = '#888';
              ctx.font = `${Math.max(8, zoom * 0.8)}px Arial`;
              ctx.textAlign = 'center';
              ctx.globalAlpha = 0.5;
              ctx.fillText('FRAME', lx, ly + 4);
              ctx.globalAlpha = 1;
            }
          }
        }

        // 3. ENGINE / DRIVETRAIN — engine bay footprint
        if (vehLayers['engine'] !== false) {
          const eng = k5Geom!['Under_Engine_Simple'];
          if (eng) drawBboxProj(eng, '#2a2530', '#6a5050', 0.5, 1);
        }

        // 4. WHEELS — 4 tire contact footprints
        for (const wn of ['Wheel_Front_Left', 'Wheel_Front_Right', 'Wheel_Back_Left', 'Wheel_Back_Right']) {
          const w = k5Geom![wn];
          if (w) drawWheelTop(w, '#aaa', 0.7);
        }

        // 5. DASH — interior reference
        const dash = k5Geom!['Dash_Main'];
        if (dash) drawBboxProj(dash, '#20222a', '#556', 0.4, 1);

        // 6. FRONT BUMPER (if present)
        const bumper = k5Geom!['Exterior_Bumper_Front'];
        if (bumper) drawBboxProj(bumper, '#303038', '#888', 0.5, 1);

        // 7. TAIL LIGHTS (visual cue for rear anchor points)
        const tail = k5Geom!['Tail_Lights_Main'];
        if (tail) drawBboxProj(tail, '#4a1a1a', '#a33', 0.7, 1);
      }
    }

    // ── COMPONENT VECTORS (physical parts at true dimensions) ────────
    if (layers.components) {
      for (const comp of ENGINE_VECTORS) {
        for (const shape of comp.shapes) {
          switch (shape.type) {
            case 'rect': {
              const [rx, ry] = toCanvas(VEH_OX + shape.x, VEH_OY + shape.y);
              const rw = shape.w * zoom;
              const rh = shape.h * zoom;
              ctx.fillStyle = comp.fill;
              ctx.globalAlpha = comp.opacity;
              if (shape.r && shape.r > 0) {
                const cr = shape.r * zoom;
                ctx.beginPath();
                ctx.roundRect(rx, ry, rw, rh, cr);
                ctx.fill();
                ctx.globalAlpha = comp.opacity * 2;
                ctx.strokeStyle = comp.stroke;
                ctx.lineWidth = 0.8;
                ctx.stroke();
              } else {
                ctx.fillRect(rx, ry, rw, rh);
                ctx.globalAlpha = comp.opacity * 2;
                ctx.strokeStyle = comp.stroke;
                ctx.lineWidth = 0.8;
                ctx.strokeRect(rx, ry, rw, rh);
              }
              ctx.globalAlpha = 1;
              break;
            }
            case 'circle': {
              const [ccx, ccy] = toCanvas(VEH_OX + shape.cx, VEH_OY + shape.cy);
              const cr = shape.r * zoom;
              ctx.fillStyle = comp.fill;
              ctx.globalAlpha = comp.opacity;
              ctx.beginPath();
              ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = comp.opacity * 2;
              ctx.strokeStyle = comp.stroke;
              ctx.lineWidth = 0.8;
              ctx.stroke();
              ctx.globalAlpha = 1;
              break;
            }
            case 'ellipse': {
              const [eex, eey] = toCanvas(VEH_OX + shape.cx, VEH_OY + shape.cy);
              const erx = shape.rx * zoom;
              const ery = shape.ry * zoom;
              ctx.fillStyle = comp.fill;
              ctx.globalAlpha = comp.opacity;
              ctx.beginPath();
              ctx.ellipse(eex, eey, erx, ery, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = comp.opacity * 2;
              ctx.strokeStyle = comp.stroke;
              ctx.lineWidth = 0.8;
              ctx.stroke();
              ctx.globalAlpha = 1;
              break;
            }
            case 'poly': {
              const pts = shape.points.map(([px, py]) => toCanvas(VEH_OX + px, VEH_OY + py));
              ctx.fillStyle = comp.fill;
              ctx.globalAlpha = comp.opacity;
              ctx.beginPath();
              pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
              ctx.closePath();
              ctx.fill();
              ctx.globalAlpha = comp.opacity * 2;
              ctx.strokeStyle = comp.stroke;
              ctx.lineWidth = 0.8;
              ctx.stroke();
              ctx.globalAlpha = 1;
              break;
            }
            case 'label': {
              if (layers.labels && zoom > 4) {
                const [lx, ly] = toCanvas(VEH_OX + shape.x, VEH_OY + shape.y);
                const fs = Math.max(6, shape.size * zoom * 0.8);
                ctx.fillStyle = comp.stroke;
                ctx.globalAlpha = 0.5;
                ctx.font = `bold ${fs}px Arial`;
                ctx.textAlign = 'center';
                ctx.fillText(shape.text, lx, ly);
                ctx.globalAlpha = 1;
              }
              break;
            }
          }
        }
      }
    }

    // ── CONNECTORS (true dimensions) ─────────────────────────────────
    if (!layers.connectors) { /* skip connector rendering */ }
    for (const d of (layers.connectors ? filteredDevices : [])) {
      const pos = positions[d.id];
      if (!pos) continue;

      const dims = getConnDims(d);
      const [cx, cy] = toCanvas(pos.x - dims.w / 2, pos.y - dims.h / 2);
      const cw = dims.w * zoom;
      const ch = dims.h * zoom;

      // Skip if off-screen
      if (cx + cw < 0 || cx > rect.width || cy + ch < 0 || cy > rect.height) continue;

      const zone = d.location_zone || 'dash';
      const color = ZONE_COLORS[zone] || '#666';
      const isHovered = hovering === d.id;
      const isSelected = selected === d.id || selectedDeviceId === d.id || selectedDevices.has(d.id);
      const isDragged = dragging === d.id;

      // Connector body — light fill (plotter-print paper), zone-colored border.
      // ASME Y14.2: connector bodies are thick-line outlined rectangles on light paper.
      ctx.fillStyle = isDragged ? '#E0E4F0' : isSelected ? '#DCE4F4' : '#FFFFFF';
      ctx.strokeStyle = isHovered || isSelected ? color : color + 'cc';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeRect(cx, cy, cw, ch);

      // Pin indicators (tiny marks inside connector) — only at zoom >= 6
      const pc = d.pin_count || 0;
      if (pc > 0 && cw > 8 && ch > 6 && zoom >= 6) {
        ctx.fillStyle = color + '44';
        const cols = Math.ceil(Math.sqrt(pc));
        const rows = Math.ceil(pc / cols);
        const pinW = cw / (cols + 1);
        const pinH = ch / (rows + 1);
        let pinNum = 0;
        for (let r = 0; r < rows && pinNum < pc; r++) {
          for (let c = 0; c < cols && pinNum < pc; c++) {
            const pinX = cx + pinW * (c + 0.5);
            const pinY = cy + pinH * (r + 0.5);
            const pinR = Math.min(pinW, pinH) * 0.2;
            ctx.beginPath();
            ctx.arc(pinX + pinW * 0.5, pinY + pinH * 0.5, Math.max(0.8, pinR), 0, Math.PI * 2);
            ctx.fill();
            pinNum++;
          }
        }
      }

      // Device label — placed by anti-overlap system (deviceLabelPlacer.ts)
      // Lookup pre-computed placement; draw pill + leader line
      if (zoom > 2 && layers.labels) {
        const placement = labelPlacements.get(d.id);
        if (placement) {
          const useAbbrev = true; // Zuken/industry convention: always compact device codes (TPS, FGR, BDI). Full names overwhelm the drawing.
          const fontSize = useAbbrev
            ? Math.max(8, zoom * 1.5)
            : Math.min(14, Math.max(9, zoom * 1.5));

          // Convert board-inch placement to canvas pixels
          const [pillCx, pillCy] = toCanvas(placement.x, placement.y);
          const pillPxW = placement.pillW * zoom;
          const pillPxH = placement.pillH * zoom;
          const stripePx = 2; // zone color stripe width in pixels

          // Leader line — if label pushed beyond 1x distance
          if (placement.offsetMult > 1) {
            const [ancX, ancY] = toCanvas(placement.anchorX, placement.anchorY);
            // Line from connector center to nearest pill edge
            const pillMidX = pillCx + pillPxW / 2;
            const pillMidY = pillCy + pillPxH / 2;
            ctx.strokeStyle = color + '66';
            ctx.lineWidth = 0.8;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(ancX, ancY);
            ctx.lineTo(pillMidX, pillMidY);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Light pill background (plotter-print paper) with subtle border
          ctx.fillStyle = 'rgba(255,255,252,0.94)';
          ctx.fillRect(pillCx, pillCy, pillPxW, pillPxH);
          ctx.strokeStyle = 'rgba(80,80,80,0.4)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(pillCx, pillCy, pillPxW, pillPxH);

          // Zone color stripe on left edge
          ctx.fillStyle = color;
          ctx.fillRect(pillCx, pillCy, stripePx, pillPxH);

          // Dark label text (ASME Y14.2: black on light)
          ctx.font = `bold ${fontSize}px Arial`;
          ctx.fillStyle = '#111';
          ctx.textAlign = 'left';
          ctx.fillText(placement.text, pillCx + stripePx + 2, pillCy + pillPxH - 2);
        }
      }

      // DRC severity dot at connector top-right (zoom > 2)
      if (zoom > 2 && drcMap) {
        const drc = drcMap.get(d.id);
        if (drc) {
          const dotR = Math.max(2, Math.min(4, zoom * 0.6));
          const dotColor = drc.severity === 'fail' ? '#ef4444' : drc.severity === 'warn' ? '#eab308' : '#22c55e';
          ctx.beginPath();
          ctx.arc(cx + cw - dotR + 1, cy + dotR - 1, dotR, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // ── WIRE ROUTING OVERLAY ──────────────────────────────────────────
    // Three-pass rendering — manufacturing-drawing style:
    //   Pass 1: TRUNK BUNDLES    — thick dark bands, width ∝ √wireCount
    //   Pass 2: PIGTAILS         — colored curves at device entry/exit only
    //   Pass 3: PIN TERMINAL DOTS — colored dots at connector edge
    // Middle of trunk = uniform dark; only the last ~2-6" break out by color.
    if (layers.trunks && wireConnections.length > 0) {
      // Build device name → zone lookup for color fallback
      const deviceZoneMap = new Map<string, string>();
      for (const d of devices) {
        if (d.location_zone) deviceZoneMap.set(d.device_name, d.location_zone);
      }

      // Helper: medium-gray zone tint for trunk inner (tape/loom look on light paper)
      const trunkInnerTint = (zone: string): string => {
        // Map zone to a muted gray with faint hue so bundles are differentiable
        // but sit on the off-white paper like printed tape.
        switch (zone) {
          case 'engine_bay': return '#8a7a6a';
          case 'firewall':   return '#8a8070';
          case 'dash':       return '#707a8a';
          case 'doors':      return '#80707a';
          case 'rear':       return '#6a7a70';
          case 'underbody':  return '#72707a';
          default:           return '#808080';
        }
      };

      // ── Pass 1: TRUNK BUNDLES ────────────────────────────────────
      ctx.save();
      // Orthogonal trunk rendering: if a segment has both horizontal and vertical delta,
      // render it as an L-shape with a corner waypoint. Real harness trunks run along
      // the board grain (firewall horizontal, dash horizontal, frame-rail horizontal,
      // grommet drops vertical). Diagonals happen inside the graph data because the
      // trunk nodes have fractionally different coords — the L-shape corrects this
      // to the eye without re-coordinating the graph.
      //
      // Heuristic: longer axis first (traverse the main spine before dropping off).
      for (const seg of trunkRenderSegments) {
        const [x1, y1] = toCanvas(seg.x1, seg.y1);
        const [x2, y2] = toCanvas(seg.x2, seg.y2);
        // Cull offscreen
        if ((x1 < -50 && x2 < -50) || (x1 > rect.width + 50 && x2 > rect.width + 50) ||
            (y1 < -50 && y2 < -50) || (y1 > rect.height + 50 && y2 > rect.height + 50)) continue;

        const dxpx = Math.abs(x2 - x1);
        const dypx = Math.abs(y2 - y1);
        const diagonal = dxpx > 4 && dypx > 4; // both legs significant → insert corner
        // Longer axis first — if horizontal delta is greater, go horizontal then vertical.
        const cornerX = dxpx >= dypx ? x2 : x1;
        const cornerY = dxpx >= dypx ? y1 : y2;

        const thickness = Math.max(3, Math.min(16, Math.sqrt(seg.wireCount) * zoom * 0.20));
        // Outer tape/loom (dark sheath on light paper)
        ctx.strokeStyle = 'rgba(40,40,44,0.95)';
        ctx.lineWidth = thickness + 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        if (diagonal) ctx.lineTo(cornerX, cornerY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Inner — very dark zone tint
        ctx.strokeStyle = trunkInnerTint(seg.zone);
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        if (diagonal) ctx.lineTo(cornerX, cornerY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // ── Pass 1b: Wire count labels at segment midpoints ─────────
      // Small inline tags (no pill, no stroke) — just count the wires so the
      // plotter reader knows bundle weight. Full schedule lives in the table.
      if (zoom > 3 && layers.labels) {
        const fs = Math.max(7, Math.min(9, zoom * 0.55));
        ctx.font = `${fs}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const seg of trunkRenderSegments) {
          if (seg.wireCount < 6) continue; // only tag heavy bundles
          const mx = (seg.x1 + seg.x2) / 2;
          const my = (seg.y1 + seg.y2) / 2;
          const [cx, cy] = toCanvas(mx, my);
          if (cx < 10 || cx > rect.width - 10 || cy < 10 || cy > rect.height - 10) continue;
          const text = `${seg.wireCount}`;
          const tw = ctx.measureText(text).width;
          // Thin beige wash behind text so it reads over the trunk fill
          ctx.fillStyle = 'rgba(245,245,240,0.85)';
          ctx.fillRect(cx - tw / 2 - 2, cy - fs / 2 - 1, tw + 4, fs + 2);
          ctx.fillStyle = '#444';
          ctx.fillText(text, cx, cy);
        }
        ctx.textBaseline = 'alphabetic';
      }

      // ── Pass 2: PIGTAILS (per-wire colored breakouts) ─────────────
      // Group wires by first-trunk-node and last-trunk-node to compute fan
      // offsets — wires fan outward near the device, converge at the trunk.
      const sourceGroup = new Map<string, number[]>();
      const destGroup = new Map<string, number[]>();
      for (let wi = 0; wi < wireConnections.length; wi++) {
        const conn = wireConnections[wi];
        const path = routedWirePaths.get(conn.wire.wireNumber);
        if (!path || path.length < 3) continue;
        const ft = path[1];
        const lt = path[path.length - 2];
        const sKey = `${ft.x.toFixed(1)},${ft.y.toFixed(1)}`;
        const dKey = `${lt.x.toFixed(1)},${lt.y.toFixed(1)}`;
        let sArr = sourceGroup.get(sKey);
        if (!sArr) { sArr = []; sourceGroup.set(sKey, sArr); }
        sArr.push(wi);
        let dArr = destGroup.get(dKey);
        if (!dArr) { dArr = []; destGroup.set(dKey, dArr); }
        dArr.push(wi);
      }

      // Draw a single pigtail from trunk node → device. Uses obstacle-aware
      // routing: if the direct line passes through solid mass (engine, dash,
      // wheels — defined in obstacleRouting.ts), insert detour waypoints
      // around the obstacle's nearest corner. Final hop applies a fan offset
      // so multiple wires terminating at the same device spread visually.
      const drawPigtail = (
        trunkPt: { x: number; y: number },
        devicePt: { x: number; y: number },
        fan: number,
      ) => {
        // Route around obstacles in board-inch space
        const a: ObstaclePt = { x: trunkPt.x, y: trunkPt.y };
        const b: ObstaclePt = { x: devicePt.x, y: devicePt.y };
        let path = obstacles.length > 0
          ? routeAroundObstacles(a, b, obstacles, 1.5, 4)
          : [a, b];

        // Orthogonalize pigtails — real wiring follows the board grain (right-angle turns),
        // not diagonals. When the router produced a simple two-point straight line between
        // trunk and device, insert an L-shaped corner so the pigtail drops vertically from
        // the device and runs horizontally into the trunk (or vice versa if the trunk is
        // vertical). This applies the Skylar principle: paths should look like channels.
        if (path.length === 2) {
          const [start, end] = path;
          const dx = Math.abs(end.x - start.x);
          const dy = Math.abs(end.y - start.y);
          if (dx > 1 && dy > 1) {
            // Heuristic: insert corner at (start.x, end.y) — treat the trunk end as the
            // "horizontal spine" and the device end as the "vertical drop." This biases
            // toward dash/front-crossbar/rear trunks which are all predominantly horizontal.
            path = [start, { x: start.x, y: end.y }, end];
          }
        }

        // Apply fan offset to the last segment (near device) — perpendicular
        // to the final approach direction so wires spread at termination.
        if (path.length >= 2 && Math.abs(fan) > 0.001) {
          const last = path[path.length - 1];
          const prev = path[path.length - 2];
          const dx = last.x - prev.x;
          const dy = last.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          const perpX = -dy / len;
          const perpY = dx / len;
          // Offset the second-to-last point so the curve bends near device
          path[path.length - 2] = {
            x: prev.x + perpX * fan,
            y: prev.y + perpY * fan,
          };
        }

        ctx.beginPath();
        const [sx, sy] = toCanvas(path[0].x, path[0].y);
        ctx.moveTo(sx, sy);
        for (let i = 1; i < path.length; i++) {
          const [px, py] = toCanvas(path[i].x, path[i].y);
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      };

      ctx.save();
      const pigtailAlpha = zoom < 2 ? 0.55 : zoom < 4 ? 0.75 : 0.92;

      for (let wi = 0; wi < wireConnections.length; wi++) {
        const conn = wireConnections[wi];
        const destZone = deviceZoneMap.get(conn.wire.to) || '';
        const baseColor = wireColorHex(conn.wire.color) || ZONE_COLORS[destZone] || '#999';
        const isHovered = hoveredWireIdx === wi;
        const isSelectedWire = selectedWireId != null && String(conn.wire.wireNumber) === selectedWireId;
        const path = routedWirePaths.get(conn.wire.wireNumber);

        // Yellow = explicit select (intentional click). Hover = keep the wire's
        // actual color but lift weight + alpha, so mousing across the board
        // doesn't flash the whole harness yellow.
        ctx.strokeStyle = isSelectedWire ? '#FFD700' : baseColor;
        ctx.lineWidth = isSelectedWire
          ? Math.max(3, zoom * 0.3)
          : isHovered ? Math.max(2.2, zoom * 0.22)
          : Math.max(1.2, zoom * 0.15);
        ctx.globalAlpha = isSelectedWire ? 1.0 : isHovered ? 1.0 : pigtailAlpha;
        ctx.lineCap = 'round';

        if (!path || path.length < 3) {
          // Fallback: unrouted / too-short — thin dashed warning line
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = isSelectedWire ? '#FFD700' : '#666';
          ctx.lineWidth = 1;
          ctx.globalAlpha = isSelectedWire ? 1.0 : 0.5;
          const [fx, fy] = toCanvas(conn.from.x, conn.from.y);
          const [tx, ty] = toCanvas(conn.to.x, conn.to.y);
          if (!((fx < -50 && tx < -50) || (fx > rect.width + 50 && tx > rect.width + 50) ||
                (fy < -50 && ty < -50) || (fy > rect.height + 50 && ty > rect.height + 50))) {
            ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
          }
          ctx.restore();
          continue;
        }

        const source = path[0];
        const firstTrunk = path[1];
        const lastTrunk = path[path.length - 2];
        const dest = path[path.length - 1];

        const sKey = `${firstTrunk.x.toFixed(1)},${firstTrunk.y.toFixed(1)}`;
        const dKey = `${lastTrunk.x.toFixed(1)},${lastTrunk.y.toFixed(1)}`;
        const sGrp = sourceGroup.get(sKey);
        const dGrp = destGroup.get(dKey);
        const sN = sGrp?.length ?? 1;
        const dN = dGrp?.length ?? 1;
        const sIdx = sGrp?.indexOf(wi) ?? 0;
        const dIdx = dGrp?.indexOf(wi) ?? 0;

        // Fan offset (perpendicular, in board inches) — spreads wires near device
        const fanSpacing = Math.min(0.35, 2.5 / Math.max(sN, dN));
        const sFan = sN > 1 ? (sIdx - (sN - 1) / 2) * fanSpacing : 0;
        const dFan = dN > 1 ? (dIdx - (dN - 1) / 2) * fanSpacing : 0;

        drawPigtail(firstTrunk, source, sFan);
        drawPigtail(lastTrunk, dest, dFan);

        if (isSelectedWire) {
          ctx.save();
          ctx.shadowColor = '#FFD700';
          ctx.shadowBlur = 8;
          drawPigtail(firstTrunk, source, sFan);
          drawPigtail(lastTrunk, dest, dFan);
          ctx.restore();
        }
      }
      ctx.restore();

      // ── Pass 3: PIN TERMINAL DOTS ─────────────────────────────────
      // For each device, collect incoming wires and paint colored dots
      // along the connector edge facing the trunk. Acts as the visible
      // manifestation of which pins a wire terminates at.
      if (zoom > 3) {
        // Collect pins by device name (from-side + to-side)
        type PinEntry = { trunkX: number; trunkY: number; colorHex: string };
        const pinsByDevice = new Map<string, PinEntry[]>();
        for (const conn of wireConnections) {
          const path = routedWirePaths.get(conn.wire.wireNumber);
          if (!path || path.length < 3) continue;
          const fromDev = conn.wire.from.split(':')[0];
          const toDev = conn.wire.to;
          const ft = path[1];
          const lt = path[path.length - 2];
          const destZone = deviceZoneMap.get(conn.wire.to) || '';
          const hex = wireColorHex(conn.wire.color) || ZONE_COLORS[destZone] || '#999';
          let fromArr = pinsByDevice.get(fromDev);
          if (!fromArr) { fromArr = []; pinsByDevice.set(fromDev, fromArr); }
          fromArr.push({ trunkX: ft.x, trunkY: ft.y, colorHex: hex });
          let toArr = pinsByDevice.get(toDev);
          if (!toArr) { toArr = []; pinsByDevice.set(toDev, toArr); }
          toArr.push({ trunkX: lt.x, trunkY: lt.y, colorHex: hex });
        }

        const dotR = Math.max(1.5, Math.min(3, zoom * 0.12));
        ctx.save();
        for (const d of filteredDevices) {
          const pins = pinsByDevice.get(d.device_name);
          if (!pins || pins.length === 0) continue;
          const pos = positions[d.id];
          if (!pos) continue;
          const dims = getConnDims(d);

          // Entry edge = dominant direction of incoming trunks
          let avgDx = 0, avgDy = 0;
          for (const p of pins) { avgDx += p.trunkX - pos.x; avgDy += p.trunkY - pos.y; }
          avgDx /= pins.length; avgDy /= pins.length;
          const edge: 'top' | 'bottom' | 'left' | 'right' =
            Math.abs(avgDx) > Math.abs(avgDy)
              ? (avgDx > 0 ? 'right' : 'left')
              : (avgDy > 0 ? 'bottom' : 'top');

          const N = pins.length;
          for (let i = 0; i < N; i++) {
            const t = N === 1 ? 0.5 : (i + 0.5) / N;
            let px: number, py: number;
            if (edge === 'top')    { px = pos.x - dims.w / 2 + dims.w * t; py = pos.y - dims.h / 2; }
            else if (edge === 'bottom') { px = pos.x - dims.w / 2 + dims.w * t; py = pos.y + dims.h / 2; }
            else if (edge === 'left')   { px = pos.x - dims.w / 2; py = pos.y - dims.h / 2 + dims.h * t; }
            else                        { px = pos.x + dims.w / 2; py = pos.y - dims.h / 2 + dims.h * t; }
            const [cx, cy] = toCanvas(px, py);
            if (cx < -5 || cx > rect.width + 5 || cy < -5 || cy > rect.height + 5) continue;
            ctx.fillStyle = pins[i].colorHex;
            ctx.beginPath();
            ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // ── SELECTED DEVICE INFO ─────────────────────────────────────────
    if (selected) {
      const d = devices.find(dd => dd.id === selected);
      const pos = positions[selected];
      if (d && pos) {
        const dims = getConnDims(d);
        const infoLines = [
          d.device_name,
          `${d.connector_type || 'unknown'} — ${d.pin_count || '?'}p`,
          `${dims.w}" × ${dims.h}" (${(dims.w * 25.4).toFixed(0)}mm × ${(dims.h * 25.4).toFixed(0)}mm)`,
          `Grid: (${pos.x}", ${pos.y}")`,
          d.power_draw_amps ? `${d.power_draw_amps}A` : '',
          d.location_zone || '',
        ].filter(Boolean);

        const padding = 8;
        const lineH = 14;
        const boxW = 240;
        const boxH = infoLines.length * lineH + padding * 2;
        const boxX = rect.width - boxW - 12;
        const boxY = 12;

        ctx.fillStyle = '#2C2C2Cee';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(infoLines[0], boxX + padding, boxY + padding + 11);
        ctx.font = '10px Courier New';
        ctx.fillStyle = '#CCC';
        for (let i = 1; i < infoLines.length; i++) {
          ctx.fillText(infoLines[i], boxX + padding, boxY + padding + 11 + i * lineH);
        }
      }
    }

    // ── LASSO OVERLAY ────────────────────────────────────────────────
    // Freehand: dotted stroke following cursor path
    if (toolMode === 'lasso-freehand' && lassoPath && lassoPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const [sx, sy] = toCanvas(lassoPath[0].x, lassoPath[0].y);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < lassoPath.length; i++) {
        const [px, py] = toCanvas(lassoPath[i].x, lassoPath[i].y);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Polygon: solid segments between vertices, dashed preview to cursor
    if (toolMode === 'lasso-polygon' && polygonVertices.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#a78bfa';
      ctx.fillStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const [sx, sy] = toCanvas(polygonVertices[0].x, polygonVertices[0].y);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < polygonVertices.length; i++) {
        const [px, py] = toCanvas(polygonVertices[i].x, polygonVertices[i].y);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Vertex dots
      for (const v of polygonVertices) {
        const [px, py] = toCanvas(v.x, v.y);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Preview segment from last vertex to cursor (dashed)
      if (lassoCursor) {
        const last = polygonVertices[polygonVertices.length - 1];
        const [lx, ly] = toCanvas(last.x, last.y);
        const [cxp, cyp] = toCanvas(lassoCursor.x, lassoCursor.y);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(cxp, cyp);
        ctx.stroke();
        // If ≥3 vertices, also preview the closing line back to first vertex
        if (polygonVertices.length >= 3) {
          const first = polygonVertices[0];
          const [fx, fy] = toCanvas(first.x, first.y);
          ctx.beginPath();
          ctx.moveTo(cxp, cyp);
          ctx.lineTo(fx, fy);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Multi-selection badge (upper-left of viewport)
    if (selectedDevices.size > 1) {
      const badgeText = `${selectedDevices.size} SELECTED`;
      ctx.font = 'bold 10px Arial';
      const tw = ctx.measureText(badgeText).width;
      const bw = tw + 16;
      const bh = 20;
      const bx = 12;
      const by = rect.height - bh - 12;
      ctx.fillStyle = '#a78bfadd';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#FFF';
      ctx.textAlign = 'left';
      ctx.fillText(badgeText, bx + 8, by + 14);
    }

    // Title banner + interaction-hint text removed — the tab name + loom filter
    // + zoom corner overlay already communicate everything this band used to.
    // Shop prints get a proper title block (drawing number, rev, scale, date)
    // only when the user hits PRINT — not baked into the on-screen canvas.

  }, [devices, filteredDevices, positions, zoom, panX, panY, hovering, selected, selectedDevices, dragging, layers, showRuler, activeLoom, toCanvas, toBoard, wireConnections, routedWirePaths, trunkRenderSegments, obstacles, k5Geom, geomToBoard, hoveredWireIdx, selectedDeviceId, selectedWireId, drcMap, vehLayers, silhouette, labelPlacements, toolMode, lassoPath, polygonVertices, lassoCursor]);

  // Render on any state change
  useEffect(() => {
    render();
  }, [render]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [render]);

  // ── MOUSE HANDLERS ─────────────────────────────────────────────────
  const getMouseBoard = useCallback((e: React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    return toBoard(cx, cy);
  }, [toBoard]);

  const hitTest = useCallback((bx: number, by: number): string | null => {
    // Minimum hit area: 2" in board coords (ensures clickable at any zoom)
    const minHit = Math.max(2, 6 / zoom);
    for (const d of devices) {
      const pos = positions[d.id];
      if (!pos) continue;
      const dims = getConnDims(d);
      const hw = Math.max(dims.w, minHit) / 2;
      const hh = Math.max(dims.h, minHit) / 2;
      if (bx >= pos.x - hw && bx <= pos.x + hw && by >= pos.y - hh && by <= pos.y + hh) {
        return d.id;
      }
    }
    return null;
  }, [devices, positions, zoom]);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, px: 0, py: 0 });
  // For batch drag: initial positions of the whole selection at drag start
  const batchDragRef = useRef<{ id: string; originX: number; originY: number }[] | null>(null);

  // Point-in-polygon test (ray casting)
  const pointInPolygon = useCallback((x: number, y: number, poly: { x: number; y: number }[]): boolean => {
    if (poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }, []);

  // Collect devices whose positions fall inside a polygon (board coords)
  const devicesInsidePolygon = useCallback((poly: { x: number; y: number }[]): string[] => {
    const found: string[] = [];
    for (const d of filteredDevices) {
      const pos = positions[d.id];
      if (!pos) continue;
      if (pointInPolygon(pos.x, pos.y, poly)) found.push(d.id);
    }
    return found;
  }, [filteredDevices, positions, pointInPolygon]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const [bx, by] = getMouseBoard(e);

    // ── Lasso modes ──
    if (toolMode === 'lasso-freehand') {
      setLassoPath([{ x: bx, y: by }]);
      setLassoCursor({ x: bx, y: by });
      e.preventDefault();
      return;
    }
    if (toolMode === 'lasso-polygon') {
      // Shift+click removes last vertex
      if (e.shiftKey) {
        setPolygonVertices(prev => prev.slice(0, -1));
        e.preventDefault();
        return;
      }
      // Check if click closes polygon (within ~5 board inches of first vertex and ≥3 vertices)
      if (polygonVertices.length >= 3) {
        const first = polygonVertices[0];
        const d2 = (bx - first.x) ** 2 + (by - first.y) ** 2;
        const threshold = Math.max(5, 12 / zoom);
        if (d2 < threshold * threshold) {
          const ids = devicesInsidePolygon(polygonVertices);
          setSelectedDevices(new Set(ids));
          if (ids.length > 0) {
            setSelected(ids[0]);
            onSelectDevice?.(ids[0]);
          }
          setPolygonVertices([]);
          setLassoCursor(null);
          e.preventDefault();
          return;
        }
      }
      setPolygonVertices(prev => [...prev, { x: bx, y: by }]);
      setLassoCursor({ x: bx, y: by });
      e.preventDefault();
      return;
    }

    const hit = hitTest(bx, by);

    if (hit) {
      if (toolMode === 'move') {
        // Move mode: start dragging (batch drag if part of multi-selection)
        pushUndo();
        const pos = positions[hit];
        setDragging(hit);
        setSelected(hit);
        setDragOffset({ x: bx - pos.x, y: by - pos.y });
        onSelectDevice?.(hit);

        // Prepare batch drag if hit is in current selection and selection > 1
        if (selectedDevices.has(hit) && selectedDevices.size > 1) {
          batchDragRef.current = Array.from(selectedDevices)
            .map(id => {
              const p = positions[id];
              return p ? { id, originX: p.x, originY: p.y } : null;
            })
            .filter((v): v is { id: string; originX: number; originY: number } => v != null);
        } else {
          batchDragRef.current = null;
          // If clicking a device NOT in selection, reset selection to just that device
          if (!selectedDevices.has(hit)) {
            setSelectedDevices(new Set([hit]));
          }
        }
      } else {
        // Select mode: shift-click toggles in/out of selection set
        if (e.shiftKey) {
          setSelectedDevices(prev => {
            const next = new Set(prev);
            if (next.has(hit)) next.delete(hit);
            else next.add(hit);
            return next;
          });
        } else {
          setSelectedDevices(new Set([hit]));
        }
        setSelected(hit);
        onSelectDevice?.(hit);
      }
      e.preventDefault();
    } else {
      // Start panning
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, px: panX, py: panY });
      if (!e.shiftKey) {
        setSelected(null);
        setSelectedDevices(new Set());
        onSelectDevice?.(null);
      }
    }
  }, [getMouseBoard, hitTest, positions, panX, panY, onSelectDevice, toolMode, pushUndo, selectedDevices, polygonVertices, zoom, devicesInsidePolygon]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Update lasso cursor for polygon preview / freehand path
    if (toolMode === 'lasso-freehand' && lassoPath) {
      const [bx, by] = getMouseBoard(e);
      setLassoPath(prev => (prev ? [...prev, { x: bx, y: by }] : prev));
      setLassoCursor({ x: bx, y: by });
      return;
    }
    if (toolMode === 'lasso-polygon' && polygonVertices.length > 0) {
      const [bx, by] = getMouseBoard(e);
      setLassoCursor({ x: bx, y: by });
      return;
    }

    if (dragging) {
      const [bx, by] = getMouseBoard(e);
      const newX = snap(bx - dragOffset.x);
      const newY = snap(by - dragOffset.y);
      // Batch drag: move every device in batchDragRef by the same delta as the hit device
      const batch = batchDragRef.current;
      if (batch && batch.length > 1) {
        const hitOrigin = batch.find(b => b.id === dragging);
        if (hitOrigin) {
          const dx = newX - hitOrigin.originX;
          const dy = newY - hitOrigin.originY;
          setPositions(prev => {
            const next = { ...prev };
            for (const b of batch) {
              next[b.id] = { x: snap(b.originX + dx), y: snap(b.originY + dy) };
            }
            return next;
          });
          return;
        }
      }
      setPositions(prev => ({ ...prev, [dragging]: { x: newX, y: newY } }));
    } else if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPanX(panStart.px + dx);
      setPanY(panStart.py + dy);
    } else {
      // Hover detection — devices first, then wires
      const [bx, by] = getMouseBoard(e);
      const hit = hitTest(bx, by);
      setHovering(hit);

      // Wire hover detection — point-to-segment distance along wire path
      if (!hit && layers.trunks) {
        let nearestWireIdx: number | null = null;
        let minDist = Infinity;
        const threshold = Math.max(3, 8 / zoom); // board-inches threshold
        for (let wi = 0; wi < wireConnections.length; wi++) {
          const conn = wireConnections[wi];
          // Check distance to each segment of the wire path
          const trunkPath = routedWirePaths.get(conn.wire.wireNumber);
          const pts = trunkPath && trunkPath.length >= 2
            ? trunkPath.map(p => ({ x: p.x, y: p.y }))
            : [conn.from, conn.to];
          for (let si = 0; si < pts.length - 1; si++) {
            const ax = pts[si].x, ay = pts[si].y;
            const bxs = pts[si + 1].x, bys = pts[si + 1].y;
            const dx = bxs - ax, dy = bys - ay;
            const lenSq = dx * dx + dy * dy;
            let t = lenSq > 0 ? ((bx - ax) * dx + (by - ay) * dy) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const px = ax + t * dx, py = ay + t * dy;
            const dist = Math.sqrt((bx - px) * (bx - px) + (by - py) * (by - py));
            if (dist < threshold && dist < minDist) {
              minDist = dist;
              nearestWireIdx = wi;
            }
          }
        }
        setHoveredWireIdx(nearestWireIdx);
      } else {
        setHoveredWireIdx(null);
      }

      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = hit ? 'grab' : 'default';
    }
  }, [dragging, isPanning, dragOffset, panStart, getMouseBoard, hitTest, wireConnections, layers, zoom, routedWirePaths]);

  const handleMouseUp = useCallback(async () => {
    // Freehand lasso: close path, select devices inside
    if (toolMode === 'lasso-freehand' && lassoPath && lassoPath.length >= 3) {
      const ids = devicesInsidePolygon(lassoPath);
      setSelectedDevices(new Set(ids));
      if (ids.length > 0) {
        setSelected(ids[0]);
        onSelectDevice?.(ids[0]);
      }
      setLassoPath(null);
      setLassoCursor(null);
      return;
    }
    if (dragging) {
      const batch = batchDragRef.current;
      if (batch && batch.length > 1) {
        // Batch save: update every dragged device
        for (const b of batch) {
          const pos = positions[b.id];
          if (pos) {
            await supabase
              .from('vehicle_build_manifest')
              .update({ pos_x_pct: pos.x, pos_y_pct: pos.y })
              .eq('id', b.id);
            onDeviceMove?.(b.id, pos.x, pos.y);
          }
        }
      } else {
        const pos = positions[dragging];
        if (pos) {
          await supabase
            .from('vehicle_build_manifest')
            .update({ pos_x_pct: pos.x, pos_y_pct: pos.y })
            .eq('id', dragging);
          onDeviceMove?.(dragging, pos.x, pos.y);
        }
      }
      batchDragRef.current = null;
    }
    setDragging(null);
    setIsPanning(false);
  }, [dragging, positions, onDeviceMove, toolMode, lassoPath, devicesInsidePolygon, onSelectDevice]);

  // Keep refs in sync so wheel handler never reads stale closures
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  zoomRef.current = zoom;
  panXRef.current = panX;
  panYRef.current = panY;

  // Native wheel handler with passive:false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldZoom = zoomRef.current;
      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      const newZoom = Math.max(0.5, Math.min(30, oldZoom * factor));
      const ratio = newZoom / oldZoom;

      // Zoom toward mouse: keep the board point under the cursor fixed
      setPanX(mx - (mx - panXRef.current) * ratio);
      setPanY(my - (my - panYRef.current) * ratio);
      setZoom(newZoom);
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const layerBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    background: active ? '#333' : '#1a1a1a',
    color: active ? '#FFF' : '#666',
    border: `1px solid ${active ? '#666' : '#333'}`,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  });

  const floatingToolBtn = (active: boolean, accent: string): React.CSSProperties => ({
    padding: '3px 8px',
    background: active ? '#2a2a3a' : 'transparent',
    color: active ? accent : '#888',
    border: `1px solid ${active ? accent : 'transparent'}`,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* Former sub-loom tab bar collapsed into the floating canvas toolbar
          below — saves ~28px of vertical chrome so the plotter print gets the
          real estate. Loom selector is now a dropdown, tool buttons float over
          the canvas top-left. */}

      {/* ── Canvas ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* Floating toolbar — overlays the canvas top-left so chrome stays out
            of the work area until the user needs it. Loom filter is a dropdown
            (was 8 buttons), tools are compact. */}
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 10,
          display: 'flex', gap: 2, alignItems: 'center',
          background: 'rgba(20,20,28,0.94)',
          border: '1px solid #333',
          padding: '3px 4px',
        }}>
          <select
            value={activeLoom}
            onChange={e => setActiveLoom(e.target.value as any)}
            title="Active sub-loom (keys 1-8)"
            style={{
              background: '#1a1a1a', color: '#6c8cff',
              border: '1px solid #444',
              fontFamily: 'Arial', fontSize: '9px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.5px',
              padding: '2px 6px', cursor: 'pointer',
            }}
          >
            {SUB_LOOMS.map((loom, i) => (
              <option key={loom.id} value={loom.id} style={{ background: '#1a1a1a' }}>
                {i + 1}. {loom.label}
              </option>
            ))}
          </select>
          <span style={{ color: '#333', margin: '0 4px' }}>|</span>
          <button
            onClick={() => setToolMode('select')}
            style={floatingToolBtn(toolMode === 'select', '#6c8cff')}
            title="Select (V)"
          >SEL</button>
          <button
            onClick={() => setToolMode('move')}
            style={floatingToolBtn(toolMode === 'move', '#f97316')}
            title="Move (M)"
          >MOV</button>
          <button
            onClick={() => { setToolMode('lasso-freehand'); setLassoPath(null); setPolygonVertices([]); }}
            style={floatingToolBtn(toolMode === 'lasso-freehand', '#a78bfa')}
            title="Freehand Lasso (L)"
          >LAS</button>
          <button
            onClick={() => { setToolMode('lasso-polygon'); setPolygonVertices([]); setLassoPath(null); }}
            style={floatingToolBtn(toolMode === 'lasso-polygon', '#a78bfa')}
            title="Polygon Lasso (P)"
          >POL</button>
          <span style={{ color: '#333', margin: '0 4px' }}>|</span>
          <button
            onClick={() => setShowRuler(r => !r)}
            style={floatingToolBtn(showRuler, '#cbd5e1')}
            title="Toggle ruler"
          >RUL</button>
          <button
            onClick={handlePrint}
            style={floatingToolBtn(false, '#cbd5e1')}
            title="Print / export PDF"
          >PRT</button>
        </div>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%', height: '100%', display: 'block',
            cursor: toolMode === 'move' ? 'grab'
              : (toolMode === 'lasso-freehand' || toolMode === 'lasso-polygon') ? 'crosshair'
              : 'default',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={(e) => {
            // Double-click closes polygon lasso
            if (toolMode === 'lasso-polygon' && polygonVertices.length >= 3) {
              const ids = devicesInsidePolygon(polygonVertices);
              setSelectedDevices(new Set(ids));
              if (ids.length > 0) {
                setSelected(ids[0]);
                onSelectDevice?.(ids[0]);
              }
              setPolygonVertices([]);
              setLassoCursor(null);
              e.preventDefault();
            }
          }}
        />
        {/* Layer toggle panel */}
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          display: 'flex', gap: 2, background: '#111', padding: '4px 6px',
          border: '1px solid #444',
        }}>
          <span style={{ color: '#888', fontFamily: 'Arial', fontSize: '10px', fontWeight: 'bold', alignSelf: 'center', marginRight: 4, textTransform: 'uppercase' }}>
            LAYERS
          </span>
          {(['grid', 'vehicle', 'components', 'connectors', 'trunks', 'labels'] as LayerName[]).map(name => (
            <button key={name} style={layerBtnStyle(layers[name])} onClick={() => toggleLayer(name)}>
              {name}
            </button>
          ))}
          <span style={{ color: '#555', margin: '0 2px' }}>|</span>
          {silhouette.layers.map(l => (
            <button key={l.id} style={{
              ...layerBtnStyle(!!vehLayers[l.id]),
              borderColor: vehLayers[l.id] ? l.color : '#333',
              color: vehLayers[l.id] ? l.color : '#666',
            }} onClick={() => toggleVehLayer(l.id)}>
              {l.shortLabel}
            </button>
          ))}
          <button style={{
            ...layerBtnStyle(!!vehLayers['zones']),
            borderColor: vehLayers['zones'] ? '#cc6600' : '#333',
            color: vehLayers['zones'] ? '#cc6600' : '#666',
          }} onClick={() => toggleVehLayer('zones')}>
            ZONES
          </button>
        </div>

        {/* Zoom controls — on-screen buttons for 13" screens */}
        <div style={{
          position: 'absolute', bottom: 12, right: 12,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <button onClick={() => setZoom(z => Math.min(30, z * 1.3))} style={{
            width: 32, height: 32, background: '#222', color: '#fff', border: '1px solid #555',
            cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>+</button>
          <button onClick={() => setZoom(z => Math.max(0.5, z / 1.3))} style={{
            width: 32, height: 32, background: '#222', color: '#fff', border: '1px solid #555',
            cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>-</button>
          <button onClick={fitToView} style={{
            width: 32, height: 32, background: '#222', color: '#fff', border: '1px solid #555',
            cursor: 'pointer', fontSize: '9px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>FIT</button>
        </div>

        {/* ── TITLE BLOCK ─────────────────────────────────────────────
            ASME Y14.44 / ASME Y14.1 engineering drawing title block. Every
            shop print has one in the bottom-right. Contains drawing number,
            revision, scale, date, sheet count — the provenance a builder
            needs to confirm they're looking at the right print. DOM overlay
            (not canvas-drawn) so it stays crisp at any zoom and prints
            cleanly via window.print(). */}
        <div style={{
          position: 'absolute', bottom: 8, right: 56, zIndex: 9,
          background: 'rgba(255,255,252,0.98)',
          border: '2px solid #111',
          fontFamily: 'Arial', fontSize: '8px', color: '#111',
          minWidth: 280, userSelect: 'none',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 70px',
            borderBottom: '1px solid #111',
          }}>
            <div style={{ padding: '4px 6px', borderRight: '1px solid #111' }}>
              <div style={{ fontSize: '6px', color: '#666', letterSpacing: '0.5px' }}>TITLE</div>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.3px' }}>
                1977 K5 BLAZER — {mode === 'routing' ? 'ROUTING DIAGRAM' : 'HARNESS FORMBOARD'}
                {activeLoom !== 'all' && ` · ${activeLoom.toUpperCase()} SUB-LOOM`}
              </div>
            </div>
            <div style={{ padding: '4px 6px' }}>
              <div style={{ fontSize: '6px', color: '#666', letterSpacing: '0.5px' }}>DWG NO.</div>
              <div style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'Courier New' }}>
                K5-WH-{mode === 'routing' ? 'RT' : 'FB'}-{(activeLoom === 'all' ? 'ALL' : activeLoom.toUpperCase().slice(0,3))}
              </div>
            </div>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '50px 1fr 40px 1fr 50px 60px',
          }}>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #111', background: '#eee' }}>
              <div style={{ fontSize: '6px', color: '#666' }}>SCALE</div>
              <div style={{ fontFamily: 'Courier New', fontWeight: 700 }}>1:1</div>
            </div>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #111' }}>
              <div style={{ fontSize: '6px', color: '#666' }}>UNITS</div>
              <div style={{ fontFamily: 'Courier New', fontWeight: 700 }}>INCH</div>
            </div>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #111', background: '#eee' }}>
              <div style={{ fontSize: '6px', color: '#666' }}>REV</div>
              <div style={{ fontFamily: 'Courier New', fontWeight: 700 }}>A</div>
            </div>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #111' }}>
              <div style={{ fontSize: '6px', color: '#666' }}>DATE</div>
              <div style={{ fontFamily: 'Courier New', fontWeight: 700 }}>
                {new Date().toISOString().slice(0, 10)}
              </div>
            </div>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #111', background: '#eee' }}>
              <div style={{ fontSize: '6px', color: '#666' }}>STD</div>
              <div style={{ fontFamily: 'Courier New', fontWeight: 700, fontSize: '7px' }}>WHMA-A-620</div>
            </div>
            <div style={{ padding: '3px 6px' }}>
              <div style={{ fontSize: '6px', color: '#666' }}>SHEET</div>
              <div style={{ fontFamily: 'Courier New', fontWeight: 700 }}>1 OF 1</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
