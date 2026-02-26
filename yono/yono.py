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


def _preprocess(image_path: str) -> np.ndarray:
    """Load, convert HEIC if needed, resize to 224x224, normalize."""
    path = Path(image_path)

    if path.suffix.lower() == ".heic":
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.close()
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-Z", "512", str(path), "--out", tmp.name],
            capture_output=True, check=True, timeout=30
        )
        path = Path(tmp.name)

    img = Image.open(path).convert("RGB").resize((224, 224), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - _MEAN) / _STD
    return arr.transpose(2, 0, 1)[np.newaxis]  # (1, 3, 224, 224)


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
