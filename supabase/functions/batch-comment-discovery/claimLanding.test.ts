import { landCommentClaims, type ClaimLandingInput } from "./claimLanding.ts";

const vehicleId = "11111111-1111-4111-8111-111111111111";
const commentId = "22222222-2222-4222-8222-222222222222";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function input(): ClaimLandingInput {
  return {
    vehicleId, modelUsed: "offline-fixture", costCents: 0.1, promptVersion: "atoms-v1",
    comments: [{ id: commentId, vehicle_id: vehicleId, source_platform: "bat",
      source_url: "https://bringatrailer.com/listing/test/#comment-1", comment_text: "Was the recall completed?",
      posted_at: "2026-10-02T15:24:04Z", author_username: "fixture", is_seller: false, bid_amount: null }],
    claims: [{ comment_id: commentId, claim_type: "buyer_question", category: "Q", field_name: null,
      proposed_value: "Recall completion requested", confidence: 0.6, model_confidence: 0.98,
      quote: "Was the recall completed?", source_quote_actual: "Was the recall completed?",
      source_quote_start: 0, source_quote_end: 25, temporal_anchor: null, temporal_anchor_basis: "unknown",
      reasoning: "", contradicts_existing: false, statement_kind: "question", subject_scope: "vehicle",
      epistemic_status: "unknown", qualification: "candidate" }],
    processedCommentIds: [commentId], commentErrors: {},
  };
}
function fake(options: { failInvoke?: number; readback?: Record<string, unknown>; progressError?: boolean;
  missingProgress?: boolean; badProgressIds?: boolean; rejectInvoke?: boolean } = {}) {
  const bodies: any[] = [];
  const observations = new Map<string, any>();
  const identities = new Map<string, string>();
  const progress = new Map<string, any>();
  const tables: string[] = [];
  let nextId = 1;
  const client = {
    functions: { invoke(_name: string, { body, signal }: any) {
      assert(signal instanceof AbortSignal, "Invoke must accept cancellation");
      bodies.push(body);
      if (options.rejectInvoke) throw new Error("private provider response must never escape");
      if (options.failInvoke === bodies.length) return Promise.resolve({ error: { message: "private payload" }, data: null });
      const duplicate = identities.has(body.source_identifier);
      const id = identities.get(body.source_identifier) ?? `33333333-3333-4333-8333-${String(nextId++).padStart(12, "0")}`;
      identities.set(body.source_identifier, id);
      observations.set(id, { ...body, id, confidence_score: 0.6 });
      return Promise.resolve({ error: null, data: { success: true, observation_id: id, duplicate } });
    } },
    from(table: string) {
      tables.push(table);
      let key = "";
      let patch: any;
      const query = {
        select(_columns: string) { return query; },
        eq(_column: string, value: string) { key = value; return query; },
        update(value: any) { patch = value; return query; },
        abortSignal(signal: AbortSignal) { assert(signal instanceof AbortSignal, "Query cancellation required"); return query; },
        maybeSingle() {
          if (table === "vehicle_observations") return Promise.resolve({ error: null,
            data: { ...observations.get(key), ...options.readback } });
          assert(table === "comment_claims_progress", "Only observation readbacks and progress writes permitted");
          if (options.progressError) return Promise.resolve({ error: { message: "private SQL detail" }, data: null });
          if (options.missingProgress) return Promise.resolve({ error: null, data: null });
          const row = { ...patch, comment_id: key };
          progress.set(key, row);
          return Promise.resolve({ error: null, data: options.badProgressIds ? { ...row, observation_ids: [] } : row });
        },
      };
      return query;
    },
  };
  return { client, bodies, observations, progress, tables };
}

