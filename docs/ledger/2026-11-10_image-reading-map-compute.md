# Image reading map, 2026-11-10: what a reading costs and what limits it

Made by a read-only agent over the repository on 2026-11-10 for the owner direction recorded in
`docs/ledger/theory/data-machine.md` ("Image analysis is the model asking"). Repo only: nothing here was checked
against production, and a later definition may have replaced a cited one. An audit output, not active guidance:
verify a finding before acting on it (`docs/ledger/README.md`).

## Summary

Repo only; nothing here was checked against the live system. (1) The only reader that can run unattended today is on the owner's Mac: launchd fires every 10 minutes and runs `claude -p --model sonnet --allowedTools Read`, one CLI session per photo, two at a time, at most 20 documents and 20 photos a fire. (2) Nothing counts or caps reads: pace is two integers and an interval in a plist, and the queue settings (max_open 300, refill_below 100, scan_per_lane 200, backfill_share 0.5, live_days 2) bound the queue and the database scan, not the reading. (3) A usage limit is recognised from the CLI's error text or a 429/529, ends that batch, and is forgotten by the next fire; an alarm raises only after two hours of fires that read nothing. (4) The cost of a reading is not recorded: per photo the database keeps reader label, prompt version, image type and outcome; seconds exist only as a per-fire total in a heartbeat row each fire overwrites; tokens, the CLI's cost figure and the resolved model are dropped. (5) Order is hard-coded in four places and differs in each: the stage queue interleaves newest uploads with oldest uploads (upload time, not capture time), the fallback and document worklists take newest capture time first, the paid drain newest upload first, and the deep read earliest capture day first within a vehicle. (6) The paid classifier can reach only OpenAI (gpt-4.1-mini default) and Gemini (flash, thin prompt); Gemini has a 500-calls-a-day cap shared with six other functions, OpenAI has no cap, and every price is a constant typed in code. (7) The first reading routes a second pass by image type and whether the photo has a vehicle, not by what was seen, so nearly every filed vehicle photo is marked for the deep read. (8) The deep read is now a three-stage Codex CLI review of up to 8 photos with the vehicle's full context, run by hand only; the GitHub drain, the Mac drain and the app's Analyze button still call the retired entry, which exits before any model call. (9) Free signals exist (the phone's Apple Vision labels, text, VIN and face check; the vision gate's cheap layers; the Apple-ML skip), but on the Mac path the skip checks run after the read is already spent. (10) A spend cap has three existing choke points (the plist, claim_image_stage_work, the image_stage_reconciler config row, with image_stage_receipts already holding the count) and an order policy has two (the reconciler's scan and the claim's pick); neither holds a cap or a selectable order today.

## The three questions

### Q1. Mustangs whose window felts were replaced during a restoration, with photographic proof.

**Path today.** Compute lens only. The first reading (v98) has no component or condition slot: it returns a type label, a description of at most 400 characters, text lines, cited values for 17 fixed vehicle fields, a VIN, an angle and a document block (classifierProvider.ts:281,340-359). A window felt can appear there only by chance in free text. The facts the question needs come from two dearer readings: the deep verdict (components_seen with label and box, build_phase_guess, state_observations; byok-vision-prompt.md:18-50) and the document read of the parts receipt (line_items with description and part number; subscription-document-reader.mjs:39). The deep read has no unattended trigger today and costs three model stages a photo.

**Smallest missing piece.** Nothing selects, before the dear pass, the photos likely to show a named component. The only selectors the deep `prepare` accepts are a vehicle, a date, exact image ids and a shard (deep-image-analysis-byok.mjs:704-750), and the first reading marks nearly every filed vehicle photo for the deep pass alike (index.ts:936-957).

### Q2. A Porsche that has a specific imperfection on it.

**Path today.** Compute lens only. Localized damage (damage_localized with label, box and severity; state_observations.damage_callouts) exists only in the deep verdict. The free recall layer, local CLIP embeddings at zero API cost, is computed only for image_observations rows that a deep read has already placed (clip-embed-drain.sh:3-9; clip-embed-image-observations.py:1-13). So an imperfection is findable only on photos that have already received the dear pass.

**Smallest missing piece.** No cheap signal about condition exists before the dear pass: the phone's labels carry none (OnDeviceAnalysis.swift:271-279) and the first reading's checklist asks for none. The embedder that could narrow candidates runs after the deep read, not before it.

### Q3. That specific imperfection was repaired, and it is now this restored Porsche.

**Path today.** Compute lens only. This needs two deep verdicts of the same area at two times. The deep `prepare --by-day` groups a vehicle's photos by capture day 'for component lifecycle and before/after' and takes the earliest day first (deep-image-analysis-byok.mjs:727-745); the prompt tells the reader that an early frame is often incomplete and to list open questions (byok-vision-prompt.md:52-62); `--rehash` re-reads frames whose questions later context could close, up to 2 dry passes (deep-image-analysis-byok.mjs:134,697-707). This is the one question whose cost depends on order: reading out of capture order produces open questions that only a second paid pass can close.

**Smallest missing piece.** No measurement exists of how many second passes an out-of-order read costs, and no control bounds deep reads to the two capture days that matter (the selectors are vehicle, one date, or exact image ids). How the two verdicts are linked as a repair is outside this map.

## Findings

### Mac subscription reader: the command and its flags (read)

**What exists.** Both readers start one `claude -p --output-format json --model <model> --allowedTools Read` process per photo and send the prompt on stdin. The model defaults to the alias `sonnet`; the launchd wrapper passes no --model. CLAUDECODE, CLAUDE_CODE_ENTRYPOINT and ANTHROPIC_API_KEY are removed from the child environment, and the wrapper and both scripts refuse to start when ANTHROPIC_API_KEY is set, so a read can only draw on the owner's Claude Code login. Each read is killed at 240 s. The frame reader's prompt is the orchestrator's v98 checklist, fetched once per fire (action classifier_prompt, no model call); the document reader's prompt is a fixed string in the script.

**Writer.** subscription-frame-classifier.mjs, subscription-document-reader.mjs

**Reader.** photo-pipeline-orchestrator (classification_raw), receipt-photo-ocr (extraction)

