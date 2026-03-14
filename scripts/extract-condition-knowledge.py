#!/usr/bin/env python3
"""
Extract condition knowledge from service manual chunks → condition_knowledge table.

Reads diagnosis tables, specifications, and maintenance schedules from
service_manual_chunks, parses structured entries where possible, uses
Claude Haiku for ambiguous content, and writes to condition_knowledge.

Usage:
  cd /Users/skylar/nuke
  dotenvx run -- python3 scripts/extract-condition-knowledge.py [--dry-run] [--limit 50]
  dotenvx run -- python3 scripts/extract-condition-knowledge.py --doc-id UUID
"""

import os
import re
import sys
import json
import time
import argparse
from pathlib import Path
from collections import defaultdict

import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")

# Section code → system mapping
SECTION_SYSTEM_MAP = {
    '0A': 'general', '0B': 'general',
    '1A': 'hvac', '1B': 'hvac', '1C': 'hvac', '1C1': 'hvac', '1D': 'hvac',
    '2A': 'frame', '2B': 'body', '2C': 'body', '2D': 'body',
    '3A': 'steering', '3B': 'steering', '3B1': 'steering', '3B2': 'steering',
    '3B3': 'steering', '3B4': 'steering',
    '3C': 'suspension', '3D': 'suspension',
    '3E': 'wheels',
    '4A': 'drivetrain', '4B': 'drivetrain', '4B6': 'drivetrain',
    '4C': 'drivetrain',
    '5': 'brakes',
    '6': 'engine', '6A': 'engine', '6A1': 'engine', '6A4': 'engine',
    '6A5': 'engine', '6A7': 'engine',
    '6B': 'engine', '6C': 'fuel', '6C1': 'fuel', '6C2': 'fuel',
    '6C4': 'fuel', '6C5': 'fuel', '6C6': 'fuel',
    '6D': 'electrical', '6E': 'engine', '6F': 'exhaust',
    '6M': 'fuel', '6Y': 'electrical',
    '7A': 'transmission', '7B': 'transmission', '7B1': 'transmission',
    '7B2': 'transmission', '7B3': 'transmission', '7B4': 'transmission',
    '7C': 'clutch', '7E': 'transfer_case', '7M': 'transmission',
    '8A': 'electrical', '8B': 'electrical', '8C': 'electrical',
    '9': 'accessories',
    '10': 'general',
    '60': 'electrical', '700': 'transmission',
    '1': 'hvac', '3': 'drivetrain', '4': 'drivetrain',
}

# System → condition_domain mapping
SYSTEM_DOMAIN_MAP = {
    'frame': 'structural',
    'body': 'exterior',
    'steering': 'mechanical',
    'suspension': 'mechanical',
    'wheels': 'mechanical',
    'brakes': 'mechanical',
    'engine': 'mechanical',
    'fuel': 'mechanical',
    'exhaust': 'mechanical',
    'electrical': 'interior',  # gauges, wiring often interior-visible
    'transmission': 'mechanical',
    'transfer_case': 'mechanical',
    'clutch': 'mechanical',
    'drivetrain': 'mechanical',
    'hvac': 'interior',
    'accessories': 'interior',
    'general': 'mechanical',
}

# System → related zones
SYSTEM_ZONES = {
    'frame': ['ext_undercarriage', 'structural_frame'],
    'body': ['ext_body_side', 'ext_rear', 'ext_front'],
    'steering': ['mech_engine_bay', 'ext_undercarriage'],
    'suspension': ['ext_undercarriage', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
    'wheels': ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
    'brakes': ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'ext_undercarriage'],
    'engine': ['mech_engine_bay'],
    'fuel': ['mech_engine_bay', 'ext_undercarriage'],
    'exhaust': ['ext_undercarriage', 'ext_rear'],
    'electrical': ['int_dashboard', 'mech_engine_bay'],
    'transmission': ['mech_engine_bay', 'ext_undercarriage'],
    'transfer_case': ['ext_undercarriage'],
    'clutch': ['mech_engine_bay'],
    'drivetrain': ['ext_undercarriage'],
    'hvac': ['int_dashboard', 'mech_engine_bay'],
    'accessories': ['int_dashboard', 'int_front_seats'],
    'general': [],
}


