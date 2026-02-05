#!/usr/bin/env python3
"""
Overnight training script - optimized for unattended runs.
Uses only pre-downloaded images to avoid network bottleneck.
"""

import os
import sys
import json
import time
import hashlib
from pathlib import Path
from datetime import datetime

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import timm
from tqdm import tqdm

# Paths
YONO_DIR = Path("/Users/skylar/nuke/yono")
DATA_DIR = Path("/Users/skylar/nuke/training-data/images")
CACHE_DIR = YONO_DIR / ".image_cache"
OUTPUT_DIR = YONO_DIR / "outputs"

# Training config
CONFIG = {
    "task": "make",
    "model": "efficientnet_b0",
    "epochs": 20,
    "batch_size": 32,
    "learning_rate": 1e-4,
    "weight_decay": 1e-4,
    "num_workers": 4,
    "min_samples_per_class": 5,  # Skip rare classes
    "val_split": 0.1,
}


def url_to_cache_path(url: str) -> Path:
    """Convert URL to cache file path."""
    url_hash = hashlib.md5(url.encode()).hexdigest()
    ext = url.split('.')[-1].split('?')[0][:4]
    if ext not in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
        ext = 'jpg'
    return CACHE_DIR / f"{url_hash}.{ext}"


def load_records():
    """Load all training records from JSONL files."""
    records = []
    for jsonl_file in sorted(DATA_DIR.glob("*.jsonl")):
        with open(jsonl_file, 'r') as f:
            for line in f:
                try:
                    record = json.loads(line.strip())
                    records.append(record)
                except:
                    pass
    return records


def filter_cached_records(records):
    """Keep only records with images already downloaded."""
    cached = []
    for r in records:
        url = r.get('image_url')
        if url:
            cache_path = url_to_cache_path(url)
            if cache_path.exists():
                r['_cache_path'] = str(cache_path)
                cached.append(r)
    return cached


