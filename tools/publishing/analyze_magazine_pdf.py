#!/usr/bin/env python3
"""
Analyze L'Officiel St Barth Issue #11 magazine PDF page by page.
Extracts structured data: page types, credits, brands, editorial stories.
Writes results to ~/email_intelligence.db and a summary markdown file.
"""

import fitz  # PyMuPDF
import sqlite3
import json
import re
import os
from datetime import datetime
from collections import defaultdict

PDF_PATH = os.environ.get("MAGAZINE_PDF_PATH", os.path.expanduser("~/LOFFICIEL LOFSBH11_ALL last.pdf"))
DB_PATH = os.path.expanduser("~/email_intelligence.db")
SUMMARY_PATH = os.path.expanduser("~/analysis/magazine_analysis_losb11.md")

PUBLICATION = "L'Officiel St Barth"
ISSUE_NUMBER = "11"

# ── Luxury / known brand patterns ──────────────────────────────────────
LUXURY_BRANDS = [
    "Louis Vuitton", "Chanel", "Hermès", "Hermes", "Dior", "Christian Dior",
    "Gucci", "Prada", "Saint Laurent", "YSL", "Yves Saint Laurent",
    "Balenciaga", "Bottega Veneta", "Valentino", "Givenchy", "Fendi",
    "Versace", "Burberry", "Celine", "Céline", "Loewe", "Miu Miu",
    "Alexander McQueen", "Tom Ford", "Dolce & Gabbana", "D&G",
    "Balmain", "Lanvin", "Chloé", "Chloe", "Isabel Marant",
    "Stella McCartney", "Acne Studios", "Off-White", "Jacquemus",
    "Max Mara", "Etro", "Missoni", "Moschino", "Roberto Cavalli",
    "Oscar de la Renta", "Carolina Herrera", "Elie Saab", "Zuhair Murad",
    "Ralph Lauren", "Calvin Klein", "Michael Kors", "Coach",
    "Tiffany", "Cartier", "Van Cleef", "Bulgari", "Bvlgari", "Chopard",
    "Piaget", "Rolex", "Omega", "TAG Heuer", "Hublot", "Breitling",
    "Audemars Piguet", "Patek Philippe", "IWC", "Jaeger-LeCoultre",
    "Chaumet", "Boucheron", "Fred", "Messika", "Pomellato",
    "La Mer", "La Prairie", "Sisley", "Lancôme", "Lancome",
    "Estée Lauder", "Estee Lauder", "Clinique", "Clarins",
    "Guerlain", "Givenchy Beauty",
    "MAC", "NARS", "Bobbi Brown", "Charlotte Tilbury",
    "Rimowa", "Goyard", "Moynat", "Berluti",
    "Jimmy Choo", "Manolo Blahnik", "Christian Louboutin", "Louboutin",
    "Roger Vivier", "Aquazzura", "Gianvito Rossi",
    "Loro Piana", "Brunello Cucinelli", "Zegna", "Ermenegildo Zegna",
    "Salvatore Ferragamo", "Ferragamo", "Tod's", "Hogan",
    "Moncler", "Canada Goose", "Mackage",
    "Zimmermann", "Eres", "Alaïa", "Alaia",
    "Repossi", "De Beers", "Graff", "Harry Winston",
    "Baccarat", "Lalique", "Christofle",
    "Dom Pérignon", "Dom Perignon", "Moët", "Moet", "Veuve Clicquot",
    "Hennessy", "Rémy Martin", "Remy Martin",
    "Four Seasons", "Aman", "Belmond", "Rosewood", "Mandarin Oriental",
    "St. Regis", "Ritz", "Peninsula",
    "Swarovski", "Pandora", "APM Monaco",
    "Diane von Furstenberg", "DVF", "Proenza Schouler",
    "The Row", "Khaite", "Totême", "Toteme", "Nanushka",
    "Rick Owens", "Maison Margiela", "Margiela", "Ann Demeulemeester",
    "Comme des Garçons", "Comme des Garcons", "Issey Miyake",
    "Kenzo", "Sandro", "Maje", "Zadig & Voltaire",
    "Ba&sh", "Claudie Pierlot", "AMI", "Ami Paris",
    "Maison Kitsuné", "Maison Kitsune",
    "Vilebrequin", "Orlebar Brown",
    "Bucherer", "Breguet", "Blancpain", "Girard-Perregaux",
    "Ulysse Nardin", "Zenith", "Panerai", "Bell & Ross",
    "Richard Mille", "MB&F",
    "Bang & Olufsen",
    "Bentley", "Rolls-Royce", "Rolls Royce", "Ferrari", "Lamborghini",
    "Porsche", "Maserati", "Aston Martin", "McLaren", "Bugatti",
    "Mercedes", "BMW", "Audi", "Range Rover", "Land Rover",
    "Eres Paris",
    # St Barth local / magazine-specific brands seen in the PDF
    "James Perse", "Jacques Zolty", "Lolita Jaca", "Kyomai",
    "Dr. Barbara Sturm", "Cesare Pompanon", "Goldfinger",
    "Zadig&Voltaire", "Eden Rock",
    "Bertini", "Silvia Gnecchi", "Julie Sulzy",
    "Canados",
]

