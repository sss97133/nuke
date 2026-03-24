// labelPlacer.ts — Collision-free wire label placement for schematic diagrams
// Pure TypeScript, zero React dependencies. Deterministic output.

import type { PathSegment } from './orthogonalRouter';

export interface WireLabelRequest {
  wireNumber: number;
  segments: PathSegment[];
  gauge: number;
  color: string;
  deviceName: string;
}

export interface LabelPlacement {
  wireNumber: number;
  x: number;
  y: number;
  text: string;
  shortText: string;
  rotation: number;
  anchor: 'start' | 'middle' | 'end';
}

// ── Bounding box for collision detection ─────────────────────────────

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CHAR_WIDTH = 5;
const LABEL_HEIGHT = 8;
const BASE_OFFSET = 5;
const MAX_OFFSET_STEPS = 6;

function labelBBox(x: number, y: number, text: string, rotation: number): BBox {
  const w = text.length * CHAR_WIDTH;
  const h = LABEL_HEIGHT;
  if (rotation === 0) {
    // Horizontal label, anchored at middle
    return { x: x - w / 2, y: y - h, w, h };
  }
  // Vertical label (rotation -90), width and height swap
  return { x: x - h, y: y - w / 2, w: h, h: w };
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ── Segment length helper ────────────────────────────────────────────

function segmentLength(s: PathSegment): number {
  return Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
}

// ── Sort segments by length descending ───────────────────────────────

function sortedByLength(segments: PathSegment[], direction?: 'horizontal' | 'vertical'): PathSegment[] {
  const filtered = direction ? segments.filter((s) => s.direction === direction) : segments;
  return [...filtered].sort((a, b) => segmentLength(b) - segmentLength(a));
}

// ── Midpoint of a segment ────────────────────────────────────────────

function midpoint(s: PathSegment): { x: number; y: number } {
  return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
}

// ── Try placing a label, return placement if no collision ────────────

function tryPlace(
  wireNumber: number,
  seg: PathSegment,
  fullText: string,
  shortText: string,
  offsetMultiplier: number,
  placed: BBox[],
): LabelPlacement | null {
  const mid = midpoint(seg);
  const rotation = seg.direction === 'horizontal' ? 0 : -90;
  const offset = BASE_OFFSET * offsetMultiplier;

  let x: number;
  let y: number;

  if (seg.direction === 'horizontal') {
    x = mid.x;
    y = mid.y - offset;
  } else {
    x = mid.x - offset;
    y = mid.y;
  }

  const bbox = labelBBox(x, y, fullText, rotation);

  for (const existing of placed) {
    if (bboxOverlaps(bbox, existing)) return null;
  }

  return { wireNumber, x, y, text: fullText, shortText, rotation, anchor: 'middle' };
}

// ── Main: place all labels ───────────────────────────────────────────

export function placeLabels(requests: WireLabelRequest[]): LabelPlacement[] {
  const placements: LabelPlacement[] = [];
  const placedBoxes: BBox[] = [];

  for (const req of requests) {
    if (req.segments.length === 0) continue;

    const fullText = `W${req.wireNumber} ${req.gauge}ga ${req.color}`;
    const shortText = `W${req.wireNumber}`;

    let placed = false;

    // Try horizontal segments first (sorted longest to shortest)
    const hSegs = sortedByLength(req.segments, 'horizontal');
    for (const seg of hSegs) {
      if (placed) break;
      for (let step = 1; step <= MAX_OFFSET_STEPS; step++) {
        const result = tryPlace(req.wireNumber, seg, fullText, shortText, step, placedBoxes);
        if (result) {
          placements.push(result);
          placedBoxes.push(labelBBox(result.x, result.y, fullText, result.rotation));
          placed = true;
          break;
        }
      }
    }

    // Fall back to vertical segments
    if (!placed) {
      const vSegs = sortedByLength(req.segments, 'vertical');
      for (const seg of vSegs) {
        if (placed) break;
        for (let step = 1; step <= MAX_OFFSET_STEPS; step++) {
          const result = tryPlace(req.wireNumber, seg, fullText, shortText, step, placedBoxes);
          if (result) {
            placements.push(result);
            placedBoxes.push(labelBBox(result.x, result.y, fullText, result.rotation));
            placed = true;
            break;
          }
        }
      }
    }

    // Last resort: place on longest segment with maximum offset
    if (!placed) {
      const allSorted = sortedByLength(req.segments);
      if (allSorted.length > 0) {
        const seg = allSorted[0];
        const mid = midpoint(seg);
        const rotation = seg.direction === 'horizontal' ? 0 : -90;
        const offset = BASE_OFFSET * (MAX_OFFSET_STEPS + 1);
        const x = seg.direction === 'horizontal' ? mid.x : mid.x - offset;
        const y = seg.direction === 'horizontal' ? mid.y - offset : mid.y;

        const label: LabelPlacement = {
          wireNumber: req.wireNumber,
          x,
          y,
          text: fullText,
          shortText,
          rotation,
          anchor: 'middle',
        };
        placements.push(label);
        placedBoxes.push(labelBBox(x, y, fullText, rotation));
      }
    }
  }

  return placements;
}