def get_connection():
    db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
    if not db_pass:
        for line in (NUKE_DIR / ".env").read_text().splitlines():
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
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


# ── Regex-based parsers for structured diagnosis tables ──────────

def parse_condition_cause_correction(text: str) -> list:
    """
    Parse CONDITION / POSSIBLE CAUSE / CORRECTION tables.
    These appear as:
      CONDITION          POSSIBLE CAUSE        CORRECTION
      Some condition.    Some cause.           Some fix.
                         Another cause.        Another fix.
    """
    entries = []

    # Split into lines and look for the pattern
    lines = text.split('\n')

    current_condition = None
    current_causes = []
    current_corrections = []

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Skip header rows
        if re.match(r'^CONDITION\s+POSSIBLE\s+CAUSE', line, re.IGNORECASE):
            i += 1
            continue
        if re.match(r'^SYMPTOM\s+CAUSE\s+(REMEDY|SOLUTION|CORRECTION)', line, re.IGNORECASE):
            i += 1
            continue
        if re.match(r'^PROBLEM\s+CAUSE\s+SOLUTION', line, re.IGNORECASE):
            i += 1
            continue
        if re.match(r'^Cause\s+Solution\s*$', line, re.IGNORECASE):
            i += 1
            continue

        if not line:
            i += 1
            continue

        # Detect new condition entries (typically start at left margin with a capital word)
        # Heuristic: if the line has content that looks like a condition statement
        # followed by cause/correction on the same or next line

        # Try to split line into 2-3 columns by detecting large gaps (2+ spaces)
        parts = re.split(r'\s{2,}', line, maxsplit=2)

        if len(parts) >= 2:
            first_part = parts[0].strip()
            second_part = parts[1].strip() if len(parts) > 1 else ""
            third_part = parts[2].strip() if len(parts) > 2 else ""

            # Check if this starts a new condition (has text in first column)
            if first_part and len(first_part) > 5:
                # Save previous entry
                if current_condition:
                    entries.append({
                        "condition": current_condition,
                        "causes": current_causes[:],
                        "corrections": current_corrections[:],
                    })
                current_condition = first_part
                current_causes = [second_part] if second_part else []
                current_corrections = [third_part] if third_part else []
            elif second_part:
                # Continuation line (empty first column = more causes/corrections)
                if second_part:
                    current_causes.append(second_part)
                if third_part:
                    current_corrections.append(third_part)
        elif len(parts) == 1 and current_condition:
            # Single-column continuation — append to condition or last field
            # (OCR sometimes doesn't preserve column alignment)
            pass  # Skip unstructured single-column lines within a table

        i += 1

    # Save last entry
    if current_condition:
        entries.append({
            "condition": current_condition,
            "causes": current_causes,
            "corrections": current_corrections,
        })

    return entries


def parse_cause_solution(text: str) -> list:
    """Parse Cause/Solution format (used in steering columns section)."""
    entries = []
    lines = text.split('\n')

    # Look for lettered entries: A. cause  A. solution
    cause_pattern = re.compile(r'^([A-Z])\.\s+(.+)')
    current_causes = []
    current_solutions = []

    for line in lines:
        line = line.strip()
        m = cause_pattern.match(line)
        if m:
            parts = re.split(r'\s{2,}', line, maxsplit=1)
            if len(parts) == 2:
                cause_m = cause_pattern.match(parts[0])
                sol_m = cause_pattern.match(parts[1])
                if cause_m and sol_m:
                    current_causes.append(cause_m.group(2))
                    current_solutions.append(sol_m.group(2))
            elif len(parts) == 1 and m:
                current_causes.append(m.group(2))

    if current_causes:
        entries.append({
            "condition": "System malfunction",
            "causes": current_causes,
            "corrections": current_solutions,
        })

    return entries


