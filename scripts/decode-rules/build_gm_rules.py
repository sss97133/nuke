"""Build cited GM / Pontiac decode-rule rows from saved chart copies.

Usage:
  python3 -I build_gm_rules.py <sources_dir> <out.json>

<sources_dir> holds the retrieved copies (see SOURCES below); each document's sha256 goes into its
chart_source row so a later reader can tell which copy the rows came from. Rows are chart
decodes, not observations of any vehicle. Charts that disagree stay as separate rows.
"""
import hashlib
import html
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CITED_ON = "2026-11-11"

SOURCES = {
    "randys_muncie": {
        "url": "https://www.randysworldwide.com/import_export/Muncie_Trans_ID.pdf",
        "title": "RANDYS Worldwide, 'Muncie Transmission Information' (ID sheet)",
        "file": "randys.txt",
    },
    "aa_saginaw": {
        "url": "https://advanceadapters.com/4-saginaw-3-4-speeds",
        "title": "Advance Adapters, 'Saginaw 3 & 4 Speeds' technical page",
        "file": "aa-sag.html",
    },
    "parts_place": {
        "url": "https://www.thepartsplaceinc.com/data-sheets/PontiacEngineCodes.pdf",
        "title": "The Parts Place, 'Pontiac Engine Codes' data sheet",
        "file": "pontiac-engine-codes.pdf",
    },
    "butler_blocks": {
        "url": "https://butlerperformance.com/n-13496-pontiac-block-casting-information.html",
        "title": "Butler Performance, 'Pontiac Block Casting Identification'",
        "file": "butler-blocks.html",
    },
    "pontiac_power_heads": {
        "url": "https://pontiacpower.net/numbers/head-codes/",
        "title": "Pontiac Power, 'Head Codes'",
        "file": "pp-heads.html",
    },
    "butler_heads": {
        "url": "https://butlerperformance.com/n-13495-pontiac-heads.html",
        "title": "Butler Performance, 'Pontiac Heads'",
        "file": "butler-heads.html",
    },
    "tranzam_1973_options": {
        "url": "https://tran-zam.com/fhistory/1973Options.aspx",
        "title": "tran-zam.com Firebird history, 1973 options (enthusiast reference)",
        "file": "tz73opt.html",
    },
    "tranzam_1973_models": {
        "url": "https://tran-zam.com/fhistory/1973Models.aspx",
        "title": "tran-zam.com Firebird history, 1973 models (enthusiast reference)",
        "file": "tz-1973Models.html",
    },
    "tranzam_1974_options": {
        "url": "https://tran-zam.com/fhistory/1974Options.aspx",
        "title": "tran-zam.com Firebird history, 1974 options (enthusiast reference)",
        "file": "tz-1974Options.html",
    },
    "gmc_1973_catalogue": {
        "url": "https://www.lov2xlr8.no/brochures/pontiac/73fire/73fire.html",
        "title": "1973 Pontiac Firebird catalogue, General Motors of Canada edition",
        "file": None,
    },
}


