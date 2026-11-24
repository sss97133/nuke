-- DRAFT — NOT APPLIED. Seeds the registry with what main@980c887 hardcodes today
-- (status active/fallback, approved_by marks them as pre-registry), plus candidates
-- found in the Nov 2026 market check (status candidate: inert, no spend).
-- Prices: USD per 1M tokens, list price, sources in README.

begin;

insert into public.model_tasks (task, description, modality, privacy_critical, quality_floor_model) values
  ('photo_classify',      'Server photo classifier: is-vehicle, image_type, angle, vehicle hints, VIN text, privacy cues', 'vision', true, null),
  ('photo_deep_read',     'Deep per-photo read (claude-cli deep-stage, two-pass agreement)', 'vision', false, null),
  ('photo_keyed_values',  'Closed-value keyed reads from a photo (keys_lane / keyed_values stage)', 'vision', false, null),
  ('photo_gate',          'Subscription gate reader: should this photo go further', 'vision', true, null),
  ('document_ocr',        'Document OCR + field extraction (document-ocr-worker, title, receipt, deal jacket)', 'document', true, null),
  ('sensitive_document',  'Detect IDs, titles, financial docs (detect-sensitive-document)', 'vision', true, null),
  ('vin_read',            'Read and validate a VIN / part number from a plate or tag photo', 'vision', false, null),
  ('place_day_synthesis', 'Place match + day synthesis from a day of photos (synthesize-day, classify-unfiled-day)', 'text', false, null),
  ('comment_extract',     'Auction comment claim extraction (batch-comment-discovery)', 'text', false, 'claude-sonnet-5-5'),
  ('listing_extract',     'Listing / description field extraction (extract-*, discover-description-data)', 'text', false, null),
  ('long_reasoning',      'Agent chat, title ownership, analyze-with-claude, due diligence', 'text', false, 'claude-sonnet-5-5'),
  ('image_embedding',     'CLIP embeddings (local, ViT-B/32)', 'embedding', false, null),
  ('on_device_vision',    'Apple Vision on iPhone: classify, OCR, faces, feature print (free)', 'on_device', true, null)
on conflict (task) do nothing;

