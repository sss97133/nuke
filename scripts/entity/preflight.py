#!/usr/bin/env python3
"""
preflight.py — the guarded door for PYTHON writers.

WHY THIS FILE EXISTS, AND WHAT IT HONESTLY IS NOT
──────────────────────────────────────────────────────────────────────────────
scripts/entity/write.mjs is the single guarded writer for served columns. It is
JavaScript. Three of the write paths that produced measured client-surface
defects are Python and cannot import it:

  lofficiel-concierge/scripts/ingest_wimco_villas.py   properties.base_price
  lofficiel-concierge/scripts/villa-turnstile/land_lebarth.py  properties.base_price
  lofficiel-concierge/scripts/ingest_shopify_catalog.py        concierge_products.price

There were two options. Reimplement the gate in Python — which means two gates,
which means the first edit to bands.json or validate.mjs silently makes one of
them wrong, and a gate that is wrong is worse than no gate because it grants
confidence. Or shell out to the real one. This is the second.

`preflight()` serialises the proposed writes to JSON, pipes them to
`write.mjs plan` under dotenvx, and returns that gate's decisions. There is
exactly ONE severity ladder, ONE bands.json, ONE cohort pass, and it lives in
JS. Nothing here judges a value.

THE ASYMMETRY, STATED PLAINLY — do not let a reader miss this
──────────────────────────────────────────────────────────────────────────────
For a JS caller, `writeField` IS the write: you cannot get a value into the
column without passing the gate, because the gate and the write are the same
call. That is structural.

For a Python caller, this is a PREFLIGHT, not a turnstile. The script still owns
its own PostgREST POST/PATCH. If a future edit adds a write that does not call
`preflight()` first, that write is ungated and nothing here will notice. The
enforcement is by convention plus the two mitigations below — it is NOT the same
guarantee the JS path has.

  Mitigation 1 — `assert_admitted()` raises. The wired callers pass their rows
    through it and let it throw. A refusal stops the ingest; it does not warn.
  Mitigation 2 — `require_price_units()` runs LOCALLY, before the subprocess,
    and refuses a money write carrying no currency or no period. This duplicates
    a check the JS gate also makes (`unit_currency_required`) and that is
    deliberate: it is the one rule whose absence produced the 388-villa
    nightly-rate-served-as-weekly defect, and it must fail even when the
    subprocess cannot be reached at all. It is a refusal, never an admission —
    it can only subtract. It can never let something in that the gate would hold.

The honest way to close the asymmetry is to port these three ingests to the JS
writer. Until then: this narrows the door, it does not lock it.

CARDINAL RULE THIS FILE ENFORCES LOCALLY
──────────────────────────────────────────────────────────────────────────────
A price write MUST carry both a currency and a period/unit, or it is refused.
A number without a unit is not a price — it is a number that will be labelled by
whatever the UI happens to say. Proof:  python3 scripts/entity/preflight.py demo

USAGE
──────────────────────────────────────────────────────────────────────────────
    import sys; sys.path.insert(0, "/Users/skylar/nuke/scripts/entity")
    from preflight import preflight, assert_admitted, PreflightRefused

    items = [{
        "subject_type": "property", "subject_id": pid, "field": "base_price",
        "value": 22000, "source": "wimco.com",
        "source_url": "https://www.wimco.com/...",
        "observed_at": "2026-07-20", "method": "listing_jsonld",
        "trust": "reported", "actor": "agent:ingest_wimco_villas",
        "context": {"currency": "USD", "period": "night"},
        "__name": villa_name,
    }]
    ok = assert_admitted(items)      # raises PreflightRefused on any held row
    # ... only now issue your own PostgREST write for `ok`

`preflight(items, apply=False)` returns the raw decision envelope:
    {"apply":bool,"n":int,"admitted":int,"held":int,"decisions":[...]}
Each decision carries: admitted, action, severity, reason, checks, units, cohort.
BRANCH ON `action`/`admitted`, never on a truthiness of the value.
"""

import json
import os
import subprocess
import sys

NUKE = "/Users/skylar/nuke"
WRITER = os.path.join(NUKE, "scripts/entity/write.mjs")

# Same regexes the JS gate uses to classify a field, so "is this money?" cannot
# disagree across the two sides of the pipe.
import re
_MONEY = re.compile(r"price|rate|cost|amount|fee|asking", re.I)


