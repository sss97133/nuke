#!/usr/bin/env python3
"""
Vehicle Defaults Derivation — Fill sparse fields using model name inference.

Derives three fields from make/model/year/title when missing:
  1. body_style  — from model name keywords and known model mappings
  2. fuel_type   — from known electric/hybrid/diesel vehicle lists
  3. drivetrain  — from known make/model drivetrain defaults

Uses COALESCE to only fill empty fields (never overwrites existing data).

Usage:
  python3 scripts/derive-vehicle-defaults.py [--limit 500000] [--dry-run]
"""
import sys
import re
import time
import argparse

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2
    from psycopg2.extras import execute_batch

DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

# ─────────────────────────────────────────────────────────────────────────────
# BODY STYLE INFERENCE
# ─────────────────────────────────────────────────────────────────────────────

# Priority-ordered keyword patterns for body style detection.
# Earlier entries win when multiple match.
BODY_STYLE_KEYWORDS = [
    # Very specific first
    (r'\bshooting\s*brake\b', 'Wagon'),
    (r'\btarga\b', 'Targa'),
    (r'\bspeedster\b', 'Convertible'),
    (r'\bspyder\b', 'Convertible'),
    (r'\bspider\b', 'Convertible'),
    (r'\bcabriolet\b', 'Convertible'),
    (r'\broadster\b', 'Roadster'),
    (r'\bconvertible\b', 'Convertible'),
    (r'\bfastback\b', 'Fastback'),
    (r'\bliftback\b', 'Hatchback'),
    (r'\bhatchback\b', 'Hatchback'),
    (r'\bcoupe\b', 'Coupe'),
    (r'\bcoupé\b', 'Coupe'),
    (r'\bsedan\b', 'Sedan'),
    (r'\bsaloon\b', 'Sedan'),
    (r'\bwagon\b', 'Wagon'),
    (r'\bestate\b', 'Wagon'),
    (r'\btouring\b', 'Wagon'),          # BMW Touring = wagon
    (r'\bavant\b', 'Wagon'),            # Audi Avant = wagon
    (r'\bsportback\b', 'Hatchback'),    # Audi Sportback
    (r'\bcrossover\b', 'SUV'),
    (r'\bsuv\b', 'SUV'),
    (r'\bminivan\b', 'Van'),
    (r'\bvan\b', 'Van'),
    (r'\bpickup\b', 'Truck'),
    (r'\btruck\b', 'Truck'),
    (r'\bflatbed\b', 'Truck'),
    (r'\bcab\b(?:\s+(?:and|&)\s+chassis)?', 'Truck'),
    (r'\bhardtop\b', 'Coupe'),          # Hardtop is usually coupe-like
]

