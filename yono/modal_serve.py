"""
YONO Inference Server on Modal — ASGI/FastAPI edition

Single base URL with path routing — compatible with yono-classify and yono-analyze
edge functions. Set YONO_SIDECAR_URL in Supabase to the Modal app URL.

Deploy:
  modal deploy yono/modal_serve.py

Get URL:
  modal app show yono-serve

Endpoints:
  GET  /health
  POST /classify        { image_url, top_k? }
  POST /classify/batch  { images: [{image_url, top_k?},...] }
  POST /analyze         { image_url }
  POST /analyze/batch   { images: [{image_url},...] }
"""

import modal
from pathlib import Path

app = modal.App("yono-serve")

# --- Pre-bake Florence-2-base weights into the image layer ---
# This runs at image build time so cold starts don't hit HuggingFace.

def _download_florence2():
    """Download Florence-2-base into HuggingFace cache (baked into image)."""
    from transformers import AutoProcessor, AutoModelForCausalLM
    import torch

    print("[YONO] Downloading Florence-2-base weights...")
    AutoProcessor.from_pretrained(
        "microsoft/florence-2-base",
        trust_remote_code=True,
    )
    AutoModelForCausalLM.from_pretrained(
        "microsoft/florence-2-base",
        trust_remote_code=True,
        torch_dtype=torch.float32,
    )
    print("[YONO] Florence-2-base cached.")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        # ONNX classify deps
        "onnxruntime==1.19.2",
        "Pillow",
        "fastapi[standard]",
        "uvicorn",
        "httpx",
        "numpy<2",
        # Florence-2 / vision deps
        "torch==2.2.2",
        "transformers==4.49.0",
        "safetensors",
        "einops",
        "timm",
    ])
    .run_function(_download_florence2)
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

MODELS_DIR = "/data/models"


# ============================================================
# Model loaders
# ============================================================

def _load_onnx_models():
    """Load ONNX classification models from volume.

    Returns (flat_sess, flat_labels, flat_input, tier1_sess, tier1_input,
             family_labels, tier2, tier2_labels, tier2_input).
    """
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
                try:
                    sess = ort.InferenceSession(str(t2_path), providers=["CPUExecutionProvider"])
                    tier2[family] = sess
                    tier2_input = sess.get_inputs()[0].name
                    tier2_labels[family] = sorted(
                        all_labels.get(f"hier_{family}", {}),
                        key=lambda k: all_labels[f"hier_{family}"][k]
                    )
                except Exception as e:
                    print(f"[YONO] Skipping {family} tier-2 (load error: {e})")
        print(f"[YONO] Hierarchical: tier1={bool(tier1_sess)}, tier2={list(tier2.keys())}")

    return flat_sess, flat_labels, flat_input, tier1_sess, tier1_input, family_labels, tier2, tier2_labels, tier2_input


