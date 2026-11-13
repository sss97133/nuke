// Deterministic review of retained sources. No provider, storage download or
// testimony insertion occurs here; the leased SQL owner validates every verdict.
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Claim = { id: string; claimed_revision: number; lease_token: string };
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

export async function reviewRetainedInputs(client: RpcClient, options: {
  limit?: number; userId?: string | null; worker?: string; now?: () => number;
} = {}) {
  const worker = options.worker ?? `contributor-review-${crypto.randomUUID()}`;
  const now = options.now ?? Date.now;
  const deadline = now() + 15000;
  const limit = Math.min(5, Math.max(0, Math.floor(options.limit ?? 2)));
  const results: Array<{ id: string; status: string }> = [];
  for (let n = 0; n < limit && now() < deadline; n++) {
    const claimed = await client.rpc('claim_contributor_intake_reevaluation', {
      p_worker: worker, p_limit: 1, p_vehicle_id: null, p_user_id: options.userId ?? null,
    });
    if (claimed.error) throw claimed.error;
    if (!Array.isArray(claimed.data)) throw new Error('invalid contributor claim receipt');
    if (!claimed.data.length) break;
    const row = object(claimed.data[0]);
    if (!row || typeof row.id !== 'string' || !Number.isSafeInteger(row.claimed_revision) ||
        typeof row.lease_token !== 'string') throw new Error('invalid contributor lease');
    const claim = row as unknown as Claim;
    const args = { p_id: claim.id, p_worker: worker, p_revision: claim.claimed_revision, p_lease_token: claim.lease_token };
    try {
      const finished = await client.rpc('finish_contributor_intake_reevaluation', args);
      if (finished.error) throw finished.error;
      const status = object(finished.data)?.status;
      if (typeof status !== 'string' || !['done', 'queued', 'already_completed', 'lease_lost', 'retry'].includes(status)) {
        throw new Error('invalid contributor review receipt');
      }
      results.push({ id: claim.id, status });
    } catch (error) {
      const retry = await client.rpc('retry_contributor_intake_reevaluation', args);
      if (retry.error) throw retry.error;
      // An expired/stolen lease is harmless. Neither caller may publish an
      // unfenced verdict; the next claim uses the retained source again.
      const status = object(retry.data)?.status;
      if (status !== 'retry' && status !== 'lease_lost') throw error;
      results.push({ id: claim.id, status });
    }
  }
  return { method: 'contributor_evidence_review_v1', claimed: results.length, results };
}
