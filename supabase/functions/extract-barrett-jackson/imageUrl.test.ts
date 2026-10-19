// Run: deno test supabase/functions/extract-barrett-jackson/
import { originImageUrl, storedImageUrls } from './imageUrl.ts';

const ORIGIN = 'https://BarrettJacksonCDN.azureedge.net/staging/carlist/items/fullsize/cars/298742/Engine_Web.jpeg';

Deno.test('every resized width of a photo is one origin URL; an origin URL is unchanged', () => {
  const widths = [640, 1080, 1200, 1920, 2048, 3840].map((w) => `https://www.barrett-jackson.com/cdn-cgi/image/width=${w},quality=75,format=webp/${ORIGIN}`);
  const origins = new Set(widths.map(originImageUrl));
  if (origins.size !== 1 || !origins.has(ORIGIN)) throw new Error(JSON.stringify([...origins]));
  if (originImageUrl(ORIGIN) !== ORIGIN) throw new Error('origin changed');
  const other = 'https://www.barrett-jackson.com/images/logo.png';
  if (originImageUrl(other) !== other) throw new Error('non-resized url changed');
});

Deno.test('a .jpg photo matches its stored .jpeg spelling and back; other URLs match only themselves', () => {
  const jpg = ORIGIN.replace(/\.jpeg$/, '.jpg');
  if (JSON.stringify(storedImageUrls(ORIGIN)) !== JSON.stringify([ORIGIN, jpg])) throw new Error(JSON.stringify(storedImageUrls(ORIGIN)));
  if (JSON.stringify(storedImageUrls(jpg)) !== JSON.stringify([jpg, ORIGIN])) throw new Error(JSON.stringify(storedImageUrls(jpg)));
  const png = 'https://BarrettJacksonCDN.azureedge.net/x/Engine_Web.png';
  if (JSON.stringify(storedImageUrls(png)) !== JSON.stringify([png])) throw new Error('png changed');
  const jpgDir = 'https://BarrettJacksonCDN.azureedge.net/a.jpg/Engine_Web.webp';
  if (storedImageUrls(jpgDir).length !== 1) throw new Error('mid-path extension rewritten');
});