def _load_zone_classifier():
    """Load Florence-2 zone classifier head (ZoneClassifierHead).

    Architecture: Florence-2-base encoder → ZoneClassifierHead (768 → 512 → 256 → 41 zones)
    Weights: yono_zone_head.safetensors (2.1MB, from volume)
    Labels:  yono_zone_classifier_labels.json

    Returns dict with {head, zone_codes, hidden_size, device} or None if unavailable.
    """
    import json
    import torch
    from torch import nn

    device = torch.device("cpu")

    head_path = Path(f"{MODELS_DIR}/yono_zone_head.safetensors")
    labels_path = Path(f"{MODELS_DIR}/yono_zone_classifier_labels.json")
    config_path = Path(f"{MODELS_DIR}/yono_zone_config.json")

    if not (head_path.exists() and labels_path.exists()):
        print("[YONO] Zone classifier files not found — skipping.")
        return None

    try:
        from safetensors.torch import load_file as safetensors_load

        with open(labels_path) as f:
            labels_data = json.load(f)
        zone_codes = labels_data["zone_codes"]
        n_zones = len(zone_codes)

        hidden_size = 768
        if config_path.exists():
            with open(config_path) as f:
                cfg = json.load(f)
            hidden_size = cfg.get("hidden_size", 768)
            n_zones = cfg.get("n_zones", n_zones)

        class ZoneClassifierHead(nn.Module):
            """Matches ZoneClassifierHead from train_zone_classifier.py."""
            def __init__(self, hidden_size: int = 768, n_zones: int = 41, dropout: float = 0.2):
                super().__init__()
                self.net = nn.Sequential(
                    nn.LayerNorm(hidden_size),
                    nn.Linear(hidden_size, 512),
                    nn.GELU(),
                    nn.Dropout(dropout),
                    nn.Linear(512, 256),
                    nn.GELU(),
                    nn.Dropout(dropout),
                    nn.Linear(256, n_zones),
                )

            def forward(self, image_features):
                x = image_features.mean(dim=1)
                return self.net(x)

        head = ZoneClassifierHead(hidden_size=hidden_size, n_zones=n_zones)
        state_dict = safetensors_load(head_path)
        head.load_state_dict(state_dict)
        head = head.to(device)
        head.eval()
        print(f"[YONO] Zone classifier loaded: {n_zones} zones, val_acc=72.8%")

        return {
            "head": head,
            "zone_codes": zone_codes,
            "hidden_size": hidden_size,
            "device": device,
        }

    except Exception as e:
        print(f"[YONO] Zone classifier load failed: {e}")
        return None


def _load_vision_analyzer():
    """Load Florence-2 + fine-tuned condition head.

    Returns VisionState namedtuple or None if loading fails.
    """
    import json
    import torch
    from torch import nn
    from transformers import AutoProcessor, AutoModelForCausalLM

    device = torch.device("cpu")

    print("[YONO] Loading Florence-2-base for vision analysis...")
    try:
        processor = AutoProcessor.from_pretrained(
            "microsoft/florence-2-base",
            trust_remote_code=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            "microsoft/florence-2-base",
            trust_remote_code=True,
            torch_dtype=torch.float32,
        ).to(device)
        model.eval()
        print("[YONO] Florence-2-base loaded.")
    except Exception as e:
        print(f"[YONO] Florence-2 load failed: {e}")
        return None

    # Load fine-tuned VehicleVisionHead (1.6MB, from volume)
    head = None
    head_config = None
    vision_mode = "zeroshot_florence2"

    head_path = Path(f"{MODELS_DIR}/yono_vision_v2_head.safetensors")
    config_path = Path(f"{MODELS_DIR}/yono_vision_v2_config.json")

    if head_path.exists() and config_path.exists():
        try:
            from safetensors.torch import load_file as safetensors_load

            with open(config_path) as f:
                head_config = json.load(f)

            hidden_size = head_config["hidden_size"]
            n_damage = head_config["n_damage"]
            n_mods = head_config["n_mods"]
            n_photo_types = head_config["n_photo_types"]

            class VisionHead(nn.Module):
                """Matches VehicleVisionHead from train_florence2.py."""
                def __init__(self, hidden_size, n_damage, n_mods, n_photo_types):
                    super().__init__()
                    self.bottleneck = nn.Sequential(
                        nn.LayerNorm(hidden_size),
                        nn.Linear(hidden_size, 512),
                        nn.GELU(),
                        nn.Dropout(0.2),
                    )
                    self.condition_head = nn.Linear(512, 5)
                    self.photo_quality_head = nn.Linear(512, 5)
                    self.interior_quality_head = nn.Linear(512, 5)
                    self.damage_head = nn.Linear(512, n_damage)
                    self.mod_head = nn.Linear(512, n_mods)
                    self.photo_type_head = nn.Linear(512, n_photo_types)

                def forward(self, image_features):
                    x = image_features.mean(dim=1)
                    x = self.bottleneck(x)
                    return {
                        "condition_score": self.condition_head(x),
                        "photo_quality": self.photo_quality_head(x),
                        "interior_quality": self.interior_quality_head(x),
                        "damage_flags": self.damage_head(x),
                        "mod_flags": self.mod_head(x),
                        "photo_type": self.photo_type_head(x),
                    }

            head = VisionHead(hidden_size, n_damage, n_mods, n_photo_types)
            state_dict = safetensors_load(head_path)
            head.load_state_dict(state_dict)
            head = head.to(device)
            head.eval()
            vision_mode = "finetuned_v2"
            print(f"[YONO] Vision head loaded (val_loss={head_config.get('best_val_loss', '?'):.4f})")
        except Exception as e:
            print(f"[YONO] Vision head load failed: {e} — falling back to zero-shot")
            head = None
            head_config = None

    # Photo type → zone code mapping (used instead of ZoneClassifier to avoid slow generation)
    PHOTO_TYPE_TO_ZONE = {
        "exterior_front": "ext_front",
        "exterior_rear": "ext_rear",
        "exterior_side": "ext_driver_side",
        "interior": "int_dashboard",
        "engine": "mech_engine_bay",
        "wheel": "wheel_fl",
        "detail": "detail_damage",
        "undercarriage": "ext_undercarriage",
        "other": "other",
    }

    return {
        "model": model,
        "processor": processor,
        "device": device,
        "head": head,
        "head_config": head_config,
        "vision_mode": vision_mode,
        "photo_type_to_zone": PHOTO_TYPE_TO_ZONE,
    }


