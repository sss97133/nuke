"""
YONO Inference Server on Modal — ASGI/FastAPI edition

Single base URL with path routing — compatible with yono-classify edge function.
Set YONO_SIDECAR_URL in Supabase to the Modal app URL.

Deploy:
  modal deploy yono/modal_serve.py

Get URL:
  modal app show yono-serve
  (the @modal.asgi_app URL, e.g. https://nuke--yono-serve-fastapi-app.modal.run)

Then set in Supabase:
  supabase secrets set YONO_SIDECAR_URL=https://nuke--yono-serve-fastapi-app.modal.run

Endpoints:
  GET  /health
  POST /classify        { image_url, top_k? }
  POST /classify/batch  { images: [{image_url, top_k?},...] }
"""

import modal
from pathlib import Path

app = modal.App("yono-serve")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "onnxruntime==1.19.2",
        "Pillow",
        "fastapi[standard]",
        "uvicorn",
        "httpx",
        "numpy<2",
    ])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

MODELS_DIR = "/data/models"


def _load_models():
    """Load ONNX models from volume. Returns (flat_sess, flat_labels, tier1_sess, family_labels, tier2)."""
    import json
    import onnxruntime as ort

    flat_sess = flat_labels = flat_input = None
    tier1_sess = tier1_input = None
    family_labels = []
    tier2 = {}
    tier2_labels = {}
    tier2_input = None

    flat_path = Path(f"{MODELS_DIR}/yono_make_v1.onnx")
    flat_labels_path = Path(f"{MODELS_DIR}/yono_labels.json")
    if flat_path.exists() and flat_labels_path.exists():
        flat_sess = ort.InferenceSession(str(flat_path), providers=["CPUExecutionProvider"])
        flat_input = flat_sess.get_inputs()[0].name
        with open(flat_labels_path) as f:
            data = json.load(f)
        flat_labels = data["labels"]
        print(f"[YONO] Flat model: {len(flat_labels)} classes")

    hier_path = Path(f"{MODELS_DIR}/hier_family.onnx")
    hier_labels_path = Path(f"{MODELS_DIR}/hier_labels.json")
    if hier_path.exists() and hier_labels_path.exists():
        tier1_sess = ort.InferenceSession(str(hier_path), providers=["CPUExecutionProvider"])
        tier1_input = tier1_sess.get_inputs()[0].name
        with open(hier_labels_path) as f:
            all_labels = json.load(f)
        family_map = all_labels.get("hier_family", {})
        family_labels = sorted(family_map, key=lambda k: family_map[k])
        for family in family_labels:
            t2_path = Path(f"{MODELS_DIR}/hier_{family}.onnx")
            if t2_path.exists():
                sess = ort.InferenceSession(str(t2_path), providers=["CPUExecutionProvider"])
                tier2[family] = sess
                tier2_input = sess.get_inputs()[0].name
                tier2_labels[family] = sorted(
                    all_labels.get(f"hier_{family}", {}),
                    key=lambda k: all_labels[f"hier_{family}"][k]
                )
        print(f"[YONO] Hierarchical: tier1={bool(tier1_sess)}, tier2={list(tier2.keys())}")

    if not flat_sess and not tier1_sess:
        raise RuntimeError("No YONO models found in /data/models — upload models first")

    return flat_sess, flat_labels, flat_input, tier1_sess, tier1_input, family_labels, tier2, tier2_labels, tier2_input


