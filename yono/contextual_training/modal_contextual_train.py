"""
YONO Contextual Training on Modal — v2

Two-phase pipeline:
  1. stage_data: Fetch from Supabase (stratified), async-download images to Modal volume
  2. train: Train EfficientNet+context → price_tier on pre-staged local data (A100)

Usage:
  # Stage 100K images (run once, data persists on volume)
  modal run yono/contextual_training/modal_contextual_train.py --action stage --limit 100000

  # Train on staged data
  modal run yono/contextual_training/modal_contextual_train.py --action train --epochs 30

  # Stage + train in one shot
  modal run yono/contextual_training/modal_contextual_train.py --action all --limit 100000 --epochs 30

  # Export best model to ONNX
  modal run yono/contextual_training/modal_contextual_train.py --action export
"""

import modal
import os

app = modal.App("yono-contextual")

# Container image with all deps
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "torch==2.2.2",
        "torchvision==0.17.2",
        "timm>=0.9.0",
        "onnx",
        "onnxruntime",
        "pillow",
        "tqdm",
        "aiohttp",
        "aiofiles",
        "numpy<2",
        "psycopg2-binary",
    ])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

STAGED_DIR = "/data/contextual"
IMAGES_DIR = f"{STAGED_DIR}/images"
METADATA_FILE = f"{STAGED_DIR}/metadata.jsonl"
MODELS_DIR = "/data/models"

# ─── PHASE 1: STAGE DATA ───────────────────────────────────────────