Deno.test("question lands as qualified sourced testimony, with exact readback IDs", async () => {
  const f = fake();
  const result = await landCommentClaims(f.client, input());
  assert(result.comments_processed === 1 && result.claims_total === 1 && result.failed_comments === 0, "Expected verified success");
  const body = f.bodies[0];
  assert(body.kind === "comment" && body.source_comment_id === commentId && body.source_slug === "bat", "Canonical typed source");
  assert(body.observed_at === input().comments[0].posted_at && body.agent_inferred && body.defer_analysis, "Source clock and inferred qualification");
  assert(body.structured_data.is_inferred && body.structured_data.statement_kind === "question" && body.structured_data.temporal_anchor === "unknown", "Question cannot become established repair");
  assert(body.structured_data.model_confidence === 0.98 && body.structured_data.confidence === 0.6, "Separate model and capped confidence");
  assert(f.progress.get(commentId).observation_ids[0] === result.derived[0].observation_id, "Progress exact IDs");
  assert(f.progress.get(commentId).extraction_version === "atoms-v1", "Progress binds parser version");
  assert(result.derived[0].credential === "system_api_key", "Credential accounting");
});

Deno.test("replay reuses stable identity and a changed prompt version supersedes identity", async () => {
  const f = fake();
  const first = await landCommentClaims(f.client, input());
  const second = await landCommentClaims(f.client, input());
  assert(first.derived[0].observation_id === second.derived[0].observation_id && second.derived[0].duplicate, "Replay must reuse");
  const changed = input(); changed.promptVersion = "atoms-v2";
  await landCommentClaims(f.client, changed);
  assert(f.observations.size === 2, "Explicit version remains independently attributable");
});

Deno.test("one failed atom leaves whole comment retryable and preserves successful atom", async () => {
  const f = fake({ failInvoke: 2 });
  const value = input(); value.claims.push({ ...value.claims[0], proposed_value: "Second question" });
  const result = await landCommentClaims(f.client, value);
  assert(result.claims_total === 1 && result.comments_processed === 0 && result.failed_comments === 1, "No false completion");
  assert(f.progress.size === 0 && f.observations.size === 1, "Preserve partial work");
  assert(!JSON.stringify(result).includes("private payload"), "Sanitized error only");
});

Deno.test("explicit empty comment completes but omitted or malformed coverage does not", async () => {
  const value = input(); value.claims = [];
  const success = await landCommentClaims(fake().client, value);
  assert(success.comments_processed === 1 && success.claims_total === 0, "Explicit empty is valid");
  for (const invalid of [{ ...value, processedCommentIds: [] }, { ...value, commentErrors: { [commentId]: ["invalid_json_array"] } }]) {
    const f = fake(); const result = await landCommentClaims(f.client, invalid);
    assert(result.failed_comments === 1 && f.progress.size === 0, "Malformed/omitted stays retryable");
  }
});

Deno.test("readback rejects cross-vehicle, cross-comment, uncapped, or missing observations", async () => {
  for (const readback of [{ vehicle_id: commentId }, { source_comment_id: vehicleId }, { confidence_score: 0.61 },
    { confidence_score: null }, { id: null }, { source_identifier: "wrong" }, { kind: "condition" }]) {
    const f = fake({ readback }); const result = await landCommentClaims(f.client, input());
    assert(result.claims_total === 0 && result.failed_comments === 1 && f.progress.size === 0, "Reject unverifiable observation");
  }
});

Deno.test("progress errors and missing rows are failures after preserved observation writes", async () => {
  for (const option of [{ progressError: true }, { missingProgress: true }, { badProgressIds: true }]) {
    const f = fake(option); const result = await landCommentClaims(f.client, input());
    assert(result.comments_processed === 0 && result.failed_comments === 1 && result.claims_total === 1, "No green progress receipt");
    assert(!JSON.stringify(result).includes("private SQL"), "No raw database error");
  }
});

