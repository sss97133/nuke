#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Stage Classifier — fine-tune Florence-2-base for fabrication stage classification.

Classifies vehicle photos into one of 10 fabrication stages:
  raw → disassembled → stripped → fabricated → primed → blocked → basecoated → clearcoated → assembled → complete

Architecture:
  Florence-2-base vision encoder → _encode_image() → (batch, 577, 768)
  → mean-pool → LayerNorm(768) → Linear(512) → GELU → Linear(10)

Saves:
  yono/models/yono_stage_classifier.pt       — full PyTorch checkpoint
  yono/models/yono_stage_head.safetensors    — head weights only (for server)
  yono/models/yono_stage_config.json         — config for inference
  yono/models/yono_stage_labels.json         — stage code list

Usage:
    python scripts/train_stage_classifier.py
    python scripts/train_stage_classifier.py --epochs 20
    python scripts/train_stage_classifier.py --dry-run
    python scripts/train_stage_classifier.py --resume checkpoint_epoch10.pt
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
LABELS_FILE = YONO_DIR / "training_labels" / "stage_labels.jsonl"
OUTPUTS_DIR = YONO_DIR / "outputs" / "stage_classifier"
MODELS_DIR = YONO_DIR / "models"

# ── Stage taxonomy ────────────────────────────────────────────────────────────
STAGE_CODES = [
    "raw",           # 0
    "disassembled",  # 1
    "stripped",      # 2
    "fabricated",    # 3
    "primed",        # 4
    "blocked",       # 5
    "basecoated",    # 6
    "clearcoated",   # 7
    "assembled",     # 8
    "complete",      # 9
]
N_STAGES = len(STAGE_CODES)
STAGE_TO_IDX = {s: i for i, s in enumerate(STAGE_CODES)}

# ── Training config ────────────────────────────────────────────────────────────
BATCH_SIZE = 4
EPOCHS = 20
LR = 2e-5
WEIGHT_DECAY = 0.01
GRAD_CLIP = 1.0
WARMUP_RATIO = 0.1
MIN_LABELS = 200  # minimum to start training


class StageDataset(Dataset):
    """Dataset for fabrication stage classification from stage-labeled JSONL."""

    PROMPT = "<DETAILED_CAPTION>"

    def __init__(self, records: list, processor):
        self.records = records
        self.processor = processor

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx: int) -> dict:
        rec = self.records[idx]

        # Support both URL-based (image_url) and path-based (image_path) records
        img_source = rec.get("image_path") or rec.get("image_url", "")

        try:
            if img_source.startswith("http"):
                # Download from URL, cache locally for reuse across epochs
                import hashlib
                import urllib.request
                cache_dir = YONO_DIR / ".image_cache"
                cache_dir.mkdir(exist_ok=True)
                url_hash = hashlib.md5(img_source.encode()).hexdigest()
                ext = Path(img_source.split("?")[0]).suffix or ".jpg"
                cached_path = cache_dir / f"{url_hash}{ext}"
                if not cached_path.exists():
                    urllib.request.urlretrieve(img_source, str(cached_path))
                image = Image.open(cached_path).convert("RGB")
            else:
                image = Image.open(img_source).convert("RGB")
        except Exception:
            image = Image.new("RGB", (768, 768), color=0)

        inputs = self.processor(
            text=self.PROMPT,
            images=image,
            return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].squeeze(0)

        stage = rec.get("fabrication_stage", "raw")
        stage_idx = STAGE_TO_IDX.get(stage, 0)
        stage_label = torch.tensor(stage_idx, dtype=torch.long)

        confidence = float(rec.get("stage_confidence", 0.7))

        return {
            "pixel_values": pixel_values,
            "stage_label": stage_label,
            "stage_confidence": torch.tensor(confidence, dtype=torch.float32),
        }


class StageClassifierHead(nn.Module):
    """
    Fabrication stage classifier head.
    Input: (batch, 577, 768) from model._encode_image()
    Output: logits over N_STAGES classes
    """

    def __init__(self, hidden_size: int = 768, n_stages: int = N_STAGES, dropout: float = 0.2):
        super().__init__()
        self.hidden_size = hidden_size
        self.n_stages = n_stages

        self.net = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, 512),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(512, n_stages),
        )

    def forward(self, image_features: torch.Tensor) -> torch.Tensor:
        pooled = image_features.mean(dim=1)  # (batch, 768)
        return self.net(pooled)              # (batch, n_stages)


def compute_accuracy(logits: torch.Tensor, labels: torch.Tensor) -> float:
    pred = logits.argmax(dim=-1)
    return (pred == labels).float().mean().item()


def compute_top3_accuracy(logits: torch.Tensor, labels: torch.Tensor) -> float:
    top3 = logits.topk(min(3, logits.size(-1)), dim=-1).indices
    correct = (top3 == labels.unsqueeze(1)).any(dim=-1)
    return correct.float().mean().item()


