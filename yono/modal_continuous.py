"""
YONO Autonomous Daily Training Pipeline

Daily cron at 2am UTC. Six phases:
  1. CHECK  — query Supabase for new labeled data, decide whether to train
  2. TRAIN  — blocking call to train_make_classifier (15 epochs, 500K limit)
  3. EVALUATE — run candidate + production on fixed 500-image eval set
  4. PROMOTE or REJECT — copy ONNX to production slot, call /reload
  5. HEALTH CHECK — send test images to /classify, verify sanity
  6. SELF-DEBUG — OOM retry, failure counting, auto-pause after 3 consecutive

Deploy:
    modal deploy yono/modal_continuous.py

Manual:
    modal run yono/modal_continuous.py --action daily          # Full loop
    modal run yono/modal_continuous.py --action evaluate       # Eval latest run
    modal run yono/modal_continuous.py --action promote        # Force promote latest
    modal run yono/modal_continuous.py --action rollback       # Rollback to .prev
    modal run yono/modal_continuous.py --action health-check   # Sanity check serving
    modal run yono/modal_continuous.py --action build-eval-set # Rebuild 500-image eval set
    modal run yono/modal_continuous.py --action history        # Last 10 registry rows
    modal run yono/modal_continuous.py --action status         # Volume state + models
"""

import modal
import os
import json
import shutil
from datetime import datetime, timedelta

app = modal.App("yono-continuous")

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

# Heavier image — needs ONNX runtime for evaluation phase
pipeline_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "supabase",
        "httpx",
        "onnxruntime",
        "Pillow",
        "numpy<2",
        "torch",
        "timm",
        "onnx",
    ])
)

STATE_FILE = "/data/continuous/state.json"
EVAL_SET_PATH = "/data/eval/eval_set.json"
MODELS_DIR = "/data/models"
RUNS_DIR = "/data/runs"
CANDIDATE_ONNX = "/data/models/yono_make_candidate.onnx"
CANDIDATE_LABELS = "/data/models/yono_labels_candidate.json"
PRODUCTION_ONNX = "/data/models/yono_make_v1.onnx"
PRODUCTION_LABELS = "/data/models/yono_labels.json"
PREV_ONNX = "/data/models/yono_make_v1.onnx.prev"
PREV_LABELS = "/data/models/yono_labels.json.prev"

# Thresholds
VISION_NEW_DATA_THRESHOLD = 5000  # new images to trigger training
LLM_NEW_DATA_THRESHOLD = 500
PROMOTE_ACCURACY_MARGIN = 1.0  # candidate must be within 1% of production
HEALTH_CHECK_MIN_CONFIDENCE = 0.3
HEALTH_CHECK_MAX_LATENCY_MS = 500
MAX_CONSECUTIVE_FAILURES = 3


# ============================================================
# State management
# ============================================================

def _load_state() -> dict:
    """Load persistent state from volume."""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "last_vision_train": None,
        "last_llm_train": None,
        "last_vision_image_count": 0,
        "last_llm_example_count": 0,
        "consecutive_failures": 0,
        "pipeline_paused": False,
        "pause_reason": None,
    }


def _save_state(state: dict):
    """Persist state to volume."""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, default=str)


def _get_supabase():
    """Create Supabase client from env."""
    from supabase import create_client
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _log(msg: str):
    """Print with timestamp."""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def _record_metric(sb, registry_id: str | None, metric_type: str, value: float, metadata: dict = None):
    """Insert a row into yono_training_metrics."""
    row = {
        "metric_type": metric_type,
        "metric_value": value,
        "metadata": json.dumps(metadata or {}),
    }
    if registry_id:
        row["model_registry_id"] = registry_id
    try:
        sb.table("yono_training_metrics").insert(row).execute()
    except Exception as e:
        _log(f"WARNING: failed to record metric: {e}")


