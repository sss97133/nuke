"""
Description Discovery on Modal — Qwen2.5-7B batch extraction

Extracts structured facts from vehicle auction descriptions using
Qwen2.5-7B-Instruct with 4-bit quantization on T4 GPUs.

Self-contained: loads the model directly in each worker (no HTTP to vllm_serve).
Writes results to description_discoveries table with model_used='qwen2.5:7b-modal'.

Deploy (not needed — runs as a job):
    modal run yono/modal_description_discovery.py --limit 100        # test
    modal run yono/modal_description_discovery.py --limit 235000     # full run
    modal run yono/modal_description_discovery.py --limit 5000 --min-price 10000
"""

import json
import os
import time
from datetime import datetime, timezone

import modal

app = modal.App("nuke-description-discovery")

MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"


# ---------------------------------------------------------------------------
# Image: torch + transformers + bitsandbytes. Model baked in at build time.
# ---------------------------------------------------------------------------

def _download_model():
    """Download model weights at image build time — no cold-start download."""
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL_ID, revision="main")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install([
        "transformers>=4.45.0",
        "accelerate>=1.0.0",
        "bitsandbytes>=0.43.0",
        "sentencepiece",
        "protobuf",
        "huggingface_hub",
        "hf_transfer",
    ])
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_function(_download_model)
)


# ---------------------------------------------------------------------------
# Prompt — matches scripts/local-description-discovery.mjs DISCOVERY_PROMPT
# ---------------------------------------------------------------------------

DISCOVERY_PROMPT = """You are analyzing a vehicle auction listing. Extract ALL factual information you can find.

VEHICLE: {year} {make} {model}
SALE PRICE: {sale_price}

LISTING DESCRIPTION:
---
{description}
---

Extract EVERYTHING factual from this description. Be thorough. Include:
- Any dates, years, timeframes mentioned
- Any numbers (mileage, production numbers, prices, measurements)
- Any people mentioned (owners, shops, dealers)
- Any locations mentioned (cities, states, countries)
- Any work done (service, repairs, restoration, modifications)
- Any parts mentioned (replaced, original, aftermarket)
- Any documentation mentioned (records, manuals, certificates)
- Any condition notes (issues, wear, damage, preservation)
- Any awards or certifications
- Any claims about originality or authenticity
- Any rarity claims
- Any provenance information

Return a JSON object. Create whatever keys make sense for the data you find.
Group related information logically. Use snake_case for keys.

IMPORTANT: Return ONLY valid JSON. No explanation, no markdown fences, just the JSON object."""

PROMPT_VERSION = "discovery-v1"


def _build_prompt(vehicle: dict) -> str:
    year = str(vehicle.get("year") or "Unknown")
    make = vehicle.get("make") or "Unknown"
    model = vehicle.get("model") or "Unknown"
    price = vehicle.get("sale_price")
    price_str = f"${price:,}" if price else "Unknown"
    desc = (vehicle.get("description") or "")[:6000]

    return (
        DISCOVERY_PROMPT
        .replace("{year}", year)
        .replace("{make}", make)
        .replace("{model}", model)
        .replace("{sale_price}", price_str)
        .replace("{description}", desc)
    )


def _count_fields(obj, depth=0):
    """Count total leaf fields in a nested JSON structure."""
    if depth > 5 or obj is None:
        return 0
    if not isinstance(obj, (dict, list)):
        return 1
    if isinstance(obj, list):
        return sum(_count_fields(item, depth + 1) for item in obj)
    return sum(_count_fields(v, depth + 1) for v in obj.values())


def _parse_json(text: str) -> dict:
    """Extract JSON object from LLM response, handling common issues."""
    import re
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return {"raw_response": text[:500], "parse_failed": True}

    raw = match.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Fix trailing commas
        import re as re2
        fixed = re2.sub(r",\s*}", "}", raw)
        fixed = re2.sub(r",\s*]", "]", fixed)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            return {"raw_response": text[:500], "parse_failed": True}


# ---------------------------------------------------------------------------
# GPU Worker — loads Qwen2.5-7B once, processes batches
# ---------------------------------------------------------------------------

