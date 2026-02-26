#!/usr/bin/env python3
"""
YONO Hierarchical Classifier Training

Fixes the 23% accuracy problem by decomposing the 276-class make classifier
into a decision tree of focused, high-accuracy models:

  Tier 0: Vehicle vs non-vehicle          (binary, target >95%)
  Tier 1: Make family                     (8 classes, target >85%)
  Tier 2: Specific make within family     (20-40 classes each, target >70%)

This mirrors how production vision systems work at scale. Each tier is a
separate EfficientNet-B0 fine-tuned on a focused sub-problem.

Usage:
  python scripts/train_hierarchical.py --tier 1           # family classifier
  python scripts/train_hierarchical.py --tier 2           # all per-family classifiers
  python scripts/train_hierarchical.py --tier 2 --family american
  python scripts/train_hierarchical.py --all              # train everything
  python scripts/train_hierarchical.py --export           # export all to ONNX
  python scripts/train_hierarchical.py --stats            # show dataset stats

Output:
  yono/models/hier_family.pt + hier_family.onnx
  yono/models/hier_american.pt + hier_american.onnx
  yono/models/hier_german.pt + hier_german.onnx
  ... etc.
  yono/models/hier_labels.json  — unified label map for all tiers
"""

import argparse
import json
import hashlib
import os
import sys
import time
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from PIL import Image
import timm
from tqdm import tqdm
import numpy as np

YONO_DIR = Path(__file__).parent.parent
CACHE_DIR = YONO_DIR / ".image_cache"
DATA_DIR = Path("/Users/skylar/nuke/training-data")
OUTPUT_DIR = YONO_DIR / "models"
CHECKPOINT_DIR = YONO_DIR / "outputs" / "hierarchical"

OUTPUT_DIR.mkdir(exist_ok=True)
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────
# Make Family Taxonomy
# ──────────────────────────────────────────────

MAKE_FAMILIES = {
    "american": [
        "Chevrolet", "Ford", "Dodge", "Plymouth", "Pontiac", "Buick",
        "Cadillac", "Oldsmobile", "Lincoln", "Mercury", "GMC", "Jeep",
        "Chrysler", "AMC", "Hudson", "Studebaker", "Packard", "Willys",
        "DeSoto", "Nash", "Kaiser", "Frazer", "Edsel", "Imperial",
        "International", "Checker", "Shelby", "Saleen", "Pantera",
        "De Tomaso", "Vector", "Mosler", "SSC", "Karma", "Rivian", "Tesla",
        "Lucid", "Fisker", "Delorean", "Excalibur", "Avanti", "Stutz",
    ],
    "german": [
        "BMW", "Mercedes-Benz", "Volkswagen", "Porsche", "Audi",
        "Opel", "Maybach", "Smart", "Borgward",
    ],
    "british": [
        "Jaguar", "MG", "Austin-Healey", "Triumph", "Rolls-Royce", "Bentley",
        "Aston Martin", "Land Rover", "Range Rover", "Morgan", "TVR", "Lotus",
        "Caterham", "Bristol", "Daimler", "Sunbeam", "Riley", "Humber",
        "Singer", "Austin", "Morris", "Rover", "Vauxhall", "Hillman",
        "Wolseley", "Standard", "AC", "Alvis", "Armstrong Siddeley",
        "Jensen", "McLaren", "Noble",
    ],
    "japanese": [
        "Toyota", "Honda", "Mazda", "Nissan", "Datsun", "Subaru",
        "Mitsubishi", "Isuzu", "Suzuki", "Lexus", "Acura", "Infiniti",
        "Scion",
    ],
    "italian": [
        "Ferrari", "Lamborghini", "Alfa Romeo", "Maserati", "Fiat",
        "Lancia", "Autobianchi", "Innocenti", "ISO", "Bizzarrini",
        "De Tomaso", "Ghia", "Bertone", "Pininfarina",
    ],
    "french": [
        "Citroën", "Citroen", "Peugeot", "Renault", "Bugatti", "Talbot",
        "Simca", "Facel Vega",
    ],
    "swedish": [
        "Volvo", "Saab",
    ],
    "other": [],  # catch-all
}

# Build reverse mapping: make → family
MAKE_TO_FAMILY = {}
for family, makes in MAKE_FAMILIES.items():
    for make in makes:
        MAKE_TO_FAMILY[make.lower()] = family

FAMILY_NAMES = list(MAKE_FAMILIES.keys())


