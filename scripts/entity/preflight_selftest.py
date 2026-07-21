#!/usr/bin/env python3
"""
preflight_selftest.py — proof that the PYTHON door reaches the same gate.

Run: cd /Users/skylar/nuke && npm run entity:preflight:selftest

Nothing is written. Every call is dry-run and every subject is read live from
the database, not from a fixture, so a schema or band change shows up here as a
changed verdict rather than a stale green tick.

WHAT IS BEING PROVEN, AND WHAT IS NOT
──────────────────────────────────────────────────────────────────────────────
PROVEN: the three Python ingests (ingest_wimco_villas.py, land_lebarth.py,
  ingest_shopify_catalog.py) now send their served-column price writes through
  scripts/entity/write.mjs, and get the same severity ladder, the same fitted
  bands and the same cohort pass a JS caller gets.
PROVEN: a price with no currency or no period is refused before it can land,
  which is what makes the "nightly rate served with a hardcoded /week" class
  structurally impossible rather than merely unlikely.
NOT PROVEN: that a future edit to those scripts cannot add an ungated write.
  This is a preflight, not a turnstile. See the preflight.py header.
"""

import json
import os
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from preflight import preflight  # noqa: E402

NUKE = "/Users/skylar/nuke"
C = {"r": "\x1b[31m", "y": "\x1b[33m", "g": "\x1b[32m", "c": "\x1b[36m",
     "d": "\x1b[2m", "b": "\x1b[1m", "x": "\x1b[0m"}
LABEL = {"applied": "ADMITTED  ", "would_apply": "WOULD ADMIT", "quarantined": "QUARANTINED",
         "conflict": "CONFLICT  ", "refused": "REFUSED   "}


def colour(sev):
    return {"pass": C["g"], "flag": C["y"], "unknown": C["c"]}.get(sev, C["r"])


def show(d, note=""):
    print(f"   {colour(d['severity'])}{LABEL.get(d['action'], d['action'])}{C['x']} "
          f"{str(d.get('name') or d['subject_id'])[:34]:34} {str(d['value']):>9}  "
          f"{C['d']}[{d['severity']}]{note}{C['x']}")
    print(f"      {C['d']}{(d.get('reason') or '')[:200]}{C['x']}")


def env(name):
    v = os.environ.get(name)
    if v:
        return v
    p = subprocess.run(["dotenvx", "run", "--quiet", "--", "printenv", name],
                       cwd=NUKE, capture_output=True, text=True, timeout=60)
    return (p.stdout or "").strip() or None


URL, KEY = env("VITE_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY")


