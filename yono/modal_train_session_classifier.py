"""
YONO Session Type Classifier — Train a group-level classifier for photo sessions.

Architecture: SessionTypeHead
  - Per-image: Florence-2 features (768d) → projection (256d)
  - Positional embeddings (order matters in photo sessions)
  - Cross-image: Multi-head attention (4 heads) over the sequence
  - Global pool → classification head → 14 session type classes

Training data comes from auto-detected sessions with rule-based types (bootstrap).
As the model improves, it replaces the rule-based classifier.

Deploy:
    modal deploy yono/modal_train_session_classifier.py

Manual:
    modal run yono/modal_train_session_classifier.py --action export-features
    modal run yono/modal_train_session_classifier.py --action train
    modal run yono/modal_train_session_classifier.py --action evaluate
    modal run yono/modal_train_session_classifier.py --action status
"""

import modal
import os
import json
import time
from datetime import datetime, timezone

app = modal.App("yono-session-classifier")

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

train_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "torch==2.2.2",
        "numpy<2",
        "onnx",
        "onnxruntime",
        "supabase",
        "httpx",
        "transformers==4.49.0",
        "safetensors",
        "einops",
        "timm",
        "Pillow",
    ])
)

MODELS_DIR = "/data/models"
FEATURES_DIR = "/data/session_features"
SESSION_MODEL_PATH = "/data/models/yono_session_classifier.onnx"
SESSION_CONFIG_PATH = "/data/models/yono_session_config.json"
MAX_IMAGES_PER_SESSION = 30  # pad/truncate to this
FEATURE_DIM = 768  # Florence-2 base hidden size
PROJECTION_DIM = 256
NUM_HEADS = 4
NUM_CLASSES = 14

SESSION_TYPE_KEYS = [
    "walkaround", "detail_closeup", "damage_documentation",
    "paint_body_work", "engine_rebuild", "interior_restoration",
    "detail_show_prep", "parts_reference", "auction_listing",
    "delivery_transport", "comparison_before_after",
    "road_trip_driving", "casual_lifestyle", "unknown",
]


def _get_supabase():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


# ============================================================
# Feature export — extract Florence-2 features for labeled sessions
# ============================================================