# Model-specific body style overrides: (make_pattern, model_pattern) -> body_style
# These override keyword detection when matched.
MODEL_BODY_STYLE = [
    # Trucks by model name
    (None, r'\bF-?150\b', 'Truck'),
    (None, r'\bF-?250\b', 'Truck'),
    (None, r'\bF-?350\b', 'Truck'),
    (None, r'\bF-?100\b', 'Truck'),
    (None, r'\bSilverado\b', 'Truck'),
    (None, r'\bSierra\b', 'Truck'),
    (None, r'\bRam\s*\d', 'Truck'),
    (None, r'\bTundra\b', 'Truck'),
    (None, r'\bTacoma\b', 'Truck'),
    (None, r'\bFrontier\b', 'Truck'),
    (None, r'\bTitan\b', 'Truck'),
    (None, r'\bRanger\b', 'Truck'),
    (None, r'\bColorado\b', 'Truck'),
    (None, r'\bCanyon\b', 'Truck'),
    (None, r'\bRidgeline\b', 'Truck'),
    (None, r'\bGladiator\b', 'Truck'),
    (None, r'\bC-?10\b', 'Truck'),
    (None, r'\bC-?20\b', 'Truck'),
    (None, r'\bC-?30\b', 'Truck'),
    (None, r'\bK-?10\b', 'Truck'),
    (None, r'\bK-?20\b', 'Truck'),
    (None, r'\bK-?5\b', 'Truck'),
    (None, r'\bS-?10\b', 'Truck'),
    (None, r'\bEl\s*Camino\b', 'Truck'),
    (None, r'\bRanchero\b', 'Truck'),

    # SUVs by model name
    (None, r'\bWrangler\b', 'SUV'),
    (None, r'\bCherokee\b', 'SUV'),
    (None, r'\bGrand\s+Cherokee\b', 'SUV'),
    (None, r'\bBronco\b', 'SUV'),
    (None, r'\b4Runner\b', 'SUV'),
    (None, r'\bLand\s*Cruiser\b', 'SUV'),
    (None, r'\bTahoe\b', 'SUV'),
    (None, r'\bSuburban\b', 'SUV'),
    (None, r'\bYukon\b', 'SUV'),
    (None, r'\bExplorer\b', 'SUV'),
    (None, r'\bExpedition\b', 'SUV'),
    (None, r'\bEscalade\b', 'SUV'),
    (None, r'\bBlazer\b', 'SUV'),
    (None, r'\bTrailBlazer\b', 'SUV'),
    (None, r'\bPathfinder\b', 'SUV'),
    (None, r'\bXterra\b', 'SUV'),
    (None, r'\bPilot\b', 'SUV'),
    (None, r'\bCR-?V\b', 'SUV'),
    (None, r'\bRAV-?4\b', 'SUV'),
    (None, r'\bHighlander\b', 'SUV'),
    (None, r'\bSequoia\b', 'SUV'),
    (None, r'\bArmada\b', 'SUV'),
    (None, r'\bDefender\b', 'SUV'),
    (None, r'\bDiscovery\b', 'SUV'),
    (None, r'\bRange\s*Rover\b', 'SUV'),
    (None, r'\bCayenne\b', 'SUV'),
    (None, r'\bMacan\b', 'SUV'),
    (None, r'\bX[1-7]\b', 'SUV'),       # BMW X series
    (None, r'\bQ[357]\b', 'SUV'),       # Audi Q series
    (None, r'\bGLC?\b', 'SUV'),         # Mercedes GL/GLC/GLE/GLS
    (None, r'\bGL[ABCES]\b', 'SUV'),
    (None, r'\bTouareg\b', 'SUV'),
    (None, r'\bSanta\s*Fe\b', 'SUV'),
    (None, r'\bTucson\b', 'SUV'),
    (None, r'\bSorento\b', 'SUV'),
    (None, r'\bSportage\b', 'SUV'),
    (None, r'\bTelluride\b', 'SUV'),
    (None, r'\bPalisade\b', 'SUV'),
    (None, r'\bFJ\s*Cruiser\b', 'SUV'),
    (None, r'\bOutlander\b', 'SUV'),
    (None, r'\bForester\b', 'SUV'),
    (None, r'\bCrosstrek\b', 'SUV'),
    (None, r'\bOutback\b', 'Wagon'),
    (None, r'\bScout\b', 'SUV'),
    (None, r'\bJimny\b', 'SUV'),
    (None, r'\bSamurai\b', 'SUV'),
    (None, r'\bH[123]\b', 'SUV'),       # Hummer
    ('hummer', r'.*', 'SUV'),

    # Convertibles / Roadsters by model
    (None, r'\bMiata\b', 'Convertible'),
    (None, r'\bMX-?5\b', 'Convertible'),
    (None, r'\bBoxster\b', 'Convertible'),
    (None, r'\bS2000\b', 'Convertible'),
    (None, r'\bZ[34]\b.*\broadster\b', 'Roadster'),
    (None, r'\b(?:SLK|SLC)\b', 'Convertible'),

    # Specific coupe models
    (None, r'\bCorvette\b', 'Coupe'),
    (None, r'\bCamaro\b', 'Coupe'),
    (None, r'\bChallenger\b', 'Coupe'),
    (None, r'\bSupra\b', 'Coupe'),
    (None, r'\bGT-?R\b', 'Coupe'),
    (None, r'\b(?:350|370|300)Z\b', 'Coupe'),
    (None, r'\bRX-?[78]\b', 'Coupe'),
    (None, r'\bGT86\b', 'Coupe'),
    (None, r'\b86\b', 'Coupe'),
    (None, r'\bBRZ\b', 'Coupe'),
    (None, r'\bFR-?S\b', 'Coupe'),
    (None, r'\bCayman\b', 'Coupe'),

    # Vans
    (None, r'\bSienna\b', 'Van'),
    (None, r'\bOdyssey\b', 'Van'),
    (None, r'\bCaravan\b', 'Van'),
    (None, r'\bTransit\b', 'Van'),
    (None, r'\bSprinter\b', 'Van'),
    (None, r'\bEconoLine\b', 'Van'),
    (None, r'\bVanagon\b', 'Van'),
    (None, r'\bWestfalia\b', 'Van'),
    (None, r'\bVanagan\b', 'Van'),

    # Porsche 911 sub-models
    ('porsche', r'\b911\b.*\btarga\b', 'Targa'),
    ('porsche', r'\b911\b.*\bcabri|conv\b', 'Convertible'),
    ('porsche', r'\b911\b', 'Coupe'),

    # Sedans — common models
    (None, r'\bCivic\b(?!.*(?:hatch|si\s+hatch))', 'Sedan'),
    (None, r'\bAccord\b', 'Sedan'),
    (None, r'\bCamry\b', 'Sedan'),
    (None, r'\bCorolla\b(?!.*hatch)', 'Sedan'),
    (None, r'\b(?:3|5|7)\s*Series\b', 'Sedan'),  # BMW (default, overridden by touring/coupe/conv keywords)
    (None, r'\bC-?Class\b', 'Sedan'),
    (None, r'\bE-?Class\b', 'Sedan'),
    (None, r'\bS-?Class\b', 'Sedan'),
    (None, r'\bA[4-8]\b', 'Sedan'),              # Audi A4-A8
    (None, r'\bJetta\b', 'Sedan'),
    (None, r'\bPassat\b', 'Sedan'),
    (None, r'\bAltima\b', 'Sedan'),
    (None, r'\bMaxima\b', 'Sedan'),
    (None, r'\bCharger\b', 'Sedan'),
    (None, r'\bImpala\b', 'Sedan'),
    (None, r'\bMalibu\b', 'Sedan'),
    (None, r'\bES\s*\d', 'Sedan'),                # Lexus ES
    (None, r'\bIS\s*\d', 'Sedan'),                # Lexus IS
    (None, r'\bGS\s*\d', 'Sedan'),                # Lexus GS
    (None, r'\bLS\s*\d', 'Sedan'),                # Lexus LS

    # Hatchbacks
    (None, r'\bGolf\b', 'Hatchback'),
    (None, r'\bGTI\b', 'Hatchback'),
    (None, r'\bBeetle\b', 'Hatchback'),
    (None, r'\bBug\b', 'Hatchback'),
    (None, r'\bFit\b', 'Hatchback'),
    (None, r'\bFocus\b(?!.*sedan)', 'Hatchback'),
    (None, r'\bFiesta\b', 'Hatchback'),
    (None, r'\bVeloster\b', 'Hatchback'),
    (None, r'\bPrius\b', 'Hatchback'),
    (None, r'\bLeaf\b', 'Hatchback'),
    (None, r'\bi3\b', 'Hatchback'),

    # Wagons
    (None, r'\bV60\b', 'Wagon'),
    (None, r'\bV70\b', 'Wagon'),
    (None, r'\bV90\b', 'Wagon'),
    (None, r'\bAllroad\b', 'Wagon'),
    (None, r'\b(?:Station\s*Wagon|Sportswagon|SportWagen)\b', 'Wagon'),
]

