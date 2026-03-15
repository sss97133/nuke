"""
GLiNER Zero-Shot NER Extraction for BaT Vehicle Descriptions — Layer 3

Extracts structured entities (engine, transmission, color, mileage, provenance,
modifications, condition, documentation) from free-text vehicle descriptions
using GLiNER medium-v2.1.

Handles long descriptions (>1200 chars) via overlapping chunking with dedup.

Deploy:
  modal deploy yono/modal_extract.py

Test run (10 descriptions):
  modal run yono/modal_extract.py --limit 10

Remote batch (100 descriptions, parallel):
  modal run yono/modal_extract.py --limit 100 --batch-size 25

Local test (no GPU required):
  dotenvx run -- python3 yono/modal_extract.py --local --limit 10
"""

import json
import os
import time
from typing import Optional

import modal

app = modal.App("nuke-extract")

# ---------------------------------------------------------------------------
# Image: GLiNER + dependencies. Model weights are baked in at build time
# so cold starts don't download from HuggingFace.
# ---------------------------------------------------------------------------

def _download_gliner():
    """Download GLiNER medium-v2.1 weights into HuggingFace cache."""
    from gliner import GLiNER
    print("[EXTRACT] Downloading GLiNER medium-v2.1 weights...")
    GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
    print("[EXTRACT] GLiNER cached.")


gliner_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "gliner>=0.2",
        "torch==2.2.2",
        "transformers>=4.40",
        "onnxruntime",
        "httpx",
    ])
    .run_function(_download_gliner)
)


# ---------------------------------------------------------------------------
# Entity labels — tuned for BaT collector vehicle descriptions (v2)
#
# Tested on 10+ real BaT descriptions with the following results:
#   - Engine/transmission: HIGH accuracy (0.87+ confidence)
#   - Exterior color: HIGH accuracy (0.80+ avg)
#   - Mileage: HIGH accuracy (0.77+ avg)
#   - Dates: HIGH accuracy (0.73+ avg)
#   - Documents: GOOD accuracy (0.52+ avg)
#   - Business names: GOOD accuracy (0.73+ avg)
#   - Person names: MODERATE (catches generic roles like "seller")
#   - Wheel/tire: MODERATE (sometimes catches interior items)
# ---------------------------------------------------------------------------

LABELS = [
    # Mechanical
    "engine_type",
    "engine_displacement",
    "horsepower_torque",
    "transmission_type",
    "drivetrain_type",
    # Appearance
    "exterior_paint_color",
    "interior_upholstery_color",
    "interior_material_type",
    # Metrics
    "odometer_mileage",
    "price_amount",
    # History
    "service_or_repair_work",
    "aftermarket_modification",
    "replacement_part_installed",
    # Condition
    "condition_observation",
    "damage_or_defect",
    # Provenance
    "document_or_record",
    "person_name",
    "business_or_shop_name",
    "ownership_event",
    "date_or_year",
    # Equipment
    "factory_option_or_package",
    "wheel_and_tire_spec",
]

# Confidence threshold — 0.30 balances recall vs noise on BaT descriptions
THRESHOLD = 0.30

# Chunking parameters for long descriptions
# GLiNER truncates at 384 tokens (~1200 chars). Overlap prevents entity loss at boundaries.
CHUNK_MAX_CHARS = 1200
CHUNK_OVERLAP = 200


# ---------------------------------------------------------------------------
# Chunking and deduplication
# ---------------------------------------------------------------------------

def _chunk_text(text: str, max_chars: int = CHUNK_MAX_CHARS, overlap: int = CHUNK_OVERLAP) -> list[tuple[str, int]]:
    """Split text into overlapping chunks at sentence boundaries.

    Returns list of (chunk_text, start_offset) tuples.
    Short texts (<= max_chars) return a single chunk.
    """
    if len(text) <= max_chars:
        return [(text, 0)]

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        # Find sentence boundary near end
        if end < len(text):
            for sep in ['. ', '.\n', '\n\n', '\n', ', ']:
                last_sep = text[start:end].rfind(sep)
                if last_sep > max_chars // 2:
                    end = start + last_sep + len(sep)
                    break
        chunks.append((text[start:end], start))
        start = end - overlap
        if start + overlap >= len(text):
            break
    return chunks


def _dedup_entities(entities: list[dict]) -> list[dict]:
    """Deduplicate entities from overlapping chunks.

    Keeps the highest-confidence version of each (text, label) pair.
    Returns entities sorted by start position.
    """
    seen = {}
    for e in sorted(entities, key=lambda x: -x["score"]):
        key = (e["text"].lower().strip(), e["label"])
        if key not in seen:
            seen[key] = e
    return sorted(seen.values(), key=lambda x: x["start"])


