#!/usr/bin/env python3
"""
Condition Spectrometer — Spectral Observation + Rhizomatic Growth

Core module for the vehicle condition scoring system:
  - Pass 0: 5W Context (free metadata before any vision)
  - Pass 1: Observation Writer (bridges YONO output → image_condition_observations)
  - Pass 2: Contextual Vision (Y/M/M knowledge-informed signals)
  - Pass 3: Sequence Cross-Reference (photo sequence analysis)
  - Score Aggregator: 0-100 from observation stack, 5-domain rubric
  - Distribution Computer: per-Y/M/M stats, rarity = 1 - CDF(score, ymm_distribution)
  - Taxonomy Growth: auto-discovers and creates new descriptors (Phase 5)

The spectrometer doesn't detect damage — it describes condition.
Damage is an adjective on a spectrum, not a binary flag.

Usage:
  cd /Users/skylar/nuke

  # Full multipass pipeline (bridge → contextual → sequence → score → distribute)
  python3 -m yono.condition_spectrometer pipeline --vehicle-id UUID

  # Individual passes
  python3 -m yono.condition_spectrometer context --image-id UUID --vehicle-id UUID
  python3 -m yono.condition_spectrometer bridge --vehicle-id UUID
  python3 -m yono.condition_spectrometer contextual --vehicle-id UUID
  python3 -m yono.condition_spectrometer sequence --vehicle-id UUID
  python3 -m yono.condition_spectrometer score --vehicle-id UUID

  # Batch score all vehicles with observations
  python3 -m yono.condition_spectrometer score-all --limit 500

  # Distributions
  python3 -m yono.condition_spectrometer distribute --ymm "1969_Chevrolet_Camaro"
  python3 -m yono.condition_spectrometer distribute --all

  # Taxonomy growth (auto-create new descriptors)
  python3 -m yono.condition_spectrometer grow --dry-run
  python3 -m yono.condition_spectrometer grow
"""

import os
import json
import math
import time
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")

# ─── Condition Tiers (0-100 score → tier label) ─────────────────────

CONDITION_TIERS = [
    (90, "concours"),    # 90-100: Show-quality, investment grade
    (80, "excellent"),   # 80-89: Well-preserved or professionally restored
    (65, "good"),        # 65-79: Solid driver with documented history
    (45, "driver"),      # 45-64: Regular use, functional but shows age
    (25, "project"),     # 25-44: Needs significant work
    (0,  "parts"),       # 0-24:  Severe deterioration
]

# Rubric weights (must sum to 100)
RUBRIC_WEIGHTS = {
    "exterior": 30,
    "interior": 20,
    "mechanical": 20,
    "provenance": 15,
    "structural": 15,  # presentation in plan → structural in taxonomy
}

# Lifecycle states ordered from best to worst
LIFECYCLE_ORDER = ["fresh", "worn", "weathered", "restored", "palimpsest", "ghost", "archaeological"]


# ─── DB Connection ──────────────────────────────────────────────────

def get_connection():
    """Get database connection."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if not db_pass:
            for line in (NUKE_DIR / ".env").read_text().splitlines():
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
            db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if db_pass:
            db_url = (
                f"postgresql://postgres.qkgaybvrernstplzjaam:{db_pass}"
                f"@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
                f"?sslmode=require"
            )
        else:
            raise RuntimeError("SUPABASE_DB_PASSWORD not set")
    elif "sslmode" not in db_url:
        db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"
    # Quick DNS probe with 2s timeout — fall back to IP if down
    import socket
    _orig_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(2)
    dns_ok = False
    try:
        socket.getaddrinfo("aws-0-us-west-1.pooler.supabase.com", 6543)
        dns_ok = True
    except (socket.gaierror, socket.timeout, OSError):
        pass
    finally:
        socket.setdefaulttimeout(_orig_timeout)

    if dns_ok:
        return psycopg2.connect(db_url, connect_timeout=15)

    # DNS down — use resolved pooler IP directly
    db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
    if not db_pass:
        raise RuntimeError("DNS down and no SUPABASE_DB_PASSWORD")
    return psycopg2.connect(
        host="52.8.172.168", port=6543,
        user="postgres.qkgaybvrernstplzjaam",
        password=db_pass, dbname="postgres",
        sslmode="require", connect_timeout=15,
    )


# ─── Pass 0: 5W Context (free metadata) ────────────────────────────

def get_5w_context(conn, image_id: str, vehicle_id: str) -> dict:
    """
    Free context that costs zero inference.
    Establishes who/what/where/when/which before any vision runs.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '15s'")

    # What + Who: vehicle identity and owner
    cur.execute("""
        SELECT
            v.year, v.make, v.model, v.vin,
            v.color, v.mileage, v.transmission, v.engine_type, v.drivetrain,
            v.condition_rating,
            v.sale_price, v.auction_source,
            CONCAT(v.year, '_', v.make, '_', v.model) as ymm_key,
            o.business_name as owner_name, o.business_type as owner_type
        FROM vehicles v
        LEFT JOIN organization_vehicles ov ON ov.vehicle_id = v.id
        LEFT JOIN organizations o ON o.id = ov.organization_id
        WHERE v.id = %s
    """, (vehicle_id,))
    vehicle = cur.fetchone()

    # When + Where: image timestamp, source
    cur.execute("""
        SELECT
            vi.created_at as image_timestamp,
            vi.source as image_source,
            vi.image_url,
            vi.vehicle_zone as existing_zone,
            vi.condition_score as existing_condition
        FROM vehicle_images vi
        WHERE vi.id = %s
    """, (image_id,))
    image = cur.fetchone()

    # Which: sequence position (photo N of M for this vehicle)
    cur.execute("""
        SELECT
            COUNT(*) as total_photos,
            (SELECT COUNT(*) FROM vehicle_images
             WHERE vehicle_id = %s AND created_at <= (
                 SELECT created_at FROM vehicle_images WHERE id = %s
             )) as position
        FROM vehicle_images
        WHERE vehicle_id = %s
    """, (vehicle_id, image_id, vehicle_id))
    seq = cur.fetchone()

    # Sequence neighbors (prev/next 3 photos)
    cur.execute("""
        (SELECT id, vehicle_zone, condition_score, image_url, 'before' as rel
         FROM vehicle_images
         WHERE vehicle_id = %s AND created_at < (SELECT created_at FROM vehicle_images WHERE id = %s)
         ORDER BY created_at DESC LIMIT 3)
        UNION ALL
        (SELECT id, vehicle_zone, condition_score, image_url, 'after' as rel
         FROM vehicle_images
         WHERE vehicle_id = %s AND created_at > (SELECT created_at FROM vehicle_images WHERE id = %s)
         ORDER BY created_at ASC LIMIT 3)
    """, (vehicle_id, image_id, vehicle_id, image_id))
    neighbors = cur.fetchall()
    cur.close()

    return {
        "who": {
            "owner_name": vehicle["owner_name"] if vehicle else None,
            "owner_type": vehicle["owner_type"] if vehicle else None,
        },
        "what": {
            "ymm_key": vehicle["ymm_key"] if vehicle else None,
            "year": vehicle["year"] if vehicle else None,
            "make": vehicle["make"] if vehicle else None,
            "model": vehicle["model"] if vehicle else None,
            "vin": vehicle["vin"] if vehicle else None,
            "color": vehicle["color"] if vehicle else None,
            "mileage": vehicle["mileage"] if vehicle else None,
            "engine_type": vehicle["engine_type"] if vehicle else None,
            "sale_price": vehicle["sale_price"] if vehicle else None,
        },
        "where": {
            "source": image["image_source"] if image else None,
            "platform": vehicle["auction_source"] if vehicle else None,
        },
        "when": {
            "timestamp": image["image_timestamp"].isoformat() if image and image["image_timestamp"] else None,
        },
        "which": {
            "position": seq["position"] if seq else None,
            "total": seq["total_photos"] if seq else None,
            "existing_zone": image["existing_zone"] if image else None,
            "existing_condition": image["existing_condition"] if image else None,
        },
        "sequence_neighbors": [
            {
                "id": str(n["id"]),
                "zone": n["vehicle_zone"],
                "condition": n["condition_score"],
                "rel": n["rel"],
            }
            for n in (neighbors or [])
        ],
    }


# ─── Spatial Surface Bridge ────────────────────────────────────────

_template_cache = {}  # {(make, model, year): {zone_bounds, length, width, height}}

def _load_template(conn, make: str, model: str, year: int) -> Optional[dict]:
    """Load vehicle_surface_templates for a Y/M/M. Returns zone_bounds + dimensions.

    Uses fuzzy model matching: first tries exact match, then prefix match
    (e.g. template "K10" matches vehicle "K10 SWB", "K10 Scottsdale", etc.)
    """
    cache_key = (make, model, year)
    if cache_key in _template_cache:
        return _template_cache[cache_key]

    cur = conn.cursor(cursor_factory=RealDictCursor)
    # Try exact match first
    cur.execute("""
        SELECT zone_bounds, length_inches, width_inches, height_inches
        FROM vehicle_surface_templates
        WHERE make = %s AND model = %s AND year_start <= %s AND year_end >= %s
        LIMIT 1
    """, (make, model, year, year))
    row = cur.fetchone()

    # Fuzzy: vehicle model starts with template model (K10 SWB → K10)
    if not row and model:
        cur.execute("""
            SELECT zone_bounds, length_inches, width_inches, height_inches
            FROM vehicle_surface_templates
            WHERE make = %s AND %s ILIKE model || '%%' AND year_start <= %s AND year_end >= %s
            ORDER BY length(model) DESC
            LIMIT 1
        """, (make, model, year, year))
        row = cur.fetchone()
    cur.close()

    if row:
        bounds = row["zone_bounds"]
        if isinstance(bounds, str):
            bounds = json.loads(bounds)
        result = {
            "zone_bounds": bounds,
            "length_inches": row["length_inches"],
            "width_inches": row["width_inches"],
            "height_inches": row["height_inches"],
        }
    else:
        result = None

    _template_cache[cache_key] = result
    return result