# ============================================================
# Phase 1: CHECK — should we train?
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=300,
)
def check_for_new_data() -> dict:
    """Check Supabase for new labeled images since last run."""
    sb = _get_supabase()
    state = _load_state()

    # Pipeline paused?
    if state.get("pipeline_paused"):
        _log(f"Pipeline PAUSED: {state.get('pause_reason', 'unknown')}")
        return {"action": "skip", "reason": f"paused: {state.get('pause_reason')}"}

    # Count vehicles with make (proxy for labeled images)
    try:
        result = sb.table("vehicles").select(
            "id", count="exact"
        ).not_.is_("make", "null").execute()
        current_count = result.count or 0
    except Exception as e:
        _log(f"Failed to count vehicles: {e}")
        current_count = state.get("last_vision_image_count", 0)

    delta = current_count - state.get("last_vision_image_count", 0)
    never_trained = state.get("last_vision_train") is None

    should_train = delta >= VISION_NEW_DATA_THRESHOLD or never_trained

    # Check if previous training is still running (stale detection)
    if state.get("last_vision_train"):
        try:
            last_train = datetime.fromisoformat(state["last_vision_train"])
            hours_since = (datetime.now() - last_train).total_seconds() / 3600
            # If last train was <24h ago, check if it completed
            if hours_since < 24:
                # Look for the latest run dir with metadata.json
                latest_run = _find_latest_run()
                if latest_run:
                    meta = _load_run_metadata(latest_run)
                    if meta and meta.get("completed_at"):
                        completed = datetime.fromisoformat(meta["completed_at"])
                        if completed > last_train:
                            pass  # Training completed, proceed
                    else:
                        _log(f"Training may still be running (started {hours_since:.1f}h ago)")
                        if hours_since < 12:
                            return {"action": "skip", "reason": "training_in_progress",
                                    "hours_since_start": round(hours_since, 1)}
        except (ValueError, TypeError):
            pass

    report = {
        "checked_at": datetime.now().isoformat(),
        "current_count": current_count,
        "last_trained_count": state.get("last_vision_image_count", 0),
        "delta": delta,
        "never_trained": never_trained,
        "should_train": should_train,
        "action": "train" if should_train else "skip",
    }

    _log(f"CHECK: count={current_count}, delta={delta}, should_train={should_train}")
    return report


# ============================================================
# Phase 2: TRAIN — blocking call
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=43200,  # 12 hours max
)
def train_and_register(batch_size: int = 64, epochs: int = 15, limit: int = 500000) -> dict:
    """Train vision model and register in DB. Blocking — returns when done."""
    sb = _get_supabase()
    state = _load_state()

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Insert registry row
    registry_row = sb.table("yono_model_registry").insert({
        "model_type": "make_classifier",
        "run_id": run_id,
        "status": "training",
        "training_params": json.dumps({
            "epochs": epochs,
            "batch_size": batch_size,
            "limit": limit,
            "model": "efficientnet_b0",
        }),
    }).execute()
    registry_id = registry_row.data[0]["id"]
    _log(f"TRAIN: registered run {run_id} (registry_id={registry_id})")

    # Call training function BLOCKING (not spawn)
    try:
        train_fn = modal.Function.from_name("yono-training", "train_make_classifier")
        result = train_fn.remote(limit=limit, epochs=epochs, batch_size=batch_size)
        _log(f"TRAIN: completed — val_acc={result.get('best_val_acc', '?')}%")
    except Exception as e:
        _log(f"TRAIN: FAILED — {e}")
        sb.table("yono_model_registry").update({
            "status": "failed",
            "rejected_reason": str(e)[:500],
        }).eq("id", registry_id).execute()
        _record_metric(sb, registry_id, "training_failure", 1.0, {"error": str(e)[:500]})
        return {"status": "failed", "error": str(e), "registry_id": registry_id}

    # Reload volume to see training outputs
    volume.reload()

    # Find the run directory (training writes to /data/runs/<timestamp>/)
    run_dir = result.get("output_dir", f"/data/runs/{run_id}")
    actual_run_id = result.get("run_id", run_id)

    # Read metadata from the training run
    val_acc = result.get("best_val_acc", 0)
    num_classes = result.get("num_classes", 0)
    total_samples = result.get("total_samples", 0)

    # Update registry
    sb.table("yono_model_registry").update({
        "status": "trained",
        "training_completed_at": datetime.now().isoformat(),
        "training_duration_s": None,  # TODO: compute from start
        "val_accuracy": val_acc,
        "checkpoint_path": f"{run_dir}/best_model.pt",
    }).eq("id", registry_id).execute()

    # Update state
    state["last_vision_train"] = datetime.now().isoformat()
    state["last_vision_image_count"] = total_samples + state.get("last_vision_image_count", 0)
    _save_state(state)
    volume.commit()

    return {
        "status": "trained",
        "registry_id": registry_id,
        "run_id": actual_run_id,
        "run_dir": run_dir,
        "val_accuracy": val_acc,
        "num_classes": num_classes,
        "total_samples": total_samples,
    }