# ============================================================
# Analysis helpers (module-level, used inside fastapi_app)
# ============================================================

# Shared damage/mod keyword tables for zero-shot fallback
_DAMAGE_KEYWORDS = {
    "rust": ["rust", "rusty", "rusted", "corrosion", "corroded"],
    "dent": ["dent", "dented", "ding", "crease", "deformation"],
    "crack": ["crack", "cracked", "fracture", "split"],
    "paint_fade": ["faded", "paint fade", "weathered", "oxidized paint", "peeling"],
    "broken_glass": ["broken glass", "cracked glass", "missing window"],
    "missing_parts": ["missing", "absent", "no hood", "no bumper", "stripped"],
    "accident_damage": ["accident", "collision", "crash", "impact damage", "body damage"],
}
_MOD_KEYWORDS = {
    "lift_kit": ["lift", "lifted", "raised suspension"],
    "lowered": ["lowered", "slammed", "low rider", "dropped", "stance"],
    "aftermarket_wheels": ["aftermarket wheel", "custom wheel", "alloy wheel", "chrome wheel"],
    "roll_cage": ["roll cage", "roll bar", "safety cage"],
    "engine_swap": ["engine swap", "v8 swap", "ls swap", "crate engine"],
    "body_kit": ["body kit", "front lip", "side skirt", "rear diffuser", "wide body"],
    "exhaust_mod": ["exhaust", "muffler delete", "catback", "side pipe"],
    "suspension_mod": ["coilover", "lowering spring", "air suspension", "air ride"],
}


