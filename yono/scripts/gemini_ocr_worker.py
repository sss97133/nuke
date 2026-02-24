#!/usr/bin/env python3
"""
Fast parallel OCR worker using Gemini Flash (free tier: 15 RPM / 1500 RPD).

Processes document_ocr_queue items using Google's Gemini 2.0 Flash vision model.
Runs parallel requests to maximize throughput within rate limits.

Usage:
    # Set your key first:
    export GOOGLE_AI_API_KEY="your-key-from-aistudio.google.com"

    dotenvx run -- python3 -u gemini_ocr_worker.py               # Process all
    dotenvx run -- python3 -u gemini_ocr_worker.py --limit 100   # Process 100
    dotenvx run -- python3 -u gemini_ocr_worker.py --rpm 30      # Paid tier, faster
"""

import os
import sys
import json
import base64
import argparse
import time
import re
import urllib.request
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# ─── Config ─────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GOOGLE_AI_KEY = os.environ.get("GOOGLE_AI_API_KEY", "")
STORAGE_BUCKET = "deal-documents"
WORKER_ID = f"gemini-worker-{os.getpid()}"

# Rate limiting
rate_lock = threading.Lock()
request_times = []

DOC_TYPES = [
    "title", "bill_of_sale", "buyers_order", "cost_sheet", "repair_order",
    "odometer_disclosure", "deal_jacket", "receipt", "auction_slip",
    "smog_certificate", "registration", "insurance_card", "shipping_bill",
    "consignment_agreement", "lien_release", "other"
]

PROMPT = f"""You are a document OCR system for vehicle dealership documents.

1. CLASSIFY this document. Pick the best type from: {', '.join(DOC_TYPES)}
2. EXTRACT all readable text and data fields.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "document_type": "type",
  "confidence": 95,
  "vin": "17-char VIN or null",
  "year": 2005,
  "make": "Toyota",
  "model": "Camry",
  "stock_number": null,
  "buyer_name": null,
  "seller_name": null,
  "sale_price": null,
  "sale_date": null,
  "odometer": null,
  "names": ["all person/company names"],
  "amounts": [1234.56],
  "dates": ["2024-01-15"],
  "raw_text": "50-100 chars of key text verbatim"
}}

RULES:
- confidence: 0-100
- Only extract what you can ACTUALLY READ
- null for anything unclear
- VINs must be exactly 17 characters
- Dates as YYYY-MM-DD
- Dollar amounts as plain numbers"""


# ─── Rate Limiter ───────────────────────────────────────────────────────────

def wait_for_rate_limit(rpm):
    """Simple sliding window rate limiter."""
    with rate_lock:
        now = time.time()
        # Remove requests older than 60s
        while request_times and request_times[0] < now - 60:
            request_times.pop(0)
        if len(request_times) >= rpm:
            sleep_time = 60 - (now - request_times[0]) + 0.1
            if sleep_time > 0:
                time.sleep(sleep_time)
        request_times.append(time.time())


# ─── Gemini API ─────────────────────────────────────────────────────────────

def gemini_vision(image_b64, prompt, rpm=15):
    """Call Gemini Flash with image. Returns parsed JSON result."""
    wait_for_rate_limit(rpm)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GOOGLE_AI_KEY}"

    payload = json.dumps({
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": image_b64}},
            ],
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1000,
            "responseMimeType": "application/json",
        },
    }).encode()

    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")

    for attempt in range(3):
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            data = json.loads(resp.read())
            text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            if not text:
                return None
            # Parse JSON from response
            match = re.search(r'\{[\s\S]*\}', text)
            return json.loads(match.group()) if match else json.loads(text)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if e.code == 429:
                # Rate limited — back off
                time.sleep(10 * (attempt + 1))
                continue
            raise Exception(f"Gemini {e.code}: {body}")
        except Exception as e:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
            else:
                raise


# ─── Supabase Operations ────────────────────────────────────────────────────

