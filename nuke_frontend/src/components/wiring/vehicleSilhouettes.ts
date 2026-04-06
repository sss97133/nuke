// vehicleSilhouettes.ts — 1973-1987 K5 Blazer SVG outlines
//
// Factory dimensions (GM Light Duty Truck Service Manual, 1980):
//   Wheelbase: 106.5"   Overall length: 184.8"   Width: 79.6"   Height: 73.7"
//   Front overhang: 31.5"   Rear overhang: 46.8"   Frame rail width: ~34"
//   Front track: 65.8"   Rear track: 63.2"
//
// Coordinate system: 0-1000 SVG units.
// Top-down: X = left(driver) to right(passenger), Y = front to rear. Center X=500.
// Side:     X = front to rear, Y = top to bottom (0=sky, 550=ground).

export interface VehicleLayer {
  id: string;
  label: string;
  shortLabel: string;
  paths: LayerPath[];
  defaultVisible: boolean;
  defaultOpacity: number;
  color: string;
  zIndex: number;
}

export interface LayerPath {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  label?: string;
}

export interface SilhouetteZone {
  id: string;
  label: string;
  path: string;
  color: string;
  yMin: number;
  yMax: number;
  xMin: number;
  xMax: number;
}

export interface ImageLayer {
  id: string;
  label: string;
  shortLabel: string;
  src: string;
  /** Source image natural dimensions */
  imgWidth: number;
  imgHeight: number;
  /** Crop region within the source image (sx, sy, sw, sh) */
  viewBox: { sx: number; sy: number; sw: number; sh: number };
  /** Placement on the 1000x1000 canvas */
  canvasRect: { x: number; y: number; w: number; h: number };
  defaultOpacity: number;
  /** Which view this layer applies to */
  view: 'top-down' | 'side' | 'both';
}

export interface VehicleSilhouette {
  id: string;
  label: string;
  viewBox: string;
  layers: VehicleLayer[];
  zones: SilhouetteZone[];
  imageLayers: ImageLayer[];
}

const Z = {
  engine_bay: '#cc2222',
  firewall:   '#cc6600',
  dash:       '#2266cc',
  doors:      '#7744aa',
  rear:       '#228b22',
  underbody:  '#8b4513',
  roof:       '#666666',
  frame:      '#444444',
};

// ══════════════════════════════════════════════════════════════════════
// TOP-DOWN VIEW — 1977 K5 Blazer
// ══════════════════════════════════════════════════════════════════════
// Proportions: ~2.3:1 length:width. Body centered at X=500.
// Body width ~400 units (200-800 for fenders). Core cabin ~330 wide.