# Compile model body style regexes for performance
_MODEL_BODY_COMPILED = []
for make_pat, model_pat, style in MODEL_BODY_STYLE:
    make_re = re.compile(make_pat, re.I) if make_pat else None
    model_re = re.compile(model_pat, re.I)
    _MODEL_BODY_COMPILED.append((make_re, model_re, style))

_KEYWORD_COMPILED = [(re.compile(pat, re.I), style) for pat, style in BODY_STYLE_KEYWORDS]


def infer_body_style(make, model, title):
    """Infer body style from make, model name, and listing title.

    Returns normalized body style string or None.
    """
    make_lower = (make or '').strip().lower()
    # Combine model + title for keyword search; model takes priority
    model_str = (model or '').strip()
    title_str = (title or '').strip()
    search_text = f"{model_str} {title_str}"

    if not search_text.strip():
        return None

    # Phase 1: Model-specific overrides (most precise)
    # Check model_str first, then title_str
    for make_re, model_re, style in _MODEL_BODY_COMPILED:
        if make_re and not make_re.search(make_lower):
            continue
        if model_re.search(model_str) or model_re.search(title_str):
            # But check if a more-specific keyword in the text overrides this default.
            # e.g., "Corvette Convertible" should be Convertible, not Coupe.
            override = _check_keyword_override(search_text, style)
            return override if override else style

    # Phase 2: Keyword scan across model + title
    for pat_re, style in _KEYWORD_COMPILED:
        if pat_re.search(search_text):
            return style

    return None


def _check_keyword_override(text, default_style):
    """Check if explicit body style keywords override the model default.

    For example, if model default is 'Coupe' but text says 'Convertible',
    return 'Convertible'.
    """
    # Only override with more-specific body style keywords
    override_keywords = [
        (r'\bconvertible\b', 'Convertible'),
        (r'\bcabriolet\b', 'Convertible'),
        (r'\broadster\b', 'Roadster'),
        (r'\bspyder\b', 'Convertible'),
        (r'\bspider\b', 'Convertible'),
        (r'\btarga\b', 'Targa'),
        (r'\bfastback\b', 'Fastback'),
        (r'\bwagon\b', 'Wagon'),
        (r'\bestate\b', 'Wagon'),
        (r'\btouring\b', 'Wagon'),
        (r'\bavant\b', 'Wagon'),
        (r'\bhatchback\b', 'Hatchback'),
        (r'\bsportback\b', 'Hatchback'),
        (r'\bsedan\b', 'Sedan'),
        (r'\bcoupe\b', 'Coupe'),
        (r'\bcoupé\b', 'Coupe'),
        (r'\bpickup\b', 'Truck'),
        (r'\btruck\b', 'Truck'),
        (r'\bsuv\b', 'SUV'),
        (r'\bvan\b', 'Van'),
    ]
    for pat, style in override_keywords:
        if style != default_style and re.search(pat, text, re.I):
            return style
    return None


# ─────────────────────────────────────────────────────────────────────────────
# FUEL TYPE INFERENCE
# ─────────────────────────────────────────────────────────────────────────────

# Pure electric makes — ALL models are electric
ELECTRIC_MAKES = {
    'tesla', 'rivian', 'lucid', 'polestar', 'fisker',
    'lordstown', 'canoo', 'faraday', 'faraday future',
    'nio', 'xpeng', 'byton', 'arrival',
}

