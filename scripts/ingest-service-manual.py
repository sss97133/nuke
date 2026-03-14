#!/usr/bin/env python3
"""
Ingest OEM service manuals → library_documents + service_manual_chunks.

Parses PDF text, detects section boundaries, classifies content types,
extracts key topics, and writes indexed chunks to the database.

Usage:
  cd /Users/skylar/nuke
  dotenvx run -- python3 scripts/ingest-service-manual.py <path-to-pdf> [--title "..."] [--year 1982] [--make-family "GM C/K"]
  dotenvx run -- python3 scripts/ingest-service-manual.py --list  # show existing documents
"""

import os
import re
import sys
import json
import argparse
import hashlib
from pathlib import Path

import PyPDF2
import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")


def get_connection():
    db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
    if not db_pass:
        for line in (NUKE_DIR / ".env").read_text().splitlines():
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
    if not db_pass:
        raise RuntimeError("SUPABASE_DB_PASSWORD not set")
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_url = (
            f"postgresql://postgres.qkgaybvrernstplzjaam:{db_pass}"
            f"@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
            f"?sslmode=require"
        )
    try:
        return psycopg2.connect(db_url, connect_timeout=15)
    except psycopg2.OperationalError:
        return psycopg2.connect(
            host="52.8.172.168", port=6543,
            user="postgres.qkgaybvrernstplzjaam",
            password=db_pass, dbname="postgres",
            sslmode="require", connect_timeout=15,
        )


# ── Section Detection ────────────────────────────────────────────

# Patterns that indicate major section headers in GM service manuals
SECTION_PATTERNS = [
    # "SECTION 2A — FRAME AND BODY MOUNTS"
    re.compile(r'SECTION\s+(\d+[A-Z]?\d?)\s*[-—–]\s*(.+)', re.IGNORECASE),
    # "2A-1  FRAME AND BODY MOUNTS" (page header style)
    re.compile(r'^(\d+[A-Z]\d?)-\d+\s+([A-Z][A-Z\s,&/]+)$', re.MULTILINE),
    # "GENERAL DESCRIPTION", "DIAGNOSIS", "SPECIFICATIONS"
    re.compile(r'^(GENERAL\s+DESCRIPTION|DIAGNOSIS|SPECIFICATIONS?|MAINTENANCE|OVERHAUL|DISASSEMBLY|ASSEMBLY|REMOVAL|INSTALLATION|INSPECTION|ADJUSTMENTS?|TORQUE\s+SPECIFICATIONS)', re.MULTILINE),
]

# Content type classification patterns
DIAGNOSIS_PATTERNS = [
    re.compile(r'CONDITION\s+POSSIBLE\s+CAUSE\s+CORRECTION', re.IGNORECASE),
    re.compile(r'TROUBLE\s*SHOOTING', re.IGNORECASE),
    re.compile(r'DIAGNOSIS\s+(CHART|TABLE|GUIDE)', re.IGNORECASE),
    re.compile(r'SYMPTOM.*CAUSE.*REMEDY', re.IGNORECASE),
    re.compile(r'PROBLEM.*CAUSE.*SOLUTION', re.IGNORECASE),
]

SPEC_PATTERNS = [
    re.compile(r'TORQUE\s+SPECIFICATIONS', re.IGNORECASE),
    re.compile(r'SPECIFICATIONS?\s*$', re.MULTILINE | re.IGNORECASE),
    re.compile(r'ft[\.\s-]*lbs|N[\.\s]*m|in[\.\s-]*lbs', re.IGNORECASE),
    re.compile(r'\d+\.\d+\s*(mm|inches?|in\.)', re.IGNORECASE),
    re.compile(r'CLEARANCE|TOLERANCE|CAPACITY', re.IGNORECASE),
]

