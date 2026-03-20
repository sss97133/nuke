/**
 * VehicleSilhouetteMap -- Interactive top-down vehicle silhouette with clickable zone regions.
 *
 * Each zone lights up based on photo coverage. Clicking a zone emits the zone name
 * so the parent can scroll the gallery to the corresponding ImageZoneSection.
 *
 * Engineering-diagram aesthetic: thin strokes, monospace labels, flat data viz on dark bg.
 */
import React, { useState, useMemo } from 'react';
import { ZONE_LABELS } from '../../constants/vehicleZones';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VehicleSilhouetteMapProps {
  /** zone_name -> image count */
  zoneCounts: Record<string, number>;
  /** Fired when user clicks a zone region */
  onZoneClick?: (zone: string) => void;
  /** Currently-selected zone (highlighted with border) */
  activeZone?: string | null;
  /** SVG viewport width -- height auto-scales (default 400) */
  width?: number;
}

// ---------------------------------------------------------------------------
// Zone geometry definitions (top-down plan view, nose at top)
//
// Coordinate system: 0,0 top-left. Vehicle body ~400w x ~800h.
// Margins: 10px all around. Usable area: 10..390 x 10..790
// ---------------------------------------------------------------------------

interface ZoneRegion {
  /** One or more vehicle_zone keys this region represents */
  zones: string[];
  /** SVG path `d` attribute */
  path: string;
  /** Center point for the count badge / label */
  cx: number;
  cy: number;
  /** Short label shown on hover / as tooltip */
  label: string;
}

// Helper: build a simple rect path
const rect = (x: number, y: number, w: number, h: number): string =>
  `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;

// Helper: build a rounded rect path (rx/ry corner radius)
const rrect = (x: number, y: number, w: number, h: number, r: number): string => {
  const cr = Math.min(r, w / 2, h / 2);
  return [
    `M${x + cr},${y}`,
    `L${x + w - cr},${y}`,
    `Q${x + w},${y} ${x + w},${y + cr}`,
    `L${x + w},${y + h - cr}`,
    `Q${x + w},${y + h} ${x + w - cr},${y + h}`,
    `L${x + cr},${y + h}`,
    `Q${x},${y + h} ${x},${y + h - cr}`,
    `L${x},${y + cr}`,
    `Q${x},${y} ${x + cr},${y}`,
    'Z',
  ].join(' ');
};

// Helper: circle path
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`;

/**
 * Layout constants.
 * The vehicle body spans roughly x:60..340, y:40..760.
 * Left = driver side, Right = passenger side (US convention, top-down).
 */