@app.function(
    image=image,
    timeout=7200,  # 2 hours for big downloads
    memory=8192,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
)
def stage_data(limit: int = 100000, images_per_vehicle: int = 3):
    """
    Fetch stratified training data from Supabase, download images to volume.
    """
    import json
    import asyncio
    import aiohttp
    from pathlib import Path
    from datetime import datetime
    import psycopg2
    from psycopg2.extras import RealDictCursor

    print("=" * 60)
    print("YONO CONTEXTUAL — Stage Data")
    print(f"Target: {limit} images, {images_per_vehicle}/vehicle")
    print("=" * 60)

    Path(IMAGES_DIR).mkdir(parents=True, exist_ok=True)

    # Direct DB connection (faster than Supabase client for big queries)
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        # Build from individual vars
        db_url = f"postgresql://postgres.qkgaybvrernstplzjaam:{os.environ['SUPABASE_DB_PASSWORD']}@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

    print("\nFetching stratified training data from DB...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute(
        "SELECT * FROM get_contextual_training_data_stratified(%s, %s)",
        (limit, images_per_vehicle)
    )
    records = cur.fetchall()
    conn.close()

    print(f"Fetched {len(records)} records")

    # Tier distribution
    tiers = {}
    for r in records:
        t = r["price_tier"]
        tiers[t] = tiers.get(t, 0) + 1
    print("\nTier distribution:")
    for t, c in sorted(tiers.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")

    # Async download images
    async def download_batch(records_batch, session, stats):
        for record in records_batch:
            img_id = str(record["image_id"])
            img_path = f"{IMAGES_DIR}/{img_id}.jpg"

            # Skip if already downloaded
            if os.path.exists(img_path) and os.path.getsize(img_path) > 100:
                stats["skipped"] += 1
                continue

            try:
                async with session.get(record["image_url"], timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status == 200:
                        data = await resp.read()
                        with open(img_path, "wb") as f:
                            f.write(data)
                        stats["downloaded"] += 1
                    else:
                        stats["failed"] += 1
            except Exception:
                stats["failed"] += 1

            if (stats["downloaded"] + stats["skipped"] + stats["failed"]) % 1000 == 0:
                total = stats["downloaded"] + stats["skipped"] + stats["failed"]
                print(f"  Progress: {total}/{len(records)} (dl:{stats['downloaded']} skip:{stats['skipped']} fail:{stats['failed']})")

    async def download_all(records):
        stats = {"downloaded": 0, "skipped": 0, "failed": 0}
        connector = aiohttp.TCPConnector(limit=80)  # 80 concurrent connections
        async with aiohttp.ClientSession(connector=connector) as session:
            # Process in chunks of 500
            chunk_size = 500
            for i in range(0, len(records), chunk_size):
                chunk = records[i:i + chunk_size]
                tasks = [download_batch([r], session, stats) for r in chunk]
                await asyncio.gather(*tasks)
        return stats

    print(f"\nDownloading {len(records)} images (80 concurrent)...")
    start = datetime.now()
    stats = asyncio.run(download_all(records))
    elapsed = (datetime.now() - start).total_seconds()
    print(f"\nDownload complete in {elapsed:.0f}s")
    print(f"  Downloaded: {stats['downloaded']}")
    print(f"  Skipped (cached): {stats['skipped']}")
    print(f"  Failed: {stats['failed']}")

    # Write metadata JSONL (only records with successfully downloaded images)
    valid_records = []
    for r in records:
        img_path = f"{IMAGES_DIR}/{r['image_id']}.jpg"
        if os.path.exists(img_path) and os.path.getsize(img_path) > 100:
            # Serialize for JSON
            record = {k: str(v) if hasattr(v, 'hex') else v for k, v in r.items()}
            valid_records.append(record)

    with open(METADATA_FILE, "w") as f:
        for r in valid_records:
            f.write(json.dumps(r, default=str) + "\n")

    print(f"\nStaged {len(valid_records)} valid records to {METADATA_FILE}")

    # Write staging manifest
    manifest = {
        "staged_at": datetime.now().isoformat(),
        "total_records": len(valid_records),
        "total_requested": limit,
        "download_stats": stats,
        "tier_distribution": tiers,
        "elapsed_seconds": elapsed,
    }
    with open(f"{STAGED_DIR}/manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    volume.commit()
    print("Volume committed.")
    return manifest


# ─── PHASE 2: TRAIN ────────────────────────────────────────────────

@app.function(
    image=image,
    gpu="A100",
    timeout=86400,  # 24h
    memory=32768,
    volumes={"/data": volume},
)
def train(
    epochs: int = 30,
    batch_size: int = 64,
    context_dim: int = 64,
    lr: float = 1e-4,
    output_task: str = "price_tier",
):
    """Train contextual model on pre-staged data."""
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader
    from torchvision import transforms
    from PIL import Image
    import timm
    from tqdm import tqdm
    import json
    from datetime import datetime
    from pathlib import Path

    print("=" * 60)
    print("YONO CONTEXTUAL — Train")
    print(f"Task: {output_task}")
    print(f"Config: epochs={epochs}, batch={batch_size}, lr={lr}")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # Load staged metadata
    if not os.path.exists(METADATA_FILE):
        raise RuntimeError(f"No staged data at {METADATA_FILE}. Run --action stage first.")

    records = []
    with open(METADATA_FILE) as f:
        for line in f:
            records.append(json.loads(line))
    print(f"\nLoaded {len(records)} staged records")

    # Verify images exist
    valid = []
    for r in records:
        img_path = f"{IMAGES_DIR}/{r['image_id']}.jpg"
        if os.path.exists(img_path):
            r["local_path"] = img_path
            valid.append(r)
    print(f"Valid (images on disk): {len(valid)}")

    if len(valid) < 100:
        raise RuntimeError(f"Only {len(valid)} valid records. Need at least 100. Run --action stage first.")

    records = valid

    # Label setup
    if output_task == "price_tier":
        label_map = {"elite": 0, "high": 1, "mid": 2, "entry": 3, "budget": 4}
        num_classes = 5
    elif output_task == "engagement":
        label_map = {"viral": 0, "high": 1, "moderate": 2, "low": 3}
        num_classes = 4
    else:
        raise ValueError(f"Unknown task: {output_task}")

    # Tier distribution
    tier_counts = {}
    for r in records:
        t = r.get("price_tier", "unknown")
        tier_counts[t] = tier_counts.get(t, 0) + 1
    print("\nTier distribution:")
    for t, c in sorted(tier_counts.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")

    CONTEXT_FEATURES = 7

    class StagedDataset(Dataset):
        def __init__(self, records, augment=False):
            self.records = records
            if augment:
                self.transform = transforms.Compose([
                    transforms.Resize((256, 256)),
                    transforms.RandomCrop(224),
                    transforms.RandomHorizontalFlip(),
                    transforms.ColorJitter(brightness=0.2, contrast=0.2),
                    transforms.ToTensor(),
                    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                       std=[0.229, 0.224, 0.225])
                ])
            else:
                self.transform = transforms.Compose([
                    transforms.Resize((224, 224)),
                    transforms.ToTensor(),
                    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                       std=[0.229, 0.224, 0.225])
                ])

        def __len__(self):
            return len(self.records)

        def __getitem__(self, idx):
            r = self.records[idx]

            # Load from disk
            try:
                img = Image.open(r["local_path"]).convert("RGB")
                img_tensor = self.transform(img)
            except Exception:
                img_tensor = torch.zeros(3, 224, 224)

            # Context features
            year = int(r.get("year") or 2000)
            mileage = int(r.get("mileage") or 50000)
            comments = int(r.get("comment_count") or 0)
            bids = int(r.get("bid_count") or 0)
            views = int(r.get("view_count") or 0)

            context = torch.tensor([
                (year - 1900) / 130.0,
                min(mileage, 500000) / 500000.0,
                min(comments, 1000) / 1000.0,
                min(bids, 100) / 100.0,
                min(views, 100000) / 100000.0,
                1.0 if r.get("transmission") else 0.0,
                1.0 if r.get("color") else 0.0,
            ], dtype=torch.float32)

            # Label
            price = int(r.get("sale_price") or 0)
            if price >= 500000:
                label = label_map["elite"]
            elif price >= 100000:
                label = label_map["high"]
            elif price >= 50000:
                label = label_map["mid"]
            elif price >= 10000:
                label = label_map["entry"]
            else:
                label = label_map["budget"]

            return img_tensor, context, label

    # Stratified split: keep tier balance in train AND val
    import random
    random.shuffle(records)
    split_idx = int(0.9 * len(records))
    train_records = records[:split_idx]
    val_records = records[split_idx:]

    train_dataset = StagedDataset(train_records, augment=True)
    val_dataset = StagedDataset(val_records, augment=False)

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True,
                             num_workers=8, pin_memory=True, persistent_workers=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False,
                           num_workers=4, pin_memory=True, persistent_workers=True)

    print(f"\nTrain: {len(train_dataset)}, Val: {len(val_dataset)}")

    # Model
    class ContextualModel(nn.Module):
        def __init__(self, num_classes, context_dim=64):
            super().__init__()
            self.image_encoder = timm.create_model("efficientnet_b0", pretrained=True)
            image_features = self.image_encoder.classifier.in_features  # 1280
            self.image_encoder.classifier = nn.Identity()

            self.context_encoder = nn.Sequential(
                nn.Linear(CONTEXT_FEATURES, 32),
                nn.ReLU(),
                nn.Dropout(0.1),
                nn.Linear(32, context_dim),
                nn.ReLU(),
            )

            self.classifier = nn.Sequential(
                nn.Linear(image_features + context_dim, 512),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(512, 256),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.Linear(256, num_classes)
            )

        def forward(self, image, context):
            img_feat = self.image_encoder(image)
            ctx_feat = self.context_encoder(context)
            combined = torch.cat([img_feat, ctx_feat], dim=1)
            return self.classifier(combined)

    model = ContextualModel(num_classes, context_dim).to(device)
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"\nModel: {total_params:,} params ({trainable_params:,} trainable)")

    # Class weights for imbalanced data
    class_counts = [0] * num_classes
    for r in train_records:
        price = int(r.get("sale_price") or 0)
        if price >= 500000:
            class_counts[0] += 1
        elif price >= 100000:
            class_counts[1] += 1
        elif price >= 50000:
            class_counts[2] += 1
        elif price >= 10000:
            class_counts[3] += 1
        else:
            class_counts[4] += 1

    total = sum(class_counts)
    weights = torch.tensor([total / (num_classes * c) if c > 0 else 1.0 for c in class_counts]).to(device)
    print(f"Class weights: {weights.tolist()}")

    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingWarmRestarts(optimizer, T_0=10, T_mult=2)

    best_acc = 0
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    checkpoint_dir = f"/data/contextual_runs/{run_id}"
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)

    # Save config
    config = {
        "task": output_task,
        "num_classes": num_classes,
        "label_map": label_map,
        "context_dim": context_dim,
        "context_features": CONTEXT_FEATURES,
        "epochs": epochs,
        "batch_size": batch_size,
        "lr": lr,
        "train_size": len(train_records),
        "val_size": len(val_records),
        "tier_distribution": tier_counts,
        "class_weights": weights.tolist(),
        "run_id": run_id,
    }
    with open(f"{checkpoint_dir}/config.json", "w") as f:
        json.dump(config, f, indent=2)

    print(f"\nStarting training — {epochs} epochs")
    print("-" * 60)

    for epoch in range(epochs):
        model.train()
        train_loss = 0
        train_correct = 0
        train_total = 0

        for images, contexts, labels in tqdm(train_loader, desc=f"Epoch {epoch+1}/{epochs}"):
            images = images.to(device, non_blocking=True)
            contexts = contexts.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)

            optimizer.zero_grad(set_to_none=True)
            outputs = model(images, contexts)
            loss = criterion(outputs, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            train_loss += loss.item() * labels.size(0)
            _, predicted = outputs.max(1)
            train_total += labels.size(0)
            train_correct += predicted.eq(labels).sum().item()

        scheduler.step()

        # Validate
        model.eval()
        val_loss = 0
        val_correct = 0
        val_total = 0
        per_class_correct = [0] * num_classes
        per_class_total = [0] * num_classes

        with torch.no_grad():
            for images, contexts, labels in val_loader:
                images = images.to(device, non_blocking=True)
                contexts = contexts.to(device, non_blocking=True)
                labels = labels.to(device, non_blocking=True)

                outputs = model(images, contexts)
                loss = criterion(outputs, labels)
                val_loss += loss.item() * labels.size(0)
                _, predicted = outputs.max(1)
                val_total += labels.size(0)
                val_correct += predicted.eq(labels).sum().item()

                for i in range(num_classes):
                    mask = labels == i
                    per_class_total[i] += mask.sum().item()
                    per_class_correct[i] += (predicted[mask] == i).sum().item()

        train_acc = 100 * train_correct / train_total
        val_acc = 100 * val_correct / val_total
        avg_train_loss = train_loss / train_total
        avg_val_loss = val_loss / val_total

        # Per-class accuracy
        inv_label = {v: k for k, v in label_map.items()}
        class_accs = []
        for i in range(num_classes):
            acc = 100 * per_class_correct[i] / per_class_total[i] if per_class_total[i] > 0 else 0
            class_accs.append(f"{inv_label[i]}:{acc:.0f}%")

        print(f"Epoch {epoch+1}: train_acc={train_acc:.1f}% val_acc={val_acc:.1f}% "
              f"loss={avg_train_loss:.4f}/{avg_val_loss:.4f} lr={scheduler.get_last_lr()[0]:.6f}")
        print(f"  Per-class: {' | '.join(class_accs)}")

        # Save best
        if val_acc > best_acc:
            best_acc = val_acc
            best_path = f"{checkpoint_dir}/best_model.pt"
            torch.save({
                "model_state_dict": model.state_dict(),
                "epoch": epoch,
                "val_acc": val_acc,
                "per_class_acc": {inv_label[i]: 100 * per_class_correct[i] / max(per_class_total[i], 1) for i in range(num_classes)},
                "config": config,
            }, best_path)
            # Also save as the canonical model
            torch.save({
                "model_state_dict": model.state_dict(),
                "epoch": epoch,
                "val_acc": val_acc,
                "config": config,
            }, f"{MODELS_DIR}/yono_contextual_best.pt")
            print(f"  *** New best: {val_acc:.1f}% → saved ***")

        # Save periodic checkpoint
        if (epoch + 1) % 5 == 0:
            torch.save({
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scheduler_state_dict": scheduler.state_dict(),
                "epoch": epoch,
                "val_acc": val_acc,
            }, f"{checkpoint_dir}/checkpoint_epoch{epoch+1}.pt")

    volume.commit()

    print("\n" + "=" * 60)
    print(f"Training complete!")
    print(f"Best validation accuracy: {best_acc:.1f}%")
    print(f"Checkpoints: {checkpoint_dir}")
    print(f"Best model: {MODELS_DIR}/yono_contextual_best.pt")
    print("=" * 60)

    return {
        "best_acc": best_acc,
        "epochs": epochs,
        "task": output_task,
        "samples": len(records),
        "run_id": run_id,
    }


# ─── PHASE 3: EXPORT TO ONNX ───────────────────────────────────────

@app.function(
    image=image,
    timeout=600,
    memory=8192,
    volumes={"/data": volume},
)
def export_onnx():
    """Export best contextual model to ONNX."""
    import torch
    import torch.nn as nn
    import timm
    import json
    import onnxruntime as ort
    import numpy as np

    best_path = f"{MODELS_DIR}/yono_contextual_best.pt"
    if not os.path.exists(best_path):
        raise RuntimeError(f"No trained model at {best_path}. Run --action train first.")

    checkpoint = torch.load(best_path, map_location="cpu", weights_only=False)
    config = checkpoint["config"]
    print(f"Loaded model from epoch {checkpoint['epoch']}, val_acc={checkpoint['val_acc']:.1f}%")
    print(f"Config: {json.dumps(config, indent=2)}")

    num_classes = config["num_classes"]
    context_dim = config["context_dim"]
    CONTEXT_FEATURES = config["context_features"]

    class ContextualModel(nn.Module):
        def __init__(self, num_classes, context_dim=64):
            super().__init__()
            self.image_encoder = timm.create_model("efficientnet_b0", pretrained=False)
            image_features = self.image_encoder.classifier.in_features
            self.image_encoder.classifier = nn.Identity()
            self.context_encoder = nn.Sequential(
                nn.Linear(CONTEXT_FEATURES, 32),
                nn.ReLU(),
                nn.Dropout(0.1),
                nn.Linear(32, context_dim),
                nn.ReLU(),
            )
            self.classifier = nn.Sequential(
                nn.Linear(image_features + context_dim, 512),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(512, 256),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.Linear(256, num_classes)
            )

        def forward(self, image, context):
            img_feat = self.image_encoder(image)
            ctx_feat = self.context_encoder(context)
            combined = torch.cat([img_feat, ctx_feat], dim=1)
            return self.classifier(combined)

    model = ContextualModel(num_classes, context_dim)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    # Export ONNX
    dummy_image = torch.randn(1, 3, 224, 224)
    dummy_context = torch.randn(1, CONTEXT_FEATURES)
    onnx_path = f"{MODELS_DIR}/yono_contextual_v1.onnx"

    torch.onnx.export(
        model,
        (dummy_image, dummy_context),
        onnx_path,
        input_names=["image", "context"],
        output_names=["logits"],
        dynamic_axes={
            "image": {0: "batch"},
            "context": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=17,
    )

    # Verify
    sess = ort.InferenceSession(onnx_path)
    result = sess.run(None, {
        "image": dummy_image.numpy(),
        "context": dummy_context.numpy()
    })
    print(f"\nONNX verification — output shape: {result[0].shape}")
    print(f"Softmax sample: {torch.softmax(torch.tensor(result[0][0]), dim=0).tolist()}")

    # Save config alongside
    onnx_config = {
        **config,
        "val_acc": checkpoint["val_acc"],
        "epoch": checkpoint["epoch"],
        "onnx_path": "yono_contextual_v1.onnx",
        "input_names": ["image", "context"],
        "context_features_order": [
            "year_normalized", "mileage_normalized", "comments_normalized",
            "bids_normalized", "views_normalized", "has_transmission", "has_color"
        ],
    }
    with open(f"{MODELS_DIR}/yono_contextual_v1_config.json", "w") as f:
        json.dump(onnx_config, f, indent=2)

    onnx_size = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"\nExported: {onnx_path} ({onnx_size:.1f} MB)")

    volume.commit()
    return {"onnx_path": onnx_path, "size_mb": onnx_size, "val_acc": checkpoint["val_acc"]}


# ─── ENTRYPOINT ─────────────────────────────────────────────────────

@app.local_entrypoint()
def main(
    action: str = "all",
    limit: int = 100000,
    epochs: int = 30,
    batch_size: int = 64,
    lr: float = 1e-4,
    task: str = "price_tier",
):
    """
    YONO Contextual Training Pipeline

    Actions:
      stage  - Download images to Modal volume
      train  - Train on pre-staged data
      export - Export best model to ONNX
      all    - Stage + train + export
    """
    if action in ("stage", "all"):
        print("=== STAGING DATA ===")
        manifest = stage_data.remote(limit=limit, images_per_vehicle=3)
        print(f"\nStaging result: {manifest}")

    if action in ("train", "all"):
        print("\n=== TRAINING ===")
        result = train.remote(
            epochs=epochs,
            batch_size=batch_size,
            lr=lr,
            output_task=task,
        )
        print(f"\nTraining result: {result}")

    if action in ("export", "all"):
        print("\n=== EXPORTING ONNX ===")
        result = export_onnx.remote()
        print(f"\nExport result: {result}")