BRAND_PATTERNS = []
for brand in LUXURY_BRANDS:
    escaped = re.escape(brand)
    BRAND_PATTERNS.append((brand, re.compile(r'\b' + escaped + r'\b', re.IGNORECASE)))


# ── Credit patterns (French + English) ─────────────────────────────────
# These require explicit role labels followed by colon/space then a name
CREDIT_PATTERNS = [
    # Explicit label patterns (role: NAME or role NAME in all-caps context)
    (r'(?:photographie|photograph(?:e[dr]?|y)|photo)\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Photographer'),
    (r'(?:Photographed|Photographié)\s+by\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Photographer'),
    (r'(?:stylisme|styling|styliste|styled)\s*(?:by)?\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Stylist'),
    (r'Styled\s+by\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Stylist'),
    (r'Styles?\s+by\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Stylist'),
    (r'(?:coiffure|hair)\s*(?:&\s*make\s*-?\s*up)?\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Hair'),
    (r'HAIR\s*&\s*MAKE\s*-?\s*UP\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Hair & Makeup'),
    (r'(?:maquillage|makeup|make-up)\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Makeup'),
    (r'(?:mannequin|modèle|model|mod[eè]le)\s+([A-Z][A-Za-zà-ÿ\- ]+(?:\s*&\s*[A-Z][A-Za-zà-ÿ\- ]+)*)', 'Model'),
    (r'MODEL\s+([A-Z][A-Za-zà-ÿ\- ]+(?:\s*&\s*[A-Z][A-Za-zà-ÿ\- ]+)*)', 'Model'),
    (r'(?:rédaction|texte|text|words)\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Writer'),
    (r'(?:direction\s+artistique|art\s+direction)\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Art Director'),
    (r'ART\s+DIRECTION\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Art Director'),
    (r'(?:réalisation|production|producer)\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Producer'),
    (r'PRODUCER\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Producer'),
    (r'PRODUCTION\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Production'),
    (r'COPY\s+EDITOR\s*\n\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Copy Editor'),
    (r'DIGITAL\s+MANAGER\s*\n\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Digital Manager'),
    (r'LOCATION\s+([A-Z][A-Za-zà-ÿ\- ]+)', 'Location'),
    (r'(?:set\s+design|décor)\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Set Designer'),
    (r'(?:casting)\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Casting'),
    (r'(?:retouche|retouching)\s*[:]\s*([A-Z][A-Za-zà-ÿ\- ]+)', 'Retoucher'),
    # "By FIRSTNAME LASTNAME" at start of line or after whitespace (strict: name must be caps)
    (r'(?:^|\n)\s*[Bb]y\s+([A-Z][A-Z]+\s+[A-Z][A-Z]+(?:\s+[A-Z]+)*)', 'Author'),
    (r'(?:^|\n)\s*[Pp]ar\s+([A-Z][A-Z]+\s+[A-Z][A-Z]+(?:\s+[A-Z]+)*)', 'Author'),
    # "Interview by NAME"
    (r'Interview\s+by\s+([A-Z][A-Z]+\s+[A-Z][A-Z]+(?:\s+[A-Z]+)*)', 'Interviewer'),
]
CREDIT_RE = [(re.compile(pat, re.MULTILINE), role) for pat, role in CREDIT_PATTERNS]