# Pure electric models: (make_pattern, model_pattern)
ELECTRIC_MODELS = [
    ('nissan', r'\bLeaf\b'),
    ('chevrolet', r'\bBolt\b'),
    ('chevy', r'\bBolt\b'),
    ('bmw', r'\bi3\b'),
    ('bmw', r'\bi4\b'),
    ('bmw', r'\biX\b'),
    ('bmw', r'\biX3\b'),
    ('ford', r'\bMustang\s+Mach[-\s]?E\b'),
    ('ford', r'\bF-?150\s+Lightning\b'),
    ('ford', r'\bLightning\b'),
    ('hyundai', r'\bIoniq\s*[56]\b'),
    ('hyundai', r'\bIoniq\s+Electric\b'),
    ('kia', r'\bEV[69]\b'),
    ('kia', r'\bEV\d\b'),
    ('porsche', r'\bTaycan\b'),
    ('audi', r'\be-?tron\b'),
    ('audi', r'\bQ4\s+e-?tron\b'),
    ('mercedes', r'\bEQ[ABCES]\b'),
    ('mercedes-benz', r'\bEQ[ABCES]\b'),
    ('volkswagen', r'\bID\.\d\b'),
    ('volkswagen', r'\bID\s+\d\b'),
    ('vw', r'\bID\.\d\b'),
    ('jaguar', r'\bI-?PACE\b'),
    ('volvo', r'\bXC40\s+Recharge\b'),
    ('volvo', r'\bC40\b'),
    ('mini', r'\bCooper\s+SE\b'),
    ('genesis', r'\bGV60\b'),
    ('cadillac', r'\bLyriq\b'),
    ('gmc', r'\bHummer\s+EV\b'),
    ('chevrolet', r'\bEquinox\s+EV\b'),
    ('honda', r'\bPrologue\b'),
    ('toyota', r'\bbZ4X\b'),
    ('subaru', r'\bSolterra\b'),
    ('mazda', r'\bMX-?30\b'),
    ('fiat', r'\b500e\b'),
    ('smart', r'.*'),  # All Smart cars (modern) are electric
]

# Hybrid models: (make_pattern, model_pattern, optional_year_range)
HYBRID_MODELS = [
    ('toyota', r'\bPrius\b', None),
    ('toyota', r'\bRAV-?4\s+(?:Hybrid|Prime)\b', None),
    ('toyota', r'\bHighlander\s+Hybrid\b', None),
    ('toyota', r'\bCamry\s+Hybrid\b', None),
    ('toyota', r'\bCorolla\s+Hybrid\b', None),
    ('toyota', r'\bVenza\b', (2021, 2030)),  # 2021+ Venza is hybrid-only
    ('honda', r'\bInsight\b', None),
    ('honda', r'\bCR-?V\s+Hybrid\b', None),
    ('honda', r'\bAccord\s+Hybrid\b', None),
    ('lexus', r'\bRX\s*450h\b', None),
    ('lexus', r'\bNX\s*(?:350h|300h)\b', None),
    ('lexus', r'\bES\s*300h\b', None),
    ('lexus', r'\bLS\s*500h\b', None),
    ('lexus', r'\bLC\s*500h\b', None),
    ('lexus', r'\bUX\s*250h\b', None),
    ('bmw', r'\bi8\b', None),
    ('porsche', r'\bCayenne\s+(?:E-?Hybrid|S\s+E-?Hybrid)\b', None),
    ('porsche', r'\bPanamera\s+(?:E-?Hybrid|4\s+E-?Hybrid|S\s+E-?Hybrid)\b', None),
    ('acura', r'\bNSX\b', (2016, 2030)),
    ('mclaren', r'\bP1\b', None),
    ('mclaren', r'\bArtura\b', None),
    ('ferrari', r'\bSF90\b', None),
    ('ferrari', r'\b296\b', None),
    ('ferrari', r'\bLaFerrari\b', None),
    ('lamborghini', r'\bRevuelto\b', None),
    ('chevrolet', r'\bVolt\b', None),
    ('chevy', r'\bVolt\b', None),
    ('ford', r'\bEscape\s+(?:Hybrid|PHEV)\b', None),
    ('ford', r'\bFusion\s+(?:Hybrid|Energi)\b', None),
    ('ford', r'\bMaverick\s+Hybrid\b', None),
    ('hyundai', r'\bSonata\s+Hybrid\b', None),
    ('hyundai', r'\bTucson\s+Hybrid\b', None),
    ('kia', r'\bNiro\b', None),
    ('volvo', r'\bXC60\s+(?:Recharge|T8)\b', None),
    ('volvo', r'\bXC90\s+(?:Recharge|T8)\b', None),
    ('chrysler', r'\bPacifica\s+Hybrid\b', None),
    ('mitsubishi', r'\bOutlander\s+PHEV\b', None),
]

# Diesel patterns in model/engine text
DIESEL_MODEL_PATTERNS = [
    r'\bTDI\b',           # VW/Audi TDI
    r'\bCDI\b',           # Mercedes CDI
    r'\bdCi\b',           # Renault dCi
    r'\bHDi\b',           # Peugeot/Citroen HDi
    r'\bCRDi\b',          # Hyundai/Kia CRDi
    r'\bBlueTEC\b',       # Mercedes BlueTEC
    r'\bPower\s*Stroke\b',  # Ford Power Stroke
    r'\bDuramax\b',       # GM Duramax
    r'\bCummins\b',       # Cummins diesel
    r'\bTurbodiesel\b',
    r'\bTurbo\s*Diesel\b',
    r'\bDiesel\b',
]

_DIESEL_COMPILED = [re.compile(p, re.I) for p in DIESEL_MODEL_PATTERNS]