def supabase_req(method, path, data=None, params=""):
    """Generic Supabase REST request with retry."""
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}"
    payload = json.dumps(data).encode() if data else None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=payload, method=method)
            req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
            req.add_header("apikey", SUPABASE_KEY)
            req.add_header("Content-Type", "application/json")
            if method == "PATCH":
                req.add_header("Prefer", "return=minimal")
            resp = urllib.request.urlopen(req, timeout=30)
            body = resp.read()
            return json.loads(body) if body and method == "GET" else None
        except Exception as e:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
            else:
                raise


def download_image_b64(storage_path):
    """Download image and return base64."""
    url = f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_path}"
    for attempt in range(3):
        try:
            resp = urllib.request.urlopen(url, timeout=60)
            return base64.b64encode(resp.read()).decode()
        except Exception:
            if attempt < 2:
                time.sleep(3)
            else:
                raise


def call_entity_linker(queue_id, deal_doc_id, doc_type, extraction_data, storage_path):
    """Call link-document-entities edge function."""
    try:
        payload = json.dumps({
            "queue_id": queue_id, "deal_document_id": deal_doc_id,
            "document_type": doc_type, "extraction_data": extraction_data,
            "storage_path": storage_path,
        }).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/functions/v1/link-document-entities",
            data=payload, method="POST"
        )
        req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
        req.add_header("Content-Type", "application/json")
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except Exception:
        return None


# ─── VIN Validation ─────────────────────────────────────────────────────────

def validate_vin(vin):
    if not vin or not isinstance(vin, str):
        return True
    if len(vin) == 17 and re.search(r'[IOQ]', vin, re.IGNORECASE):
        return False
    if "123456" in str(vin):
        return False
    return True


# ─── Process Single Item ────────────────────────────────────────────────────

