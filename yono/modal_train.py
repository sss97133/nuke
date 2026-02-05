"""
YONO Training on Modal - Stream 18M images from Supabase Storage
"""

import modal
import os

# Create Modal app
app = modal.App("yono-training")

# Define the container image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "torch",
        "torchvision",
        "timm",
        "pillow",
        "tqdm",
        "aiohttp",
        "supabase",
    ])
)

# Persistent volume for checkpoints and cache
volume = modal.Volume.from_name("yono-data", create_if_missing=True)

# Training configuration
TRAINING_CONFIG = {
    "model": "efficientnet_b0",
    "batch_size": 64,
    "epochs": 30,
    "learning_rate": 1e-4,
    "num_workers": 8,
    "min_samples_per_class": 20,
}


@app.function(
    image=image,
    gpu="A100",  # Options: "T4", "A10G", "A100", "H100"
    timeout=86400,  # 24 hours max
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
)
def train_make_classifier(
    limit: int = 1000000,
    epochs: int = 30,
    batch_size: int = 64,
    resume_from: str = None,
):
    """
    Train vehicle make classifier on Modal A100.
    Streams images directly from Supabase Storage.
    """
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader, IterableDataset
    from torchvision import transforms
    from PIL import Image
    import timm
    from tqdm import tqdm
    import json
    import io
    import asyncio
    import aiohttp
    from datetime import datetime
    from collections import Counter
    from supabase import create_client

    print("=" * 60)
    print("YONO Training on Modal")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Config: limit={limit}, epochs={epochs}, batch_size={batch_size}")
    print("=" * 60)

    # Setup device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # Connect to Supabase
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(supabase_url, supabase_key)

    print("\nFetching training data from Supabase...")

    # Fetch image records with vehicle info
    # Using pagination to handle large datasets
    all_records = []
    page_size = 1000  # Supabase limit
    offset = 0

    while len(all_records) < limit:
        response = supabase.table("vehicle_images").select(
            "id, image_url, vehicles!vehicle_images_vehicle_id_fkey(make, model, year)"
        ).range(offset, offset + page_size - 1).execute()

        if not response.data:
            break

        for row in response.data:
            if row.get("vehicles") and row["vehicles"].get("make") and row.get("image_url"):
                all_records.append({
                    "id": row["id"],
                    "url": row["image_url"],
                    "make": row["vehicles"]["make"],
                    "model": row["vehicles"].get("model"),
                    "year": row["vehicles"].get("year"),
                })

        offset += page_size
        if len(all_records) % 10000 == 0:
            print(f"  Fetched {len(all_records)} records...")

        if len(response.data) < page_size:
            break

    print(f"Total records: {len(all_records)}")

    # Count makes and filter rare ones
    make_counts = Counter(r["make"] for r in all_records)
    valid_makes = {m for m, c in make_counts.items() if c >= TRAINING_CONFIG["min_samples_per_class"]}
    filtered_records = [r for r in all_records if r["make"] in valid_makes]

    print(f"After filtering: {len(filtered_records)} records, {len(valid_makes)} makes")

    # Build label mapping
    sorted_makes = sorted(valid_makes)
    label_to_idx = {m: i for i, m in enumerate(sorted_makes)}
    idx_to_label = {i: m for m, i in label_to_idx.items()}
    num_classes = len(sorted_makes)

    print(f"Classes: {num_classes}")

    # Split train/val
    import random
    random.shuffle(filtered_records)
    split = int(len(filtered_records) * 0.9)
    train_records = filtered_records[:split]
    val_records = filtered_records[split:]

    print(f"Train: {len(train_records)}, Val: {len(val_records)}")

    # Transforms
    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(224),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    val_transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    # Dataset that fetches images on demand
    class StreamingImageDataset(Dataset):
        def __init__(self, records, label_to_idx, transform):
            self.records = records
            self.label_to_idx = label_to_idx
            self.transform = transform
            self.session = None

        def __len__(self):
            return len(self.records)

        def __getitem__(self, idx):
            record = self.records[idx]
            url = record["url"]
            label = self.label_to_idx[record["make"]]

            try:
                import urllib.request
                with urllib.request.urlopen(url, timeout=10) as response:
                    img_data = response.read()
                img = Image.open(io.BytesIO(img_data)).convert("RGB")
                if self.transform:
                    img = self.transform(img)
                return img, label
            except Exception as e:
                # Return black image on error
                return torch.zeros(3, 224, 224), label

    # Create datasets
    train_dataset = StreamingImageDataset(train_records, label_to_idx, train_transform)
    val_dataset = StreamingImageDataset(val_records, label_to_idx, val_transform)

    # DataLoaders with prefetching
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=TRAINING_CONFIG["num_workers"],
        pin_memory=True,
        drop_last=True,
        prefetch_factor=4,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=TRAINING_CONFIG["num_workers"],
        pin_memory=True,
        prefetch_factor=2,
    )

    # Model
    print(f"\nLoading model: {TRAINING_CONFIG['model']}")
    model = timm.create_model(TRAINING_CONFIG["model"], pretrained=True, num_classes=num_classes)

    # Load checkpoint if resuming
    if resume_from and os.path.exists(f"/data/{resume_from}"):
        print(f"Resuming from: /data/{resume_from}")
        checkpoint = torch.load(f"/data/{resume_from}")
        model.load_state_dict(checkpoint["model_state_dict"])

    model = model.to(device)

    # Use DataParallel if multiple GPUs
    if torch.cuda.device_count() > 1:
        print(f"Using {torch.cuda.device_count()} GPUs")
        model = nn.DataParallel(model)

    # Loss, optimizer, scheduler
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=TRAINING_CONFIG["learning_rate"], weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    # Mixed precision training
    scaler = torch.amp.GradScaler()

    # Training loop
    best_val_acc = 0
    history = []
    output_dir = f"/data/runs/{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    os.makedirs(output_dir, exist_ok=True)

    # Save config and labels
    with open(f"{output_dir}/config.json", "w") as f:
        json.dump(TRAINING_CONFIG, f, indent=2)
    with open(f"{output_dir}/labels.json", "w") as f:
        json.dump(idx_to_label, f, indent=2)

    print(f"\nOutput directory: {output_dir}")
    print("=" * 60)
    print("Starting training...")
    print("=" * 60)

    for epoch in range(1, epochs + 1):
        # Train
        model.train()
        train_loss, train_correct, train_total = 0, 0, 0

        pbar = tqdm(train_loader, desc=f"Epoch {epoch}/{epochs} [Train]")
        for images, labels in pbar:
            images, labels = images.to(device), labels.to(device)

            optimizer.zero_grad()

            with torch.amp.autocast(device_type="cuda"):
                outputs = model(images)
                loss = criterion(outputs, labels)

            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

            train_loss += loss.item()
            _, predicted = outputs.max(1)
            train_total += labels.size(0)
            train_correct += predicted.eq(labels).sum().item()

            pbar.set_postfix(
                loss=f"{train_loss/(pbar.n+1):.4f}",
                acc=f"{100.*train_correct/train_total:.1f}%"
            )

        # Validate
        model.eval()
        val_loss, val_correct, val_total = 0, 0, 0

        with torch.no_grad():
            for images, labels in tqdm(val_loader, desc=f"Epoch {epoch}/{epochs} [Val]"):
                images, labels = images.to(device), labels.to(device)

                with torch.amp.autocast(device_type="cuda"):
                    outputs = model(images)
                    loss = criterion(outputs, labels)

                val_loss += loss.item()
                _, predicted = outputs.max(1)
                val_total += labels.size(0)
                val_correct += predicted.eq(labels).sum().item()

        scheduler.step()

        # Calculate metrics
        train_acc = 100. * train_correct / train_total
        val_acc = 100. * val_correct / val_total

        print(f"\nEpoch {epoch}/{epochs}")
        print(f"  Train Loss: {train_loss/len(train_loader):.4f}, Train Acc: {train_acc:.2f}%")
        print(f"  Val Loss: {val_loss/len(val_loader):.4f}, Val Acc: {val_acc:.2f}%")

        history.append({
            "epoch": epoch,
            "train_loss": train_loss / len(train_loader),
            "train_acc": train_acc,
            "val_loss": val_loss / len(val_loader),
            "val_acc": val_acc,
        })

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            save_path = f"{output_dir}/best_model.pt"
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.module.state_dict() if hasattr(model, "module") else model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_acc": val_acc,
                "num_classes": num_classes,
            }, save_path)
            print(f"  -> Saved best model (val_acc: {val_acc:.2f}%)")

        # Save history
        with open(f"{output_dir}/history.json", "w") as f:
            json.dump(history, f, indent=2)

        # Save latest checkpoint
        torch.save({
            "epoch": epoch,
            "model_state_dict": model.module.state_dict() if hasattr(model, "module") else model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "val_acc": val_acc,
            "num_classes": num_classes,
        }, f"{output_dir}/latest.pt")

        # Commit volume to persist data
        volume.commit()

    print("\n" + "=" * 60)
    print("Training complete!")
    print(f"Best validation accuracy: {best_val_acc:.2f}%")
    print(f"Model saved to: {output_dir}/best_model.pt")
    print("=" * 60)

    return {
        "best_val_acc": best_val_acc,
        "output_dir": output_dir,
        "num_classes": num_classes,
        "total_samples": len(filtered_records),
    }


