#!/usr/bin/env python3
"""
Export Nuke system knowledge + vehicle data as instruction-tuning JSONL
for fine-tuning Qwen2.5-7B into a Nuke domain agent.

Generates 3 categories of training pairs:
1. System Knowledge — codebase, tools, pipeline, schema
2. Vehicle Verification — field_evidence conflicts, VIN vs claims
3. Vehicle Domain — make/model/year identification, pricing, market knowledge

Usage:
    dotenvx run -- python3 scripts/export_nuke_agent_data.py
"""

import json
import os
import sys
import glob
import random
from pathlib import Path
from datetime import datetime

# Supabase client
from supabase import create_client

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

OUTPUT_DIR = Path("/Users/skylar/nuke/training-data/nuke-agent")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SYSTEM_PROMPT = """You are Nuke, a vehicle data intelligence agent built by Nuke Ltd (nuke.ag). You are an expert in:
- Collector and vintage vehicle identification (make, model, year, trim, options)
- Vehicle data provenance and verification (VIN decoding, source trust hierarchies, modification detection)
- Auction market analysis (pricing, trends, geographic patterns)
- The Nuke platform architecture (edge functions, data pipelines, observation system)

You speak with authority on vehicles, are precise about data sources, and flag uncertainty when provenance is unclear. You use the source trust hierarchy: VIN/NHTSA (100) > Title Document (90) > Auction Listing (85) > Receipt/Work Order (80) > AI Analysis (65) > User Input (50) > Enrichment (30)."""


def make_pair(user_msg, assistant_msg, category="general"):
    """Create an instruction-tuning pair."""
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": assistant_msg},
        ],
        "category": category,
    }


# ============================================================
# CATEGORY 1: System Knowledge
# ============================================================