def _resolve_zone_coords(template: dict, zone: str) -> dict:
    """Resolve a zone code to physical inch coordinates via template bounds."""
    if not template or not zone:
        return {}
    bounds = template.get("zone_bounds", {}).get(zone)
    if not bounds:
        return {}
    return {
        "u_min_inches": bounds.get("u_min"),
        "u_max_inches": bounds.get("u_max"),
        "v_min_inches": bounds.get("v_min"),
        "v_max_inches": bounds.get("v_max"),
        "h_min_inches": bounds.get("h_min"),
        "h_max_inches": bounds.get("h_max"),
    }


def write_surface_observation(conn, image_id: str, vehicle_id: str,
                              zone: str, observation_type: str, label: str,
                              confidence: float = None, severity: float = None,
                              lifecycle_state: str = None, descriptor_id: str = None,
                              region_detail: str = None, pass_number: int = None,
                              model_version: str = None, pass_name: str = None,
                              evidence: dict = None, resolution_level: int = 0,
                              bbox: tuple = None,
                              make: str = None, model: str = None, year: int = None) -> bool:
    """
    Write a single surface_observation with auto-resolved physical coordinates.

    This is the spatial counterpart to image_condition_observations.
    Every condition observation has a WHERE on the vehicle surface.
    The spectrometer says WHAT. The surface map says WHERE.

    If make/model/year provided, resolves zone → physical inch coordinates
    via vehicle_surface_templates.

    bbox: (x, y, w, h) normalized 0-1 image coordinates, or None for whole-image.
    """
    cur = conn.cursor()

    # Resolve physical coordinates from template
    coords = {}
    if make and model and year:
        template = _load_template(conn, make, model, year)
        coords = _resolve_zone_coords(template, zone)

    # Default bbox to full image if not specified
    bbox_x, bbox_y, bbox_w, bbox_h = bbox if bbox else (0.0, 0.0, 1.0, 1.0)

    try:
        cur.execute("""
            INSERT INTO surface_observations
                (vehicle_image_id, vehicle_id, zone, observation_type, label,
                 confidence, severity, lifecycle_state, descriptor_id,
                 region_detail, pass_number, model_version, pass_name,
                 evidence, resolution_level,
                 bbox_x, bbox_y, bbox_w, bbox_h,
                 u_min_inches, u_max_inches, v_min_inches, v_max_inches,
                 h_min_inches, h_max_inches)
            VALUES (%s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s)
        """, (
            image_id, vehicle_id, zone, observation_type, label,
            confidence, severity, lifecycle_state,
            descriptor_id,
            region_detail, pass_number, model_version, pass_name,
            json.dumps(evidence) if evidence else None, resolution_level,
            bbox_x, bbox_y, bbox_w, bbox_h,
            coords.get("u_min_inches"), coords.get("u_max_inches"),
            coords.get("v_min_inches"), coords.get("v_max_inches"),
            coords.get("h_min_inches"), coords.get("h_max_inches"),
        ))
        return True
    except Exception as e:
        print(f"[SPECTROMETER] Surface obs write error: {e}")
        return False
    finally:
        cur.close()


# ─── Observation Writer Bridge ──────────────────────────────────────

def _load_alias_map(conn) -> dict:
    """Load condition_aliases → descriptor_id mapping with case-insensitive support."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT ca.alias_key, ca.descriptor_id
        FROM condition_aliases ca
    """)
    aliases = {}
    for r in cur.fetchall():
        did = str(r["descriptor_id"])
        key = r["alias_key"]
        aliases[key] = did
        # Also index the lowercase version for case-insensitive matching
        aliases[key.lower()] = did
    cur.close()
    return aliases


def _resolve_flag(flag: str, alias_map: dict) -> str:
    """Resolve a YONO flag to a descriptor_id with fallback matching.

    Try: exact → lowercase → underscore-to-space → prefix match.
    """
    # Exact match
    if flag in alias_map:
        return alias_map[flag]
    # Lowercase match
    if flag.lower() in alias_map:
        return alias_map[flag.lower()]
    # Underscore to space
    spaced = flag.replace("_", " ")
    if spaced in alias_map:
        return alias_map[spaced]
    if spaced.lower() in alias_map:
        return alias_map[spaced.lower()]
    # Prefix match (e.g., "rust_heavy" → "rust")
    for alias_key, did in alias_map.items():
        if flag.lower().startswith(alias_key.lower()) and len(alias_key) >= 3:
            return did
    return None


def _zone_to_domain(zone: str) -> str:
    """Infer condition domain from zone prefix."""
    if not zone:
        return "exterior"
    z = zone.lower()
    if z.startswith("int_"):
        return "interior"
    elif z.startswith("mech_"):
        return "mechanical"
    elif z.startswith("ext_") or z.startswith("panel_") or z.startswith("wheel_"):
        return "exterior"
    elif z == "detail_odometer":
        return "interior"
    elif z.startswith("detail_"):
        return "exterior"
    elif z.startswith("structural_"):
        return "structural"
    return "exterior"


def _severity_from_score(condition_score: int) -> float:
    """Infer severity from per-image condition_score (1-5).

    Score 1 = worst condition → severity 0.9 (high damage)
    Score 5 = best condition  → severity 0.1 (trace damage)
    """
    if condition_score is None:
        return 0.5
    severity_map = {1: 0.9, 2: 0.7, 3: 0.5, 4: 0.3, 5: 0.1}
    return severity_map.get(condition_score, 0.5)


