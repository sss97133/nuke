/**
 * Which hosted source marks are drawn in dark ink and which in light ink, measured from the PNGs in
 * public/source-logos (share of opaque pixels with luminance < 60, or > 200 at low saturation, at least 60%).
 * The board shows marks with no backing chip, so a dark mark is flipped on the dark theme and a light mark on the
 * light theme; multi-colour marks are left as drawn. Re-measure when a PNG in that folder changes.
 */
const DARK_INK = new Set([
  '1600veloce', 'autotrader-classics', 'bat', 'bonhams', 'broad-arrow', 'carandclassic', 'cars-and-bids',
  'classic-com', 'classiccars-com', 'classicdriver', 'collectible-classics', 'gooding', 'grand-prix-classics',
  'jamesedition', 'mohr-imports', 'pcarmarket', 'rm-sothebys', 'sbx-cars', 'vantage-auto', 'velocity-restorations',
]);
const LIGHT_INK = new Set(['conceptcarz', 'private-collection-motors']);

export function sourceLogoInk(logoUrl: string | null | undefined): 'dark' | 'light' | null {
  const m = logoUrl?.match(/\/source-logos\/([^/?#]+)\.png(?:[?#]|$)/);
  if (!m) return null;
  if (DARK_INK.has(m[1])) return 'dark';
  if (LIGHT_INK.has(m[1])) return 'light';
  return null;
}