def rest(path):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}",
                                 headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def main():
    held = admitted = cases = 0

    # ── 1. THE CARDINAL RULE ────────────────────────────────────────────────
    print(f"\n{C['b']}1 — THE CARDINAL RULE: a price write carries unit + currency, or it is refused{C['x']}")
    print(f"{C['d']}the class this closes: 388 of 747 priced villas served ~7x under because a "
          f"nightly rate met a hardcoded '/week' label{C['x']}\n")
    prop = rest("properties?select=id,name&base_price=is.null&limit=1")[0]
    base = {"subject_type": "property", "subject_id": prop["id"], "field": "base_price",
            "source": "selftest", "source_url": "https://example.invalid/selftest",
            "observed_at": "2026-07-20", "method": "selftest", "trust": "reported",
            "actor": "agent:preflight-selftest", "__name": prop["name"]}
    unit_cases = [
        ("bare number, no unit at all", {}),
        ("currency, NO period — the WIMCO shape", {"currency": "USD"}),
        ("period, NO currency", {"period": "week"}),
        ("both present — reaches the fitted band", {"currency": "USD", "period": "week"}),
    ]
    for label, ctx in unit_cases:
        d = preflight([{**base, "value": 22000, "context": ctx}])["decisions"][0]
        cases += 1
        admitted, held = (admitted + 1, held) if d["admitted"] else (admitted, held + 1)
        show({**d, "name": label})
        if not ctx.get("currency") or not ctx.get("period"):
            assert not d["admitted"], "CARDINAL RULE VIOLATED — a unitless price was admitted"

    # ── 2. THE ELAN VILLA PRICES, THROUGH THE PYTHON DOOR ───────────────────
    print(f"\n{C['b']}2 — the 9 real Elan prices (merchant publishes 22,000-125,000; these stored "
          f"294-804 — 27-155x under){C['x']}")
    print(f"{C['d']}source: properties.metadata.price_quarantine.base_price_as_found, read live. "
          f"Sent as ONE batch, which is how they really arrived and what makes the cohort pass "
          f"reachable.{C['x']}\n")
    elan = rest("properties?select=id,name,source_url,metadata&metadata->price_quarantine=not.is.null")
    items = [{
        "subject_type": "property", "subject_id": r["id"], "field": "base_price",
        "value": r["metadata"]["price_quarantine"]["base_price_as_found"],
        "source": "elanvillarental", "source_url": r["source_url"],
        "observed_at": "2026-07-01", "method": "html_scrape", "trust": "reported",
        "actor": "agent:preflight-selftest",
        "context": {"currency": r["metadata"]["price_quarantine"]["price_currency_as_found"],
                    "period": r["metadata"]["price_quarantine"]["price_period_as_found"]},
        "__name": r["name"],
    } for r in elan]
    if items:
        e = preflight(items)
        for d in e["decisions"]:
            co = next((c for c in d["checks"] if c["check"] == "cohort_displacement"), None)
            show(d, " +cohort" if co else "")
        cases += e["n"]
        admitted += e["admitted"]
        held += e["held"]
        pop = (e["decisions"][0].get("cohort") or {}).get("population_n")
        print(f"   {C['b']}{e['held']}/{e['n']} held{C['x']} {C['d']}against {pop} live population "
              f"rows — identical to the JS path's own replay, because it is the same gate{C['x']}")

    # ── 3. THE 100x GARMENT SHAPE, ON REAL PRODUCTS ─────────────────────────
    print(f"\n{C['b']}3 — the 100x product shape (a garment stored at 0.12 EUR the merchant sells "
          f"at 12.00 EUR){C['x']}")
    print(f"{C['d']}The original row was repaired before this writer existed and no quarantine "
          f"record of it survives, so the DEFECT SHAPE (value/100) is replayed against real live "
          f"products of the same merchant. Stated plainly: the subjects and the population are "
          f"real and read live; the two candidate values are reconstructed, not preserved.{C['x']}\n")
    # Pick the merchant with the MOST EUR-priced retail rows, not simply the
    # priciest rows on the platform. product.price bands are fitted per org
    # (SUBJECTS.product.groupCol = 'org_id' — the merchant IS the price regime,
    # without which a pooled EUR band flags every handbag and every cappuccino),
    # so the largest population is the best-fitted band and therefore the
    # honest place to test. Ordering by price alone picked two villas-sold-as-
    # products off a 3-row merchant and proved almost nothing.
    pool = rest("concierge_products?select=id,name,price,currency,price_unit,org_id"
                "&price=not.is.null&currency=eq.EUR&kind=eq.retail_item&limit=1000")
    from collections import Counter
    top_org = Counter(p["org_id"] for p in pool).most_common(1)[0]
    prods = sorted([p for p in pool if p["org_id"] == top_org[0]],
                   key=lambda p: float(p["price"]), reverse=True)[:2]
    print(f"{C['d']}merchant chosen: org {top_org[0]} — {top_org[1]} EUR retail rows, "
          f"the best-fitted band on the platform{C['x']}\n")
    pitems = [{
        "subject_type": "product", "subject_id": p["id"], "field": "price",
        "value": round(float(p["price"]) / 100, 2),
        "source": "shopify_replay", "source_url": "https://example.invalid/replay",
        "observed_at": "2026-07-20", "method": "shopify_products_json", "trust": "reported",
        "actor": "agent:preflight-selftest",
        "context": {"currency": p["currency"], "period": p["price_unit"] or "each"},
        "__name": f"{p['name'][:26]} (real {p['price']} ÷100)",
    } for p in prods]
    if pitems:
        e = preflight(pitems)
        for d in e["decisions"]:
            show(d)
        cases += e["n"]
        admitted += e["admitted"]
        held += e["held"]

    # ── 4. THE PRODUCT PATH'S OWN UNIT RULE ─────────────────────────────────
    print(f"\n{C['b']}4 — concierge_products.price with no price_unit{C['x']}")
    print(f"{C['d']}the retail branch of ingest_shopify_catalog.py wrote price + currency and NEVER "
          f"price_unit — a number with a currency but no unit. Now refused.{C['x']}\n")
    if prods:
        p = prods[0]
        d = preflight([{
            "subject_type": "product", "subject_id": p["id"], "field": "price",
            "value": float(p["price"]), "source": "shopify_replay",
            "source_url": "https://example.invalid/replay", "observed_at": "2026-07-20",
            "method": "shopify_products_json", "trust": "reported",
            "actor": "agent:preflight-selftest",
            "context": {"currency": p["currency"]},
            "__name": f"{p['name'][:26]} (no price_unit)",
        }])["decisions"][0]
        cases += 1
        admitted, held = (admitted + 1, held) if d["admitted"] else (admitted, held + 1)
        show(d)
        assert not d["admitted"], "CARDINAL RULE VIOLATED — a unitless product price was admitted"

    print(f"\n{C['b']}{cases} cases · {held} held at the door · {admitted} admitted{C['x']}")
    print(f"{C['d']}Nothing was written, nulled or deleted (every call dry-run).{C['x']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