def export_system_knowledge():
    """Export codebase and architecture knowledge as Q&A pairs."""
    pairs = []
    nuke_root = Path("/Users/skylar/nuke")

    # --- TOOLS.md knowledge ---
    tools_path = nuke_root / "TOOLS.md"
    if tools_path.exists():
        tools_content = tools_path.read_text()
        pairs.append(make_pair(
            "What tools and edge functions does Nuke have? Give me the full registry.",
            f"Here is the canonical Nuke tools registry:\n\n{tools_content}",
            "system"
        ))

        # Parse individual tool entries for targeted Q&A
        lines = tools_content.split("\n")
        current_section = ""
        for line in lines:
            if line.startswith("## "):
                current_section = line.replace("## ", "").strip()
            elif line.startswith("| `") and "|" in line:
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) >= 2:
                    func_name = parts[0].strip("`")
                    description = parts[1]
                    pairs.append(make_pair(
                        f"What does the {func_name} function do?",
                        f"The `{func_name}` edge function: {description}. It's part of the {current_section} system.",
                        "system"
                    ))

    # --- Downloads docs as knowledge ---
    downloads = Path("/Users/skylar/Downloads")

    # Provenance architecture
    prov_audit = downloads / "provenance-architecture-audit.md"
    if prov_audit.exists():
        content = prov_audit.read_text()
        pairs.append(make_pair(
            "Explain the Nuke data provenance system. What are the gaps and how should provenance work?",
            content[:8000],
            "system"
        ))
        pairs.append(make_pair(
            "A vehicle has conflicting engine data — VIN says 5.0L but the listing says 5.7L. How should Nuke handle this?",
            """This is a modification detection case. The VIN decode (trust level 100) shows the FACTORY specification: 5.0L engine. The listing (trust level 85) shows the CURRENT state: 5.7L engine swap.

Nuke should:
1. Mark the field as MODIFICATION DETECTED (V_MOD verification level)
2. Record the factory value (5.0L) from VIN with source_type='nhtsa_vin_decode', confidence=100
3. Record the current value (5.7L) from the listing with source_type='bat_listing', confidence=85
4. Create a modification timeline event documenting the engine swap
5. Display BOTH values: "Factory: 5.0L 305ci V8 | Current: 5.7L 350ci SBC V8 (modified)"
6. Show the [MOD] badge on the engine field

The key principle: VIN tells you what left the factory. Listings and owner reports tell you what exists now. Both are valid — the provenance system tracks the difference.""",
            "system"
        ))

    # Relationship data audit
    rel_audit = downloads / "RELATIONSHIP_DATA_AUDIT.md"
    if rel_audit.exists():
        content = rel_audit.read_text()
        pairs.append(make_pair(
            "How does the Nuke relationship and ownership system work? What data connects users to vehicles?",
            content[:8000],
            "system"
        ))

    # Design system
    renovation = downloads / "RENOVATION-GUIDE.md"
    if renovation.exists():
        content = renovation.read_text()[:4000]
        pairs.append(make_pair(
            "What are the Nuke design system rules?",
            """The Nuke design system enforces strict rules:
- **Typography**: Arial only. Courier New for data. Font sizes 8-12px via CSS vars (--fs-8 through --fs-12)
- **Borders**: 2px solid, border-radius: 0 everywhere. Zero rounded corners.
- **Colors**: CSS variables only, no hardcoded hex or Tailwind color utilities
- **Shadows**: Only `0 1px 3px rgba(0,0,0,0.12)` — no other shadows
- **Gradients**: NONE. Zero gradients anywhere. Flat solid colors only.
- **Labels**: ALL CAPS with letter-spacing: 0.05em
- **Transitions**: 0.12s ease only
- **Canonical CSS**: `src/styles/unified-design-system.css` (legacy `design-system.css` is frozen)
- **Racing accents**: Gulf, Martini, JPS, BRG, Papaya — easter eggs only, never primary colors""",
            "system"
        ))

    # Map v6 UX spec knowledge
    pairs.append(make_pair(
        "What is the Nuke Map v6 architecture? How does the geo model work?",
        """The Nuke Map v6 uses a ZIP-code-first architecture:

**Geo Model**: ZIP codes are the primary spatial unit, replacing the previous H3 hex grid. ZIP code boundaries come from ZCTA shapefiles (Census Bureau). Every data point maps to exactly one ZIP. At zoom levels z4-z8, ZIPs cluster into counties/metros. At z9+, individual ZIP polygons are visible and interactive.

**Thermal System**: Thermal color fills ZIP polygons based on aggregate data (not radial point-based). Color ramp: purple (low) > red > orange > yellow > white (high). Zero bleed across ZIP boundaries. Log-scale normalization prevents extreme outliers from washing out mid-range ZIPs.

**Layer Controls**: Layer toggles (Vehicles, Businesses, Photos, Collections, Counties) directly show/hide map layers. Mode selector (HEX/POINTS/THERMAL) switches rendering mode. Color presets (DFLT/THER/MONO/SATE) change the palette. Sliders (Point Size, Hex Size, Opacity) update the map live.

**Click Interactions**: All interactions stay within the map — no navigation away. Clicking a ZIP opens a rich sidebar with stats, top vehicles, org list, photo gallery, and timeline scoped to that ZIP.

**Counties**: First-class interactive regions for measuring aggregate data. Shift-click/lasso to select multiple counties for comparison.""",
        "system"
    ))

    # Pipeline registry knowledge
    pairs.append(make_pair(
        "How does the Nuke pipeline registry work? What is it for?",
        """The pipeline_registry table in Supabase maps every computed/managed database field to the edge function that owns it. It has 63 entries covering vehicles (33 fields), vehicle_images (10), import_queue (5), bat_extraction_queue (4), document_ocr_queue (6), and vehicle_observations (4).

Before writing to ANY computed field, you MUST check:
```sql
SELECT owned_by, description, do_not_write_directly, write_via
FROM pipeline_registry
WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';
```

Fields with do_not_write_directly=true must be written through their owning function. This prevents data forks where multiple pipelines write to the same field with no coordination.

Examples:
- vehicles.signal_score → owned by signal-scoring-engine
- vehicles.nuke_estimate → owned by nuke-estimator
- vehicle_images.ai_processing_status → owned by analyze-image
- vehicles.data_quality_score → owned by score-data-quality""",
        "system"
    ))

    # Edge function patterns
    edge_funcs_dir = nuke_root / "supabase" / "functions"
    if edge_funcs_dir.exists():
        func_names = sorted([d.name for d in edge_funcs_dir.iterdir() if d.is_dir() and not d.name.startswith("_")])
        func_list = ", ".join(func_names[:50])
        pairs.append(make_pair(
            "List the Nuke edge functions.",
            f"Nuke has {len(func_names)} edge functions in supabase/functions/. Key ones include: {func_list}... and {len(func_names)-50} more. Use TOOLS.md for the canonical intent-to-function mapping.",
            "system"
        ))

    # Observation system
    pairs.append(make_pair(
        "How does the Nuke observation system work?",
        """The observation system is Nuke's source-agnostic data architecture. All data points flow through a unified pipeline:

[Any Source] → ingest-observation → vehicle_observations → discover-from-observations → observation_discoveries

Key tables:
- observation_sources: Registry of data sources with trust scores (auctions, forums, social, marketplaces, registries, shops, owners, documentation)
- vehicle_observations: Unified event store — ALL observations from ANY source
- observation_extractors: Config for how to extract from each source
- observation_discoveries: AI insights derived from observations

To add a new source, you register it in observation_sources with a slug, category, base_trust_score, and supported observation types. Then configure an extractor. This is config, not code.

The archiveFetch() function must be used for all external URL fetches — it auto-archives every page to listing_page_snapshots, enabling re-extraction without re-crawling.""",
        "system"
    ))

    return pairs