def parse_torque_specs(text: str) -> list:
    """Extract torque specifications from text."""
    specs = []

    # Pattern: "Component name ... NN ft-lbs" or "NN N.m"
    torque_pat = re.compile(
        r'(.{10,60}?)\s+(\d+(?:\.\d+)?)\s*(ft[\.\s-]*lbs?|N[\.\s]*m|in[\.\s-]*lbs?)',
        re.IGNORECASE
    )

    for m in torque_pat.finditer(text):
        name = m.group(1).strip()
        value = m.group(2)
        unit = m.group(3).strip().lower().replace(' ', '').replace('.', '')
        # Normalize unit
        if 'ft' in unit:
            unit = 'ft-lbs'
        elif 'nm' in unit or 'n·m' in unit:
            unit = 'N·m'
        elif 'in' in unit:
            unit = 'in-lbs'

        # Clean up the name
        name = re.sub(r'^[-–—\s.]+', '', name)
        name = re.sub(r'[.\s]+$', '', name)
        if len(name) < 5:
            continue

        specs.append({
            "spec_name": name,
            "spec_value": f"{value} {unit}",
            "spec_unit": unit,
            "spec_min": float(value),
            "spec_max": float(value),
        })

    return specs


def parse_clearance_specs(text: str) -> list:
    """Extract clearance/tolerance specifications."""
    specs = []

    # Pattern: "Component ... 0.001-0.005 inches"
    clearance_pat = re.compile(
        r'(.{10,60}?)\s+(\d+\.\d+)\s*[-–to]+\s*(\d+\.\d+)\s*(inches?|in\.|mm|thou)',
        re.IGNORECASE
    )

    for m in clearance_pat.finditer(text):
        name = m.group(1).strip()
        min_val = m.group(2)
        max_val = m.group(3)
        unit = m.group(4).strip().lower()
        if 'in' in unit or 'thou' in unit:
            unit = 'inches'

        name = re.sub(r'^[-–—\s.]+', '', name)
        if len(name) < 5:
            continue

        specs.append({
            "spec_name": name,
            "spec_value": f"{min_val}-{max_val} {unit}",
            "spec_unit": unit,
            "spec_min": float(min_val),
            "spec_max": float(max_val),
        })

    return specs


def infer_severity_class(condition_text: str, system: str) -> str:
    """Infer severity class from condition description and system."""
    text_lower = condition_text.lower()

    # Safety-critical keywords
    safety_words = ['brake', 'steer', 'wander', 'pull', 'lock', 'fail',
                    'unsafe', 'hazard', 'warning', 'crash', 'loss of control']
    if any(w in text_lower for w in safety_words):
        return 'safety_critical'

    # Structural keywords
    structural_words = ['frame', 'crossmember', 'crack', 'weld', 'structural',
                        'body mount', 'chassis', 'buckle']
    if any(w in text_lower for w in structural_words):
        return 'structural'

    # Cosmetic keywords
    cosmetic_words = ['appearance', 'paint', 'chrome', 'trim', 'rattle',
                      'squeak', 'noise', 'cosmetic', 'stain', 'fade']
    if any(w in text_lower for w in cosmetic_words):
        return 'cosmetic'

    # Default based on system
    if system in ('brakes', 'steering', 'suspension'):
        return 'safety_critical'
    if system in ('frame',):
        return 'structural'
    if system in ('body',):
        return 'cosmetic'

    return 'functional'


