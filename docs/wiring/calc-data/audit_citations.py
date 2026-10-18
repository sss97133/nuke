#!/usr/bin/env python3
"""Check every "cited" field in the K5 master list against the source it cites.

A citation only counts if code can open the source and find the field's own values in it.
Sources are read from what we actually hold:
  - PDFs in reference_documents/ (text per page in docs/library/_extracted/, built by scripts/library_index.py)
  - web page snapshots in reference_documents/web_snapshots/ (fetch_sources.py; gitignored, third-party text)
  - owner documents in reference_documents/owner_docs/ (Dave's M130 sheet; gitignored)

Each cited field gets one status:
  VERIFIED       every checkable value in the field was found in a stored source it cites
  PARTIAL        some values found, some not
  NOT_FOUND      the cited source is stored but none of the field's values are in it (wrong or loose citation)
  STORED_PROSE   the source is stored but the field has no machine-checkable value (a sentence, a method)
  UNSTORED       the source is outside (a URL we know) but we never kept a copy
  NEVER_FETCHED  the source was never retrieved in any session (no URL, no copy) -- the citation is a claim, not evidence
  SELF_ONLY      the only sources are our own files (cut lists, drawings, the registry, state rows) -- a design record, not evidence

Usage: python3 audit_citations.py [--fields] [--json out.json]
"""
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

CD = Path(__file__).resolve().parent
REPO = CD.parents[2]
EXTRACTED = REPO / "docs/library/_extracted"
SNAP = REPO / "reference_documents/web_snapshots"
OWNER = REPO / "reference_documents/owner_docs"

