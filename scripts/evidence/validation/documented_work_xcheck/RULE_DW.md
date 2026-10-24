# documented_work image+OCR cross-check (pre-registered 2026-10-23, before any OCR result was viewed)
Sample: dw260.json = 260 graded-v2 cars with >=1 documented_work claim (seed 31), gallery tail images (position rank > 0.65*n).
Detector: CLIP ViT-B/32 zero-shot, P("a photo of a paper document or receipt") among the 6 scene prompts >= 0.85 => document image.
doc_type: argmax among doctype prompts (receipt/invoice, service record, window sticker, title/registration, Carfax-style history report, owner manual/book).
OCR: rapidocr_onnxruntime on the image re-fetched at w=1600. Lines with conf>=0.5. Text kept if >=20 words.
work_categories: graded/extract_v2.py CAT regexes applied to OCR text (same vocabulary as the description extractor).
Unit: each graded-v2 documented_work claim (vehicle, value_text category), deduped per (vehicle, category).
Checkable: the vehicle has >=1 receipt_invoice/service_record doc with OCR text kept.
Agree: some checkable doc of that vehicle has the claim's category in work_categories.
Gate: checkable n>=200 and agree/n >= 0.90 => record structured_crosscheck independent_source=true; else record and do not backfill.
