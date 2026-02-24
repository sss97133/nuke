#!/usr/bin/env python3
"""
Local OCR worker using Ollama vision models — pipelined for max throughput.

Pre-fetches images while GPU processes, defers entity linking to batch pass.
Achieves ~4-5 docs/min on Apple Silicon vs ~2.9/min sequential.

Usage:
    dotenvx run -- python3 -u ollama_ocr_worker.py              # Process all pending
    dotenvx run -- python3 -u ollama_ocr_worker.py --limit 50   # Process 50
    dotenvx run -- python3 -u ollama_ocr_worker.py --continuous  # Until queue empty
    dotenvx run -- python3 -u ollama_ocr_worker.py --link-only  # Batch entity linking
"""

import os
import sys
import json
import base64
import argparse
import time
import re
import urllib.request
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue
import threading

# ─── Config ─────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OLLAMA_URL = "http://localhost:11434"
VISION_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2-vision:11b")
WORKER_ID = f"ollama-worker-{os.getpid()}"
STORAGE_BUCKET = "deal-documents"

# ─── Document Type Prompts ──────────────────────────────────────────────────

DOC_TYPES = [
    "title", "bill_of_sale", "buyers_order", "cost_sheet", "repair_order",
    "odometer_disclosure", "deal_jacket", "receipt", "auction_slip",
    "smog_certificate", "registration", "insurance_card", "shipping_bill",
    "consignment_agreement", "lien_release", "other"
]

CLASSIFY_PROMPT = f"""Look at this document image carefully. What type of document is it?

Reply with ONLY valid JSON in this exact format:
{{"document_type": "TYPE", "confidence": NUMBER, "orientation_degrees": NUMBER}}

Where TYPE must be one of: {', '.join(DOC_TYPES)}
confidence is 0-100 (how sure you are)
orientation_degrees is 0, 90, 180, or 270 (rotation needed to read it)

Reply with ONLY the JSON object, nothing else."""

SINGLE_PASS_PROMPT = f"""Classify and OCR this document. Return ONLY JSON:
{{"document_type":"TYPE","confidence":N,"vin":null,"year":null,"make":null,"model":null,"names":[],"amounts":[],"dates":[],"odometer":null,"raw_text":"key text"}}
TYPE must be one of: {', '.join(DOC_TYPES)}
Only extract what you can read. Null if unclear."""