**Where.** scripts/photo-pipeline/subscription-frame-classifier.mjs:28,32,56-73,136-138; scripts/photo-pipeline/subscription-document-reader.mjs:30,34,39,93-106,119-121; scripts/photo-pipeline/subscription-reader-batch.sh:24,55-56; supabase/functions/photo-pipeline-orchestrator/index.ts:303-308

**Gap.** No flag bounds effort, turns or output length. The reader label stored is the alias (`claude-cli sonnet subscription`), so the model that actually answered is not recorded. Every photo is a new CLI session that re-sends the whole checklist; nothing batches photos or reuses a session (inferred from one spawn per photo).

### Mac subscription reader: photos per fire, concurrency, fires per hour (read)

**What exists.** launchd runs the wrapper every 600 s (also at load, nice 10) with arguments 20 and 20. The wrapper runs the document reader (limit 20, concurrency 2), then the frame classifier (limit 20, concurrency 2, statuses failed,pending), and skips the whole fire while either reader process is still running. From those constants the ceiling is 6 fires an hour and 20 photos plus 20 documents a fire (arithmetic on repo constants, not a measurement). Run by hand the defaults are larger: 200 photos, 500 documents. A claim hands out at most 25 photos a call, in JS and in SQL. The frame reader leases its whole batch for max(900, ceil(min(limit,25)/concurrency) x 300) s, which is 3,000 s for 20 photos at concurrency 2. The wrapper fast-forwards a checkout of origin/main every fire, so script changes on main reach the reader within one interval.

**Where.** scripts/com.nuke.subscription-reader.plist:13-26,39-42; scripts/photo-pipeline/subscription-reader-batch.sh:17,25,27-31,55-56; scripts/photo-pipeline/subscription-frame-classifier.mjs:30-31,81-82; scripts/photo-pipeline/subscription-document-reader.mjs:32-33; scripts/photo-pipeline/stage-queue.mjs:34-38; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:97

**Gap.** No count per hour or per day exists, and no setting names one. Pace is two integers and an interval in a plist that is installed by hand (cp to ~/Library/LaunchAgents), so the copy that runs is not the repo copy unless reinstalled. The plist's own comment allows 10-40 s a read; 40 reads at concurrency 2 can exceed the 600 s interval, and the skip-if-running guard then drops fires.

### Mac subscription reader: image down-scaling (read)

**What exists.** Frame classifier: a JPEG is handed to the CLI exactly as downloaded; HEIC, HEIF, PNG and WebP are converted with `sips -s format jpeg -Z 1600`. Document reader: only HEIC/HEIF are converted, at `-Z 2200`; JPEG, PNG and WebP go as downloaded. Both download the original from image_url, not the storage renderer. The paid path instead asks the storage renderer for 1600 px q85, then 1024 px q70, caps the bytes at 4 MB and down-scales other hosts in-function to 1568 px.

**Where.** scripts/photo-pipeline/subscription-frame-classifier.mjs:124-135; scripts/photo-pipeline/subscription-document-reader.mjs:109-118; supabase/functions/photo-pipeline-orchestrator/classifierImage.ts:5-16,18-20,32-65; supabase/functions/photo-pipeline-orchestrator/classifierBase.ts:15-17

**Gap.** The scripts put no size bound on a JPEG, so the image cost of a subscription read is whatever the CLI's Read tool does with the file. That is not controlled or recorded anywhere in the repo (inferred).

### Mac subscription reader: time per read, and what is recorded per read (read)

**What exists.** Each reader adds the CLI's reported duration_ms (or wall time) to one per-fire total, summary.read_seconds, next to the counts frames, read, accepted, errors, error_classes, stopped and by_type. The per-photo result rows hold image id, image type, HTTP status, success, error class and skipped: no seconds. The document reader reads the CLI's total_cost_usd into usage_cost and its caller discards it; the frame reader never reads it. Token usage and the resolved model are never read. For a reader-supplied answer the orchestrator stores a classifier receipt with model `reader:<label>`, attempts 1 and every timing field zero. Times stated in the repo: a plist comment '~10-40 s each'; 'one sale sheet read in 47 s on the default model'; a hard stop at 240 s.

**Where.** scripts/photo-pipeline/subscription-frame-classifier.mjs:94,146,155,174-176; scripts/photo-pipeline/subscription-document-reader.mjs:122-125,140,173-174,213-215; supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:510-513; scripts/com.nuke.subscription-reader.plist:23; docs/photo-landing-v3.md:68-69

**Gap.** No per-photo duration, token count, cost-equivalent or resolved model reaches the database. The per-fire total survives in two places only: the heartbeat row, which every fire overwrites, and one JSON file per fire under ~/nuke/logs on the Mac (subscription-reader-batch.sh:35).

### Mac subscription reader: how a usage limit is detected and what happens next (read)

**What exists.** A reader error is typed by receiptForResult. API status 429 or 529, or error text matching the USAGE_LIMIT pattern ('usage limit', 'hit your ... limit', '5-hour|session|weekly|opus|sonnet limit reached', 'out of extra usage', 'rate limit', 'quota', 'overloaded', 'credit balance'), becomes outcome rate_limited, error_class reader_usage_limit, retry after 3,600 s, stop true. Stop ends the batch. On the stage queue the frame reader writes that receipt for the photo in flight; photos claimed but not started stay claimed until the lease ends and are released by release_expired_image_stage_work in the reconciler cron. The document reader records nothing for a limit and simply tries again next fire. The summary carries stopped and error_classes into the heartbeat. A rate-limited photo is offered again after retry_after while attempts are under max_attempts (6), then once a day. The hourly assay raises when a reader has taken photos and read none for at least 3 fires spanning over 2 h, quoting the failure types.

**Where.** scripts/photo-pipeline/stage-queue.mjs:40-47,79-89; scripts/photo-pipeline/subscription-frame-classifier.mjs:96-114,119,142,164; scripts/photo-pipeline/subscription-document-reader.mjs:150-164; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:70,194,290-292,441-446,508-509; supabase/migrations/20261113120000_photo_reading_flow_assay_v2.sql:42,198-217; scripts/photo-pipeline/reader-heartbeat.mjs:70-78