def infer_fuel_type(make, model, title, year, engine_size):
    """Infer fuel type from make/model/year.

    Returns normalized fuel type string or None.
    Matches existing DB conventions: 'Gasoline', 'Electric', 'Diesel', 'Hybrid'
    """
    make_lower = (make or '').strip().lower()
    model_str = (model or '').strip()
    title_str = (title or '').strip()
    engine_str = (engine_size or '').strip()
    search_text = f"{model_str} {title_str} {engine_str}"
    yr = year or 0

    # Check all-electric makes first
    if make_lower in ELECTRIC_MAKES:
        return 'Electric'

    # Check specific electric models
    for emake, epat in ELECTRIC_MODELS:
        if make_lower.startswith(emake) or emake in make_lower:
            if re.search(epat, search_text, re.I):
                return 'Electric'

    # Check hybrid models
    for hmake, hpat, year_range in HYBRID_MODELS:
        if make_lower.startswith(hmake) or hmake in make_lower:
            if re.search(hpat, search_text, re.I):
                if year_range is None or (year_range[0] <= yr <= year_range[1]):
                    return 'Hybrid'

    # Check diesel patterns across model + title + engine
    for dpat in _DIESEL_COMPILED:
        if dpat.search(search_text):
            return 'Diesel'

    # Also check make field itself (e.g., make = "Cummins-Powered")
    if make and re.search(r'\bcummins\b', make, re.I):
        return 'Diesel'

    # Default: we can't infer gasoline vs unknown, so return None
    # (Most vehicles are gasoline but we shouldn't assume without evidence)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# DRIVETRAIN INFERENCE
# ─────────────────────────────────────────────────────────────────────────────

# Always AWD makes (all or nearly all models)
AWD_MAKES = {
    'subaru',       # All Subaru except BRZ
}