const ZONE_REGIONS: ZoneRegion[] = [
  // -- FRONT bumper area --
  {
    zones: ['ext_front'],
    path: rrect(80, 30, 240, 50, 20),
    cx: 200, cy: 55,
    label: 'Front',
  },

  // -- Front fenders + hood row --
  {
    zones: ['panel_fender_fl'],
    path: rect(60, 85, 60, 70),
    cx: 90, cy: 120,
    label: 'Fender FL',
  },
  {
    zones: ['panel_hood'],
    path: rect(125, 85, 150, 70),
    cx: 200, cy: 120,
    label: 'Hood',
  },
  {
    zones: ['panel_fender_fr'],
    path: rect(280, 85, 60, 70),
    cx: 310, cy: 120,
    label: 'Fender FR',
  },

  // -- Front wheels --
  {
    zones: ['wheel_fl'],
    path: circle(45, 190, 22),
    cx: 45, cy: 190,
    label: 'Wheel FL',
  },
  {
    zones: ['wheel_fr'],
    path: circle(355, 190, 22),
    cx: 355, cy: 190,
    label: 'Wheel FR',
  },

  // -- Front 3/4 views (corner zones mapped to fender/bumper intersection areas) --
  {
    zones: ['ext_front_driver'],
    path: rect(60, 160, 60, 50),
    cx: 90, cy: 185,
    label: 'Front 3/4 Driver',
  },
  {
    zones: ['ext_front_passenger'],
    path: rect(280, 160, 60, 50),
    cx: 310, cy: 185,
    label: 'Front 3/4 Pass',
  },

  // -- Engine bay --
  {
    zones: ['mech_engine_bay'],
    path: rect(125, 160, 150, 50),
    cx: 200, cy: 185,
    label: 'Engine Bay',
  },

  // -- Front doors --
  {
    zones: ['panel_door_fl'],
    path: rect(60, 215, 60, 100),
    cx: 90, cy: 265,
    label: 'Door FL',
  },
  {
    zones: ['panel_door_fr'],
    path: rect(280, 215, 60, 100),
    cx: 310, cy: 265,
    label: 'Door FR',
  },

  // -- Driver / Passenger side (full-profile view zones) --
  {
    zones: ['ext_driver_side'],
    path: rect(20, 215, 36, 280),
    cx: 38, cy: 355,
    label: 'Driver Side',
  },
  {
    zones: ['ext_passenger_side'],
    path: rect(344, 215, 36, 280),
    cx: 362, cy: 355,
    label: 'Pass Side',
  },

  // -- Interior cluster (center cabin) --
  {
    zones: ['int_dashboard', 'int_front_seats', 'int_rear_seats', 'int_cargo', 'int_headliner',
            'int_door_panel_fl', 'int_door_panel_fr', 'int_door_panel_rl', 'int_door_panel_rr'],
    path: rect(125, 215, 150, 280),
    cx: 200, cy: 355,
    label: 'Interior',
  },

  // -- Rear doors --
  {
    zones: ['panel_door_rl'],
    path: rect(60, 320, 60, 100),
    cx: 90, cy: 370,
    label: 'Door RL',
  },
  {
    zones: ['panel_door_rr'],
    path: rect(280, 320, 60, 100),
    cx: 310, cy: 370,
    label: 'Door RR',
  },

  // -- Rear 3/4 views --
  {
    zones: ['ext_rear_driver'],
    path: rect(60, 425, 60, 50),
    cx: 90, cy: 450,
    label: 'Rear 3/4 Driver',
  },
  {
    zones: ['ext_rear_passenger'],
    path: rect(280, 425, 60, 50),
    cx: 310, cy: 450,
    label: 'Rear 3/4 Pass',
  },

  // -- Mechanical underside --
  {
    zones: ['mech_transmission', 'mech_suspension'],
    path: rect(125, 500, 150, 50),
    cx: 200, cy: 525,
    label: 'Drivetrain',
  },

  // -- Rear wheels --
  {
    zones: ['wheel_rl'],
    path: circle(45, 460, 22),
    cx: 45, cy: 460,
    label: 'Wheel RL',
  },
  {
    zones: ['wheel_rr'],
    path: circle(355, 460, 22),
    cx: 355, cy: 460,
    label: 'Wheel RR',
  },

  // -- Rear fenders + trunk row --
  {
    zones: ['panel_fender_rl'],
    path: rect(60, 480, 60, 70),
    cx: 90, cy: 515,
    label: 'Fender RL',
  },
  {
    zones: ['panel_trunk'],
    path: rect(125, 555, 150, 70),
    cx: 200, cy: 590,
    label: 'Trunk',
  },
  {
    zones: ['panel_fender_rr'],
    path: rect(280, 480, 60, 70),
    cx: 310, cy: 515,
    label: 'Fender RR',
  },

  // -- Rear bumper --
  {
    zones: ['ext_rear'],
    path: rrect(80, 630, 240, 50, 20),
    cx: 200, cy: 655,
    label: 'Rear',
  },

  // -- Roof (overlaid semi-transparent, centered) --
  {
    zones: ['ext_roof'],
    path: rrect(140, 230, 120, 240, 12),
    cx: 200, cy: 350,
    label: 'Roof',
  },

  // -- Undercarriage (shown below vehicle as dashed outline) --
  {
    zones: ['ext_undercarriage'],
    path: rrect(70, 700, 260, 50, 8),
    cx: 200, cy: 725,
    label: 'Undercarriage',
  },

  // -- Detail zones (small row at very bottom) --
  {
    zones: ['detail_vin'],
    path: rect(70, 760, 60, 30),
    cx: 100, cy: 775,
    label: 'VIN',
  },
  {
    zones: ['detail_badge'],
    path: rect(135, 760, 60, 30),
    cx: 165, cy: 775,
    label: 'Badge',
  },
  {
    zones: ['detail_damage'],
    path: rect(200, 760, 60, 30),
    cx: 230, cy: 775,
    label: 'Damage',
  },
  {
    zones: ['detail_odometer'],
    path: rect(265, 760, 65, 30),
    cx: 297, cy: 775,
    label: 'Odometer',
  },
];

// ---------------------------------------------------------------------------
// Fill color based on image count
// ---------------------------------------------------------------------------

function zoneFill(count: number, isHovered: boolean, isActive: boolean): string {
  if (isActive) return 'rgba(59,130,246,0.8)';
  if (isHovered) return 'rgba(59,130,246,0.6)';
  if (count === 0) return 'rgba(255,255,255,0.05)';
  // Scale blue intensity with count: 1 image = 0.2, 10+ = 0.5
  const intensity = Math.min(0.5, 0.15 + count * 0.035);
  return `rgba(59,130,246,${intensity.toFixed(2)})`;
}