def is_money_field(field, context=None):
    ctx = context or {}
    if "is_money" in ctx:
        return bool(ctx["is_money"])
    return bool(_MONEY.search(field or ""))


class PreflightRefused(Exception):
    """Raised when the gate held one or more proposed writes. Carries them."""

    def __init__(self, held, envelope=None):
        self.held = held
        self.envelope = envelope
        lines = [f"{len(held)} write(s) held at the door:"]
        for d in held[:20]:
            who = d.get("name") or d.get("subject_id")
            lines.append(
                f"  [{d.get('action')}/{d.get('severity')}] {who} "
                f".{d.get('field')} = {d.get('value')!r} — {(d.get('reason') or '')[:220]}"
            )
        if len(held) > 20:
            lines.append(f"  … and {len(held) - 20} more")
        super().__init__("\n".join(lines))


def require_price_units(items):
    """LOCAL refusal, before the subprocess. Returns a list of refusal dicts
    shaped like gate decisions (empty list == nothing locally refusable).

    This is the one rule that must hold even if the gate is unreachable: a money
    value with no currency or no period is refused. 388 of 747 priced villas
    were served ~7x under because a nightly rate met a hardcoded "/week" label.
    Carrying the unit with the number is what makes that class impossible.
    """
    out = []
    for i, it in enumerate(items):
        field = it.get("field")
        if not is_money_field(field, it.get("context")):
            continue
        ctx = it.get("context") or {}
        cur = ctx.get("currency")
        per = ctx.get("period") or ctx.get("unit")
        missing = []
        if cur in (None, "", "unknown"):
            missing.append("currency")
        if per in (None, "", "unknown"):
            missing.append("period/unit")
        if missing:
            out.append({
                "index": i,
                "subject_type": it.get("subject_type"),
                "subject_id": it.get("subject_id"),
                "field": field,
                "value": it.get("value"),
                "name": it.get("__name"),
                "admitted": False,
                "action": "refused",
                "severity": "block",
                "reason": (
                    f"unit_currency_required (preflight, local): money value "
                    f"{it.get('value')!r} carries no {' and no '.join(missing)} — "
                    "a number without a unit is not a price. It would be labelled by "
                    "whatever the UI happens to say, which is exactly how 388 nightly "
                    "villa rates came to be served with a hardcoded '/week'."
                ),
                "checks": [{"check": "unit_currency_required", "severity": "block", "code": "local_preflight"}],
                "units": {"currency": cur, "period": per},
                "cohort": None,
            })
    return out


def preflight(items, apply=False, timeout=600):
    """Run the REAL gate over `items`. Returns the decision envelope.

    Local unit refusals short-circuit: if any money row lacks currency/period we
    do not consult the gate at all, because the batch is already malformed and
    sending it would put an unlabelled number in front of a cohort statistic
    that assumes labels.
    """
    items = list(items or [])
    if not items:
        return {"apply": apply, "n": 0, "admitted": 0, "held": 0, "decisions": []}

    local = require_price_units(items)
    if local:
        return {
            "apply": apply, "n": len(items), "admitted": 0, "held": len(local),
            "decisions": local, "gate": "local_preflight_only",
        }

    cmd = ["dotenvx", "run", "--quiet", "--", "node", WRITER, "plan"]
    if apply:
        cmd.append("--apply")
    proc = subprocess.run(
        cmd, cwd=NUKE, input=json.dumps(items), capture_output=True,
        text=True, timeout=timeout,
    )
    # exit 0 = all admitted, 3 = some held, 2 = bad input, other = crash.
    if proc.returncode not in (0, 3):
        raise RuntimeError(
            f"gate failed (exit {proc.returncode}) — refusing to write blind.\n"
            f"stderr: {proc.stderr[-2000:]}\nstdout: {proc.stdout[-2000:]}"
        )
    line = (proc.stdout or "").strip().splitlines()
    if not line:
        raise RuntimeError("gate produced no output — refusing to write blind")
    env = json.loads(line[-1])
    env["gate"] = "write.mjs plan"
    return env


