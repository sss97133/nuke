#!/usr/bin/env python3
"""Step 2 of the art-photos pipeline: which labelled photos are the holder's own work, and which are art they photographed or
saved. Scores from evidence the library already carries; nothing is parsed from pixels.

  + camera EXIF present (a photograph the holder took)          - no camera (a saved or forwarded image)
  + taken at one of the holder's places (--my-places regex)      - taken at a museum or gallery (--others-places regex)
  + in one of the holder's work albums (--my-albums)             - in a saved/reference album (--saved-albums), small image
  + labelled billboard or mural                                  - labelled as a document or printed page with no painting label

    python3 score_candidates.py candidates.json scored.json [--min-score 1] [--my-places 'Boulder City|Las Vegas|Henderson'] ...
Writes scored.json (every candidate with score, reasons, kind) and scope_uuids.txt (score >= min). The thresholds and regexes are the
analysis's declared assumptions; the holder's corrections on the resulting works are the ground truth that tunes them.
"""
import argparse, collections, json, re

KINDS = [("billboards", "billboard"), ("mural", "mural"), ("sculpture", "sculpture"), ("painting", "painting"), ("acrylic paint", "painting"),
         ("modern art", "painting"), ("drawing", "drawing"), ("sketch", "sketch")]


def kind_of(labels):
    for label, kind in KINDS:
        if label in labels:
            return kind
    return "artwork"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates"); ap.add_argument("out")
    ap.add_argument("--min-score", type=int, default=1)
    ap.add_argument("--my-places", default=r"\b(Boulder City|Las Vegas|Henderson)\b")
    ap.add_argument("--others-places", default=r"\b(Pompidou|Museum|Mus[ée]e|Gallery|Galerie|Louvre|Tate|MoMA|Kunsthalle|Kunstmuseum|Biennale|Art Basel)\b")
    ap.add_argument("--my-albums", default="Canvas,Signs")
    ap.add_argument("--saved-albums", default="Moodboard 2017,Meta AI,WhatsApp")
    a = ap.parse_args()
    my_places, others = re.compile(a.my_places, re.I), re.compile(a.others_places, re.I)
    my_albums, saved_albums = set(a.my_albums.split(",")), set(a.saved_albums.split(","))
    rows = json.load(open(a.candidates)); scored = []; reasons = collections.Counter()
    for r in rows:
        e = r.get("exif_info") or {}; cam = ((e.get("camera_make") or "") + " " + (e.get("camera_model") or "")).strip()
        pl = r.get("place") or {}; place = pl.get("name") if isinstance(pl, dict) else None
        albums = set(r.get("albums") or []); labels = {l.lower() for l in r.get("labels") or []}
        w, h = r.get("width") or 0, r.get("height") or 0
        score, why = 0, []
        if cam: score += 2; why.append("camera")
        else: score -= 2; why.append("no_camera")
        if max(w, h) < 1000: score -= 2; why.append("small")
        if place and my_places.search(place): score += 2; why.append("my_place")
        if place and others.search(place): score -= 3; why.append("others_place")
        if albums & my_albums: score += 3; why.append("my_album")
        if albums & saved_albums: score -= 3; why.append("saved_album")
        if "art gallery" in labels: score -= 1; why.append("gallery_label")
        if labels & {"billboards", "mural"}: score += 1; why.append("billboard_or_mural")
        if labels & {"document", "handwriting", "printed page"} and not labels & {"painting", "billboards", "mural"}: score -= 1; why.append("document_like")
        scored.append({"uuid": r["uuid"], "date": r.get("date"), "filename": r.get("original_filename") or r.get("filename"), "camera": cam or None,
                       "place": place, "albums": sorted(albums), "labels": sorted(labels), "kind": kind_of(labels), "width": w, "height": h,
                       "latitude": r.get("latitude"), "longitude": r.get("longitude"), "caption": r.get("ai_caption"), "score": score, "why": why})
        reasons[tuple(sorted(why))] += 1
    scope = [s for s in scored if s["score"] >= a.min_score]
    json.dump(scored, open(a.out, "w"), default=str)
    open(a.out.rsplit(".", 1)[0] + "_scope_uuids.txt", "w").write("\n".join(s["uuid"] for s in scope) + "\n")
    print(json.dumps({"candidates": len(rows), "in_scope": len(scope), "by_kind": dict(collections.Counter(s["kind"] for s in scope)),
                      "reasons_top": [[list(k), n] for k, n in reasons.most_common(8)]}, indent=1))


if __name__ == "__main__":
    main()
