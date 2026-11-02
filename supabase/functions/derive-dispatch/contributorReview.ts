// Use the existing extractor registry and existing contributor review queue.
// This registered route can only reuse retained readings, never spend owner or
// platform compute on a fresh extraction.
export async function dispatchContributorReview(admin: any, baseUrl: string, secret: string,
  userId: string | null, capacity: number, fetcher: typeof fetch = fetch) {
  if (capacity <= 0) return null;
  const { data: reader, error } = await admin.from('observation_extractors')
    .select('slug,edge_function_name,is_active,extractor_config')
    .eq('slug', 'contributor-evidence-review-v1').maybeSingle();
  if (error) throw error;
  if (!reader?.is_active) return null;
  if (reader.edge_function_name !== 'contributor-intake' || reader.extractor_config?.action !== 'retained_review' ||
      reader.extractor_config?.paid_extraction !== false) throw new Error('invalid contributor retained review route');
  const res = await fetcher(`${baseUrl}/functions/v1/${reader.edge_function_name}/review`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'x-nuke-internal': secret },
    body: JSON.stringify({ action: 'retained_review', batch_size: Math.min(2, capacity), user_id: userId, platform_credential: false }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || result?.method !== 'contributor_evidence_review_v1' || !Array.isArray(result.results)) {
    throw new Error('contributor retained review incomplete');
  }
  return result;
}