def infer_component(condition_text: str, section_heading: str, system: str) -> tuple:
    """Infer component and sub_component from text context."""
    text_lower = condition_text.lower()
    heading_lower = (section_heading or "").lower()
    combined = text_lower + " " + heading_lower

    # Component detection (order matters — most specific first)
    component_patterns = [
        ('master_cylinder', r'master\s+cylinder'),
        ('wheel_cylinder', r'wheel\s+cylinder'),
        ('power_brake_booster', r'power\s+brake|booster'),
        ('brake_caliper', r'caliper'),
        ('brake_rotor', r'rotor|disc'),
        ('brake_drum', r'drum'),
        ('brake_pad', r'brake\s+pad|disc\s+pad'),
        ('brake_shoe', r'brake\s+shoe'),
        ('ball_joint', r'ball\s+joint'),
        ('tie_rod', r'tie\s+rod'),
        ('pitman_arm', r'pitman\s+arm'),
        ('idler_arm', r'idler\s+arm'),
        ('control_arm', r'control\s+arm'),
        ('steering_gear', r'steering\s+gear'),
        ('steering_column', r'steering\s+column'),
        ('power_steering_pump', r'power\s+steering\s+pump'),
        ('body_mount', r'body\s+mount'),
        ('crossmember', r'crossmember|cross\s+member'),
        ('rocker_panel', r'rocker\s+panel'),
        ('quarter_panel', r'quarter\s+panel'),
        ('fender', r'fender'),
        ('hood', r'hood'),
        ('tailgate', r'tailgate'),
        ('door', r'door'),
        ('windshield', r'windshield'),
        ('bumper', r'bumper'),
        ('alternator', r'alternator'),
        ('starter', r'starter'),
        ('distributor', r'distributor'),
        ('carburetor', r'carburetor'),
        ('fuel_pump', r'fuel\s+pump'),
        ('water_pump', r'water\s+pump'),
        ('radiator', r'radiator'),
        ('thermostat', r'thermostat'),
        ('crankshaft', r'crankshaft'),
        ('camshaft', r'camshaft'),
        ('cylinder_head', r'cylinder\s+head'),
        ('valve', r'valve'),
        ('piston', r'piston'),
        ('connecting_rod', r'connecting\s+rod|con\s+rod'),
        ('transmission', r'transmission'),
        ('clutch', r'clutch'),
        ('differential', r'differential'),
        ('transfer_case', r'transfer\s+case'),
        ('driveshaft', r'driveshaft|propeller\s+shaft|drive\s+shaft'),
        ('u_joint', r'u-joint|universal\s+joint'),
        ('spring', r'leaf\s+spring|coil\s+spring|spring'),
        ('shock_absorber', r'shock\s+absorber|shock'),
        ('sway_bar', r'sway\s+bar|stabilizer'),
        ('wheel_bearing', r'wheel\s+bearing'),
        ('axle_shaft', r'axle\s+shaft'),
        ('gauge', r'gauge|gage'),
        ('wiring', r'wiring|wire'),
        ('fuse', r'fuse'),
        ('exhaust_manifold', r'exhaust\s+manifold'),
        ('muffler', r'muffler'),
    ]

    for component, pattern in component_patterns:
        if re.search(pattern, combined, re.IGNORECASE):
            return component, None

    # Fallback: use system as component
    return system, None