**Gap.** No reader-wide 'blocked until' is stored, and the reset time the CLI prints ('resets 3pm') is not parsed. So during a limit window each fire claims a fresh batch, spends a CLI call per worker to rediscover the limit, and adds one attempt to the photo in flight (inferred from the code across fires). The paid lane has such a state (photo_pipeline_provider_state) and the night-run job has a six-hour backoff (scripts/night-run/controller.py:252-254); the readers have neither.

### Order of first readings: four lanes, four hard-coded orders (read)

**What exists.** (a) Stage queue. The reconciler's live lane takes the newest uploads inside live_days after a min_age grace, newest first; its backfill lane walks everything else oldest first by a (created_at, id) cursor. The claim then interleaves live #1, backfill #1, live #2 and so on, whatever backfill_share says. (b) The frame reader's fallback worklist, used when the queue is off: taken_at descending, nulls last. (c) The document reader: taken_at descending, 2,000 rows from each of two queries, then the first `limit`. (d) The paid drain's claim: created_at descending, with a cut at recent_days (14) when photo_pipeline_backlog.enabled is false. created_at is the row's insert time, not the capture time: the orchestrator records a June 2026 library backfill that put photos taken 2017-2026 on one upload clock.

**Writer.** reconcile_image_stages

**Reader.** claim_image_stage_work, subscription-frame-classifier.mjs

**Where.** supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:195-198,214-231,241-250,265-280; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:108-120; scripts/photo-pipeline/subscription-frame-classifier.mjs:85-88; scripts/photo-pipeline/subscription-document-reader.mjs:73-74,81; supabase/migrations/20261109000500_photo_pipeline_backoff.sql:85-97; supabase/functions/photo-pipeline-orchestrator/index.ts:885-888

**Gap.** No config key, column or argument selects an order. image_stage_work has lane ('live' or 'backfill'), not_before and created_at, and no priority or reason-for-priority column. claim_image_stage_work takes stage, limit, lease seconds and user id: no vehicle, date range or priority. 'Earliest first' in the backfill lane means earliest uploaded; no first-pass lane orders by capture time ascending.

### Controls that exist today on the stage queue (read)

**What exists.** platform_config key image_stage_reconciler holds: enabled; user_ids (seeded empty, then the owner); live_days 2; scan_per_lane (seeded 1000, set to 200); max_open 300; backfill_share 0.5; min_age_minutes 15; refill_below 100. The cron image-stage-reconciler runs every 10 minutes and calls reconcile_image_stages(100); a run's budget is min(100, max_open minus open items, 500), split by backfill_share, with unused live budget rolling to the backfill, and the backfill scan skipped while refill_below or more items are claimable. The stage registry image_pipeline_stages holds, per stage: required, required_version, contract, applies_when, max_attempts (6). The reader itself reads only enabled and user_ids.

**Writer.** migrations 20261113110000, 20261113130000, 20261113140000

**Reader.** reconcile_image_stages, claim_image_stage_work, image_stage_coverage, stageQueueEnabled

**Where.** supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:64-86,161-165,508-509; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:141-145; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:182-209,299-301; scripts/photo-pipeline/stage-queue.mjs:27-32

**Gap.** Every key bounds the size of the queue or the cost of the database scan. None bounds reads: nothing is named or acts as reads per hour, reads per day or a budget. The two levers that declare work (contract and required_version) requeue a whole stage's eligible population at once; the migration notes that contract 'v98' would add 6,737 photos in one step. There is no partial scope by vehicle, type or date.

### Paid classifier: the providers it can reach, models, price tables, per-request budget (read)

**What exists.** The classifier route reaches two providers only. OpenAI is primary: gpt-4.1-mini by default, gpt-4o-mini or gpt-4.1 allowed through platform_config key photo_classifier_provider; key OPENAI_API_KEY or OPEN_AI_API_KEY. Gemini is the fallback: gemini-flash-latest, with the short legacy prompt and 768 output tokens (the v98 checklist is not sent to Gemini); key GOOGLE_AI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY or free_api_key. Prices are constants in code: OPENAI_MODELS (0.40/1.60, 0.15/0.60, 2.00/8.00 USD per million tokens) and CLASSIFIER_PRICES for Gemini (0.30/2.50 and 0.10/0.40, marked 'NOT re-verified'). Per request: input 16,384 tokens, output 768 (legacy) or 3,000 (v98), image 4 MB, request 20 s. OpenAI gets up to 3 HTTP tries; an unusable v98 answer triggers one more OpenAI call with the legacy prompt; then Gemini, with one backoff retry. No Anthropic or xAI call exists in the orchestrator folder.

**Writer.** classifyImageRouted

**Reader.** photo-pipeline-orchestrator main handler

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:18-41,93-98,129-148,159-167,191-245; supabase/functions/photo-pipeline-orchestrator/classifier.ts:10-20,60-80,106-131; supabase/functions/photo-pipeline-orchestrator/classifierBase.ts:15-17; supabase/functions/photo-pipeline-orchestrator/index.ts:561-564

**Gap.** OpenAI has no call or dollar cap of any kind. An answer over the token budget is discarded after it was paid for. The cheapest paid reader (Gemini) produces only the thin reading, so it cannot satisfy the v98 contract. photo_classifier_provider has no seed migration in the repo (live value unknown).

### Gemini daily cap and the breakers (read)

**What exists.** geminiFetch wraps every Gemini generate call. It refuses while paused, refuses at daily_cap (default 500 calls per UTC day, counted as llm_cost_tracking rows with provider 'google', across every function), refuses for 10 minutes after a 402, 429 or 403 (a shared 'google_block' row), and refuses with 503 when the count cannot be read. The seed is {daily_cap: 500, paused: false}. OpenAI has an in-memory cooldown per isolate: 10 minutes after 401/402/403, 20 s after 429. The SQL breaker photo_pipeline_provider_state blocks claim_photo_pipeline_batch after a rate-limit or credit refusal: 60 s doubling (1,800 s for a 402), capped at 6 h; rate-limit attempts are counted apart from the per-photo budget and give up at 12. The breaker is cleared by photo_pipeline_clear_retry on any completed photo.

**Writer.** geminiFetch, photo_pipeline_note_failure

**Reader.** claim_photo_pipeline_batch, reset_stuck_photo_pipeline_images, assay_photo_reading_flow

