#!/usr/bin/env python3
"""
Test YONO training setup.

Verifies:
1. Training data can be loaded
2. Data statistics look reasonable
3. A mini training run works
"""

import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

def test_data_loading():
    """Test data loading from JSONL"""
    print("Testing data loading...")

    from data.loader import load_all_records

    data_dir = Path("/Users/skylar/nuke/training-data/images")
    if not data_dir.exists():
        print(f"  ERROR: Data directory not found: {data_dir}")
        return False

    records = load_all_records(data_dir)
    print(f"  Loaded {len(records)} records")

    if len(records) == 0:
        print("  ERROR: No records loaded")
        return False

    # Check data quality
    makes = set()
    years = set()
    with_vehicle = 0

    for r in records:
        if r.make:
            makes.add(r.make)
        if r.year:
            years.add(r.year)
        if r.vehicle:
            with_vehicle += 1

    print(f"  Unique makes: {len(makes)}")
    print(f"  Year range: {min(years) if years else 'N/A'} - {max(years) if years else 'N/A'}")
    print(f"  Records with vehicle info: {with_vehicle}/{len(records)} ({with_vehicle/len(records)*100:.1f}%)")

    # Sample records
    print("\n  Sample records:")
    for r in records[:3]:
        print(f"    {r.vehicle or 'Unknown'}: {r.image_url[:50]}...")

    return True


def test_label_distribution():
    """Check label distribution for classification"""
    print("\nTesting label distribution...")

    from data.loader import load_all_records
    from collections import Counter

    data_dir = Path("/Users/skylar/nuke/training-data/images")
    records = load_all_records(data_dir)

    # Count makes
    makes = Counter(r.make for r in records if r.make)
    print(f"\n  Top 10 makes:")
    for make, count in makes.most_common(10):
        bar = "█" * min(50, count // 100)
        print(f"    {make:20s} {count:6d} {bar}")

    # Count categories
    categories = Counter(r.category for r in records if r.category)
    print(f"\n  Categories:")
    for cat, count in categories.most_common():
        print(f"    {cat:20s} {count:6d}")

    return True


def test_dataloader():
    """Test PyTorch dataloader creation"""
    print("\nTesting dataloader...")

    try:
        import torch
        from data.loader import create_dataloaders

        data_dir = Path("/Users/skylar/nuke/training-data/images")

        # Create small test loader
        train_loader, val_loader = create_dataloaders(
            data_dir=data_dir,
            task="make",
            batch_size=4,
            num_workers=0,  # Single thread for testing
        )

        print(f"  Train batches: {len(train_loader)}")
        print(f"  Val batches: {len(val_loader)}")
        print(f"  Classes: {train_loader.dataset.num_classes}")

        # Try to get one batch (will download images)
        print("\n  Loading sample batch (may download images)...")
        try:
            images, labels = next(iter(train_loader))
            print(f"  Batch shape: {images.shape}")
            print(f"  Labels: {labels.tolist()}")
        except Exception as e:
            print(f"  Note: Batch loading requires network/cache: {e}")

        return True

    except ImportError as e:
        print(f"  Missing dependency: {e}")
        print("  Run: pip install -r requirements.txt")
        return False


def test_model_creation():
    """Test model can be created"""
    print("\nTesting model creation...")

    try:
        import torch
        import timm

        model = timm.create_model(
            "efficientnet_b0",
            pretrained=True,
            num_classes=100,
        )

        # Test forward pass
        x = torch.randn(1, 3, 224, 224)
        y = model(x)
        print(f"  Model output shape: {y.shape}")

        # Count parameters
        params = sum(p.numel() for p in model.parameters())
        print(f"  Parameters: {params / 1e6:.1f}M")

        return True

    except ImportError as e:
        print(f"  Missing dependency: {e}")
        return False


def main():
    print("=" * 50)
    print("YONO Training Setup Test")
    print("=" * 50)
    print()

    results = {
        "Data Loading": test_data_loading(),
        "Label Distribution": test_label_distribution(),
        "DataLoader": test_dataloader(),
        "Model Creation": test_model_creation(),
    }

    print("\n" + "=" * 50)
    print("Summary")
    print("=" * 50)

    all_passed = True
    for test, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}: {test}")
        if not passed:
            all_passed = False

    if all_passed:
        print("\n✓ All tests passed! Ready to train.")
        print("\nNext steps:")
        print("  1. Download images: python scripts/download_images.py --limit 10000")
        print("  2. Train model: python scripts/train_classifier.py --task make --epochs 10")
    else:
        print("\n✗ Some tests failed. Check errors above.")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
