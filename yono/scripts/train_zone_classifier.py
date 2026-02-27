#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Zone Classifier — fine-tune Florence-2-base for vehicle zone classification.

This is the Phase 1 model in VISION_ARCHITECTURE.md. It runs first on every image
to determine WHERE on the vehicle the photo is looking. Zone context then informs
condition/damage assessment (Phase 2).

Architecture:
  Florence-2-base vision encoder → _encode_image() → (batch, 577, 768)
  → mean-pool → LayerNorm(768) → Linear(512) → GELU → Linear(N_ZONES)

Output: vehicle_zone (41 classes from the full taxonomy)

Saves:
  yono/models/yono_zone_classifier.pt  — full PyTorch checkpoint
  yono/models/yono_zone_classifier_labels.json — zone code list
  yono/models/yono_zone_head.safetensors — head weights only (for server)
  yono/models/yono_zone_config.json — config for inference

NOTE: Do not run simultaneously with train_florence2.py — both use MPS.
Wait for condition model (PID 68092) to finish before starting this.

Usage:
    python scripts/train_zone_classifier.py
    python scripts/train_zone_classifier.py --epochs 15
    python scripts/train_zone_classifier.py --dry-run
"""

import argparse
import json
import os
import random
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader
from PIL import Image

YONO_DIR = Path(__file__).parent.parent
NUKE_DIR = YONO_DIR.parent
LABELS_FILE = YONO_DIR / "training_labels" / "labels.jsonl"
OUTPUTS_DIR = YONO_DIR / "outputs" / "zone_classifier"
MODELS_DIR = YONO_DIR / "models"

# ── Zone taxonomy (must match add_zone_labels.py exactly) ─────────────────────
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
N_ZONES = len(ZONE_CODES)
ZONE_TO_IDX = {z: i for i, z in enumerate(ZONE_CODES)}

# ── Training config ────────────────────────────────────────────────────────────
BATCH_SIZE = 4
EPOCHS = 15           # more epochs for harder 41-class task
LR = 2e-5
WEIGHT_DECAY = 0.01
GRAD_CLIP = 1.0
WARMUP_RATIO = 0.1
MIN_LABELS = 500      # need zone labels to train


class ZoneDataset(Dataset):
    """Dataset for zone classification from zone-labeled JSONL."""

    PROMPT = "<DETAILED_CAPTION>"

    def __init__(self, records: list, processor):
        self.records = records
        self.processor = processor

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx: int) -> dict:
        rec = self.records[idx]

        img_path = Path(rec["image_path"])
        try:
            image = Image.open(img_path).convert("RGB")
        except Exception:
            image = Image.new("RGB", (768, 768), color=0)

        inputs = self.processor(
            text=self.PROMPT,
            images=image,
            return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].squeeze(0)

        zone = rec.get("vehicle_zone", "other")
        zone_idx = ZONE_TO_IDX.get(zone, ZONE_TO_IDX["other"])
        zone_label = torch.tensor(zone_idx, dtype=torch.long)

        # Also carry zone_confidence for optional sample weighting
        confidence = float(rec.get("zone_confidence", 0.7))

        return {
            "pixel_values": pixel_values,
            "zone_label": zone_label,
            "zone_confidence": torch.tensor(confidence, dtype=torch.float32),
        }


class ZoneClassifierHead(nn.Module):
    """
    Single-task zone classifier head.
    Input: (batch, 577, 768) from model._encode_image()
    Output: logits over N_ZONES classes
    """

    def __init__(self, hidden_size: int = 768, n_zones: int = N_ZONES, dropout: float = 0.2):
        super().__init__()
        self.hidden_size = hidden_size
        self.n_zones = n_zones

        self.net = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, 512),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(512, 256),
            nn.GELU(),
            nn.Dropout(dropout / 2),
            nn.Linear(256, n_zones),
        )

    def forward(self, image_features: torch.Tensor) -> torch.Tensor:
        # Mean-pool over spatial tokens
        pooled = image_features.mean(dim=1)  # (batch, 768)
        return self.net(pooled)              # (batch, n_zones)


def compute_accuracy(logits: torch.Tensor, labels: torch.Tensor) -> float:
    pred = logits.argmax(dim=-1)
    return (pred == labels).float().mean().item()


def compute_top3_accuracy(logits: torch.Tensor, labels: torch.Tensor) -> float:
    """Top-3 accuracy: correct if true label is in top 3 predictions."""
    top3 = logits.topk(min(3, logits.size(-1)), dim=-1).indices
    correct = (top3 == labels.unsqueeze(1)).any(dim=-1)
    return correct.float().mean().item()


def load_zone_labels(min_confidence: float = 0.5) -> list:
    """
    Load labels that have vehicle_zone.
    Filters by zone_confidence threshold.
    """
    if not LABELS_FILE.exists():
        raise FileNotFoundError(f"Labels not found: {LABELS_FILE}")

    records = []
    skipped_no_zone = 0
    skipped_low_conf = 0
    skipped_missing = 0

    with open(LABELS_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if not rec.get("vehicle_zone"):
                    skipped_no_zone += 1
                    continue
                if rec.get("zone_confidence", 1.0) < min_confidence:
                    skipped_low_conf += 1
                    continue
                if not Path(rec["image_path"]).exists():
                    skipped_missing += 1
                    continue
                records.append(rec)
            except Exception:
                pass

    print(f"Loaded {len(records):,} zone-labeled records")
    print(f"  Skipped (no zone): {skipped_no_zone:,}")
    print(f"  Skipped (low confidence < {min_confidence}): {skipped_low_conf:,}")
    print(f"  Skipped (missing file): {skipped_missing:,}")
    return records


def print_zone_distribution(records: list):
    from collections import Counter
    counts = Counter(r["vehicle_zone"] for r in records)
    print("\nZone distribution in training set:")
    for zone, count in sorted(counts.items(), key=lambda x: -x[1]):
        bar = "█" * min(40, int(count / max(counts.values()) * 40))
        print(f"  {zone:30s} {count:4d} {bar}")


def train(args):
    from transformers import AutoProcessor, AutoModelForCausalLM

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nLoading zone labels...")
    records = load_zone_labels(min_confidence=0.5)

    if len(records) < MIN_LABELS:
        print(f"\nOnly {len(records)} zone labels (need {MIN_LABELS}).")
        print("Run add_zone_labels.py first, or use --force")
        if not args.force:
            sys.exit(1)

    if args.dry_run:
        print_zone_distribution(records)
        print("\nDRY RUN — no training")
        return

    print_zone_distribution(records)

    # Train/val split
    random.seed(42)
    random.shuffle(records)
    n_val = max(100, int(len(records) * 0.1))
    val_records = records[:n_val]
    train_records = records[n_val:]
    print(f"\nTrain: {len(train_records):,}  |  Val: {len(val_records):,}")

    # Load Florence-2
    print("\nLoading microsoft/florence-2-base...")
    t0 = time.time()
    processor = AutoProcessor.from_pretrained("microsoft/florence-2-base", trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        "microsoft/florence-2-base", trust_remote_code=True, torch_dtype=torch.float32
    )
    print(f"Loaded in {time.time()-t0:.1f}s")

    model = model.to(device)
    model.eval()

    # Freeze all backbone
    for p in model.parameters():
        p.requires_grad = False

    # Unfreeze last 2 DaViT block groups (blocks attribute, not stages)
    vision_tower = model.vision_tower
    try:
        blocks = list(vision_tower.blocks)
        for block in blocks[-2:]:
            for p in block.parameters():
                p.requires_grad = True
        print(f"Unfrozen: last 2 of {len(blocks)} DaViT block groups")
    except Exception as e:
        print(f"Could not unfreeze DaViT blocks: {e}")

    # Also unfreeze image projection
    for name, p in model.named_parameters():
        if "image_proj" in name or "image_pos_embed" in name:
            p.requires_grad = True

    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Trainable backbone params: {n_trainable/1e6:.1f}M")

    # Build zone head
    head = ZoneClassifierHead(hidden_size=768, n_zones=N_ZONES).to(device)
    print(f"Zone head params: {sum(p.numel() for p in head.parameters())/1e6:.3f}M")

    # Compute class weights to handle imbalanced zone distribution
    from collections import Counter
    zone_counts = Counter(r["vehicle_zone"] for r in train_records)
    weights = []
    total = len(train_records)
    for zone in ZONE_CODES:
        count = zone_counts.get(zone, 1)
        # Inverse frequency weighting, capped at 10x
        weights.append(min(10.0, total / (N_ZONES * count)))
    class_weights = torch.tensor(weights, dtype=torch.float32).to(device)
    print(f"Class weights: min={class_weights.min():.2f} max={class_weights.max():.2f}")

    # Loss with class weighting
    criterion = nn.CrossEntropyLoss(weight=class_weights)

    backbone_params = [p for p in model.parameters() if p.requires_grad]
    head_params = list(head.parameters())
    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": LR * 0.1},
        {"params": head_params, "lr": LR},
    ], weight_decay=WEIGHT_DECAY)

    total_steps = (len(train_records) // BATCH_SIZE + 1) * args.epochs
    warmup_steps = int(total_steps * WARMUP_RATIO)

    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return max(0.05, 0.5 * (1.0 + np.cos(np.pi * progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    train_ds = ZoneDataset(train_records, processor)
    val_ds = ZoneDataset(val_records, processor)
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    print(f"\nTraining {args.epochs} epochs, {len(train_loader)} steps/epoch")

    best_val_acc = 0.0
    global_step = 0
    start_epoch = 1

    # Resume from checkpoint if requested
    if args.resume:
        resume_path = Path(args.resume)
        if not resume_path.exists():
            # Try resolving relative to OUTPUTS_DIR
            resume_path = OUTPUTS_DIR / args.resume
        if not resume_path.exists():
            print(f"ERROR: checkpoint not found: {args.resume}")
            sys.exit(1)
        print(f"\nResuming from: {resume_path}")
        ckpt = torch.load(resume_path, map_location=device, weights_only=False)
        head.load_state_dict(ckpt["head_state_dict"])
        optimizer.load_state_dict(ckpt["optimizer_state_dict"])
        start_epoch = ckpt["epoch"] + 1
        best_val_acc = ckpt.get("val_acc", 0.0)
        # Advance scheduler to match where we left off
        steps_done = (start_epoch - 1) * len(train_loader)
        for _ in range(steps_done):
            scheduler.step()
        global_step = steps_done
        print(f"Resumed at epoch {start_epoch}, best_val_acc={best_val_acc:.1%}, global_step={global_step}")

    for epoch in range(start_epoch, args.epochs + 1):
        model.train()
        head.train()
        epoch_losses = []
        epoch_accs = []
        t_epoch = time.time()

        for step, batch in enumerate(train_loader):
            optimizer.zero_grad()
            pixel_values = batch["pixel_values"].to(device)

            image_features = model._encode_image(pixel_values)
            logits = head(image_features)
            labels = batch["zone_label"].to(device)

            loss = criterion(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(backbone_params + head_params, GRAD_CLIP)
            optimizer.step()
            scheduler.step()
            global_step += 1

            epoch_losses.append(loss.item())

            if step % 20 == 0:
                with torch.no_grad():
                    acc = compute_accuracy(logits, labels)
                    top3 = compute_top3_accuracy(logits, labels)
                epoch_accs.append(acc)
                lr = scheduler.get_last_lr()[-1]
                print(
                    f"  E{epoch:02d} [{step:4d}/{len(train_loader)}] "
                    f"loss={loss.item():.4f} acc={acc:.1%} top3={top3:.1%} lr={lr:.1e}"
                )

        # Validation
        model.eval()
        head.eval()
        val_losses, val_accs, val_top3s = [], [], []
        with torch.no_grad():
            for batch in val_loader:
                pixel_values = batch["pixel_values"].to(device)
                features = model._encode_image(pixel_values)
                logits = head(features)
                labels = batch["zone_label"].to(device)
                val_losses.append(criterion(logits, labels).item())
                val_accs.append(compute_accuracy(logits, labels))
                val_top3s.append(compute_top3_accuracy(logits, labels))

        avg_train_loss = np.mean(epoch_losses) if epoch_losses else 0
        avg_val_loss = np.mean(val_losses) if val_losses else 0
        avg_val_acc = np.mean(val_accs) if val_accs else 0
        avg_val_top3 = np.mean(val_top3s) if val_top3s else 0
        elapsed = time.time() - t_epoch

        print(f"\nEpoch {epoch:02d} ({elapsed:.0f}s)")
        print(f"  train_loss={avg_train_loss:.4f} | val_loss={avg_val_loss:.4f}")
        print(f"  val_acc={avg_val_acc:.1%} | val_top3_acc={avg_val_top3:.1%}")

        # Save checkpoint
        ckpt = {
            "epoch": epoch,
            "head_state_dict": head.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "val_acc": avg_val_acc,
            "val_top3_acc": avg_val_top3,
            "zone_codes": ZONE_CODES,
        }
        ckpt_path = OUTPUTS_DIR / f"checkpoint_epoch{epoch:02d}.pt"
        torch.save(ckpt, ckpt_path)

        if avg_val_acc > best_val_acc:
            best_val_acc = avg_val_acc
            shutil.copy2(ckpt_path, OUTPUTS_DIR / "checkpoint_best.pt")
            print(f"  New best! val_acc={best_val_acc:.1%}")

    # Save final model files
    print("\nSaving final zone classifier...")
    from safetensors.torch import save_file as safetensors_save

    # Full checkpoint with zone codes
    torch.save({
        "head_state_dict": head.state_dict(),
        "zone_codes": ZONE_CODES,
        "n_zones": N_ZONES,
        "hidden_size": 768,
        "best_val_acc": best_val_acc,
    }, MODELS_DIR / "yono_zone_classifier.pt")

    # Safetensors head weights
    safetensors_save(head.state_dict(), MODELS_DIR / "yono_zone_head.safetensors")

    # Labels file
    with open(MODELS_DIR / "yono_zone_classifier_labels.json", "w") as f:
        json.dump({"zone_codes": ZONE_CODES, "n_zones": N_ZONES}, f, indent=2)

    # Config for server.py
    config = {
        "model_base": "microsoft/florence-2-base",
        "hidden_size": 768,
        "n_zones": N_ZONES,
        "zone_codes": ZONE_CODES,
        "best_val_acc": best_val_acc,
        "version": "v1",
    }
    with open(MODELS_DIR / "yono_zone_config.json", "w") as f:
        json.dump(config, f, indent=2)

    print(f"Saved: yono_zone_classifier.pt")
    print(f"Saved: yono_zone_head.safetensors")
    print(f"Saved: yono_zone_classifier_labels.json")
    print(f"Saved: yono_zone_config.json")
    print(f"\nBest val_acc: {best_val_acc:.1%}")
    print("Restart server.py to load the zone classifier.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Florence-2 zone classifier")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--lr", type=float, default=LR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--resume", type=str, default=None,
                        help="Path to checkpoint .pt file to resume from (e.g. checkpoint_epoch10.pt)")
    args = parser.parse_args()

    BATCH_SIZE = args.batch_size
    LR = args.lr

    train(args)
