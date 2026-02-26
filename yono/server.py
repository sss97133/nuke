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
  GET  /health          → {status, model_version, tier1, tier2_families, flat, uptime_s, vision_available}
  POST /classify        → {image_url} → {make, confidence, family, family_confidence, top5, source, is_vehicle, ms}
  POST /classify/batch  → [{image_url},...] → [{...},...]
  GET  /labels          → full list of known makes / families

  POST /analyze         → {image_url} → {vehicle_zone, zone_confidence, condition_score,
                                          damage_flags, modification_flags, interior_quality,
                                          photo_quality, surface_coord_u, surface_coord_v, ms, model}
  POST /analyze/batch   → {images: [{image_url},...]} → {results: [...], count: N}
"""

import argparse
import json
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

# === Paths ===
YONO_DIR = Path(__file__).parent
MODELS_DIR = YONO_DIR / "models"
VISION_HEAD_PATH = MODELS_DIR / "yono_vision_v2_head.safetensors"
VISION_CONFIG_PATH = MODELS_DIR / "yono_vision_v2_config.json"
ZONE_HEAD_PATH = MODELS_DIR / "yono_zone_head.safetensors"
ZONE_CONFIG_PATH = MODELS_DIR / "yono_zone_config.json"

# Loaded at startup
_hier: Optional[HierarchicalYONO] = None
_flat: Optional[YONOClassifier] = None
_vision_analyzer: Optional["VisionAnalyzer"] = None
_zone_classifier: Optional["ZoneClassifier"] = None
_started_at = time.time()


# ============================================================
# ZoneClassifier — Florence-2 based zone prediction
# ============================================================

class ZoneClassifier:
    """
    Zone classifier: image → vehicle_zone (41-class).

    Loads fine-tuned head from yono_zone_head.safetensors.
    Falls back to zone extraction from VisionAnalyzer zero-shot caption
    if fine-tuned model not available.
    """

    # Photo-type → zone mapping for zero-shot fallback (from old photo_type field)
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

    def __init__(self, model, processor, device):
        self.model = model
        self.processor = processor
        self.device = device
        self._head = None
        self._zone_codes = None
        self._loaded = False

        if ZONE_HEAD_PATH.exists() and ZONE_CONFIG_PATH.exists():
            self._load_head()

    def _load_head(self):
        """Load fine-tuned zone head."""
        try:
            import torch
            from torch import nn
            from safetensors.torch import load_file as safetensors_load

            with open(ZONE_CONFIG_PATH) as f:
                config = json.load(f)

            self._zone_codes = config["zone_codes"]
            n_zones = config["n_zones"]
            hidden_size = config.get("hidden_size", 768)

            class ZoneHead(nn.Module):
                def __init__(self, hidden_size, n_zones):
                    super().__init__()
                    self.net = nn.Sequential(
                        nn.LayerNorm(hidden_size),
                        nn.Linear(hidden_size, 512),
                        nn.GELU(),
                        nn.Dropout(0.2),
                        nn.Linear(512, 256),
                        nn.GELU(),
                        nn.Dropout(0.1),
                        nn.Linear(256, n_zones),
                    )
                def forward(self, x):
                    return self.net(x.mean(dim=1))

            head = ZoneHead(hidden_size, n_zones)
            state = safetensors_load(ZONE_HEAD_PATH)
            head.load_state_dict(state)
            self._head = head.to(self.device)
            self._head.eval()
            self._loaded = True
            print(f"ZoneClassifier: fine-tuned head loaded (val_acc={config.get('best_val_acc', '?'):.1%})")
        except Exception as e:
            print(f"ZoneClassifier: head load failed: {e} — using caption fallback")

    def classify(self, image_path: str) -> dict:
        """
        Classify zone for an image.

        Returns:
          {vehicle_zone: str, zone_confidence: float, surface_coord_u: null, surface_coord_v: null}
        """
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")
        inputs = self.processor(text="<DETAILED_CAPTION>", images=image, return_tensors="pt").to(self.device)

        if self._loaded and self._head is not None:
            with torch.no_grad():
                features = self.model._encode_image(inputs["pixel_values"])
                logits = self._head(features)
                probs = logits.softmax(dim=-1)[0]
                top_idx = int(probs.argmax().item())
                zone = self._zone_codes[top_idx]
                confidence = float(probs[top_idx].item())
        else:
            # Fallback: generate caption and extract zone via keyword matching
            zone, confidence = self._caption_to_zone(inputs)

        return {
            "vehicle_zone": zone,
            "zone_confidence": round(confidence, 3),
            "surface_coord_u": None,  # populated by COLMAP Phase 1
            "surface_coord_v": None,
        }

    def _caption_to_zone(self, inputs) -> tuple:
        """Zero-shot zone inference from Florence-2 caption."""
        import torch
        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=80,
                do_sample=False,
                num_beams=2,
            )
        text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0].lower()

        # Zone keyword matching (ordered from most to least specific)
        zone_keywords = [
            ("detail_vin", ["vin plate", "vin number", "vehicle identification"]),
            ("detail_odometer", ["odometer", "mileage reading", "instrument cluster"]),
            ("detail_badge", ["badge", "emblem", "logo", "nameplate"]),
            ("detail_damage", ["damage close", "rust close", "dent close"]),
            ("ext_undercarriage", ["undercarriage", "underneath", "frame"]),
            ("ext_roof", ["roof", "top down", "aerial", "overhead"]),
            ("ext_front_driver", ["front driver", "front left", "front 3/4"]),
            ("ext_front_passenger", ["front passenger", "front right"]),
            ("ext_rear_driver", ["rear driver", "rear left"]),
            ("ext_rear_passenger", ["rear passenger", "rear right"]),
            ("ext_front", ["front", "grille", "headlight"]),
            ("ext_rear", ["rear", "taillight", "trunk lid", "back"]),
            ("ext_driver_side", ["driver side", "left side", "profile"]),
            ("ext_passenger_side", ["passenger side", "right side"]),
            ("panel_hood", ["hood open", "hood surface", "bonnet"]),
            ("panel_trunk", ["trunk open", "boot open", "tailgate"]),
            ("panel_door_fl", ["driver door", "front left door"]),
            ("panel_door_fr", ["passenger door", "front right door"]),
            ("panel_fender_rl", ["rear left fender", "rear left quarter"]),
            ("panel_fender_rr", ["rear right fender", "rear right quarter"]),
            ("panel_fender_fl", ["front left fender"]),
            ("panel_fender_fr", ["front right fender"]),
            ("wheel_fl", ["wheel", "tire", "rim", "brake"]),
            ("int_dashboard", ["dashboard", "interior", "steering wheel", "gauges"]),
            ("int_front_seats", ["front seat", "driver seat"]),
            ("int_rear_seats", ["rear seat", "back seat"]),
            ("int_cargo", ["cargo", "trunk interior", "boot interior"]),
            ("mech_engine_bay", ["engine", "motor", "engine bay"]),
            ("mech_transmission", ["transmission", "gearbox"]),
            ("mech_suspension", ["suspension", "axle", "differential"]),
        ]

        for zone, keywords in zone_keywords:
            if any(kw in text for kw in keywords):
                return zone, 0.6  # 0.6 = moderate confidence for caption-derived

        return "other", 0.4


# ============================================================
# VisionAnalyzer — Florence-2 based condition assessment
# ============================================================

class VisionAnalyzer:
    """
    Vehicle condition analyzer using Florence-2-base.

    If fine-tuned head weights exist (yono_vision_v2_head.safetensors), uses
    the fine-tuned model. Otherwise falls back to zero-shot Florence-2 captioning
    + structured extraction.

    Outputs:
      condition_score (1-5), damage_flags (list), modification_flags (list),
      interior_quality (1-5 or null), photo_quality (1-5), photo_type (str)
    """

    DAMAGE_FLAGS = ["rust", "dent", "crack", "paint_fade", "broken_glass", "missing_parts", "accident_damage"]
    MOD_FLAGS = ["lift_kit", "lowered", "aftermarket_wheels", "roll_cage", "engine_swap", "body_kit", "exhaust_mod", "suspension_mod"]
    PHOTO_TYPES = ["exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "wheel", "detail", "undercarriage", "other"]

    def __init__(self):
        import torch
        from transformers import AutoProcessor, AutoModelForCausalLM

        self.device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        self.torch = torch

        print(f"Loading Florence-2-base (device: {self.device})...")
        t0 = time.time()

        self.processor = AutoProcessor.from_pretrained(
            "microsoft/florence-2-base",
            trust_remote_code=True,
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            "microsoft/florence-2-base",
            trust_remote_code=True,
            torch_dtype=torch.float32,
        ).to(self.device)
        self.model.eval()

        print(f"Florence-2 loaded in {time.time()-t0:.1f}s")

        # Try to load fine-tuned head + config
        self._head = None
        self._head_config = None
        self._vision_encoder = None
        self._finetuned = False

        if VISION_HEAD_PATH.exists() and VISION_CONFIG_PATH.exists():
            self._load_finetuned_head()

        if self._finetuned:
            self._mode = "finetuned"
            print("VisionAnalyzer: fine-tuned mode (yono_vision_v2)")
        else:
            self._mode = "zeroshot"
            print("VisionAnalyzer: zero-shot mode (Florence-2 captioning)")

    def _load_finetuned_head(self):
        """Load fine-tuned classification head."""
        try:
            import torch
            from safetensors.torch import load_file as safetensors_load

            with open(VISION_CONFIG_PATH) as f:
                config = json.load(f)
            self._head_config = config

            # Rebuild head architecture (matches train_florence2.py VehicleVisionHead)
            hidden_size = config["hidden_size"]
            n_damage = config["n_damage"]
            n_mods = config["n_mods"]
            n_photo_types = config["n_photo_types"]

            from torch import nn

            class VisionHead(nn.Module):
                """Matches VehicleVisionHead in train_florence2.py."""
                def __init__(self, hidden_size, n_damage, n_mods, n_photo_types):
                    super().__init__()
                    # Shared bottleneck: mean-pooled features → 512
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
                    # Mean-pool over spatial tokens (same as training)
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

            self._head = VisionHead(hidden_size, n_damage, n_mods, n_photo_types)
            state_dict = safetensors_load(VISION_HEAD_PATH)
            self._head.load_state_dict(state_dict)
            self._head = self._head.to(self.device)
            self._head.eval()

            self._finetuned = True
            print(f"Fine-tuned head loaded (val_loss={config.get('best_val_loss', '?'):.4f})")
        except Exception as e:
            print(f"Fine-tuned head load failed: {e} — using zero-shot mode")
            self._finetuned = False

    def analyze(self, image_path: str) -> dict:
        """
        Analyze a vehicle image.

        Returns:
          {
            condition_score: 1-5,
            damage_flags: [...],
            modification_flags: [...],
            interior_quality: 1-5 or null,
            photo_quality: 1-5,
            photo_type: str,
            model: "finetuned_v2" | "zeroshot_florence2"
          }
        """
        if self._finetuned:
            return self._analyze_finetuned(image_path)
        else:
            return self._analyze_zeroshot(image_path)

    def _analyze_finetuned(self, image_path: str) -> dict:
        """Use fine-tuned Florence-2 head for prediction."""
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")
        # Florence-2 processor needs task prompt + image
        inputs = self.processor(
            text="<DETAILED_CAPTION>",
            images=image,
            return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].to(self.device)

        config = self._head_config

        with torch.no_grad():
            # Use Florence-2's internal image encoding
            # Returns (batch, 577, 768) spatial features
            features = self.model._encode_image(pixel_values)
            preds = self._head(features)

            cond_score = int(preds["condition_score"].argmax(dim=-1).item()) + 1
            photo_qual = int(preds["photo_quality"].argmax(dim=-1).item()) + 1

            iq_idx = int(preds["interior_quality"].argmax(dim=-1).item())
            # Determine if interior is visible by checking photo_type
            pt_idx = int(preds["photo_type"].argmax(dim=-1).item())
            photo_type = config["photo_types"][pt_idx]
            interior_quality = (iq_idx + 1) if photo_type == "interior" else None

            # Damage flags (threshold 0.4)
            dmg_probs = preds["damage_flags"].sigmoid()[0]
            damage_flags = [
                config["damage_flags"][i]
                for i, p in enumerate(dmg_probs.tolist())
                if p >= 0.4
            ]

            # Mod flags (threshold 0.4)
            mod_probs = preds["mod_flags"].sigmoid()[0]
            mod_flags = [
                config["mod_flags"][i]
                for i, p in enumerate(mod_probs.tolist())
                if p >= 0.4
            ]

        return {
            "condition_score": cond_score,
            "damage_flags": damage_flags,
            "modification_flags": mod_flags,
            "interior_quality": interior_quality,
            "photo_quality": photo_qual,
            "photo_type": photo_type,
            "model": "finetuned_v2",
        }

    def _analyze_zeroshot(self, image_path: str) -> dict:
        """
        Zero-shot Florence-2 analysis using structured captioning tasks.

        Uses Florence-2's built-in <DETAILED_CAPTION> prompt, then extracts
        structured condition fields via keyword matching on the generated caption.
        """
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")

        # Detailed captioning task
        task_prompt = "<DETAILED_CAPTION>"
        inputs = self.processor(text=task_prompt, images=image, return_tensors="pt").to(self.device)

        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=200,
                do_sample=False,
                num_beams=3,
            )

        generated_text = self.processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = self.processor.post_process_generation(
            generated_text, task=task_prompt, image_size=(image.width, image.height)
        )
        caption = parsed.get("<DETAILED_CAPTION>", "").lower()

        # Extract structured fields from caption via keyword matching
        result = self._extract_from_caption(caption, image)
        result["model"] = "zeroshot_florence2"
        return result

    def _extract_from_caption(self, caption: str, image) -> dict:
        """Extract structured condition fields from Florence-2 caption text."""
        # Damage detection via keyword matching
        damage_keywords = {
            "rust": ["rust", "rusty", "rusted", "corrosion", "corroded", "oxidation"],
            "dent": ["dent", "dented", "ding", "crease", "creased", "deformation"],
            "crack": ["crack", "cracked", "fracture", "fissure", "split"],
            "paint_fade": ["faded", "paint fade", "weathered", "oxidized paint", "peeling", "chalking"],
            "broken_glass": ["broken glass", "cracked glass", "missing window", "broken windshield"],
            "missing_parts": ["missing", "absent", "no hood", "no bumper", "stripped"],
            "accident_damage": ["accident", "collision", "crash", "impact damage", "body damage", "damaged"],
        }

        modification_keywords = {
            "lift_kit": ["lift", "lifted", "raised suspension", "lifted suspension", "high clearance"],
            "lowered": ["lowered", "slammed", "low rider", "dropped", "stance"],
            "aftermarket_wheels": ["aftermarket wheel", "custom wheel", "alloy wheel", "chrome wheel", "bbs", "enkei", "rays"],
            "roll_cage": ["roll cage", "roll bar", "safety cage", "cage"],
            "engine_swap": ["engine swap", "v8 swap", "ls swap", "crate engine"],
            "body_kit": ["body kit", "front lip", "side skirt", "rear diffuser", "wide body"],
            "exhaust_mod": ["exhaust", "muffler delete", "catback", "side pipe", "straight pipe"],
            "suspension_mod": ["coilover", "lowering spring", "air suspension", "air bag", "air ride"],
        }

        damage_flags = [flag for flag, kws in damage_keywords.items() if any(kw in caption for kw in kws)]
        mod_flags = [flag for flag, kws in modification_keywords.items() if any(kw in caption for kw in kws)]

        # Photo type detection
        photo_type = "other"
        if any(w in caption for w in ["front", "grille", "headlight", "bumper front"]):
            photo_type = "exterior_front"
        elif any(w in caption for w in ["rear", "trunk", "taillight", "back of"]):
            photo_type = "exterior_rear"
        elif any(w in caption for w in ["side", "door", "quarter panel", "profile"]):
            photo_type = "exterior_side"
        elif any(w in caption for w in ["interior", "dashboard", "steering wheel", "seat", "cabin"]):
            photo_type = "interior"
        elif any(w in caption for w in ["engine", "motor", "under hood", "engine bay"]):
            photo_type = "engine"
        elif any(w in caption for w in ["wheel", "tire", "rim", "brake"]):
            photo_type = "wheel"

        # Condition score heuristic from caption
        condition_score = 3  # default: fair
        excellent_words = ["pristine", "perfect", "immaculate", "concours", "showroom", "mint", "flawless"]
        good_words = ["clean", "nice", "good condition", "well maintained", "solid"]
        poor_words = ["rough", "poor condition", "needs work", "project", "parts car", "junk", "rough"]

        if any(w in caption for w in excellent_words):
            condition_score = 5
        elif any(w in caption for w in good_words):
            condition_score = 4
        elif damage_flags:
            if len(damage_flags) >= 3 or "accident_damage" in damage_flags:
                condition_score = 2
            else:
                condition_score = 3
        elif any(w in caption for w in poor_words):
            condition_score = 2

        # Photo quality heuristic
        photo_quality = 3
        if any(w in caption for w in ["blurry", "out of focus", "dark", "poor lighting", "unclear"]):
            photo_quality = 2
        elif any(w in caption for w in ["clear", "sharp", "well-lit", "detailed", "professional"]):
            photo_quality = 4

        # Interior quality (only if visible)
        interior_quality = None
        if photo_type == "interior":
            if any(w in caption for w in ["clean interior", "nice interior", "good interior"]):
                interior_quality = 4
            elif any(w in caption for w in ["torn", "ripped", "worn", "damaged interior"]):
                interior_quality = 2
            else:
                interior_quality = 3

        return {
            "condition_score": condition_score,
            "damage_flags": damage_flags,
            "modification_flags": mod_flags,
            "interior_quality": interior_quality,
            "photo_quality": photo_quality,
            "photo_type": photo_type,
        }

    def analyze_batch(self, image_paths: list[str]) -> list[dict]:
        """Analyze multiple images."""
        return [self.analyze(p) for p in image_paths]


# ============================================================
# Startup
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _hier, _flat, _vision_analyzer, _zone_classifier
    print("Loading YONO models...")

    # Load make classifier (existing, unchanged)
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

    # Load vision analyzer (Florence-2) — also creates shared model for zone classifier
    try:
        _vision_analyzer = VisionAnalyzer()
        print(f"VisionAnalyzer: {_vision_analyzer._mode}")
    except Exception as e:
        print(f"VisionAnalyzer load failed: {e}")
        _vision_analyzer = None

    # Load zone classifier (shares Florence-2 model with VisionAnalyzer)
    try:
        if _vision_analyzer is not None:
            _zone_classifier = ZoneClassifier(
                model=_vision_analyzer.model,
                processor=_vision_analyzer.processor,
                device=_vision_analyzer.device,
            )
            print(f"ZoneClassifier: {'fine-tuned' if _zone_classifier._loaded else 'caption-fallback'}")
        else:
            print("ZoneClassifier: skipped (VisionAnalyzer not loaded)")
    except Exception as e:
        print(f"ZoneClassifier load failed: {e}")
        _zone_classifier = None

    print("Ready.")
    yield


app = FastAPI(
    title="YONO",
    description="Vehicle image classifier and condition analyzer — zero API cost",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ============================================================
# Request/Response models
# ============================================================

class ClassifyRequest(BaseModel):
    image_url: str
    top_k: int = 5


class BatchRequest(BaseModel):
    images: List[ClassifyRequest]


class AnalyzeRequest(BaseModel):
    image_url: str


class AnalyzeBatchRequest(BaseModel):
    images: List[AnalyzeRequest]


# ============================================================
# Helpers
# ============================================================

def _active_clf():
    """Return best available make classifier."""
    if _hier and _hier.available:
        return _hier
    if _flat:
        return _flat
    return None


def _download_image(image_url: str) -> str:
    """Download image URL to temp file. Returns temp file path."""
    ext = Path(image_url.split("?")[0]).suffix or ".jpg"
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.close()
    urllib.request.urlretrieve(image_url, tmp.name)
    return tmp.name


def _run_classify(image_path: str, top_k: int) -> dict:
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Make classifier not loaded")
    if isinstance(clf, HierarchicalYONO):
        return clf.predict(image_path, top_k=top_k)
    result = clf.predict(image_path, top_k=top_k)
    return {**result, "family": None, "family_confidence": None, "source": "flat"}


# ============================================================
# Existing endpoints (UNCHANGED)
# ============================================================

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
        "status": "ok" if clf or _vision_analyzer else "loading",
        "model": str(clf) if clf else "loading",
        "hierarchical": hier_info,
        "vision_available": _vision_analyzer is not None,
        "vision_mode": _vision_analyzer._mode if _vision_analyzer else None,
        "zone_available": _zone_classifier is not None,
        "zone_mode": "finetuned" if (_zone_classifier and _zone_classifier._loaded) else "caption_fallback",
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


@app.post("/classify")
def classify(req: ClassifyRequest):
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Model not loaded")

    t0 = time.perf_counter()
    tmp_path = None
    try:
        tmp_path = _download_image(req.image_url)
        result = _run_classify(tmp_path, req.top_k)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Failed to classify: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
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


# ============================================================
# New vision analysis endpoints
# ============================================================

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """
    Analyze vehicle image for zone, condition, damage, modifications.

    Returns:
      vehicle_zone: Zone from 41-zone taxonomy (VISION_ARCHITECTURE.md)
      zone_confidence: 0-1 confidence in zone prediction
      surface_coord_u: null (populated after COLMAP Phase 1)
      surface_coord_v: null (populated after COLMAP Phase 1)
      condition_score (1-5): Overall exterior condition
      damage_flags: List of detected damage types
      modification_flags: List of detected modifications
      interior_quality (1-5 or null): Interior condition if visible
      photo_quality (1-5): Photo usefulness score
      ms: Inference time in milliseconds
      model: Which model was used
    """
    if not _vision_analyzer:
        raise HTTPException(503, "Vision analyzer not loaded")

    t0 = time.perf_counter()
    tmp_path = None
    try:
        tmp_path = _download_image(req.image_url)

        # Run zone classification first (Phase 1 in VISION_ARCHITECTURE.md)
        zone_result = {}
        if _zone_classifier:
            zone_result = _zone_classifier.classify(tmp_path)

        # Run condition/damage analysis (Phase 2)
        condition_result = _vision_analyzer.analyze(tmp_path)

        # Merge: zone info takes precedence, condition/damage fills in the rest
        result = {
            "vehicle_zone": zone_result.get("vehicle_zone", "other"),
            "zone_confidence": zone_result.get("zone_confidence", None),
            "surface_coord_u": None,  # null until COLMAP Phase 1
            "surface_coord_v": None,
            **condition_result,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Failed to analyze: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    return {**result, "ms": elapsed_ms, "image_url": req.image_url}


@app.post("/analyze/batch")
def analyze_batch(req: AnalyzeBatchRequest):
    """
    Batch vehicle image analysis.

    Max 20 images per request.
    """
    if not _vision_analyzer:
        raise HTTPException(503, "Vision analyzer not loaded")
    if len(req.images) > 20:
        raise HTTPException(400, "Max 20 images per batch for /analyze/batch")

    results = []
    for item in req.images:
        try:
            results.append(analyze(item))
        except HTTPException as e:
            results.append({"image_url": item.image_url, "error": e.detail})

    return {"results": results, "count": len(results)}


# ============================================================
# Entry point
# ============================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8472)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--no-vision", action="store_true", help="Skip loading VisionAnalyzer (faster startup for classify-only)")
    args = parser.parse_args()

    if args.no_vision:
        # Monkey-patch to skip vision loading
        original_lifespan = lifespan
        async def lifespan_no_vision(app):
            global _hier, _flat
            _hier = HierarchicalYONO()
            if not (_hier and _hier.available):
                _flat = YONOClassifier()
            yield
        app.router.lifespan_context = lifespan_no_vision

    print(f"Starting YONO server on {args.host}:{args.port}")
    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.reload)