def normalize_make(make: str) -> str:
    """Normalize make names: title case, common aliases."""
    if not make:
        return ""
    make = make.strip()
    # Known aliases
    aliases = {
        "bmw": "BMW",
        "mg": "MG",
        "gmc": "GMC",
        "tvr": "TVR",
        "amg": "Mercedes-Benz",
        "mercedes": "Mercedes-Benz",
        "rolls royce": "Rolls-Royce",
        "range rover": "Land Rover",
        "land": "Land Rover",
        "alfa": "Alfa Romeo",
        "vw": "Volkswagen",
        "chevy": "Chevrolet",
        "chev": "Chevrolet",
        "datsun": "Nissan",  # family same
        "scion": "Toyota",   # family same
        "lexus": "Toyota",   # family same (for tier 2 = japanese)
        "acura": "Honda",
        "infiniti": "Nissan",
        "aston": "Aston Martin",
        "austin healey": "Austin-Healey",
        "de tomaso": "De Tomaso",
    }
    lower = make.lower()
    if lower in aliases:
        return aliases[lower]
    return make.title() if not any(c.isupper() for c in make[1:]) else make


def get_family(make: str) -> str:
    """Map a make to its family name."""
    normalized = normalize_make(make)
    return MAKE_TO_FAMILY.get(normalized.lower(), "other")


# ──────────────────────────────────────────────
# Dataset Loading
# ──────────────────────────────────────────────

def load_jsonl_records():
    """Load all records from JSONL batch files. Returns list of dicts."""
    records = []
    batch_dir = DATA_DIR / "images"
    files = sorted(batch_dir.glob("batch_*.jsonl"))
    if not files:
        print(f"No batch files found in {batch_dir}")
        return records
    print(f"Loading {len(files)} JSONL batch files...")
    for f in files:
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except Exception:
                        pass
    print(f"  Loaded {len(records):,} raw records")
    return records


def build_manifest(records, family_filter=None):
    """
    Build (image_path, make, family, model) tuples for records with cached images.

    Args:
        family_filter: if set, only return records for that family
    Returns:
        list of (image_path, make, family) tuples
    """
    manifest = []
    missing = 0
    for rec in records:
        url = rec.get("image_url", "")
        make = normalize_make(rec.get("make", ""))
        if not url or not make:
            continue
        # Compute MD5 cache key
        h = hashlib.md5(url.encode()).hexdigest()
        img_path = CACHE_DIR / f"{h}.jpg"
        if not img_path.exists():
            missing += 1
            continue
        family = get_family(make)
        if family_filter and family != family_filter:
            continue
        manifest.append((str(img_path), make, family))
    if missing > 0:
        print(f"  Skipped {missing:,} records with no cached image")
    return manifest


def dataset_stats(manifest):
    """Print class distribution stats."""
    families = Counter(f for _, _, f in manifest)
    makes = Counter(m for _, m, _ in manifest)
    print(f"\nDataset: {len(manifest):,} images")
    print(f"  Families: {len(families)} | Makes: {len(makes)}")
    print(f"\nFamily distribution:")
    for fam, cnt in sorted(families.items(), key=lambda x: -x[1]):
        print(f"  {fam:12s}: {cnt:6,}")
    print(f"\nTop 20 makes:")
    for make, cnt in makes.most_common(20):
        fam = get_family(make)
        print(f"  {make:25s}: {cnt:6,}  [{fam}]")
    makes_lt50 = sum(1 for c in makes.values() if c < 50)
    print(f"\nMakes with <50 images: {makes_lt50} (will be excluded from tier-2 training)")


# ──────────────────────────────────────────────
# PyTorch Dataset
# ──────────────────────────────────────────────

IMG_MEAN = [0.485, 0.456, 0.406]
IMG_STD = [0.229, 0.224, 0.225]

TRAIN_TRANSFORMS = transforms.Compose([
    transforms.RandomResizedCrop(224, scale=(0.7, 1.0)),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
    transforms.RandomGrayscale(p=0.05),
    transforms.ToTensor(),
    transforms.Normalize(IMG_MEAN, IMG_STD),
])

VAL_TRANSFORMS = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(IMG_MEAN, IMG_STD),
])


class VehicleDataset(Dataset):
    def __init__(self, samples, label_to_idx, transform):
        """
        samples: list of (image_path, label_str)
        label_to_idx: dict mapping label → int
        """
        self.samples = samples
        self.label_to_idx = label_to_idx
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = Image.open(path).convert("RGB")
        except Exception:
            img = Image.new("RGB", (224, 224), (128, 128, 128))
        img = self.transform(img)
        return img, self.label_to_idx[label]


def make_splits(samples, val_frac=0.1, seed=42):
    """Split into train/val with stratification."""
    rng = np.random.default_rng(seed)
    by_class = defaultdict(list)
    for s in samples:
        by_class[s[1]].append(s)
    train, val = [], []
    for cls_samples in by_class.values():
        rng.shuffle(cls_samples)
        n_val = max(1, int(len(cls_samples) * val_frac))
        val.extend(cls_samples[:n_val])
        train.extend(cls_samples[n_val:])
    rng.shuffle(train)
    return train, val


