# Model registry — spec + drafts (NOT APPLIED)

Status: draft only. Nothing here is applied to the database or deployed. Files live under
`supabase/drafts/model-registry/` so no migration runner or function deploy picks them up.
No model was called and nothing was spent to produce this.

| File | What it is |
|---|---|
| `001_model_registry.sql` | `model_tasks`, `model_registry`, `model_registry_events`, `model_shadow_budget`; `resolve_model(task)`, `model_promotion_check`, `model_promote`, `model_retire_expired`, `model_queue_candidate` |
| `002_eval_harness.sql` | frozen gold sets, eval runs/results, `model_eval_finish`, gold-set selection queries |
| `003_seed.sql` | today's hardcoded models as active/fallback, Nov 2026 candidates as inert `candidate` rows, shadow budgets present but OFF |
| `resolveModel.ts` (+ `_test.ts`, 5 passing) | the one resolver every edge function would call; falls back to the caller's hardcoded model if the registry is unreachable |
| `providerWatch.ts` | weekly job: reads provider model lists (free), queues candidates, records shutdown dates, auto-retires |

All three SQL files were applied to a throwaway local Postgres 17 (with a stub `llm_cost_tracking`) and exercised:
resolve order, approval gate, shadow sampling under cap, frozen gold-set guard, promotion check (refuses without
shadow sample, passes on better-or-equal accuracy at lower cost), promote (old active becomes fallback 1),
auto-retire (active past shutdown is retired and fallback 1 takes over).

---

## 1. Inventory (main @ 980c887, 2026-11-23)

Volumes are last 30 days from `llm_cost_tracking`, `image_stage_receipts`, `comment_discoveries`,
`evidence_judgment_requests`. "not logged" = the function writes no cost or model row anywhere.

| Task | Where (file:line) | Model / provider | 30-day volume, cost | Fallback |
|---|---|---|---|---|
| Photo classify (server) | `photo-pipeline-orchestrator/classifierProvider.ts:22` (platform_config `photo_classifier_provider`) | **gpt-4.1-mini** (OpenAI) — *shuts down 2027-01-14* | 11,006 ok, **$29.14** ($0.00265/call, 5,311 in / 327 out tok); +920 HTTP 429, 323 timeouts, 113 invalid JSON | Gemini `gemini-flash-latest` (`classifier.ts:10`) — **dead**: 424×402 + 64×403, 0 successes |
| Photo classify (subscription) | `scripts/photo-pipeline/subscription_gate_reader.py:199`, `subscription-frame-classifier.mjs:52` | claude-cli **`sonnet` (unpinned alias)** / claude-sonnet-5-5 | 7,656 alias + 231 pinned receipts, $0 marginal | none |
| Deep read | `scripts/photo-pipeline/deep-stage.mjs:22` | claude-cli claude-sonnet-5-5 (two-pass) | 85 receipts, $0 marginal | none |
| Keyed values | `scripts/photo-pipeline/keys_lane.py:549` | claude-cli `sonnet` alias | 177 receipts | none |
| Receipt OCR (subscription) | `subscription-document-reader.mjs:144` | claude-cli `sonnet` | 22 receipts | none |
| Place match / day synthesis | `scripts/daily-receipt/synthesize-day.mjs:296`, `classify-unfiled-day.mjs:41` | claude-cli claude-opus-5-5 | not logged | none |
| Legacy cascade | `scripts/daily-receipt/process-photo-cascade.mjs:191` | claude-opus-4-7-1m (label) | not logged | — |
| Document OCR | `document-ocr-worker/index.ts:426,597,637,497` | Sonnet 5.5 → gpt-4o → grok-2-vision-1212; Gemini for classify | only Gemini failures logged (37×402, 8×403) | gpt-4o (*shuts down 2027-01-14*), grok-2-vision (**shut down 2026-02-28**) |
| Sensitive document | `detect-sensitive-document/index.ts:281,343` | gpt-4o → Sonnet 5.5 | not logged | Sonnet 5.5 |
| Title read | `extract-title-data/index.ts:89,151` | gpt-4o → Sonnet 5.5 | not logged | Sonnet |
| Receipt extract | `receipt-extract/index.ts:539,598` | gpt-4o | not logged | none |
| Deal jacket | `forensic-deal-jacket/index.ts:404,448,494`; `deal-jacket-pipeline:230` | Sonnet 5.5 / gpt-4o / grok-2-vision(-latest) | not logged | dead xAI |
| Image cron / validate | `process-all-images-cron:128`, `validate-vehicle-image:87`, `image-ai-chat:62` | gpt-4o / gpt-4o-mini | not logged | none |
| Comment extraction | `batch-comment-discovery/deriveComment.ts:6`, `index.ts:644-703` | claude-sonnet-5-5 (floor raised from Haiku); grok-3-mini → Gemini lite → Sonnet chain | 185 Sonnet + 1,148 haiku-5-5 rows; ds_cost $1.50 / 63 | grok-3-mini **dead since 2026-02-28** |
| Listing / description extraction | `extract-premium-auction/llm-extractor.ts:378,585`, `discover-description-data:165-232`, `extract-vehicle-data-ai:266-272`, `import-classiccars-listing` | gpt-4o-mini, gpt-4o, grok-3-mini, Gemini lite, Sonnet | not logged | partly dead |
| Enrichment | `enrich-factory-specs:80-82`, `enrich-vehicle-profile-ai:140-142` | grok-3-mini → gpt-4o-mini ×2 | not logged | first hop dead |
| Long reasoning | `agent-chat:40`, `analyze-with-claude:39`, `derive-title-ownership:40`, `_shared/agentTiers.ts:42-44` | claude-opus-5-5 / sonnet-5-5 (the "haiku" tier is mapped to Sonnet) | evidence_judgment: 226 claude-code-cli + 85 Sonnet | none |
| Static routers (unused by most) | `_shared/llmRouter.ts:100-308` (5 importers), `_shared/llmProvider.ts:31-50` (11 importers), `_shared/visionFallback.ts:29-31` | in-code `MODEL_REGISTRY` with task defaults | — | coded chains, no health |
| Embeddings | `scripts/clip-embed-image-observations.py:56` | CLIP ViT-B/32 local | $0 | — |
| Local vision | `scripts/vision-loop-daemon.mjs:37` (`VISION_MODEL`), `scripts/stacks/lib/ask.mjs:110` | Ollama qwen2.5vl:7b, qwen3.5:9b | $0 | — |
| iOS on-device | `VisionEngine.swift:205,249,415`; `OnDeviceAnalysis.swift:85,353`; `NativeIdentityOCR.swift:31` | VNClassifyImageRequest **rev 2**, VNDetectFaceRectangles **rev 3**, VNRecognizeText (default rev, accurate, no LM), VNGenerateImageFeaturePrint (default) | free | — |