# Masthead role patterns - for the masthead page specifically
MASTHEAD_PATTERNS = [
    (r"CREATIVE\s+DIRECTOR\s*&?\s*EDITOR[- ]IN[- ]CHIEF\s*\n\s*(.+)", "Creative Director & Editor-in-Chief"),
    (r"EDITOR[- ]IN[- ]CHIEF\s*\n?\s*[:.]?\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)", "Editor-in-Chief"),
    (r"CREATIVE\s+DIRECTOR\s*\n?\s*[:.]?\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)", "Creative Director"),
    (r"PUBLISHER\s*&?\s*EDITORIAL\s+DIRECTOR\s*\n\s*(.+)", "Publisher & Editorial Director"),
    (r"FASHION\s+EDITORS?\s*\n\s*(.+?)(?:\n[A-Z]{2,}|\n\n)", "Fashion Editor"),
    (r"PHOTOGRAPHY\s*\n((?:[A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*\n?)+)", "Photography"),
    (r"COPY\s+EDITOR\s*\n\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)", "Copy Editor"),
    (r"DIGITAL\s+MANAGER\s*\n\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)", "Digital Manager"),
]
MASTHEAD_RE = [(re.compile(pat, re.MULTILINE), role) for pat, role in MASTHEAD_PATTERNS]

# ── Indicators for ad pages ─────────────────────────────────────────────
AD_INDICATORS = [
    re.compile(r'(?:gustavia|rue\s+de\s+la\s+r[eé]publique|rue\s+du\s+(?:g[eé]n[eé]ral|roi|bord\s+de\s+mer)|saint[- ]barth[eé]lemy|saint[- ]jean|lorient|colombier)', re.IGNORECASE),
    re.compile(r'(?:showroom|boutique|flagship|store|shop)\b', re.IGNORECASE),
    re.compile(r'(?:www\.|\.com|\.fr|@)', re.IGNORECASE),
    re.compile(r'\+590\b|\+33\b', re.IGNORECASE),
    re.compile(r'(?:depuis|established|fondé)\s+\d{4}', re.IGNORECASE),
]

# ── Fashion credit line pattern ───────────────────────────────────────
# Matches structured fashion credits like "white knit dress JAMES PERSE" or
# "Necklace VINTAGE CHANEL" -- garment word followed by brand in ALL CAPS
FASHION_CREDIT_STRUCTURED = re.compile(
    r'(?:dress|top|skirt|pants?|jacket|coat|shirts?|sweater|pullover|hoodie|shorts?|'
    r'jumpsuit|hat|shoes|belt|bags?|necklace|earrings?|bracelets?|rings?|watch|'
    r'tote|pochette|sandals?|boots?|flats|sneakers?|bikini|swimsuit|sunglasses|'
    r'lunettes?|cover|kimono|collar|t-shirt|jeans|blazer|vest|cape|scarf)\s+'
    r'[A-Z][A-Z]+(?:\s+[A-Z]+)*',  # followed by ALL-CAPS brand name
    re.MULTILINE
)

# Also match "Look BRAND" pattern
LOOK_BRAND = re.compile(r'\bLook\s+[A-Z][A-Z]+(?:\s+[A-Z]+)*', re.MULTILINE)

# "OPPOSITE PAGE" or "PREVIOUS PAGE" or "ABOVE" styling indicators
STYLING_INDICATORS = re.compile(
    r'(?:OPPOSITE\s+PAGE|PREVIOUS\s+PAGE|ABOVE|TO\s+THE\s+(?:LEFT|RIGHT))\s*[—\-]',
    re.MULTILINE
)