# ============================================================
# CATEGORY 2: Vehicle Verification
# ============================================================

def export_vehicle_verification(sb):
    """Export field_evidence data as verification Q&A pairs."""
    pairs = []

    # Fetch vehicles that have multiple conflicting evidence entries
    print("  Fetching field_evidence with conflicts...")

    # Get all field evidence grouped by vehicle
    all_evidence = []
    offset = 0
    while True:
        resp = sb.table("field_evidence").select(
            "vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context"
        ).range(offset, offset + 999).execute()
        if not resp.data:
            break
        all_evidence.extend(resp.data)
        offset += 1000
        if len(resp.data) < 1000:
            break

    print(f"  Total field_evidence rows: {len(all_evidence)}")

    # Group by vehicle_id + field_name
    from collections import defaultdict
    field_groups = defaultdict(list)
    for ev in all_evidence:
        key = (ev["vehicle_id"], ev["field_name"])
        field_groups[key].append(ev)

    # Find conflicts (multiple sources with different values)
    conflicts = []
    for (vid, field), entries in field_groups.items():
        if len(entries) >= 2:
            values = set(str(e["proposed_value"]).lower().strip() for e in entries if e["proposed_value"])
            if len(values) >= 2:
                conflicts.append((vid, field, entries))

    print(f"  Found {len(conflicts)} field conflicts across vehicles")

    # Fetch vehicle details for conflicted vehicles
    conflict_vids = list(set(c[0] for c in conflicts))[:200]  # Cap at 200
    vehicle_map = {}
    for i in range(0, len(conflict_vids), 50):
        batch = conflict_vids[i:i+50]
        resp = sb.table("vehicles").select(
            "id, year, make, model, vin, sale_price, engine_type, drivetrain, color, transmission"
        ).in_("id", batch).execute()
        if resp.data:
            for v in resp.data:
                vehicle_map[v["id"]] = v

    # Generate verification Q&A pairs
    for vid, field, entries in conflicts[:500]:  # Cap at 500 pairs
        vehicle = vehicle_map.get(vid)
        if not vehicle:
            continue

        ymm = f"{vehicle.get('year', '?')} {vehicle.get('make', '?')} {vehicle.get('model', '?')}"
        vin = vehicle.get("vin", "unknown")

        # Build evidence summary
        evidence_lines = []
        for e in sorted(entries, key=lambda x: -(x.get("source_confidence") or 0)):
            src = e.get("source_type", "unknown")
            val = e.get("proposed_value", "?")
            conf = e.get("source_confidence", 0)
            ctx = (e.get("extraction_context") or "")[:100]
            evidence_lines.append(f"- [{src}] (confidence {conf}): \"{val}\" — {ctx}")

        evidence_text = "\n".join(evidence_lines)

        # Determine the "correct" answer based on trust hierarchy
        sorted_entries = sorted(entries, key=lambda x: -(x.get("source_confidence") or 0))
        primary = sorted_entries[0]
        has_vin = any("vin" in (e.get("source_type") or "").lower() or "nhtsa" in (e.get("source_type") or "").lower() for e in entries)

        # Check for modification (VIN disagrees with other sources)
        vin_entries = [e for e in entries if "vin" in (e.get("source_type") or "").lower() or "nhtsa" in (e.get("source_type") or "").lower()]
        other_entries = [e for e in entries if e not in vin_entries]

        is_modification = False
        if vin_entries and other_entries:
            vin_val = str(vin_entries[0].get("proposed_value", "")).lower().strip()
            other_val = str(other_entries[0].get("proposed_value", "")).lower().strip()
            if vin_val and other_val and vin_val != other_val:
                is_modification = True

        if is_modification:
            answer = f"""For the {ymm} (VIN: {vin}), the {field} field has conflicting evidence that indicates a MODIFICATION:

Evidence:
{evidence_text}

The VIN decode shows the factory specification: "{vin_entries[0].get('proposed_value')}". Other sources show the current state: "{other_entries[0].get('proposed_value')}". This difference indicates a modification from factory spec.

Both values are valid — the VIN tells us what left the factory, while the listing/owner data tells us what exists now. This should be marked as V_MOD (Modification Detected) with both factory and current values tracked."""
        else:
            answer = f"""For the {ymm} (VIN: {vin}), the {field} field has multiple evidence sources:

Evidence:
{evidence_text}

The primary value is "{primary.get('proposed_value')}" from {primary.get('source_type')} (confidence: {primary.get('source_confidence')}). This is the highest-confidence source available."""

        pairs.append(make_pair(
            f"What is the verified {field} for the {ymm}? VIN: {vin}. I have conflicting data.",
            answer,
            "verification"
        ))

    return pairs