# ---------------------------------------------------------------- source registry
# (pattern, id, kind, where). kind: stored_pdf | snapshot | owner_xlsx | self | never_fetched | external
# where: for stored_pdf the _extracted slug and a printed->pdf page offset; for snapshot the snapshot stem.
SOURCES = [
    (r"motec_m130_datasheet|M130 datasheet", "motec_m130_datasheet", "stored_pdf", ("component_drawings__motec_m130_datasheet", 0)),
    (r"C125 manual", "motec_c125_manual", "stored_pdf", ("component_drawings__motec_c125_user_manual", 1)),
    (r"PDM (user )?manual|PDM manual", "motec_pdm_manual", "stored_pdf", ("component_drawings__motec_pdm_user_manual", 3)),
    (r"techspec", "motec_m1_techspec", "stored_pdf", ("component_drawings__motec_m1_hardware_techspec", 0)),
    (r"Holley 199R10762", "holley_199r10762", "snapshot", "documents.holley.com__199r10762rev1"),
    (r"Checkline", "checkline_pull_test", "snapshot", "www.checkline.com__wire_pull_test_standards"),
    (r"M1 Tune manual", "motec_m1_tune_manual", "external", "MoTeC M1 Tune manual (not located)"),
    (r"Dave'?s (M130 )?sheet|Desert Performance|Overland Bronco", "dave_m130_sheet", "owner_xlsx", "M130 ECU Overland Bronco.xlsx"),
    (r"B09/UDIG4 is spare on Dave|Dave's sheet keeps B15", "dave_m130_sheet", "owner_xlsx", "M130 ECU Overland Bronco.xlsx"),
    (r"SSC-N tooling chart|prowire SSC-N", "prowire_ssc_n", "snapshot", "www.prowireusa.com__SSC-N"),
    (r"DMC tooling", "dmc_m39029_tooling", "snapshot", ["dmctools.com__196", "www.dmctools.com__10"]),
    (r"DigiKey M39029|^M39029/58-363$", "digikey_m39029", "snapshot", ["www.digikey.com__2172799", "www.digikey.com__2172809"]),
    (r"K1S Selector Settings", "prowire_ssc_n", "snapshot", "www.prowireusa.com__SSC-N"),
    (r"ictbillet|ICT (Billet|WCTHB50)|WCTHB50", "ict_pages", "snapshot", ["www.ictbillet.com__lt-gen-v-throttle-body-connector-component-kit",
                                                                         "www.ictbillet.com__oil-ls3-wire-component-kit"]),
    (r"p-3718|8-injector EV1 kit page", "prowire_p3718", "snapshot", "www.prowireusa.com__p-3718-8-cyl-injector-connector-kit-w-90-boots"),
    (r"prowire 68201", "prowire_68201", "snapshot", "www.prowireusa.com__68201"),
    (r"p-2268", "prowire_p2268", "snapshot", "www.prowireusa.com__p-2268-female-gt-150-terminal-20-22-ga"),
    (r"3137CT", "prowire_3137ct", "snapshot", ["www.prowireusa.com__3137ct", "www.prowireusa.com__p-1924-mini-seal-crimp-stub-splice-red",
                                              "www.prowireusa.com__p-1925-mini-seal-crimp-stub-splice-blue",
                                              "www.prowireusa.com__p-1926-mini-seal-crimp-stub-splice-yellow"]),
    (r"p-3769", "prowire_p3769", "snapshot", "www.prowireusa.com__p-3769-20-16-ga-jpt-timer-terminal"),
    (r"p-2104", "prowire_p2104", "snapshot", "www.prowireusa.com__p-2104-metri-pack-150-280-sealed-crimp-tool"),
    (r"Custom Connector Kits 15366021", "cck_15366021", "snapshot", "www.customconnectorkits.com__15366021"),
    (r"p-506", "prowire_12110847", "snapshot", "www.prowireusa.com__p-506-12110847-female-terminal-18-22-awg"),
    (r"p-2061", "seal_15324976", "snapshot", ["www.prowireusa.com__p-2061-delphi-15324976-cable-seal-white-metri-pack-150-series",
                                             "www.connectorid.com__aptiv-15324976"]),
    (r"p-3845", "prowire_p3845", "snapshot", "www.prowireusa.com__p-3845-gt150-6-way-female-housing-dbw"),
    (r"p-3846", "prowire_p3846", "snapshot", "www.prowireusa.com__p-3846-gt150-6-way-tpa-dbw"),
    (r"M-RJ45-CABLE", "prowire_rj45_cable", "external", "ProWire M-RJ45-CABLE page (not kept)"),
    (r"Glenair AS39029", "glenair_as39029", "never_fetched", None),
    (r"M81969 datasheet", "m81969_datasheet", "never_fetched", None),
    (r"/32-22 OD 1\.09", "wire_od_seal_fit", "snapshot", ["www.prowireusa.com__m22759-32-tefzel-wire", "www.prowireusa.com__m22759-16-tefzel-wire",
                                                         "www.customconnectorkits.com__15366021"]),
    (r"prowire p-2025", "prowire_p2025", "snapshot", "www.prowireusa.com__p-2025-ideal-stripmater-tefzel-stripper-26-16-ga"),
    (r"ProWire 12110847", "prowire_12110847", "snapshot", "www.prowireusa.com__p-506-12110847-female-terminal-18-22-awg"),
    (r"15324976 'Metri-Pack 150 seal", "seal_15324976", "snapshot", ["www.prowireusa.com__p-2061-delphi-15324976-cable-seal-white-metri-pack-150-series",
                                                                   "www.connectorid.com__aptiv-15324976"]),
    (r"MaxxECU", "maxxecu_etb", "snapshot", "www.maxxecu.com__wirings-e-throttle_bodies"),
    (r"rusefi", "rusefi_sent_etb", "snapshot", "github.com__SENT-ETB-Electronic-Throttle-Body"),
    (r"LS1Tech|E67 C1 pin refs|page returns 403", "ls1tech_pedal", "external", "LS1Tech (403 to fetch)"),
    (r"siemensdeka", "siemensdeka_fi114961", "snapshot", "siemensdeka.com__60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm"),
    (r"COIL-CONN-LS2/7", "prowire_p2069", "snapshot", "www.prowireusa.com__p-2069-gm-coil-connector-kit-d585-d581-ls2-7"),
    (r"prowire p-2077|GM LS Crank", "prowire_p2077", "snapshot", "www.prowireusa.com__p-2077-ls-crank-map-sensor-connector-kit"),
    (r"MAP Connector Kit 3 Way", "prowire_p2077", "snapshot", "www.prowireusa.com__p-2077-ls-crank-map-sensor-connector-kit"),
    (r"prowire p-2076", "prowire_p2076", "snapshot", "www.prowireusa.com__p-2076-ls-camshaft-sensor-connector-kit"),
    (r"prowire p-1753", "prowire_p1753", "snapshot", "www.prowireusa.com__p-1753-liquid-temp-sensor-conn-kit"),
    (r"prowire p-1233", "prowire_p1233", "snapshot", "www.prowireusa.com__p-1233-delphi-gt150-hand-crimp-tool"),
    (r"M22520-2-01-afm8", "prowire_afm8", "snapshot", "www.prowireusa.com__M22520-2-01-afm8-crimp-frame"),
    (r"RT125", "prowire_rt125", "snapshot", "www.prowireusa.com__resin-tech-rt125-ds-050-epoxy"),
    (r"prowire p-2360", "prowire_p2360", "external", "https://www.prowireusa.com/p-2360"),
    (r"prowire sitemap", "prowire_sitemap", "external", "https://www.prowireusa.com/sitemap"),
    (r"D510C cross-references|UF413|afa-motors", "coil_crossref", "external", "afa-motors listing (URL not kept)"),
    (r"GPR|fw 01\.11", "motec_gpr_release_notes", "external", "MoTeC GPR firmware release notes (not located)"),
    (r"Amphenol PCD datasheet", "amphenol_m85049_69", "snapshot", "www.amphenolpcd.com__M85049_69-Shrink-Boot"),
    (r"core-ics", "core_ics", "external", "core-ics dimensions (URL not kept)"),
    (r"listing plate photo", "ebay_k43_listing", "external", "eBay 178217121942 listing photo"),
    (r"'Short CAN Bus'|CAN Bus Wiring Requirements|twisted 22# Tefzel", "motec_pdm_manual", "stored_pdf", ("component_drawings__motec_pdm_user_manual", 3)),
    # our own files: design records, not evidence
    (r"K5_connector_|generate_connector_build_sheets|K5_cut_list|output/|registry|state row|state (row )?\d|state 0|tools\.yaml|parts\.yaml|"
     r"families\.yaml|endpoints\.yaml|chapters/|ch\.1[678]|receipt 2026|A14/AV1 is free|knock return joins|24# is not offered|"
     r"knock shield drains", "self", "self", None),
]