def sha(src_dir, key):
    f = SOURCES[key]["file"]
    if not f:
        return None
    with open(os.path.join(src_dir, f), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def row(src_dir, key, rule_key, make, model, code, y0, y1, value, locator, **qual):
    s = SOURCES[key]
    q = {k: v for k, v in qual.items() if v is not None}
    USED.add(key)
    return {
        "rule_key": rule_key, "make": make, "model": model, "code": str(code),
        "year_min": y0, "year_max": y1, "value": value,
        "citation_url": s["url"], "citation_title": s["title"], "citation_locator": locator,
        "cited_on": CITED_ON, "qualifiers": q,
    }


USED = set()
# Existing uncited rows for the same RPO codes: referenced, not forked.
RPO_REFS = {
    "M20": [{"table": "vintage_rpo_codes", "id": "ef7d7ca0-7535-4163-8d48-4bbde24edb16"},
            {"table": "gm_rpo_library", "id": "32a21098-18d0-401c-96a5-5b89f5c88c07"}],
    "M21": [{"table": "vintage_rpo_codes", "id": "0e1939f8-ecfd-4354-be54-cdc693d6ba5a"},
            {"table": "gm_rpo_library", "id": "31a30589-d8b0-4b99-9331-aa820b54718f"}],
    "M22": [{"table": "vintage_rpo_codes", "id": "360597b6-9447-45a1-9dd4-2223b215be55"},
            {"table": "gm_rpo_library", "id": "32a7d895-487c-4b3f-abdb-d926a42725a9"}],
}
SOURCE_NOTES = {
    "parts_place": {"parse": "pdftotext -layout, then parse_parts_place.py (1 of 1,221 table rows unparsed (counted by carb + casting + mains): p.5 '12 5 63 421 405 Powerglide')",
                    "rule": "a stamp code repeats across years and bodies; resolve it with the block casting or the date",
                    "exact_duplicates_removed": True},
    "hpp_1973": {"method": "hand transcription of the scanned pages (scripts/decode-rules/hpp_1973_firebird.json); italic engine codes recorded as updated_emissions"},
}


def source_rows(src_dir):
    out = []
    for key in sorted(USED):
        s = SOURCES[key]
        v = {"title": s["title"], "retrieved_on": CITED_ON}
        h = sha(src_dir, key)
        if h:
            v["copy_sha256"] = h
            v["copy_file"] = s["file"]
        v.update(SOURCE_NOTES.get(key, {}))
        out.append({"rule_key": "chart_source", "make": None, "model": None, "code": key, "year_min": None, "year_max": None,
                    "value": v, "citation_url": s["url"], "citation_title": s["title"], "citation_locator": "whole document",
                    "cited_on": CITED_ON, "qualifiers": {}})
    return out


def page_text(path):
    t = open(path, encoding="utf-8", errors="ignore").read()
    t = re.sub(r"<(script|style).*?</\1>", "", t, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "|", t))
    return re.sub(r"\|[\s|]*\|", "|", t)


def must_contain(path, needle):
    if needle not in page_text(path):
        raise SystemExit(f"source check failed: {os.path.basename(path)} lacks {needle!r}")


