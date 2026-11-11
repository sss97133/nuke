// Retained supplier image bytes, not HTML acquisition. Product pages use archiveFetch.
import { firecrawlScrape } from './firecrawl.ts';

const MAX_BYTES = 15_000_000;
const sha = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value as BufferSource)), x => x.toString(16).padStart(2, '0')).join('');
export function allowedStockImage(url: string) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['cdn.oerparts.com', 'cdn.classicindustries.com', 'images.oreillyauto.com', 'images-prod.oreillyauto.com'].includes(u.hostname); } catch { return false; }
}
export async function retainImage(admin: any, url: string, effects = { fetch, firecrawlScrape }) {
  if (!allowedStockImage(url)) throw new Error('stock_image_host_unapproved');
  let response = await effects.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  let remoteMime: string | null = null;
  let refuseRemote = (code: string): never => { throw new Error(code); };
  if (response.status === 403) {
    await response.body?.cancel();
    // Regional CDN refusal must not strand an otherwise qualified receipt product.
    // One metered US request for the exact original image, never a screenshot or a substitute.
    const remote = await effects.firecrawlScrape({ url, formats: ['rawBase64'],
      location: { country: 'US', languages: ['en-US'] }, proxy: 'basic', timeout: 30000 },
      { caller: 'receipt-products-stock-image', maxAttempts: 1, timeoutMs: 45000 });
    const data = remote.raw?.data, metadata = data?.metadata;
    const status = (value: unknown) => Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
    const mime = String(metadata?.contentType ?? '').split(';')[0].trim().toLowerCase();
    const diagnostic = { api_status: status(remote.httpStatus), origin_status: status(metadata?.statusCode),
      requested_source_matches: metadata?.sourceURL === url, final_source_matches: metadata?.url === url,
      content_type: ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'other',
      original_bytes_present: typeof data?.rawBase64 === 'string' };
    // Keep only fixed categories and bounded status fields: never provider errors,
    // URLs, credentials or base64. A refused real capture must remain diagnosable.
    refuseRemote = (code: string): never => {
      console.warn(JSON.stringify({ event: 'catalog_stock_image_remote_refused', code, ...diagnostic }));
      throw new Error(code);
    };
    if (remote.error === 'firecrawl_allowance_exhausted') refuseRemote('stock_image_budget_deferred');
    if (!remote.ok || !remote.success || remote.error || remote.blocked || metadata?.statusCode !== 200
      || metadata?.sourceURL !== url || metadata?.url !== url
      || data?.screenshot || data?.actions?.screenshots?.length) {
      refuseRemote('stock_image_remote_unqualified');
    }
    remoteMime = mime;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(remoteMime)) refuseRemote('stock_image_format_unrecognized');
    const encoded = data?.rawBase64;
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_BYTES / 3) * 4) refuseRemote('stock_image_too_large');
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) refuseRemote('stock_image_format_unrecognized');
    const decoded = atob(encoded);
    if (decoded.length > MAX_BYTES) refuseRemote('stock_image_too_large');
    // A string iterator materializes millions of characters before constructing
    // a typed array. Fill the bounded buffer directly within the Edge heap limit.
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    response = new Response(bytes, { headers: { 'content-type': remoteMime } });
  }
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('stock_image_unavailable');
  const reader = response.body?.getReader(); if (!reader) throw new Error('stock_image_empty');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('stock_image_too_large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  const ext = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg'
    : bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10' ? 'png'
    : new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP' ? 'webp' : null;
  if (!ext || size < 100) refuseRemote('stock_image_format_unrecognized');
  if (remoteMime && remoteMime !== `image/${ext}`) refuseRemote('stock_image_format_unrecognized');
  const hash = await sha(bytes), path = `receipt-products/${hash}.${ext}`;
  const { error } = await admin.storage.from('catalog-images').upload(path, bytes, { contentType: `image/${ext}`, upsert: false });
  if (error && !['409','Duplicate'].includes(String(error.statusCode ?? error.error))) throw new Error('stock_image_persistence_failed');
  // Read back the immutable object, including an existing object after a duplicate upload.
  const stored = await admin.storage.from('catalog-images').download(path);
  if (stored.error || !stored.data || stored.data.size !== size || await sha(new Uint8Array(await stored.data.arrayBuffer())) !== hash) throw new Error('stock_image_readback_mismatch');
  return { image_sha256: hash, image_storage_path: path,
    image_url: admin.storage.from('catalog-images').getPublicUrl(path).data.publicUrl };
}