# ============================================================
# Eval set management
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=1800,  # 30 min
)
def build_eval_set(num_makes: int = 50, images_per_make: int = 10) -> dict:
    """Build a fixed eval set: stratified sample of images by make.

    Once built, this set NEVER changes (ensures consistent eval across runs).
    Force rebuild by deleting /data/eval/eval_set.json then calling this.
    """
    import httpx

    if os.path.exists(EVAL_SET_PATH):
        with open(EVAL_SET_PATH) as f:
            existing = json.load(f)
        _log(f"Eval set already exists: {len(existing['images'])} images, {len(existing['makes'])} makes")
        return {"status": "exists", "count": len(existing["images"]), "makes": len(existing["makes"])}

    sb = _get_supabase()

    # Get top makes by vehicle count — paginate to get broad coverage
    _log(f"Building eval set: {num_makes} makes x {images_per_make} images")
    from collections import Counter

    counts = Counter()
    page_size = 1000
    for offset in range(0, 50000, page_size):
        result = sb.table("vehicles").select("make").not_.is_(
            "make", "null"
        ).range(offset, offset + page_size - 1).execute()
        if not result.data:
            break
        counts.update(r["make"] for r in result.data)
    makes = [m for m, c in counts.most_common(num_makes) if c >= images_per_make]

    _log(f"Found {len(makes)} qualifying makes")

    # Sample images per make — get vehicle IDs first, then images
    eval_images = []
    for make in makes:
        # Get vehicles for this make
        v_result = sb.table("vehicles").select("id").eq(
            "make", make
        ).limit(images_per_make * 2).execute()

        vehicle_ids = [r["id"] for r in v_result.data]
        if not vehicle_ids:
            continue

        # Get images for these vehicles
        img_result = sb.table("vehicle_images").select(
            "id, image_url, vehicle_id"
        ).in_("vehicle_id", vehicle_ids[:20]).not_.is_(
            "image_url", "null"
        ).limit(images_per_make).execute()

        for img in img_result.data:
            eval_images.append({
                "id": img["id"],
                "image_url": img["image_url"],
                "expected_make": make,
            })

    # Validate URLs are accessible (sample 5)
    valid_count = 0
    with httpx.Client(timeout=10, follow_redirects=True) as client:
        for img in eval_images[:5]:
            try:
                resp = client.head(img["image_url"])
                if resp.status_code < 400:
                    valid_count += 1
            except Exception:
                pass

    eval_set = {
        "built_at": datetime.now().isoformat(),
        "makes": makes,
        "images_per_make": images_per_make,
        "images": eval_images,
        "validation_sample": f"{valid_count}/5 accessible",
    }

    os.makedirs(os.path.dirname(EVAL_SET_PATH), exist_ok=True)
    with open(EVAL_SET_PATH, "w") as f:
        json.dump(eval_set, f, indent=2)
    volume.commit()

    _log(f"Eval set built: {len(eval_images)} images across {len(makes)} makes")
    return {"status": "built", "count": len(eval_images), "makes": len(makes)}


