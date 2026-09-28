#!/usr/bin/env python3
"""Keep a copy of every web source the K5 master list cites, so audit_citations.py can check it.

Pages are fetched through Firecrawl (never straight from this machine's IP -- ProWire's firewall banned it once,
2026-09-25) one at a time: 15 s between ProWire pages, 8 s elsewhere. Stops at the first 403/429 from a host.
Each page is saved as markdown with a header (url, fetched time, status) to reference_documents/web_snapshots/,
which is gitignored: third-party text never goes into the public repo.

Usage: dotenvx run -- python3 fetch_sources.py [--only substring] [--force]
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[3]
SNAP = REPO / "reference_documents/web_snapshots"

URLS = [
    # contacts, crimp and insertion tooling (the 61-pin and the M130/PDM Superseal plugs)
    "https://www.prowireusa.com/SSC-N",
    "https://www.prowireusa.com/p-1384-k1s-postioner.html",
    "https://www.prowireusa.com/M22520-2-01-afm8-crimp-frame",
    "https://www.digikey.com/en/products/detail/amphenol-aerospace-operations/M39029-56-351/2172799",
    "https://www.digikey.com/en/products/detail/amphenol-aerospace-operations/M39029-58-363/2172809",
    "https://dmctools.com/m39029/contact/196",
    "https://www.dmctools.com/m39029/connector-series/10",
    "https://dmctools.com/k43",
    "https://www.edmo.com/product/M819691410/insert-extraction-tool-red-and-orange-plastic-m819691410",
    "https://www.edmo.com/product/M819691411/insert-extraction-tool-20-gauge-red-and-white-plastic-tips-m819691411",
    # wire and seal fit
    "https://www.prowireusa.com/m22759-32-tefzel-wire.html",
    "https://www.prowireusa.com/m22759-16-tefzel-wire.html",
    "https://www.waytekwire.com/product/aptiv-15366021-gt-150-series-1-way-cable-seal",
    "https://www.waytekwire.com/product/aptiv-12191818-gt-150-series-22-20-ga",
    "https://www.prowireusa.com/p-2061-delphi-15324976-cable-seal-white-metri-pack-150-series.html",
    "https://www.connectorid.com/products/aptiv-15324976",
    "https://www.connectorid.com/products/aptiv-15324974",
    "https://www.customconnectorkits.com/products/15366021",
    "https://www.prowireusa.com/p-506-12110847-female-terminal-18-22-awg.html",
    "https://www.prowireusa.com/p-2268-female-gt-150-terminal-20-22-ga.html",
    "https://www.prowireusa.com/p-3769-20-16-ga-jpt-timer-terminal.html",
    "https://www.prowireusa.com/p-2104-metri-pack-150-280-sealed-crimp-tool.html",
    # plug kits
    "https://www.prowireusa.com/p-2077-ls-crank-map-sensor-connector-kit.html",
    "https://www.prowireusa.com/p-2076-ls-camshaft-sensor-connector-kit.html",
    "https://www.prowireusa.com/p-1753-liquid-temp-sensor-conn-kit.html",
    "https://www.prowireusa.com/p-2069-gm-coil-connector-kit-d585-d581-ls2-7.html",
    "https://www.prowireusa.com/p-3718-8-cyl-injector-connector-kit-w-90-boots.html",
    "https://www.prowireusa.com/68201",
    "https://www.prowireusa.com/p-3845-gt150-6-way-female-housing-dbw.html",
    "https://www.prowireusa.com/p-3846-gt150-6-way-tpa-dbw.html",
    "https://www.ictbillet.com/products/lt-gen-v-throttle-body-connector-component-kit",
    "https://www.ictbillet.com/products/oil-ls3-wire-component-kit",
    "https://www.digikey.com/en/products/detail/amphenol-pcd/M85049-69-25N/5623517",
    "https://www.prowireusa.com/raychem-miniseal-splices",
    "https://www.prowireusa.com/3137ct.html",
    "https://www.prowireusa.com/p-1924-mini-seal-crimp-stub-splice-red.html",
    "https://www.prowireusa.com/p-1925-mini-seal-crimp-stub-splice-blue.html",
    "https://www.prowireusa.com/p-1926-mini-seal-crimp-stub-splice-yellow.html",
    # tools
    "https://www.prowireusa.com/p-2025-ideal-stripmater-tefzel-stripper-26-16-ga.html",
    "https://www.prowireusa.com/p-1233-delphi-gt150-hand-crimp-tool.html",
    "https://www.prowireusa.com/resin-tech-rt125-ds-050-epoxy.html",
    # devices and pinouts
    "https://siemensdeka.com/product/60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm/",
    "https://www.maxxecu.com/webhelp/wirings-e-throttle_bodies.html",
    "https://github.com/rusefi/rusefi/wiki/SENT-ETB-Electronic-Throttle-Body",
    "https://documents.holley.com/199r10762rev1.pdf",
    "https://www.motec.com.au/ac-cc-ethernet/cc-ethernet-dw/",
    # standards and boots
    "https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf",
    "https://www.amphenolpcd.com/wp-content/uploads/2024/03/M85049_69-Shrink-Boot.pdf",
    # 2026-09-27 owner reply: isolator, batteries, DC-DC, Dakota indicators, pedal plug, E-Stopp indicator
    "https://www.bluesea.com/products/7700/ML-RBS_Remote_Battery_Switch_with_Manual_Control_-_12V_DC_500A",
    "https://powerwerx.com/blue-sea-7700-ml-rbs-remote-battery-switch",
    "https://powerwerx.com/victron-ori121236140-oriontrsmart-30a-nonisolated",
    "https://www.ictbillet.com/products/ls-gen-3-truck-dbw-pedal-position-sensor-pigtail",
    "https://www.dakotadigital.com/pdf/GSS-3000.pdf",
    "https://estopp.com/products/esr1-cm",
    "https://estopp.com/pages/how-to",
    "https://estopp.com/pages/faq",
    "https://estopp.com/pages/troubleshooting",
    "https://www.gmsquarebody.com/threads/blower-motor-resistor.5343/",
    "https://www.gmsquarebody.com/threads/ac-blower-wiring.38262/",
    "https://www.usa1industries.com/1985-87-square-body-chevy-gmc-truck-washer-jar-kit/",
    "https://www.usa1industries.com/1985-87-square-body-chevy-gmc-truck-windshield-wiper-washer-pump/",
    "https://www.gmsquarebody.com/threads/general-concensus-on-fixing-the-windshield-washer-pump.26964/",
    # 2026-09-27 carts the owner asked for: audio, windows + locks
    "https://www.crutchfield.com/p_20646CX660/Kicker-46CXA660-5.html",
    "https://www.crutchfield.com/p_109CL1000/JBL-Club-WS1000.html",
    "https://www.crutchfield.com/p_109CL102SL/JBL-Club-102SL.html",
    "https://www.crutchfield.com/p_13698640/JL-Audio-VX700-5i.html",
    "https://www.crutchfield.com/p_13698606/JL-Audio-XD700-5v2.html",
    "https://www.crutchfield.com/p_136C2650X/JL-Audio-C2-650X.html",
    "https://www.crutchfield.com/p_136C3650/JL-Audio-C3-650.html",
    "https://www.crutchfield.com/p_13610TW3/JL-Audio-10TW3-D4.html",
    "https://www.crutchfield.com/p_20646CC654/Kicker-46CSC654.html",
    "https://www.retromanufacturing.com/products/1973-87-chevrolet-c-k-series-trucks-retroradio",
    "https://www.nu-relics.com/73-87-Chevy-Truck-Regulators-p/17383-2.htm",
    "https://classicparts.com/1973-87-retro-radio-hermosa-sku-69-710f-chr-chr",
    "https://shop.autoloc.com/products/compact-2-wire-car-door-lock-actuator-heavy-duty-12-volt-motor-13-lbs-power-12v",
    "https://www.summitracing.com/parts/dak-gss-3000",
    "https://batterysales.com/product/34-78-pc1500dt-odyssey/",
    "https://batterysales.com/product/d34-78-8014-045-optima/",
    "https://www.autoloc.com/catalog/Actuators/Door-Lock-Actuators/AUTZT2000/Compact-2-Wire-Car-Door-Lock-Actuator-Heavy-Duty-12-Volt-Motor-13-Lbs-Power-12V",
    # door pass-throughs re-picked to the window wires' gauge (2026-09-28 night: DTP size 12 for 14 AWG, DT 8-way for the rest)
    "https://www.customconnectorkits.com/products/dtp04-4p",
    "https://www.customconnectorkits.com/products/dt04-08pa",
    "https://www.ksvlooms.com/products/mated-dtp-connector-kits-4-way",
    # Packard 56-series terminal gauge sizes (the factory switch blades)
    "https://ceautoelectricsupply.com/product/packard-56-series-female-terminals/",
]


def stem(url):
    u = urlparse(url)
    last = [p for p in u.path.split("/") if p][-1] if u.path.strip("/") else "index"
    last = re.sub(r"\.(html?|pdf)$", "", last)
    return f"{u.netloc}__{last}"


def scrape(url, key):
    body = json.dumps({"url": url, "formats": ["markdown"], "onlyMainContent": False, "timeout": 60000}).encode()
    req = urllib.request.Request("https://api.firecrawl.dev/v1/scrape", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    key = os.environ.get("FIRECRAWL_API_KEY")
    if not key:
        sys.exit("FIRECRAWL_API_KEY not set (run under dotenvx)")
    SNAP.mkdir(parents=True, exist_ok=True)
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    force = "--force" in sys.argv
    blocked, last_host_at = set(), {}
    for url in URLS:
        if only and only not in url:
            continue
        host = urlparse(url).netloc
        out = SNAP / f"{stem(url)}.md"
        if out.exists() and not force:
            print(f"have  {out.name}")
            continue
        if host in blocked:
            print(f"skip  {url} (host blocked this run)")
            continue
        gap = 15 if "prowireusa" in host else 8
        wait = last_host_at.get(host, 0) + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            res = scrape(url, key)
        except Exception as e:  # network or API error: record and move on
            print(f"FAIL  {url}: {e}")
            last_host_at[host] = time.time()
            continue
        last_host_at[host] = time.time()
        meta = (res.get("data") or {}).get("metadata") or {}
        status = meta.get("statusCode")
        md = (res.get("data") or {}).get("markdown") or ""
        if status in (403, 429):
            blocked.add(host)
            print(f"STOP  {host} answered {status}; no more requests to it this run")
            continue
        if not res.get("success") or not md.strip() or (status or 200) >= 400:
            print(f"EMPTY {url} (status {status})")
            continue
        head = (f"<!-- source: {url}\n     fetched: {datetime.now(timezone.utc).isoformat(timespec='seconds')} via Firecrawl\n"
                f"     status: {status} · title: {meta.get('title', '')} -->\n\n")
        out.write_text(head + md)
        print(f"saved {out.name} ({len(md):,} chars, status {status})")


if __name__ == "__main__":
    main()
