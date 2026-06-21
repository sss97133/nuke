#!/usr/bin/env python3
"""
Extract text per page from every PDF in reference_documents/ into greppable
flat text files. Write a JSON manifest with metadata + file hashes.

Output layout:
  docs/library/_extracted/
    manifest.json
    <document_slug>/
      page-0001.txt
      page-0002.txt
      ...

Usage:
  python3 scripts/library_index.py [--force] [--filter <substring>]

Pure pdftotext extraction — no OCR. Image-only PDFs end up with empty/sparse
files and get flagged in the manifest with extraction_method='pdftotext_empty'
so they can be triaged for vision OCR in a later pass.

Idempotent: skips files whose hash matches the manifest unless --force.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parent.parent
SOURCE_ROOT = REPO / "reference_documents"
OUT_ROOT = REPO / "docs/library/_extracted"
MANIFEST_PATH = OUT_ROOT / "manifest.json"

# Year-tag inference from filename
YEAR_RE = re.compile(r"\b(19[5-9][0-9]|20[0-2][0-9])\b")
# Vehicle/topic inference from filename
TOPIC_HINTS = {
    "blazer": "K5_Blazer",
    "k5": "K5_Blazer",
    "ck": "C/K_Truck",
    "c10": "C10",
    "k10": "K10",
    "light_truck": "Light_Truck",
    "service_manual": "service_manual",
    "wiring": "wiring",
    "ls3": "LS3",
    "motec": "MoTeC",
    "pdm": "MoTeC_PDM",
    "frame_dimensions": "frame_dimensions",
    "metri-pack": "Metri-Pack",
    "weather-pack": "Weather-Pack",
    "delphi": "Delphi",
    "bosch": "Bosch",
    "dakota_digital": "Dakota_Digital",
    "aeromotive": "Aeromotive",
    "holley": "Holley",
    "rpo": "RPO_codes",
}


def slugify(p: Path) -> str:
    rel = p.relative_to(SOURCE_ROOT).with_suffix("")
    s = str(rel).replace("/", "__").lower()
    return re.sub(r"[^a-z0-9_]+", "_", s).strip("_")


def file_hash(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def infer_metadata(p: Path) -> dict:
    name_lower = p.name.lower()
    rel = p.relative_to(SOURCE_ROOT)
    year_m = YEAR_RE.search(p.name)
    year = int(year_m.group(1)) if year_m else None
    topics = []
    for k, v in TOPIC_HINTS.items():
        if k in name_lower:
            topics.append(v)
    # Top-level category from path
    category = rel.parts[0] if rel.parts else "unknown"
    return {
        "year": year,
        "topics": sorted(set(topics)),
        "category": category,
    }


def pdf_page_count(p: Path) -> int:
    try:
        out = subprocess.run(["pdfinfo", str(p)], capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":")[1].strip())
    except Exception:
        return 0
    return 0


def extract_text_per_page(p: Path, out_dir: Path, page_count: int) -> dict:
    """Run pdftotext per page. Returns stats."""
    out_dir.mkdir(parents=True, exist_ok=True)
    chars_total = 0
    empty_pages = 0
    for i in range(1, page_count + 1):
        page_file = out_dir / f"page-{i:04d}.txt"
        try:
            r = subprocess.run(
                ["pdftotext", "-layout", "-f", str(i), "-l", str(i), str(p), str(page_file)],
                capture_output=True, text=True, timeout=15
            )
            if r.returncode != 0:
                page_file.write_text("")
        except subprocess.TimeoutExpired:
            page_file.write_text("")
        text = page_file.read_text() if page_file.exists() else ""
        text = text.strip()
        if not text:
            empty_pages += 1
        chars_total += len(text)
    return {
        "pages_total": page_count,
        "pages_empty": empty_pages,
        "chars_extracted": chars_total,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-extract even if hash matches")
    parser.add_argument("--filter", default=None, help="Substring filter on filename")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N files")
    args = parser.parse_args()

    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    # Load existing manifest if present
    manifest = {}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text())

    pdfs = sorted(SOURCE_ROOT.rglob("*.pdf"))
    if args.filter:
        pdfs = [p for p in pdfs if args.filter.lower() in p.name.lower()]
    if args.limit:
        pdfs = pdfs[:args.limit]

    print(f"Processing {len(pdfs)} PDFs from {SOURCE_ROOT}", file=sys.stderr)
    print(f"Output: {OUT_ROOT}", file=sys.stderr)

    new_or_updated = 0
    for i, p in enumerate(pdfs, 1):
        slug = slugify(p)
        h = file_hash(p)
        existing = manifest.get(slug, {})
        if not args.force and existing.get("file_hash") == h and existing.get("extracted_at"):
            # already extracted at this hash
            continue

        page_count = pdf_page_count(p)
        if page_count == 0:
            print(f"  [{i}/{len(pdfs)}] {slug}: pdfinfo returned 0 pages, skipping", file=sys.stderr)
            continue

        print(f"  [{i}/{len(pdfs)}] {slug}: {page_count} pages, extracting...", file=sys.stderr)
        out_dir = OUT_ROOT / slug
        if out_dir.exists():
            shutil.rmtree(out_dir)
        stats = extract_text_per_page(p, out_dir, page_count)

        meta = infer_metadata(p)
        manifest[slug] = {
            "slug": slug,
            "file_path": str(p.relative_to(REPO)),
            "file_hash": h,
            "page_count": page_count,
            "extraction_method": "pdftotext" if stats["pages_empty"] < page_count * 0.8 else "pdftotext_empty_needs_ocr",
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            **meta,
            **stats,
        }
        new_or_updated += 1

        # Save manifest periodically
        if new_or_updated % 5 == 0:
            MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True))

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"\nDONE. {new_or_updated} new/updated extractions. Manifest: {MANIFEST_PATH.relative_to(REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
