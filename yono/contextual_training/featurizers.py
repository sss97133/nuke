#!/usr/bin/env python3
"""
Y/M/M Profile Featurizers

Converts structured Y/M/M knowledge profiles into fixed-size float vectors
for direct model input. Zero API calls — pure numerical encoding.

Three featurizers:
  1. featurize_ymm_profile()    — ~200D from Y/M/M knowledge profile
  2. featurize_vehicle_instance() — 20D from individual vehicle metadata
  3. featurize_user_timeline()   — 10D from photo-taking patterns

Combined context: ~230D → concatenated with EfficientNet-B0 image features (1280D)
→ fed through context encoder → multi-task prediction heads.
"""

import math
import numpy as np
from datetime import datetime, timedelta
from typing import Optional

# ─── Zone taxonomy (matches train_zone_classifier.py) ────────────────────────

ALL_ZONES = [
    "ext_front", "ext_front_driver", "ext_front_passenger",
    "ext_driver_side", "ext_passenger_side",
    "ext_rear", "ext_rear_driver", "ext_rear_passenger",
    "ext_roof", "ext_undercarriage",
    "panel_hood", "panel_trunk",
    "panel_door_fl", "panel_door_fr", "panel_door_rl", "panel_door_rr",
    "panel_fender_fl", "panel_fender_fr", "panel_fender_rl", "panel_fender_rr",
    "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr",
    "int_dashboard", "int_front_seats", "int_rear_seats", "int_cargo",
    "int_headliner",
    "int_door_panel_fl", "int_door_panel_fr", "int_door_panel_rl", "int_door_panel_rr",
    "mech_engine_bay", "mech_transmission", "mech_suspension",
    "detail_vin", "detail_badge", "detail_damage", "detail_odometer",
    "other",
]
N_ZONES = len(ALL_ZONES)  # 39

# ─── Damage/mod flags (matches yono_vision_v2_config.json) ───────────────────

DAMAGE_FLAGS = [
    "rust", "dent", "crack", "paint_fade",
    "broken_glass", "missing_parts", "accident_damage",
]
N_DAMAGE = len(DAMAGE_FLAGS)  # 7

MOD_FLAGS = [
    "lift_kit", "lowered", "aftermarket_wheels", "roll_cage",
    "engine_swap", "body_kit", "exhaust_mod", "suspension_mod",
]
N_MODS = len(MOD_FLAGS)  # 8

# ─── Modification categories from build_ymm_knowledge.py ─────────────────────

COMMON_MOD_TYPES = [
    "engine_swap", "transmission", "lift_kit", "lowered",
    "wheels", "exhaust", "transfer_case", "axle",
    "fuel_injection", "air_conditioning", "body_work", "interior",
]
N_MOD_TYPES = len(COMMON_MOD_TYPES)  # 12

# ─── Engine family classification ────────────────────────────────────────────

ENGINE_FAMILIES = [
    "v8_small",    # SBC 283/302/305/327/350/383
    "v8_big",      # BBC 396/402/427/454/502
    "v8_ls",       # LS1/LS2/LS3/LSx
    "v8_other",    # Other V8s (Ford, Mopar, etc.)
    "v6",
    "i6",          # Inline 6 (Jeep 4.0, etc.)
    "i4",
    "diesel",
    "other",
    "unknown",
]
N_ENGINE_FAMILIES = len(ENGINE_FAMILIES)  # 10

# ─── Drivetrain classification ────────────────────────────────────────────────

DRIVETRAIN_TYPES = ["4WD", "AWD", "RWD", "FWD", "unknown"]
N_DRIVETRAINS = len(DRIVETRAIN_TYPES)  # 5

# ─── Transmission classification ─────────────────────────────────────────────

TRANSMISSION_TYPES = ["automatic", "manual", "other", "unknown"]
N_TRANSMISSIONS = len(TRANSMISSION_TYPES)  # 4


# ═══════════════════════════════════════════════════════════════════════════════
# Utility functions
# ═══════════════════════════════════════════════════════════════════════════════