@app.cls(
    image=image,
    gpu="T4",
    max_containers=4,
    timeout=1800,          # 30 min per batch
    retries=2,             # Retry on preemption
    scaledown_window=300,  # Keep warm 5min between calls
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
)
class DescriptionExtractor:
    """Stateful Qwen2.5-7B worker for description extraction.

    Model loads once per container via @modal.enter().
    Each container processes one batch at a time — Modal auto-scales.
    """

    @modal.enter()
    def load_model(self):
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig

        t0 = time.time()
        print(f"[DESC-EXTRACT] Loading {MODEL_ID} with 4-bit quantization...")

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )

        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
        )
        self.model.eval()
        print(f"[DESC-EXTRACT] Model loaded in {time.time()-t0:.1f}s")

    def _generate(self, prompt: str) -> str:
        """Generate text from a single prompt."""
        import torch

        messages = [{"role": "user", "content": prompt}]
        text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )
        inputs = self.tokenizer(
            text, return_tensors="pt", truncation=True, max_length=6144,
        ).to(self.model.device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=2048,
                temperature=0.1,
                do_sample=True,
                top_p=0.9,
                repetition_penalty=1.05,
                pad_token_id=self.tokenizer.pad_token_id,
            )

        new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
        return self.tokenizer.decode(new_tokens, skip_special_tokens=True)

    @modal.method()
    def extract_batch(self, batch: list[dict]) -> list[dict]:
        """Extract descriptions from a batch of vehicles.

        Args:
            batch: List of dicts with keys: id, year, make, model, description, sale_price

        Returns:
            List of dicts ready for description_discoveries upsert.
        """
        results = []

        for vehicle in batch:
            vid = vehicle.get("id", "unknown")
            desc = vehicle.get("description", "")

            if not desc or len(desc) < 100:
                results.append({
                    "vehicle_id": vid,
                    "skipped": True,
                    "skip_reason": "description_too_short",
                })
                continue

            try:
                t0 = time.perf_counter()
                prompt = _build_prompt(vehicle)
                response = self._generate(prompt)
                elapsed_ms = round((time.perf_counter() - t0) * 1000)

                parsed = _parse_json(response)
                keys_found = len(parsed)
                total_fields = _count_fields(parsed)

                results.append({
                    "vehicle_id": vid,
                    "discovered_at": datetime.now(timezone.utc).isoformat(),
                    "model_used": "qwen2.5:7b-modal",
                    "prompt_version": PROMPT_VERSION,
                    "raw_extraction": parsed,
                    "keys_found": keys_found,
                    "total_fields": total_fields,
                    "description_length": len(desc),
                    "sale_price": vehicle.get("sale_price"),
                    "inference_ms": elapsed_ms,
                })
            except Exception as e:
                print(f"[DESC-EXTRACT] Error on {vid[:12]}: {e}")
                results.append({
                    "vehicle_id": vid,
                    "skipped": True,
                    "skip_reason": str(e)[:200],
                })

        return results