def bridge_yono_output(conn, image_id: str, vehicle_id: str,
                       yono_result: dict, source: str = "yono_v1",
                       source_version: str = None) -> int:
    """
    Bridge existing YONO classifier output → image_condition_observations.

    Takes YONO output (zone, condition_score, damage_flags, modification_flags)
    and writes structured observations using the condition taxonomy.

    Improvements (v2):
    - Case-insensitive flag matching with fallback chain
    - Severity inference from condition_score (not always NULL)
    - Zone-aware domain assignment (int_* → interior, mech_* → mechanical)
    - Baseline observations per domain present in zones (not just exterior)

    Returns count of observations written.
    """
    alias_map = _load_alias_map(conn)
    cur = conn.cursor()
    written = 0

    zone = yono_result.get("vehicle_zone")
    condition_score = yono_result.get("condition_score")
    if condition_score is not None:
        condition_score = int(condition_score)  # Handle Decimal from DB
    damage_flags = yono_result.get("damage_flags") or []
    modification_flags = yono_result.get("modification_flags") or []

    # Map condition_score (1-5) to lifecycle state
    lifecycle = None
    if condition_score is not None:
        if condition_score >= 5:
            lifecycle = "fresh"
        elif condition_score >= 4:
            lifecycle = "worn"
        elif condition_score >= 3:
            lifecycle = "weathered"
        elif condition_score >= 2:
            lifecycle = "ghost"
        else:
            lifecycle = "archaeological"

    # Infer severity from condition_score (v2: no longer always NULL)
    severity = _severity_from_score(condition_score) if damage_flags else None

    # Infer domain from zone (v2: zone-aware domain assignment)
    zone_domain = _zone_to_domain(zone)

    # Write damage flag observations
    for flag in damage_flags:
        descriptor_id = _resolve_flag(flag, alias_map)
        if not descriptor_id:
            continue
        cur.execute("""
            INSERT INTO image_condition_observations
                (image_id, vehicle_id, descriptor_id, severity, lifecycle_state,
                 zone, pass_number, confidence, source, source_version, evidence)
            VALUES (%s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s)
        """, (
            image_id, vehicle_id, descriptor_id,
            severity,  # v2: inferred from condition_score
            lifecycle, zone,
            yono_result.get("confidence"),
            source, source_version,
            json.dumps({"raw_flag": flag, "yono_output": {
                "zone": zone, "condition_score": condition_score,
            }}),
        ))
        written += 1

    # Write modification flag observations
    for flag in modification_flags:
        descriptor_id = _resolve_flag(flag, alias_map)
        if not descriptor_id:
            continue
        cur.execute("""
            INSERT INTO image_condition_observations
                (image_id, vehicle_id, descriptor_id, severity, lifecycle_state,
                 zone, pass_number, confidence, source, source_version, evidence)
            VALUES (%s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s)
        """, (
            image_id, vehicle_id, descriptor_id,
            None, lifecycle, zone,
            yono_result.get("confidence"),
            source, source_version,
            json.dumps({"raw_flag": flag, "yono_output": {
                "zone": zone, "condition_score": condition_score,
            }}),
        ))
        written += 1

    # v2: Write baseline observations per domain derived from zone
    # Instead of only writing ONE exterior baseline, write a domain-appropriate baseline
    if condition_score is not None and lifecycle:
        baseline_domain = zone_domain if zone else "exterior"
        baseline_key = f"{baseline_domain}.assessed.baseline"

        # Look up or create the domain-specific baseline descriptor
        cur2 = conn.cursor(cursor_factory=RealDictCursor)
        cur2.execute("""
            SELECT descriptor_id FROM condition_taxonomy
            WHERE canonical_key = %s
        """, (baseline_key,))
        row = cur2.fetchone()
        if not row:
            cur2.execute("""
                INSERT INTO condition_taxonomy
                    (canonical_key, domain, descriptor_type, display_label, taxonomy_version)
                VALUES (%s, %s, 'state', %s, 'v2_2026_03')
                ON CONFLICT (canonical_key) DO NOTHING
                RETURNING descriptor_id
            """, (baseline_key, baseline_domain,
                  f"{baseline_domain.title()} Assessed Baseline"))
            row = cur2.fetchone()
            if not row:
                # ON CONFLICT hit — re-fetch
                cur2.execute("""
                    SELECT descriptor_id FROM condition_taxonomy
                    WHERE canonical_key = %s
                """, (baseline_key,))
                row = cur2.fetchone()
        baseline_descriptor_id = str(row["descriptor_id"]) if row else None
        cur2.close()

        if baseline_descriptor_id:
            # Map condition_score 1-5 to severity 0-1 (5=1.0 best, 1=0.0 worst)
            baseline_severity = (condition_score - 1) / 4.0 if condition_score else 0.5

            cur.execute("""
                INSERT INTO image_condition_observations
                    (image_id, vehicle_id, descriptor_id, severity, lifecycle_state,
                     zone, pass_number, confidence, source, source_version, evidence)
                VALUES (%s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s)
            """, (
                image_id, vehicle_id, baseline_descriptor_id,
                baseline_severity, lifecycle, zone,
                yono_result.get("confidence", 0.5),
                source, source_version,
                json.dumps({"baseline": True, "condition_score": condition_score,
                            "zone": zone, "lifecycle": lifecycle,
                            "domain": baseline_domain}),
            ))
            written += 1

    # ── Spatial surface bridge ──────────────────────────────────
    # Every condition observation also becomes a spatially-anchored
    # surface_observation. The spectrometer says WHAT, the surface
    # map says WHERE. Together they form the observation assemblage.
    #
    # Resolve Y/M/M for template-aware coordinate mapping.
    ymm_cur = conn.cursor(cursor_factory=RealDictCursor)
    ymm_cur.execute(
        "SELECT year, make, model FROM vehicles WHERE id = %s", (vehicle_id,)
    )
    ymm = ymm_cur.fetchone()
    ymm_cur.close()

    v_make = ymm["make"] if ymm else None
    v_model = ymm["model"] if ymm else None
    v_year = int(ymm["year"]) if ymm and ymm["year"] else None

    if zone:
        # Zone classify observation (always)
        write_surface_observation(
            conn, image_id, vehicle_id,
            zone=zone, observation_type="zone_classify", label=zone,
            confidence=yono_result.get("confidence"),
            lifecycle_state=lifecycle, pass_number=1,
            model_version=source_version or source, pass_name="zone_classify",
            make=v_make, model=v_model, year=v_year,
        )
        # Damage observations (spatially located)
        for flag in damage_flags:
            d_id = _resolve_flag(flag, alias_map)
            write_surface_observation(
                conn, image_id, vehicle_id,
                zone=zone, observation_type="condition", label=flag,
                confidence=yono_result.get("confidence"),
                severity=severity,  # v2: inferred from condition_score
                lifecycle_state=lifecycle, descriptor_id=d_id,
                pass_number=1, model_version=source_version or source,
                pass_name="damage_scan",
                evidence={"raw_flag": flag},
                make=v_make, model=v_model, year=v_year,
            )
        # Modification observations (spatially located)
        for flag in modification_flags:
            d_id = _resolve_flag(flag, alias_map)
            write_surface_observation(
                conn, image_id, vehicle_id,
                zone=zone, observation_type="modification", label=flag,
                confidence=yono_result.get("confidence"),
                lifecycle_state=lifecycle, descriptor_id=d_id,
                pass_number=1, model_version=source_version or source,
                pass_name="mod_scan",
                evidence={"raw_flag": flag},
                make=v_make, model=v_model, year=v_year,
            )

    conn.commit()
    cur.close()
    return written


