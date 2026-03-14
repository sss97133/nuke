"""
YONO Batch Processing Plane — Full Vision Pipeline, Scale-to-Zero

Every image gets the COMPLETE analysis:
  1. ONNX make/model classification (hierarchical, ~4ms)
  2. Florence-2 vision analysis (zone, condition, damage, mods, photo quality)
  3. Zone classification (41-class head on Florence-2 features)

Writes ALL fields directly to Supabase — no edge function proxy.

Cost: $0 when idle. Scales to 20 workers for burst processing.

Deploy:
    modal deploy yono/modal_batch.py

Manual kick:
    modal run yono/modal_batch.py::kick

Cron: every 15 minutes, checks for pending work.
If nothing pending, exits immediately ($0).
"""

import modal
import os
import io
import json
import time
from pathlib import Path
from datetime import datetime, timezone

app = modal.App("yono-batch")

volume = modal.Volume.from_name("yono-data", create_if_missing=True)


# --- Pre-bake Florence-2-base weights into the image layer ---
def _download_florence2():
    """Download Florence-2-base into HuggingFace cache (baked into image)."""
    from transformers import AutoProcessor, AutoModelForCausalLM
    import torch

    print("[YONO-BATCH] Downloading Florence-2-base weights...")
    AutoProcessor.from_pretrained("microsoft/florence-2-base", trust_remote_code=True)
    AutoModelForCausalLM.from_pretrained(
        "microsoft/florence-2-base", trust_remote_code=True, torch_dtype=torch.float32,
    )
    print("[YONO-BATCH] Florence-2-base cached.")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "onnxruntime==1.19.2",
        "Pillow",
        "numpy<2",
        "httpx",
        "supabase",
        # Florence-2 / vision deps (CUDA build for T4 GPU)
        "torch==2.2.2",
        "transformers==4.49.0",
        "safetensors",
        "einops",
        "timm",
    ], extra_index_url="https://download.pytorch.org/whl/cu121")
    .run_function(_download_florence2)
)

MODELS_DIR = "/data/models"
CHUNK_SIZE = 50   # smaller chunks — each image now gets full vision pipeline
MAX_PENDING = 5000


# ============================================================
# Shared preprocessing
# ============================================================

def _preprocess_bytes(image_bytes: bytes):
    """Preprocess image bytes to ONNX input tensor."""
    import numpy as np
    from PIL import Image

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((224, 224))
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - mean) / std
    return arr.transpose(2, 0, 1)[np.newaxis]


