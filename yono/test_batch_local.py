"""
Local test for YONO batch logic — no Modal required.

Uses local ONNX models + real Supabase to:
1. Load models (same logic as modal_batch.py)
2. Fetch a small batch of pending images from DB
3. Classify them locally
4. Optionally write results back (--write flag)

Usage:
    cd /Users/skylar/nuke
    dotenvx run -- yono/.venv/bin/python yono/test_batch_local.py          # dry run
    dotenvx run -- yono/.venv/bin/python yono/test_batch_local.py --write  # write to DB
    dotenvx run -- yono/.venv/bin/python yono/test_batch_local.py --limit 5
"""

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

# Models are local, not on Modal volume
MODELS_DIR = Path(__file__).parent / "models"


def load_models():
    """Load ONNX models — same logic as BatchWorker.load_models()"""
    import onnxruntime as ort

    state = {
        "flat_sess": None, "flat_labels": None, "flat_input": None,
        "tier1_sess": None, "tier1_input": None, "family_labels": [],
        "tier2": {}, "tier2_labels": {},
    }

    flat_path = MODELS_DIR / "yono_make_v1.onnx"
    flat_labels_path = MODELS_DIR / "yono_labels.json"
    if flat_path.exists() and flat_labels_path.exists():
        state["flat_sess"] = ort.InferenceSession(str(flat_path), providers=["CPUExecutionProvider"])
        state["flat_input"] = state["flat_sess"].get_inputs()[0].name
        with open(flat_labels_path) as f:
            data = json.load(f)
        state["flat_labels"] = data["labels"]
        print(f"  Flat model: {len(state['flat_labels'])} classes")

    hier_path = MODELS_DIR / "hier_family.onnx"
    hier_labels_path = MODELS_DIR / "hier_labels.json"
    if hier_path.exists() and hier_labels_path.exists():
        state["tier1_sess"] = ort.InferenceSession(str(hier_path), providers=["CPUExecutionProvider"])
        state["tier1_input"] = state["tier1_sess"].get_inputs()[0].name
        with open(hier_labels_path) as f:
            all_labels = json.load(f)
        family_map = all_labels.get("hier_family", {})
        state["family_labels"] = sorted(family_map, key=lambda k: family_map[k])
        for family in state["family_labels"]:
            t2_path = MODELS_DIR / f"hier_{family}.onnx"
            if t2_path.exists():
                try:
                    sess = ort.InferenceSession(str(t2_path), providers=["CPUExecutionProvider"])
                    state["tier2"][family] = sess
                    state["tier2_labels"][family] = sorted(
                        all_labels.get(f"hier_{family}", {}),
                        key=lambda k: all_labels[f"hier_{family}"][k],
                    )
                except Exception as e:
                    print(f"  Skip {family} tier-2: {e}")
        print(f"  Hierarchical: tier1={bool(state['tier1_sess'])}, tier2={list(state['tier2'].keys())}")

    return state


def preprocess_bytes(image_bytes):
    import numpy as np
    from PIL import Image

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - mean) / std
    return arr.transpose(2, 0, 1)[np.newaxis]


