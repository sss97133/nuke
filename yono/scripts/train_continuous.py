#!/usr/bin/env python3
"""
Continuous training loop - downloads more images, trains, repeats.
Designed to run all day unattended.
"""

import os
import sys
import json
import time
import hashlib
import subprocess
import asyncio
import aiohttp
from pathlib import Path
from datetime import datetime
from collections import Counter

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
LOG_FILE = YONO_DIR / "training.log"

# Training phases - progressively larger
PHASES = [
    {"name": "phase1_warmup", "target_images": 15000, "epochs": 10, "batch_size": 32, "lr": 1e-4},
    {"name": "phase2_expand", "target_images": 30000, "epochs": 15, "batch_size": 32, "lr": 5e-5},
    {"name": "phase3_full", "target_images": 50000, "epochs": 20, "batch_size": 48, "lr": 3e-5},
    {"name": "phase4_refine", "target_images": 75000, "epochs": 25, "batch_size": 48, "lr": 1e-5},
    {"name": "phase5_final", "target_images": 100000, "epochs": 30, "batch_size": 64, "lr": 5e-6},
]

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + "\n")


def url_to_cache_path(url: str) -> Path:
    url_hash = hashlib.md5(url.encode()).hexdigest()
    ext = url.split('.')[-1].split('?')[0][:4]
    if ext not in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
        ext = 'jpg'
    return CACHE_DIR / f"{url_hash}.{ext}"


def load_all_records():
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


def get_uncached_urls(records, limit=None):
    """Get URLs that haven't been downloaded yet."""
    uncached = []
    for r in records:
        url = r.get('image_url')
        if url and not url_to_cache_path(url).exists():
            uncached.append(url)
            if limit and len(uncached) >= limit:
                break
    return uncached


async def download_image(session, url, semaphore):
    """Download a single image."""
    async with semaphore:
        try:
            cache_path = url_to_cache_path(url)
            if cache_path.exists():
                return True

            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    content = await resp.read()
                    cache_path.write_bytes(content)
                    return True
        except:
            pass
        return False


async def download_batch(urls, concurrency=100):
    """Download multiple images concurrently."""
    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency, force_close=True)

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [download_image(session, url, semaphore) for url in urls]
        results = []
        for coro in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="Downloading"):
            result = await coro
            results.append(result)
        return sum(results)


def download_images_sync(records, target_count):
    """Download images until we have target_count cached."""
    current_count = len(list(CACHE_DIR.glob("*")))

    if current_count >= target_count:
        log(f"Already have {current_count} images cached (target: {target_count})")
        return current_count

    needed = target_count - current_count
    log(f"Need {needed} more images (have {current_count}, want {target_count})")

    urls = get_uncached_urls(records, limit=needed + 1000)  # Get extra in case of failures

    if not urls:
        log("No more URLs to download")
        return current_count

    log(f"Downloading up to {len(urls)} images...")
    downloaded = asyncio.run(download_batch(urls[:needed + 500], concurrency=100))

    new_count = len(list(CACHE_DIR.glob("*")))
    log(f"Downloaded {downloaded} images. Total cached: {new_count}")
    return new_count


def filter_cached_records(records):
    """Keep only records with cached images."""
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
    def __init__(self, records, task="make", transform=None, min_samples=5):
        self.task = task
        self.transform = transform

        # Build label mapping
        labels = [self._get_label(r) for r in records]
        label_counts = Counter(l for l in labels if l)
        valid_labels = {l for l, c in label_counts.items() if c >= min_samples}

        self.filtered_records = [r for r in records if self._get_label(r) in valid_labels]
        unique_labels = sorted(valid_labels)
        self.label_to_idx = {l: i for i, l in enumerate(unique_labels)}
        self.idx_to_label = {i: l for l, i in self.label_to_idx.items()}

    def _get_label(self, record):
        if self.task == "make":
            return record.get("make")
        elif self.task == "make_model":
            make, model = record.get("make"), record.get("model")
            return f"{make} {model}" if make and model else None
        elif self.task == "year":
            year = record.get("year")
            return f"{(year // 10) * 10}s" if year else None
        elif self.task == "category":
            return record.get("category")
        return None

    def __len__(self):
        return len(self.filtered_records)

    def __getitem__(self, idx):
        record = self.filtered_records[idx]
        try:
            img = Image.open(record['_cache_path']).convert('RGB')
            if self.transform:
                img = self.transform(img)
        except:
            img = torch.zeros(3, 224, 224)

        label_idx = self.label_to_idx.get(self._get_label(record), 0)
        return img, label_idx