# ============================================================
# Phase 3: EVALUATE — compare candidate vs production
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=3600,  # 1 hour
)
def evaluate_model(registry_id: str = None) -> dict:
    """Export candidate to ONNX and evaluate against production on fixed eval set."""
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    import io
    import httpx
    import torch
    import timm

    sb = _get_supabase()

    # Load eval set
    if not os.path.exists(EVAL_SET_PATH):
        _log("No eval set found — building one first")
        build_eval_set.remote()
        volume.reload()
        if not os.path.exists(EVAL_SET_PATH):
            return {"status": "error", "error": "Could not build eval set"}

    with open(EVAL_SET_PATH) as f:
        eval_set = json.load(f)

    eval_images = eval_set["images"]
    _log(f"EVALUATE: {len(eval_images)} eval images, {len(eval_set['makes'])} makes")

    # Find the registry row to evaluate
    if registry_id:
        reg_result = sb.table("yono_model_registry").select("*").eq("id", registry_id).execute()
    else:
        # Get latest trained/evaluating row
        reg_result = sb.table("yono_model_registry").select("*").in_(
            "status", ["trained", "evaluating"]
        ).order("created_at", desc=True).limit(1).execute()

    if not reg_result.data:
        return {"status": "error", "error": "No model to evaluate"}

    reg = reg_result.data[0]
    registry_id = reg["id"]
    checkpoint_path = reg.get("checkpoint_path")

    if not checkpoint_path or not os.path.exists(checkpoint_path):
        return {"status": "error", "error": f"Checkpoint not found: {checkpoint_path}"}

    # Mark as evaluating
    sb.table("yono_model_registry").update({"status": "evaluating"}).eq("id", registry_id).execute()

    # --- Export candidate checkpoint to ONNX ---
    _log("Exporting candidate to ONNX...")
    run_dir = os.path.dirname(checkpoint_path)
    labels_path = f"{run_dir}/labels.json"

    if not os.path.exists(labels_path):
        return {"status": "error", "error": f"Labels not found: {labels_path}"}

    with open(labels_path) as f:
        labels_data = json.load(f)

    # labels.json is {idx_str: make_name}
    num_classes = len(labels_data)
    idx_to_label = {int(k): v for k, v in labels_data.items()}

    model = timm.create_model("efficientnet_b0", pretrained=False, num_classes=num_classes)
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    state_dict = ckpt.get("model_state_dict", ckpt)
    model.load_state_dict(state_dict)
    model.eval()

    dummy = torch.randn(1, 3, 224, 224)
    os.makedirs(MODELS_DIR, exist_ok=True)

    torch.onnx.export(
        model, dummy, CANDIDATE_ONNX,
        export_params=True, opset_version=17,
        input_names=["image"], output_names=["logits"],
        dynamic_axes={"image": {0: "batch_size"}, "logits": {0: "batch_size"}},
    )

    candidate_labels_list = [idx_to_label[i] for i in range(num_classes)]
    with open(CANDIDATE_LABELS, "w") as f:
        json.dump({"labels": candidate_labels_list}, f)

    volume.commit()
    _log(f"Candidate ONNX exported: {num_classes} classes")

    # --- Preprocessing helper ---
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def preprocess(image_bytes: bytes) -> np.ndarray:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
        arr = np.array(img, dtype=np.float32) / 255.0
        arr = (arr - mean) / std
        return arr.transpose(2, 0, 1)[np.newaxis].astype(np.float32)

    def run_eval(onnx_path: str, labels_json_path: str) -> dict:
        """Run eval set through an ONNX model, return accuracy."""
        if not os.path.exists(onnx_path):
            return {"accuracy": 0, "error": f"Model not found: {onnx_path}"}

        sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        input_name = sess.get_inputs()[0].name

        with open(labels_json_path) as f:
            labels = json.load(f).get("labels", [])

        correct = 0
        total = 0
        errors = 0

        with httpx.Client(timeout=15, follow_redirects=True) as client:
            for img_entry in eval_images:
                try:
                    resp = client.get(img_entry["image_url"])
                    resp.raise_for_status()
                    tensor = preprocess(resp.content)
                    logits = sess.run(None, {input_name: tensor})[0]
                    pred_idx = int(logits[0].argmax())
                    pred_make = labels[pred_idx] if pred_idx < len(labels) else "unknown"
                    if pred_make.lower() == img_entry["expected_make"].lower():
                        correct += 1
                    total += 1
                except Exception:
                    errors += 1

        accuracy = (correct / total * 100) if total > 0 else 0
        return {"accuracy": accuracy, "correct": correct, "total": total, "errors": errors}

    # --- Run eval on candidate ---
    _log("Evaluating candidate model...")
    candidate_result = run_eval(CANDIDATE_ONNX, CANDIDATE_LABELS)
    _log(f"Candidate: {candidate_result['accuracy']:.1f}% ({candidate_result['correct']}/{candidate_result['total']})")

    # --- Run eval on production ---
    production_result = {"accuracy": 0, "correct": 0, "total": 0, "errors": 0}
    if os.path.exists(PRODUCTION_ONNX) and os.path.exists(PRODUCTION_LABELS):
        _log("Evaluating production model...")
        production_result = run_eval(PRODUCTION_ONNX, PRODUCTION_LABELS)
        _log(f"Production: {production_result['accuracy']:.1f}% ({production_result['correct']}/{production_result['total']})")
    else:
        _log("No production model found — candidate auto-qualifies")

    # --- Decision ---
    candidate_acc = candidate_result["accuracy"]
    production_acc = production_result["accuracy"]
    should_promote = candidate_acc >= (production_acc - PROMOTE_ACCURACY_MARGIN)

    # Update registry
    sb.table("yono_model_registry").update({
        "eval_accuracy": candidate_acc,
        "eval_results": json.dumps({
            "candidate": candidate_result,
            "production": production_result,
            "decision": "promote" if should_promote else "reject",
        }),
        "onnx_path": CANDIDATE_ONNX,
    }).eq("id", registry_id).execute()

    # Record metrics
    _record_metric(sb, registry_id, "eval_accuracy", candidate_acc, {
        "production_accuracy": production_acc,
        "decision": "promote" if should_promote else "reject",
    })

    result = {
        "status": "evaluated",
        "registry_id": registry_id,
        "candidate_accuracy": candidate_acc,
        "production_accuracy": production_acc,
        "should_promote": should_promote,
        "margin": round(candidate_acc - production_acc, 2),
    }

    _log(f"EVALUATE: {'PROMOTE' if should_promote else 'REJECT'} (margin={result['margin']:+.1f}%)")
    return result