-- Active + fallbacks exactly as the code runs today
insert into public.model_registry (task, provider, model, version, status, fallback_rank, price_input_per_mtok, price_output_per_mtok,
  price_source_url, price_checked_at, provider_deprecated_at, provider_shutdown_at, approved_by, approved_at, discovered_by, notes) values
  ('photo_classify','openai','gpt-4.1-mini','gpt-4.1-mini-2025-04-14','active',null,0.40,1.60,
   'https://developers.openai.com/api/docs/pricing','2026-11-23','2026-10-14','2027-01-14','pre-registry hardcode (classifierProvider.ts:22)',now(),'manual',
   '30d: 11,006 ok calls, $29.14, avg 5,311 in / 327 out tokens, 920 HTTP 429, 323 timeouts'),
  ('photo_classify','google','gemini-flash-latest',null,'fallback',1,0.30,2.50,
   'https://ai.google.dev/gemini-api/docs/pricing','2026-11-23',null,null,'pre-registry hardcode (classifier.ts:10)',now(),'manual',
   'Fallback is effectively dead: 30d = 424 HTTP 402 + 64 HTTP 403, zero successes'),
  ('photo_deep_read','claude_cli','claude-sonnet-5-5',null,'active',null,0,0,null,'2026-11-23',null,null,'pre-registry hardcode (scripts/photo-pipeline/deep-stage.mjs:22)',now(),'manual','subscription; 30d receipts: deep_reading 85'),
  ('photo_keyed_values','claude_cli','claude-sonnet-5-5',null,'active',null,0,0,null,'2026-11-23',null,null,'pre-registry hardcode (keys_lane.py default "sonnet")',now(),'manual','subscription; 30d receipts: 177'),
  ('photo_gate','claude_cli','sonnet',null,'active',null,0,0,null,'2026-11-23',null,null,'pre-registry hardcode (subscription_gate_reader.py:199)',now(),'manual','UNPINNED ALIAS "sonnet"; 30d classifier-stage receipts: 7,656 alias + 231 pinned'),
  ('document_ocr','anthropic','claude-sonnet-5-5',null,'active',null,2,10,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23',null,null,'pre-registry hardcode (document-ocr-worker/index.ts:426)',now(),'manual',null),
  ('document_ocr','openai','gpt-4o','gpt-4o-2024-08-06','fallback',1,2.50,10,'https://developers.openai.com/api/docs/pricing','2026-11-23','2026-10-14','2027-01-14','pre-registry hardcode (document-ocr-worker/index.ts:597)',now(),'manual',null),
  ('document_ocr','xai','grok-2-vision-1212',null,'fallback',2,2,10,null,'2026-11-23','2026-02-03','2026-02-28','pre-registry hardcode (document-ocr-worker/index.ts:637)',now(),'manual','ALREADY SHUT DOWN by xAI 2026-02-28 — dead fallback'),
  ('sensitive_document','openai','gpt-4o','gpt-4o-2024-08-06','active',null,2.50,10,'https://developers.openai.com/api/docs/pricing','2026-11-23','2026-10-14','2027-01-14','pre-registry hardcode (detect-sensitive-document/index.ts:281)',now(),'manual',null),
  ('sensitive_document','anthropic','claude-sonnet-5-5',null,'fallback',1,2,10,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23',null,null,'pre-registry hardcode (detect-sensitive-document/index.ts:343)',now(),'manual',null),
  ('place_day_synthesis','claude_cli','claude-opus-5-5',null,'active',null,0,0,null,'2026-11-23',null,null,'pre-registry hardcode (synthesize-day.mjs:296, classify-unfiled-day.mjs:41)',now(),'manual','subscription'),
  ('comment_extract','anthropic','claude-sonnet-5-5',null,'active',null,2,10,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23',null,null,'pre-registry hardcode (batch-comment-discovery/deriveComment.ts:6)',now(),'manual','30d: 185 sonnet-5-5 + 1,148 haiku-5-5 rows in comment_discoveries'),
  ('long_reasoning','anthropic','claude-opus-5-5',null,'active',null,4,20,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23',null,null,'pre-registry hardcode (agent-chat:40, analyze-with-claude:39, derive-title-ownership:40)',now(),'manual',null),
  ('image_embedding','local','ViT-B-32-quickgelu','openai',  'active',null,0,0,null,'2026-11-23',null,null,'pre-registry hardcode (scripts/clip-embed-image-observations.py:56)',now(),'manual','zero API cost'),
  ('on_device_vision','apple','VNClassifyImageRequest','revision2','active',null,0,0,null,'2026-11-23',null,null,'pre-registry hardcode (VisionEngine.swift:205)',now(),'manual','plus VNRecognizeTextRequest default rev, VNDetectFaceRectanglesRequest rev3, VNGenerateImageFeaturePrint default')
on conflict do nothing;

-- Candidates (inert until approved). Nov 2026 market check.
insert into public.model_registry (task, provider, model, version, status, price_input_per_mtok, price_output_per_mtok, price_per_page,
  price_source_url, price_checked_at, discovered_by, params, notes) values
  ('photo_classify','openai','gpt-6-luna',null,'candidate',0.10,0.50,null,'https://developers.openai.com/api/docs/models/gpt-6-luna','2026-11-23','manual','{"reasoning_effort":"none"}',
   'OpenAI''s listed replacement for gpt-4.1-mini. Same tokens as today => ~$0.0007/call vs $0.0026 (-74%). Image token accounting must be measured.'),
  ('photo_classify','anthropic','claude-haiku-5-5',null,'candidate',0.10,0.50,null,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23','manual','{"effort":"low"}',
   'Second-provider fallback to replace dead Gemini. 1568px long edge => ~2.4k visual tokens. Retirement not before 2027-10-07.'),
  ('photo_classify','google','gemini-3.5-flash-lite',null,'candidate',0.30,2.50,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-11-23','manual','{"thinking":"minimal"}','Needs Gemini billing restored (402 today).'),
  ('photo_classify','google','gemini-3.1-flash-lite',null,'candidate',0.25,1.50,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-11-23','manual','{}','Needs Gemini billing restored (402 today).'),
  ('photo_classify','openai','gpt-5.4-nano',null,'candidate',0.20,1.25,null,'https://developers.openai.com/api/docs/pricing','2026-11-23','manual','{"reasoning_effort":"none"}',null),
  ('document_ocr','mistral','mistral-ocr-4.1',null,'candidate',null,null,0.004,'https://docs.mistral.ai/models/ocr-4-1','2026-11-23','manual','{}','Per page: $0.004 ($0.005 annotated, batch 50% off). Pure OCR; pair with a cheap LLM for fields.'),
  ('document_ocr','anthropic','claude-haiku-5-5',null,'candidate',0.10,0.50,null,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23','manual','{}','20x cheaper than Sonnet 5.5 for field extraction; test on titles/receipts.'),
  ('document_ocr','openai','gpt-6-luna',null,'candidate',0.10,0.50,null,'https://developers.openai.com/api/docs/models/gpt-6-luna','2026-11-23','manual','{"reasoning_effort":"low"}','Replaces gpt-4o fallback (shuts down 2027-01-14).'),
  ('sensitive_document','openai','gpt-6-luna',null,'candidate',0.10,0.50,null,'https://developers.openai.com/api/docs/models/gpt-6-luna','2026-11-23','manual','{"reasoning_effort":"none"}','Replaces gpt-4o (shuts down 2027-01-14). Privacy-critical: recall may not regress.'),
  ('vin_read','apple','RecognizeDocumentsRequest','iOS26',      'candidate',0,0,null,'https://developer.apple.com/documentation/vision/recognizedocumentsrequest','2026-11-23','manual','{}','Free, on-device; structured text, tables, barcodes.'),
  ('vin_read','anthropic','claude-haiku-5-5',null,'candidate',0.10,0.50,null,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23','manual','{}','Only for crops where on-device OCR fails the ISO 3779 check digit.'),
  ('on_device_vision','apple','RecognizeDocumentsRequest','iOS26','candidate',0,0,null,'https://developer.apple.com/documentation/vision/recognizedocumentsrequest','2026-11-23','manual','{}','Free. Plus DetectLensSmudgeRequest to reject hazy shots before any paid pass.'),
  ('long_reasoning','anthropic','claude-sonnet-5-5',null,'candidate',2,10,null,'https://platform.claude.com/docs/en/about-claude/pricing','2026-11-23','manual','{}','Half of Opus 5.5 price; eval on title-ownership + due-diligence gold before moving.'),
  ('long_reasoning','google','gemini-3.8-flash',null,'candidate',0.75,3.75,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-11-23','manual','{}','Price doubles 2027-01-01 ($1.50/$7.50).'),
  ('listing_extract','openai','gpt-6-luna',null,'candidate',0.10,0.50,null,'https://developers.openai.com/api/docs/models/gpt-6-luna','2026-11-23','manual','{"reasoning_effort":"none"}','Replaces gpt-4o-mini/gpt-4o in extract-*, enrich-* (shut down 2027-01-14).')
on conflict do nothing;

-- Shadow budgets: present but OFF. Turning one on needs approved_by.
insert into public.model_shadow_budget (task, sample_pct, monthly_cap_usd, enabled) values
  ('photo_classify', 2, 2, false), ('document_ocr', 2, 2, false), ('sensitive_document', 2, 1, false)
on conflict (task) do nothing;

commit;
