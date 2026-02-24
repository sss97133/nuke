#!/usr/bin/env python3
"""
Re-extract data from documents using qwen2.5vl:7b (best local OCR model).
Only processes items with known document_type — skips unclassified.
Uses type-specific extraction prompts for maximum data quality.

Usage:
    dotenvx run -- python3 -u reextract_with_11b.py             # Re-extract unlinked docs
    dotenvx run -- python3 -u reextract_with_11b.py --all       # Re-extract ALL docs
    dotenvx run -- python3 -u reextract_with_11b.py --model X   # Use different model
"""

import os, sys, json, base64, time, re, urllib.request, threading, argparse
from datetime import datetime, timezone
from io import BytesIO

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OLLAMA_URL = "http://localhost:11434"
MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")
BUCKET = "deal-documents"

# Type-specific prompts — natural language works better with qwen2.5vl
PROMPTS = {
    "title": "Read all text on this vehicle title document. Extract: VIN (17 characters), year, make, model, title number, state, issue date (YYYY-MM-DD), owner names, lienholder name, odometer reading. Return as JSON only.",

    "bill_of_sale": "Read all text on this bill of sale. Extract: VIN, year, make, model, buyer name, seller name, sale date (YYYY-MM-DD), sale price, odometer. Return as JSON only.",

    "receipt": "Read all text on this receipt or invoice. Extract: vendor name, date, receipt/invoice number, total amount, line items, and any VIN/year/make/model if present. Return as JSON only.",

    "registration": "Read all text on this vehicle registration. Extract: VIN, year, make, model, license plate, state, registered owner name, registration date, expiration date. Return as JSON only.",

    "odometer_disclosure": "Read all text on this odometer disclosure statement. Extract: VIN, year, make, model, odometer reading, date, seller name, buyer name. Return as JSON only.",

    "repair_order": "Read all text on this repair order. Extract: RO number, VIN, year, make, model, mileage, customer name, date, labor items, parts, total amount. Return as JSON only.",

    "buyers_order": "Read all text on this buyer's order. Extract: VIN, year, make, model, stock number, buyer name, seller/dealer name, sale price, deal date. Return as JSON only.",

    "deal_jacket": "Read all text on this deal jacket. Extract: stock number, deal number, sold date, buyer name, VIN, year, make, model, sale price. Return as JSON only.",

    "auction_slip": "Read all text on this auction slip. Extract: auction house, auction date, lot number, VIN, year, make, model, sale price, seller name. Return as JSON only.",
}

DEFAULT_PROMPT = "Read all text on this document. Extract any: VIN, year, make, model, person names, dates, dollar amounts. Return as JSON only."


def resize_b64(image_b64, max_dim=1024):
    try:
        from PIL import Image
        raw = base64.b64decode(image_b64)
        img = Image.open(BytesIO(raw))
        w, h = img.size
        if max(w, h) <= max_dim:
            return image_b64
        ratio = max_dim / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return image_b64


def ollama(prompt, image_b64):
    # Resize to 1536px — good balance for qwen2.5vl OCR quality vs speed
    image_b64 = resize_b64(image_b64, max_dim=1536)
    payload = json.dumps({
        "model": MODEL, "prompt": prompt, "images": [image_b64],
        "stream": False, "options": {"temperature": 0.1, "num_predict": 600},
    }).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=payload)
    req.add_header("Content-Type", "application/json")
    resp = urllib.request.urlopen(req, timeout=120)
    result = json.loads(resp.read())
    return result["response"], result.get("total_duration", 0) / 1e9


def parse_json(text):
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try: return json.loads(match.group())
        except: pass
    try: return json.loads(text.strip())
    except: return None


def supa_get(path, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}?{params}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url)
            req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
            req.add_header("apikey", SUPABASE_KEY)
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except:
            if attempt < 2: time.sleep(3)
            else: raise


def supa_patch(path, data, match=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}?{match}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=json.dumps(data).encode(), method="PATCH")
            req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
            req.add_header("apikey", SUPABASE_KEY)
            req.add_header("Content-Type", "application/json")
            req.add_header("Prefer", "return=minimal")
            urllib.request.urlopen(req, timeout=30)
            return
        except:
            if attempt < 2: time.sleep(3)
            else: raise


def download_b64(storage_path):
    url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}"
    for attempt in range(3):
        try:
            return base64.b64encode(urllib.request.urlopen(url, timeout=60).read()).decode()
        except:
            if attempt < 2: time.sleep(3)
            else: raise


def prefetch(items, cache):
    for item in items:
        if item["id"] not in cache:
            try: cache[item["id"]] = download_b64(item["storage_path"])
            except: cache[item["id"]] = None


