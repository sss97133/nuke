#!/usr/bin/env python3
"""local_image_analysis.py: one definitive, signed, free local analysis row per library photo.

Why: the library was never read end to end by one reader, so sorting decisions keep resting on partial,
mixed-provider guesses. This pass reads every one of the owner's own photos with one pinned, open model on CPU
(no API credit, no subscription) and records, per photo, in image_observations (the existing image engine layer,
which already carries embedding_clip_vitb32 + its HNSW index):

  is it a vehicle (p_vehicle), view/angle, vehicle category, body and make cues, pixel quality, and a 512-d
  OpenCLIP ViT-B/32 embedding for comparing against each vehicle's verified gallery.

It is analysis only. It never writes vehicle_images, never files, never moves a photo, and makes no identity
claim (vehicle_id stays null on the observation). Sensitive/private rows are skipped before download.

Signing: observed_by = OBSERVER; confidence_basis[OBSERVER] = {agent, code_commit, analyzer_version,
prompt_version, embed_model, label_model, run_id, confidence, ...}. Revert a run with --revert RUN_ID (sets
is_active=false on that run's rows only; nothing is deleted).

Resumable: a cursor (last image id) and the run id live in --state-dir; restart with the same command.

  SUPABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/photo-pipeline/local_image_analysis.py \
      --state-dir /workspace/sortrun/analysis [--batch 100] [--label-model l14] [--hours 12] [--dry-run]
  ... local_image_analysis.py --revert <run_id>
"""
import argparse, datetime, http.client, io, json, os, socket, subprocess, sys, time, uuid, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local_image_analysis_model as M

OBSERVER = "local_image_analysis_v1"
AGENT = os.environ.get("NUKE_AGENT", "injestion (grok-bot ingestion agent)")
AST = ZoneInfo("America/St_Barthelemy")
RETRYABLE_HTTP = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}
URL = (os.environ.get("SUPABASE_URL") or "https://qkgaybvrernstplzjaam.supabase.co").rstrip("/")


def key():
    k = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not k:
        sys.exit("SUPABASE_SECRET_KEY not set")
    return k


def H(extra=None):
    k = key()
    h = {"apikey": k, "Authorization": f"Bearer {k}"}
    h.update(extra or {})
    return h


def is_retryable(e):
    if isinstance(e, urllib.error.HTTPError):
        return e.code in RETRYABLE_HTTP
    return isinstance(e, (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, http.client.HTTPException, OSError))


def with_retry(fn, attempts=8, base=3.0, cap=300.0, log=None):
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if not is_retryable(e) or i == attempts - 1:
                raise
            w = min(cap, base * 2 ** i)
            if log:
                log(f"retry {i + 1} in {w:.0f}s: {str(e)[:160]}")
            time.sleep(w)


def http(method, path, body=None, headers=None, timeout=90, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{URL}{path}", data=data, method=method,
                                 headers=H({"Content-Type": "application/json", **(headers or {})}))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
        return b if raw else (json.loads(b) if b else None)


def object_path(row):
    """Authenticated object path for a vehicle_images row, or None when the bytes are not in our storage."""
    u = row.get("image_url") or ""
    for marker in ("/storage/v1/object/public/", "/storage/v1/object/sign/", "/storage/v1/object/authenticated/"):
        if marker in u and u.startswith(URL):
            return "/storage/v1/object/" + urllib.parse.quote(urllib.parse.unquote(u.split(marker, 1)[1].split("?", 1)[0]))
    sp = row.get("storage_path") or ""
    if sp and not sp.startswith("/") and "://" not in sp:
        return "/storage/v1/object/vehicle-photos/" + urllib.parse.quote(sp.lstrip("/"))
    return None


def decode(raw):
    im, w, h = M.load_image(raw)
    q = M.pixel_quality(im)
    im.thumbnail((448, 448))
    return im.tobytes(), im.size, w, h, q


