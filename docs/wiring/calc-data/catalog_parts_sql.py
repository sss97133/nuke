#!/usr/bin/env python3
"""Usage: python3 catalog_parts_sql.py [SNAPSHOT_DIR] > values.sql

The K5 build's parts and tools catalog (catalog/parts.yaml, catalog/tools.yaml) as VALUES rows for catalog_parts, the part
master the harness keys point at (case ledger 13.12.2 step c; RSI pass 6). Only entries that cite a source and are not
open or retired; tools only with a part number. No prices and no purchase state: "$..." fragments are cut from source
strings and cart read-backs are dropped. supplier_url is the vendor page a stored snapshot was taken from
(reference_documents/web_snapshots, local, not in git), when one is named in the sources or matches the part number.
Columns: (part_number, name, subcategory, supplier, supplier_url, application_data json)."""
import json
import re
import sys
from pathlib import Path

import yaml

CD = Path(__file__).resolve().parent
REPO = CD.parents[2]
SNAP = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "reference_documents/web_snapshots"
PRICE = re.compile(r"\s*[(,;]?\s*\$[\d.,]+[^);,]*\)?")


def clean_sources(src):
    out = []
    for s in src or []:
        s = str(s)
        if re.search(r"\bcart\b", s, re.I):
            continue
        s = PRICE.sub("", s).strip(" ;,")
        if s:
            out.append(s)
    return out


def snapshot_url(pn, sources):
    names = re.findall(r"web_snapshots/([^\s)'\"]+?\.md)", " ".join(sources))
    slug = pn.lower().replace("/", "-")
    if SNAP.is_dir():
        names += [p.name for p in SNAP.glob("*.md") if p.stem.lower().endswith("__" + slug) or p.stem.lower().endswith("-" + slug)]
    for n in names:
        f = SNAP / n
        if f.exists():
            m = re.search(r"source: (\S+)", f.read_text(errors="ignore")[:600])
            if m:
                return m.group(1)
    return None


def rows():
    parts = yaml.safe_load((CD / "catalog/parts.yaml").read_text())
    tools = yaml.safe_load((CD / "catalog/tools.yaml").read_text())
    out = []
    for pn, v in parts.items():
        src = clean_sources(v.get("sources") or ([v["source"]] if v.get("source") else []))
        if not src or v.get("status") in ("open", "retired") or v.get("kind") == "reference":
            continue
        app = {"supplier": v.get("vendor"), "source_file": "docs/wiring/calc-data/catalog/parts.yaml", "sources": src,
               "loaded_by": "rsi pass 6 (catalog_parts_sql.py)"}
        for k in ("family", "range_awg", "contains", "die", "stud", "amps"):
            if v.get(k) is not None:
                app[k] = v[k]
        out.append((pn, v.get("name") or pn, v.get("kind"), v.get("vendor"), snapshot_url(pn, src), app))
    for code, v in tools.items():
        src = clean_sources(v.get("sources"))
        if not v.get("pn") or not src:
            continue
        app = {"supplier": None, "source_file": "docs/wiring/calc-data/catalog/tools.yaml", "tool_code": code, "sources": src,
               "loaded_by": "rsi pass 6 (catalog_parts_sql.py)"}
        for k in ("does", "for", "range"):
            if v.get(k) is not None:
                app[k] = v[k]
        out.append((v["pn"], v.get("name") or v["pn"], "tool", None, snapshot_url(v["pn"], src), app))
    pns = [r[0] for r in out]
    assert len(pns) == len(set(pns)), "a part number appears twice"
    return out


def q(x):
    return "NULL" if x is None else "'" + str(x).replace("'", "''") + "'"


if __name__ == "__main__":
    rs = rows()
    print(",\n".join(f"  ({q(pn)}, {q(name)}, {q(kind)}, {q(vendor)}, {q(url)}, {q(json.dumps(app, ensure_ascii=False))}::jsonb)"
                     for pn, name, kind, vendor, url, app in rs))
    print(f"-- {len(rs)} rows; {sum(1 for r in rs if r[4])} with a snapshot URL", file=sys.stderr)