# Model-specific drivetrain rules: (make_pattern, model_pattern, drivetrain, year_range, exclude_pattern)
DRIVETRAIN_RULES = [
    # ── RWD vehicles ──

    # BMW (pre-2010 non-xi models are RWD)
    ('bmw', r'\b(?:3|5|6|7)\s*Series\b', 'RWD', None, r'\b(?:xi|xDrive|iX)\b'),
    ('bmw', r'\bM[3456]\b', 'RWD', None, r'\b(?:xDrive|Competition\s+xDrive)\b'),
    ('bmw', r'\bZ[34]\b', 'RWD', None, None),

    # Porsche (base 911/Boxster/Cayman are RWD)
    ('porsche', r'\bBoxster\b', 'RWD', None, None),
    ('porsche', r'\bCayman\b', 'RWD', None, None),
    ('porsche', r'\b911\b', 'RWD', None, r'\b(?:4S|Carrera\s*4|Turbo|GT2)\b'),

    # Porsche 911 AWD variants
    ('porsche', r'\b911\b.*\b(?:4S|Carrera\s*4)\b', 'AWD', None, None),
    ('porsche', r'\b911\b.*\bTurbo\b', 'AWD', None, None),
    ('porsche', r'\b911\b.*\bGT2\b', 'RWD', None, None),

    # Mazda MX-5/Miata
    ('mazda', r'\b(?:MX-?5|Miata)\b', 'RWD', None, None),

    # Corvette — always RWD (until C8 E-Ray)
    ('chevrolet', r'\bCorvette\b', 'RWD', None, r'\bE-?Ray\b'),
    ('chevy', r'\bCorvette\b', 'RWD', None, r'\bE-?Ray\b'),

    # Mustang (non-AWD)
    ('ford', r'\bMustang\b', 'RWD', None, r'\bMach[-\s]?E\b'),

    # Camaro
    ('chevrolet', r'\bCamaro\b', 'RWD', None, None),
    ('chevy', r'\bCamaro\b', 'RWD', None, None),

    # Dodge muscle
    ('dodge', r'\bChallenger\b', 'RWD', None, r'\bAWD\b'),
    ('dodge', r'\bViper\b', 'RWD', None, None),
    ('dodge', r'\bCharger\b', 'RWD', None, r'\b(?:AWD|SXT\s+AWD|GT\s+AWD)\b'),

    # Classic sports
    (None, r'\bS2000\b', 'RWD', None, None),
    ('nissan', r'\b(?:350|370|300)Z\b', 'RWD', None, None),
    ('toyota', r'\bSupra\b', 'RWD', None, None),
    ('toyota', r'\b(?:GT-?86|86|GR\s*86)\b', 'RWD', None, None),
    ('subaru', r'\bBRZ\b', 'RWD', None, None),
    ('scion', r'\bFR-?S\b', 'RWD', None, None),

    # Ferrari (most are RWD)
    ('ferrari', r'.*', 'RWD', None, r'\b(?:FF|GTC4|Purosangue|SF90|296)\b'),

    # Lamborghini older = RWD, newer = AWD
    ('lamborghini', r'\b(?:Countach|Diablo|Gallardo)\b.*\bRWD\b', 'RWD', None, None),
    ('lamborghini', r'\b(?:Huracan|Aventador|Urus|Revuelto)\b', 'AWD', None, r'\bRWD\b'),

    # Classic American RWD
    ('pontiac', r'\b(?:GTO|Firebird|Trans\s*Am)\b', 'RWD', None, None),
    ('plymouth', r'\b(?:Barracuda|Cuda|Road\s*Runner|GTX)\b', 'RWD', None, None),
    ('oldsmobile', r'\b(?:442|Cutlass)\b', 'RWD', None, None),
    ('buick', r'\b(?:Grand\s*National|GNX|Skylark|GSX)\b', 'RWD', None, None),
    ('mercury', r'\b(?:Cougar|Cyclone)\b', 'RWD', None, None),
    ('amc', r'\b(?:Javelin|AMX)\b', 'RWD', None, None),

    # Lotus
    ('lotus', r'.*', 'RWD', None, r'\bEvija\b'),

    # Aston Martin
    ('aston martin', r'.*', 'RWD', None, None),

    # Morgan
    ('morgan', r'.*', 'RWD', None, None),

    # TVR
    ('tvr', r'.*', 'RWD', None, None),

    # ── AWD vehicles ──

    # Subaru (all except BRZ)
    ('subaru', r'\bBRZ\b', 'RWD', None, None),  # Already above, but explicit
    ('subaru', r'(?!.*\bBRZ\b).*', 'AWD', None, None),

    # Audi Quattro
    ('audi', r'\b(?:quattro|Quattro)\b', 'AWD', None, None),
    ('audi', r'\bRS\s*\d', 'AWD', None, None),
    ('audi', r'\bS[345678]\b', 'AWD', None, None),
    ('audi', r'\bAllroad\b', 'AWD', None, None),
    ('audi', r'\bQ[2-9]\b', 'AWD', None, None),

    # Tesla (AWD for dual motor, RWD for single — default AWD for safety)
    ('tesla', r'\b(?:Model\s*[SXY3]|Roadster)\b', 'AWD', None, None),

    # Nissan GT-R
    ('nissan', r'\bGT-?R\b', 'AWD', None, None),

    # Mitsubishi Evo
    ('mitsubishi', r'\b(?:Lancer\s+)?Evo(?:lution)?\b', 'AWD', None, None),

    # ── 4WD vehicles ──

    # Jeep Wrangler / classic Jeeps
    ('jeep', r'\bWrangler\b', '4WD', None, None),
    ('jeep', r'\bCJ[-\s]?\d\b', '4WD', None, None),
    ('jeep', r'\bGladiator\b', '4WD', None, None),

    # Toyota off-road
    ('toyota', r'\bLand\s*Cruiser\b', '4WD', None, None),
    ('toyota', r'\bFJ\s*Cruiser\b', '4WD', None, None),
    ('toyota', r'\b4Runner\b', '4WD', None, r'\b(?:2WD|SR5\s+2WD)\b'),
    ('toyota', r'\bTacoma\b.*\b(?:TRD|4x4|4WD)\b', '4WD', None, None),

    # Land Rover
    ('land rover', r'.*', '4WD', None, None),

    # Hummer
    ('hummer', r'.*', '4WD', None, None),

    # Mercedes G-Class
    ('mercedes', r'\bG[-\s]?(?:Class|Wagen|500|550|63|65)\b', '4WD', None, None),
    ('mercedes-benz', r'\bG[-\s]?(?:Class|Wagen|500|550|63|65)\b', '4WD', None, None),

    # Ford Bronco
    ('ford', r'\bBronco\b', '4WD', None, r'\bSport\b'),

    # Chevrolet/GMC K-series trucks
    ('chevrolet', r'\bK-?\d{1,2}\b', '4WD', None, None),
    ('gmc', r'\bK-?\d{1,2}\b', '4WD', None, None),

    # International Scout
    ('international', r'\bScout\b', '4WD', None, None),

    # ── FWD vehicles ──

    # Honda sedans/hatchbacks (non-AWD, non-CR-V)
    ('honda', r'\bCivic\b', 'FWD', None, r'\b(?:AWD|Type\s*R)\b'),
    ('honda', r'\bAccord\b', 'FWD', None, r'\bAWD\b'),
    ('honda', r'\bFit\b', 'FWD', None, None),
    ('honda', r'\bInsight\b', 'FWD', None, None),

    # Toyota sedans
    ('toyota', r'\bCamry\b', 'FWD', None, r'\bAWD\b'),
    ('toyota', r'\bCorolla\b', 'FWD', None, r'\b(?:AWD|Cross)\b'),
    ('toyota', r'\bPrius\b', 'FWD', None, r'\bAWD\b'),

    # VW Golf/Jetta
    ('volkswagen', r'\bGolf\b', 'FWD', None, r'\b(?:R\b|4motion|4MOTION|Syncro)\b'),
    ('volkswagen', r'\bJetta\b', 'FWD', None, r'\b(?:4motion|4MOTION)\b'),
    ('volkswagen', r'\bGTI\b', 'FWD', None, r'\b(?:4motion|4MOTION)\b'),
    ('volkswagen', r'\bBeetle\b', 'RWD', (1938, 1979), None),  # Air-cooled Beetles are RWD
    ('volkswagen', r'\bBeetle\b', 'FWD', (1998, 2019), None),  # New Beetle is FWD
    ('volkswagen', r'\bBug\b', 'RWD', None, None),             # Bug = old Beetle

    # Hyundai / Kia sedans
    ('hyundai', r'\b(?:Elantra|Sonata|Accent)\b', 'FWD', None, r'\bAWD\b'),
    ('kia', r'\b(?:Forte|Optima|K5|Rio|Soul)\b', 'FWD', None, r'\bAWD\b'),

    # Nissan sedans
    ('nissan', r'\b(?:Altima|Sentra|Versa|Maxima)\b', 'FWD', None, r'\bAWD\b'),

    # Mazda sedans
    ('mazda', r'\b(?:Mazda3|3)\b', 'FWD', None, r'\bAWD\b'),
    ('mazda', r'\b(?:Mazda6|6)\b', 'FWD', None, r'\bAWD\b'),

    # Mini (FWD based)
    ('mini', r'\bCooper\b', 'FWD', None, r'\b(?:Countryman|ALL4|S\s+ALL4)\b'),

    # Fiat
    ('fiat', r'\b(?:500|124)\b', 'FWD', None, r'\b(?:AWD|4x4|X)\b'),
]