def make_weighted_sampler(samples, label_to_idx):
    """Oversample minority classes to fix class imbalance."""
    labels = [label_to_idx[s[1]] for s in samples]
    class_counts = Counter(labels)
    weights = [1.0 / class_counts[l] for l in labels]
    return WeightedRandomSampler(weights, len(weights), replacement=True)


# ──────────────────────────────────────────────
# Training
# ──────────────────────────────────────────────

def get_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def train_model(
    name: str,
    samples: list,
    label_to_idx: dict,
    epochs: int = 20,
    batch_size: int = 32,
    lr: float = 1e-4,
    min_class_samples: int = 10,
) -> dict:
    """
    Train an EfficientNet-B0 classifier.

    Returns dict with trained model path, val_acc, labels.
    """
    device = get_device()
    idx_to_label = {v: k for k, v in label_to_idx.items()}
    n_classes = len(label_to_idx)
    print(f"\n{'='*60}")
    print(f"Training: {name}")
    print(f"  Classes: {n_classes} | Samples: {len(samples):,} | Device: {device}")
    print(f"  Epochs: {epochs} | Batch: {batch_size} | LR: {lr}")

    train_samples, val_samples = make_splits(samples)
    print(f"  Train: {len(train_samples):,} | Val: {len(val_samples):,}")

    train_ds = VehicleDataset(train_samples, label_to_idx, TRAIN_TRANSFORMS)
    val_ds = VehicleDataset(val_samples, label_to_idx, VAL_TRANSFORMS)

    sampler = make_weighted_sampler(train_samples, label_to_idx)
    train_loader = DataLoader(train_ds, batch_size=batch_size, sampler=sampler,
                              num_workers=4, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False,
                            num_workers=4, pin_memory=True)

    model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=n_classes)
    model = model.to(device)

    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_val_acc = 0.0
    best_ckpt = CHECKPOINT_DIR / f"{name}_best.pt"

    for epoch in range(1, epochs + 1):
        # Train
        model.train()
        train_loss = 0
        train_correct = 0
        train_total = 0
        pbar = tqdm(train_loader, desc=f"Epoch {epoch}/{epochs} [train]", leave=False)
        for imgs, labels in pbar:
            imgs, labels = imgs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
            _, predicted = outputs.max(1)
            train_correct += predicted.eq(labels).sum().item()
            train_total += len(labels)
            pbar.set_postfix(loss=f"{loss.item():.3f}")
        scheduler.step()

        # Validate
        model.eval()
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for imgs, labels in val_loader:
                imgs, labels = imgs.to(device), labels.to(device)
                outputs = model(imgs)
                _, predicted = outputs.max(1)
                val_correct += predicted.eq(labels).sum().item()
                val_total += len(labels)

        train_acc = 100 * train_correct / max(train_total, 1)
        val_acc = 100 * val_correct / max(val_total, 1)
        print(f"  Epoch {epoch:2d}/{epochs}: train_acc={train_acc:.1f}%  val_acc={val_acc:.1f}%  lr={scheduler.get_last_lr()[0]:.2e}")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_acc": val_acc,
                "label_to_idx": label_to_idx,
                "n_classes": n_classes,
                "name": name,
            }, best_ckpt)
            print(f"    ✓ New best: {val_acc:.1f}%")

    print(f"\n  Best val_acc: {best_val_acc:.1f}% → {best_ckpt}")
    return {"name": name, "val_acc": best_val_acc, "checkpoint": str(best_ckpt),
            "n_classes": n_classes, "labels": list(label_to_idx.keys())}


# ──────────────────────────────────────────────
# ONNX Export
# ──────────────────────────────────────────────

def export_to_onnx(checkpoint_path: str, output_path: str):
    """Export a saved checkpoint to ONNX."""
    import onnx

    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    n_classes = ckpt["n_classes"]
    label_to_idx = ckpt["label_to_idx"]

    model = timm.create_model("efficientnet_b0", pretrained=False, num_classes=n_classes)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    dummy = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        model, dummy, output_path,
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
    )
    # Save as single file (no external data)
    m = onnx.load(output_path)
    onnx.save_model(m, output_path, save_as_external_data=False)

    # Verify
    import onnxruntime as ort
    sess = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
    out_ort = sess.run(None, {"image": dummy.numpy()})[0]

    print(f"  ONNX exported: {output_path} ({os.path.getsize(output_path)/1e6:.1f}MB)")
    print(f"  val_acc: {ckpt['val_acc']:.1f}%  classes: {n_classes}")
    return {"onnx_path": output_path, "label_to_idx": label_to_idx, "val_acc": ckpt["val_acc"]}


# ──────────────────────────────────────────────
# Main Training Flows
# ──────────────────────────────────────────────

