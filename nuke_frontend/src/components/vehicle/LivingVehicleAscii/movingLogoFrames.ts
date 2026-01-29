/**
 * Moving logos: 3D wireframe cube and tire (torus).
 * Kinds map to cube or tire; optional label below.
 */

import { CURSOR_CUBE_FRAMES } from './cursorCube';
import { TIRE_FRAMES } from './asciiTire';

export const CUBE_FRAMES: string[][] = CURSOR_CUBE_FRAMES;
export const TIRE_LOGO_FRAMES: string[][] = TIRE_FRAMES;

export type MovingLogoKind = 'cursor' | 'tire' | 'mustang' | 'corvette' | 'gm' | 'plymouth';

const FRAME_SETS: Record<MovingLogoKind, string[][]> = {
  cursor: CUBE_FRAMES,
  tire: TIRE_LOGO_FRAMES,
  mustang: CUBE_FRAMES,
  corvette: CUBE_FRAMES,
  gm: CUBE_FRAMES,
  plymouth: CUBE_FRAMES,
};

export function getMovingLogoFrames(kind: MovingLogoKind): string[][] {
  return FRAME_SETS[kind] ?? CUBE_FRAMES;
}

export function inferMovingLogoKind(make?: string | null): MovingLogoKind {
  const m = (make ?? '').toLowerCase();
  if (/chevrolet|chev|corvette/.test(m)) return 'corvette';
  if (/ford|mustang/.test(m)) return 'mustang';
  if (/gm|general\s*motors|buick|gmc|cadillac|hummer/.test(m)) return 'gm';
  if (/plymouth|chrysler/.test(m)) return 'plymouth';
  return 'cursor';
}
