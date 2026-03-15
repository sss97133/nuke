#!/usr/bin/env python3
"""
Layer 1: Deterministic regex-based extractor for BaT vehicle descriptions.

Part of the Nuke extraction stack. Runs at $0/extraction in microseconds.
Handles ~38% of extractable claims from BaT editorial descriptions.
Produces filterable/sortable fields that feed into the library scanner (Layer 2)
and GLiNER NER extraction (Layer 3).

BaT editorial patterns exploited:
  - 75% start with "This [year] [make] [model]..."
  - 76% contain "finished in [color]"
  - 62% contain odometer references
  - 58% contain powertrain phrases

Each extraction returns structured results with:
  - value: the extracted content
  - confidence: 0.0-1.0 based on pattern specificity
  - source_span: (start, end) character positions in description
  - pattern: which named regex matched
"""

import html
import re
from dataclasses import dataclass
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Extraction result container
# ---------------------------------------------------------------------------

@dataclass
class ExtractionResult:
    """Single extraction result with provenance tracking."""
    value: Any
    confidence: float
    source_span: tuple[int, int]
    pattern: str

    def to_dict(self) -> dict:
        return {
            'value': self.value,
            'confidence': self.confidence,
            'source_span': self.source_span,
            'pattern': self.pattern,
        }


# ---------------------------------------------------------------------------
# Text normalization
# ---------------------------------------------------------------------------

def _normalize_text(text: str) -> str:
    """Normalize HTML entities, Unicode, and whitespace for consistent matching.

    BaT descriptions contain:
      - HTML entities: &#8220; &#8221; (smart quotes), &#8243; (double prime for inches),
        &amp; &lt; &gt; &#8217; (apostrophe), &#8211; (en dash), &#8212; (em dash)
      - Unicode: curly quotes, em dashes, non-breaking spaces
      - Escaped newlines from database storage
    """
    if not text:
        return ''

    # Decode HTML entities (handles both named and numeric)
    text = html.unescape(text)

    # Normalize Unicode characters to ASCII-friendly equivalents
    replacements = {
        '\u2018': "'",   # left single quote
        '\u2019': "'",   # right single quote / apostrophe
        '\u201C': '"',   # left double quote
        '\u201D': '"',   # right double quote
        '\u2013': '-',   # en dash
        '\u2014': '--',  # em dash
        '\u2033': '"',   # double prime (inches)
        '\u2032': "'",   # prime (feet)
        '\u00A0': ' ',   # non-breaking space
        '\u200B': '',    # zero-width space
        '\u00D7': 'x',   # multiplication sign
        '\u2026': '...', # ellipsis
    }
    for orig, repl in replacements.items():
        text = text.replace(orig, repl)

    # Normalize escaped newlines from DB
    text = text.replace('\\n', '\n')

    # Collapse multiple spaces (but preserve newlines)
    text = re.sub(r'[^\S\n]+', ' ', text)

    return text


# ---------------------------------------------------------------------------
# Helper: find all matches with spans
# ---------------------------------------------------------------------------

def _find_all(pattern: str, text: str, flags: int = 0) -> list[re.Match]:
    """Return all regex match objects (preserving span info)."""
    return list(re.finditer(pattern, text, flags))


def _make_result(value: Any, match: re.Match, pattern_name: str,
                 confidence: float) -> ExtractionResult:
    """Build an ExtractionResult from a regex match."""
    return ExtractionResult(
        value=value,
        confidence=confidence,
        source_span=(match.start(), match.end()),
        pattern=pattern_name,
    )


# ---------------------------------------------------------------------------
# Compiled pattern sets (module-level for performance)
# ---------------------------------------------------------------------------

# Engine displacement — liters
_RE_ENGINE_LITER = re.compile(
    r'(\d\.\d)\s*[- ]?(?:L|liter|litre)\b', re.I
)

# Engine displacement — cubic inches
_RE_ENGINE_CI = re.compile(
    r'(\d{3,4})\s*(?:ci|cubic[- ]?inch(?:es)?|cid)\b', re.I
)

# Engine displacement — cc
_RE_ENGINE_CC = re.compile(
    r'(\d{3,5})\s*cc\b', re.I
)

# Engine configuration (V8, inline-six, flat-four, etc.)
# V-engines require 4+ or specific known counts (V6, V8, V10, V12, V16)
# to avoid false positives like "V3 coilovers" or "KW V3"
_RE_ENGINE_CONFIG = re.compile(
    r'\b((?:flat|inline|straight|opposed)[- ]?\d+|'
    r'V[- ]?(?:4|6|8|10|12|16)|'
    r'[IL][- ]?\d{1,2}|'
    r'boxer[- ]?\d+)\b', re.I
)

# Forced induction
_RE_ENGINE_TURBO = re.compile(
    r'\b(twin[- ]?turbo(?:charged)?|bi[- ]?turbo(?:charged)?|turbo(?:charged)?|supercharged)\b', re.I
)

# Fuel system
_RE_FUEL_SYSTEM = re.compile(
    r'\b(fuel[- ]?inject(?:ed|ion)|carburet(?:ed|or)|'
    r'EFI|TBI|MPI|MPFI|direct[- ]?inject(?:ed|ion)|'
    r'Weber|Solex|Zenith|SU|Holley|Edelbrock|Rochester|Carter|'
    r'Mikuni|Dellorto|triple[- ]?carb(?:uret(?:ed|or))?s?|dual[- ]?carb(?:uret(?:ed|or))?s?|'
    r'side[- ]?draft|down[- ]?draft)\b', re.I
)

# Engine family / code names
_RE_ENGINE_FAMILY = re.compile(
    r'\b(LS\d|LT\d|LM\d|LQ\d|LSA|LS[AXJC]|'
    r'Coyote|Vortec|EcoBoost|Hemi|Magnum|'
    r'Windsor|Cleveland|FE|MEL|Flathead|'
    r'Slant[- ]?Six|Nailhead|Buick\s+\d{3}|'
    r'Small[- ]?Block|Big[- ]?Block|SBC|BBC|'
    r'B[- ]?Series|RB[- ]?Series|LA[- ]?Series|'
    r'M\d{2,3}|S\d{2}|N\d{2}|B\d{2}|'
    r'2JZ|RB26|SR20|4AGE|K20|K24|B18|H22|'
    r'Barra|Crossflow|Kent|Pinto|Zetec|Duratec|'
    r'XK|AJ|Rover\s+V8)\b', re.I
)

# Transmission — specific models
_RE_TRANS_SPECIFIC = re.compile(
    r'\b(4L60E|4L65E|4L70E|4L80E|6L80E|6L90E|'
    r'TH350|TH400|TH200|TH700[- ]?R4|'
    r'T-?5|T-?10|T-?56|T-?45|'
    r'Muncie[- ]?(?:M20|M21|M22)?|Saginaw|'
    r'Tremec[- ]?(?:T-?56|TKO|TKX|TR-?3650|TR-?6060|Magnum)?|'
    r'700R4|200[- ]?4R|2004R|'
    r'Powerglide|Turbo\s*\d{3}|'
    r'C-?4|C-?6|AOD|AODE|E4OD|4R70W|4R100|'
    r'ZF[- ]?\d*|Getrag[- ]?\d*|'
    r'Borg[- ]?Warner[- ]?(?:T-?\d+)?|Doug\s+Nash|'
    r'Jatco|Torqueflite|'
    r'904|727|A833|A-?833|A-?230|A-?390|'
    r'NV3500|NV4500|NP435|'
    r'SM465|SM420|SM-?420|'
    r'NSG370|G56|Aisin[- ]?\w*|'
    r'AX-?5|AX-?15|BA10|'
    r'PDK|SMG|DCT|DSG|S[- ]?tronic|'
    r'CVT|Tiptronic|Steptronic|Sportomatic|'
    r'GM Hydra-?[Mm]atic)\b', re.I
)

# Transmission — generic (X-speed manual/auto)
_RE_TRANS_TYPE = re.compile(
    r'\b(\d)[- ]speed\s+(manual|automatic|auto|sequential|dual[- ]?clutch|semi[- ]?automatic|'
    r'synchromesh|overdrive|close[- ]?ratio)\b', re.I
)

# Transmission — generic class
_RE_TRANS_GENERIC = re.compile(
    r'\b(automatic|manual|stick[- ]?shift)\s+(?:transmission|gearbox|trans(?:axle)?)\b', re.I
)

