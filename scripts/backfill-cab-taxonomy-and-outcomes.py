#!/usr/bin/env python3
"""
Cars & Bids Multi-Axis Taxonomy (`series`, `trim`, `body_style`), Outcome & Sale Date Backfill,
and Materialized View Refresh Script.

Usage:
  dotenvx run -- python3 scripts/backfill-cab-taxonomy-and-outcomes.py [--dry-run] [--skip-mv-refresh]
"""
import argparse
import os
import re
import socket
import sys
import time
import psycopg2
from psycopg2.extras import execute_values


def clean_cab_text(raw):
    if not raw:
        return ""
    cleaned = re.sub(r"[\u2013\u2014]", "-", str(raw))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"\s+Watch$", "", cleaned, flags=re.I).strip()
    return cleaned


def strip_leading_year_and_mileage(headline):
    s = clean_cab_text(headline)
    s = re.sub(r"^(?:[\d,]+\s*k?-?\s*mile\s+)+", "", s, flags=re.I)
    s = re.sub(r"^(?:19\d{2}|20\d{2})\s+", "", s)
    return s.strip()


def normalize_body_style(raw_body, combined_text, make, model, year):
    t = combined_text
    raw = clean_cab_text(raw_body)
    make_l = (make or "").strip().lower()
    model_l = (model or "").strip().lower()
    yr = year or 0

    if re.search(r"\btarga\b", t, re.I):
        return "Targa"
    if re.search(r"\bspeedster\b", t, re.I):
        return "Speedster"
    if re.search(r"\bspyder\b|\bspider\b", t, re.I):
        return "Roadster" if ("porsche" in make_l or "audi" in make_l) else "Spider"
    if re.search(r"\broadster\b", t, re.I):
        return "Roadster"
    if re.search(r"\bcabriolet\b|\bdrophead\b", t, re.I):
        return "Cabriolet" if "porsche" in make_l else "Convertible"
    if re.search(r"\bconvertible\b|\bsoft\s*top\b", t, re.I):
        return "Convertible"
    if re.search(r"\bfastback\b|\bsportsroof\b", t, re.I):
        return "Fastback"
    if re.search(r"\bshooting\s*brake\b", t, re.I):
        return "Shooting Brake"
    if re.search(r"\bsport\s*turismo\b|\bcross\s*turismo\b|\bavant\b|\btouring\s*wagon\b|\bestate\b|\bwagon\b", t, re.I):
        return "Wagon"

    is_truck_family = bool(
        re.search(
            r"\b(c10|k10|c20|k20|c30|k30|r10|v10|r20|v20|c1500|k1500|c2500|k2500|silverado|sierra|f-?100|f-?150|f-?250|f-?350|f-?450|super\s*duty|ram\s*1500|ram\s*2500|ram\s*3500|tacoma|tundra|ranger|gladiator|ridgeline|maverick|santa\s*cruz|cybertruck|r1t|pickup|truck|apache|3100|3600|3800|cameo|syclone)\b",
            f"{model_l} {t}",
            re.I,
        )
    )
    if is_truck_family:
        if re.search(r"\bstepside\b|\bstep-side\b|\bthriftside\b|\bfenderside\b|\bflareside\b", t, re.I):
            return "Stepside Pickup"
        if re.search(r"\bfleetside\b|\bfleet-side\b|\bwideside\b|\bstyleside\b|\bsweptline\b", t, re.I):
            return "Fleetside Pickup"
        if re.search(r"\bcrew\s*cab\b|\bsupercrew\b|\bdouble\s*cab\b|\bquad\s*cab\b|\bmega\s*cab\b", t, re.I):
            return "Crew Cab Pickup"
        if re.search(r"\bextended\s*cab\b|\bsupercab\b|\bking\s*cab\b|\baccess\s*cab\b|\bclub\s*cab\b|\bext\s*cab\b", t, re.I):
            return "Extended Cab Pickup"
        if re.search(r"\bregular\s*cab\b|\bsingle\s*cab\b|\bstandard\s*cab\b", t, re.I):
            return "Regular Cab Pickup"
        return "Pickup"

    if re.search(r"\bgran\s*coupe\b|\bsportback\b|\b4-door\s*coupe\b", t, re.I):
        return "Sedan"
    if re.search(r"\bhatchback\b", t, re.I) or re.match(r"^hatchback$", raw, re.I):
        return "Hatchback"
    if re.search(r"\bsedan\b|\bsaloon\b", t, re.I) or re.match(r"^sedan$", raw, re.I):
        return "Sedan"
    if re.search(r"\bcoupe\b|\bhardtop\b|\bberlinetta\b", t, re.I) or re.match(r"^coupe$", raw, re.I):
        return "Coupe"
    if re.search(r"\bvan\b|\bminivan\b|\bsprinter\b|\btransit\b|\beurovan\b|\bvanagon\b|\bwestfalia\b", t, re.I) or re.match(r"^van", raw, re.I):
        return "Van"

    if re.match(r"^suv/crossover$|^suv$", raw, re.I):
        return "SUV"
    if re.match(r"^truck$", raw, re.I):
        return "Pickup"
    if re.match(r"^wagon$", raw, re.I):
        return "Wagon"
    if re.match(r"^convertible$", raw, re.I):
        return "Convertible"

    if (
        re.search(
            r"\b(land\s*cruiser|bronco|wrangler|cherokee|grand\s*cherokee|4runner|sequoia|gx\s*\d+|lx\s*\d+|tahoe|suburban|yukon|escalade|blazer|jimmy|defender|discovery|range\s*rover|lr3|lr4|g\s*500|g\s*550|g\s*63|g\s*55|g-class|cayenne|macan|x3|x5|x7|q5|q7|q8|rs\s*q8|r1s|model\s*x|model\s*y|fj\s*cruiser|pathfinder|armada|patrol|pajero|montero|trooper|vehicross|scout)\b",
            f"{model_l} {t}",
            re.I,
        )
        and yr > 0
    ):
        return "SUV"

    return raw or None


def normalize_cab_model(make, raw_model, headline):
    m = clean_cab_text(raw_model)
    h = strip_leading_year_and_mileage(headline)
    make_l = (make or "").strip().lower()

    if make_l == "ford" and re.match(r"^super\s*duty$", m, re.I):
        f_match = re.search(r"\b(F-?(?:250|350|450|550))\b", h, re.I)
        if f_match:
            num = re.sub(r"[^0-9]", "", f_match.group(1))
            return f"F-{num} Super Duty"
    if make_l == "bmw":
        if re.match(r"^02\s*series$", m, re.I):
            if re.search(r"\b2002\s*tii\b|\b2002tii\b", h, re.I):
                return "2002tii"
            if re.search(r"\b2002\s*turbo\b", h, re.I):
                return "2002 Turbo"
            if re.search(r"\b1600\b|\b1602\b", h, re.I):
                return "1600"
            return "2002"
        if re.match(r"^[1-8]\s*series$", m, re.I):
            code = re.search(
                r"\b([1-8]\d{2}(?:i|is|xi|d|e|ti|ci|li|il|csi|csl)?(?:\s*xDrive)?|M[1-8]\d{2}i?(?:\s*xDrive)?)\b",
                h,
                re.I,
            )
            if code:
                return code.group(1)
    if make_l == "mercedes-benz" and re.search(r"glk-\s*class", m, re.I):
        return "GLK-Class"

    return m or None