def git_commit():
    try:
        d = os.path.dirname(os.path.abspath(__file__))
        c = subprocess.check_output(["git", "-C", d, "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.call(["git", "-C", d, "diff", "--quiet", "HEAD", "--", "scripts/photo-pipeline"], cwd=d) != 0
        return c + ("-dirty" if dirty else "")
    except Exception:  # noqa: BLE001
        return "unknown"


class Run:
    def __init__(self, a):
        self.a = a
        os.makedirs(a.state_dir, exist_ok=True)
        self.state_p = os.path.join(a.state_dir, "state.json")
        self.st = json.load(open(self.state_p)) if os.path.exists(self.state_p) else {}
        if not self.st.get("run_id"):
            self.st = {"run_id": str(uuid.uuid4()), "cursor": "00000000-0000-0000-0000-000000000000", "done": 0,
                       "skipped": {}, "started_at": datetime.datetime.now(AST).isoformat()}
            self.save()
        self.commit = git_commit()
        self.log_p = a.progress_log
        self.res_p = os.path.join(a.state_dir, f"results_{self.st['run_id']}.jsonl")

    def save(self):
        tmp = self.state_p + ".tmp"
        json.dump(self.st, open(tmp, "w"))
        os.replace(tmp, self.state_p)

    def log(self, msg):
        line = f"{datetime.datetime.now(AST).strftime('%Y-%m-%d %H:%M:%S')} AST  {msg}"
        print(line, flush=True)
        with open(self.log_p, "a") as f:
            f.write(line + "\n")


def manifest_rows(a, pos, limit):
    ids = a.manifest[pos:pos + limit]
    if not ids:
        return []
    rows = http("GET", "/rest/v1/vehicle_images?id=in.(" + ",".join(ids) + ")&select=" + ",".join(a.select_cols))
    order = {i: k for k, i in enumerate(ids)}
    return sorted(rows or [], key=lambda r: order[r["id"]])


def target_query(a, cursor, limit):
    q = [f"user_id=eq.{a.owner}", f"id=gt.{cursor}", "order=id.asc", f"limit={limit}",
         "select=" + ",".join(a.select_cols)]
    q += a.filters
    return "/rest/v1/vehicle_images?" + "&".join(q)


def skip_reason(a, r):
    if r.get("is_sensitive"):
        return "sensitive"
    for col in a.private_flags:
        if r.get(col):
            return col
    if a.hold_ids and r["id"] in a.hold_ids:
        return "privacy_hold"
    if not object_path(r):
        return "not_in_storage"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", default=os.environ.get("NUKE_OWNER_ID", "0b9f107a-d124-49de-9ded-94698f63c1c4"))
    ap.add_argument("--state-dir", default="/workspace/sortrun/analysis")
    ap.add_argument("--progress-log", default="/workspace/sortrun/analysis_progress.log")
    ap.add_argument("--batch", type=int, default=100)
    ap.add_argument("--label-model", default="l14", choices=list(M.LABEL_MODELS))
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--limit", type=int, default=0, help="stop after N analysed photos (0 = all)")
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true", help="read and log locally; write nothing to the database")
    ap.add_argument("--total", type=int, default=0, help="denominator for progress lines (count of eligible photos)")
    ap.add_argument("--hold-ids", default="", help="file of image ids on privacy hold (never downloaded)")
    ap.add_argument("--filter", action="append", default=[], help="extra PostgREST filter on vehicle_images, e.g. source=neq.bat")
    ap.add_argument("--private-flag", action="append", default=[], help="boolean vehicle_images column that marks a photo private")
    ap.add_argument("--manifest", help="file of image ids (one per line) this pass owns; progress cursor is a line index")
    ap.add_argument("--revert", metavar="RUN_ID")
    ap.add_argument("--observer", default=OBSERVER, help="observed_by of the run to revert (codex runs: " + "codex_image_analysis_v1)")
    a = ap.parse_args()

    if a.revert:
        rid = str(uuid.UUID(a.revert))
        ob = a.observer
        path = (f"/rest/v1/image_observations?observed_by=eq.{ob}&is_active=is.true"
                f"&confidence_basis->{ob}->>run_id=eq.{rid}")
        res = with_retry(lambda: http("PATCH", path, {"is_active": False}, {"Prefer": "return=representation,count=exact"}))
        print(json.dumps({"reverted_run": rid, "rows_deactivated": len(res or [])}))
        return

    a.filters = a.filter
    a.private_flags = a.private_flag
    a.select_cols = ["id", "vehicle_id", "image_url", "storage_path", "is_sensitive"] + a.private_flag
    a.hold_ids = set(l.strip() for l in open(a.hold_ids)) if a.hold_ids else set()
    a.manifest = [l.strip() for l in open(a.manifest) if l.strip()] if a.manifest else None
    if a.manifest and not a.total:
        a.total = len(a.manifest)
    run = Run(a)
    rid = run.st["run_id"]
    run.log(f"start run={rid} commit={run.commit} label_model={a.label_model} batch={a.batch} dry_run={a.dry_run}")
    R = M.Reader(threads=8, label_model=a.label_model)
    signature = {"agent": AGENT, "code_commit": run.commit, "analyzer_version": M.ANALYZER_VERSION,
                 "prompt_version": M.PROMPT_VERSION, "embed_model": f"{M.MODEL_NAME}:{M.MODEL_PRETRAINED}",
                 "label_model": R.label_name, "run_id": rid, "runtime": "box cpu, open weights, no API"}
    t_end = time.time() + a.hours * 3600
    dl = ThreadPoolExecutor(a.threads)
    dec = ProcessPoolExecutor(max(1, a.threads - 2))
    t0, n0 = time.time(), run.st["done"]
    from PIL import Image
    while time.time() < t_end:
        if a.limit and run.st["done"] - n0 >= a.limit:
            break
        tb = time.time()
        if a.manifest is not None:
            pos = int(run.st.get("pos", 0))
            rows = with_retry(lambda: manifest_rows(a, pos, a.batch), log=run.log)
            if not rows and pos < len(a.manifest):
                run.st["pos"] = pos + a.batch; run.save(); continue
        else:
            rows = with_retry(lambda: http("GET", target_query(a, run.st["cursor"], a.batch)), log=run.log)
        if not rows:
            run.log(f"no more targets after cursor {run.st['cursor']}; done={run.st['done']}")
            break
        todo, skipped = [], {}
        for r in rows:
            why = skip_reason(a, r)
            if why:
                skipped[why] = skipped.get(why, 0) + 1
            else:
                todo.append(r)
        # idempotent: never write a second active row for the same analyzer version
        if todo and not a.dry_run:
            ids = ",".join(r["id"] for r in todo)
            have = with_retry(lambda: http("GET", f"/rest/v1/image_observations?observed_by=eq.{OBSERVER}&is_active=is.true"
                                                 f"&image_id=in.({ids})&select=image_id,confidence_basis->{OBSERVER}->>analyzer_version"),
                              log=run.log)
            seen = {h["image_id"] for h in have or [] if h.get("analyzer_version") == M.ANALYZER_VERSION}
            if seen:
                skipped["already_analysed"] = len(seen)
                todo = [r for r in todo if r["id"] not in seen]

        def fetch(r):
            try:
                return r, with_retry(lambda: http("GET", object_path(r), raw=True, timeout=120), attempts=5, log=run.log), None
            except Exception as e:  # noqa: BLE001
                return r, None, f"download:{getattr(e, 'code', type(e).__name__)}"
        got = list(dl.map(fetch, todo))
        ok_rows, raws = [], []
        for r, raw, err in got:
            if err:
                skipped[err] = skipped.get(err, 0) + 1
            else:
                ok_rows.append(r); raws.append(raw)
        decoded = []
        for r, fut in zip(ok_rows, [dec.submit(decode, b) for b in raws]):
            try:
                decoded.append((r, fut.result(timeout=300)))
            except Exception as e:  # noqa: BLE001
                skipped["decode_error"] = skipped.get("decode_error", 0) + 1
        readings = []
        for i in range(0, len(decoded), 25):
            chunk = decoded[i:i + 25]
            readings += R.read([Image.frombytes("RGB", d[1], d[0]) for _, d in chunk])
        out = []
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        for (r, (_, _, w, h, q)), rd in zip(decoded, readings):
            emb = rd.pop("embedding")
            rd["quality"] = M.quality_grade(q, rd.pop("p_blurry_clip"), w, h)
            rd["source"] = {"width": w, "height": h, "object": object_path(r), "vehicle_id_at_read": r.get("vehicle_id")}
            conf = round(rd["view_confidence"] * (rd["p_vehicle"] if rd["is_vehicle"] else 1 - rd["p_vehicle"]), 4)
            basis = {OBSERVER: {**signature, "confidence": conf, "analysed_at": now, "reading": rd}}
            out.append({"image_id": r["id"], "vehicle_id": None, "observed_by": OBSERVER, "confidence": conf,
                        "role": "document" if rd["view"] == "document" else "incidental",
                        "layer_version": {"analyzer": M.ANALYZER_VERSION, "prompts": M.PROMPT_VERSION, "run_id": rid},
                        "agent_version": f"{M.ANALYZER_VERSION}@{run.commit[:12]}",
                        "confidence_basis": basis, "embedding_clip_vitb32": "[" + ",".join(f"{v:.6f}" for v in emb) + "]",
                        "is_active": True})
        if out and not a.dry_run:
            with_retry(lambda: http("POST", "/rest/v1/image_observations", out, {"Prefer": "return=minimal"}), log=run.log)
        with open(run.res_p, "a") as f:
            for o in out:
                rd = o["confidence_basis"][OBSERVER]["reading"]
                f.write(json.dumps({"image_id": o["image_id"], "is_vehicle": rd["is_vehicle"], "p_vehicle": rd["p_vehicle"],
                                    "view": rd["view"], "view_confidence": rd["view_confidence"], "category": rd["category"],
                                    "make_cues": rd["make_cues"][:1], "quality": rd["quality"]["grade"], "written": not a.dry_run}) + "\n")
        run.st["cursor"] = rows[-1]["id"]
        if a.manifest is not None:
            run.st["pos"] = int(run.st.get("pos", 0)) + a.batch
        run.st["done"] += len(out)
        for k, v in skipped.items():
            run.st["skipped"][k] = run.st["skipped"].get(k, 0) + v
        run.save()
        el = time.time() - t0
        rate = (run.st["done"] - n0) / el if el else 0
        tot = f"/{a.total}" if a.total else ""
        eta = ""
        if a.total and rate:
            rem = max(0, a.total - run.st["done"] - sum(run.st["skipped"].values()))
            eta = f" eta={rem / rate / 3600:.1f}h"
        run.log(f"batch rows={len(rows)} analysed={len(out)} skipped={skipped} batch_s={time.time() - tb:.0f} "
                f"done={run.st['done']}{tot} rate={rate:.2f}/s{eta}")
    run.log(f"stop run={rid} done={run.st['done']} skipped={run.st['skipped']}")


if __name__ == "__main__":
    main()
