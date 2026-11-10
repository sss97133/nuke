// Retained supplier image bytes, not HTML acquisition. Product pages use archiveFetch.
const sha = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value as BufferSource)), x => x.toString(16).padStart(2, '0')).join('');
export function allowedStockImage(url: string) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
    ['cdn.oerparts.com', 'cdn.classicindustries.com', 'images.oreillyauto.com'].includes(u.hostname); } catch { return false; }
}
export async function retainImage(admin: any, url: string) {
  if (!allowedStockImage(url)) throw new Error('stock_image_host_unapproved');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || Number(response.headers.get('content-length')) > 15_000_000) throw new Error('stock_image_unavailable');
  const reader = response.body?.getReader(); if (!reader) throw new Error('stock_image_empty');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > 15_000_000) { await reader.cancel(); throw new Error('stock_image_too_large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  const ext = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg'
    : bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10' ? 'png'
    : new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP' ? 'webp' : null;
  if (!ext || size < 100) throw new Error('stock_image_format_unrecognized');
  const hash = await sha(bytes), path = `receipt-products/${hash}.${ext}`;
  const { error } = await admin.storage.from('catalog-images').upload(path, bytes, { contentType: `image/${ext}`, upsert: false });
  if (error && !['409','Duplicate'].includes(String(error.statusCode ?? error.error))) throw new Error('stock_image_persistence_failed');
  // Read back the immutable object, including an existing object after a duplicate upload.
  const stored = await admin.storage.from('catalog-images').download(path);
  if (stored.error || !stored.data || stored.data.size !== size || await sha(new Uint8Array(await stored.data.arrayBuffer())) !== hash) throw new Error('stock_image_readback_mismatch');
  return { image_sha256: hash, image_storage_path: path,
    image_url: admin.storage.from('catalog-images').getPublicUrl(path).data.publicUrl };
}
