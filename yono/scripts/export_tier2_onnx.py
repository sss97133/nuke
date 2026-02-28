#!/usr/bin/env python3
"""
Export tier-2 hierarchical models from PyTorch (.pt) to ONNX.

Reads from outputs/hierarchical/hier_{family}_best.pt
Writes to models/hier_{family}.onnx
Updates models/hier_labels.json with per-family label mappings.

Usage:
  python scripts/export_tier2_onnx.py
  python scripts/export_tier2_onnx.py --verify
  python scripts/export_tier2_onnx.py --family german
"""

import argparse
import json
import time
from pathlib import Path

import torch
import timm
import numpy as np

YONO_DIR = Path(__file__).parent.parent
OUTPUTS_DIR = YONO_DIR / "outputs" / "hierarchical"
MODELS_DIR = YONO_DIR / "models"

FAMILIES = ["american", "german", "british", "japanese", "italian", "french", "swedish"]


def export_family(family: str, verify: bool = False) -> dict | None:
    """Export a single tier-2 family model to ONNX.

    Returns info dict or None if checkpoint not found.
    """
    pt_path = OUTPUTS_DIR / f"hier_{family}_best.pt"
    if not pt_path.exists():
        print(f"  {family}: checkpoint not found at {pt_path}, skipping")
        return None

    ckpt = torch.load(pt_path, map_location="cpu", weights_only=False)
    label_to_idx = ckpt.get("label_to_idx", {})
    n_classes = ckpt.get("n_classes", len(label_to_idx))
    val_acc = ckpt.get("val_acc", 0)

    if n_classes == 0:
        print(f"  {family}: 0 classes, skipping")
        return None

    # Sort labels by index to get consistent ordering
    labels_sorted = sorted(label_to_idx.keys(), key=lambda k: label_to_idx[k])

    # Build EfficientNet-B0 with correct number of output classes
    model = timm.create_model("efficientnet_b0", pretrained=False, num_classes=n_classes)

    state_dict = ckpt.get("model_state_dict", ckpt)
    model.load_state_dict(state_dict)
    model.eval()

    # Export to ONNX
    onnx_path = MODELS_DIR / f"hier_{family}.onnx"
    dummy = torch.randn(1, 3, 224, 224)

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

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"  {family}: {n_classes} classes, val_acc={val_acc:.1f}%, exported to {onnx_path.name} ({size_mb:.1f} MB)")

    if verify:
        try:
            import onnxruntime as ort

            # PyTorch inference
            with torch.no_grad():
                pt_out = torch.softmax(model(dummy), dim=1).numpy()

            # ONNX inference
            sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
            onnx_out = sess.run(["logits"], {"image": dummy.numpy()})[0]
            onnx_probs = np.exp(onnx_out) / np.exp(onnx_out).sum(axis=1, keepdims=True)

            max_diff = float(np.abs(pt_out - onnx_probs).max())
            status = "OK" if max_diff < 1e-4 else "WARNING"
            print(f"    Verification: max_diff={max_diff:.6f} ({status})")

            # Speed test
            times = []
            for _ in range(20):
                t = time.time()
                sess.run(["logits"], {"image": dummy.numpy()})
                times.append((time.time() - t) * 1000)
            print(f"    Speed: {sum(times)/len(times):.1f}ms avg ({min(times):.1f}ms best)")
        except ImportError:
            print("    Install onnxruntime to verify: pip install onnxruntime")

    return {
        "family": family,
        "n_classes": n_classes,
        "val_acc": val_acc,
        "labels": labels_sorted,
        "label_to_idx": {label: idx for idx, label in enumerate(labels_sorted)},
        "onnx_path": str(onnx_path),
        "size_mb": size_mb,
    }


def update_hier_labels(results: list[dict]):
    """Update models/hier_labels.json with all tier-2 label mappings."""
    labels_path = MODELS_DIR / "hier_labels.json"

    # Load existing labels (includes hier_family from tier-1)
    existing = {}
    if labels_path.exists():
        with open(labels_path) as f:
            existing = json.load(f)

    # Add/update tier-2 entries
    for info in results:
        key = f"hier_{info['family']}"
        existing[key] = info["label_to_idx"]

    with open(labels_path, "w") as f:
        json.dump(existing, f, indent=2)

    print(f"\nUpdated {labels_path}")
    print(f"  Entries: {list(existing.keys())}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true", help="Verify ONNX matches PyTorch")
    parser.add_argument("--family", help="Export only this family (e.g. 'german')")
    args = parser.parse_args()

    MODELS_DIR.mkdir(exist_ok=True)

    families = [args.family] if args.family else FAMILIES

    print(f"Exporting tier-2 models from {OUTPUTS_DIR}")
    print(f"Output directory: {MODELS_DIR}\n")

    results = []
    for family in families:
        info = export_family(family, verify=args.verify)
        if info:
            results.append(info)

    if results:
        update_hier_labels(results)

    print(f"\nExported {len(results)} / {len(families)} families")
    if results:
        print("\nSummary:")
        for r in results:
            print(f"  {r['family']:12s} — {r['n_classes']:3d} classes, val_acc={r['val_acc']:.1f}%, {r['size_mb']:.1f} MB")

    missing = [f for f in families if not any(r["family"] == f for r in results)]
    if missing:
        print(f"\nMissing/skipped: {missing}")

    print("\nNext steps:")
    print("  1. Upload to Modal: bash yono/scripts/upload_tier2_to_modal.sh")
    print("  2. Redeploy:        modal deploy yono/modal_serve.py")


if __name__ == "__main__":
    main()
