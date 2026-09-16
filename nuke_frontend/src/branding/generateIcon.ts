/**
 * On-the-fly app-icon generation.
 *
 * The whole "slap your icon on it" hook dies if the user has to go produce a
 * 180×180 / 192×192 / 512×512 PNG. So we generate them in-browser from whatever
 * we already have: a real logo if the entity has one, otherwise a monogram on
 * the livery colorway. Zero uploads, zero backend.
 */

import { LIVERY_ICON_COLORS, monogramFor, type BrandIdentity } from './brandIdentity';

const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export interface GeneratedIcons {
  /** size -> PNG data URL */
  bySize: Record<IconSize, string>;
  /** Convenience: the 180px icon used for apple-touch-icon. */
  appleTouch: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('icon image load failed: ' + url));
    img.src = url;
  });
}

function drawMonogram(ctx: CanvasRenderingContext2D, size: number, brand: BrandIdentity) {
  const { bg, fg } = LIVERY_ICON_COLORS[brand.accent];
  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // Subtle bottom-edge bar in the foreground color — reads as a "livery stripe".
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, size - Math.round(size * 0.10), size, Math.round(size * 0.10));
  ctx.globalAlpha = 1;
  // Monogram
  const text = monogramFor(brand.name);
  ctx.fillStyle = fg;
  ctx.font = `700 ${Math.round(size * 0.46)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + size * 0.02);
}

function drawLogo(ctx: CanvasRenderingContext2D, size: number, img: HTMLImageElement, brand: BrandIdentity) {
  const { bg } = LIVERY_ICON_COLORS[brand.accent];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // Contain the logo with padding so it never bleeds to the rounded mask edge.
  const pad = Math.round(size * 0.16);
  const box = size - pad * 2;
  const scale = Math.min(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
}

export async function generateIcons(brand: BrandIdentity): Promise<GeneratedIcons> {
  let logo: HTMLImageElement | null = null;
  if (brand.logoUrl) {
    try {
      logo = await loadImage(brand.logoUrl);
    } catch {
      logo = null; // fall back to monogram on any load/CORS failure
    }
  }

  const bySize = {} as Record<IconSize, string>;
  for (const size of ICON_SIZES) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    if (logo) drawLogo(ctx, size, logo, brand);
    else drawMonogram(ctx, size, brand);
    bySize[size] = canvas.toDataURL('image/png');
  }

  return { bySize, appleTouch: bySize[180] };
}
