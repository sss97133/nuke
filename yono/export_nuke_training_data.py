"""
Export Nuke platform data as instruction-tuning JSONL for LLM fine-tuning.

Pulls from Supabase:
- Vehicle extractions (description → structured data)
- Field evidence chains (provenance)
- Comment discoveries (sentiment analysis examples)
- Schema knowledge (DDL, pipeline_registry)
- Domain knowledge (RPO codes, paint codes, make/model patterns)

Outputs: /data/nuke-agent/train.jsonl + val.jsonl (90/10 split)

Usage:
    modal run yono/export_nuke_training_data.py
    modal run yono/export_nuke_training_data.py --limit 50000
    modal run yono/export_nuke_training_data.py --notify  # Send Telegram updates
"""

import modal
import os

app = modal.App("nuke-export-training-data")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "supabase",
        "tqdm",
    ])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)


def send_telegram(message: str, bot_token: str, chat_id: str):
    """Send a Telegram notification."""
    import urllib.request
    import json
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "Markdown"}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[telegram] Failed: {e}")


@app.function(
    image=image,
    timeout=7200,
    volumes={"/data": volume},
    secrets=[
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("nuke-sidecar-secrets"),
    ],
    memory=32768,
)
def export_training_data(limit: int = 100000, notify: bool = True):
    """Export Nuke data as instruction-tuning examples."""
    import json
    import random
    from datetime import datetime
    from supabase import create_client

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")

    def dispatch(msg):
        print(msg)
        if notify and bot_token and chat_id:
            send_telegram(msg, bot_token, chat_id)

    dispatch(f"🏁 *Nuke Training Export Started*\nLimit: {limit:,}\nTime: {datetime.now().strftime('%H:%M:%S')}")

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    examples = []
    stats = {"extractions": 0, "evidence": 0, "comments": 0, "schema": 0, "domain": 0}

    # ── 1. Vehicle extraction examples ──────────────────────────
    # Input: description/listing text → Output: structured vehicle data
    dispatch("📋 Exporting vehicle extractions...")

    offset = 0
    page_size = 1000
    while len(examples) < limit:
        resp = supabase.table("vehicles").select(
            "id, year, make, model, trim, vin, sale_price, mileage, "
            "color, interior_color, transmission, engine_type, engine_size, "
            "drivetrain, body_style, description, highlights, equipment, auction_source"
        ).not_.is_("description", "null").not_.is_("make", "null").range(offset, offset + page_size - 1).execute()

        if not resp.data:
            break

        for v in resp.data:
            desc = (v.get("description") or "").strip()
            if len(desc) < 50:
                continue

            # Build the structured output
            structured = {}
            for field in ["year", "make", "model", "trim", "vin", "sale_price", "mileage",
                          "color", "interior_color", "transmission", "engine_type", "engine_size",
                          "drivetrain", "body_style", "highlights", "equipment"]:
                val = v.get(field)
                if val is not None and val != "" and val != []:
                    structured[field] = val

            if len(structured) < 4:
                continue

            examples.append({
                "messages": [
                    {"role": "system", "content": "You are a vehicle data extraction specialist. Extract structured data from auction listing descriptions. Return valid JSON with all fields you can identify."},
                    {"role": "user", "content": f"Extract structured vehicle data from this {v.get('auction_source', 'auction')} listing:\n\n{desc[:3000]}"},
                    {"role": "assistant", "content": json.dumps(structured, indent=2)},
                ]
            })
            stats["extractions"] += 1

        offset += page_size
        if offset % 10000 == 0:
            dispatch(f"  ...{stats['extractions']:,} extraction examples so far")

    dispatch(f"✅ Extractions: {stats['extractions']:,}")

    # ── 2. Field evidence examples ──────────────────────────────
    # Train the model to cite sources for claims
    dispatch("🔍 Exporting field evidence chains...")

    offset = 0
    while stats["evidence"] < min(limit // 4, 25000):
        resp = supabase.table("field_evidence").select(
            "vehicle_id, field_name, proposed_value, source_confidence, source_type, extraction_context, status"
        ).range(offset, offset + page_size - 1).execute()

        if not resp.data:
            break

        # Group by vehicle
        by_vehicle = {}
        for row in resp.data:
            vid = row["vehicle_id"]
            if vid not in by_vehicle:
                by_vehicle[vid] = []
            by_vehicle[vid].append(row)

        for vid, evidence_rows in by_vehicle.items():
            if len(evidence_rows) < 3:
                continue

            evidence_text = "\n".join(
                f"- {r['field_name']}: \"{r.get('proposed_value', '?')}\" "
                f"(confidence: {r.get('source_confidence', '?')}, source: {r.get('source_type', '?')}, "
                f"context: \"{(r.get('extraction_context') or '')[:200]}\")"
                for r in evidence_rows[:20]
            )

            examples.append({
                "messages": [
                    {"role": "system", "content": "You are a vehicle data verification specialist. Given field evidence with source citations, assess data quality and flag any conflicts or low-confidence values."},
                    {"role": "user", "content": f"Review the evidence chain for vehicle {vid}:\n\n{evidence_text}"},
                    {"role": "assistant", "content": _generate_evidence_review(evidence_rows)},
                ]
            })
            stats["evidence"] += 1

        offset += page_size

    dispatch(f"✅ Evidence chains: {stats['evidence']:,}")

    # ── 3. Comment discovery examples ───────────────────────────
    # Train on rich comment analysis
    dispatch("💬 Exporting comment discoveries...")

    offset = 0
    while stats["comments"] < min(limit // 4, 25000):
        resp = supabase.table("comment_discoveries").select(
            "vehicle_id, overall_sentiment, sentiment_score, total_fields, "
            "raw_extraction, model_used, data_quality_score, missing_data_flags"
        ).not_.is_("raw_extraction", "null").range(offset, offset + page_size - 1).execute()

        if not resp.data:
            break

        for disc in resp.data:
            raw = disc.get("raw_extraction")
            if not raw or (isinstance(raw, dict) and len(raw) < 2):
                continue

            analysis = {
                "sentiment": disc.get("overall_sentiment"),
                "sentiment_score": disc.get("sentiment_score"),
                "total_fields_extracted": disc.get("total_fields"),
                "data_quality_score": disc.get("data_quality_score"),
                "missing_data_flags": disc.get("missing_data_flags"),
                "extraction": raw if isinstance(raw, dict) else str(raw)[:2000],
            }

            # Get some actual comments for this vehicle
            comments_resp = supabase.table("auction_comments").select(
                "comment_text, author_username"
            ).eq("vehicle_id", disc["vehicle_id"]).limit(15).execute()

            if not comments_resp.data or len(comments_resp.data) < 3:
                continue

            comment_block = "\n".join(
                f"@{c.get('author_username', 'anon')}: {(c.get('comment_text') or '')[:300]}"
                for c in comments_resp.data
            )

            examples.append({
                "messages": [
                    {"role": "system", "content": "You are an auction comment analyst. Analyze collector vehicle auction comments to extract sentiment, themes, notable claims about the vehicle, and red flags. Comments are rhizomatic — they reveal info about the vehicle, the commenter, auction dynamics, and market sentiment."},
                    {"role": "user", "content": f"Analyze these auction comments:\n\n{comment_block}"},
                    {"role": "assistant", "content": json.dumps(analysis, indent=2)},
                ]
            })
            stats["comments"] += 1

        offset += page_size

    dispatch(f"✅ Comment discoveries: {stats['comments']:,}")

    # ── 4. Schema knowledge examples ────────────────────────────
    dispatch("📐 Generating schema knowledge examples...")

    schema_examples = [
        {
            "messages": [
                {"role": "user", "content": "What table stores vehicle images and what are its key columns?"},
                {"role": "assistant", "content": "vehicle_images — 33M+ rows. Key columns: id (uuid PK), vehicle_id (FK to vehicles), image_url, storage_path, angle (classified by YONO), zone (41 zones), ai_processing_status (pending/processing/completed/failed/skipped), optimization_status (pending/processing/optimized/failed), organization_status (unorganized/organized/ignored), source, width, height, file_size, position. Images flow through photo-pipeline-orchestrator for AI analysis, and yono-classify for zone/angle detection."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "How does the observation system work?"},
                {"role": "assistant", "content": "All data flows through a unified observation pipeline: [Any Source] → ingest-observation → vehicle_observations → discover-from-observations → observation_discoveries. Sources are registered in observation_sources with category (auction/forum/social_media/marketplace/registry/shop/owner/documentation), base_trust_score, and supported observation kinds. Each observation stores raw_payload and structured_data as JSONB, with observed_at timestamp and trust_score. This is source-agnostic — adding a new source is config, not code."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "What's the pipeline_registry and why does it matter?"},
                {"role": "assistant", "content": "pipeline_registry has 63 entries mapping table.column → owning edge function. It prevents write conflicts — before writing to any field, you MUST check who owns it: SELECT owned_by, do_not_write_directly, write_via FROM pipeline_registry WHERE table_name='vehicles' AND column_name='nuke_estimate'; For example, nuke_estimate is owned by compute-vehicle-valuation. Writing to it directly from another function would create a data fork."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "How should I batch a large UPDATE on the vehicles table?"},
                {"role": "assistant", "content": "Never run unbounded UPDATE/DELETE on vehicles. Use batched writes:\n\nDO $$\nDECLARE batch_size INT := 1000; affected INT;\nBEGIN\n  LOOP\n    UPDATE vehicles SET your_column = 'value'\n    WHERE id IN (\n      SELECT id FROM vehicles WHERE your_condition LIMIT batch_size\n    );\n    GET DIAGNOSTICS affected = ROW_COUNT;\n    EXIT WHEN affected = 0;\n    PERFORM pg_sleep(0.1);\n  END LOOP;\nEND $$;\n\nAfter EVERY batch, check locks: SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'; If > 0, stop and investigate. Statement timeout is 120s — respect it. A single unbounded UPDATE on vehicles caused a full API outage (PGRST002) on 2026-02-27."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "What is the Auction Readiness Score?"},
                {"role": "assistant", "content": "ARS is a 0-100 composite across 6 dimensions: identity (VIN, year/make/model completeness), photos (8 MVPS zones + 12 competitive zones coverage), documentation (title, build sheet, service records), description (quality and completeness), market (comparable sales data), condition (inspection data, disclosure). Tiers: TIER 1 (90-100, auction-ready) → TIER 5 (0-34, discovery-only). Currently ~99% of vehicles are TIER 4-5 because they lack first-party owner data. The coaching engine generates priority-ranked actions to close gaps. Tables: auction_readiness, ars_tier_transitions."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "Explain the extraction pipeline phases."},
                {"role": "assistant", "content": "Phase 1 — DOCUMENTATION: Parse text sources (title, description, auction comments, VIN decode, bid history). Key insight: descriptions are TESTIMONY with HALF-LIVES — each claim decays by category (mechanical claims decay faster than cosmetic). Phase 2 — VISION BLIND: YONO model processes images with zero context — raw visual observations (zone classification, make detection, condition scoring). Phase 3 — VISION CONTEXTUAL: Compare blind observations against documentation. Seller says 'matching numbers' but engine bay photo shows aftermarket headers? That's a discovery. Phase 4 — DISCREPANCY DETECTION: Flag mismatches for valuation adjustment. Trim is forensic: factory trim (SPID/build sheet) vs current presentation (photos) — the delta tells the story of every modification."},
            ]
        },
    ]
    examples.extend(schema_examples)
    stats["schema"] = len(schema_examples)

    dispatch(f"✅ Schema knowledge: {stats['schema']:,}")

    # ── 5. Domain knowledge examples ────────────────────────────
    dispatch("🚗 Generating domain knowledge examples...")

    domain_examples = [
        {
            "messages": [
                {"role": "user", "content": "What makes a matching-numbers vehicle more valuable?"},
                {"role": "assistant", "content": "Matching numbers means the major drivetrain components (engine, transmission, sometimes rear axle) have serial numbers or casting codes that match the vehicle's VIN or build documentation, confirming they're the original factory-installed parts. This adds approximately +60% to value because it proves the vehicle's mechanical provenance is intact. Verification requires: VIN decode → component stamp comparison → build sheet cross-reference. In Nuke, this is tracked through field_evidence chains linking VIN data to component observations. A vehicle claiming matching numbers without photographic evidence of the stamps is flagged as unverified."},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "How do BaT auction comments provide intelligence beyond the listing?"},
                {"role": "assistant", "content": "BaT comments are rhizomatic — they reveal multiple intelligence layers simultaneously. About the vehicle: commenters with domain expertise often spot details the seller missed (incorrect part numbers, non-original components, undisclosed repairs). About the commenter: username history reveals expertise level, buying patterns, geographic base. About auction dynamics: comment velocity and sentiment predict sell-through probability. About the market: comparative references ('this is cleaner than the $45K one last month') reveal real-time market sentiment. We have 11.5M comments across 141K vehicles with 496K unique commenters. 123K have programmatic-v1 discovery (weak pattern matching), 2,751 have Claude Haiku analysis (rich semantic extraction)."},
            ]
        },
    ]
    examples.extend(domain_examples)
    stats["domain"] = len(domain_examples)

    dispatch(f"✅ Domain knowledge: {stats['domain']:,}")

    # ── Shuffle and split ───────────────────────────────────────
    total = len(examples)
    random.shuffle(examples)

    split_idx = int(total * 0.9)
    train = examples[:split_idx]
    val = examples[split_idx:]

    # ── Write to volume ─────────────────────────────────────────
    os.makedirs("/data/nuke-agent", exist_ok=True)

    with open("/data/nuke-agent/train.jsonl", "w") as f:
        for ex in train:
            f.write(json.dumps(ex) + "\n")

    with open("/data/nuke-agent/val.jsonl", "w") as f:
        for ex in val:
            f.write(json.dumps(ex) + "\n")

    volume.commit()

    summary = (
        f"✅ *Nuke Training Export Complete*\n\n"
        f"📊 *Stats:*\n"
        f"  Extractions: {stats['extractions']:,}\n"
        f"  Evidence chains: {stats['evidence']:,}\n"
        f"  Comment analyses: {stats['comments']:,}\n"
        f"  Schema examples: {stats['schema']:,}\n"
        f"  Domain examples: {stats['domain']:,}\n\n"
        f"📁 *Output:*\n"
        f"  Train: {len(train):,} examples\n"
        f"  Val: {len(val):,} examples\n"
        f"  Location: /data/nuke-agent/\n\n"
        f"🚀 *Next:* `modal run yono/modal_nuke_agent_train.py`"
    )
    dispatch(summary)

    return {"total": total, "train": len(train), "val": len(val), "stats": stats}


def _generate_evidence_review(evidence_rows):
    """Generate a review assessment from evidence rows."""
    import json
    high_conf = [r for r in evidence_rows if (r.get("source_confidence") or 0) >= 0.8]
    low_conf = [r for r in evidence_rows if (r.get("source_confidence") or 0) < 0.5]
    fields = list(set(r["field_name"] for r in evidence_rows))

    review = {
        "total_evidence_points": len(evidence_rows),
        "high_confidence_fields": [r["field_name"] for r in high_conf[:10]],
        "low_confidence_fields": [{"field": r["field_name"], "confidence": r.get("source_confidence"), "reason": "low extraction confidence"} for r in low_conf[:5]],
        "fields_covered": fields[:20],
        "data_quality_assessment": "strong" if len(high_conf) > len(evidence_rows) * 0.7 else "moderate" if len(high_conf) > len(evidence_rows) * 0.4 else "needs_verification",
    }
    return json.dumps(review, indent=2)


@app.local_entrypoint()
def main(limit: int = 100000, notify: bool = True):
    """Export Nuke training data to Modal volume."""
    print(f"Exporting up to {limit:,} training examples...")
    result = export_training_data.remote(limit=limit, notify=notify)
    import json
    print(f"\nResult: {json.dumps(result, indent=2)}")