export const TOP_DOWN: VehicleSilhouette = {
  id: 'top-down',
  label: 'TOP DOWN — 1977 K5 BLAZER',
  viewBox: '0 0 1000 1000',
  layers: [
    // ── Frame Rails ──
    {
      id: 'frame',
      label: 'Frame Rails',
      shortLabel: 'FRAME',
      defaultVisible: false,
      defaultOpacity: 0.25,
      color: Z.frame,
      zIndex: 0,
      paths: [
        // Left rail
        { d: 'M 355,65 L 370,65 L 370,945 L 355,945 Z', fill: Z.frame },
        // Right rail
        { d: 'M 630,65 L 645,65 L 645,945 L 630,945 Z', fill: Z.frame },
        // Crossmembers
        { d: 'M 355,90 L 645,90 L 645,100 L 355,100 Z', fill: Z.frame },
        { d: 'M 355,260 L 645,260 L 645,270 L 355,270 Z', fill: Z.frame },
        { d: 'M 355,460 L 645,460 L 645,470 L 355,470 Z', fill: Z.frame },
        { d: 'M 355,660 L 645,660 L 645,670 L 355,670 Z', fill: Z.frame },
        { d: 'M 355,850 L 645,850 L 645,860 L 355,860 Z', fill: Z.frame },
      ],
    },
    // ── Body Shell ──
    {
      id: 'body',
      label: 'Body Shell',
      shortLabel: 'BODY',
      defaultVisible: true,
      defaultOpacity: 0.06,
      color: '#d5d0c8',
      zIndex: 1,
      paths: [
        // Outer body — K5 Blazer top-down shape
        // Fender flares, wheel well cutouts, step notches, tailgate
        {
          d: [
            // === Front bumper (chrome, slightly wider than body) ===
            'M 215,52',
            'Q 500,40 785,52',         // Slight front bumper curve

            // === Right fender (passenger side) ===
            'L 800,65',                 // Bumper corner
            'Q 830,68 842,90',          // Fender corner radius
            'L 845,130',               // Fender side

            // Right front wheel well cutout
            'Q 848,148 850,170',
            'Q 852,195 845,220',        // Wheel arch peak
            'Q 838,248 830,260',        // Wheel well rear

            // Right body between wheels
            'L 828,280',
            'L 825,340',               // Pre-door body side
            // Right door area — slight step-out for running boards
            'L 835,350',
            'L 838,365',               // Door handle area
            'L 838,545',               // Door panel
            'L 835,560',
            'L 828,570',               // Post-door

            // Right rear wheel well cutout
            'L 830,680',
            'Q 838,700 845,730',        // Wheel arch front
            'Q 852,760 850,790',        // Wheel arch peak
            'Q 848,818 842,840',        // Wheel arch rear

            // Right rear quarter
            'L 838,870',
            'Q 835,900 825,930',        // Quarter taper toward tailgate
            'L 810,945',               // Tailgate corner

            // === Tailgate ===
            'Q 500,958 190,945',        // Tailgate — slight curve, step bumper

            // === Left rear quarter ===
            'L 175,930',
            'Q 165,900 162,870',
            'L 158,840',

            // Left rear wheel well cutout
            'Q 152,818 150,790',        // Wheel arch rear
            'Q 148,760 155,730',        // Wheel arch peak
            'Q 162,700 170,680',        // Wheel arch front

            // Left body between wheels
            'L 172,570',
            'L 165,560',
            // Left door area
            'L 162,545',
            'L 162,365',
            'L 165,350',
            'L 172,340',

            // Left body toward fender
            'L 175,280',
            'L 170,260',

            // Left front wheel well cutout
            'Q 162,248 155,220',        // Wheel well rear
            'Q 148,195 150,170',        // Wheel arch peak
            'Q 152,148 158,130',        // Wheel arch front

            // Left fender
            'L 158,90',
            'Q 170,68 200,65',          // Fender corner radius
            'L 215,52',
            'Z',
          ].join(' '),
          fill: '#d5d0c8',
          strokeWidth: 2,
        },

        // Grille face (inset — the square headlight grille)
        { d: 'M 260,60 L 740,60 L 740,80 L 260,80 Z', fill: '#1a1a1a' },

        // Headlights (square, dual headlight setup)
        { d: 'M 270,62 L 330,62 L 330,78 L 270,78 Z', fill: '#888', stroke: '#aaa', strokeWidth: 1 },
        { d: 'M 340,62 L 380,62 L 380,78 L 340,78 Z', fill: '#777', stroke: '#aaa', strokeWidth: 1 },
        { d: 'M 620,62 L 660,62 L 660,78 L 620,78 Z', fill: '#777', stroke: '#aaa', strokeWidth: 1 },
        { d: 'M 670,62 L 730,62 L 730,78 L 670,78 Z', fill: '#888', stroke: '#aaa', strokeWidth: 1 },

        // Hood seam line
        { d: 'M 280,90 L 280,315 Q 500,320 720,315 L 720,90', fill: 'none', stroke: '#555', strokeWidth: 0.8 },

        // Hood scoop / center ridge (subtle)
        { d: 'M 470,110 L 530,110 L 530,280 L 470,280 Z', fill: 'none', stroke: '#444', strokeWidth: 0.5 },

        // Windshield
        { d: 'M 240,330 L 760,330 L 740,365 L 260,365 Z', fill: '#334455', stroke: '#2a2a2a', strokeWidth: 1.5 },

        // A-pillars
        { d: 'M 235,328 L 255,328 L 260,370 L 240,370 Z', fill: '#2a2a2a' },
        { d: 'M 745,328 L 765,328 L 760,370 L 740,370 Z', fill: '#2a2a2a' },

        // Roof panel (removable hardtop — slightly inset from body)
        { d: 'M 260,375 L 740,375 L 738,555 L 262,555 Z', fill: '#333', stroke: '#2a2a2a', strokeWidth: 1 },

        // Drip rails on roof edges
        { d: 'M 258,375 L 262,375 L 262,555 L 258,555 Z', fill: '#444' },
        { d: 'M 738,375 L 742,375 L 742,555 L 738,555 Z', fill: '#444' },

        // Rear window (removable hardtop — large single pane)
        { d: 'M 275,558 L 725,558 L 735,590 L 265,590 Z', fill: '#334455', stroke: '#2a2a2a', strokeWidth: 1 },

        // Rear quarter panels (behind rear window to tailgate)
        { d: 'M 200,595 L 800,595 L 810,940 L 190,940 Z', fill: '#2e2e2e' },

        // Tailgate handle / latch
        { d: 'M 470,942 L 530,942 L 530,950 L 470,950 Z', fill: '#666' },

        // Side mirrors
        { d: 'M 148,340 L 160,335 L 162,355 L 150,358 Z', fill: '#2a2a2a' },
        { d: 'M 852,340 L 840,335 L 838,355 L 850,358 Z', fill: '#2a2a2a' },

        // Front wheels (visible through wells)
        { d: 'M 140,155 A 35,55 0 1,1 140,156 Z', fill: '#333', stroke: '#555', strokeWidth: 1 },
        { d: 'M 860,155 A 35,55 0 1,1 860,156 Z', fill: '#333', stroke: '#555', strokeWidth: 1 },

        // Rear wheels
        { d: 'M 140,755 A 35,55 0 1,1 140,756 Z', fill: '#333', stroke: '#555', strokeWidth: 1 },
        { d: 'M 860,755 A 35,55 0 1,1 860,756 Z', fill: '#333', stroke: '#555', strokeWidth: 1 },

        // Front turn signals (amber, in bumper)
        { d: 'M 230,52 L 260,55 L 260,60 L 230,58 Z', fill: '#cc8800' },
        { d: 'M 770,52 L 740,55 L 740,60 L 770,58 Z', fill: '#cc8800' },

        // Tail lights
        { d: 'M 192,920 L 215,920 L 218,945 L 192,945 Z', fill: '#aa2222' },
        { d: 'M 808,920 L 785,920 L 782,945 L 808,945 Z', fill: '#aa2222' },
      ],
    },
    // ── Engine ──
    {
      id: 'engine',
      label: 'Engine / Drivetrain',
      shortLabel: 'ENGINE',
      defaultVisible: false,
      defaultOpacity: 0.2,
      color: '#994400',
      zIndex: 2,
      paths: [
        // LS3 block (V8, top-down view with valve covers visible)
        { d: 'M 375,115 L 625,115 L 625,295 L 375,295 Z', fill: '#994400', label: 'LS3' },
        // Left valve cover
        { d: 'M 378,125 L 475,125 L 475,285 L 378,285 Z', fill: '#885522' },
        // Right valve cover
        { d: 'M 525,125 L 622,125 L 622,285 L 525,285 Z', fill: '#885522' },
        // Intake manifold (center valley)
        { d: 'M 478,130 L 522,130 L 522,280 L 478,280 Z', fill: '#776644' },
        // Throttle body
        { d: 'M 488,118 L 512,118 L 512,132 L 488,132 Z', fill: '#666' },
        // Transmission (4L80E)
        { d: 'M 430,300 L 570,300 L 560,450 L 440,450 Z', fill: '#776655' },
        // Transfer case (NP241)
        { d: 'M 450,455 L 550,455 L 545,525 L 455,525 Z', fill: '#776655' },
        // Front driveshaft
        { d: 'M 495,115 L 505,115 L 505,80 L 495,80 Z', fill: '#555' },
        // Rear driveshaft
        { d: 'M 495,530 L 505,530 L 505,840 L 495,840 Z', fill: '#555' },
        // Exhaust manifolds (headers)
        { d: 'M 365,140 L 375,140 L 375,280 L 365,280 Z', fill: '#666' },
        { d: 'M 625,140 L 635,140 L 635,280 L 625,280 Z', fill: '#666' },
      ],
    },
    // ── Interior ──
    {
      id: 'interior',
      label: 'Interior',
      shortLabel: 'INT',
      defaultVisible: false,
      defaultOpacity: 0.15,
      color: Z.dash,
      zIndex: 3,
      paths: [
        // Dashboard (full width under windshield)
        { d: 'M 260,365 L 740,365 L 740,395 L 260,395 Z', fill: Z.dash },
        // Steering wheel (driver side)
        { d: 'M 310,405 A 30,30 0 1,1 310,406 Z', fill: 'none', stroke: '#555', strokeWidth: 2 },
        // Steering column
        { d: 'M 308,395 L 312,395 L 312,420 L 308,420 Z', fill: '#555' },
        // Front seats
        { d: 'M 270,425 L 450,425 L 450,540 L 270,540 Z', fill: '#445566' },
        { d: 'M 550,425 L 730,425 L 730,540 L 550,540 Z', fill: '#445566' },
        // Center console / hump
        { d: 'M 460,400 L 540,400 L 540,550 L 460,550 Z', fill: '#3a3a3a' },
        // Rear bench seat
        { d: 'M 270,560 L 730,560 L 730,640 L 270,640 Z', fill: '#445566' },
      ],
    },
  ],
  zones: [
    {
      id: 'engine_bay', label: 'ENGINE BAY', color: Z.engine_bay,
      path: 'M 160,50 L 840,50 L 840,330 L 160,330 Z',
      yMin: 5, yMax: 28, xMin: 25, xMax: 75,
    },
    {
      id: 'firewall', label: 'FIREWALL', color: Z.firewall,
      path: 'M 160,330 L 840,330 L 840,370 L 160,370 Z',
      yMin: 29, yMax: 33, xMin: 30, xMax: 70,
    },
    {
      id: 'dash', label: 'DASH / CABIN', color: Z.dash,
      path: 'M 160,370 L 840,370 L 840,660 L 160,660 Z',
      yMin: 34, yMax: 55, xMin: 25, xMax: 75,
    },
    {
      id: 'doors', label: 'DOORS', color: Z.doors,
      path: 'M 140,350 L 165,350 L 165,560 L 140,560 Z M 835,350 L 860,350 L 860,560 L 835,560 Z',
      yMin: 42, yMax: 54, xMin: 10, xMax: 90,
    },
    {
      id: 'rear', label: 'REAR / CARGO', color: Z.rear,
      path: 'M 160,660 L 840,660 L 840,950 L 160,950 Z',
      yMin: 62, yMax: 90, xMin: 28, xMax: 72,
    },
    {
      id: 'underbody', label: 'UNDERBODY', color: Z.underbody,
      path: 'M 350,50 L 650,50 L 650,950 L 350,950 Z',
      yMin: 20, yMax: 85, xMin: 35, xMax: 65,
    },
    {
      id: 'roof', label: 'ROOF', color: Z.roof,
      path: 'M 258,375 L 742,375 L 742,555 L 258,555 Z',
      yMin: 36, yMax: 44, xMin: 35, xMax: 65,
    },
  ],
  imageLayers: [
    {
      id: 'body-ortho', label: 'Body Outline (RC4WD)', shortLabel: 'BODY',
      src: '/wiring/K5_body_orthographic_rc4wd.jpg',
      imgWidth: 772, imgHeight: 480,
      viewBox: { sx: 15, sy: 5, sw: 285, sh: 525 },
      canvasRect: { x: 150, y: 40, w: 700, h: 920 },
      defaultOpacity: 0.25, view: 'top-down',
    },
    {
      id: '4view-ortho', label: '4-View Orthographic', shortLabel: '4VIEW',
      src: '/wiring/K5_blazer_1977_4view_orthographic.gif',
      imgWidth: 1005, imgHeight: 555,
      viewBox: { sx: 0, sy: 0, sw: 1005, sh: 555 },
      canvasRect: { x: 50, y: 20, w: 900, h: 500 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'engine-bay', label: 'LS3 Engine Bay', shortLabel: 'LS3',
      src: '/wiring/K5_engine_bay_ls3_standalone.png',
      imgWidth: 2486, imgHeight: 1720,
      viewBox: { sx: 0, sy: 0, sw: 2486, sh: 1720 },
      canvasRect: { x: 200, y: 50, w: 600, h: 280 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'harness-plan', label: 'Harness Routing Plan', shortLabel: 'HARNESS',
      src: '/wiring/K5_harness_routing_plan_view.png',
      imgWidth: 4200, imgHeight: 1800,
      viewBox: { sx: 0, sy: 0, sw: 4200, sh: 1800 },
      canvasRect: { x: 50, y: 30, w: 900, h: 390 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'engine-wiring', label: 'Engine Compartment Wiring', shortLabel: 'ENG WIR',
      src: '/wiring/engine_6D16D_compartment_wiring_3quarter.png',
      imgWidth: 2486, imgHeight: 3358,
      viewBox: { sx: 0, sy: 0, sw: 2486, sh: 3358 },
      canvasRect: { x: 150, y: 30, w: 700, h: 940 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'front-lighting', label: 'Front Lighting (On-Vehicle)', shortLabel: 'FRT LT',
      src: '/wiring/elec_8_9_onvehicle_headlamp_front_lighting.png',
      imgWidth: 2156, imgHeight: 2772,
      viewBox: { sx: 0, sy: 0, sw: 2156, sh: 2772 },
      canvasRect: { x: 100, y: 20, w: 500, h: 640 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'forward-lamp', label: 'Forward Lamp Wiring', shortLabel: 'FWD LMP',
      src: '/wiring/elec_8A14_forward_lamp_wiring_CK_front.png',
      imgWidth: 2504, imgHeight: 3371,
      viewBox: { sx: 0, sy: 0, sw: 2504, sh: 3371 },
      canvasRect: { x: 100, y: 20, w: 500, h: 670 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'rear-lighting', label: 'Rear Lighting (CK)', shortLabel: 'REAR LT',
      src: '/wiring/elec_8_12_rear_lighting_CK_all_models.png',
      imgWidth: 2148, imgHeight: 2766,
      viewBox: { sx: 0, sy: 0, sw: 2148, sh: 2766 },
      canvasRect: { x: 200, y: 500, w: 600, h: 770 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'clearance-interior', label: 'Clearance / Light Switch / Interior', shortLabel: 'CLR/INT',
      src: '/wiring/elec_8_14_clearance_lamps_light_switch_interior.png',
      imgWidth: 2140, imgHeight: 2761,
      viewBox: { sx: 0, sy: 0, sw: 2140, sh: 2761 },
      canvasRect: { x: 150, y: 200, w: 700, h: 900 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'underbody-wiring', label: 'Auxiliary Wiring (Underbody)', shortLabel: 'UNDER',
      src: '/wiring/elec_8A16_auxiliary_wiring_underbody.png',
      imgWidth: 2501, imgHeight: 3369,
      viewBox: { sx: 0, sy: 0, sw: 2501, sh: 3369 },
      canvasRect: { x: 200, y: 100, w: 600, h: 810 },
      defaultOpacity: 0, view: 'top-down',
    },
    {
      id: 'cab-clearance', label: 'Cab Clearance / Service', shortLabel: 'CAB SVC',
      src: '/wiring/elec_8A_onvehicle_service_cab_clearance.png',
      imgWidth: 2523, imgHeight: 3384,
      viewBox: { sx: 0, sy: 0, sw: 2523, sh: 3384 },
      canvasRect: { x: 150, y: 300, w: 700, h: 940 },
      defaultOpacity: 0, view: 'top-down',
    },
  ],
};

// ══════════════════════════════════════════════════════════════════════
// SIDE VIEW — 1977 K5 Blazer, driver side
// ══════════════════════════════════════════════════════════════════════
// X: 0=front, 1000=rear. Y: 0=sky, 550=ground line.
// Front axle center ~240, rear axle ~800. Ground ~440.

export const SIDE_VIEW: VehicleSilhouette = {
  id: 'side',
  label: 'SIDE VIEW — 1977 K5 BLAZER',
  viewBox: '0 0 1000 550',
  layers: [
    // ── Frame ──
    {
      id: 'frame',
      label: 'Frame Rails',
      shortLabel: 'FRAME',
      defaultVisible: false,
      defaultOpacity: 0.3,
      color: Z.frame,
      zIndex: 0,
      paths: [
        { d: 'M 50,415 L 950,415 L 950,432 L 50,432 Z', fill: Z.frame, strokeWidth: 1.5 },
        { d: 'M 80,410 L 100,410 L 100,437 L 80,437 Z', fill: Z.frame },
        { d: 'M 200,410 L 220,410 L 220,437 L 200,437 Z', fill: Z.frame },
        { d: 'M 420,410 L 440,410 L 440,437 L 420,437 Z', fill: Z.frame },
        { d: 'M 580,410 L 600,410 L 600,437 L 580,437 Z', fill: Z.frame },
        { d: 'M 750,410 L 770,410 L 770,437 L 750,437 Z', fill: Z.frame },
        { d: 'M 900,410 L 920,410 L 920,437 L 900,437 Z', fill: Z.frame },
      ],
    },
    // ── Body Shell ──
    {
      id: 'body',
      label: 'Body Shell',
      shortLabel: 'BODY',
      defaultVisible: true,
      defaultOpacity: 0.06,
      color: '#d5d0c8',
      zIndex: 1,
      paths: [
        {
          d: [
            // Front bumper — chrome, square GM truck bumper
            'M 25,355',
            'L 25,330',               // Bumper face bottom to top
            'L 40,328',               // Bumper lip
            // Grille face — square headlights, vertical bar grille
            'L 55,310',               // Valance panel
            'L 60,290',               // Lower grille
            'L 65,260',               // Upper grille / headlight top
            // Hood line — long flat GM truck hood
            'L 80,255',               // Hood leading edge
            'L 170,248',              // Hood rises slightly
            'Q 250,240 340,238',      // Long flat hood with subtle crown

            // Windshield — steep rake (~68 degrees, very upright on these trucks)
            'L 350,235',              // Cowl
            'Q 365,165 380,135',      // Windshield glass (steep, tall)

            // A-pillar to roof
            'L 395,118',              // A-pillar top
            'Q 420,108 440,105',      // Roof front edge radius

            // Roof — flat, short (removable hardtop)
            'L 580,103',              // Roof panel (flat across top)

            // B-pillar / rear of cab
            'Q 600,105 615,110',      // Roof rear radius
            'L 625,120',              // B-pillar

            // Rear window — angled back on hardtop
            'Q 640,155 650,185',      // Rear window glass

            // C-pillar / rear quarter transition
            'L 658,205',              // Quarter panel top
            'L 665,215',

            // Bed rail / rear quarter panel — flat horizontal line (short bed)
            'L 910,215',              // Flat bed rail all the way back

            // Tailgate
            'L 920,220',              // Tailgate top corner
            'L 945,340',              // Tailgate face (slightly angled)
            'L 950,355',              // Tailgate bottom

            // Rear bumper
            'L 965,355',
            'L 965,370',              // Bumper face
            'L 950,372',
            'L 935,372',

            // Underside — rear
            'L 935,370',

            // Rear wheel well arch
            'Q 880,370 870,355',
            'Q 855,325 840,310',      // Arch ascending
            'Q 820,295 800,290',      // Arch crown
            'Q 780,295 760,310',      // Arch descending
            'Q 745,325 735,355',
            'Q 730,370 720,375',

            // Rocker panel between wheel wells
            'L 320,375',

            // Front wheel well arch
            'Q 310,370 300,355',
            'Q 285,325 270,310',
            'Q 250,295 235,290',      // Front arch crown
            'Q 215,295 200,310',
            'Q 185,325 175,355',
            'Q 170,370 160,375',

            // Lower front
            'L 60,375',
            'L 40,372',
            'L 25,370',
            'L 25,355',
            'Z',
          ].join(' '),
          fill: '#d5d0c8',
          strokeWidth: 2,
        },

        // Front wheel
        { d: 'M 235,335 m -48,0 a 48,48 0 1,0 96,0 a 48,48 0 1,0 -96,0', fill: '#444', stroke: '#555', strokeWidth: 1.5 },
        // Front wheel hub
        { d: 'M 235,335 m -15,0 a 15,15 0 1,0 30,0 a 15,15 0 1,0 -30,0', fill: '#666' },

        // Rear wheel
        { d: 'M 800,335 m -48,48 0 1,0 96,0 a 48,48 0 1,0 -96,0', fill: '#444', stroke: '#555', strokeWidth: 1.5 },
        // Rear wheel hub
        { d: 'M 800,335 m -15,0 a 15,15 0 1,0 30,0 a 15,15 0 1,0 -30,0', fill: '#666' },

        // Door outline
        { d: 'M 380,140 L 380,370 L 620,370 L 620,115 Q 610,112 600,110', fill: 'none', stroke: '#555', strokeWidth: 0.8 },

        // Door handle
        { d: 'M 540,255 L 575,255 L 575,262 L 540,262 Z', fill: '#666' },

        // Window glass — door
        { d: 'M 395,140 L 395,250 L 605,250 L 605,120 Q 600,115 590,112 L 440,108 Q 420,112 395,140 Z', fill: '#334455', stroke: '#2a2a2a', strokeWidth: 0.8 },

        // Windshield glass
        { d: 'M 352,232 Q 367,165 382,133 L 392,120 Q 400,112 410,108 L 440,108 L 395,140 L 395,232 Z', fill: '#334455', stroke: '#2a2a2a', strokeWidth: 0.8 },

        // Rear window glass
        { d: 'M 610,118 Q 625,125 633,150 L 648,192 L 648,210 L 610,210 Z', fill: '#334455', stroke: '#2a2a2a', strokeWidth: 0.8 },

        // Headlight (square dual)
        { d: 'M 63,265 L 78,265 L 78,288 L 63,288 Z', fill: '#888', stroke: '#aaa', strokeWidth: 0.8 },

        // Turn signal (below headlight)
        { d: 'M 63,290 L 78,290 L 78,300 L 63,300 Z', fill: '#cc8800' },

        // Tail light
        { d: 'M 935,230 L 945,230 L 948,330 L 935,330 Z', fill: '#aa2222' },

        // Side marker (front fender)
        { d: 'M 110,345 L 140,345 L 140,352 L 110,352 Z', fill: '#cc8800' },

        // Side mirror
        { d: 'M 370,180 L 358,175 L 355,195 L 368,198 Z', fill: '#2a2a2a' },

        // Fender badge / BLAZER text area
        { d: 'M 120,300 L 165,300 L 165,308 L 120,308 Z', fill: 'none', stroke: '#555', strokeWidth: 0.4 },
      ],
    },
    // ── Engine ──
    {
      id: 'engine',
      label: 'Engine / Drivetrain',
      shortLabel: 'ENGINE',
      defaultVisible: false,
      defaultOpacity: 0.25,
      color: '#994400',
      zIndex: 2,
      paths: [
        { d: 'M 120,262 L 300,262 L 300,400 L 120,400 Z', fill: '#994400', label: 'LS3' },
        { d: 'M 130,248 L 290,248 L 290,262 L 130,262 Z', fill: '#885533' },
        { d: 'M 305,290 L 430,305 L 430,405 L 305,400 Z', fill: '#776655', label: 'Trans' },
        { d: 'M 435,315 L 495,320 L 495,405 L 435,405 Z', fill: '#776655', label: 'T-case' },
        { d: 'M 235,405 L 235,410 L 435,410 L 435,405 Z', fill: '#666' },
        { d: 'M 500,405 L 500,410 L 800,410 L 800,405 Z', fill: '#666' },
      ],
    },
    // ── Interior ──
    {
      id: 'interior',
      label: 'Interior / Dash',
      shortLabel: 'INT',
      defaultVisible: false,
      defaultOpacity: 0.2,
      color: Z.dash,
      zIndex: 3,
      paths: [
        { d: 'M 348,165 L 385,165 L 385,268 L 348,268 Z', fill: Z.dash, label: 'Dash' },
        { d: 'M 378,200 L 408,245 L 403,250 L 373,205 Z', fill: '#555' },
        { d: 'M 405,190 L 520,190 L 530,365 L 395,365 Z', fill: '#445566' },
        { d: 'M 535,195 L 615,195 L 620,365 L 530,365 Z', fill: '#445566' },
      ],
    },
  ],
  zones: [
    {
      id: 'engine_bay', label: 'ENGINE BAY', color: Z.engine_bay,
      path: 'M 25,200 L 345,200 L 345,410 L 25,410 Z',
      yMin: 5, yMax: 28, xMin: 25, xMax: 75,
    },
    {
      id: 'firewall', label: 'FIREWALL', color: Z.firewall,
      path: 'M 345,135 L 370,135 L 370,410 L 345,410 Z',
      yMin: 29, yMax: 33, xMin: 30, xMax: 70,
    },
    {
      id: 'dash', label: 'DASH / CABIN', color: Z.dash,
      path: 'M 370,105 L 660,105 L 660,410 L 370,410 Z',
      yMin: 34, yMax: 55, xMin: 25, xMax: 75,
    },
    {
      id: 'doors', label: 'DOORS', color: Z.doors,
      path: 'M 380,140 L 620,115 L 620,370 L 380,370 Z',
      yMin: 42, yMax: 54, xMin: 10, xMax: 90,
    },
    {
      id: 'rear', label: 'REAR / CARGO', color: Z.rear,
      path: 'M 660,210 L 950,210 L 950,410 L 660,410 Z',
      yMin: 62, yMax: 90, xMin: 28, xMax: 72,
    },
    {
      id: 'underbody', label: 'UNDERBODY', color: Z.underbody,
      path: 'M 25,410 L 965,410 L 965,445 L 25,445 Z',
      yMin: 20, yMax: 85, xMin: 35, xMax: 65,
    },
    {
      id: 'roof', label: 'ROOF', color: Z.roof,
      path: 'M 440,103 L 580,103 L 580,115 L 440,115 Z',
      yMin: 36, yMax: 44, xMin: 35, xMax: 65,
    },
  ],
  imageLayers: [],
};

export const SILHOUETTES: Record<string, VehicleSilhouette> = {
  'top-down': TOP_DOWN,
  'side': SIDE_VIEW,
};
