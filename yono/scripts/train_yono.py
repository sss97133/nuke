#!/usr/bin/env python3
"""
Train YONO - Custom YOLOv8 classifier for vehicle identification

Prerequisites:
  pip install ultralytics

Usage:
  python train_yono.py              # Train from scratch
  python train_yono.py --resume     # Resume training
  python train_yono.py --epochs 50  # Custom epochs
"""

import argparse
from pathlib import Path
from datetime import datetime

try:
    from ultralytics import YOLO
except ImportError:
    print("Install ultralytics: pip install ultralytics")
    exit(1)

YONO_DIR = Path("/Users/skylar/nuke/yono")
DATASET_DIR = YONO_DIR / "dataset"
MODELS_DIR = YONO_DIR / "models"

def main():
    parser = argparse.ArgumentParser(description="Train YONO")
    parser.add_argument("--epochs", type=int, default=100, help="Training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=224, help="Image size")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--base", default="yolov8n-cls.pt", help="Base model")
    args = parser.parse_args()

    MODELS_DIR.mkdir(exist_ok=True)

    # Check dataset
    train_dir = DATASET_DIR / "train"
    if not train_dir.exists():
        print("No training data found!")
        print("Run: python export_training_data.py first")
        return

    # Count images
    classes = [d.name for d in train_dir.iterdir() if d.is_dir()]
    total = sum(len(list((train_dir / c).glob("*"))) for c in classes)
    print(f"Dataset: {total} images across {len(classes)} classes")
    print(f"Classes: {classes}\n")

    if total < 10:
        print("Need more training data! At least 10 labeled images.")
        print("Label more photos via SMS review or manual assignment.")
        return

    # Load base model
    if args.resume:
        # Find latest checkpoint
        checkpoints = list(MODELS_DIR.glob("yono_*/weights/last.pt"))
        if checkpoints:
            latest = max(checkpoints, key=lambda p: p.stat().st_mtime)
            print(f"Resuming from: {latest}")
            model = YOLO(str(latest))
        else:
            print("No checkpoint found, starting fresh")
            model = YOLO(args.base)
    else:
        print(f"Starting from base model: {args.base}")
        model = YOLO(args.base)

    # Train
    run_name = f"yono_{datetime.now().strftime('%Y%m%d_%H%M')}"

    print(f"\nTraining YONO...")
    print(f"  Epochs: {args.epochs}")
    print(f"  Batch: {args.batch}")
    print(f"  Image size: {args.imgsz}")
    print(f"  Run: {run_name}\n")

    results = model.train(
        data=str(DATASET_DIR),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        project=str(MODELS_DIR),
        name=run_name,
        patience=20,  # Early stopping
        save=True,
        plots=True,
    )

    # Save best model as yono.pt
    best_model = MODELS_DIR / run_name / "weights" / "best.pt"
    if best_model.exists():
        final_path = MODELS_DIR / "yono.pt"
        import shutil
        shutil.copy(best_model, final_path)
        print(f"\n✓ YONO trained! Model saved to: {final_path}")

    print("\nNext steps:")
    print("  python inference_yono.py image.jpg  # Test inference")
    print("  python deploy_yono.py               # Deploy to cloud")

if __name__ == "__main__":
    main()