**Where.** supabase/functions/_shared/geminiGuard.ts:1-17,66-115; supabase/migrations/20261015200000_gemini_spend_guard_config.sql:1-11; supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:95,151-152,221-223; supabase/migrations/20261109000500_photo_pipeline_backoff.sql:16-25,46-55,70-76,83-84; supabase/functions/photo-pipeline-orchestrator/index.ts:699

**Gap.** The Gemini cap counts calls, not dollars, and is shared by seven functions (batch-comment-discovery, discover-description-data, document-ocr-worker, extract-premium-auction, import-classiccars-listing, index-reference-document, photo-pipeline-orchestrator), so the classifier has no share of its own. The classifier's countTokens call does not pass through the guard (classifier.ts:115). The breaker reacts to refusals; it is not a budget. The case ledger notes it reads 'healthy' after a subscription reader's completion, which never called the provider (data-machine-cases.md:386-387).

### Paid lane: trigger and pace (read)

**What exists.** An AFTER INSERT trigger posts one orchestrator call per uploaded photo whose status is pending, that is not a duplicate and not external. The drain cron posts {action: process_pending, limit: 10} every 10 minutes; the orchestrator clamps a batch to 12 photos and 4 workers with a 100 s deadline; the SQL claim hands out at most 25, newest upload first, with a 300 s lease, and nothing while the breaker is closed against the provider. reset_stuck_photo_pipeline_images requeues up to 200 per phase hourly with a 3-attempt budget.

**Where.** supabase/migrations/20261015150000_photo_pipeline_trigger_skips_external_listing_photos.sql:1-20; supabase/migrations/20260927010200_photo_pipeline_pace.sql:104-114; supabase/functions/photo-pipeline-orchestrator/index.ts:311-318,404-431; supabase/migrations/20261109000500_photo_pipeline_backoff.sql:78-143

**Gap.** The backlog switch photo_pipeline_backlog (enabled, recent_days) is read by the claim and the assay but has no seed in the repo. A second cron, photo-pipeline-drain-b, appears only in a comment. Whether either cron is active was not checked live. Per the repo's own dated notes no platform key was answering on 2026-11-10 (20261113100000_photo_reading_flow_assay.sql:4-6).

### llm_cost_tracking: what is written (read)