# ---------------------------------------------------------------------------
# Post-processing filters
# ---------------------------------------------------------------------------

# Generic role words that person_name catches but aren't actual names
_GENERIC_ROLES = {"seller", "buyer", "owner", "original owner", "second owner",
                  "third owner", "fourth owner", "current owner", "previous owner",
                  "new owner", "first owner"}


def _postprocess_entities(entities: list[dict]) -> list[dict]:
    """Clean up known misclassification patterns.

    - Reclassifies generic ownership roles from person_name to ownership_event
    - Filters obvious misclassifications (interior items as wheel_and_tire_spec)
    """
    cleaned = []
    for e in entities:
        text_lower = e["text"].lower().strip()

        # Reclassify generic roles
        if e["label"] == "person_name" and text_lower in _GENERIC_ROLES:
            e = {**e, "label": "ownership_event"}

        # Filter interior items tagged as wheel_and_tire_spec
        if e["label"] == "wheel_and_tire_spec":
            if any(kw in text_lower for kw in ["interior", "upholstery", "seat", "vinyl", "leather", "dashboard", "dash"]):
                continue  # Drop this entity

        cleaned.append(e)
    return cleaned


# ---------------------------------------------------------------------------
# GLiNER extraction function (GPU worker)
# ---------------------------------------------------------------------------

@app.cls(
    image=gliner_image,
    gpu="T4",
    timeout=600,
    retries=1,
    scaledown_window=120,  # Keep warm for 2min between calls
)
class GLiNERExtractor:
    """Stateful GLiNER extraction worker.

    Model loads once per container, then processes batches of descriptions.
    Each container handles one batch at a time — Modal auto-scales for parallel batches.
    Long descriptions are automatically chunked with overlapping windows.
    """

    @modal.enter()
    def load_model(self):
        from gliner import GLiNER
        t0 = time.time()
        self.model = GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
        print(f"[EXTRACT] GLiNER loaded in {time.time()-t0:.1f}s")

    def _extract_single(self, text: str) -> tuple[list[dict], float]:
        """Extract entities from a single description with chunking.

        Returns (entities, inference_ms).
        """
        t0 = time.perf_counter()
        chunks = _chunk_text(text)

        all_entities = []
        for chunk_text_str, offset in chunks:
            raw = self.model.predict_entities(chunk_text_str, LABELS, threshold=THRESHOLD)
            for e in raw:
                all_entities.append({
                    "text": e["text"],
                    "label": e["label"],
                    "score": round(e["score"], 4),
                    "start": e["start"] + offset,
                    "end": e["end"] + offset,
                })

        entities = _dedup_entities(all_entities)
        entities = _postprocess_entities(entities)
        inference_ms = round((time.perf_counter() - t0) * 1000, 1)
        return entities, inference_ms

    @modal.method()
    def extract_batch(self, descriptions: list[dict]) -> list[dict]:
        """Extract entities from a batch of descriptions.

        Args:
            descriptions: List of dicts with keys:
                - id: vehicle UUID
                - description: text to extract from
                - year (optional): vehicle year for context
                - make (optional): vehicle make for context
                - model (optional): vehicle model for context

        Returns:
            List of dicts with keys:
                - id: vehicle UUID
                - entity_count: number of entities found
                - entities: list of {text, label, score, start, end}
                - labels_used: label set version
                - threshold: confidence threshold used
                - inference_ms: time for this description
                - chunks: number of chunks processed
        """
        results = []

        for desc in descriptions:
            vehicle_id = desc.get("id", "unknown")
            text = desc.get("description", "")

            if not text or len(text) < 20:
                results.append({
                    "id": vehicle_id,
                    "entity_count": 0,
                    "entities": [],
                    "labels_used": "v2",
                    "threshold": THRESHOLD,
                    "inference_ms": 0,
                    "chunks": 0,
                    "skipped": True,
                    "skip_reason": "description_too_short",
                })
                continue

            entities, inference_ms = self._extract_single(text)
            n_chunks = len(_chunk_text(text))

            results.append({
                "id": vehicle_id,
                "entity_count": len(entities),
                "entities": entities,
                "labels_used": "v2",
                "threshold": THRESHOLD,
                "inference_ms": inference_ms,
                "chunks": n_chunks,
            })

        return results


