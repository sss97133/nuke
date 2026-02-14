#!/usr/bin/env python3
"""
Deal Jacket Auto-Pipeline
==========================
Finds documentation photos (deal jackets, invoices, receipts) that haven't been
processed yet, extracts data, runs forensic analysis, and creates/links vehicle profiles.

Extraction methods (in priority order):
  1. Claude Code (manual) — operator reads image and provides extraction JSON
  2. xAI grok-2-vision — API call (may hallucinate on dense text)
  3. Queue — marks for later processing

Usage:
    # Show what needs processing
    python3 process-deal-jackets.py --status

    # Process with Claude Code providing extractions (interactive)
    python3 process-deal-jackets.py --process --limit 5

    # Process using xAI API
    python3 process-deal-jackets.py --process --method xai --limit 5

    # Just find and flag documentation images
    python3 process-deal-jackets.py --flag-new

    # Create vehicle profiles from existing extractions
    python3 process-deal-jackets.py --create-profiles
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error


def get_config():
    """Read Supabase config from .env via dotenvx."""
    try:
        result = subprocess.run(
            ["dotenvx", "run", "--quiet", "--", "bash", "-c",
             'echo "$VITE_SUPABASE_URL|$SUPABASE_SERVICE_ROLE_KEY|$XAI_API_KEY"'],
            capture_output=True, text=True, cwd="/Users/skylar/nuke"
        )
        clean = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout).strip()
        for line in clean.split('\n'):
            line = line.strip()
            parts = line.split("|")
            if len(parts) >= 2 and parts[0].startswith('http'):
                return {
                    "url": parts[0],
                    "key": parts[1],
                    "xai_key": parts[2] if len(parts) > 2 else "",
                }
    except Exception:
        pass
    return None


def supabase_get(config, path, params=""):
    """GET from Supabase REST API."""
    url = f"{config['url']}/rest/v1/{path}?{params}" if params else f"{config['url']}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {config['key']}",
        "apikey": config["key"],
    })
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read().decode("utf-8"))


def supabase_patch(config, path, params, data):
    """PATCH Supabase REST API."""
    url = f"{config['url']}/rest/v1/{path}?{params}"
    req = urllib.request.Request(url,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['key']}",
            "apikey": config["key"],
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="PATCH"
    )
    urllib.request.urlopen(req, timeout=10)


def supabase_post(config, path, data):
    """POST to Supabase REST API or edge function."""
    if path.startswith("functions/"):
        url = f"{config['url']}/{path}"
    else:
        url = f"{config['url']}/rest/v1/{path}"
    req = urllib.request.Request(url,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['key']}",
            "apikey": config["key"],
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=120)
    return json.loads(resp.read().decode("utf-8"))


def supabase_insert(config, table, data):
    """INSERT into Supabase table."""
    url = f"{config['url']}/rest/v1/{table}"
    req = urllib.request.Request(url,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['key']}",
            "apikey": config["key"],
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read().decode("utf-8"))


# ─── STATUS ────────────────────────────────────────────────────────────────────

def show_status(config):
    """Show current deal jacket processing status."""
    # Find documentation images
    docs = supabase_get(config, "vehicle_images",
        "category=in.(documentation,receipt)&select=id,vehicle_id,category,components,ai_extractions&limit=100")

    total = len(docs)
    has_extraction = sum(1 for d in docs if d.get("ai_extractions") and
        any(e.get("type") == "forensic_deal_jacket" for e in (d["ai_extractions"] or [])))
    needs_extraction = total - has_extraction
    has_vehicle = sum(1 for d in docs if d.get("vehicle_id"))
    flagged = sum(1 for d in docs if (d.get("components") or {}).get("needs_forensic_extraction"))

    print(f"Deal Jacket Pipeline Status")
    print(f"{'─' * 40}")
    print(f"  Documentation images:   {total}")
    print(f"  With forensic extract:  {has_extraction}")
    print(f"  Needs extraction:       {needs_extraction}")
    print(f"  Flagged for extraction: {flagged}")
    print(f"  Linked to vehicle:      {has_vehicle}")
    print(f"  Orphaned (no vehicle):  {total - has_vehicle}")

    # Show existing forensic results
    if has_extraction > 0:
        print(f"\n  Existing extractions:")
        for d in docs:
            if d.get("ai_extractions"):
                for e in d["ai_extractions"]:
                    if e.get("type") == "forensic_deal_jacket":
                        r = e.get("result", {})
                        v = r.get("vehicle", {})
                        s = r.get("sale", {})
                        print(f"    {d['id'][:8]}... → {v.get('year','')} {v.get('make','')} {v.get('model','')} "
                              f"| sale: ${s.get('sale_price', 0):,.0f} | vehicle_id: {d.get('vehicle_id', 'none')[:8] if d.get('vehicle_id') else 'none'}...")

    # Check for deal_jacket_forensics in vehicles
    # This requires a different query approach
    print(f"\n  (Run --create-profiles to auto-link vehicles from extractions)")


# ─── FLAG NEW ──────────────────────────────────────────────────────────────────

def flag_new_documents(config):
    """Find documentation images that haven't been flagged for extraction."""
    docs = supabase_get(config, "vehicle_images",
        "category=in.(documentation,receipt)"
        "&select=id,category,components"
        "&limit=100")

    flagged = 0
    for doc in docs:
        components = doc.get("components") or {}
        if not components.get("needs_forensic_extraction"):
            new_components = {**components, "needs_forensic_extraction": True, "classification": doc["category"]}
            try:
                supabase_patch(config, "vehicle_images", f"id=eq.{doc['id']}", {"components": new_components})
                flagged += 1
                print(f"  Flagged: {doc['id']}")
            except Exception as e:
                print(f"  ERROR flagging {doc['id']}: {e}")

    print(f"\nFlagged {flagged} images for forensic extraction")