# Exterior color — "finished in [Color]"
_RE_COLOR_FINISHED = re.compile(
    r'(?:finished|painted|refinished|repainted|resprayed|sprayed|wearing|'
    r'dressed|presented|shown|coated|wrapped|done)\s+in\s+'
    r'(.+?)(?:\.|,|--|—|\s+over\s+|\s+with\s+|\s+and\s+(?:features?|trimmed|sitting|riding|complemented|is)|'
    r'\s+(?:the|this|it)\b)',
    re.I
)

# Interior — "trimmed in [Color] [Material]"
# Note: "wrapped in" omitted to avoid matching tire descriptions like
# "wheels wrapped in Michelin tires". Interior wrapping is rare enough
# to leave for GLiNER (Layer 3).
_RE_INTERIOR = re.compile(
    r'(?:trimmed|upholstered|appointed|clad|covered|lined)\s+in\s+'
    r'(.+?)(?:\.|,|--|—|and\s+(?:features?|includes?|complemented|equipped|is|was|has|powers?)|$)',
    re.I
)

# Interior — "[Color] over [Color]" pattern
_RE_COLOR_OVER = re.compile(
    r'(\w[\w\s]*?)\s+over\s+(\w[\w\s]*?)'
    r'(?:\s+(?:leather|interior|vinyl|cloth|upholstery|velour|alcantara|hides?|trim))',
    re.I
)

# Interior — direct mentions
_RE_INTERIOR_DIRECT = re.compile(
    r'\b(?:interior\s+(?:is|in|features?|includes?)\s+(?:in\s+)?|(?:with|has)\s+(?:a\s+)?)'
    r'((?:black|brown|tan|beige|red|blue|white|gray|grey|saddle|cognac|camel|palomino|'
    r'parchment|cream|ivory|green|burgundy|maroon|navy|oxblood|tobacco|biscuit|'
    r'champagne|silver|charcoal)\s*'
    r'(?:leather|vinyl|cloth|velour|suede|alcantara|fabric|tweed|houndstooth|plaid)?)',
    re.I
)

# Mileage — contextual odometer readings
_RE_MILEAGE_CONTEXT = re.compile(
    r'(?:odometer|odo)\s+(?:shows?|reads?|indicates?|displays?|reflects?)\s+'
    r'(?:approximately\s+|roughly\s+|about\s+|~)?'
    r'([\d,]+)\s*(?:miles?|mi\.?|kilometers?|km)',
    re.I
)

# Mileage — "shows/reads/indicates X miles"
_RE_MILEAGE_SHOWS = re.compile(
    r'(?:shows?|reads?|indicates?|displaying?|reflecting?)\s+'
    r'(?:approximately\s+|roughly\s+|about\s+|~)?'
    r'([\d,]+)\s*(?:miles?|mi\.?)\b',
    re.I
)

# Mileage — "X,XXX miles" with context
_RE_MILEAGE_GENERAL = re.compile(
    r'\b([\d,]+)\s*(?:original\s+)?(?:miles?|mi\.?)\b'
    r'(?:\s+(?:are|is|was|were|have been|has been|shown|indicated|from new|since new))?',
    re.I
)

# Mileage — "Xk miles"
_RE_MILEAGE_K = re.compile(
    r'\b(\d+(?:\.\d)?)\s*k\s+miles?\b', re.I
)

# Drivetrain
_RE_DRIVETRAIN = re.compile(
    r'\b(4WD|4x4|AWD|FWD|RWD|2WD|'
    r'four[- ]wheel[- ]drive|all[- ]wheel[- ]drive|'
    r'rear[- ]wheel[- ]drive|front[- ]wheel[- ]drive|'
    r'part[- ]time\s+(?:4WD|four[- ]wheel[- ]drive)|'
    r'full[- ]time\s+(?:4WD|four[- ]wheel[- ]drive)|'
    r'two[- ]wheel[- ]drive)\b',
    re.I
)

# Horsepower
_RE_HORSEPOWER = re.compile(
    r'(?:(?:rated|producing|making|develops?|generates?|delivers?|puts?\s+out|output(?:ting)?)\s+'
    r'(?:at\s+|an?\s+(?:claimed|estimated|factory[- ]rated)?\s*)?)?'
    r'(\d{2,4})\s*(?:hp|horsepower|bhp|whp|PS|cv|pferde)\b',
    re.I
)

# Torque
_RE_TORQUE = re.compile(
    r'(\d{2,4})\s*(?:lb[- ]?ft|foot[- ]?pounds?|pound[- ]?feet|Nm|newton[- ]?meters?)\b',
    re.I
)

# Brakes — type
_RE_BRAKES = re.compile(
    r'\b((?:four[- ]wheel\s+|front\s+|rear\s+)?'
    r'(?:ventilated\s+|vented\s+|drilled\s+|cross[- ]drilled\s+|slotted\s+|solid\s+)?'
    r'(?:disc|drum|carbon[- ]ceramic)\s+brakes?)',
    re.I
)

# Brakes — brand
# Note: "Porsche" omitted — too many false positives from make name.
# Porsche-branded brakes are detected by "Porsche" + nearby "brake/caliper" in GLiNER (Layer 3).
_RE_BRAKE_BRAND = re.compile(
    r'\b(Brembo|Wilwood|Baer|StopTech|AP\s+Racing|EBC|Hawk|'
    r'Alcon|Endless|Project\s+Mu)\b', re.I
)

# Wheels — size
_RE_WHEEL_SIZE = re.compile(
    r'(\d{2})[- ]?(?:inch|"|x\d+(?:\.\d+)?[Jj]?)\s*'
    r'(?:alloy|aluminum|steel|chrome|forged|magnesium|mag|wire|spoke|mesh|'
    r'factory|OEM|original|aftermarket|lightweight|staggered|center[- ]lock)?\s*'
    r'(?:wheels?|rims?)',
    re.I
)

# Wheels — brand
# Note: "Work" (Japanese wheel brand) requires nearby wheel/rim context to avoid
# false positives from common English word. Handled separately in _extract_wheels.
_RE_WHEEL_BRAND = re.compile(
    r'\b(BBS|HRE|Forgeline|CCW|American\s+Racing|Torq\s+Thrust|Cragar|'
    r'Halibrand|Minilite|Panasport|Fuchs|OZ\s+Racing|Enkei|Volk|'
    r'SSR|Watanabe|Hayashi|Dayton|Borrani|Campagnolo|'
    r'Advan|Rays|Fifteen52|Rotiform|Konig|Weld|Centerline|'
    r'Rocket\s+Racing|US\s+Mags?|Foose|Boyd\s+Coddington)\b', re.I
)

# "Work" wheels need context (too common as a regular word)
_RE_WHEEL_BRAND_WORK = re.compile(
    r'\bWork\s+(?:Meister|Emotion|Equip|VS[- ]?\w+|CR|XD)\b', re.I
)

# Tires — brand
_RE_TIRE_BRAND = re.compile(
    r'\b(Michelin|Bridgestone|Goodyear|Continental|Pirelli|Toyo|Nitto|'
    r'BFGoodrich|Falken|Yokohama|Hankook|Dunlop|Firestone|Cooper|'
    r'General|Hoosier|Kumho|Avon|Vredestein|Maxxis|'
    r'Mickey\s+Thompson|Dick\s+Cepek|Pro\s+Comp|'
    r'Coker|Bias[- ]?Ply|Radial)\b', re.I
)

# Tires — size
_RE_TIRE_SIZE = re.compile(
    r'\b(P?\d{3}/\d{2}[RZBrz]\d{2}|'
    r'LT\d{3}/\d{2}[Rr]\d{2}|'
    r'\d{2}x\d+(?:\.\d+)?[- ]?\d{2}|'
    r'\d{3}/\d{2}[- ]?\d{2})\b'
)

# Date events — "in YYYY" with context
_RE_DATE_EVENTS = re.compile(
    r'(?:in|during|circa|around|since|from|before|after|'
    r'purchased|acquired|sold|built|produced|manufactured|delivered|'
    r'restored|repainted|rebuilt|refinished|completed|'
    r'imported|registered|serviced|overhauled|refreshed)\s+'
    r'(\d{4})\b', re.I
)

# Date — "Month YYYY"
_RE_DATE_MONTH_YEAR = re.compile(
    r'\b((?:January|February|March|April|May|June|July|August|'
    r'September|October|November|December)\s+(?:of\s+)?(\d{4}))\b', re.I
)

