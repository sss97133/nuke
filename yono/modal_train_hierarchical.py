"""
YONO Hierarchical Classifier Training on Modal

Decomposes the 276-class make classifier into a 2-tier decision tree:
  Tier 1: Make family (8 classes: american, german, british, etc.)
  Tier 2: Specific make within each family (20-40 classes each)

Each tier is a separate EfficientNet-B0, trained on A100, streaming images from Supabase.

Usage:
  modal run yono/modal_train_hierarchical.py                          # train all tiers
  modal run yono/modal_train_hierarchical.py --action train-tier1     # family only
  modal run yono/modal_train_hierarchical.py --action train-tier2     # per-family only
  modal run yono/modal_train_hierarchical.py --action train-tier2 --family american
  modal run yono/modal_train_hierarchical.py --action export          # ONNX export
  modal run yono/modal_train_hierarchical.py --action list            # list runs
  modal run yono/modal_train_hierarchical.py --limit 500000 --detach  # background
"""

import modal
import os

app = modal.App("yono-hierarchical-train")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "torch",
        "torchvision",
        "timm",
        "pillow",
        "tqdm",
        "supabase",
        "numpy",
        "onnx",
        "onnxruntime",
    ])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

# ──────────────────────────────────────────────
# Make Family Taxonomy
# ──────────────────────────────────────────────

MAKE_FAMILIES = {
    "american": [
        "Chevrolet", "Ford", "Dodge", "Plymouth", "Pontiac", "Buick",
        "Cadillac", "Oldsmobile", "Lincoln", "Mercury", "GMC", "Jeep",
        "Chrysler", "AMC", "Hudson", "Studebaker", "Packard", "Willys",
        "DeSoto", "Nash", "Kaiser", "Frazer", "Edsel", "Imperial",
        "International", "Checker", "Shelby", "Saleen", "Pantera",
        "De Tomaso", "Vector", "Mosler", "SSC", "Karma", "Rivian", "Tesla",
        "Lucid", "Fisker", "Delorean", "Excalibur", "Avanti", "Stutz",
    ],
    "german": [
        "BMW", "Mercedes-Benz", "Volkswagen", "Porsche", "Audi",
        "Opel", "Maybach", "Smart", "Borgward",
    ],
    "british": [
        "Jaguar", "MG", "Austin-Healey", "Triumph", "Rolls-Royce", "Bentley",
        "Aston Martin", "Land Rover", "Range Rover", "Morgan", "TVR", "Lotus",
        "Caterham", "Bristol", "Daimler", "Sunbeam", "Riley", "Humber",
        "Singer", "Austin", "Morris", "Rover", "Vauxhall", "Hillman",
        "Wolseley", "Standard", "AC", "Alvis", "Armstrong Siddeley",
        "Jensen", "McLaren", "Noble",
    ],
    "japanese": [
        "Toyota", "Honda", "Mazda", "Nissan", "Datsun", "Subaru",
        "Mitsubishi", "Isuzu", "Suzuki", "Lexus", "Acura", "Infiniti",
        "Scion",
    ],
    "italian": [
        "Ferrari", "Lamborghini", "Alfa Romeo", "Maserati", "Fiat",
        "Lancia", "Autobianchi", "Innocenti", "ISO", "Bizzarrini",
        "De Tomaso", "Ghia", "Bertone", "Pininfarina",
    ],
    "french": [
        "Citroën", "Citroen", "Peugeot", "Renault", "Bugatti", "Talbot",
        "Simca", "Facel Vega",
    ],
    "swedish": [
        "Volvo", "Saab",
    ],
    "other": [],  # catch-all
}

# Reverse mapping: make → family
_MAKE_TO_FAMILY = {}
for _fam, _makes in MAKE_FAMILIES.items():
    for _m in _makes:
        _MAKE_TO_FAMILY[_m.lower()] = _fam

FAMILY_NAMES = list(MAKE_FAMILIES.keys())

# Make aliases
MAKE_ALIASES = {
    "bmw": "BMW", "mg": "MG", "gmc": "GMC", "tvr": "TVR",
    "amg": "Mercedes-Benz", "mercedes": "Mercedes-Benz",
    "rolls royce": "Rolls-Royce", "range rover": "Land Rover",
    "land": "Land Rover", "alfa": "Alfa Romeo", "vw": "Volkswagen",
    "chevy": "Chevrolet", "chev": "Chevrolet",
    "datsun": "Nissan", "scion": "Toyota", "lexus": "Toyota",
    "acura": "Honda", "infiniti": "Nissan",
    "aston": "Aston Martin", "austin healey": "Austin-Healey",
    "de tomaso": "De Tomaso",
}