# ─── PROCESS ───────────────────────────────────────────────────────────────────

def find_unprocessed(config, limit=10):
    """Find documentation images that need forensic extraction."""
    docs = supabase_get(config, "vehicle_images",
        "category=in.(documentation,receipt)"
        "&select=id,image_url,storage_path,filename,vehicle_id,category,components,ai_extractions"
        f"&limit={limit}"
        "&order=created_at.desc")

    # Filter to those without forensic extraction
    unprocessed = []
    for d in docs:
        has_forensic = False
        if d.get("ai_extractions"):
            has_forensic = any(e.get("type") == "forensic_deal_jacket" for e in d["ai_extractions"])
        if not has_forensic:
            unprocessed.append(d)

    return unprocessed


def extract_with_xai(image_url, xai_key, prompt):
    """Use xAI grok-2-vision for deal jacket extraction."""
    import base64

    # Download image
    img_resp = urllib.request.urlopen(image_url, timeout=30)
    img_data = base64.b64encode(img_resp.read()).decode("utf-8")

    # Determine content type
    ct = "image/jpeg"
    if image_url.endswith(".png"):
        ct = "image/png"

    data = json.dumps({
        "model": "grok-2-vision-latest",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{ct};base64,{img_data}"}},
            ],
        }],
        "max_tokens": 4000,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.x.ai/v1/chat/completions",
        data=data,
        headers={
            "Authorization": f"Bearer {xai_key}",
            "Content-Type": "application/json",
        },
    )

    resp = urllib.request.urlopen(req, timeout=90)
    result = json.loads(resp.read().decode("utf-8"))
    content = result["choices"][0]["message"]["content"]

    # Parse JSON from response
    json_match = re.search(r'\{[\s\S]*\}', content)
    if json_match:
        return json.loads(json_match.group())
    raise ValueError(f"No JSON in xAI response: {content[:200]}")