# ============================================================
# Phase 4: PROMOTE / REJECT / ROLLBACK
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=600,
)
def promote_model(registry_id: str = None) -> dict:
    """Promote candidate ONNX to production slot and call /reload on serving."""
    import httpx

    sb = _get_supabase()

    # Find model to promote
    if registry_id:
        reg_result = sb.table("yono_model_registry").select("*").eq("id", registry_id).execute()
    else:
        reg_result = sb.table("yono_model_registry").select("*").in_(
            "status", ["evaluating", "trained"]
        ).order("created_at", desc=True).limit(1).execute()

    if not reg_result.data:
        return {"status": "error", "error": "No model to promote"}

    reg = reg_result.data[0]
    registry_id = reg["id"]

    if not os.path.exists(CANDIDATE_ONNX):
        return {"status": "error", "error": "Candidate ONNX not found"}

    # Archive current production as .prev
    if os.path.exists(PRODUCTION_ONNX):
        shutil.copy2(PRODUCTION_ONNX, PREV_ONNX)
        _log("Archived production model as .prev")
    if os.path.exists(PRODUCTION_LABELS):
        shutil.copy2(PRODUCTION_LABELS, PREV_LABELS)

    # Copy candidate to production
    shutil.copy2(CANDIDATE_ONNX, PRODUCTION_ONNX)
    shutil.copy2(CANDIDATE_LABELS, PRODUCTION_LABELS)
    _log("Candidate promoted to production")

    # Clean up candidate files
    os.remove(CANDIDATE_ONNX)
    os.remove(CANDIDATE_LABELS)

    volume.commit()

    # Update registry
    sb.table("yono_model_registry").update({
        "status": "promoted",
        "promoted_at": datetime.now().isoformat(),
        "onnx_path": PRODUCTION_ONNX,
    }).eq("id", registry_id).execute()

    # Call /reload on serving app
    reload_result = _call_reload()
    _log(f"Reload result: {reload_result}")

    return {
        "status": "promoted",
        "registry_id": registry_id,
        "reload": reload_result,
    }


@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=300,
)
def reject_model(registry_id: str, reason: str = "eval_accuracy_below_threshold") -> dict:
    """Mark model as rejected and clean up candidate ONNX."""
    sb = _get_supabase()

    # Clean up candidate
    for path in [CANDIDATE_ONNX, CANDIDATE_LABELS]:
        if os.path.exists(path):
            os.remove(path)
    volume.commit()

    sb.table("yono_model_registry").update({
        "status": "rejected",
        "rejected_reason": reason,
    }).eq("id", registry_id).execute()

    _log(f"REJECT: {registry_id} — {reason}")
    return {"status": "rejected", "registry_id": registry_id, "reason": reason}


@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=300,
)
def rollback_model() -> dict:
    """Restore .prev model to production and call /reload."""
    import httpx

    sb = _get_supabase()

    if not os.path.exists(PREV_ONNX):
        return {"status": "error", "error": "No .prev model to rollback to"}

    # Restore
    shutil.copy2(PREV_ONNX, PRODUCTION_ONNX)
    if os.path.exists(PREV_LABELS):
        shutil.copy2(PREV_LABELS, PRODUCTION_LABELS)

    volume.commit()

    # Mark latest promoted model as rolled_back
    reg_result = sb.table("yono_model_registry").select("*").eq(
        "status", "promoted"
    ).order("promoted_at", desc=True).limit(1).execute()

    if reg_result.data:
        sb.table("yono_model_registry").update({
            "status": "rolled_back",
            "rejected_reason": "health_check_failed",
        }).eq("id", reg_result.data[0]["id"]).execute()

    reload_result = _call_reload()
    _log(f"ROLLBACK complete, reload: {reload_result}")

    return {"status": "rolled_back", "reload": reload_result}


