#!/usr/bin/env python3
"""
YONO Classifier Training Script

Train a vehicle image classifier on the Nuke dataset.

Usage:
    python train_classifier.py --config configs/train_classifier.yaml
    python train_classifier.py --task make --epochs 20 --batch-size 64
"""

import argparse
import yaml
from pathlib import Path
from datetime import datetime
import json

import torch
import torch.nn as nn
import torch.optim as optim
from torch.optim.lr_scheduler import CosineAnnealingLR, StepLR, ReduceLROnPlateau
import timm
from tqdm import tqdm

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from data.loader import create_dataloaders, load_all_records


def get_device(config_device: str = "auto") -> torch.device:
    """Get the best available device"""
    if config_device == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        elif torch.backends.mps.is_available():
            return torch.device("mps")
        else:
            return torch.device("cpu")
    return torch.device(config_device)


def create_model(
    architecture: str,
    num_classes: int,
    pretrained: bool = True,
    dropout: float = 0.2,
) -> nn.Module:
    """Create a classifier model using timm"""
    model = timm.create_model(
        architecture,
        pretrained=pretrained,
        num_classes=num_classes,
        drop_rate=dropout,
    )
    return model


def train_epoch(
    model: nn.Module,
    loader,
    criterion: nn.Module,
    optimizer: optim.Optimizer,
    device: torch.device,
    scaler=None,
    log_every: int = 100,
) -> dict:
    """Train for one epoch"""
    model.train()
    total_loss = 0
    correct = 0
    total = 0

    pbar = tqdm(loader, desc="Training")
    for batch_idx, (images, labels) in enumerate(pbar):
        # Skip invalid labels
        valid_mask = labels >= 0
        if not valid_mask.any():
            continue

        images = images[valid_mask].to(device)
        labels = labels[valid_mask].to(device)

        optimizer.zero_grad()

        # Mixed precision training
        if scaler is not None:
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

        if batch_idx % log_every == 0:
            pbar.set_postfix({
                'loss': f'{loss.item():.4f}',
                'acc': f'{100. * correct / total:.2f}%'
            })

    return {
        'loss': total_loss / len(loader),
        'accuracy': correct / total if total > 0 else 0,
    }


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader,
    criterion: nn.Module,
    device: torch.device,
) -> dict:
    """Evaluate the model"""
    model.eval()
    total_loss = 0
    correct = 0
    total = 0

    for images, labels in tqdm(loader, desc="Evaluating"):
        valid_mask = labels >= 0
        if not valid_mask.any():
            continue

        images = images[valid_mask].to(device)
        labels = labels[valid_mask].to(device)

        outputs = model(images)
        loss = criterion(outputs, labels)

        total_loss += loss.item()
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

    return {
        'loss': total_loss / len(loader) if len(loader) > 0 else 0,
        'accuracy': correct / total if total > 0 else 0,
    }


def save_checkpoint(
    model: nn.Module,
    optimizer: optim.Optimizer,
    epoch: int,
    metrics: dict,
    label_mapping: dict,
    path: Path,
):
    """Save a training checkpoint"""
    torch.save({
        'epoch': epoch,
        'model_state_dict': model.state_dict(),
        'optimizer_state_dict': optimizer.state_dict(),
        'metrics': metrics,
        'label_mapping': label_mapping,
    }, path)
    print(f"Saved checkpoint to {path}")