EXTRACTION_PROMPT = """You are a forensic accountant. Extract ALL data from this dealer deal jacket.

Return a JSON object with these sections:
{
  "deal_header": {
    "stock_number": "", "deal_number": "", "sold_date": "YYYY-MM-DD",
    "buyer_name": "", "seller_entity": "", "salesperson": ""
  },
  "vehicle": {
    "year": null, "make": "", "model": "", "trim": "",
    "vin": "", "odometer": null, "color": ""
  },
  "acquisition": {
    "purchase_cost": 0.00, "listing_fee": 0.00, "shipping": 0.00,
    "total_pre_recon": 0.00
  },
  "reconditioning": {
    "line_items": [
      {"line_number": 1, "description": "", "amount": 0.00, "vendor_named": false, "vendor_name": "", "is_round_number": false}
    ],
    "total": 0.00
  },
  "sale": {
    "sale_price": 0.00, "total_cost": 0.00
  },
  "trade_in": {
    "year": null, "make": "", "model": "", "vin": "", "allowance": 0.00
  },
  "profit": {
    "reported_profit": 0.00
  },
  "investments": [
    {"name": "", "amount": 0.00, "type": "cash|inventory|phantom"}
  ]
}

Extract EVERY line item. Be precise with dollar amounts. If something is unclear, note it."""


def process_deal_jackets(config, method="manual", limit=5):
    """Process unextracted deal jacket images."""
    unprocessed = find_unprocessed(config, limit)
    if not unprocessed:
        print("No unprocessed deal jackets found.")
        print("(Images must be classified as 'documentation' or 'receipt' first)")
        return

    print(f"Found {len(unprocessed)} unprocessed deal jackets\n")

    for i, doc in enumerate(unprocessed):
        image_id = doc["id"]
        image_url = doc.get("image_url") or ""
        print(f"[{i+1}/{len(unprocessed)}] {image_id}")
        print(f"  URL: {image_url[:80]}...")

        extraction = None

        if method == "xai":
            if not config.get("xai_key"):
                print("  ERROR: No XAI_API_KEY available")
                continue
            try:
                print("  Extracting with xAI grok-2-vision...", end=" ", flush=True)
                extraction = extract_with_xai(image_url, config["xai_key"], EXTRACTION_PROMPT)
                print("OK")
            except Exception as e:
                print(f"FAILED: {e}")
                continue

        elif method == "manual":
            # Interactive: ask operator to paste extraction JSON
            print(f"  Download image and extract data manually.")
            print(f"  Image: {image_url}")
            print(f"  Paste extraction JSON (or 'skip' to skip, 'quit' to stop):")
            lines = []
            while True:
                line = input()
                if line.strip().lower() == "skip":
                    extraction = None
                    break
                if line.strip().lower() == "quit":
                    return
                lines.append(line)
                # Try to parse accumulated JSON
                text = "\n".join(lines)
                try:
                    extraction = json.loads(text)
                    break
                except json.JSONDecodeError:
                    continue  # Keep reading lines

            if extraction is None:
                print("  Skipped.")
                continue

        if extraction:
            print("  Sending to forensic-deal-jacket for trust scoring...")
            try:
                result = supabase_post(config, "functions/v1/forensic-deal-jacket", {
                    "image_id": image_id,
                    "vehicle_id": doc.get("vehicle_id"),
                    "mode": "manual",
                    "extraction": extraction,
                    "store_results": True,
                })
                summary = result.get("forensic_summary", {})
                print(f"  Forensic result:")
                print(f"    Red flags: {len(summary.get('red_flags', []))}")
                print(f"    Reported profit: ${summary.get('reported_profit', 0):,.2f}")
                print(f"    True profit est: ${summary.get('true_profit_estimate', 0):,.2f}")

                # Auto-create/link vehicle
                vehicle_data = extraction.get("vehicle", {})
                if vehicle_data.get("year") and vehicle_data.get("make"):
                    link_result = auto_link_vehicle(config, image_id, vehicle_data, extraction)
                    if link_result:
                        print(f"    Vehicle: {link_result}")

            except Exception as e:
                print(f"  ERROR in forensic analysis: {e}")

        print()


# ─── VEHICLE LINKING ───────────────────────────────────────────────────────────