def extract_cab_facets(year, make, model, title, sub_title=None, existing_body_style=None):
    yr = year or 0
    raw_headline = clean_cab_text(title) or clean_cab_text(model)
    headline = strip_leading_year_and_mileage(raw_headline)
    subtitle = clean_cab_text(sub_title)
    normalized_model = normalize_cab_model(make, model, headline)
    primary_text = f"{normalized_model or clean_cab_text(model)} {headline}".strip()
    combined = f"{primary_text} {subtitle}".strip()
    make_l = clean_cab_text(make).lower()
    model_l = (normalized_model or clean_cab_text(model)).lower()

    series = None
    trim = None

    # 1. PORSCHE
    if "porsche" in make_l:
        is_911 = bool(
            re.search(r"\b911\b|\b930\b|\b964\b|\b993\b|\b996\b|\b997\b|\b991\b|\b992\b|\bcarrera\b|\btarga\b|\bgt3\b|\bgt2\b", model_l, re.I)
            or re.search(r"\b911\b|\b930\b|\b964\b|\b993\b|\b996\b|\b997\b|\b991\b|\b992\b|\bgt3\b|\bgt2\b", headline, re.I)
        )
        if is_911:
            if re.search(r"\b992\.2\b", combined, re.I):
                series = "992.2"
            elif re.search(r"\b992\.1\b|\b992\b", combined, re.I):
                series = "992"
            elif re.search(r"\b991\.2\b", combined, re.I):
                series = "991.2"
            elif re.search(r"\b991\.1\b|\b991\b", combined, re.I):
                series = "991"
            elif re.search(r"\b997\.2\b", combined, re.I):
                series = "997.2"
            elif re.search(r"\b997\.1\b|\b997\b", combined, re.I):
                series = "997"
            elif re.search(r"\b996\b", combined, re.I):
                series = "996"
            elif re.search(r"\b993\b", combined, re.I):
                series = "993"
            elif re.search(r"\b964\b", combined, re.I):
                series = "964"
            elif re.search(r"\b930\b", combined, re.I):
                series = "930"
            elif yr >= 2019:
                series = "992"
            elif yr >= 2017:
                series = "991.2"
            elif yr >= 2012:
                series = "991"
            elif yr >= 2009:
                series = "997.2"
            elif yr >= 2005:
                series = "997"
            elif yr >= 1999:
                series = "996"
            elif yr >= 1995:
                series = "993"
            elif yr >= 1989:
                series = "964"
            elif yr >= 1974:
                series = "930" if re.search(r"\bturbo\b", primary_text, re.I) else "G-Body"
            elif yr >= 1964:
                series = "F-Series"

            if re.search(r"\bgt2\s*rs\b", primary_text, re.I):
                trim = "GT2 RS"
            elif re.search(r"\bgt3\s*rs\b", primary_text, re.I):
                trim = "GT3 RS"
            elif re.search(r"\bgt3\s*touring\b", primary_text, re.I):
                trim = "GT3 Touring"
            elif re.search(r"\bgt3\b", primary_text, re.I):
                trim = "GT3"
            elif re.search(r"\bgt2\b", primary_text, re.I):
                trim = "GT2"
            elif re.search(r"\bs/t\b|\b911\s*st\b", primary_text, re.I):
                trim = "S/T"
            elif re.search(r"\bdakar\b", primary_text, re.I):
                trim = "Dakar"
            elif re.search(r"\bsport\s*classic\b", primary_text, re.I):
                trim = "Sport Classic"
            elif re.search(r"\b911\s*r\b", primary_text, re.I):
                trim = "911 R"
            elif re.search(r"\bturbo\s*s\b", primary_text, re.I):
                trim = "Turbo S"
            elif re.search(r"\bturbo\b", primary_text, re.I):
                trim = "Turbo"
            elif re.search(r"\bcarrera\s*rs\b|\brs\s*america\b", primary_text, re.I):
                trim = "Carrera RS"
            elif re.search(r"\bcarrera\s*4\s*gts\b|\bc4\s*gts\b|\btarga\s*4\s*gts\b", primary_text, re.I):
                trim = "4 GTS"
            elif re.search(r"\bcarrera\s*gts\b|\b911\s*gts\b|\btarga\s*gts\b", primary_text, re.I):
                trim = "GTS"
            elif re.search(r"\bcarrera\s*4s\b|\bc4s\b|\btarga\s*4s\b", primary_text, re.I):
                trim = "4S"
            elif re.search(r"\bcarrera\s*s\b", primary_text, re.I):
                trim = "Carrera S"
            elif re.search(r"\bcarrera\s*t\b", primary_text, re.I):
                trim = "Carrera T"
            elif re.search(r"\bcarrera\s*4\b|\btarga\s*4\b", primary_text, re.I):
                trim = "Carrera 4"
            elif re.search(r"\b911\s*sc\b|\bsuper\s*carrera\b", primary_text, re.I):
                trim = "SC"
            elif re.search(r"\bcarrera\b", primary_text, re.I):
                trim = "Carrera"
            elif re.search(r"\btarga\b", primary_text, re.I):
                trim = "Targa"
            elif re.search(r"\b911s\b|\b911\s*s\b", primary_text, re.I):
                trim = "S"
            elif re.search(r"\b911e\b|\b911\s*e\b", primary_text, re.I):
                trim = "E"
            elif re.search(r"\b911t\b|\b911\s*t\b", primary_text, re.I):
                trim = "T"
        elif re.search(r"\bboxster\b|\bcayman\b|\b718\b", primary_text, re.I):
            if re.search(r"\b982\b|\b718\b", combined, re.I) or yr >= 2017:
                series = "982 / 718"
            elif re.search(r"\b981\b", combined, re.I) or (2013 <= yr <= 2016):
                series = "981"
            elif re.search(r"\b987\b", combined, re.I) or (2005 <= yr <= 2012):
                series = "987"
            elif re.search(r"\b986\b", combined, re.I) or (1997 <= yr <= 2004):
                series = "986"

            if re.search(r"\bgt4\s*rs\b", primary_text, re.I):
                trim = "GT4 RS"
            elif re.search(r"\bgt4\b", primary_text, re.I):
                trim = "GT4"
            elif re.search(r"\bspyder\s*rs\b", primary_text, re.I):
                trim = "Spyder RS"
            elif re.search(r"\bspyder\b", primary_text, re.I):
                trim = "Spyder"
            elif re.search(r"\bgts\s*4\.0\b", primary_text, re.I):
                trim = "GTS 4.0"
            elif re.search(r"\bgts\b", primary_text, re.I):
                trim = "GTS"
            elif re.search(r"\bcayman\s*r\b", primary_text, re.I):
                trim = "R"
            elif re.search(r"\bboxster\s*s\b|\bcayman\s*s\b", primary_text, re.I):
                trim = "S"
            elif re.search(r"\bboxster\s*t\b|\bcayman\s*t\b", primary_text, re.I):
                trim = "T"
            else:
                trim = "Base"
        elif re.search(r"\b356\b", primary_text, re.I):
            if re.search(r"\b356\s*c\b|\b356c\b", primary_text, re.I) or (1964 <= yr <= 1965):
                series = "356C"
            elif re.search(r"\b356\s*b\b|\b356b\b", primary_text, re.I) or (1960 <= yr <= 1963):
                series = "356B"
            elif re.search(r"\b356\s*a\b|\b356a\b", primary_text, re.I) or (1955 <= yr <= 1959):
                series = "356A"
            else:
                series = "Pre-A"
            if re.search(r"\bcarrera\b", primary_text, re.I):
                trim = "Carrera"
            elif re.search(r"\bsuper\s*90\b|\bs90\b", primary_text, re.I):
                trim = "Super 90"
            elif re.search(r"\b1600\s*sc\b|\b356\s*sc\b|\b356c\s*1600\s*sc\b", primary_text, re.I):
                trim = "SC"
            elif re.search(r"\b1600\s*super\b|\bsuper\b", primary_text, re.I):
                trim = "Super"
        elif re.search(r"\bcayenne\b", primary_text, re.I):
            if re.search(r"\b955\b", combined, re.I) or (2003 <= yr <= 2006):
                series = "955"
            elif re.search(r"\b957\b", combined, re.I) or (2008 <= yr <= 2010):
                series = "957"
            elif re.search(r"\b958\b", combined, re.I) or (2011 <= yr <= 2018):
                series = "958"
            elif yr >= 2019:
                series = "9Y0"
            if re.search(r"\bturbo\s*gt\b", primary_text, re.I):
                trim = "Turbo GT"
            elif re.search(r"\bturbo\s*s\b", primary_text, re.I):
                trim = "Turbo S"
            elif re.search(r"\bturbo\b", primary_text, re.I):
                trim = "Turbo"
            elif re.search(r"\bgts\b", primary_text, re.I):
                trim = "GTS"
            elif re.search(r"\btranssyberia\b", primary_text, re.I):
                trim = "Transsyberia"
            elif re.search(r"\bdiesel\b", primary_text, re.I):
                trim = "Diesel"
            elif re.search(r"\be-hybrid\b|\bhybrid\b", primary_text, re.I):
                trim = "E-Hybrid"
            elif re.search(r"\bcayenne\s*s\b", primary_text, re.I):
                trim = "S"
            else:
                trim = "Base"
        elif re.search(r"\bmacan\b|\bpanamera\b|\btaycan\b", primary_text, re.I):
            if re.search(r"\b95b\b", combined, re.I) or "macan" in model_l:
                series = "95B"
            elif re.search(r"\b970\b", combined, re.I) or ("panamera" in model_l and yr <= 2016):
                series = "970"
            elif re.search(r"\b971\b", combined, re.I) or ("panamera" in model_l and yr >= 2017):
                series = "971"
            elif "taycan" in model_l:
                series = "J1"
            if re.search(r"\bturbo\s*s\b", primary_text, re.I):
                trim = "Turbo S"
            elif re.search(r"\bturbo\b", primary_text, re.I):
                trim = "Turbo"
            elif re.search(r"\bgts\b", primary_text, re.I):
                trim = "GTS"
            elif re.search(r"\b4s\b", primary_text, re.I):
                trim = "4S"
            elif re.search(r"\b(?:macan|panamera|taycan)\s*s\b", primary_text, re.I):
                trim = "S"
            elif re.search(r"\b(?:macan|panamera)\s*t\b", primary_text, re.I):
                trim = "T"
            else:
                trim = "Base"

    # 2. BMW
    elif "bmw" in make_l:
        chassis_match = re.search(
            r"\b(E10|E12|E21|E23|E24|E28|E30|E31|E32|E34|E36|E38|E39|E46|E52|E53|E60|E61|E63|E64|E65|E70|E82|E85|E86|E89|E90|E91|E92|E93|F06|F10|F12|F13|F15|F22|F30|F31|F32|F36|F80|F82|F83|F85|F87|F90|G01|G05|G20|G22|G29|G30|G80|G82|G83|G87)\b",
            combined,
            re.I,
        )
        if re.search(r"\bm3\b", primary_text, re.I):
            if chassis_match:
                c = chassis_match.group(1).upper()
                series = "E90/E92/E93 M3" if c in ("E90", "E92", "E93") else f"{c} M3"
            elif yr >= 2021:
                series = "G80 M3"
            elif yr >= 2015:
                series = "F80 M3"
            elif yr >= 2008:
                series = "E90/E92/E93 M3"
            elif yr >= 2001:
                series = "E46 M3"
            elif yr >= 1994:
                series = "E36 M3"
            elif yr >= 1986:
                series = "E30 M3"
        elif re.search(r"\bm5\b", primary_text, re.I):
            if chassis_match:
                series = f"{chassis_match.group(1).upper()} M5"
            elif yr >= 2018:
                series = "F90 M5"
            elif yr >= 2012:
                series = "F10 M5"
            elif yr >= 2006:
                series = "E60 M5"
            elif yr >= 1999:
                series = "E39 M5"
            elif yr >= 1989:
                series = "E34 M5"
            elif yr >= 1985:
                series = "E28 M5"
        elif re.search(r"\bm2\b", primary_text, re.I):
            series = f"{chassis_match.group(1).upper()} M2" if chassis_match else ("G87 M2" if yr >= 2023 else "F87 M2")
        elif re.search(r"\bm4\b", primary_text, re.I):
            series = f"{chassis_match.group(1).upper()} M4" if chassis_match else ("G82/G83 M4" if yr >= 2021 else "F82/F83 M4")
        elif re.search(r"\bm6\b|\bm635csi\b", primary_text, re.I):
            if chassis_match:
                series = f"{chassis_match.group(1).upper()} M6"
            elif yr >= 2012:
                series = "F06/F12/F13 M6"
            elif yr >= 2006:
                series = "E63/E64 M6"
            elif yr <= 1989:
                series = "E24 M6"
        elif re.search(r"\b(1600|1602|2002|2002tii|2002\s*turbo)\b", primary_text, re.I) or "02 series" in model_l:
            series = "E10 / 02 Series"
        elif chassis_match:
            series = chassis_match.group(1).upper()
        elif re.search(r"\b3\d{2}[a-z]*\b", primary_text, re.I) or "3 series" in model_l:
            if yr >= 2019:
                series = "G20"
            elif yr >= 2012:
                series = "F30"
            elif yr >= 2006:
                series = "E90/E92/E93"
            elif yr >= 1999:
                series = "E46"
            elif yr >= 1992:
                series = "E36"
            elif yr >= 1984:
                series = "E30"
            elif yr >= 1977:
                series = "E21"
        elif re.search(r"\b5\d{2}[a-z]*\b", primary_text, re.I) or "5 series" in model_l:
            if yr >= 2017:
                series = "G30"
            elif yr >= 2011:
                series = "F10"
            elif yr >= 2004:
                series = "E60"
            elif yr >= 1997:
                series = "E39"
            elif yr >= 1989:
                series = "E34"
            elif yr >= 1982:
                series = "E28"
        elif re.search(r"\b7\d{2}[a-z]*\b", primary_text, re.I) or "7 series" in model_l:
            if yr >= 2016:
                series = "G11/G12"
            elif yr >= 2009:
                series = "F01/F02"
            elif yr >= 2002:
                series = "E65/E66"
            elif yr >= 1995:
                series = "E38"
            elif yr >= 1988:
                series = "E32"
        elif re.search(r"\b8\d{2}[a-z]*\b", primary_text, re.I) or "8 series" in model_l:
            series = "E31" if yr <= 1999 else "G15"
        elif re.search(r"\bz3\b", primary_text, re.I):
            series = "E36/7 / E36/8"
        elif re.search(r"\bz4\b", primary_text, re.I):
            if yr >= 2019:
                series = "G29"
            elif yr >= 2009:
                series = "E89"
            else:
                series = "E85/E86"
        elif re.search(r"\bz8\b", primary_text, re.I):
            series = "E52"

        if re.search(r"\bcsl\b", primary_text, re.I):
            trim = "CSL"
        elif re.search(r"\bcompetition\b", combined, re.I):
            trim = "Competition"
        elif re.search(r"\b\bcs\b", primary_text, re.I):
            trim = "CS"
        elif re.search(r"\bgts\b", primary_text, re.I):
            trim = "GTS"
        elif re.search(r"\blightweight\b|\bltw\b", primary_text, re.I):
            trim = "Lightweight"
        elif re.search(r"\bzcp\b", combined, re.I):
            trim = "ZCP Competition"
        elif re.search(r"\bzhp\b", combined, re.I):
            trim = "ZHP Performance Package"
        elif re.search(r"\b2002\s*tii\b|\b2002tii\b", primary_text, re.I):
            trim = "2002tii"
        elif re.search(r"\b2002\s*turbo\b", primary_text, re.I):
            trim = "2002 Turbo"
        elif re.search(r"\balpina\b", primary_text, re.I):
            trim = "Alpina"
        else:
            bmw_code = re.search(
                r"\b([1-8]\d{2}(?:i|is|xi|d|e|ti|ci|li|il|csi|csl)?(?:\s*xDrive)?|M[1-8]\d{2}i?(?:\s*xDrive)?)\b",
                primary_text,
                re.I,
            )
            if bmw_code:
                trim = bmw_code.group(1)

    # 3. TOYOTA
    elif "toyota" in make_l:
        if re.search(r"\bland\s*cruiser\b|\bfj\d{2}\b|\bbj\d{2}\b|\bhj\d{2}\b|\bfzj\d{2}\b|\buzj\d{2,3}\b|\burj\d{2,3}\b|\bkzj\d{2}\b|\bhzj\d{2}\b|\bhdj\d{2}\b", primary_text, re.I):
            j_match = re.search(r"\b(FJ40|FJ43|FJ45|BJ40|BJ42|BJ44|HJ45|HJ47|FJ55|FJ60|FJ62|HJ60|HJ61|FJ70|BJ70|HZJ7\d|KZJ7\d|LJ7\d|VDJ7\d|FJ80|FZJ80|HDJ80|HDJ81|HZJ80|KZJ9\d|KDJ9\d|UZJ100|HDJ100|URJ200|VDJ200|J250)\b", combined, re.I)
            if j_match:
                code = j_match.group(1).upper()
                if re.match(r"^(FJ|BJ|HJ)4", code):
                    series = "J40"
                    trim = code
                elif code == "FJ55":
                    series = "J55"
                    trim = "FJ55"
                elif re.match(r"^(FJ|HJ)6", code):
                    series = "J60"
                    trim = code
                elif re.match(r"^(FJ|BJ|HZJ|KZJ|LJ|VDJ)7", code):
                    series = "J70"
                    trim = code
                elif re.match(r"^(FJ|FZJ|HDJ|HZJ)8", code):
                    series = "J80"
                    trim = code
                elif re.match(r"^(KZJ|KDJ)9", code):
                    series = "J90 Prado"
                    trim = code
                elif re.match(r"^(UZJ|HDJ)100", code):
                    series = "J100"
                    trim = code
                elif re.match(r"^(URJ|VDJ)200", code):
                    series = "J200"
                    trim = code
                else:
                    series = code
            elif yr >= 2024:
                series = "J250"
            elif yr >= 2008:
                series = "J200"
            elif yr >= 1998:
                series = "J100"
            elif yr >= 1991:
                series = "J80"
                trim = "FJ80" if yr <= 1992 else "FZJ80"
            elif yr >= 1988:
                series = "J60"
                trim = "FJ62"
            elif yr >= 1981:
                series = "J60"
                trim = "FJ60"
            elif yr >= 1968 and re.search(r"\bwagon\b|\b55\b", primary_text, re.I):
                series = "J55"
                trim = "FJ55"
            elif yr <= 1984:
                series = "J40"
                trim = "FJ40"

            if re.search(r"\bheritage\s*edition\b", primary_text, re.I):
                trim = "Heritage Edition"
            elif re.search(r"\bfirst\s*edition\b", primary_text, re.I):
                trim = "First Edition"
            elif re.search(r"\b1958\b", primary_text, re.I):
                trim = "1958"
            elif re.search(r"\bvx\s*limited\b", primary_text, re.I):
                trim = "VX Limited"
            elif re.search(r"\bprado\b", primary_text, re.I) and not trim:
                trim = "Prado"
        elif re.search(r"\bsupra\b", primary_text, re.I):
            if re.search(r"\ba90\b|\ba91\b|\bmk5\b|\bmkv\b|\bgr\s*supra\b", combined, re.I) or yr >= 2020:
                series = "A90 / Mk5"
            elif re.search(r"\ba80\b|\bmk4\b|\bmkiv\b", combined, re.I) or (1993 <= yr <= 2002):
                series = "A80 / Mk4"
            elif re.search(r"\ba70\b|\bmk3\b|\bmkiii\b", combined, re.I) or (1986 <= yr <= 1992):
                series = "A70 / Mk3"
            elif re.search(r"\ba60\b|\bmk2\b|\bmkii\b", combined, re.I) or (1982 <= yr <= 1986):
                series = "A60 / Mk2"
            if re.search(r"\ba91-mt\b|\ba91-cf\b|\ba91\b", primary_text, re.I):
                trim = "A91 Edition"
            elif re.search(r"\b45th\s*anniversary\b", primary_text, re.I):
                trim = "45th Anniversary"
            elif re.search(r"\blaunch\s*edition\b", primary_text, re.I):
                trim = "Launch Edition"
            elif re.search(r"\btwin\s*turbo\b|\bturbo\b", primary_text, re.I):
                trim = "Turbo"
            elif re.search(r"\b3\.0\s*premium\b", primary_text, re.I):
                trim = "3.0 Premium"
            elif re.search(r"\b3\.0\b", primary_text, re.I):
                trim = "3.0"
            elif re.search(r"\b2\.0\b", primary_text, re.I):
                trim = "2.0"
        elif re.search(r"\b4runner\b|\btacoma\b|\btundra\b|\bsequoia\b|\bfj\s*cruiser\b", primary_text, re.I):
            if "4runner" in model_l:
                if yr >= 2010:
                    series = "N280 (5th Gen)"
                elif yr >= 2003:
                    series = "N210 (4th Gen)"
                elif yr >= 1996:
                    series = "N180 (3rd Gen)"
                elif yr >= 1990:
                    series = "N130 (2nd Gen)"
                elif yr >= 1984:
                    series = "N60 (1st Gen)"
            elif "tacoma" in model_l:
                if yr >= 2024:
                    series = "N400 (4th Gen)"
                elif yr >= 2016:
                    series = "N300 (3rd Gen)"
                elif yr >= 2005:
                    series = "N200 (2nd Gen)"
                elif yr >= 1995:
                    series = "N100 (1st Gen)"
            if re.search(r"\btrd\s*pro\b", primary_text, re.I):
                trim = "TRD Pro"
            elif re.search(r"\btrd\s*off-?road\s*premium\b", primary_text, re.I):
                trim = "TRD Off-Road Premium"
            elif re.search(r"\btrd\s*off-?road\b", primary_text, re.I):
                trim = "TRD Off-Road"
            elif re.search(r"\btrd\s*sport\b", primary_text, re.I):
                trim = "TRD Sport"
            elif re.search(r"\btrailhunter\b", primary_text, re.I):
                trim = "Trailhunter"
            elif re.search(r"\btrail\s*teams\b", primary_text, re.I):
                trim = "Trail Teams Special Edition"
            elif re.search(r"\b1794\s*edition\b", primary_text, re.I):
                trim = "1794 Edition"
            elif re.search(r"\bplatinum\b", primary_text, re.I):
                trim = "Platinum"
            elif re.search(r"\blimited\b", primary_text, re.I):
                trim = "Limited"
            elif re.search(r"\bsr5\b", primary_text, re.I):
                trim = "SR5"
        elif re.search(r"\bmr2\b", primary_text, re.I):
            if re.search(r"\bw30\b|\bspyder\b", combined, re.I) or yr >= 2000:
                series = "W30 (3rd Gen)"
            elif re.search(r"\bsw20\b", combined, re.I) or (1991 <= yr <= 1999):
                series = "SW20 (2nd Gen)"
            elif re.search(r"\baw11\b", combined, re.I) or yr <= 1989:
                series = "AW11 (1st Gen)"
            if re.search(r"\bturbo\b", primary_text, re.I):
                trim = "Turbo"
            elif re.search(r"\bsupercharged\b", primary_text, re.I):
                trim = "Supercharged"

    # 4. CHEVROLET / GMC
    elif "chevrolet" in make_l or make_l == "gmc":
        if re.search(r"\bcorvette\b", primary_text, re.I):
            c_match = re.search(r"\b(C[1-8])\b", combined, re.I)
            if c_match:
                series = c_match.group(1).upper()
            elif yr >= 2020:
                series = "C8"
            elif yr >= 2014:
                series = "C7"
            elif yr >= 2005:
                series = "C6"
            elif yr >= 1997:
                series = "C5"
            elif yr >= 1984:
                series = "C4"
            elif yr >= 1968:
                series = "C3"
            elif yr >= 1963:
                series = "C2"
            elif yr >= 1953:
                series = "C1"

            if re.search(r"\bzr-?1\b", primary_text, re.I):
                trim = "ZR-1" if series == "C4" else "ZR1"
            elif re.search(r"\bz06\b", primary_text, re.I):
                trim = "Z06"
            elif re.search(r"\be-ray\b", primary_text, re.I):
                trim = "E-Ray"
            elif re.search(r"\bgrand\s*sport\b", primary_text, re.I):
                trim = "Grand Sport"
            elif re.search(r"\b427\b", primary_text, re.I) and series == "C6":
                trim = "427"
            elif re.search(r"\bcallaway\b", primary_text, re.I):
                trim = "Callaway"
            elif re.search(r"\bl88\b", primary_text, re.I):
                trim = "L88"
            elif re.search(r"\bsting\s*ray\b", primary_text, re.I) and series == "C2":
                trim = "Sting Ray"
            elif re.search(r"\bstingray\b", primary_text, re.I):
                trim = "Stingray"
            else:
                trim = "Base"
        elif re.search(r"\b(c10|k10|c20|k20|c30|k30|r10|v10|r20|v20|c1500|k1500|c2500|k2500|silverado|sierra|3100|3600|apache|pickup|k5\s*blazer|blazer|jimmy|suburban|tahoe|yukon)\b", primary_text, re.I):
            ton_match = re.search(r"\b(C10|K10|C20|K20|C30|K30|R10|V10|R20|V20|C1500|K1500|C2500|K2500|3100|3600|3800|K5)\b", primary_text, re.I)
            if ton_match:
                series = ton_match.group(1).upper()
            elif re.search(r"\bsilverado\s*1500\b|\bsierra\s*1500\b|\b1500\b", primary_text, re.I):
                series = "1500"
            elif re.search(r"\bsilverado\s*2500(?:\s*hd)?\b|\bsierra\s*2500(?:\s*hd)?\b|\b2500(?:\s*hd)?\b", primary_text, re.I):
                series = "2500HD" if re.search(r"2500\s*hd", primary_text, re.I) else "2500"
            elif re.search(r"\bsilverado\s*3500(?:\s*hd)?\b|\bsierra\s*3500(?:\s*hd)?\b|\b3500(?:\s*hd)?\b", primary_text, re.I):
                series = "3500HD" if re.search(r"3500\s*hd", primary_text, re.I) else "3500"
            elif re.search(r"\bblazer\b|\bjimmy\b", primary_text, re.I) and yr <= 1991:
                series = "K5"

            if re.search(r"\b454\s*ss\b", primary_text, re.I):
                trim = "454 SS"
            elif re.search(r"\bcheyenne\s*super\b", primary_text, re.I):
                trim = "Cheyenne Super"
            elif re.search(r"\bcheyenne\b", primary_text, re.I):
                trim = "Cheyenne"
            elif re.search(r"\bscottsdale\b", primary_text, re.I):
                trim = "Scottsdale"
            elif re.search(r"\bcustom\s*deluxe\b", primary_text, re.I):
                trim = "Custom Deluxe"
            elif re.search(r"\bcst\b|\bcustom\s*sport\s*truck\b", primary_text, re.I):
                trim = "CST"
            elif re.search(r"\bsilverado\b", primary_text, re.I) and "silverado" not in model_l:
                trim = "Silverado"
            elif re.search(r"\bsierra\s*classic\b", primary_text, re.I):
                trim = "Sierra Classic"
            elif re.search(r"\bsierra\s*grande\b", primary_text, re.I):
                trim = "Sierra Grande"
            elif re.search(r"\bhigh\s*sierra\b", primary_text, re.I):
                trim = "High Sierra"
            elif re.search(r"\bzr2\s*bison\b", primary_text, re.I):
                trim = "ZR2 Bison"
            elif re.search(r"\bzr2\b", primary_text, re.I):
                trim = "ZR2"
            elif re.search(r"\bat4x\b", primary_text, re.I):
                trim = "AT4X"
            elif re.search(r"\bat4\b", primary_text, re.I):
                trim = "AT4"
            elif re.search(r"\bdenali\s*ultimate\b", primary_text, re.I):
                trim = "Denali Ultimate"
            elif re.search(r"\bdenali\b", primary_text, re.I):
                trim = "Denali"
            elif re.search(r"\bhigh\s*country\b", primary_text, re.I):
                trim = "High Country"
            elif re.search(r"\btrail\s*boss\b", primary_text, re.I):
                trim = "Trail Boss"
            elif re.search(r"\bz71\b", primary_text, re.I):
                trim = "Z71"
            elif re.search(r"\bltz\b", primary_text, re.I):
                trim = "LTZ"
        elif re.search(r"\bcamaro\b", primary_text, re.I):
            if yr >= 2016:
                series = "6th Gen"
            elif yr >= 2010:
                series = "5th Gen"
            elif yr >= 1993:
                series = "4th Gen"
            elif yr >= 1982:
                series = "3rd Gen"
            elif yr >= 1970:
                series = "2nd Gen"
            elif yr >= 1967:
                series = "1st Gen"

            if re.search(r"\bzl1\s*1le\b", primary_text, re.I):
                trim = "ZL1 1LE"
            elif re.search(r"\bzl1\b", primary_text, re.I):
                trim = "ZL1"
            elif re.search(r"\bz/?28\b", primary_text, re.I):
                trim = "Z/28"
            elif re.search(r"\biroc-?z\b", primary_text, re.I):
                trim = "IROC-Z"
            elif re.search(r"\bss\s*1le\b|\b2ss\s*1le\b|\b1ss\s*1le\b", primary_text, re.I):
                trim = "SS 1LE"
            elif re.search(r"\b2ss\b|\b1ss\b|\bss\b", primary_text, re.I):
                trim = "SS"
            elif re.search(r"\brs\b", primary_text, re.I):
                trim = "RS"
            elif re.search(r"\blt1\b", primary_text, re.I):
                trim = "LT1"
        elif re.search(r"\bchevelle\b", primary_text, re.I):
            if 1968 <= yr <= 1972:
                series = "2nd Gen"
            elif 1964 <= yr <= 1967:
                series = "1st Gen"
            if re.search(r"\bss\s*454\b", primary_text, re.I):
                trim = "SS 454"
            elif re.search(r"\bss\s*396\b", primary_text, re.I):
                trim = "SS 396"
            elif re.search(r"\bss\b|\bsuper\s*sport\b", primary_text, re.I):
                trim = "SS"
            elif re.search(r"\bmalibu\b", primary_text, re.I):
                trim = "Malibu"

    # 5. FORD
    elif "ford" in make_l:
        if re.search(r"\bbronco\b", primary_text, re.I) and not re.search(r"\bbronco\s*ii\b", primary_text, re.I):
            if re.search(r"\bu13\b", combined, re.I):
                series = "U13 (1st Gen Roadster)"
            elif re.search(r"\bu14\b", combined, re.I):
                series = "U14 (1st Gen Half-Cab)"
            elif re.search(r"\bu15\b", combined, re.I) or (1966 <= yr <= 1977):
                series = "U15 (1st Gen)"
            elif 1978 <= yr <= 1979:
                series = "2nd Gen"
            elif 1980 <= yr <= 1986:
                series = "3rd Gen (Bullnose)"
            elif 1987 <= yr <= 1991:
                series = "4th Gen (Bricknose)"
            elif 1992 <= yr <= 1996:
                series = "5th Gen (OBS)"
            elif yr >= 2021:
                series = "Bronco Sport" if re.search(r"\bbronco\s*sport\b", primary_text, re.I) else "6th Gen (U725)"

            if re.search(r"\braptor\b", primary_text, re.I):
                trim = "Raptor"
            elif re.search(r"\bheritage\s*limited\b", primary_text, re.I):
                trim = "Heritage Limited"
            elif re.search(r"\bheritage\b", primary_text, re.I):
                trim = "Heritage Edition"
            elif re.search(r"\bfirst\s*edition\b", primary_text, re.I):
                trim = "First Edition"
            elif re.search(r"\bwildtrak\b", primary_text, re.I):
                trim = "Wildtrak"
            elif re.search(r"\bbadlands\b", primary_text, re.I):
                trim = "Badlands"
            elif re.search(r"\beverglades\b", primary_text, re.I):
                trim = "Everglades"
            elif re.search(r"\bouter\s*banks\b", primary_text, re.I):
                trim = "Outer Banks"
            elif re.search(r"\bblack\s*diamond\b", primary_text, re.I):
                trim = "Black Diamond"
            elif re.search(r"\bbig\s*bend\b", primary_text, re.I):
                trim = "Big Bend"
            elif re.search(r"\beddie\s*bauer\b", primary_text, re.I):
                trim = "Eddie Bauer"
            elif re.search(r"\bxlt\s*lariat\b", primary_text, re.I):
                trim = "XLT Lariat"
            elif re.search(r"\bxlt\b", primary_text, re.I):
                trim = "XLT"
            elif re.search(r"\branger\s*xlt\b|\branger\b", primary_text, re.I) and yr <= 1981:
                trim = "Ranger"
            elif re.search(r"\bsport\b", primary_text, re.I) and yr <= 1977:
                trim = "Sport"
        elif re.search(r"\bmustang\b|\bshelby\s*gt[35]00\b", primary_text, re.I):
            if re.search(r"\bs650\b", combined, re.I) or yr >= 2024:
                series = "S650"
            elif re.search(r"\bs550\b", combined, re.I) or (2015 <= yr <= 2023):
                series = "S550"
            elif re.search(r"\bs197\b", combined, re.I) or (2005 <= yr <= 2014):
                series = "S197"
            elif re.search(r"\bsn95\b|\bnew\s*edge\b", combined, re.I) or (1994 <= yr <= 2004):
                series = "SN95"
            elif re.search(r"\bfox\s*body\b", combined, re.I) or (1979 <= yr <= 1993):
                series = "Fox Body"
            elif 1964 <= yr <= 1973:
                series = "1st Gen"

            if re.search(r"\bshelby\s*gt500\b|\bgt500\b", primary_text, re.I):
                trim = "Shelby GT500"
            elif re.search(r"\bshelby\s*gt350r\b|\bgt350r\b", primary_text, re.I):
                trim = "Shelby GT350R"
            elif re.search(r"\bshelby\s*gt350\b|\bgt350\b", primary_text, re.I):
                trim = "Shelby GT350"
            elif re.search(r"\bboss\s*429\b", primary_text, re.I):
                trim = "Boss 429"
            elif re.search(r"\bboss\s*302\b", primary_text, re.I):
                trim = "Boss 302"
            elif re.search(r"\bmach\s*1\b", primary_text, re.I):
                trim = "Mach 1"
            elif re.search(r"\bbullitt\b", primary_text, re.I):
                trim = "Bullitt"
            elif re.search(r"\bsvt\s*cobra\s*r\b|\bcobra\s*r\b", primary_text, re.I):
                trim = "SVT Cobra R"
            elif re.search(r"\bsvt\s*cobra\b|\bterminator\b|\bcobra\b", primary_text, re.I):
                trim = "SVT Cobra"
            elif re.search(r"\bdark\s*horse\b", primary_text, re.I):
                trim = "Dark Horse"
            elif re.search(r"\bsaleen\b", primary_text, re.I):
                trim = "Saleen"
            elif re.search(r"\broush\b", primary_text, re.I):
                trim = "Roush"
            elif re.search(r"\bgt\s*california\s*special\b|\bgt/cs\b", primary_text, re.I):
                trim = "GT/CS"
            elif re.search(r"\bgt\b", primary_text, re.I):
                trim = "GT"
            elif re.search(r"\blx\s*5\.0\b", primary_text, re.I):
                trim = "LX 5.0"
            elif re.search(r"\becoboost\b", primary_text, re.I):
                trim = "EcoBoost"
        elif re.search(r"\b(f-?100|f-?150|f-?250|f-?350|f-?450|super\s*duty)\b", primary_text, re.I):
            f_match = re.search(r"\b(F-?(?:100|150|250|350|450))\b", primary_text, re.I)
            if f_match:
                series = f"F-{re.sub(r'[^0-9]', '', f_match.group(1))}"
            if re.search(r"\braptor\s*r\b", primary_text, re.I):
                trim = "Raptor R"
            elif re.search(r"\braptor\b|\bsvt\s*raptor\b", primary_text, re.I):
                trim = "Raptor"
            elif re.search(r"\bsvt\s*lightning\b|\blightning\b", primary_text, re.I):
                trim = "Lightning"
            elif re.search(r"\bharley-davidson\b", primary_text, re.I):
                trim = "Harley-Davidson"
            elif re.search(r"\bking\s*ranch\b", primary_text, re.I):
                trim = "King Ranch"
            elif re.search(r"\bplatinum\b", primary_text, re.I):
                trim = "Platinum"
            elif re.search(r"\blimited\b", primary_text, re.I):
                trim = "Limited"
            elif re.search(r"\btremor\b", primary_text, re.I):
                trim = "Tremor"
            elif re.search(r"\blariat\b", primary_text, re.I):
                trim = "Lariat"
            elif re.search(r"\bxlt\b", primary_text, re.I):
                trim = "XLT"
            elif re.search(r"\branger\b", primary_text, re.I) and yr <= 1981:
                trim = "Ranger"

    # 6. MERCEDES-BENZ
    elif "mercedes" in make_l:
        mb_chassis = re.search(
            r"\b(W108|W109|W111|W113|W114|W115|W116|W123|W124|W126|W140|W201|W202|W203|W204|W205|W206|W210|W211|W212|W213|W219|W220|W221|W222|W223|W460|W461|W463|R107|C107|R129|R170|R171|R172|R230|R231|R232|C124|C126|C140|C190|C197|C204|C205|C207|C208|C209|C215|C216|C217|C218|S123|S124|S210|S211|S212|S213)\b",
            combined,
            re.I,
        )
        if mb_chassis:
            series = mb_chassis.group(1).upper()
        elif re.search(r"\b(380\s*sl|450\s*sl|560\s*sl|280\s*sl|350\s*sl|500\s*sl)\b", primary_text, re.I):
            if 1971 <= yr <= 1989:
                series = "R107"
            elif 1963 <= yr <= 1971:
                series = "W113"
            elif 1990 <= yr <= 2002:
                series = "R129"
        elif re.search(r"\bsl\s*\d{2,3}\b|\b500\s*sl\b|\b600\s*sl\b|\bsl500\b|\bsl55\b|\bsl63\b|\bsl65\b|\bsl600\b", primary_text, re.I):
            if yr >= 2022:
                series = "R232"
            elif yr >= 2013:
                series = "R231"
            elif yr >= 2003:
                series = "R230"
            elif yr >= 1990:
                series = "R129"
        elif re.search(r"\bg\s*500\b|\bg\s*550\b|\bg\s*55\b|\bg\s*63\b|\bg\s*65\b|\bg-class\b|\b300gd\b|\b280ge\b", primary_text, re.I):
            series = "W460" if yr <= 1989 else "W463"
        elif re.search(r"\be\s*55\b|\be\s*63\b|\be\s*320\b|\be\s*350\b|\be\s*500\b|\be\s*550\b|\b500\s*e\b|\be-class\b", primary_text, re.I):
            if yr >= 2017:
                series = "W213"
            elif yr >= 2010:
                series = "W212"
            elif yr >= 2003:
                series = "W211"
            elif yr >= 1996:
                series = "W210"
            elif yr >= 1986:
                series = "W124"
        elif re.search(r"\bc\s*63\b|\bc\s*43\b|\bc\s*36\b|\bc\s*55\b|\bc\s*300\b|\bc-class\b", primary_text, re.I):
            if yr >= 2022:
                series = "W206"
            elif yr >= 2015:
                series = "W205"
            elif yr >= 2008:
                series = "W204"
            elif yr >= 2001:
                series = "W203"
            elif yr >= 1994:
                series = "W202"

        if re.search(r"\bblack\s*series\b", primary_text, re.I):
            trim = "AMG Black Series"
        elif re.search(r"\bamg\s*gt\s*r\b", primary_text, re.I):
            trim = "AMG GT R"
        elif re.search(r"\bamg\s*gt\s*c\b", primary_text, re.I):
            trim = "AMG GT C"
        elif re.search(r"\bamg\s*gt\s*s\b", primary_text, re.I):
            trim = "AMG GT S"
        elif re.search(r"\b([A-Z]{1,3}\s*\d{2,3}\s*AMG|AMG\s*[A-Z]{1,3}\s*\d{2,3}(?:\s*S)?)\b", primary_text, re.I):
            m_amg = re.search(r"\b([A-Z]{1,3}\s*\d{2,3}\s*AMG|AMG\s*[A-Z]{1,3}\s*\d{2,3}(?:\s*S)?)\b", primary_text, re.I)
            trim = re.sub(r"\s+", " ", m_amg.group(1)).strip()
        elif re.search(r"\b(\d{3}\s*[A-Z]{1,3}|[A-Z]{1,3}\s*\d{3})\b", primary_text, re.I):
            m_code = re.search(r"\b(\d{3}\s*(?:SL|SEL|SEC|SE|E|CE|TE|D|TD|GD|GE)|(?:SL|S|E|C|CL|CLK|CLS|SLK|SLC|G|GL|GLE|GLS|GLK|GLC|GLA|GLB|ML)\s*\d{3})\b", primary_text, re.I)
            if m_code:
                trim = re.sub(r"\s+", "", m_code.group(1)).upper()

    # 7. DODGE / PLYMOUTH / RAM
    elif make_l in ("dodge", "plymouth", "ram"):
        if re.search(r"\bviper\b", primary_text, re.I):
            if yr >= 2013:
                series = "VX I (Gen V)"
            elif yr >= 2008:
                series = "ZB II (Gen IV)"
            elif yr >= 2003:
                series = "ZB I (Gen III)"
            elif yr >= 1996:
                series = "SR II (Gen II)"
            else:
                series = "SR I (Gen I)"
            if re.search(r"\bacr\b", primary_text, re.I):
                trim = "ACR"
            elif re.search(r"\bgts\b", primary_text, re.I):
                trim = "GTS"
            elif re.search(r"\brt/10\b", primary_text, re.I):
                trim = "RT/10"
            elif re.search(r"\bsrt-?10\b", primary_text, re.I):
                trim = "SRT-10"
        elif re.search(r"\bchallenger\b|\bcharger\b", primary_text, re.I):
            series = "Classic" if yr <= 1974 else "Modern"
            if re.search(r"\bsrt\s*demon\s*170\b|\bdemon\s*170\b", primary_text, re.I):
                trim = "SRT Demon 170"
            elif re.search(r"\bsrt\s*demon\b|\bdemon\b", primary_text, re.I):
                trim = "SRT Demon"
            elif re.search(r"\bhellcat\s*redeye\b", primary_text, re.I):
                trim = "SRT Hellcat Redeye"
            elif re.search(r"\bhellcat\b", primary_text, re.I):
                trim = "SRT Hellcat"
            elif re.search(r"\bscat\s*pack\b", primary_text, re.I):
                trim = "R/T Scat Pack"
            elif re.search(r"\bsrt-?8\b|\bsrt\s*392\b", primary_text, re.I):
                trim = "SRT8"
            elif re.search(r"\br/t\b", primary_text, re.I):
                trim = "R/T"
            elif re.search(r"\bt/a\b", primary_text, re.I):
                trim = "T/A"
        elif re.search(r"\b1500\b|\b2500\b|\b3500\b|\bram\b", primary_text, re.I):
            ton = re.search(r"\b(1500|2500|3500)\b", primary_text)
            if ton:
                series = ton.group(1)
            if re.search(r"\btrx\b", primary_text, re.I):
                trim = "TRX"
            elif re.search(r"\bsrt-?10\b", primary_text, re.I):
                trim = "SRT-10"
            elif re.search(r"\bpower\s*wagon\b", primary_text, re.I):
                trim = "Power Wagon"
            elif re.search(r"\blimited\b", primary_text, re.I):
                trim = "Limited"
            elif re.search(r"\blaramie\b", primary_text, re.I):
                trim = "Laramie"
            elif re.search(r"\brebel\b", primary_text, re.I):
                trim = "Rebel"

    # 8. HONDA / ACURA / MAZDA / NISSAN / SUBARU / LEXUS / AUDI / LAND ROVER / JEEP / RIVIAN / TESLA
    else:
        if re.search(r"\bmx-?5\b|\bmiata\b", primary_text, re.I):
            if re.search(r"\bnd\b", combined, re.I) or yr >= 2016:
                series = "ND"
            elif re.search(r"\bnc\b", combined, re.I) or (2006 <= yr <= 2015):
                series = "NC"
            elif re.search(r"\bnb\b", combined, re.I) or (1999 <= yr <= 2005):
                series = "NB"
            elif re.search(r"\bna\b", combined, re.I) or (1989 <= yr <= 1997):
                series = "NA"
            if re.search(r"\bmazdaspeed\b", primary_text, re.I):
                trim = "Mazdaspeed"
            elif re.search(r"\bclub\b", primary_text, re.I):
                trim = "Club"
            elif re.search(r"\bgrand\s*touring\b", primary_text, re.I):
                trim = "Grand Touring"
        elif re.search(r"\brx-?7\b", primary_text, re.I):
            if re.search(r"\bfd3s\b|\bfd\b", combined, re.I) or yr >= 1992:
                series = "FD"
            elif re.search(r"\bfc3s\b|\bfc\b", combined, re.I) or (1986 <= yr <= 1991):
                series = "FC"
            else:
                series = "FB / SA22C"
        elif re.search(r"\bs2000\b", primary_text, re.I):
            series = "AP2" if (re.search(r"\bap2\b", combined, re.I) or yr >= 2004) else "AP1"
            if re.search(r"\b\bcr\b", primary_text, re.I):
                trim = "CR"
        elif re.search(r"\bnsx\b", primary_text, re.I):
            if yr >= 2017:
                series = "NC1"
            elif re.search(r"\bna2\b", combined, re.I) or yr >= 1997:
                series = "NA2"
            else:
                series = "NA1"
            if re.search(r"\btype\s*s\b", primary_text, re.I):
                trim = "Type S"
            elif re.search(r"\bnsx-t\b", primary_text, re.I):
                trim = "NSX-T"
        elif re.search(r"\bwrangler\b", primary_text, re.I):
            if re.search(r"\bjl\b", combined, re.I) or yr >= 2018:
                series = "JL"
            elif re.search(r"\bjk\b", combined, re.I) or (2007 <= yr <= 2017):
                series = "JK"
            elif re.search(r"\btj\b|\blj\b", combined, re.I) or (1997 <= yr <= 2006):
                series = "TJ"
            elif re.search(r"\byj\b", combined, re.I) or (1987 <= yr <= 1995):
                series = "YJ"
            if re.search(r"\brubicon\s*392\b", primary_text, re.I):
                trim = "Rubicon 392"
            elif re.search(r"\brubicon\b", primary_text, re.I):
                trim = "Rubicon"
            elif re.search(r"\bsahara\b", primary_text, re.I):
                trim = "Sahara"
            elif re.search(r"\bunlimited\b", primary_text, re.I):
                trim = "Unlimited"
        elif re.search(r"\bdefender\b", primary_text, re.I):
            if re.search(r"\bdefender\s*90\b|\bd90\b", primary_text, re.I):
                series = "Defender 90"
            elif re.search(r"\bdefender\s*110\b|\bd110\b", primary_text, re.I):
                series = "Defender 110"
            elif re.search(r"\bdefender\s*130\b|\bd130\b", primary_text, re.I):
                series = "Defender 130"
        elif re.search(r"\bskyline\b|\bgt-?r\b", primary_text, re.I) and ("nissan" in make_l or "datsun" in make_l):
            if re.search(r"\br35\b", combined, re.I) or yr >= 2009:
                series = "R35"
            elif re.search(r"\br34\b", combined, re.I) or (1999 <= yr <= 2002):
                series = "R34"
            elif re.search(r"\br33\b", combined, re.I) or (1995 <= yr <= 1998):
                series = "R33"
            elif re.search(r"\br32\b", combined, re.I) or (1989 <= yr <= 1994):
                series = "R32"
            if re.search(r"\bnismo\b", primary_text, re.I):
                trim = "NISMO"
            elif re.search(r"\bv-?spec\b", primary_text, re.I):
                trim = "V-Spec"
            elif re.search(r"\btrack\s*edition\b", primary_text, re.I):
                trim = "Track Edition"
            elif re.search(r"\bpremium\b", primary_text, re.I):
                trim = "Premium"

    # Generic fallback trim extraction from primary_text when trim is still None
    if not trim:
        generic_trim = re.search(
            r"\b(Type\s*R|Type\s*S|STI|WRX\s*STI|Nismo|Spec-?V|Track\s*Edition|Performance|Plaid|Long\s*Range|Quad-?Motor|Tri-?Motor|Dual-?Motor|Launch\s*Edition|First\s*Edition|Autobiography|HSE\s*Luxury|HSE|Westminster|Supercharged|SVR|SVAutobiography|Rubicon\s*392|Rubicon|Sahara|Mojave|Trailhawk|Trackhawk|SRT8|SRT|R/T|Scat\s*Pack|Hellcat|Z06|ZR1|Z71|ZR2|TRD\s*Pro|TRD\s*Off-?Road|Limited|Platinum|King\s*Ranch|Lariat|XLT|Eddie\s*Bauer|Denali|AT4|Competition|CSL|Clubsport|Quattroporte|Prestige|Premium\s*Plus|Technik|S-?Line|F\s*Sport|IS\s*F|RC\s*F|GS\s*F|LC\s*500|LX\s*450|LX\s*470|LX\s*570|LX\s*600|GX\s*460|GX\s*470|GX\s*550)\b",
            primary_text,
            re.I,
        )
        if generic_trim:
            trim = re.sub(r"\s+", " ", generic_trim.group(1)).strip()

    body_style = normalize_body_style(existing_body_style, combined, make, normalized_model or model, yr)

    return {
        "series": series,
        "trim": trim,
        "body_style": body_style,
        "normalized_model": normalized_model,
        "cleaned_title": raw_headline,
    }