def find_brands(text):
    """Find all luxury brand names mentioned in text."""
    found = []
    for brand, pattern in BRAND_PATTERNS:
        if pattern.search(text):
            found.append(brand)
    return sorted(set(found))


def find_credits(text):
    """Extract credited people from text using strict patterns."""
    people = []
    for pattern, role in CREDIT_RE:
        for match in pattern.finditer(text):
            raw = match.group(1).strip()
            # Take only the first line
            name = raw.split('\n')[0].strip().rstrip('.,;:')
            # Remove trailing words that are clearly not names
            # (like "in Brooklyn" or "described the show")
            name = re.sub(r'\s+(?:in|at|on|of|for|with|the|and|from|is|was|has|had|to|who|that|which)\b.*$', '', name, flags=re.IGNORECASE)
            name = name.strip()
            if len(name) > 50 or len(name) < 3:
                continue
            # Must contain at least two words for a person name
            words = name.split()
            if len(words) < 2:
                continue
            # Skip if it looks like a sentence (lowercase word after first)
            # Allow all-caps names and Title Case
            if not (name.isupper() or all(w[0].isupper() for w in words if len(w) > 1)):
                continue
            # Could be multiple names separated by &
            sub_names = re.split(r'\s*&\s*', name)
            for sn in sub_names:
                sn = sn.strip()
                if 3 < len(sn) < 50 and len(sn.split()) >= 2:
                    people.append({"name": sn, "role": role})
    return people


def parse_masthead(text):
    """Parse the masthead page specifically."""
    people = []
    for pattern, role in MASTHEAD_RE:
        for match in pattern.finditer(text):
            raw = match.group(1).strip()
            # For photography, split by newlines
            if role == "Photography":
                for line in raw.split('\n'):
                    name = line.strip()
                    if name and len(name) > 3 and not name.isupper():
                        people.append({"name": name, "role": "Photographer"})
            elif role == "Fashion Editor":
                for name in re.split(r'\n', raw):
                    name = name.strip()
                    if name and len(name) > 3:
                        people.append({"name": name, "role": role})
            else:
                name = raw.split('\n')[0].strip().rstrip('.,;:')
                if len(name) > 3:
                    people.append({"name": name, "role": role})
    return people


def is_fashion_credit_page(text):
    """Check if a page contains structured fashion credits (garment BRAND pattern)."""
    structured_matches = len(FASHION_CREDIT_STRUCTURED.findall(text))
    look_matches = len(LOOK_BRAND.findall(text))
    styling_matches = len(STYLING_INDICATORS.findall(text))
    # Need multiple structured garment+brand credits OR styling indicators + some credits
    return (structured_matches >= 3) or (structured_matches >= 1 and styling_matches >= 1)


def count_ad_signals(text):
    """Count how many ad-like signals are in the text."""
    score = 0
    for pattern in AD_INDICATORS:
        if pattern.search(text):
            score += 1
    return score