def _normalize(value: float, max_val: float) -> float:
    """Normalize to [0, 1] with cap."""
    if value is None or max_val <= 0:
        return 0.0
    return min(1.0, max(0.0, float(value) / max_val))


def _log_normalize(value: float, max_val: float = 1e6) -> float:
    """Log-normalize to [0, 1] for prices/counts with large ranges."""
    if value is None or value <= 0:
        return 0.0
    return min(1.0, math.log1p(float(value)) / math.log1p(max_val))


def _one_hot(value: str, categories: list[str]) -> list[float]:
    """One-hot encode a categorical value."""
    result = [0.0] * len(categories)
    if value:
        val_lower = value.lower().strip()
        for i, cat in enumerate(categories):
            if cat.lower() == val_lower:
                result[i] = 1.0
                return result
    # Default to last category ("unknown" or "other")
    result[-1] = 1.0
    return result


def _classify_engine(engine_str: Optional[str]) -> str:
    """Classify an engine string into a family."""
    if not engine_str:
        return "unknown"

    e = engine_str.lower()

    # LS family
    if any(x in e for x in ["ls1", "ls2", "ls3", "ls6", "ls7", "lsx", "ls ", "4.8l ls", "5.3l ls", "6.0l ls", "6.2l ls"]):
        return "v8_ls"

    # Diesel
    if any(x in e for x in ["diesel", "duramax", "cummins", "powerstroke", "6.2l diesel", "6.5l"]):
        return "diesel"

    # Big block V8
    if any(x in e for x in ["396", "402", "427", "454", "502", "big block", "bbc"]):
        return "v8_big"

    # Small block V8
    if any(x in e for x in [
        "283", "302", "305", "307", "327", "350", "355", "383",
        "small block", "sbc", "5.0l", "5.7l v-8", "5.7l v8",
        "4bbl", "v-8", "v8",
    ]):
        return "v8_small"

    # V6
    if any(x in e for x in ["v6", "v-6", "3.8", "4.3"]):
        return "v6"

    # Inline 6
    if any(x in e for x in ["i6", "inline 6", "inline-6", "4.0l", "3.8l i", "straight 6", "250"]):
        return "i6"

    # I4
    if any(x in e for x in ["i4", "4-cyl", "4 cyl", "1.8", "2.0l", "2.4"]):
        return "i4"

    return "other"


def _classify_drivetrain(dt_str: Optional[str]) -> str:
    """Classify drivetrain string."""
    if not dt_str:
        return "unknown"
    d = dt_str.upper().strip()
    if d in ("4WD", "4X4"):
        return "4WD"
    if d in ("AWD", "ALL-WHEEL", "ALL WHEEL"):
        return "AWD"
    if d in ("RWD", "REAR-WHEEL", "REAR WHEEL"):
        return "RWD"
    if d in ("FWD", "FRONT-WHEEL", "FRONT WHEEL"):
        return "FWD"
    return "unknown"


def _classify_transmission(tx_str: Optional[str]) -> str:
    """Classify transmission string."""
    if not tx_str:
        return "unknown"
    t = tx_str.lower().strip()
    if any(x in t for x in ["auto", "th350", "th400", "700r4", "4l60", "4l80"]):
        return "automatic"
    if any(x in t for x in ["manual", "speed", "sm465", "nv4500", "t56", "muncie", "stick"]):
        return "manual"
    return "other"


# ═══════════════════════════════════════════════════════════════════════════════
# Main featurizers
# ═══════════════════════════════════════════════════════════════════════════════

