import argparse
from pathlib import Path

from .commands.initdb import cmd_initdb
from .commands.ingest import cmd_ingest
from .commands.cluster import cmd_cluster
from .commands.seed import cmd_seed
from .commands.suggest import cmd_suggest
from .commands.review import cmd_review
from .commands.organize import cmd_organize


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="photo-cli",
        description="Vehicle photo organizer: ingest, cluster, suggest, review, organize",
    )
    parser.add_argument("root", type=Path, help="Workspace root for the photo DB and outputs")

    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("initdb", help="Create SQLite DB and tables")
    p_init.set_defaults(func=cmd_initdb)

    p_ing = sub.add_parser("ingest", help="Scan a folder and ingest photos")
    p_ing.add_argument("inbox", type=Path, help="Folder containing photos to ingest")
    p_ing.add_argument("--recursive", action="store_true", help="Recurse into subdirectories")
    p_ing.set_defaults(func=cmd_ingest)

    p_clu = sub.add_parser("cluster", help="Cluster sessions by time+GPS")
    p_clu.add_argument("--time-mins", type=float, default=45.0, help="Time window in minutes")
    p_clu.add_argument("--dist-m", type=float, default=150.0, help="Spatial window in meters")
    p_clu.set_defaults(func=cmd_cluster)

    p_seed = sub.add_parser("seed", help="Seed known vehicle with images")
    p_seed.add_argument("vehicle", type=str, help="Vehicle name, e.g., '1979 Chevrolet K10 SWB'")
    p_seed.add_argument("images", nargs="+", type=Path, help="Representative images for the vehicle")
    p_seed.set_defaults(func=cmd_seed)

    p_sug = sub.add_parser("suggest", help="Generate top-N vehicle suggestions per photo")
    p_sug.add_argument("--topn", type=int, default=3)
    p_sug.set_defaults(func=cmd_suggest)

    p_rev = sub.add_parser("review", help="Interactive review of suggestions")
    p_rev.add_argument("--limit", type=int, default=100)
    p_rev.set_defaults(func=cmd_review)

    p_org = sub.add_parser("organize", help="Move/copy photos into Vehicles/<slug>")
    p_org.add_argument("--copy", action="store_true", help="Copy instead of move")
    p_org.set_defaults(func=cmd_organize)

    args = parser.parse_args()

    # Ensure root exists
    args.root.mkdir(parents=True, exist_ok=True)

    # Dispatch
    return args.func(args)


if __name__ == "__main__":
    main()