def load_stage_labels(min_confidence: float = 0.4) -> list:
    """
    Load labels from stage_labels.jsonl.
    Filters by stage_confidence threshold.
    """
    if not LABELS_FILE.exists():
        raise FileNotFoundError(f"Stage labels not found: {LABELS_FILE}\nRun auto_label_stages.py first.")

    records = []
    skipped_low_conf = 0
    skipped_invalid = 0

    with open(LABELS_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                stage = rec.get("fabrication_stage", "")
                if stage not in STAGE_CODES:
                    skipped_invalid += 1
                    continue
                if rec.get("stage_confidence", 1.0) < min_confidence:
                    skipped_low_conf += 1
                    continue
                records.append(rec)
            except Exception:
                pass

    print(f"Loaded {len(records):,} stage-labeled records")
    print(f"  Skipped (low confidence < {min_confidence}): {skipped_low_conf:,}")
    print(f"  Skipped (invalid stage): {skipped_invalid:,}")
    return records


def print_stage_distribution(records: list):
    from collections import Counter
    counts = Counter(r["fabrication_stage"] for r in records)
    print("\nStage distribution in training set:")
    for stage in STAGE_CODES:
        count = counts.get(stage, 0)
        max_count = max(counts.values()) if counts else 1
        bar = "█" * min(40, int(count / max_count * 40)) if count > 0 else ""
        print(f"  {stage:15s} {count:4d} {bar}")


def train(args):
    from transformers import AutoProcessor, AutoModelForCausalLM

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nLoading stage labels...")
    records = load_stage_labels(min_confidence=0.4)

    if len(records) < MIN_LABELS:
        print(f"\nOnly {len(records)} stage labels (need {MIN_LABELS}).")
        print("Run auto_label_stages.py first, or use --force")
        if not args.force:
            sys.exit(1)

    if args.dry_run:
        print_stage_distribution(records)
        print("\nDRY RUN — no training")
        return

    print_stage_distribution(records)

    # Train/val split
    random.seed(42)
    random.shuffle(records)
    n_val = max(50, int(len(records) * 0.1))
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

    # Unfreeze last 2 DaViT block groups
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

    # Build stage head
    head = StageClassifierHead(hidden_size=768, n_stages=N_STAGES).to(device)
    print(f"Stage head params: {sum(p.numel() for p in head.parameters())/1e6:.3f}M")

    # Class weights for imbalanced distribution
    from collections import Counter
    stage_counts = Counter(r["fabrication_stage"] for r in train_records)
    weights = []
    total = len(train_records)
    for stage in STAGE_CODES:
        count = stage_counts.get(stage, 1)
        weights.append(min(10.0, total / (N_STAGES * count)))
    class_weights = torch.tensor(weights, dtype=torch.float32).to(device)
    print(f"Class weights: min={class_weights.min():.2f} max={class_weights.max():.2f}")

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

    train_ds = StageDataset(train_records, processor)
    val_ds = StageDataset(val_records, processor)
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    print(f"\nTraining {args.epochs} epochs, {len(train_loader)} steps/epoch")

    best_val_acc = 0.0
    global_step = 0
    start_epoch = 1

    # Resume from checkpoint
    if args.resume:
        resume_path = Path(args.resume)
        if not resume_path.exists():
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
        steps_done = (start_epoch - 1) * len(train_loader)
        for _ in range(steps_done):
            scheduler.step()
        global_step = steps_done
        print(f"Resumed at epoch {start_epoch}, best_val_acc={best_val_acc:.1%}, step={global_step}")

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
            labels = batch["stage_label"].to(device)

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
                labels = batch["stage_label"].to(device)
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
            "stage_codes": STAGE_CODES,
        }
        ckpt_path = OUTPUTS_DIR / f"checkpoint_epoch{epoch:02d}.pt"
        torch.save(ckpt, ckpt_path)

        if avg_val_acc > best_val_acc:
            best_val_acc = avg_val_acc
            shutil.copy2(ckpt_path, OUTPUTS_DIR / "checkpoint_best.pt")
            print(f"  ★ New best! val_acc={best_val_acc:.1%}")

    # Save final model files
    print("\nSaving final stage classifier...")
    from safetensors.torch import save_file as safetensors_save

    # Full checkpoint
    torch.save({
        "head_state_dict": head.state_dict(),
        "stage_codes": STAGE_CODES,
        "n_stages": N_STAGES,
        "hidden_size": 768,
        "best_val_acc": best_val_acc,
    }, MODELS_DIR / "yono_stage_classifier.pt")

    # Safetensors head weights
    safetensors_save(head.state_dict(), MODELS_DIR / "yono_stage_head.safetensors")

    # Labels file
    with open(MODELS_DIR / "yono_stage_labels.json", "w") as f:
        json.dump({"stage_codes": STAGE_CODES, "n_stages": N_STAGES}, f, indent=2)

    # Config for server.py
    config = {
        "model_base": "microsoft/florence-2-base",
        "hidden_size": 768,
        "n_stages": N_STAGES,
        "stage_codes": STAGE_CODES,
        "best_val_acc": best_val_acc,
        "version": "v1",
    }
    with open(MODELS_DIR / "yono_stage_config.json", "w") as f:
        json.dump(config, f, indent=2)

    print(f"Saved: yono_stage_classifier.pt")
    print(f"Saved: yono_stage_head.safetensors")
    print(f"Saved: yono_stage_labels.json")
    print(f"Saved: yono_stage_config.json")
    print(f"\nBest val_acc: {best_val_acc:.1%}")
    print("Restart server.py to load the stage classifier.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Florence-2 fabrication stage classifier")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--lr", type=float, default=LR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--resume", type=str, default=None,
                        help="Path to checkpoint .pt file to resume from")
    args = parser.parse_args()

    BATCH_SIZE = args.batch_size
    LR = args.lr

    train(args)