def classify(part):
    for rx, sid, kind, where in SOURCES:
        if re.search(rx, part, re.I):
            return sid, kind, where
    return "unknown:" + part[:60], "unknown", None


def split_sources(s):
    parts = []
    for p in re.split(r";\s*|\s+/\s+|\s\+\s", str(s or "")):
        p = p.strip()
        if not p:
            continue
        m = re.match(r"^decision:.*?—\s*(.*)$", p)
        if m:
            parts.append("state row (decision)")      # the decision itself is our record
            p = m.group(1)
        parts.append(p)
    return parts


# ---------------------------------------------------------------- source text
_cache = {}


def pdf_pages(slug):
    d = EXTRACTED / slug
    if not d.exists():
        return None
    return {int(f.stem.split("-")[1]): f.read_text(errors="ignore") for f in sorted(d.glob("page-*.txt"))}


def cited_pages(part):
    """printed page numbers named in the citation text: 'p.20', 'p.4–5', 'p.48'"""
    m = re.search(r"p\.\s*(\d+)(?:\s*[–-]\s*(\d+))?", part)
    if not m:
        return []
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    return list(range(a, b + 1))


def source_text(sid, kind, where, part):
    """(text, note) for this source, or (None, reason)"""
    if kind == "stored_pdf":
        slug, off = where
        pages = _cache.setdefault(slug, pdf_pages(slug))
        if not pages:
            return None, "pdf not extracted"
        want = cited_pages(part)
        if not want:
            return "\n".join(pages.values()), "whole document"
        near = sorted({p + off + d for p in want for d in (-1, 0, 1)} & set(pages))
        return "\n".join(pages[p] for p in near), f"pages {near[0]}–{near[-1]} (cited {want[0]}{'–' + str(want[-1]) if len(want) > 1 else ''}, offset {off})"
    if kind == "snapshot":
        stems = where if isinstance(where, list) else [where]
        texts = [page_text((SNAP / f"{s}.md").read_text(errors="ignore")) for s in stems if (SNAP / f"{s}.md").exists()]
        return ("\n".join(texts), f"{len(texts)} snapshot(s)") if texts else (None, "no snapshot kept")
    if kind == "owner_xlsx":
        f = OWNER / where
        if not f.exists():
            return None, "owner document not in reference_documents/owner_docs"
        if sid not in _cache:
            _cache[sid] = xlsx_text(f)
        return _cache[sid], "owner sheet"
    return None, kind


