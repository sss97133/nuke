import type { V2Extras } from './classifierTypes.ts';

type Field = V2Extras['vehicle_fields'][number];
type GuardRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export type FieldSourceAdmission = {
  fields: Field[];
  refusals: Array<{ field: string; index: number; reason: string }>;
  status: 'ok' | 'source_role_guard_unavailable';
};

/** Both photo writers use the existing SQL semantic owner. A refusal preserves
 * the classifier's raw fields/text; it never adds a manual-review queue item. */
export async function admitPhotoFields(fields: Field[], description: string, rpc: GuardRpc): Promise<FieldSourceAdmission> {
  if (!fields.length) return { fields: [], refusals: [], status: 'ok' };
  const unavailable = (): FieldSourceAdmission => ({ fields: [], status: 'source_role_guard_unavailable',
    refusals: fields.map((field, index) => ({ field: field.field_name, index, reason: 'source_role_guard_unavailable' })) });
  try {
    const { data, error } = await rpc('photo_field_not_about_vehicle', { p_fields: fields, p_descr: description });
    const result = data as { status?: string; decisions?: Array<{ index?: unknown; reason?: unknown }> } | null;
    if (error || result?.status !== 'ok' || !Array.isArray(result.decisions) || result.decisions.length !== fields.length) return unavailable();
    const accepted: Field[] = [], refusals: FieldSourceAdmission['refusals'] = [];
    for (let index = 0; index < fields.length; index++) {
      const decision = result.decisions[index];
      if (decision?.index !== index || (decision.reason !== null && (typeof decision.reason !== 'string' || !decision.reason))) return unavailable();
      if (decision.reason === null) accepted.push(fields[index]);
      else refusals.push({ field: fields[index].field_name, index, reason: decision.reason as string });
    }
    return { fields: accepted, refusals, status: 'ok' };
  } catch { return unavailable(); }
}
