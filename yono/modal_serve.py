"""
YONO Inference Server on Modal

Hosts the YONO hierarchical classifier as a stable HTTPS endpoint.
Set YONO_SIDECAR_URL in Supabase env to the deployment URL to enable
zero-cost image classification in all edge functions.

Deploy:
  modal deploy yono/modal_serve.py

Get URL:
  modal app show yono-serve   (look for the web_endpoint URL)

Then in Supabase:
  supabase secrets set YONO_SIDECAR_URL=https://<modal-org>--yono-serve-classify.modal.run

Endpoints (same API as local server.py):
  GET  /health
  POST /classify       { image_url, top_k? }
  POST /classify/batch { images: [{image_url},...] }
"""

import modal

app = modal.App("yono-serve")

# Container with ONNX runtime + PIL
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "onnxruntime==1.17.3",
        "Pillow",
        "fastapi[standard]",
        "httpx",
        "numpy",
    ])
)

# Persistent volume holding ONNX models (populated by modal_train.py or manual upload)
volume = modal.Volume.from_name("yono-data", create_if_missing=True)

MODELS_DIR = "/data/models"
FLAT_ONNX = f"{MODELS_DIR}/yono_make_v1.onnx"
FLAT_LABELS = f"{MODELS_DIR}/yono_labels.json"
HIER_FAMILY_ONNX = f"{MODELS_DIR}/hier_family.onnx"
HIER_LABELS = f"{MODELS_DIR}/hier_labels.json"


