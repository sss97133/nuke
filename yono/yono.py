"""
YONO — You Only Nuke Once
Vehicle image classifier. Zero external API calls.

Usage:
  from yono import YONOClassifier

  clf = YONOClassifier()
  result = clf.predict("photo.jpg")
  # {"make": "Porsche", "confidence": 0.87, "top5": [["Porsche", 0.87], ["BMW", 0.05], ...]}

  results = clf.predict_batch(["a.jpg", "b.jpg"])
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Union

import numpy as np
from PIL import Image

YONO_DIR = Path(__file__).parent
MODELS_DIR = YONO_DIR / "models"
ONNX_PATH = MODELS_DIR / "yono_make_v1.onnx"
LABELS_PATH = MODELS_DIR / "yono_labels.json"

# ImageNet normalization (same as training)
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def _preprocess(image_path: str, size: int = 260) -> np.ndarray:
    """Load, convert HEIC if needed, resize to size x size, normalize."""
    path = Path(image_path)

    if path.suffix.lower() == ".heic":
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.close()
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-Z", "512", str(path), "--out", tmp.name],
            capture_output=True, check=True, timeout=30
        )
        path = Path(tmp.name)

    img = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - _MEAN) / _STD
    return arr.transpose(2, 0, 1)[np.newaxis]  # (1, 3, size, size)


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


class YONOClassifier:
    """
    YONO vehicle make classifier.
    Wraps ONNX model for fast local inference with no API cost.
    """

    def __init__(self, onnx_path: str = None, labels_path: str = None):
        import onnxruntime as ort

        onnx_path = Path(onnx_path or ONNX_PATH)
        labels_path = Path(labels_path or LABELS_PATH)

        if not onnx_path.exists():
            raise FileNotFoundError(
                f"YONO model not found: {onnx_path}\n"
                f"Run: python scripts/export_onnx.py"
            )
        if not labels_path.exists():
            raise FileNotFoundError(f"Labels not found: {labels_path}")

        with open(labels_path) as f:
            data = json.load(f)
        self.labels = data["labels"]  # list: labels[idx] = make_name
        self.meta = data.get("meta", {})

        # CPU is 4ms/image — fast enough. CoreML has path config issues with ONNX Runtime.
        self.session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        self._input_name = self.session.get_inputs()[0].name

    def predict(self, image_path: str, top_k: int = 5) -> dict:
        """
        Classify a single vehicle image.

        Args:
            image_path: Local file path (HEIC, JPG, PNG supported)
            top_k: Number of top predictions to return

        Returns:
            {
                "make": "Porsche",
                "confidence": 0.87,
                "top5": [["Porsche", 0.87], ["BMW", 0.05], ...],
                "is_vehicle": True  # confidence > threshold
            }
        """
        tensor = _preprocess(image_path)
        logits = self.session.run(None, {self._input_name: tensor})[0]
        probs = _softmax(logits)[0]

        top_indices = probs.argsort()[::-1][:top_k]
        top_k_results = [[self.labels[i], float(probs[i])] for i in top_indices]

        top_make, top_conf = top_k_results[0]

        return {
            "make": top_make,
            "confidence": top_conf,
            "top5": top_k_results,
            "is_vehicle": top_conf >= 0.25,  # Low threshold — caller decides
        }

    def predict_batch(self, image_paths: list, top_k: int = 5) -> list:
        """Classify multiple images. Returns list of predict() results."""
        return [self.predict(p, top_k=top_k) for p in image_paths]

    def predict_url(self, url: str, top_k: int = 5) -> dict:
        """Download image URL and classify it."""
        import urllib.request
        ext = Path(url.split("?")[0]).suffix or ".jpg"
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp.close()
        urllib.request.urlretrieve(url, tmp.name)
        result = self.predict(tmp.name, top_k=top_k)
        os.unlink(tmp.name)
        return result

    def __repr__(self):
        return (
            f"YONOClassifier("
            f"classes={len(self.labels)}, "
            f"phase={self.meta.get('phase', '?')}, "
            f"val_acc={self.meta.get('val_acc', 0):.1f}%)"
        )


class HierarchicalYONO:
    """
    Two-tier hierarchical vehicle classifier.

    Tier 1: make family (american, german, japanese, british, italian, french, swedish, other)
    Tier 2: specific make within family (per-family ONNX model)

    Falls back to flat YONOClassifier for any family without a Tier 2 model.

    Usage:
        hier = HierarchicalYONO()
        result = hier.predict("photo.jpg")
        # {
        #   "make": "Porsche", "confidence": 0.71,
        #   "family": "german", "family_confidence": 0.82,
        #   "top5": [["Porsche", 0.71], ...],
        #   "source": "hierarchical",
        #   "is_vehicle": True
        # }
    """

    TIER1_PATH = MODELS_DIR / "hier_family.onnx"
    TIER1_LABELS_PATH = MODELS_DIR / "hier_labels.json"

    def __init__(self):
        import onnxruntime as ort

        self._tier1: Optional[object] = None
        self._tier2: dict = {}  # family → ort.InferenceSession
        self._tier2_labels: dict = {}  # family → [label, ...]
        self._flat: Optional[YONOClassifier] = None

        # Load Tier 1 family classifier
        if self.TIER1_PATH.exists() and self.TIER1_LABELS_PATH.exists():
            self._tier1 = ort.InferenceSession(
                str(self.TIER1_PATH), providers=["CPUExecutionProvider"]
            )
            self._tier1_input = self._tier1.get_inputs()[0].name
            with open(self.TIER1_LABELS_PATH) as f:
                all_labels = json.load(f)
            # hier_labels.json: {model_name: {label: idx, ...}, ...}
            family_map = all_labels.get("hier_family", {})
            self._family_labels = sorted(family_map, key=lambda k: family_map[k])

            # Load any available Tier 2 per-family classifiers
            for family in self._family_labels:
                tier2_path = MODELS_DIR / f"hier_{family}.onnx"
                if tier2_path.exists():
                    sess = ort.InferenceSession(
                        str(tier2_path), providers=["CPUExecutionProvider"]
                    )
                    self._tier2[family] = sess
                    self._tier2_labels[family] = sorted(
                        all_labels.get(f"hier_{family}", {}),
                        key=lambda k: all_labels[f"hier_{family}"][k]
                    )

        # Flat model fallback
        if ONNX_PATH.exists():
            self._flat = YONOClassifier()

    @property
    def available(self) -> bool:
        return self._tier1 is not None or self._flat is not None

    @property
    def tier2_families(self) -> list:
        return list(self._tier2.keys())

    def predict(self, image_path: str, top_k: int = 5) -> dict:
        tensor = _preprocess(image_path)

        # Tier 1: family
        family = None
        family_confidence = 0.0
        if self._tier1 is not None:
            logits = self._tier1.run(None, {self._tier1_input: tensor})[0]
            probs = _softmax(logits)[0]
            top_idx = int(probs.argmax())
            family = self._family_labels[top_idx]
            family_confidence = float(probs[top_idx])

        # Tier 2: make within family
        if family and family in self._tier2:
            sess = self._tier2[family]
            input_name = sess.get_inputs()[0].name
            logits2 = sess.run(None, {input_name: tensor})[0]
            probs2 = _softmax(logits2)[0]
            labels2 = self._tier2_labels[family]
            top_indices = probs2.argsort()[::-1][:top_k]
            top5 = [[labels2[i], float(probs2[i])] for i in top_indices]
            make, confidence = top5[0]
            return {
                "make": make,
                "confidence": confidence,
                "family": family,
                "family_confidence": family_confidence,
                "top5": top5,
                "source": "hierarchical",
                "is_vehicle": confidence >= 0.20,
            }

        # Tier 2 not available for this family — fall back to flat.
        # Don't propagate family from Tier 1 since without Tier 2 confirmation
        # it can actively mislead callers (Tier 1 at 45% is unreliable for routing).
        if self._flat is not None:
            flat = self._flat.predict(image_path, top_k=top_k)
            return {
                **flat,
                "family": None,
                "family_confidence": None,
                "source": "flat_fallback",
            }

        return {
            "make": None,
            "confidence": 0.0,
            "family": family,
            "family_confidence": family_confidence,
            "top5": [],
            "source": "unavailable",
            "is_vehicle": False,
        }

    def predict_batch(self, image_paths: list, top_k: int = 5) -> list:
        return [self.predict(p, top_k=top_k) for p in image_paths]

    def __repr__(self):
        tier2 = ", ".join(self._tier2.keys()) if self._tier2 else "none"
        return (
            f"HierarchicalYONO("
            f"tier1={'yes' if self._tier1 else 'no'}, "
            f"tier2=[{tier2}], "
            f"flat={'yes' if self._flat else 'no'})"
        )


class ContextualYONOClassifier:
    """
    Contextual vehicle image analysis. Zero API calls.

    Uses Y/M/M knowledge profiles for context-aware predictions.
    Multi-task outputs: zone, condition, damage, modifications, price tier.

    Usage:
        clf = ContextualYONOClassifier()
        result = clf.analyze("photo.jpg", year=1972, make="Chevrolet", model="K10")
        # {
        #   "zone": "ext_front", "zone_confidence": 0.85,
        #   "condition_score": 3, "condition_confidence": 0.72,
        #   "damage_flags": ["rust", "paint_fade"],
        #   "modification_flags": ["lift_kit"],
        #   "price_tier": "mid",
        #   "ymm_context": {...}
        # }
    """

    # Taxonomy constants
    ZONE_CODES = [
        "ext_front", "ext_front_driver", "ext_front_passenger",
        "ext_driver_side", "ext_passenger_side",
        "ext_rear", "ext_rear_driver", "ext_rear_passenger",
        "ext_roof", "ext_undercarriage",
        "panel_hood", "panel_trunk",
        "panel_door_fl", "panel_door_fr", "panel_door_rl", "panel_door_rr",
        "panel_fender_fl", "panel_fender_fr", "panel_fender_rl", "panel_fender_rr",
        "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr",
        "int_dashboard", "int_front_seats", "int_rear_seats", "int_cargo",
        "int_headliner",
        "int_door_panel_fl", "int_door_panel_fr", "int_door_panel_rl", "int_door_panel_rr",
        "mech_engine_bay", "mech_transmission", "mech_suspension",
        "detail_vin", "detail_badge", "detail_damage", "detail_odometer",
        "other",
    ]
    DAMAGE_FLAGS = ["rust", "dent", "crack", "paint_fade", "broken_glass", "missing_parts", "accident_damage"]
    MOD_FLAGS = ["lift_kit", "lowered", "aftermarket_wheels", "roll_cage", "engine_swap", "body_kit", "exhaust_mod", "suspension_mod"]
    PRICE_TIERS = ["elite", "high", "mid", "entry", "budget"]

    def __init__(self, model_path: str = None, ymm_store_path: str = None):
        import onnxruntime as ort

        model_path = model_path or str(MODELS_DIR / "yono_contextual_v3.onnx")
        if not Path(model_path).exists():
            raise FileNotFoundError(
                f"Contextual model not found at {model_path}. "
                "Train with: modal run yono/contextual_training/modal_contextual_train.py --version v3 --action all"
            )

        self._session = ort.InferenceSession(model_path)
        self._make_clf = None  # Lazy-loaded for Y/M/M fallback

        # Load Y/M/M knowledge store (local Parquet or in-memory dict)
        self._ymm_store = {}
        ymm_path = ymm_store_path or str(YONO_DIR / "data" / "ymm_knowledge.parquet")
        if Path(ymm_path).exists():
            self._load_ymm_store(ymm_path)

        # Load config
        config_path = Path(model_path).with_suffix(".onnx").parent / "yono_contextual_v3_config.json"
        self._config = {}
        if config_path.exists():
            self._config = json.loads(config_path.read_text())

    def _load_ymm_store(self, path: str):
        """Load Y/M/M profiles from Parquet into memory."""
        try:
            import pyarrow.parquet as pq
            table = pq.read_table(path)
            for i in range(table.num_rows):
                key = table.column("ymm_key")[i].as_py()
                profile_json = table.column("profile_json")[i].as_py()
                self._ymm_store[key] = json.loads(profile_json)
        except ImportError:
            # Fallback: no pyarrow, try loading from JSON sidecar
            json_path = Path(path).with_suffix(".json")
            if json_path.exists():
                data = json.loads(json_path.read_text())
                for entry in data:
                    self._ymm_store[entry["ymm_key"]] = entry

    def _get_ymm_features(self, year: int, make: str, model: str) -> np.ndarray:
        """Get Y/M/M feature vector. Returns zeros if not found."""
        from yono.contextual_training.featurizers import (
            featurize_ymm_profile, default_ymm_profile, FEATURE_DIM_YMM
        )
        ymm_key = f"{year}_{make}_{model}"
        profile = self._ymm_store.get(ymm_key, default_ymm_profile())
        return featurize_ymm_profile(profile)

    def analyze(
        self,
        image_path: str,
        year: int = None,
        make: str = None,
        model: str = None,
        vehicle_row: dict = None,
        damage_threshold: float = 0.4,
        mod_threshold: float = 0.4,
    ) -> dict:
        """
        Analyze a vehicle image with contextual knowledge.

        Args:
            image_path: Path to image file
            year/make/model: Vehicle identification (optional, uses make classifier if missing)
            vehicle_row: Vehicle metadata dict for instance features
            damage_threshold: Sigmoid threshold for damage flag detection
            mod_threshold: Sigmoid threshold for modification detection

        Returns:
            Dict with zone, condition, damage_flags, modification_flags, price_tier
        """
        from yono.contextual_training.featurizers import (
            featurize_ymm_profile, featurize_vehicle_instance,
            default_ymm_profile, FEATURE_DIM_YMM, FEATURE_DIM_VEHICLE, FEATURE_DIM_TIMELINE
        )

        # 1. Classify make if Y/M/M unknown
        if not (year and make and model):
            if self._make_clf is None:
                self._make_clf = HierarchicalYONO()
            make_result = self._make_clf.predict(image_path)
            make = make_result.get("make", "Unknown")

        # 2. Get Y/M/M features
        ymm_key = f"{year}_{make}_{model}"
        profile = self._ymm_store.get(ymm_key, default_ymm_profile())
        ymm_features = featurize_ymm_profile(profile)

        # 3. Vehicle instance features
        veh_data = vehicle_row or {}
        if year:
            veh_data["_ymm_year"] = year
        vehicle_features = featurize_vehicle_instance(veh_data)

        # 4. Timeline features (zeros for single-image analysis)
        timeline_features = np.zeros(FEATURE_DIM_TIMELINE, dtype=np.float32)

        # 5. Concatenate context
        context = np.concatenate([ymm_features, vehicle_features, timeline_features])
        context = context[np.newaxis]  # (1, 133)

        # 6. Preprocess image
        image_tensor = _preprocess(image_path)

        # 7. Run inference
        outputs = self._session.run(None, {
            "image": image_tensor.astype(np.float32),
            "context": context.astype(np.float32),
        })

        zone_logits, cond_logits, damage_logits, mod_logits, price_logits = outputs

        # 8. Decode outputs
        zone_probs = _softmax(zone_logits)[0]
        zone_idx = int(zone_probs.argmax())
        zone = self.ZONE_CODES[zone_idx]
        zone_conf = float(zone_probs[zone_idx])

        cond_probs = _softmax(cond_logits)[0]
        cond_idx = int(cond_probs.argmax())
        condition_score = cond_idx + 1  # 1-5
        cond_conf = float(cond_probs[cond_idx])

        damage_probs = 1 / (1 + np.exp(-damage_logits[0]))  # sigmoid
        damage_flags = [
            self.DAMAGE_FLAGS[i]
            for i in range(len(self.DAMAGE_FLAGS))
            if damage_probs[i] > damage_threshold
        ]
        damage_detail = {
            self.DAMAGE_FLAGS[i]: float(damage_probs[i])
            for i in range(len(self.DAMAGE_FLAGS))
        }

        mod_probs = 1 / (1 + np.exp(-mod_logits[0]))  # sigmoid
        modification_flags = [
            self.MOD_FLAGS[i]
            for i in range(len(self.MOD_FLAGS))
            if mod_probs[i] > mod_threshold
        ]
        mod_detail = {
            self.MOD_FLAGS[i]: float(mod_probs[i])
            for i in range(len(self.MOD_FLAGS))
        }

        price_probs = _softmax(price_logits)[0]
        price_idx = int(price_probs.argmax())
        price_tier = self.PRICE_TIERS[price_idx]

        return {
            "zone": zone,
            "zone_confidence": zone_conf,
            "zone_top5": [
                (self.ZONE_CODES[i], float(zone_probs[i]))
                for i in zone_probs.argsort()[::-1][:5]
            ],
            "condition_score": condition_score,
            "condition_confidence": cond_conf,
            "damage_flags": damage_flags,
            "damage_detail": damage_detail,
            "modification_flags": modification_flags,
            "mod_detail": mod_detail,
            "price_tier": price_tier,
            "price_confidence": float(price_probs[price_idx]),
            "ymm_key": ymm_key,
            "ymm_context": {
                "vehicle_count": profile.get("vehicle_count", 0),
                "source_comment_count": profile.get("source_comment_count", 0),
                "factory_specs": profile.get("factory_specs", {}),
                "market": profile.get("market", {}),
            },
        }

    def __repr__(self):
        return (
            f"ContextualYONOClassifier("
            f"ymm_store={len(self._ymm_store)} profiles, "
            f"model={'loaded' if self._session else 'missing'})"
        )


def _has_coreml() -> bool:
    try:
        import onnxruntime as ort
        return "CoreMLExecutionProvider" in ort.get_available_providers()
    except Exception:
        return False


# Quick CLI usage
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python yono.py <image_path_or_url>")
        sys.exit(1)

    clf = YONOClassifier()
    print(f"Model: {clf}")

    path = sys.argv[1]
    if path.startswith("http"):
        result = clf.predict_url(path)
    else:
        result = clf.predict(path)

    print(f"\nResult: {result['make']} ({result['confidence']:.0%} confidence)")
    print("Top 5:")
    for make, conf in result["top5"]:
        bar = "█" * int(conf * 30)
        print(f"  {make:20s} {conf:5.1%} {bar}")
