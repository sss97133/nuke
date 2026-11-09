#!/usr/bin/env python3
"""Calibrate local_image_analysis_model against held-out hand checks (never used to fit anything).

  python3 local_image_analysis_calibrate.py --items items.json --labels hand_labels.py [--out report.json]
items.json: [[image_id, local_path], ...] in label-index order. labels: a python file defining L = {index: {'views': [...], 'is_vehicle': bool|None}}.
Reports is-vehicle precision/recall and view accuracy (fine = any acceptable view; coarse = exterior/interior/engine/
undercarriage/detail/non-vehicle).
"""
import argparse, json, sys, os, runpy, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local_image_analysis_model as M

COARSE = {"exterior_front": "exterior", "exterior_rear": "exterior", "exterior_side": "exterior"}
def coarse(v):
    return COARSE.get(v, v if v in M.VEHICLE_VIEWS else "non_vehicle")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--items"); ap.add_argument("--labels"); ap.add_argument("--out"); ap.add_argument("--label-model", default="b32"); ap.add_argument("--split", default="all", choices=["all","dev","test"])
    a = ap.parse_args()
    items = json.load(open(a.items)); L = runpy.run_path(a.labels)["L"]
    R = M.Reader(threads=8, label_model=a.label_model); rows = []
    for i in range(0, len(items), 25):
        ims = [M.load_image(open(p, "rb").read())[0] for _, p in items[i:i + 25]]
        rows += R.read(ims)
    tp = fp = fn = tn = 0; fine = coarse_ok = n = 0; conf = collections.Counter(); miss = []
    for k, r in enumerate(rows):
        lab = L.get(k)
        if not lab: continue
        if (a.split == "dev" and k % 2) or (a.split == "test" and k % 2 == 0): continue
        if lab["is_vehicle"] is not None:
            p, t = r["is_vehicle"], lab["is_vehicle"]
            tp += p and t; fp += p and not t; fn += (not p) and t; tn += (not p) and not t
        n += 1
        ok = r["view"] in lab["views"]; fine += ok
        cok = coarse(r["view"]) in {coarse(v) for v in lab["views"]}; coarse_ok += cok
        if not cok: conf[(lab["views"][0], r["view"])] += 1; miss.append((k, lab["views"], r["view"], r["view_confidence"]))
    rep = {"analyzer": M.ANALYZER_VERSION, "prompts": M.PROMPT_VERSION, "model": R.label_name, "split": a.split, "n": n,
           "is_vehicle": {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
                          "precision": round(tp / max(1, tp + fp), 4), "recall": round(tp / max(1, tp + fn), 4),
                          "non_vehicle_precision": round(tn / max(1, tn + fn), 4), "non_vehicle_recall": round(tn / max(1, tn + fp), 4)},
           "view_fine_acc": round(fine / n, 4), "view_coarse_acc": round(coarse_ok / n, 4),
           "coarse_confusions": {f"{a}->{b}": c for (a, b), c in conf.most_common()}, "misses": miss}
    print(json.dumps({k: v for k, v in rep.items() if k != "misses"}, indent=1))
    if a.out: json.dump(rep, open(a.out, "w"), indent=1)

if __name__ == "__main__":
    main()