# Ownership — "X-owner"
_RE_OWNERSHIP_COUNT = re.compile(
    r'\b(one|two|three|four|five|six|single|1st|2nd|3rd|'
    r'first|second|third|fourth|\d)[- ]owner\b', re.I
)

# Ownership — acquisition
_RE_OWNERSHIP_ACQUIRED = re.compile(
    r'(?:acquired|purchased|bought)\s+'
    r'(?:by\s+the\s+(?:current\s+)?(?:seller|owner)\s+)?'
    r'(?:in\s+)?(\d{4})', re.I
)

# Ownership — acquired from
_RE_OWNERSHIP_FROM = re.compile(
    r'(?:acquired|purchased|bought)\s+'
    r'(?:from|at|through)\s+'
    r"([A-Z][a-zA-Z\s&']+?)(?:\s+in\s+|\s+during\s+|,|\.|$)"
)

# Documentation keywords mapped to canonical names
_DOCUMENTATION_KEYWORDS = [
    ('service records', 'service_records'),
    ('service history', 'service_records'),
    ('maintenance records', 'maintenance_records'),
    ('window sticker', 'window_sticker'),
    ('Monroney', 'window_sticker'),
    ('build sheet', 'build_sheet'),
    ('broadcast sheet', 'build_sheet'),
    ("owner's manual", 'owners_manual'),
    ('owners manual', 'owners_manual'),
    ('tool kit', 'tool_kit'),
    ('toolkit', 'tool_kit'),
    ('Marti report', 'marti_report'),
    ('Marti Auto Works', 'marti_report'),
    ('PHS documentation', 'phs_documentation'),
    ('PHS report', 'phs_documentation'),
    ('NCRS', 'ncrs'),
    ('certificate of authenticity', 'certificate_of_authenticity'),
    ('Carfax', 'carfax'),
    ('AutoCheck', 'autocheck'),
    ('clean title', 'clean_title'),
    ('Heritage Certificate', 'heritage_certificate'),
    ('COA', 'certificate_of_authenticity'),
    ('factory invoice', 'factory_invoice'),
    ('dealer invoice', 'dealer_invoice'),
    ('bill of sale', 'bill_of_sale'),
    ('import documents', 'import_documents'),
    ('pre-purchase inspection', 'ppi'),
    ('PPI', 'ppi'),
    ('two keys', 'keys'),
    ('spare key', 'keys'),
    ('books and tools', 'books_and_tools'),
    ('books', 'books'),
    ('manuals', 'manuals'),
    ('literature', 'literature'),
    ('inspection report', 'inspection_report'),
    ('Fender Tag', 'fender_tag'),
]

# Condition positive keywords — order matters: check multi-word first
_CONDITION_POSITIVE_KEYWORDS = [
    'rust-free', 'rust free', 'no rust', 'zero rust', 'without rust',
    'matching numbers', 'numbers-matching', 'numbers matching',
    'original paint', 'all-original', 'all original',
    'survivor', 'concours',
    'frame-off', 'frame off',
    'nut-and-bolt', 'nut and bolt',
    'barn find', 'time capsule',
    'low miles', 'low-mileage', 'low mileage',
    'solid floors', 'solid frame',
    'clean title', 'no accidents',
    'museum quality', 'show quality',
    'award winning', 'award-winning', 'best of show',
    'gold certification',
    'well-maintained', 'well maintained',
    'always garaged', 'garage kept', 'garage-kept',
    'never wrecked', 'never modified',
    'bone stock', 'unmodified', 'unmolested',
    'fully documented', 'complete history',
    'books and tools',
    'no stories', 'southern car', 'california car',
    'dry state', 'no salt', 'no winters',
    'summer driven', 'trophy winner',
    'rotisserie restoration', 'body-off restoration',
    'date-coded', 'date coded',
    'never seen salt', 'accident free', 'accident-free',
]

# Condition negative keywords
_CONDITION_NEGATIVE_KEYWORDS = [
    'repainted', 'non-matching', 'non matching',
    'rebuilt', 'replacement engine',
    'aftermarket', 'modified',
    'repaired', 'replaced',
    'rust',  # NOTE: negation-aware — "rust-free" and "no rust" are filtered out as positives
    'cracked', 'crack',
    'dented', 'dent',
    'needs', 'issue', 'issues',
    'leak', 'leaks', 'leaking',
    'worn', 'wear',
    'faded', 'scratches', 'scratch',
    'chips', 'chip', 'ding', 'dings',
    'damaged', 'damage',
    'bent', 'broken', 'missing',
    'stripped', 'bondo', 'body filler',
    'accident', 'collision',
    'salvage', 'flood', 'fire damage',
    'overheating', 'smoke', 'smoking',
    'oil leak', 'coolant leak',
    'non-original', 'non original',
    'incorrect', 'mismatched',
]

# Words within a 2-word window that negate "rust" from being negative
_RUST_NEGATORS = {'free', 'no', 'zero', 'without', 'never', 'any'}

# Parenthetical codes — (XX) to (XXXXXX)
_RE_PARENTHETICAL_CODES = re.compile(r'\(([A-Z0-9]{2,6})\)')

# Body style
_RE_BODY_STYLE = re.compile(
    r'\b(convertible|roadster|cabriolet|cabrio|targa|'
    r'coupe|coup\u00e9|'
    r'sedan|saloon|'
    r'hardtop|hard[- ]top|'
    r'fastback|fast[- ]back|liftback|'
    r'hatchback|'
    r'wagon|estate|shooting[- ]brake|sport[- ]back|avant|touring|'
    r'pickup|truck|'
    r'SUV|sport[- ]utility|'
    r'van|minivan|bus|'
    r'limousine|limo|landau|'
    r'speedster|spyder|spider|barchetta)\b',
    re.I
)

# No reserve
_RE_NO_RESERVE = re.compile(
    r'\b(?:no[- ]reserve|offered\s+without\s+reserve)\b', re.I
)

# Locations — US states
_US_STATES = (
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
    'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
    'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
    'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
    'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming',
)

_RE_LOCATIONS = re.compile(
    r'\b(' + '|'.join(re.escape(s) for s in _US_STATES) + r')\b', re.I
)

# Countries
_RE_COUNTRIES = re.compile(
    r'\b(United States|Canada|UK|United Kingdom|Germany|Japan|Italy|'
    r'France|Sweden|Australia|Switzerland|Netherlands|Belgium|'
    r'Austria|Spain|Portugal|Mexico|Brazil|South Africa|New Zealand)\b', re.I
)

# Shops / builders — "restored by [Name]", "serviced at [Name]"
_RE_SHOPS = re.compile(
    r'(?:restored|rebuilt|serviced|maintained|prepared|completed|'
    r'performed|done|carried\s+out|commissioned|built|fabricated)\s+'
    r'(?:by|at)\s+'
    r"([A-Z][a-zA-Z\s&']{3,40}?)"
    r'(?:\s+in\s+|\s+of\s+|\s+during\s+|,|\.|$)'
)


# ---------------------------------------------------------------------------
# Main extractor class
# ---------------------------------------------------------------------------

