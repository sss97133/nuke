#!/usr/bin/env python3
"""
Generate rich training data for Nuke LLM fine-tuning.

Template-based approach using REAL data from the Nuke DB:
- Deep vehicle analysis with comparables
- Modification detection with reasoning chains
- Condition assessment from descriptions
- "What would it take" upgrade analysis
- Auction comment intelligence
- Market comparables analysis

Produces 20-50K training examples in chat format for Qwen2.5-7B fine-tuning.

Usage:
    dotenvx run -- yono/.venv/bin/python3 scripts/generate_rich_training_data.py
    dotenvx run -- yono/.venv/bin/python3 scripts/generate_rich_training_data.py --category deep_analysis --limit 1000
    dotenvx run -- yono/.venv/bin/python3 scripts/generate_rich_training_data.py --stats
"""

import json
import os
import sys
import random
import argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict, Counter
from typing import Optional

from supabase import create_client

# ============================================================
# Config
# ============================================================

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

OUTPUT_DIR = Path("/Users/skylar/nuke/training-data/nuke-agent")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SYSTEM_PROMPT = """You are Nuke, a vehicle data intelligence agent built by Nuke Ltd (nuke.ag). You are an expert in collector and vintage vehicles — identification, valuation, condition assessment, provenance verification, and market analysis.

When analyzing a vehicle, you follow this process:
1. IDENTIFY — Confirm year, make, model from available data. Note any discrepancies.
2. COMPARE — Pull comparable sales for the same Y/M/M. Explain price variation.
3. ASSESS — Evaluate condition from descriptions, photos, and expert commentary.
4. VALUE — Position the vehicle relative to its market tier with reasoning.
5. ADVISE — Identify what would increase value, what the best versions look like.

You cite specific data: real sale prices, real auction results, real expert commentary. You flag uncertainty when provenance is unclear. You use the trust hierarchy: VIN/NHTSA (100) > Title (90) > Auction Listing (85) > Receipt (80) > AI Analysis (65) > User Input (50) > Enrichment (30).

You speak with authority but never fabricate data. If you don't have comps, you say so."""


def make_pair(user_msg: str, assistant_msg: str, category: str = "general", system_prompt: str = None) -> dict:
    return {
        "messages": [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": assistant_msg},
        ],
        "category": category,
    }


def format_price(p: float) -> str:
    if p is None:
        return "N/A"
    return f"${p:,.0f}"


def price_tier(p: float) -> str:
    if p is None:
        return "unknown"
    if p >= 500000:
        return "elite"
    if p >= 100000:
        return "high"
    if p >= 50000:
        return "mid"
    if p >= 10000:
        return "entry"
    return "budget"


def ymm_key(v: dict) -> str:
    return f"{v.get('year', '?')}_{v.get('make', '?')}_{v.get('model', '?')}"


# ============================================================
# Data Loading (paginated, cached)
# ============================================================

class DataLoader:
    def __init__(self, sb):
        self.sb = sb
        self._vehicles = None
        self._ymm_groups = None
        self._comments_by_vehicle = None
        self._field_evidence = None

    def vehicles(self, limit: int = 50000) -> list:
        """Load vehicles with rich data."""
        if self._vehicles is not None:
            return self._vehicles

        print("  Loading vehicles...")
        all_vehicles = []
        offset = 0
        page_size = 1000

        while len(all_vehicles) < limit:
            resp = self.sb.table("vehicles").select(
                "id,year,make,model,vin,sale_price,engine_type,engine_size,"
                "transmission,drivetrain,color,interior_color,mileage,body_style,"
                "trim,auction_source,description,condition_rating"
            ).gt("sale_price", 1000).not_.is_("make", "null").not_.is_("year", "null").not_.is_("model", "null").not_.is_("description", "null").range(offset, offset + page_size - 1).execute()

            if not resp.data:
                break

            # Filter out garbage data (ConceptCarz artifacts, non-vehicle entries)
            for v in resp.data:
                desc = v.get("description", "") or ""
                make = v.get("make", "") or ""
                if len(desc) < 100:
                    continue
                if any(bad in make.lower() for bad in ["acrylic", "sculpture", "model by", "canvas"]):
                    continue
                if v.get("year", 0) and 1900 <= v["year"] <= 2026:
                    all_vehicles.append(v)

            offset += page_size
            if len(resp.data) < page_size:
                break
            if len(all_vehicles) % 10000 == 0:
                print(f"    {len(all_vehicles)} loaded...")

        self._vehicles = all_vehicles
        print(f"    Total: {len(all_vehicles)} vehicles")
        return all_vehicles

    def ymm_groups(self) -> dict:
        """Group vehicles by year/make/model."""
        if self._ymm_groups is not None:
            return self._ymm_groups

        vehicles = self.vehicles()
        groups = defaultdict(list)
        for v in vehicles:
            key = ymm_key(v)
            groups[key].append(v)

        self._ymm_groups = dict(groups)
        multi = {k: v for k, v in self._ymm_groups.items() if len(v) >= 2}
        print(f"    Y/M/M groups: {len(self._ymm_groups)} total, {len(multi)} with 2+ vehicles")
        return self._ymm_groups

    def comments_for_vehicles(self, vehicle_ids: list) -> dict:
        """Fetch auction comments for a batch of vehicle IDs."""
        comments_map = defaultdict(list)
        for i in range(0, len(vehicle_ids), 20):
            batch = vehicle_ids[i:i + 20]
            try:
                resp = self.sb.table("auction_comments").select(
                    "vehicle_id,comment_text,author_username,posted_at"
                ).in_("vehicle_id", batch).neq("is_seller", "True").order("posted_at", desc=True).limit(200).execute()

                if resp.data:
                    for c in resp.data:
                        if c.get("comment_text") and len(c["comment_text"]) > 30:
                            comments_map[c["vehicle_id"]].append(c)
            except Exception as e:
                pass  # Non-critical, skip batch

        return dict(comments_map)

    def field_evidence(self, limit: int = 5000) -> list:
        """Load field evidence with conflicts."""
        if self._field_evidence is not None:
            return self._field_evidence

        print("  Loading field evidence...")
        all_evidence = []
        offset = 0
        while len(all_evidence) < limit:
            resp = self.sb.table("field_evidence").select(
                "vehicle_id,field_name,proposed_value,source_type,source_confidence,extraction_context"
            ).range(offset, offset + 999).execute()
            if not resp.data:
                break
            all_evidence.extend(resp.data)
            offset += 1000
            if len(resp.data) < 1000:
                break

        self._field_evidence = all_evidence
        print(f"    Total: {len(all_evidence)} field evidence rows")
        return all_evidence