# Compile drivetrain regexes
_DRIVETRAIN_COMPILED = []
for make_pat, model_pat, dt, year_range, exclude_pat in DRIVETRAIN_RULES:
    make_re = re.compile(make_pat, re.I) if make_pat else None
    model_re = re.compile(model_pat, re.I)
    excl_re = re.compile(exclude_pat, re.I) if exclude_pat else None
    _DRIVETRAIN_COMPILED.append((make_re, model_re, dt, year_range, excl_re))


def infer_drivetrain(make, model, title, year):
    """Infer drivetrain from make/model/year.

    Returns normalized drivetrain: 'RWD', 'FWD', 'AWD', '4WD', or None.
    """
    make_lower = (make or '').strip().lower()
    model_str = (model or '').strip()
    title_str = (title or '').strip()
    search_text = f"{model_str} {title_str}"
    yr = year or 0

    if not make_lower and not search_text.strip():
        return None

    # Check for explicit drivetrain keywords in model/title first
    # These override any rule-based inference
    if re.search(r'\b(?:4x4|4×4|4WD|four.wheel.drive)\b', search_text, re.I):
        return '4WD'
    if re.search(r'\b(?:AWD|all.wheel.drive|Quattro|xDrive|4motion|ATTESA|SH-AWD|S-AWD|Symmetrical\s+AWD)\b', search_text, re.I):
        return 'AWD'

    # Apply rules
    for make_re, model_re, dt, year_range, excl_re in _DRIVETRAIN_COMPILED:
        if make_re and not make_re.search(make_lower):
            continue
        if not model_re.search(search_text):
            continue
        if excl_re and excl_re.search(search_text):
            continue
        if year_range and yr and not (year_range[0] <= yr <= year_range[1]):
            continue
        return dt

    return None


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Derive vehicle defaults for body_style, fuel_type, drivetrain')
    parser.add_argument('--limit', type=int, default=500000, help='Max vehicles to process per field')
    parser.add_argument('--dry-run', action='store_true', help='Parse but do not write to DB')
    parser.add_argument('--field', choices=['body_style', 'fuel_type', 'drivetrain', 'all'],
                        default='all', help='Which field to derive (default: all)')
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    page_size = 5000
    batch_size = 100
    grand_start = time.time()
    summary = {}

    fields_to_run = ['body_style', 'fuel_type', 'drivetrain'] if args.field == 'all' else [args.field]

    # ── BODY STYLE ──
    if 'body_style' in fields_to_run:
        print(f"\n[{time.strftime('%H:%M:%S')}] ===== BODY STYLE DERIVATION =====", file=sys.stderr)
        vehicles = _load_vehicles(cur, """
            SELECT id, make, model, bat_listing_title
            FROM vehicles
            WHERE body_style IS NULL
              AND (model IS NOT NULL OR bat_listing_title IS NOT NULL)
            ORDER BY id
        """, page_size, args.limit)
        print(f"[{time.strftime('%H:%M:%S')}] Loaded {len(vehicles)} vehicles missing body_style", file=sys.stderr)

        updates = []
        for i, (vid, make, model, title) in enumerate(vehicles):
            style = infer_body_style(make, model, title)
            if style:
                updates.append((style, str(vid)))
            if (i + 1) % 1000 == 0:
                print(f"  ... processed {i+1}/{len(vehicles)}, {len(updates)} derivable", file=sys.stderr)

        print(f"[{time.strftime('%H:%M:%S')}] Derived body_style for {len(updates)}/{len(vehicles)} vehicles", file=sys.stderr)

        if not args.dry_run and updates:
            errors = _batch_update(cur, "UPDATE vehicles SET body_style = COALESCE(body_style, %s) WHERE id = %s", updates, batch_size, 'body_style')
            summary['body_style'] = {'derived': len(updates), 'errors': errors}
        else:
            summary['body_style'] = {'derived': len(updates), 'errors': 0}
            if args.dry_run and updates:
                # Show sample
                print(f"  DRY RUN — sample derivations:", file=sys.stderr)
                for style, vid in updates[:15]:
                    print(f"    {vid[:8]}... -> {style}", file=sys.stderr)

    # ── FUEL TYPE ──
    if 'fuel_type' in fields_to_run:
        print(f"\n[{time.strftime('%H:%M:%S')}] ===== FUEL TYPE DERIVATION =====", file=sys.stderr)
        vehicles = _load_vehicles(cur, """
            SELECT id, make, model, bat_listing_title, year, engine_size
            FROM vehicles
            WHERE fuel_type IS NULL
              AND (make IS NOT NULL OR model IS NOT NULL)
            ORDER BY id
        """, page_size, args.limit)
        print(f"[{time.strftime('%H:%M:%S')}] Loaded {len(vehicles)} vehicles missing fuel_type", file=sys.stderr)

        updates = []
        for i, (vid, make, model, title, year, engine_size) in enumerate(vehicles):
            fuel = infer_fuel_type(make, model, title, year, engine_size)
            if fuel:
                updates.append((fuel, str(vid)))
            if (i + 1) % 1000 == 0:
                print(f"  ... processed {i+1}/{len(vehicles)}, {len(updates)} derivable", file=sys.stderr)

        print(f"[{time.strftime('%H:%M:%S')}] Derived fuel_type for {len(updates)}/{len(vehicles)} vehicles", file=sys.stderr)

        if not args.dry_run and updates:
            errors = _batch_update(cur, "UPDATE vehicles SET fuel_type = COALESCE(fuel_type, %s) WHERE id = %s", updates, batch_size, 'fuel_type')
            summary['fuel_type'] = {'derived': len(updates), 'errors': errors}
        else:
            summary['fuel_type'] = {'derived': len(updates), 'errors': 0}
            if args.dry_run and updates:
                print(f"  DRY RUN — sample derivations:", file=sys.stderr)
                for fuel, vid in updates[:15]:
                    print(f"    {vid[:8]}... -> {fuel}", file=sys.stderr)

    # ── DRIVETRAIN ──
    if 'drivetrain' in fields_to_run:
        print(f"\n[{time.strftime('%H:%M:%S')}] ===== DRIVETRAIN DERIVATION =====", file=sys.stderr)
        vehicles = _load_vehicles(cur, """
            SELECT id, make, model, bat_listing_title, year
            FROM vehicles
            WHERE drivetrain IS NULL
              AND (make IS NOT NULL OR model IS NOT NULL)
            ORDER BY id
        """, page_size, args.limit)
        print(f"[{time.strftime('%H:%M:%S')}] Loaded {len(vehicles)} vehicles missing drivetrain", file=sys.stderr)

        updates = []
        for i, (vid, make, model, title, year) in enumerate(vehicles):
            dt = infer_drivetrain(make, model, title, year)
            if dt:
                updates.append((dt, str(vid)))
            if (i + 1) % 1000 == 0:
                print(f"  ... processed {i+1}/{len(vehicles)}, {len(updates)} derivable", file=sys.stderr)

        print(f"[{time.strftime('%H:%M:%S')}] Derived drivetrain for {len(updates)}/{len(vehicles)} vehicles", file=sys.stderr)

        if not args.dry_run and updates:
            errors = _batch_update(cur, "UPDATE vehicles SET drivetrain = COALESCE(drivetrain, %s) WHERE id = %s", updates, batch_size, 'drivetrain')
            summary['drivetrain'] = {'derived': len(updates), 'errors': errors}
        else:
            summary['drivetrain'] = {'derived': len(updates), 'errors': 0}
            if args.dry_run and updates:
                print(f"  DRY RUN — sample derivations:", file=sys.stderr)
                for dt, vid in updates[:15]:
                    print(f"    {vid[:8]}... -> {dt}", file=sys.stderr)

    # ── SUMMARY ──
    cur.close()
    conn.close()
    elapsed = time.time() - grand_start
    print(f"\n[{time.strftime('%H:%M:%S')}] ===== COMPLETE =====", file=sys.stderr)
    for field, stats in summary.items():
        status = "WRITTEN" if not args.dry_run else "DRY RUN"
        print(f"  {field}: {stats['derived']} derived ({status}), {stats['errors']} errors", file=sys.stderr)
    print(f"  Duration: {int(elapsed//60)}m {int(elapsed%60)}s", file=sys.stderr)


