#!/usr/bin/env python3
"""
YONO inference server — FastAPI sidecar for edge function integration.

Runs locally on port 8472. Edge functions call this before hitting Gemini/GPT-4o.
If YONO is confident, cloud call is skipped entirely. Saves $0.0001–$0.004/image.

Usage:
  python server.py                    # start on :8472
  python server.py --port 8473        # custom port
  python server.py --host 0.0.0.0     # bind all interfaces

Endpoints:
  GET  /health          → {status, model_version, tier1, tier2_families, flat, uptime_s}
  POST /classify        → {image_url} → {make, confidence, family, family_confidence, top5, source, is_vehicle, ms}
  POST /classify/batch  → [{image_url},...] → [{...},...]
  GET  /labels          → full list of known makes / families
"""

import argparse
import os
import time
import tempfile
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

import sys
sys.path.insert(0, str(Path(__file__).parent))
from yono import HierarchicalYONO, YONOClassifier

# Loaded at startup
_hier: Optional[HierarchicalYONO] = None
_flat: Optional[YONOClassifier] = None
_started_at = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _hier, _flat
    print("Loading YONO models...")
    try:
        _hier = HierarchicalYONO()
        print(f"Hierarchical: {_hier}")
    except Exception as e:
        print(f"HierarchicalYONO load failed: {e}")
    if not (_hier and _hier.available):
        try:
            _flat = YONOClassifier()
            print(f"Flat fallback: {_flat}")
        except Exception as e:
            print(f"Flat model load failed: {e}")
    print("Ready.")
    yield


app = FastAPI(
    title="YONO",
    description="Vehicle image classifier — zero API cost",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ClassifyRequest(BaseModel):
    image_url: str
    top_k: int = 5


class BatchRequest(BaseModel):
    images: List[ClassifyRequest]


def _active_clf():
    """Return best available classifier."""
    if _hier and _hier.available:
        return _hier
    if _flat:
        return _flat
    return None


@app.get("/health")
def health():
    clf = _active_clf()
    hier_info = None
    if _hier:
        hier_info = {
            "tier1": _hier._tier1 is not None,
            "tier2_families": _hier.tier2_families,
            "flat_fallback": _hier._flat is not None,
        }
    return {
        "status": "ok" if clf else "loading",
        "model": str(clf) if clf else "loading",
        "hierarchical": hier_info,
        "uptime_s": round(time.time() - _started_at, 1),
    }


@app.get("/labels")
def labels():
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Model not loaded")
    if isinstance(clf, HierarchicalYONO):
        return {
            "families": clf._family_labels if clf._tier1 else [],
            "tier2": {fam: clf._tier2_labels[fam] for fam in clf._tier2.keys()},
            "flat_makes": clf._flat.labels if clf._flat else [],
        }
    return {"makes": clf.labels, "count": len(clf.labels)}


def _run_classify(image_path: str, top_k: int) -> dict:
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Model not loaded")
    if isinstance(clf, HierarchicalYONO):
        return clf.predict(image_path, top_k=top_k)
    result = clf.predict(image_path, top_k=top_k)
    return {**result, "family": None, "family_confidence": None, "source": "flat"}


@app.post("/classify")
def classify(req: ClassifyRequest):
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Model not loaded")

    t0 = time.perf_counter()

    ext = Path(req.image_url.split("?")[0]).suffix or ".jpg"
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.close()

    try:
        urllib.request.urlretrieve(req.image_url, tmp.name)
        result = _run_classify(tmp.name, req.top_k)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Failed to classify: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    return {**result, "ms": elapsed_ms, "image_url": req.image_url}


@app.post("/classify/batch")
def classify_batch(req: BatchRequest):
    if not _active_clf():
        raise HTTPException(503, "Model not loaded")
    if len(req.images) > 50:
        raise HTTPException(400, "Max 50 images per batch")

    results = []
    for item in req.images:
        try:
            results.append(classify(item))
        except HTTPException as e:
            results.append({"image_url": item.image_url, "error": e.detail})

    return {"results": results, "count": len(results)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8472)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    print(f"Starting YONO server on {args.host}:{args.port}")
    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.reload)