def _call_reload() -> dict:
    """Call /reload on the yono-serve app."""
    import httpx

    try:
        # Get the serve URL from Modal
        serve_fn = modal.Function.from_name("yono-serve", "fastapi_app")
        # The web URL for the app
        sidecar_url = os.environ.get("YONO_SIDECAR_URL", "")
        if not sidecar_url:
            return {"status": "skipped", "reason": "YONO_SIDECAR_URL not set"}

        token = os.environ.get("MODAL_SIDECAR_TOKEN", "")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        with httpx.Client(timeout=30) as client:
            resp = client.post(f"{sidecar_url}/reload", headers=headers)
            return resp.json()
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ============================================================
# Phase 5: HEALTH CHECK
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=600,
)
def health_check() -> dict:
    """Send test images to /classify and verify sanity."""
    import httpx

    sb = _get_supabase()

    sidecar_url = os.environ.get("YONO_SIDECAR_URL", "")
    if not sidecar_url:
        return {"status": "skipped", "reason": "YONO_SIDECAR_URL not set"}

    token = os.environ.get("MODAL_SIDECAR_TOKEN", "")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    # Get 10 test images from eval set or DB
    test_images = []
    if os.path.exists(EVAL_SET_PATH):
        with open(EVAL_SET_PATH) as f:
            eval_set = json.load(f)
        test_images = eval_set["images"][:10]
    else:
        result = sb.table("vehicle_images").select(
            "id, image_url"
        ).not_.is_("image_url", "null").limit(10).execute()
        test_images = [{"image_url": r["image_url"]} for r in result.data]

    if not test_images:
        return {"status": "error", "error": "No test images available"}

    results = []
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        for img in test_images:
            try:
                resp = client.post(
                    f"{sidecar_url}/classify",
                    json={"image_url": img["image_url"]},
                    headers=headers,
                )
                data = resp.json()
                results.append({
                    "make": data.get("make"),
                    "confidence": data.get("confidence", 0),
                    "ms": data.get("ms", 0),
                    "error": data.get("error"),
                })
            except Exception as e:
                results.append({"make": None, "confidence": 0, "ms": 0, "error": str(e)})

    # Analyze results
    non_null_makes = [r for r in results if r["make"] is not None]
    avg_confidence = sum(r["confidence"] for r in non_null_makes) / len(non_null_makes) if non_null_makes else 0
    avg_latency = sum(r["ms"] for r in results) / len(results) if results else 0
    error_count = sum(1 for r in results if r.get("error"))

    passed = (
        len(non_null_makes) >= 7  # at least 7/10 return a make
        and avg_confidence >= HEALTH_CHECK_MIN_CONFIDENCE
        and avg_latency <= HEALTH_CHECK_MAX_LATENCY_MS
    )

    # Record metric
    _record_metric(sb, None, "health_check", 1.0 if passed else 0.0, {
        "non_null_makes": len(non_null_makes),
        "avg_confidence": round(avg_confidence, 3),
        "avg_latency_ms": round(avg_latency, 1),
        "errors": error_count,
    })

    status = "passed" if passed else "failed"
    _log(f"HEALTH CHECK: {status} — {len(non_null_makes)}/10 makes, "
         f"avg_conf={avg_confidence:.2f}, avg_latency={avg_latency:.0f}ms")

    return {
        "status": status,
        "passed": passed,
        "non_null_makes": len(non_null_makes),
        "avg_confidence": round(avg_confidence, 3),
        "avg_latency_ms": round(avg_latency, 1),
        "errors": error_count,
        "details": results,
    }


# ============================================================
# Phase 6: SELF-DEBUG
# ============================================================

def _handle_failure(state: dict, sb, error: str, registry_id: str = None):
    """Increment failure counter, pause if too many consecutive failures."""
    state["consecutive_failures"] = state.get("consecutive_failures", 0) + 1
    failures = state["consecutive_failures"]

    _record_metric(sb, registry_id, "training_failure", float(failures), {"error": error[:500]})

    if failures >= MAX_CONSECUTIVE_FAILURES:
        state["pipeline_paused"] = True
        state["pause_reason"] = f"{failures} consecutive failures. Last: {error[:200]}"
        _log(f"SELF-DEBUG: PAUSING pipeline after {failures} consecutive failures")
    else:
        _log(f"SELF-DEBUG: failure {failures}/{MAX_CONSECUTIVE_FAILURES}")

    _save_state(state)


def _handle_success(state: dict):
    """Reset failure counter on success."""
    state["consecutive_failures"] = 0
    _save_state(state)


# ============================================================
# Helper functions
# ============================================================

def _find_latest_run() -> str | None:
    """Find the latest training run directory."""
    if not os.path.exists(RUNS_DIR):
        return None
    runs = sorted(os.listdir(RUNS_DIR), reverse=True)
    for run in runs:
        if os.path.exists(f"{RUNS_DIR}/{run}/best_model.pt"):
            return run
    return None


def _load_run_metadata(run_name: str) -> dict | None:
    """Load metadata.json from a run directory."""
    meta_path = f"{RUNS_DIR}/{run_name}/metadata.json"
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            return json.load(f)
    return None


# ============================================================
# Status and history
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    timeout=120,
)
def get_history(limit: int = 10) -> dict:
    """Get last N model registry entries."""
    sb = _get_supabase()

    result = sb.table("yono_model_registry").select("*").order(
        "created_at", desc=True
    ).limit(limit).execute()

    return {"runs": result.data}