def _load_vehicles(cur, base_query, page_size, limit):
    """Load vehicles in paginated batches using LIMIT/OFFSET."""
    vehicles = []
    offset = 0
    while len(vehicles) < limit:
        cur.execute(f"{base_query} LIMIT %s OFFSET %s", (page_size, offset))
        page = cur.fetchall()
        if not page:
            break
        vehicles.extend(page)
        offset += page_size
        if len(vehicles) % 50000 < page_size:
            print(f"  ... loaded {len(vehicles)} vehicles", file=sys.stderr)
    return vehicles[:limit]


def _batch_update(cur, sql, updates, batch_size, field_name):
    """Execute batch updates, printing progress every 1000."""
    errors = 0
    for i in range(0, len(updates), batch_size):
        chunk = updates[i:i + batch_size]
        try:
            execute_batch(cur, sql, chunk, page_size=batch_size)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Batch error ({field_name}): {e}", file=sys.stderr)
        written = min(i + batch_size, len(updates))
        if written % 1000 < batch_size:
            print(f"  ... {written}/{len(updates)} {field_name} written", file=sys.stderr)
    print(f"[{time.strftime('%H:%M:%S')}] Finished writing {len(updates)} {field_name} updates ({errors} errors)", file=sys.stderr)
    return errors


if __name__ == '__main__':
    main()