# --------------------------------------------------------------------------------------------
def muncie(src):
    txt = open(os.path.join(src, "randys.txt"), encoding="utf-8").read()
    for needle in ["2.56               1.91", "2.52 / 1.88 / 1.46 / 1.00 / 3.11", "3925661", "3857584", "P7D27", "Ratio Code Chart"]:
        if needle not in txt:
            raise SystemExit(f"RANDYS text lacks {needle!r}")
    out = []
    loc_avail = "p.1, 'Ratios that were available' table, with reverse and rings from 'Ratios of the M20, M21, M22'"
    for model, y0, y1, cs, gears, rev, rings, spl in [
        ("M20", 1963, 1965, "7/8", [2.56, 1.91, 1.48, 1.00], 3.16, 0, "10"),
        ("M20", 1965, 1974, "1", [2.52, 1.88, 1.46, 1.00], 3.11, 2, "10 or 26"),
        ("M21", 1963, 1965, "7/8", [2.20, 1.64, 1.28, 1.00], 2.27, 1, "10 or 26"),
        ("M21", 1965, 1974, "1", [2.20, 1.64, 1.28, 1.00], 2.27, 1, "10 or 26"),
        ("M22", 1967, 1974, "1", [2.20, 1.64, 1.28, 1.00], 2.27, 0, "10 or 26"),
    ]:
        out.append(row(src, "randys_muncie", "transmission_gear_ratios", "GM", None, model, y0, y1,
                       {"family": "Muncie 4-speed", "speeds": 4, "gears": gears, "reverse": rev,
                        "countershaft_in": cs, "input_rings": rings, "input_splines": spl},
                       loc_avail, lookup_by="model + countershaft size (from the case casting)",
                       also_in=RPO_REFS.get(model),
                       year_note="the ratio section gives M20 2.52 as 1966-1974; the availability table gives 1965-74 with the 1-inch countershaft" if (model == "M20" and y0 == 1965) else None))
    for model, y0, y1, rings, spl, teeth in [
        ("M20", 1963, 1965, 0, 10, 24), ("M20", 1966, 1970, 2, 10, 21), ("M20", 1970, 1974, 2, 26, 21),
        ("M21", 1963, 1970, 1, 10, 26), ("M21", 1970, 1974, 1, 26, 26),
        ("M22", 1967, 1970, 0, 10, 26), ("M22", 1969, 1974, 0, 26, 26),
    ]:
        out.append(row(src, "randys_muncie", "transmission_input_shaft", "GM", None, model, y0, y1,
                       {"family": "Muncie 4-speed", "rings": rings, "splines": spl, "teeth": teeth},
                       "p.1, 'Input Shaft Tooth and Spline Count Related to Year'",
                       caveat="some GM and aftermarket input shafts carry no identifying rings; GM stopped the marks after 1974"))
    for code, y0, y1, pin, note in [
        ("3831704", 1963, 1963, "7/8", "207 input bearing"), ("3839606", 1963, 1964, "7/8", None),
        ("3851325", 1964, 1965, "7/8", None), ("3864848", 1965, 1965, "7/8", None),
        ("3864___", 1965, 1965, "7/8", "last 3 digits milled off"), ("3885010", 1965, 1967, "1", None),
        ("3925660", 1968, 1970, "1", None), ("3925661", 1970, 1974, "1", "used in some early 1975 cars"),
    ]:
        v = {"family": "Muncie 4-speed", "countershaft_in": pin}
        if note:
            v["note"] = note
        out.append(row(src, "randys_muncie", "transmission_case_casting", "GM", None, code, y0, y1, v,
                       "p.1, 'Case casting numbers'"))
    out.append(row(src, "randys_muncie", "transmission_tailhousing_casting", "GM", None, "3857584", 1966, 1970,
                   {"family": "Muncie 4-speed", "output_splines": 27, "speedo_side": "passenger"}, "p.1, 'Important Notes'",
                   rule_note="all other tails used the driver-side speedometer output except 32-spline tails"))
    out.append(row(src, "randys_muncie", "transmission_tailhousing_casting", "GM", None, "3978764", 1970, 1974,
                   {"family": "Muncie 4-speed", "output_splines": 32, "speedo_side": "passenger"}, "p.1, 'Important Notes'"))
    months = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "H": 6, "K": 7, "M": 8, "P": 9, "R": 10, "S": 11, "T": 12}
    loc_ser = "p.1, 'Serial and VIN Numbers', 'Month Code Chart', 'Ratio Code Chart'"
    out.append(row(src, "randys_muncie", "transmission_serial_format", "GM", None, "P_MMDD", 1963, 1966,
                   {"family": "Muncie 4-speed", "pattern": "^P(\\d{2})(\\d{2})$", "fields": ["month", "day"],
                    "encodes_year": False, "encodes_model": False, "example": "P0101 = January 1"}, loc_ser))
    out.append(row(src, "randys_muncie", "transmission_serial_format", "GM", None, "P_YMDD", 1967, 1968,
                   {"family": "Muncie 4-speed", "pattern": "^P(\\d)([A-Z])(\\d{2})$", "fields": ["model_year_digit", "month_letter", "day"],
                    "encodes_year": True, "encodes_model": False, "month_letters": months,
                    "example": "P7D27 = April 27, 1967 model year",
                    "build_year_rule": "September-December dates were assembled in the calendar year before the model year"}, loc_ser))
    out.append(row(src, "randys_muncie", "transmission_serial_format", "GM", None, "P_YMDDR", 1969, 1974,
                   {"family": "Muncie 4-speed", "pattern": "^P(\\d)([A-Z])(\\d{2})([ABC])$",
                    "fields": ["model_year_digit", "month_letter", "day", "ratio_letter"], "encodes_year": True, "encodes_model": True,
                    "month_letters": months, "ratio_letters": {"A": "M20", "B": "M21", "C": "M22"},
                    "examples": ["P9R12C = October 12, 1968, 1969 model year, M22", "P4K31B = July 31, 1974, M21"],
                    "build_year_rule": "September-December dates were assembled in the calendar year before the model year"}, loc_ser))
    return out