def bridge_vehicle_images(conn, vehicle_id: str = None, limit: int = 1000,
                          rebridge: bool = False) -> dict:
    """
    Bridge existing vehicle_images flags → image_condition_observations for
    all images of a vehicle (or a batch of unprocessed images).

    If rebridge=True, deletes existing yono_v1 observations first and processes
    all images regardless of whether they've been bridged before.

    Returns {processed, observations_written, skipped, deleted}.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '120s'")

    deleted = 0
    if rebridge:
        # Delete existing yono_v1 observations for this vehicle (or all)
        if vehicle_id:
            cur.execute("""
                DELETE FROM image_condition_observations
                WHERE source = 'yono_v1' AND vehicle_id = %s
            """, (vehicle_id,))
        else:
            # Batch delete for all vehicles
            while True:
                cur.execute("""
                    DELETE FROM image_condition_observations
                    WHERE id IN (
                        SELECT id FROM image_condition_observations
                        WHERE source = 'yono_v1'
                        LIMIT 1000
                    )
                """)
                batch = cur.rowcount
                deleted += batch
                conn.commit()
                if batch < 1000:
                    break
                if deleted % 5000 == 0:
                    print(f"  Deleted {deleted} old observations...")
        deleted += cur.rowcount
        conn.commit()
        if deleted:
            print(f"  Deleted {deleted} existing yono_v1 observations")

    if vehicle_id:
        cur.execute("""
            SELECT vi.id as image_id, vi.vehicle_id,
                   vi.vehicle_zone, vi.condition_score,
                   vi.damage_flags, vi.modification_flags
            FROM vehicle_images vi
            WHERE vi.vehicle_id = %s
              AND (vi.condition_score IS NOT NULL
                   OR vi.damage_flags IS NOT NULL
                   OR vi.modification_flags IS NOT NULL)
            """ + ("" if rebridge else """
              AND NOT EXISTS (
                  SELECT 1 FROM image_condition_observations ico
                  WHERE ico.image_id = vi.id AND ico.source = 'yono_v1'
              )""") + """
            LIMIT %s
        """, (vehicle_id, limit))
    else:
        cur.execute("""
            SELECT vi.id as image_id, vi.vehicle_id,
                   vi.vehicle_zone, vi.condition_score,
                   vi.damage_flags, vi.modification_flags
            FROM vehicle_images vi
            WHERE (vi.condition_score IS NOT NULL
                   OR vi.damage_flags IS NOT NULL
                   OR vi.modification_flags IS NOT NULL)
            """ + ("" if rebridge else """
              AND NOT EXISTS (
                  SELECT 1 FROM image_condition_observations ico
                  WHERE ico.image_id = vi.id AND ico.source = 'yono_v1'
              )""") + """
            LIMIT %s
        """, (limit,))

    rows = cur.fetchall()
    cur.close()

    processed = 0
    total_obs = 0
    skipped = 0

    for row in rows:
        yono_result = {
            "vehicle_zone": row["vehicle_zone"],
            "condition_score": row["condition_score"],
            "damage_flags": row["damage_flags"],
            "modification_flags": row["modification_flags"],
        }
        obs = bridge_yono_output(
            conn,
            image_id=str(row["image_id"]),
            vehicle_id=str(row["vehicle_id"]),
            yono_result=yono_result,
            source="yono_v1",
        )
        if obs > 0:
            processed += 1
            total_obs += obs
        else:
            skipped += 1

        if processed % 500 == 0 and processed > 0:
            print(f"  Bridged {processed} images, {total_obs} observations...")

    return {"processed": processed, "observations_written": total_obs,
            "skipped": skipped, "deleted": deleted}


# ─── Condition Score Aggregator (0-100) ─────────────────────────────

def tier_from_score(score: float) -> str:
    """Map 0-100 score to condition tier."""
    for threshold, tier in CONDITION_TIERS:
        if score >= threshold:
            return tier
    return "parts"


def _normal_cdf(x, mean, std) -> float:
    x, mean, std = float(x), float(mean), float(std)
    """Approximate normal CDF using error function."""
    if std <= 0:
        return 1.0 if x >= mean else 0.0
    return 0.5 * (1 + math.erf((x - mean) / (std * math.sqrt(2))))


def compute_condition_score(conn, vehicle_id: str) -> Optional[dict]:
    """
    Aggregate all image_condition_observations for a vehicle into a 0-100 score.

    The 100-point rubric:
      Exterior:    30 pts  (from exterior domain observations)
      Interior:    20 pts  (from interior domain observations)
      Mechanical:  20 pts  (from mechanical domain observations)
      Provenance:  15 pts  (from provenance domain observations)
      Structural:  15 pts  (from structural domain observations)

    Scoring logic:
      - Start at max points per category
      - Each negative observation (adjective type with severity) reduces score
      - Positive state observations (original, matching_numbers) add bonus
      - No observations for a domain = neutral (50% of max)
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    # Get all observations for this vehicle
    cur.execute("""
        SELECT
            ico.descriptor_id, ico.severity, ico.lifecycle_state,
            ico.zone, ico.confidence, ico.pass_number,
            ct.canonical_key, ct.domain, ct.descriptor_type, ct.severity_scale
        FROM image_condition_observations ico
        JOIN condition_taxonomy ct ON ct.descriptor_id = ico.descriptor_id
        WHERE ico.vehicle_id = %s
        ORDER BY ico.observed_at DESC
    """, (vehicle_id,))

    observations = cur.fetchall()

    if not observations:
        cur.close()
        return None

    # Get Y/M/M key for this vehicle
    cur.execute("""
        SELECT year, make, model,
               CONCAT(year, '_', make, '_', model) as ymm_key
        FROM vehicles WHERE id = %s
    """, (vehicle_id,))
    vehicle = cur.fetchone()
    cur.close()

    if not vehicle:
        return None

    ymm_key = vehicle["ymm_key"]

    # Group observations by domain
    by_domain = defaultdict(list)
    for obs in observations:
        by_domain[obs["domain"]].append(obs)

    # Track unique zones covered
    zones_seen = set()
    lifecycle_counts = Counter()
    descriptor_summary = defaultdict(lambda: {"count": 0, "total_severity": 0.0, "zones": set()})

    for obs in observations:
        if obs["zone"]:
            zones_seen.add(obs["zone"])
        if obs["lifecycle_state"]:
            lifecycle_counts[obs["lifecycle_state"]] += 1

        key = obs["canonical_key"]
        descriptor_summary[key]["count"] += 1
        if obs["severity"] is not None:
            descriptor_summary[key]["total_severity"] += float(obs["severity"])
        if obs["zone"]:
            descriptor_summary[key]["zones"].add(obs["zone"])

    # Score each domain
    domain_scores = {}
    for domain, max_points in RUBRIC_WEIGHTS.items():
        domain_obs = by_domain.get(domain, [])
        if not domain_obs:
            # No data for this domain → give 50% (neutral)
            domain_scores[domain] = max_points * 0.5
            continue

        # Start at max points, subtract for negative observations
        score = float(max_points)
        positive_bonus = 0.0

        for obs in domain_obs:
            desc_type = obs["descriptor_type"]
            severity = float(obs["severity"]) if obs["severity"] is not None else 0.5

            if desc_type == "adjective":
                # Adjectives reduce score proportional to severity
                # Each adjective observation can reduce up to (max_points / 10)
                penalty = severity * (max_points / 10.0)
                score -= penalty

            elif desc_type == "state":
                # States: positive states add bonus, negative states penalize
                key = obs["canonical_key"]
                if any(pos in key for pos in ["original", "matching", "continuous", "build_sheet",
                                                "window_sticker", "service_records"]):
                    positive_bonus += max_points * 0.05  # 5% bonus per positive state
                elif any(neg in key for neg in ["non_original", "aftermarket", "replaced",
                                                  "absent", "modified"]):
                    score -= max_points * 0.03  # 3% penalty per non-original state

            elif desc_type == "mechanism":
                # Mechanisms are explanatory — lighter penalty
                score -= severity * (max_points / 15.0)

        # Apply positive bonus (capped at 10% of max)
        score += min(positive_bonus, max_points * 0.10)
        domain_scores[domain] = max(0.0, min(float(max_points), score))

    # Total score
    raw_score = sum(domain_scores.values())
    raw_score = max(0.0, min(100.0, raw_score))

    # Dominant lifecycle state
    lifecycle = lifecycle_counts.most_common(1)[0][0] if lifecycle_counts else None

    # Zone coverage (out of 41 possible zones)
    zone_coverage = len(zones_seen) / 41.0

    # Build descriptor summary for storage
    desc_summary_json = {}
    for key, info in descriptor_summary.items():
        avg_sev = info["total_severity"] / info["count"] if info["count"] > 0 else None
        desc_summary_json[key] = {
            "count": info["count"],
            "avg_severity": round(avg_sev, 3) if avg_sev is not None else None,
            "zones": sorted(info["zones"]),
        }

    return {
        "vehicle_id": vehicle_id,
        "condition_score": round(raw_score, 1),
        "condition_tier": tier_from_score(raw_score),
        "ymm_key": ymm_key,
        "exterior_score": round(domain_scores.get("exterior", 0), 1),
        "interior_score": round(domain_scores.get("interior", 0), 1),
        "mechanical_score": round(domain_scores.get("mechanical", 0), 1),
        "provenance_score": round(domain_scores.get("provenance", 0), 1),
        "structural_score": round(domain_scores.get("structural", 0), 1),
        "lifecycle_state": lifecycle,
        "descriptor_summary": desc_summary_json,
        "observation_count": len(observations),
        "zone_coverage": round(zone_coverage, 3),
    }


def save_condition_score(conn, score_data: dict) -> None:
    """Upsert a computed condition score into vehicle_condition_scores."""
    cur = conn.cursor()

    # Get distribution context if available
    ymm_key = score_data["ymm_key"]
    dist = get_ymm_distribution(conn, ymm_key)

    percentile_ymm = None
    percentile_global = None
    rarity = None
    ymm_mean = None
    ymm_std = None
    ymm_size = None

    if dist:
        ymm_mean = dist["mean_score"]
        ymm_std = dist["std_dev"]
        ymm_size = dist["group_size"]
        if ymm_std and ymm_std > 0:
            cdf = _normal_cdf(score_data["condition_score"], ymm_mean, ymm_std)
            percentile_ymm = round(cdf * 100, 1)
            rarity = round(1.0 - cdf, 4)

    global_dist = get_global_distribution(conn)
    if global_dist and global_dist["std_dev"] and global_dist["std_dev"] > 0:
        cdf = _normal_cdf(score_data["condition_score"], global_dist["mean_score"], global_dist["std_dev"])
        percentile_global = round(cdf * 100, 1)

    cur.execute("""
        INSERT INTO vehicle_condition_scores (
            vehicle_id, condition_score, condition_tier,
            percentile_within_ymm, percentile_global,
            ymm_key, ymm_group_size, ymm_mean_score, ymm_std_dev,
            exterior_score, interior_score, mechanical_score,
            provenance_score, presentation_score,
            lifecycle_state, descriptor_summary, condition_rarity,
            observation_count, zone_coverage
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (vehicle_id) DO UPDATE SET
            condition_score = EXCLUDED.condition_score,
            condition_tier = EXCLUDED.condition_tier,
            percentile_within_ymm = EXCLUDED.percentile_within_ymm,
            percentile_global = EXCLUDED.percentile_global,
            ymm_key = EXCLUDED.ymm_key,
            ymm_group_size = EXCLUDED.ymm_group_size,
            ymm_mean_score = EXCLUDED.ymm_mean_score,
            ymm_std_dev = EXCLUDED.ymm_std_dev,
            exterior_score = EXCLUDED.exterior_score,
            interior_score = EXCLUDED.interior_score,
            mechanical_score = EXCLUDED.mechanical_score,
            provenance_score = EXCLUDED.provenance_score,
            presentation_score = EXCLUDED.presentation_score,
            lifecycle_state = EXCLUDED.lifecycle_state,
            descriptor_summary = EXCLUDED.descriptor_summary,
            condition_rarity = EXCLUDED.condition_rarity,
            observation_count = EXCLUDED.observation_count,
            zone_coverage = EXCLUDED.zone_coverage,
            computed_at = NOW()
    """, (
        score_data["vehicle_id"],
        score_data["condition_score"],
        score_data["condition_tier"],
        percentile_ymm,
        percentile_global,
        score_data["ymm_key"],
        ymm_size,
        ymm_mean,
        ymm_std,
        score_data["exterior_score"],
        score_data["interior_score"],
        score_data["mechanical_score"],
        score_data["provenance_score"],
        score_data["structural_score"],  # stored as presentation_score column
        score_data["lifecycle_state"],
        json.dumps(score_data["descriptor_summary"]),
        rarity,
        score_data["observation_count"],
        score_data["zone_coverage"],
    ))
    conn.commit()
    cur.close()


# ─── Distribution Computer ──────────────────────────────────────────

def _to_float_dict(row) -> dict:
    """Convert a RealDictRow to a regular dict with Decimals cast to float."""
    from decimal import Decimal
    result = {}
    for k, v in dict(row).items():
        result[k] = float(v) if isinstance(v, Decimal) else v
    return result


def get_ymm_distribution(conn, ymm_key: str) -> Optional[dict]:
    """Get cached distribution for a Y/M/M group."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT * FROM condition_distributions
        WHERE ymm_key = %s AND group_type = 'ymm'
        ORDER BY computed_at DESC LIMIT 1
    """, (ymm_key,))
    row = cur.fetchone()
    cur.close()
    return _to_float_dict(row) if row else None


def get_global_distribution(conn) -> Optional[dict]:
    """Get cached global distribution."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT * FROM condition_distributions
        WHERE group_type = 'global'
        ORDER BY computed_at DESC LIMIT 1
    """)
    row = cur.fetchone()
    cur.close()
    return _to_float_dict(row) if row else None


