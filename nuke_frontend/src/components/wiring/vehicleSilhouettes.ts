// vehicleSilhouettes.ts — Dimensionally accurate K5 Blazer SVG layers
//
// All coordinates derived from 1973-1987 GM K5 Blazer factory dimensions:
//   Wheelbase: 106.5"   Overall length: 184.8"   Width: 79.6"   Height: 73.7"
//   Front overhang: 31.5"   Rear overhang: 46.8"   Frame rail width: ~34"
//
// Coordinate system: 0-1000 for precision, mapped to percentage space by the canvas.
// Side view: X = front-to-rear (0=front bumper), Y = top-to-bottom (0=roof)
// Top-down:  X = left-to-right (0=driver side), Y = front-to-rear (0=front bumper)
//
// Source: GM Light Duty Truck Service Manual (1980), Section 0 — General Information

export interface VehicleLayer {
  id: string;
  label: string;
  shortLabel: string;     // For compact toggle buttons
  paths: LayerPath[];
  defaultVisible: boolean;
  defaultOpacity: number;
  color: string;
  zIndex: number;          // Render order (lower = behind)
}

export interface LayerPath {
  d: string;               // SVG path data
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
  // Zone bounds in percentage space for device placement
  yMin: number;
  yMax: number;
  xMin: number;
  xMax: number;
}

export interface VehicleSilhouette {
  id: string;
  label: string;
  viewBox: string;
  layers: VehicleLayer[];
  zones: SilhouetteZone[];
}

// ── Scale factor: 1" = 5.41 SVG units (1000 / 184.8" overall length) ──
// This means the side view SVG is 1000 units wide = 184.8" = 15.4 feet

// ── Zone Colors ────────────────────────────────────────────────────────
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
// SIDE VIEW — 1977 K5 Blazer, driver side
// ══════════════════════════════════════════════════════════════════════
// Key X positions (front-to-rear, scaled from real dims):
//   0    = front bumper
//   170  = grille/headlights  (31.5" overhang → 170 units)
//   576  = firewall           (106.5" wheelbase starts at ~37" from front)
//   746  = rear of cab        (~138" from front)
//   1000 = rear bumper