def saginaw(src):
    p = os.path.join(src, "aa-sag.html")
    for n in ["Saginaw 3-Speed Transmission", "4-Speed Saginaw Transmission Gear Ratios", "Dates Produced: 1966 to 1985"]:
        must_contain(p, n)
    out = []
    for grooves, g in [(0, [2.85, 1.68, 1.0]), (1, [2.54, 1.50, 1.0]), (2, [3.11, 1.84, 1.0]), (3, [3.50, 1.89, 1.0])]:
        out.append(row(src, "aa_saginaw", "transmission_gear_ratios", "GM", None, f"SAGINAW_3SP_G{grooves}", 1966, 1985,
                       {"family": "Saginaw 3-speed", "speeds": 3, "gears": g, "reverse": None, "input_shaft_grooves": grooves},
                       "'Saginaw 3-Speed Transmission Gear Ratios' table",
                       lookup_by="grooves cut across the input-shaft clutch splines", year_basis="'Dates Produced: 1966 to 1985' on the same page"))
    for grooves, g in [(0, [2.84, 2.01, 1.35, 1.0]), (1, [2.54, 1.80, 1.44, 1.0]), (2, [3.11, 2.20, 1.47, 1.0]), (3, [3.50, 2.47, 1.65, 1.0])]:
        out.append(row(src, "aa_saginaw", "transmission_gear_ratios", "GM", None, f"SAGINAW_4SP_G{grooves}", 1966, 1985,
                       {"family": "Saginaw 4-speed", "speeds": 4, "gears": g, "reverse": None, "input_shaft_grooves": grooves},
                       "'4-Speed Saginaw Transmission Gear Ratios' table",
                       lookup_by="grooves cut across the input-shaft clutch splines", year_basis="'Dates Produced: 1966 to 1985' on the same page"))
    out.append(row(src, "aa_saginaw", "transmission_id_rule", "GM", None, "SAGINAW_CASE_CODE", 1966, 1985,
                   {"rule": "code on the passenger side of the rear cover: 3-speed codes begin with S, 4-speed with O; 3-speeds have two linkage arms, 4-speeds three",
                    "rpo": {"M15": "3-speed", "M26/M27": "4-speed"}}, "'Saginaw 3-Speed Identification' paragraph",
                   conflicts_with="itstillruns.com says R marks a 4-speed; not used as a row"))
    return out


def parts_place(src):
    pdf = os.path.join(src, "pontiac-engine-codes.pdf")
    tmp_txt = os.path.join(os.environ.get("TMPDIR", "/tmp"), "pp_codes_layout.txt")
    tmp_json = tmp_txt + ".json"
    subprocess.run(["pdftotext", "-layout", pdf, tmp_txt], check=True)
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "parse_parts_place.py"), tmp_txt, tmp_json],
                       check=True, capture_output=True, text=True)
    parsed = json.load(open(tmp_json))
    out = []
    for d in parsed:
        yy = int(d["yr"])
        year = 1900 + yy
        v = {"displacement_ci": int(d["cid"]), "hp": int(d["hp"]), "transmission": d["trans"].strip(),
             "carb": d["carb"], "block_casting": d["cast"], "mains": int(d["main"])}
        for k in ("rpo", "vin", "notes"):
            if d.get(k):
                v["vin_engine_char" if k == "vin" else k] = d[k]
        out.append(row(src, "parts_place", "engine_stamp_code", "Pontiac", d["car"], d["code"], year, year, v,
                       f"p.{d['page']}"))
    return out, r.stdout.strip()