def classify_page(page_num, total_pages, text, image_count, brands, credits):
    """Classify a page type with confidence score."""
    text_stripped = text.strip()
    text_len = len(text_stripped)
    text_lower = text_stripped.lower()
    lines = [l.strip() for l in text_stripped.split('\n') if l.strip()]
    line_count = len(lines)

    # Cover pages
    if page_num == 1:
        return 'cover', 0.95
    if page_num == total_pages:
        return 'back_cover', 0.95

    # Masthead detection - look for staff listing keywords
    masthead_keywords = ['PHOTOGRAPHY', 'FASHION EDITOR', 'COPY EDITOR',
                         'DIGITAL MANAGER', 'CREATIVE DIRECTOR', 'PUBLISHER',
                         'EDITOR-IN-CHIEF', 'EDITORIAL DIRECTOR']
    masthead_score = sum(1 for kw in masthead_keywords if kw in text)
    if masthead_score >= 3:
        return 'masthead', min(0.6 + masthead_score * 0.08, 0.95)

    # Table of contents - page 12 has numbered entries like "47\n" "51\n" "54\n"
    toc_numbers = re.findall(r'(?:^|\t)\s*(\d{1,3})\s*$', text, re.MULTILINE)
    has_toc_structure = len(toc_numbers) >= 4
    if has_toc_structure and page_num <= 15:
        return 'toc', 0.90

    # Fashion credit page (lots of garment descriptions: "dress BRAND, skirt BRAND")
    if is_fashion_credit_page(text):
        return 'fashion_credits', 0.80

    # Production credits block (MODEL, ART DIRECTION, PRODUCER, etc.)
    prod_credit_keywords = ['MODEL ', 'ART DIRECTION', 'PRODUCER', 'HAIR & MAKE',
                            'PRODUCTION ', 'LOCATION ', 'WITH THANKS']
    prod_score = sum(1 for kw in prod_credit_keywords if kw in text)
    if prod_score >= 3:
        return 'production_credits', 0.85

    # Ad page detection
    ad_signals = count_ad_signals(text)
    # Address/website/phone with limited editorial text = ad
    if ad_signals >= 2 and text_len < 500:
        return 'ad', 0.80
    if ad_signals >= 3:
        return 'ad', 0.85
    if text_len < 60 and image_count >= 1 and ad_signals >= 1:
        return 'ad', 0.85
    # Very minimal text = likely ad
    if text_len < 40 and image_count >= 1:
        return 'ad', 0.75
    # Single brand name + website/address
    if text_len < 300 and ad_signals >= 2 and line_count <= 10:
        return 'ad', 0.75
    # Short text with just a brand/shop name and address
    if text_len < 200 and ad_signals >= 1 and line_count <= 5:
        return 'ad', 0.70

    # Interview format (L'OFFICIEL: / L'O:)
    if "L'OFFICIEL:" in text or "L'O:" in text:
        return 'editorial', 0.90

    # Editorial story (has credits like "Photographed by", "Styled by")
    if len(credits) >= 2:
        return 'fashion_story', 0.80

    # Substantial text = editorial
    if text_len > 500:
        return 'editorial', 0.75

    # Medium text with brands = likely editorial feature on a brand/person
    if text_len > 200:
        return 'editorial', 0.65

    # Light text + images
    if image_count >= 1 and text_len > 30:
        if len(brands) >= 1 and not ad_signals:
            return 'fashion_story', 0.55
        if ad_signals >= 1:
            return 'ad', 0.60
        return 'editorial', 0.50

    # Minimal text
    if text_len < 100 and image_count >= 1:
        return 'ad', 0.50

    return 'editorial', 0.40


def detect_story_title(text):
    """Try to detect a story/article title from the text.
    Only returns a title if there's a strong signal (ALL CAPS short line
    that looks like a deliberate headline, not just the start of body text).
    """
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    if not lines:
        return None

    skip_patterns = ['ST BARTH', 'ISSUE', 'WINTER', 'SPRING', "L'OFFICIEL",
                     'OPPOSITE PAGE', 'PREVIOUS PAGE', 'ABOVE', 'BELOW']

    for line in lines[:6]:
        if any(sp in line.upper() for sp in skip_patterns):
            continue
        # Only accept ALL CAPS titles (magazine convention for headlines)
        cleaned = re.sub(r'[^A-Za-zÀ-ÿ\s\'\-]', '', line).strip()
        if not cleaned or len(cleaned) < 4:
            continue
        # ALL CAPS, 2-6 words, clearly a headline
        words = cleaned.split()
        if cleaned.isupper() and 1 <= len(words) <= 8 and len(cleaned) < 50:
            # Skip single common words
            if len(words) == 1 and cleaned.lower() in ('the', 'and', 'for', 'from', 'with', 'page'):
                continue
            return cleaned.title()
    return None