def train_epoch(model, loader, criterion, optimizer, device, scaler=None):
    model.train()
    total_loss, correct, total = 0, 0, 0

    pbar = tqdm(loader, desc="Training", leave=False)
    for images, labels in pbar:
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()

        if scaler:  # Mixed precision
            with torch.cuda.amp.autocast():
                outputs = model(images)
                loss = criterion(outputs, labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

        total_loss += loss.item()
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

        pbar.set_postfix(loss=f"{total_loss/(pbar.n+1):.4f}", acc=f"{100.*correct/total:.1f}%")

    return total_loss / len(loader), 100. * correct / total


def validate(model, loader, criterion, device):
    model.eval()
    total_loss, correct, total = 0, 0, 0

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


def run_training_phase(phase, all_records, device, prev_checkpoint=None):
    """Run a single training phase."""
    log(f"\n{'='*60}")
    log(f"PHASE: {phase['name']}")
    log(f"Target images: {phase['target_images']}, Epochs: {phase['epochs']}")
    log(f"{'='*60}")

    # Download images for this phase
    download_images_sync(all_records, phase['target_images'])

    # Filter to cached records
    cached_records = filter_cached_records(all_records)
    log(f"Cached records available: {len(cached_records)}")

    if len(cached_records) < 1000:
        log("Not enough cached images, skipping phase")
        return None

    # Transforms
    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(224),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3),
        transforms.RandomRotation(15),
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
    split_idx = int(len(cached_records) * 0.9)
    train_records = cached_records[:split_idx]
    val_records = cached_records[split_idx:]

    train_dataset = CachedImageDataset(train_records, task="make", transform=train_transform)
    val_dataset = CachedImageDataset(val_records, task="make", transform=val_transform)
    val_dataset.label_to_idx = train_dataset.label_to_idx
    val_dataset.idx_to_label = train_dataset.idx_to_label

    num_classes = len(train_dataset.label_to_idx)
    log(f"Classes: {num_classes}, Train: {len(train_dataset)}, Val: {len(val_dataset)}")

    train_loader = DataLoader(train_dataset, batch_size=phase['batch_size'],
                             shuffle=True, num_workers=4, drop_last=True)
    val_loader = DataLoader(val_dataset, batch_size=phase['batch_size'],
                           shuffle=False, num_workers=4)

    # Model
    model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=num_classes)

    # Load previous checkpoint if available
    if prev_checkpoint and Path(prev_checkpoint).exists():
        log(f"Loading weights from: {prev_checkpoint}")
        checkpoint = torch.load(prev_checkpoint, map_location='cpu')
        # Only load if num_classes matches
        if checkpoint.get('num_classes') == num_classes:
            model.load_state_dict(checkpoint['model_state_dict'], strict=False)

    model = model.to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=phase['lr'], weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=phase['epochs'])

    # Output directory
    run_dir = OUTPUT_DIR / f"{phase['name']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir.mkdir(parents=True, exist_ok=True)

    # Save config
    with open(run_dir / "config.json", 'w') as f:
        json.dump(phase, f, indent=2)
    with open(run_dir / "labels.json", 'w') as f:
        json.dump(train_dataset.idx_to_label, f, indent=2)

    best_val_acc = 0
    history = []

    for epoch in range(1, phase['epochs'] + 1):
        train_loss, train_acc = train_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        scheduler.step()

        log(f"Epoch {epoch}/{phase['epochs']}: train_acc={train_acc:.1f}%, val_acc={val_acc:.1f}%")

        history.append({
            "epoch": epoch, "train_loss": train_loss, "train_acc": train_acc,
            "val_loss": val_loss, "val_acc": val_acc
        })

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                'epoch': epoch, 'model_state_dict': model.state_dict(),
                'val_acc': val_acc, 'num_classes': num_classes, 'phase': phase['name']
            }, run_dir / "best_model.pt")

        with open(run_dir / "history.json", 'w') as f:
            json.dump(history, f, indent=2)

    log(f"Phase complete! Best val_acc: {best_val_acc:.1f}%")
    log(f"Model saved: {run_dir / 'best_model.pt'}")

    return str(run_dir / "best_model.pt")


def main():
    log("\n" + "="*60)
    log("YONO CONTINUOUS TRAINING")
    log(f"Started: {datetime.now().isoformat()}")
    log("="*60)

    # Device
    if torch.backends.mps.is_available():
        device = torch.device("mps")
        log("Using Apple Silicon GPU (MPS)")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
        log("Using CUDA GPU")
    else:
        device = torch.device("cpu")
        log("Using CPU")

    # Load all records
    log("Loading all records...")
    all_records = load_all_records()
    log(f"Total records: {len(all_records)}")

    # Run phases
    prev_checkpoint = None

    for phase in PHASES:
        try:
            checkpoint = run_training_phase(phase, all_records, device, prev_checkpoint)
            if checkpoint:
                prev_checkpoint = checkpoint
        except Exception as e:
            log(f"Phase {phase['name']} failed: {e}")
            import traceback
            traceback.print_exc()
            continue

    log("\n" + "="*60)
    log("ALL PHASES COMPLETE")
    log(f"Finished: {datetime.now().isoformat()}")
    log("="*60)

    # Summary
    log("\nFinal models:")
    for p in OUTPUT_DIR.glob("phase*"):
        best = p / "best_model.pt"
        if best.exists():
            log(f"  {p.name}: {best}")


if __name__ == "__main__":
    main()