# ============================================================
# CATEGORY 3: Vehicle Domain Knowledge
# ============================================================

def export_vehicle_domain(sb):
    """Export vehicle records as domain knowledge pairs."""
    pairs = []

    # Fetch a diverse sample of vehicles with good data
    print("  Fetching vehicle samples for domain knowledge...")

    resp = sb.table("vehicles").select(
        "year, make, model, vin, sale_price, engine_type, engine_size, transmission, drivetrain, color, interior_color, mileage, body_style, trim, auction_source, description"
    ).gt("sale_price", 1000).not_.is_("vin", "null").not_.is_("description", "null").limit(2000).execute()

    vehicles = resp.data or []
    print(f"  Got {len(vehicles)} vehicles with rich data")

    for v in vehicles:
        ymm = f"{v.get('year', '?')} {v.get('make', '?')} {v.get('model', '?')}"
        price = v.get("sale_price", 0)
        desc = (v.get("description") or "")[:500]

        if not desc or len(desc) < 50:
            continue

        # Vehicle identification Q&A
        pairs.append(make_pair(
            f"Tell me about the {ymm}.",
            f"""The {ymm} is a collector vehicle in the Nuke database.

**Specifications:**
- Engine: {v.get('engine_type') or v.get('engine_size') or 'Not recorded'}
- Transmission: {v.get('transmission') or 'Not recorded'}
- Drivetrain: {v.get('drivetrain') or 'Not recorded'}
- Color: {v.get('color') or 'Not recorded'}
- Interior: {v.get('interior_color') or 'Not recorded'}
- Mileage: {v.get('mileage') or 'Not recorded'}

**Sale:** ${price:,.0f} via {v.get('auction_source') or 'unknown platform'}

**Description excerpt:** {desc}""",
            "domain"
        ))

        # Price verification Q&A
        if price and price > 0:
            # Generate price tier
            if price >= 500000:
                tier = "elite"
            elif price >= 100000:
                tier = "high"
            elif price >= 50000:
                tier = "mid"
            else:
                tier = "entry"

            pairs.append(make_pair(
                f"What did the {ymm} sell for? Is that a reasonable price?",
                f"The {ymm} sold for ${price:,.0f}, placing it in the '{tier}' price tier. Source: {v.get('auction_source') or 'auction platform'}.",
                "domain"
            ))

    # Make/model frequency knowledge
    print("  Generating make/model distribution knowledge...")
    resp = sb.rpc("", {}).execute() if False else None  # Skip RPC

    # Top makes
    top_makes_resp = sb.table("vehicles").select("make").not_.is_("make", "null").limit(10000).execute()
    if top_makes_resp.data:
        from collections import Counter
        make_counts = Counter(r["make"] for r in top_makes_resp.data if r.get("make"))
        top_20 = make_counts.most_common(20)
        make_summary = "\n".join(f"- {make}: {count} vehicles" for make, count in top_20)

        pairs.append(make_pair(
            "What are the most common vehicle makes in the Nuke database?",
            f"The top 20 makes in the Nuke database (from a sample):\n\n{make_summary}\n\nThe full database contains 1.25M+ vehicles across hundreds of makes.",
            "domain"
        ))

    return pairs


# ============================================================
# CATEGORY 4: ConceptCarz Forensics (Data Quality)
# ============================================================