# ============================================================
# Category 1: Deep Vehicle Analysis
# ============================================================

def generate_deep_analysis(loader: DataLoader, limit: int = 5000) -> list:
    """Generate deep vehicle analysis examples with comparables."""
    pairs = []
    vehicles = loader.vehicles()
    ymm = loader.ymm_groups()

    # Pick vehicles that have comparables (same Y/M/M group has multiple entries)
    rich_vehicles = []
    for v in vehicles:
        key = ymm_key(v)
        group = ymm.get(key, [])
        if len(group) >= 2 and v.get("sale_price", 0) > 5000 and len(v.get("description", "") or "") > 200:
            rich_vehicles.append((v, group))

    random.shuffle(rich_vehicles)
    print(f"  Deep analysis: {len(rich_vehicles)} candidates")

    # Batch-load comments for these vehicles
    sample_vids = [v["id"] for v, _ in rich_vehicles[:limit]]
    comments_map = loader.comments_for_vehicles(sample_vids[:500])

    for v, group in rich_vehicles[:limit]:
        desc = (v.get("description") or "")[:800]
        price = v.get("sale_price", 0)
        tier = price_tier(price)
        source = v.get("auction_source") or "auction"
        ymm_str = f"{v['year']} {v['make']} {v['model']}"

        # Build comparables from the group (excluding self)
        comps = [c for c in group if c["id"] != v["id"] and c.get("sale_price")]
        comps.sort(key=lambda x: x.get("sale_price", 0), reverse=True)
        comps = comps[:5]

        comp_lines = []
        for c in comps:
            c_price = format_price(c.get("sale_price"))
            c_miles = f"{c['mileage']:,.0f} mi" if c.get("mileage") else "mileage unknown"
            c_src = c.get("auction_source") or "auction"
            c_color = c.get("color") or ""
            comp_lines.append(f"- {c['year']} {c['make']} {c['model']}, {c_miles}, {c_color}: {c_price} ({c_src})")

        comp_text = "\n".join(comp_lines) if comp_lines else "No direct comparables in database."

        # Comments if available
        vehicle_comments = comments_map.get(v["id"], [])
        comment_text = ""
        if vehicle_comments:
            top_comments = sorted(vehicle_comments, key=lambda x: len(x.get("comment_text", "")), reverse=True)[:3]
            comment_lines = []
            for c in top_comments:
                username = c.get("author_username") or "anonymous"
                text = (c.get("comment_text") or "")[:200]
                comment_lines.append(f'"{text}" — {username}')
            comment_text = "\n\n**Expert commentary from auction:**\n" + "\n".join(comment_lines)

        # Build specs string
        specs = []
        if v.get("engine_type") or v.get("engine_size"):
            specs.append(f"Engine: {v.get('engine_type') or v.get('engine_size')}")
        if v.get("transmission"):
            specs.append(f"Transmission: {v['transmission']}")
        if v.get("drivetrain"):
            specs.append(f"Drivetrain: {v['drivetrain']}")
        if v.get("color"):
            specs.append(f"Exterior: {v['color']}")
        if v.get("interior_color"):
            specs.append(f"Interior: {v['interior_color']}")
        if v.get("mileage"):
            specs.append(f"Mileage: {v['mileage']:,.0f}")
        specs_text = " | ".join(specs) if specs else "Specs not fully recorded"

        # Price positioning
        group_prices = [c.get("sale_price", 0) for c in group if c.get("sale_price")]
        if group_prices:
            avg_price = sum(group_prices) / len(group_prices)
            min_price = min(group_prices)
            max_price = max(group_prices)
            price_spread = max_price - min_price
            position = "above average" if price > avg_price else "below average"

            market_text = f"""**Market position:** At {format_price(price)}, this {ymm_str} sits {position} for the model ({format_price(min_price)} to {format_price(max_price)} range across {len(group_prices)} tracked sales). The {format_price(price_spread)} spread reflects differences in condition, options, and provenance."""
        else:
            market_text = f"**Market position:** Sold for {format_price(price)}, placing it in the '{tier}' price tier."

        # Question variations
        question_templates = [
            f"Analyze this {ymm_str}. {source} listing. {specs_text}.",
            f"I'm looking at a {ymm_str} that sold for {format_price(price)}. Is that a good price? What should I know?",
            f"Give me a full breakdown on this {ymm_str}. What's the market like?",
            f"What can you tell me about this {ymm_str}? Here's the listing description: {desc[:300]}",
        ]

        answer = f"""The {ymm_str} is a {tier}-tier collector vehicle.

**Specifications:** {specs_text}

**Description:** {desc[:500]}

{market_text}

**Comparable sales ({len(comps)} tracked):**
{comp_text}{comment_text}

**Source:** {source} | Price: {format_price(price)} | Tier: {tier}"""

        pairs.append(make_pair(random.choice(question_templates), answer.strip(), "deep_analysis"))

    return pairs


# ============================================================
# Category 2: Comparable Market Analysis
# ============================================================

