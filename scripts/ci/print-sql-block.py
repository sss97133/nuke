#!/usr/bin/env python3
"""Print one named migration DO block as base64 for client-side SQL contracts."""
import base64
import re
import sys
from pathlib import Path

path, tag = sys.argv[1:]
if not re.fullmatch(r"[a-z_][a-z0-9_]*", tag):
    raise SystemExit("invalid SQL block tag")
text = Path(path).read_text()
pattern = rf"^DO \${re.escape(tag)}\$\n.*?^END \${re.escape(tag)}\$;"
blocks = re.findall(pattern, text, flags=re.M | re.S)
if len(blocks) != 1:
    raise SystemExit("expected exactly one named SQL block")
print(base64.b64encode(blocks[0].encode()).decode())
