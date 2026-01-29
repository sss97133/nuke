/**
 * 3D rotating wireframe tire (torus).
 * Same pipeline as cursorCube: isometric projection, Bresenham lines, 32 frames.
 */

const GRID_W = 56;
const GRID_H = 28;

const R = 1.2; // major radius (center of tube to center of tire)
const r = 0.5; // minor radius (tube thickness)
const N = 16;  // points per ring

function torusPoint(u: number, v: number): [number, number, number] {
  const x = (R + r * Math.cos(v)) * Math.cos(u);
  const y = (R + r * Math.cos(v)) * Math.sin(u);
  const z = r * Math.sin(v);
  return [x, y, z];
}

function rotateY(x: number, y: number, z: number, theta: number): [number, number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [x * c - z * s, y, x * s + z * c];
}

function project(x: number, y: number, z: number): [number, number] {
  return [x - z, y + (x + z) * 0.5];
}

const SCALE = 7;
const CX = GRID_W / 2;
const CY = GRID_H / 2;

function toGrid(x: number, y: number): [number, number] {
  return [Math.round(CX + x * SCALE), Math.round(CY - y * SCALE)];
}

function drawLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
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

  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const u = (i / N) * Math.PI * 2;
    const [x0, y0, z0] = rotateY(...torusPoint(u, 0), theta);
    const [x1, y1, z1] = rotateY(...torusPoint(u, Math.PI), theta);
    outer.push(toGrid(...project(x0, y0, z0)));
    inner.push(toGrid(...project(x1, y1, z1)));
  }

  for (let i = 0; i < N; i++) {
    const [x0, y0] = outer[i];
    const [x1, y1] = outer[(i + 1) % N];
    drawLine(x0, y0, x1, y1, grid, edgeChar(x1 - x0, y1 - y0));
  }
  for (let i = 0; i < N; i++) {
    const [x0, y0] = inner[i];
    const [x1, y1] = inner[(i + 1) % N];
    drawLine(x0, y0, x1, y1, grid, edgeChar(x1 - x0, y1 - y0));
  }
  for (let i = 0; i < N; i++) {
    const [x0, y0] = outer[i];
    const [x1, y1] = inner[i];
    drawLine(x0, y0, x1, y1, grid, edgeChar(x1 - x0, y1 - y0));
  }

  for (const [x, y] of [...outer, ...inner]) {
    if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) grid[y][x] = '+';
  }

  return grid.map((row) => row.join('').replace(/\s+$/, '')).filter((r) => r.length > 0);
}

const FRAME_COUNT = 32;
export const TIRE_FRAMES: string[][] = Array.from({ length: FRAME_COUNT }, (_, i) =>
  renderFrame((i / FRAME_COUNT) * Math.PI * 2)
);

export function getTireFrame(angleRad: number): string[] {
  return renderFrame(angleRad);
}