@app.function(
    image=image,
    volumes={"/data": volume},
)
def list_runs():
    """List all training runs."""
    import os
    runs_dir = "/data/runs"
    if not os.path.exists(runs_dir):
        return []

    runs = []
    for run in os.listdir(runs_dir):
        run_path = f"{runs_dir}/{run}"
        history_path = f"{run_path}/history.json"
        if os.path.exists(history_path):
            import json
            with open(history_path) as f:
                history = json.load(f)
            if history:
                runs.append({
                    "name": run,
                    "epochs": len(history),
                    "best_val_acc": max(h["val_acc"] for h in history),
                })
    return runs


@app.function(
    image=image,
    volumes={"/data": volume},
)
def download_model(run_name: str):
    """Download a trained model."""
    import os
    model_path = f"/data/runs/{run_name}/best_model.pt"
    labels_path = f"/data/runs/{run_name}/labels.json"

    if not os.path.exists(model_path):
        return None

    with open(model_path, "rb") as f:
        model_bytes = f.read()
    with open(labels_path, "rb") as f:
        labels_bytes = f.read()

    return {
        "model": model_bytes,
        "labels": labels_bytes,
    }


@app.local_entrypoint()
def main(
    action: str = "train",
    limit: int = 100000,
    epochs: int = 30,
    batch_size: int = 64,
):
    """
    YONO Training on Modal

    Usage:
        modal run modal_train.py --action train --limit 1000000 --epochs 30
        modal run modal_train.py --action list
        modal run modal_train.py --action download --run-name 20240204_123456
    """
    if action == "train":
        print(f"Starting training with limit={limit}, epochs={epochs}, batch_size={batch_size}")
        result = train_make_classifier.remote(
            limit=limit,
            epochs=epochs,
            batch_size=batch_size,
        )
        print(f"Training complete: {result}")

    elif action == "list":
        runs = list_runs.remote()
        print("Training runs:")
        for run in runs:
            print(f"  {run['name']}: {run['epochs']} epochs, best_val_acc={run['best_val_acc']:.2f}%")

    elif action == "download":
        # Would need run_name argument
        print("Use: modal run modal_train.py::download_model --run-name <name>")


if __name__ == "__main__":
    # For local testing
    print("Run with: modal run modal_train.py")