def page_text(md):
    """What the page says, not where it lives: drop our fetch header, image links, link targets and bare URLs,
    so a part number that only appears in a URL or an image file name doesn't count as the page stating it."""
    md = re.sub(r"^<!--.*?-->", "", md, count=1, flags=re.S)
    md = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r" \1 ", md)          # images -> alt text
    md = re.sub(r"\[([^\]]*)\]\([^)]*\)", r" \1 ", md)           # links  -> link text
    md = re.sub(r"https?://\S+", " ", md)
    return md


def xlsx_text(path):
    z = zipfile.ZipFile(path)
    ss = re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf8", "ignore"), re.S) if "xl/sharedStrings.xml" in z.namelist() else []
    strings = ["".join(re.findall(r"<t[^>]*>([^<]*)</t>", s)) for s in ss]
    rows = []
    for name in sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet")):
        x = z.read(name).decode("utf8", "ignore")
        for row in re.findall(r"<row[^>]*>(.*?)</row>", x, re.S):
            vals = []
            for attrs, body in re.findall(r"<c ([^>]*)>(.*?)</c>", row, re.S):
                v = re.search(r"<v>([^<]*)</v>", body)
                if v:
                    vals.append(strings[int(v.group(1))] if 't="s"' in attrs else v.group(1))
            rows.append(" | ".join(vals))
    return "\n".join(rows)


# ---------------------------------------------------------------- values a field claims
CODE = re.compile(r"(?<![A-Za-z0-9/.-])((?=[A-Z0-9/.-]*\d)[A-Z0-9][A-Z0-9/.-]*[A-Z0-9]|[A-Z0-9]+(?:-[A-Z0-9/]+){2,}|[A-Z]{2,5}-[A-Z]{1,3})(?![A-Za-z0-9])")
PIN = re.compile(r"\bM130:([AB])(\d{2})\b")
MEAS = re.compile(r"(\d+(?:\.\d+)?)\s?(in|mm|lbf|ohm|Ω)\b")
SEL = re.compile(r"selector\s+(\d+)", re.I)
IGNORE = {"M130", "PDM30", "AWG", "M22759/32", "M22759/16"}     # spec family words are checked through the wire rows


def value_tokens(v):
    """Every checkable value in a field: part numbers and codes, M130 pins, measurements, crimp selector settings."""
    v = str(v)
    toks = set()
    for m in PIN.finditer(v):
        toks.add(("pin", f"{m.group(1)}{m.group(2)}"))
    for m in CODE.finditer(v):
        t = m.group(1).rstrip(".")
        if t in IGNORE or re.fullmatch(r"[AB]\d{2}", t) or re.fullmatch(r"\d{1,3}(\.\d+)?", t):
            continue
        toks.add(("pn", t))
    for m in MEAS.finditer(v):
        toks.add(("num", m.group(1)))
    for m in SEL.finditer(v):
        toks.add(("sel", m.group(1)))
    # wire rows: the spec at this gauge ("M22759/16-22", as the MoTeC manuals print it) and the colour
    m = re.search(r"(\d{1,2}) AWG (M22759/\d+)", v)
    if m:
        toks.add(("pn", f"{m.group(2)}-{m.group(1)}"))
    m = re.search(r"\b((?:white|black|red|green|blue|yellow|orange|brown|gray|grey|violet|purple|pink|tan)(?:/(?:white|black|red|green|blue|yellow|orange|brown|gray|grey|violet|purple|pink|tan))*)\b", v, re.I)
    if m and " AWG " in v:
        toks.add(("col", m.group(1).lower()))
    # "M39029/56-351 (cabin) + /58-363 (engine)": the second contact is the same spec family
    for m in re.finditer(r"(M\d{5})/\d+-\d+[^/]*?\+ /(\d+-\d+)", v):
        toks.discard(("pn", "/" + m.group(2)))
        toks.discard(("pn", m.group(2)))
        toks.add(("pn", f"{m.group(1)}/{m.group(2)}"))
    # names before the em dash in wire rows are the cut list's words, not part numbers
    if " — " in v and " AWG " in v:
        name = v.split(" — ")[0]
        toks = {t for t in toks if not (t[0] == "pn" and t[1] in name)}
    return toks