Deno.test("all claims validated before any write; quote/date/source failures stay retryable", async () => {
  for (const mutate of [
    (value: ClaimLandingInput) => { value.claims[0].source_quote_actual = "A repaired car"; },
    (value: ClaimLandingInput) => { value.claims[0].temporal_anchor = "2004-01-01"; },
    (value: ClaimLandingInput) => { value.comments[0].posted_at = "invalid"; },
    (value: ClaimLandingInput) => { value.comments[0].source_platform = "private"; },
    (value: ClaimLandingInput) => { value.comments[0].source_url = "https://example.com/listing"; },
    (value: ClaimLandingInput) => { value.claims = Array.from({ length: 17 }, () => value.claims[0]); },
  ]) {
    const value = input(); mutate(value); const f = fake();
    const result = await landCommentClaims(f.client, value);
    assert(result.failed_comments === 1 && f.bodies.length === 0 && f.progress.size === 0, "Reject before writes");
  }
});

Deno.test("model knowledge and uncertain seller responses retain their distinct scope", async () => {
  for (const mode of ["model", "comment"] as const) {
    const value = input(); const claim = value.claims[0];
    claim.category = mode === "model" ? "E" : "C";
    claim.claim_type = mode === "model" ? "general_spec" : "seller_response";
    claim.statement_kind = "assertion"; claim.subject_scope = mode; claim.epistemic_status = "uncertain";
    value.comments[0].is_seller = true;
    const f = fake(); await landCommentClaims(f.client, value);
    assert(f.bodies[0].kind === "comment" && f.bodies[0].structured_data.subject_scope === mode &&
      f.bodies[0].structured_data.epistemic_status === "uncertain", "Preserve epistemic distinction");
  }
});

Deno.test("unexpected provider exceptions remain static and never mark progress", async () => {
  const f = fake({ rejectInvoke: true }); const result = await landCommentClaims(f.client, input());
  assert(result.errors[0] === "observation_write_failed" && !JSON.stringify(result).includes("private provider"), "Static exception category");
  assert(f.progress.size === 0, "Must remain retryable");
});

Deno.test("whole-call deadline is bounded and cannot turn timeout into empty success", async () => {
  const original = Date.now;
  let calls = 0;
  Date.now = () => ++calls === 1 ? 0 : 46_000;
  try {
    const f = fake(); const result = await landCommentClaims(f.client, input());
    assert(result.errors[0] === "landing_time_budget_exceeded" && result.failed_comments === 1 && f.bodies.length === 0, "Deadline must reject before invocation");
  } finally { Date.now = original; }
});

Deno.test("an in-flight invocation is aborted at the ten-second limit", async () => {
  const original = globalThis.setTimeout;
  let requestedTimeout = 0;
  let signal: AbortSignal | undefined;
  globalThis.setTimeout = ((callback: () => void, milliseconds: number) => {
    requestedTimeout = milliseconds;
    queueMicrotask(callback);
    return 0;
  }) as typeof setTimeout;
  try {
    const f = fake();
    f.client.functions.invoke = (_name: string, options: any) => {
      signal = options.signal;
      return new Promise<never>(() => {});
    };
    const result = await landCommentClaims(f.client, input());
    assert(requestedTimeout === 10_000 && signal?.aborted, "Bound and abort stalled network invocation");
    assert(result.errors[0] === "landing_timeout" && result.failed_comments === 1 && f.progress.size === 0, "Timeout remains retryable");
  } finally { globalThis.setTimeout = original; }
});

Deno.test("local credential is explicit without changing paid default and refuses billed local claims", async () => {
  const local = fake();
  const result = await landCommentClaims(local.client, { ...input(), credential: "local_ollama", costCents: 0 });
  assert(result.derived[0]?.credential === "local_ollama", "Local receipt must identify actual execution");
  assert(local.bodies[0].structured_data.derivation_credential === "local_ollama" && local.bodies[0].agent_cost_cents === 0, "Local is unbilled and attributed");
  const paid = fake();
  const paidResult = await landCommentClaims(paid.client, input());
  assert(paidResult.derived[0]?.credential === "system_api_key", "Paid default preserved");
  const invalid = fake();
  const refused = await landCommentClaims(invalid.client, { ...input(), credential: "local_ollama" });
  assert(refused.errors[0] === "invalid_landing_batch" && invalid.bodies.length === 0, "Billed local claims rejected before writes");
});