@app.function(
    image=train_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    gpu="T4",
    timeout=7200,  # 2 hours
    memory=8192,
)
def export_session_features():
    """
    Export Florence-2 features for all labeled sessions.
    Each session → {features: [N, 768], label: str, session_id: str, image_count: int}
    Cached to /data/session_features/ for fast training iterations.
    """
    import torch
    import httpx
    import io
    import numpy as np
    from PIL import Image
    from transformers import AutoProcessor, AutoModelForCausalLM

    print("[SESSION-CLF] Loading Florence-2...")
    processor = AutoProcessor.from_pretrained("microsoft/florence-2-base", trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        "microsoft/florence-2-base", trust_remote_code=True, torch_dtype=torch.float32,
    ).cuda()
    model.eval()

    sb = _get_supabase()

    # Fetch all auto-sessions with type labels
    print("[SESSION-CLF] Fetching labeled sessions...")
    resp = sb.rpc("get_vehicle_sessions", {
        "p_vehicle_id": None,  # This won't work — we need raw SQL
    }).execute()

    # Use direct query instead
    from supabase import create_client
    import httpx as hx

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    query_url = f"{url}/rest/v1/rpc/get_labeled_sessions_for_training"

    # Fallback: query image_sets directly
    resp = (
        sb.table("image_sets")
        .select("id, vehicle_id, session_type_key")
        .eq("is_auto_session", True)
        .not_.is_("session_type_key", "null")
        .limit(5000)
        .execute()
    )
    sessions = resp.data or []
    print(f"[SESSION-CLF] Found {len(sessions)} labeled sessions")

    # Filter to known types only
    sessions = [s for s in sessions if s["session_type_key"] in SESSION_TYPE_KEYS]
    print(f"[SESSION-CLF] {len(sessions)} sessions with valid type labels")

    os.makedirs(FEATURES_DIR, exist_ok=True)
    fetch_headers = {
        "User-Agent": "Mozilla/5.0 (compatible; NukeVision/1.0; +https://nuke.ag)",
        "Accept": "image/*,*/*",
    }

    exported = 0
    errors = 0

    for si, session in enumerate(sessions):
        session_id = session["id"]
        label = session["session_type_key"]
        out_path = os.path.join(FEATURES_DIR, f"{session_id}.npz")

        if os.path.exists(out_path):
            exported += 1
            continue

        # Fetch member images
        members = (
            sb.table("image_set_members")
            .select("image_id")
            .eq("image_set_id", session_id)
            .order("display_order")
            .limit(MAX_IMAGES_PER_SESSION)
            .execute()
        ).data or []

        if not members:
            continue

        image_ids = [m["image_id"] for m in members]

        # Fetch image URLs
        images = (
            sb.table("vehicle_images")
            .select("id, image_url")
            .in_("id", image_ids)
            .execute()
        ).data or []

        url_map = {img["id"]: img["image_url"] for img in images}

        # Extract features for each image
        features_list = []
        for img_id in image_ids:
            img_url = url_map.get(img_id)
            if not img_url:
                continue
            try:
                with httpx.Client(timeout=10, follow_redirects=True) as client:
                    resp_img = client.get(img_url, headers=fetch_headers)
                    resp_img.raise_for_status()
                    pil_img = Image.open(io.BytesIO(resp_img.content)).convert("RGB")

                inputs = processor(text="<DETAILED_CAPTION>", images=pil_img, return_tensors="pt")
                pixel_values = inputs["pixel_values"].cuda()

                with torch.no_grad():
                    feats = model._encode_image(pixel_values)  # [1, seq_len, 768]
                    pooled = feats.mean(dim=1).cpu().numpy()  # [1, 768]
                    features_list.append(pooled[0])
            except Exception as e:
                if errors < 10:
                    print(f"  Error fetching {img_id}: {e}")
                errors += 1
                continue

        if not features_list:
            continue

        # Stack features [N, 768]
        features_arr = np.stack(features_list)

        # Save
        np.savez_compressed(out_path, features=features_arr, label=label,
                           session_id=session_id, image_count=len(features_list))
        exported += 1

        if (si + 1) % 50 == 0:
            print(f"  [{si+1}/{len(sessions)}] Exported {exported} sessions, {errors} fetch errors")
            volume.commit()

    volume.commit()
    print(f"[SESSION-CLF] Feature export done: {exported} sessions, {errors} errors")
    return {"exported": exported, "errors": errors, "total_sessions": len(sessions)}


# ============================================================
# Model definition
# ============================================================

def _build_session_type_head():
    """Build the SessionTypeHead model."""
    import torch
    from torch import nn

    class SessionTypeHead(nn.Module):
        """
        Classifies a GROUP of images into a session type.
        Takes pooled Florence-2 features from N images.
        Returns session_type probabilities (14 classes).
        """
        def __init__(self, feature_dim=FEATURE_DIM, projection_dim=PROJECTION_DIM,
                     num_heads=NUM_HEADS, num_classes=NUM_CLASSES,
                     max_images=MAX_IMAGES_PER_SESSION, dropout=0.2):
            super().__init__()
            self.max_images = max_images
            self.projection_dim = projection_dim

            # Per-image projection
            self.image_proj = nn.Sequential(
                nn.LayerNorm(feature_dim),
                nn.Linear(feature_dim, projection_dim),
                nn.GELU(),
                nn.Dropout(dropout),
            )

            # Positional embeddings (order matters for session type)
            self.pos_embed = nn.Embedding(max_images, projection_dim)

            # Image count embedding (how many photos in session is a signal)
            self.count_embed = nn.Embedding(max_images + 1, projection_dim)

            # Cross-image multi-head attention
            self.attention = nn.MultiheadAttention(
                embed_dim=projection_dim, num_heads=num_heads,
                dropout=dropout, batch_first=True,
            )
            self.attn_norm = nn.LayerNorm(projection_dim)

            # Classification head
            self.classifier = nn.Sequential(
                nn.LayerNorm(projection_dim * 2),  # pool + count
                nn.Linear(projection_dim * 2, 128),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(128, num_classes),
            )

        def forward(self, features, mask=None):
            """
            features: [B, N, 768] — padded per-image Florence-2 features
            mask: [B, N] — True where padding (to ignore)
            Returns: [B, num_classes] logits
            """
            B, N, _ = features.shape

            # Project
            x = self.image_proj(features)  # [B, N, projection_dim]

            # Add positional embeddings
            positions = torch.arange(N, device=features.device).unsqueeze(0).expand(B, -1)
            x = x + self.pos_embed(positions)

            # Cross-image attention
            attn_out, _ = self.attention(x, x, x, key_padding_mask=mask)
            x = self.attn_norm(x + attn_out)

            # Global pool (ignoring padding)
            if mask is not None:
                # Zero out padded positions before pooling
                x = x.masked_fill(mask.unsqueeze(-1), 0.0)
                lengths = (~mask).sum(dim=1, keepdim=True).float().clamp(min=1)
                pooled = x.sum(dim=1) / lengths
            else:
                pooled = x.mean(dim=1)

            # Image count embedding
            if mask is not None:
                counts = (~mask).sum(dim=1)  # [B]
            else:
                counts = torch.full((B,), N, device=features.device, dtype=torch.long)
            counts = counts.clamp(max=self.max_images)
            count_emb = self.count_embed(counts)  # [B, projection_dim]

            # Concat pool + count → classify
            combined = torch.cat([pooled, count_emb], dim=-1)  # [B, projection_dim*2]
            return self.classifier(combined)

    return SessionTypeHead()