# ---------------------------------------------------------------------------
# Local entrypoint — fetch candidates, fan out, write back
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(
    limit: int = 5000,
    min_price: int = 0,
    batch_size: int = 50,
    dry_run: bool = False,
):
    """Batch extract descriptions from Supabase via Modal GPU workers.

    Args:
        limit: Total vehicles to process
        min_price: Minimum sale price filter (0 = all)
        batch_size: Vehicles per GPU worker batch
        dry_run: Print stats without writing to DB
    """
    import urllib.request

    supabase_url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("[DESC-EXTRACT] ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        print("[DESC-EXTRACT] Run with: dotenvx run -- modal run yono/modal_description_discovery.py")
        return

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    # ── Fetch candidates via PostgREST RPC ──
    # Use execute_sql RPC to get vehicles without existing qwen2.5:7b-modal discoveries
    print(f"[DESC-EXTRACT] Fetching up to {limit} candidates (min_price={min_price})...")

    query = f"""
        SELECT v.id, v.year, v.make, v.model, v.description,
               COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price
        FROM vehicles v
        WHERE v.description IS NOT NULL
          AND length(v.description) >= 100
          AND v.deleted_at IS NULL
          AND COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price, 0) >= {min_price}
          AND NOT EXISTS (
            SELECT 1 FROM description_discoveries dd
            WHERE dd.vehicle_id = v.id AND dd.model_used = 'qwen2.5:7b-modal'
          )
        LIMIT {limit}
    """

    rpc_body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/rpc/execute_sql",
        data=rpc_body,
        headers=headers,
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req, timeout=120)
        vehicles = json.loads(resp.read().decode())
    except Exception as e:
        print(f"[DESC-EXTRACT] Error fetching candidates: {e}")
        # Fallback: paginated REST API fetch
        print("[DESC-EXTRACT] Falling back to paginated REST fetch...")
        vehicles = _fetch_paginated(supabase_url, headers, limit, min_price)

    if not isinstance(vehicles, list):
        print(f"[DESC-EXTRACT] Unexpected response type: {type(vehicles)}")
        return

    print(f"[DESC-EXTRACT] Got {len(vehicles)} candidates")

    if not vehicles:
        print("[DESC-EXTRACT] No vehicles to process.")
        return

    # ── Split into batches and fan out to GPU workers ──
    batches = [vehicles[i:i + batch_size] for i in range(0, len(vehicles), batch_size)]
    print(f"[DESC-EXTRACT] Processing {len(vehicles)} vehicles in {len(batches)} batches of {batch_size}")
    print(f"[DESC-EXTRACT] Using 4 T4 containers @ $0.59/hr each")

    extractor = DescriptionExtractor()
    t0 = time.time()

    all_results = []
    batch_num = 0
    for batch_results in extractor.extract_batch.map(batches):
        batch_num += 1
        good = [r for r in batch_results if not r.get("skipped")]
        all_results.extend(batch_results)
        if batch_num % 10 == 0:
            elapsed = time.time() - t0
            rate = len(all_results) / elapsed if elapsed > 0 else 0
            print(f"[DESC-EXTRACT] Batch {batch_num}/{len(batches)} — "
                  f"{len(all_results)} done, {rate:.1f}/s")

    elapsed = time.time() - t0

    # ── Write results to DB ──
    good_results = [r for r in all_results if not r.get("skipped")]
    skipped = len(all_results) - len(good_results)

    if good_results and not dry_run:
        print(f"\n[DESC-EXTRACT] Writing {len(good_results)} results to description_discoveries...")
        written = _write_results(good_results, supabase_url, headers)
    else:
        written = 0
        if dry_run:
            print(f"\n[DESC-EXTRACT] DRY RUN — skipping DB write")

    # ── Report ──
    total_fields = sum(r.get("total_fields", 0) for r in good_results)
    avg_fields = total_fields / len(good_results) if good_results else 0
    avg_keys = sum(r.get("keys_found", 0) for r in good_results) / len(good_results) if good_results else 0
    avg_ms = sum(r.get("inference_ms", 0) for r in good_results) / len(good_results) if good_results else 0
    parse_fails = sum(1 for r in good_results if r.get("raw_extraction", {}).get("parse_failed"))

    print(f"\n{'='*60}")
    print(f"DESCRIPTION DISCOVERY COMPLETE")
    print(f"{'='*60}")
    print(f"  Processed:      {len(all_results)}")
    print(f"  Extracted:      {len(good_results)}")
    print(f"  Skipped:        {skipped}")
    print(f"  Written to DB:  {written}")
    print(f"  Parse failures: {parse_fails}")
    print(f"  Avg keys/desc:  {avg_keys:.1f}")
    print(f"  Avg fields/desc:{avg_fields:.1f}")
    print(f"  Avg inference:  {avg_ms:.0f}ms")
    print(f"  Wall-clock:     {elapsed:.1f}s ({elapsed/60:.1f}min)")
    print(f"  Throughput:     {len(good_results)/elapsed:.1f} desc/s" if elapsed > 0 else "")

    # Cost estimate
    container_hours = (elapsed / 3600) * 4  # 4 containers
    cost = container_hours * 0.59
    print(f"  Est. cost:      ${cost:.2f} ({container_hours:.2f} container-hours)")

    # Sample results
    if good_results:
        print(f"\n{'='*60}")
        print(f"SAMPLE (first 3)")
        print(f"{'='*60}")
        for r in good_results[:3]:
            vid = r["vehicle_id"][:12]
            keys = r.get("keys_found", 0)
            fields = r.get("total_fields", 0)
            ms = r.get("inference_ms", 0)
            print(f"  {vid}... — {keys} keys, {fields} fields, {ms}ms")
            top_keys = list(r.get("raw_extraction", {}).keys())[:8]
            print(f"    Keys: {', '.join(top_keys)}")


