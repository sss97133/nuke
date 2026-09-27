// Squarified treemap layout (Bruls, Huizing, van Wijk 2000).
// Area is proportional to the value handed in; nothing is grouped or dropped.
// Shared by the explore treemap (HomePage) and the market map (MarketPulse).

export interface SquarifyItem<T> {
  node: T;
  area: number;
}

export interface SquarifyRect<T> {
  node: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Scaled<T> = SquarifyItem<T> & { scaledArea: number };

function worstAspectRatio(row: number[], w: number): number {
  // w = length of the shorter side of the remaining rectangle
  // row = array of areas
  const s = row.reduce((a, b) => a + b, 0);
  const rMax = Math.max(...row);
  const rMin = Math.min(...row);
  // worst = max(w^2 * rMax / s^2, s^2 / (w^2 * rMin))
  const w2 = w * w;
  const s2 = s * s;
  return Math.max((w2 * rMax) / s2, s2 / (w2 * rMin));
}

export function squarify<T>(
  items: SquarifyItem<T>[],
  x: number,
  y: number,
  w: number,
  h: number
): SquarifyRect<T>[] {
  if (items.length === 0) return [];
  if (w <= 0 || h <= 0) return [];

  // Sort descending by area
  const sorted = [...items].sort((a, b) => b.area - a.area);
  const totalArea = sorted.reduce((s, i) => s + i.area, 0);
  if (totalArea <= 0) return [];

  // Scale areas to fill the rectangle
  const scale = (w * h) / totalArea;
  const scaled = sorted.map(i => ({ ...i, scaledArea: i.area * scale }));

  const result: SquarifyRect<T>[] = [];
  layoutRow(scaled, x, y, w, h, result);
  return result;
}

function layoutRow<T>(
  items: Scaled<T>[],
  x: number,
  y: number,
  w: number,
  h: number,
  result: SquarifyRect<T>[]
): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ node: items[0].node, x, y, w, h });
    return;
  }

  // Determine the shorter side
  const shorter = Math.min(w, h);
  const horizontal = w >= h; // layout row along the shorter dimension

  let row: Scaled<T>[] = [items[0]];
  let remaining = items.slice(1);
  let currentWorst = worstAspectRatio(
    row.map(i => i.scaledArea),
    shorter
  );

  // Greedily add items to the row while aspect ratio improves
  for (let k = 0; k < remaining.length; k++) {
    const candidate = [...row, remaining[k]];
    const candidateWorst = worstAspectRatio(
      candidate.map(i => i.scaledArea),
      shorter
    );
    if (candidateWorst <= currentWorst) {
      row = candidate;
      currentWorst = candidateWorst;
    } else {
      break;
    }
  }

  remaining = items.slice(row.length);

  // Lay out the row
  const rowArea = row.reduce((s, i) => s + i.scaledArea, 0);

  if (horizontal) {
    // Row fills along the left side (fixed width = rowArea / h)
    const rowW = rowArea / h;
    let yOff = y;
    for (const item of row) {
      const itemH = item.scaledArea / rowW;
      result.push({ node: item.node, x, y: yOff, w: rowW, h: itemH });
      yOff += itemH;
    }
    // Recurse on the remaining rectangle
    layoutRow(remaining, x + rowW, y, w - rowW, h, result);
  } else {
    // Row fills along the top (fixed height = rowArea / w)
    const rowH = rowArea / w;
    let xOff = x;
    for (const item of row) {
      const itemW = item.scaledArea / rowH;
      result.push({ node: item.node, x: xOff, y, w: itemW, h: rowH });
      xOff += itemW;
    }
    // Recurse on the remaining rectangle
    layoutRow(remaining, x, y + rowH, w, h - rowH, result);
  }
}
