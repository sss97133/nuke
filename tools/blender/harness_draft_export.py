"""
Harness Draft Export (Blender)

Goal:
  Export measurable wiring/harness routing data from a vehicle 3D model:
  - Marker points (empties) for grommets, clamps, connector targets, branch points
  - Route curves (Bezier/NURBS) representing the harness path(s)
  - Computed curve lengths + sampled points along curves at a fixed spacing

Tested with:
  Blender 2.93+ (should work on newer versions as well)

Conventions:
  - Marker empties: name starts with "HP_" (Harness Point)
      Example: HP_FIREWALL_GROMMET_MAIN
  - Route curves: name starts with "HR_" (Harness Route)
      Example: HR_ENGINE_MAIN, HR_FRONT_LIGHTING

Usage (Blender):
  - Open your .blend (or import FBX)
  - Create empties for points you want measured, name them HP_*
  - Create Curve objects for harness paths, name them HR_*
  - Run this script from the Scripting workspace

Output:
  Writes a CSV + JSON side-by-side to:
    //exports/harness_draft_<timestamp>.{csv,json}
  where '//' means "relative to the .blend file directory".
"""

from __future__ import annotations

import bpy
import csv
import json
import math
import os
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class HarnessPoint:
    name: str
    kind: str  # "marker" | "curve_sample"
    route: Optional[str]  # HR_* name for curve samples
    distance_along_route: Optional[float]  # scene units
    x: float
    y: float
    z: float


@dataclass
class HarnessRoute:
    name: str
    length: float  # scene units
    sample_spacing: float  # scene units
    samples: int


def _scene_unit_label() -> str:
    us = bpy.context.scene.unit_settings
    # Not perfect (Blender is flexible), but better than nothing.
    if us.system == "IMPERIAL":
        return "imperial"
    if us.system == "METRIC":
        return "metric"
    return "none"


def _world_xyz(obj: bpy.types.Object) -> Tuple[float, float, float]:
    w = obj.matrix_world.translation
    return float(w.x), float(w.y), float(w.z)


def _iter_marker_empties(prefix: str = "HP_") -> List[bpy.types.Object]:
    out: List[bpy.types.Object] = []
    for obj in bpy.data.objects:
        if obj.type != "EMPTY":
            continue
        if not obj.name.startswith(prefix):
            continue
        out.append(obj)
    out.sort(key=lambda o: o.name)
    return out


def _evaluated_curve_length(curve_obj: bpy.types.Object, depsgraph: bpy.types.Depsgraph) -> float:
    # Convert the evaluated curve to a mesh and sum edge lengths.
    # This is stable and works regardless of spline type.
    eval_obj = curve_obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    try:
        length = 0.0
        verts = mesh.vertices
        for e in mesh.edges:
            v1 = verts[e.vertices[0]].co
            v2 = verts[e.vertices[1]].co
            length += (v2 - v1).length
        return float(length)
    finally:
        eval_obj.to_mesh_clear()


def _evaluated_curve_polyline(curve_obj: bpy.types.Object, depsgraph: bpy.types.Depsgraph) -> List[Tuple[float, float, float]]:
    # Similar approach: evaluated curve -> mesh -> follow edges as a polyline.
    # For typical curve exports this is already ordered; we still do a simple ordering pass.
    eval_obj = curve_obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    try:
        if len(mesh.vertices) == 0 or len(mesh.edges) == 0:
            return []

        # Build adjacency for a simple path walk.
        adj: Dict[int, List[int]] = {i: [] for i in range(len(mesh.vertices))}
        for e in mesh.edges:
            a, b = e.vertices
            adj[a].append(b)
            adj[b].append(a)

        # Find an endpoint (degree 1) to start; otherwise start at 0.
        start = 0
        for vid, nbs in adj.items():
            if len(nbs) == 1:
                start = vid
                break

        visited = set()
        order = [start]
        visited.add(start)
        cur = start
        prev = None

        # Walk until we can't.
        while True:
            candidates = [n for n in adj[cur] if n != prev]
            if not candidates:
                break
            nxt = candidates[0]
            if nxt in visited:
                break
            order.append(nxt)
            visited.add(nxt)
            prev, cur = cur, nxt

        pts = []
        mw = curve_obj.matrix_world
        for vid in order:
            co = mw @ mesh.vertices[vid].co
            pts.append((float(co.x), float(co.y), float(co.z)))
        return pts
    finally:
        eval_obj.to_mesh_clear()