def extract_from_chunk_regex(chunk: dict) -> list:
    """Extract condition knowledge entries from a chunk using regex parsing."""
    entries = []
    content = chunk["content"]
    section = chunk["section_name"] or ""
    heading = chunk["section_heading"] or ""
    content_type = chunk.get("original_content_type") or chunk.get("content_type", "")

    system = SECTION_SYSTEM_MAP.get(section, 'general')
    domain = SYSTEM_DOMAIN_MAP.get(system, 'mechanical')
    zones = SYSTEM_ZONES.get(system, [])

    # Parse diagnosis tables
    if content_type in ('diagnosis', 'chart'):
        parsed = parse_condition_cause_correction(content)
        if not parsed:
            parsed = parse_cause_solution(content)

        for item in parsed:
            component, sub = infer_component(item["condition"], heading, system)
            severity = infer_severity_class(item["condition"], system)

            entries.append({
                "chunk_id": chunk["id"],
                "manual_section": section,
                "page_range": str(chunk["page_number"]),
                "system": system,
                "component": component,
                "sub_component": sub,
                "condition_type": "failure_mode",
                "symptom": item["condition"],
                "possible_causes": item["causes"][:10],
                "corrections": item["corrections"][:10],
                "severity_class": severity,
                "condition_domain": domain,
                "related_zones": zones,
            })

    # Parse specifications
    if content_type in ('specification',):
        torque_specs = parse_torque_specs(content)
        clearance_specs = parse_clearance_specs(content)

        for spec in torque_specs + clearance_specs:
            component, sub = infer_component(spec["spec_name"], heading, system)
            entries.append({
                "chunk_id": chunk["id"],
                "manual_section": section,
                "page_range": str(chunk["page_number"]),
                "system": system,
                "component": component,
                "sub_component": sub,
                "condition_type": "specification",
                "spec_name": spec["spec_name"],
                "spec_value": spec["spec_value"],
                "spec_unit": spec["spec_unit"],
                "spec_min": spec.get("spec_min"),
                "spec_max": spec.get("spec_max"),
                "condition_domain": domain,
                "related_zones": zones,
            })

    return entries


def extract_with_haiku(chunk: dict, api_key: str) -> list:
    """Use Claude Haiku to extract structured knowledge from ambiguous chunks."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)

    section = chunk["section_name"] or ""
    heading = chunk["section_heading"] or ""
    system = SECTION_SYSTEM_MAP.get(section, 'general')
    domain = SYSTEM_DOMAIN_MAP.get(system, 'mechanical')

    # Truncate content to ~3000 chars to keep costs down
    content = chunk["content"][:3000]

    prompt = f"""Extract structured condition knowledge from this service manual excerpt.

Section: {section} — {heading}
System: {system}

TEXT:
{content}

Extract ALL of:
1. Failure modes (symptoms, causes, corrections)
2. Specifications (torque values, clearances, capacities)
3. Inspection criteria (what to check, pass/fail)
4. Maintenance intervals

Return JSON array. Each entry:
{{
  "condition_type": "failure_mode" | "specification" | "inspection_criterion" | "maintenance_interval",
  "component": "specific_component_name",
  "symptom": "description (for failure_modes)",
  "possible_causes": ["cause1", "cause2"],
  "corrections": ["fix1", "fix2"],
  "severity_class": "cosmetic" | "functional" | "safety_critical" | "structural",
  "spec_name": "for specifications",
  "spec_value": "value with units",
  "spec_unit": "unit",
  "inspection_method": "for inspection_criterion",
  "pass_criteria": "for inspection_criterion",
  "fail_indicators": ["indicator1"],
  "inspection_interval": "for maintenance_interval"
}}

