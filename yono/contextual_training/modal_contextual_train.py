"""
YONO Contextual Training on Modal — v2 / v3

v2 (original): EfficientNet + 7D context → price_tier (single task)
v3 (contextual intelligence): EfficientNet + 133D context → multi-task heads

Pipeline:
  1. stage_data: Fetch from Supabase (stratified), async-download images to Modal volume
  2. train: Train model on pre-staged local data (A100)
  3. export: Export best model to ONNX

Usage:
  # v2 (original pipeline)
  modal run yono/contextual_training/modal_contextual_train.py --action all --limit 100000

  # v3 (contextual intelligence pipeline)
  modal run yono/contextual_training/modal_contextual_train.py --action stage --version v3 --limit 100000
  modal run yono/contextual_training/modal_contextual_train.py --action train --version v3 --epochs 30
  modal run yono/contextual_training/modal_contextual_train.py --action export --version v3
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
    Uses per-tier batched queries to avoid Supabase statement timeout.
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
        db_url = f"postgresql://postgres.qkgaybvrernstplzjaam:{os.environ['SUPABASE_DB_PASSWORD']}@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require"
    elif "sslmode" not in db_url:
        db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"

    # Fetch data per-tier to avoid statement timeout on massive UNION ALL
    per_tier = limit // 5
    vehicles_per_tier = per_tier // images_per_vehicle

    tiers = [
        ("elite",  "v.sale_price >= 500000"),
        ("high",   "v.sale_price >= 100000 AND v.sale_price < 500000"),
        ("mid",    "v.sale_price >= 50000 AND v.sale_price < 100000"),
        ("entry",  "v.sale_price >= 10000 AND v.sale_price < 50000"),
        ("budget", "v.sale_price > 0 AND v.sale_price < 10000"),
    ]

    records = []
    for tier_name, tier_filter in tiers:
        print(f"\nFetching tier '{tier_name}' (up to {per_tier} images)...")
        conn = psycopg2.connect(db_url, connect_timeout=30, keepalives=1,
                                keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # Set a generous per-query timeout (120s per tier)
        cur.execute("SET statement_timeout = '120s'")
        cur.execute(f"""
            SELECT
                vi.id as image_id,
                vi.image_url,
                v.id as vehicle_id,
                v.year, v.make, v.model, v.color, v.mileage,
                v.transmission, v.engine_size, v.condition_rating,
                v.sale_price,
                COALESCE(bl.comment_count, 0) as comment_count,
                v.bid_count, v.view_count,
                '{tier_name}' as price_tier
            FROM vehicles v
            JOIN LATERAL (
                SELECT vi2.id, vi2.image_url
                FROM vehicle_images vi2
                WHERE vi2.vehicle_id = v.id
                  AND vi2.image_url IS NOT NULL
                  AND vi2.image_url != ''
                LIMIT {images_per_vehicle}
            ) vi ON true
            LEFT JOIN bat_listings bl ON bl.vehicle_id = v.id
            WHERE {tier_filter}
              AND v.make IS NOT NULL
              AND v.year IS NOT NULL
            LIMIT {per_tier}
        """)
        tier_rows = cur.fetchall()
        conn.close()
        records.extend(tier_rows)
        print(f"  Got {len(tier_rows)} records for '{tier_name}'")

    print(f"\nTotal fetched: {len(records)} records")

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


# ═══════════════════════════════════════════════════════════════════════════════
# V3: CONTEXTUAL INTELLIGENCE PIPELINE
# Multi-task heads, 133D context (Y/M/M + vehicle + timeline), context dropout
# ═══════════════════════════════════════════════════════════════════════════════

V3_STAGED_DIR = "/data/contextual_v3"
V3_IMAGES_DIR = f"{V3_STAGED_DIR}/images"
V3_METADATA_FILE = f"{V3_STAGED_DIR}/metadata.jsonl"

# Taxonomy constants (must match featurizers.py)
N_ZONES = 39
N_DAMAGE = 7
N_MODS = 8
N_PRICE_TIERS = 5
N_CONDITION = 5

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
ZONE_TO_IDX = {z: i for i, z in enumerate(ZONE_CODES)}

DAMAGE_FLAGS = ["rust", "dent", "crack", "paint_fade", "broken_glass", "missing_parts", "accident_damage"]
MOD_FLAGS = ["lift_kit", "lowered", "aftermarket_wheels", "roll_cage", "engine_swap", "body_kit", "exhaust_mod", "suspension_mod"]

PRICE_TIER_MAP = {"elite": 0, "high": 1, "mid": 2, "entry": 3, "budget": 4}

# Feature dimensions from featurizers.py
FEAT_DIM_YMM = 103
FEAT_DIM_VEHICLE = 20
FEAT_DIM_TIMELINE = 10
FEAT_DIM_TOTAL = FEAT_DIM_YMM + FEAT_DIM_VEHICLE + FEAT_DIM_TIMELINE  # 133


@app.function(
    image=image,
    timeout=7200,
    memory=8192,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
)
def stage_data_v3(limit: int = 100000, images_per_vehicle: int = 5):
    """
    Stage v3 training data: images + Y/M/M feature vectors + multi-task labels.
    """
    import json
    import asyncio
    import aiohttp
    from pathlib import Path
    from datetime import datetime
    import psycopg2
    from psycopg2.extras import RealDictCursor

    print("=" * 60)
    print("YONO CONTEXTUAL V3 — Stage Data")
    print(f"Target: {limit} images, {images_per_vehicle}/vehicle")
    print("=" * 60)

    Path(V3_IMAGES_DIR).mkdir(parents=True, exist_ok=True)

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_url = f"postgresql://postgres.qkgaybvrernstplzjaam:{os.environ['SUPABASE_DB_PASSWORD']}@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require"

    # Fetch images WITH zone labels, damage/mod flags, and Y/M/M feature vectors
    per_tier = limit // 5

    tiers = [
        ("elite",  "v.sale_price >= 500000"),
        ("high",   "v.sale_price >= 100000 AND v.sale_price < 500000"),
        ("mid",    "v.sale_price >= 50000 AND v.sale_price < 100000"),
        ("entry",  "v.sale_price >= 10000 AND v.sale_price < 50000"),
        ("budget", "v.sale_price > 0 AND v.sale_price < 10000"),
    ]

    records = []
    for tier_name, tier_filter in tiers:
        print(f"\nFetching tier '{tier_name}' (up to {per_tier} images)...")
        conn = psycopg2.connect(db_url, connect_timeout=30, keepalives=1,
                                keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '120s'")
        cur.execute(f"""
            SELECT
                vi.id as image_id,
                vi.image_url,
                vi.vehicle_zone,
                vi.condition_score,
                vi.damage_flags,
                vi.modification_flags,

                v.id as vehicle_id,
                v.year, v.make, v.model,
                v.color, v.mileage, v.transmission,
                v.engine_type, v.drivetrain, v.vin,
                v.condition_rating,
                v.sale_price, v.bid_count, v.view_count,

                yk.feature_vector as ymm_feature_vector,
                yk.source_comment_count as ymm_comment_count,

                '{tier_name}' as price_tier
            FROM vehicles v
            JOIN LATERAL (
                SELECT vi2.id, vi2.image_url, vi2.vehicle_zone,
                       vi2.condition_score, vi2.damage_flags, vi2.modification_flags
                FROM vehicle_images vi2
                WHERE vi2.vehicle_id = v.id
                  AND vi2.image_url IS NOT NULL
                  AND vi2.image_url != ''
                LIMIT {images_per_vehicle}
            ) vi ON true
            LEFT JOIN ymm_knowledge yk
                ON yk.year = v.year AND yk.make = v.make AND yk.model = v.model
            WHERE {tier_filter}
              AND v.make IS NOT NULL
              AND v.year IS NOT NULL
            ORDER BY RANDOM()
            LIMIT {per_tier}
        """)
        tier_rows = cur.fetchall()
        conn.close()
        records.extend(tier_rows)
        print(f"  Got {len(tier_rows)} records for '{tier_name}'")

    print(f"\nTotal fetched: {len(records)} records")

    # Stats
    tier_dist = {}
    with_ymm = 0
    with_zone = 0
    with_damage = 0
    for r in records:
        t = r["price_tier"]
        tier_dist[t] = tier_dist.get(t, 0) + 1
        if r.get("ymm_feature_vector"):
            with_ymm += 1
        if r.get("vehicle_zone"):
            with_zone += 1
        if r.get("damage_flags"):
            with_damage += 1

    print(f"\nTier distribution:")
    for t, c in sorted(tier_dist.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")
    print(f"\nWith Y/M/M vectors: {with_ymm}/{len(records)} ({100*with_ymm/max(len(records),1):.0f}%)")
    print(f"With zone labels: {with_zone}/{len(records)} ({100*with_zone/max(len(records),1):.0f}%)")
    print(f"With damage flags: {with_damage}/{len(records)} ({100*with_damage/max(len(records),1):.0f}%)")

    # Async download images (same as v2)
    async def download_batch(records_batch, session, stats):
        for record in records_batch:
            img_id = str(record["image_id"])
            img_path = f"{V3_IMAGES_DIR}/{img_id}.jpg"
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

    async def download_all(records):
        stats = {"downloaded": 0, "skipped": 0, "failed": 0}
        connector = aiohttp.TCPConnector(limit=80)
        async with aiohttp.ClientSession(connector=connector) as session:
            chunk_size = 500
            for i in range(0, len(records), chunk_size):
                chunk = records[i:i + chunk_size]
                tasks = [download_batch([r], session, stats) for r in chunk]
                await asyncio.gather(*tasks)
                total = stats["downloaded"] + stats["skipped"] + stats["failed"]
                if total % 2000 == 0:
                    print(f"  Progress: {total}/{len(records)}")
        return stats

    print(f"\nDownloading {len(records)} images...")
    start = datetime.now()
    stats = asyncio.run(download_all(records))
    elapsed = (datetime.now() - start).total_seconds()
    print(f"Download complete in {elapsed:.0f}s — dl:{stats['downloaded']} skip:{stats['skipped']} fail:{stats['failed']}")

    # Write metadata JSONL
    valid_records = []
    for r in records:
        img_path = f"{V3_IMAGES_DIR}/{r['image_id']}.jpg"
        if os.path.exists(img_path) and os.path.getsize(img_path) > 100:
            record = {k: str(v) if hasattr(v, 'hex') else v for k, v in r.items()}
            valid_records.append(record)

    with open(V3_METADATA_FILE, "w") as f:
        for r in valid_records:
            f.write(json.dumps(r, default=str) + "\n")

    manifest = {
        "version": "v3",
        "staged_at": datetime.now().isoformat(),
        "total_records": len(valid_records),
        "with_ymm_vectors": with_ymm,
        "with_zone_labels": with_zone,
        "with_damage_flags": with_damage,
        "tier_distribution": tier_dist,
        "elapsed_seconds": elapsed,
    }
    with open(f"{V3_STAGED_DIR}/manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    volume.commit()
    print(f"\nStaged {len(valid_records)} records to {V3_METADATA_FILE}")
    return manifest


@app.function(
    image=image,
    gpu="A100",
    timeout=86400,
    memory=32768,
    volumes={"/data": volume},
)
def train_v3(
    epochs: int = 30,
    batch_size: int = 64,
    lr: float = 1e-4,
    context_dropout: float = 0.2,
):
    """
    Train ContextualModelV3: multi-task heads with Y/M/M knowledge context.

    Architecture:
      EfficientNet-B0 (1280D)
        + Y/M/M features (103D → 128D)
        + Vehicle instance (20D → 32D)
        + Timeline (10D → 16D)
        → fused (1280 + 128 + 32 + 16 = 1456D)
        → trunk (1456 → 768 → 384)
        → heads: zone(39), condition(5), damage(7), mods(8), price(5)

    Key techniques:
      - Context dropout (20%): randomly zero Y/M/M context to ensure robustness
      - pos_weight for BCEWithLogitsLoss on damage/mod heads (class rebalancing)
      - Focal loss for severely imbalanced classes
    """
    import torch
    import torch.nn as nn
    import torch.optim as optim
    import torch.nn.functional as F
    from torch.utils.data import Dataset, DataLoader
    from torchvision import transforms
    from PIL import Image
    import timm
    from tqdm import tqdm
    import json
    import numpy as np
    from datetime import datetime
    from pathlib import Path
    import random

    print("=" * 60)
    print("YONO CONTEXTUAL V3 — Multi-Task Training")
    print(f"Config: epochs={epochs}, batch={batch_size}, lr={lr}, ctx_dropout={context_dropout}")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # Load staged metadata
    if not os.path.exists(V3_METADATA_FILE):
        raise RuntimeError(f"No staged data at {V3_METADATA_FILE}. Run --action stage --version v3 first.")

    records = []
    with open(V3_METADATA_FILE) as f:
        for line in f:
            records.append(json.loads(line))
    print(f"\nLoaded {len(records)} staged records")

    # Verify images
    valid = []
    for r in records:
        img_path = f"{V3_IMAGES_DIR}/{r['image_id']}.jpg"
        if os.path.exists(img_path):
            r["local_path"] = img_path
            valid.append(r)
    print(f"Valid (images on disk): {len(valid)}")
    records = valid

    if len(records) < 100:
        raise RuntimeError(f"Only {len(records)} valid records. Need >= 100.")

    # ── Dataset ──────────────────────────────────────────────────────────

    class V3Dataset(Dataset):
        """Multi-task dataset with Y/M/M context vectors."""

        def __init__(self, records, augment=False, ctx_dropout=0.0):
            self.records = records
            self.ctx_dropout = ctx_dropout
            if augment:
                self.transform = transforms.Compose([
                    transforms.Resize((256, 256)),
                    transforms.RandomCrop(224),
                    transforms.RandomHorizontalFlip(),
                    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
                    transforms.ToTensor(),
                    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
                ])
            else:
                self.transform = transforms.Compose([
                    transforms.Resize((224, 224)),
                    transforms.ToTensor(),
                    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
                ])

        def __len__(self):
            return len(self.records)

        def __getitem__(self, idx):
            r = self.records[idx]

            # Image
            try:
                img = Image.open(r["local_path"]).convert("RGB")
                img_tensor = self.transform(img)
            except Exception:
                img_tensor = torch.zeros(3, 224, 224)

            # Y/M/M feature vector (103D) — may be None
            ymm_vec = r.get("ymm_feature_vector")
            if ymm_vec and isinstance(ymm_vec, (list, str)):
                if isinstance(ymm_vec, str):
                    ymm_vec = json.loads(ymm_vec) if ymm_vec.startswith("[") else []
                ymm_features = torch.tensor(ymm_vec[:FEAT_DIM_YMM], dtype=torch.float32)
                if len(ymm_features) < FEAT_DIM_YMM:
                    ymm_features = F.pad(ymm_features, (0, FEAT_DIM_YMM - len(ymm_features)))
            else:
                ymm_features = torch.zeros(FEAT_DIM_YMM, dtype=torch.float32)

            # Context dropout: zero out Y/M/M features randomly
            if self.ctx_dropout > 0 and random.random() < self.ctx_dropout:
                ymm_features = torch.zeros_like(ymm_features)

            # Vehicle instance features (20D) — inline featurization
            def _norm(v, mx):
                return min(1.0, max(0.0, float(v or 0) / mx)) if mx > 0 else 0.0

            import math
            def _lognorm(v, mx=1e6):
                return min(1.0, math.log1p(float(v or 0)) / math.log1p(mx)) if v else 0.0

            mileage = int(r.get("mileage") or 0)
            price = int(r.get("sale_price") or 0)

            vehicle_features = torch.tensor([
                _norm(mileage, 300000),
                _lognorm(mileage, 500000),
                _lognorm(price, 2e6),
                1.0 if price >= 500000 else 0.75 if price >= 100000 else 0.5 if price >= 50000 else 0.25 if price >= 10000 else 0.0,
                _norm(r.get("bid_count", 0), 200),
                _norm(r.get("view_count", 0), 100000),
                _norm(r.get("comment_count") or r.get("ymm_comment_count", 0), 1000),
                _lognorm(r.get("comment_count") or r.get("ymm_comment_count", 0), 5000),
                1.0 if r.get("vin") else 0.0,
                1.0 if r.get("color") else 0.0,
                1.0 if r.get("transmission") else 0.0,
                1.0 if r.get("engine_type") else 0.0,
                1.0 if r.get("mileage") else 0.0,
                1.0 if r.get("drivetrain") else 0.0,
                _norm(r.get("condition_rating", 0), 5.0) if r.get("condition_rating") else 0.5,
                1.0 if r.get("condition_rating") else 0.0,
                0.0, 0.0, 0.0, 0.0,  # padding to 20D
            ], dtype=torch.float32)

            # Timeline features (10D) — placeholder zeros (no timestamp ordering in batch)
            timeline_features = torch.zeros(FEAT_DIM_TIMELINE, dtype=torch.float32)

            # Concatenate full context
            context = torch.cat([ymm_features, vehicle_features, timeline_features])

            # ── Multi-task labels ────────────────────────────────────────
            # Zone (39-class softmax)
            zone_str = r.get("vehicle_zone", "other")
            zone_idx = ZONE_TO_IDX.get(zone_str, ZONE_TO_IDX["other"])
            zone_label = torch.tensor(zone_idx, dtype=torch.long)

            # Condition (5-class softmax, 1-5 → 0-4)
            cond = int(r.get("condition_score") or 3) - 1
            cond_label = torch.tensor(max(0, min(4, cond)), dtype=torch.long)

            # Damage flags (7-class multi-label BCE)
            damage_flags = r.get("damage_flags") or []
            if isinstance(damage_flags, str):
                damage_flags = json.loads(damage_flags) if damage_flags.startswith("[") else []
            damage_vec = torch.zeros(N_DAMAGE, dtype=torch.float32)
            for flag in damage_flags:
                if flag in DAMAGE_FLAGS:
                    damage_vec[DAMAGE_FLAGS.index(flag)] = 1.0

            # Modification flags (8-class multi-label BCE)
            mod_flags = r.get("modification_flags") or []
            if isinstance(mod_flags, str):
                mod_flags = json.loads(mod_flags) if mod_flags.startswith("[") else []
            mod_vec = torch.zeros(N_MODS, dtype=torch.float32)
            for flag in mod_flags:
                if flag in MOD_FLAGS:
                    mod_vec[MOD_FLAGS.index(flag)] = 1.0

            # Price tier (5-class softmax)
            price_tier = r.get("price_tier", "entry")
            price_label = torch.tensor(PRICE_TIER_MAP.get(price_tier, 3), dtype=torch.long)

            return {
                "image": img_tensor,
                "context": context,
                "zone": zone_label,
                "condition": cond_label,
                "damage": damage_vec,
                "mods": mod_vec,
                "price_tier": price_label,
            }

    # ── Model ────────────────────────────────────────────────────────────

    class ContextualModelV3(nn.Module):
        """
        Multi-task contextual vehicle analysis model.

        EfficientNet-B0 (1280D) + context (133D → 176D) → trunk → 5 task heads.
        """
        def __init__(self):
            super().__init__()

            # Image encoder (frozen first 6 blocks, train last 2 + classifier)
            self.image_encoder = timm.create_model("efficientnet_b0", pretrained=True)
            img_dim = self.image_encoder.classifier.in_features  # 1280
            self.image_encoder.classifier = nn.Identity()

            # Context encoders (separate for each context type)
            self.ymm_encoder = nn.Sequential(
                nn.Linear(FEAT_DIM_YMM, 128),
                nn.ReLU(),
                nn.Dropout(0.1),
            )
            self.vehicle_encoder = nn.Sequential(
                nn.Linear(FEAT_DIM_VEHICLE, 32),
                nn.ReLU(),
                nn.Dropout(0.1),
            )
            self.timeline_encoder = nn.Sequential(
                nn.Linear(FEAT_DIM_TIMELINE, 16),
                nn.ReLU(),
            )

            fused_dim = img_dim + 128 + 32 + 16  # 1456

            # Shared trunk
            self.trunk = nn.Sequential(
                nn.Linear(fused_dim, 768),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(768, 384),
                nn.ReLU(),
                nn.Dropout(0.2),
            )

            # Task-specific heads
            self.zone_head = nn.Linear(384, N_ZONES)         # 39-class softmax
            self.condition_head = nn.Linear(384, N_CONDITION)  # 5-class softmax
            self.damage_head = nn.Linear(384, N_DAMAGE)       # 7-class BCE
            self.mods_head = nn.Linear(384, N_MODS)           # 8-class BCE
            self.price_head = nn.Linear(384, N_PRICE_TIERS)   # 5-class softmax

        def forward(self, image, context):
            # Split context into components
            ymm_ctx = context[:, :FEAT_DIM_YMM]
            veh_ctx = context[:, FEAT_DIM_YMM:FEAT_DIM_YMM + FEAT_DIM_VEHICLE]
            tl_ctx = context[:, FEAT_DIM_YMM + FEAT_DIM_VEHICLE:]

            img_feat = self.image_encoder(image)
            ymm_feat = self.ymm_encoder(ymm_ctx)
            veh_feat = self.vehicle_encoder(veh_ctx)
            tl_feat = self.timeline_encoder(tl_ctx)

            fused = torch.cat([img_feat, ymm_feat, veh_feat, tl_feat], dim=1)
            trunk_out = self.trunk(fused)

            return {
                "zone": self.zone_head(trunk_out),
                "condition": self.condition_head(trunk_out),
                "damage": self.damage_head(trunk_out),
                "mods": self.mods_head(trunk_out),
                "price_tier": self.price_head(trunk_out),
            }

    # ── Prepare data ─────────────────────────────────────────────────────

    random.shuffle(records)
    split_idx = int(0.9 * len(records))
    train_records = records[:split_idx]
    val_records = records[split_idx:]

    train_ds = V3Dataset(train_records, augment=True, ctx_dropout=context_dropout)
    val_ds = V3Dataset(val_records, augment=False, ctx_dropout=0.0)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,
                             num_workers=8, pin_memory=True, persistent_workers=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False,
                           num_workers=4, pin_memory=True, persistent_workers=True)

    print(f"\nTrain: {len(train_ds)}, Val: {len(val_ds)}")

    # ── Class weights for imbalanced data ────────────────────────────────

    # Damage flag positive weights (inverse frequency, capped at 20x)
    damage_pos = torch.zeros(N_DAMAGE)
    damage_total = 0
    mod_pos = torch.zeros(N_MODS)
    mod_total = 0

    for r in train_records:
        dflags = r.get("damage_flags") or []
        if isinstance(dflags, str):
            try:
                dflags = json.loads(dflags)
            except Exception:
                dflags = []
        for flag in dflags:
            if flag in DAMAGE_FLAGS:
                damage_pos[DAMAGE_FLAGS.index(flag)] += 1
        damage_total += 1

        mflags = r.get("modification_flags") or []
        if isinstance(mflags, str):
            try:
                mflags = json.loads(mflags)
            except Exception:
                mflags = []
        for flag in mflags:
            if flag in MOD_FLAGS:
                mod_pos[MOD_FLAGS.index(flag)] += 1
        mod_total += 1

    # pos_weight = (N - pos) / pos, capped at 20
    damage_pw = torch.clamp((damage_total - damage_pos) / damage_pos.clamp(min=1), max=20.0).to(device)
    mod_pw = torch.clamp((mod_total - mod_pos) / mod_pos.clamp(min=1), max=20.0).to(device)

    print(f"\nDamage pos_weight: {damage_pw.tolist()}")
    print(f"Mod pos_weight: {mod_pw.tolist()}")

    # Price tier class weights
    price_counts = [0] * N_PRICE_TIERS
    for r in train_records:
        pt = PRICE_TIER_MAP.get(r.get("price_tier", "entry"), 3)
        price_counts[pt] += 1
    price_total = sum(price_counts)
    price_weights = torch.tensor(
        [price_total / (N_PRICE_TIERS * max(c, 1)) for c in price_counts]
    ).to(device)

    # ── Loss functions ───────────────────────────────────────────────────

    zone_criterion = nn.CrossEntropyLoss()
    condition_criterion = nn.CrossEntropyLoss()
    damage_criterion = nn.BCEWithLogitsLoss(pos_weight=damage_pw)
    mods_criterion = nn.BCEWithLogitsLoss(pos_weight=mod_pw)
    price_criterion = nn.CrossEntropyLoss(weight=price_weights)

    # Loss weights (relative importance of each task)
    LOSS_WEIGHTS = {"zone": 1.0, "condition": 1.5, "damage": 2.0, "mods": 1.5, "price_tier": 1.0}

    # ── Model + optimizer ────────────────────────────────────────────────

    model = ContextualModelV3().to(device)
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"\nModel: {total_params:,} params ({trainable_params:,} trainable)")

    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingWarmRestarts(optimizer, T_0=10, T_mult=2)

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    checkpoint_dir = f"/data/contextual_v3_runs/{run_id}"
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)

    config = {
        "version": "v3",
        "context_dim": FEAT_DIM_TOTAL,
        "ymm_dim": FEAT_DIM_YMM,
        "vehicle_dim": FEAT_DIM_VEHICLE,
        "timeline_dim": FEAT_DIM_TIMELINE,
        "n_zones": N_ZONES,
        "n_damage": N_DAMAGE,
        "n_mods": N_MODS,
        "n_condition": N_CONDITION,
        "n_price_tiers": N_PRICE_TIERS,
        "zone_codes": ZONE_CODES,
        "damage_flags": DAMAGE_FLAGS,
        "mod_flags": MOD_FLAGS,
        "epochs": epochs,
        "batch_size": batch_size,
        "lr": lr,
        "context_dropout": context_dropout,
        "train_size": len(train_records),
        "val_size": len(val_records),
        "loss_weights": LOSS_WEIGHTS,
        "run_id": run_id,
    }
    with open(f"{checkpoint_dir}/config.json", "w") as f:
        json.dump(config, f, indent=2)

    # ── Training loop ────────────────────────────────────────────────────

    best_score = 0
    print(f"\nStarting training — {epochs} epochs, {len(train_loader)} steps/epoch")
    print("-" * 60)

    for epoch in range(epochs):
        model.train()
        epoch_losses = {k: 0.0 for k in LOSS_WEIGHTS}
        epoch_total = 0

        for batch in tqdm(train_loader, desc=f"Epoch {epoch+1}/{epochs}"):
            images = batch["image"].to(device, non_blocking=True)
            context = batch["context"].to(device, non_blocking=True)

            optimizer.zero_grad(set_to_none=True)
            outputs = model(images, context)

            # Compute per-task losses
            loss = torch.tensor(0.0, device=device)
            l_zone = zone_criterion(outputs["zone"], batch["zone"].to(device))
            l_cond = condition_criterion(outputs["condition"], batch["condition"].to(device))
            l_dmg = damage_criterion(outputs["damage"], batch["damage"].to(device))
            l_mod = mods_criterion(outputs["mods"], batch["mods"].to(device))
            l_price = price_criterion(outputs["price_tier"], batch["price_tier"].to(device))

            loss = (LOSS_WEIGHTS["zone"] * l_zone
                    + LOSS_WEIGHTS["condition"] * l_cond
                    + LOSS_WEIGHTS["damage"] * l_dmg
                    + LOSS_WEIGHTS["mods"] * l_mod
                    + LOSS_WEIGHTS["price_tier"] * l_price)

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            bs = images.size(0)
            epoch_losses["zone"] += l_zone.item() * bs
            epoch_losses["condition"] += l_cond.item() * bs
            epoch_losses["damage"] += l_dmg.item() * bs
            epoch_losses["mods"] += l_mod.item() * bs
            epoch_losses["price_tier"] += l_price.item() * bs
            epoch_total += bs

        scheduler.step()

        # ── Validate ─────────────────────────────────────────────────────
        model.eval()
        val_zone_correct = 0
        val_cond_correct = 0
        val_price_correct = 0
        val_damage_tp = torch.zeros(N_DAMAGE)
        val_damage_fp = torch.zeros(N_DAMAGE)
        val_damage_fn = torch.zeros(N_DAMAGE)
        val_total = 0

        with torch.no_grad():
            for batch in val_loader:
                images = batch["image"].to(device, non_blocking=True)
                context = batch["context"].to(device, non_blocking=True)
                outputs = model(images, context)

                bs = images.size(0)
                val_total += bs

                # Zone accuracy
                _, zone_pred = outputs["zone"].max(1)
                val_zone_correct += zone_pred.eq(batch["zone"].to(device)).sum().item()

                # Condition accuracy
                _, cond_pred = outputs["condition"].max(1)
                val_cond_correct += cond_pred.eq(batch["condition"].to(device)).sum().item()

                # Price tier accuracy
                _, price_pred = outputs["price_tier"].max(1)
                val_price_correct += price_pred.eq(batch["price_tier"].to(device)).sum().item()

                # Damage F1 (per-class)
                dmg_pred = (torch.sigmoid(outputs["damage"]) > 0.4).cpu().float()
                dmg_true = batch["damage"]
                val_damage_tp += (dmg_pred * dmg_true).sum(0)
                val_damage_fp += (dmg_pred * (1 - dmg_true)).sum(0)
                val_damage_fn += ((1 - dmg_pred) * dmg_true).sum(0)

        zone_acc = 100 * val_zone_correct / val_total
        cond_acc = 100 * val_cond_correct / val_total
        price_acc = 100 * val_price_correct / val_total

        # Damage macro F1
        dmg_precision = val_damage_tp / (val_damage_tp + val_damage_fp).clamp(min=1)
        dmg_recall = val_damage_tp / (val_damage_tp + val_damage_fn).clamp(min=1)
        dmg_f1 = 2 * dmg_precision * dmg_recall / (dmg_precision + dmg_recall).clamp(min=1e-6)
        macro_f1 = dmg_f1.mean().item() * 100

        # Composite score for best model selection
        composite = zone_acc * 0.2 + cond_acc * 0.2 + price_acc * 0.2 + macro_f1 * 0.4

        avg_losses = {k: v / epoch_total for k, v in epoch_losses.items()}
        print(f"Epoch {epoch+1}: zone={zone_acc:.1f}% cond={cond_acc:.1f}% "
              f"price={price_acc:.1f}% dmg_f1={macro_f1:.1f}% "
              f"composite={composite:.1f} lr={scheduler.get_last_lr()[0]:.6f}")
        print(f"  Losses: {' | '.join(f'{k}={v:.4f}' for k, v in avg_losses.items())}")

        # Per-damage-class F1
        dmg_details = []
        for i, flag in enumerate(DAMAGE_FLAGS):
            dmg_details.append(f"{flag}:{dmg_f1[i].item()*100:.0f}%")
        print(f"  Damage F1: {' | '.join(dmg_details)}")

        # Save best
        if composite > best_score:
            best_score = composite
            torch.save({
                "model_state_dict": model.state_dict(),
                "epoch": epoch,
                "composite_score": composite,
                "zone_acc": zone_acc,
                "cond_acc": cond_acc,
                "price_acc": price_acc,
                "damage_f1": macro_f1,
                "config": config,
            }, f"{checkpoint_dir}/best_model.pt")
            torch.save({
                "model_state_dict": model.state_dict(),
                "epoch": epoch,
                "composite_score": composite,
                "config": config,
            }, f"{MODELS_DIR}/yono_contextual_v3_best.pt")
            print(f"  *** New best: composite={composite:.1f} → saved ***")

        if (epoch + 1) % 5 == 0:
            torch.save({
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "epoch": epoch,
            }, f"{checkpoint_dir}/checkpoint_epoch{epoch+1}.pt")

    volume.commit()
    print(f"\nTraining complete! Best composite: {best_score:.1f}")
    return {"best_composite": best_score, "epochs": epochs, "samples": len(records), "run_id": run_id}


@app.function(
    image=image,
    timeout=600,
    memory=8192,
    volumes={"/data": volume},
)
def export_onnx_v3():
    """Export ContextualModelV3 to ONNX with multi-output."""
    import torch
    import torch.nn as nn
    import timm
    import json
    import onnxruntime as ort
    import numpy as np

    best_path = f"{MODELS_DIR}/yono_contextual_v3_best.pt"
    if not os.path.exists(best_path):
        raise RuntimeError(f"No trained model at {best_path}. Run --action train --version v3 first.")

    checkpoint = torch.load(best_path, map_location="cpu", weights_only=False)
    config = checkpoint["config"]
    print(f"Loaded v3 model from epoch {checkpoint['epoch']}")
    print(f"Composite score: {checkpoint.get('composite_score', 'N/A')}")

    # Rebuild model architecture
    class ContextualModelV3(nn.Module):
        def __init__(self):
            super().__init__()
            self.image_encoder = timm.create_model("efficientnet_b0", pretrained=False)
            img_dim = self.image_encoder.classifier.in_features
            self.image_encoder.classifier = nn.Identity()
            self.ymm_encoder = nn.Sequential(nn.Linear(FEAT_DIM_YMM, 128), nn.ReLU(), nn.Dropout(0.1))
            self.vehicle_encoder = nn.Sequential(nn.Linear(FEAT_DIM_VEHICLE, 32), nn.ReLU(), nn.Dropout(0.1))
            self.timeline_encoder = nn.Sequential(nn.Linear(FEAT_DIM_TIMELINE, 16), nn.ReLU())
            fused_dim = img_dim + 128 + 32 + 16
            self.trunk = nn.Sequential(
                nn.Linear(fused_dim, 768), nn.ReLU(), nn.Dropout(0.3),
                nn.Linear(768, 384), nn.ReLU(), nn.Dropout(0.2),
            )
            self.zone_head = nn.Linear(384, N_ZONES)
            self.condition_head = nn.Linear(384, N_CONDITION)
            self.damage_head = nn.Linear(384, N_DAMAGE)
            self.mods_head = nn.Linear(384, N_MODS)
            self.price_head = nn.Linear(384, N_PRICE_TIERS)

        def forward(self, image, context):
            ymm_ctx = context[:, :FEAT_DIM_YMM]
            veh_ctx = context[:, FEAT_DIM_YMM:FEAT_DIM_YMM + FEAT_DIM_VEHICLE]
            tl_ctx = context[:, FEAT_DIM_YMM + FEAT_DIM_VEHICLE:]
            img_feat = self.image_encoder(image)
            fused = torch.cat([img_feat, self.ymm_encoder(ymm_ctx),
                              self.vehicle_encoder(veh_ctx), self.timeline_encoder(tl_ctx)], dim=1)
            trunk_out = self.trunk(fused)
            return (self.zone_head(trunk_out), self.condition_head(trunk_out),
                    self.damage_head(trunk_out), self.mods_head(trunk_out),
                    self.price_head(trunk_out))

    model = ContextualModelV3()
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    dummy_image = torch.randn(1, 3, 224, 224)
    dummy_context = torch.randn(1, FEAT_DIM_TOTAL)
    onnx_path = f"{MODELS_DIR}/yono_contextual_v3.onnx"

    torch.onnx.export(
        model,
        (dummy_image, dummy_context),
        onnx_path,
        input_names=["image", "context"],
        output_names=["zone_logits", "condition_logits", "damage_logits", "mod_logits", "price_logits"],
        dynamic_axes={
            "image": {0: "batch"}, "context": {0: "batch"},
            "zone_logits": {0: "batch"}, "condition_logits": {0: "batch"},
            "damage_logits": {0: "batch"}, "mod_logits": {0: "batch"},
            "price_logits": {0: "batch"},
        },
        opset_version=17,
    )

    # Verify
    sess = ort.InferenceSession(onnx_path)
    results = sess.run(None, {"image": dummy_image.numpy(), "context": dummy_context.numpy()})
    print(f"\nONNX verification — outputs: {[r.shape for r in results]}")

    onnx_config = {
        **config,
        "onnx_path": "yono_contextual_v3.onnx",
        "input_names": ["image", "context"],
        "output_names": ["zone_logits", "condition_logits", "damage_logits", "mod_logits", "price_logits"],
    }
    with open(f"{MODELS_DIR}/yono_contextual_v3_config.json", "w") as f:
        json.dump(onnx_config, f, indent=2)

    onnx_size = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"\nExported: {onnx_path} ({onnx_size:.1f} MB)")

    volume.commit()
    return {"onnx_path": onnx_path, "size_mb": onnx_size}


# ─── ENTRYPOINT ─────────────────────────────────────────────────────

@app.local_entrypoint()
def main(
    action: str = "all",
    version: str = "v2",
    limit: int = 100000,
    epochs: int = 30,
    batch_size: int = 64,
    lr: float = 1e-4,
    task: str = "price_tier",
    context_dropout: float = 0.2,
):
    """
    YONO Contextual Training Pipeline

    Actions:
      stage  - Download images to Modal volume
      train  - Train on pre-staged data
      export - Export best model to ONNX
      all    - Stage + train + export

    Versions:
      v2 - Original: EfficientNet + 7D context → price_tier
      v3 - Contextual intelligence: EfficientNet + 133D Y/M/M context → multi-task
    """
    if version == "v3":
        if action in ("stage", "all"):
            print("=== V3 STAGING DATA ===")
            manifest = stage_data_v3.remote(limit=limit, images_per_vehicle=5)
            print(f"\nStaging result: {manifest}")

        if action in ("train", "all"):
            print("\n=== V3 TRAINING ===")
            result = train_v3.remote(
                epochs=epochs, batch_size=batch_size, lr=lr,
                context_dropout=context_dropout,
            )
            print(f"\nTraining result: {result}")

        if action in ("export", "all"):
            print("\n=== V3 EXPORTING ONNX ===")
            result = export_onnx_v3.remote()
            print(f"\nExport result: {result}")

    else:
        # V2 original pipeline
        if action in ("stage", "all"):
            print("=== STAGING DATA ===")
            manifest = stage_data.remote(limit=limit, images_per_vehicle=3)
            print(f"\nStaging result: {manifest}")

        if action in ("train", "all"):
            print("\n=== TRAINING ===")
            result = train.remote(
                epochs=epochs, batch_size=batch_size, lr=lr, output_task=task,
            )
            print(f"\nTraining result: {result}")

        if action in ("export", "all"):
            print("\n=== EXPORTING ONNX ===")
            result = export_onnx.remote()
            print(f"\nExport result: {result}")
