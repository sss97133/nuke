#!/usr/bin/env python3
"""
Color Normalization — Clean garbage, split combined values, assign color families.

Three phases:
  1. CLEANUP  — NULL out garbage values (non-color words, fragments, too-short)
  2. SPLIT    — Split "X Over Y" patterns into color + interior_color
  3. FAMILY   — Assign color_family from OEM name mappings and keyword fallback

Usage:
  python3 scripts/normalize-colors.py --dry-run --phase all
  python3 scripts/normalize-colors.py --phase cleanup --limit 50000
  python3 scripts/normalize-colors.py --phase split
  python3 scripts/normalize-colors.py --phase family
  python3 scripts/normalize-colors.py --phase all
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


# =============================================================================
# PHASE 1: GARBAGE DETECTION
# =============================================================================

# Exact-match garbage values (case-insensitive)
GARBAGE_EXACT = {
    'ps', 'two', 'the', 'in', 'an', 'ed in', 'its current shade',
    'matching', 'n/a', 'n/a.', 'na', 'n.a', 'n.a.', 'none', 'unknown',
    'other', 'various', 'tbd', 'see description', 'see listing',
    'see photos', 'see details', 'not specified', 'not listed',
    'new', 'off', 'by', 'up', 'led', 'was', 'as', 'all', 'ed',
    'on', 'it', 'few', 'six', 'non', 'may', 'ing', 'can', 'but',
    'cc', 'ado', 'per', 'and', 'for', 'the', 'has', 'had', 'his',
    'her', 'its', 'our', 'not', 'are', 'were', 'been', 'have',
    'with', 'this', 'that', 'from', 'they', 'been', 'some', 'what',
    'when', 'your', 'each', 'make', 'like', 'just', 'over', 'such',
    'take', 'than', 'them', 'very', 'after', 'also', 'back', 'been',
    'only', 'come', 'made', 'well', 'more', 'most', 'much', 'then',
    'will', 'year', 'does', 'done', 'both', 'down', 'even', 'here',
    'into', 'many', 'must', 'part', 'same', 'work', 'still',
    'stock', 'original', 'factory', 'custom', 'repaint', 'repainted',
    'refinished', 'restored', 'recent', 'nice', 'good', 'great',
    'excellent', 'beautiful', 'gorgeous', 'stunning', 'clean',
    'solid', 'fresh', 'painted', 'wrapped', 'vinyl wrap',
    'clear coat', 'clearcoat', 'base coat', 'basecoat',
    'primer', 'primered', 'bare metal', 'patina',
    'multiple', 'several', 'assorted', 'mixed',
    'oem', 'standard', 'base', 'special', 'limited',
    'to be determined', 'will update', 'coming soon',
    'ask', 'call', 'email', 'contact', 'inquire',
    '-', '--', '---', '.', '..', '...', '/', '//', 'n', 'a',
    'null', 'none', 'tone', 'additional', 'calipers fitted',
    'in the', 'details', 'include', 'just',
    'inherit', 'of the', 'color', 'colour', 'shows just',
    'to match the', 'under previous ownership',
    'under prior ownership', 'under current ownership',
    'during', 'which', 'about', 'being', 'where',
    'there', 'those', 'these', 'could', 'would', 'should',
    'first', 'second', 'third', 'last', 'next',
    'sold', 'bought', 'listed', 'offered', 'featured',
}

# Regex patterns that indicate garbage (not a real color)
GARBAGE_PATTERNS = [
    r'^\d+$',                          # Pure numbers: "123"
    r'^[A-Z]{2,5}\d{3,}',             # Part numbers: "WA409Y"
    r'^\(.+\)$',                       # Just parenthetical: "(see description)"
    r'^https?://',                     # URLs
    r'^\d{4}\s',                       # Starts with a year: "2019 Ford..."
    r'(?i)^(?:this|the|a|an|is|was|has|had|it|its)\s',  # Starts with article/pronoun
    r'(?i)\bvin\b',                    # Contains VIN reference
    r'(?i)\bstock\s*#',               # Stock number
    r'(?i)\blot\s*#',                 # Lot number
    r'(?i)^(?:see|per|as|please|check|refer)\s',  # Instructional
    r'(?i)^(?:currently|previously|originally|recently)\s',  # Temporal
    r'(?i)^its\s+(?:current|original|present|factory)',  # "Its Current Shade", "Its Original Color"
    r'(?i)^the\s+(?:style|factory|original|current)',    # "The style of...", "The Factory"
    r'(?i)^(?:details?\s+include|hood\s+scoops?\b)',     # Description fragments
    r'(?i)^(?:under|during|shows?|inherit)',              # Ownership/condition fragments
    r'(?i)^(?:of\s+the|to\s+match|in\s+(?:the|a|its))\b',  # Prepositional fragments
    r'(?i)^(?:said|been|sold|bought|listed|offered)\s',   # Past tense fragments
    r'^(?:COLOR|COLOUR|TBD|TBA|SEE|CALL|ASK|MISC|MIXED|STOCK|BASE|OEM|STD)$',  # ALL-CAPS non-color codes
    r'(?i)\b(?:miles?|km|odometer|mileage)\b',  # Mileage data in color field
    r'(?i)\b(?:engine|motor|trans|cylinder|hp|horsepower)\b',  # Engine data
    r'(?i)\b(?:title|registration|certificate)\b',  # Document references
    r'(?i)^\d+[kK]\s',                # "45K Miles" etc
]

_GARBAGE_COMPILED = [re.compile(p) for p in GARBAGE_PATTERNS]


def is_garbage(color_val):
    """Return True if this color value is garbage that should be NULLed."""
    if not color_val:
        return True

    stripped = color_val.strip()

    # Too short (single char or empty)
    if len(stripped) < 2:
        return True

    # Exact match against garbage set
    if stripped.lower() in GARBAGE_EXACT:
        return True

    # Pattern match
    for pat in _GARBAGE_COMPILED:
        if pat.search(stripped):
            return True

    return False


# =============================================================================
# PHASE 2: SPLIT "X OVER Y" PATTERNS
# =============================================================================

# Pattern: "Color Over Interior" or "Color over Interior"
# Examples: "Red Over Black Vinyl", "Guards Red Over Black Leather"
OVER_PATTERN = re.compile(
    r'^(.+?)\s+[Oo]ver\s+(.+)$'
)

# Also handle "Color With Interior" (less common but present)
WITH_PATTERN = re.compile(
    r'^(.+?)\s+[Ww]ith\s+(.+)$'
)

# "Color/Interior" slash patterns like "Red/White"
SLASH_PATTERN = re.compile(
    r'^([A-Za-z][\w\s]*?)\s*/\s*([A-Za-z][\w\s]*?)$'
)


def split_combined_color(color_val):
    """Split combined exterior/interior color strings.

    Returns (exterior_color, interior_color_or_none).
    If no split is needed, returns (original, None).
    """
    if not color_val:
        return (color_val, None)

    stripped = color_val.strip()

    # Try "X Over Y" first (most common pattern: 15,000+ values)
    m = OVER_PATTERN.match(stripped)
    if m:
        exterior = m.group(1).strip()
        interior = m.group(2).strip()
        # Validate exterior is plausibly a color (not just "The" or "In")
        if len(exterior) >= 2 and not is_garbage(exterior):
            return (exterior, interior if interior else None)

    # Try "X With Y" (less common: ~1,500 values)
    m = WITH_PATTERN.match(stripped)
    if m:
        exterior = m.group(1).strip()
        interior = m.group(2).strip()
        if len(exterior) >= 2 and not is_garbage(exterior):
            # "With" interior descriptions are often partial — only use if substantial
            if len(interior) >= 3:
                return (exterior, interior)
            return (exterior, None)

    return (stripped, None)


# =============================================================================
# PHASE 3: COLOR FAMILY MAPPING
# =============================================================================

# The 15 canonical color families
COLOR_FAMILIES = [
    'Black', 'White', 'Silver/Gray', 'Red', 'Blue', 'Green',
    'Yellow', 'Orange', 'Brown/Tan', 'Gold', 'Purple/Violet',
    'Burgundy/Maroon', 'Beige/Cream', 'Bronze', 'Multi/Two-Tone',
]

# ── OEM Color Name → Color Family ──
# This is the most valuable mapping — hundreds of manufacturer-specific names.
# Organized by manufacturer for maintainability.
OEM_COLOR_MAP = {
    # ─── PORSCHE ───
    'guards red': 'Red',
    'arena red': 'Red',
    'ruby red': 'Red',
    'carmine red': 'Red',
    'indian red': 'Red',
    'signal red': 'Red',
    'zanzibar red': 'Red',
    'carmona red': 'Red',
    'amaranth red': 'Red',
    'speed yellow': 'Yellow',
    'racing yellow': 'Yellow',
    'signal yellow': 'Yellow',
    'pastel yellow': 'Yellow',
    'summer yellow': 'Yellow',
    'pts yellow': 'Yellow',
    'riviera blue': 'Blue',
    'miami blue': 'Blue',
    'shark blue': 'Blue',
    'gentian blue': 'Blue',
    'sapphire blue': 'Blue',
    'cobalt blue': 'Blue',
    'aqua blue': 'Blue',
    'yachting blue': 'Blue',
    'ocean blue': 'Blue',
    'maritime blue': 'Blue',
    'albert blue': 'Blue',
    'minerva blue': 'Blue',
    'iris blue': 'Blue',
    'viper green': 'Green',
    'python green': 'Green',
    'aventurine green': 'Green',
    'irish green': 'Green',
    'oak green': 'Green',
    'brewster green': 'Green',
    'moss green': 'Green',
    'auratium green': 'Green',
    'gt silver': 'Silver/Gray',
    'gt silver metallic': 'Silver/Gray',
    'arctic silver': 'Silver/Gray',
    'arctic silver metallic': 'Silver/Gray',
    'seal grey': 'Silver/Gray',
    'seal grey metallic': 'Silver/Gray',
    'agate grey': 'Silver/Gray',
    'agate grey metallic': 'Silver/Gray',
    'meteor grey': 'Silver/Gray',
    'meteor grey metallic': 'Silver/Gray',
    'ice grey': 'Silver/Gray',
    'ice grey metallic': 'Silver/Gray',
    'chalk': 'White',
    'carrara white': 'White',
    'grand prix white': 'White',
    'biarritz white': 'White',
    'crayon': 'Silver/Gray',
    'lava orange': 'Orange',
    'gulf orange': 'Orange',
    'pastel orange': 'Orange',
    'signal orange': 'Orange',
    'tangerine': 'Orange',
    'paint to sample': 'Multi/Two-Tone',
    'pts': 'Multi/Two-Tone',
    'basalt black': 'Black',
    'basalt black metallic': 'Black',
    'jet black': 'Black',
    'jet black metallic': 'Black',
    'black': 'Black',
    'mahogany': 'Burgundy/Maroon',
    'mahogany metallic': 'Burgundy/Maroon',
    'macadamia': 'Brown/Tan',
    'macadamia metallic': 'Brown/Tan',
    'cognac': 'Brown/Tan',
    'cognac metallic': 'Brown/Tan',
    'cashmere beige': 'Beige/Cream',
    'luxor beige': 'Beige/Cream',
    'platinum': 'Silver/Gray',
    'rhodium silver': 'Silver/Gray',
    'rhodium silver metallic': 'Silver/Gray',
    'dolomite silver': 'Silver/Gray',
    'dolomite silver metallic': 'Silver/Gray',
    'silverstone metallic': 'Silver/Gray',
    'silverstone': 'Silver/Gray',

    # ─── FERRARI ───
    'rosso corsa': 'Red',
    'rosso scuderia': 'Red',
    'rosso fiorano': 'Red',
    'rosso berlinetta': 'Red',
    'rosso mugello': 'Red',
    'rosso maranello': 'Red',
    'rosso dino': 'Red',
    'rosso barchetta': 'Red',
    'rosso rubino': 'Red',
    'rossa chiaro': 'Red',
    'giallo modena': 'Yellow',
    'giallo fly': 'Yellow',
    'giallo triplo strato': 'Yellow',
    'giallo pastello': 'Yellow',
    'giallo grosso': 'Yellow',
    'blu pozzi': 'Blue',
    'blu tour de france': 'Blue',
    'blu scozia': 'Blue',
    'blu nart': 'Blue',
    'blu elettrico': 'Blue',
    'blu swaters': 'Blue',
    'blu mirabeau': 'Blue',
    'blu sera': 'Blue',
    'grigio silverstone': 'Silver/Gray',
    'grigio titanio': 'Silver/Gray',
    'grigio ferro': 'Silver/Gray',
    'grigio alloy': 'Silver/Gray',
    'grigio ingrid': 'Silver/Gray',
    'grigio scuro': 'Silver/Gray',
    'nero': 'Black',
    'nero daytona': 'Black',
    'nero stellato': 'Black',
    'nero ds': 'Black',
    'bianco': 'White',
    'bianco avus': 'White',
    'bianco fuji': 'White',
    'bianco italia': 'White',
    'bianco cervino': 'White',
    'argento nurburgring': 'Silver/Gray',
    'argento nurburgring metallic': 'Silver/Gray',
    'verde british racing': 'Green',
    'verde inglese': 'Green',
    'verde scuro': 'Green',
    'verde pino': 'Green',
    'verde abu dhabi': 'Green',
    'marrone metallizzato': 'Brown/Tan',
    'canna di fucile': 'Silver/Gray',
    'grigio medio': 'Silver/Gray',
    'azzurro california': 'Blue',
    'avorio': 'Beige/Cream',
    'fly yellow': 'Yellow',
    'tour de france blue': 'Blue',
    'corsa red': 'Red',

    # ─── BMW ───
    'alpine white': 'White',
    'alpine white ii': 'White',
    'alpine white iii': 'White',
    'mineral white': 'White',
    'mineral white metallic': 'White',
    'frozen brilliant white': 'White',
    'frozen brilliant white metallic': 'White',
    'black sapphire': 'Black',
    'black sapphire metallic': 'Black',
    'jet black': 'Black',
    'carbon black': 'Black',
    'carbon black metallic': 'Black',
    'frozen black': 'Black',
    'azurite black': 'Black',
    'azurite black metallic': 'Black',
    'citrin black': 'Black',
    'citrin black metallic': 'Black',
    'melbourne red': 'Red',
    'melbourne red metallic': 'Red',
    'crimson red': 'Red',
    'imola red': 'Red',
    'imola red ii': 'Red',
    'estoril blue': 'Blue',
    'estoril blue metallic': 'Blue',
    'le mans blue': 'Blue',
    'le mans blue metallic': 'Blue',
    'tanzanite blue': 'Blue',
    'tanzanite blue metallic': 'Blue',
    'san marino blue': 'Blue',
    'san marino blue metallic': 'Blue',
    'long beach blue': 'Blue',
    'long beach blue metallic': 'Blue',
    'portimao blue': 'Blue',
    'portimao blue metallic': 'Blue',
    'interlagos blue': 'Blue',
    'interlagos blue metallic': 'Blue',
    'avus blue': 'Blue',
    'avus blue metallic': 'Blue',
    'montego blue': 'Blue',
    'montego blue metallic': 'Blue',
    'phytonic blue': 'Blue',
    'phytonic blue metallic': 'Blue',
    'isle of man green': 'Green',
    'isle of man green metallic': 'Green',
    'british racing green': 'Green',
    'british racing green metallic': 'Green',
    'oxford green': 'Green',
    'oxford green metallic': 'Green',
    'dark green metallic': 'Green',
    'java green': 'Green',
    'java green metallic': 'Green',
    'malachite green': 'Green',
    'malachite green metallic': 'Green',
    'sunset orange': 'Orange',
    'sunset orange metallic': 'Orange',
    'sakhir orange': 'Orange',
    'sakhir orange metallic': 'Orange',
    'valencia orange': 'Orange',
    'valencia orange metallic': 'Orange',
    'fire orange': 'Orange',
    'austin yellow': 'Yellow',
    'austin yellow metallic': 'Yellow',
    'dakar yellow': 'Yellow',
    'dakar yellow ii': 'Yellow',
    'phoenix yellow': 'Yellow',
    'speed yellow': 'Yellow',
    'titanium silver': 'Silver/Gray',
    'titanium silver metallic': 'Silver/Gray',
    'space gray': 'Silver/Gray',
    'space gray metallic': 'Silver/Gray',
    'space grey metallic': 'Silver/Gray',
    'mineral gray': 'Silver/Gray',
    'mineral gray metallic': 'Silver/Gray',
    'mineral grey metallic': 'Silver/Gray',
    'glacier silver': 'Silver/Gray',
    'glacier silver metallic': 'Silver/Gray',
    'sparkling graphite': 'Silver/Gray',
    'sparkling graphite metallic': 'Silver/Gray',
    'dravit grey': 'Silver/Gray',
    'dravit grey metallic': 'Silver/Gray',
    'nardo grey': 'Silver/Gray',
    'frozen gray': 'Silver/Gray',
    'frozen grey': 'Silver/Gray',
    'brooklyn grey': 'Silver/Gray',
    'brooklyn grey metallic': 'Silver/Gray',
    'sophisto grey': 'Silver/Gray',
    'sophisto grey metallic': 'Silver/Gray',
    'skyscraper grey metallic': 'Silver/Gray',
    'thundernight metallic': 'Purple/Violet',
    'techno violet': 'Purple/Violet',
    'techno violet metallic': 'Purple/Violet',
    'daytona violet': 'Purple/Violet',
    'daytona violet metallic': 'Purple/Violet',
    'byzanz metallic': 'Brown/Tan',
    'terra brown metallic': 'Brown/Tan',
    'marrakesh brown': 'Brown/Tan',
    'marrakesh brown metallic': 'Brown/Tan',
    'champagne quartz metallic': 'Gold',
    'individual': 'Multi/Two-Tone',

    # ─── MERCEDES-BENZ ───
    'obsidian black': 'Black',
    'obsidian black metallic': 'Black',
    'magnetite black': 'Black',
    'magnetite black metallic': 'Black',
    'night black': 'Black',
    'cosmos black': 'Black',
    'cosmos black metallic': 'Black',
    'polar white': 'White',
    'cirrus white': 'White',
    'calcite white': 'White',
    'diamond white': 'White',
    'diamond white metallic': 'White',
    'designo diamond white': 'White',
    'designo diamond white metallic': 'White',
    'cashmere white': 'White',
    'cashmere white metallic': 'White',
    'mystic white': 'White',
    'brilliant blue': 'Blue',
    'brilliant blue metallic': 'Blue',
    'cavansite blue': 'Blue',
    'cavansite blue metallic': 'Blue',
    'lunar blue': 'Blue',
    'lunar blue metallic': 'Blue',
    'starling blue': 'Blue',
    'starling blue metallic': 'Blue',
    'nautical blue': 'Blue',
    'nautical blue metallic': 'Blue',
    'spectral blue': 'Blue',
    'spectral blue metallic': 'Blue',
    'sodalite blue': 'Blue',
    'sodalite blue metallic': 'Blue',
    'selenite grey': 'Silver/Gray',
    'selenite grey metallic': 'Silver/Gray',
    'selenite gray': 'Silver/Gray',
    'selenite gray metallic': 'Silver/Gray',
    'mojave silver': 'Silver/Gray',
    'mojave silver metallic': 'Silver/Gray',
    'iridium silver': 'Silver/Gray',
    'iridium silver metallic': 'Silver/Gray',
    'palladium silver': 'Silver/Gray',
    'palladium silver metallic': 'Silver/Gray',
    'flint grey': 'Silver/Gray',
    'flint grey metallic': 'Silver/Gray',
    'graphite grey': 'Silver/Gray',
    'graphite grey metallic': 'Silver/Gray',
    'tenorite grey': 'Silver/Gray',
    'tenorite grey metallic': 'Silver/Gray',
    'designo selenite grey magno': 'Silver/Gray',
    'emerald green': 'Green',
    'emerald green metallic': 'Green',
    'cardinal red': 'Red',
    'cardinal red metallic': 'Red',
    'rubellite red': 'Red',
    'rubellite red metallic': 'Red',
    'designo cardinal red': 'Red',
    'hyacinth red': 'Red',
    'hyacinth red metallic': 'Red',
    'jupiter red': 'Red',
    'mars red': 'Red',
    'fire opal': 'Red',
    'patagonia red': 'Red',
    'patagonia red metallic': 'Red',
    'sun yellow': 'Yellow',
    'sun yellow metallic': 'Yellow',
    'citrine brown': 'Brown/Tan',
    'citrine brown metallic': 'Brown/Tan',
    'dolomite brown': 'Brown/Tan',
    'dolomite brown metallic': 'Brown/Tan',
    'dakota brown': 'Brown/Tan',
    'kalahari gold': 'Gold',
    'kalahari gold metallic': 'Gold',
    'champagne': 'Gold',

    # ─── CHEVROLET / GM ───
    'tuxedo black': 'Black',
    'tuxedo black metallic': 'Black',
    'mosaic black': 'Black',
    'mosaic black metallic': 'Black',
    'black metallic': 'Black',
    'summit white': 'White',
    'arctic white': 'White',
    'olympic white': 'White',
    'torch red': 'Red',
    'bright red': 'Red',
    'victory red': 'Red',
    'rally red': 'Red',
    'crystal red': 'Red',
    'crystal red tintcoat': 'Red',
    'garnet red': 'Red',
    'garnet red metallic': 'Red',
    'long beach red': 'Red',
    'long beach red metallic': 'Red',
    'rapid blue': 'Blue',
    'laguna blue': 'Blue',
    'laguna blue metallic': 'Blue',
    'arctic blue': 'Blue',
    'arctic blue metallic': 'Blue',
    'admiral blue': 'Blue',
    'admiral blue metallic': 'Blue',
    'elkhart lake blue': 'Blue',
    'elkhart lake blue metallic': 'Blue',
    'kinetic blue': 'Blue',
    'kinetic blue metallic': 'Blue',
    'watkins glen gray': 'Silver/Gray',
    'watkins glen gray metallic': 'Silver/Gray',
    'cyber gray': 'Silver/Gray',
    'cyber gray metallic': 'Silver/Gray',
    'shadow gray': 'Silver/Gray',
    'shadow gray metallic': 'Silver/Gray',
    'satin steel gray': 'Silver/Gray',
    'satin steel gray metallic': 'Silver/Gray',
    'blade silver': 'Silver/Gray',
    'blade silver metallic': 'Silver/Gray',
    'machine silver': 'Silver/Gray',
    'machine silver metallic': 'Silver/Gray',
    'inferno orange': 'Orange',
    'inferno orange metallic': 'Orange',
    'sebring orange': 'Orange',
    'sebring orange metallic': 'Orange',
    'tangier orange': 'Orange',
    'velocity yellow': 'Yellow',
    'accelerate yellow': 'Yellow',
    'accelerate yellow metallic': 'Yellow',
    'corvette racing yellow': 'Yellow',
    'mean yellow': 'Yellow',
    'rally yellow': 'Yellow',
    'velocity yellow tintcoat': 'Yellow',
    'dark moon blue': 'Blue',
    'dark moon blue metallic': 'Blue',
    'riverside green': 'Green',
    'rally green': 'Green',
    'rally green metallic': 'Green',
    'spring green': 'Green',
    'synergy green': 'Green',
    'cajun red': 'Red',
    'cajun red tintcoat': 'Red',
    'harvest gold': 'Gold',
    'pewter metallic': 'Silver/Gray',

    # ─── FORD ───
    'race red': 'Red',
    'rapid red': 'Red',
    'rapid red metallic': 'Red',
    'rapid red metallic tinted clearcoat': 'Red',
    'ruby red': 'Red',
    'ruby red metallic': 'Red',
    'ruby red metallic tinted clearcoat': 'Red',
    'redfire metallic': 'Red',
    'candy apple red': 'Red',
    'vermillion red': 'Red',
    'oxford white': 'White',
    'star white': 'White',
    'star white metallic': 'White',
    'star white metallic tri-coat': 'White',
    'white platinum': 'White',
    'white platinum metallic tri-coat': 'White',
    'wimbledon white': 'White',
    'performance white': 'White',
    'shadow black': 'Black',
    'agate black': 'Black',
    'agate black metallic': 'Black',
    'tuxedo black metallic': 'Black',
    'absolute black': 'Black',
    'ebony black': 'Black',
    'velocity blue': 'Blue',
    'velocity blue metallic': 'Blue',
    'grabber blue': 'Blue',
    'grabber blue metallic': 'Blue',
    'antimatter blue': 'Blue',
    'antimatter blue metallic': 'Blue',
    'atlas blue': 'Blue',
    'atlas blue metallic': 'Blue',
    'kona blue': 'Blue',
    'kona blue metallic': 'Blue',
    'lightning blue': 'Blue',
    'lightning blue metallic': 'Blue',
    'deep impact blue': 'Blue',
    'deep impact blue metallic': 'Blue',
    'vista blue': 'Blue',
    'vista blue metallic': 'Blue',
    'sonic blue': 'Blue',
    'sonic blue metallic': 'Blue',
    'twister orange': 'Orange',
    'twister orange metallic': 'Orange',
    'competition orange': 'Orange',
    'fury orange': 'Orange',
    'cyber orange': 'Orange',
    'cyber orange metallic tri-coat': 'Orange',
    'carbonized gray': 'Silver/Gray',
    'carbonized gray metallic': 'Silver/Gray',
    'iconic silver': 'Silver/Gray',
    'iconic silver metallic': 'Silver/Gray',
    'ingot silver': 'Silver/Gray',
    'ingot silver metallic': 'Silver/Gray',
    'magnetic': 'Silver/Gray',
    'magnetic metallic': 'Silver/Gray',
    'dark highland green': 'Green',
    'highland green': 'Green',
    'highland green metallic': 'Green',
    'eruption green': 'Green',
    'eruption green metallic': 'Green',
    'need for green': 'Green',
    'gotta have it green': 'Green',
    'gotta have it green metallic': 'Green',
    'grabber lime': 'Green',
    'triple yellow': 'Yellow',
    'triple yellow tri-coat': 'Yellow',
    'screaming yellow': 'Yellow',
    'yellow blaze metallic tri-coat': 'Yellow',
    'school bus yellow': 'Yellow',
    'area 51': 'Blue',
    'cactus gray': 'Silver/Gray',
    'cactus grey': 'Silver/Gray',
    'alto blue': 'Blue',
    'alto blue metallic': 'Blue',
    'vapour blue': 'Blue',
    'vapor blue': 'Blue',

    # ─── LAMBORGHINI ───
    'giallo midas': 'Yellow',
    'giallo orion': 'Yellow',
    'giallo horus': 'Yellow',
    'giallo tenerife': 'Yellow',
    'giallo auge': 'Yellow',
    'giallo inti': 'Yellow',
    'giallo halys': 'Yellow',
    'giallo maggio': 'Yellow',
    'arancio borealis': 'Orange',
    'arancio argos': 'Orange',
    'arancio atlas': 'Orange',
    'arancio leonis': 'Orange',
    'arancio ishtar': 'Orange',
    'arancio xanto': 'Orange',
    'verde mantis': 'Green',
    'verde scandal': 'Green',
    'verde ithaca': 'Green',
    'verde selvans': 'Green',
    'verde artemis': 'Green',
    'verde gea': 'Green',
    'verde ermes': 'Green',
    'verde ulysses': 'Green',
    'verde medio': 'Green',
    'blu cepheus': 'Blue',
    'blu nethuns': 'Blue',
    'blu caelum': 'Blue',
    'blu lemonade': 'Blue',
    'blu eleos': 'Blue',
    'blu sideris': 'Blue',
    'blu aegeus': 'Blue',
    'blu fontus': 'Blue',
    'blu glauco': 'Blue',
    'blu le mans': 'Blue',
    'rosso mars': 'Red',
    'rosso efesto': 'Red',
    'rosso bia': 'Red',
    'rosso anteros': 'Red',
    'rosso leto': 'Red',
    'bianco monocerus': 'White',
    'bianco isi': 'White',
    'bianco icarus': 'White',
    'bianco canopus': 'White',
    'nero nemesis': 'Black',
    'nero noctis': 'Black',
    'nero aldebaran': 'Black',
    'nero pegaso': 'Black',
    'nero helene': 'Black',
    'grigio titans': 'Silver/Gray',
    'grigio telesto': 'Silver/Gray',
    'grigio nimbus': 'Silver/Gray',
    'grigio estoque': 'Silver/Gray',
    'grigio lynx': 'Silver/Gray',
    'grigio hati': 'Silver/Gray',
    'grigio keres': 'Silver/Gray',
    'viola pasifae': 'Purple/Violet',
    'viola ophelia': 'Purple/Violet',
    'viola parsifae': 'Purple/Violet',
    'marrone apus': 'Brown/Tan',
    'oro elios': 'Gold',

    # ─── MCLAREN ───
    'mclaren orange': 'Orange',
    'papaya spark': 'Orange',
    'volcano yellow': 'Yellow',
    'volcano red': 'Red',
    'mantis green': 'Green',
    'storm grey': 'Silver/Gray',
    'chicane grey': 'Silver/Gray',
    'saros': 'Silver/Gray',
    'onyx black': 'Black',
    'silica white': 'White',
    'aztec gold': 'Gold',

    # ─── ROLLS-ROYCE / BENTLEY ───
    'beluga black': 'Black',
    'beluga': 'Black',
    'ghost white': 'White',
    'arctic white': 'White',
    'glacier white': 'White',
    'magnetic': 'Silver/Gray',
    'hallmark': 'Silver/Gray',
    'dark sapphire': 'Blue',
    'sequin blue': 'Blue',
    'flying spur': 'Silver/Gray',
    'st james red': 'Red',
    'dragon red': 'Red',
    'verdant': 'Green',
    'cumbrian green': 'Green',
    'barnato green': 'Green',
    'burnt orange': 'Orange',

    # ─── ASTON MARTIN ───
    'onyx black': 'Black',
    'jet black': 'Black',
    'stratus white': 'White',
    'morning frost white': 'White',
    'white stone': 'White',
    'lightning silver': 'Silver/Gray',
    'magnetic silver': 'Silver/Gray',
    'china grey': 'Silver/Gray',
    'tungsten silver': 'Silver/Gray',
    'hammerhead silver': 'Silver/Gray',
    'quantum silver': 'Silver/Gray',
    'skyfall silver': 'Silver/Gray',
    'cobalt blue': 'Blue',
    'zaffre blue': 'Blue',
    'concours blue': 'Blue',
    'marina blue': 'Blue',
    'q azure blue': 'Blue',
    'racing green': 'Green',
    'appletree green': 'Green',
    'aston martin racing green': 'Green',
    'iridescent emerald': 'Green',
    'supernova red': 'Red',
    'hyper red': 'Red',
    'diavolo red': 'Red',
    'cinnabar orange': 'Orange',
    'sunburst yellow': 'Yellow',
    'cosmos orange': 'Orange',
    'champagne gold': 'Gold',

    # ─── MASERATI ───
    'rosso trionfale': 'Red',
    'rosso magma': 'Red',
    'blu sofisticato': 'Blue',
    'blu emozione': 'Blue',
    'blu nobile': 'Blue',
    'blu inchiostro': 'Blue',
    'grigio maratea': 'Silver/Gray',
    'grigio alfieri': 'Silver/Gray',
    'grigio granito': 'Silver/Gray',
    'grigio lava': 'Silver/Gray',
    'nero ribelle': 'Black',
    'nero carbonio': 'Black',
    'bianco alpi': 'White',

    # ─── JAGUAR ───
    'british racing green': 'Green',
    'brg': 'Green',
    'old english white': 'White',
    'opalescent silver blue': 'Blue',
    'indigo blue': 'Blue',
    'loire blue': 'Blue',
    'firenze red': 'Red',
    'caldera red': 'Red',
    'italian racing red': 'Red',
    'santorini black': 'Black',
    'narvik black': 'Black',
    'fuji white': 'White',
    'yulong white': 'White',
    'eiger grey': 'Silver/Gray',
    'corris grey': 'Silver/Gray',
    'silicon silver': 'Silver/Gray',
    'carpathian grey': 'Silver/Gray',
    'byron blue': 'Blue',
    'ultraviolet': 'Purple/Violet',
    'sorrento yellow': 'Yellow',

    # ─── LAND ROVER ───
    'santorini black metallic': 'Black',
    'fuji white': 'White',
    'yulong white metallic': 'White',
    'eiger grey metallic': 'Silver/Gray',
    'corris grey metallic': 'Silver/Gray',
    'silicon silver metallic': 'Silver/Gray',
    'carpathian grey metallic': 'Silver/Gray',
    'firenze red metallic': 'Red',
    'byron blue metallic': 'Blue',
    'portofino blue metallic': 'Blue',
    'tasman blue metallic': 'Blue',
    'aruba': 'Blue',

    # ─── DODGE / CHRYSLER / MOPAR ───
    'plum crazy': 'Purple/Violet',
    'plum crazy purple': 'Purple/Violet',
    'b5 blue': 'Blue',
    'b5 blue pearl': 'Blue',
    'sublime': 'Green',
    'sublime green': 'Green',
    'sublime metallic': 'Green',
    'go mango': 'Orange',
    'go mango orange': 'Orange',
    'hemi orange': 'Orange',
    'tor red': 'Red',
    'torred': 'Red',
    'redline red': 'Red',
    'redline red tricoat': 'Red',
    'octane red': 'Red',
    'octane red pearl': 'Red',
    'hellraisin': 'Purple/Violet',
    'frostbite': 'Blue',
    'sinamon stick': 'Brown/Tan',
    'destroyer grey': 'Silver/Gray',
    'destroyer gray': 'Silver/Gray',
    'smoke show': 'Silver/Gray',
    'granite crystal': 'Silver/Gray',
    'granite crystal metallic': 'Silver/Gray',
    'pitch black': 'Black',
    'diamond black': 'Black',
    'diamond black crystal': 'Black',
    'white knuckle': 'White',
    'ivory white': 'White',
    'bright white': 'White',
    'triple nickel': 'Silver/Gray',
    'billet silver': 'Silver/Gray',
    'billet silver metallic': 'Silver/Gray',
    'maximum steel': 'Silver/Gray',
    'maximum steel metallic': 'Silver/Gray',
    'indigo blue': 'Blue',
    'f8 green': 'Green',
    'srt green': 'Green',
    'green go': 'Green',
    'yellow jacket': 'Yellow',
    'stinger yellow': 'Yellow',
    'banana yellow': 'Yellow',

    # ─── TOYOTA / LEXUS ───
    'super white': 'White',
    'super white ii': 'White',
    'blizzard white': 'White',
    'blizzard white pearl': 'White',
    'wind chill pearl': 'White',
    'eminent white pearl': 'White',
    'ultra white': 'White',
    'midnight black': 'Black',
    'midnight black metallic': 'Black',
    'attitude black': 'Black',
    'attitude black metallic': 'Black',
    'caviar': 'Black',
    'celestial silver': 'Silver/Gray',
    'celestial silver metallic': 'Silver/Gray',
    'classic silver': 'Silver/Gray',
    'classic silver metallic': 'Silver/Gray',
    'magnetic gray': 'Silver/Gray',
    'magnetic gray metallic': 'Silver/Gray',
    'nebula gray pearl': 'Silver/Gray',
    'atomic silver': 'Silver/Gray',
    'barcelona red': 'Red',
    'barcelona red metallic': 'Red',
    'ruby flare pearl': 'Red',
    'supersonic red': 'Red',
    'inferno': 'Orange',
    'hot lava': 'Orange',
    'solar shift': 'Orange',
    'blueprint': 'Blue',
    'cavalry blue': 'Blue',
    'nautical blue': 'Blue',
    'nautical blue metallic': 'Blue',
    'structural blue': 'Blue',
    'army green': 'Green',
    'lime rush': 'Green',
    'nori green pearl': 'Green',
    'voodoo blue': 'Blue',
    'cement': 'Silver/Gray',
    'lunar rock': 'Silver/Gray',
    'smoked mesquite': 'Brown/Tan',
    'quicksand': 'Beige/Cream',
    'sandstorm': 'Gold',
    'ultrasonic blue mica': 'Blue',
    'ultrasonic blue mica 2.0': 'Blue',
    'matador red mica': 'Red',
    'flint mica': 'Silver/Gray',

    # ─── HONDA / ACURA ───
    'crystal black pearl': 'Black',
    'crystal white pearl': 'White',
    'platinum white pearl': 'White',
    'rallye red': 'Red',
    'san marino red': 'Red',
    'aegean blue metallic': 'Blue',
    'obsidian blue pearl': 'Blue',
    'sonic gray pearl': 'Silver/Gray',
    'modern steel metallic': 'Silver/Gray',
    'lunar silver metallic': 'Silver/Gray',
    'still night pearl': 'Blue',
    'boost blue pearl': 'Blue',
    'championship white': 'White',
    'phoenix yellow': 'Yellow',
    'apex blue pearl': 'Blue',
    'indy yellow pearl': 'Yellow',
    'nouvelle blue pearl': 'Blue',
    'type s pearl yellow': 'Yellow',

    # ─── NISSAN / INFINITI ───
    'gun metallic': 'Silver/Gray',
    'super black': 'Black',
    'brilliant silver': 'Silver/Gray',
    'brilliant silver metallic': 'Silver/Gray',
    'pearl white': 'White',
    'pearl white tricoat': 'White',
    'deep blue pearl': 'Blue',
    'electric blue metallic': 'Blue',
    'bayside blue': 'Blue',
    'midnight purple': 'Purple/Violet',
    'millennium jade': 'Green',
    'iridescent amethyst': 'Purple/Violet',

    # ─── VOLKSWAGEN / AUDI ───
    'tornado red': 'Red',
    'reflex silver': 'Silver/Gray',
    'reflex silver metallic': 'Silver/Gray',
    'platinum gray': 'Silver/Gray',
    'platinum gray metallic': 'Silver/Gray',
    'night blue metallic': 'Blue',
    'lapiz blue metallic': 'Blue',
    'habanero orange': 'Orange',
    'cornflower blue': 'Blue',
    'silk blue metallic': 'Blue',
    'great falls green metallic': 'Green',
    'kings red metallic': 'Red',
    'urano grey': 'Silver/Gray',
    'nardo gray': 'Silver/Gray',
    'nardo grey': 'Silver/Gray',
    'navarra blue': 'Blue',
    'navarra blue metallic': 'Blue',
    'tango red': 'Red',
    'tango red metallic': 'Red',
    'python yellow': 'Yellow',
    'turbo blue': 'Blue',
    'glacier white': 'White',
    'glacier white metallic': 'White',
    'mythos black': 'Black',
    'mythos black metallic': 'Black',
    'florett silver': 'Silver/Gray',
    'florett silver metallic': 'Silver/Gray',
    'daytona gray': 'Silver/Gray',
    'daytona gray pearl': 'Silver/Gray',
    'monsoon gray': 'Silver/Gray',
    'monsoon gray metallic': 'Silver/Gray',
    'quantum gray': 'Silver/Gray',
    'quantum grey': 'Silver/Gray',
    'ara blue crystal': 'Blue',
    'sepang blue': 'Blue',
    'sepang blue pearl': 'Blue',
    'sonoma green': 'Green',
    'sonoma green metallic': 'Green',
    'district green': 'Green',
    'district green metallic': 'Green',
    'vegas yellow': 'Yellow',
    'imola yellow': 'Yellow',
    'misano red': 'Red',
    'misano red pearl': 'Red',
    'talisman gold': 'Gold',

    # ─── SUBARU ───
    'world rally blue': 'Blue',
    'world rally blue pearl': 'Blue',
    'wrb': 'Blue',
    'crystal white pearl': 'White',
    'ice silver metallic': 'Silver/Gray',
    'dark gray metallic': 'Silver/Gray',
    'magnetite gray metallic': 'Silver/Gray',
    'sapphire blue pearl': 'Blue',
    'lapis blue pearl': 'Blue',
    'plasma yellow pearl': 'Yellow',
    'pure red': 'Red',

    # ─── MAZDA ───
    'soul red crystal metallic': 'Red',
    'soul red crystal': 'Red',
    'soul red': 'Red',
    'machine gray metallic': 'Silver/Gray',
    'machine grey metallic': 'Silver/Gray',
    'snowflake white pearl': 'White',
    'snowflake white pearl mica': 'White',
    'jet black mica': 'Black',
    'eternal blue mica': 'Blue',
    'deep crystal blue mica': 'Blue',
    'polymetal gray metallic': 'Silver/Gray',
    'zircon sand metallic': 'Beige/Cream',

    # ─── VOLVO ───
    'ice white': 'White',
    'crystal white metallic': 'White',
    'crystal white pearl': 'White',
    'onyx black metallic': 'Black',
    'black stone': 'Black',
    'thunder grey': 'Silver/Gray',
    'osmium grey metallic': 'Silver/Gray',
    'pebble grey metallic': 'Silver/Gray',
    'electric silver metallic': 'Silver/Gray',
    'mussel blue metallic': 'Blue',
    'bursting blue metallic': 'Blue',
    'denim blue metallic': 'Blue',
    'rebel blue': 'Blue',
    'fusion red metallic': 'Red',
    'passion red': 'Red',
    'luminous sand metallic': 'Beige/Cream',
    'maple brown metallic': 'Brown/Tan',

    # ─── HYUNDAI / KIA / GENESIS ───
    'phantom black': 'Black',
    'aurora black pearl': 'Black',
    'quartz white': 'White',
    'ceramic white': 'White',
    'hampton grey': 'Silver/Gray',
    'electric shadow': 'Silver/Gray',
    'fluidic silver': 'Silver/Gray',
    'shimmering silver': 'Silver/Gray',
    'portofino gray': 'Silver/Gray',
    'uyuni white': 'White',
    'ceramic silver': 'Silver/Gray',
    'havana red': 'Red',
    'runway red': 'Red',
    'racing red': 'Red',
    'gravity gold': 'Gold',

    # ─── CLASSIC AMERICAN MUSCLE ───
    'hugger orange': 'Orange',
    'hemi orange': 'Orange',
    'grabber orange': 'Orange',
    'calypso coral': 'Orange',
    'poppy red': 'Red',
    'rangoon red': 'Red',
    'candyapple red': 'Red',
    'candy apple red': 'Red',
    'code red': 'Red',
    'acapulco blue': 'Blue',
    'grabber blue': 'Blue',
    'twilight turquoise': 'Blue',
    'tahoe turquoise': 'Blue',
    'marina blue': 'Blue',
    'tuxedo black': 'Black',
    'raven black': 'Black',
    'ebony black': 'Black',
    'ermine white': 'White',
    'cameo white': 'White',
    'wimbledon white': 'White',
    'frost green': 'Green',
    'sherwood green': 'Green',
    'ivy green': 'Green',
    'lime gold': 'Gold',
    'champagne gold': 'Gold',
    'burnished bronze': 'Bronze',
    'autumn bronze': 'Bronze',
    'saddle bronze': 'Bronze',
    'dark bronze': 'Bronze',
    'aztec gold': 'Gold',
    'harvest gold': 'Gold',
    'rally green': 'Green',
    'fathom green': 'Green',
    'verdoro green': 'Green',
    'british racing green': 'Green',
    'racing green': 'Green',
    'lemans blue': 'Blue',
    'laguna blue': 'Blue',
    'mulsanne blue': 'Blue',
    'daytona yellow': 'Yellow',
    'corvette yellow': 'Yellow',
    'sunflower yellow': 'Yellow',
    'canary yellow': 'Yellow',
    'cream yellow': 'Yellow',
    'butternut yellow': 'Yellow',
    'goldenrod yellow': 'Yellow',
    'bright yellow': 'Yellow',
    'medium yellow': 'Yellow',
    'dark green': 'Green',
    'light green': 'Green',
    'medium green': 'Green',
    'dark blue': 'Blue',
    'light blue': 'Blue',
    'medium blue': 'Blue',
    'dark red': 'Red',
    'light red': 'Red',
    'dark brown': 'Brown/Tan',
    'light brown': 'Brown/Tan',
    'medium brown': 'Brown/Tan',

    # ─── GENERIC / CROSS-BRAND ───
    'black': 'Black',
    'white': 'White',
    'red': 'Red',
    'blue': 'Blue',
    'green': 'Green',
    'yellow': 'Yellow',
    'orange': 'Orange',
    'silver': 'Silver/Gray',
    'gray': 'Silver/Gray',
    'grey': 'Silver/Gray',
    'brown': 'Brown/Tan',
    'tan': 'Brown/Tan',
    'gold': 'Gold',
    'purple': 'Purple/Violet',
    'violet': 'Purple/Violet',
    'burgundy': 'Burgundy/Maroon',
    'maroon': 'Burgundy/Maroon',
    'beige': 'Beige/Cream',
    'cream': 'Beige/Cream',
    'ivory': 'Beige/Cream',
    'bronze': 'Bronze',
    'copper': 'Bronze',
    'champagne': 'Gold',
    'charcoal': 'Silver/Gray',
    'graphite': 'Silver/Gray',
    'pewter': 'Silver/Gray',
    'platinum': 'Silver/Gray',
    'slate': 'Silver/Gray',
    'gunmetal': 'Silver/Gray',
    'taupe': 'Beige/Cream',
    'sand': 'Beige/Cream',
    'camel': 'Brown/Tan',
    'mocha': 'Brown/Tan',
    'espresso': 'Brown/Tan',
    'chocolate': 'Brown/Tan',
    'chestnut': 'Brown/Tan',
    'cinnamon': 'Brown/Tan',
    'saddle': 'Brown/Tan',
    'khaki': 'Beige/Cream',
    'olive': 'Green',
    'sage': 'Green',
    'teal': 'Blue',
    'turquoise': 'Blue',
    'aqua': 'Blue',
    'navy': 'Blue',
    'cobalt': 'Blue',
    'indigo': 'Blue',
    'sapphire': 'Blue',
    'royal blue': 'Blue',
    'midnight blue': 'Blue',
    'sky blue': 'Blue',
    'baby blue': 'Blue',
    'powder blue': 'Blue',
    'cornflower blue': 'Blue',
    'steel blue': 'Blue',
    'ice blue': 'Blue',
    'azure': 'Blue',
    'cerulean': 'Blue',
    'periwinkle': 'Blue',
    'wine': 'Burgundy/Maroon',
    'merlot': 'Burgundy/Maroon',
    'garnet': 'Burgundy/Maroon',
    'ruby': 'Red',
    'crimson': 'Red',
    'scarlet': 'Red',
    'cardinal': 'Red',
    'cherry': 'Red',
    'coral': 'Orange',
    'salmon': 'Orange',
    'peach': 'Orange',
    'apricot': 'Orange',
    'rust': 'Orange',
    'terra cotta': 'Orange',
    'terracotta': 'Orange',
    'amber': 'Orange',
    'mustard': 'Yellow',
    'lemon': 'Yellow',
    'canary': 'Yellow',
    'saffron': 'Yellow',
    'maize': 'Yellow',
    'honey': 'Gold',
    'butterscotch': 'Gold',
    'caramel': 'Brown/Tan',
    'fawn': 'Brown/Tan',
    'buff': 'Beige/Cream',
    'ecru': 'Beige/Cream',
    'off-white': 'White',
    'off white': 'White',
    'eggshell': 'White',
    'pearl': 'White',
    'snow white': 'White',
    'bright white': 'White',
    'pure white': 'White',
    'flat black': 'Black',
    'matte black': 'Black',
    'gloss black': 'Black',
    'satin black': 'Black',
    'jet black': 'Black',
    'midnight black': 'Black',
    'onyx': 'Black',
    'obsidian': 'Black',
    'ebony': 'Black',
    'anthracite': 'Silver/Gray',
    'titanium': 'Silver/Gray',
    'nickel': 'Silver/Gray',
    'tin': 'Silver/Gray',
    'ash': 'Silver/Gray',
    'smoke': 'Silver/Gray',
    'stone': 'Silver/Gray',
    'steel': 'Silver/Gray',
    'iron': 'Silver/Gray',
    'cement': 'Silver/Gray',
    'concrete': 'Silver/Gray',
    'dove': 'Silver/Gray',
    'dove gray': 'Silver/Gray',
    'dove grey': 'Silver/Gray',
    'primer gray': 'Silver/Gray',
    'primer grey': 'Silver/Gray',
    'mouse gray': 'Silver/Gray',
    'mouse grey': 'Silver/Gray',
    'battleship gray': 'Silver/Gray',
    'battleship grey': 'Silver/Gray',
    'satin silver': 'Silver/Gray',
    'bright silver': 'Silver/Gray',
    'chrome silver': 'Silver/Gray',
    'polished silver': 'Silver/Gray',
    'quicksilver': 'Silver/Gray',
    'dark gray': 'Silver/Gray',
    'dark grey': 'Silver/Gray',
    'light gray': 'Silver/Gray',
    'light grey': 'Silver/Gray',
    'medium gray': 'Silver/Gray',
    'medium grey': 'Silver/Gray',
    'metallic gray': 'Silver/Gray',
    'metallic grey': 'Silver/Gray',
    'forest green': 'Green',
    'hunter green': 'Green',
    'pine green': 'Green',
    'emerald green': 'Green',
    'jade green': 'Green',
    'lime green': 'Green',
    'kelly green': 'Green',
    'moss green': 'Green',
    'army green': 'Green',
    'military green': 'Green',
    'olive green': 'Green',
    'olive drab': 'Green',
    'seafoam': 'Green',
    'seafoam green': 'Green',
    'mint green': 'Green',
    'avocado green': 'Green',
    'dark green': 'Green',
    'deep green': 'Green',
    'pacific green': 'Green',
    'tropical green': 'Green',
    'fire engine red': 'Red',
    'brick red': 'Red',
    'blood red': 'Red',
    'barn red': 'Red',
    'candy red': 'Red',
    'lipstick red': 'Red',
    'hot rod red': 'Red',
    'signal red': 'Red',
    'passion red': 'Red',
    'deep red': 'Red',
    'dark red': 'Red',
    'light red': 'Red',
    'oxide red': 'Red',
    'venetian red': 'Red',
    'vermilion': 'Red',
    'vermillion': 'Red',
    'claret': 'Burgundy/Maroon',
    'oxblood': 'Burgundy/Maroon',
    'cranberry': 'Burgundy/Maroon',
    'raspberry': 'Red',
    'magenta': 'Red',
    'mauve': 'Purple/Violet',
    'lilac': 'Purple/Violet',
    'lavender': 'Purple/Violet',
    'plum': 'Purple/Violet',
    'eggplant': 'Purple/Violet',
    'amethyst': 'Purple/Violet',
    'mulberry': 'Purple/Violet',
    'orchid': 'Purple/Violet',
    'rose': 'Red',
    'pink': 'Red',
    'hot pink': 'Red',
    'fuchsia': 'Red',
    'two-tone': 'Multi/Two-Tone',
    'two tone': 'Multi/Two-Tone',
    'tri-tone': 'Multi/Two-Tone',
    'multi': 'Multi/Two-Tone',
    'multi-color': 'Multi/Two-Tone',
    'multicolor': 'Multi/Two-Tone',
    'rainbow': 'Multi/Two-Tone',
    'custom paint': 'Multi/Two-Tone',
    'special order': 'Multi/Two-Tone',
    'clearcoat metallic': 'Silver/Gray',
    'biancospino': 'White',
    'hypergreen': 'Green',
    'diamantschwarz': 'Black',
    'diamantschwarz metallic': 'Black',
    'diamantweiss': 'White',
    'diamantweiss metallic': 'White',
    'saphirschwarz': 'Black',
    'saphirschwarz metallic': 'Black',
    'orientbraun': 'Brown/Tan',
    'orientbraun metallic': 'Brown/Tan',
    'shadow metallic': 'Silver/Gray',
    'desert dune': 'Beige/Cream',
    'desert dune metallic': 'Beige/Cream',
    'satin aurum': 'Gold',
    'aurum': 'Gold',

    # ─── COMMON COMPOUND FORMS ───
    'metallic blue': 'Blue',
    'metallic red': 'Red',
    'metallic green': 'Green',
    'metallic silver': 'Silver/Gray',
    'metallic gray': 'Silver/Gray',
    'metallic grey': 'Silver/Gray',
    'metallic orange': 'Orange',
    'metallic brown': 'Brown/Tan',
    'metallic black': 'Black',
    'metallic gold': 'Gold',
    'metallic bronze': 'Bronze',
    'metallic purple': 'Purple/Violet',
    'metallic white': 'White',
    'metallic beige': 'Beige/Cream',
    'blue metallic': 'Blue',
    'red metallic': 'Red',
    'green metallic': 'Green',
    'silver metallic': 'Silver/Gray',
    'gray metallic': 'Silver/Gray',
    'grey metallic': 'Silver/Gray',
    'white metallic': 'White',
    'black metallic': 'Black',
    'gold metallic': 'Gold',
    'bronze metallic': 'Bronze',
    'brown metallic': 'Brown/Tan',
    'orange metallic': 'Orange',
    'purple metallic': 'Purple/Violet',
    'beige metallic': 'Beige/Cream',
    'pearl white': 'White',
    'white pearl': 'White',
    'pearl black': 'Black',
    'black pearl': 'Black',
    'pearl blue': 'Blue',
    'blue pearl': 'Blue',
    'pearl red': 'Red',
    'red pearl': 'Red',
}


# ── Keyword fallback: ordered by specificity ──
# For colors not found in OEM_COLOR_MAP, scan for these keywords.
# More specific keywords first to avoid false matches.
COLOR_KEYWORD_RULES = [
    # Multi/Two-tone (check first — these override single-color matches)
    (r'\btwo[-\s]?tone\b', 'Multi/Two-Tone'),
    (r'\btri[-\s]?tone\b', 'Multi/Two-Tone'),
    (r'\bmulti[-\s]?colou?r\b', 'Multi/Two-Tone'),
    (r'\bcustom\s+paint\b', 'Multi/Two-Tone'),
    (r'\bpaint\s+to\s+sample\b', 'Multi/Two-Tone'),

    # Burgundy/Maroon (before red, as these contain "red" sometimes)
    (r'\bburgundy\b', 'Burgundy/Maroon'),
    (r'\bmaroon\b', 'Burgundy/Maroon'),
    (r'\bwine\b', 'Burgundy/Maroon'),
    (r'\bmerlot\b', 'Burgundy/Maroon'),
    (r'\bclaret\b', 'Burgundy/Maroon'),
    (r'\boxblood\b', 'Burgundy/Maroon'),
    (r'\bcranberry\b', 'Burgundy/Maroon'),
    (r'\bgarnet\b', 'Burgundy/Maroon'),

    # Purple/Violet (before blue)
    (r'\bpurple\b', 'Purple/Violet'),
    (r'\bviolet\b', 'Purple/Violet'),
    (r'\blavender\b', 'Purple/Violet'),
    (r'\blilac\b', 'Purple/Violet'),
    (r'\bplum\b', 'Purple/Violet'),
    (r'\bmauve\b', 'Purple/Violet'),
    (r'\bamethyst\b', 'Purple/Violet'),
    (r'\borchid\b', 'Purple/Violet'),

    # Bronze (before brown)
    (r'\bbronze\b', 'Bronze'),
    (r'\bcopper\b', 'Bronze'),

    # Gold (before yellow/brown)
    (r'\bgold\b', 'Gold'),
    (r'\bchampagne\b', 'Gold'),
    (r'\bhoney\b', 'Gold'),
    (r'\bbutterscotch\b', 'Gold'),

    # Beige/Cream (before brown/white)
    (r'\bbeige\b', 'Beige/Cream'),
    (r'\bcream\b', 'Beige/Cream'),
    (r'\bivory\b', 'Beige/Cream'),
    (r'\btaupe\b', 'Beige/Cream'),
    (r'\bsand\b(?!\s*(?:stone|blast))', 'Beige/Cream'),
    (r'\bbuff\b', 'Beige/Cream'),
    (r'\becru\b', 'Beige/Cream'),
    (r'\bkhaki\b', 'Beige/Cream'),
    (r'\bparchment\b', 'Beige/Cream'),
    (r'\blinen\b', 'Beige/Cream'),
    (r'\bbisque\b', 'Beige/Cream'),

    # Brown/Tan
    (r'\bbrown\b', 'Brown/Tan'),
    (r'\btan\b', 'Brown/Tan'),
    (r'\bcamel\b', 'Brown/Tan'),
    (r'\bmocha\b', 'Brown/Tan'),
    (r'\bespresso\b', 'Brown/Tan'),
    (r'\bchocolate\b', 'Brown/Tan'),
    (r'\bchestnut\b', 'Brown/Tan'),
    (r'\bcinnamon\b', 'Brown/Tan'),
    (r'\bsaddle\b', 'Brown/Tan'),
    (r'\bcognac\b', 'Brown/Tan'),
    (r'\bmahogany\b', 'Brown/Tan'),
    (r'\bfawn\b', 'Brown/Tan'),
    (r'\bcaramel\b', 'Brown/Tan'),
    (r'\bwalnut\b', 'Brown/Tan'),
    (r'\bsienna\b', 'Brown/Tan'),
    (r'\bumber\b', 'Brown/Tan'),
    (r'\boak\b', 'Brown/Tan'),
    (r'\btobacco\b', 'Brown/Tan'),
    (r'\bhavana\b', 'Brown/Tan'),

    # Primary colors
    (r'\bblack\b', 'Black'),
    (r'\bnero\b', 'Black'),
    (r'\bnoir\b', 'Black'),
    (r'\bschwarz\b', 'Black'),
    (r'\bonyx\b', 'Black'),
    (r'\bobsidian\b', 'Black'),
    (r'\bebony\b', 'Black'),
    (r'\bmidnight\b(?!\s*(?:blue|purple))', 'Black'),

    (r'\bwhite\b', 'White'),
    (r'\bbianco\b', 'White'),
    (r'\bblanc\b', 'White'),
    (r'\bweiss\b', 'White'),
    (r'\bchalk\b', 'White'),
    (r'\bpearl\b(?!\s)', 'White'),

    (r'\bred\b', 'Red'),
    (r'\brosso\b', 'Red'),
    (r'\brouge\b', 'Red'),
    (r'\brot\b', 'Red'),
    (r'\bcrimson\b', 'Red'),
    (r'\bscarlet\b', 'Red'),
    (r'\bruby\b', 'Red'),
    (r'\bcherry\b', 'Red'),
    (r'\bvermil(?:l)?ion\b', 'Red'),
    (r'\bpink\b', 'Red'),
    (r'\bfuchsia\b', 'Red'),
    (r'\bmagenta\b', 'Red'),
    (r'\brose\b', 'Red'),

    (r'\bblue\b', 'Blue'),
    (r'\bblu\b', 'Blue'),
    (r'\bbleu\b', 'Blue'),
    (r'\bblau\b', 'Blue'),
    (r'\bazure\b', 'Blue'),
    (r'\bazul\b', 'Blue'),
    (r'\bcobalt\b', 'Blue'),
    (r'\bnavy\b', 'Blue'),
    (r'\bindigo\b', 'Blue'),
    (r'\bsapphire\b', 'Blue'),
    (r'\bteal\b', 'Blue'),
    (r'\bturquoise\b', 'Blue'),
    (r'\baqua\b', 'Blue'),
    (r'\bcerulean\b', 'Blue'),
    (r'\bcyan\b', 'Blue'),

    (r'\bgreen\b', 'Green'),
    (r'\bverde\b', 'Green'),
    (r'\bvert\b', 'Green'),
    (r'\bgrun\b', 'Green'),
    (r'\bolive\b', 'Green'),
    (r'\bsage\b', 'Green'),
    (r'\bseafoam\b', 'Green'),
    (r'\bmint\b', 'Green'),
    (r'\blime\b', 'Green'),
    (r'\bemerald\b', 'Green'),
    (r'\bjade\b', 'Green'),
    (r'\bhunter\b(?=\s*green)', 'Green'),
    (r'\bforest\b(?=\s*green)', 'Green'),

    (r'\byellow\b', 'Yellow'),
    (r'\bgiallo\b', 'Yellow'),
    (r'\bjaune\b', 'Yellow'),
    (r'\bgelb\b', 'Yellow'),
    (r'\blemon\b', 'Yellow'),
    (r'\bcanary\b', 'Yellow'),
    (r'\bsaffron\b', 'Yellow'),
    (r'\bmustard\b', 'Yellow'),

    (r'\borange\b', 'Orange'),
    (r'\barancio\b', 'Orange'),
    (r'\bcoral\b', 'Orange'),
    (r'\bsalmon\b', 'Orange'),
    (r'\bpeach\b', 'Orange'),
    (r'\brust\b', 'Orange'),
    (r'\bamber\b', 'Orange'),
    (r'\btangerine\b', 'Orange'),

    # Gray/Silver last among primaries (lots of false positives)
    (r'\bsilver\b', 'Silver/Gray'),
    (r'\bgr[ae]y\b', 'Silver/Gray'),
    (r'\bargento\b', 'Silver/Gray'),
    (r'\bgrigio\b', 'Silver/Gray'),
    (r'\bgris\b', 'Silver/Gray'),
    (r'\bgrau\b', 'Silver/Gray'),
    (r'\bcharcoal\b', 'Silver/Gray'),
    (r'\bgraphite\b', 'Silver/Gray'),
    (r'\bpewter\b', 'Silver/Gray'),
    (r'\bplatinum\b', 'Silver/Gray'),
    (r'\bslate\b', 'Silver/Gray'),
    (r'\bgunmetal\b', 'Silver/Gray'),
    (r'\btitanium\b', 'Silver/Gray'),
    (r'\banthracite\b', 'Silver/Gray'),
    (r'\bcement\b', 'Silver/Gray'),
    (r'\bconcrete\b', 'Silver/Gray'),
    (r'\bsteel\b', 'Silver/Gray'),
    (r'\biron\b', 'Silver/Gray'),
    (r'\bsmoke\b', 'Silver/Gray'),
    (r'\bash\b', 'Silver/Gray'),
    (r'\bdove\b', 'Silver/Gray'),
    (r'\bstone\b', 'Silver/Gray'),
]

_KEYWORD_COMPILED = [(re.compile(p, re.I), family) for p, family in COLOR_KEYWORD_RULES]


def classify_color_family(color_val):
    """Map a color string to one of the 15 color families.

    Strategy:
      1. Exact match in OEM_COLOR_MAP (case-insensitive)
      2. Strip common suffixes (Metallic, Pearl, etc.) and retry
      3. Keyword fallback scan
      4. Return None if truly unclassifiable
    """
    if not color_val:
        return None

    stripped = color_val.strip()
    if not stripped:
        return None

    lower = stripped.lower()

    # 1. Direct OEM lookup
    if lower in OEM_COLOR_MAP:
        return OEM_COLOR_MAP[lower]

    # 2. Strip finish suffixes and retry
    # "Guards Red Metallic" -> "Guards Red"
    # "Pearl White Tri-Coat" -> "Pearl White"
    for suffix_pat in [
        r'\s+metallic$', r'\s+pearl$', r'\s+mica$', r'\s+matte$',
        r'\s+satin$', r'\s+gloss$', r'\s+flat$', r'\s+tricoat$',
        r'\s+tri-coat$', r'\s+tri\s+coat$', r'\s+tintcoat$',
        r'\s+tinted\s+clearcoat$', r'\s+clearcoat$',
        r'\s+crystal$', r'\s+effect$', r'\s+brilliant$',
    ]:
        stripped_lower = re.sub(suffix_pat, '', lower, flags=re.I).strip()
        if stripped_lower != lower and stripped_lower in OEM_COLOR_MAP:
            return OEM_COLOR_MAP[stripped_lower]

    # 3. Strip parenthetical paint codes: "Royal Blue Metallic (WA409Y)" -> "Royal Blue Metallic"
    no_paren = re.sub(r'\s*\([^)]*\)\s*$', '', lower).strip()
    if no_paren != lower:
        if no_paren in OEM_COLOR_MAP:
            return OEM_COLOR_MAP[no_paren]
        # Also try stripping suffix from the no-paren version
        for suffix_pat in [r'\s+metallic$', r'\s+pearl$', r'\s+mica$']:
            stripped_no_paren = re.sub(suffix_pat, '', no_paren, flags=re.I).strip()
            if stripped_no_paren in OEM_COLOR_MAP:
                return OEM_COLOR_MAP[stripped_no_paren]

    # 4. Handle "X Metallic" / "X Pearl" as "extract X, classify X"
    m = re.match(r'^(.+?)\s+(?:metallic|pearl|mica|matte|satin|gloss)(?:\s|$)', lower, re.I)
    if m:
        base = m.group(1).strip()
        if base in OEM_COLOR_MAP:
            return OEM_COLOR_MAP[base]

    # 5. Handle "Metallic X" pattern
    m = re.match(r'^(?:metallic|pearl)\s+(.+)$', lower, re.I)
    if m:
        base = m.group(1).strip()
        if base in OEM_COLOR_MAP:
            return OEM_COLOR_MAP[base]

    # 6. Keyword fallback — scan the full string for color terms
    for pat_re, family in _KEYWORD_COMPILED:
        if pat_re.search(lower):
            return family

    return None


def normalize_case(color_val):
    """Normalize color case to Title Case for simple values.

    "black" -> "Black", "RACING RED" -> "Racing Red"
    But preserves already-correct casing for OEM names.
    """
    if not color_val:
        return color_val

    stripped = color_val.strip()
    if not stripped:
        return stripped

    # If it's all lowercase or all uppercase, title-case it
    if stripped.islower() or stripped.isupper():
        return stripped.title()

    # If first char is lowercase but rest has mixed case, just capitalize first
    if stripped[0].islower():
        return stripped[0].upper() + stripped[1:]

    return stripped


# =============================================================================
# DATA LOADING AND WRITING HELPERS
# =============================================================================

def load_vehicles_keyset(cur, base_query, page_size, limit):
    """Load vehicles using keyset pagination (faster than OFFSET for large tables).

    The base_query MUST select 'id' as the first column and end with 'ORDER BY id'.
    We inject a WHERE id > last_id clause for pagination.
    """
    vehicles = []
    last_id = '00000000-0000-0000-0000-000000000000'  # UUID min

    while len(vehicles) < limit:
        # Inject the keyset clause before ORDER BY
        paginated = base_query.replace('ORDER BY id', f"AND id > '{last_id}' ORDER BY id")
        cur.execute(f"{paginated} LIMIT %s", (page_size,))
        page = cur.fetchall()
        if not page:
            break
        vehicles.extend(page)
        last_id = str(page[-1][0])  # id is first column
        if len(vehicles) % 50000 < page_size:
            print(f"  ... loaded {len(vehicles)} vehicles", file=sys.stderr)
    return vehicles[:limit]


def batch_update(cur, sql, updates, batch_size, label):
    """Execute batch updates with progress reporting."""
    errors = 0
    for i in range(0, len(updates), batch_size):
        chunk = updates[i:i + batch_size]
        try:
            execute_batch(cur, sql, chunk, page_size=batch_size)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Batch error ({label}): {e}", file=sys.stderr)
        written = min(i + batch_size, len(updates))
        if written % 2000 < batch_size:
            print(f"  ... {written}/{len(updates)} {label} written", file=sys.stderr)
    print(f"[{time.strftime('%H:%M:%S')}] Finished {len(updates)} {label} updates ({errors} errors)", file=sys.stderr)
    return errors


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Normalize vehicle color data: cleanup garbage, split combined, assign families'
    )
    parser.add_argument('--limit', type=int, default=300000,
                        help='Max vehicles to process (default: 300000)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Analyze but do not write to DB')
    parser.add_argument('--phase', choices=['cleanup', 'split', 'family', 'all'],
                        default='all', help='Which phase to run (default: all)')
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    page_size = 5000
    batch_size = 100
    grand_start = time.time()
    summary = {}

    phases = ['cleanup', 'split', 'family'] if args.phase == 'all' else [args.phase]

    # ─────────────────────────────────────────────────────────────────────────
    # PHASE 1: CLEANUP — NULL out garbage color values
    # ─────────────────────────────────────────────────────────────────────────
    if 'cleanup' in phases:
        print(f"\n[{time.strftime('%H:%M:%S')}] ===== PHASE 1: GARBAGE CLEANUP =====", file=sys.stderr)

        vehicles = load_vehicles_keyset(cur, """
            SELECT id, color
            FROM vehicles
            WHERE color IS NOT NULL AND color != ''
            ORDER BY id
        """, page_size, args.limit)
        print(f"[{time.strftime('%H:%M:%S')}] Loaded {len(vehicles)} vehicles with color data", file=sys.stderr)

        null_updates = []  # vehicle IDs to NULL out
        case_updates = []  # (new_color, vehicle_id) for case normalization
        garbage_examples = {}

        for vid, color in vehicles:
            if is_garbage(color):
                null_updates.append((str(vid),))
                # Track garbage for reporting
                key = color.strip()[:40]
                garbage_examples[key] = garbage_examples.get(key, 0) + 1
            else:
                # Normalize case for non-garbage values
                normalized = normalize_case(color)
                if normalized != color:
                    case_updates.append((normalized, str(vid)))

        print(f"[{time.strftime('%H:%M:%S')}] Garbage to NULL: {len(null_updates)}", file=sys.stderr)
        print(f"[{time.strftime('%H:%M:%S')}] Case to normalize: {len(case_updates)}", file=sys.stderr)

        # Show top garbage values
        top_garbage = sorted(garbage_examples.items(), key=lambda x: -x[1])[:20]
        print(f"\n  Top garbage values being NULLed:", file=sys.stderr)
        for val, cnt in top_garbage:
            print(f"    {cnt:>6}x  \"{val}\"", file=sys.stderr)

        if not args.dry_run:
            if null_updates:
                errors = batch_update(
                    cur,
                    "UPDATE vehicles SET color = NULL WHERE id = %s",
                    null_updates, batch_size, 'garbage-null'
                )
                summary['cleanup_null'] = {'count': len(null_updates), 'errors': errors}

            if case_updates:
                errors = batch_update(
                    cur,
                    "UPDATE vehicles SET color = %s WHERE id = %s",
                    case_updates, batch_size, 'case-normalize'
                )
                summary['cleanup_case'] = {'count': len(case_updates), 'errors': errors}
        else:
            summary['cleanup_null'] = {'count': len(null_updates), 'errors': 0}
            summary['cleanup_case'] = {'count': len(case_updates), 'errors': 0}
            if case_updates:
                print(f"\n  Sample case normalizations:", file=sys.stderr)
                for new_color, vid in case_updates[:10]:
                    print(f"    {vid[:8]}... -> \"{new_color}\"", file=sys.stderr)

    # ─────────────────────────────────────────────────────────────────────────
    # PHASE 2: SPLIT — Split "X Over Y" into color + interior_color
    # ─────────────────────────────────────────────────────────────────────────
    if 'split' in phases:
        print(f"\n[{time.strftime('%H:%M:%S')}] ===== PHASE 2: SPLIT COMBINED COLORS =====", file=sys.stderr)

        # Load vehicles where color contains "Over" or "With" and interior_color is NULL
        vehicles = load_vehicles_keyset(cur, """
            SELECT id, color, interior_color
            FROM vehicles
            WHERE color IS NOT NULL
              AND (color LIKE '%% Over %%' OR color LIKE '%% over %%'
                   OR color LIKE '%% With %%' OR color LIKE '%% with %%')
            ORDER BY id
        """, page_size, args.limit)
        print(f"[{time.strftime('%H:%M:%S')}] Loaded {len(vehicles)} vehicles with combined color values", file=sys.stderr)

        # Two update types:
        # 1. Update color only (strip the "Over Y" part) — always
        # 2. Update interior_color — only if currently NULL
        color_only_updates = []     # (new_color, vehicle_id)
        color_and_interior = []     # (new_color, interior, vehicle_id)
        split_examples = []

        for vid, color, interior_color in vehicles:
            exterior, interior = split_combined_color(color)

            if exterior != color:
                # The split produced a different exterior
                vid_str = str(vid)

                if interior and not interior_color:
                    # Fill both exterior and interior
                    color_and_interior.append((normalize_case(exterior), normalize_case(interior), vid_str))
                    if len(split_examples) < 15:
                        split_examples.append((color, exterior, interior))
                else:
                    # Only update exterior (interior already populated or no interior from split)
                    color_only_updates.append((normalize_case(exterior), vid_str))
                    if len(split_examples) < 15:
                        split_examples.append((color, exterior, None))

        print(f"[{time.strftime('%H:%M:%S')}] Split color only: {len(color_only_updates)}", file=sys.stderr)
        print(f"[{time.strftime('%H:%M:%S')}] Split color + fill interior: {len(color_and_interior)}", file=sys.stderr)

        if split_examples:
            print(f"\n  Sample splits:", file=sys.stderr)
            for original, ext, inter in split_examples:
                if inter:
                    print(f"    \"{original}\" -> color=\"{ext}\", interior=\"{inter}\"", file=sys.stderr)
                else:
                    print(f"    \"{original}\" -> color=\"{ext}\"", file=sys.stderr)

        if not args.dry_run:
            errors = 0
            if color_only_updates:
                errors += batch_update(
                    cur,
                    "UPDATE vehicles SET color = %s WHERE id = %s",
                    color_only_updates, batch_size, 'split-color-only'
                )

            if color_and_interior:
                errors += batch_update(
                    cur,
                    "UPDATE vehicles SET color = %s, interior_color = COALESCE(interior_color, %s) WHERE id = %s",
                    color_and_interior, batch_size, 'split-color-interior'
                )

            summary['split'] = {
                'color_only': len(color_only_updates),
                'color_and_interior': len(color_and_interior),
                'errors': errors
            }
        else:
            summary['split'] = {
                'color_only': len(color_only_updates),
                'color_and_interior': len(color_and_interior),
                'errors': 0
            }

    # ─────────────────────────────────────────────────────────────────────────
    # PHASE 3: FAMILY — Assign color_family to all vehicles with a color
    # ─────────────────────────────────────────────────────────────────────────
    if 'family' in phases:
        print(f"\n[{time.strftime('%H:%M:%S')}] ===== PHASE 3: COLOR FAMILY ASSIGNMENT =====", file=sys.stderr)

        # Ensure color_family column exists
        if not args.dry_run:
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'vehicles' AND column_name = 'color_family'
                )
            """)
            exists = cur.fetchone()[0]
            if not exists:
                print(f"[{time.strftime('%H:%M:%S')}] Adding color_family column to vehicles...", file=sys.stderr)
                cur.execute("ALTER TABLE vehicles ADD COLUMN color_family TEXT")
                print(f"[{time.strftime('%H:%M:%S')}] Column added.", file=sys.stderr)

        # Load ALL vehicles with a color value
        vehicles = load_vehicles_keyset(cur, """
            SELECT id, color
            FROM vehicles
            WHERE color IS NOT NULL AND color != ''
            ORDER BY id
        """, page_size, args.limit)
        print(f"[{time.strftime('%H:%M:%S')}] Loaded {len(vehicles)} vehicles with color data", file=sys.stderr)

        updates = []
        family_counts = {}
        unclassified = {}
        unclassified_count = 0

        for vid, color in vehicles:
            family = classify_color_family(color)
            if family:
                updates.append((family, str(vid)))
                family_counts[family] = family_counts.get(family, 0) + 1
            else:
                unclassified_count += 1
                key = color.strip()[:50]
                unclassified[key] = unclassified.get(key, 0) + 1

        classified_pct = (len(updates) / len(vehicles) * 100) if vehicles else 0
        print(f"[{time.strftime('%H:%M:%S')}] Classified: {len(updates)}/{len(vehicles)} ({classified_pct:.1f}%)", file=sys.stderr)
        print(f"[{time.strftime('%H:%M:%S')}] Unclassified: {unclassified_count}", file=sys.stderr)

        # Show family distribution
        print(f"\n  Color Family Distribution:", file=sys.stderr)
        for family in sorted(family_counts.keys(), key=lambda f: -family_counts[f]):
            cnt = family_counts[family]
            pct = cnt / len(updates) * 100 if updates else 0
            bar = '#' * int(pct / 2)
            print(f"    {family:<20} {cnt:>7} ({pct:>5.1f}%) {bar}", file=sys.stderr)

        # Show top unclassified
        if unclassified:
            top_unc = sorted(unclassified.items(), key=lambda x: -x[1])[:20]
            print(f"\n  Top unclassified colors:", file=sys.stderr)
            for val, cnt in top_unc:
                print(f"    {cnt:>5}x  \"{val}\"", file=sys.stderr)

        if not args.dry_run and updates:
            errors = batch_update(
                cur,
                "UPDATE vehicles SET color_family = %s WHERE id = %s",
                updates, batch_size, 'color-family'
            )
            summary['family'] = {
                'classified': len(updates),
                'unclassified': unclassified_count,
                'errors': errors
            }
        else:
            summary['family'] = {
                'classified': len(updates),
                'unclassified': unclassified_count,
                'errors': 0
            }

    # ─────────────────────────────────────────────────────────────────────────
    # SUMMARY
    # ─────────────────────────────────────────────────────────────────────────
    cur.close()
    conn.close()
    elapsed = time.time() - grand_start
    mode = "WRITTEN" if not args.dry_run else "DRY RUN"

    print(f"\n[{time.strftime('%H:%M:%S')}] ===== COMPLETE ({mode}) =====", file=sys.stderr)
    for phase, stats in summary.items():
        print(f"  {phase}: {stats}", file=sys.stderr)
    print(f"  Duration: {int(elapsed//60)}m {int(elapsed%60)}s", file=sys.stderr)


if __name__ == '__main__':
    main()