@app.cls(
    image=image,
    volumes={"/data": volume},
    min_containers=0,        # scale-to-zero when idle
    scaledown_window=300,    # keep warm for 5 min after last request
    allow_concurrent_inputs=10,
)
class YONOServer:
    @modal.enter()
    def load_models(self):
        import json
        import numpy as np
        import onnxruntime as ort
        from pathlib import Path

        self._mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        self._std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

        self._flat_sess = None
        self._flat_labels = []
        self._tier1_sess = None
        self._family_labels = []
        self._tier2: dict = {}
        self._tier2_labels: dict = {}

        # Load flat model
        if Path(FLAT_ONNX).exists() and Path(FLAT_LABELS).exists():
            self._flat_sess = ort.InferenceSession(FLAT_ONNX, providers=["CPUExecutionProvider"])
            self._flat_input = self._flat_sess.get_inputs()[0].name
            with open(FLAT_LABELS) as f:
                data = json.load(f)
            self._flat_labels = data["labels"]
            self._flat_meta = data.get("meta", {})
            print(f"Flat model loaded: {len(self._flat_labels)} classes")

        # Load hierarchical Tier 1
        if Path(HIER_FAMILY_ONNX).exists() and Path(HIER_LABELS).exists():
            self._tier1_sess = ort.InferenceSession(HIER_FAMILY_ONNX, providers=["CPUExecutionProvider"])
            self._tier1_input = self._tier1_sess.get_inputs()[0].name
            with open(HIER_LABELS) as f:
                all_labels = json.load(f)
            family_map = all_labels.get("hier_family", {})
            self._family_labels = sorted(family_map, key=lambda k: family_map[k])
            # Load any Tier 2 per-family models
            for family in self._family_labels:
                tier2_path = f"{MODELS_DIR}/hier_{family}.onnx"
                if Path(tier2_path).exists():
                    sess = ort.InferenceSession(tier2_path, providers=["CPUExecutionProvider"])
                    self._tier2[family] = sess
                    self._tier2_input = sess.get_inputs()[0].name
                    self._tier2_labels[family] = sorted(
                        all_labels.get(f"hier_{family}", {}),
                        key=lambda k: all_labels[f"hier_{family}"][k]
                    )
            print(f"Hierarchical: tier1={bool(self._tier1_sess)}, tier2={list(self._tier2.keys())}")

        if not self._flat_sess and not self._tier1_sess:
            raise RuntimeError("No YONO models found in /data/models — upload models first")

    def _preprocess(self, image_bytes: bytes) -> "np.ndarray":
        import io
        import numpy as np
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
        arr = np.array(img, dtype=np.float32) / 255.0
        arr = (arr - self._mean) / self._std
        return arr.transpose(2, 0, 1)[np.newaxis]

    def _softmax(self, x: "np.ndarray") -> "np.ndarray":
        import numpy as np
        e = np.exp(x - x.max(axis=1, keepdims=True))
        return e / e.sum(axis=1, keepdims=True)

    def _classify_tensor(self, tensor: "np.ndarray", top_k: int = 5) -> dict:
        # Tier 1: family
        family = None
        family_confidence = None
        if self._tier1_sess:
            logits = self._tier1_sess.run(None, {self._tier1_input: tensor})[0]
            probs = self._softmax(logits)[0]
            top_idx = int(probs.argmax())
            family = self._family_labels[top_idx]
            family_confidence = float(probs[top_idx])

            # Tier 2: make within family
            if family in self._tier2:
                sess = self._tier2[family]
                input_name = sess.get_inputs()[0].name
                logits2 = sess.run(None, {input_name: tensor})[0]
                probs2 = self._softmax(logits2)[0]
                labels2 = self._tier2_labels[family]
                top_indices = probs2.argsort()[::-1][:top_k]
                top5 = [[labels2[i], float(probs2[i])] for i in top_indices]
                return {
                    "make": top5[0][0],
                    "confidence": top5[0][1],
                    "family": family,
                    "family_confidence": family_confidence,
                    "top5": top5,
                    "source": "hierarchical",
                    "is_vehicle": top5[0][1] >= 0.20,
                }

        # Flat fallback
        if self._flat_sess:
            logits = self._flat_sess.run(None, {self._flat_input: tensor})[0]
            probs = self._softmax(logits)[0]
            top_indices = probs.argsort()[::-1][:top_k]
            top5 = [[self._flat_labels[i], float(probs[i])] for i in top_indices]
            return {
                "make": top5[0][0],
                "confidence": top5[0][1],
                "family": None,
                "family_confidence": None,
                "top5": top5,
                "source": "flat_fallback",
                "is_vehicle": top5[0][1] >= 0.25,
            }

        return {"make": None, "confidence": 0.0, "top5": [], "source": "unavailable", "is_vehicle": False}

    @modal.web_endpoint(method="GET", label="health")
    def health(self):
        return {
            "status": "ok",
            "tier1": self._tier1_sess is not None,
            "tier2_families": list(self._tier2.keys()),
            "flat": self._flat_sess is not None,
            "flat_classes": len(self._flat_labels),
        }

    @modal.web_endpoint(method="POST", label="classify")
    async def classify(self, request: dict):
        import httpx
        import time
        image_url = request.get("image_url")
        top_k = request.get("top_k", 5)
        if not image_url:
            return {"error": "Missing image_url"}, 400

        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(image_url)
            resp.raise_for_status()
            image_bytes = resp.content

        tensor = self._preprocess(image_bytes)
        result = self._classify_tensor(tensor, top_k=top_k)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {**result, "ms": elapsed_ms, "image_url": image_url}

    @modal.web_endpoint(method="POST", label="classify-batch")
    async def classify_batch(self, request: dict):
        import httpx
        import asyncio
        import time
        images = request.get("images", [])
        if len(images) > 50:
            return {"error": "Max 50 images per batch"}, 400

        async def classify_one(item):
            t0 = time.perf_counter()
            url = item.get("image_url", "")
            top_k = item.get("top_k", 5)
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    tensor = self._preprocess(resp.content)
                    result = self._classify_tensor(tensor, top_k=top_k)
                    ms = round((time.perf_counter() - t0) * 1000, 1)
                    return {**result, "ms": ms, "image_url": url}
            except Exception as e:
                return {"image_url": url, "error": str(e)}

        results = await asyncio.gather(*[classify_one(item) for item in images])
        return {"results": list(results), "count": len(results)}