def main():
    parser = argparse.ArgumentParser(description="Re-extract with qwen2.5vl")
    parser.add_argument("--all", action="store_true", help="Re-extract ALL completed docs (not just unlinked)")
    parser.add_argument("--model", type=str, default=None, help="Override model")
    parser.add_argument("--limit", type=int, default=500, help="Max items")
    args = parser.parse_args()

    global MODEL
    if args.model:
        MODEL = args.model

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing env vars"); sys.exit(1)

    real_types = "title,bill_of_sale,buyers_order,receipt,registration,repair_order,odometer_disclosure,deal_jacket,auction_slip,shipping_bill,lien_release,consignment_agreement"

    if args.all:
        # Re-extract all completed real docs
        items = supa_get("document_ocr_queue",
            f"status=eq.complete&document_type=in.({real_types})&order=priority.desc,created_at.asc&limit={args.limit}&select=*")
    else:
        # Only unlinked docs (pending or complete without vehicle)
        items = supa_get("document_ocr_queue",
            f"status=in.(pending,complete)&document_type=in.({real_types})&linked_vehicle_id=is.null&order=priority.desc,created_at.asc&limit={args.limit}&select=*")

    if not items:
        print("No pre-classified documents to re-extract.")
        return

    print(f"Re-extracting {len(items)} pre-classified documents with {MODEL}")
    types = {}
    for r in items:
        types[r['document_type']] = types.get(r['document_type'], 0) + 1
    for k, v in sorted(types.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")
    print()

    img_cache = {}
    start = time.time()
    done = 0
    stats = {"complete": 0, "failed": 0}

    # Pre-fetch first batch
    threading.Thread(target=prefetch, args=(items[:5], img_cache), daemon=True).start()

    for i, item in enumerate(items):
        # Pre-fetch ahead
        if i + 5 < len(items):
            threading.Thread(target=prefetch, args=(items[i+5:i+6], img_cache), daemon=True).start()

        item_id = item["id"]
        doc_type = item["document_type"]
        prompt = PROMPTS.get(doc_type, DEFAULT_PROMPT)

        # Wait for prefetch
        for _ in range(60):
            if item_id in img_cache: break
            time.sleep(0.5)

        img = img_cache.pop(item_id, None)
        if not img:
            try: img = download_b64(item["storage_path"])
            except: continue

        try:
            # Lock
            supa_patch("document_ocr_queue",
                {"locked_at": datetime.now(timezone.utc).isoformat(), "locked_by": f"reextract-{MODEL.split(':')[0]}", "status": "extracting"},
                f"id=eq.{item_id}")

            response, duration = ollama(prompt, img)
            result = parse_json(response)

            # Check if qwen says it's not a document
            if not result or (isinstance(response, str) and any(phrase in response.lower() for phrase in [
                "no text", "not a document", "no receipt", "no bill", "no title",
                "no vehicle", "image shows", "no visible text", "does not contain"
            ])):
                # Reclassify as non-document
                supa_patch("document_ocr_queue", {
                    "status": "skipped", "document_type": "other",
                    "document_type_confidence": 10,
                    "extraction_provider": "ollama", "extraction_model": MODEL,
                    "extraction_data": {"raw_text": response[:300], "not_a_document": True},
                    "locked_at": None, "locked_by": None,
                }, f"id=eq.{item_id}")
                done += 1
                stats["skipped"] = stats.get("skipped", 0) + 1
                elapsed = time.time() - start
                rate = done / elapsed * 60 if elapsed > 0 else 0
                print(f"  [{done}/{len(items)}] SKIP (not doc)    | {duration:.1f}s | {rate:.0f}/min")
                continue

            if not result:
                result = {"raw_text": response[:500]}

            extraction_data = {
                "document_type": doc_type,
                "extracted_data": result,
                "needs_review": False,
            }

            supa_patch("document_ocr_queue", {
                "status": "complete",
                "extraction_provider": "ollama", "extraction_model": MODEL,
                "extraction_data": extraction_data, "extraction_cost_usd": 0,
                "attempts": (item.get("attempts") or 0) + 1,
                "locked_at": None, "locked_by": None,
            }, f"id=eq.{item_id}")

            if item.get("deal_document_id"):
                try:
                    supa_patch("deal_documents", {
                        "document_type": doc_type,
                        "ocr_data": {"status": "extracted", "provider": "ollama",
                                     "model": MODEL, "data": result},
                    }, f"id=eq.{item['deal_document_id']}")
                except: pass

            done += 1
            stats["complete"] += 1
            elapsed = time.time() - start
            rate = done / elapsed * 60 if elapsed > 0 else 0
            vin = result.get("vin", "")
            year = result.get("year", "")
            make = result.get("make", "")
            print(f"  [{done}/{len(items)}] {doc_type:20s} | {duration:.1f}s | {vin or '—':17s} | {year} {make} | {rate:.0f}/min")

        except Exception as e:
            stats["failed"] += 1
            try:
                supa_patch("document_ocr_queue", {
                    "status": "failed", "error_message": str(e)[:500],
                    "locked_at": None, "locked_by": None,
                }, f"id=eq.{item_id}")
            except: pass
            print(f"  [{done}/{len(items)}] FAIL: {str(e)[:80]}")

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"Complete: {stats.get('complete',0)} | Skipped (not docs): {stats.get('skipped',0)} | Failed: {stats.get('failed',0)}")
    if elapsed > 0:
        print(f"Rate: {done/elapsed*60:.0f}/min")


if __name__ == "__main__":
    main()
