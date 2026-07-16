// deviceLabelPlacer.ts — Collision-free device label placement for formboard
// Pure TypeScript, zero React dependencies. Memoize output in useMemo.
//
// Algorithm: greedy priority placement with 8-direction probing.
// Each device connector is an immovable obstacle. Labels are placed at the
// first non-overlapping candidate from 8 directions × 3 distance multipliers.
// Selected/hovered devices get priority placement.

// ── Types ────────────────────────────────────────────────────────────

export interface DeviceLabelInput {
  id: string;
  name: string;
  /** Connector bounding box in board inches (center x/y + half-widths) */
  cx: number;
  cy: number;
  hw: number; // half-width
  hh: number; // half-height
  pinCount: number;
  zone: string;
  selected: boolean;
  hovered: boolean;
}

export interface DeviceLabelPlacement {
  id: string;
  /** Label pill position in board inches (top-left corner) */
  x: number;
  y: number;
  text: string;
  /** Pill dimensions in board inches */
  pillW: number;
  pillH: number;
  /** How far the label was pushed from its connector (1 = touching, 2/3 = further) */
  offsetMult: number;
  /** Leader line endpoint: connector center in board inches */
  anchorX: number;
  anchorY: number;
}

// ── Internals ────────────────────────────────────────────────────────

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ── Text computation (extracted from FormboardCanvas) ────────────────

/** Compute label text — same abbreviation logic as the original renderer. */
export function computeLabelText(name: string, useAbbrev: boolean, maxChars: number): string {
  if (useAbbrev) {
    const clean = name
      .replace(/^(Fuel |Ignition |Electric |LED |Electronic |Power |Radiator |Parking |Side Marker |Cab Clearance |Turn Signal |Backup |Door Puddle )/, '')
      .replace(/\s*(Left|Right|Front|Rear|Center|High|Low)\s*/gi, '')
      .replace(/\s*\(.*\)\s*/, '');
    const words = clean.split(/[\s/]+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0] + (words[2]?.[0] || words[1][1] || '')).toUpperCase();
    } else if (words[0] && words[0].length > 0) {
      return words[0].slice(0, 3).toUpperCase();
    }
    return name.slice(0, 3).toUpperCase();
  }
  // Full name with generous truncation
  return name.length > maxChars ? name.slice(0, maxChars - 1) + '\u2026' : name;
}

// ── Cached text measurement ─────────────────────────────────────────

let measureCtx: OffscreenCanvas | null = null;

function getTextWidth(text: string, font: string): number {
  if (!measureCtx) {
    if (typeof OffscreenCanvas !== 'undefined') {
      measureCtx = new OffscreenCanvas(1, 1);
    } else {
      // Fallback: estimate from char count
      const fontSize = parseFloat(font) || 10;
      return text.length * fontSize * 0.6;
    }
  }
  const ctx = measureCtx.getContext('2d');
  if (!ctx) {
    const fontSize = parseFloat(font) || 10;
    return text.length * fontSize * 0.6;
  }
  ctx.font = font;
  return ctx.measureText(text).width;
}

// ── 8-direction candidate generation ────────────────────────────────

// Preferred first (diagonal — near connector corner), then cardinal
const DIRECTIONS: { dx: number; dy: number }[] = [
  { dx: 1, dy: 1 },   // below-right
  { dx: -1, dy: 1 },  // below-left
  { dx: 1, dy: -1 },  // above-right
  { dx: -1, dy: -1 }, // above-left
  { dx: 1, dy: 0 },   // right-center
  { dx: -1, dy: 0 },  // left-center
  { dx: 0, dy: 1 },   // below-center
  { dx: 0, dy: -1 },  // above-center
];

// 1.5" max wasn't enough in dense clusters (dash row, fuse block) — labels
// hit the overlap-anyway fallback. Extending to 6× gives the placer 48 candidate
// positions per label (8 directions × 6 distances) and should prevent fallback
// overlap until the cluster is genuinely impossible. The deeper fix is leader
// lines (allow labels to float far with a thin connecting line) — see
// HYPOTHESIS notes in DONE.md.
const DISTANCE_MULTS = [1, 2, 3, 4, 5, 6];

interface Candidate {
  x: number;
  y: number;
  mult: number;
}

function generateCandidates(
  cx: number, cy: number,
  hw: number, hh: number,
  pillW: number, pillH: number,
  baseGap: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const mult of DISTANCE_MULTS) {
    const gap = baseGap * mult;
    for (const dir of DIRECTIONS) {
      let x: number;
      let y: number;

      if (dir.dx > 0) {
        x = cx + hw + gap; // right of connector
      } else if (dir.dx < 0) {
        x = cx - hw - gap - pillW; // left of connector
      } else {
        x = cx - pillW / 2; // centered horizontally
      }

      if (dir.dy > 0) {
        y = cy + hh + gap; // below connector
      } else if (dir.dy < 0) {
        y = cy - hh - gap - pillH; // above connector
      } else {
        y = cy - pillH / 2; // centered vertically
      }

      candidates.push({ x, y, mult });
    }
  }
  return candidates;
}

// ── Main placement function ─────────────────────────────────────────