def compute_distribution(conn, ymm_key: str = None, group_type: str = "ymm") -> Optional[dict]:
    """
    Compute condition distribution for a Y/M/M group or globally.
    Writes result to condition_distributions table.

    For Y/M/M: stats across all scored vehicles of that type.
    For global: stats across ALL scored vehicles.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")

    if group_type == "ymm" and ymm_key:
        cur.execute("""
            SELECT
                condition_score, condition_tier, lifecycle_state
            FROM vehicle_condition_scores
            WHERE ymm_key = %s
        """, (ymm_key,))
    elif group_type == "global":
        cur.execute("""
            SELECT
                condition_score, condition_tier, lifecycle_state
            FROM vehicle_condition_scores
        """)
    else:
        cur.close()
        return None

    rows = cur.fetchall()
    cur.close()

    if len(rows) < 3:
        return None

    scores = sorted([float(r["condition_score"]) for r in rows])
    n = len(scores)

    # Basic stats
    mean = sum(scores) / n
    median = scores[n // 2] if n % 2 == 1 else (scores[n // 2 - 1] + scores[n // 2]) / 2
    variance = sum((s - mean) ** 2 for s in scores) / n
    std = math.sqrt(variance) if variance > 0 else 0

    # Percentiles
    def percentile(pct):
        idx = pct / 100.0 * (n - 1)
        lo = int(idx)
        hi = min(lo + 1, n - 1)
        frac = idx - lo
        return scores[lo] + frac * (scores[hi] - scores[lo])

    # Skewness
    skewness = None
    if std > 0:
        skewness = sum(((s - mean) / std) ** 3 for s in scores) / n

    # Lifecycle distribution
    lifecycle_counts = Counter(r["lifecycle_state"] for r in rows if r["lifecycle_state"])
    lifecycle_total = sum(lifecycle_counts.values())
    lifecycle_dist = {k: round(v / lifecycle_total, 3) for k, v in lifecycle_counts.items()} if lifecycle_total > 0 else {}

    result = {
        "ymm_key": ymm_key,
        "group_type": group_type,
        "group_size": n,
        "mean_score": round(mean, 2),
        "median_score": round(median, 2),
        "std_dev": round(std, 2),
        "percentile_10": round(percentile(10), 2),
        "percentile_25": round(percentile(25), 2),
        "percentile_50": round(percentile(50), 2),
        "percentile_75": round(percentile(75), 2),
        "percentile_90": round(percentile(90), 2),
        "skewness": round(skewness, 3) if skewness is not None else None,
        "lifecycle_distribution": lifecycle_dist,
    }

    # Save to DB
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO condition_distributions (
            ymm_key, group_type, group_size,
            mean_score, median_score, std_dev,
            percentile_10, percentile_25, percentile_50, percentile_75, percentile_90,
            skewness, lifecycle_distribution
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        result["ymm_key"], result["group_type"], result["group_size"],
        result["mean_score"], result["median_score"], result["std_dev"],
        result["percentile_10"], result["percentile_25"], result["percentile_50"],
        result["percentile_75"], result["percentile_90"],
        result["skewness"],
        json.dumps(result["lifecycle_distribution"]),
    ))
    conn.commit()
    cur.close()

    return result


def recompute_all_distributions(conn) -> dict:
    """Recompute distributions for all Y/M/M groups with scored vehicles."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")

    cur.execute("""
        SELECT ymm_key, COUNT(*) as cnt
        FROM vehicle_condition_scores
        WHERE ymm_key IS NOT NULL
        GROUP BY ymm_key
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC
    """)
    groups = cur.fetchall()
    cur.close()

    computed = 0
    skipped = 0

    for g in groups:
        dist = compute_distribution(conn, ymm_key=g["ymm_key"], group_type="ymm")
        if dist:
            computed += 1
        else:
            skipped += 1

    # Global distribution
    global_dist = compute_distribution(conn, group_type="global")

    return {
        "ymm_groups_computed": computed,
        "ymm_groups_skipped": skipped,
        "global_computed": global_dist is not None,
    }


# ─── Pass 2: Contextual Vision (Y/M/M knowledge-informed) ───────────