def export_data_quality_knowledge():
    """Export data quality and forensics knowledge."""
    pairs = []

    pairs.append(make_pair(
        "Tell me about the ConceptCarz data quality issue. What happened?",
        """In March 2026, a forensic investigation revealed that 90.7% of sale_price values from ConceptCarz (374K rows, 29% of all vehicles) were fabricated average estimates, not real hammer prices.

**How it was detected:**
- Real auction prices follow bid increment patterns (always divisible by 100 at higher values)
- ConceptCarz prices like $70,156 are mathematically impossible as actual auction results
- The same "average" prices appeared across multiple vehicles

**What was done:**
- 265,215 fabricated prices moved from sale_price → cz_estimated_value (new column)
- 1,962 suspected averages also quarantined
- 18,407 rows retained as credible (likely_real or plausible)
- price_confidence column added: fabricated | suspected_average | plausible | likely_real
- 25,434 model names cleaned (stripped "Chassis#:" suffixes)
- 8,553 garbage rows deleted (make = auction house name)
- auction_source properly mapped for 329K rows across 28 auction houses

**Lesson:** Always verify price data provenance. Aggregated estimates are NOT the same as actual sale prices.""",
        "verification"
    ))

    pairs.append(make_pair(
        "How can I tell if a vehicle's sale price is real or fabricated?",
        """Check these signals:

1. **Bid increment test**: Real auction prices at higher values are typically divisible by 100 or 250 (bid increments). A price like $47,156 is suspicious — real auctions would end at $47,000 or $47,250.

2. **price_confidence field**: Check if it's set. Values: likely_real, plausible, suspected_average, fabricated.

3. **Source cross-reference**: Prices from direct auction platforms (BaT, Mecum, Barrett-Jackson) are more reliable than aggregator sites.

4. **Repetition check**: If the same price appears across many different vehicles from the same source, it's likely a computed average, not a real sale.

5. **Round number frequency**: Real auction data has a natural distribution. If all prices end in round numbers ($50,000, $75,000), that's normal. If they're oddly precise ($50,156, $75,312), they're likely computed.

The Nuke pipeline_registry shows that sale_price should only be written by verified extraction functions, never by enrichment pipelines.""",
        "verification"
    ))

    return pairs


# ============================================================
# Main export
# ============================================================

def main():
    print(f"{'='*60}")
    print("NUKE AGENT TRAINING DATA EXPORT")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'='*60}")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    all_pairs = []

    # 1. System knowledge (no DB needed)
    print("\n[1/4] Exporting system knowledge...")
    sys_pairs = export_system_knowledge()
    print(f"  Generated {len(sys_pairs)} system knowledge pairs")
    all_pairs.extend(sys_pairs)

    # 2. Vehicle verification (needs DB)
    print("\n[2/4] Exporting vehicle verification data...")
    ver_pairs = export_vehicle_verification(sb)
    print(f"  Generated {len(ver_pairs)} verification pairs")
    all_pairs.extend(ver_pairs)

    # 3. Vehicle domain (needs DB)
    print("\n[3/4] Exporting vehicle domain knowledge...")
    dom_pairs = export_vehicle_domain(sb)
    print(f"  Generated {len(dom_pairs)} domain knowledge pairs")
    all_pairs.extend(dom_pairs)

    # 4. Data quality knowledge
    print("\n[4/4] Exporting data quality knowledge...")
    dq_pairs = export_data_quality_knowledge()
    print(f"  Generated {len(dq_pairs)} data quality pairs")
    all_pairs.extend(dq_pairs)

    # Shuffle and write
    random.shuffle(all_pairs)

    # Split train/val
    split_idx = int(len(all_pairs) * 0.95)
    train_pairs = all_pairs[:split_idx]
    val_pairs = all_pairs[split_idx:]

    train_path = OUTPUT_DIR / "train.jsonl"
    val_path = OUTPUT_DIR / "val.jsonl"

    with open(train_path, "w") as f:
        for pair in train_pairs:
            f.write(json.dumps(pair) + "\n")

    with open(val_path, "w") as f:
        for pair in val_pairs:
            f.write(json.dumps(pair) + "\n")

    # Stats
    categories = {}
    for p in all_pairs:
        cat = p.get("category", "unknown")
        categories[cat] = categories.get(cat, 0) + 1

    print(f"\n{'='*60}")
    print("EXPORT COMPLETE")
    print(f"{'='*60}")
    print(f"Total pairs: {len(all_pairs)}")
    print(f"Train: {len(train_pairs)} ({train_path})")
    print(f"Val: {len(val_pairs)} ({val_path})")
    print(f"\nBy category:")
    for cat, count in sorted(categories.items()):
        print(f"  {cat}: {count}")
    print(f"\nFile sizes:")
    print(f"  train.jsonl: {train_path.stat().st_size / 1024:.1f} KB")
    print(f"  val.jsonl: {val_path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
