/** Optional canonical binding to the existing property commons. Raw source bodies are never rewritten. */
export interface ObservationProperty {
  id: string; property_key: string; data_type: string; unit: string | null;
  applies_to_kinds: string[] | null; deprecated_at: string | null;
}
export function propertyBinding(key: string | undefined, kind: string,
  data: Record<string, unknown> | undefined, property: ObservationProperty | null): string | null {
  if (!key) return null;
  if (!property || property.property_key !== key || property.deprecated_at) throw new Error(`Unknown or deprecated property_key: ${key}`);
  if (!property.applies_to_kinds?.includes(kind)) throw new Error(`Property ${key} does not declare kind ${kind}; request a reviewed vocabulary change`);
  const value = data?.value;
  const types: Record<string, boolean> = {
    integer: typeof value === 'number' && Number.isSafeInteger(value),
    numeric: typeof value === 'number' && Number.isFinite(value),
    string: typeof value === 'string', text_long: typeof value === 'string', enum: typeof value === 'string',
    boolean: typeof value === 'boolean',
    jsonb: value !== undefined && value !== null,
    date: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)),
    timestamp: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
  };
  if (!types[property.data_type]) throw new Error(`Property ${key} requires ${property.data_type} value; uuid_ref needs a separate typed entity path`);
  const unit = data?.unit;
  if ((property.unit || '').toLowerCase() !== (typeof unit === 'string' ? unit : '').toLowerCase()) {
    throw new Error(`Property ${key} unit mismatch: source ${unit ?? 'unitless'}, registry ${property.unit ?? 'unitless'}; use a cited projection, not a source-body edit`);
  }
  return property.id;
}
