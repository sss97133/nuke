// A Photos adjustment sidecar is metadata, even if export gives it an image extension.
// Keep it out of storage and the image identity pipeline; the asset still needs an original.
export function isPlistExport(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (bytes.subarray(0, 8).equals(Buffer.from('bplist00'))) return true;
  const head = bytes.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return (head.startsWith('<?xml') || head.startsWith('<plist')) && /<plist(?:\s|>)/.test(head);
}