def butler_blocks(src):
    t = open(os.path.join(src, "butler-blocks.html"), encoding="utf-8", errors="ignore").read()
    tables = re.findall(r"<table.*?</table>", t, flags=re.S)[:4]
    out = []
    for tb in tables:
        for r in re.findall(r"<tr.*?</tr>", tb, flags=re.S)[1:]:
            c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, flags=re.S)]
            year, cid, casts, note = c[0], c[1], c[2], (c[3] if len(c) > 3 else "")
            for cast in [x.strip() for x in casts.split(",")]:
                v = {"displacement_ci": int(cid), "family": "Pontiac V8" if int(cid) >= 287 else "Pontiac"}
                if note:
                    v["note"] = note
                out.append(row(src, "butler_blocks", "block_casting", "Pontiac", None, cast, int(year), int(year), v,
                               "'Casting Numbers by Year' tables",
                               needs_verification=True if "verify" in note or "sources differ" in note else None))
    out.append(row(src, "butler_blocks", "block_date_format", "Pontiac", None, "LDDY", 1955, 1981,
                   {"pattern": "^([A-L])(\\d{1,2})(\\d)$", "fields": ["month_letter", "day", "year_digit"],
                    "examples": ["J23 on 9773155 = October 2, 1963 (a 1964-model 389)", "F126 on 9782611 = June 12, 1966"],
                    "rule": "blocks are cast a few months before the car is built, so the cast year may be one model year earlier"},
                   "'Reading the Date Code'", year_bound_stated=False))
    return out


def heads(src):
    must_contain(os.path.join(src, "pp-heads.html"), "A=January")
    must_contain(os.path.join(src, "butler-heads.html"), "the 1969 400 Ram Air III big-valve head")
    return [
        row(src, "pontiac_power_heads", "head_casting_date_format", "Pontiac", None, "LDDY", 1955, 1981,
            {"pattern": "^([A-Z])(\\d{1,2})(\\d)$", "fields": ["month_letter", "day", "year_digit"],
             "quoted": "The date code is a 3 or 4 digit code. The first digit will be a letter. A=January, B=February, C=March, etc. Followed by a 1 or 2 digit number for the day of the month. The last digit will be the year.",
             "head_code_location": "center exhaust ports (two or three digits from 1965)"},
            "intro paragraphs above the casting table", year_bound_stated=False),
        row(src, "pontiac_power_heads", "head_code", "Pontiac", None, "48", 1969, 1969,
            {"applications": [{"displacement_ci": 350, "hp": 325, "valves_in": [2.11, 1.77], "chamber_cc": 72},
                              {"displacement_ci": 400, "hp": "330, 335, 350, 366", "valves_in": [2.11, 1.77], "chamber_cc": 72, "note": "MT Ram Air III"}]},
            "casting table, rows for 48", conflicts_with="Butler Performance: 48 = 1969 400 Ram Air III only"),
        row(src, "butler_heads", "head_code", "Pontiac", None, "48", 1969, 1969,
            {"applications": [{"displacement_ci": 400, "application": "Ram Air III", "valves_in": [2.11, 1.77]}],
             "quoted": "#48: the 1969 400 Ram Air III big-valve head; the legacy \"350 HO\" pairing doesn't match (the 350 HO uses small 1.96/1.66 valves) — confirm before relying on it."},
            "verification notes, #48", conflicts_with="Pontiac Power lists 48 for a 1969 350 as well"),
    ]


def hpp(src):
    d = json.load(open(os.path.join(HERE, "hpp_1973_firebird.json")))
    s = d["_source"]
    SOURCES["hpp_1973"] = {"url": s["url"], "title": s["title"], "file": None}
    out = []
    for r in d["rows"]:
        for code in r.get("codes", [r.get("code")]):
            out.append(row(src, "hpp_1973", r["rule_key"], "Pontiac", "Firebird", code, 1973, 1973, r["value"], r["locator"],
                           **r.get("qualifiers", {})))
    return out