def process_one(item, rpm):
    """Process a single queue item end-to-end."""
    item_id = item["id"]
    storage_path = item["storage_path"]
    attempts = (item.get("attempts") or 0) + 1
    start = time.time()

    try:
        # Lock
        supabase_req("PATCH", "document_ocr_queue",
                     {"locked_at": datetime.utcnow().isoformat(), "locked_by": WORKER_ID,
                      "status": "extracting"},
                     f"id=eq.{item_id}&locked_at=is.null")

        # Download + OCR in one shot
        img_b64 = download_image_b64(storage_path)
        result = gemini_vision(img_b64, PROMPT, rpm)

        if not result:
            result = {"document_type": "other", "confidence": 30}

        doc_type = result.get("document_type", "other")
        confidence = result.get("confidence", 0)
        if isinstance(confidence, float) and 0 < confidence <= 1:
            confidence = int(confidence * 100)
        if doc_type not in DOC_TYPES:
            doc_type = "other"

        # Skip non-documents
        if confidence < 30 or (doc_type == "other" and confidence < 50):
            supabase_req("PATCH", "document_ocr_queue", {
                "status": "skipped", "document_type": doc_type,
                "document_type_confidence": confidence,
                "attempts": attempts, "locked_at": None, "locked_by": None,
            }, f"id=eq.{item_id}")
            return {"id": item_id[:8], "status": "skip", "type": doc_type,
                    "conf": confidence, "time": time.time() - start}

        # Clean VIN
        if not validate_vin(result.get("vin")):
            result["vin"] = None

        extraction_data = {
            "document_type": doc_type,
            "extracted_data": result,
            "needs_review": False,
        }

        # Update queue
        supabase_req("PATCH", "document_ocr_queue", {
            "status": "linking", "document_type": doc_type,
            "document_type_confidence": confidence,
            "extraction_provider": "google", "extraction_model": "gemini-2.0-flash",
            "extraction_data": extraction_data, "extraction_cost_usd": 0,
            "attempts": attempts,
        }, f"id=eq.{item_id}")

        # Update deal_documents
        if item.get("deal_document_id"):
            try:
                supabase_req("PATCH", "deal_documents", {
                    "document_type": doc_type,
                    "ocr_data": {"status": "extracted", "provider": "google",
                                 "model": "gemini-2.0-flash", "data": result},
                }, f"id=eq.{item['deal_document_id']}")
            except Exception:
                pass

        # Entity linking
        link = call_entity_linker(item_id, item.get("deal_document_id"),
                                  doc_type, extraction_data, storage_path)

        # Complete
        supabase_req("PATCH", "document_ocr_queue", {
            "status": "complete",
            "linked_vehicle_id": link.get("vehicle_id") if link else None,
            "linked_deal_id": link.get("deal_id") if link else None,
            "locked_at": None, "locked_by": None,
        }, f"id=eq.{item_id}")

        return {"id": item_id[:8], "status": "done", "type": doc_type,
                "conf": confidence, "time": time.time() - start,
                "vin": result.get("vin"), "entities": bool(link)}

    except Exception as e:
        try:
            supabase_req("PATCH", "document_ocr_queue", {
                "status": "failed", "error_message": str(e)[:500],
                "attempts": attempts, "locked_at": None, "locked_by": None,
                "next_attempt_at": datetime.utcnow().isoformat(),
            }, f"id=eq.{item_id}")
        except Exception:
            pass
        return {"id": item_id[:8], "status": "FAIL", "error": str(e)[:80],
                "time": time.time() - start}


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Gemini Flash OCR Worker")
    parser.add_argument("--limit", type=int, default=1500, help="Max items (default: 1500, free tier daily limit)")
    parser.add_argument("--rpm", type=int, default=15, help="Requests per minute (free=15, paid=up to 2000)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel workers")
    parser.add_argument("--batch-size", type=int, default=50, help="Items per queue fetch")
    parser.add_argument("--continuous", action="store_true", help="Keep running until queue empty")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)
    if not GOOGLE_AI_KEY:
        print("ERROR: Missing GOOGLE_AI_API_KEY")
        print("Get one free at: https://aistudio.google.com/apikey")
        print("Then: export GOOGLE_AI_API_KEY='your-key'")
        sys.exit(1)

    print("=" * 60)
    print(f"Gemini Flash OCR Worker")
    print(f"Rate: {args.rpm} RPM | Workers: {args.workers} | Limit: {args.limit}")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    total = 0
    stats = {"done": 0, "skip": 0, "FAIL": 0}
    start_time = time.time()

    while total < args.limit:
        # Fetch batch
        fetch_size = min(args.batch_size, args.limit - total)
        items = supabase_req("GET", "document_ocr_queue", params=
            f"status=eq.pending&locked_at=is.null&order=priority.desc,created_at.asc&limit={fetch_size}&select=*")

        if not items:
            if args.continuous:
                elapsed = time.time() - start_time
                rate = total / elapsed * 60 if elapsed > 0 else 0
                print(f"\n  Queue empty ({total} done, {rate:.0f}/min). Waiting 30s...")
                time.sleep(30)
                continue
            break

        print(f"\n  Fetched {len(items)} items")

        # Process in parallel
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(process_one, item, args.rpm): item for item in items}
            for future in as_completed(futures):
                total += 1
                r = future.result()
                stats[r["status"]] = stats.get(r["status"], 0) + 1

                elapsed = time.time() - start_time
                rate = total / elapsed * 60 if elapsed > 0 else 0

                vin_str = f" VIN:{r['vin']}" if r.get("vin") else ""
                print(f"  [{total}] {r['status']:4s} | {r.get('type','?'):20s} | "
                      f"{r.get('conf','?')}% | {r['time']:.1f}s{vin_str} | {rate:.0f}/min")

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"DONE in {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"Processed: {total} | Complete: {stats.get('done',0)} | "
          f"Skipped: {stats.get('skip',0)} | Failed: {stats.get('FAIL',0)}")
    print(f"Rate: {total/elapsed*60:.0f}/min | Cost: $0.00 (Gemini free tier)")
    print("=" * 60)


if __name__ == "__main__":
    main()