**What exists.** OpenAI classifier: one best-effort insert per classification with provider, model, caller 'photo-pipeline-orchestrator', date, task (HTTP status or error class), input_tokens, output_tokens, cost_cents (the code's estimate times 100) and duration_ms. Gemini guard: one insert before each call (provider 'google', model, caller, date), later updated with duration_ms and the HTTP status; plus 'google_block' marker rows. The assay reads it for calls and successes in 6 h and 24 h; the yield refresh reads it to decide whether anything was read.

**Writer.** classifyImageRouted, geminiFetch, scripts/overnight-enrichment.mjs

**Reader.** geminiFetch (cap count), assay_photo_reading_flow, photo_analysis_yield_daily_refresh

**Where.** supabase/functions/photo-pipeline-orchestrator/classifierProvider.ts:195-213; supabase/functions/_shared/geminiGuard.ts:77-113; supabase/migrations/20261113120000_photo_reading_flow_assay_v2.sql:144-153,289

**Gap.** Subscription reads write no row. Gemini rows carry no tokens and no cost. When the legacy-prompt retry runs, only the second call's tokens are logged. The insert swallows its own errors. The table has no CREATE TABLE in the repo's migrations, so its columns are known only from these writers.

### Other paid keys in _shared: not reachable for the classifier (read)

**What exists.** The orchestrator imports only geminiGuard, writeGuard, supabaseKeys, cors and batChassis from _shared. The other paid modules serve other functions: llmRouter (Anthropic haiku/sonnet/opus with a price registry; its routing table names image_analysis as claude-haiku-4-5 with gpt-4o fallback) for agent-tier-router, haiku-extraction-worker, imessage-router and sonnet-supervisor; llmProvider (tier1 to expert, its own price table) for extract-vehicle-data-ai, identify-vehicle-from-image and others; visionFallback for api-v1-vision and check-image-vehicle-match, where the platform path platformVisionMultiJSON uses claude-haiku-5-5 on NUKE_PHOTO_ANTHROPIC_API_KEY behind a wallet hold and settle (ai_credit_ledger, margin 1.2, 2 to 14 images) and the system key pool is retired (2026-09-28); claudeSubscriptionAuth for agent-chat, analyze-with-claude, connect-claude and derive-title-ownership. The document route's worker tries Gemini flash, then claude-sonnet-4-20250514, then gpt-4o, then grok-2-vision-1212, and totals cost per day in ds_cost_tracking.

**Where.** supabase/functions/_shared/llmRouter.ts:100-323; supabase/functions/_shared/llmProvider.ts:28-51; supabase/functions/_shared/visionFallback.ts:1-17,27-31,99-179; supabase/functions/_shared/aiCredits.ts:20-55; supabase/functions/_shared/openaiCost.ts:17-23; supabase/functions/document-ocr-worker/index.ts:487-533,665-739

**Gap.** Seven separate price tables are typed in code (classifierProvider, classifier, llmProvider, llmRouter, aiCredits, openaiCost, document-ocr-worker inline) and none is in the database; the document worker hard-codes Gemini's cost as 0. The only true prepaid budget in the repo (hold, call, settle) is wired to the multi-image subject path, not to the classifier or the document route.

### Passes: how the first reading routes a second pass today (read)

**What exists.** After the first reading routeByType switches on image_type. Exterior, interior, detail close-up, undercarriage, other, VIN plate and progress shot, when the photo has a vehicle: enqueueDeepByok, which sets vision_gate_status to approved (unless already rejected or already deep) and refreshes the vehicle's coverage counter. Engine bay: the same enqueue plus a call to analyze-engine-bay. Part close-up: a call to part-number-ocr. Document: an immediate call to receipt-photo-ocr; with no supplied extraction that function asks document-ocr-worker to classify (unless a stored document type hint exists) and extract through the paid chain. No vehicle: no second pass. On the Mac path a document photo that the paid chain could not read is read again later by the subscription document reader, which picks photos with a document type or a failed route and no capture_document_pages row.

**Writer.** routeByType, enqueueDeepByok

**Reader.** deep-image-analysis-byok.mjs prepare/queue, byok-fleet-next.mjs

**Where.** supabase/functions/photo-pipeline-orchestrator/index.ts:926-1044,1066-1103,1133-1157,1159-1248; supabase/functions/receipt-photo-ocr/core.ts:333-375; supabase/functions/receipt-photo-ocr/index.ts:36-50; scripts/photo-pipeline/subscription-document-reader.mjs:70-82

**Gap.** The trigger for the dearer pass is the type label plus having a vehicle, never what the reading found (text present, a component, damage). Nearly every filed vehicle photo is therefore marked for the deep read. The mark is a column flip and a counter refresh: no queue row, receipt or reason is written. analyze-engine-bay and part-number-ocr have no source folder in the repo. A document photo can cost one subscription classifier read, one paid classify plus up to four paid extract attempts, and one subscription document read.

### Passes: the stage registry's conditional stages (read)

**What exists.** image_pipeline_stages allows two applicability words by CHECK: 'always' and 'document_like'. Four stages are registered: classifier (required), exif, engine_bay and receipt_ocr (all three not required). image_stage_gaps applies 'document_like' when the stored image_type is one of receipt, document, invoice or text_document. The case ledger states that deep, text and document levels have no stage worker.

**Where.** supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:69,81-86,269-296; supabase/functions/photo-pipeline-orchestrator/classifierTypes.ts:31-41; docs/ledger/theory/data-machine-cases.md:452-453

**Gap.** The classifier's only document label is receipt_document, which is not in the 'document_like' list, so if receipt_ocr were made required the predicate would match no current reading. There is no deep stage in the registry and no applicability word for it; the deep pass is tracked outside the ledger by the byok_deep_analysis marker and image_coverage_by_vehicle. The document reader writes receipt_ocr receipts for only two outcomes (succeeded, blocked_input).

### Free first passes that exist, and where they sit relative to the paid or subscription read (read)

**What exists.** Before upload, the phone's triage decides whether pixels leave the phone: clutter and documents (a document, receipt or web label in the top three) and personal frames (a prominent face with no work context) stay on the phone. In the orchestrator, before any provider call: a junk-URL skip, a cross-sweep duplicate skip, and an Apple-ML skip when vehicle_score is 0 and labels exist. On the Mac every 15 minutes, the vision gate's cheap layers (stored text, source, Apple labels, flags, sender affinity; 80 photos a vehicle, 40 vehicles a fire, no vision call) set vision_gate_status. In the queue: eligibility excludes duplicate, sensitive, external, superseded and rejected-personal photos and photos with no http URL, at enqueue and again at claim.

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:300-365; apps/nuke-capture-ios/Sources/NukeCapture/VisionDecision.swift:1-71; supabase/functions/photo-pipeline-orchestrator/index.ts:481-549,554-565; scripts/com.nuke.vision-gate-approver.plist:8-38; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:233-237; scripts/photo-pipeline/subscription-frame-classifier.mjs:136-148

**Gap.** On the Mac path the three orchestrator skips run after the read: the reader calls `claude` first and posts the answer, and the orchestrator returns its skip before it looks at classification_raw, so that read is spent and discarded (recorded as policy_skip). Queue eligibility does not consult vehicle_score or the vision gate's approved state. vehicle_score is written by image-intake from the Mac photo-sync script; no file under apps/ sends it, so phone-captured rows likely cannot trigger the Apple-ML skip (inferred from grep).

### The phone (free): what it can and cannot read (read)

**What exists.** Can, on the device at a stated ~50 ms an image with no network or key: Apple's fixed classification labels (the top 12 go to apple_ml_labels), an is-vehicle rule from those labels, prominent-face detection, the screenshot flag, text lines with their top three candidates, 17-character VINs checked by check digit (with the I/O/Q fix and at most one glyph repair), labelled pre-1981 serials of 8 to 16 characters at lower confidence, plate-shaped strings, a zone guess mapped from labels (engine_bay, interior, wheel, shop, outdoor_lot, road, exterior, paperwork) and a feature print for similarity. At most 40 readings an image are sent; they land through sync_local_vision_tags and the record_device_reading lane into image_observations.

**Where.** apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:1-13,22-52,92-102,197-220,381,410-415; apps/nuke-capture-ios/Sources/NukeCapture/OnDeviceAnalysis.swift:1-22,68-78,271-289,404-410; apps/nuke-capture-ios/Sources/NukeCapture/NativeIdentityOCR.swift:8-12; apps/nuke-capture-ios/Sources/NukeCapture/LocalTagPush.swift:1-14; scripts/daily-receipt/byok-vision-prompt.md:9-14; supabase/migrations/20261017160000_sync_vision_tags_capture_rows.sql:1-17

**Gap.** Cannot: name a make, model, year or trim; identify a component or place a box on one; read condition, damage, rust or paint state; relate two photos as before and after. Its labels are described in the repo as noisy guesses (a truck read as an airplane, a data plate as a document), and a part or interior close-up often gets no vehicle label. Classification runs on a 512 px (or 256 px) decode; only the identity text pass allows up to 4,096 px. Text and serials read from a document frame are not uploaded. The tag push reaches only capture-app rows (matched on the asset id).

### The deep read as it stands, and what it costs relative to a first reading (read)

**What exists.** The batch entry refuses anything but `--reviewed --vehicle-id UUID --limit 1..8 --out-dir PATH [--apply]`. It runs reviewed-image-batch.ts: the Codex CLI (`codex exec`) under a ChatGPT subscription login, model from BYOK_MODEL (default gpt-6-astra), reasoning effort medium, read-only sandbox, tools and MCP servers disabled. One batch is 1 to 8 photos of one vehicle (default 3) read in three model stages (draft, critique, revision); every stage attaches every photo again and carries the vehicle's context briefing, the prompt contract and the earlier stages' output. A stage may run for 150 s a photo plus 60 s; building the context may take 360 s; prepare loads every eligible image row of the vehicle. Photos are downloaded whole (HEIC through the renderer at 2,048 px q90, others as stored up to 40 MB). Admission goes through the orchestrator's record_reviewed_analysis with zero model calls. Relative to a first reading: three image readings instead of one, a far larger text context, and a larger model. Older figures for the retired engine: '~2-4 min/image' on Opus, '4 imgs / 15 min'.

**Writer.** reviewed-image-batch.ts, deep-image-analysis-byok.mjs ingest

**Reader.** photo-pipeline-orchestrator record_reviewed_analysis

**Where.** scripts/daily-receipt/byok-image-batch.sh:1-12; scripts/daily-receipt/reviewed-image-batch.ts:43-61,110,184-196,228-263,278-302,326-329,345-365; scripts/deep-image-analysis-byok.mjs:625-638,674-750; supabase/functions/photo-pipeline-orchestrator/reviewedAnalysis.ts:66-68,111-116; scripts/daily-receipt/byok-image-parallel.sh:5,9

**Gap.** No measured cost ratio exists. The batch writes cost_basis 'Subscription; per-image cost and duration not measured' and sets api_equivalent_cost_usd to null; per-stage token usage is kept only in run-receipt.json in the operator's output folder. The intake accepts agent_duration_ms and agent_cost_cents, and the batch does not send them.

### The deep read's schedulers are disconnected from its engine (read)

**What exists.** The GitHub workflow runs every 10 minutes on 4 shards (55-minute timeout, 45-minute budget, batch 12, model claude-sonnet-4-6, CLAUDE_CODE_OAUTH_TOKEN) and calls byok-cloud-drain.sh, which calls `byok-image-batch.sh <vehicle> <batch>`. That positional call now exits 2 with 'Legacy raw batch retired; no model or writes started'; the drain counts it as a failure and stops at three. The Mac launchd job (every 900 s, batch 15) reaches the same call through byok-image-drain.sh, whose catch-all branch logs 'batch ran ... more frames next fire' and exits 0. byok-fleet-batch.sh, byok-image-parallel.sh and byok-burn-all.sh make the same call. The app's Analyze button (trigger-analysis-run; minutes up to 30, batch up to 20) dispatches the same workflow. The design book says old unattended callers fail before model calls until deliberately migrated.

**Where.** .github/workflows/byok-analysis-drain.yml:54,72-86,130-160; scripts/daily-receipt/byok-cloud-drain.sh:139-154; scripts/daily-receipt/byok-image-drain.sh:83-89; scripts/daily-receipt/byok-fleet-batch.sh:38-51; scripts/daily-receipt/byok-image-batch.sh:5-8; scripts/daily-receipt/byok-drain.test.mjs:189-193; docs/library/technical/design-book/18-deep-image-analysis.md:114-116; supabase/functions/trigger-analysis-run/index.ts:73,94,116; scripts/com.nuke.byok-image-analysis.plist:13-25

**Gap.** Per the repo the deep pass has no unattended trigger: every scheduled or button-driven path ends before a model call. The orchestrator still marks photos for it. The Mac drain's log line reads like progress for a fire that did nothing. Whether the workflow or the launchd job is still enabled was not checked live.

### Deep read: order and the controls it has (read)

**What exists.** Vehicle order: `queue` lists the user's vehicles least-analysed first, then most pending; byok-fleet-next ranks by image_coverage_by_vehicle with score = unread last-7-day photos times 1,000,000 plus gated-unseen (new photos before backlog); the cloud drain gives one batch a vehicle in rotation. Inside a vehicle, `prepare --by-day` groups pending photos by capture day and takes the earliest day first; `--date` targets one day; `--image-ids` selects exact photos; `--rehash` re-reads verdicts that are not saturated. The saturation ledger skips a photo once nothing more can be extracted at the current schema version, and saturates after 2 dry passes. Other controls: batch size, the minutes budget, a failure budget of 1 to 10 (default 3), a quota exit code that stops a shard, 4 shards, and user_analysis_settings (method nuke_hosted, byo_api_key or byo_subscription; provider; model; tier default 'free'; enabled) resolved by the broker.

**Where.** scripts/deep-image-analysis-byok.mjs:81-95,134,139-175,697-750,1118-1168,1177-1231; scripts/daily-receipt/byok-fleet-next.mjs:39-59; scripts/daily-receipt/byok-cloud-drain.sh:30-34,122-155; supabase/migrations/20260621030000_user_analysis_settings.sql:15-27

**Gap.** This is the one place where earliest capture day first is hard-coded, per vehicle. There is no limit on deep reads a day. The settings row's tier column limits nothing in any reader I found (readers: the broker, vehicle-agent, trigger-analysis-run, the settings page; inferred from grep). The subscription readers on the Mac do not read user_analysis_settings at all.

### Telemetry from which the cost of a reading could be learned (read)

**What exists.** job_assay_readings: one row per reader, keyed by jobname and overwritten each fire; reading keys for the frame reader are frames, source, read, accepted, classifier_rejected, errors, error_classes, receipts, receipt_errors, stopped, by_type, read_seconds, plus zero_read_since and zero_read_fires; the document reader adds page, landed, waiting_no_vehicle, vehicle_document, to_land, relanded; elapsed_ms is the wrapper's wall time. image_stage_receipts: one row per attempt with stage, producer, producer_version, outcome, attempt, observed_at, retry_after, error_class, http_status, input_fingerprint and detail {reader, prompt_version, image_type, orchestrator_http, skipped}. image_stage_coverage() already returns receipts in 6 h and 24 h and the current outcome mix per stage. The paid classifier's receipt, stored inside ai_scan_metadata.classification, has tokens, estimated_cost_usd, timing_ms, image_bytes and retries. llm_cost_tracking and ds_cost_tracking hold paid calls. photo_analysis_yield_daily holds, per user and day: photos, filed_photos, rows_total, rows_analysis, mean_tables_touched, mean_coverage, mean_extraction, landing_rate, cited_evidence, mean_confidence and more. The action classifier_assay is a no-write, one-image Gemini probe that returns a full receipt.

**Where.** supabase/migrations/20261112120000_subscription_reader_heartbeat.sql:16-39,76; supabase/migrations/20261014090000_job_health_run_digest_and_assay_readings.sql:100-111; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:90-117,453-484; scripts/photo-pipeline/stage-queue.mjs:63-64,91-98; supabase/functions/photo-pipeline-orchestrator/classifierTypes.ts:5-28; supabase/migrations/20261113120000_photo_reading_flow_assay_v2.sql:279-323; supabase/functions/photo-pipeline-orchestrator/classifierAssay.ts:18-83

**Gap.** For a subscription read nothing stores seconds, tokens or cost per photo, and the heartbeat keeps one fire. Reads per day and the share of reads wasted (policy_skip after a read, invalid answers, rate limits) can be counted from image_stage_receipts, but no view or assay does it. The yield table has no cost, time or reader column, and the repo records it at 0 rows on 2026-11-10 after its cron failed every run from 2026-11-03 (20261113100000_photo_reading_flow_assay.sql:9-10). Its CREATE TABLE and llm_cost_tracking's are not in the repo.

### Other draws on the same subscription, and the one daily allowance that exists (read)

**What exists.** The night-run controller on the same Mac calls `claude -p` (default model claude-opus-5-5) under a daily allowance in seconds (NIGHT_RUN_CAP, default 45 minutes, shared by every invocation in a 01:30-to-01:30 window, tracked as spent_seconds) and defers six hours on a subscription-limit answer. Other scripts call the subscription CLI on demand (subject-classify-batch.sh, analyze-capture-photos.mjs, classify-unfiled-day.mjs, synthesize-day.mjs). The deep read uses a different subscription (ChatGPT, through Codex).

**Where.** scripts/night-run/controller.py:76,209,252-254,269-271,291-295; scripts/night-run/README.md:1-6,35-40; scripts/daily-receipt/subject-classify-batch.sh:60-63; scripts/daily-receipt/reviewed-image-batch.ts:48-50

**Gap.** The readers know nothing of the night-run's use or of interactive sessions on the same login. The night-run allowance is the only daily cap on subscription time in the repo, and it lives in a local state file for that one job.

### What a re-read buys today (inferred)

**What exists.** The first-pass switch-on sets the classifier contract to NULL so that only photos with no reading at all are queued, because 'today the fold is first-write-wins'. The case ledger gives the keys: photo_extracted_fields (image_id, field_name, source) and photo_text_lines (image_id, line_idx, source), written ON CONFLICT DO NOTHING, so a second reading under any prompt version lands nothing in those tables.

**Where.** supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:6-12,141; docs/ledger/theory/data-machine-cases.md:409-411,452-453

**Gap.** Compute spent on a second classifier reading currently changes the cached reading on the image row and nothing in the normalized tables. Taken from the migration comment and the case ledger; the landing fold's definition was not opened.

### Scale and measured times stated in the repo, each with its date (read)

**What exists.** Table: vehicle_images 62.7M rows, 57 GB heap, measured live 2026-11-08; 52.5M rows, 49 GB on 2026-10-15; '~32.7M rows pending' on 2026-07-06. Owner: 29,749 frames, 7,397 in the last 365 days (2026-11-08); 5,480 capture-app rows (2026-10-15); '~75K total' in the iPhoto library (2026-05-23, a draft chapter). Reading state: 8,816 of 26,941 owner images with no classification and 6,737 with a legacy reading (snapshot 2026-11-03, read 2026-11-10); 10,777 v98 readings against 31k+ owner rows, and about 21,000 'completed' without a current reading (2026-11-10). Paid history: OpenAI 12,076 calls, 11,006 answering 200, 10,924 of them on 2026-11-03, then only 429; every logged Gemini call 402 from 2026-10-15; 22,182 trigger calls in the 24 h to 2026-10-15, all failing at countTokens. Reader: 'frames 20, read 0, errors 20' in 5 s (2026-11-10 17:23-17:35 UTC); one sale sheet in 47 s; '~10-40 s each' (plist comment). Reconciler: 8.97 s and 13.21 s a run, each scanning 200 and queueing 100 (2026-11-10 19:08 UTC). Deep: corpus 29,063, gated 17,587, seen 8,632 (2026-06-17); '19 vehicles / 961 frames stuck at 0%' (workflow comment, undated); Gemini 2.5 Flash '$0.001/image' and 'parallel agents hit usage quotas around the 1.5-hour mark' (2026-05-23, marked not to be trusted). Phone: '~50ms/img'. Platform: on 2026-10-28 Supabase restricted the organisation (storage 763.69 GB of 110 GB, spend cap on) and every API request, the phone's relay included, was dropped.

**Where.** supabase/migrations/20261111190000_capture_ledger_index.sql:3-4; supabase/migrations/20261017160000_sync_vision_tags_capture_rows.sql:7-9; supabase/functions/photo-pipeline-orchestrator/index.ts:323-331; docs/library/technical/engineering-manual/18-deep-image-analysis.md:3-5,96,139-141,275-276; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:7-8; supabase/migrations/20261113100000_photo_reading_flow_assay.sql:4-12,22-23; docs/ledger/theory/data-machine-cases.md:383-390,395-399,435-440,3480-3482; supabase/migrations/20261015150000_photo_pipeline_trigger_skips_external_listing_photos.sql:6-7; docs/photo-landing-v3.md:44-45,68-69; scripts/com.nuke.subscription-reader.plist:23; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:3-4; .github/workflows/byok-analysis-drain.yml:46-47,76-78; apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift:6-7

**Gap.** These are quotations of dated comments, not current counts. No comment gives a measured number of subscription reads completed per hour or per day, or a measured cost for one deep read on the current engine.

### Where a spend cap and an order policy would naturally live (statement of the existing structure) (read)

**What exists.** Subscription first pass. Reads leave through three existing points: the plist's per-fire arguments and interval; claim_image_stage_work, the single hand-out of stage work, which already takes a limit and a user id and re-judges every item it hands out; and the platform_config row image_stage_reconciler, the only numeric settings, read by the SQL and by the reader. The number a cap would be compared with already exists: image_stage_receipts holds every attempt with observed_at under an index on (stage, observed_at desc), and image_stage_coverage() already returns receipts_24h. Order is decided in exactly two places: reconcile_image_stages (which photos enter the queue, in which lane, in what scan order) and the due/pick ordering inside claim_image_stage_work (which leave first); image_stage_work carries lane, not_before and created_at. Paid lane: gemini_spend_guard is the only cap object and llm_cost_tracking its counter; OpenAI's cost_cents rows land in the same table. Per user: user_analysis_settings is the only per-user compute row and ai_credit_ledger the only prepaid balance. Deep read: the drain's arguments (minutes, batch, failure budget) and prepare's selection flags (by-day, date, image-ids, rehash).

**Where.** scripts/com.nuke.subscription-reader.plist:15-26; supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql:94-137; supabase/migrations/20261113140000_image_stage_reconciler_refill.sql:165-289; supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql:116-138,161-165,453-484; supabase/functions/_shared/geminiGuard.ts:14-17,84-90; supabase/migrations/20260621030000_user_analysis_settings.sql:15-27; supabase/functions/_shared/aiCredits.ts:1-17; scripts/deep-image-analysis-byok.mjs:704-750

**Gap.** None of these points holds a read cap or a selectable order today. Missing, stated exactly: a stored limit to compare receipts_24h against; a reader-wide cool-down after a usage limit; any column on image_stage_work or argument on the claim that expresses priority (a vehicle, a job, a date range); any capture-time ordering in the first pass; and a per-read cost record to make a cap meaningful in anything but counts.

## To read from production

- platform_config: config_value for config_key in ('image_stage_reconciler','gemini_spend_guard','photo_classifier_provider','photo_pipeline_backlog'). The last two have no seed in the repo.
- image_pipeline_stages: stage, required, required_version, contract, applies_when, max_attempts for every row (is the classifier contract NULL or 'v98').
- supabase_migrations.schema_migrations: are versions 20261113110000, 20261113120000, 20261113130000 and 20261113140000 applied (is the stage queue actually switched on).
- select public.image_stage_coverage(): open work by lane and reason, current receipts by outcome, receipts_6h, receipts_24h, cursor position, wrapped_at.
- image_stage_receipts where stage = 'classifier': count by date(observed_at), outcome, error_class and detail->>'reader' (reads per day; share that are policy_skip after a read, classifier_response_invalid, reader_usage_limit, reader_timeout); count of distinct image_id with outcome 'succeeded'.
- job_assay_readings where jobname in ('subscription-frame-classifier','subscription-document-reader'): reading (frames, read, accepted, read_seconds, stopped, error_classes, zero_read_fires), elapsed_ms, assayed_at. read_seconds / read gives seconds per read for the last fire only.
- llm_cost_tracking: its columns (information_schema.columns), then per date, provider, model, caller and task: count, sum(input_tokens), sum(output_tokens), sum(cost_cents), avg(duration_ms). The rows for caller 'photo-pipeline-orchestrator' on 2026-11-03 give a measured paid cost per first reading.
- A bounded sample (for example 500 owner rows by primary key) of vehicle_images.ai_scan_metadata #> '{classification,classifier_receipt}': model, usage tokens, estimated_cost_usd, timing_ms.total, image_bytes, by model.
- Owner rows that are still unread and have vehicle_score = 0 with non-empty apple_ml_labels (reads the Mac path would spend and then discard), and how many owner rows have vehicle_score not null at all, by source.
- Owner rows: count by month of created_at and by year of taken_at, and count with taken_at null (how far upload order departs from capture order).
- cron.job: active, schedule and command for jobname in ('image-stage-reconciler','photo-pipeline-drain','photo-pipeline-drain-b','photo-pipeline-reset-stuck','subscription-reader-watch','photo-reading-flow-watch','photo-analysis-yield-hourly'); recent cron.job_run_details durations for image-stage-reconciler.
- photo_pipeline_provider_state where provider = 'classifier' (blocked_until, consecutive_failures, note) and photo_pipeline_retry_state: count by terminal and last_error_class.
- photo_analysis_yield_daily: its columns, row count, latest day, and the owner's rows (photos, rows_total, landing_rate, mean_coverage) for the days since 2026-11-10.
- image_coverage_by_vehicle for the owner's vehicles: sum(gated_t0), sum(seen_t1), sum(inflow_7d), sum(seen_7d) (the deep backlog that nothing drains), and count(*) from user_image_deep_reads.
- user_analysis_settings for the owner: method, provider, model, tier, enabled.
- ds_cost_tracking: total_extractions, total_cost_usd and tokens by date, provider and model.
- user_image_counts: sum(n_all) for the owner (the population any reads-per-day figure is measured against).
- Outside the database: GitHub Actions run history for byok-analysis-drain.yml (enabled or not, conclusion and minutes per run); on the Mac, launchctl state and the installed copies of com.nuke.subscription-reader.plist and com.nuke.byok-image-analysis.plist, and the per-fire files ~/nuke/logs/subscription-frame-classifier-*.json (read, read_seconds, stopped) for a history of seconds per read.

## Open questions

- Which model does the alias `sonnet` resolve to under the owner's login, and how much of the 5-hour and weekly allowance does one first reading use? Nothing in the repo records either.
- Does the Claude CLI's Read tool shrink a full-size JPEG before the model sees it, and to what size? The scripts do not bound it and do not record it.
- When the owner says 'earliest photos first', is the clock capture time (taken_at) or upload time (created_at)? The stage queue's backfill lane uses upload time; the deep read uses capture day; the two reader worklists use newest capture time first.
- Is the GitHub drain still enabled and failing on four runners every 10 minutes, and is the Mac's com.nuke.byok-image-analysis job still loaded and logging no-op fires?
- What does one deep read on the current engine (Codex, three stages, up to 8 photos) cost in time and tokens? The only figures in the repo are 2026-05/06 estimates for the retired `claude --print` engine.
- Do phone-captured rows ever carry vehicle_score, or only rows that came through the Mac photo-sync script? If not, the Apple-ML skip never fires for the phone's photos.
- A document photo gets a classifier reading whose checklist already asks for document fields, and separately a document read. Are both readings used downstream, or is one of them spend with no consumer? (Some migrations read classification.v2.document; I did not trace which.)
- Are analyze-engine-bay and part-number-ocr deployed anywhere? Their source is not in the repo, yet the orchestrator's engine-bay and part close-up routes call them.
- Is the repo's plist (20 and 20 every 600 s) the copy installed on the Mac? It is installed by hand, so the running pace may differ.
- Who else draws on the same Claude subscription at the same time (night-run, hand-run scripts, interactive sessions), and should the readers' pace account for that? Nothing in the repo coordinates them.
