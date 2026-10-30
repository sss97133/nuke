// The existing analysis owner decides eligibility from its registry. Never sweep
// the fleet or call paid widgets from this periodic retained-only wake.
export async function dispatchRetainedAnalysis(baseUrl: string, secret: string,
  userId: string | null, capacity: number, fetcher: typeof fetch = fetch) {
  if (capacity <= 0 || userId !== null) return null;
  const response = await fetcher(`${baseUrl}/functions/v1/analysis-engine-coordinator`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'x-nuke-internal': secret },
    body: JSON.stringify({ action: 'compute_retained', batch_size: Math.min(2, capacity) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.method !== 'retained_analysis_dispatch_v1' || !Array.isArray(result.results)
    || !Number.isInteger(result.processed) || !Number.isInteger(result.total_failed)) {
    throw new Error('Retained analysis dispatch incomplete');
  }
  if (result.total_failed > 0) throw new Error(`Retained analysis failed for ${result.total_failed} calculations`);
  return result;
}