def featurize_ymm_profile(profile: dict) -> np.ndarray:
    """
    Convert a Y/M/M knowledge profile JSON to a fixed-size float vector.

    Input: profile dict from ymm_knowledge.profile column
    Output: numpy float32 array, ~200 dimensions

    Dimension breakdown:
      - Year normalized:           1D
      - Engine family one-hot:    10D
      - Drivetrain one-hot:        5D
      - Transmission one-hot:      4D
      - Market signals:           10D
      - Zone damage frequency:    39D (one per zone, max damage across types)
      - Damage flag prevalence:    7D
      - Mod flag prevalence:       8D
      - Comment mod categories:   12D
      - Data richness:             5D
      - Price spread + colors:     2D (included in market signals block)
      ─────────────────────────────
      Total:                     103D (compact but information-dense)
    """
    features = []

    year = profile.get("year", 1970)
    factory = profile.get("factory_specs", {})
    market = profile.get("market", {})
    zone_dmg = profile.get("zone_damage_frequency", {})
    dmg_totals = profile.get("damage_flag_totals", {})
    mod_totals = profile.get("modification_flag_totals", {})
    mod_mentions = profile.get("common_mods_mentioned", {})

    # ── Year (1D) ─────────────────────────────────────────────────────────
    features.append(_normalize(year - 1900, 130.0))

    # ── Engine family one-hot (10D) ───────────────────────────────────────
    engine = factory.get("typical_engine", "")
    engine_family = _classify_engine(engine)
    features.extend(_one_hot(engine_family, ENGINE_FAMILIES))

    # ── Drivetrain one-hot (5D) ───────────────────────────────────────────
    drivetrain = factory.get("typical_drivetrain", "")
    features.extend(_one_hot(_classify_drivetrain(drivetrain), DRIVETRAIN_TYPES))

    # ── Transmission one-hot (4D) ─────────────────────────────────────────
    transmission = factory.get("typical_transmission", "")
    features.extend(_one_hot(_classify_transmission(transmission), TRANSMISSION_TYPES))

    # ── Market signals (10D) ──────────────────────────────────────────────
    features.append(_log_normalize(market.get("avg_sale_price"), 2e6))
    features.append(_log_normalize(market.get("median_sale_price"), 2e6))
    features.append(_log_normalize(market.get("min_sale_price"), 2e6))
    features.append(_log_normalize(market.get("max_sale_price"), 2e6))
    features.append(_normalize(market.get("sales_tracked", 0), 500))
    features.append(_normalize(market.get("avg_mileage", 0), 300000))
    features.append(_normalize(market.get("avg_bids", 0), 200))
    features.append(_normalize(market.get("avg_views", 0), 100000))
    # Price spread ratio (max/min, normalized)
    min_p = market.get("min_sale_price") or 1
    max_p = market.get("max_sale_price") or 1
    features.append(_normalize(max_p / max(min_p, 1), 50))
    # Number of color options (proxy for production volume / variety)
    features.append(_normalize(len(factory.get("color_options", [])), 30))

    # ── Zone damage frequency (39D) ───────────────────────────────────────
    # One float per zone: max damage frequency across all damage types
    for zone in ALL_ZONES:
        zone_data = zone_dmg.get(zone, {})
        if zone_data:
            features.append(max(float(v) for v in zone_data.values()))
        else:
            features.append(0.0)

    # ── Damage flag prevalence (7D) ───────────────────────────────────────
    total_damage_obs = max(sum(dmg_totals.values()), 1) if dmg_totals else 1
    for flag in DAMAGE_FLAGS:
        features.append(_normalize(dmg_totals.get(flag, 0), total_damage_obs))

    # ── Mod flag prevalence (8D) ──────────────────────────────────────────
    total_mod_obs = max(sum(mod_totals.values()), 1) if mod_totals else 1
    for flag in MOD_FLAGS:
        features.append(_normalize(mod_totals.get(flag, 0), total_mod_obs))

    # ── Comment mod categories (12D) ──────────────────────────────────────
    for mod_type in COMMON_MOD_TYPES:
        mod_data = mod_mentions.get(mod_type, [])
        # Encode as: has_mentions (0/1) * variety (num unique terms normalized)
        if mod_data:
            features.append(min(1.0, len(mod_data) / 10.0))
        else:
            features.append(0.0)

    # ── Data richness (5D) ────────────────────────────────────────────────
    features.append(_normalize(profile.get("vehicle_count", 0), 1000))
    features.append(_normalize(profile.get("source_comment_count", 0), 1000))
    features.append(_normalize(profile.get("source_image_count", 0), 10000))
    features.append(_normalize(len(profile.get("key_claims", [])), 100))
    features.append(_normalize(len(profile.get("expert_quotes", [])), 50))

    vec = np.array(features, dtype=np.float32)
    assert vec.shape == (FEATURE_DIM_YMM,), f"Expected {FEATURE_DIM_YMM}D, got {vec.shape[0]}D"
    return vec


