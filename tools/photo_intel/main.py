"""
Photo Intel — Local Vehicle Story Reconstruction Tool

CLI entry + FastAPI server + SSE orchestration.

Usage:
    # Full pipeline with browser UI
    dotenvx run -- /Users/skylar/nuke/yono/.venv/bin/python -m tools.photo_intel.main --serve

    # CLI only
    dotenvx run -- /Users/skylar/nuke/yono/.venv/bin/python -m tools.photo_intel.main

    # Individual phases
    dotenvx run -- /Users/skylar/nuke/yono/.venv/bin/python -m tools.photo_intel.main --phase harvest
    dotenvx run -- /Users/skylar/nuke/yono/.venv/bin/python -m tools.photo_intel.main --phase classify

    # Options
    --dry-run          # analyze only, no upload
    --album "1977..."  # single album
    --skip-classify    # skip YONO (fast metadata preview)
    --fresh            # ignore SQLite cache
    --serve            # start FastAPI server with browser UI
    --port 8473        # custom UI port
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

# Ensure project root is on path for imports
PROJECT_ROOT = Path(__file__).parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def run_pipeline(args):
    """Run the full pipeline or a single phase."""
    from tools.photo_intel.harvest import harvest
    from tools.photo_intel.filter import filter_photos
    from tools.photo_intel.sessions import detect_sessions
    from tools.photo_intel.profiles import build_profiles
    from tools.photo_intel.classify import classify_photos
    from tools.photo_intel.stories import assemble_stories
    from tools.photo_intel.upload import upload_all
    from tools.photo_intel.db import get_db, reset_phase

    phase = args.phase
    t0 = time.time()

    if args.fresh:
        db = get_db()
        for p in ["filter", "sessions", "profiles", "classify", "upload"]:
            if not phase or phase == p:
                reset_phase(db, p)
        if not phase:
            db.execute("DELETE FROM photos")
            db.commit()
        db.close()
        print("Cache cleared.")

    # Phase 0: Harvest
    if not phase or phase == "harvest":
        print("\n== PHASE 0: HARVEST ==")
        harvest(library_path=args.library, fresh=args.fresh)

    # Phase 1: Filter
    if not phase or phase == "filter":
        print("\n== PHASE 1: FILTER ==")
        filter_photos()

    # Phase 2: Sessions
    if not phase or phase == "sessions":
        print("\n== PHASE 2: SESSIONS ==")
        detect_sessions()

    # Phase 3: Profiles
    if not phase or phase == "profiles":
        print("\n== PHASE 3: PROFILES ==")
        build_profiles()

    # Phase 4: Classify
    if not phase or phase == "classify":
        if not args.skip_classify:
            print("\n== PHASE 4: CLASSIFY ==")
            classify_photos()
        else:
            print("\n== PHASE 4: CLASSIFY (skipped) ==")

    # Phase 7: Stories
    if not phase or phase == "stories":
        print("\n== PHASE 7: STORIES ==")
        assemble_stories()

    # Phase 8: Upload
    if not phase or phase == "upload":
        if not args.dry_run:
            print("\n== PHASE 8: UPLOAD ==")
            upload_all(dry_run=args.dry_run)
        else:
            print("\n== PHASE 8: UPLOAD (dry run) ==")
            upload_all(dry_run=True)

    # Summary
    duration = time.time() - t0
    print(f"\n{'='*50}")
    print(f"Pipeline complete in {duration:.1f}s")

    # Print summary stats
    db = get_db()
    from tools.photo_intel.db import count
    print(f"  Photos:       {count(db, 'photos')}")
    print(f"  Vehicles:     {count(db, 'photos', 'is_vehicle=1')}")
    print(f"  Sessions:     {count(db, 'sessions')}")
    print(f"  Profiles:     {count(db, 'vehicle_profiles')}")
    print(f"  Classified:   {count(db, 'classifications')}")
    print(f"  Uploaded:     {count(db, 'photos', 'uploaded=1')}")
    db.close()


def run_server(args):
    """Start FastAPI server with SSE and browser UI."""
    import uvicorn
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

    app = FastAPI(title="Photo Intel")
    ui_path = Path(__file__).parent / "ui.html"

    # Pipeline state for SSE
    state = {
        "phase": "idle",
        "progress": 0,
        "total": 0,
        "message": "",
        "running": False,
    }
    subscribers = []

    def broadcast(event_type: str, data: dict):
        state.update(data)
        msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        dead = []
        for q in subscribers:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            subscribers.remove(q)

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return ui_path.read_text()

    @app.get("/events")
    async def events():
        q = asyncio.Queue()
        subscribers.append(q)

        async def stream():
            try:
                # Send current state immediately
                yield f"event: state\ndata: {json.dumps(state)}\n\n"
                while True:
                    msg = await q.get()
                    yield msg
            except asyncio.CancelledError:
                subscribers.remove(q) if q in subscribers else None

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/api/stories")
    async def get_stories():
        from tools.photo_intel.db import get_db
        db = get_db()
        profiles = db.execute("SELECT * FROM vehicle_profiles ORDER BY year, make, model").fetchall()
        result = []
        for p in profiles:
            result.append({
                "id": p["id"],
                "album": p["album_name"],
                "year": p["year"],
                "make": p["make"],
                "model": p["model"],
                "supabase_vehicle_id": p["supabase_vehicle_id"],
                "photo_count": p["photo_count"],
                "session_count": p["session_count"],
                "first_photo": p["first_photo"],
                "last_photo": p["last_photo"],
                "yono_consensus": json.loads(p["yono_consensus"]) if p["yono_consensus"] else None,
                "story": json.loads(p["story"]) if p["story"] else None,
            })
        db.close()
        return result

    @app.get("/api/stats")
    async def get_stats():
        from tools.photo_intel.db import get_db, count
        db = get_db()
        stats = {
            "photos": count(db, "photos"),
            "vehicles": count(db, "photos", "is_vehicle=1"),
            "sessions": count(db, "sessions"),
            "profiles": count(db, "vehicle_profiles"),
            "classified": count(db, "classifications"),
            "uploaded": count(db, "photos", "uploaded=1"),
        }
        db.close()
        return stats

    @app.post("/api/run")
    async def run_all(request: Request):
        if state["running"]:
            return JSONResponse({"error": "Pipeline already running"}, status_code=409)

        body = await request.json() if request.headers.get("content-type") == "application/json" else {}
        skip_classify = body.get("skip_classify", False)
        dry_run = body.get("dry_run", False)

        async def pipeline():
            state["running"] = True
            try:
                from tools.photo_intel.harvest import harvest
                from tools.photo_intel.filter import filter_photos
                from tools.photo_intel.sessions import detect_sessions
                from tools.photo_intel.profiles import build_profiles
                from tools.photo_intel.classify import classify_photos
                from tools.photo_intel.stories import assemble_stories
                from tools.photo_intel.upload import upload_all

                broadcast("phase", {"phase": "harvest", "progress": 0, "total": 0, "message": "Harvesting photos..."})
                await asyncio.to_thread(harvest,
                    on_progress=lambda c, t: broadcast("progress", {"progress": c, "total": t}))

                broadcast("phase", {"phase": "filter", "progress": 0, "total": 0, "message": "Filtering vehicles..."})
                await asyncio.to_thread(filter_photos,
                    on_progress=lambda c, t, p=0: broadcast("progress", {"progress": c, "total": t, "passed": p}))

                broadcast("phase", {"phase": "sessions", "progress": 0, "total": 0, "message": "Detecting sessions..."})
                await asyncio.to_thread(detect_sessions,
                    on_progress=lambda c, t: broadcast("progress", {"progress": c, "total": t}))

                broadcast("phase", {"phase": "profiles", "progress": 0, "total": 0, "message": "Building profiles..."})
                await asyncio.to_thread(build_profiles,
                    on_progress=lambda c, t: broadcast("progress", {"progress": c, "total": t}))

                if not skip_classify:
                    broadcast("phase", {"phase": "classify", "progress": 0, "total": 0, "message": "Classifying with YONO..."})
                    await asyncio.to_thread(classify_photos,
                        on_progress=lambda c, t: broadcast("progress", {"progress": c, "total": t}))

                broadcast("phase", {"phase": "stories", "progress": 0, "total": 0, "message": "Assembling stories..."})
                await asyncio.to_thread(assemble_stories,
                    on_progress=lambda c, t: broadcast("progress", {"progress": c, "total": t}))

                broadcast("phase", {"phase": "complete", "progress": 100, "total": 100, "message": "Pipeline complete"})
            except Exception as e:
                broadcast("error", {"phase": "error", "message": str(e)})
            finally:
                state["running"] = False

        asyncio.create_task(pipeline())
        return {"status": "started"}

    @app.post("/api/upload/{profile_id}")
    async def upload_profile_endpoint(profile_id: str, request: Request):
        body = await request.json() if request.headers.get("content-type") == "application/json" else {}
        dry_run = body.get("dry_run", False)
        from tools.photo_intel.upload import upload_profile

        result = await asyncio.to_thread(upload_profile, profile_id, dry_run=dry_run,
            on_progress=lambda c, t, u=0, e=0: broadcast("upload", {"progress": c, "total": t, "uploaded": u, "errors": e}))
        return result

    port = args.port or 8473
    print(f"\nPhoto Intel server starting on http://localhost:{port}")
    print(f"Open browser to view pipeline UI\n")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def main():
    parser = argparse.ArgumentParser(description="Photo Intel — Local Vehicle Story Reconstruction")
    parser.add_argument("--serve", action="store_true", help="Start FastAPI server with browser UI")
    parser.add_argument("--port", type=int, default=8473, help="Server port (default: 8473)")
    parser.add_argument("--phase", choices=["harvest", "filter", "sessions", "profiles", "classify", "stories", "upload"],
                        help="Run a single phase")
    parser.add_argument("--dry-run", action="store_true", help="Analyze only, no upload")
    parser.add_argument("--skip-classify", action="store_true", help="Skip YONO classification")
    parser.add_argument("--fresh", action="store_true", help="Ignore SQLite cache, re-run everything")
    parser.add_argument("--library", help="Override Photos library path")
    parser.add_argument("--album", help="Process single album only")

    args = parser.parse_args()

    if args.serve:
        run_server(args)
    else:
        run_pipeline(args)


if __name__ == "__main__":
    main()