def connect_db():
    ip = socket.gethostbyname("aws-0-us-west-1.pooler.supabase.com")
    for attempt in range(12):
        try:
            conn = psycopg2.connect(
                host="aws-0-us-west-1.pooler.supabase.com",
                hostaddr=ip,
                port=5432,
                user="postgres.qkgaybvrernstplzjaam",
                password=os.environ["SUPABASE_DB_PASSWORD"],
                database="postgres",
                sslmode="require",
                connect_timeout=15,
            )
            return conn
        except Exception as e:
            print(f"[connect attempt {attempt + 1}/12] {e}", flush=True)
            time.sleep(3)
    raise RuntimeError("Could not connect to Supabase Postgres pooler after 12 attempts")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-mv-refresh", action="store_true")
    args = parser.parse_args()

    conn = connect_db()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '10min';")
    cur.execute("SET lock_timeout = '15s';")

    print("=== 1. BEFORE-BACKFILL CENSUS ===", flush=True)
    cur.execute("""
        SELECT
          count(*) AS total_cab,
          count(*) FILTER (WHERE sale_price > 0) AS with_sale_price,
          count(*) FILTER (WHERE sale_status = 'sold') AS sale_status_sold,
          count(*) FILTER (WHERE auction_outcome = 'sold') AS auction_outcome_sold,
          count(*) FILTER (WHERE sale_date IS NOT NULL) AS with_sale_date,
          count(*) FILTER (WHERE series IS NOT NULL AND btrim(series) <> '') AS with_series,
          count(*) FILTER (WHERE trim IS NOT NULL AND btrim(trim) <> '') AS with_trim,
          count(*) FILTER (WHERE body_style IS NOT NULL AND btrim(body_style) <> '') AS with_body_style
        FROM public.vehicles
        WHERE discovery_source = 'carsandbids'
          AND deleted_at IS NULL
          AND status IS DISTINCT FROM 'merged';
    """)
    print("vehicles (before):", cur.fetchone(), flush=True)

    cur.execute("""
        SELECT
          count(*) AS total_rows,
          count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sold_rows,
          count(*) FILTER (WHERE outcome = 'not_sold') AS not_sold_rows,
          sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS total_usd
        FROM public.mv_treemap_outcomes
        WHERE source_name = 'Cars & Bids';
    """)
    print("mv_treemap_outcomes (before):", cur.fetchone(), flush=True)

    cur.execute("""
        SELECT
          count(*) AS total_dated_sales,
          count(*) FILTER (WHERE family_key <> 'other') AS keyed_sales,
          sum(usd) AS total_usd
        FROM public.mv_family_sales
        WHERE source = 'Cars & Bids';
    """)
    print("mv_family_sales (before):", cur.fetchone(), flush=True)

    if not args.dry_run:
        print("=== 2. APPLYING CANONICAL MODEL ALIASES & TREEMAP_FAMILY_SALES FUNCTION ===", flush=True)
        cur.execute("""
            DO $cab_aliases$
            DECLARE
              r record;
            BEGIN
              FOR r IN
                SELECT * FROM (VALUES
                  ('Ford',          'F-250',      ARRAY['super duty', 'f-250 super duty']),
                  ('Ford',          'F-350',      ARRAY['f-350 super duty']),
                  ('Ford',          'F-450',      ARRAY['f-450 super duty']),
                  ('BMW',           '2002',       ARRAY['02 series', '2002tii', '2002 turbo', '1600-2', '1602']),
                  ('BMW',           '328i',       ARRAY['3 series']),
                  ('BMW',           '228i',       ARRAY['2 series']),
                  ('BMW',           '435i',       ARRAY['4 series']),
                  ('Mercedes-Benz', 'GLK-Class',  ARRAY['glk- class', 'glk class'])
                ) AS v(make_name, model_name, new_aliases)
              LOOP
                UPDATE public.canonical_models m
                SET aliases = (
                  SELECT array_agg(a ORDER BY ord)
                  FROM (
                    SELECT a, min(ord) AS ord
                    FROM unnest(coalesce(m.aliases, '{}'::text[]) || r.new_aliases) WITH ORDINALITY AS t(a, ord)
                    GROUP BY a
                  ) s
                )
                WHERE lower(m.make) = lower(r.make_name)
                  AND lower(m.canonical_model) = lower(r.model_name)
                  AND NOT (coalesce(m.aliases, '{}'::text[]) @> r.new_aliases);
              END LOOP;
            END $cab_aliases$;
        """)
        migration_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "supabase",
            "migrations",
            "20261018183000_cab_taxonomy_and_treemap_outcomes.sql",
        )
        with open(migration_path, "r") as f:
            sql_text = f.read()
        fn_start = sql_text.index("CREATE OR REPLACE FUNCTION public.treemap_family_sales")
        fn_end = sql_text.index("COMMIT;", fn_start)
        cur.execute(sql_text[fn_start:fn_end])
        print("Canonical aliases & treemap_family_sales function applied.", flush=True)

    print("=== 3. FETCHING ALL CARS & BIDS VEHICLES IN ONE PASS ===", flush=True)
    cur.execute("""
        SELECT
          v.id::text,
          v.year,
          v.make,
          v.model,
          v.title,
          v.listing_title,
          v.series,
          v.trim,
          v.body_style,
          v.sale_price,
          v.sold_price,
          v.winning_bid,
          v.sale_status,
          v.auction_outcome,
          v.auction_status,
          v.reserve_status,
          v.sale_date,
          v.auction_end_date::date AS derived_sale_date,
          v.auction_source,
          v.canonical_platform,
          v.platform_source,
          v.is_public
        FROM public.vehicles v
        WHERE v.discovery_source = 'carsandbids'
          AND v.deleted_at IS NULL
          AND v.status IS DISTINCT FROM 'merged';
    """)
    rows = cur.fetchall()
    print(f"Fetched {len(rows)} Cars & Bids vehicles from public.vehicles.", flush=True)

    missing_date_ids = [
        r[0] for r in rows if r[16] is None and r[17] is None and ((r[9] or 0) > 0 or r[14] == "sold")
    ]
    fallback_dates = {}
    if missing_date_ids:
        cur.execute(
            """
            SELECT vehicle_id::text, max(COALESCE(sold_at::date, ended_at::date))
            FROM public.vehicle_events
            WHERE vehicle_id = ANY(%s::uuid[])
              AND COALESCE(sold_at, ended_at) IS NOT NULL
            GROUP BY vehicle_id;
            """,
            (missing_date_ids,),
        )
        for vid, dt in cur.fetchall():
            if dt:
                fallback_dates[vid] = dt
        still_missing = [vid for vid in missing_date_ids if vid not in fallback_dates]
        if still_missing:
            cur.execute(
                """
                SELECT vehicle_id::text, max(auction_end_date::date)
                FROM public.auction_events
                WHERE vehicle_id = ANY(%s::uuid[])
                  AND auction_end_date IS NOT NULL
                GROUP BY vehicle_id;
                """,
                (still_missing,),
            )
            for vid, dt in cur.fetchall():
                if dt:
                    fallback_dates[vid] = dt
        print(f"Resolved {len(fallback_dates)} fallback event dates for {len(missing_date_ids)} rows without auction_end_date.", flush=True)

    outcome_updates = []
    date_updates = []
    series_trim_updates = []
    model_body_updates = []
    generic_vin_series = {
        "3-series", "5-series", "6-series", "7-series", "1-series", "2-series", "4-series", "8-series",
        "x3", "x5", "x6", "z3", "z4", "m3", "m5", "m6",
    }
    non_sold_outcomes = {"reserve_not_met", "no_sale", "unsold", "cancelled", "withdrawn"}
    non_sold_statuses = {"not_sold", "unsold", "bid_to"}

    import datetime as _dt
    min_valid_date = _dt.date(2020, 1, 1)
    max_valid_date = _dt.date.today() + _dt.timedelta(days=1)

    for (
        r_id, year, make, model, title, listing_title,
        cur_series, cur_trim, cur_body,
        sale_price, sold_price, winning_bid,
        sale_status, auction_outcome, auction_status, reserve_status,
        sale_date, derived_sale_date,
        auction_source, canonical_platform, platform_source, is_public
    ) in rows:
        # A. Outcome & platform normalization
        sp = float(sale_price) if sale_price is not None else 0.0
        is_explicit_non_sale = (
            (auction_outcome or "") in non_sold_outcomes
            or (sale_status or "") in non_sold_statuses
            or (reserve_status or "") == "reserve_not_met"
        )
        is_sold_lot = (not is_explicit_non_sale) and (sp > 0 or auction_status == "sold")
        is_ended_unsold = (sp <= 0) and auction_status == "ended"

        new_sale_status = sale_status
        new_auction_outcome = auction_outcome
        new_sold_price = sold_price
        new_winning_bid = winning_bid

        if is_sold_lot:
            new_sale_status = "sold"
            new_auction_outcome = "sold"
            if sp > 0:
                if new_sold_price is None or float(new_sold_price) == 0:
                    new_sold_price = sale_price
                if new_winning_bid is None or float(new_winning_bid) == 0:
                    new_winning_bid = sale_price
        elif is_ended_unsold:
            if (sale_status or "available") == "available":
                new_sale_status = "not_sold"
            if auction_outcome is None:
                new_auction_outcome = "reserve_not_met"

        new_auction_source = auction_source or "cars_and_bids"
        if new_auction_source != "cars_and_bids":
            new_auction_source = "cars_and_bids"
        new_canonical_platform = canonical_platform or "cars-and-bids"
        if new_canonical_platform != "cars-and-bids":
            new_canonical_platform = "cars-and-bids"
        new_platform_source = platform_source
        if not new_platform_source or new_platform_source.lower().startswith("http") or new_platform_source == "carsandbids":
            new_platform_source = "cars-and-bids"

        if (
            new_sale_status != sale_status
            or new_auction_outcome != auction_outcome
            or new_sold_price != sold_price
            or new_winning_bid != winning_bid
            or new_auction_source != auction_source
            or new_canonical_platform != canonical_platform
            or new_platform_source != platform_source
        ):
            outcome_updates.append((
                r_id,
                new_sale_status,
                new_auction_outcome,
                new_sold_price,
                new_winning_bid,
                new_auction_source,
                new_canonical_platform,
                new_platform_source,
            ))

        # B. Sale date normalization
        eff_derived_date = derived_sale_date or fallback_dates.get(r_id)
        if (
            sale_date is None
            and eff_derived_date is not None
            and min_valid_date <= eff_derived_date <= max_valid_date
            and (is_sold_lot or new_sale_status == "sold" or new_auction_outcome == "sold" or sp > 0)
        ):
            date_updates.append((r_id, eff_derived_date))

        # C. Multi-axis taxonomy & title normalization
        sub_title = None
        if listing_title and "—" in listing_title:
            parts = listing_title.split("—", 1)
            sub_title = parts[1].strip()

        facets = extract_cab_facets(
            year=year,
            make=make,
            model=model,
            title=title or listing_title,
            sub_title=sub_title,
            existing_body_style=cur_body,
        )

        new_series = facets["series"]
        if not new_series and cur_series and cur_series.strip().lower() not in generic_vin_series:
            new_series = cur_series.strip()
        elif new_series is None and cur_series:
            new_series = cur_series.strip()

        new_trim = facets["trim"] or (cur_trim.strip() if cur_trim else None)
        new_body = facets["body_style"] or (cur_body.strip() if cur_body else None)
        new_model = facets["normalized_model"] or (model.strip() if model else None)
        new_title = clean_cab_text(title) if title else None
        new_listing_title = clean_cab_text(listing_title) if listing_title else None

        if (
            new_series != cur_series
            or new_trim != cur_trim
            or (title is not None and new_title != title)
            or (listing_title is not None and new_listing_title != listing_title)
        ):
            series_trim_updates.append((r_id, new_series, new_trim, new_title, new_listing_title))

        if new_body != cur_body or new_model != model:
            model_body_updates.append((r_id, new_body, new_model))

    outcome_updates.sort(key=lambda x: x[0])
    date_updates.sort(key=lambda x: x[0])
    series_trim_updates.sort(key=lambda x: x[0])
    model_body_updates.sort(key=lambda x: x[0])

    print(
        f"Computed updates: {len(outcome_updates)} outcome/platform rows, "
        f"{len(date_updates)} sale_date rows, {len(series_trim_updates)} series/trim/title rows, "
        f"{len(model_body_updates)} model/body_style rows.",
        flush=True,
    )

    def run_chunk_with_retry(sql_query, chunk_data):
        nonlocal conn, cur
        for attempt in range(6):
            try:
                cur.execute("SET LOCAL statement_timeout = '5min';")
                cur.execute("SET LOCAL lock_timeout = '30s';")
                cur.execute("SET LOCAL app.skip_completion_enqueue = '1';")
                execute_values(cur, sql_query, chunk_data)
                conn.commit()
                return
            except Exception as err:
                print(f"    [chunk retry {attempt + 1}/6] {err}", flush=True)
                try:
                    conn.rollback()
                except Exception:
                    pass
                time.sleep(2 + attempt * 2)
                try:
                    conn.close()
                except Exception:
                    pass
                conn = connect_db()
                conn.autocommit = False
                cur = conn.cursor()
        raise RuntimeError("Chunk failed after 6 retries")

    if not args.dry_run:
        conn.autocommit = False
        chunk_size = 500

        if outcome_updates:
            print(f"Applying {len(outcome_updates)} outcome/platform updates in chunks of {chunk_size}...", flush=True)
            for i in range(0, len(outcome_updates), chunk_size):
                chunk = outcome_updates[i : i + chunk_size]
                t0 = time.time()
                run_chunk_with_retry(
                    """
                    UPDATE public.vehicles AS v
                    SET
                      sale_status = u.sale_status,
                      auction_outcome = u.auction_outcome,
                      sold_price = u.sold_price::numeric,
                      winning_bid = u.winning_bid::numeric,
                      auction_source = u.auction_source,
                      canonical_platform = u.canonical_platform,
                      platform_source = u.platform_source
                    FROM (VALUES %s) AS u(
                      id, sale_status, auction_outcome, sold_price, winning_bid,
                      auction_source, canonical_platform, platform_source
                    )
                    WHERE v.id = u.id::uuid;
                    """,
                    chunk,
                )
                print(
                    f"  Outcome chunk {i // chunk_size + 1} ({min(i + chunk_size, len(outcome_updates))}/{len(outcome_updates)}) in {time.time() - t0:.2f}s",
                    flush=True,
                )

        if date_updates:
            print(f"Applying {len(date_updates)} sale_date updates in chunks of {chunk_size}...", flush=True)
            for i in range(0, len(date_updates), chunk_size):
                chunk = date_updates[i : i + chunk_size]
                t0 = time.time()
                run_chunk_with_retry(
                    """
                    UPDATE public.vehicles AS v
                    SET sale_date = u.sale_date::date
                    FROM (VALUES %s) AS u(id, sale_date)
                    WHERE v.id = u.id::uuid;
                    """,
                    chunk,
                )
                print(
                    f"  Date chunk {i // chunk_size + 1} ({min(i + chunk_size, len(date_updates))}/{len(date_updates)}) in {time.time() - t0:.2f}s",
                    flush=True,
                )

        if series_trim_updates:
            st_chunk_size = 500
            print(f"Applying {len(series_trim_updates)} series/trim/title updates in chunks of {st_chunk_size}...", flush=True)
            for i in range(0, len(series_trim_updates), st_chunk_size):
                chunk = series_trim_updates[i : i + st_chunk_size]
                t0 = time.time()
                run_chunk_with_retry(
                    """
                    UPDATE public.vehicles AS v
                    SET
                      series = COALESCE(u.series, v.series),
                      trim = COALESCE(u.trim, v.trim),
                      title = COALESCE(u.title, v.title),
                      listing_title = COALESCE(u.listing_title, v.listing_title)
                    FROM (VALUES %s) AS u(id, series, trim, title, listing_title)
                    WHERE v.id = u.id::uuid;
                    """,
                    chunk,
                )
                print(
                    f"  Series/trim chunk {i // st_chunk_size + 1} ({min(i + st_chunk_size, len(series_trim_updates))}/{len(series_trim_updates)}) in {time.time() - t0:.2f}s",
                    flush=True,
                )

        if model_body_updates:
            print(f"Applying {len(model_body_updates)} model/body_style updates in chunks of {chunk_size}...", flush=True)
            for i in range(0, len(model_body_updates), chunk_size):
                chunk = model_body_updates[i : i + chunk_size]
                t0 = time.time()
                run_chunk_with_retry(
                    """
                    UPDATE public.vehicles AS v
                    SET
                      body_style = COALESCE(u.body_style, v.body_style),
                      model = COALESCE(u.model, v.model)
                    FROM (VALUES %s) AS u(id, body_style, model)
                    WHERE v.id = u.id::uuid;
                    """,
                    chunk,
                )
                print(
                    f"  Model/body chunk {i // chunk_size + 1} ({min(i + chunk_size, len(model_body_updates))}/{len(model_body_updates)}) in {time.time() - t0:.2f}s",
                    flush=True,
                )

        conn.autocommit = True
        cur.execute("SET statement_timeout = '15min';")

    if not args.dry_run and not args.skip_mv_refresh:
        print("=== 4. REFRESHING MATERIALIZED VIEWS ===", flush=True)
        for mv in [
            "public.mv_vehicle_name_dictionary",
            "public.mv_model_family_names",
            "public.mv_treemap_outcomes",
            "public.mv_treemap_sale_brands",
            "public.mv_treemap_sale_models",
            "public.mv_brand_market",
            "public.mv_family_market",
            "public.mv_family_sales",
        ]:
            t_mv = time.time()
            try:
                cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv};")
            except Exception:
                cur.execute(f"REFRESH MATERIALIZED VIEW {mv};")
            print(f"  Refreshed {mv} in {time.time() - t_mv:.1f}s", flush=True)

    print("=== 5. AFTER-BACKFILL VERIFICATION ===", flush=True)
    cur.execute("""
        SELECT
          count(*) AS total_cab,
          count(*) FILTER (WHERE sale_price > 0) AS with_sale_price,
          count(*) FILTER (WHERE sale_status = 'sold') AS sale_status_sold,
          count(*) FILTER (WHERE auction_outcome = 'sold') AS auction_outcome_sold,
          count(*) FILTER (WHERE sale_date IS NOT NULL) AS with_sale_date,
          count(*) FILTER (WHERE series IS NOT NULL AND btrim(series) <> '') AS with_series,
          count(*) FILTER (WHERE trim IS NOT NULL AND btrim(trim) <> '') AS with_trim,
          count(*) FILTER (WHERE body_style IS NOT NULL AND btrim(body_style) <> '') AS with_body_style
        FROM public.vehicles
        WHERE discovery_source = 'carsandbids'
          AND deleted_at IS NULL
          AND status IS DISTINCT FROM 'merged';
    """)
    print("vehicles (after):", cur.fetchone(), flush=True)

    cur.execute("""
        SELECT
          count(*) AS total_rows,
          count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sold_rows,
          count(*) FILTER (WHERE outcome = 'not_sold') AS not_sold_rows,
          sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS total_usd
        FROM public.mv_treemap_outcomes
        WHERE source_name = 'Cars & Bids';
    """)
    print("mv_treemap_outcomes (after):", cur.fetchone(), flush=True)

    cur.execute("""
        SELECT
          count(*) AS total_dated_sales,
          count(*) FILTER (WHERE family_key <> 'other') AS keyed_sales,
          sum(usd) AS total_usd
        FROM public.mv_family_sales
        WHERE source = 'Cars & Bids';
    """)
    print("mv_family_sales (after):", cur.fetchone(), flush=True)

    conn.close()


if __name__ == "__main__":
    main()