def featurize_vehicle_instance(vehicle_row: dict) -> np.ndarray:
    """
    Encode vehicle-specific fields for a single vehicle instance.

    Input: dict with keys from vehicles table (year, mileage, color, etc.)
    Output: numpy float32 array, 20 dimensions
    """
    features = []

    # Mileage (2D: normalized + log-normalized)
    mileage = vehicle_row.get("mileage") or 0
    features.append(_normalize(mileage, 300000))
    features.append(_log_normalize(mileage, 500000))

    # Sale price (2D: log-normalized + price tier one-hot collapsed)
    price = vehicle_row.get("sale_price") or 0
    features.append(_log_normalize(price, 2e6))
    # Simple tier: budget/entry/mid/high/elite
    if price >= 500000:
        features.append(1.0)
    elif price >= 100000:
        features.append(0.75)
    elif price >= 50000:
        features.append(0.5)
    elif price >= 10000:
        features.append(0.25)
    else:
        features.append(0.0)

    # Engagement signals (4D)
    features.append(_normalize(vehicle_row.get("bid_count", 0), 200))
    features.append(_normalize(vehicle_row.get("view_count", 0), 100000))
    features.append(_normalize(vehicle_row.get("comment_count", 0), 1000))
    features.append(_log_normalize(vehicle_row.get("comment_count", 0), 5000))

    # Metadata presence flags (6D)
    features.append(1.0 if vehicle_row.get("vin") else 0.0)
    features.append(1.0 if vehicle_row.get("color") else 0.0)
    features.append(1.0 if vehicle_row.get("transmission") else 0.0)
    features.append(1.0 if vehicle_row.get("engine_type") else 0.0)
    features.append(1.0 if vehicle_row.get("mileage") else 0.0)
    features.append(1.0 if vehicle_row.get("drivetrain") else 0.0)

    # Condition rating (2D)
    cond = vehicle_row.get("condition_rating")
    features.append(_normalize(cond, 5.0) if cond else 0.5)
    features.append(1.0 if cond else 0.0)  # has_condition flag

    # Year delta from Y/M/M typical (2D)
    # If vehicle year differs from the Y/M/M group, encode the delta
    year = vehicle_row.get("year") or 0
    ymm_year = vehicle_row.get("_ymm_year") or year
    features.append(_normalize(abs(year - ymm_year), 20))
    features.append(1.0 if year == ymm_year else 0.0)

    # Pad to exactly 20D
    while len(features) < 20:
        features.append(0.0)

    vec = np.array(features[:20], dtype=np.float32)
    assert vec.shape == (FEATURE_DIM_VEHICLE,), f"Expected {FEATURE_DIM_VEHICLE}D, got {vec.shape[0]}D"
    return vec