def generate_comparables(loader: DataLoader, limit: int = 5000) -> list:
    """Generate comparable vehicle analysis for Y/M/M groups."""
    pairs = []
    ymm = loader.ymm_groups()

    # Only groups with 3+ sales
    multi_groups = {k: v for k, v in ymm.items() if len(v) >= 3}
    group_list = list(multi_groups.items())
    random.shuffle(group_list)
    print(f"  Comparables: {len(multi_groups)} Y/M/M groups with 3+ sales")

    for key, group in group_list[:limit]:
        if not group:
            continue

        sample = group[0]
        ymm_str = f"{sample['year']} {sample['make']} {sample['model']}"

        # Sort by price
        priced = sorted([v for v in group if v.get("sale_price")], key=lambda x: x["sale_price"], reverse=True)
        if len(priced) < 3:
            continue

        prices = [v["sale_price"] for v in priced]
        avg = sum(prices) / len(prices)
        median = sorted(prices)[len(prices) // 2]

        # Build comparison table
        comp_lines = []
        for v in priced[:8]:
            p = format_price(v.get("sale_price"))
            miles = f"{v['mileage']:,.0f} mi" if v.get("mileage") else "N/A"
            color = v.get("color") or "N/A"
            src = v.get("auction_source") or "unknown"
            trans = v.get("transmission") or ""
            engine = v.get("engine_type") or v.get("engine_size") or ""
            comp_lines.append(f"- {p} | {miles} | {color} | {engine} {trans} | {src}")

        # Price analysis
        spread = max(prices) - min(prices)
        top = priced[0]
        bottom = priced[-1]

        top_desc_snippet = (top.get("description") or "")[:200]
        bottom_desc_snippet = (bottom.get("description") or "")[:200]

        # What drives the price difference?
        diff_factors = []
        if top.get("mileage") and bottom.get("mileage") and top["mileage"] < bottom["mileage"]:
            diff_factors.append(f"Lower mileage ({top['mileage']:,.0f} vs {bottom['mileage']:,.0f})")
        if top.get("color") != bottom.get("color"):
            diff_factors.append(f"Color preference ({top.get('color', 'N/A')} vs {bottom.get('color', 'N/A')})")
        if top.get("transmission") != bottom.get("transmission"):
            diff_factors.append(f"Transmission ({top.get('transmission', 'N/A')} vs {bottom.get('transmission', 'N/A')})")
        if top.get("vin") and not bottom.get("vin"):
            diff_factors.append("VIN-documented provenance")
        if not diff_factors:
            diff_factors.append("Condition, documentation, and timing")

        diff_text = "; ".join(diff_factors)

        question = random.choice([
            f"I have a {ymm_str}. What are comparable recent sales?",
            f"What's the market like for {ymm_str}? Show me comps.",
            f"What should I expect to pay for a {ymm_str}?",
            f"I'm thinking about buying a {ymm_str}. What's the price range?",
        ])

        answer = f"""Here are {len(priced)} tracked sales for the {ymm_str}:

**Price range:** {format_price(min(prices))} — {format_price(max(prices))}
**Average:** {format_price(avg)} | **Median:** {format_price(median)}
**Spread:** {format_price(spread)} ({len(priced)} sales tracked)

**Sales breakdown:**
{chr(10).join(comp_lines)}

**What drives the {format_price(spread)} spread:** {diff_text}

**Highest sale ({format_price(top['sale_price'])}):** {top_desc_snippet}

**Lowest sale ({format_price(bottom['sale_price'])}):** {bottom_desc_snippet}

**Assessment:** A {ymm_str} in good condition with documented history should trade in the {format_price(median * 0.9)} to {format_price(median * 1.1)} range. Exceptional examples with low miles and matching numbers command {format_price(max(prices))} territory."""

        pairs.append(make_pair(question, answer.strip(), "comparables"))

    return pairs


# ============================================================
# Category 3: Modification Detection & Provenance
# ============================================================

def generate_modification_detection(loader: DataLoader, limit: int = 3000) -> list:
    """Generate modification detection reasoning chains from field_evidence."""
    pairs = []
    evidence = loader.field_evidence()
    vehicles = loader.vehicles()

    # Build vehicle lookup
    vehicle_map = {v["id"]: v for v in vehicles}

    # Group evidence by vehicle + field
    field_groups = defaultdict(list)
    for ev in evidence:
        key = (ev["vehicle_id"], ev["field_name"])
        field_groups[key].append(ev)

    # Find conflicts
    conflicts = []
    for (vid, field), entries in field_groups.items():
        if len(entries) < 2:
            continue
        values = set(str(e.get("proposed_value", "")).lower().strip() for e in entries if e.get("proposed_value"))
        if len(values) >= 2:
            vehicle = vehicle_map.get(vid)
            if vehicle:
                conflicts.append((vid, field, entries, vehicle))

    random.shuffle(conflicts)
    print(f"  Modification detection: {len(conflicts)} conflicts found")

    for vid, field, entries, vehicle in conflicts[:limit]:
        ymm_str = f"{vehicle.get('year', '?')} {vehicle.get('make', '?')} {vehicle.get('model', '?')}"
        vin = vehicle.get("vin") or "not recorded"

        # Sort by confidence
        sorted_entries = sorted(entries, key=lambda x: -(x.get("source_confidence") or 0))

        # Identify VIN vs non-VIN sources
        vin_entries = [e for e in entries if "vin" in (e.get("source_type") or "").lower() or "nhtsa" in (e.get("source_type") or "").lower()]
        other_entries = [e for e in entries if e not in vin_entries]

        is_modification = bool(vin_entries and other_entries)

        # Build evidence chain
        evidence_lines = []
        for e in sorted_entries:
            src = e.get("source_type", "unknown")
            val = e.get("proposed_value", "?")
            conf = e.get("source_confidence", 0)
            ctx = (e.get("extraction_context") or "")[:150]
            evidence_lines.append(f"- **{src}** (confidence {conf}): \"{val}\"\n  Context: {ctx}")

        evidence_text = "\n".join(evidence_lines)

        if is_modification:
            factory_val = vin_entries[0].get("proposed_value", "?")
            current_val = other_entries[0].get("proposed_value", "?")

            answer = f"""**MODIFICATION DETECTED** on the {ymm_str} (VIN: {vin})

**Field:** {field}

**Step 1 — Factory specification (VIN decode, trust 100):**
The VIN decodes to: {field} = "{factory_val}". This is what left the factory.

**Step 2 — Current state (listing/owner data, trust 85):**
The listing reports: {field} = "{current_val}". This is what exists today.

**Step 3 — Evidence chain:**
{evidence_text}

**Step 4 — Assessment:**
The VIN and listing disagree. This indicates a post-factory modification: the {field} was changed from "{factory_val}" to "{current_val}". This should be marked as V_MOD (Modification Detected).

**Step 5 — Value impact:**
Modifications can increase or decrease value depending on the market. For {ymm_str}:
- If the modification is period-correct or performance-enhancing (common for this era/model), it may be neutral or positive
- If it removes matching-numbers originality, it typically reduces value 10-30%
- Documentation of the modification (receipts, photos) partially mitigates the discount

**Recommendation:** Record both factory and current values. Display as "Factory: {factory_val} | Current: {current_val} (modified)". Seek documentation of when/how the modification was performed."""
        else:
            primary = sorted_entries[0]
            answer = f"""**DATA CONFLICT** on the {ymm_str} (VIN: {vin})

**Field:** {field}

**Evidence chain:**
{evidence_text}

**Resolution:** The highest-confidence source is **{primary.get('source_type')}** (confidence {primary.get('source_confidence')}), reporting "{primary.get('proposed_value')}". This value takes precedence per the trust hierarchy.

**Note:** Multiple sources disagree on {field}. This could indicate:
1. Data entry errors across platforms
2. A modification not captured by VIN
3. Regional naming differences (e.g., "Ivory" vs "Cream" for the same color)

Without VIN decode data to compare against, we cannot confirm modification. Flag for manual review."""

        question = random.choice([
            f"I have conflicting data on the {field} for a {ymm_str} (VIN: {vin}). What's the verified value?",
            f"The {ymm_str} has different {field} values from different sources. Which is correct?",
            f"VIN shows one {field}, listing shows another for this {ymm_str}. Is this a modification?",
        ])

        pairs.append(make_pair(question, answer.strip(), "modification"))

    return pairs


# ============================================================
# Category 4: Condition Assessment from Descriptions
# ============================================================

def generate_condition_assessment(loader: DataLoader, limit: int = 3000) -> list:
    """Generate condition assessment examples from descriptions."""
    pairs = []
    vehicles = loader.vehicles()

    # Condition signal keywords
    positive_signals = {
        "restored": "Full or partial restoration completed",
        "matching numbers": "Original drivetrain components verified",
        "original paint": "Factory paint preserved",
        "no rust": "No corrosion detected",
        "garaged": "Indoor storage history",
        "documented": "Service/ownership history available",
        "concours": "Show-quality condition",
        "freshly rebuilt": "Recent mechanical work",
        "low miles": "Below-average mileage",
        "numbers matching": "Original drivetrain verified",
        "no accidents": "Clean accident history",
        "service records": "Maintenance documentation available",
    }

    negative_signals = {
        "rust": "Corrosion present",
        "needs work": "Mechanical or cosmetic attention required",
        "project": "Requires significant restoration",
        "non-running": "Vehicle is not operational",
        "repaint": "Non-original paint",
        "replacement engine": "Non-matching drivetrain",
        "dent": "Body damage present",
        "crack": "Structural or cosmetic cracking",
        "leak": "Fluid leaks detected",
        "worn": "Interior or mechanical wear",
        "faded": "Paint or interior deterioration",
        "missing": "Components absent",
    }

    # Pick vehicles with meaty descriptions
    rich = [v for v in vehicles if len(v.get("description", "") or "") > 300 and v.get("sale_price")]
    random.shuffle(rich)
    print(f"  Condition assessment: {len(rich)} vehicles with rich descriptions")

    for v in rich[:limit]:
        desc = (v.get("description") or "")[:1000]
        desc_lower = desc.lower()
        price = v.get("sale_price", 0)
        ymm_str = f"{v['year']} {v['make']} {v['model']}"

        # Extract condition signals
        found_positive = []
        found_negative = []

        for signal, meaning in positive_signals.items():
            if signal in desc_lower:
                found_positive.append(f"- **{signal.title()}**: {meaning}")
        for signal, meaning in negative_signals.items():
            if signal in desc_lower:
                found_negative.append(f"- **{signal.title()}**: {meaning}")

        if not found_positive and not found_negative:
            continue  # Skip if no signals found

        # Estimate condition score
        positive_count = len(found_positive)
        negative_count = len(found_negative)
        raw_score = 50 + (positive_count * 8) - (negative_count * 12)
        score = max(10, min(95, raw_score))

        if score >= 85:
            tier_label = "Excellent (85-95)"
        elif score >= 70:
            tier_label = "Good (70-84)"
        elif score >= 50:
            tier_label = "Driver (50-69)"
        elif score >= 30:
            tier_label = "Project (30-49)"
        else:
            tier_label = "Parts/Salvage (below 30)"

        pos_text = "\n".join(found_positive) if found_positive else "- No strong positive signals detected"
        neg_text = "\n".join(found_negative) if found_negative else "- No significant concerns detected"

        question = random.choice([
            f"Assess the condition of this {ymm_str} based on the listing: {desc[:400]}",
            f"What condition would you rate this {ymm_str}? Description: {desc[:400]}",
            f"Here's a {ymm_str} listing. How's the condition? \"{desc[:400]}\"",
        ])

        answer = f"""**Condition Assessment: {ymm_str}**

**Estimated Score:** {score}/100 — {tier_label}

**Positive signals detected:**
{pos_text}

**Concerns detected:**
{neg_text}

**Analysis:**
Based on the listing description, this {ymm_str} presents as a {tier_label.split('(')[0].strip().lower()} vehicle. {"The presence of matching numbers and documented history significantly supports the value." if positive_count > 2 else ""}{"Noted concerns around " + ", ".join(s.split("**")[1] for s in found_negative[:2]).lower() + " should be investigated further." if negative_count > 0 else ""}

**Price-condition alignment:** At {format_price(price)} in the '{price_tier(price)}' tier, this {"appears well-priced for its condition level" if (score >= 70 and price_tier(price) in ("mid", "high")) or (score >= 50 and price_tier(price) in ("entry", "budget")) else "may warrant closer inspection relative to asking price"}.

**Recommended next steps:**
1. {"Request VIN decode to verify matching-numbers claim" if "matching" in desc_lower else "Request VIN decode for factory specification verification"}
2. {"Professional rust inspection of known trouble areas" if "rust" in desc_lower or v.get("year", 2000) < 1985 else "Verify paint quality and body panel alignment"}
3. {"Mechanical inspection — check for the reported issues" if negative_count > 1 else "Pre-purchase inspection to confirm advertised condition"}"""

        pairs.append(make_pair(question, answer.strip(), "condition"))

    return pairs


# ============================================================
# Category 5: "What Would It Take" Upgrade Analysis
# ============================================================

def generate_upgrade_analysis(loader: DataLoader, limit: int = 3000) -> list:
    """Generate 'what would it take to make this excellent' examples."""
    pairs = []
    ymm = loader.ymm_groups()

    # Need groups with price spread (cheap + expensive versions of same car)
    for key, group in ymm.items():
        priced = [v for v in group if v.get("sale_price")]
        if len(priced) < 3:
            continue

        priced.sort(key=lambda x: x["sale_price"])
        low = priced[0]
        high = priced[-1]
        spread = high["sale_price"] - low["sale_price"]

        if spread < 5000:
            continue  # Need meaningful spread

        ymm_str = f"{low['year']} {low['make']} {low['model']}"
        avg_price = sum(v["sale_price"] for v in priced) / len(priced)

        # What the best version looks like
        high_desc = (high.get("description") or "")[:500]
        low_desc = (low.get("description") or "")[:500]

        # Estimate upgrade costs based on price spread
        gap = high["sale_price"] - low["sale_price"]
        paint_est = min(gap * 0.25, 25000)
        mech_est = min(gap * 0.2, 15000)
        interior_est = min(gap * 0.15, 12000)
        docs_est = min(gap * 0.05, 3000)
        total_est = paint_est + mech_est + interior_est + docs_est

        # Specs comparison
        spec_diffs = []
        for field, label in [("color", "Exterior"), ("transmission", "Transmission"), ("engine_type", "Engine"), ("mileage", "Mileage")]:
            low_val = low.get(field)
            high_val = high.get(field)
            if low_val and high_val and str(low_val) != str(high_val):
                if field == "mileage":
                    spec_diffs.append(f"- Mileage: {low_val:,.0f} (yours) vs {high_val:,.0f} (best)")
                else:
                    spec_diffs.append(f"- {label}: {low_val} (yours) vs {high_val} (best)")

        spec_diff_text = "\n".join(spec_diffs) if spec_diffs else "- Specifications are similar — condition and provenance drive the price difference"

        question = random.choice([
            f"I have a {ymm_str} worth about {format_price(low['sale_price'])}. What would it take to make it worth {format_price(high['sale_price'])}?",
            f"What separates a {format_price(low['sale_price'])} {ymm_str} from a {format_price(high['sale_price'])} one?",
            f"I own a {ymm_str} in driver condition. What would make it excellent?",
        ])

        answer = f"""**Upgrade Analysis: {ymm_str}**
**Current tier:** {format_price(low['sale_price'])} ({price_tier(low['sale_price'])})
**Target tier:** {format_price(high['sale_price'])} ({price_tier(high['sale_price'])})
**Gap:** {format_price(gap)}

**What the best version looks like:**
{high_desc[:400]}

**What yours looks like:**
{low_desc[:400]}

**Key differences:**
{spec_diff_text}

**Estimated investment to bridge the gap:**

| Category | Estimated Cost | Impact |
|----------|---------------|--------|
| Paint/Body | {format_price(paint_est)} | Show-quality repaint in correct color, body/panel work |
| Mechanical | {format_price(mech_est)} | Engine rebuild/refresh, suspension, brakes |
| Interior | {format_price(interior_est)} | Reupholstery, carpet, dash restoration |
| Documentation | {format_price(docs_est)} | Service records compilation, provenance research |
| **Total estimated** | **{format_price(total_est)}** | |

**ROI analysis:** Investing {format_price(total_est)} to move from {format_price(low['sale_price'])} to {format_price(high['sale_price'])} represents a potential {format_price(gap - total_est)} gain — {"a solid return if executed well" if gap > total_est * 1.3 else "marginal — only worth it if you plan to enjoy the car, not flip it"}.

**Critical warning:** Not every improvement translates to dollar-for-dollar value increase. The collector market rewards:
1. Originality over modifications
2. Documentation over claims
3. Patina over fresh paint (for some eras)
4. Matching numbers above all else"""

        pairs.append(make_pair(question, answer.strip(), "upgrade"))

        if len(pairs) >= limit:
            break

    random.shuffle(pairs)
    return pairs


# ============================================================
# Category 6: Auction Comment Intelligence
# ============================================================

def generate_comment_intelligence(loader: DataLoader, limit: int = 3000) -> list:
    """Generate auction comment analysis examples."""
    pairs = []
    vehicles = loader.vehicles()

    # Sample vehicles and fetch their comments
    rich_v = [v for v in vehicles if v.get("sale_price") and len(v.get("description", "") or "") > 200]
    random.shuffle(rich_v)
    sample = rich_v[:min(2000, limit)]

    print(f"  Comment intelligence: fetching comments for {len(sample)} vehicles...")
    vids = [v["id"] for v in sample]
    comments_map = loader.comments_for_vehicles(vids)

    print(f"    Got comments for {len(comments_map)} vehicles")

    for v in sample:
        if v["id"] not in comments_map:
            continue
        comments = comments_map[v["id"]]
        if len(comments) < 3:
            continue

        ymm_str = f"{v['year']} {v['make']} {v['model']}"
        price = v.get("sale_price", 0)

        # Format top comments
        top = sorted(comments, key=lambda x: len(x.get("comment_text", "")), reverse=True)[:5]
        comment_block = []
        for c in top:
            user = c.get("author_username") or "anonymous"
            text = (c.get("comment_text") or "")[:300]
            comment_block.append(f'"{text}" — @{user}')

        comments_text = "\n\n".join(comment_block)

        # Analyze comment themes
        all_text = " ".join(c.get("comment_text", "") for c in comments).lower()

        themes = []
        if any(w in all_text for w in ["rust", "corrosion", "rot"]):
            themes.append("**Rust/corrosion concerns** raised by commenters")
        if any(w in all_text for w in ["original", "matching", "numbers matching"]):
            themes.append("**Originality discussion** — commenters noting matching/non-matching components")
        if any(w in all_text for w in ["price", "expensive", "cheap", "deal", "bargain", "overpriced"]):
            themes.append("**Price debate** among commenters")
        if any(w in all_text for w in ["beautiful", "gorgeous", "stunning", "nice"]):
            themes.append("**Positive reception** — commenters admiring the vehicle")
        if any(w in all_text for w in ["mod", "swap", "converted", "custom"]):
            themes.append("**Modification discussion** — custom work or engine swaps noted")
        if any(w in all_text for w in ["history", "provenance", "owner", "documented"]):
            themes.append("**Provenance interest** — ownership history and documentation")

        if not themes:
            themes.append("**General discussion** — no strong thematic signals")

        themes_text = "\n".join(f"- {t}" for t in themes)

        # Sentiment
        pos_words = sum(1 for w in ["beautiful", "gorgeous", "stunning", "nice", "excellent", "love", "amazing", "perfect", "wow"] if w in all_text)
        neg_words = sum(1 for w in ["rust", "problem", "issue", "concern", "overpriced", "ugly", "wrong", "damaged"] if w in all_text)
        if pos_words > neg_words * 2:
            sentiment = "Strongly positive"
        elif pos_words > neg_words:
            sentiment = "Generally positive"
        elif neg_words > pos_words:
            sentiment = "Mixed to negative"
        else:
            sentiment = "Neutral / mixed"

        question = f"Here are the top comments from a {v.get('auction_source', 'BaT')} auction for a {ymm_str} (sold for {format_price(price)}). What do they tell us?\n\n{comments_text}"

        answer = f"""**Auction Comment Analysis: {ymm_str}**
**Sale price:** {format_price(price)} | **Comments analyzed:** {len(comments)}
**Overall sentiment:** {sentiment}

**Key themes:**
{themes_text}

**What the crowd is telling us:**
The {len(comments)} comments on this {ymm_str} {"paint a positive picture — the community recognizes this as a quality example" if sentiment.startswith("Strong") else "reveal important signals about the vehicle's reception"}.

{"The most substantive comments focus on " + themes[0].split("**")[1] + ", which is typical for " + ymm_str + " auctions." if themes else ""}

**Intelligence extracted:**
- **Condition signals:** {len([t for t in themes if "rust" in t.lower() or "originality" in t.lower()])} condition-related discussions
- **Market signals:** {len([t for t in themes if "price" in t.lower()])} price-related discussions
- **Modification flags:** {len([t for t in themes if "mod" in t.lower()])} modification-related discussions

**Takeaway for {ymm_str} buyers:** {"Expert commenters validate this vehicle — strong community reception typically correlates with fair pricing." if sentiment.startswith("Strong") or sentiment.startswith("General") else "Mixed reception suggests closer inspection warranted. Read the specific concerns raised."}"""

        pairs.append(make_pair(question, answer.strip(), "comment_intelligence"))

        if len(pairs) >= limit:
            break

    return pairs


# ============================================================
# Category 7: Platform Architecture (keep existing + expand)
# ============================================================

def generate_platform_knowledge() -> list:
    """Generate platform architecture knowledge (from existing export + expansion)."""
    pairs = []
    nuke_root = Path("/Users/skylar/nuke")

    # Import existing system knowledge
    sys.path.insert(0, str(nuke_root / "scripts"))
    try:
        from export_nuke_agent_data import export_system_knowledge, export_data_quality_knowledge
        pairs.extend(export_system_knowledge())
        pairs.extend(export_data_quality_knowledge())
    except Exception as e:
        print(f"  Warning: could not import existing knowledge: {e}")

    # Add multi-turn architecture conversations
    pairs.append(make_pair(
        "A vehicle has sale_price set but I'm not sure it's real. How do I verify?",
        """Check these in order:

**1. Source verification:**
```sql
SELECT auction_source, price_confidence FROM vehicles WHERE id = '<vehicle_id>';
```
- If `price_confidence = 'fabricated'` → it's a ConceptCarz average, not a real sale
- If `auction_source` is 'bat', 'carsandbids', 'mecum', 'barrett-jackson' → likely real hammer price

**2. Bid increment test:**
Real auction prices at higher values follow bid increments:
- Under $5K: $100 increments
- $5-25K: $250 increments
- $25-100K: $500-1000 increments
- Above $100K: $1000-5000 increments

A price like $47,156 is suspicious. Real auctions end at $47,000 or $47,250.

**3. Cross-reference:**
```sql
SELECT source_type, proposed_value, source_confidence
FROM field_evidence
WHERE vehicle_id = '<vehicle_id>' AND field_name = 'sale_price'
ORDER BY source_confidence DESC;
```

**4. Pipeline registry check:**
```sql
SELECT owned_by, write_via FROM pipeline_registry
WHERE table_name = 'vehicles' AND column_name = 'sale_price';
```
Only the owning function should write this field.

**Trust hierarchy for prices:**
- Direct auction result (BaT, Mecum confirmed): 95
- Auction listing (claimed price): 85
- Aggregator (ConceptCarz, Hagerty): 60
- User-reported: 50""",
        "system"
    ))

    pairs.append(make_pair(
        "How does the YONO vision system work? Walk me through the inference pipeline.",
        """YONO (You Only Nuke Once) is Nuke's local vehicle vision model. The inference pipeline:

**Step 1: Image intake**
Image URL or file → downloaded → converted to RGB (handles HEIC, WebP, JPG, PNG)

**Step 2: Hierarchical classification**
- **Tier 1 (Family):** EfficientNet-B0 ONNX model classifies into 8 families: American, German, British, Japanese, Italian, French, Swedish, Other
- **Tier 2 (Make):** Per-family ONNX model classifies specific make within family (e.g., German → BMW, Porsche, Mercedes, Audi, VW)
- **Fallback:** If tier-2 confidence < 0.5, falls through to flat 276-class model

**Step 3: Contextual analysis (if Y/M/M known)**
If we know the vehicle: 133D context vector (Y/M/M knowledge + vehicle instance + timeline) is concatenated with the 1280D image embedding → multi-task heads predict:
- Vehicle zone (39 classes: ext_front, int_dashboard, mech_engine_bay, etc.)
- Condition score (1-5)
- Damage flags (rust, dent, crack, paint_fade, broken_glass, missing_parts, accident)
- Modification flags (lift_kit, engine_swap, custom_paint, etc.)
- Price tier (budget/entry/mid/high/elite)

**Step 4: Condition spectrometer (multi-pass)**
For deep analysis, 5 passes:
- Pass 0: Free 5W context (metadata, zero cost)
- Pass 1: Broad YONO vision
- Pass 2: Y/M/M-loaded contextual vision
- Pass 3: Photo sequence cross-reference
- Final: 0-100 spectral condition score

**Performance:** 4ms/image on CPU (ONNX), ~125ms on Modal T4 GPU with Florence-2

**API:** `POST /classify` → `{make, confidence, family, top5}`
**API:** `POST /analyze` → `{zone, condition, damage_flags, mod_flags, photo_type}`""",
        "system"
    ))

    return pairs


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Generate rich training data for Nuke LLM")
    parser.add_argument("--category", type=str, default="all",
                        choices=["all", "deep_analysis", "comparables", "modification", "condition", "upgrade", "comments", "platform",
                                 "tool_routing", "pipeline_ownership", "data_quality_diagnosis", "system_rules",
                                 "incident_response", "session_patterns", "data_completeness", "stats"])
    parser.add_argument("--limit", type=int, default=5000, help="Max examples per category")
    parser.add_argument("--operational", action="store_true", help="Include operational training data (tool routing, system rules, etc.)")
    parser.add_argument("--operational-only", action="store_true", help="Generate only operational training data")
    parser.add_argument("--sample", type=int, default=0, help="Print N sample examples per category for review")
    parser.add_argument("--output", type=str, default=str(OUTPUT_DIR), help="Output directory")
    args = parser.parse_args()

    print("=" * 60)
    print("NUKE RICH TRAINING DATA GENERATOR")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Category: {args.category} | Limit per category: {args.limit}")
    print("=" * 60)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    loader = DataLoader(sb)

    all_pairs = []

    generators = {
        "deep_analysis": ("Deep Vehicle Analysis", lambda: generate_deep_analysis(loader, args.limit)),
        "comparables": ("Comparable Market Analysis", lambda: generate_comparables(loader, args.limit)),
        "modification": ("Modification Detection", lambda: generate_modification_detection(loader, args.limit)),
        "condition": ("Condition Assessment", lambda: generate_condition_assessment(loader, args.limit)),
        "upgrade": ("Upgrade Analysis", lambda: generate_upgrade_analysis(loader, args.limit)),
        "comments": ("Auction Comment Intelligence", lambda: generate_comment_intelligence(loader, args.limit)),
        "platform": ("Platform Architecture", generate_platform_knowledge),
    }

    # Load operational data sources if needed
    operational_generators = {}
    is_operational = args.operational or args.operational_only or args.category in (
        "tool_routing", "pipeline_ownership", "data_quality_diagnosis",
        "system_rules", "incident_response", "session_patterns", "data_completeness",
    )

    if is_operational or args.category == "all":
        print("\n[setup] Loading operational data sources...")
        try:
            from operational_training.parsers.tools_md_parser import parse_tools_md
            from operational_training.parsers.claude_md_parser import parse_hard_rules
            from operational_training.parsers.done_md_parser import parse_done_md
            from operational_training.parsers.pipeline_registry_loader import load_pipeline_registry
            from operational_training.parsers.session_log_parser import parse_all_sessions
            from operational_training.generators.tool_routing import generate_tool_routing
            from operational_training.generators.pipeline_ownership import generate_pipeline_ownership
            from operational_training.generators.data_quality_diagnosis import generate_data_quality_diagnosis
            from operational_training.generators.system_rules import generate_system_rules
            from operational_training.generators.incident_response import generate_incident_response
            from operational_training.generators.session_patterns import generate_session_patterns
            from operational_training.generators.data_completeness import generate_data_completeness

            tools_entries, antipatterns = parse_tools_md(Path("/Users/skylar/nuke/TOOLS.md"))
            print(f"  TOOLS.md: {len(tools_entries)} tools, {len(antipatterns)} antipatterns")

            hard_rules, principles = parse_hard_rules(Path("/Users/skylar/nuke/CLAUDE.md"))
            print(f"  CLAUDE.md: {len(hard_rules)} rules, {len(principles)} principles")

            done_entries = parse_done_md(Path("/Users/skylar/nuke/DONE.md"))
            print(f"  DONE.md: {len(done_entries)} entries ({sum(1 for e in done_entries if e.is_incident)} incidents)")

            registry = load_pipeline_registry(sb)
            print(f"  pipeline_registry: {len(registry)} entries")

            sessions_dir = Path("/Users/skylar/.claude/projects/-Users-skylar-nuke/")
            exchanges = parse_all_sessions(sessions_dir)
            print(f"  Session logs: {len(exchanges)} usable exchanges")

            operational_generators = {
                "tool_routing": ("Tool Routing", lambda: generate_tool_routing(tools_entries, antipatterns, args.limit)),
                "pipeline_ownership": ("Pipeline Ownership", lambda: generate_pipeline_ownership(registry, args.limit)),
                "data_quality_diagnosis": ("Data Quality Diagnosis", lambda: generate_data_quality_diagnosis(loader, args.limit)),
                "system_rules": ("System Rules", lambda: generate_system_rules(hard_rules, principles, args.limit)),
                "incident_response": ("Incident Response", lambda: generate_incident_response(done_entries, args.limit)),
                "session_patterns": ("Session Patterns", lambda: generate_session_patterns(exchanges, args.limit)),
                "data_completeness": ("Data Completeness", lambda: generate_data_completeness(loader, registry, args.limit)),
            }
        except Exception as e:
            print(f"  WARNING: Failed to load operational sources: {e}")
            import traceback
            traceback.print_exc()

    if args.category == "stats":
        # Just count available data
        print("\nLoading data counts...")
        vehicles = loader.vehicles()
        ymm = loader.ymm_groups()
        evidence = loader.field_evidence()
        multi_ymm = {k: v for k, v in ymm.items() if len(v) >= 3}
        print(f"\n{'=' * 40}")
        print(f"Vehicles with rich data: {len(vehicles)}")
        print(f"Y/M/M groups: {len(ymm)}")
        print(f"Y/M/M groups with 3+ sales: {len(multi_ymm)}")
        print(f"Field evidence rows: {len(evidence)}")
        print(f"\nEstimated output (vehicle):")
        print(f"  Deep analysis: ~{min(len(vehicles), args.limit)} examples")
        print(f"  Comparables: ~{min(len(multi_ymm), args.limit)} examples")
        print(f"  Modification: ~{min(len(evidence) // 3, args.limit)} examples")
        print(f"  Condition: ~{min(len(vehicles), args.limit)} examples")
        print(f"  Upgrade: ~{min(len(multi_ymm), args.limit)} examples")
        print(f"  Comments: ~{min(1000, args.limit)} examples (requires comment fetch)")
        print(f"  Platform: ~20 examples")
        if operational_generators:
            print(f"\nEstimated output (operational):")
            print(f"  Tool routing: ~{min(len(tools_entries) * 5, args.limit)} examples")
            print(f"  Pipeline ownership: ~{min(len(registry) * 5, args.limit)} examples")
            print(f"  Data quality diagnosis: ~{min(3000, args.limit)} examples")
            print(f"  System rules: ~{min(len(hard_rules) * 100, args.limit)} examples")
            print(f"  Incident response: ~{min(len([e for e in done_entries if e.is_incident]) * 5, args.limit)} examples")
            print(f"  Session patterns: ~{min(len(exchanges), args.limit)} examples")
            print(f"  Data completeness: ~{min(2000, args.limit)} examples")
        return

    if args.operational_only:
        run_generators = operational_generators
    elif args.category == "all":
        run_generators = dict(generators)
        if args.operational or operational_generators:
            run_generators.update(operational_generators)
    elif args.category in generators:
        run_generators = {args.category: generators[args.category]}
    elif args.category in operational_generators:
        run_generators = {args.category: operational_generators[args.category]}
    else:
        print(f"Unknown category: {args.category}")
        return

    for cat_key, (cat_name, gen_fn) in run_generators.items():
        print(f"\n[{cat_key}] Generating {cat_name}...")
        try:
            pairs = gen_fn()
            print(f"  Generated: {len(pairs)} examples")
            all_pairs.extend(pairs)
        except Exception as e:
            print(f"  ERROR in {cat_key}: {e}")
            import traceback
            traceback.print_exc()

    if not all_pairs:
        print("\nNo pairs generated!")
        return

    # Sample mode: print examples for review
    if args.sample > 0:
        cats = Counter(p.get("category", "unknown") for p in all_pairs)
        for cat in sorted(cats.keys()):
            cat_pairs = [p for p in all_pairs if p.get("category") == cat]
            print(f"\n{'='*60}")
            print(f"SAMPLE: {cat} ({len(cat_pairs)} total)")
            print(f"{'='*60}")
            for p in random.sample(cat_pairs, min(args.sample, len(cat_pairs))):
                print(f"\nUSER: {p['messages'][1]['content'][:200]}")
                print(f"ASSISTANT: {p['messages'][2]['content'][:300]}...")
        return

    # Shuffle and split
    random.shuffle(all_pairs)
    split_idx = int(len(all_pairs) * 0.95)
    train_pairs = all_pairs[:split_idx]
    val_pairs = all_pairs[split_idx:]

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    train_path = output_dir / "train.jsonl"
    val_path = output_dir / "val.jsonl"

    with open(train_path, "w") as f:
        for pair in train_pairs:
            f.write(json.dumps(pair) + "\n")

    with open(val_path, "w") as f:
        for pair in val_pairs:
            f.write(json.dumps(pair) + "\n")

    # Stats
    categories = Counter(p.get("category", "unknown") for p in all_pairs)
    avg_len = sum(len(p["messages"][-1]["content"]) for p in all_pairs) / len(all_pairs)
    short = sum(1 for p in all_pairs if len(p["messages"][-1]["content"]) < 200)

    print(f"\n{'=' * 60}")
    print("GENERATION COMPLETE")
    print(f"{'=' * 60}")
    print(f"Total pairs: {len(all_pairs)}")
    print(f"Train: {len(train_pairs)} ({train_path})")
    print(f"Val: {len(val_pairs)} ({val_path})")
    print(f"Average response length: {avg_len:.0f} chars")
    print(f"Short responses (<200 chars): {short} ({100*short/len(all_pairs):.1f}%)")
    print(f"\nBy category:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        cat_pairs = [p for p in all_pairs if p.get("category") == cat]
        cat_avg = sum(len(p["messages"][-1]["content"]) for p in cat_pairs) / len(cat_pairs)
        print(f"  {cat}: {count} examples (avg {cat_avg:.0f} chars)")
    print(f"\nFile sizes:")
    print(f"  train.jsonl: {train_path.stat().st_size / 1024 / 1024:.1f} MB")
    print(f"  val.jsonl: {val_path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