MAINTENANCE_PATTERNS = [
    re.compile(r'MAINTENANCE\s+SCHEDULE', re.IGNORECASE),
    re.compile(r'LUBRICATION', re.IGNORECASE),
    re.compile(r'INSPECTION\s+(INTERVAL|SCHEDULE|CRITERIA)', re.IGNORECASE),
    re.compile(r'\d+[,.]?\d*\s*miles', re.IGNORECASE),
    re.compile(r'EVERY\s+\d+', re.IGNORECASE),
]

PROCEDURE_PATTERNS = [
    re.compile(r'^\s*\d+\.\s+', re.MULTILINE),  # Numbered steps
    re.compile(r'REMOVAL|INSTALLATION|DISASSEMBLY|ASSEMBLY|REPLACEMENT|ADJUSTMENT', re.IGNORECASE),
    re.compile(r'OVERHAUL', re.IGNORECASE),
]

# Component/topic extraction patterns
COMPONENT_KEYWORDS = [
    'engine', 'transmission', 'transfer case', 'axle', 'differential',
    'brake', 'steering', 'suspension', 'frame', 'body', 'electrical',
    'alternator', 'starter', 'carburetor', 'fuel pump', 'water pump',
    'radiator', 'thermostat', 'clutch', 'flywheel', 'crankshaft',
    'camshaft', 'piston', 'cylinder', 'valve', 'rocker arm', 'pushrod',
    'connecting rod', 'bearing', 'seal', 'gasket', 'bushing', 'mount',
    'spring', 'shock absorber', 'ball joint', 'tie rod', 'pitman arm',
    'idler arm', 'control arm', 'sway bar', 'stabilizer',
    'master cylinder', 'wheel cylinder', 'caliper', 'rotor', 'drum',
    'brake pad', 'brake shoe', 'proportioning valve', 'booster',
    'wiring', 'fuse', 'relay', 'switch', 'gauge', 'lamp', 'horn',
    'heater', 'air conditioning', 'compressor', 'evaporator', 'condenser',
    'exhaust', 'muffler', 'catalytic converter', 'manifold',
    'propeller shaft', 'u-joint', 'driveshaft', 'yoke',
    'body mount', 'rocker panel', 'fender', 'hood', 'tailgate',
    'bumper', 'grille', 'windshield', 'door', 'quarter panel',
]

# GM manual section to system mapping
SECTION_SYSTEM_MAP = {
    '0A': 'general', '0B': 'maintenance',
    '1A': 'hvac', '1B': 'hvac', '1C': 'hvac', '1D': 'hvac',
    '2A': 'frame', '2B': 'body', '2C': 'body', '2D': 'body',
    '3A': 'steering', '3B': 'suspension', '3C': 'suspension',
    '3D': 'wheels', '3E': 'steering',
    '4A': 'drivetrain', '4B': 'drivetrain', '4C': 'drivetrain',
    '5': 'brakes',
    '6': 'engine', '6A': 'engine', '6A1': 'engine', '6B': 'engine',
    '6C': 'engine', '6D': 'engine', '6E': 'engine', '6F': 'engine',
    '6M': 'fuel',
    '7A': 'transmission', '7B': 'transmission', '7C': 'transmission',
    '7D': 'transmission', '7E': 'transfer_case',
    '8A': 'electrical', '8B': 'electrical', '8C': 'electrical',
    '9': 'accessories',
}


def classify_content_type(text: str) -> str:
    """Classify a chunk's content type based on patterns."""
    text_upper = text.upper()

    # Check diagnosis first (most valuable)
    for pat in DIAGNOSIS_PATTERNS:
        if pat.search(text):
            return 'diagnosis'

    # Specifications
    spec_hits = sum(1 for pat in SPEC_PATTERNS if pat.search(text))
    if spec_hits >= 2:
        return 'specification'

    # Maintenance
    maint_hits = sum(1 for pat in MAINTENANCE_PATTERNS if pat.search(text))
    if maint_hits >= 2:
        return 'maintenance'

    # Check for reference/chart (has lots of numbers in table format)
    if text.count('\n') > 5:
        lines = text.strip().split('\n')
        numeric_lines = sum(1 for l in lines if re.search(r'\d+\.\d+|\d+/\d+|\d+-\d+', l))
        if numeric_lines > len(lines) * 0.4:
            return 'specification'

    # Procedures (numbered steps)
    for pat in PROCEDURE_PATTERNS:
        if pat.search(text):
            return 'procedure'

    return 'reference'