function zoneStroke(isActive: boolean, isDashed: boolean): string {
  if (isActive) return 'var(--surface-elevated)';
  return isDashed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.2)';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const VehicleSilhouetteMap: React.FC<VehicleSilhouetteMapProps> = ({
  zoneCounts,
  onZoneClick,
  activeZone = null,
  width = 400,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Compute total count for each region (sum across all zones in the region)
  const regionCounts = useMemo(() => {
    return ZONE_REGIONS.map((region) => {
      let total = 0;
      for (const z of region.zones) {
        total += zoneCounts[z] || 0;
      }
      return total;
    });
  }, [zoneCounts]);

  // Check if a region contains the active zone
  const isRegionActive = (region: ZoneRegion): boolean => {
    if (!activeZone) return false;
    return region.zones.includes(activeZone);
  };

  // Vehicle body outline (the outermost shape, purely decorative)
  const bodyOutline = rrect(55, 25, 290, 665, 30);

  const viewBoxHeight = 800;
  const scale = width / 400;
  const height = viewBoxHeight * scale;

  // Tooltip for hovered region
  const hoveredRegion = hoveredIdx !== null ? ZONE_REGIONS[hoveredIdx] : null;
  const hoveredCount = hoveredIdx !== null ? regionCounts[hoveredIdx] : 0;

  return (
    <div
      style={{
        position: 'relative',
        width: width,
        maxWidth: '100%',
        margin: '0 auto',
      }}
    >
      <svg
        viewBox={`0 0 400 ${viewBoxHeight}`}
        width={width}
        height={height}
        style={{
          display: 'block',
          backgroundColor: '#111',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Vehicle body outline */}
        <path
          d={bodyOutline}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.5"
        />

        {/* Zone regions */}
        {ZONE_REGIONS.map((region, idx) => {
          const count = regionCounts[idx];
          const isHovered = hoveredIdx === idx;
          const isActive = isRegionActive(region);
          const isUndercarriage = region.zones.includes('ext_undercarriage');
          const isRoof = region.zones.includes('ext_roof');

          return (
            <g
              key={region.zones.join(',')}
              style={{ cursor: onZoneClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => {
                if (onZoneClick) {
                  // Emit the first zone in the region
                  onZoneClick(region.zones[0]);
                }
              }}
            >
              <path
                d={region.path}
                fill={zoneFill(count, isHovered, isActive)}
                stroke={zoneStroke(isActive, isUndercarriage)}
                strokeWidth={isActive ? 2 : 1}
                strokeDasharray={isUndercarriage ? '4,3' : undefined}
                opacity={isRoof ? 0.6 : 1}
              />
              {/* Count badge */}
              {count > 0 && (
                <text
                  x={region.cx}
                  y={region.cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={count > 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)'}
                  fontSize="11"
                  fontFamily="'Courier New', monospace"
                  fontWeight="600"
                  style={{ pointerEvents: 'none' }}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}

        {/* Centerline (decorative) */}
        <line
          x1="200" y1="30" x2="200" y2="685"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="0.5"
          strokeDasharray="8,6"
        />

        {/* Axle lines (decorative) */}
        <line
          x1="25" y1="190" x2="375" y2="190"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="0.5"
          strokeDasharray="4,4"
        />
        <line
          x1="25" y1="460" x2="375" y2="460"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="0.5"
          strokeDasharray="4,4"
        />

        {/* "FRONT" / "REAR" labels */}
        <text
          x="200" y="18"
          textAnchor="middle"
          fill="rgba(255,255,255,0.3)"
          fontSize="9"
          fontFamily="'Courier New', monospace"
          letterSpacing="2"
        >
          FRONT
        </text>
        <text
          x="200" y="698"
          textAnchor="middle"
          fill="rgba(255,255,255,0.3)"
          fontSize="9"
          fontFamily="'Courier New', monospace"
          letterSpacing="2"
        >
          REAR
        </text>

        {/* Side labels */}
        <text
          x="10" y="355"
          textAnchor="middle"
          fill="rgba(255,255,255,0.2)"
          fontSize="8"
          fontFamily="'Courier New', monospace"
          letterSpacing="1"
          transform="rotate(-90, 10, 355)"
        >
          DRIVER
        </text>
        <text
          x="390" y="355"
          textAnchor="middle"
          fill="rgba(255,255,255,0.2)"
          fontSize="8"
          fontFamily="'Courier New', monospace"
          letterSpacing="1"
          transform="rotate(90, 390, 355)"
        >
          PASSENGER
        </text>
      </svg>

      {/* Tooltip */}
      {hoveredRegion && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            backgroundColor: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.2)',
            padding: '4px 8px',
            fontSize: '10px',
            fontFamily: "'Courier New', monospace",
            color: 'var(--surface-elevated)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          <span style={{ fontWeight: 600 }}>{hoveredRegion.label}</span>
          <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 6 }}>
            {hoveredCount} {hoveredCount === 1 ? 'image' : 'images'}
          </span>
          {hoveredRegion.zones.length > 1 && (
            <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              {hoveredRegion.zones.map((z) => {
                const c = zoneCounts[z] || 0;
                return c > 0 ? `${ZONE_LABELS[z] || z}: ${c}` : null;
              }).filter(Boolean).join(' / ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VehicleSilhouetteMap;

// ---------------------------------------------------------------------------
// Utility: compute zone counts from image array
// ---------------------------------------------------------------------------

/**
 * Tallies vehicle_zone occurrences across an image array.
 * Images with null/empty zone are counted under 'other'.
 */
export function computeZoneCounts(
  images: Array<{ vehicle_zone?: string | null }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const img of images) {
    const zone = img.vehicle_zone?.trim().toLowerCase() || 'other';
    counts[zone] = (counts[zone] || 0) + 1;
  }
  return counts;
}