def availability(src):
    must_contain(os.path.join(src, "tz73opt.html"), "Not available with 350cid (35M/L30) V-8 or 400cid (35R/L65)i V-8 2BBL")
    must_contain(os.path.join(src, "tz-1973Models.html"), "M20 4 speed Manual Floor Shift  (with 350 V8 Only)")
    must_contain(os.path.join(src, "tz-1974Options.html"), "Not available with 6 Cylinder (35D)")
    return [
        row(src, "gmc_1973_catalogue", "model_availability", "Pontiac", "Firebird", "S87:D:M20", 1973, 1973,
            {"series": "Firebird (base)", "engine": "250 six", "transmission": "4-speed manual", "available": False,
             "quoted": "Transmissions | Standard | 3-spd. manual | Optional | Hydra-matic", "quoted_column": "FIREBIRD", "other_columns_note": "Esprit and Formula list 3-spd. manual, 4-spd. manual, Hydra-matic; Trans Am 4-spd. manual, Hydra-matic",
             "also_listed": {"tires_standard": "E 78-14", "wheel_size": "14 x 6 in.", "engine_standard_6cyl": "250-1", "engine_optional_8cyl": "350-2"}},
            "specifications table (page image firebird73-brochure-5), Firebird column", market="Canada", source_type="factory catalogue",
            conflicts_with="tran-zam 1973 options 36E/M20 row"),
        row(src, "tranzam_1973_models", "model_availability", "Pontiac", "Firebird", "S87:D:M20", 1973, 1973,
            {"series": "Firebird (base)", "engine": "250 six", "transmission": "M20 4-speed", "available": False,
             "quoted": "M20 4 speed Manual Floor Shift  (with 350 V8 Only)"},
            "Base Firebird S87, Optional Transmission", market="US", source_type="enthusiast reference",
            conflicts_with="tran-zam 1973 options 36E/M20 row (same site)"),
        row(src, "tranzam_1973_options", "model_availability", "Pontiac", "Firebird", "S87:D:M20", 1973, 1973,
            {"series": "Firebird (base)", "engine": "250 six (35D/L20)", "transmission": "M20 4-speed (36E)", "available": "implied",
             "quoted": "36E | M20 | 4 Speed Manual Transmission | $ 200.00 | A | A | A | S | Not available with 350cid (35M/L30) V-8 or 400cid (35R/L65)i V-8 2BBL",
             "inference": "Base column is A; the base series offered only 35D and 35M, so excluding 35M leaves the six"},
            "options table, 36E / M20 row", market="US", source_type="enthusiast reference",
            conflicts_with="GM of Canada 1973 catalogue; tran-zam 1973 models"),
        row(src, "tranzam_1974_options", "model_availability", "Pontiac", "Firebird", "S87:D:M20", 1974, 1974,
            {"series": "Firebird (base)", "engine": "250 six (35D)", "transmission": "M20 4-speed (36E)", "available": False,
             "quoted": "Not available with 6 Cylinder (35D), 400 ci V-8 2BBL (35R), or 455, 4 bbl (35W)."},
            "options table, 36E / M20 row", market="US", source_type="enthusiast reference"),
    ]


def main():
    src, out_path = sys.argv[1], sys.argv[2]
    pp_rows, pp_log = parts_place(src)
    rows = muncie(src) + saginaw(src) + pp_rows + butler_blocks(src) + heads(src) + hpp(src) + availability(src)
    rows += source_rows(src)
    dedup = []
    seen = set()
    for r in rows:
        k = (r["rule_key"], r["make"], r["model"], r["code"], r["year_min"], r["year_max"], r["citation_url"], json.dumps(r["value"], sort_keys=True))
        if k not in seen:
            seen.add(k)
            dedup.append(r)
    # vehicle_decode_rules allows one current row per (rule_key, make, model, code, years, citation_url).
    # A chart that prints several lines for one such key keeps them all, as value.variants.
    groups = {}
    for r in dedup:
        groups.setdefault((r["rule_key"], r["make"] or "", r["model"] or "", r["code"] or "", r["year_min"] or 0, r["year_max"] or 0, r["citation_url"]), []).append(r)
    merged = []
    for k, rs in groups.items():
        if len(rs) == 1:
            merged.append(rs[0]); continue
        base = dict(rs[0])
        base["value"] = {"variants": [dict(x["value"], locator=x["citation_locator"]) for x in rs]}
        base["citation_locator"] = ", ".join(sorted({x["citation_locator"] for x in rs}))
        base["qualifiers"] = dict(rs[0]["qualifiers"], variants=len(rs), variant_rule="the chart prints several lines for this code, year and body; all are kept")
        merged.append(base)
    dedup = merged
    json.dump(dedup, open(out_path, "w"), indent=0)
    from collections import Counter
    print(pp_log)
    print(len(rows), "rows,", len(dedup), "after exact-duplicate removal")
    for k, n in sorted(Counter((r["citation_url"].split("/")[2], r["rule_key"]) for r in dedup).items()):
        print(n, *k)


if __name__ == "__main__":
    main()
