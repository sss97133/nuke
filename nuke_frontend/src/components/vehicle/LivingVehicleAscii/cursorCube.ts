/**
 * Cursor-quality 3D rotating wireframe cube.
 * Isometric projection, high-res grid, integer Bresenham, 32 frames.
 */

const GRID_W = 56;
const GRID_H = 28;

const VERTICES: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function rotateY(x: number, y: number, z: number, theta: number): [number, number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [x * c - z * s, y, x * s + z * c];
}

function project(x: number, y: number, z: number): [number, number] {
  return [x - z, y + (x + z) * 0.5];
}

const SCALE = 8;
const CX = GRID_W / 2;
const CY = GRID_H / 2;

function toGrid(x: number, y: number): [number, number] {
  return [Math.round(CX + x * SCALE), Math.round(CY - y * SCALE)];
}

function drawLine(
  x0: number, y0: number, x1: number, y1: number,
  grid: string[][],
  ch: string
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + t * (x1 - x0));
    const y = Math.round(y0 + t * (y1 - y0));
    if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W)
      if (ch === '+' || grid[y][x] === ' ') grid[y][x] = ch;
  }
}

function edgeChar(dx: number, dy: number): string {
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return '+';
  if (Math.abs(dy) < Math.abs(dx) * 0.35) return '-';
  if (Math.abs(dx) < Math.abs(dy) * 0.35) return '|';
  return dx * dy >= 0 ? '\\' : '/';
}

function renderFrame(theta: number): string[] {
  const grid: string[][] = Array.from({ length: GRID_H }, () =>
    Array(GRID_W).fill(' ')
  );

  const pts = VERTICES.map(([x, y, z]) => {
    const [xr, yr, zr] = rotateY(x, y, z, theta);
    const [px, py] = project(xr, yr, zr);
    return toGrid(px, py);
  });

  for (const [i, j] of EDGES) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[j];
    drawLine(x0, y0, x1, y1, grid, edgeChar(x1 - x0, y1 - y0));
  }
  for (const [x, y] of pts) {
    if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) grid[y][x] = '+';
  }

  return grid.map((row) => row.join('').replace(/\s+$/, '')).filter((r) => r.length > 0);
}

const FRAME_COUNT = 32;
export const CURSOR_CUBE_FRAMES: string[][] = Array.from({ length: FRAME_COUNT }, (_, i) =>
  renderFrame((i / FRAME_COUNT) * Math.PI * 2)
);

export function getCursorCubeFrame(angleRad: number): string[] {
  return renderFrame(angleRad);
}