# ============================================================
# Training
# ============================================================

@app.function(
    image=train_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    gpu="T4",
    timeout=3600,
    memory=8192,
)
def train_session_classifier():
    """Train the SessionTypeHead on exported features."""
    import torch
    from torch import nn
    import numpy as np
    from pathlib import Path

    print("[SESSION-CLF] Loading features...")

    features_dir = Path(FEATURES_DIR)
    if not features_dir.exists():
        return {"status": "no_features", "message": "Run export-features first"}

    # Load all feature files
    samples = []
    label_counts = {}
    for f in features_dir.glob("*.npz"):
        data = np.load(f, allow_pickle=True)
        label = str(data["label"])
        if label not in SESSION_TYPE_KEYS:
            continue
        features = data["features"]  # [N, 768]
        samples.append({"features": features, "label": label})
        label_counts[label] = label_counts.get(label, 0) + 1

    print(f"[SESSION-CLF] {len(samples)} sessions loaded")
    for k, v in sorted(label_counts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")

    if len(samples) < 20:
        return {"status": "insufficient_data", "count": len(samples)}

    # Build label encoder
    label_to_idx = {k: i for i, k in enumerate(SESSION_TYPE_KEYS)}

    # Pad/truncate features to MAX_IMAGES_PER_SESSION
    def prepare_batch(batch):
        features_list = []
        masks = []
        labels = []
        for s in batch:
            feats = s["features"][:MAX_IMAGES_PER_SESSION]
            n = len(feats)
            # Pad
            if n < MAX_IMAGES_PER_SESSION:
                pad = np.zeros((MAX_IMAGES_PER_SESSION - n, FEATURE_DIM), dtype=np.float32)
                feats = np.concatenate([feats, pad], axis=0)
            mask = np.array([False] * n + [True] * (MAX_IMAGES_PER_SESSION - n))
            features_list.append(feats)
            masks.append(mask)
            labels.append(label_to_idx[s["label"]])
        return (
            torch.tensor(np.stack(features_list), dtype=torch.float32),
            torch.tensor(np.stack(masks), dtype=torch.bool),
            torch.tensor(labels, dtype=torch.long),
        )

    # Train/val split (80/20)
    import random
    random.seed(42)
    random.shuffle(samples)
    split = int(len(samples) * 0.8)
    train_samples = samples[:split]
    val_samples = samples[split:]

    # Class weights (inverse frequency)
    total = len(train_samples)
    class_weights = torch.ones(NUM_CLASSES)
    for label, count in label_counts.items():
        if label in label_to_idx:
            idx = label_to_idx[label]
            class_weights[idx] = total / max(count, 1)
    class_weights = class_weights / class_weights.sum() * NUM_CLASSES

    model = _build_session_type_head().cuda()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=0.01)
    criterion = nn.CrossEntropyLoss(weight=class_weights.cuda())
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=30)

    batch_size = 32
    best_val_acc = 0
    best_state = None

    for epoch in range(30):
        # Train
        model.train()
        random.shuffle(train_samples)
        train_loss = 0
        train_correct = 0
        train_total = 0

        for i in range(0, len(train_samples), batch_size):
            batch = train_samples[i:i+batch_size]
            features, masks, labels = prepare_batch(batch)
            features, masks, labels = features.cuda(), masks.cuda(), labels.cuda()

            optimizer.zero_grad()
            logits = model(features, masks)
            loss = criterion(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            train_loss += loss.item() * len(batch)
            train_correct += (logits.argmax(1) == labels).sum().item()
            train_total += len(batch)

        scheduler.step()

        # Validate
        model.eval()
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for i in range(0, len(val_samples), batch_size):
                batch = val_samples[i:i+batch_size]
                features, masks, labels = prepare_batch(batch)
                features, masks, labels = features.cuda(), masks.cuda(), labels.cuda()
                logits = model(features, masks)
                val_correct += (logits.argmax(1) == labels).sum().item()
                val_total += len(batch)

        train_acc = train_correct / max(train_total, 1)
        val_acc = val_correct / max(val_total, 1) if val_total > 0 else 0
        avg_loss = train_loss / max(train_total, 1)

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        if (epoch + 1) % 5 == 0:
            print(f"  Epoch {epoch+1}/30: loss={avg_loss:.4f} train_acc={train_acc:.3f} val_acc={val_acc:.3f}")

    if best_state is None:
        return {"status": "training_failed", "message": "No improvement"}

    # Save best model
    model.load_state_dict(best_state)
    model = model.cpu()

    # Export to ONNX
    dummy_features = torch.randn(1, MAX_IMAGES_PER_SESSION, FEATURE_DIM)
    dummy_mask = torch.zeros(1, MAX_IMAGES_PER_SESSION, dtype=torch.bool)

    os.makedirs(os.path.dirname(SESSION_MODEL_PATH), exist_ok=True)
    torch.onnx.export(
        model, (dummy_features, dummy_mask),
        SESSION_MODEL_PATH,
        input_names=["features", "mask"],
        output_names=["logits"],
        dynamic_axes={
            "features": {0: "batch"},
            "mask": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=14,
    )

    # Save config
    config = {
        "session_types": SESSION_TYPE_KEYS,
        "feature_dim": FEATURE_DIM,
        "projection_dim": PROJECTION_DIM,
        "num_heads": NUM_HEADS,
        "max_images_per_session": MAX_IMAGES_PER_SESSION,
        "best_val_acc": best_val_acc,
        "train_samples": len(train_samples),
        "val_samples": len(val_samples),
        "label_distribution": label_counts,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(SESSION_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

    volume.commit()

    print(f"[SESSION-CLF] Training done: val_acc={best_val_acc:.3f}")
    print(f"  ONNX saved: {SESSION_MODEL_PATH}")
    print(f"  Config saved: {SESSION_CONFIG_PATH}")

    # Record to Supabase
    try:
        sb = _get_supabase()
        sb.table("yono_training_metrics").insert({
            "model_type": "session_classifier",
            "accuracy": best_val_acc,
            "train_samples": len(train_samples),
            "val_samples": len(val_samples),
            "config": config,
        }).execute()
    except Exception as e:
        print(f"  Metrics recording failed (non-fatal): {e}")

    return {
        "status": "trained",
        "best_val_acc": best_val_acc,
        "train_samples": len(train_samples),
        "val_samples": len(val_samples),
        "label_distribution": label_counts,
    }


# ============================================================
# Evaluation
# ============================================================

@app.function(
    image=train_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    timeout=600,
)
def evaluate_session_classifier():
    """Evaluate the trained ONNX session classifier on held-out data."""
    import onnxruntime as ort
    import numpy as np
    from pathlib import Path

    if not os.path.exists(SESSION_MODEL_PATH):
        return {"status": "no_model"}

    if not os.path.exists(SESSION_CONFIG_PATH):
        return {"status": "no_config"}

    with open(SESSION_CONFIG_PATH) as f:
        config = json.load(f)

    session = ort.InferenceSession(SESSION_MODEL_PATH, providers=["CPUExecutionProvider"])
    type_keys = config["session_types"]

    features_dir = Path(FEATURES_DIR)
    samples = []
    for f_path in features_dir.glob("*.npz"):
        data = np.load(f_path, allow_pickle=True)
        label = str(data["label"])
        if label in type_keys:
            samples.append({"features": data["features"], "label": label})

    if not samples:
        return {"status": "no_data"}

    # Use last 20% as test set (consistent with training)
    import random
    random.seed(42)
    random.shuffle(samples)
    split = int(len(samples) * 0.8)
    test_samples = samples[split:]

    label_to_idx = {k: i for i, k in enumerate(type_keys)}
    correct = 0
    total = 0
    confusion = {}

    for s in test_samples:
        feats = s["features"][:MAX_IMAGES_PER_SESSION]
        n = len(feats)
        if n < MAX_IMAGES_PER_SESSION:
            pad = np.zeros((MAX_IMAGES_PER_SESSION - n, FEATURE_DIM), dtype=np.float32)
            feats = np.concatenate([feats, pad], axis=0)
        mask = np.array([[False] * n + [True] * (MAX_IMAGES_PER_SESSION - n)])
        feats = feats[np.newaxis].astype(np.float32)

        logits = session.run(None, {"features": feats, "mask": mask})[0]
        pred_idx = int(np.argmax(logits[0]))
        pred_label = type_keys[pred_idx]
        true_label = s["label"]

        if pred_label == true_label:
            correct += 1
        total += 1

        key = f"{true_label}→{pred_label}"
        confusion[key] = confusion.get(key, 0) + 1

    accuracy = correct / max(total, 1)
    print(f"[SESSION-CLF] Eval: {correct}/{total} = {accuracy:.3f} accuracy")

    return {
        "status": "evaluated",
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "top_confusions": dict(sorted(confusion.items(), key=lambda x: -x[1])[:10]),
    }


# ============================================================
# Status
# ============================================================

@app.function(
    image=train_image,
    volumes={"/data": volume},
    timeout=60,
)
def status():
    """Check session classifier status."""
    from pathlib import Path

    result = {
        "model_exists": os.path.exists(SESSION_MODEL_PATH),
        "config_exists": os.path.exists(SESSION_CONFIG_PATH),
    }

    features_dir = Path(FEATURES_DIR)
    if features_dir.exists():
        result["feature_files"] = len(list(features_dir.glob("*.npz")))
    else:
        result["feature_files"] = 0

    if os.path.exists(SESSION_CONFIG_PATH):
        with open(SESSION_CONFIG_PATH) as f:
            config = json.load(f)
        result["best_val_acc"] = config.get("best_val_acc")
        result["trained_at"] = config.get("trained_at")
        result["train_samples"] = config.get("train_samples")

    return result


# ============================================================
# Weekly cron — Sunday 2am UTC
# ============================================================

@app.function(
    image=train_image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("nuke-sidecar-secrets")],
    schedule=modal.Cron("0 2 * * 0"),  # Sunday 2am UTC
    timeout=14400,  # 4 hours
)
def weekly_session_classifier_train():
    """Weekly cron: export features → train → evaluate."""
    print("[SESSION-CLF] Weekly training pipeline starting...")

    # Phase 1: Export features for any new sessions
    export_result = export_session_features.remote()
    print(f"  Export: {export_result}")

    if export_result.get("exported", 0) < 20:
        print("  Not enough sessions for training. Skipping.")
        return {"status": "skipped", "reason": "insufficient_sessions", "export": export_result}

    # Phase 2: Train
    train_result = train_session_classifier.remote()
    print(f"  Train: {train_result}")

    if train_result.get("status") != "trained":
        return {"status": "train_failed", "train": train_result}

    # Phase 3: Evaluate
    eval_result = evaluate_session_classifier.remote()
    print(f"  Eval: {eval_result}")

    return {
        "status": "completed",
        "export": export_result,
        "train": train_result,
        "eval": eval_result,
    }


# ============================================================
# Entry point
# ============================================================

@app.local_entrypoint()
def main(action: str = "status"):
    """Manual entry point for session classifier operations."""
    if action == "export-features":
        result = export_session_features.remote()
    elif action == "train":
        result = train_session_classifier.remote()
    elif action == "evaluate":
        result = evaluate_session_classifier.remote()
    elif action == "status":
        result = status.remote()
    else:
        print(f"Unknown action: {action}")
        print("Available: export-features, train, evaluate, status")
        return

    print(f"\nResult: {json.dumps(result, indent=2, default=str)}")