# ---------------------------------------------------------------------------
# Batch processing entry point — reads from Supabase, processes, writes back
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(
    limit: int = 10,
    offset: int = 0,
    batch_size: int = 25,
    dry_run: bool = False,
    write_back: bool = False,
):
    """Process BaT descriptions from the database.

    Args:
        limit: Total descriptions to process
        offset: Starting offset in the query
        batch_size: Descriptions per Modal worker
        dry_run: If True, just print results without writing to DB
        write_back: If True, write extraction results to vehicle_observations
    """
    import httpx

    # Load Supabase credentials from environment
    supabase_url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("[EXTRACT] ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        print("[EXTRACT] Run with: dotenvx run -- modal run yono/modal_extract.py")
        return

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    # Fetch descriptions from Supabase
    print(f"[EXTRACT] Fetching {limit} descriptions (offset={offset})...")
    query_url = (
        f"{supabase_url}/rest/v1/vehicles"
        f"?select=id,description,year,make,model"
        f"&description=not.is.null"
        f"&order=id"
        f"&limit={limit}&offset={offset}"
    )

    resp = httpx.get(query_url, headers=headers, timeout=30)
    resp.raise_for_status()
    vehicles = resp.json()

    # Filter out empty/short descriptions
    vehicles = [v for v in vehicles if v.get("description") and len(v["description"]) > 50]
    print(f"[EXTRACT] Got {len(vehicles)} vehicles with substantial descriptions")

    if not vehicles:
        print("[EXTRACT] No descriptions to process.")
        return

    # Split into batches
    batches = [vehicles[i:i + batch_size] for i in range(0, len(vehicles), batch_size)]
    print(f"[EXTRACT] Processing {len(vehicles)} descriptions in {len(batches)} batches of {batch_size}")

    # Fan out to Modal workers
    extractor = GLiNERExtractor()
    t0 = time.time()

    all_results = []
    for batch_results in extractor.extract_batch.map(batches):
        all_results.extend(batch_results)

    elapsed = time.time() - t0

    # Report results
    total_entities = sum(r["entity_count"] for r in all_results)
    avg_entities = total_entities / len(all_results) if all_results else 0
    avg_ms = sum(r.get("inference_ms", 0) for r in all_results) / len(all_results) if all_results else 0

    print(f"\n{'='*60}")
    print(f"EXTRACTION COMPLETE")
    print(f"{'='*60}")
    print(f"  Descriptions processed: {len(all_results)}")
    print(f"  Total entities found:   {total_entities}")
    print(f"  Avg entities/desc:      {avg_entities:.1f}")
    print(f"  Avg inference time:     {avg_ms:.0f}ms")
    print(f"  Total wall-clock time:  {elapsed:.1f}s")
    print(f"  Throughput:             {len(all_results)/elapsed:.1f} desc/s")

    # Entity distribution
    label_counts = {}
    for r in all_results:
        for e in r.get("entities", []):
            label = e["label"]
            label_counts[label] = label_counts.get(label, 0) + 1

    print(f"\n  Label distribution:")
    for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
        print(f"    {label:35s} {count:5d}  ({count/len(all_results):.1f}/desc)")

    # Print sample results (first 3)
    print(f"\n{'='*60}")
    print(f"SAMPLE RESULTS (first 3)")
    print(f"{'='*60}")
    for r in all_results[:3]:
        vid = r["id"][:12]
        print(f"\n  Vehicle {vid}... ({r['entity_count']} entities, {r.get('inference_ms',0):.0f}ms, {r.get('chunks',1)} chunks)")
        for e in r.get("entities", []):
            print(f"    [{e['label']:35s}] {e['score']:.3f}  \"{e['text']}\"")

    # Optionally write results back to DB
    if write_back and not dry_run:
        print(f"\n[EXTRACT] Writing {total_entities} entities to vehicle_observations...")
        _write_results_to_db(all_results, supabase_url, headers)
    elif dry_run:
        print(f"\n[EXTRACT] DRY RUN — skipping DB write.")
        print(json.dumps(all_results[:3], indent=2))


def _write_results_to_db(results: list[dict], supabase_url: str, headers: dict):
    """Write extraction results to vehicle_observations table."""
    import httpx

    observations = []
    for r in results:
        if not r.get("entities"):
            continue

        # Group entities by label for structured storage
        grouped = {}
        for e in r["entities"]:
            label = e["label"]
            if label not in grouped:
                grouped[label] = []
            grouped[label].append({
                "text": e["text"],
                "score": e["score"],
                "start": e["start"],
                "end": e["end"],
            })

        observations.append({
            "vehicle_id": r["id"],
            "observation_type": "gliner_ner_extraction",
            "data": {
                "entities": r["entities"],
                "grouped": grouped,
                "entity_count": r["entity_count"],
                "labels_version": r["labels_used"],
                "threshold": r["threshold"],
                "inference_ms": r.get("inference_ms", 0),
                "chunks": r.get("chunks", 1),
            },
            "source": "gliner_medium_v2.1",
            "confidence": sum(e["score"] for e in r["entities"]) / len(r["entities"]) if r["entities"] else 0,
        })

    if not observations:
        print("[EXTRACT] No observations to write.")
        return

    # Batch insert via PostgREST
    batch_size = 100
    written = 0
    for i in range(0, len(observations), batch_size):
        batch = observations[i:i + batch_size]
        resp = httpx.post(
            f"{supabase_url}/rest/v1/vehicle_observations",
            headers={**headers, "Prefer": "return=minimal"},
            json=batch,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            written += len(batch)
            print(f"[EXTRACT] Written {written}/{len(observations)} observations")
        else:
            print(f"[EXTRACT] Write error ({resp.status_code}): {resp.text[:200]}")
            break

    print(f"[EXTRACT] Done — {written} observations written.")


# ---------------------------------------------------------------------------
# Local execution mode (no GPU required — runs on CPU)
# ---------------------------------------------------------------------------

def run_local(limit: int = 10, offset: int = 0):
    """Run extraction locally on CPU. For testing without Modal billing."""
    import subprocess
    import httpx
    from gliner import GLiNER

    # Load credentials
    env_proc = subprocess.run(
        ["dotenvx", "run", "--", "env"],
        cwd="/Users/skylar/nuke",
        capture_output=True, text=True
    )
    env_vars = {}
    for line in env_proc.stdout.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            env_vars[k] = v

    supabase_url = env_vars.get("VITE_SUPABASE_URL", "")
    supabase_key = env_vars.get("SUPABASE_SERVICE_ROLE_KEY", "")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    # Fetch
    print(f"[LOCAL] Fetching {limit} descriptions...")
    resp = httpx.get(
        f"{supabase_url}/rest/v1/vehicles"
        f"?select=id,description,year,make,model"
        f"&description=not.is.null"
        f"&order=id"
        f"&limit={limit}&offset={offset}",
        headers=headers, timeout=30,
    )
    resp.raise_for_status()
    vehicles = [v for v in resp.json() if v.get("description") and len(v["description"]) > 50]
    print(f"[LOCAL] Got {len(vehicles)} vehicles")

    # Load model
    print("[LOCAL] Loading GLiNER...")
    t0 = time.time()
    model = GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
    print(f"[LOCAL] Model loaded in {time.time()-t0:.1f}s")

    # Extract
    results = []
    for v in vehicles:
        text = v["description"]
        chunks = _chunk_text(text)
        all_ents = []

        t0 = time.perf_counter()
        for chunk_str, offset_val in chunks:
            raw = model.predict_entities(chunk_str, LABELS, threshold=THRESHOLD)
            for e in raw:
                all_ents.append({
                    "text": e["text"], "label": e["label"],
                    "score": round(e["score"], 4),
                    "start": e["start"] + offset_val,
                    "end": e["end"] + offset_val,
                })

        entities = _postprocess_entities(_dedup_entities(all_ents))
        ms = round((time.perf_counter() - t0) * 1000, 1)

        results.append({
            "id": v["id"],
            "ymm": f"{v.get('year','')} {v.get('make','')} {v.get('model','')}",
            "desc_len": len(text),
            "entity_count": len(entities),
            "entities": entities,
            "inference_ms": ms,
            "chunks": len(chunks),
        })

    # Report
    total_ents = sum(r["entity_count"] for r in results)
    total_ms = sum(r["inference_ms"] for r in results)

    print(f"\n{'='*70}")
    print(f"LOCAL EXTRACTION — {len(results)} descriptions")
    print(f"{'='*70}")
    print(f"  Total entities: {total_ents} ({total_ents/len(results):.1f}/desc)")
    print(f"  Avg inference:  {total_ms/len(results):.0f}ms")
    print(f"  Total time:     {total_ms:.0f}ms")

    label_counts = {}
    for r in results:
        for e in r["entities"]:
            label_counts[e["label"]] = label_counts.get(e["label"], 0) + 1

    print(f"\n  {'Label':<35s} {'Count':>5s}")
    for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
        print(f"  {label:<35s} {count:5d}")

    for r in results:
        print(f"\n  {r['ymm']} ({r['entity_count']} entities, {r['inference_ms']:.0f}ms, {r['chunks']} chunks)")
        for e in r["entities"]:
            print(f"    [{e['label']:35s}] {e['score']:.3f}  \"{e['text']}\"")

    with open("/tmp/gliner-extract-results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Results: /tmp/gliner-extract-results.json")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="Run locally on CPU")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()

    if args.local:
        run_local(limit=args.limit, offset=args.offset)
    else:
        print("Use 'modal run yono/modal_extract.py' for Modal execution")
        print("Use '--local' flag for CPU-only local execution")
