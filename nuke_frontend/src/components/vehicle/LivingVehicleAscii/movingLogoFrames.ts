/**
 * Moving logos: Cursor-quality 3D cube only.
 * All kinds use the same wireframe cube; optional label below (no 2D drawings).
 */

import { CURSOR_CUBE_FRAMES } from './cursorCube';

export const CUBE_FRAMES: string[][] = CURSOR_CUBE_FRAMES;

export type MovingLogoKind = 'cursor' | 'mustang' | 'corvette' | 'gm' | 'plymouth';

/** Every kind uses the same 3D cube. Labels are optional (add in component if needed). */
const FRAME_SETS: Record<MovingLogoKind, string[][]> = {
  cursor: CUBE_FRAMES,
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