def _polyline_sample_at_spacing(poly: List[Tuple[float, float, float]], spacing: float) -> List[Tuple[float, float, float, float]]:
    """
    Return list of samples: (distance_along, x, y, z)
    """
    if spacing <= 0:
        raise ValueError("spacing must be > 0")
    if len(poly) < 2:
        return []

    def dist(a, b) -> float:
        return math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2)

    samples: List[Tuple[float, float, float, float]] = []
    d_total = 0.0
    next_target = 0.0

    a = poly[0]
    samples.append((0.0, a[0], a[1], a[2]))

    for i in range(1, len(poly)):
        b = poly[i]
        seg_len = dist(a, b)
        if seg_len <= 1e-12:
            a = b
            continue

        while next_target <= d_total + seg_len:
            t = 0.0 if seg_len == 0 else (next_target - d_total) / seg_len
            x = a[0] + (b[0] - a[0]) * t
            y = a[1] + (b[1] - a[1]) * t
            z = a[2] + (b[2] - a[2]) * t
            if next_target != 0.0:  # 0 already added
                samples.append((float(next_target), float(x), float(y), float(z)))
            next_target += spacing

        d_total += seg_len
        a = b

    # Ensure last point is included (useful for "service loop end" and total length).
    last = poly[-1]
    if not samples or (abs(samples[-1][0] - d_total) > spacing * 0.25):
        samples.append((float(d_total), last[0], last[1], last[2]))

    return samples


def export_harness_draft(sample_spacing_scene_units: float = 0.25) -> Dict[str, Any]:
    """
    sample_spacing_scene_units:
      Spacing between samples along HR_* curves, in *scene units*.
      Example:
        - If your scene is meters and you want ~25mm samples, use 0.025.
        - If your scene is inches and you want 6-inch clip spacing, use 6.0.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()

    markers = _iter_marker_empties("HP_")
    routes = [o for o in bpy.data.objects if o.type == "CURVE" and o.name.startswith("HR_")]
    routes.sort(key=lambda o: o.name)

    points: List[HarnessPoint] = []
    route_summaries: List[HarnessRoute] = []

    for m in markers:
        x, y, z = _world_xyz(m)
        points.append(HarnessPoint(
            name=m.name,
            kind="marker",
            route=None,
            distance_along_route=None,
            x=x, y=y, z=z
        ))

    for r in routes:
        length = _evaluated_curve_length(r, depsgraph)
        poly = _evaluated_curve_polyline(r, depsgraph)
        samples = _polyline_sample_at_spacing(poly, sample_spacing_scene_units) if poly else []

        route_summaries.append(HarnessRoute(
            name=r.name,
            length=float(length),
            sample_spacing=float(sample_spacing_scene_units),
            samples=len(samples),
        ))

        for (d, x, y, z) in samples:
            points.append(HarnessPoint(
                name=f"{r.name}_SAMPLE_{d:.6f}",
                kind="curve_sample",
                route=r.name,
                distance_along_route=float(d),
                x=float(x), y=float(y), z=float(z)
            ))

    payload: Dict[str, Any] = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "scene": {
            "unit_system": _scene_unit_label(),
            "unit_scale": float(bpy.context.scene.unit_settings.scale_length),
            "frame": int(bpy.context.scene.frame_current),
        },
        "routes": [asdict(r) for r in route_summaries],
        "points": [asdict(p) for p in points],
    }
    return payload


def write_exports(payload: Dict[str, Any]) -> Tuple[str, str]:
    # '//' is relative to current blend directory
    base_dir = bpy.path.abspath("//")
    out_dir = os.path.join(base_dir, "exports")
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(out_dir, f"harness_draft_{ts}.csv")
    json_path = os.path.join(out_dir, f"harness_draft_{ts}.json")

    # JSON
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=False)

    # CSV (flat points)
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "kind", "route", "distance_along_route", "x", "y", "z"])
        for p in payload.get("points", []):
            w.writerow([
                p.get("name"),
                p.get("kind"),
                p.get("route"),
                p.get("distance_along_route"),
                p.get("x"),
                p.get("y"),
                p.get("z"),
            ])

    print("Wrote:", csv_path)
    print("Wrote:", json_path)
    return csv_path, json_path


def main():
    # Default spacing is intentionally small in scene units because we don't know your unit scale.
    # Change to what you want before running:
    #   inches scene: 6.0 (clips every 6 inches)
    #   meters scene: 0.1524 (6 inches in meters)
    payload = export_harness_draft(sample_spacing_scene_units=0.25)
    write_exports(payload)


if __name__ == "__main__":
    main()