def train_family_classifier(manifest):
    """Train Tier 1: make family classifier."""
    # samples: (image_path, family)
    samples = [(p, f) for p, m, f in manifest]
    families = sorted(set(f for _, f in samples))
    label_to_idx = {f: i for i, f in enumerate(families)}
    result = train_model(
        "hier_family",
        samples,
        label_to_idx,
        epochs=25,
        batch_size=64,
        lr=5e-5,
    )
    return result


def train_family_make_classifiers(manifest, family_filter=None, min_samples=50):
    """Train Tier 2: per-family make classifiers."""
    results = []
    families = FAMILY_NAMES if not family_filter else [family_filter]

    for family in families:
        # Filter manifest to this family
        family_manifest = [(p, m) for p, m, f in manifest if f == family]
        if not family_manifest:
            print(f"\nSkipping {family}: no samples")
            continue

        # Count makes, filter out rare ones
        make_counts = Counter(m for _, m in family_manifest)
        valid_makes = {m for m, c in make_counts.items() if c >= min_samples}

        if len(valid_makes) < 2:
            print(f"\nSkipping {family}: fewer than 2 makes with ≥{min_samples} samples")
            for m, c in make_counts.most_common():
                print(f"  {m}: {c}")
            continue

        # Filter to valid makes only
        samples = [(p, m) for p, m in family_manifest if m in valid_makes]
        label_to_idx = {m: i for i, m in enumerate(sorted(valid_makes))}

        print(f"\n[{family}] {len(valid_makes)} makes, {len(samples):,} images")
        for m, c in sorted(make_counts.items(), key=lambda x: -x[1]):
            flag = "✓" if m in valid_makes else "✗"
            print(f"  {flag} {m}: {c}")

        result = train_model(
            f"hier_{family}",
            samples,
            label_to_idx,
            epochs=30 if len(samples) < 5000 else 25,
            batch_size=32,
            lr=1e-4,
            min_class_samples=min_samples,
        )
        results.append(result)

    return results


def export_all_models():
    """Export all trained hierarchical models to ONNX."""
    checkpoints = list(CHECKPOINT_DIR.glob("hier_*_best.pt"))
    if not checkpoints:
        print("No hierarchical checkpoints found. Train first.")
        return

    all_labels = {}
    for ckpt_path in sorted(checkpoints):
        name = ckpt_path.stem.replace("_best", "")
        onnx_path = str(OUTPUT_DIR / f"{name}.onnx")
        print(f"\nExporting {name}...")
        result = export_to_onnx(str(ckpt_path), onnx_path)
        all_labels[name] = result["label_to_idx"]

    # Write unified label map
    labels_path = OUTPUT_DIR / "hier_labels.json"
    with open(labels_path, "w") as f:
        json.dump(all_labels, f, indent=2)
    print(f"\nLabel map written: {labels_path}")
    print(f"Exported {len(checkpoints)} models")


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train YONO hierarchical classifiers")
    parser.add_argument("--tier", type=int, choices=[1, 2], help="Tier to train")
    parser.add_argument("--family", type=str, help="Specific family for tier-2 training")
    parser.add_argument("--all", action="store_true", help="Train all tiers")
    parser.add_argument("--export", action="store_true", help="Export checkpoints to ONNX")
    parser.add_argument("--stats", action="store_true", help="Show dataset stats only")
    parser.add_argument("--min-samples", type=int, default=50,
                        help="Min samples per class for tier-2 (default: 50)")
    args = parser.parse_args()

    if not any([args.tier, args.all, args.export, args.stats]):
        parser.print_help()
        return

    # Load data
    records = load_jsonl_records()
    manifest = build_manifest(records)

    if args.stats:
        dataset_stats(manifest)
        return

    if args.export:
        export_all_models()
        return

    results = []

    if args.all or args.tier == 1:
        print("\n[Phase 1] Training family classifier (Tier 1)...")
        r = train_family_classifier(manifest)
        results.append(r)

    if args.all or args.tier == 2:
        print("\n[Phase 2] Training per-family classifiers (Tier 2)...")
        rs = train_family_make_classifiers(manifest, args.family, args.min_samples)
        results.extend(rs)

    # Summary
    print(f"\n{'='*60}")
    print("Training complete:")
    for r in results:
        print(f"  {r['name']:20s}: {r['val_acc']:.1f}% val_acc  ({r['n_classes']} classes)")

    if args.export or args.all:
        print("\nExporting to ONNX...")
        export_all_models()

    # Save results summary
    summary_path = CHECKPOINT_DIR / "training_summary.json"
    with open(summary_path, "w") as f:
        json.dump({"trained_at": datetime.now().isoformat(), "results": results}, f, indent=2)
    print(f"\nSummary saved: {summary_path}")


if __name__ == "__main__":
    main()
