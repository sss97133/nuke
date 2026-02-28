#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
YONO Retrain From Queue — Incremental fine-tuning from active learning queue.

Fetches ground truth from yono-export-training edge function,
merges with existing training labels, and fine-tunes stage/zone/condition heads.

Usage:
    python scripts/retrain_from_queue.py                    # export + retrain all heads
    python scripts/retrain_from_queue.py --head stage       # retrain stage head only
    python scripts/retrain_from_queue.py --head zone        # retrain zone head only
    python scripts/retrain_from_queue.py --dry-run           # export only, no training
    python scripts/retrain_from_queue.py --export-only       # just save JSONL, skip training
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

NUKE_DIR = Path(__file__).parent.parent.parent
YONO_DIR = Path(__file__).parent.parent
LABELS_DIR = YONO_DIR / "training_labels"

# Load env
for line in (NUKE_DIR / ".env").read_text().splitlines():
    if line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    k = k.strip()
    v = v.strip().strip('"').strip("'")
    if k and v and k not in os.environ:
        os.environ[k] = v


def export_training_data(prediction_type: str = "all", limit: int = 2000) -> list[dict]:
    """Call yono-export-training edge function to get ground truth data."""
    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE_KEY")

    if not url or not key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    export_url = f"{url}/functions/v1/yono-export-training"
    payload = json.dumps({
        "prediction_type": prediction_type,
        "limit": limit,
        "mark_exported": True,
    }).encode()

    req = urllib.request.Request(export_url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f"Export failed: {e}")
        return []

    jsonl = data.get("jsonl", "")
    count = data.get("count", 0)
    print(f"Exported {count} training entries")
    print(f"  By type: {data.get('by_type', {})}")
    print(f"  By source: {data.get('by_source', {})}")

    if not jsonl:
        return []

    records = []
    for line in jsonl.split("\n"):
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except Exception:
                pass

    return records


def merge_with_existing(records: list[dict], head_type: str) -> Path:
    """
    Merge exported records with existing training labels.
    Returns path to merged JSONL file.
    """
    LABELS_DIR.mkdir(parents=True, exist_ok=True)

    if head_type == "stage":
        existing_file = LABELS_DIR / "stage_labels.jsonl"
        merged_file = LABELS_DIR / "stage_labels_merged.jsonl"
    elif head_type == "zone":
        existing_file = LABELS_DIR / "labels.jsonl"
        merged_file = LABELS_DIR / "labels_merged.jsonl"
    else:
        existing_file = LABELS_DIR / "labels.jsonl"
        merged_file = LABELS_DIR / "labels_merged.jsonl"

    # Load existing
    existing_ids = set()
    existing_records = []
    if existing_file.exists():
        with open(existing_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    rec_id = rec.get("image_id") or rec.get("image_path", "")
                    existing_ids.add(rec_id)
                    existing_records.append(rec)
                except Exception:
                    pass

    print(f"Existing labels: {len(existing_records)}")

    # Merge: new records override existing by image_id
    new_count = 0
    override_count = 0
    for rec in records:
        rec_id = rec.get("image_id", "")
        if rec_id in existing_ids:
            # Override existing with ground truth
            existing_records = [
                r for r in existing_records
                if (r.get("image_id") or r.get("image_path", "")) != rec_id
            ]
            existing_records.append(rec)
            override_count += 1
        else:
            existing_records.append(rec)
            new_count += 1

    print(f"After merge: {len(existing_records)} total ({new_count} new, {override_count} overrides)")

    # Write merged file
    with open(merged_file, "w") as f:
        for rec in existing_records:
            f.write(json.dumps(rec) + "\n")

    # Also update the original labels file
    with open(existing_file, "w") as f:
        for rec in existing_records:
            f.write(json.dumps(rec) + "\n")

    return merged_file


def retrain_head(head_type: str, epochs: int = 10):
    """Invoke the appropriate training script."""
    import subprocess

    if head_type == "stage":
        script = YONO_DIR / "scripts" / "train_stage_classifier.py"
        cmd = [sys.executable, str(script), "--epochs", str(epochs)]
    elif head_type == "zone":
        script = YONO_DIR / "scripts" / "train_zone_classifier.py"
        cmd = [sys.executable, str(script), "--epochs", str(epochs)]
    else:
        print(f"Unknown head type: {head_type}")
        return

    print(f"\nRetraining {head_type} head ({epochs} epochs)...")
    print(f"Command: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(YONO_DIR))

    if result.returncode == 0:
        print(f"\n{head_type} head retrained successfully!")
    else:
        print(f"\n{head_type} head training failed (exit code {result.returncode})")


def main():
    parser = argparse.ArgumentParser(description="Retrain YONO heads from active learning queue")
    parser.add_argument("--head", choices=["stage", "zone", "all"], default="all",
                        help="Which head(s) to retrain")
    parser.add_argument("--epochs", type=int, default=10,
                        help="Training epochs for fine-tuning")
    parser.add_argument("--limit", type=int, default=2000,
                        help="Max training entries to export")
    parser.add_argument("--dry-run", action="store_true",
                        help="Export only, show stats, no training")
    parser.add_argument("--export-only", action="store_true",
                        help="Export and save JSONL, skip training")
    args = parser.parse_args()

    print("=" * 60)
    print("YONO Retrain From Queue")
    print("=" * 60)
    print(f"Head:   {args.head}")
    print(f"Epochs: {args.epochs}")
    print(f"Limit:  {args.limit}")
    print()

    # Step 1: Export ground truth from training queue
    heads = ["stage", "zone"] if args.head == "all" else [args.head]

    for head_type in heads:
        print(f"\n--- {head_type.upper()} HEAD ---")

        prediction_type = head_type if head_type != "all" else "all"
        records = export_training_data(prediction_type, args.limit)

        if not records:
            print(f"No training data for {head_type}, skipping.")
            continue

        if args.dry_run:
            print(f"\nDRY RUN: Would merge {len(records)} records and retrain {head_type} head")
            continue

        # Step 2: Merge with existing labels
        merged_path = merge_with_existing(records, head_type)
        print(f"Merged labels saved to: {merged_path}")

        if args.export_only:
            print("Export only — skipping training")
            continue

        # Step 3: Retrain
        retrain_head(head_type, args.epochs)

    print("\nDone!")
    if not args.dry_run and not args.export_only:
        print("Upload new models to Modal:")
        print("  bash yono/scripts/upload_models_to_modal.sh")
        print("Then redeploy the sidecar.")


if __name__ == "__main__":
    main()
