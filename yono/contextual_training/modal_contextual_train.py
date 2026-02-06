"""
YONO Contextual Training on Modal

Extends standard image training to include:
- Vehicle profile context
- Behavioral signals (comments, bids, views)
- Sale outcome for supervision

This trains models that understand not just WHAT is in an image,
but the MEANING of that image in context.
"""

import modal
import os

# Create Modal app
app = modal.App("yono-contextual")

# Define the container image
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
        "einops",
    ])
)

# Persistent volume for checkpoints
volume = modal.Volume.from_name("yono-data", create_if_missing=True)


@app.function(
    image=image,
    gpu="A100",
    timeout=86400,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
)
def train_contextual_model(
    limit: int = 100000,
    epochs: int = 30,
    batch_size: int = 32,
    context_dim: int = 64,
    output_task: str = "price_tier",
):
    """
    Train contextual model: image + metadata → prediction

    output_task options:
    - "price_tier": Predict elite/high/mid/entry
    - "engagement": Predict comment count tier
    - "quality": Predict listing quality score
    """
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader
    from torchvision import transforms
    from PIL import Image
    import timm
    from tqdm import tqdm
    import json
    import io
    import asyncio
    import aiohttp
    from datetime import datetime
    from supabase import create_client

    print("=" * 60)
    print("YONO CONTEXTUAL Training")
    print(f"Task: {output_task}")
    print(f"Config: limit={limit}, epochs={epochs}, batch={batch_size}")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")

    # Connect to Supabase
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(supabase_url, supabase_key)

    # Fetch contextual training data
    print("\nFetching contextual training data...")

    records = []
    page_size = 1000
    offset = 0

    while len(records) < limit:
        response = supabase.rpc("get_contextual_training_data", {
            "p_limit": min(page_size, limit - len(records)),
            "p_offset": offset
        }).execute()

        if not response.data:
            break

        records.extend(response.data)
        offset += page_size
        print(f"  Fetched {len(records)} records...")

    print(f"Total records: {len(records)}")

    # Build label mappings
    if output_task == "price_tier":
        label_map = {"elite": 0, "high": 1, "mid": 2, "entry": 3}
        num_classes = 4
    elif output_task == "engagement":
        label_map = {"viral": 0, "high": 1, "moderate": 2, "low": 3}
        num_classes = 4
    else:
        raise ValueError(f"Unknown task: {output_task}")

    # Context feature dimension
    # Year (normalized), mileage (normalized), comment_count, bid_count, view_count, has_transmission, has_color
    CONTEXT_FEATURES = 7

    class ContextualDataset(Dataset):
        def __init__(self, records, label_map, output_task):
            self.records = records
            self.label_map = label_map
            self.output_task = output_task
            self.transform = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                   std=[0.229, 0.224, 0.225])
            ])
            # Pre-cache images
            self.image_cache = {}

        def __len__(self):
            return len(self.records)

        def _get_label(self, record):
            if self.output_task == "price_tier":
                price = record.get("sale_price", 0) or 0
                if price >= 500000:
                    return self.label_map["elite"]
                elif price >= 100000:
                    return self.label_map["high"]
                elif price >= 50000:
                    return self.label_map["mid"]
                else:
                    return self.label_map["entry"]

            elif self.output_task == "engagement":
                comments = record.get("comment_count", 0) or 0
                if comments >= 500:
                    return self.label_map["viral"]
                elif comments >= 200:
                    return self.label_map["high"]
                elif comments >= 50:
                    return self.label_map["moderate"]
                else:
                    return self.label_map["low"]

        def _get_context(self, record):
            """Extract numerical context features"""
            year = record.get("year", 2000) or 2000
            mileage = record.get("mileage", 50000) or 50000
            comments = record.get("comment_count", 0) or 0
            bids = record.get("bid_count", 0) or 0
            views = record.get("view_count", 0) or 0

            return torch.tensor([
                (year - 1900) / 130.0,  # Normalized year
                min(mileage, 500000) / 500000.0,  # Normalized mileage
                min(comments, 1000) / 1000.0,  # Normalized comments
                min(bids, 100) / 100.0,  # Normalized bids
                min(views, 100000) / 100000.0,  # Normalized views
                1.0 if record.get("transmission") else 0.0,
                1.0 if record.get("color") else 0.0,
            ], dtype=torch.float32)

        def __getitem__(self, idx):
            record = self.records[idx]
            image_url = record["image_url"]

            # Load image (with caching)
            if idx not in self.image_cache:
                try:
                    import urllib.request
                    with urllib.request.urlopen(image_url, timeout=10) as response:
                        image_data = response.read()
                    img = Image.open(io.BytesIO(image_data)).convert("RGB")
                    self.image_cache[idx] = self.transform(img)
                except Exception as e:
                    # Return black image on failure
                    self.image_cache[idx] = torch.zeros(3, 224, 224)

            image_tensor = self.image_cache[idx]
            context = self._get_context(record)
            label = self._get_label(record)

            return image_tensor, context, label

    # Build dataset
    print(f"\nBuilding dataset for task: {output_task}")
    dataset = ContextualDataset(records, label_map, output_task)

    # Split train/val
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=4)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=4)

    print(f"Train: {len(train_dataset)}, Val: {len(val_dataset)}")

    # Build contextual model
    class ContextualModel(nn.Module):
        """
        Image encoder + Context encoder → Joint prediction

        This is the key innovation: context modulates image understanding
        """
        def __init__(self, num_classes, context_dim=64):
            super().__init__()

            # Image encoder (pretrained)
            self.image_encoder = timm.create_model("efficientnet_b0", pretrained=True)
            image_features = self.image_encoder.classifier.in_features
            self.image_encoder.classifier = nn.Identity()

            # Context encoder
            self.context_encoder = nn.Sequential(
                nn.Linear(CONTEXT_FEATURES, 32),
                nn.ReLU(),
                nn.Linear(32, context_dim),
                nn.ReLU(),
            )

            # Joint classifier
            self.classifier = nn.Sequential(
                nn.Linear(image_features + context_dim, 256),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(256, num_classes)
            )

        def forward(self, image, context):
            img_features = self.image_encoder(image)
            ctx_features = self.context_encoder(context)
            combined = torch.cat([img_features, ctx_features], dim=1)
            return self.classifier(combined)

    model = ContextualModel(num_classes, context_dim).to(device)
    print(f"\nModel parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Training setup
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_acc = 0
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    for epoch in range(epochs):
        # Train
        model.train()
        train_loss = 0
        train_correct = 0
        train_total = 0

        for images, contexts, labels in tqdm(train_loader, desc=f"Epoch {epoch+1}/{epochs}"):
            images = images.to(device)
            contexts = contexts.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            outputs = model(images, contexts)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()
            _, predicted = outputs.max(1)
            train_total += labels.size(0)
            train_correct += predicted.eq(labels).sum().item()

        scheduler.step()

        # Validate
        model.eval()
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for images, contexts, labels in val_loader:
                images = images.to(device)
                contexts = contexts.to(device)
                labels = labels.to(device)

                outputs = model(images, contexts)
                _, predicted = outputs.max(1)
                val_total += labels.size(0)
                val_correct += predicted.eq(labels).sum().item()

        train_acc = 100 * train_correct / train_total
        val_acc = 100 * val_correct / val_total

        print(f"Epoch {epoch+1}: train_acc={train_acc:.1f}%, val_acc={val_acc:.1f}%")

        # Save best
        if val_acc > best_acc:
            best_acc = val_acc
            checkpoint_path = f"/data/contextual_{output_task}_{run_id}_best.pt"
            torch.save({
                "model_state_dict": model.state_dict(),
                "epoch": epoch,
                "val_acc": val_acc,
                "config": {
                    "task": output_task,
                    "context_dim": context_dim,
                    "num_classes": num_classes,
                    "label_map": label_map,
                }
            }, checkpoint_path)
            print(f"  → Saved best model: {val_acc:.1f}%")

    volume.commit()

    print("\n" + "=" * 60)
    print(f"Training complete!")
    print(f"Best validation accuracy: {best_acc:.1f}%")
    print("=" * 60)

    return {
        "best_acc": best_acc,
        "epochs": epochs,
        "task": output_task,
        "samples": len(records)
    }


@app.local_entrypoint()
def main(
    limit: int = 100000,
    epochs: int = 30,
    task: str = "price_tier"
):
    """Run contextual training on Modal"""
    result = train_contextual_model.remote(
        limit=limit,
        epochs=epochs,
        output_task=task
    )
    print(f"\nResult: {result}")