@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    timeout=120,
)
def get_status() -> dict:
    """Get full pipeline status: state, models on volume, recent runs."""
    state = _load_state()

    # Check ONNX models
    models = {}
    if os.path.exists(MODELS_DIR):
        for f in os.listdir(MODELS_DIR):
            fpath = f"{MODELS_DIR}/{f}"
            if os.path.isfile(fpath):
                models[f] = {
                    "size_mb": round(os.path.getsize(fpath) / 1e6, 1),
                    "modified": datetime.fromtimestamp(os.path.getmtime(fpath)).isoformat(),
                }

    # Check recent runs
    recent_runs = []
    if os.path.exists(RUNS_DIR):
        for run_dir in sorted(os.listdir(RUNS_DIR), reverse=True)[:5]:
            meta = _load_run_metadata(run_dir)
            if meta:
                recent_runs.append(meta)
            else:
                recent_runs.append({"run_id": run_dir, "metadata": "missing"})

    # Eval set info
    eval_info = None
    if os.path.exists(EVAL_SET_PATH):
        with open(EVAL_SET_PATH) as f:
            es = json.load(f)
        eval_info = {
            "built_at": es.get("built_at"),
            "images": len(es.get("images", [])),
            "makes": len(es.get("makes", [])),
        }

    return {
        "state": state,
        "models": models,
        "recent_runs": recent_runs,
        "eval_set": eval_info,
        "has_prev_model": os.path.exists(PREV_ONNX),
    }


# ============================================================
# THE DAILY LOOP — orchestrates all phases
# ============================================================

@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
    schedule=modal.Cron("0 2 * * *"),  # Daily 2am UTC
    timeout=43200,  # 12 hours
)
def daily_autonomous_loop():
    """Daily cron: check -> train -> evaluate -> promote/reject -> health check."""
    sb = _get_supabase()
    state = _load_state()

    _log("=" * 60)
    _log("YONO Daily Autonomous Training Pipeline")
    _log("=" * 60)

    # --- Phase 1: CHECK ---
    _log("\n--- Phase 1: CHECK ---")

    if state.get("pipeline_paused"):
        _log(f"Pipeline PAUSED: {state.get('pause_reason')}")
        _record_metric(sb, None, "health_check", 0.0, {"reason": "pipeline_paused"})
        _save_log({"action": "paused", "reason": state.get("pause_reason")})
        return {"status": "paused", "reason": state.get("pause_reason")}

    check = check_for_new_data.remote()

    if check.get("action") != "train":
        _log(f"Skipping: {check.get('reason', 'not enough new data')}")
        _save_log({"action": "skip", "check": check})
        return {"status": "skipped", "check": check}

    # --- Phase 2: TRAIN ---
    _log("\n--- Phase 2: TRAIN ---")
    try:
        train_result = train_and_register.remote()
    except Exception as e:
        _log(f"TRAIN error: {e}")
        _handle_failure(state, sb, f"train_error: {e}")
        volume.commit()
        _save_log({"action": "train_failed", "error": str(e)})
        return {"status": "train_failed", "error": str(e)}

    if train_result.get("status") == "failed":
        error = train_result.get("error", "unknown")
        _handle_failure(state, sb, error, train_result.get("registry_id"))
        volume.commit()

        # Self-debug: OOM -> retry with smaller batch
        if "out of memory" in error.lower() or "oom" in error.lower():
            _log("SELF-DEBUG: OOM detected, retrying with batch_size=32")
            try:
                train_result = train_and_register.remote(batch_size=32, epochs=15, limit=250000)
            except Exception as e2:
                _save_log({"action": "train_retry_failed", "error": str(e2)})
                return {"status": "train_retry_failed"}

            if train_result.get("status") == "failed":
                _save_log({"action": "train_retry_failed"})
                return {"status": "train_retry_failed"}

        else:
            _save_log({"action": "train_failed", "error": error})
            return {"status": "train_failed", "error": error}

    registry_id = train_result["registry_id"]
    _handle_success(state)
    volume.commit()

    # --- Phase 3: EVALUATE ---
    _log("\n--- Phase 3: EVALUATE ---")
    volume.reload()

    # Ensure eval set exists
    build_eval_set.remote()
    volume.reload()

    try:
        eval_result = evaluate_model.remote(registry_id=registry_id)
    except Exception as e:
        _log(f"EVALUATE error: {e}")
        _save_log({"action": "eval_failed", "error": str(e), "registry_id": registry_id})
        return {"status": "eval_failed", "error": str(e)}

    # --- Phase 4: PROMOTE or REJECT ---
    _log("\n--- Phase 4: PROMOTE/REJECT ---")
    if eval_result.get("should_promote"):
        try:
            promote_result = promote_model.remote(registry_id=registry_id)
        except Exception as e:
            _log(f"PROMOTE error: {e}")
            _save_log({"action": "promote_failed", "error": str(e)})
            return {"status": "promote_failed", "error": str(e)}

        # --- Phase 5: HEALTH CHECK ---
        _log("\n--- Phase 5: HEALTH CHECK ---")
        try:
            hc = health_check.remote()
        except Exception as e:
            _log(f"Health check error: {e}")
            hc = {"passed": False, "error": str(e)}

        if not hc.get("passed"):
            _log("Health check FAILED — rolling back")
            rollback_model.remote()
            _save_log({
                "action": "promoted_then_rolled_back",
                "registry_id": registry_id,
                "eval": eval_result,
                "health_check": hc,
            })
            return {"status": "rolled_back", "reason": "health_check_failed", "health": hc}

        _log("Health check PASSED")
        _save_log({
            "action": "promoted",
            "registry_id": registry_id,
            "eval": eval_result,
            "health_check": hc,
        })
        return {"status": "promoted", "registry_id": registry_id, "eval": eval_result, "health": hc}

    else:
        reject_model.remote(
            registry_id=registry_id,
            reason=f"candidate_acc={eval_result.get('candidate_accuracy', 0):.1f}% < "
                   f"production_acc={eval_result.get('production_accuracy', 0):.1f}% - {PROMOTE_ACCURACY_MARGIN}%",
        )
        _save_log({
            "action": "rejected",
            "registry_id": registry_id,
            "eval": eval_result,
        })
        return {"status": "rejected", "registry_id": registry_id, "eval": eval_result}


