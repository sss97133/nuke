"""Usage: python3 gm_circuit_tabulation_78.py [EXTRACTION_DIR] [--sql]

Parse the Circuit Tabulation chart of ST 352 78 (1978 GM C/K light duty truck wiring diagrams), pp. 8-11, from the
library's text extraction. Two columns per page; a circuit's colour can wrap ("Dark Green-" / "White"), and a name wraps
onto indented lines. Colours the OCR garbled stay null with the raw text kept."""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
# The booklet (reference_documents/wiring_diagram_booklets/ST_352_78_CK_Wiring.pdf) and the library's text extraction
# are local, not in git; run from a checkout that has them (scripts/library_index.py builds the extraction).
D = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "docs/library/_extracted/wiring_diagram_booklets__st_352_78_ck_wiring"
COLORS = ["Dark Brown", "Light Green", "Light Blue", "Dark Green", "Dark Blue", "Red", "Pink", "Brown", "Yellow", "Purple",
          "Gray", "Grey", "Tan", "White", "Black", "Orange", "Blue", "Green"]
CODE = {"Dark Brown": "DK BRN", "Light Green": "LT GRN", "Light Blue": "LT BLU", "Dark Green": "DK GRN", "Dark Blue": "DK BLU",
        "Red": "RED", "Pink": "PNK", "Brown": "BRN", "Yellow": "YEL", "Purple": "PPL", "Gray": "GRY", "Grey": "GRY", "Tan": "TAN",
        "White": "WHT", "Black": "BLK", "Orange": "ORN", "Blue": "BLU", "Green": "GRN"}
ALT = "|".join(COLORS)
CRE = re.compile(rf"^({ALT})(?:\s*-\s*({ALT})?)?")
FIXES = [("­", "-"), ("·", "-"), ("Wh ite", "White"), ("Pu rple", "Purple"), ("<;Jreen", "Green")]


def clean(s):
    for a, b in FIXES:
        s = s.replace(a, b)
    return re.sub(r"^(\s*[i|]?\s*\d{1,3}\s+),", r"\1 ", s)


def split_col(lines):
    for l in lines[:10]:
        idx = [m.start() for m in re.finditer(r"Circ\w+", l)]
        if len(idx) >= 3:
            return idx[2] - 3
    raise SystemExit("no header")


def take_colour(text):
    """(colour, stripe, rest, stripe_pending) from the start of text."""
    m = CRE.match(text)
    if not m:
        return None, None, text, False
    rest = text[m.end():].strip()
    pending = m.group(2) is None and text[:m.end()].rstrip().endswith("-")
    return m.group(1), m.group(2), rest, pending


rows = []
for p in (8, 9, 10, 11):
    lines = (D / f"page-{p:04d}.txt").read_text().splitlines()
    sc = split_col(lines)
    last = {0: None, 1: None}
    for l in lines[8:]:
        for side, part in ((0, l[:sc]), (1, l[sc:])):
            part = clean(part)
            if not part.strip():
                continue
            m = re.match(r"^\s*[i|]?\s*(\d{1,3})\s{2,}(.*)$", part)
            if m:
                col, stripe, name, pending = take_colour(m.group(2).strip())
                r = {"page": p, "number": int(m.group(1)), "color": col, "stripe": stripe, "name": name,
                     "pending_stripe": pending, "raw": m.group(2).strip()}
                rows.append(r)
                last[side] = r
            elif last[side] is not None:
                t, r = part.strip(), last[side]
                if r["pending_stripe"]:
                    c, _, t2, _ = take_colour(t)
                    if c:
                        r["stripe"], t = c, t2
                    r["pending_stripe"] = False
                elif r["color"] is None:
                    c, s2, t2, pend = take_colour(t)
                    if c:
                        r["color"], r["stripe"], t, r["pending_stripe"] = c, s2, t2, pend
                if t and not re.fullmatch(r"[\d\W]{1,3}", t):
                    r["name"] = (r["name"] + " " + t).strip()
for r in rows:
    if r["color"] is None:
        m = re.search(rf"\s({ALT})$", r["name"])
        if m:
            r["color"], r["name"] = m.group(1), r["name"][:m.start()].strip()
    m = re.match(rf"^({ALT})\s+(?=[A-Z])", r["name"])
    if m and r["color"] and not r["stripe"]:          # a stripe that wrapped without its hyphen ("Light Green" / "Black ...")
        r["stripe"], r["name"] = m.group(1), r["name"][m.end():]
    r["name"] = re.sub(r"^Stripe\s+", "", r["name"])
    r["name"] = re.sub(r"(\w)-\s+([a-z])", r"\1\2", r["name"])
    r["name"] = re.sub(r"\s+", " ", r["name"]).strip(" ,")
    r["code"] = CODE.get(r["color"]) if r["color"] else None
    r["stripe_code"] = CODE.get(r["stripe"]) if r["stripe"] else None
nums = [r["number"] for r in rows]
assert len(nums) == len(set(nums)), "duplicate circuit numbers"
if "--sql" in sys.argv:
    # VALUES rows for the migration: (number, colour, stripe, name, page); a circuit whose colour is unreadable is left out
    def q(v):
        return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"
    vals = [f"({r['number']}, {q(r['code'])}, {q(r['stripe_code'])}, {q(r['name'])}, {r['page']})"
            for r in sorted(rows, key=lambda r: r["number"]) if r["code"]]
    print(",\n".join("  " + v for v in vals))
else:
    print(len(rows), "rows; numbers", min(nums), "-", max(nums))
    print("colour unreadable:", [(r["page"], r["number"], r["raw"][:30]) for r in rows if not r["code"]])
