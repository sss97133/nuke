import type { CommentRow, ExtractedClaim } from "../_shared/commentRefinery.ts";

type SourceComment = CommentRow & { source_url: string; vehicle_id?: string; source_platform?: string };
type Claim = ExtractedClaim & { comment_id: string };
export interface ClaimLandingInput {
  vehicleId: string;
  comments: SourceComment[];
  claims: Claim[];
  processedCommentIds: string[];
  commentErrors: Record<string, string[]>;
  modelUsed: string;
  costCents: number;
  promptVersion: string;
  deadlineMs?: number;
}

/** Only this qualified derivative is written here; testimony and vehicle facts stay intact. */
export async function landCommentClaims(supabase: any, input: ClaimLandingInput) {
  const result = {
    derived: [] as Array<{ observation_id: string; comment_id: string; duplicate: boolean; credential: "system_api_key" }>,
    comments_processed: 0, claims_total: 0, failed_comments: 0, errors: [] as string[],
  };
  const deadline = Math.min(Date.now() + 45_000, input.deadlineMs ?? Infinity);
  const covered = new Set(input.processedCommentIds);
  const known = new Set(input.comments.map((comment) => comment.id));
  const invalidBatch = input.comments.length === 0 || !uuid(input.vehicleId) || !input.promptVersion || !input.modelUsed ||
    !Number.isFinite(input.costCents) || input.costCents < 0 || known.size !== input.comments.length ||
    input.claims.some((claim) => !known.has(claim.comment_id)) ||
    input.processedCommentIds.some((id) => !known.has(id));
  if (invalidBatch) {
    result.failed_comments = input.comments.length;
    result.errors.push("invalid_landing_batch");
    return result;
  }
  for (const comment of input.comments) {
    const claims = input.claims.filter((claim) => claim.comment_id === comment.id);
    if (!covered.has(comment.id) || input.commentErrors[comment.id]?.length ||
      claims.length > 16 || !validComment(comment, input.vehicleId) ||
      claims.some((claim) => !validClaim(claim, comment))) {
      result.failed_comments++;
      result.errors.push("comment_not_validated");
      continue;
    }
    const observationIds = new Set<string>();
    let failed = false;
    for (const claim of claims) {
      try {
        const scope = claim.subject_scope!;
        const sourceIdentifier = await identity(comment.id, claim, scope, input.promptVersion);
        const response = await bounded((signal) => supabase.functions.invoke("ingest-observation", {
          signal,
          body: {
            vehicle_id: input.vehicleId,
            source_slug: "bat",
            source_comment_id: comment.id,
            source_identifier: sourceIdentifier,
            source_url: comment.source_url,
            kind: "comment",
            observed_at: comment.posted_at,
            content_text: claim.source_quote_actual,
            agent_inferred: true,
            defer_analysis: true,
            extraction_method: "comment_refinery_atom",
            agent_model: input.modelUsed,
            agent_cost_cents: input.costCents / Math.max(1, input.claims.length),
            structured_data: {
              analysis_kind: "comment_atom",
              is_inferred: true,
              claim_type: claim.claim_type,
              category: claim.category,
              statement_kind: claim.statement_kind,
              subject_scope: scope,
              epistemic_status: claim.epistemic_status,
              qualification: claim.qualification,
              field_name: claim.field_name,
              proposed_value: claim.proposed_value,
              source_quote_actual: claim.source_quote_actual,
              source_quote_start: claim.source_quote_start,
              source_quote_end: claim.source_quote_end,
              source_quote_offset_unit: "utf16_code_units",
              source_comment_id: comment.id,
              source_family: `bat-comment:${comment.id}`,
              quoted_source_comment_id: comment.id,
              confidence: Math.min(0.6, claim.confidence),
              model_confidence: claim.model_confidence ?? claim.confidence,
              temporal_anchor: claim.temporal_anchor ?? "unknown",
              temporal_anchor_basis: claim.temporal_anchor_basis ?? "unknown",
              prompt_version: input.promptVersion,
              author_username: comment.author_username,
              is_seller: comment.is_seller,
            },
          },
        }), deadline);
        if (response.error || response.data?.success !== true || !uuid(response.data?.observation_id)) {
          throw new LandingError("ingest_failed");
        }
        const id = response.data.observation_id;
        const readback = await bounded((signal) => supabase.from("vehicle_observations")
          .select("id,vehicle_id,source_comment_id,source_identifier,kind,confidence_score")
          .eq("id", id).abortSignal(signal).maybeSingle(), deadline);
        const row = readback.data;
        if (readback.error || row?.id !== id || row.vehicle_id !== input.vehicleId ||
          row.source_comment_id !== comment.id || row.source_identifier !== sourceIdentifier ||
          row.kind !== "comment" || typeof row.confidence_score !== "number" ||
          !Number.isFinite(row.confidence_score) || row.confidence_score < 0 || row.confidence_score > 0.6) {
          throw new LandingError("observation_readback_failed");
        }
        observationIds.add(id);
        if (!result.derived.some((entry) => entry.observation_id === id)) {
          result.derived.push({ observation_id: id, comment_id: comment.id,
            duplicate: response.data.duplicate === true, credential: "system_api_key" });
        }
      } catch (error) {
        result.errors.push(error instanceof LandingError ? error.code : "observation_write_failed");
        failed = true;
        break;
      }
    }
    if (!failed) {
      try {
        const ids = [...observationIds];
        const progress = await bounded((signal) => supabase.from("comment_claims_progress").update({
          llm_processed: true,
          llm_model: input.modelUsed,
          extraction_version: input.promptVersion,
          llm_cost_cents: Math.round(input.costCents / Math.max(1, input.comments.length) * 10000) / 10000,
          claims_extracted: ids.length,
          observation_ids: ids,
          processed_at: new Date().toISOString(),
        }).eq("comment_id", comment.id).select("comment_id,observation_ids,llm_processed")
          .abortSignal(signal).maybeSingle(), deadline);
        if (progress.error || progress.data?.comment_id !== comment.id || progress.data.llm_processed !== true ||
          !sameIds(progress.data.observation_ids, ids)) throw new LandingError("progress_write_failed");
        result.comments_processed++;
      } catch (error) {
        failed = true;
        result.errors.push(error instanceof LandingError ? error.code : "progress_write_failed");
      }
    }
    if (failed) result.failed_comments++;
  }
  result.claims_total = result.derived.length;
  return result;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function validComment(comment: SourceComment, vehicleId: string) {
  if (!uuid(comment.id) || (comment.vehicle_id && comment.vehicle_id !== vehicleId) ||
    (comment.source_platform && comment.source_platform !== "bat") ||
    typeof comment.comment_text !== "string" || !comment.posted_at || !Number.isFinite(Date.parse(comment.posted_at))) return false;
  try {
    const url = new URL(comment.source_url);
    return url.protocol === "https:" && ["bringatrailer.com", "www.bringatrailer.com"].includes(url.hostname);
  } catch { return false; }
}
function validClaim(claim: Claim, comment: SourceComment) {
  const start = claim.source_quote_start;
  const end = claim.source_quote_end;
  const modelConfidence = claim.model_confidence ?? claim.confidence;
  const basis = claim.temporal_anchor_basis ?? "unknown";
  const anchor = claim.temporal_anchor;
  return typeof claim.claim_type === "string" && claim.claim_type.length > 0 &&
    claim.qualification === "candidate" &&
    claim.statement_kind === (String(claim.category) === "Q" ? "question" : "assertion") &&
    claim.subject_scope === (claim.claim_type === "seller_response" ? "comment" : claim.category === "E" ? "model" : "vehicle") &&
    (claim.claim_type !== "seller_response" || (claim.category === "C" && comment.is_seller === true)) &&
    typeof claim.epistemic_status === "string" && ["asserted", "uncertain", "unknown", "refused"].includes(claim.epistemic_status) &&
    ["A", "B", "C", "D", "E", "Q"].includes(claim.category) &&
    typeof claim.proposed_value === "string" && claim.proposed_value.trim().length > 0 &&
    typeof claim.confidence === "number" && Number.isFinite(claim.confidence) && claim.confidence >= 0 && claim.confidence <= 0.6 &&
    Number.isFinite(modelConfidence) && modelConfidence >= 0 && modelConfidence <= 1 &&
    Number.isInteger(start) && Number.isInteger(end) && start! >= 0 && end! > start! && end! <= comment.comment_text.length &&
    typeof claim.source_quote_actual === "string" && comment.comment_text.slice(start, end) === claim.source_quote_actual &&
    claim.quote === claim.source_quote_actual &&
    ((basis === "unknown" && (anchor === null || anchor === "unknown")) ||
      (basis === "comment_posted_at" && anchor === comment.posted_at) ||
      (basis === "source_explicit_date" && typeof anchor === "string" && Number.isFinite(Date.parse(anchor)) && claim.source_quote_actual.includes(anchor)));
}
async function identity(commentId: string, claim: Claim, scope: string, version: string) {
  const data = JSON.stringify([commentId, "comment", claim.category, claim.claim_type, claim.field_name,
    claim.proposed_value, claim.source_quote_actual, scope, version]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return "comment-atom:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sameIds(actual: unknown, expected: string[]) {
  return Array.isArray(actual) && actual.length === expected.length &&
    new Set(actual).size === expected.length && expected.every((id) => actual.includes(id));
}
class LandingError extends Error {
  constructor(public code: string) { super(code); }
}
async function bounded(operation: (signal: AbortSignal) => PromiseLike<any>, deadline: number): Promise<any> {
  const remaining = Math.min(10_000, deadline - Date.now());
  if (remaining <= 0) throw new LandingError("landing_time_budget_exceeded");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new LandingError("landing_timeout")); }, remaining);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