def norm(s):
    return re.sub(r"[\s\u00a0]+", " ", s).upper()


def found(tok, text):
    kind, t = tok
    T = norm(text)
    if kind == "pin":
        a, n = t[0], int(t[1:])
        return bool(re.search(rf"\b{a}0?{n}\b", T))
    if kind == "num":
        return bool(re.search(rf"(?<![\d.]){re.escape(t)}(?![\d])", T))
    if kind == "col":
        return t.upper() in T
    if kind == "sel":
        # a selector setting only counts if the source has a selector/position table that shows this number
        return bool(re.search(r"SELECTOR|POSITION(ER)? SETTING", T)) and bool(re.search(rf"(?<![\d.]){t}(?![\d.])", T))
    u = t.upper()
    if u in T:
        return True
    squash = lambda s: re.sub(r"[^A-Z0-9]", "", s)
    return len(squash(u)) >= 4 and squash(u) in squash(T)


# ---------------------------------------------------------------- audit
def audit():
    r = json.load(open(CD / "k5_registry.json"))
    out = []
    for eid, d in r["dossiers"].items():
        for rw in d["rows"]:
            if rw["state"] != "cited":
                continue
            parts = split_sources(rw.get("source"))
            srcs = [(p,) + classify(p) for p in parts]
            toks = value_tokens(rw["value"])
            ext = [s for s in srcs if s[2] != "self"]
            per_src = []
            union_hit = set()
            any_text = False
            for p_, sid, kind, where in ext:
                txt, note = source_text(sid, kind, where, p_)
                hit = {t for t in toks if txt and found(t, txt)}
                union_hit |= hit
                any_text = any_text or bool(txt)
                per_src.append({"id": sid, "kind": kind, "note": note, "stored": bool(txt), "found": sorted(t for _, t in hit)})
            if not ext:
                status = "SELF_ONLY"
            elif not any_text:
                status = "NEVER_FETCHED" if {s[2] for s in ext} <= {"never_fetched"} else "UNSTORED"
            elif not toks:
                status = "STORED_PROSE"
            else:
                status = "VERIFIED" if union_hit == toks else "PARTIAL" if union_hit else "NOT_FOUND"
            out.append({"endpoint": eid, "field": rw["field"], "value": rw["value"], "source": rw.get("source"),
                        "status": status, "tokens": sorted(f"{k}:{t}" for k, t in toks),
                        "missing": sorted(f"{k}:{t}" for k, t in toks - union_hit) if any_text else [],
                        "sources": per_src, "self": len(srcs) - len(ext)})
    return out


def main():
    res = audit()
    c = Counter(x["status"] for x in res)
    order = ["VERIFIED", "PARTIAL", "NOT_FOUND", "STORED_PROSE", "UNSTORED", "NEVER_FETCHED", "SELF_ONLY"]
    print(f"cited fields: {len(res)}")
    for s in order:
        print(f"  {s:14s} {c.get(s, 0):4d}  {100 * c.get(s, 0) / max(1, len(res)):5.1f}%")
    by_src = defaultdict(Counter)
    for x in res:
        for s in x["sources"]:
            key = ("stored, values found" if s["stored"] and s["found"] else "stored, none found" if s["stored"] else
                   "never fetched" if s["kind"] == "never_fetched" else "not kept")
            by_src[s["id"]][key] += 1
        if x["self"]:
            by_src["(our own files)"]["design record"] += 1
    print("\nby source (fields citing it):")
    for sid, cc in sorted(by_src.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"  {sid:28s} {sum(cc.values()):4d}  " + ", ".join(f"{k} {v}" for k, v in cc.most_common()))
    if "--fields" in sys.argv:
        for x in res:
            if x["status"] in ("PARTIAL", "NOT_FOUND"):
                print(f"\n[{x['status']}] {x['endpoint']} · {x['field']}: {x['value'][:120]}\n   missing {x['missing']} · {x['sources']}")
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
