#!/usr/bin/env python3
"""
Search the extracted library text by keyword. Returns matching pages with
cited excerpts. Pure filesystem grep — no DB needed.

Usage:
  scripts/library_search.py "grommet"
  scripts/library_search.py "harness routing" --year 1977
  scripts/library_search.py "M22759" --context 3
  scripts/library_search.py "firewall" --topic K5_Blazer --limit 10
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO / "docs/library/_extracted"
MANIFEST_PATH = OUT_ROOT / "manifest.json"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("query", help="Search term (regex). Use -F for fixed string.")
    p.add_argument("--year", type=int, help="Only documents published this year")
    p.add_argument("--topic", help="Only documents tagged with this topic")
    p.add_argument("--category", help="Only documents in this category (service_manuals, k5_factory_docs, etc.)")
    p.add_argument("--limit", type=int, default=25, help="Max page hits to return")
    p.add_argument("--context", "-C", type=int, default=2, help="Lines of context around each match")
    p.add_argument("--fixed-string", "-F", action="store_true", help="Treat query as literal string")
    p.add_argument("--json", action="store_true", help="Emit JSON")
    args = p.parse_args()

    if not MANIFEST_PATH.exists():
        sys.exit(f"ERROR: manifest not found at {MANIFEST_PATH}. Run library_index.py first.")
    manifest = json.loads(MANIFEST_PATH.read_text())

    # Filter documents
    docs = list(manifest.values())
    if args.year:
        docs = [d for d in docs if d.get("year") == args.year]
    if args.topic:
        docs = [d for d in docs if args.topic in d.get("topics", [])]
    if args.category:
        docs = [d for d in docs if d.get("category") == args.category]

    if not docs:
        sys.exit("No documents match filters.")

    print(f"Searching {len(docs)} documents for {args.query!r} (limit {args.limit})...", file=sys.stderr)

    # Use ripgrep for speed; fallback to grep
    have_rg = subprocess.run(["which", "rg"], capture_output=True).returncode == 0
    if have_rg:
        cmd = ["rg", "--with-filename", "--line-number", "-C", str(args.context)]
        if args.fixed_string:
            cmd.append("-F")
        cmd += ["-i", args.query]
    else:
        cmd = ["grep", "-rni", "-C", str(args.context)]
        if args.fixed_string:
            cmd.insert(2, "-F")
        cmd.append(args.query)

    # Search each document's directory
    hits = []
    for d in docs:
        slug = d["slug"]
        doc_dir = OUT_ROOT / slug
        if not doc_dir.exists():
            continue
        r = subprocess.run(cmd + [str(doc_dir)], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            hits.append((d, r.stdout))

    # Format results
    if args.json:
        out = []
        for d, text in hits:
            out.append({"document": d, "matches": text})
        print(json.dumps(out, indent=2))
        return

    n_hits = 0
    for d, text in hits:
        # parse rg output: path:line:content OR with -C: path-line-content / path:line:content
        # Group hits by page file
        page_groups = {}
        for line in text.splitlines():
            if not line.strip() or line == "--":
                continue
            # rg output: path:line_no:content (match) or path-line_no-content (context)
            m = re.match(r"^(.+/page-(\d+)\.txt)[-:](\d+)[-:](.*)$", line)
            if not m:
                continue
            page_path, page_num, line_num, content = m.groups()
            key = (page_path, int(page_num))
            page_groups.setdefault(key, []).append((int(line_num), content))

        for (page_path, page_num), lines in sorted(page_groups.items(), key=lambda x: x[0][1]):
            if n_hits >= args.limit:
                print(f"\n--- truncated at {args.limit} hits ---", file=sys.stderr)
                return
            n_hits += 1
            print(f"\n=== {d['slug']} (year={d.get('year','?')}) p.{page_num}")
            print(f"   citation: {d['file_path']} p.{page_num}")
            if d.get("topics"):
                print(f"   topics: {', '.join(d['topics'])}")
            for ln, content in lines:
                print(f"   L{ln:4d}  {content}")

    if n_hits == 0:
        print(f"\nNo matches for {args.query!r}.", file=sys.stderr)
    else:
        print(f"\n{n_hits} hits across {len({k[0] for d,t in hits for k in [(d['slug'],)]})} documents.", file=sys.stderr)


if __name__ == "__main__":
    main()