Return ONLY the JSON array, no other text. If no extractable knowledge, return [].
"""

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()

        # Parse JSON from response
        if text.startswith('['):
            items = json.loads(text)
        else:
            # Try to extract JSON array from response
            m = re.search(r'\[.*\]', text, re.DOTALL)
            if m:
                items = json.loads(m.group())
            else:
                return []

        entries = []
        zones = SYSTEM_ZONES.get(system, [])
        for item in items:
            entry = {
                "chunk_id": chunk["id"],
                "manual_section": section,
                "page_range": str(chunk["page_number"]),
                "system": system,
                "component": item.get("component", system),
                "sub_component": None,
                "condition_type": item.get("condition_type", "failure_mode"),
                "condition_domain": domain,
                "related_zones": zones,
            }
            # Copy fields based on type
            if entry["condition_type"] == "failure_mode":
                entry["symptom"] = item.get("symptom")
                entry["possible_causes"] = item.get("possible_causes", [])
                entry["corrections"] = item.get("corrections", [])
                entry["severity_class"] = item.get("severity_class", "functional")
            elif entry["condition_type"] == "specification":
                entry["spec_name"] = item.get("spec_name")
                entry["spec_value"] = item.get("spec_value")
                entry["spec_unit"] = item.get("spec_unit")
            elif entry["condition_type"] == "inspection_criterion":
                entry["inspection_method"] = item.get("inspection_method")
                entry["pass_criteria"] = item.get("pass_criteria")
                entry["fail_indicators"] = item.get("fail_indicators", [])
            elif entry["condition_type"] == "maintenance_interval":
                entry["inspection_interval"] = item.get("inspection_interval")
                entry["inspection_method"] = item.get("inspection_method")

            entries.append(entry)
        return entries

    except Exception as e:
        print(f"    Haiku extraction error: {e}")
        return []


def write_entries(conn, entries: list) -> int:
    """Write condition_knowledge entries to the database."""
    cur = conn.cursor()
    written = 0

    for entry in entries:
        try:
            cur.execute("""
                INSERT INTO condition_knowledge (
                    chunk_id, manual_section, page_range,
                    system, component, sub_component,
                    condition_type,
                    symptom, possible_causes, corrections, severity_class,
                    spec_name, spec_value, spec_unit, spec_min, spec_max,
                    inspection_interval, inspection_method, pass_criteria, fail_indicators,
                    condition_domain, related_zones,
                    applicable_makes, applicable_models, applicable_years
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
            """, (
                entry.get("chunk_id"),
                entry.get("manual_section"),
                entry.get("page_range"),
                entry["system"],
                entry["component"],
                entry.get("sub_component"),
                entry["condition_type"],
                entry.get("symptom"),
                entry.get("possible_causes"),
                entry.get("corrections"),
                entry.get("severity_class"),
                entry.get("spec_name"),
                entry.get("spec_value"),
                entry.get("spec_unit"),
                entry.get("spec_min"),
                entry.get("spec_max"),
                entry.get("inspection_interval"),
                entry.get("inspection_method"),
                entry.get("pass_criteria"),
                entry.get("fail_indicators"),
                entry["condition_domain"],
                entry.get("related_zones"),
                ['Chevrolet', 'GMC'],  # applicable_makes
                ['C10', 'C20', 'C30', 'K10', 'K20', 'K30', 'Blazer', 'Suburban', 'Jimmy'],
                '[1967, 1992)',  # applicable_years (square body era)
            ))
            written += 1
        except Exception as e:
            print(f"    Write error: {e}")
            conn.rollback()
            continue

    conn.commit()
    cur.close()
    return written


def main():
    parser = argparse.ArgumentParser(description="Extract condition knowledge from manual chunks")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't write")
    parser.add_argument("--limit", type=int, default=0, help="Limit chunks to process")
    parser.add_argument("--doc-id", help="Process only chunks from this document")
    parser.add_argument("--use-haiku", action="store_true", help="Use Claude Haiku for procedure chunks too")
    parser.add_argument("--haiku-limit", type=int, default=100, help="Max chunks to send to Haiku")
    args = parser.parse_args()

    os.chdir(NUKE_DIR)
    conn = get_connection()

    # Get API key for Haiku
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        for line in (NUKE_DIR / ".env").read_text().splitlines():
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            if key.strip() == "ANTHROPIC_API_KEY":
                api_key = val.strip('"').strip("'")
                break

    # Clear existing condition_knowledge (idempotent re-extraction)
    cur = conn.cursor()
    cur.execute("DELETE FROM condition_knowledge")
    deleted = cur.rowcount
    conn.commit()
    cur.close()
    if deleted:
        print(f"Cleared {deleted} existing condition_knowledge entries")

    # Fetch chunks
    cur = conn.cursor(cursor_factory=RealDictCursor)

    where_clauses = []
    params = []

    if args.doc_id:
        where_clauses.append("smc.document_id = %s")
        params.append(args.doc_id)
    else:
        # Only process chunks from our ingested manuals
        where_clauses.append("""smc.document_id IN (
            SELECT id FROM library_documents
            WHERE document_type = 'service_manual'
        )""")

    where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"
    limit_sql = f"LIMIT {args.limit}" if args.limit else ""

    cur.execute(f"""
        SELECT smc.id, smc.document_id, smc.page_number,
               smc.section_name, smc.section_heading,
               smc.content, smc.content_type,
               smc.key_topics,
               smc.metadata->>'original_content_type' as original_content_type
        FROM service_manual_chunks smc
        WHERE {where_sql}
        ORDER BY smc.document_id, smc.page_number
        {limit_sql}
    """, params)

    chunks = cur.fetchall()
    cur.close()

    print(f"\nProcessing {len(chunks)} chunks...")

    # Phase 1: Regex extraction from diagnosis + specification chunks
    all_entries = []
    regex_count = 0
    haiku_count = 0

    for i, chunk in enumerate(chunks):
        ct = chunk.get("original_content_type") or chunk["content_type"]

        if ct in ('diagnosis', 'chart', 'specification'):
            entries = extract_from_chunk_regex(chunk)
            if entries:
                all_entries.extend(entries)
                regex_count += len(entries)

    print(f"  Regex extraction: {regex_count} entries from diagnosis/spec chunks")

    # Phase 2: Haiku extraction from procedure chunks (the bulk of content)
    if args.use_haiku and api_key:
        procedure_chunks = [c for c in chunks
                           if (c.get("original_content_type") or c["content_type"]) == 'procedure'
                           and len(c["content"]) > 200]

        # Sample procedure chunks (they're numerous, we don't need all)
        haiku_chunks = procedure_chunks[:args.haiku_limit]
        print(f"  Sending {len(haiku_chunks)} procedure chunks to Haiku...")

        for i, chunk in enumerate(haiku_chunks):
            entries = extract_with_haiku(chunk, api_key)
            if entries:
                all_entries.extend(entries)
                haiku_count += len(entries)

            if (i + 1) % 10 == 0:
                print(f"    Haiku: {i+1}/{len(haiku_chunks)} chunks, {haiku_count} entries so far")
                time.sleep(0.5)  # Rate limiting

        print(f"  Haiku extraction: {haiku_count} entries")

    elif args.use_haiku and not api_key:
        print("  WARNING: --use-haiku specified but ANTHROPIC_API_KEY not found")

    # Summary
    type_counts = defaultdict(int)
    domain_counts = defaultdict(int)
    system_counts = defaultdict(int)
    for e in all_entries:
        type_counts[e["condition_type"]] += 1
        domain_counts[e["condition_domain"]] += 1
        system_counts[e["system"]] += 1

    print(f"\nTotal entries: {len(all_entries)}")
    print(f"\nBy type:")
    for t, c in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"  {t:30s} {c}")
    print(f"\nBy domain:")
    for d, c in sorted(domain_counts.items(), key=lambda x: -x[1]):
        print(f"  {d:30s} {c}")
    print(f"\nBy system:")
    for s, c in sorted(system_counts.items(), key=lambda x: -x[1]):
        print(f"  {s:30s} {c}")

    if args.dry_run:
        print("\n[DRY RUN] No entries written")
        # Print a few sample entries
        for e in all_entries[:5]:
            print(f"\n  {e['condition_type']:20s} | {e['system']:15s} | {e['component']:20s}")
            if e.get('symptom'):
                print(f"    symptom: {e['symptom'][:80]}")
            if e.get('spec_name'):
                print(f"    spec: {e['spec_name'][:40]} = {e.get('spec_value', '?')}")
    else:
        written = write_entries(conn, all_entries)
        print(f"\nWritten {written} entries to condition_knowledge")

    conn.close()


if __name__ == "__main__":
    main()
