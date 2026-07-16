#!/usr/bin/env python3
"""
Ingest docs/library/_extracted/manifest.json + per-page text files into
public.reference_documents + public.document_pages.

Idempotent via file_hash matching. If a document's hash already exists in
reference_documents, skip extraction insert; only insert any missing page
rows.

Pre-req: 20260522_reference_documents_substrate.sql applied.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO / "docs/library/_extracted"
MANIFEST_PATH = OUT_ROOT / "manifest.json"

CATEGORY_MAP = {
    "service_manuals": "service_manual",
    "k5_factory_docs": "service_manual",
    "wiring_diagram_booklets": "wiring_diagram_booklet",
    "component_drawings": "component_datasheet",
    "vehicle_base_drawings": "vehicle_drawing",
}


def pg_q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"


def pg_arr(arr):
    if not arr:
        return "NULL"
    items = ", ".join(pg_q(x) for x in arr)
    return f"ARRAY[{items}]"


def pg_jsonb(d):
    if d is None:
        return "NULL"
    return "'" + json.dumps(d, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def main():
    if not MANIFEST_PATH.exists():
        sys.exit(f"manifest not found: {MANIFEST_PATH}")
    manifest = json.loads(MANIFEST_PATH.read_text())
    print(f"Manifest has {len(manifest)} documents", file=sys.stderr)

    pgpass = os.environ.get("PGPASSWORD")
    if not pgpass:
        sys.exit("PGPASSWORD required")
    base = ["psql", "-h", "aws-0-us-west-1.pooler.supabase.com", "-p", "6543",
            "-U", "postgres.qkgaybvrernstplzjaam", "-d", "postgres",
            "-v", "ON_ERROR_STOP=1"]

    inserted_docs = 0
    skipped_docs = 0
    inserted_pages = 0

    for slug, meta in manifest.items():
        # Check existing
        chk = subprocess.run(base + ["-t","-A","-c",
            f"SELECT id, file_hash FROM public.reference_documents WHERE slug = {pg_q(slug)};"],
            env={**os.environ, "PGPASSWORD": pgpass},
            capture_output=True, text=True)
        existing = chk.stdout.strip()
        if existing:
            existing_id, existing_hash = existing.split("|")
            if existing_hash == meta["file_hash"]:
                # Already ingested at this hash
                skipped_docs += 1
                continue
            # Hash changed — supersede
            doc_id = None
        else:
            doc_id = None

        # Determine category
        category = CATEGORY_MAP.get(meta["category"], "other")
        title = meta["file_path"].rsplit("/", 1)[-1].replace("_", " ").rsplit(".", 1)[0]

        # Insert document
        ext_method = "pdftotext" if meta.get("extraction_method") == "pdftotext" else "pdftotext_layout"
        ext_quality = "high" if meta.get("pages_empty", 0) < meta["page_count"] * 0.1 else (
            "medium" if meta.get("pages_empty", 0) < meta["page_count"] * 0.5 else "low"
        )

        doc_insert = f"""
INSERT INTO public.reference_documents
  (slug, title, category, file_path, file_hash, page_count, year, topics, extraction_method, extraction_quality, extracted_at)
VALUES (
  {pg_q(slug)}, {pg_q(title)}, {pg_q(category)}, {pg_q(meta['file_path'])},
  {pg_q(meta['file_hash'])}, {meta['page_count']}, {pg_q(meta.get('year'))},
  {pg_arr(meta.get('topics'))},
  {pg_q(ext_method)}, {pg_q(ext_quality)},
  {pg_q(meta.get('extracted_at'))})
RETURNING id;
"""
        r = subprocess.run(base + ["-t","-A","-c", doc_insert],
            env={**os.environ, "PGPASSWORD": pgpass},
            capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  FAIL {slug}: {r.stderr[:300]}", file=sys.stderr)
            continue
        # Last line of stdout has the id
        doc_id = [l for l in r.stdout.strip().splitlines() if l and "-" in l][-1]
        inserted_docs += 1

        # Insert pages (batch)
        doc_dir = OUT_ROOT / slug
        page_files = sorted(doc_dir.glob("page-*.txt"))
        if not page_files:
            print(f"  no page files for {slug}", file=sys.stderr)
            continue

        # Build batch insert in chunks of 50 pages
        chunk_size = 50
        for i in range(0, len(page_files), chunk_size):
            chunk = page_files[i:i+chunk_size]
            values = []
            for pf in chunk:
                m = re.match(r"page-(\d+)\.txt", pf.name)
                if not m:
                    continue
                page_num = int(m.group(1))
                text = pf.read_text()
                values.append(
                    f"({pg_q(doc_id)}, {page_num}, {pg_q(text)}, {pg_q(ext_method)})"
                )
            if not values:
                continue
            page_sql = (
                "BEGIN; SET LOCAL statement_timeout='120s';\n"
                "INSERT INTO public.document_pages (document_id, page_number, extracted_text, extraction_method) VALUES\n"
                + ",\n".join(values) + ";\nCOMMIT;\n"
            )
            r = subprocess.run(base + ["-c", page_sql],
                env={**os.environ, "PGPASSWORD": pgpass},
                capture_output=True, text=True)
            if r.returncode != 0:
                print(f"  FAIL pages batch {i} for {slug}: {r.stderr[:300]}", file=sys.stderr)
                break
            inserted_pages += len(values)
        print(f"  [{inserted_docs}] {slug}: {len(page_files)} pages ingested", file=sys.stderr)

    print(f"\nDONE. {inserted_docs} new docs, {skipped_docs} skipped (already ingested at same hash), {inserted_pages} pages inserted.", file=sys.stderr)


if __name__ == "__main__":
    main()