@app.function(
    image=image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    min_containers=1,        # 1 warm container — keepalive pings every 5min keep it alive
    max_containers=4,        # cap to prevent container leak
    scaledown_window=300,    # 5 min — matches keepalive interval
    timeout=600,             # 10 min — batch of 20 images @ ~10s each needs ~200s
)
@modal.asgi_app()
def fastapi_app():
    import asyncio
    import io
    import json
    import os
    import time

    import httpx
    import numpy as np
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from PIL import Image

    api = FastAPI(title="YONO Inference Server")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ---- Bearer token auth middleware ----
    # GET /health is public (monitoring). All other endpoints require Authorization: Bearer <token>.
    # Token is stored in Modal secret nuke-sidecar-secrets + Supabase secrets MODAL_SIDECAR_TOKEN.
    _SIDECAR_TOKEN = os.environ.get("MODAL_SIDECAR_TOKEN", "")

    @api.middleware("http")
    async def auth_middleware(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        if not _SIDECAR_TOKEN:
            # No token configured — allow all (shouldn't happen in prod)
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {_SIDECAR_TOKEN}":
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    # ---- Load ONNX classify models ----
    (flat_sess, flat_labels, flat_input,
     tier1_sess, tier1_input, family_labels,
     tier2, tier2_labels, tier2_input) = _load_onnx_models()

    # ---- Load zone classifier ----
    _zone = _load_zone_classifier()

    # ---- Load vision analyzer (Florence-2 + fine-tuned head) ----
    _vision = _load_vision_analyzer()

    started_at = time.time()

    # ---- ONNX helpers ----
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def _preprocess(image_bytes: bytes) -> np.ndarray:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
        arr = np.array(img, dtype=np.float32) / 255.0
        arr = (arr - mean) / std
        return arr.transpose(2, 0, 1)[np.newaxis]

    def _softmax(x: np.ndarray) -> np.ndarray:
        e = np.exp(x - x.max(axis=1, keepdims=True))
        return e / e.sum(axis=1, keepdims=True)

    def _classify(tensor: np.ndarray, top_k: int = 5) -> dict:
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
            return {
                "make": family, "confidence": family_conf,
                "family": family, "family_confidence": family_conf,
                "top5": [[family, family_conf]],
                "source": "hierarchical_tier1_only",
                "is_vehicle": family_conf >= 0.25,
            }

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

    # ---- Zone classification helper ----
    def _classify_zone(features) -> tuple[str, float]:
        """Run zone classifier head on Florence-2 image features.

        Returns (zone_code, confidence). Falls back to 'other'/0.0 if not loaded.
        """
        import torch

        if _zone is None:
            return "other", 0.0

        with torch.no_grad():
            zone_head = _zone["head"]
            zone_codes = _zone["zone_codes"]
            logits = zone_head(features)
            probs = torch.softmax(logits, dim=-1)[0]
            idx = int(probs.argmax().item())
            return zone_codes[idx], float(probs[idx])

    # ---- Vision analysis helpers ----
    def _analyze_finetuned(image_bytes: bytes) -> dict:
        """Fine-tuned Florence-2 head: fast (encode only, no generation).

        Uses both VisionHead (condition/damage/mods/photo_type/interior_quality)
        and ZoneClassifierHead (41-class zone) on shared Florence-2 features.
        """
        import torch

        v = _vision
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        inputs = v["processor"](
            text="<DETAILED_CAPTION>",
            images=img,
            return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].to(v["device"])
        config = v["head_config"]

        with torch.no_grad():
            features = v["model"]._encode_image(pixel_values)
            preds = v["head"](features)

            cond_score = int(preds["condition_score"].argmax(dim=-1).item()) + 1
            photo_qual = int(preds["photo_quality"].argmax(dim=-1).item()) + 1

            pt_idx = int(preds["photo_type"].argmax(dim=-1).item())
            photo_type = config["photo_types"][pt_idx]

            iq_idx = int(preds["interior_quality"].argmax(dim=-1).item())
            interior_quality = (iq_idx + 1) if photo_type == "interior" else None

            dmg_probs = preds["damage_flags"].sigmoid()[0]
            damage_flags = [
                config["damage_flags"][i]
                for i, p in enumerate(dmg_probs.tolist())
                if p >= 0.4
            ]

            mod_probs = preds["mod_flags"].sigmoid()[0]
            mod_flags = [
                config["mod_flags"][i]
                for i, p in enumerate(mod_probs.tolist())
                if p >= 0.4
            ]

        # Use zone classifier if available; fall back to photo_type→zone mapping
        if _zone is not None:
            vehicle_zone, zone_confidence = _classify_zone(features)
            zone_source = "zone_classifier_v1"
        else:
            vehicle_zone = v["photo_type_to_zone"].get(photo_type, "other")
            zone_confidence = 0.7
            zone_source = "photo_type_heuristic"

        return {
            "vehicle_zone": vehicle_zone,
            "zone_confidence": zone_confidence,
            "zone_source": zone_source,
            "surface_coord_u": None,
            "surface_coord_v": None,
            "condition_score": cond_score,
            "damage_flags": damage_flags,
            "modification_flags": mod_flags,
            "interior_quality": interior_quality,
            "photo_quality": photo_qual,
            "photo_type": photo_type,
            "model": "finetuned_v2",
        }

    def _analyze_zeroshot(image_bytes: bytes) -> dict:
        """Zero-shot Florence-2: slower (caption generation), used as fallback.

        Uses zone classifier on image features when available; falls back to
        photo_type keyword heuristic otherwise.
        """
        import torch

        v = _vision
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        inputs = v["processor"](
            text="<DETAILED_CAPTION>",
            images=img,
            return_tensors="pt",
        ).to(v["device"])

        with torch.no_grad():
            # Encode image for zone classifier (reuse features)
            pixel_values = inputs["pixel_values"]
            features = v["model"]._encode_image(pixel_values)

            generated_ids = v["model"].generate(
                input_ids=inputs["input_ids"],
                pixel_values=pixel_values,
                max_new_tokens=200,
                do_sample=False,
                num_beams=2,
            )
        generated_text = v["processor"].batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = v["processor"].post_process_generation(
            generated_text, task="<DETAILED_CAPTION>",
            image_size=(img.width, img.height),
        )
        caption = parsed.get("<DETAILED_CAPTION>", "").lower()

        # Keyword-based extraction
        damage_flags = [f for f, kws in _DAMAGE_KEYWORDS.items() if any(kw in caption for kw in kws)]
        mod_flags = [f for f, kws in _MOD_KEYWORDS.items() if any(kw in caption for kw in kws)]

        photo_type = "other"
        if any(w in caption for w in ["front", "grille", "headlight"]):
            photo_type = "exterior_front"
        elif any(w in caption for w in ["rear", "trunk", "taillight", "back of"]):
            photo_type = "exterior_rear"
        elif any(w in caption for w in ["side", "door", "quarter panel", "profile"]):
            photo_type = "exterior_side"
        elif any(w in caption for w in ["interior", "dashboard", "steering wheel", "seat"]):
            photo_type = "interior"
        elif any(w in caption for w in ["engine", "motor", "engine bay"]):
            photo_type = "engine"
        elif any(w in caption for w in ["wheel", "tire", "rim"]):
            photo_type = "wheel"

        condition_score = 3
        if any(w in caption for w in ["pristine", "perfect", "immaculate", "mint", "flawless"]):
            condition_score = 5
        elif any(w in caption for w in ["clean", "nice", "good condition", "well maintained"]):
            condition_score = 4
        elif damage_flags and (len(damage_flags) >= 3 or "accident_damage" in damage_flags):
            condition_score = 2

        photo_quality = 3
        if any(w in caption for w in ["blurry", "out of focus", "dark", "poor lighting"]):
            photo_quality = 2
        elif any(w in caption for w in ["clear", "sharp", "well-lit", "detailed"]):
            photo_quality = 4

        interior_quality = None
        if photo_type == "interior":
            if any(w in caption for w in ["clean interior", "nice interior"]):
                interior_quality = 4
            elif any(w in caption for w in ["torn", "ripped", "worn"]):
                interior_quality = 2
            else:
                interior_quality = 3

        # Use zone classifier if available; fall back to photo_type heuristic
        if _zone is not None:
            vehicle_zone, zone_confidence = _classify_zone(features)
            zone_source = "zone_classifier_v1"
        else:
            vehicle_zone = v["photo_type_to_zone"].get(photo_type, "other")
            zone_confidence = 0.5
            zone_source = "photo_type_heuristic"

        return {
            "vehicle_zone": vehicle_zone,
            "zone_confidence": zone_confidence,
            "zone_source": zone_source,
            "surface_coord_u": None,
            "surface_coord_v": None,
            "condition_score": condition_score,
            "damage_flags": damage_flags,
            "modification_flags": mod_flags,
            "interior_quality": interior_quality,
            "photo_quality": photo_quality,
            "photo_type": photo_type,
            "model": "zeroshot_florence2",
        }

    def _analyze_image(image_bytes: bytes) -> dict:
        if _vision is None:
            raise RuntimeError("Vision analyzer not loaded")
        if _vision.get("head") is not None:
            return _analyze_finetuned(image_bytes)
        return _analyze_zeroshot(image_bytes)

    # ======================================================
    # Endpoints
    # ======================================================

    @api.get("/health")
    def health():
        return {
            "status": "ok",
            "tier1": tier1_sess is not None,
            "tier2_families": list(tier2.keys()),
            "flat": flat_sess is not None,
            "flat_classes": len(flat_labels) if flat_labels else 0,
            "vision_available": _vision is not None,
            "vision_mode": _vision.get("vision_mode") if _vision else None,
            "zone_classifier": _zone is not None,
            "zone_classes": len(_zone["zone_codes"]) if _zone else 0,
            "uptime_s": round(time.time() - started_at, 1),
        }

    @api.post("/reload")
    async def reload_models():
        """Hot-swap ONNX models from volume without redeploying the app."""
        nonlocal flat_sess, flat_labels, flat_input, tier1_sess, tier1_input
        nonlocal family_labels, tier2, tier2_labels, tier2_input
        try:
            volume.reload()
            (flat_sess, flat_labels, flat_input,
             tier1_sess, tier1_input, family_labels,
             tier2, tier2_labels, tier2_input) = _load_onnx_models()
            return {"status": "ok", "flat_classes": len(flat_labels) if flat_labels else 0,
                    "tier2_families": list(tier2.keys())}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    _FETCH_HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; NukeVision/1.0; +https://nuke.ag)",
        "Accept": "image/*,*/*",
    }

    @api.post("/classify")
    async def classify(body: dict):
        image_url = body.get("image_url")
        top_k = body.get("top_k", 5)
        if not image_url:
            return {"error": "Missing image_url"}

        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(image_url, headers=_FETCH_HEADERS)
                resp.raise_for_status()
                image_bytes = resp.content
        except Exception as e:
            return {"error": f"Image fetch failed: {e}", "image_url": image_url,
                    "make": None, "confidence": 0, "top5": [], "ms": 0}

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
                async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                    resp = await client.get(url, headers=_FETCH_HEADERS)
                    resp.raise_for_status()
                    tensor = _preprocess(resp.content)
                    result = _classify(tensor, top_k=top_k)
                    return {**result, "ms": round((time.perf_counter() - t0) * 1000, 1), "image_url": url}
            except Exception as e:
                return {"image_url": url, "error": str(e)}

        results = await asyncio.gather(*[one(item) for item in images])
        return {"results": list(results), "count": len(results)}

    @api.post("/analyze")
    async def analyze(body: dict):
        """Analyze vehicle image for zone, condition, damage, modifications."""
        if _vision is None:
            return {"error": "Vision analyzer not loaded", "available": False}

        image_url = body.get("image_url")
        if not image_url:
            return {"error": "Missing image_url"}

        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(image_url, headers=_FETCH_HEADERS)
                resp.raise_for_status()
                image_bytes = resp.content

            result = _analyze_image(image_bytes)
            ms = round((time.perf_counter() - t0) * 1000, 1)
            return {**result, "ms": ms, "image_url": image_url}
        except Exception as e:
            return {"image_url": image_url, "error": str(e)}

    @api.post("/analyze/batch")
    async def analyze_batch(body: dict):
        """Batch vision analysis. Max 20 images."""
        if _vision is None:
            return {"error": "Vision analyzer not loaded", "available": False}

        images = body.get("images", [])
        if len(images) > 20:
            return {"error": "Max 20 images per batch"}

        async def one(item):
            url = item.get("image_url", "")
            t0 = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                    resp = await client.get(url, headers=_FETCH_HEADERS)
                    resp.raise_for_status()
                    result = _analyze_image(resp.content)
                    return {**result, "ms": round((time.perf_counter() - t0) * 1000, 1), "image_url": url}
            except Exception as e:
                return {"image_url": url, "error": str(e)}

        results = await asyncio.gather(*[one(item) for item in images])
        return {"results": list(results), "count": len(results)}

    return api
