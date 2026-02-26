#!/usr/bin/env python3
"""
Export YONO phase5 model to ONNX for fast inference.

Usage:
  python scripts/export_onnx.py
  python scripts/export_onnx.py --phase phase3_full_20260204_105430
  python scripts/export_onnx.py --verify    # Test ONNX output matches PyTorch
"""

import argparse
import json
import time
from pathlib import Path

import torch
import timm
import numpy as np

YONO_DIR = Path(__file__).parent.parent
OUTPUTS_DIR = YONO_DIR / "outputs"
MODELS_DIR = YONO_DIR / "models"

# Default to latest phase
DEFAULT_PHASE = "phase5_final_20260204_231224"


def find_latest_phase():
    phases = sorted(OUTPUTS_DIR.glob("phase*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for phase in phases:
        if (phase / "best_model.pt").exists():
            return phase.name
    return DEFAULT_PHASE


def load_pytorch_model(phase_name, device="cpu"):
    phase_dir = OUTPUTS_DIR / phase_name
    model_path = phase_dir / "best_model.pt"
    labels_path = phase_dir / "labels.json"

    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if not labels_path.exists():
        raise FileNotFoundError(f"Labels not found: {labels_path}")

    with open(labels_path) as f:
        labels = json.load(f)  # {"0": "Porsche", "1": "BMW", ...}

    num_classes = len(labels)
    model = timm.create_model("efficientnet_b0", pretrained=False, num_classes=num_classes)

    ckpt = torch.load(model_path, map_location=device, weights_only=False)
    state_dict = ckpt["model_state_dict"] if isinstance(ckpt, dict) and "model_state_dict" in ckpt else ckpt
    model.load_state_dict(state_dict)
    model.eval()

    meta = {
        "phase": ckpt.get("phase", phase_name) if isinstance(ckpt, dict) else phase_name,
        "epoch": ckpt.get("epoch", "?") if isinstance(ckpt, dict) else "?",
        "val_acc": ckpt.get("val_acc", 0) if isinstance(ckpt, dict) else 0,
        "num_classes": num_classes,
    }

    return model, labels, meta


def export_onnx(phase_name=None, verify=False):
    MODELS_DIR.mkdir(exist_ok=True)

    if phase_name is None:
        phase_name = find_latest_phase()

    print(f"Exporting: {phase_name}")

    model, labels, meta = load_pytorch_model(phase_name)
    print(f"  Loaded: {meta['num_classes']} classes, epoch {meta['epoch']}, val_acc={meta['val_acc']:.1f}%")

    # Dummy input: batch=1, RGB, 224x224
    dummy = torch.randn(1, 3, 224, 224)

    onnx_path = MODELS_DIR / "yono_make_v1.onnx"
    labels_path = MODELS_DIR / "yono_labels.json"

    # Export
    print(f"  Exporting to ONNX...")
    torch.onnx.export(
        model,
        dummy,
        str(onnx_path),
        export_params=True,
        opset_version=17,
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch_size"}, "logits": {0: "batch_size"}},
    )

    # Save labels alongside
    # Convert to list format for fast index lookup: labels[i] = make_name
    labels_list = [labels[str(i)] for i in range(len(labels))]
    with open(labels_path, "w") as f:
        json.dump({"labels": labels_list, "meta": meta}, f, indent=2)

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"  Saved: {onnx_path} ({size_mb:.1f} MB)")
    print(f"  Labels: {labels_path}")

    if verify:
        print("\nVerifying ONNX output matches PyTorch...")
        try:
            import onnxruntime as ort

            # PyTorch inference
            with torch.no_grad():
                pt_out = torch.softmax(model(dummy), dim=1).numpy()

            # ONNX inference
            sess = ort.InferenceSession(str(onnx_path))
            onnx_out = sess.run(["logits"], {"image": dummy.numpy()})[0]
            onnx_out = np.exp(onnx_out) / np.exp(onnx_out).sum(axis=1, keepdims=True)  # softmax

            max_diff = np.abs(pt_out - onnx_out).max()
            print(f"  Max output diff: {max_diff:.6f} {'✓ OK' if max_diff < 1e-4 else '✗ WARNING'}")

            # Speed test
            times = []
            for _ in range(20):
                t = time.time()
                sess.run(["logits"], {"image": dummy.numpy()})
                times.append((time.time() - t) * 1000)
            print(f"  Inference speed: {sum(times)/len(times):.1f}ms avg ({min(times):.1f}ms best)")

        except ImportError:
            print("  Install onnxruntime to verify: pip install onnxruntime")

    print(f"\nDone. Use with:")
    print(f"  from yono import YONOClassifier")
    print(f"  model = YONOClassifier()")
    print(f"  print(model.predict('photo.jpg'))")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", help="Phase directory name (default: latest)")
    parser.add_argument("--verify", action="store_true", help="Verify ONNX matches PyTorch")
    args = parser.parse_args()

    export_onnx(phase_name=args.phase, verify=args.verify)