EXTRACT_PROMPTS = {
    "title": """Extract ALL readable fields from this vehicle title. Return ONLY valid JSON:
{"vin": null, "year": null, "make": null, "model": null, "body_style": null,
 "title_number": null, "state": null, "issue_date": null,
 "owner_names": [], "owner_address": null,
 "lienholder_name": null, "odometer": null, "odometer_status": null}
CRITICAL: Only extract text you can ACTUALLY READ in the image. Use null for anything you cannot read clearly. VINs are exactly 17 characters. Dates must be YYYY-MM-DD.""",

    "bill_of_sale": """Extract ALL readable fields from this bill of sale. Return ONLY valid JSON:
{"vin": null, "year": null, "make": null, "model": null,
 "buyer_name": null, "buyer_address": null, "seller_name": null, "seller_address": null,
 "sale_date": null, "sale_price": null, "odometer": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "buyers_order": """Extract ALL readable fields from this buyer's order. Return ONLY valid JSON:
{"vin": null, "year": null, "make": null, "model": null, "color": null, "stock_number": null,
 "buyer_name": null, "seller_name": null,
 "sale_price": null, "total_price": null, "deal_date": null, "salesperson": null,
 "fees": []}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "cost_sheet": """Extract ALL readable fields from this dealer cost sheet. Return ONLY valid JSON:
{"vin": null, "year": null, "make": null, "model": null, "trim": null, "color": null,
 "stock_number": null, "deal_number": null,
 "initial_cost": null, "reconditioning_costs": [], "total_cost": null,
 "sale_price": null, "gross_profit": null, "acquired_from": null, "sold_to": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "repair_order": """Extract ALL readable fields from this repair order. Return ONLY valid JSON:
{"ro_number": null, "vin": null, "year": null, "make": null, "model": null, "mileage": null,
 "customer_name": null, "date_in": null, "date_out": null,
 "labor_items": [], "parts": [], "total_amount": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "deal_jacket": """Extract ALL readable fields from this deal jacket. Return ONLY valid JSON:
{"stock_number": null, "deal_number": null, "sold_date": null,
 "buyer_name": null, "salesperson": null, "seller_entity": null,
 "vin": null, "year": null, "make": null, "model": null, "color": null, "odometer": null,
 "sale_price": null, "gross_profit": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "receipt": """Extract ALL readable fields from this receipt/invoice. Return ONLY valid JSON:
{"vendor_name": null, "date": null, "receipt_number": null,
 "line_items": [], "subtotal": null, "tax": null, "total": null,
 "vin": null, "year": null, "make": null, "model": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "auction_slip": """Extract ALL readable fields from this auction slip. Return ONLY valid JSON:
{"auction_house": null, "auction_date": null, "lot_number": null,
 "vin": null, "year": null, "make": null, "model": null, "color": null, "odometer": null,
 "seller_name": null, "sale_price": null, "sold": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "odometer_disclosure": """Extract ALL readable fields from this odometer statement. Return ONLY valid JSON:
{"vin": null, "year": null, "make": null, "model": null,
 "odometer_reading": null, "odometer_date": null, "odometer_status": null,
 "seller_name": null, "buyer_name": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "registration": """Extract ALL readable fields from this vehicle registration. Return ONLY valid JSON:
{"vin": null, "year": null, "make": null, "model": null,
 "license_plate": null, "state": null, "registered_owner": null,
 "registration_date": null, "expiration_date": null}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",

    "other": """Extract ALL readable text and data from this document. Return ONLY valid JSON:
{"document_title": null, "vin": null, "year": null, "make": null, "model": null,
 "names": [], "dates": [], "amounts": [], "identifiers": []}
CRITICAL: Only extract text you can ACTUALLY READ. Use null for unclear fields.""",
}

# Fill in missing types with the "other" prompt
for dt in DOC_TYPES:
    if dt not in EXTRACT_PROMPTS:
        EXTRACT_PROMPTS[dt] = EXTRACT_PROMPTS["other"]


# ─── Image Resizing ────────────────────────────────────────────────────────

def resize_image_b64(image_b64, max_dim=1024):
    """Resize image to max_dim while keeping aspect ratio. Returns base64 JPEG."""
    from io import BytesIO
    try:
        from PIL import Image
    except ImportError:
        return image_b64  # No PIL, use original

    raw = base64.b64decode(image_b64)
    img = Image.open(BytesIO(raw))

    # Only resize if larger than max_dim
    w, h = img.size
    if max(w, h) <= max_dim:
        return image_b64

    ratio = max_dim / max(w, h)
    new_size = (int(w * ratio), int(h * ratio))
    img = img.resize(new_size, Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


# ─── Ollama API ─────────────────────────────────────────────────────────────

def ollama_vision(prompt, image_b64, timeout=120):
    """Call Ollama vision model with a resized image."""
    # Resize to 768px max — fast inference, still readable for doc OCR
    image_b64 = resize_image_b64(image_b64, max_dim=768)

    payload = json.dumps({
        "model": VISION_MODEL,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 300},
    }).encode()

    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=payload)
    req.add_header("Content-Type", "application/json")
    resp = urllib.request.urlopen(req, timeout=timeout)
    result = json.loads(resp.read())
    return result["response"], result.get("total_duration", 0) / 1e9


def parse_json_response(text):
    """Extract JSON from model response, handling markdown fences."""
    # Try to find JSON block
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Try the whole text
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return None


# ─── VIN Validation ─────────────────────────────────────────────────────────

def validate_vin(vin):
    """Basic VIN validation."""
    if not vin:
        return True, None
    if len(vin) < 5:
        return False, "too_short"
    if len(vin) == 17:
        if re.search(r'[IOQ]', vin, re.IGNORECASE):
            return False, "invalid_chars"
        if "123456" in vin:
            return False, "fake_pattern"
        return True, None
    return True, None


def post_process(extraction, doc_type):
    """Validate and clean extraction results."""
    if not extraction:
        return None, True, ["no_extraction"]

    review_reasons = []
    data = extraction.get("extracted_data", extraction)

    # VIN check
    vin = data.get("vin")
    valid, reason = validate_vin(vin)
    if not valid:
        review_reasons.append(f"VIN: {reason}")
        data["vin"] = None

    # Year range check
    year = data.get("year")
    if year and (not isinstance(year, int) or year < 1886 or year > 2027):
        review_reasons.append(f"Year out of range: {year}")

    # Suspicious names
    suspect = ["john doe", "jane doe", "john smith", "test user"]
    for field in ["buyer_name", "seller_name", "customer_name", "registered_owner"]:
        name = data.get(field, "")
        if isinstance(name, str) and name.lower() in suspect:
            review_reasons.append(f"Suspicious name in {field}: {name}")
            data[field] = None

    # Check owner_names list too
    if isinstance(data.get("owner_names"), list):
        data["owner_names"] = [n for n in data["owner_names"]
                                if not (isinstance(n, str) and n.lower() in suspect)]

    needs_review = len(review_reasons) > 0
    return data, needs_review, review_reasons


# ─── Supabase Operations ────────────────────────────────────────────────────

def supabase_get(path, params=""):
    """GET from Supabase REST API with retry."""
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
            req.add_header("apikey", SUPABASE_KEY)
            resp = urllib.request.urlopen(req, timeout=30)
            return json.loads(resp.read())
        except Exception as e:
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
            else:
                raise


def supabase_patch(path, data, match=""):
    """PATCH Supabase REST API with retry."""
    url = f"{SUPABASE_URL}/rest/v1/{path}?{match}"
    payload = json.dumps(data).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=payload, method="PATCH")
            req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
            req.add_header("apikey", SUPABASE_KEY)
            req.add_header("Content-Type", "application/json")
            req.add_header("Prefer", "return=minimal")
            urllib.request.urlopen(req, timeout=30)
            return
        except Exception as e:
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
            else:
                raise


def download_image(storage_path):
    """Download image from Supabase Storage and return base64 with retry."""
    url = f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_path}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req, timeout=60)
            data = resp.read()
            return base64.b64encode(data).decode()
        except Exception as e:
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
            else:
                raise


def get_pending_items(limit):
    """Get pending queue items."""
    items = supabase_get(
        "document_ocr_queue",
        f"status=eq.pending&locked_at=is.null&order=priority.desc,created_at.asc&limit={limit}&select=*"
    )
    return items


def lock_item(item_id):
    """Lock a queue item."""
    try:
        supabase_patch("document_ocr_queue",
                       {"locked_at": datetime.now(timezone.utc).isoformat(), "locked_by": WORKER_ID},
                       f"id=eq.{item_id}&locked_at=is.null")
        return True
    except Exception:
        return False


def update_item(item_id, data):
    """Update a queue item."""
    supabase_patch("document_ocr_queue", data, f"id=eq.{item_id}")


def call_entity_linker(queue_id, deal_document_id, doc_type, extraction_data, storage_path):
    """Call the link-document-entities edge function."""
    try:
        payload = json.dumps({
            "queue_id": queue_id,
            "deal_document_id": deal_document_id,
            "document_type": doc_type,
            "extraction_data": extraction_data,
            "storage_path": storage_path,
        }).encode()
        url = f"{SUPABASE_URL}/functions/v1/link-document-entities"
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
        req.add_header("Content-Type", "application/json")
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except Exception as e:
        print(f"    Entity linking error (non-fatal): {e}")
        return None


# ─── Main Processing ────────────────────────────────────────────────────────





def prefetch_images(items, cache):
    """Download images for a batch of items into cache dict. Runs in background thread."""
    for item in items:
        item_id = item["id"]
        if item_id not in cache:
            try:
                cache[item_id] = download_image(item["storage_path"])
            except Exception as e:
                cache[item_id] = None


def process_item_fast(item, img_b64, classify_only=False, skip_linking=True):
    """Process a single queue item with pre-downloaded image. Skips entity linking by default."""
    item_id = item["id"]
    storage_path = item["storage_path"]
    attempts = (item.get("attempts") or 0) + 1

    if not lock_item(item_id):
        return {"id": item_id, "status": "skipped", "reason": "locked"}

    try:
        if not img_b64:
            img_b64 = download_image(storage_path)

        update_item(item_id, {"status": "extracting"})
        response_text, duration = ollama_vision(SINGLE_PASS_PROMPT, img_b64)
        result = parse_json_response(response_text)

        if not result:
            result = {"document_type": "other", "confidence": 30, "raw_text": response_text[:500]}

        doc_type = result.get("document_type", "other")
        confidence = result.get("confidence") or 0
        if isinstance(confidence, str):
            confidence = int(''.join(c for c in confidence if c.isdigit()) or '0')
        if isinstance(confidence, (int, float)) and 0 < confidence <= 1:
            confidence = int(confidence * 100)
        if doc_type not in DOC_TYPES:
            doc_type = "other"

        if confidence < 30 or (doc_type == "other" and confidence < 50):
            update_item(item_id, {
                "status": "skipped", "document_type": doc_type,
                "document_type_confidence": confidence,
                "attempts": attempts, "locked_at": None, "locked_by": None,
            })
            return {"id": item_id, "status": "skipped", "document_type": doc_type,
                    "confidence": confidence, "time": f"{duration:.1f}s"}

        if classify_only:
            update_item(item_id, {
                "status": "pending", "document_type": doc_type,
                "document_type_confidence": confidence,
                "locked_at": None, "locked_by": None,
            })
            return {"id": item_id, "status": "classified", "document_type": doc_type,
                    "confidence": confidence, "time": f"{duration:.1f}s"}

        processed_data, needs_review, review_reasons = post_process(result, doc_type)
        extraction_data = {
            "document_type": doc_type,
            "extracted_data": processed_data or result,
            "needs_review": needs_review,
            "review_reasons": review_reasons,
        }

        # Skip linking for speed — set to complete directly
        final_status = "complete" if skip_linking else "linking"

        update_item(item_id, {
            "status": final_status,
            "document_type": doc_type,
            "document_type_confidence": confidence,
            "extraction_provider": "ollama",
            "extraction_model": VISION_MODEL,
            "extraction_data": extraction_data,
            "extraction_cost_usd": 0,
            "attempts": attempts,
            "locked_at": None, "locked_by": None,
        })

        # Update deal_documents
        if item.get("deal_document_id"):
            try:
                supabase_patch("deal_documents", {
                    "document_type": doc_type,
                    "ocr_data": {
                        "status": "extracted",
                        "extracted_at": datetime.now(timezone.utc).isoformat(),
                        "provider": "ollama", "model": VISION_MODEL,
                        "data": processed_data or result,
                        "needs_review": needs_review,
                    },
                }, f"id=eq.{item['deal_document_id']}")
            except Exception:
                pass

        # Entity linking (if not skipping)
        link_result = None
        if not skip_linking:
            link_result = call_entity_linker(
                item_id, item.get("deal_document_id"), doc_type,
                extraction_data, storage_path
            )
            update_item(item_id, {
                "status": "complete",
                "linked_vehicle_id": link_result.get("vehicle_id") if link_result else None,
                "linked_deal_id": link_result.get("deal_id") if link_result else None,
                "locked_at": None, "locked_by": None,
            })

        return {"id": item_id, "status": "complete", "document_type": doc_type,
                "confidence": confidence, "time": f"{duration:.1f}s",
                "needs_review": needs_review}

    except Exception as e:
        try:
            update_item(item_id, {
                "status": "failed", "error_message": str(e)[:500],
                "attempts": attempts, "locked_at": None, "locked_by": None,
                "next_attempt_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        return {"id": item_id, "status": "failed", "error": str(e)[:200]}


def batch_link_entities():
    """Batch entity linking pass — run after OCR is done."""
    print("\n  Running batch entity linking...")
    items = supabase_get("document_ocr_queue",
        "status=eq.complete&extraction_data=not.is.null&linked_vehicle_id=is.null"
        "&order=created_at.asc&limit=500&select=id,deal_document_id,document_type,extraction_data,storage_path")

    if not items:
        print("  No items need linking.")
        return

    print(f"  Linking {len(items)} items...")
    linked = 0
    for i, item in enumerate(items):
        result = call_entity_linker(
            item["id"], item.get("deal_document_id"),
            item.get("document_type"), item.get("extraction_data"),
            item.get("storage_path"))
        if result:
            try:
                update_item(item["id"], {
                    "linked_vehicle_id": result.get("vehicle_id"),
                    "linked_deal_id": result.get("deal_id"),
                })
                linked += 1
            except Exception:
                pass
        if (i + 1) % 10 == 0:
            print(f"    [{i+1}/{len(items)}] linked: {linked}")

    print(f"  Entity linking done: {linked}/{len(items)} linked")


def main():
    parser = argparse.ArgumentParser(description="Ollama OCR Worker (pipelined)")
    parser.add_argument("--limit", type=int, default=1000, help="Max items to process")
    parser.add_argument("--classify-only", action="store_true", help="Only classify, don't extract")
    parser.add_argument("--continuous", action="store_true", help="Run continuously until queue empty")
    parser.add_argument("--batch-size", type=int, default=30, help="Items per batch fetch")
    parser.add_argument("--prefetch", type=int, default=5, help="Images to pre-download")
    parser.add_argument("--skip-linking", action="store_true", default=True, help="Skip entity linking (faster)")
    parser.add_argument("--link-only", action="store_true", help="Only run entity linking pass")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    if args.link_only:
        batch_link_entities()
        return

    # Verify Ollama is running
    try:
        urllib.request.urlopen(urllib.request.Request(f"{OLLAMA_URL}/api/tags"), timeout=5)
    except Exception:
        print("ERROR: Ollama not running. Start with: ollama serve")
        sys.exit(1)

    print("=" * 60)
    print(f"Ollama OCR Worker ({VISION_MODEL}) — Pipelined")
    print(f"Worker: {WORKER_ID} | Prefetch: {args.prefetch}")
    print(f"Mode: {'classify-only' if args.classify_only else 'full (linking deferred)'}")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    total = 0
    stats = {"complete": 0, "skipped": 0, "failed": 0}
    start_time = time.time()
    img_cache = {}

    while total < args.limit:
        batch_size = min(args.batch_size, args.limit - total)
        items = get_pending_items(batch_size)

        if not items:
            if args.continuous:
                elapsed = time.time() - start_time
                rate = total / elapsed * 60 if elapsed > 0 else 0
                print(f"\n  Queue empty ({total} done, {rate:.0f}/min). Waiting 30s...")
                time.sleep(30)
                continue
            break

        print(f"\n  Fetched {len(items)} items")

        # Pre-fetch first batch of images in background
        prefetch_thread = threading.Thread(
            target=prefetch_images,
            args=(items[:args.prefetch], img_cache),
            daemon=True
        )
        prefetch_thread.start()

        for i, item in enumerate(items):
            # Start pre-fetching next images while GPU works
            if i + args.prefetch < len(items):
                next_items = items[i + args.prefetch : i + args.prefetch + 1]
                threading.Thread(target=prefetch_images, args=(next_items, img_cache), daemon=True).start()

            # Wait for this image to be ready
            item_id = item["id"]
            for _ in range(30):  # Wait up to 30s for prefetch
                if item_id in img_cache:
                    break
                time.sleep(0.1)

            total += 1
            cached_img = img_cache.pop(item_id, None)
            result = process_item_fast(item, cached_img, args.classify_only, args.skip_linking)
            status = result["status"]
            stats[status] = stats.get(status, 0) + 1

            elapsed = time.time() - start_time
            rate = total / elapsed * 60 if elapsed > 0 else 0
            doc_type = result.get("document_type", "?")
            conf = result.get("confidence", "?")
            t = result.get("time", "")

            print(f"  [{total}] {status:8s} | {doc_type:20s} ({conf}%) | {t} | {rate:.0f}/min")

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"DONE in {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"Processed: {total} | Complete: {stats.get('complete',0)} | "
          f"Skipped: {stats.get('skipped',0)} | Failed: {stats.get('failed',0)}")
    if elapsed > 0:
        print(f"Rate: {total/elapsed*60:.0f}/min | Cost: $0.00 (local Ollama)")
    print("=" * 60)


if __name__ == "__main__":
    main()