def _save_log(data: dict):
    """Save run log to volume."""
    log_dir = "/data/continuous/logs"
    os.makedirs(log_dir, exist_ok=True)
    log_path = f"{log_dir}/{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(log_path, "w") as f:
        json.dump({**data, "timestamp": datetime.now().isoformat()}, f, indent=2, default=str)
    try:
        volume.commit()
    except Exception:
        pass


# ============================================================
# Local entrypoint for manual control
# ============================================================

@app.local_entrypoint()
def main(action: str = "status"):
    """
    YONO Autonomous Training Pipeline

    Usage:
        modal run yono/modal_continuous.py --action daily          # Full loop
        modal run yono/modal_continuous.py --action evaluate       # Eval latest
        modal run yono/modal_continuous.py --action promote        # Force promote
        modal run yono/modal_continuous.py --action rollback       # Rollback to .prev
        modal run yono/modal_continuous.py --action health-check   # Sanity check
        modal run yono/modal_continuous.py --action build-eval-set # Rebuild eval set
        modal run yono/modal_continuous.py --action history        # Last 10 runs
        modal run yono/modal_continuous.py --action status         # Volume state
        modal run yono/modal_continuous.py --action unpause        # Unpause pipeline
    """
    if action == "daily":
        result = daily_autonomous_loop.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "evaluate":
        result = evaluate_model.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "promote":
        result = promote_model.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "rollback":
        result = rollback_model.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "health-check":
        result = health_check.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "build-eval-set":
        result = build_eval_set.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "history":
        result = get_history.remote()
        for run in result.get("runs", []):
            status = run.get("status", "?")
            run_id = run.get("run_id", "?")
            val_acc = run.get("val_accuracy")
            eval_acc = run.get("eval_accuracy")
            created = run.get("created_at", "?")[:19]
            val_str = f"val={val_acc:.1f}%" if val_acc else "val=?"
            eval_str = f"eval={eval_acc:.1f}%" if eval_acc else "eval=?"
            print(f"  {created} | {run_id} | {status:12s} | {val_str} | {eval_str}")

    elif action == "status":
        result = get_status.remote()
        print(json.dumps(result, indent=2, default=str))

    elif action == "unpause":
        # Remote unpause
        _unpause.remote()
        print("Pipeline unpaused")

    else:
        print(f"Unknown action: {action}")
        print("Valid: daily, evaluate, promote, rollback, health-check, build-eval-set, history, status, unpause")


@app.function(
    image=pipeline_image,
    volumes={"/data": volume},
    timeout=60,
)
def _unpause():
    """Unpause the pipeline and reset failure counter."""
    state = _load_state()
    state["pipeline_paused"] = False
    state["pause_reason"] = None
    state["consecutive_failures"] = 0
    _save_state(state)
    volume.commit()
    _log("Pipeline unpaused, failure counter reset")