class CachedImageDataset(Dataset):
    """Dataset that ONLY uses pre-cached images (no network)."""

    def __init__(self, records, task="make", transform=None):
        self.records = records
        self.task = task
        self.transform = transform

        # Build label mapping
        labels = []
        for r in records:
            label = self._get_label(r)
            if label:
                labels.append(label)

        # Count label frequencies
        from collections import Counter
        label_counts = Counter(labels)

        # Keep only classes with enough samples
        valid_labels = {l for l, c in label_counts.items()
                       if c >= CONFIG["min_samples_per_class"]}

        # Filter records to valid labels
        self.filtered_records = []
        for r in records:
            label = self._get_label(r)
            if label and label in valid_labels:
                self.filtered_records.append(r)

        # Build final label mapping
        unique_labels = sorted(valid_labels)
        self.label_to_idx = {l: i for i, l in enumerate(unique_labels)}
        self.idx_to_label = {i: l for l, i in self.label_to_idx.items()}

        print(f"Dataset: {len(self.filtered_records)} images, {len(unique_labels)} classes")

    def _get_label(self, record):
        if self.task == "make":
            return record.get("make")
        elif self.task == "make_model":
            make = record.get("make")
            model = record.get("model")
            if make and model:
                return f"{make} {model}"
        elif self.task == "year":
            year = record.get("year")
            if year:
                decade = (year // 10) * 10
                return f"{decade}s"
        elif self.task == "category":
            return record.get("category")
        return None

    def __len__(self):
        return len(self.filtered_records)

    def __getitem__(self, idx):
        record = self.filtered_records[idx]
        cache_path = record['_cache_path']

        try:
            img = Image.open(cache_path).convert('RGB')
            if self.transform:
                img = self.transform(img)
        except Exception as e:
            # Return a black image on error
            img = torch.zeros(3, 224, 224)

        label = self._get_label(record)
        label_idx = self.label_to_idx.get(label, 0)

        return img, label_idx


def train_epoch(model, loader, criterion, optimizer, device, epoch):
    model.train()
    total_loss = 0
    correct = 0
    total = 0

    pbar = tqdm(loader, desc=f"Epoch {epoch}")
    for batch_idx, (images, labels) in enumerate(pbar):
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item()
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

        acc = 100. * correct / total
        pbar.set_postfix(loss=f"{total_loss/(batch_idx+1):.4f}", acc=f"{acc:.2f}%")

    return total_loss / len(loader), 100. * correct / total


def validate(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    correct = 0
    total = 0

    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            outputs = model(images)
            loss = criterion(outputs, labels)

            total_loss += loss.item()
            _, predicted = outputs.max(1)
            total += labels.size(0)
            correct += predicted.eq(labels).sum().item()

    return total_loss / len(loader), 100. * correct / total


def main():
    print("=" * 60)
    print("YONO Overnight Training")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 60)

    # Device
    if torch.backends.mps.is_available():
        device = torch.device("mps")
        print("Using Apple Silicon GPU (MPS)")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
        print("Using CUDA GPU")
    else:
        device = torch.device("cpu")
        print("Using CPU")

    # Wait for images to be downloaded
    print("\nChecking cached images...")
    while True:
        cached_count = len(list(CACHE_DIR.glob("*")))
        print(f"  Cached images: {cached_count}")
        if cached_count >= 5000:
            break
        print("  Waiting for more images to download...")
        time.sleep(60)

    # Load data
    print("\nLoading records...")
    all_records = load_records()
    print(f"  Total records in JSONL: {len(all_records)}")

    cached_records = filter_cached_records(all_records)
    print(f"  Records with cached images: {len(cached_records)}")

    # Transforms
    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(224),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    val_transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    # Split data
    import random
    random.shuffle(cached_records)
    split_idx = int(len(cached_records) * (1 - CONFIG["val_split"]))
    train_records = cached_records[:split_idx]
    val_records = cached_records[split_idx:]

    # Create datasets
    train_dataset = CachedImageDataset(train_records, task=CONFIG["task"], transform=train_transform)
    val_dataset = CachedImageDataset(val_records, task=CONFIG["task"], transform=val_transform)

    # Sync label mappings
    val_dataset.label_to_idx = train_dataset.label_to_idx
    val_dataset.idx_to_label = train_dataset.idx_to_label

    # DataLoaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=CONFIG["batch_size"],
        shuffle=True,
        num_workers=CONFIG["num_workers"],
        drop_last=True
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=CONFIG["batch_size"],
        shuffle=False,
        num_workers=CONFIG["num_workers"]
    )

    num_classes = len(train_dataset.label_to_idx)
    print(f"\nClasses: {num_classes}")
    print(f"Train samples: {len(train_dataset)}")
    print(f"Val samples: {len(val_dataset)}")

    # Model
    print(f"\nLoading model: {CONFIG['model']}")
    model = timm.create_model(CONFIG["model"], pretrained=True, num_classes=num_classes)
    model = model.to(device)

    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(
        model.parameters(),
        lr=CONFIG["learning_rate"],
        weight_decay=CONFIG["weight_decay"]
    )
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=CONFIG["epochs"])

    # Output directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = OUTPUT_DIR / f"{CONFIG['task']}_{CONFIG['model']}_{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    # Save config
    with open(run_dir / "config.json", 'w') as f:
        json.dump(CONFIG, f, indent=2)

    # Save labels
    with open(run_dir / "labels.json", 'w') as f:
        json.dump(train_dataset.idx_to_label, f, indent=2)

    # Training loop
    print(f"\n{'='*60}")
    print("Starting training...")
    print(f"Output: {run_dir}")
    print(f"{'='*60}\n")

    best_val_acc = 0
    history = []

    for epoch in range(1, CONFIG["epochs"] + 1):
        train_loss, train_acc = train_epoch(model, train_loader, criterion, optimizer, device, epoch)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        scheduler.step()

        print(f"\nEpoch {epoch}/{CONFIG['epochs']}")
        print(f"  Train Loss: {train_loss:.4f}, Train Acc: {train_acc:.2f}%")
        print(f"  Val Loss: {val_loss:.4f}, Val Acc: {val_acc:.2f}%")

        history.append({
            "epoch": epoch,
            "train_loss": train_loss,
            "train_acc": train_acc,
            "val_loss": val_loss,
            "val_acc": val_acc,
            "lr": scheduler.get_last_lr()[0]
        })

        # Save checkpoint
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_acc': val_acc,
                'config': CONFIG,
            }, run_dir / "best_model.pt")
            print(f"  -> Saved best model (val_acc: {val_acc:.2f}%)")

        # Save history
        with open(run_dir / "history.json", 'w') as f:
            json.dump(history, f, indent=2)

        # Save latest checkpoint
        torch.save({
            'epoch': epoch,
            'model_state_dict': model.state_dict(),
            'optimizer_state_dict': optimizer.state_dict(),
            'val_acc': val_acc,
            'config': CONFIG,
        }, run_dir / "latest_checkpoint.pt")

    print(f"\n{'='*60}")
    print("Training complete!")
    print(f"Best validation accuracy: {best_val_acc:.2f}%")
    print(f"Model saved to: {run_dir / 'best_model.pt'}")
    print(f"Finished: {datetime.now().isoformat()}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