def contextual_pass(conn, vehicle_id: str) -> dict:
    """
    Phase 3C: Contextual observation pass.

    Loads Y/M/M knowledge profile, then generates additional observations
    based on what's known about this specific vehicle type.

    For example:
      - If Y/M/M is 1972 K10 and zone is rocker_panel with lifecycle=weathered
        → check for cowl_seam_water_ingress (known K10 failure mode)
      - If lifecycle_distribution for this Y/M/M shows 80% fresh
        but this vehicle is "ghost" → condition_rarity signal is HIGH

    Writes observations with pass_number=2, source='contextual_v1'.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    # Get vehicle identity
    cur.execute("""
        SELECT year, make, model, CONCAT(year, '_', make, '_', model) as ymm_key
        FROM vehicles WHERE id = %s
    """, (vehicle_id,))
    vehicle = cur.fetchone()
    if not vehicle:
        cur.close()
        return {"error": "Vehicle not found"}

    ymm_key = vehicle["ymm_key"]

    # Load Y/M/M knowledge profile — 3-tier fallback:
    # 1. Exact match on CONCAT key
    # 2. Case-insensitive match (handles "chevrolet" vs "Chevrolet")
    # 3. Suffix-stripped base model (handles "Camaro Z28" → "Camaro")
    cur.execute("""
        SELECT profile FROM ymm_knowledge WHERE ymm_key = %s
    """, (ymm_key,))
    yk_row = cur.fetchone()

    if not yk_row:
        # Try case-insensitive match
        cur.execute("SELECT profile, ymm_key FROM ymm_knowledge WHERE LOWER(ymm_key) = LOWER(%s)", (ymm_key,))
        yk_row = cur.fetchone()
        if yk_row:
            ymm_key = yk_row["ymm_key"]

    if not yk_row:
        # Try base model (coalesced) with suffix stripping
        from yono.contextual_training.build_ymm_knowledge import strip_model_suffix
        base_model, _ = strip_model_suffix(vehicle["model"] or '')
        alt_key = f"{vehicle['year']}_{vehicle['make']}_{base_model}"
        cur.execute("SELECT profile FROM ymm_knowledge WHERE ymm_key = %s", (alt_key,))
        yk_row = cur.fetchone()
        if not yk_row:
            # Also try case-insensitive on the stripped key
            cur.execute("SELECT profile, ymm_key FROM ymm_knowledge WHERE LOWER(ymm_key) = LOWER(%s)", (alt_key,))
            yk_row = cur.fetchone()
        if yk_row:
            ymm_key = yk_row.get("ymm_key", alt_key)

    if not yk_row:
        cur.close()
        return {"ymm_key": ymm_key, "contextual_observations": 0, "reason": "no_ymm_profile"}

    profile = yk_row["profile"]
    if isinstance(profile, str):
        profile = json.loads(profile)

    # Get existing pass-1 observations for this vehicle
    cur.execute("""
        SELECT ico.zone, ico.lifecycle_state, ct.canonical_key, ct.domain
        FROM image_condition_observations ico
        JOIN condition_taxonomy ct ON ct.descriptor_id = ico.descriptor_id
        WHERE ico.vehicle_id = %s AND ico.pass_number = 1
    """, (vehicle_id,))
    pass1_obs = cur.fetchall()
    cur.close()

    if not pass1_obs:
        return {"ymm_key": ymm_key, "contextual_observations": 0, "reason": "no_pass1_observations"}

    # Analyze pass-1 observations in context of Y/M/M knowledge
    contextual_obs = []

    # Lifecycle distribution context
    lifecycle_dist = profile.get("lifecycle_distribution", {})
    condition_dist = profile.get("condition_distribution", {})

    # Count lifecycle states from pass-1
    lifecycle_counts = Counter(o["lifecycle_state"] for o in pass1_obs if o["lifecycle_state"])
    dominant_lifecycle = lifecycle_counts.most_common(1)[0][0] if lifecycle_counts else None

    # Rarity signal: if this vehicle's dominant lifecycle is unusual for its Y/M/M
    if dominant_lifecycle and lifecycle_dist:
        expected_freq = lifecycle_dist.get(dominant_lifecycle, 0)
        if expected_freq < 0.10:
            # This lifecycle state is seen in <10% of this Y/M/M — rare condition
            contextual_obs.append({
                "type": "rarity_signal",
                "detail": f"lifecycle '{dominant_lifecycle}' seen in only {expected_freq:.0%} of {ymm_key}",
                "rarity": round(1.0 - expected_freq, 3),
            })

    # Zone-specific knowledge checks
    zones_observed = set(o["zone"] for o in pass1_obs if o["zone"])
    descriptors_observed = set(o["canonical_key"] for o in pass1_obs)

    # If exterior.metal.oxidation is present and the Y/M/M typically scores high,
    # this is a stronger negative signal (unexpected rust)
    if "exterior.metal.oxidation" in descriptors_observed:
        ymm_mean = condition_dist.get("mean")
        if ymm_mean and ymm_mean >= 4.0:
            contextual_obs.append({
                "type": "unexpected_condition",
                "detail": f"oxidation detected but {ymm_key} mean condition is {ymm_mean:.1f}/5 — this vehicle is below typical",
            })

    # Coverage analysis: what zones are NOT observed?
    all_exterior_zones = {
        "ext_front", "ext_rear", "ext_driver_side", "ext_passenger_side",
        "ext_front_driver", "ext_front_passenger", "ext_rear_driver", "ext_rear_passenger",
    }
    missing_zones = all_exterior_zones - zones_observed
    if zones_observed and missing_zones and len(missing_zones) < len(all_exterior_zones):
        contextual_obs.append({
            "type": "coverage_gap",
            "detail": f"observed {len(zones_observed)} zones but missing: {', '.join(sorted(missing_zones))}",
            "coverage_ratio": round(len(zones_observed) / len(all_exterior_zones), 2),
        })

    # Write contextual observations as evidence JSONB (pass_number=2)
    # These don't map to specific taxonomy descriptors yet — they're contextual signals
    # that inform the score but aren't binary flags
    written = 0
    if contextual_obs:
        alias_map = _load_alias_map(conn)

        # For now, store as evidence on a general observation
        # Future: create specific taxonomy nodes for rarity/coverage signals
        cur = conn.cursor()
        for ctx_ob in contextual_obs:
            # Find an appropriate image_id from pass-1 (use first one)
            cur2 = conn.cursor(cursor_factory=RealDictCursor)
            cur2.execute("""
                SELECT image_id FROM image_condition_observations
                WHERE vehicle_id = %s AND pass_number = 1
                LIMIT 1
            """, (vehicle_id,))
            img_row = cur2.fetchone()
            cur2.close()

            if not img_row:
                continue

            # Store contextual signal as JSON evidence on the vehicle's score
            # We don't create fake taxonomy entries — these are metadata signals
            pass

        conn.commit()
        cur.close()

    return {
        "ymm_key": ymm_key,
        "contextual_signals": contextual_obs,
        "pass1_observation_count": len(pass1_obs),
        "dominant_lifecycle": dominant_lifecycle,
        "zones_observed": sorted(zones_observed),
        "lifecycle_distribution_reference": lifecycle_dist,
    }


# ─── Pass 3: Sequence Cross-Reference ──────────────────────────────

def sequence_pass(conn, vehicle_id: str) -> dict:
    """
    Phase 3D: Sequence cross-reference pass.

    Analyzes photo sequences for a vehicle:
      - Spatial continuity (close-up preceded by full shot → we know where this is)
      - Multi-angle confirmation (same damage in multiple views → higher confidence)
      - Coverage gaps (5 photos of driver side, 0 of passenger → flag asymmetry)
      - Sequence patterns (systematic walkthrough vs random shots)

    Writes observations with pass_number=3, source='sequence_inference'.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    # Get all images for this vehicle with their observations
    cur.execute("""
        SELECT
            vi.id as image_id, vi.vehicle_zone, vi.condition_score,
            vi.created_at as timestamp,
            vi.image_url
        FROM vehicle_images vi
        WHERE vi.vehicle_id = %s
        ORDER BY vi.created_at ASC
    """, (vehicle_id,))
    images = cur.fetchall()

    if len(images) < 2:
        cur.close()
        return {"vehicle_id": vehicle_id, "sequence_signals": [], "reason": "insufficient_images"}

    # Get observations grouped by image
    cur.execute("""
        SELECT
            ico.image_id, ct.canonical_key, ico.severity, ico.zone
        FROM image_condition_observations ico
        JOIN condition_taxonomy ct ON ct.descriptor_id = ico.descriptor_id
        WHERE ico.vehicle_id = %s
    """, (vehicle_id,))
    obs_rows = cur.fetchall()
    cur.close()

    obs_by_image = defaultdict(list)
    for o in obs_rows:
        obs_by_image[str(o["image_id"])].append(o)

    sequence_signals = []

    # 1. Zone distribution analysis
    zone_counts = Counter(img["vehicle_zone"] for img in images if img["vehicle_zone"])
    total_with_zone = sum(zone_counts.values())

    if total_with_zone > 0:
        # Check for zone imbalance
        exterior_zones = {z: c for z, c in zone_counts.items() if z.startswith("ext_")}
        if exterior_zones:
            max_zone = max(exterior_zones.values())
            min_zone = min(exterior_zones.values()) if len(exterior_zones) > 1 else 0
            if max_zone > 3 * max(min_zone, 1):
                heavy_zone = max(exterior_zones, key=exterior_zones.get)
                sequence_signals.append({
                    "type": "zone_imbalance",
                    "detail": f"heavy coverage of {heavy_zone} ({max_zone} photos) vs minimal coverage of other exterior zones",
                    "zone_distribution": dict(zone_counts),
                })

    # 2. Multi-angle damage confirmation
    damage_by_descriptor = defaultdict(set)  # descriptor → set of zones it appears in
    for img_id, obs_list in obs_by_image.items():
        for o in obs_list:
            if o["zone"]:
                damage_by_descriptor[o["canonical_key"]].add(o["zone"])

    for descriptor, zones in damage_by_descriptor.items():
        if len(zones) >= 2:
            sequence_signals.append({
                "type": "multi_angle_confirmation",
                "detail": f"'{descriptor}' observed in {len(zones)} different zones: {sorted(zones)}",
                "descriptor": descriptor,
                "zone_count": len(zones),
                "confidence_boost": min(0.3, len(zones) * 0.1),
            })

    # 3. Photo sequence pattern
    # Are photos taken in a systematic walkthrough or random order?
    if total_with_zone >= 5:
        zone_sequence = [img["vehicle_zone"] for img in images if img["vehicle_zone"]]
        # Check if consecutive photos tend to be in related zones
        transitions = 0
        related = 0
        for i in range(1, len(zone_sequence)):
            transitions += 1
            z1, z2 = zone_sequence[i-1], zone_sequence[i]
            # Related if same zone prefix (ext_, int_, mech_, etc.)
            if z1 and z2 and z1.split("_")[0] == z2.split("_")[0]:
                related += 1

        if transitions > 0:
            continuity = related / transitions
            if continuity > 0.6:
                pattern = "systematic_walkthrough"
            elif continuity > 0.3:
                pattern = "semi_organized"
            else:
                pattern = "random_shots"

            sequence_signals.append({
                "type": "sequence_pattern",
                "detail": f"photo sequence is {pattern} (continuity={continuity:.0%})",
                "pattern": pattern,
                "continuity_score": round(continuity, 2),
            })

    # 4. Coverage completeness
    all_major_zones = {
        "ext_front", "ext_rear", "ext_driver_side", "ext_passenger_side",
        "int_dashboard", "mech_engine_bay",
    }
    covered = set(zone_counts.keys()) & all_major_zones
    coverage_pct = len(covered) / len(all_major_zones)

    if coverage_pct < 1.0:
        missing = all_major_zones - covered
        sequence_signals.append({
            "type": "coverage_completeness",
            "detail": f"{coverage_pct:.0%} of major zones covered, missing: {sorted(missing)}",
            "coverage_pct": round(coverage_pct, 2),
            "missing_zones": sorted(missing),
        })

    return {
        "vehicle_id": vehicle_id,
        "total_images": len(images),
        "images_with_zone": total_with_zone,
        "zone_distribution": dict(zone_counts),
        "sequence_signals": sequence_signals,
        "images_with_observations": len(obs_by_image),
    }


# ─── Phase 5: Taxonomy Growth (Rhizomatic) ─────────────────────────