Env vars that name a model: `BYOK_MODEL` (default gpt-6-astra, `scripts/daily-receipt/reviewed-image-batch.ts:175`),
`VISION_MODEL`, `OLLAMA_MODEL`, `ODYSSEUS_MODEL`, `STACKS_OLLAMA_MODEL`. DB config: `platform_config.photo_classifier_provider`.

Blast radius of provider retirements already on the calendar:
* **28 edge functions** hardcode gpt-4o / gpt-4o-mini / gpt-4.1 / gpt-4.1-mini — OpenAI shuts all four down **2027-01-14** (52 days).
* **7 edge functions** still route to grok-2-vision-1212 / grok-3-mini, shut down by xAI **2026-02-28**: every one of those hops fails today.
* The server classifier's only fallback (Gemini) is out of credit (HTTP 402). On 2027-01-14 the classifier has **no working model**.

## 2. Market check (Nov 2026, list prices per 1M tokens unless noted)

| Task | Today | Candidates | Source |
|---|---|---|---|
| Vision classification | gpt-4.1-mini $0.40/$1.60 (deprecated) | **gpt-6-luna $0.10/$0.50** (OpenAI's listed replacement; image input; set `reasoning_effort: none`); **claude-haiku-5-5 $0.10/$0.50** (≤100K prompt; image input; retirement ≥ 2027-10-07); gpt-5.4-nano $0.20/$1.25; gpt-5-nano $0.05/$0.40; gemini-3.1-flash-lite $0.25/$1.50; gemini-3.5-flash-lite $0.30/$2.50 | [OpenAI gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| OCR / document reading | Sonnet 5.5 $2/$10 → gpt-4o $2.50/$10 → dead xAI | Mistral OCR 4.1 **$0.004/page** ($0.005 annotated, batch −50%); claude-haiku-5-5; gpt-6-luna; free on-device **RecognizeDocumentsRequest** (iOS 26: text, tables, lists, barcodes) | [Mistral OCR 4.1](https://docs.mistral.ai/models/ocr-4-1), [Apple RecognizeDocumentsRequest](https://developer.apple.com/documentation/vision/recognizedocumentsrequest), [WWDC25 session](https://developer.apple.com/videos/play/wwdc2025/272/) |
| VIN / part-number reading | Apple VNRecognizeText + paid vision re-read | On-device first (RecognizeDocumentsRequest, ISO 3779 check digit as the judge); paid read only on crops that fail the check, with Haiku 5.5 / gpt-6-luna | as above |
| Place matching / day synthesis | claude-cli Opus 5.5 (subscription) | Sonnet 5.5 (half Opus API price $2/$10 vs $4/$20) or Haiku 5.5 for the GPS→place join; most of this is deterministic (GPS radius + session) and should be rules first | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Long reasoning | Opus 5.5 $4/$20; Sonnet 5.5 $2/$10 | gemini-3.8-flash $0.75/$3.75 (doubles 2027-01-01); grok-4.3 $1.25/$2.50; Batch API −50% on Claude/OpenAI for anything not interactive | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [xAI Grok 4.3](https://docs.x.ai/developers/models/grok-4.3) |
| Dead xAI hops | grok-2-vision-1212, grok-3-mini | grok-4.3 ($1.25/$2.50) or remove the hop | [xAI deprecation (Feb 2026)](https://www.eonmsk.com/2026/02/03/xai-deprecating-grok-api-models-grok-2-3-mini-and-grok-2-vision/), [litellm deprecation dates PR](https://github.com/BerriAI/litellm/pull/20102) |

Caveat: token-for-token comparisons assume the same image tokenization. Each provider counts image tokens
differently (Claude: ⌈w/28⌉×⌈h/28⌉ visual tokens; Haiku 5.5 uses the high-res tier), so the eval harness
measures real cost per call instead of trusting list price.

## 3. Biggest win now

**Server photo classifier: gpt-4.1-mini → gpt-6-luna, with Claude Haiku 5.5 replacing the dead Gemini fallback.**
* Cost: 11,006 calls cost $29.14 in 30 days ($0.00265/call). The same 5,311 in / 327 out tokens on gpt-6-luna cost
  $0.000695/call → **~$7.65 per 30 days, −74% (~$21.50/month saved)**; via Batch/Flex (−50%) ~$3.80.
* Reliability: it is not optional. gpt-4.1-mini stops answering 2027-01-14 and the fallback has 0 successes in 30 days.
  Haiku 5.5 as fallback 1 adds a second working provider at the same list price.
* Eval cost to prove it: 300 gold photos × 2 candidates ≈ **$0.45 total** at measured-token estimates (cap per run $5).

## 4. Design

### 4.1 Registry
`model_registry(task, provider, model, version, status, fallback_rank, params, prices, est_cost_per_call_usd,
eval_accuracy, eval_privacy_recall, eval_p95_latency_ms, shadow_agreement, provider_deprecated_at,
provider_shutdown_at, approved_by, promoted_at, retired_at …)`.
Status: `candidate → shadow → active`, plus `fallback` (ranked) and `retired`. One active per task (partial unique
index). A check constraint makes `approved_by` mandatory for anything except candidate/retired, so the weekly
watcher can never spend money on its own. Every transition is written to `model_registry_events`.
Pinned snapshots go in `version` (e.g. `gpt-4.1-mini-2025-04-14`), which kills the unpinned `sonnet` alias problem.

### 4.2 Resolver
`resolve_model(task)` returns active, then live fallbacks by rank (anything on/after `provider_shutdown_at` is
skipped), plus at most one shadow model while the task's monthly shadow cap is unspent.
`resolveModel.ts` caches it 60 s per isolate and, if the RPC fails or returns nothing, returns the caller's
hardcoded model, so wiring a function to it is behaviour-neutral until registry rows exist. Adoption order:
classifierProvider.ts (replaces `platform_config.photo_classifier_provider`), then `_shared/llmProvider.ts` /
`llmRouter.ts` / `visionFallback.ts` (one change reaches their 16 importers), then the 28 functions with the
Jan-14 models. Scripts (claude-cli readers) read the same RPC through PostgREST.

### 4.3 Eval harness
* Gold set: frozen per task (`model_gold_sets` + `model_gold_cases`; a trigger blocks edits after freeze), built
  only from verified facts: human-filed vehicles (`vehicle_images.user_confirmed_vehicle_by`), VIN reads that equal
  `vehicles.vin` with a valid ISO 3779 check digit, and human privacy verdicts. Machine flags are never gold.
* **Finding:** planner stats show `user_confirmed_vehicle = true` on effectively 0% of 66M image rows and
  `is_sensitive = true` on ~0.0003%. There is not enough human-labelled data yet. A one-time ~300-photo review by
  Skylar (vehicle, is-it-a-car, private yes/no), with neighbours pre-filled by the free on-device facts, gives the
  first usable set (decision 3).
* Scorers: classify = exact match on is_vehicle, image_type, vehicle_id; VIN = exact 17-char + check digit;
  privacy = recall on private cases (a privacy miss counts as a failure regardless of other fields); document =
  field-level exact/normalised match.
* Each run records measured tokens, cost, p50/p95 latency and error rate; `model_eval_finish` writes the scores
  onto the registry row. Runs need a named approver and a ≤ $5 budget. Claude-cli subscription readers can be
  evaluated at $0 marginal cost.

### 4.4 Shadow mode
`model_shadow_budget(task, sample_pct ≤ 5, monthly_cap_usd ≤ 25, enabled, approved_by)`. Seeded OFF. The resolver
offers the shadow model only while month-to-date spend (`llm_cost_tracking` where `caller = 'shadow:<task>'`) is under
the cap; callers sample locally and run shadow after answering, never changing the user-visible result.
Agreement with active is stored as `shadow_agreement`.

### 4.5 Promotion rule (`model_promotion_check`)
Promote only if, on the same frozen gold set, with ≥ 200 scored cases and a measured shadow sample:
* (a) accuracy ≥ active **and** cost/call ≤ active, or
* (b) accuracy ≥ active − 1.0 pt **and** cost/call ≤ 70% of active;
* and always: privacy recall not lower on privacy-critical tasks, p95 latency ≤ 1.5× active, any per-task policy
  floor respected (comment_extract / long_reasoning are floored at claude-sonnet-5-5 per `_shared/aiCredits.ts`).
`model_promote(candidate, actor)` refuses without a passing check and a named human; old active becomes fallback 1.

### 4.6 Automatic retire and fallback
`model_retire_expired()` (daily, and at the end of each watch run) retires anything past `provider_shutdown_at`.
If it was active, fallback 1 becomes active automatically; this is the only automatic move into `active` and it
only ever moves to a model that was already approved. The resolver already skips expired rows, so traffic shifts
even before the job runs.

### 4.7 Weekly provider watch
`providerWatch.ts`, Mondays 09:00 PST: lists models from OpenAI (`/v1/models`, which carries `shutdown_date`),
Anthropic, Google, xAI and Mistral (free list calls), queues new relevant ids as `candidate` (no price, no spend),
records shutdown dates on known rows, runs auto-retire, and returns a digest (new candidates, shutdowns within
60 days, provider errors) for the weekly message to Skylar. Nothing moves to shadow without approval.

## 5. Gaps found
* G1. ~50 model-calling functions write no cost/model row; only the orchestrator, `llmProvider` and
  `document-ocr-worker` log to `llm_cost_tracking`. Volume for most tasks is unknown.
* G2. Three parallel in-code registries (`llmRouter.MODEL_REGISTRY`, `llmProvider` tiers, `visionFallback`) with
  different prices for the same model (`openaiCost.ts` has gpt-4o at $5/$15; current list is $2.50/$10).
* G3. Unpinned aliases: claude-cli `sonnet`, Gemini `*-latest`. Results can change under the same label.
* G4. `llm_cost_tracking.task` holds the HTTP status ("200", "402"), not the task.
* G5. `agentTiers.ts` maps the "haiku" tier to claude-sonnet-5-5 (20× Haiku 5.5's price) by policy.

## 6. Decisions for Skylar
1. Apply the registry tables + resolver (additive, no behaviour change until rows exist)? yes/no
2. Approve a gold-set eval of gpt-6-luna and claude-haiku-5-5 for the photo classifier, ≤ $1 total? yes/no
3. Do a one-time ~300-photo labelling pass (vehicle / car or not / private) to make the first gold set? yes/no
4. Turn on shadow for photo_classify at 2% with a $2/month cap after the eval? yes/no
5. Let auto-retire promote an already-approved fallback when a provider shuts a model down (recommended; otherwise the pipeline stops on 2027-01-14)? yes/no
6. Remove the 7 dead xAI hops now (pure code cleanup, no spend)? yes/no
7. Keep the Sonnet 5.5 floor for comment extraction and agent tiers, or let the registry test Haiku 5.5 there too? keep/test