export const SIDE_VIEW: VehicleSilhouette = {
  id: 'side',
  label: 'SIDE VIEW — 1977 K5 BLAZER',
  viewBox: '0 0 1000 550',
  layers: [
    // ── Layer 0: Frame Rails ──
    {
      id: 'frame',
      label: 'Frame Rails',
      shortLabel: 'FRAME',
      defaultVisible: false,
      defaultOpacity: 0.3,
      color: Z.frame,
      zIndex: 0,
      paths: [
        // Main frame rail (side view = rectangle from bumper to bumper)
        { d: 'M 50,410 L 950,410 L 950,430 L 50,430 Z', fill: Z.frame, strokeWidth: 1.5 },
        // Front crossmember
        { d: 'M 80,405 L 80,435 L 100,435 L 100,405 Z', fill: Z.frame },
        // Engine crossmember
        { d: 'M 200,405 L 200,435 L 220,435 L 220,405 Z', fill: Z.frame },
        // Transmission crossmember
        { d: 'M 420,405 L 420,435 L 440,435 L 440,405 Z', fill: Z.frame },
        // Body mount crossmembers
        { d: 'M 580,405 L 580,435 L 600,435 L 600,405 Z', fill: Z.frame },
        { d: 'M 750,405 L 750,435 L 770,435 L 770,405 Z', fill: Z.frame },
        // Rear crossmember
        { d: 'M 900,405 L 900,435 L 920,435 L 920,405 Z', fill: Z.frame },
        // Front bumper bracket
        { d: 'M 30,400 L 60,400 L 60,440 L 30,440 Z', fill: '#666' },
        // Rear bumper bracket
        { d: 'M 940,400 L 970,400 L 970,440 L 940,440 Z', fill: '#666' },
      ],
    },
    // ── Layer 1: Body Shell ──
    {
      id: 'body',
      label: 'Body Shell',
      shortLabel: 'BODY',
      defaultVisible: true,
      defaultOpacity: 0.15,
      color: '#2a2a2a',
      zIndex: 1,
      paths: [
        // Main body profile — accurate K5 Blazer proportions
        {
          d: [
            // Front bumper
            'M 30,370',
            'L 30,340',          // Bumper face
            'L 50,340',          // Bumper top
            // Grille and hood
            'L 60,320',          // Valance
            'L 70,290',          // Grille top
            'L 170,285',        // Hood front edge (flat grille face → hood line)
            'L 340,270',        // Hood surface (slight slope back, long flat hood)
            // Windshield
            'L 365,160',        // Windshield base to top (steep angle, ~65°)
            // Roof / cab
            'L 430,120',        // A-pillar top
            'L 560,115',        // Roof line (flat, short cab)
            // Removable hardtop rear
            'L 610,120',        // B-pillar area
            'L 640,170',        // Rear window (angled back)
            // Rear quarter / bed area (K5 has short bed behind cab)
            'L 660,200',        // C-pillar base
            'L 900,200',        // Bed rail / quarter panel top (flat line to tailgate)
            // Tailgate
            'L 920,210',        // Tailgate top corner
            'L 950,360',        // Tailgate face
            // Rear bumper
            'L 970,360',
            'L 970,380',        // Bumper bottom
            'L 940,380',
            // Underside — wheel wells
            'L 940,370',
            // Rear wheel well
            'L 860,370',
            'L 850,340',        // Wheel well arch start
            'L 830,320',        // Wheel well top
            'L 800,310',        // Wheel well crown
            'L 770,320',
            'L 750,340',
            'L 740,370',        // Wheel well arch end
            // Rocker panel between wheels
            'L 310,370',
            // Front wheel well
            'L 300,370',
            'L 290,340',
            'L 270,320',
            'L 240,310',        // Front wheel well crown
            'L 210,320',
            'L 190,340',
            'L 180,370',
            // Back to front bumper
            'L 60,370',
            'L 30,370',
            'Z',
          ].join(' '),
          fill: '#2a2a2a',
          strokeWidth: 2,
        },
        // Front wheel (circle)
        { d: 'M 290,340 A 50,50 0 1,1 290,341 Z', fill: '#555', label: 'Front axle' },
        // Rear wheel
        { d: 'M 850,340 A 50,50 0 1,1 850,341 Z', fill: '#555', label: 'Rear axle' },
      ],
    },
    // ── Layer 2: Engine Block (LS3) ──
    {
      id: 'engine',
      label: 'Engine / Drivetrain',
      shortLabel: 'ENGINE',
      defaultVisible: false,
      defaultOpacity: 0.25,
      color: '#994400',
      zIndex: 2,
      paths: [
        // LS3 block (roughly 28" long x 24" tall in side view)
        { d: 'M 130,280 L 280,280 L 280,390 L 130,390 Z', fill: '#994400', label: 'LS3 block' },
        // Intake manifold
        { d: 'M 145,260 L 265,260 L 265,280 L 145,280 Z', fill: '#885533' },
        // Transmission (4L80E, ~24" long)
        { d: 'M 285,295 L 415,310 L 415,395 L 285,390 Z', fill: '#776655', label: 'Trans' },
        // Transfer case (NP241, ~12" long)
        { d: 'M 420,320 L 480,325 L 480,395 L 420,395 Z', fill: '#776655', label: 'T-case' },
        // Front driveshaft
        { d: 'M 240,395 L 240,400 L 420,400 L 420,395 Z', fill: '#666' },
        // Rear driveshaft
        { d: 'M 485,395 L 485,400 L 800,400 L 800,395 Z', fill: '#666' },
      ],
    },
    // ── Layer 3: Interior ──
    {
      id: 'interior',
      label: 'Interior / Dash',
      shortLabel: 'INT',
      defaultVisible: false,
      defaultOpacity: 0.2,
      color: Z.dash,
      zIndex: 3,
      paths: [
        // Dashboard
        { d: 'M 345,165 L 380,165 L 380,290 L 345,290 Z', fill: Z.dash, label: 'Dash' },
        // Steering column
        { d: 'M 370,200 L 400,240 L 395,245 L 365,205 Z', fill: '#555' },
        // Front seat
        { d: 'M 400,200 L 500,200 L 510,350 L 390,350 Z', fill: '#445566' },
        // Rear seat area (K5 has a rear bench)
        { d: 'M 520,200 L 600,200 L 610,350 L 510,350 Z', fill: '#445566' },
      ],
    },
  ],
  zones: [
    {
      id: 'engine_bay', label: 'ENGINE BAY', color: Z.engine_bay,
      path: 'M 30,200 L 340,200 L 340,400 L 30,400 Z',
      yMin: 5, yMax: 28, xMin: 25, xMax: 75,
    },
    {
      id: 'firewall', label: 'FIREWALL', color: Z.firewall,
      path: 'M 340,160 L 365,160 L 365,400 L 340,400 Z',
      yMin: 29, yMax: 33, xMin: 30, xMax: 70,
    },
    {
      id: 'dash', label: 'DASH / CABIN', color: Z.dash,
      path: 'M 365,115 L 650,115 L 660,400 L 365,400 Z',
      yMin: 34, yMax: 55, xMin: 25, xMax: 75,
    },
    {
      id: 'doors', label: 'DOORS', color: Z.doors,
      path: 'M 380,200 L 640,200 L 650,370 L 380,370 Z',
      yMin: 42, yMax: 54, xMin: 10, xMax: 90,
    },
    {
      id: 'rear', label: 'REAR / CARGO', color: Z.rear,
      path: 'M 660,200 L 950,200 L 950,400 L 660,400 Z',
      yMin: 62, yMax: 90, xMin: 28, xMax: 72,
    },
    {
      id: 'underbody', label: 'UNDERBODY', color: Z.underbody,
      path: 'M 30,400 L 950,400 L 950,440 L 30,440 Z',
      yMin: 20, yMax: 85, xMin: 35, xMax: 65,
    },
    {
      id: 'roof', label: 'ROOF', color: Z.roof,
      path: 'M 430,110 L 610,110 L 610,125 L 430,125 Z',
      yMin: 36, yMax: 44, xMin: 35, xMax: 65,
    },
  ],
};