def extract_key_topics(text: str, section_name: str = None) -> list:
    """Extract component/system topics from chunk text."""
    text_lower = text.lower()
    topics = set()

    for keyword in COMPONENT_KEYWORDS:
        if keyword in text_lower:
            topics.add(keyword)

    # Add section-derived system
    if section_name:
        section_code = re.match(r'(\d+[A-Z]?\d?)', section_name)
        if section_code:
            system = SECTION_SYSTEM_MAP.get(section_code.group(1))
            if system:
                topics.add(system)

    return sorted(topics)[:15]  # Cap at 15 topics


def detect_section(text: str) -> tuple:
    """Try to detect a section header from page text. Returns (section_code, section_title) or (None, None)."""
    for pat in SECTION_PATTERNS[:2]:  # Only structured patterns
        m = pat.search(text[:500])  # Check first 500 chars
        if m:
            return m.group(1).strip(), m.group(2).strip()
    return None, None


def extract_page_header(text: str) -> tuple:
    """Extract section code from page header like '2A-15 FRAME AND BODY MOUNTS'."""
    m = re.match(r'^(\d+[A-Z]\d?)-(\d+)\s+(.+?)$', text.strip().split('\n')[0] if text.strip() else '')
    if m:
        return m.group(1), m.group(3).strip()
    # Try "SECTION_CODE-PAGE_NUM  TITLE" format
    m = re.match(r'^(\d+[A-Z]?\d?)-\d+\s+(.+)', text.strip().split('\n')[0] if text.strip() else '')
    if m:
        return m.group(1), m.group(2).strip()
    return None, None


def parse_pdf(pdf_path: str) -> list:
    """
    Parse PDF into page-by-page text with section tracking.
    Returns list of {page_number, text, section_name, section_heading}.
    """
    reader = PyPDF2.PdfReader(pdf_path)
    pages = []
    current_section = None
    current_heading = None

    print(f"  Parsing {len(reader.pages)} pages...")

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = text.strip()

        if not text or len(text) < 20:
            continue

        # Try to detect section from page header
        sec_code, sec_title = extract_page_header(text)
        if not sec_code:
            sec_code, sec_title = detect_section(text)

        if sec_code:
            current_section = sec_code
            current_heading = sec_title

        pages.append({
            "page_number": i + 1,
            "text": text,
            "section_name": current_section,
            "section_heading": current_heading,
        })

    print(f"  Extracted text from {len(pages)} non-empty pages")
    return pages


def chunk_pages(pages: list, chunk_size: int = 2) -> list:
    """
    Group consecutive pages within the same section into chunks.
    Chunks are 1-2 pages (configurable) to keep context manageable.
    """
    if not pages:
        return []

    chunks = []
    current_chunk_pages = []
    current_section = pages[0].get("section_name")

    for page in pages:
        section = page.get("section_name")

        # Start new chunk on section change or size limit
        if section != current_section or len(current_chunk_pages) >= chunk_size:
            if current_chunk_pages:
                chunks.append(_build_chunk(current_chunk_pages))
            current_chunk_pages = [page]
            current_section = section
        else:
            current_chunk_pages.append(page)

    if current_chunk_pages:
        chunks.append(_build_chunk(current_chunk_pages))

    return chunks


