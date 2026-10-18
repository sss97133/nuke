// Run: deno test supabase/functions/extract-barrett-jackson/
import { originImageUrl } from './imageUrl.ts';

const ORIGIN = 'https://BarrettJacksonCDN.azureedge.net/staging/carlist/items/fullsize/cars/298742/Engine_Web.jpeg';

Deno.test('every resized width of a photo is one origin URL; an origin URL is unchanged', () => {
  const widths = [640, 1080, 1200, 1920, 2048, 3840].map((w) => `https://www.barrett-jackson.com/cdn-cgi/image/width=${w},quality=75,format=webp/${ORIGIN}`);
  const origins = new Set(widths.map(originImageUrl));
  if (origins.size !== 1 || !origins.has(ORIGIN)) throw new Error(JSON.stringify([...origins]));
  if (originImageUrl(ORIGIN) !== ORIGIN) throw new Error('origin changed');
  const other = 'https://www.barrett-jackson.com/images/logo.png';
  if (originImageUrl(other) !== other) throw new Error('non-resized url changed');
});