@app.function(
    image=image,
    volumes={"/data": volume},
    min_containers=1,        # keep 1 warm — cold start is 3-5s
    scaledown_window=600,    # keep warm 10 min after last request
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def fastapi_app():
    import asyncio
    import io
    import json
    import time

    import httpx
    import numpy as np
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from PIL import Image

    api = FastAPI(title="YONO Inference Server")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    (flat_sess, flat_labels, flat_input,
     tier1_sess, tier1_input, family_labels,
     tier2, tier2_labels, tier2_input) = _load_models()

    started_at = time.time()

    def _preprocess(image_bytes: bytes) -> np.ndarray:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
        arr = np.array(img, dtype=np.float32) / 255.0
        arr = (arr - mean) / std
        return arr.transpose(2, 0, 1)[np.newaxis]

    def _softmax(x: np.ndarray) -> np.ndarray:
        e = np.exp(x - x.max(axis=1, keepdims=True))
        return e / e.sum(axis=1, keepdims=True)

    def _classify(tensor: np.ndarray, top_k: int = 5) -> dict:
        # Tier 1 → Tier 2 hierarchical path
        if tier1_sess:
            logits = tier1_sess.run(None, {tier1_input: tensor})[0]
            probs = _softmax(logits)[0]
            top_idx = int(probs.argmax())
            family = family_labels[top_idx]
            family_conf = float(probs[top_idx])

            if family in tier2:
                sess = tier2[family]
                inp = sess.get_inputs()[0].name
                logits2 = sess.run(None, {inp: tensor})[0]
                probs2 = _softmax(logits2)[0]
                labels2 = tier2_labels[family]
                top_ix = probs2.argsort()[::-1][:top_k]
                top5 = [[labels2[i], float(probs2[i])] for i in top_ix]
                return {
                    "make": top5[0][0], "confidence": top5[0][1],
                    "family": family, "family_confidence": family_conf,
                    "top5": top5, "source": "hierarchical",
                    "is_vehicle": top5[0][1] >= 0.20,
                }
            # Tier 1 only (no tier 2 for this family yet)
            return {
                "make": family, "confidence": family_conf,
                "family": family, "family_confidence": family_conf,
                "top5": [[family, family_conf]],
                "source": "hierarchical_tier1_only",
                "is_vehicle": family_conf >= 0.25,
            }

        # Flat fallback
        if flat_sess:
            logits = flat_sess.run(None, {flat_input: tensor})[0]
            probs = _softmax(logits)[0]
            top_ix = probs.argsort()[::-1][:top_k]
            top5 = [[flat_labels[i], float(probs[i])] for i in top_ix]
            return {
                "make": top5[0][0], "confidence": top5[0][1],
                "family": None, "family_confidence": None,
                "top5": top5, "source": "flat_fallback",
                "is_vehicle": top5[0][1] >= 0.25,
            }

        return {"make": None, "confidence": 0.0, "top5": [],
                "source": "unavailable", "is_vehicle": False}

    @api.get("/health")
    def health():
        return {
            "status": "ok",
            "tier1": tier1_sess is not None,
            "tier2_families": list(tier2.keys()),
            "flat": flat_sess is not None,
            "flat_classes": len(flat_labels) if flat_labels else 0,
            "uptime_s": round(time.time() - started_at, 1),
        }

    @api.post("/classify")
    async def classify(body: dict):
        image_url = body.get("image_url")
        top_k = body.get("top_k", 5)
        if not image_url:
            return {"error": "Missing image_url"}

        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(image_url)
            resp.raise_for_status()
            image_bytes = resp.content

        tensor = _preprocess(image_bytes)
        result = _classify(tensor, top_k=top_k)
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {**result, "ms": ms}

    @api.post("/classify/batch")
    async def classify_batch(body: dict):
        images = body.get("images", [])
        if len(images) > 50:
            return {"error": "Max 50 images per batch"}

        async def one(item):
            t0 = time.perf_counter()
            url = item.get("image_url", "")
            top_k = item.get("top_k", 5)
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    tensor = _preprocess(resp.content)
                    result = _classify(tensor, top_k=top_k)
                    return {**result, "ms": round((time.perf_counter() - t0) * 1000, 1), "image_url": url}
            except Exception as e:
                return {"image_url": url, "error": str(e)}

        import asyncio
        results = await asyncio.gather(*[one(item) for item in images])
        return {"results": list(results), "count": len(results)}

    return api
