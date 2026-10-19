#!/usr/bin/env python3
"""Export each K5 wire's route over the live route graph into inputs/route_lengths.json (RSI pass 39).

The route graph (route_harness_segments, RSI pass 33) routes each segment between standing points over the design
record's branches. This reads the live model and writes, per wire code: the route length summed over its routed
segments (inches), the branch count, how many live segments the wire has and how many are routed, and whether the
route is complete. reconcile_v5.py reads the file: a wire with no length takes its complete route, and a wire with only
a zone estimate takes the longer of the two (a twin route carries no modelled slack, so it never shortens a cut).
Run from a checkout on origin/main after a loader run, with the service credentials through dotenvx, the same way as
load_map_rows.py.
"""
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import load_map_rows as L

OUT = Path(__file__).with_name("inputs") / "route_lengths.json"


MATED = {"FIREWALL-ENGINE": "FIREWALL-CABIN"}      # the 61-pin's two halves are one crossing


def chain(hops):
    """The plugs a wire's segments join, start to end, when they form one simple path in their own direction; else None."""
    if not hops or any(h is None or None in h for h in hops):
        return None
    nxt = {}
    for a, b in hops:
        a, b = MATED.get(a, a), MATED.get(b, b)
        if a in nxt:
            return None
        nxt[a] = b
    starts = set(nxt) - set(nxt.values())
    if len(starts) != 1:
        return None
    path = [starts.pop()]
    while path[-1] in nxt and len(path) <= len(hops):
        path.append(nxt[path[-1]])
    return path if len(path) == len(hops) + 1 and len(set(path)) == len(path) else None


def main():
    api = L.API()
    segs = api.get("harness_segments", f"vehicle_id=eq.{L.K5}&is_superseded=eq.false&select=id,"
                                       "circuit:vehicle_custom_circuits(circuit_code,design_status,is_superseded)&limit=5000")
    routes = api.get("v_harness_route_length_check", f"vehicle_id=eq.{L.K5}&select=segment_id,route_in,branches&order=segment_id&limit=5000")
    by_seg = {r["segment_id"]: r for r in routes}
    ends = {g["segment_id"]: (g["from_plug"], g["to_plug"]) for g in
            api.get("v_harness_segment_geometry", f"vehicle_id=eq.{L.K5}&select=segment_id,from_plug,to_plug&order=segment_id&limit=5000")}
    wires = defaultdict(lambda: {"route_in": 0.0, "branches": 0, "segments": 0, "routed": 0})
    hops = defaultdict(list)
    for s in segs:
        c = s.get("circuit") or {}
        if not c or c.get("is_superseded") or c.get("design_status") != "decided":
            continue
        w = wires[c["circuit_code"]]
        w["segments"] += 1
        hops[c["circuit_code"]].append(ends.get(s["id"]))
        r = by_seg.get(s["id"])
        if r:
            w["routed"] += 1
            w["route_in"] += float(r["route_in"])
            w["branches"] += int(r["branches"])
    out = {"exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "source": "live route graph (v_harness_route_length_check over harness_segments), vehicle " + L.K5,
           "wires": {k: dict(v, route_in=round(v["route_in"], 1), complete=v["routed"] == v["segments"] and v["routed"] > 0,
                             chain=chain(hops[k]))
                     for k, v in sorted(wires.items()) if v["routed"]}}
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    done = sum(1 for v in out["wires"].values() if v["complete"])
    print(f"{len(out['wires'])} wires with a routed segment, {done} fully routed -> {OUT}")


if __name__ == "__main__":
    main()
