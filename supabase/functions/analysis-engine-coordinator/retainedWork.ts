const methods = new Set(['registered_source_state_v1', 'filed_photo_state_v1']);
export function retainedWorkLimits(body: { batch_size?: unknown; time_budget_ms?: unknown }) {
  const requested = body.batch_size == null ? 2 : Number(body.batch_size);
  const requestedBudget = body.time_budget_ms == null ? 15000 : Number(body.time_budget_ms);
  return { batchSize: Number.isFinite(requested) ? Math.max(0, Math.min(20, Math.floor(requested))) : 0,
    budgetMs: Number.isFinite(requestedBudget) ? Math.max(10000, Math.min(45000, Math.floor(requestedBudget))) : 15000 };
}
export function retainedMethodAllowed(method: unknown): method is string {
  return typeof method === 'string' && methods.has(method);
}

/** Reuse the registered reader. This route has no model, storage or edge call. */
export async function computeRetainedWidget(db: any, vehicle: string, slug: string, method: string) {
  if (!retainedMethodAllowed(method)) throw new Error('Unregistered retained method');
  const started = Date.now();
  const { data, error } = await db.rpc('compute_retained_analysis_widget', {
    p_vehicle_id: vehicle, p_widget_slug: slug, p_method: method,
  }).abortSignal(AbortSignal.timeout(8000));
  if (error) throw new Error(`Retained calculation failed: ${error.message}`);
  if (data?.method_revision !== method || data?.assessment_status !== 'not_assessed'
    || data?.score !== null || data?.severity !== 'info' || !data?.details || !data?.evidence
    || !Array.isArray(data.reasons)) throw new Error('Retained result receipt missing');
  return { score: null, severity: 'info', value_json: data, evidence: data.evidence,
    reasons: data.reasons as string[], compute_time_ms: Date.now() - started };
}