def main():
    parser = argparse.ArgumentParser(description="Train YONO classifier")
    parser.add_argument("--config", type=Path, help="Path to config YAML")
    parser.add_argument("--task", type=str, default="make", help="Classification task")
    parser.add_argument("--epochs", type=int, default=50, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--model", type=str, default="efficientnet_b0", help="Model architecture")
    parser.add_argument("--data-dir", type=Path, default=Path("/Users/skylar/nuke/training-data/images"))
    parser.add_argument("--output-dir", type=Path, default=Path("/Users/skylar/nuke/yono/outputs"))
    parser.add_argument("--resume", type=Path, help="Resume from checkpoint")
    args = parser.parse_args()

    # Load config if provided
    config = {}
    if args.config and args.config.exists():
        with open(args.config) as f:
            config = yaml.safe_load(f)

    # Merge CLI args with config (CLI takes precedence)
    task = args.task or config.get("task", "make")
    epochs = args.epochs or config.get("training", {}).get("epochs", 50)
    batch_size = args.batch_size or config.get("data", {}).get("batch_size", 32)
    lr = args.lr or config.get("training", {}).get("learning_rate", 0.001)
    architecture = args.model or config.get("model", {}).get("architecture", "efficientnet_b0")
    data_dir = args.data_dir or Path(config.get("data", {}).get("train_dir", "/Users/skylar/nuke/training-data/images"))
    output_dir = args.output_dir or Path(config.get("logging", {}).get("output_dir", "/Users/skylar/nuke/yono/outputs"))
    cache_dir = Path(config.get("data", {}).get("cache_dir", "/Users/skylar/nuke/yono/.image_cache"))

    # Setup
    output_dir.mkdir(parents=True, exist_ok=True)
    run_name = f"{task}_{architecture}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir = output_dir / run_name
    run_dir.mkdir(parents=True, exist_ok=True)

    print(f"YONO Classifier Training")
    print(f"========================")
    print(f"Task: {task}")
    print(f"Model: {architecture}")
    print(f"Data: {data_dir}")
    print(f"Output: {run_dir}")
    print()

    # Device
    device = get_device(config.get("hardware", {}).get("device", "auto"))
    print(f"Device: {device}")

    # Data
    print(f"Loading data from {data_dir}...")
    train_loader, val_loader = create_dataloaders(
        data_dir=data_dir,
        task=task,
        batch_size=batch_size,
        num_workers=config.get("data", {}).get("num_workers", 4),
        cache_dir=cache_dir,
    )

    num_classes = train_loader.dataset.num_classes
    label_mapping = train_loader.dataset.idx_to_label
    print(f"Classes: {num_classes}")

    # Save label mapping
    with open(run_dir / "labels.json", "w") as f:
        json.dump(label_mapping, f, indent=2)

    # Model
    print(f"Creating model: {architecture}")
    model = create_model(
        architecture=architecture,
        num_classes=num_classes,
        pretrained=config.get("model", {}).get("pretrained", True),
        dropout=config.get("model", {}).get("dropout", 0.2),
    )
    model = model.to(device)

    # Resume from checkpoint
    start_epoch = 0
    if args.resume and args.resume.exists():
        print(f"Resuming from {args.resume}")
        checkpoint = torch.load(args.resume, map_location=device)
        model.load_state_dict(checkpoint['model_state_dict'])
        start_epoch = checkpoint['epoch'] + 1

    # Training setup
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(
        model.parameters(),
        lr=lr,
        weight_decay=config.get("training", {}).get("weight_decay", 0.01),
    )

    scheduler_type = config.get("training", {}).get("scheduler", "cosine")
    if scheduler_type == "cosine":
        scheduler = CosineAnnealingLR(optimizer, T_max=epochs)
    elif scheduler_type == "step":
        scheduler = StepLR(optimizer, step_size=10, gamma=0.1)
    else:
        scheduler = ReduceLROnPlateau(optimizer, mode='max', patience=5)

    # Mixed precision
    scaler = None
    if config.get("hardware", {}).get("mixed_precision", True) and device.type == "cuda":
        scaler = torch.cuda.amp.GradScaler()

    # Training loop
    best_accuracy = 0
    history = []

    print(f"\nStarting training for {epochs} epochs...")
    print()

    for epoch in range(start_epoch, epochs):
        print(f"Epoch {epoch + 1}/{epochs}")

        # Train
        train_metrics = train_epoch(
            model, train_loader, criterion, optimizer, device, scaler,
            log_every=config.get("logging", {}).get("log_every", 100),
        )

        # Evaluate
        val_metrics = evaluate(model, val_loader, criterion, device)

        # Update scheduler
        if scheduler_type == "plateau":
            scheduler.step(val_metrics['accuracy'])
        else:
            scheduler.step()

        # Log
        print(f"  Train Loss: {train_metrics['loss']:.4f}, Acc: {train_metrics['accuracy']*100:.2f}%")
        print(f"  Val Loss: {val_metrics['loss']:.4f}, Acc: {val_metrics['accuracy']*100:.2f}%")
        print()

        history.append({
            'epoch': epoch + 1,
            'train_loss': train_metrics['loss'],
            'train_accuracy': train_metrics['accuracy'],
            'val_loss': val_metrics['loss'],
            'val_accuracy': val_metrics['accuracy'],
            'lr': optimizer.param_groups[0]['lr'],
        })

        # Save history
        with open(run_dir / "history.json", "w") as f:
            json.dump(history, f, indent=2)

        # Save best model
        if val_metrics['accuracy'] > best_accuracy:
            best_accuracy = val_metrics['accuracy']
            save_checkpoint(
                model, optimizer, epoch,
                val_metrics, label_mapping,
                run_dir / "best_model.pt"
            )

        # Save periodic checkpoint
        save_every = config.get("logging", {}).get("save_every", 5)
        if (epoch + 1) % save_every == 0:
            save_checkpoint(
                model, optimizer, epoch,
                val_metrics, label_mapping,
                run_dir / f"checkpoint_epoch_{epoch+1}.pt"
            )

    # Save final model
    save_checkpoint(
        model, optimizer, epochs - 1,
        val_metrics, label_mapping,
        run_dir / "final_model.pt"
    )

    print(f"\nTraining complete!")
    print(f"Best validation accuracy: {best_accuracy*100:.2f}%")
    print(f"Outputs saved to: {run_dir}")


if __name__ == "__main__":
    main()