// ══════════════════════════════════════════════════════════════════════
// TOP-DOWN VIEW — 1977 K5 Blazer
// ══════════════════════════════════════════════════════════════════════
// Y = front-to-rear (0 = front bumper)
// X = driver(left) to passenger(right), centered at 500
// Width: 79.6" → full span. Wheelbase starts at Y=170, rear axle at Y=746

export const TOP_DOWN: VehicleSilhouette = {
  id: 'top-down',
  label: 'TOP DOWN — 1977 K5 BLAZER',
  viewBox: '0 0 1000 1000',
  layers: [
    // ── Frame ──
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
        { d: 'M 350,40 L 370,40 L 370,960 L 350,960 Z', fill: Z.frame },
        // Right rail
        { d: 'M 630,40 L 650,40 L 650,960 L 630,960 Z', fill: Z.frame },
        // Crossmembers
        { d: 'M 350,80 L 650,80 L 650,95 L 350,95 Z', fill: Z.frame },
        { d: 'M 350,250 L 650,250 L 650,265 L 350,265 Z', fill: Z.frame },
        { d: 'M 350,450 L 650,450 L 650,465 L 350,465 Z', fill: Z.frame },
        { d: 'M 350,650 L 650,650 L 650,665 L 350,665 Z', fill: Z.frame },
        { d: 'M 350,850 L 650,850 L 650,865 L 350,865 Z', fill: Z.frame },
        { d: 'M 350,930 L 650,930 L 650,945 L 350,945 Z', fill: Z.frame },
      ],
    },
    // ── Body ──
    {
      id: 'body',
      label: 'Body Shell',
      shortLabel: 'BODY',
      defaultVisible: true,
      defaultOpacity: 0.12,
      color: '#2a2a2a',
      zIndex: 1,
      paths: [
        {
          d: [
            // Front bumper
            'M 200,30',
            'L 800,30',
            // Right fender
            'L 830,60',         // Bumper wrap
            'L 840,120',        // Fender corner
            'L 840,350',        // Fender to door
            // Right step
            'L 860,350',
            'L 860,560',        // Step rail
            'L 840,560',
            // Right rear quarter
            'L 840,900',
            // Rear
            'L 820,950',
            'L 180,950',
            // Left rear quarter
            'L 160,900',
            'L 160,560',
            // Left step
            'L 140,560',
            'L 140,350',
            'L 160,350',
            // Left fender
            'L 160,120',
            'L 170,60',
            'L 200,30',
            'Z',
          ].join(' '),
          fill: '#2a2a2a',
          strokeWidth: 2,
        },
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
        // LS3 block top-down (roughly centered, V8 shape)
        { d: 'M 370,100 L 630,100 L 630,310 L 370,310 Z', fill: '#994400', label: 'LS3' },
        // Transmission
        { d: 'M 420,315 L 580,315 L 570,460 L 430,460 Z', fill: '#776655' },
        // Transfer case
        { d: 'M 440,465 L 560,465 L 555,530 L 445,530 Z', fill: '#776655' },
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
        // Dashboard line
        { d: 'M 180,360 L 820,360 L 820,390 L 180,390 Z', fill: Z.dash },
        // Front seats
        { d: 'M 220,420 L 450,420 L 450,550 L 220,550 Z', fill: '#445566' },
        { d: 'M 550,420 L 780,420 L 780,550 L 550,550 Z', fill: '#445566' },
        // Rear bench
        { d: 'M 220,570 L 780,570 L 780,650 L 220,650 Z', fill: '#445566' },
      ],
    },
  ],
  zones: [
    {
      id: 'engine_bay', label: 'ENGINE BAY', color: Z.engine_bay,
      path: 'M 160,30 L 840,30 L 840,330 L 160,330 Z',
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
      path: 'M 140,350 L 160,350 L 160,560 L 140,560 Z M 840,350 L 860,350 L 860,560 L 840,560 Z',
      yMin: 42, yMax: 54, xMin: 10, xMax: 90,
    },
    {
      id: 'rear', label: 'REAR / CARGO', color: Z.rear,
      path: 'M 160,660 L 840,660 L 840,950 L 160,950 Z',
      yMin: 62, yMax: 90, xMin: 28, xMax: 72,
    },
    {
      id: 'underbody', label: 'UNDERBODY', color: Z.underbody,
      path: 'M 350,40 L 650,40 L 650,960 L 350,960 Z',
      yMin: 20, yMax: 85, xMin: 35, xMax: 65,
    },
    {
      id: 'roof', label: 'ROOF', color: Z.roof,
      path: 'M 200,380 L 800,380 L 800,560 L 200,560 Z',
      yMin: 36, yMax: 44, xMin: 35, xMax: 65,
    },
  ],
};

export const SILHOUETTES: Record<string, VehicleSilhouette> = {
  'top-down': TOP_DOWN,
  'side': SIDE_VIEW,
};
