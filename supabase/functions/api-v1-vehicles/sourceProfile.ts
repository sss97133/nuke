// A source profile is a view of testimony, never a second witness or a physical-car merge.
import { ecrUrl, ECR_METHOD, ECR_MODE, readEcrCapture } from "../ingest-observation/retainedEcr.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

const LIMIT = 20;
const columns = "id,source_id,source_snapshot_id,source_identifier,source_url,kind,extraction_method,is_superseded,vehicle_id,subject_type,subject_id,observed_at,ingested_at,structured_data,observed_at_basis,source_event_time_precision,source_event_at";
const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const equal = (a: unknown, b: unknown) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const result = (status: number, body: Record<string, unknown>) => ({ status, body });
export const sourceProfilePath = (url: string, snapshot?: string | null) => `/vehicle/source?source_url=${encodeURIComponent(url)}`
  + (snapshot ? `&capture_id=${encodeURIComponent(snapshot)}` : "");

/** Existing authenticated vehicles API only. No new table visibility, external fetch or write. */
export async function readSourceProfile(db: any, selector: string, captureSelector?: string | null) {
  const url = ecrUrl(selector);
  if (!url) return result(400, { error: "Unsupported source profile URL" });
  if (captureSelector != null && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(captureSelector))
    return result(400, { error: "Invalid retained capture selector" });
  const captureId = captureSelector?.toLowerCase() ?? null;
  const source = await db.from("observation_sources").select("id,species")
    .eq("slug", "exclusive-car-registry").maybeSingle();
  if (source.error || source.data?.species !== "aggregator") return result(503, { error: "Source qualification unavailable" });
  const query = () => {
    const q = db.from("vehicle_observations").select(columns)
      .eq("source_id", source.data.id).eq("extraction_method", ECR_METHOD).eq("is_superseded", false);
    return captureId ? q.eq("source_snapshot_id", captureId) : q;
  };
  const finish = (q: any) => q.order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(LIMIT + 1);
  const isCollection = url.includes("/collection/");
  // Keep the source URL's own detail evidence and the collection's testimony distinct.
  const own = await finish(query().in("source_url", [url, url + "/"]));
  if (own.error) return result(503, { error: "Source profile evidence unavailable" });
  let memberships: any[] = [];
  if (!isCollection) {
    const read = await finish(query().contains("structured_data", { ecr_capture_receipt: { cards: [{ url }] } }));
    if (read.error) return result(503, { error: "Source profile relationships unavailable" });
    memberships = read.data ?? [];
  }
  const rows = [...new Map<string, any>([...(own.data ?? []), ...memberships].map(row => [row.id, row])).values()];
  rows.sort((a, b) => a.observed_at === b.observed_at ? b.id.localeCompare(a.id) : a.observed_at < b.observed_at ? 1 : -1);
  const complete = (own.data?.length ?? 0) <= LIMIT && memberships.length <= LIMIT && rows.length <= LIMIT;
  if (!rows.length) return result(404, { error: "No admitted source evidence for this URL" });
  const evidence: any[] = [];
  const checkedCaptures = new Map<string, Awaited<ReturnType<typeof readEcrCapture>>>();
  for (const row of rows.slice(0, LIMIT)) {
    if (captureId && row.source_snapshot_id !== captureId) return result(503, { error: "Source evidence belongs to another retained capture" });
    // Re-derive against the retained original. An arbitrary JSON envelope is not an admission credential.
    const checked = checkedCaptures.get(row.source_snapshot_id) ?? await readEcrCapture(db, row.source_snapshot_id);
    checkedCaptures.set(row.source_snapshot_id, checked);
    if (!checked.ok) return result(503, { error: "Retained source evidence cannot be verified", reason: checked.reason });
    const r = checked.receipt;
    if (row.source_id !== source.data.id || row.extraction_method !== ECR_METHOD || row.kind !== "listing"
      || row.is_superseded !== false || row.vehicle_id !== null || row.subject_id !== null
      || row.subject_type !== (r.kind === "collection" ? "organization" : "vehicle")
      || row.source_identifier !== `${ECR_MODE}:${r.snapshot_id}` || row.source_url !== r.source_url
      || row.observed_at_basis !== "source_capture_time" || row.source_event_time_precision !== "unknown" || row.source_event_at !== null
      || observationClockMicroseconds(row.observed_at) !== observationClockMicroseconds(r.captured_at)
      || !equal(row.structured_data?.ecr_capture_receipt, r)) return result(503, { error: "Admitted source custody differs from retained evidence" });
    const cards = isCollection ? r.cards : r.cards.filter(c => c.url === url);
    if (isCollection && ecrUrl(r.source_url) !== url) return result(503, { error: "Source evidence belongs to another collection presentation" });
    if (!isCollection && ecrUrl(r.source_url) !== url && !cards.length) return result(503, { error: "Source evidence belongs to another vehicle presentation" });
    const existing = evidence.find(e => e.snapshot_id === r.snapshot_id);
    if (existing) { existing.observation_ids.push(row.id); continue; }
    evidence.push({ observation_id: row.id, observation_ids: [row.id], snapshot_id: r.snapshot_id, source_url: r.source_url,
      source_hash: r.source_sha256, captured_at: r.captured_at, recorded_at: r.capture_recorded_at,
      admitted_at: row.ingested_at, label: r.label, kind: r.kind, cards,
      current_total: r.current_total, previous_total: r.previous_total, enumeration: r.enumeration });
  }
  const history = { complete, scope: "admitted_exact_source_url", selected_snapshot_id: captureId, observation_limit: LIMIT };
  if (isCollection) {
    const latest = evidence[0];
    return result(200, { data: { kind: "source_collection", source: "exclusive-car-registry", source_url: url,
      label: latest.label, captured_at: latest.captured_at, history,
      // The actual captured members are traversable even when Load more was never captured.
      members: latest.cards.map((c: any) => ({ source_url: c.url, label: c.label, image_url: c.image_url,
        relationship: c.relationship, profile_path: sourceProfilePath(c.url, latest.snapshot_id) })),
      enumeration: latest.enumeration, current_total: latest.current_total, previous_total: latest.previous_total,
      model_use_policy: "ecr_source_presentation_v1", model_use: { attributed_registry_presentation: true,
        dated_collection_presentation: latest.cards.length > 0, current_ownership: false,
        current_availability: false, independent_corroboration: false },
      ownership_status: "unverified", evidence } });
  }
  const claims = evidence.flatMap(e => {
    const cards = e.cards.filter((c: any) => c.url === url);
    return (cards.length ? cards : [null]).map((card: any) => ({ observation_id: e.observation_id, supporting_observation_ids: e.observation_ids, snapshot_id: e.snapshot_id, source_url: e.source_url,
      source_hash: e.source_hash, captured_at: e.captured_at, admitted_at: e.admitted_at,
      label: card?.label ?? e.label, image_url: card?.image_url ?? null,
      relationship: card?.relationship ?? null, collection_label: card ? e.label : null,
      collection_profile_path: card ? sourceProfilePath(e.source_url, e.snapshot_id) : null }));
  });
  const labels = [...new Set(claims.map(c => c.label))];
  const image = claims.find(c => c.image_url);
  return result(200, { data: { kind: "source_vehicle", source_profile_id: `ecr:${url.split("/").at(-1)}`,
    vehicle_id: null, source: "exclusive-car-registry", source_url: url, profile_path: sourceProfilePath(url, captureId),
    label: claims[0].label, label_status: labels.length > 1 ? "source_labels_differ" : "source_assertion",
    image_url: image?.image_url ?? null, image_source_url: image?.source_url ?? null,
    image_page_captured_at: image?.captured_at ?? null, image_observation_id: image?.observation_id ?? null,
    image_relationship: image?.relationship ?? null, history, claims,
    identity_status: "unresolved_physical_vehicle", ownership_status: "unverified", staging_permission_status: "unknown",
    // Eligibility is specific to what the evidence establishes. No confidence score launders a claim into a fact.
    model_use_policy: "ecr_source_presentation_v1", model_use: { attributed_registry_presentation: true, dated_collection_presentation: claims.some(c => c.relationship),
      verified_physical_identity: false, verified_factory_specification: false, current_ownership: false,
      current_availability: false, sale_outcome: false, independent_corroboration: false } } });
}