/**
 * Place device labels without overlap.
 *
 * @param inputs  - device positions + metadata in board inches
 * @param fontSize - label font size in board inches (pre-divided by zoom)
 * @param zoom    - current zoom level (pixels per inch)
 * @param useAbbrev - true if zoom < 4 (use 3-char abbreviations)
 * @returns Map from device id to placement
 */
export function placeDeviceLabels(
  inputs: DeviceLabelInput[],
  fontSize: number,
  zoom: number,
  useAbbrev: boolean,
): Map<string, DeviceLabelPlacement> {
  const result = new Map<string, DeviceLabelPlacement>();
  if (inputs.length === 0) return result;

  // Sort by priority: selected/hovered first, then pin count desc, then alpha
  const sorted = [...inputs].sort((a, b) => {
    const aPri = (a.selected ? 2 : 0) + (a.hovered ? 1 : 0);
    const bPri = (b.selected ? 2 : 0) + (b.hovered ? 1 : 0);
    if (aPri !== bPri) return bPri - aPri;
    if (a.pinCount !== b.pinCount) return b.pinCount - a.pinCount;
    return a.name.localeCompare(b.name);
  });

  // Occupancy set: connector bboxes are immovable
  const occupied: BBox[] = [];
  for (const inp of inputs) {
    occupied.push({
      x: inp.cx - inp.hw,
      y: inp.cy - inp.hh,
      w: inp.hw * 2,
      h: inp.hh * 2,
    });
  }

  // Font string for measurement (in board-inch scale, converted to pixels for measurement)
  const maxChars = useAbbrev ? 5 : Math.max(16, Math.floor(zoom * 4)); // 5 to accommodate "PRR₁" suffix
  const fontPx = fontSize * zoom; // actual pixel size for measurement
  const font = `bold ${fontPx}px Arial`;

  // Pill padding in board inches
  const padX = 2 / zoom; // ~2px padding each side
  const stripeW = 2 / zoom; // zone color stripe width
  const padY = 1.5 / zoom;
  const baseGap = 0.5; // 0.5" base gap from connector edge

  // Disambiguate duplicate abbreviations — when three devices all abbreviate
  // to "PRR" (Parking Right Rear × 3), suffix with subscript digits so the
  // plotter print can tell them apart. Uses unicode subscripts ₁ ₂ ₃ … so the
  // pill stays narrow. Order is stable (input order → left-to-right on board).
  const rawTexts = new Map<string, string>();
  const codeCounts = new Map<string, number>();
  for (const inp of inputs) {
    const t = computeLabelText(inp.name, useAbbrev, maxChars);
    rawTexts.set(inp.id, t);
    codeCounts.set(t, (codeCounts.get(t) || 0) + 1);
  }
  const SUBSCRIPT = ['', '\u2081', '\u2082', '\u2083', '\u2084', '\u2085', '\u2086', '\u2087', '\u2088', '\u2089'];
  const codeSeen = new Map<string, number>();
  const disambiguated = new Map<string, string>();
  for (const inp of inputs) {
    const raw = rawTexts.get(inp.id)!;
    if ((codeCounts.get(raw) || 0) > 1) {
      const n = (codeSeen.get(raw) || 0) + 1;
      codeSeen.set(raw, n);
      disambiguated.set(inp.id, raw + (SUBSCRIPT[n] || `_${n}`));
    } else {
      disambiguated.set(inp.id, raw);
    }
  }

  for (const inp of sorted) {
    const text = disambiguated.get(inp.id) || computeLabelText(inp.name, useAbbrev, maxChars);

    // Measure text width in pixels, convert to board inches
    const textPxW = getTextWidth(text, font);
    const textInchW = textPxW / zoom;
    const pillW = textInchW + padX * 2 + stripeW;
    const pillH = fontSize + padY * 2;

    const candidates = generateCandidates(
      inp.cx, inp.cy,
      inp.hw, inp.hh,
      pillW, pillH,
      baseGap,
    );

    let placed = false;
    for (const cand of candidates) {
      const bbox: BBox = { x: cand.x, y: cand.y, w: pillW, h: pillH };

      // Check against all occupied boxes
      let overlaps = false;
      for (const occ of occupied) {
        if (bboxOverlaps(bbox, occ)) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        occupied.push(bbox);
        result.set(inp.id, {
          id: inp.id,
          x: cand.x,
          y: cand.y,
          text,
          pillW,
          pillH,
          offsetMult: cand.mult,
          anchorX: inp.cx,
          anchorY: inp.cy,
        });
        placed = true;
        break;
      }
    }

    // Fallback: first candidate (overlap is better than invisible)
    if (!placed && candidates.length > 0) {
      const cand = candidates[0];
      const bbox: BBox = { x: cand.x, y: cand.y, w: pillW, h: pillH };
      occupied.push(bbox);
      result.set(inp.id, {
        id: inp.id,
        x: cand.x,
        y: cand.y,
        text,
        pillW,
        pillH,
        offsetMult: cand.mult,
        anchorX: inp.cx,
        anchorY: inp.cy,
      });
    }
  }

  return result;
}