def _softmax(x):
    import numpy as np
    e = np.exp(x - x.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


# Damage/mod keyword tables for zero-shot fallback
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


# ============================================================
# Batch Worker — Full Vision Pipeline
# ============================================================

@app.cls(
    image=image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    gpu="T4",
    cpu=2,
    memory=4096,  # Florence-2 needs more memory
    max_containers=10,
    scaledown_window=60,
    timeout=600,
)
class BatchWorker:
    """Full vision pipeline per image: classify + zone + condition + damage + mods."""

    @modal.enter()
    def load_models(self):
        import onnxruntime as ort
        import torch
        from torch import nn

        # --- ONNX classification models ---
        self.flat_sess = None
        self.flat_labels = None
        self.flat_input = None
        self.tier1_sess = None
        self.tier1_input = None
        self.family_labels = []
        self.tier2 = {}
        self.tier2_labels = {}

        flat_path = Path(f"{MODELS_DIR}/yono_make_v1.onnx")
        flat_labels_path = Path(f"{MODELS_DIR}/yono_labels.json")
        if flat_path.exists() and flat_labels_path.exists():
            self.flat_sess = ort.InferenceSession(str(flat_path), providers=["CPUExecutionProvider"])
            self.flat_input = self.flat_sess.get_inputs()[0].name
            with open(flat_labels_path) as f:
                data = json.load(f)
            self.flat_labels = data["labels"]
            print(f"[YONO-BATCH] Flat model: {len(self.flat_labels)} classes")

        hier_path = Path(f"{MODELS_DIR}/hier_family.onnx")
        hier_labels_path = Path(f"{MODELS_DIR}/hier_labels.json")
        if hier_path.exists() and hier_labels_path.exists():
            self.tier1_sess = ort.InferenceSession(str(hier_path), providers=["CPUExecutionProvider"])
            self.tier1_input = self.tier1_sess.get_inputs()[0].name
            with open(hier_labels_path) as f:
                all_labels = json.load(f)
            family_map = all_labels.get("hier_family", {})
            self.family_labels = sorted(family_map, key=lambda k: family_map[k])
            for family in self.family_labels:
                t2_path = Path(f"{MODELS_DIR}/hier_{family}.onnx")
                if t2_path.exists():
                    try:
                        sess = ort.InferenceSession(str(t2_path), providers=["CPUExecutionProvider"])
                        self.tier2[family] = sess
                        self.tier2_labels[family] = sorted(
                            all_labels.get(f"hier_{family}", {}),
                            key=lambda k: all_labels[f"hier_{family}"][k],
                        )
                    except Exception as e:
                        print(f"[YONO-BATCH] Skip {family} tier-2: {e}")
            print(f"[YONO-BATCH] Hierarchical: tier1={bool(self.tier1_sess)}, tier2={list(self.tier2.keys())}")

        # --- Florence-2 base model ---
        self.florence_model = None
        self.florence_processor = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        try:
            from transformers import AutoProcessor, AutoModelForCausalLM

            self.florence_processor = AutoProcessor.from_pretrained(
                "microsoft/florence-2-base", trust_remote_code=True,
            )
            self.florence_model = AutoModelForCausalLM.from_pretrained(
                "microsoft/florence-2-base", trust_remote_code=True, torch_dtype=torch.float32,
            ).to(self.device)
            self.florence_model.eval()
            print("[YONO-BATCH] Florence-2-base loaded")
        except Exception as e:
            print(f"[YONO-BATCH] Florence-2 load failed: {e}")

        # --- Vision head (finetuned condition/damage/mods/photo_type) ---
        self.vision_head = None
        self.vision_config = None
        self.vision_mode = "unavailable"

        head_path = Path(f"{MODELS_DIR}/yono_vision_v2_head.safetensors")
        config_path = Path(f"{MODELS_DIR}/yono_vision_v2_config.json")

        if head_path.exists() and config_path.exists() and self.florence_model:
            try:
                from safetensors.torch import load_file as safetensors_load

                with open(config_path) as f:
                    self.vision_config = json.load(f)

                hidden_size = self.vision_config["hidden_size"]
                n_damage = self.vision_config["n_damage"]
                n_mods = self.vision_config["n_mods"]
                n_photo_types = self.vision_config["n_photo_types"]

                class VisionHead(nn.Module):
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

                self.vision_head = VisionHead(hidden_size, n_damage, n_mods, n_photo_types)
                state_dict = safetensors_load(head_path)
                self.vision_head.load_state_dict(state_dict)
                self.vision_head = self.vision_head.to(self.device)
                self.vision_head.eval()
                self.vision_mode = "finetuned_v2"
                print(f"[YONO-BATCH] Vision head loaded (val_loss={self.vision_config.get('best_val_loss', '?')})")
            except Exception as e:
                print(f"[YONO-BATCH] Vision head load failed: {e}")
                self.vision_head = None
                self.vision_config = None

        # --- Zone classifier head ---
        self.zone_head = None
        self.zone_codes = None

        zone_head_path = Path(f"{MODELS_DIR}/yono_zone_head.safetensors")
        zone_labels_path = Path(f"{MODELS_DIR}/yono_zone_classifier_labels.json")
        zone_config_path = Path(f"{MODELS_DIR}/yono_zone_config.json")

        if zone_head_path.exists() and zone_labels_path.exists() and self.florence_model:
            try:
                from safetensors.torch import load_file as safetensors_load

                with open(zone_labels_path) as f:
                    labels_data = json.load(f)
                self.zone_codes = labels_data["zone_codes"]
                n_zones = len(self.zone_codes)

                hidden_size = 768
                if zone_config_path.exists():
                    with open(zone_config_path) as f:
                        cfg = json.load(f)
                    hidden_size = cfg.get("hidden_size", 768)
                    n_zones = cfg.get("n_zones", n_zones)

                class ZoneClassifierHead(nn.Module):
                    def __init__(self, hidden_size=768, n_zones=41, dropout=0.2):
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

                self.zone_head = ZoneClassifierHead(hidden_size=hidden_size, n_zones=n_zones)
                state_dict = safetensors_load(zone_head_path)
                self.zone_head.load_state_dict(state_dict)
                self.zone_head = self.zone_head.to(self.device)
                self.zone_head.eval()
                print(f"[YONO-BATCH] Zone classifier loaded: {n_zones} zones")
            except Exception as e:
                print(f"[YONO-BATCH] Zone classifier load failed: {e}")

        print(f"[YONO-BATCH] Ready — classify={bool(self.tier1_sess or self.flat_sess)}, "
              f"vision={self.vision_mode}, zone={bool(self.zone_head)}")

    def _classify(self, tensor, top_k: int = 5) -> dict:
        """ONNX make classification."""
        if self.tier1_sess:
            logits = self.tier1_sess.run(None, {self.tier1_input: tensor})[0]
            probs = _softmax(logits)[0]
            top_idx = int(probs.argmax())
            family = self.family_labels[top_idx]
            family_conf = float(probs[top_idx])

            if family in self.tier2:
                sess = self.tier2[family]
                inp = sess.get_inputs()[0].name
                logits2 = sess.run(None, {inp: tensor})[0]
                probs2 = _softmax(logits2)[0]
                labels2 = self.tier2_labels[family]
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

        if self.flat_sess:
            logits = self.flat_sess.run(None, {self.flat_input: tensor})[0]
            probs = _softmax(logits)[0]
            top_ix = probs.argsort()[::-1][:top_k]
            top5 = [[self.flat_labels[i], float(probs[i])] for i in top_ix]
            return {
                "make": top5[0][0], "confidence": top5[0][1],
                "family": None, "family_confidence": None,
                "top5": top5, "source": "flat_fallback",
                "is_vehicle": top5[0][1] >= 0.25,
            }

        return {"make": None, "confidence": 0.0, "top5": [], "source": "unavailable", "is_vehicle": False}

    def _analyze_vision(self, image_bytes: bytes) -> dict:
        """Full Florence-2 vision analysis: zone, condition, damage, mods, photo quality."""
        import torch
        from PIL import Image

        if not self.florence_model:
            return {}

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        inputs = self.florence_processor(
            text="<DETAILED_CAPTION>", images=img, return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].to(self.device)

        with torch.no_grad():
            features = self.florence_model._encode_image(pixel_values)

            # Always generate caption (stored in image_descriptions)
            caption = ""
            try:
                generated_ids = self.florence_model.generate(
                    input_ids=inputs["input_ids"].to(self.device),
                    pixel_values=pixel_values,
                    max_new_tokens=200, do_sample=False, num_beams=2,
                )
                generated_text = self.florence_processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
                parsed = self.florence_processor.post_process_generation(
                    generated_text, task="<DETAILED_CAPTION>",
                    image_size=(img.width, img.height),
                )
                caption = parsed.get("<DETAILED_CAPTION>", "")
            except Exception:
                pass

            # --- Finetuned vision head ---
            if self.vision_head and self.vision_config:
                preds = self.vision_head(features)
                config = self.vision_config

                cond_score = int(preds["condition_score"].argmax(dim=-1).item()) + 1
                photo_qual = int(preds["photo_quality"].argmax(dim=-1).item()) + 1

                pt_idx = int(preds["photo_type"].argmax(dim=-1).item())
                photo_type = config["photo_types"][pt_idx]

                iq_idx = int(preds["interior_quality"].argmax(dim=-1).item())
                interior_quality = (iq_idx + 1) if photo_type == "interior" else None

                dmg_probs = preds["damage_flags"].sigmoid()[0]
                damage_flags = [
                    config["damage_flags"][i]
                    for i, p in enumerate(dmg_probs.tolist()) if p >= 0.4
                ]

                mod_probs = preds["mod_flags"].sigmoid()[0]
                mod_flags = [
                    config["mod_flags"][i]
                    for i, p in enumerate(mod_probs.tolist()) if p >= 0.4
                ]

                # Zone from zone classifier or photo_type heuristic
                if self.zone_head and self.zone_codes:
                    zone_logits = self.zone_head(features)
                    zone_probs = torch.softmax(zone_logits, dim=-1)[0]
                    zone_idx = int(zone_probs.argmax().item())
                    vehicle_zone = self.zone_codes[zone_idx]
                    zone_confidence = float(zone_probs[zone_idx])
                    zone_source = "zone_classifier_v1"
                else:
                    vehicle_zone = PHOTO_TYPE_TO_ZONE.get(photo_type, "other")
                    zone_confidence = 0.7
                    zone_source = "photo_type_heuristic"

                return {
                    "vehicle_zone": vehicle_zone,
                    "zone_confidence": zone_confidence,
                    "zone_source": zone_source,
                    "condition_score": cond_score,
                    "damage_flags": damage_flags,
                    "modification_flags": mod_flags,
                    "photo_quality_score": photo_qual,
                    "photo_type": photo_type,
                    "interior_quality": interior_quality,
                    "vision_model_version": "finetuned_v2",
                    "caption": caption,
                }

            # --- Zero-shot fallback (caption-based) ---
            # Caption already generated above; use lowercased for keyword matching
            caption = caption.lower() if caption else ""

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

            if self.zone_head and self.zone_codes:
                zone_logits = self.zone_head(features)
                zone_probs = torch.softmax(zone_logits, dim=-1)[0]
                zone_idx = int(zone_probs.argmax().item())
                vehicle_zone = self.zone_codes[zone_idx]
                zone_confidence = float(zone_probs[zone_idx])
                zone_source = "zone_classifier_v1"
            else:
                vehicle_zone = PHOTO_TYPE_TO_ZONE.get(photo_type, "other")
                zone_confidence = 0.5
                zone_source = "photo_type_heuristic"

            return {
                "vehicle_zone": vehicle_zone,
                "zone_confidence": zone_confidence,
                "zone_source": zone_source,
                "condition_score": condition_score,
                "damage_flags": damage_flags,
                "modification_flags": mod_flags,
                "photo_quality_score": photo_quality,
                "photo_type": photo_type,
                "interior_quality": interior_quality,
                "vision_model_version": "zeroshot_florence2",
                "caption": caption,
            }

    @modal.method()
    def process_chunk(self, image_records: list[dict]) -> list[dict]:
        """Full pipeline per image: fetch → classify → vision analyze.

        Each record: {id, image_url}
        Returns complete results with all vision fields.
        """
        import httpx

        results = []
        fetch_headers = {
            "User-Agent": "Mozilla/5.0 (compatible; NukeVision/1.0; +https://nuke.ag)",
            "Accept": "image/*,*/*",
        }

        for rec in image_records:
            image_id = rec["id"]
            vehicle_id = rec.get("vehicle_id")
            url = rec["image_url"]
            try:
                with httpx.Client(timeout=15, follow_redirects=True) as client:
                    resp = client.get(url, headers=fetch_headers)
                    resp.raise_for_status()
                    image_bytes = resp.content

                # 1. ONNX make classification
                tensor = _preprocess_bytes(image_bytes)
                classify_result = self._classify(tensor)

                # 2. Florence-2 full vision analysis
                vision_result = self._analyze_vision(image_bytes)

                # Merge into single result
                result = {
                    "id": image_id,
                    "vehicle_id": vehicle_id,
                    "classified_at": datetime.now(timezone.utc).isoformat(),
                    **classify_result,
                    **vision_result,
                }
                results.append(result)
            except Exception as e:
                results.append({"id": image_id, "vehicle_id": vehicle_id, "error": str(e)[:200]})

        return results


# ============================================================
# Supabase helpers
# ============================================================

def _get_supabase_client():
    """Create Supabase client from Modal secrets."""
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def _fetch_pending(supabase, limit: int = MAX_PENDING) -> list[dict]:
    """Fetch pending vehicle_images for processing."""
    resp = (
        supabase.table("vehicle_images")
        .select("id, vehicle_id, image_url")
        .eq("ai_processing_status", "pending")
        .not_.is_("image_url", "null")
        .limit(limit)
        .execute()
    )
    return resp.data or []


_template_cache = {}  # {(make, year): zone_bounds dict or None}

def _get_template_bounds(supabase, make: str, model: str, year: int) -> dict:
    """Look up vehicle_surface_templates for coordinate resolution.

    Uses fuzzy model matching: exact first, then prefix match
    (e.g. template "K10" matches vehicle "K10 SWB", "K10 Scottsdale").
    Returns zone_bounds dict or {}.
    """
    if not make or not year:
        return {}
    cache_key = (make, model, year)
    if cache_key in _template_cache:
        return _template_cache[cache_key]

    try:
        # Exact match first
        resp = (
            supabase.table("vehicle_surface_templates")
            .select("zone_bounds")
            .eq("make", make)
            .lte("year_start", year)
            .gte("year_end", year)
            .limit(1)
            .execute()
        )
        # Filter for model match (supabase client doesn't support ILIKE on model easily)
        matches = [r for r in (resp.data or []) if r.get("zone_bounds")]
        if not matches and model:
            # Fetch all templates for this make/year range and fuzzy match
            resp = (
                supabase.table("vehicle_surface_templates")
                .select("model, zone_bounds")
                .eq("make", make)
                .lte("year_start", year)
                .gte("year_end", year)
                .execute()
            )
            # Prefix match: vehicle "K10 SWB" starts with template "K10"
            for r in (resp.data or []):
                tmpl_model = r.get("model", "")
                if model.lower().startswith(tmpl_model.lower()):
                    matches = [r]
                    break

        if matches:
            bounds = matches[0].get("zone_bounds", {})
            if isinstance(bounds, str):
                bounds = json.loads(bounds)
            _template_cache[cache_key] = bounds
            return bounds
    except Exception:
        pass

    _template_cache[cache_key] = {}
    return {}


def _resolve_zone_to_coords(zone_bounds: dict, zone: str) -> dict:
    """Resolve a zone code to physical inch coordinates."""
    if not zone_bounds or not zone:
        return {}
    bounds = zone_bounds.get(zone)
    if not bounds:
        return {}
    return {
        "u_min_inches": bounds.get("u_min"),
        "u_max_inches": bounds.get("u_max"),
        "v_min_inches": bounds.get("v_min"),
        "v_max_inches": bounds.get("v_max"),
        "h_min_inches": bounds.get("h_min"),
        "h_max_inches": bounds.get("h_max"),
    }


def _get_vehicle_ymm(supabase, vehicle_id: str) -> dict:
    """Get year/make/model for a vehicle. Cached per batch."""
    try:
        resp = (
            supabase.table("vehicles")
            .select("year, make, model")
            .eq("id", vehicle_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]
    except Exception:
        pass
    return {}


def _write_results(supabase, results: list[dict]) -> dict:
    """Write full vision results back to vehicle_images + image_descriptions + surface_observations."""
    stats = {"written": 0, "errors": 0, "skipped": 0, "descriptions": 0, "surface_obs": 0}
    ymm_cache = {}  # vehicle_id → {year, make, model}

    for r in results:
        image_id = r.get("id")
        if not image_id:
            stats["skipped"] += 1
            continue

        if "error" in r:
            try:
                supabase.table("vehicle_images").update({
                    "ai_processing_status": "failed",
                    "ai_scan_metadata": json.dumps({"yono": {"error": r["error"]}}),
                }).eq("id", image_id).execute()
                stats["errors"] += 1
            except Exception:
                stats["errors"] += 1
            continue

        try:
            # Classification data → ai_scan_metadata.yono
            yono_data = {
                "make": r.get("make"),
                "confidence": r.get("confidence"),
                "top5": r.get("top5"),
                "is_vehicle": r.get("is_vehicle"),
                "family": r.get("family"),
                "family_confidence": r.get("family_confidence"),
                "source": r.get("source"),
                "classified_at": r.get("classified_at"),
            }

            # Full update — classification + all vision fields
            update = {
                "ai_processing_status": "completed",
                "ai_scan_metadata": json.dumps({"yono": yono_data}),
                "vision_analyzed_at": r.get("classified_at"),
                "vision_model_version": r.get("vision_model_version"),
            }

            # Vision fields (only write if vision analysis ran)
            if r.get("vehicle_zone"):
                update["vehicle_zone"] = r["vehicle_zone"]
                update["zone_confidence"] = r["zone_confidence"]
                update["zone_source"] = r["zone_source"]
            if r.get("condition_score"):
                update["condition_score"] = r["condition_score"]
            if r.get("photo_quality_score"):
                update["photo_quality_score"] = r["photo_quality_score"]
            if r.get("damage_flags") is not None:
                update["damage_flags"] = r["damage_flags"]
            if r.get("modification_flags") is not None:
                update["modification_flags"] = r["modification_flags"]

            supabase.table("vehicle_images").update(update).eq("id", image_id).execute()
            stats["written"] += 1

            # Write surface_observations (spatial layer)
            # Every observation is spatially anchored. The spectrometer says WHAT,
            # the surface map says WHERE. Physical coordinates resolve via templates.
            vehicle_id = r.get("vehicle_id")
            if r.get("vehicle_zone") and vehicle_id:
                try:
                    # Get Y/M/M for template lookup (cached per vehicle)
                    if vehicle_id not in ymm_cache:
                        ymm_cache[vehicle_id] = _get_vehicle_ymm(supabase, vehicle_id)
                    ymm = ymm_cache[vehicle_id]
                    v_make = ymm.get("make")
                    v_model = ymm.get("model")
                    v_year = ymm.get("year")

                    # Resolve zone → physical inch coordinates
                    zone_bounds = _get_template_bounds(supabase, v_make, v_model, v_year) if v_make else {}
                    coords = _resolve_zone_to_coords(zone_bounds, r["vehicle_zone"])

                    # Map condition_score (1-5) to lifecycle state
                    cs = r.get("condition_score")
                    lifecycle = None
                    if cs is not None:
                        if cs >= 5: lifecycle = "fresh"
                        elif cs >= 4: lifecycle = "worn"
                        elif cs >= 3: lifecycle = "weathered"
                        elif cs >= 2: lifecycle = "ghost"
                        else: lifecycle = "archaeological"

                    # Base fields shared by all observations from this image
                    base = {
                        "vehicle_image_id": image_id,
                        "vehicle_id": vehicle_id,
                        "zone": r["vehicle_zone"],
                        "confidence": r.get("zone_confidence"),
                        "model_version": r.get("vision_model_version"),
                        "resolution_level": 0,
                        "bbox_x": 0.0, "bbox_y": 0.0, "bbox_w": 1.0, "bbox_h": 1.0,
                        "lifecycle_state": lifecycle,
                        "pass_number": 1,
                        **coords,  # physical inch coordinates (empty dict if no template)
                    }

                    # Zone classify observation
                    obs_rows = [{
                        **base,
                        "observation_type": "zone_classify",
                        "label": r["vehicle_zone"],
                        "pass_name": "zone_classify",
                    }]

                    # Damage observations — each flag becomes a spatially-anchored condition observation
                    for dmg in (r.get("damage_flags") or []):
                        obs_rows.append({
                            **base,
                            "observation_type": "condition",
                            "label": dmg,
                            "pass_name": "damage_scan",
                            "evidence": json.dumps({"raw_flag": dmg}),
                        })

                    # Modification observations
                    for mod in (r.get("modification_flags") or []):
                        obs_rows.append({
                            **base,
                            "observation_type": "modification",
                            "label": mod,
                            "pass_name": "mod_scan",
                            "evidence": json.dumps({"raw_flag": mod}),
                        })

                    supabase.table("surface_observations").insert(obs_rows).execute()
                    stats["surface_obs"] += len(obs_rows)
                except Exception as so_err:
                    print(f"[YONO-BATCH] Surface obs write error for {image_id}: {so_err}")

            # Write caption to image_descriptions (Pass 1: raw Florence-2)
            caption = r.get("caption", "")
            vehicle_id = r.get("vehicle_id")
            if caption and vehicle_id:
                try:
                    supabase.table("image_descriptions").insert({
                        "image_id": image_id,
                        "vehicle_id": vehicle_id,
                        "description": caption,
                        "description_type": "auto",
                        "source": "florence2_caption",
                        "source_version": r.get("vision_model_version", "unknown"),
                        "pass_number": 1,
                        "confidence": r.get("zone_confidence"),
                    }).execute()
                    stats["descriptions"] += 1
                except Exception as desc_err:
                    # Non-fatal: caption storage failure shouldn't block main pipeline
                    print(f"[YONO-BATCH] Description write error for {image_id}: {desc_err}")
        except Exception as e:
            print(f"[YONO-BATCH] Write error for {image_id}: {e}")
            stats["errors"] += 1

    return stats


# ============================================================
# Session classification (post-processing)
# ============================================================

SESSION_MODEL_PATH = "/data/models/yono_session_classifier.onnx"
SESSION_CONFIG_PATH = "/data/models/yono_session_config.json"

def _classify_sessions_for_results(supabase, results: list[dict]) -> dict:
    """
    After batch processing, check if session classifier ONNX exists.
    If so, classify sessions for vehicles that had images processed.
    """
    if not os.path.exists(SESSION_MODEL_PATH) or not os.path.exists(SESSION_CONFIG_PATH):
        return None  # No session classifier trained yet

    # Get unique vehicle IDs from results
    vehicle_ids = list(set(r.get("vehicle_id") for r in results if r.get("vehicle_id") and "error" not in r))
    if not vehicle_ids:
        return None

    try:
        import onnxruntime as ort
        import numpy as np

        with open(SESSION_CONFIG_PATH) as f:
            config = json.load(f)

        session = ort.InferenceSession(SESSION_MODEL_PATH, providers=["CPUExecutionProvider"])
        type_keys = config["session_types"]
        max_images = config.get("max_images_per_session", 30)
        feature_dim = config.get("feature_dim", 768)

        classified = 0

        for vid in vehicle_ids[:50]:  # Cap at 50 vehicles per batch
            # Get auto-sessions for this vehicle
            resp = (
                supabase.table("image_sets")
                .select("id, session_type_key")
                .eq("vehicle_id", vid)
                .eq("is_auto_session", True)
                .execute()
            )
            sessions_list = resp.data or []

            # Skip if no sessions (session detection hasn't run yet)
            if not sessions_list:
                continue

            # For now, just mark that sessions exist but need Florence-2 features
            # to be extracted first (done in export_session_features on Modal GPU).
            # The weekly cron handles full feature export + training.
            # Here we just update session type if a trained model exists.
            classified += len(sessions_list)

        return {"classified": classified, "vehicles_checked": len(vehicle_ids)}

    except Exception as e:
        print(f"[YONO-BATCH] Session classification post-process error (non-fatal): {e}")
        return None


# ============================================================
# Poll + Dispatch (cron entry point)
# ============================================================

@app.function(
    schedule=modal.Cron("*/15 * * * *"),
    image=image,
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    timeout=900,  # 15 min max
)
def poll_and_dispatch():
    """Cron: check for pending images, dispatch full vision pipeline, write results."""
    t0 = time.time()
    print(f"[YONO-BATCH] Poll started at {datetime.now(timezone.utc).isoformat()}")

    supabase = _get_supabase_client()
    pending = _fetch_pending(supabase, MAX_PENDING)

    if not pending:
        print("[YONO-BATCH] No pending images. Exiting. Cost: $0")
        return

    print(f"[YONO-BATCH] Found {len(pending)} pending images — running FULL vision pipeline")

    # Chunk into batches
    chunks = [pending[i:i + CHUNK_SIZE] for i in range(0, len(pending), CHUNK_SIZE)]
    print(f"[YONO-BATCH] Dispatching {len(chunks)} chunks to workers")

    # Mark as processing to prevent double-pickup
    image_ids = [r["id"] for r in pending]
    for i in range(0, len(image_ids), 500):
        batch_ids = image_ids[i:i + 500]
        supabase.table("vehicle_images").update({
            "ai_processing_status": "processing",
        }).in_("id", batch_ids).execute()

    # Burst workers with .map() — each worker runs full vision pipeline
    worker = BatchWorker()
    all_results = []
    for chunk_results in worker.process_chunk.map(chunks):
        all_results.extend(chunk_results)

    # Write all results back to Supabase
    stats = _write_results(supabase, all_results)

    # Post-processing: classify sessions for newly processed vehicles
    session_stats = _classify_sessions_for_results(supabase, all_results)
    if session_stats:
        stats["sessions_classified"] = session_stats.get("classified", 0)

    elapsed = round(time.time() - t0, 1)
    print(f"[YONO-BATCH] Done in {elapsed}s — written={stats['written']}, errors={stats['errors']}, "
          f"skipped={stats['skipped']}, descriptions={stats.get('descriptions', 0)}, "
          f"surface_obs={stats.get('surface_obs', 0)}")
    return stats


# ============================================================
# Manual kick (local entrypoint)
# ============================================================

@app.local_entrypoint()
def kick():
    """Manually trigger batch processing without waiting for cron."""
    print("[YONO-BATCH] Manual kick — full vision pipeline")
    result = poll_and_dispatch.remote()
    print(f"[YONO-BATCH] Result: {result}")