def _build_chunk(pages: list) -> dict:
    """Build a chunk dict from a list of page dicts."""
    text = "\n\n".join(p["text"] for p in pages)
    first_page = pages[0]["page_number"]
    section_name = pages[0].get("section_name")
    section_heading = pages[0].get("section_heading")

    content_type = classify_content_type(text)
    key_topics = extract_key_topics(text, section_name)

    return {
        "page_number": first_page,
        "section_name": section_name,
        "section_heading": section_heading,
        "content": text,
        "content_type": content_type,
        "key_topics": key_topics,
    }


def register_document(conn, pdf_path: str, title: str, year: int = None,
                       make_family: str = None, page_count: int = None) -> str:
    """Register a manual in library_documents. Returns document_id."""
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Check if already registered (by title)
    cur.execute("SELECT id FROM library_documents WHERE title = %s", (title,))
    existing = cur.fetchone()
    if existing:
        print(f"  Document already registered: {existing['id']}")
        cur.close()
        return str(existing["id"])

    file_size = os.path.getsize(pdf_path)

    # Need a library_id — use existing reference library
    cur.execute("SELECT id FROM reference_libraries LIMIT 1")
    lib = cur.fetchone()
    if not lib:
        # Use a known existing library_id from library_documents
        cur.execute("SELECT DISTINCT library_id FROM library_documents LIMIT 1")
        lib_row = cur.fetchone()
        library_id = str(lib_row["library_id"]) if lib_row else None
        if not library_id:
            raise RuntimeError("No reference_libraries or library_documents found")
    else:
        library_id = str(lib["id"])

    # We need an uploaded_by UUID — use a system account
    cur.execute("SELECT id FROM auth.users LIMIT 1")
    user = cur.fetchone()
    user_id = str(user["id"]) if user else None

    cur.execute("""
        INSERT INTO library_documents (
            library_id, document_type, title, description,
            file_url, file_size_bytes, page_count, mime_type,
            year_published, uploaded_by,
            metadata
        ) VALUES (
            %s, 'service_manual', %s, %s,
            %s, %s, %s, 'application/pdf',
            %s, %s,
            %s
        )
        RETURNING id
    """, (
        library_id, title,
        f"Factory service manual for {make_family or 'GM'} vehicles",
        f"file://{pdf_path}", file_size, page_count,
        year, user_id,
        json.dumps({"make_family": make_family, "source": "local_pdf"}),
    ))
    doc = cur.fetchone()
    conn.commit()
    cur.close()

    doc_id = str(doc["id"])
    print(f"  Registered document: {doc_id}")
    return doc_id