def auto_link_vehicle(config, image_id, vehicle_data, extraction=None):
    """Find or create a vehicle from deal jacket extraction data."""
    year = vehicle_data.get("year")
    make = vehicle_data.get("make", "").strip()
    model = vehicle_data.get("model", "").strip()
    vin = vehicle_data.get("vin", "").strip()

    if not make:
        return None

    # 1. Try VIN match first
    if vin and len(vin) >= 11:
        try:
            matches = supabase_get(config, "vehicles",
                f"vin=eq.{vin}&deleted_at=is.null&select=id,year,make,model&limit=1")
            if matches:
                vehicle_id = matches[0]["id"]
                supabase_patch(config, "vehicle_images", f"id=eq.{image_id}", {"vehicle_id": vehicle_id})
                enrich_vehicle_from_extraction(config, vehicle_id, extraction)
                return f"VIN matched → {matches[0].get('year','')} {matches[0].get('make','')} {matches[0].get('model','')} ({vehicle_id[:8]}...)"
        except Exception:
            pass

    # 2. Try year+make+model match
    try:
        params = f"deleted_at=is.null&select=id,year,make,model,vin&limit=5"
        if year:
            params += f"&year=eq.{year}"
        params += f"&make=ilike.{make}"
        if model:
            params += f"&model=ilike.{model}"

        matches = supabase_get(config, "vehicles", params)
        if matches:
            # If exactly one match, link it
            if len(matches) == 1:
                vehicle_id = matches[0]["id"]
                supabase_patch(config, "vehicle_images", f"id=eq.{image_id}", {"vehicle_id": vehicle_id})
                enrich_vehicle_from_extraction(config, vehicle_id, extraction)
                return f"Matched → {matches[0].get('year','')} {matches[0].get('make','')} {matches[0].get('model','')} ({vehicle_id[:8]}...)"
            # Multiple matches — try to narrow by VIN
            if vin:
                for m in matches:
                    if m.get("vin") and vin[:8] in (m["vin"] or ""):
                        vehicle_id = m["id"]
                        supabase_patch(config, "vehicle_images", f"id=eq.{image_id}", {"vehicle_id": vehicle_id})
                        enrich_vehicle_from_extraction(config, vehicle_id, extraction)
                        return f"Partial VIN matched → {m.get('year','')} {m.get('make','')} {m.get('model','')} ({vehicle_id[:8]}...)"
    except Exception:
        pass

    # 3. Create new vehicle
    try:
        new_vehicle = {
            "year": year,
            "make": make,
            "model": model or None,
            "vin": vin if vin and len(vin) >= 11 else None,
            "color": vehicle_data.get("color"),
            "source": "deal_jacket_extraction",
        }

        # Get user_id from the image
        try:
            img = supabase_get(config, "vehicle_images", f"id=eq.{image_id}&select=user_id")
            if img and img[0].get("user_id"):
                new_vehicle["user_id"] = img[0]["user_id"]
        except Exception:
            pass

        created = supabase_insert(config, "vehicles", new_vehicle)
        if created:
            vehicle_id = created[0]["id"] if isinstance(created, list) else created["id"]
            supabase_patch(config, "vehicle_images", f"id=eq.{image_id}", {"vehicle_id": vehicle_id})
            enrich_vehicle_from_extraction(config, vehicle_id, extraction)
            return f"Created → {year} {make} {model} ({vehicle_id[:8]}...)"
    except Exception as e:
        return f"Create failed: {e}"

    return None