def discover_new_descriptors(conn, dry_run: bool = False) -> dict:
    """
    Phase 5: Scan for observations/flags that don't map to existing taxonomy.
    When found, create new taxonomy nodes automatically.

    Sources of new descriptors:
      1. damage_flags/modification_flags in vehicle_images that have no alias
      2. Recurring evidence patterns in image_condition_observations
      3. Expert quote themes from ymm_knowledge profiles

    The taxonomy grows by observation — new nodes are versioned, never deleted.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")

    # 1. Find damage_flags and modification_flags that have no alias mapping
    cur.execute("""
        SELECT alias_key FROM condition_aliases
    """)
    existing_aliases = {r["alias_key"] for r in cur.fetchall()}

    # Scan image_condition_observations for raw_flag values (already indexed, much smaller)
    # Plus check known flag enums from the codebase
    KNOWN_DAMAGE_FLAGS = {
        "rust", "dent", "crack", "paint_fade", "broken_glass",
        "missing_parts", "accident_damage",
        # Extended flags from various sources
        "water_damage", "fire_damage", "hail_damage", "frame_damage",
        "flood_damage", "surface_rust", "deep_rust", "paint_bubble",
        "clear_coat_peel", "chrome_pit", "trim_missing", "seat_tear",
        "dash_crack", "headliner_sag", "carpet_stain",
    }
    KNOWN_MOD_FLAGS = {
        "lift_kit", "lowered", "aftermarket_wheels", "roll_cage",
        "engine_swap", "body_kit", "exhaust_mod", "suspension_mod",
        # Extended
        "turbo", "supercharger", "headers", "cam", "intake",
        "disc_brakes", "power_steering", "overdrive",
        "air_conditioning", "stereo", "gauges", "tonneau",
        "winch", "light_bar", "bed_liner",
    }

    # Also scan evidence from existing observations for real flags seen in the wild
    cur.execute("""
        SELECT DISTINCT evidence->>'raw_flag' as flag
        FROM image_condition_observations
        WHERE evidence->>'raw_flag' IS NOT NULL
    """)
    observed_flags = {r["flag"] for r in cur.fetchall()}

    all_damage_flags = KNOWN_DAMAGE_FLAGS | observed_flags
    all_mod_flags = KNOWN_MOD_FLAGS | observed_flags

    unmapped_damage = all_damage_flags - existing_aliases
    unmapped_mods = all_mod_flags - existing_aliases

    new_descriptors = []

    # Auto-generate taxonomy entries for unmapped flags
    # Use naming convention: domain.category.descriptor
    damage_mapping_rules = {
        # Common patterns we might encounter
        "water_damage": ("exterior.surface.water_damage", "adjective", "exterior"),
        "fire_damage": ("structural.fire.evidence", "adjective", "structural"),
        "hail_damage": ("exterior.body.hail_damage", "adjective", "exterior"),
        "frame_damage": ("structural.frame.damage", "adjective", "structural"),
        "flood_damage": ("structural.flood.evidence", "adjective", "structural"),
        "undercoating": ("exterior.undercarriage.undercoating", "state", "exterior"),
        "surface_rust": ("exterior.metal.surface_oxidation", "adjective", "exterior"),
        "deep_rust": ("exterior.metal.perforation", "adjective", "exterior"),
        "paint_bubble": ("exterior.paint.blistering", "adjective", "exterior"),
        "clear_coat_peel": ("exterior.paint.delamination", "adjective", "exterior"),
        "chrome_pit": ("exterior.chrome.pitting", "adjective", "exterior"),
        "trim_missing": ("exterior.trim.absent", "state", "exterior"),
        "seat_tear": ("interior.upholstery.tear", "adjective", "interior"),
        "dash_crack": ("interior.dashboard.cracking", "adjective", "interior"),
        "headliner_sag": ("interior.headliner.sagging", "adjective", "interior"),
        "carpet_stain": ("interior.carpet.staining", "adjective", "interior"),
    }

    mod_mapping_rules = {
        "turbo": ("mechanical.engine.forced_induction", "state", "mechanical"),
        "supercharger": ("mechanical.engine.forced_induction", "state", "mechanical"),
        "headers": ("mechanical.exhaust.headers_aftermarket", "state", "mechanical"),
        "cam": ("mechanical.engine.camshaft_modified", "state", "mechanical"),
        "intake": ("mechanical.engine.intake_modified", "state", "mechanical"),
        "disc_brakes": ("mechanical.brakes.disc_conversion", "state", "mechanical"),
        "power_steering": ("mechanical.steering.power_added", "state", "mechanical"),
        "overdrive": ("mechanical.transmission.overdrive_added", "state", "mechanical"),
        "air_conditioning": ("interior.comfort.ac_added", "state", "interior"),
        "stereo": ("interior.electronics.stereo_aftermarket", "state", "interior"),
        "gauges": ("interior.electronics.gauges_aftermarket", "state", "interior"),
        "tonneau": ("exterior.accessories.tonneau_cover", "state", "exterior"),
        "winch": ("exterior.accessories.winch", "state", "exterior"),
        "light_bar": ("exterior.accessories.light_bar", "state", "exterior"),
        "bed_liner": ("exterior.bed.liner", "state", "exterior"),
    }

    # Process unmapped damage flags
    for flag in sorted(unmapped_damage):
        if flag in damage_mapping_rules:
            canonical, desc_type, domain = damage_mapping_rules[flag]
        else:
            # Auto-generate: exterior.unknown.{flag_name}
            clean = flag.lower().replace(" ", "_").replace("-", "_")
            canonical = f"exterior.detected.{clean}"
            desc_type = "adjective"
            domain = "exterior"

        new_descriptors.append({
            "canonical_key": canonical,
            "descriptor_type": desc_type,
            "domain": domain,
            "display_label": flag.replace("_", " ").title(),
            "alias_from": flag,
            "source": "damage_flag_growth",
        })

    # Process unmapped mod flags
    for flag in sorted(unmapped_mods):
        if flag in mod_mapping_rules:
            canonical, desc_type, domain = mod_mapping_rules[flag]
        else:
            clean = flag.lower().replace(" ", "_").replace("-", "_")
            canonical = f"mechanical.detected.{clean}"
            desc_type = "state"
            domain = "mechanical"

        new_descriptors.append({
            "canonical_key": canonical,
            "descriptor_type": desc_type,
            "domain": domain,
            "display_label": flag.replace("_", " ").title(),
            "alias_from": flag,
            "source": "modification_flag_growth",
        })

    # 2. Find recurring evidence patterns without taxonomy mapping
    cur.execute("""
        SELECT evidence->>'raw_flag' as raw_flag, COUNT(*) as cnt
        FROM image_condition_observations
        WHERE evidence->>'raw_flag' IS NOT NULL
        GROUP BY evidence->>'raw_flag'
        HAVING COUNT(*) >= 5
    """)
    recurring = cur.fetchall()
    for r in recurring:
        flag = r["raw_flag"]
        if flag not in existing_aliases and not any(d["alias_from"] == flag for d in new_descriptors):
            clean = flag.lower().replace(" ", "_").replace("-", "_")
            new_descriptors.append({
                "canonical_key": f"observed.recurring.{clean}",
                "descriptor_type": "adjective",
                "domain": "exterior",
                "display_label": flag.replace("_", " ").title(),
                "alias_from": flag,
                "source": f"recurring_observation_n={r['cnt']}",
            })

    cur.close()

    if dry_run or not new_descriptors:
        return {
            "unmapped_flags_checked": len(unmapped_damage) + len(unmapped_mods),
            "new_descriptors": new_descriptors,
            "dry_run": dry_run,
        }

    # Write new taxonomy nodes and aliases
    cur = conn.cursor()
    created = 0
    version = f"v_auto_{datetime.now().strftime('%Y%m%d_%H%M')}"

    for desc in new_descriptors:
        # Check if canonical_key already exists (another descriptor might share it)
        cur.execute(
            "SELECT descriptor_id FROM condition_taxonomy WHERE canonical_key = %s",
            (desc["canonical_key"],),
        )
        existing = cur.fetchone()

        if existing:
            descriptor_id = existing[0]
        else:
            cur.execute("""
                INSERT INTO condition_taxonomy
                    (canonical_key, domain, descriptor_type, display_label, taxonomy_version)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING descriptor_id
            """, (
                desc["canonical_key"], desc["domain"], desc["descriptor_type"],
                desc["display_label"], version,
            ))
            descriptor_id = cur.fetchone()[0]

        # Create alias
        cur.execute("""
            INSERT INTO condition_aliases (alias_key, descriptor_id, taxonomy_version)
            VALUES (%s, %s, %s)
            ON CONFLICT (alias_key) DO NOTHING
        """, (desc["alias_from"], descriptor_id, version))

        created += 1

    conn.commit()
    cur.close()

    return {
        "unmapped_flags_checked": len(unmapped_damage) + len(unmapped_mods),
        "new_descriptors": new_descriptors,
        "created": created,
        "taxonomy_version": version,
        "dry_run": False,
    }


# ─── CLI ────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Condition Spectrometer")
    subparsers = parser.add_subparsers(dest="command")

    # 5W context
    ctx_parser = subparsers.add_parser("context", help="Get 5W context for an image")
    ctx_parser.add_argument("--image-id", required=True)
    ctx_parser.add_argument("--vehicle-id", required=True)

    # Bridge YONO output → observations
    bridge_parser = subparsers.add_parser("bridge", help="Bridge YONO output to observations")
    bridge_parser.add_argument("--vehicle-id", help="Bridge for specific vehicle")
    bridge_parser.add_argument("--limit", type=int, default=1000, help="Max images to bridge")
    bridge_parser.add_argument("--rebridge", action="store_true",
                               help="Delete existing yono_v1 observations and re-bridge all")

    # Compute condition score
    score_parser = subparsers.add_parser("score", help="Compute condition score")
    score_parser.add_argument("--vehicle-id", required=True)
    score_parser.add_argument("--save", action="store_true", default=True)

    # Compute distributions
    dist_parser = subparsers.add_parser("distribute", help="Compute condition distributions")
    dist_parser.add_argument("--ymm", help="Specific Y/M/M key")
    dist_parser.add_argument("--all", action="store_true", help="All Y/M/M groups")

    # Contextual pass (Phase 3C)
    ctx_pass_parser = subparsers.add_parser("contextual", help="Run contextual pass (Y/M/M knowledge-informed)")
    ctx_pass_parser.add_argument("--vehicle-id", required=True)

    # Sequence pass (Phase 3D)
    seq_parser = subparsers.add_parser("sequence", help="Run sequence cross-reference pass")
    seq_parser.add_argument("--vehicle-id", required=True)

    # Full pipeline (bridge → contextual → sequence → score → distribute)
    pipe_parser = subparsers.add_parser("pipeline", help="Run full multipass pipeline for a vehicle")
    pipe_parser.add_argument("--vehicle-id", required=True)

    # Batch score all vehicles with observations
    batch_parser = subparsers.add_parser("score-all", help="Score all vehicles with observations")
    batch_parser.add_argument("--limit", type=int, default=500, help="Max vehicles to score")

    # Taxonomy growth
    grow_parser = subparsers.add_parser("grow", help="Discover and create new taxonomy nodes")
    grow_parser.add_argument("--dry-run", action="store_true", help="Preview without writing")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    conn = get_connection()

    if args.command == "context":
        ctx = get_5w_context(conn, args.image_id, args.vehicle_id)
        print(json.dumps(ctx, indent=2, default=str))

    elif args.command == "bridge":
        result = bridge_vehicle_images(conn, vehicle_id=args.vehicle_id,
                                       limit=args.limit, rebridge=args.rebridge)
        print(f"Bridged: {result['processed']} images, {result['observations_written']} observations, "
              f"{result['skipped']} skipped, {result.get('deleted', 0)} old observations deleted")

    elif args.command == "score":
        score_data = compute_condition_score(conn, args.vehicle_id)
        if score_data:
            print(f"\nCondition Score: {score_data['condition_score']}/100 ({score_data['condition_tier']})")
            print(f"  Exterior:    {score_data['exterior_score']}/30")
            print(f"  Interior:    {score_data['interior_score']}/20")
            print(f"  Mechanical:  {score_data['mechanical_score']}/20")
            print(f"  Provenance:  {score_data['provenance_score']}/15")
            print(f"  Structural:  {score_data['structural_score']}/15")
            print(f"  Lifecycle:   {score_data['lifecycle_state']}")
            print(f"  Observations: {score_data['observation_count']}")
            print(f"  Zone coverage: {score_data['zone_coverage']:.1%}")
            if args.save:
                save_condition_score(conn, score_data)
                print(f"\n  Saved to vehicle_condition_scores")
        else:
            print("No observations found for this vehicle.")

    elif args.command == "distribute":
        if args.all:
            result = recompute_all_distributions(conn)
            print(f"Distributions computed:")
            print(f"  Y/M/M groups: {result['ymm_groups_computed']}")
            print(f"  Skipped (< 3 vehicles): {result['ymm_groups_skipped']}")
            print(f"  Global: {'yes' if result['global_computed'] else 'no'}")
        elif args.ymm:
            dist = compute_distribution(conn, ymm_key=args.ymm, group_type="ymm")
            if dist:
                print(f"\nDistribution for {args.ymm}:")
                print(f"  N={dist['group_size']}, mean={dist['mean_score']}, "
                      f"median={dist['median_score']}, std={dist['std_dev']}")
                print(f"  P10={dist['percentile_10']}, P25={dist['percentile_25']}, "
                      f"P50={dist['percentile_50']}, P75={dist['percentile_75']}, "
                      f"P90={dist['percentile_90']}")
                if dist['skewness'] is not None:
                    direction = "right (more low-condition)" if dist['skewness'] > 0 else "left (more high-condition)"
                    print(f"  Skewness: {dist['skewness']} ({direction})")
                if dist['lifecycle_distribution']:
                    print(f"  Lifecycle: {dist['lifecycle_distribution']}")
            else:
                print(f"Not enough data for {args.ymm} (need >= 3 scored vehicles)")
        else:
            dist_parser.print_help()

    elif args.command == "contextual":
        result = contextual_pass(conn, args.vehicle_id)
        if result.get("error"):
            print(f"Error: {result['error']}")
        else:
            print(f"\nContextual Pass for {result.get('ymm_key', '?')}:")
            print(f"  Pass-1 observations: {result.get('pass1_observation_count', 0)}")
            print(f"  Dominant lifecycle: {result.get('dominant_lifecycle', 'unknown')}")
            print(f"  Zones observed: {', '.join(result.get('zones_observed', []))}")
            signals = result.get("contextual_signals", [])
            if signals:
                print(f"  Contextual signals ({len(signals)}):")
                for s in signals:
                    print(f"    [{s['type']}] {s['detail']}")
            else:
                print("  No contextual signals generated")
            ref = result.get("lifecycle_distribution_reference", {})
            if ref:
                print(f"  Y/M/M lifecycle reference: {ref}")

    elif args.command == "sequence":
        result = sequence_pass(conn, args.vehicle_id)
        if result.get("reason"):
            print(f"Skipped: {result['reason']}")
        else:
            print(f"\nSequence Pass for {args.vehicle_id}:")
            print(f"  Total images: {result['total_images']}")
            print(f"  With zone: {result['images_with_zone']}")
            print(f"  With observations: {result['images_with_observations']}")
            zones = result.get("zone_distribution", {})
            if zones:
                top_zones = sorted(zones.items(), key=lambda x: x[1], reverse=True)[:10]
                print(f"  Top zones: {', '.join(f'{z}({c})' for z, c in top_zones)}")
            signals = result.get("sequence_signals", [])
            if signals:
                print(f"  Sequence signals ({len(signals)}):")
                for s in signals:
                    print(f"    [{s['type']}] {s['detail']}")
            else:
                print("  No sequence signals")

    elif args.command == "pipeline":
        print(f"Running full pipeline for {args.vehicle_id}...")
        # Step 1: Bridge
        bridge_result = bridge_vehicle_images(conn, vehicle_id=args.vehicle_id)
        print(f"  [1/5] Bridge: {bridge_result['observations_written']} observations from {bridge_result['processed']} images")

        # Step 2: Contextual pass
        ctx_result = contextual_pass(conn, args.vehicle_id)
        ctx_signals = len(ctx_result.get("contextual_signals", []))
        print(f"  [2/5] Contextual: {ctx_signals} signals, lifecycle={ctx_result.get('dominant_lifecycle', '?')}")

        # Step 3: Sequence pass
        seq_result = sequence_pass(conn, args.vehicle_id)
        seq_signals = len(seq_result.get("sequence_signals", []))
        print(f"  [3/5] Sequence: {seq_signals} signals across {seq_result.get('total_images', 0)} images")

        # Step 4: Score
        score_data = compute_condition_score(conn, args.vehicle_id)
        if score_data:
            save_condition_score(conn, score_data)
            print(f"  [4/5] Score: {score_data['condition_score']}/100 ({score_data['condition_tier']})")
            print(f"         Exterior={score_data['exterior_score']}/30  Interior={score_data['interior_score']}/20  "
                  f"Mechanical={score_data['mechanical_score']}/20  Provenance={score_data['provenance_score']}/15  "
                  f"Structural={score_data['structural_score']}/15")
            print(f"         Lifecycle={score_data['lifecycle_state']}  Zones={score_data['zone_coverage']:.0%}")
        else:
            print(f"  [4/5] Score: no observations to score")

        # Step 5: Distribution update (if score was computed)
        if score_data:
            ymm_key = score_data["ymm_key"]
            dist = compute_distribution(conn, ymm_key=ymm_key, group_type="ymm")
            if dist:
                print(f"  [5/5] Distribution: {ymm_key} N={dist['group_size']} mean={dist['mean_score']} std={dist['std_dev']}")
            else:
                print(f"  [5/5] Distribution: not enough data for {ymm_key} (need >=3)")
        else:
            print(f"  [5/5] Distribution: skipped (no score)")

        print("\nPipeline complete.")

    elif args.command == "score-all":
        print(f"Batch scoring vehicles (limit={args.limit})...")
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '30s'")
        cur.execute("""
            SELECT DISTINCT ico.vehicle_id
            FROM image_condition_observations ico
            LEFT JOIN vehicle_condition_scores vcs ON vcs.vehicle_id = ico.vehicle_id
            WHERE vcs.vehicle_id IS NULL
               OR vcs.computed_at < ico.observed_at
            LIMIT %s
        """, (args.limit,))
        vehicles = cur.fetchall()
        cur.close()

        scored = 0
        failed = 0
        for v in vehicles:
            try:
                score_data = compute_condition_score(conn, str(v["vehicle_id"]))
                if score_data:
                    save_condition_score(conn, score_data)
                    scored += 1
                    if scored % 50 == 0:
                        print(f"  ...scored {scored}/{len(vehicles)}")
            except Exception as e:
                failed += 1
                if failed <= 5:
                    print(f"  Error scoring {v['vehicle_id']}: {e}")

        print(f"\nBatch score complete: {scored} scored, {failed} failed, {len(vehicles)} attempted")

        # Recompute distributions after batch
        if scored > 0:
            print("Recomputing distributions...")
            dist_result = recompute_all_distributions(conn)
            print(f"  Y/M/M groups: {dist_result['ymm_groups_computed']}, global: {dist_result['global_computed']}")

    elif args.command == "grow":
        result = discover_new_descriptors(conn, dry_run=args.dry_run)
        print(f"\nTaxonomy Growth {'(dry run)' if args.dry_run else ''}:")
        print(f"  Unmapped flags scanned: {result.get('unmapped_flags_checked', 0)}")
        new_descriptors = result.get("new_descriptors", [])
        if new_descriptors:
            print(f"  New descriptors {'would be ' if args.dry_run else ''}created: {len(new_descriptors)}")
            for d in new_descriptors:
                print(f"    {d['canonical_key']} ({d['descriptor_type']}) — from: {d['source']}")
        else:
            print("  No new descriptors needed")

    conn.close()


if __name__ == "__main__":
    main()