def featurize_user_timeline(
    photo_timestamps: list[datetime],
    current_idx: int = 0,
) -> np.ndarray:
    """
    Encode the user's photo-taking pattern up to the current image.

    This gives the model context about the owner's documentation habits:
    - Are they doing a quick overview or detailed inspection?
    - How long have they been tracking this vehicle?
    - Is this a burst (multiple photos same day)?

    Input: list of datetime timestamps, current photo index
    Output: numpy float32 array, 10 dimensions
    """
    features = []

    if not photo_timestamps or len(photo_timestamps) == 0:
        return np.zeros(FEATURE_DIM_TIMELINE, dtype=np.float32)

    # Sort timestamps
    ts = sorted(photo_timestamps)
    n = len(ts)
    current_idx = min(current_idx, n - 1)
    current_ts = ts[current_idx]

    # Days since first photo (1D)
    span_days = max(0, (current_ts - ts[0]).total_seconds() / 86400)
    features.append(_normalize(span_days, 365 * 5))  # cap at 5 years

    # Days since previous photo (1D)
    if current_idx > 0:
        gap = (current_ts - ts[current_idx - 1]).total_seconds() / 86400
        features.append(_normalize(gap, 365))
    else:
        features.append(0.0)

    # Photo sequence position (1D): where in the timeline
    features.append(current_idx / max(n - 1, 1))

    # Total photos normalized (1D)
    features.append(_normalize(n, 1000))

    # Photos in last 7 days (1D)
    week_ago = current_ts - timedelta(days=7)
    recent_7 = sum(1 for t in ts[:current_idx + 1] if t >= week_ago)
    features.append(_normalize(recent_7, 50))

    # Photos in last 30 days (1D)
    month_ago = current_ts - timedelta(days=30)
    recent_30 = sum(1 for t in ts[:current_idx + 1] if t >= month_ago)
    features.append(_normalize(recent_30, 200))

    # Is burst — multiple photos same day (1D)
    same_day = sum(1 for t in ts if t.date() == current_ts.date())
    features.append(min(1.0, same_day / 20.0))

    # Day of week — cyclical encoding (2D: sin + cos)
    dow = current_ts.weekday()  # 0=Monday
    features.append(math.sin(2 * math.pi * dow / 7))
    features.append(math.cos(2 * math.pi * dow / 7))

    # Hour of day — cyclical (1D: sin only, saves a dimension)
    hour = current_ts.hour + current_ts.minute / 60.0
    features.append(math.sin(2 * math.pi * hour / 24))

    vec = np.array(features[:FEATURE_DIM_TIMELINE], dtype=np.float32)
    assert vec.shape == (FEATURE_DIM_TIMELINE,), f"Expected {FEATURE_DIM_TIMELINE}D, got {vec.shape[0]}D"
    return vec


def default_ymm_profile() -> dict:
    """Return a zeroed-out default profile for unknown Y/M/M."""
    return {
        "ymm_key": "unknown",
        "year": 1970,
        "make": "Unknown",
        "model": "Unknown",
        "vehicle_count": 0,
        "factory_specs": {},
        "market": {},
        "zone_damage_frequency": {},
        "damage_flag_totals": {},
        "modification_flag_totals": {},
        "common_mods_mentioned": {},
        "key_claims": [],
        "expert_quotes": [],
        "source_comment_count": 0,
        "source_image_count": 0,
    }


# ─── Dimension constants (exported for model architecture) ────────────────────

FEATURE_DIM_YMM = 103       # featurize_ymm_profile output
FEATURE_DIM_VEHICLE = 20    # featurize_vehicle_instance output
FEATURE_DIM_TIMELINE = 10   # featurize_user_timeline output
FEATURE_DIM_TOTAL = FEATURE_DIM_YMM + FEATURE_DIM_VEHICLE + FEATURE_DIM_TIMELINE  # 133


