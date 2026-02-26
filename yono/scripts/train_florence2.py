#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Phase 2: Fine-tune Florence-2-base for vehicle condition assessment.

Florence-2-base architecture:
- DaViT vision encoder (DaViT-Base, 87M params)
- _encode_image() → (batch, 577, 768) features
- Fine-tunes final DaViT blocks + custom classification head

Outputs:
  - condition_score (1-5)
  - damage_flags (7-label multi-label)
  - modification_flags (8-label multi-label)
  - photo_quality (1-5)
  - interior_quality (1-5 or null)
  - photo_type (9-class)

Uses MPS device (M4 Max) for fast local training.

Saves checkpoints to yono/outputs/florence2/
Saves final head to yono/models/yono_vision_v2_head.safetensors
Saves config to yono/models/yono_vision_v2_config.json

Usage:
    python scripts/train_florence2.py                    # full training
    python scripts/train_florence2.py --epochs 5         # custom epochs
    python scripts/train_florence2.py --dry-run          # validate data loading only
"""

import argparse
import json
import os
import sys
import time
import random
import shutil
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader
from PIL import Image

# === Paths ===
YONO_DIR = Path(__file__).parent.parent
NUKE_DIR = YONO_DIR.parent
LABELS_FILE = YONO_DIR / "training_labels" / "labels.jsonl"
OUTPUTS_DIR = YONO_DIR / "outputs" / "florence2"
MODELS_DIR = YONO_DIR / "models"

# === Label schema ===
DAMAGE_FLAGS = ["rust", "dent", "crack", "paint_fade", "broken_glass", "missing_parts", "accident_damage"]
MOD_FLAGS = ["lift_kit", "lowered", "aftermarket_wheels", "roll_cage", "engine_swap", "body_kit", "exhaust_mod", "suspension_mod"]
PHOTO_TYPES = ["exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "wheel", "detail", "undercarriage", "other"]

N_DAMAGE = len(DAMAGE_FLAGS)
N_MODS = len(MOD_FLAGS)
N_PHOTO_TYPES = len(PHOTO_TYPES)

# === Florence-2 specifics (verified via forward pass) ===
FLORENCE2_HIDDEN_SIZE = 768   # _encode_image() output dim: (batch, 577, 768)
FLORENCE2_IMAGE_SIZE = 768    # Florence-2 default input resolution (768x768)

# === Training config ===
BATCH_SIZE = 4         # conservative for MPS memory with 768x768 inputs
EPOCHS = 10
LR = 1e-5
WEIGHT_DECAY = 0.01
GRAD_CLIP = 1.0
WARMUP_RATIO = 0.1
MIN_LABELS = 200       # minimum labels to start training


class VehicleVisionDataset(Dataset):
    """Dataset for vehicle condition labels from labels.jsonl."""

    PROMPT = "<DETAILED_CAPTION>"  # Florence-2 task prompt for image conditioning

    def __init__(self, records: list, processor, augment: bool = False):
        self.records = records
        self.processor = processor
        self.augment = augment

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx: int) -> dict:
        rec = self.records[idx]

        # Load image
        img_path = Path(rec["image_path"])
        try:
            image = Image.open(img_path).convert("RGB")
            # Florence-2 processor handles resize internally
        except Exception:
            image = Image.new("RGB", (FLORENCE2_IMAGE_SIZE, FLORENCE2_IMAGE_SIZE), color=0)

        # Process with Florence-2 processor
        # Florence-2 requires both text and image inputs
        inputs = self.processor(
            text=self.PROMPT,
            images=image,
            return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].squeeze(0)  # (3, 768, 768)

        # Build label tensors
        condition_score = torch.tensor(rec["condition_score"] - 1, dtype=torch.long)  # 0-4
        photo_quality = torch.tensor(rec["photo_quality"] - 1, dtype=torch.long)      # 0-4

        # Interior quality: null maps to -1 (masked out in loss)
        iq = rec.get("interior_quality")
        interior_quality = torch.tensor(iq - 1 if iq is not None else -1, dtype=torch.long)

        # Damage flags: multi-hot
        damage = torch.zeros(N_DAMAGE, dtype=torch.float32)
        for flag in rec.get("damage_flags", []):
            if flag in DAMAGE_FLAGS:
                damage[DAMAGE_FLAGS.index(flag)] = 1.0

        # Modification flags: multi-hot
        mods = torch.zeros(N_MODS, dtype=torch.float32)
        for flag in rec.get("modification_flags", []):
            if flag in MOD_FLAGS:
                mods[MOD_FLAGS.index(flag)] = 1.0

        # Photo type: single class
        pt = rec.get("photo_type", "other")
        photo_type = torch.tensor(
            PHOTO_TYPES.index(pt) if pt in PHOTO_TYPES else PHOTO_TYPES.index("other"),
            dtype=torch.long
        )

        return {
            "pixel_values": pixel_values,
            "condition_score": condition_score,
            "photo_quality": photo_quality,
            "interior_quality": interior_quality,
            "damage_flags": damage,
            "mod_flags": mods,
            "photo_type": photo_type,
        }


class VehicleVisionHead(nn.Module):
    """
    Multi-task classification head on top of Florence-2 image features.

    Input: (batch, seq_len=577, hidden_size=768) from model._encode_image()
    Uses mean-pooling over spatial tokens for global representation.

    Outputs all 6 predictions in a single forward pass.
    """

    def __init__(
        self,
        hidden_size: int = FLORENCE2_HIDDEN_SIZE,
        n_damage: int = N_DAMAGE,
        n_mods: int = N_MODS,
        n_photo_types: int = N_PHOTO_TYPES,
    ):
        super().__init__()
        self.hidden_size = hidden_size

        # Shared bottleneck: 768 → 512 with GELU
        self.bottleneck = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, 512),
            nn.GELU(),
            nn.Dropout(0.2),
        )

        # Task-specific heads
        self.condition_head = nn.Linear(512, 5)
        self.photo_quality_head = nn.Linear(512, 5)
        self.interior_quality_head = nn.Linear(512, 5)
        self.damage_head = nn.Linear(512, n_damage)
        self.mod_head = nn.Linear(512, n_mods)
        self.photo_type_head = nn.Linear(512, n_photo_types)

    def forward(self, image_features: torch.Tensor) -> dict:
        # image_features: (batch, seq_len, hidden_size)
        # Mean-pool over spatial tokens (all 577 tokens)
        pooled = image_features.mean(dim=1)  # (batch, hidden_size)
        x = self.bottleneck(pooled)

        return {
            "condition_score": self.condition_head(x),
            "photo_quality": self.photo_quality_head(x),
            "interior_quality": self.interior_quality_head(x),
            "damage_flags": self.damage_head(x),
            "mod_flags": self.mod_head(x),
            "photo_type": self.photo_type_head(x),
        }


def compute_loss(preds: dict, batch: dict, device: torch.device) -> dict:
    """Compute multi-task losses."""
    ce = nn.CrossEntropyLoss()
    bce = nn.BCEWithLogitsLoss()

    losses = {}

    losses["condition"] = ce(preds["condition_score"], batch["condition_score"].to(device))
    losses["photo_quality"] = ce(preds["photo_quality"], batch["photo_quality"].to(device))

    # Interior quality — only where visible (iq >= 0)
    iq_labels = batch["interior_quality"].to(device)
    iq_mask = iq_labels >= 0
    if iq_mask.any():
        losses["interior_quality"] = ce(preds["interior_quality"][iq_mask], iq_labels[iq_mask])
    else:
        losses["interior_quality"] = torch.tensor(0.0, device=device)

    losses["damage"] = bce(preds["damage_flags"], batch["damage_flags"].to(device))
    losses["mods"] = bce(preds["mod_flags"], batch["mod_flags"].to(device))
    losses["photo_type"] = ce(preds["photo_type"], batch["photo_type"].to(device))

    # Weighted total: condition + photo_quality are highest priority
    total = (
        1.5 * losses["condition"] +
        1.2 * losses["photo_quality"] +
        0.4 * losses["interior_quality"] +
        1.0 * losses["damage"] +
        0.8 * losses["mods"] +
        0.6 * losses["photo_type"]
    )
    losses["total"] = total
    return losses


def compute_metrics(preds: dict, batch: dict, device: torch.device) -> dict:
    """Compute accuracy metrics for monitoring."""
    metrics = {}

    pred_cond = preds["condition_score"].argmax(dim=-1)
    true_cond = batch["condition_score"].to(device)
    metrics["condition_acc"] = (pred_cond == true_cond).float().mean().item()

    pred_pq = preds["photo_quality"].argmax(dim=-1)
    true_pq = batch["photo_quality"].to(device)
    metrics["photo_quality_acc"] = (pred_pq == true_pq).float().mean().item()

    # Damage F1
    pred_dmg = (preds["damage_flags"].sigmoid() > 0.5).float()
    true_dmg = batch["damage_flags"].to(device)
    tp = (pred_dmg * true_dmg).sum()
    fp = (pred_dmg * (1 - true_dmg)).sum()
    fn = ((1 - pred_dmg) * true_dmg).sum()
    prec = tp / (tp + fp + 1e-8)
    rec = tp / (tp + fn + 1e-8)
    metrics["damage_f1"] = (2 * prec * rec / (prec + rec + 1e-8)).item()

    return metrics


def load_labels(min_photo_quality: int = 2) -> list:
    """Load and filter training labels."""
    if not LABELS_FILE.exists():
        raise FileNotFoundError(
            f"Labels file not found: {LABELS_FILE}\n"
            "Run: python scripts/auto_label_images.py"
        )

    records = []
    skipped_quality = 0
    skipped_missing = 0

    with open(LABELS_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if rec.get("photo_quality", 0) < min_photo_quality:
                    skipped_quality += 1
                    continue
                if not Path(rec["image_path"]).exists():
                    skipped_missing += 1
                    continue
                records.append(rec)
            except Exception:
                pass

    print(f"Loaded {len(records):,} label records")
    print(f"  Skipped low-quality (photo_quality < {min_photo_quality}): {skipped_quality:,}")
    print(f"  Skipped missing files: {skipped_missing:,}")
    return records


def train(args):
    from transformers import AutoProcessor, AutoModelForCausalLM

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Load labels
    print(f"\nLoading labels from {LABELS_FILE}...")
    records = load_labels(min_photo_quality=2)

    if len(records) < MIN_LABELS:
        print(f"\nWARNING: Only {len(records)} labels (need {MIN_LABELS} minimum).")
        if not args.force:
            print("Run auto_label_images.py to generate more labels, or use --force")
            sys.exit(1)

    # Train/val split (90/10, min 50 val)
    random.seed(42)
    random.shuffle(records)
    n_val = max(50, int(len(records) * 0.1))
    val_records = records[:n_val]
    train_records = records[n_val:]
    print(f"Train: {len(train_records):,}  |  Val: {len(val_records):,}")

    # Load Florence-2
    print("\nLoading microsoft/florence-2-base...")
    t0 = time.time()
    processor = AutoProcessor.from_pretrained(
        "microsoft/florence-2-base",
        trust_remote_code=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        "microsoft/florence-2-base",
        trust_remote_code=True,
        torch_dtype=torch.float32,
    )
    print(f"Loaded in {time.time()-t0:.1f}s")
    print(f"Total params: {sum(p.numel() for p in model.parameters())/1e6:.1f}M")

    if args.dry_run:
        print("\nDRY RUN — validating data pipeline...")
        ds = VehicleVisionDataset(train_records[:8], processor)
        for i in range(min(3, len(ds))):
            item = ds[i]
            pv = item["pixel_values"]
            print(f"  Item {i}: pixels={pv.shape}, cond={item['condition_score'].item()+1}, pq={item['photo_quality'].item()+1}")
        print("Data pipeline OK")
        return

    # Move to device
    model = model.to(device)
    model.eval()  # Freeze BN etc.

    # Freeze all Florence-2 params — we only fine-tune our head + last few DaViT blocks
    for param in model.parameters():
        param.requires_grad = False

    # Unfreeze last 2 DaViT block groups (the deeper spatial features)
    # DaViT children: convs, blocks, avgpool
    vision_tower = model.vision_tower
    try:
        blocks = list(vision_tower.blocks)
        n_blocks = len(blocks)
        # Unfreeze the last 2 block groups
        for block in blocks[-2:]:
            for param in block.parameters():
                param.requires_grad = True
        print(f"Unfrozen: last 2 of {n_blocks} DaViT block groups")
    except Exception as e:
        print(f"Could not unfreeze DaViT blocks: {e} — head-only training")

    # Also unfreeze image projection layers (they adapt vision features to language space)
    for name, param in model.named_parameters():
        if "image_proj" in name or "image_pos_embed" in name:
            param.requires_grad = True

    # Count trainable
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_total = sum(p.numel() for p in model.parameters())
    print(f"Trainable params: {n_trainable/1e6:.1f}M / {n_total/1e6:.1f}M total")

    # Build classification head
    head = VehicleVisionHead(
        hidden_size=FLORENCE2_HIDDEN_SIZE,
        n_damage=N_DAMAGE,
        n_mods=N_MODS,
        n_photo_types=N_PHOTO_TYPES,
    ).to(device)
    print(f"Head params: {sum(p.numel() for p in head.parameters())/1e6:.2f}M")

    # Optimizer: lower LR for Florence-2 body, higher for head
    backbone_params = [p for p in model.parameters() if p.requires_grad]
    head_params = list(head.parameters())

    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": LR * 0.1},   # gentle fine-tune
        {"params": head_params, "lr": LR},              # head trains faster
    ], weight_decay=WEIGHT_DECAY)

    # Cosine LR schedule with warmup
    total_steps = (len(train_records) // BATCH_SIZE + 1) * args.epochs
    warmup_steps = int(total_steps * WARMUP_RATIO)

    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return max(0.05, 0.5 * (1.0 + np.cos(np.pi * progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # Datasets & loaders
    train_ds = VehicleVisionDataset(train_records, processor, augment=True)
    val_ds = VehicleVisionDataset(val_records, processor, augment=False)

    train_loader = DataLoader(
        train_ds, batch_size=BATCH_SIZE, shuffle=True,
        num_workers=0,  # 0 = main process (avoids fork issues with MPS + HF tokenizers)
        pin_memory=False,
    )
    val_loader = DataLoader(
        val_ds, batch_size=BATCH_SIZE, shuffle=False,
        num_workers=0,
        pin_memory=False,
    )

    print(f"\nStarting training: {args.epochs} epochs")
    print(f"Steps: {total_steps} total, {warmup_steps} warmup")
    print(f"Batch size: {BATCH_SIZE}, LR: {LR}")

    best_val_loss = float("inf")
    global_step = 0

    for epoch in range(1, args.epochs + 1):
        model.train()
        head.train()
        epoch_losses = []
        epoch_metrics = []
        t_epoch = time.time()

        for step, batch in enumerate(train_loader):
            optimizer.zero_grad()

            pixel_values = batch["pixel_values"].to(device)

            # Extract image features using Florence-2's internal method
            # _encode_image → (batch, 577, 768) spatial tokens
            with torch.set_grad_enabled(True):
                image_features = model._encode_image(pixel_values)

            preds = head(image_features)
            losses = compute_loss(preds, batch, device)

            losses["total"].backward()
            torch.nn.utils.clip_grad_norm_(
                backbone_params + head_params, GRAD_CLIP
            )
            optimizer.step()
            scheduler.step()
            global_step += 1

            epoch_losses.append(losses["total"].item())

            if step % 20 == 0:
                with torch.no_grad():
                    metrics = compute_metrics(preds, batch, device)
                epoch_metrics.append(metrics)
                lr = scheduler.get_last_lr()[-1]
                print(
                    f"  E{epoch:02d} [{step:4d}/{len(train_loader)}] "
                    f"loss={losses['total'].item():.4f} "
                    f"cond={losses['condition'].item():.3f} "
                    f"dmg={losses['damage'].item():.3f} "
                    f"cond_acc={metrics['condition_acc']:.1%} "
                    f"lr={lr:.1e}"
                )

        # Validation
        model.eval()
        head.eval()
        val_losses = []
        val_metrics_all = []

        with torch.no_grad():
            for batch in val_loader:
                pixel_values = batch["pixel_values"].to(device)
                image_features = model._encode_image(pixel_values)
                preds = head(image_features)
                losses = compute_loss(preds, batch, device)
                metrics = compute_metrics(preds, batch, device)
                val_losses.append(losses["total"].item())
                val_metrics_all.append(metrics)

        avg_train_loss = np.mean(epoch_losses) if epoch_losses else 0
        avg_val_loss = np.mean(val_losses) if val_losses else 0
        avg_val_cond_acc = np.mean([m["condition_acc"] for m in val_metrics_all]) if val_metrics_all else 0
        avg_val_dmg_f1 = np.mean([m["damage_f1"] for m in val_metrics_all]) if val_metrics_all else 0

        elapsed = time.time() - t_epoch
        print(f"\nEpoch {epoch:02d} ({elapsed:.0f}s)")
        print(f"  train_loss={avg_train_loss:.4f} | val_loss={avg_val_loss:.4f}")
        print(f"  val_condition_acc={avg_val_cond_acc:.1%} | val_damage_f1={avg_val_dmg_f1:.1%}")

        # Save checkpoint
        ckpt_path = OUTPUTS_DIR / f"checkpoint_epoch{epoch:02d}.pt"
        torch.save({
            "epoch": epoch,
            "global_step": global_step,
            "head_state_dict": head.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "val_loss": avg_val_loss,
            "val_condition_acc": avg_val_cond_acc,
            "val_damage_f1": avg_val_dmg_f1,
        }, ckpt_path)

        # Track best
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            shutil.copy2(ckpt_path, OUTPUTS_DIR / "checkpoint_best.pt")
            print(f"  New best! val_loss={best_val_loss:.4f}")

    # Save final model files
    print("\nSaving final model...")
    from safetensors.torch import save_file as safetensors_save

    head_path = MODELS_DIR / "yono_vision_v2_head.safetensors"
    config_path = MODELS_DIR / "yono_vision_v2_config.json"

    safetensors_save(head.state_dict(), head_path)

    config = {
        "model_base": "microsoft/florence-2-base",
        "hidden_size": FLORENCE2_HIDDEN_SIZE,
        "image_size": FLORENCE2_IMAGE_SIZE,
        "n_damage": N_DAMAGE,
        "n_mods": N_MODS,
        "n_photo_types": N_PHOTO_TYPES,
        "damage_flags": DAMAGE_FLAGS,
        "mod_flags": MOD_FLAGS,
        "photo_types": PHOTO_TYPES,
        "best_val_loss": best_val_loss,
        "version": "v2",
    }
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    print(f"Saved head: {head_path}")
    print(f"Saved config: {config_path}")
    print(f"\nDone. Best val_loss: {best_val_loss:.4f}")
    print("Restart server.py to load the fine-tuned model automatically.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--lr", type=float, default=LR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Train even with < MIN_LABELS")
    args = parser.parse_args()

    BATCH_SIZE = args.batch_size
    LR = args.lr

    train(args)