def assert_admitted(items, apply=False, on_hold="raise"):
    """Preflight `items`; return only the admitted ones.

    on_hold="raise" (default) — any held row aborts the ingest. This is the
        setting the wired callers use. A bad price reaching a client surface is
        worse than an ingest that stops.
    on_hold="skip" — drop held rows, proceed with the rest, print the refusals.
        Use only where partial landing is genuinely better than none, and say so
        at the call site.
    """
    env = preflight(items, apply=apply)
    held = [d for d in env["decisions"] if not d.get("admitted")]
    if held:
        if on_hold == "raise":
            raise PreflightRefused(held, env)
        print(f"  PREFLIGHT: {len(held)} of {env['n']} held, skipping them:", file=sys.stderr)
        for d in held:
            print(f"    [{d['action']}] {d.get('name') or d.get('subject_id')} "
                  f".{d['field']}={d['value']!r} — {(d.get('reason') or '')[:200]}", file=sys.stderr)
    ok_idx = {d["index"] for d in env["decisions"] if d.get("admitted")}
    return [it for i, it in enumerate(items) if i in ok_idx]


def _demo():
    """PROOF of the cardinal rule: a price write with no period is refused.

    Uses a real live property id so the demonstration is against the real gate
    and the real schema, not a fixture. Writes nothing (apply=False throughout,
    and the unit-less case never reaches the gate at all).
    """
    import urllib.request

    # Resolve env the way the repo does — through dotenvx — rather than parsing
    # .env by hand. /Users/skylar/nuke has SEVEN .env* files and .env pins
    # VITE_SUPABASE_URL at 127.0.0.1:54321; hand-parsing picked the local stack
    # and the demo silently talked to nothing. dotenvx is the one resolver.
    def _env(name):
        v = os.environ.get(name)
        if v:
            return v
        try:
            p = subprocess.run(["dotenvx", "run", "--quiet", "--", "printenv", name],
                               cwd=NUKE, capture_output=True, text=True, timeout=60)
            return (p.stdout or "").strip() or None
        except Exception:
            return None

    url = _env("VITE_SUPABASE_URL")
    key = _env("SUPABASE_SERVICE_ROLE_KEY")
    pid = name = None
    if url and key:
        try:
            req = urllib.request.Request(
                f"{url}/rest/v1/properties?select=id,name&base_price=is.null&limit=1",
                headers={"apikey": key, "Authorization": f"Bearer {key}"})
            rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
            if rows:
                pid, name = rows[0]["id"], rows[0]["name"]
        except Exception as e:
            print(f"(could not read a live property: {e})")
    if not pid:
        print("no live property available; run from an env with DB access")
        return 1

    base = {
        "subject_type": "property", "subject_id": pid, "field": "base_price",
        "source": "preflight-demo", "source_url": "https://example.invalid/demo",
        "observed_at": "2026-07-20", "method": "demo", "trust": "reported",
        "actor": "agent:preflight-demo", "__name": name,
    }

    print("\nPROOF — the cardinal rule: a price write must carry unit + currency.")
    print(f"subject: property {name} ({pid}), base_price currently NULL, all cases dry-run\n")

    cases = [
        ("A. no period, no currency (a bare number)", {**base, "value": 22000, "context": {}}),
        ("B. currency but NO period (the WIMCO shape)", {**base, "value": 22000, "context": {"currency": "USD"}}),
        ("C. period but NO currency", {**base, "value": 22000, "context": {"period": "week"}}),
        ("D. both present — reaches the real gate", {**base, "value": 22000,
                                                     "context": {"currency": "USD", "period": "week"}}),
    ]
    rc = 0
    for label, item in cases:
        env2 = preflight([item], apply=False)
        d = env2["decisions"][0]
        verdict = "ADMITTED" if d["admitted"] else "REFUSED "
        print(f"  {verdict}  {label}")
        print(f"            gate={env2.get('gate')}  action={d['action']}  severity={d['severity']}")
        print(f"            {(d.get('reason') or '')[:300]}")
        print(f"            units={d.get('units')}\n")
        if label.startswith(("A.", "B.", "C.")) and d["admitted"]:
            print("  !! CARDINAL RULE VIOLATED — a unitless price was admitted")
            rc = 1
    print("Nothing was written by this demo.\n")
    return rc


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "demo":
        sys.exit(_demo())
    print(__doc__)