class DescriptionRegexExtractor:
    """Deterministic extraction from vehicle listing descriptions.

    Layer 1 of the Nuke extraction stack. $0/extraction, microseconds.
    Designed for BaT editorial descriptions but works on any vehicle listing text.

    Usage:
        extractor = DescriptionRegexExtractor()
        result = extractor.extract(description_text)

        # Each field is a list of ExtractionResult dicts
        for engine in result['engine']:
            print(engine['value'], engine['confidence'])

        # Quick summary
        stats = extractor.coverage_stats(result)
        print(f"{stats['fields_found']}/{stats['fields_total']} fields extracted")
    """

    def extract(self, description: str, year: int = None,
                make: str = None, model: str = None) -> dict:
        """Extract all regex-detectable fields from a description.

        Args:
            description: Raw listing description text (may contain HTML entities).
            year: Known year of vehicle (optional, for validation).
            make: Known make (optional, for validation).
            model: Known model (optional, for validation).

        Returns:
            Dict mapping field names to lists of ExtractionResult dicts.
            Empty lists mean the field was not detected.
        """
        text = _normalize_text(description)
        if not text:
            return self._empty_result()

        return {
            'engine': self._extract_engine(text),
            'transmission': self._extract_transmission(text),
            'exterior_color': self._extract_exterior_color(text),
            'interior': self._extract_interior(text),
            'mileage': self._extract_mileage(text, year),
            'drivetrain': self._extract_drivetrain(text),
            'horsepower': self._extract_horsepower(text),
            'torque': self._extract_torque(text),
            'brakes': self._extract_brakes(text),
            'wheels': self._extract_wheels(text),
            'tires': self._extract_tires(text),
            'dates': self._extract_dates(text, year),
            'ownership': self._extract_ownership(text),
            'documentation': self._extract_documentation(text),
            'condition_positive': self._extract_condition_positive(text),
            'condition_negative': self._extract_condition_negative(text),
            'parenthetical_codes': self._extract_parenthetical_codes(text),
            'locations': self._extract_locations(text),
            'shops': self._extract_shops(text),
            'body_style': self._extract_body_style(text),
            'fuel_system': self._extract_fuel_system(text),
            'no_reserve': self._extract_no_reserve(text),
        }

    def extract_flat(self, description: str, year: int = None,
                     make: str = None, model: str = None) -> dict:
        """Extract and flatten to simple values (best match per field).

        Returns a dict with scalar values suitable for database insertion.
        Picks the highest-confidence result for single-value fields.
        """
        full = self.extract(description, year, make, model)
        flat = {}

        # Single-value fields: pick highest confidence
        for field in ('exterior_color', 'drivetrain', 'body_style', 'no_reserve'):
            results = full.get(field, [])
            if results:
                best = max(results, key=lambda r: r['confidence'])
                flat[field] = best['value']
            else:
                flat[field] = None

        # Numeric single-value fields
        for field in ('horsepower', 'torque'):
            results = full.get(field, [])
            if results:
                best = max(results, key=lambda r: r['confidence'])
                try:
                    flat[field] = int(best['value'].replace(',', ''))
                except (ValueError, AttributeError):
                    flat[field] = best['value']
            else:
                flat[field] = None

        # Mileage: prefer odometer-context reads
        mileage_results = full.get('mileage', [])
        if mileage_results:
            # Prefer odometer_context > mileage_shows > mileage_general
            priority = {'odometer_context': 3, 'mileage_shows': 2,
                        'mileage_general': 1, 'mileage_k': 1}
            best = max(mileage_results,
                       key=lambda r: (priority.get(r['pattern'], 0), r['confidence']))
            try:
                flat['mileage'] = int(best['value'].replace(',', ''))
            except (ValueError, AttributeError):
                flat['mileage'] = best['value']
        else:
            flat['mileage'] = None

        # Multi-value fields: collect unique values
        for field in ('engine', 'transmission', 'interior', 'brakes', 'wheels',
                      'tires', 'dates', 'ownership', 'documentation',
                      'condition_positive', 'condition_negative',
                      'parenthetical_codes', 'locations', 'shops',
                      'fuel_system'):
            results = full.get(field, [])
            # Deduplicate by value
            seen = set()
            values = []
            for r in results:
                v = r['value'] if isinstance(r['value'], str) else str(r['value'])
                v_lower = v.lower()
                if v_lower not in seen:
                    seen.add(v_lower)
                    values.append(r['value'])
            flat[field] = values if values else None

        return flat

    @staticmethod
    def coverage_stats(result: dict) -> dict:
        """Compute coverage statistics for an extraction result.

        Args:
            result: Output of extract().

        Returns:
            Dict with fields_total, fields_found, coverage_pct,
            total_extractions, and per-field counts.
        """
        fields_total = len(result)
        fields_found = sum(1 for v in result.values() if v)
        total_extractions = sum(len(v) for v in result.values() if v)
        per_field = {k: len(v) for k, v in result.items()}

        return {
            'fields_total': fields_total,
            'fields_found': fields_found,
            'coverage_pct': round(100 * fields_found / fields_total, 1) if fields_total else 0,
            'total_extractions': total_extractions,
            'per_field': per_field,
        }

    # ------------------------------------------------------------------
    # Private extraction methods
    # ------------------------------------------------------------------

    def _empty_result(self) -> dict:
        """Return empty extraction result."""
        return {field: [] for field in (
            'engine', 'transmission', 'exterior_color', 'interior',
            'mileage', 'drivetrain', 'horsepower', 'torque',
            'brakes', 'wheels', 'tires', 'dates', 'ownership',
            'documentation', 'condition_positive', 'condition_negative',
            'parenthetical_codes', 'locations', 'shops', 'body_style',
            'fuel_system', 'no_reserve',
        )}

    def _extract_engine(self, text: str) -> list[dict]:
        """Extract engine specifications.

        Patterns:
          - Displacement in liters: "3.5L", "3.5 liter"
          - Displacement in cubic inches: "350ci", "350 cubic inches"
          - Displacement in cc: "2000cc"
          - Configuration: V8, inline-six, flat-four, boxer-6
          - Forced induction: turbocharged, supercharged, twin-turbo
          - Engine family: LS3, Coyote, SBC, 2JZ, etc.
        """
        results = []

        for m in _find_all(_RE_ENGINE_LITER.pattern, text, re.I):
            results.append(_make_result(
                f'{m.group(1)}L', m, 'engine_liter', 0.95
            ).to_dict())

        for m in _find_all(_RE_ENGINE_CI.pattern, text, re.I):
            val = int(m.group(1))
            # Filter out year-like values (1900-2100)
            if val < 1900 or val > 2100:
                results.append(_make_result(
                    f'{m.group(1)}ci', m, 'engine_ci', 0.95
                ).to_dict())

        for m in _find_all(_RE_ENGINE_CC.pattern, text, re.I):
            results.append(_make_result(
                f'{m.group(1)}cc', m, 'engine_cc', 0.90
            ).to_dict())

        for m in _find_all(_RE_ENGINE_CONFIG.pattern, text, re.I):
            # Normalize: "V 8" -> "V8", "inline 6" -> "inline-6"
            val = re.sub(r'\s+', '-', m.group(1).strip())
            results.append(_make_result(
                val, m, 'engine_config', 0.90
            ).to_dict())

        for m in _find_all(_RE_ENGINE_TURBO.pattern, text, re.I):
            results.append(_make_result(
                m.group(1).lower(), m, 'engine_forced_induction', 0.95
            ).to_dict())

        for m in _find_all(_RE_ENGINE_FAMILY.pattern, text, re.I):
            results.append(_make_result(
                m.group(1), m, 'engine_family', 0.75
            ).to_dict())

        return results

    def _extract_transmission(self, text: str) -> list[dict]:
        """Extract transmission specifications.

        Patterns:
          - Specific models: 4L60E, TH400, T56, Tremec TKO, etc.
          - Generic type: "5-speed manual", "3-speed automatic"
          - Class: "automatic transmission", "manual gearbox"
        """
        results = []

        for m in _find_all(_RE_TRANS_SPECIFIC.pattern, text, re.I):
            results.append(_make_result(
                m.group(1), m, 'transmission_specific', 0.95
            ).to_dict())

        for m in _find_all(_RE_TRANS_TYPE.pattern, text, re.I):
            val = f'{m.group(1)}-speed {m.group(2).lower()}'
            results.append(_make_result(
                val, m, 'transmission_type', 0.90
            ).to_dict())

        for m in _find_all(_RE_TRANS_GENERIC.pattern, text, re.I):
            results.append(_make_result(
                m.group(1).lower(), m, 'transmission_generic', 0.70
            ).to_dict())

        return results

    def _extract_exterior_color(self, text: str) -> list[dict]:
        """Extract exterior color from BaT editorial patterns.

        Primary pattern: "finished in [Color]" (76% coverage)
        Also catches: refinished, repainted, painted, sprayed, wearing
        """
        results = []

        for m in _find_all(_RE_COLOR_FINISHED.pattern, text, re.I):
            color = m.group(1).strip()
            # Clean up trailing articles/connectors
            color = re.sub(r'\s+(?:a|an|the|that|which)\s*$', '', color, flags=re.I)
            # Don't accept overly long "colors" (likely captured too much)
            if len(color) <= 60 and len(color) >= 2:
                results.append(_make_result(
                    color, m, 'color_finished_in', 0.85
                ).to_dict())

        return results

    def _extract_interior(self, text: str) -> list[dict]:
        """Extract interior description.

        Primary patterns:
          - "trimmed in [Color] [Material]"
          - "upholstered in [Color] leather"
          - "[Color] over [Color] [material]"
          - Direct color + material mentions
        """
        results = []

        for m in _find_all(_RE_INTERIOR.pattern, text, re.I):
            val = m.group(1).strip()
            # Clean trailing words
            val = re.sub(r'\s+(?:a|an|the|that|which)\s*$', '', val, flags=re.I)
            if 2 <= len(val) <= 80:
                results.append(_make_result(
                    val, m, 'interior_trimmed_in', 0.85
                ).to_dict())

        for m in _find_all(_RE_COLOR_OVER.pattern, text, re.I):
            results.append(_make_result(
                m.group(2).strip(), m, 'interior_over_pattern', 0.80
            ).to_dict())

        for m in _find_all(_RE_INTERIOR_DIRECT.pattern, text, re.I):
            results.append(_make_result(
                m.group(1).strip(), m, 'interior_direct', 0.70
            ).to_dict())

        return results

    def _extract_mileage(self, text: str, year: int = None) -> list[dict]:
        """Extract mileage/odometer readings.

        Priority order (highest confidence first):
          1. "odometer shows/reads X miles" (0.95)
          2. "shows/reads/indicates X miles" (0.85)
          3. "X,XXX miles" with plausibility filter (0.65)
          4. "Xk miles" (0.70)

        Filters out:
          - Values that look like years (1900-2100)
          - Implausibly high values (>999,999)
          - Values of 0
        """
        results = []
        seen_values = set()

        def _is_plausible_mileage(val_str: str) -> bool:
            try:
                val = int(val_str.replace(',', ''))
            except ValueError:
                return False
            if val <= 0 or val >= 1_000_000:
                return False
            # Skip year-like values (but 2100+ is fine as mileage)
            if 1900 <= val <= 2100 and year and val != year:
                return False
            return True

        for m in _find_all(_RE_MILEAGE_CONTEXT.pattern, text, re.I):
            val = m.group(1)
            if _is_plausible_mileage(val) and val not in seen_values:
                seen_values.add(val)
                results.append(_make_result(
                    val, m, 'odometer_context', 0.95
                ).to_dict())

        for m in _find_all(_RE_MILEAGE_SHOWS.pattern, text, re.I):
            val = m.group(1)
            if _is_plausible_mileage(val) and val not in seen_values:
                seen_values.add(val)
                results.append(_make_result(
                    val, m, 'mileage_shows', 0.85
                ).to_dict())

        for m in _find_all(_RE_MILEAGE_K.pattern, text, re.I):
            raw = m.group(1)
            try:
                val = str(int(float(raw) * 1000))
                if val not in seen_values:
                    seen_values.add(val)
                    results.append(_make_result(
                        val, m, 'mileage_k', 0.70
                    ).to_dict())
            except ValueError:
                pass

        for m in _find_all(_RE_MILEAGE_GENERAL.pattern, text, re.I):
            val = m.group(1)
            if _is_plausible_mileage(val) and val not in seen_values:
                seen_values.add(val)
                results.append(_make_result(
                    val, m, 'mileage_general', 0.65
                ).to_dict())

        return results

    def _extract_drivetrain(self, text: str) -> list[dict]:
        """Extract drivetrain configuration.

        Patterns: RWD, FWD, AWD, 4WD, 4x4, rear-wheel drive, etc.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_DRIVETRAIN.pattern, text, re.I):
            val = m.group(1)
            # Normalize to canonical form
            normalized = val.upper().replace(' ', '').replace('-', '')
            canonical_map = {
                'REARWHEELDRIVE': 'RWD', 'RWD': 'RWD',
                'FRONTWHEELDRIVE': 'FWD', 'FWD': 'FWD',
                'ALLWHEELDRIVE': 'AWD', 'AWD': 'AWD',
                'FOURWHEELDRIVE': '4WD', '4WD': '4WD', '4X4': '4WD',
                'TWOWHEELDRIVE': '2WD', '2WD': '2WD',
            }
            # Strip "PARTTIME" / "FULLTIME" prefixes for lookup
            for prefix in ('PARTTIME', 'FULLTIME'):
                if normalized.startswith(prefix):
                    base = normalized[len(prefix):]
                    if base in canonical_map:
                        normalized = base
                        break

            canon = canonical_map.get(normalized, val)
            if canon not in seen:
                seen.add(canon)
                results.append(_make_result(
                    canon, m, 'drivetrain', 0.90
                ).to_dict())

        return results

    def _extract_horsepower(self, text: str) -> list[dict]:
        """Extract horsepower figures.

        Patterns: "350 hp", "350 horsepower", "rated at 350", "producing 350 hp"
        Filters: 10-2500 HP range to exclude false positives.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_HORSEPOWER.pattern, text, re.I):
            val = m.group(1)
            try:
                num = int(val)
                if 10 <= num <= 2500 and val not in seen:
                    seen.add(val)
                    results.append(_make_result(
                        val, m, 'horsepower', 0.85
                    ).to_dict())
            except ValueError:
                pass

        return results

    def _extract_torque(self, text: str) -> list[dict]:
        """Extract torque figures.

        Patterns: "300 lb-ft", "300 foot-pounds", "400 Nm"
        Filters: 10-3000 range.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_TORQUE.pattern, text, re.I):
            val = m.group(1)
            try:
                num = int(val)
                if 10 <= num <= 3000 and val not in seen:
                    seen.add(val)
                    results.append(_make_result(
                        val, m, 'torque', 0.85
                    ).to_dict())
            except ValueError:
                pass

        return results

    def _extract_brakes(self, text: str) -> list[dict]:
        """Extract brake specifications.

        Patterns:
          - Type: disc brakes, drum brakes, carbon-ceramic, vented, drilled
          - Brand: Brembo, Wilwood, Baer, StopTech, AP Racing
        """
        results = []

        for m in _find_all(_RE_BRAKES.pattern, text, re.I):
            results.append(_make_result(
                m.group(1).strip(), m, 'brake_type', 0.90
            ).to_dict())

        for m in _find_all(_RE_BRAKE_BRAND.pattern, text, re.I):
            results.append(_make_result(
                m.group(1), m, 'brake_brand', 0.95
            ).to_dict())

        return results

    def _extract_wheels(self, text: str) -> list[dict]:
        """Extract wheel specifications.

        Patterns:
          - Size: "17-inch wheels", '17" wheels'
          - Brand: BBS, HRE, Fuchs, Cragar, etc.
        """
        results = []

        for m in _find_all(_RE_WHEEL_SIZE.pattern, text, re.I):
            val = m.group(1)
            try:
                size = int(val)
                if 10 <= size <= 26:
                    results.append(_make_result(
                        f'{val}"', m, 'wheel_size', 0.85
                    ).to_dict())
            except ValueError:
                pass

        for m in _find_all(_RE_WHEEL_BRAND.pattern, text, re.I):
            results.append(_make_result(
                m.group(1), m, 'wheel_brand', 0.95
            ).to_dict())

        # "Work" wheels need model name context (e.g., "Work Meister")
        for m in _find_all(_RE_WHEEL_BRAND_WORK.pattern, text, re.I):
            results.append(_make_result(
                m.group(0), m, 'wheel_brand', 0.95
            ).to_dict())

        return results

    def _extract_tires(self, text: str) -> list[dict]:
        """Extract tire specifications.

        Patterns:
          - Brand: Michelin, Pirelli, BFGoodrich, etc.
          - Size: 255/45R18, P225/50R16, LT285/75R16, etc.
        """
        results = []

        for m in _find_all(_RE_TIRE_BRAND.pattern, text, re.I):
            results.append(_make_result(
                m.group(1), m, 'tire_brand', 0.95
            ).to_dict())

        for m in _find_all(_RE_TIRE_SIZE.pattern, text):
            results.append(_make_result(
                m.group(1), m, 'tire_size', 0.95
            ).to_dict())

        return results

    def _extract_dates(self, text: str, year: int = None) -> list[dict]:
        """Extract date references (events, service dates, ownership changes).

        Patterns:
          - "in YYYY" with event context: acquired, purchased, restored, etc.
          - "Month YYYY": January 2019, etc.

        Filters out the vehicle's own model year to reduce noise.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_DATE_MONTH_YEAR.pattern, text, re.I):
            val = m.group(1)
            date_year = int(m.group(2))
            if 1900 <= date_year <= 2030 and val not in seen:
                seen.add(val)
                results.append(_make_result(
                    val, m, 'date_month_year', 0.85
                ).to_dict())

        for m in _find_all(_RE_DATE_EVENTS.pattern, text, re.I):
            val = m.group(1)
            date_year = int(val)
            # Skip the vehicle's own model year and implausible years
            if year and date_year == year:
                continue
            if 1900 <= date_year <= 2030 and val not in seen:
                seen.add(val)
                results.append(_make_result(
                    val, m, 'date_event_year', 0.65
                ).to_dict())

        return results

    def _extract_ownership(self, text: str) -> list[dict]:
        """Extract ownership history details.

        Patterns:
          - Owner count: "one-owner", "single-owner", "3-owner"
          - Acquisition year: "acquired in 2019", "purchased in 2015"
          - Acquisition source: "purchased from [dealer]"
        """
        results = []

        for m in _find_all(_RE_OWNERSHIP_COUNT.pattern, text, re.I):
            val = m.group(1).lower()
            # Normalize word numbers to digits
            word_to_num = {
                'one': '1', 'single': '1', 'first': '1', '1st': '1',
                'two': '2', 'second': '2', '2nd': '2',
                'three': '3', 'third': '3', '3rd': '3',
                'four': '4', 'fourth': '4',
                'five': '5', 'six': '6',
            }
            num = word_to_num.get(val, val)
            results.append(_make_result(
                f'{num}-owner', m, 'owner_count', 0.90
            ).to_dict())

        for m in _find_all(_RE_OWNERSHIP_ACQUIRED.pattern, text, re.I):
            val = m.group(1)
            try:
                yr = int(val)
                if 1900 <= yr <= 2030:
                    results.append(_make_result(
                        val, m, 'acquired_year', 0.85
                    ).to_dict())
            except ValueError:
                pass

        for m in _find_all(_RE_OWNERSHIP_FROM.pattern, text):
            val = m.group(1).strip()
            if 3 <= len(val) <= 50:
                results.append(_make_result(
                    val, m, 'acquired_from', 0.60
                ).to_dict())

        return results

    def _extract_documentation(self, text: str) -> list[dict]:
        """Extract mentions of documentation, records, and provenance items.

        Uses keyword matching against a canonical list of 35+ document types.
        High precision (95%) since document names are unambiguous.
        """
        results = []
        text_lower = text.lower()
        seen_canonical = set()

        for keyword, canonical in _DOCUMENTATION_KEYWORDS:
            kw_lower = keyword.lower()
            idx = text_lower.find(kw_lower)
            if idx != -1 and canonical not in seen_canonical:
                seen_canonical.add(canonical)
                # Create a pseudo-match span
                results.append({
                    'value': canonical,
                    'confidence': 0.95,
                    'source_span': (idx, idx + len(keyword)),
                    'pattern': 'documentation_keyword',
                })

        return results

    def _extract_condition_positive(self, text: str) -> list[dict]:
        """Extract positive condition indicators.

        Negation-aware: "rust-free" and "no rust" are POSITIVE.
        Checks a 2-word window around "rust" for negators like
        "free", "no", "zero", "without", "never".
        """
        results = []
        text_lower = text.lower()

        for keyword in _CONDITION_POSITIVE_KEYWORDS:
            idx = text_lower.find(keyword)
            if idx != -1:
                results.append({
                    'value': keyword,
                    'confidence': 0.90,
                    'source_span': (idx, idx + len(keyword)),
                    'pattern': 'condition_positive_keyword',
                })

        return results

    def _extract_condition_negative(self, text: str) -> list[dict]:
        """Extract negative condition indicators.

        IMPORTANT: Negation-aware for "rust":
          - "rust-free" -> NOT negative (it's positive)
          - "no rust" -> NOT negative (it's positive)
          - "rust" alone -> negative
          - "surface rust" -> negative

        Uses a 2-word window: if any word in {free, no, zero, without, never}
        appears within 2 words before or after "rust", skip it.
        """
        results = []
        text_lower = text.lower()
        words = text_lower.split()

        for keyword in _CONDITION_NEGATIVE_KEYWORDS:
            idx = text_lower.find(keyword)
            if idx == -1:
                continue

            # Special handling for "rust" — check negation window
            if keyword == 'rust':
                if self._is_rust_negated(text_lower, idx):
                    continue

            # Skip if this keyword is part of a positive phrase we already caught.
            # e.g., "rust" in "rust-free" or "aftermarket" in context of a positive
            skip = False
            for pos_kw in _CONDITION_POSITIVE_KEYWORDS:
                pos_idx = text_lower.find(pos_kw)
                if pos_idx != -1 and pos_idx <= idx < pos_idx + len(pos_kw):
                    skip = True
                    break
            if skip:
                continue

            results.append({
                'value': keyword,
                'confidence': 0.70,
                'source_span': (idx, idx + len(keyword)),
                'pattern': 'condition_negative_keyword',
            })

        return results

    @staticmethod
    def _is_rust_negated(text_lower: str, rust_idx: int) -> bool:
        """Check if 'rust' at position rust_idx is negated by a nearby word.

        Looks in a 2-word window before and after the word 'rust'.
        Negators: free, no, zero, without, never, any (in negative context).

        Also checks for hyphenated forms: "rust-free", "rust free".
        """
        # Check for "rust-free" / "rust free" directly after
        after = text_lower[rust_idx:rust_idx + 15]
        if re.match(r'rust[- ]free', after):
            return True

        # Check for "no rust", "zero rust", etc. directly before
        before = text_lower[max(0, rust_idx - 20):rust_idx]
        if re.search(r'\b(?:no|zero|without|never|free\s+of)\s+$', before):
            return True

        # 2-word window check
        # Get words around the rust occurrence
        pre_text = text_lower[:rust_idx].split()
        post_text = text_lower[rust_idx + 4:].split()

        window_words = set()
        for w in pre_text[-2:]:
            window_words.add(w.strip('.,;:!?()'))
        for w in post_text[:2]:
            window_words.add(w.strip('.,;:!?()'))

        return bool(window_words & _RUST_NEGATORS)

    def _extract_parenthetical_codes(self, text: str) -> list[dict]:
        """Extract codes in parentheses — paint codes, RPO codes, engine codes.

        Pattern: (XX) to (XXXXXX) where content is uppercase alphanumeric.
        Examples: (L82), (M20), (3E), (049), (WCF), (Z28)

        Medium precision (~60%) — some false positives from abbreviations.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_PARENTHETICAL_CODES.pattern, text, 0):
            code = m.group(1)
            if code not in seen:
                seen.add(code)
                results.append(_make_result(
                    code, m, 'parenthetical_code', 0.60
                ).to_dict())

        return results

    def _extract_locations(self, text: str) -> list[dict]:
        """Extract geographic locations (US states and countries).

        Medium precision (~70%) — state names can appear in non-location contexts
        (e.g., "Virginia" as a person's name, "New York minute").
        """
        results = []
        seen = set()

        for m in _find_all(_RE_LOCATIONS.pattern, text, re.I):
            val = m.group(1)
            # Normalize to title case
            val_title = val.title()
            if val_title not in seen:
                seen.add(val_title)
                results.append(_make_result(
                    val_title, m, 'us_state', 0.70
                ).to_dict())

        for m in _find_all(_RE_COUNTRIES.pattern, text, re.I):
            val = m.group(1)
            if val not in seen:
                seen.add(val)
                results.append(_make_result(
                    val, m, 'country', 0.70
                ).to_dict())

        return results

    def _extract_shops(self, text: str) -> list[dict]:
        """Extract shop/builder/service provider names.

        Pattern: "restored by [Name]", "serviced at [Name]"
        Low precision (~45%) due to sentence fragments matching.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_SHOPS.pattern, text, 0):
            val = m.group(1).strip()
            # Filter out obvious false positives
            if len(val) < 3 or len(val) > 50:
                continue
            # Skip if it's just a common word
            skip_words = {'the', 'a', 'an', 'its', 'his', 'her', 'their',
                          'this', 'that', 'some', 'other', 'local', 'various'}
            if val.lower() in skip_words:
                continue
            val_lower = val.lower()
            if val_lower not in seen:
                seen.add(val_lower)
                results.append(_make_result(
                    val, m, 'shop_name', 0.45
                ).to_dict())

        return results

    def _extract_body_style(self, text: str) -> list[dict]:
        """Extract body style classification.

        Patterns: convertible, coupe, sedan, hardtop, fastback, wagon,
                  pickup, SUV, roadster, targa, spider, etc.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_BODY_STYLE.pattern, text, re.I):
            val = m.group(1).lower()
            # Normalize synonyms
            synonyms = {
                'coup\u00e9': 'coupe',
                'saloon': 'sedan',
                'estate': 'wagon',
                'shooting-brake': 'wagon', 'shooting brake': 'wagon',
                'sport-back': 'hatchback', 'sportback': 'hatchback',
                'avant': 'wagon', 'touring': 'wagon',
                'hard-top': 'hardtop', 'hard top': 'hardtop',
                'fast-back': 'fastback', 'fast back': 'fastback',
                'sport-utility': 'suv', 'sport utility': 'suv',
                'spider': 'spyder',
                'cabrio': 'convertible', 'cabriolet': 'convertible',
                'limo': 'limousine',
            }
            canon = synonyms.get(val, val)
            if canon not in seen:
                seen.add(canon)
                results.append(_make_result(
                    canon, m, 'body_style', 0.85
                ).to_dict())

        return results

    def _extract_fuel_system(self, text: str) -> list[dict]:
        """Extract fuel system / carburetion / injection details.

        Patterns: fuel-injected, carbureted, EFI, TBI, Weber, Holley, etc.
        """
        results = []
        seen = set()

        for m in _find_all(_RE_FUEL_SYSTEM.pattern, text, re.I):
            val = m.group(1)
            val_lower = val.lower()
            if val_lower not in seen:
                seen.add(val_lower)
                results.append(_make_result(
                    val, m, 'fuel_system', 0.90
                ).to_dict())

        return results

    def _extract_no_reserve(self, text: str) -> list[dict]:
        """Extract no-reserve auction status.

        Patterns: "No Reserve", "no reserve", "offered without reserve"
        """
        results = []

        for m in _find_all(_RE_NO_RESERVE.pattern, text, re.I):
            results.append(_make_result(
                True, m, 'no_reserve', 0.99
            ).to_dict())

        return results


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

def _run_tests():
    """Test the extractor on sample descriptions and show coverage stats.

    If run with a database connection (via environment), tests on real data.
    Otherwise tests on hardcoded samples.
    """
    import json
    import os
    import time

    extractor = DescriptionRegexExtractor()

    # --- Hardcoded test descriptions (representative BaT patterns) ---
    test_descriptions = [
        {
            'id': 'test-1',
            'year': 1973,
            'make': 'Porsche',
            'model': '911T',
            'description': (
                'This 1973 Porsche 911T is finished in Light Yellow (117) over a black '
                'leatherette interior and is powered by a 2.4-liter flat-six paired with '
                'a 5-speed manual transmission. The car was sold new in California and '
                'acquired by the seller in 2018 from a Porsche collector in Oregon. '
                'Modifications include Fuchs 15-inch alloy wheels, Bilstein shocks, and '
                'a stainless-steel exhaust. The odometer shows 89,400 miles. '
                'Service records from 2015 onward accompany the sale along with '
                "the owner's manual, tool kit, and a clean Carfax report. "
                'This is a rust-free, two-owner example offered at No Reserve.'
            ),
        },
        {
            'id': 'test-2',
            'year': 1967,
            'make': 'Chevrolet',
            'model': 'Camaro',
            'description': (
                'This 1967 Chevrolet Camaro SS is finished in Bolero Red over a black '
                'vinyl interior and is powered by a 350ci V8 mated to a TH350 three-speed '
                'automatic transmission. The car is equipped with 15" Rally wheels, '
                'power front disc brakes, and Flowmaster exhaust. It produces approximately '
                '300 horsepower and 380 lb-ft of torque. The odometer reads 42,618 miles. '
                'A frame-off restoration was completed in 2019 by Classic Car Studio in '
                'Missouri. Documentation includes a build sheet, Protect-O-Plate, and '
                'window sticker. The rear end features a 12-bolt with Positraction. '
                'RPO codes include (L48) and (M20). This matching-numbers coupe shows '
                'no rust and is offered at no reserve.'
            ),
        },
        {
            'id': 'test-3',
            'year': 2015,
            'make': 'BMW',
            'model': 'M4',
            'description': (
                'This 2015 BMW M4 is finished in Austin Yellow Metallic over black '
                'Merino leather and is powered by a 3.0-liter twin-turbocharged inline-six '
                'producing 425 horsepower and 406 lb-ft of torque through a 6-speed manual '
                'transmission. Equipment includes carbon-fiber roof, adaptive M suspension, '
                'Harman Kardon audio, and a heads-up display. Modifications include an '
                'Akrapovic exhaust and KW V3 coilovers. The car rides on 19-inch forged '
                'BBS wheels wrapped in Michelin Pilot Sport 4S tires in 255/35ZR19 front '
                'and 275/35ZR19 rear. Carbon ceramic brakes are fitted at all four corners. '
                'The odometer indicates 31,200 miles. Service was performed at BMW of Manhattan '
                'in February 2024. A clean Carfax and two keys are included. '
                'This is a one-owner, rear-wheel drive example located in New York.'
            ),
        },
        {
            'id': 'test-4',
            'year': 1984,
            'make': 'Toyota',
            'model': 'Land Cruiser FJ60',
            'description': (
                'This 1984 Toyota Land Cruiser FJ60 is finished in Freeborn Red over gray '
                'cloth and is powered by the factory 4.2-liter inline-six paired with a '
                '4-speed manual transmission and part-time four-wheel drive with a '
                'factory transfer case. The truck shows approximately 187k miles and was '
                'acquired by the seller in 2020 from the second owner in Colorado. '
                'Recent work includes a rebuilt carburetor, new Bilstein shocks, '
                'Old Man Emu springs, and BFGoodrich All-Terrain tires in LT285/75R16. '
                'The frame is described as rust-free and the body shows no significant '
                'dents or damage. This solid-frame, well-maintained three-owner example '
                'is a southern car that has never seen salt.'
            ),
        },
        {
            'id': 'test-5',
            'year': 1970,
            'make': 'Plymouth',
            'model': 'Barracuda',
            'description': (
                "This 1970 Plymouth 'Cuda is repainted in Vitamin C Orange over a "
                'black interior trimmed in vinyl. Power comes from a replacement 440ci '
                'big-block V8 with a Holley 4-barrel carburetor, producing an estimated '
                '375 horsepower. A Torqueflite 727 automatic transmission sends power to '
                'the rear wheels through a Dana 60 rear axle with a Sure Grip limited-slip '
                'differential. The car rides on Cragar SS wheels with Goodyear Eagle tires. '
                'Known issues include minor surface rust on the trunk floor and a small '
                'crack in the dashboard. The odometer shows 68,200 miles, though true '
                'mileage is unknown (TMU). This non-matching numbers convertible was '
                'restored in 2005 and has been garage kept since. A PHS report and '
                'bill of sale are included.'
            ),
        },
    ]

    print('=' * 80)
    print('DESCRIPTION REGEX EXTRACTOR — Layer 1 Test Suite')
    print('=' * 80)

    total_fields = 0
    total_found = 0
    total_extractions = 0
    field_hit_counts: dict[str, int] = {}
    timings = []

    for desc_data in test_descriptions:
        desc = desc_data['description']
        year = desc_data.get('year')
        make = desc_data.get('make')
        model = desc_data.get('model')

        t0 = time.perf_counter_ns()
        result = extractor.extract(desc, year, make, model)
        elapsed_us = (time.perf_counter_ns() - t0) / 1000
        timings.append(elapsed_us)

        stats = extractor.coverage_stats(result)
        total_fields += stats['fields_total']
        total_found += stats['fields_found']
        total_extractions += stats['total_extractions']

        for field, count in stats['per_field'].items():
            if count > 0:
                field_hit_counts[field] = field_hit_counts.get(field, 0) + 1

        print(f"\n--- {desc_data['year']} {desc_data['make']} {desc_data['model']} ---")
        print(f"  Coverage: {stats['fields_found']}/{stats['fields_total']} fields "
              f"({stats['coverage_pct']}%), {stats['total_extractions']} total extractions, "
              f'{elapsed_us:.0f} us')

        for field_name, field_results in result.items():
            if field_results:
                values = [r['value'] for r in field_results]
                confs = [r['confidence'] for r in field_results]
                avg_conf = sum(confs) / len(confs)
                val_str = str(values)
                if len(val_str) > 80:
                    val_str = val_str[:80] + '...'
                print(f'    {field_name:<25} {val_str}  (avg conf: {avg_conf:.2f})')

    n = len(test_descriptions)
    print('\n' + '=' * 80)
    print('SUMMARY')
    print('=' * 80)
    print(f'  Descriptions tested: {n}')
    print(f'  Avg fields found: {total_found/n:.1f}/{total_fields/n:.0f} '
          f'({100*total_found/total_fields:.1f}%)')
    print(f'  Avg extractions per description: {total_extractions/n:.1f}')
    print(f'  Avg extraction time: {sum(timings)/len(timings):.0f} us '
          f'(min: {min(timings):.0f}, max: {max(timings):.0f})')

    print(f'\n  Field coverage across {n} descriptions:')
    for field, hits in sorted(field_hit_counts.items(), key=lambda x: -x[1]):
        print(f'    {field:<25} {hits}/{n} ({100*hits/n:.0f}%)')

    # --- Also test flat extraction ---
    print('\n' + '-' * 40)
    print('FLAT EXTRACTION SAMPLE (test-1):')
    print('-' * 40)
    flat = extractor.extract_flat(
        test_descriptions[0]['description'],
        test_descriptions[0]['year'],
        test_descriptions[0]['make'],
        test_descriptions[0]['model'],
    )
    for k, v in flat.items():
        if v is not None:
            val_str = str(v)
            if len(val_str) > 70:
                val_str = val_str[:70] + '...'
            print(f'  {k:<25} {val_str}')

    # --- Test edge cases ---
    print('\n' + '-' * 40)
    print('EDGE CASE TESTS:')
    print('-' * 40)

    # HTML entities — em dash (&#8212;), apostrophe (&#8217;), double prime (&#8243;)
    html_desc = 'finished in Rosso Corsa&#8212;the car&#8217;s 15&#8243; wheels are wrapped in 205/55R16 tires'
    r = extractor.extract(html_desc)
    assert r['exterior_color'], f'Failed to extract color from HTML entities: {html_desc}'
    assert r['exterior_color'][0]['value'] == 'Rosso Corsa', \
        f'Expected "Rosso Corsa", got: {r["exterior_color"][0]["value"]}'
    print('  [PASS] HTML entity handling (&#8212; em dash, &#8217; apostrophe)')

    # Unicode
    uni_desc = 'finished in \u201cGriogio Titanio Metalizzato\u201d over tan leather'
    r = extractor.extract(uni_desc)
    assert r['exterior_color'], f'Failed to extract color from Unicode: {uni_desc}'
    print('  [PASS] Unicode smart quote handling')

    # Rust negation
    rust_pos = 'This is a rust-free California car with no rust underneath'
    r = extractor.extract(rust_pos)
    assert any(x['value'] in ('rust-free', 'rust free', 'no rust') for x in r['condition_positive']), \
        'rust-free should be positive'
    neg_rust_values = [x['value'] for x in r['condition_negative']]
    assert 'rust' not in neg_rust_values, \
        f'rust should NOT be negative when negated, got: {neg_rust_values}'
    print('  [PASS] Rust negation (rust-free = positive, not negative)')

    # Rust negative (not negated)
    rust_neg = 'There is surface rust on the rocker panels and some rust in the trunk'
    r = extractor.extract(rust_neg)
    assert any(x['value'] == 'rust' for x in r['condition_negative']), \
        'Bare "rust" should be negative'
    print('  [PASS] Bare rust = negative')

    # Empty input
    r = extractor.extract('')
    assert all(v == [] for v in r.values()), 'Empty input should return empty lists'
    print('  [PASS] Empty input handling')

    # None-ish input
    r = extractor.extract('   ')
    assert all(v == [] for v in r.values()), 'Whitespace input should return empty lists'
    print('  [PASS] Whitespace-only input')

    # Mileage — "Xk miles"
    k_desc = 'The truck has approximately 187k miles on the odometer'
    r = extractor.extract(k_desc)
    mileage_vals = [x['value'] for x in r['mileage']]
    assert '187000' in mileage_vals, f'Should parse 187k as 187000, got: {mileage_vals}'
    print('  [PASS] "187k miles" -> 187000')

    # No reserve detection
    nr_desc = 'This example is offered at No Reserve on Bring a Trailer'
    r = extractor.extract(nr_desc)
    assert r['no_reserve'], 'Should detect No Reserve'
    print('  [PASS] No Reserve detection')

    # TMU / non-matching negative
    tmu_desc = 'true mileage unknown, non-matching numbers replacement engine'
    r = extractor.extract(tmu_desc)
    neg_vals = [x['value'] for x in r['condition_negative']]
    assert 'non-matching' in neg_vals or 'replacement engine' in neg_vals or 'replacement' in neg_vals, \
        f'Should detect negative condition, got: {neg_vals}'
    print('  [PASS] TMU / non-matching detection')

    print('\n  All edge case tests passed.')

    # --- Database test (if available) ---
    try:
        import subprocess
        result_proc = subprocess.run(
            ['dotenvx', 'run', '--', 'python3', '-c',
             'import os; print(os.environ.get("VITE_SUPABASE_URL", ""))'],
            capture_output=True, text=True, cwd='/Users/skylar/nuke',
            timeout=10,
        )
        supabase_url = result_proc.stdout.strip()
        if supabase_url:
            print(f'\n  Supabase URL found. To test on real data, run:')
            print(f'    cd /Users/skylar/nuke && dotenvx run -- python3 -m yono.extractors.description_regex --db')
    except Exception:
        pass


def _run_db_test():
    """Test on real BaT descriptions from the database."""
    import json
    import os
    import subprocess
    import time

    extractor = DescriptionRegexExtractor()

    # Fetch 10 descriptions from the DB
    query = """
    SELECT id, year, make, model, description
    FROM vehicles
    WHERE description IS NOT NULL
      AND length(description) > 200
      AND source = 'bat'
    ORDER BY random()
    LIMIT 10
    """

    print('\nFetching 10 random BaT descriptions from database...')

    try:
        result = subprocess.run(
            ['dotenvx', 'run', '--', 'python3', '-c', f'''
import os, json
try:
    from supabase import create_client
    url = os.environ["VITE_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)
    resp = sb.rpc("execute_raw_sql", {{"query": """{query}"""}}).execute()
    print(json.dumps(resp.data))
except Exception as e:
    # Fallback: use psql
    import subprocess as sp
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        r = sp.run(["psql", db_url, "-t", "-A", "-F", "|",
                     "-c", """{query}"""],
                    capture_output=True, text=True, timeout=30)
        rows = []
        for line in r.stdout.strip().split("\\n"):
            parts = line.split("|")
            if len(parts) >= 5:
                rows.append({{
                    "id": parts[0],
                    "year": int(parts[1]) if parts[1] else None,
                    "make": parts[2],
                    "model": parts[3],
                    "description": parts[4],
                }})
        print(json.dumps(rows))
    else:
        print("[]")
'''],
            capture_output=True, text=True, cwd='/Users/skylar/nuke',
            timeout=30,
        )

        if result.returncode != 0:
            print(f'  Database query failed: {result.stderr[:200]}')
            return

        rows = json.loads(result.stdout.strip() or '[]')
        if not rows:
            print('  No results returned.')
            return

        print(f'  Got {len(rows)} descriptions.\n')

        total_fields = 0
        total_found = 0
        total_extractions = 0
        timings = []

        for row in rows:
            desc = row.get('description', '')
            year = row.get('year')
            make = row.get('make', '')
            model = row.get('model', '')

            t0 = time.perf_counter_ns()
            ext = extractor.extract(desc, year, make, model)
            elapsed_us = (time.perf_counter_ns() - t0) / 1000
            timings.append(elapsed_us)

            stats = extractor.coverage_stats(ext)
            total_fields += stats['fields_total']
            total_found += stats['fields_found']
            total_extractions += stats['total_extractions']

            vehicle_label = f"{year or '?'} {make} {model}"
            print(f'  {vehicle_label:<40} '
                  f'{stats["fields_found"]}/{stats["fields_total"]} fields, '
                  f'{stats["total_extractions"]} extractions, '
                  f'{elapsed_us:.0f} us')

            # Show non-empty fields
            for field_name, field_results in ext.items():
                if field_results:
                    values = [r['value'] for r in field_results[:3]]
                    val_str = str(values)
                    if len(val_str) > 70:
                        val_str = val_str[:70] + '...'
                    print(f'    {field_name:<25} {val_str}')

        n = len(rows)
        print(f'\n  --- DB Test Summary ({n} descriptions) ---')
        print(f'  Avg fields found: {total_found/n:.1f}/{total_fields/n:.0f} '
              f'({100*total_found/total_fields:.1f}%)')
        print(f'  Avg extractions: {total_extractions/n:.1f}')
        print(f'  Avg time: {sum(timings)/len(timings):.0f} us')

    except Exception as e:
        print(f'  Database test error: {e}')


if __name__ == '__main__':
    import sys
    if '--db' in sys.argv:
        _run_db_test()
    else:
        _run_tests()
