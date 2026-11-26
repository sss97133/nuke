/** Canonical intake only: caller chooses a retained source, never asserts amounts. */
export const CATALOG_MODES = ['catalog_source_document','catalog_supply_property'] as const;
export const CATALOG_METHODS = ['supplied_catalog_source_v1','catalog_supply_property_v1'];
type Obj = Record<string, any>;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function catalogSupplySelector(input: Obj): { name: string; args: Obj } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.mode === 'catalog_source_document' && Object.keys(input).every(k => ['mode','document_id'].includes(k)) &&
    uuid.test(input.document_id ?? '')) return { name: 'qualify_catalog_document', args: { p_document: input.document_id } };
  if (input.mode === 'catalog_supply_property' && Object.keys(input).every(k =>
    ['mode','source_observation_id','catalog_part_id','source_line'].includes(k)) &&
    uuid.test(input.source_observation_id ?? '') && uuid.test(input.catalog_part_id ?? '') &&
    Number.isInteger(input.source_line) && input.source_line > 0 && input.source_line <= 262144)
    return { name: 'qualify_catalog_supply_property', args: {
      p_source: input.source_observation_id, p_part: input.catalog_part_id, p_line: input.source_line } };
  return null;
}
export interface CatalogIntakeDeps {
  authorize(): Promise<boolean>;
  qualify(name: string, args: Obj): Promise<Obj | null>;
  find(input: Obj): Promise<string | null>;
  insert(input: Obj): Promise<string | 'duplicate'>;
}
export async function admitCatalogSupply(input: Obj, deps: CatalogIntakeDeps) {
  const reply = (status: number, body: Obj) => ({ status, body: { ...body, model_calls: 0 } });
  if (!await deps.authorize()) return reply(403, { success: false, error: 'catalog_service_required' });
  const selector = catalogSupplySelector(input);
  if (!selector) return reply(400, { success: false, error: 'catalog_selector_required' });
  const q = await deps.qualify(selector.name, selector.args);
  if (!q?.input) return reply(422, { success: false, error: 'catalog_source_or_property_unqualified' });
  const row = q.input;
  let id = await deps.find(row), duplicate = Boolean(id);
  if (!id) {
    const inserted = await deps.insert(row);
    if (inserted === 'duplicate') { id = await deps.find(row); duplicate = true; }
    else id = inserted;
  }
  if (!id) return reply(409, { success: false, error: 'catalog_admission_not_persisted' });
  const checked = await deps.qualify(selector.name, { ...selector.args, p_result: id });
  if (checked?.result_verified !== true) return reply(409, { success: false, error: 'catalog_source_changed' });
  return reply(200, { success: true, observation_id: id, duplicate, authority: 'supplied_document_unverified',
    purchasing_eligible: false, property: checked.property ?? null });
}
export function catalogIntakeStore(db: any, authorize: CatalogIntakeDeps['authorize']): CatalogIntakeDeps {
  return {
    authorize,
    async qualify(name, args) {
      const r = await db.rpc(name, args).abortSignal(AbortSignal.timeout(5000));
      if (r.error) throw new Error('Catalog qualification unavailable');
      return r.data;
    },
    async find(input) {
      const r = await db.from('vehicle_observations').select('id').eq('source_id', input.source_id)
        .eq('source_identifier', input.source_identifier).eq('content_hash', input.content_hash)
        .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (r.error) throw new Error('Catalog replay unavailable');
      return r.data?.id ?? null;
    },
    async insert(input) {
      const r = await db.from('vehicle_observations').insert(input).select('id')
        .abortSignal(AbortSignal.timeout(5000)).single();
      if (r.error?.code === '23505') return 'duplicate';
      if (r.error || !r.data?.id) throw new Error('Catalog source admission refused');
      return r.data.id;
    },
  };
}