def main():
    print(f"Opening PDF: {PDF_PATH}")
    doc = fitz.open(PDF_PATH)
    total_pages = len(doc)
    print(f"Total pages: {total_pages}")

    # ── Database setup ──────────────────────────────────────────────────
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS magazine_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publication TEXT NOT NULL,
            issue_number TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            page_type TEXT,
            text_content TEXT,
            brand_names TEXT,
            person_names TEXT,
            image_count INTEGER,
            story_title TEXT,
            is_spread INTEGER DEFAULT 0,
            confidence REAL DEFAULT 0.5,
            source_file TEXT,
            analyzed_at TEXT DEFAULT (datetime('now')),
            UNIQUE(publication, issue_number, page_number)
        )
    """)
    conn.commit()

    # ── Page-by-page analysis ───────────────────────────────────────────
    all_pages = []
    all_brands_by_page = {}
    masthead_text = None
    masthead_people = []

    for page_num in range(1, total_pages + 1):
        page = doc[page_num - 1]
        text = page.get_text()
        images = page.get_images(full=True)
        image_count = len(images)

        brands = find_brands(text)
        credits = find_credits(text)

        page_type, confidence = classify_page(
            page_num, total_pages, text, image_count, brands, credits
        )

        # If masthead, parse it specially
        if page_type == 'masthead':
            masthead_text = text
            masthead_people = parse_masthead(text)
            all_people = credits + masthead_people
        else:
            all_people = credits

        story_title = None
        if page_type in ('editorial', 'fashion_story'):
            story_title = detect_story_title(text)

        record = {
            'page_number': page_num,
            'page_type': page_type,
            'text_content': text,
            'brand_names': json.dumps(brands, ensure_ascii=False),
            'person_names': json.dumps(all_people, ensure_ascii=False),
            'image_count': image_count,
            'story_title': story_title,
            'confidence': confidence,
        }
        all_pages.append(record)
        all_brands_by_page[page_num] = brands

        conn.execute("""
            INSERT OR REPLACE INTO magazine_pages
            (publication, issue_number, page_number, page_type, text_content,
             brand_names, person_names, image_count, story_title, is_spread,
             confidence, source_file)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        """, (
            PUBLICATION, ISSUE_NUMBER, page_num, page_type, text,
            json.dumps(brands, ensure_ascii=False),
            json.dumps(all_people, ensure_ascii=False),
            image_count, story_title, confidence,
            os.path.basename(PDF_PATH)
        ))

        if page_num % 10 == 0 or page_num == total_pages:
            conn.commit()
            print(f"  Processed {page_num}/{total_pages} pages...")

    conn.commit()
    doc.close()

    # ── Build summary statistics ────────────────────────────────────────
    type_counts = defaultdict(int)
    ad_pages = []
    editorial_pages = []
    fashion_story_pages = []
    fashion_credit_pages = []
    prod_credit_pages = []
    all_ad_brands = defaultdict(list)
    all_editorial_stories = []
    current_story = None

    # Build a set of "break" pages (non-content pages that interrupt stories)
    break_pages = set()

    for p in all_pages:
        ptype = p['page_type']
        pnum = p['page_number']
        type_counts[ptype] += 1

        if ptype == 'ad':
            ad_pages.append(pnum)
            break_pages.add(pnum)
            brands = json.loads(p['brand_names'])
            for b in brands:
                all_ad_brands[b].append(pnum)
        elif ptype in ('cover', 'back_cover', 'toc', 'masthead'):
            break_pages.add(pnum)
        elif ptype in ('editorial', 'fashion_story', 'fashion_credits', 'production_credits'):
            if ptype == 'editorial':
                editorial_pages.append(pnum)
            elif ptype == 'fashion_story':
                fashion_story_pages.append(pnum)
            elif ptype == 'fashion_credits':
                fashion_credit_pages.append(pnum)
            elif ptype == 'production_credits':
                prod_credit_pages.append(pnum)

    # Group consecutive content pages into stories, breaking on non-content pages
    for p in all_pages:
        ptype = p['page_type']
        pnum = p['page_number']
        is_content = ptype in ('editorial', 'fashion_story', 'fashion_credits', 'production_credits')

        if not is_content:
            # This breaks any current story
            if current_story:
                all_editorial_stories.append(current_story)
                current_story = None
            continue

        # Check if any break page exists between current story end and this page
        has_break = False
        if current_story:
            for bp in range(current_story['end'] + 1, pnum):
                if bp in break_pages:
                    has_break = True
                    break

        # Detect if this page starts a new story
        new_story_signal = False
        if current_story and p['story_title'] and current_story.get('title'):
            # Both pages have titles and they're different = new story
            if p['story_title'] != current_story['title']:
                new_story_signal = True

        if current_story and not has_break and not new_story_signal and pnum - current_story['end'] <= 2:
            current_story['end'] = pnum
            current_story['page_types'].add(ptype)
            if p['story_title'] and not current_story['title']:
                current_story['title'] = p['story_title']
            current_story['brands'].update(json.loads(p['brand_names']))
            current_story['credits'].extend(json.loads(p['person_names']))
        else:
            if current_story:
                all_editorial_stories.append(current_story)
            current_story = {
                'title': p['story_title'],
                'start': pnum,
                'end': pnum,
                'page_types': {ptype},
                'brands': set(json.loads(p['brand_names'])),
                'credits': json.loads(p['person_names']),
            }

    if current_story:
        all_editorial_stories.append(current_story)

    # ── Collect all people ──────────────────────────────────────────────
    all_people_map = defaultdict(set)
    for p in all_pages:
        people = json.loads(p['person_names'])
        for person in people:
            all_people_map[person['name']].add(person['role'])

    # ── Write summary markdown ──────────────────────────────────────────
    total_ad = len(ad_pages)
    total_content = len(editorial_pages) + len(fashion_story_pages) + len(fashion_credit_pages) + len(prod_credit_pages)

    with open(SUMMARY_PATH, 'w') as f:
        f.write(f"# L'Officiel St Barth - Issue #11 - Magazine Analysis\n\n")
        f.write(f"**Source**: `{os.path.basename(PDF_PATH)}`\n")
        f.write(f"**Analyzed**: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")

        f.write(f"## Overview\n\n")
        f.write(f"- **Total pages**: {total_pages}\n")
        f.write(f"- **Ad pages**: {total_ad}\n")
        f.write(f"- **Editorial/Content pages**: {total_content}\n")
        f.write(f"- **Ad-to-content ratio**: {total_ad}:{total_content}\n\n")

        f.write(f"### Page Type Breakdown\n\n")
        f.write(f"| Type | Count | Pages |\n|------|-------|-------|\n")
        # Gather pages per type
        pages_by_type = defaultdict(list)
        for p in all_pages:
            pages_by_type[p['page_type']].append(p['page_number'])
        for ptype, count in sorted(type_counts.items(), key=lambda x: -x[1]):
            pnums = pages_by_type[ptype]
            f.write(f"| {ptype} | {count} | {', '.join(str(p) for p in pnums)} |\n")
        f.write("\n")

        # ── Brand Advertisements ────────────────────────────────────────
        f.write(f"## Brand Advertisements\n\n")
        f.write(f"### Identified Brand Ads\n\n")
        if all_ad_brands:
            f.write(f"| Brand | Pages |\n|-------|-------|\n")
            for brand, pages in sorted(all_ad_brands.items()):
                f.write(f"| {brand} | {', '.join(str(p) for p in pages)} |\n")
            f.write("\n")
        else:
            f.write("No brand ads detected with identifiable brand names.\n\n")

        f.write(f"### All Ad Pages\n\n")
        for p_num in ad_pages:
            p = all_pages[p_num - 1]
            text_snippet = p['text_content'].strip().replace('\n', ' ')[:150]
            brands_on_page = json.loads(p['brand_names'])
            brand_str = f" [{', '.join(brands_on_page)}]" if brands_on_page else ""
            f.write(f"- **Page {p_num}**{brand_str}: `{text_snippet}`\n")
        f.write("\n")

        # ── Editorial Stories ───────────────────────────────────────────
        f.write(f"## Editorial Stories\n\n")
        for story in all_editorial_stories:
            page_range = f"pp. {story['start']}-{story['end']}" if story['start'] != story['end'] else f"p. {story['start']}"
            title = story['title'] or "(Untitled)"
            f.write(f"### {title} ({page_range})\n")
            types_str = ', '.join(sorted(story['page_types']))
            f.write(f"- **Page types**: {types_str}\n")
            if story['brands']:
                f.write(f"- **Brands**: {', '.join(sorted(story['brands']))}\n")
            if story['credits']:
                seen = set()
                for c in story['credits']:
                    key = f"{c['name']}|{c['role']}"
                    if key not in seen:
                        seen.add(key)
                        f.write(f"- **{c['role']}**: {c['name']}\n")
            f.write("\n")

        # ── Masthead ────────────────────────────────────────────────────
        f.write(f"## Masthead\n\n")
        if masthead_people:
            for entry in masthead_people:
                f.write(f"- **{entry['role']}**: {entry['name']}\n")
        else:
            f.write("No structured masthead detected.\n")

        if masthead_text:
            f.write(f"\n### Raw Masthead Text\n\n```\n{masthead_text.strip()}\n```\n")
        f.write("\n")

        # ── Fashion Credits Detail ──────────────────────────────────────
        f.write(f"## Fashion Credits (Garment/Styling Pages)\n\n")
        if fashion_credit_pages:
            for p_num in fashion_credit_pages:
                p = all_pages[p_num - 1]
                brands_on_page = json.loads(p['brand_names'])
                f.write(f"### Page {p_num}\n")
                if brands_on_page:
                    f.write(f"- **Brands**: {', '.join(brands_on_page)}\n")
                # Show the actual credit text
                text_lines = [l.strip() for l in p['text_content'].strip().split('\n') if l.strip()]
                for line in text_lines:
                    f.write(f"- {line}\n")
                f.write("\n")
        else:
            f.write("No dedicated fashion credit pages detected.\n\n")

        # ── All People Found ────────────────────────────────────────────
        f.write(f"## All People Found\n\n")
        if all_people_map:
            f.write(f"| Name | Roles |\n|------|-------|\n")
            for name, roles in sorted(all_people_map.items()):
                f.write(f"| {name} | {', '.join(sorted(roles))} |\n")
        f.write("\n")

        # ── All Brands Across Magazine ──────────────────────────────────
        f.write(f"## All Brands Mentioned\n\n")
        all_brands_combined = defaultdict(list)
        for pnum, brands in all_brands_by_page.items():
            for b in brands:
                all_brands_combined[b].append(pnum)
        if all_brands_combined:
            f.write(f"| Brand | Pages | Count |\n|-------|-------|-------|\n")
            for brand, pages in sorted(all_brands_combined.items(), key=lambda x: -len(x[1])):
                unique_pages = sorted(set(pages))
                f.write(f"| {brand} | {', '.join(str(p) for p in unique_pages)} | {len(unique_pages)} |\n")
        f.write("\n")

    conn.close()

    # ── Final summary to stdout ─────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"ANALYSIS COMPLETE: L'Officiel St Barth Issue #11")
    print(f"{'='*60}")
    print(f"Total pages: {total_pages}")
    print(f"Page types: {dict(type_counts)}")
    print(f"Ad pages: {total_ad} (pages: {ad_pages})")
    print(f"Content pages: {total_content}")
    print(f"Editorial stories: {len(all_editorial_stories)}")
    for story in all_editorial_stories:
        title = story['title'] or "(Untitled)"
        print(f"  - {title}: pp.{story['start']}-{story['end']}")
    print(f"Unique brands found: {len(all_brands_combined)}")
    print(f"People/credits found: {len(all_people_map)}")
    print(f"\nDatabase: {DB_PATH}")
    print(f"Summary: {SUMMARY_PATH}")


if __name__ == '__main__':
    main()
