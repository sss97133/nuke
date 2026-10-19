#!/usr/bin/env python3
"""Bundle the existing attributed web wordmarks as native vector assets.

Requires the already installed rsvg-convert. No network or extra Python packages.
Run with --check to regenerate in memory and compare every byte.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
WEB = ROOT / "nuke_frontend/public/stacks/makes"
CATALOGUE = WEB / "wordmarks.json"
WEB_RENDERER = ROOT / "nuke_frontend/src/components/common/MakeIdentity.tsx"
ASSETS = APP / "Sources/Assets.xcassets/MakeWordmarks"
RESOURCES = APP / "Resources/MakeIdentity"


def digest(data):
    # The source catalogue uses base64 digest bytes; keep that same non-token representation.
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def web_aliases():
    source = WEB_RENDERER.read_text()
    block = re.search(r"const aliases: Record<string, string> = \{(.*?)\};", source, re.S)
    if not block:
        raise ValueError("Cannot read the existing web make aliases")
    entries = re.findall(r"(?:'([^']+)'|([a-z][a-z0-9-]*)):\s*'([^']+)'", block[1])
    return {quoted or bare: value for quoted, bare, value in entries}


def make_key(brand, aliases):
    key = "-".join(brand.strip().lower().split())
    return aliases.get(key, key)


def inspect_svg(row):
    path = WEB / row["file"]
    data = path.read_bytes()
    expected = base64.b64decode(row["localSha256Base64"])
    if hashlib.sha256(data).digest() != expected:
        raise ValueError(f"Source hash changed: {row['file']}")
    svg = ET.fromstring(data)
    paints = set()
    for element in svg.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag in {"image", "script", "foreignObject"}:
            raise ValueError(f"Non-vector content in {row['file']}: {tag}")
        for name, value in element.attrib.items():
            if name.rsplit("}", 1)[-1] == "href" and not value.startswith("#"):
                raise ValueError(f"External SVG reference in {row['file']}")
            if name in {"fill", "stroke"} and value not in {"none", "transparent"}:
                paints.add(value.lower())
        if "style" in element.attrib:
            raise ValueError(f"Review inline SVG style before conversion: {row['file']}")
    _, _, width, height = map(float, svg.attrib["viewBox"].split())
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid SVG viewport: {row['file']}")
    return data, sorted(paints), width / height


def verified_dark_ink(paints):
    if paints == ["black"]:
        return True
    if len(paints) != 1 or not re.fullmatch(r"#[0-9a-f]{6}", paints[0]):
        return False
    rgb = [int(paints[0][i:i + 2], 16) for i in (1, 3, 5)]
    return max(rgb) <= 64 and max(rgb) - min(rgb) <= 16


def generate(converter):
    aliases = web_aliases()
    rows = json.loads(CATALOGUE.read_bytes())
    grouped = {}
    for row in rows:
        if row["role"] not in {"wordmark", "lettered lockup"}:
            continue
        key = make_key(row["brand"], aliases)
        appearance = "dark" if row["file"].endswith("-dark.svg") else "light"
        variants = grouped.setdefault(key, {})
        if appearance in variants:
            raise ValueError(f"Ambiguous wordmark: {key}/{appearance}")
        variants[appearance] = row
    output = {ASSETS / "Contents.json": json_bytes({"info": {"author": "xcode", "version": 1}})}
    makes = []
    for key, variants in sorted(grouped.items()):
        light = variants.get("light")
        if not light:
            raise ValueError(f"Missing light wordmark: {key}")
        _, paints, aspect = inspect_svg(light)
        template = "dark" not in variants
        if template and not verified_dark_ink(paints):
            raise ValueError(f"Unpaired colored wordmark requires a sourced dark asset: {key}")
        asset = "MakeWordmark-" + key
        images, sources = [], []
        for appearance, row in sorted(variants.items()):
            _, palette, _ = inspect_svg(row)
            result = subprocess.run([converter, "--format", "pdf", str(WEB / row["file"])],
                env={**os.environ, "SOURCE_DATE_EPOCH": "0"}, check=True, capture_output=True)
            filename = appearance + ".pdf"
            output[ASSETS / (asset + ".imageset") / filename] = result.stdout
            image = {"filename": filename, "idiom": "universal"}
            if appearance == "dark":
                image["appearances"] = [{"appearance": "luminosity", "value": "dark"}]
            images.append(image)
            sources.append({**row, "appearance": appearance, "palette": palette,
                "pdfSha256Base64": digest(result.stdout)})
        output[ASSETS / (asset + ".imageset") / "Contents.json"] = json_bytes({
            "images": images, "info": {"author": "xcode", "version": 1},
            "properties": {"preserves-vector-representation": True,
                "template-rendering-intent": "template" if template else "original"}})
        makes.append({"key": key, "brand": light["brand"], "asset": asset,
            "aspectRatio": aspect, "rendering": "template" if template else "original", "sources": sources})
    version = subprocess.check_output([converter, "--version"], text=True).strip()
    output[RESOURCES / "make-wordmarks.json"] = json_bytes({"schemaVersion": 1,
        "sourceCatalogue": str(CATALOGUE.relative_to(ROOT)), "sourceCatalogueSha256Base64": digest(CATALOGUE.read_bytes()),
        "aliasSource": str(WEB_RENDERER.relative_to(ROOT)), "aliasSourceSha256Base64": digest(WEB_RENDERER.read_bytes()),
        "converter": version, "sourceDateEpoch": 0, "aliases": aliases, "makes": makes})
    output[RESOURCES / "CARDOG-LICENSE.txt"] = (WEB / "CARDOG-LICENSE.txt").read_bytes()
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    converter = shutil.which("rsvg-convert")
    if not converter:
        raise SystemExit("Use the installed rsvg-convert; no dependencies are downloaded")
    output = generate(converter)
    existing = {p for directory in (ASSETS, RESOURCES) if directory.exists() for p in directory.rglob("*") if p.is_file()}
    stale = existing - output.keys()
    if stale:
        raise SystemExit("Unexpected generated files; review before removal: " + ", ".join(map(str, sorted(stale))))
    if args.check:
        different = [str(p.relative_to(APP)) for p, data in output.items() if not p.exists() or p.read_bytes() != data]
        if different:
            raise SystemExit("Generated make assets differ: " + ", ".join(different))
    else:
        for path, data in output.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    pdfs = sum(p.suffix == ".pdf" for p in output)
    print(f"{'Verified' if args.check else 'Generated'} {pdfs} vector PDFs; {len(output)} source/resource files")


if __name__ == "__main__":
    main()
