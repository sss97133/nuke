const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** Optional caller restriction, never a source-privacy or account authorization. */
export function allowedSubjectSources(value: unknown, requested: string[], expected?: Record<string, string>):
  { valid: true; hashes: ReadonlyMap<string, string> | null } | { valid: false } {
  if (value === undefined) return { valid: true, hashes: null };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { valid: false };
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 64 || entries.some(([id, hash]) =>
    !UUID.test(id) || typeof hash !== "string" || !SHA256.test(hash))) return { valid: false };
  // Copy before any async source lookup. A later caller mutation cannot broaden
  // the set or replace its exact byte pins while the operation is in flight.
  const hashes = new Map<string, string>(entries);
  if (requested.some(id => !hashes.has(id) || expected && expected[id] !== hashes.get(id))) return { valid: false };
  return { valid: true, hashes };
}

export function subjectInputScopeRefusal(hashes: ReadonlyMap<string, string> | null,
  sources: Array<{ id: string; file_hash: string }>): "source_outside_allowed_scope" | "source_changed" | null {
  if (!hashes) return null;
  if (sources.some(source => !hashes.has(source.id))) return "source_outside_allowed_scope";
  return sources.some(source => hashes.get(source.id) !== source.file_hash) ? "source_changed" : null;
}