def normalize_make(make: str) -> str:
    if not make:
        return ""
    make = make.strip()
    lower = make.lower()
    if lower in MAKE_ALIASES:
        return MAKE_ALIASES[lower]
    return make.title() if not any(c.isupper() for c in make[1:]) else make


def get_family(make: str) -> str:
    normalized = normalize_make(make)
    return _MAKE_TO_FAMILY.get(normalized.lower(), "other")


# ──────────────────────────────────────────────
# Core training function (runs on Modal GPU)
# ──────────────────────────────────────────────

@app.function(
    image=image,
    gpu="A100",
    timeout=86400,  # 24h
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("supabase-credentials")],
)
def train_hierarchical(
    limit: int = 500000,
    tier: str = "all",
    family: str = None,
    epochs_tier1: int = 25,
    epochs_tier2: int = 30,
    batch_size: int = 64,
    min_samples: int = 50,
):
    """Train hierarchical classifiers on Modal A100."""
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
    from torchvision import transforms
    from PIL import Image
    import timm
    from tqdm import tqdm
    import json
    import io
    import numpy as np
    from datetime import datetime
    from collections import Counter, defaultdict
    from supabase import create_client

    print("=" * 60)
    print("YONO Hierarchical Training on Modal")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Config: tier={tier}, limit={limit}, family={family}")
    print(f"  epochs_tier1={epochs_tier1}, epochs_tier2={epochs_tier2}, batch_size={batch_size}")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # ── Fetch data from Supabase ──
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(supabase_url, supabase_key)

    print("\nFetching training data from Supabase...")
    all_records = []
    page_size = 1000
    offset = 0

    while len(all_records) < limit:
        response = sb.table("vehicle_images").select(
            "id, image_url, vehicles!vehicle_images_vehicle_id_fkey(make, model, year)"
        ).range(offset, offset + page_size - 1).execute()

        if not response.data:
            break

        for row in response.data:
            if row.get("vehicles") and row["vehicles"].get("make") and row.get("image_url"):
                make = normalize_make(row["vehicles"]["make"])
                fam = get_family(make)
                all_records.append({
                    "url": row["image_url"],
                    "make": make,
                    "family": fam,
                })

        offset += page_size
        if len(all_records) % 50000 == 0:
            print(f"  Fetched {len(all_records):,} records...")
        if len(response.data) < page_size:
            break

    print(f"Total records: {len(all_records):,}")

    # Stats
    family_counts = Counter(r["family"] for r in all_records)
    make_counts = Counter(r["make"] for r in all_records)
    print(f"\nFamily distribution:")
    for fam, cnt in sorted(family_counts.items(), key=lambda x: -x[1]):
        print(f"  {fam:12s}: {cnt:>8,}")
    print(f"\nMakes: {len(make_counts)} unique")

    # ── Setup ──
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = f"/data/hierarchical/{run_id}"
    os.makedirs(output_dir, exist_ok=True)

    IMG_MEAN = [0.485, 0.456, 0.406]
    IMG_STD = [0.229, 0.224, 0.225]

    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(224, scale=(0.7, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
        transforms.RandomGrayscale(p=0.05),
        transforms.ToTensor(),
        transforms.Normalize(IMG_MEAN, IMG_STD),
    ])

    val_transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(IMG_MEAN, IMG_STD),
    ])

    class StreamingDataset(Dataset):
        def __init__(self, records, label_field, label_to_idx, transform):
            self.records = records
            self.label_field = label_field
            self.label_to_idx = label_to_idx
            self.transform = transform

        def __len__(self):
            return len(self.records)

        def __getitem__(self, idx):
            rec = self.records[idx]
            label = self.label_to_idx[rec[self.label_field]]
            try:
                import urllib.request
                with urllib.request.urlopen(rec["url"], timeout=10) as resp:
                    img = Image.open(io.BytesIO(resp.read())).convert("RGB")
                if self.transform:
                    img = self.transform(img)
                return img, label
            except Exception:
                return torch.zeros(3, 224, 224), label

    def split_stratified(records, label_field, val_frac=0.1, seed=42):
        rng = np.random.default_rng(seed)
        by_class = defaultdict(list)
        for r in records:
            by_class[r[label_field]].append(r)
        train, val = [], []
        for cls_records in by_class.values():
            arr = list(cls_records)
            rng.shuffle(arr)
            n_val = max(1, int(len(arr) * val_frac))
            val.extend(arr[:n_val])
            train.extend(arr[n_val:])
        rng.shuffle(train)
        return train, val

    def make_weighted_sampler(records, label_field, label_to_idx):
        labels = [label_to_idx[r[label_field]] for r in records]
        class_counts = Counter(labels)
        weights = [1.0 / class_counts[l] for l in labels]
        return WeightedRandomSampler(weights, len(weights), replacement=True)

    def train_one_model(name, records, label_field, label_to_idx, epochs, bs):
        """Train a single EfficientNet-B0 classifier."""
        n_classes = len(label_to_idx)
        print(f"\n{'='*60}")
        print(f"Training: {name}")
        print(f"  Classes: {n_classes} | Samples: {len(records):,} | Epochs: {epochs}")

        train_recs, val_recs = split_stratified(records, label_field)
        print(f"  Train: {len(train_recs):,} | Val: {len(val_recs):,}")

        train_ds = StreamingDataset(train_recs, label_field, label_to_idx, train_transform)
        val_ds = StreamingDataset(val_recs, label_field, label_to_idx, val_transform)

        sampler = make_weighted_sampler(train_recs, label_field, label_to_idx)
        train_loader = DataLoader(
            train_ds, batch_size=bs, sampler=sampler,
            num_workers=8, pin_memory=True, drop_last=True, prefetch_factor=4,
        )
        val_loader = DataLoader(
            val_ds, batch_size=bs, shuffle=False,
            num_workers=8, pin_memory=True, prefetch_factor=2,
        )

        model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=n_classes)
        model = model.to(device)

        criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
        optimizer = optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-4)
        scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
        scaler = torch.amp.GradScaler()

        best_val_acc = 0.0
        best_ckpt_path = f"{output_dir}/{name}_best.pt"
        history = []

        for epoch in range(1, epochs + 1):
            # Train
            model.train()
            train_loss, train_correct, train_total = 0, 0, 0
            pbar = tqdm(train_loader, desc=f"E{epoch}/{epochs} [train]")
            for imgs, labels in pbar:
                imgs, labels = imgs.to(device), labels.to(device)
                optimizer.zero_grad()
                with torch.amp.autocast(device_type="cuda"):
                    outputs = model(imgs)
                    loss = criterion(outputs, labels)
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
                train_loss += loss.item()
                _, predicted = outputs.max(1)
                train_correct += predicted.eq(labels).sum().item()
                train_total += len(labels)
                pbar.set_postfix(
                    loss=f"{train_loss/(pbar.n+1):.4f}",
                    acc=f"{100.*train_correct/train_total:.1f}%"
                )

            scheduler.step()

            # Validate
            model.eval()
            val_correct, val_total = 0, 0
            with torch.no_grad():
                for imgs, labels in tqdm(val_loader, desc=f"E{epoch}/{epochs} [val]"):
                    imgs, labels = imgs.to(device), labels.to(device)
                    with torch.amp.autocast(device_type="cuda"):
                        outputs = model(imgs)
                    _, predicted = outputs.max(1)
                    val_correct += predicted.eq(labels).sum().item()
                    val_total += len(labels)

            train_acc = 100.0 * train_correct / max(train_total, 1)
            val_acc = 100.0 * val_correct / max(val_total, 1)
            print(f"  E{epoch:2d}/{epochs}: train_acc={train_acc:.1f}%  val_acc={val_acc:.1f}%  lr={scheduler.get_last_lr()[0]:.2e}")

            history.append({"epoch": epoch, "train_acc": train_acc, "val_acc": val_acc})

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                torch.save({
                    "epoch": epoch,
                    "model_state_dict": model.state_dict(),
                    "val_acc": val_acc,
                    "label_to_idx": label_to_idx,
                    "n_classes": n_classes,
                    "name": name,
                }, best_ckpt_path)
                print(f"    -> New best: {val_acc:.1f}%")

            # Persist every epoch
            volume.commit()

        print(f"\n  Best val_acc: {best_val_acc:.1f}%")
        return {
            "name": name,
            "val_acc": best_val_acc,
            "n_classes": n_classes,
            "labels": list(label_to_idx.keys()),
            "checkpoint": best_ckpt_path,
            "history": history,
        }

    # ── Train Tier 1: Family classifier ──
    results = []

    if tier in ("all", "tier1"):
        print("\n[TIER 1] Training family classifier...")
        families = sorted(set(r["family"] for r in all_records))
        family_label_to_idx = {f: i for i, f in enumerate(families)}
        r = train_one_model(
            "hier_family", all_records, "family", family_label_to_idx,
            epochs=epochs_tier1, bs=batch_size,
        )
        results.append(r)

    # ── Train Tier 2: Per-family make classifiers ──
    if tier in ("all", "tier2"):
        print("\n[TIER 2] Training per-family make classifiers...")
        families_to_train = [family] if family else FAMILY_NAMES

        for fam in families_to_train:
            fam_records = [r for r in all_records if r["family"] == fam]
            if not fam_records:
                print(f"\nSkipping {fam}: no samples")
                continue

            fam_make_counts = Counter(r["make"] for r in fam_records)
            valid_makes = {m for m, c in fam_make_counts.items() if c >= min_samples}

            if len(valid_makes) < 2:
                print(f"\nSkipping {fam}: <2 makes with >={min_samples} samples")
                for m, c in fam_make_counts.most_common():
                    print(f"  {m}: {c}")
                continue

            fam_filtered = [r for r in fam_records if r["make"] in valid_makes]
            make_label_to_idx = {m: i for i, m in enumerate(sorted(valid_makes))}

            print(f"\n[{fam}] {len(valid_makes)} makes, {len(fam_filtered):,} images")
            for m, c in sorted(fam_make_counts.items(), key=lambda x: -x[1]):
                flag = "+" if m in valid_makes else "-"
                print(f"  {flag} {m}: {c:,}")

            ep = epochs_tier2 if len(fam_filtered) >= 5000 else epochs_tier2 + 5
            r = train_one_model(
                f"hier_{fam}", fam_filtered, "make", make_label_to_idx,
                epochs=ep, bs=batch_size,
            )
            results.append(r)

    # ── Save summary ──
    summary = {
        "run_id": run_id,
        "completed_at": datetime.now().isoformat(),
        "total_records": len(all_records),
        "results": results,
    }
    with open(f"{output_dir}/training_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # Save unified label map
    all_labels = {}
    for r in results:
        ckpt = torch.load(r["checkpoint"], map_location="cpu", weights_only=False)
        all_labels[r["name"]] = ckpt["label_to_idx"]
    with open(f"{output_dir}/hier_labels.json", "w") as f:
        json.dump(all_labels, f, indent=2)

    volume.commit()

    print(f"\n{'='*60}")
    print("HIERARCHICAL TRAINING COMPLETE")
    for r in results:
        print(f"  {r['name']:20s}: {r['val_acc']:.1f}% val_acc  ({r['n_classes']} classes)")
    print(f"Output: {output_dir}")
    print(f"{'='*60}")

    return summary


# ──────────────────────────────────────────────
# ONNX export (runs on CPU)
# ──────────────────────────────────────────────

@app.function(
    image=image,
    timeout=3600,
    volumes={"/data": volume},
)
def export_onnx(run_id: str = None):
    """Export all hierarchical checkpoints to ONNX."""
    import torch
    import timm
    import onnx
    import onnxruntime as ort
    import json
    import glob

    # Find the latest run if not specified
    if not run_id:
        runs = sorted(glob.glob("/data/hierarchical/*/"))
        if not runs:
            print("No hierarchical training runs found.")
            return
        run_dir = runs[-1]
    else:
        run_dir = f"/data/hierarchical/{run_id}"

    if not os.path.exists(run_dir):
        print(f"Run directory not found: {run_dir}")
        return

    print(f"Exporting from: {run_dir}")
    checkpoints = sorted(glob.glob(f"{run_dir}/hier_*_best.pt"))
    if not checkpoints:
        print("No hierarchical checkpoints found.")
        return

    all_labels = {}
    for ckpt_path in checkpoints:
        name = os.path.basename(ckpt_path).replace("_best.pt", "")
        onnx_path = f"{run_dir}/{name}.onnx"

        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        n_classes = ckpt["n_classes"]
        label_to_idx = ckpt["label_to_idx"]

        model = timm.create_model("efficientnet_b0", pretrained=False, num_classes=n_classes)
        model.load_state_dict(ckpt["model_state_dict"])
        model.eval()

        dummy = torch.randn(1, 3, 224, 224)
        torch.onnx.export(
            model, dummy, onnx_path,
            input_names=["image"],
            output_names=["logits"],
            dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=18,
        )

        # Save without external data
        m = onnx.load(onnx_path)
        onnx.save_model(m, onnx_path, save_as_external_data=False)

        # Verify
        sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        out = sess.run(None, {"image": dummy.numpy()})[0]
        size_mb = os.path.getsize(onnx_path) / 1e6

        print(f"  {name}: {size_mb:.1f}MB, {n_classes} classes, val_acc={ckpt['val_acc']:.1f}%")
        all_labels[name] = label_to_idx

    # Save unified label map
    labels_path = f"{run_dir}/hier_labels.json"
    with open(labels_path, "w") as f:
        json.dump(all_labels, f, indent=2)

    volume.commit()
    print(f"\nExported {len(checkpoints)} models. Labels: {labels_path}")
    return {"run_dir": run_dir, "models": len(checkpoints)}


# ──────────────────────────────────────────────
# List runs
# ──────────────────────────────────────────────

@app.function(
    image=image,
    volumes={"/data": volume},
)
def list_runs():
    """List all hierarchical training runs."""
    import json
    import glob

    runs_dir = "/data/hierarchical"
    if not os.path.exists(runs_dir):
        return []

    runs = []
    for run_dir in sorted(glob.glob(f"{runs_dir}/*/")):
        summary_path = f"{run_dir}training_summary.json"
        if os.path.exists(summary_path):
            with open(summary_path) as f:
                summary = json.load(f)
            runs.append({
                "run_id": summary.get("run_id", os.path.basename(run_dir.rstrip("/"))),
                "total_records": summary.get("total_records", 0),
                "models": len(summary.get("results", [])),
                "results": [
                    {"name": r["name"], "val_acc": r["val_acc"], "n_classes": r["n_classes"]}
                    for r in summary.get("results", [])
                ],
            })
    return runs


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

@app.local_entrypoint()
def main(
    action: str = "train-all",
    limit: int = 500000,
    tier: str = "all",
    family: str = None,
    epochs_tier1: int = 25,
    epochs_tier2: int = 30,
    batch_size: int = 64,
    min_samples: int = 50,
    run_id: str = None,
):
    """
    YONO Hierarchical Training on Modal

    Actions:
        train-all     Train tier-1 (family) + tier-2 (per-family makes)
        train-tier1   Train only the family classifier
        train-tier2   Train only per-family classifiers (optionally --family <name>)
        export        Export checkpoints to ONNX (optionally --run-id <id>)
        list          List all training runs
    """
    if action.startswith("train"):
        if action == "train-tier1":
            tier = "tier1"
        elif action == "train-tier2":
            tier = "tier2"
        else:
            tier = "all"

        print(f"Starting hierarchical training: tier={tier}, limit={limit}, family={family}")
        result = train_hierarchical.remote(
            limit=limit,
            tier=tier,
            family=family,
            epochs_tier1=epochs_tier1,
            epochs_tier2=epochs_tier2,
            batch_size=batch_size,
            min_samples=min_samples,
        )
        print(f"\nTraining complete!")
        if result and "results" in result:
            for r in result["results"]:
                print(f"  {r['name']:20s}: {r['val_acc']:.1f}%  ({r['n_classes']} classes)")

    elif action == "export":
        result = export_onnx.remote(run_id=run_id)
        print(f"Export complete: {result}")

    elif action == "list":
        runs = list_runs.remote()
        if not runs:
            print("No hierarchical training runs found.")
        else:
            for run in runs:
                print(f"\nRun: {run['run_id']} ({run['total_records']:,} records)")
                for r in run["results"]:
                    print(f"  {r['name']:20s}: {r['val_acc']:.1f}%  ({r['n_classes']} classes)")

    else:
        print(f"Unknown action: {action}")
        print("Valid actions: train-all, train-tier1, train-tier2, export, list")