def enrich_vehicle_from_extraction(config, vehicle_id, extraction):
    """Enrich a vehicle profile with data from the deal jacket extraction."""
    if not extraction:
        return

    updates = {}

    # Vehicle data
    vehicle = extraction.get("vehicle", {})
    if vehicle.get("vin") and len(vehicle["vin"]) >= 11:
        updates["vin"] = vehicle["vin"]
        updates["vin_source"] = "deal_jacket"
    if vehicle.get("odometer"):
        updates["mileage"] = vehicle["odometer"]
    if vehicle.get("color"):
        updates["color"] = vehicle["color"]

    # Financial data → origin_metadata
    sale = extraction.get("sale", {})
    profit = extraction.get("profit", {})
    acq = extraction.get("acquisition", {})
    header = extraction.get("deal_header", {})

    origin_update = {}
    if sale.get("sale_price"):
        updates["sale_price"] = sale["sale_price"]
        origin_update["sale_price"] = sale["sale_price"]
    if acq.get("purchase_cost"):
        origin_update["purchase_cost"] = acq["purchase_cost"]
    if profit.get("reported_profit"):
        origin_update["reported_profit"] = profit["reported_profit"]
    if header.get("sold_date"):
        origin_update["sold_date"] = header["sold_date"]
    if header.get("buyer_name"):
        origin_update["buyer_name"] = header["buyer_name"]
    if header.get("stock_number"):
        origin_update["stock_number"] = header["stock_number"]

    if origin_update:
        # Merge into existing origin_metadata
        try:
            existing = supabase_get(config, "vehicles", f"id=eq.{vehicle_id}&select=origin_metadata")
            existing_meta = (existing[0].get("origin_metadata") or {}) if existing else {}
            existing_meta["deal_jacket_data"] = origin_update
            updates["origin_metadata"] = existing_meta
        except Exception:
            updates["origin_metadata"] = {"deal_jacket_data": origin_update}

    if updates:
        try:
            supabase_patch(config, "vehicles", f"id=eq.{vehicle_id}", updates)
        except Exception as e:
            print(f"    Warning: enrichment failed: {e}")


# ─── CREATE PROFILES ───────────────────────────────────────────────────────────

def create_profiles_from_extractions(config):
    """Create/link vehicle profiles for all deal jackets that have extractions but no vehicle."""
    docs = supabase_get(config, "vehicle_images",
        "category=in.(documentation,receipt)"
        "&vehicle_id=is.null"
        "&select=id,image_url,ai_extractions,components"
        "&limit=50")

    # Filter to those with forensic extractions
    unlinked = []
    for d in docs:
        if d.get("ai_extractions"):
            for e in d["ai_extractions"]:
                if e.get("type") == "forensic_deal_jacket" and e.get("result", {}).get("vehicle"):
                    unlinked.append({"image_id": d["id"], "extraction": e["result"]})

    if not unlinked:
        print("No unlinked extractions found.")
        return

    print(f"Found {len(unlinked)} extractions needing vehicle profiles\n")

    for item in unlinked:
        image_id = item["image_id"]
        vehicle_data = item["extraction"].get("vehicle", {})
        print(f"  {image_id[:8]}... → {vehicle_data.get('year','')} {vehicle_data.get('make','')} {vehicle_data.get('model','')} VIN:{vehicle_data.get('vin','none')[:8]}...")

        result = auto_link_vehicle(config, image_id, vehicle_data, item["extraction"])
        if result:
            print(f"    {result}")
        else:
            print(f"    Could not link")


# ─── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Deal Jacket Auto-Pipeline")
    parser.add_argument("--status", action="store_true", help="Show pipeline status")
    parser.add_argument("--flag-new", action="store_true", help="Flag new documentation images")
    parser.add_argument("--process", action="store_true", help="Process unextracted deal jackets")
    parser.add_argument("--create-profiles", action="store_true", help="Create vehicle profiles from extractions")
    parser.add_argument("--method", default="manual", choices=["manual", "xai"],
                       help="Extraction method (default: manual)")
    parser.add_argument("--limit", type=int, default=5, help="Max items to process")
    args = parser.parse_args()

    config = get_config()
    if not config:
        print("ERROR: Could not read Supabase config", file=sys.stderr)
        sys.exit(1)

    if args.status:
        show_status(config)
    elif args.flag_new:
        flag_new_documents(config)
    elif args.process:
        process_deal_jackets(config, method=args.method, limit=args.limit)
    elif args.create_profiles:
        create_profiles_from_extractions(config)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