def _fetch_paginated(supabase_url: str, headers: dict, limit: int, min_price: int) -> list:
    """Fallback: fetch candidates via paginated REST API."""
    import urllib.request

    vehicles = []
    page_size = 1000
    offset = 0
    remaining = limit

    while remaining > 0:
        fetch_count = min(page_size, remaining)
        price_filter = f"&sale_price=gte.{min_price}" if min_price > 0 else ""
        url = (
            f"{supabase_url}/rest/v1/vehicles"
            f"?select=id,year,make,model,description,sale_price"
            f"&description=not.is.null"
            f"&deleted_at=is.null"
            f"{price_filter}"
            f"&order=id"
            f"&limit={fetch_count}&offset={offset}"
        )

        req = urllib.request.Request(url, headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            page = json.loads(resp.read().decode())
        except Exception as e:
            print(f"[DESC-EXTRACT] Fetch error at offset {offset}: {e}")
            break

        if not page:
            break

        good = [v for v in page if v.get("description") and len(v["description"]) >= 100]
        vehicles.extend(good)
        offset += len(page)
        remaining -= len(page)

        if len(page) < fetch_count:
            break

    return vehicles


def _write_results(results: list[dict], supabase_url: str, headers: dict) -> int:
    """Batch upsert results to description_discoveries. 500 rows per batch."""
    import urllib.request

    written = 0
    batch_size = 500

    for i in range(0, len(results), batch_size):
        batch = results[i:i + batch_size]

        # Build upsert rows (strip internal fields)
        rows = []
        for r in batch:
            if r.get("skipped"):
                continue
            rows.append({
                "vehicle_id": r["vehicle_id"],
                "discovered_at": r.get("discovered_at", datetime.now(timezone.utc).isoformat()),
                "model_used": "qwen2.5:7b-modal",
                "prompt_version": r.get("prompt_version", PROMPT_VERSION),
                "raw_extraction": r["raw_extraction"],
                "keys_found": r.get("keys_found"),
                "total_fields": r.get("total_fields"),
                "description_length": r.get("description_length"),
                "sale_price": r.get("sale_price"),
            })

        if not rows:
            continue

        upsert_headers = {
            **headers,
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }

        req = urllib.request.Request(
            f"{supabase_url}/rest/v1/description_discoveries",
            data=json.dumps(rows).encode(),
            headers=upsert_headers,
            method="POST",
        )

        try:
            urllib.request.urlopen(req, timeout=60)
            written += len(rows)
            print(f"[DESC-EXTRACT] Upserted {written}/{len(results)} rows")
        except Exception as e:
            print(f"[DESC-EXTRACT] Write error at batch {i}: {e}")
            # Try smaller sub-batches on failure
            for sub_start in range(0, len(rows), 50):
                sub = rows[sub_start:sub_start + 50]
                sub_req = urllib.request.Request(
                    f"{supabase_url}/rest/v1/description_discoveries",
                    data=json.dumps(sub).encode(),
                    headers=upsert_headers,
                    method="POST",
                )
                try:
                    urllib.request.urlopen(sub_req, timeout=30)
                    written += len(sub)
                except Exception as sub_e:
                    print(f"[DESC-EXTRACT] Sub-batch error: {sub_e}")

        # Small delay between batches to avoid lock contention
        if i + batch_size < len(results):
            time.sleep(0.2)

    return written