def softmax(x):
    import numpy as np
    e = np.exp(x - x.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def classify(state, tensor, top_k=5):
    if state["tier1_sess"]:
        logits = state["tier1_sess"].run(None, {state["tier1_input"]: tensor})[0]
        probs = softmax(logits)[0]
        top_idx = int(probs.argmax())
        family = state["family_labels"][top_idx]
        family_conf = float(probs[top_idx])

        if family in state["tier2"]:
            sess = state["tier2"][family]
            inp = sess.get_inputs()[0].name
            logits2 = sess.run(None, {inp: tensor})[0]
            probs2 = softmax(logits2)[0]
            labels2 = state["tier2_labels"][family]
            top_ix = probs2.argsort()[::-1][:top_k]
            top5 = [[labels2[i], float(probs2[i])] for i in top_ix]
            return {
                "make": top5[0][0], "confidence": top5[0][1],
                "family": family, "family_confidence": family_conf,
                "top5": top5, "source": "hierarchical",
                "is_vehicle": top5[0][1] >= 0.20,
            }
        return {
            "make": family, "confidence": family_conf,
            "top5": [[family, family_conf]], "source": "hierarchical_tier1_only",
            "is_vehicle": family_conf >= 0.25,
        }

    if state["flat_sess"]:
        logits = state["flat_sess"].run(None, {state["flat_input"]: tensor})[0]
        probs = softmax(logits)[0]
        top_ix = probs.argsort()[::-1][:top_k]
        top5 = [[state["flat_labels"][i], float(probs[i])] for i in top_ix]
        return {
            "make": top5[0][0], "confidence": top5[0][1],
            "top5": top5, "source": "flat_fallback",
            "is_vehicle": top5[0][1] >= 0.25,
        }

    return {"make": None, "confidence": 0.0, "top5": [], "source": "unavailable", "is_vehicle": False}


def main():
    parser = argparse.ArgumentParser(description="Local YONO batch test")
    parser.add_argument("--write", action="store_true", help="Write results to Supabase")
    parser.add_argument("--limit", type=int, default=10, help="Number of images to process")
    args = parser.parse_args()

    # Check env
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("ERROR: Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (use dotenvx run --)")
        sys.exit(1)

    from supabase import create_client
    import httpx

    print(f"\n=== YONO Local Batch Test ===")
    print(f"Mode: {'WRITE' if args.write else 'DRY RUN'}")
    print(f"Limit: {args.limit}")
    print(f"Models dir: {MODELS_DIR}")
    print()

    # 1. Load models
    print("[1/4] Loading ONNX models...")
    t0 = time.time()
    state = load_models()
    has_models = state["flat_sess"] is not None or state["tier1_sess"] is not None
    if not has_models:
        print("ERROR: No ONNX models found!")
        sys.exit(1)
    print(f"  Loaded in {time.time() - t0:.1f}s\n")

    # 2. Fetch pending images
    print("[2/4] Fetching pending images from Supabase...")
    supabase = create_client(supabase_url, supabase_key)
    resp = (
        supabase.table("vehicle_images")
        .select("id, image_url")
        .eq("ai_processing_status", "pending")
        .not_.is_("image_url", "null")
        .limit(args.limit)
        .execute()
    )
    pending = resp.data or []
    print(f"  Got {len(pending)} pending images\n")

    if not pending:
        print("Nothing to process!")
        return

    # 3. Classify each
    print(f"[3/4] Classifying {len(pending)} images...")
    results = []
    fetch_headers = {
        "User-Agent": "Mozilla/5.0 (compatible; NukeVision/1.0)",
        "Accept": "image/*,*/*",
    }

    for i, rec in enumerate(pending):
        t1 = time.perf_counter()
        try:
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                resp = client.get(rec["image_url"], headers=fetch_headers)
                resp.raise_for_status()
                tensor = preprocess_bytes(resp.content)
                result = classify(state, tensor)
                ms = round((time.perf_counter() - t1) * 1000, 1)
                result["id"] = rec["id"]
                result["classified_at"] = datetime.now(timezone.utc).isoformat()
                results.append(result)
                print(f"  [{i+1}/{len(pending)}] {result['make']} ({result['confidence']:.1%}) — {ms}ms")
        except Exception as e:
            ms = round((time.perf_counter() - t1) * 1000, 1)
            results.append({"id": rec["id"], "error": str(e)[:200]})
            print(f"  [{i+1}/{len(pending)}] ERROR: {str(e)[:80]} — {ms}ms")

    successes = [r for r in results if "error" not in r]
    errors = [r for r in results if "error" in r]
    print(f"\n  Results: {len(successes)} ok, {len(errors)} errors\n")

    # 4. Write (or dry-run)
    if args.write and successes:
        print(f"[4/4] Writing {len(successes)} results to Supabase...")
        written = 0
        for r in successes:
            yono_data = {
                "make": r.get("make"),
                "confidence": r.get("confidence"),
                "top5": r.get("top5"),
                "is_vehicle": r.get("is_vehicle"),
                "source": r.get("source"),
                "classified_at": r.get("classified_at"),
            }
            try:
                supabase.table("vehicle_images").update({
                    "ai_processing_status": "completed",
                    "ai_scan_metadata": json.dumps({"yono": yono_data}),
                }).eq("id", r["id"]).execute()
                written += 1
            except Exception as e:
                print(f"  Write error: {e}")
        print(f"  Written: {written}/{len(successes)}")
    elif not args.write:
        print("[4/4] DRY RUN — skipping DB writes. Use --write to persist.")

    print("\nDone!")


if __name__ == "__main__":
    main()