def ingest_chunks(conn, document_id: str, chunks: list) -> int:
    """Write chunks to service_manual_chunks. Returns count written."""
    cur = conn.cursor()

    # Clear existing chunks for this document (idempotent re-ingest)
    cur.execute("DELETE FROM service_manual_chunks WHERE document_id = %s", (document_id,))
    deleted = cur.rowcount
    if deleted:
        print(f"  Cleared {deleted} existing chunks")

    written = 0
    for chunk in chunks:
        # Validate content_type against CHECK constraint
        valid_types = ('procedure', 'specification', 'chart', 'diagram', 'reference')
        ct = chunk["content_type"]
        # Map our extended types to the CHECK constraint values
        type_map = {
            'diagnosis': 'chart',       # diagnosis tables → chart
            'maintenance': 'reference', # maintenance schedules → reference
        }
        db_content_type = type_map.get(ct, ct)
        if db_content_type not in valid_types:
            db_content_type = 'reference'

        cur.execute("""
            INSERT INTO service_manual_chunks (
                document_id, page_number, section_name, section_heading,
                content, content_type, key_topics, metadata
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            document_id,
            chunk["page_number"],
            chunk["section_name"],
            chunk["section_heading"],
            chunk["content"],
            db_content_type,
            chunk["key_topics"],
            json.dumps({
                "original_content_type": chunk["content_type"],
                "char_count": len(chunk["content"]),
            }),
        ))
        written += 1

        if written % 50 == 0:
            conn.commit()
            print(f"  Written {written} chunks...")

    conn.commit()
    cur.close()
    print(f"  Total chunks written: {written}")
    return written


def list_documents(conn):
    """List existing library documents."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT ld.id, ld.title, ld.page_count, ld.year_published,
               count(smc.id) as chunk_count
        FROM library_documents ld
        LEFT JOIN service_manual_chunks smc ON smc.document_id = ld.id
        WHERE ld.document_type = 'service_manual'
        GROUP BY ld.id, ld.title, ld.page_count, ld.year_published
        ORDER BY ld.year_published
    """)
    docs = cur.fetchall()
    cur.close()

    if not docs:
        print("No service manuals registered.")
        return

    print(f"\n{'ID':40s} {'Title':50s} {'Pages':>6s} {'Chunks':>7s}")
    print("-" * 105)
    for d in docs:
        print(f"{str(d['id']):40s} {(d['title'] or '(untitled)')[:50]:50s} {d['page_count'] or 0:6d} {d['chunk_count']:7d}")


def main():
    parser = argparse.ArgumentParser(description="Ingest OEM service manual PDFs")
    parser.add_argument("pdf_path", nargs="?", help="Path to PDF file")
    parser.add_argument("--title", help="Manual title")
    parser.add_argument("--year", type=int, help="Publication year")
    parser.add_argument("--make-family", help="Make/family (e.g., 'GM C/K')")
    parser.add_argument("--chunk-size", type=int, default=2, help="Pages per chunk (default: 2)")
    parser.add_argument("--list", action="store_true", help="List existing documents")
    args = parser.parse_args()

    os.chdir(NUKE_DIR)
    conn = get_connection()

    if args.list:
        list_documents(conn)
        conn.close()
        return

    if not args.pdf_path:
        parser.error("PDF path required (or use --list)")

    pdf_path = os.path.abspath(args.pdf_path)
    if not os.path.exists(pdf_path):
        print(f"Error: {pdf_path} not found")
        sys.exit(1)

    # Auto-detect title from filename if not provided
    title = args.title or Path(pdf_path).stem.replace("_", " ")

    print(f"\n{'='*60}")
    print(f"Ingesting: {Path(pdf_path).name}")
    print(f"Title: {title}")
    print(f"{'='*60}")

    # 1. Parse PDF
    print("\n[1/3] Parsing PDF...")
    pages = parse_pdf(pdf_path)

    reader = PyPDF2.PdfReader(pdf_path)
    page_count = len(reader.pages)

    # Show section summary
    sections = {}
    for p in pages:
        sec = p.get("section_name") or "(unknown)"
        if sec not in sections:
            sections[sec] = {"heading": p.get("section_heading"), "pages": 0}
        sections[sec]["pages"] += 1

    print(f"\n  Sections found: {len(sections)}")
    for sec, info in sorted(sections.items()):
        print(f"    {sec:8s} {info['heading'] or '':40s} ({info['pages']} pages)")

    # 2. Chunk pages
    print(f"\n[2/3] Chunking into {args.chunk_size}-page segments...")
    chunks = chunk_pages(pages, chunk_size=args.chunk_size)

    # Content type summary
    type_counts = {}
    for c in chunks:
        ct = c["content_type"]
        type_counts[ct] = type_counts.get(ct, 0) + 1

    print(f"  Total chunks: {len(chunks)}")
    for ct, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"    {ct:20s} {count}")

    # 3. Register and write
    print(f"\n[3/3] Writing to database...")
    doc_id = register_document(
        conn, pdf_path, title,
        year=args.year, make_family=args.make_family,
        page_count=page_count,
    )
    written = ingest_chunks(conn, doc_id, chunks)

    print(f"\nDone! {written} chunks ingested for document {doc_id}")
    conn.close()


if __name__ == "__main__":
    main()
