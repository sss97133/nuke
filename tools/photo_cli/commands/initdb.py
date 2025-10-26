from __future__ import annotations

from pathlib import Path
from ..db import init_db


def cmd_initdb(args) -> None:
    root: Path = args.root
    init_db(root)
    print(f"Initialized DB at {root}/photo_cli.sqlite3")