# ─── Self-test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Test with the K10 profile from DB
    import json

    print("Featurizer self-test")
    print(f"  YMM dim:      {FEATURE_DIM_YMM}")
    print(f"  Vehicle dim:  {FEATURE_DIM_VEHICLE}")
    print(f"  Timeline dim: {FEATURE_DIM_TIMELINE}")
    print(f"  Total dim:    {FEATURE_DIM_TOTAL}")

    # Test with default (unknown) profile
    default = default_ymm_profile()
    vec = featurize_ymm_profile(default)
    print(f"\nDefault profile → {vec.shape}, sum={vec.sum():.2f}, "
          f"min={vec.min():.3f}, max={vec.max():.3f}")

    # Test with a sample K10-like profile
    k10_profile = {
        "year": 1972,
        "make": "Chevrolet",
        "model": "K10",
        "vehicle_count": 34,
        "factory_specs": {
            "typical_engine": "350",
            "typical_transmission": "Automatic",
            "typical_drivetrain": "4WD",
            "engine_options": ["350 CI", "400 CI V-8"],
            "color_options": ["Red", "Blue", "White", "Green", "Yellow"],
        },
        "market": {
            "avg_sale_price": 70134,
            "median_sale_price": 70400,
            "min_sale_price": 13200,
            "max_sale_price": 117700,
            "sales_tracked": 28,
            "avg_mileage": 31324,
        },
        "zone_damage_frequency": {
            "panel_fender_rl": {"rust": 0.65, "paint_fade": 0.4},
            "ext_undercarriage": {"rust": 0.71},
        },
        "damage_flag_totals": {"rust": 50, "paint_fade": 30, "dent": 5},
        "modification_flag_totals": {"lift_kit": 10, "aftermarket_wheels": 8},
        "common_mods_mentioned": {
            "engine_swap": ["350", "LS", "400"],
            "transmission": ["TH350"],
            "lift_kit": ["4-inch"],
        },
        "key_claims": ["Original 350 V8", "Colonial Yellow paint"],
        "expert_quotes": ["Cowl seam rust is the main flaw with these trucks."],
        "source_comment_count": 160,
        "source_image_count": 0,
    }

    k10_vec = featurize_ymm_profile(k10_profile)
    print(f"\nK10 profile   → {k10_vec.shape}, sum={k10_vec.sum():.2f}, "
          f"min={k10_vec.min():.3f}, max={k10_vec.max():.3f}")

    # Test with a very different vehicle (Porsche 911)
    p911_profile = {
        "year": 2020,
        "make": "Porsche",
        "model": "911",
        "vehicle_count": 200,
        "factory_specs": {
            "typical_engine": "3.0L Twin-Turbo Flat-6",
            "typical_transmission": "Automatic",
            "typical_drivetrain": "RWD",
            "engine_options": ["3.0L Twin-Turbo"],
            "color_options": ["White", "Black", "Silver", "Red", "Blue",
                              "Yellow", "Green", "Grey", "Orange"],
        },
        "market": {
            "avg_sale_price": 145000,
            "median_sale_price": 130000,
            "min_sale_price": 75000,
            "max_sale_price": 350000,
            "sales_tracked": 180,
            "avg_mileage": 12000,
        },
        "zone_damage_frequency": {},
        "damage_flag_totals": {"paint_fade": 2},
        "modification_flag_totals": {},
        "common_mods_mentioned": {"exhaust": ["Akrapovic"]},
        "key_claims": ["PDK transmission"],
        "expert_quotes": [],
        "source_comment_count": 500,
        "source_image_count": 100,
    }

    p911_vec = featurize_ymm_profile(p911_profile)
    print(f"\n911 profile   → {p911_vec.shape}, sum={p911_vec.sum():.2f}, "
          f"min={p911_vec.min():.3f}, max={p911_vec.max():.3f}")

    # Cosine similarity between K10 and 911
    dot = np.dot(k10_vec, p911_vec)
    norm_k10 = np.linalg.norm(k10_vec)
    norm_911 = np.linalg.norm(p911_vec)
    cos_sim = dot / (norm_k10 * norm_911) if (norm_k10 > 0 and norm_911 > 0) else 0
    print(f"\nK10 vs 911 cosine similarity: {cos_sim:.3f}")
    print(f"  (should be < 0.5 — these are very different vehicles)")

    # Test vehicle instance featurizer
    vehicle = {"year": 1972, "mileage": 45000, "sale_price": 65000,
               "bid_count": 45, "view_count": 12000, "comment_count": 200,
               "vin": "1234", "color": "Red", "transmission": "Automatic",
               "_ymm_year": 1972}
    v_vec = featurize_vehicle_instance(vehicle)
    print(f"\nVehicle instance → {v_vec.shape}, sum={v_vec.sum():.2f}")

    # Test timeline featurizer
    now = datetime.now()
    timestamps = [now - timedelta(days=i) for i in range(30, 0, -1)]
    t_vec = featurize_user_timeline(timestamps, current_idx=15)
    print(f"User timeline    → {t_vec.shape}, sum={t_vec.sum():.2f}")

    # Full combined vector
    full = np.concatenate([k10_vec, v_vec, t_vec])
    print(f"\nFull context vector: {full.shape} ({FEATURE_DIM_TOTAL}D)")
    print("Self-test PASSED")
