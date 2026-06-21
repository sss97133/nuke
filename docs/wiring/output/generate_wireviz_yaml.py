#!/usr/bin/env python3
"""
Generate WireViz YAML from K5_cut_list_v2.txt for a given loom.
Render via Kroki.io to SVG.

Source: K5_cut_list_v2.txt (canonical) + K5_connector_schedule.txt (pin functions).
Output: docs/wiring/output/K5_<loom>_wireviz.yaml + .svg

WireViz syntax reference: https://github.com/wireviz/WireViz/blob/master/docs/syntax.md
"""
import re
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
CUT_LIST = ROOT / "K5_cut_list_v2.txt"  # v3 (gauge-audit) retracted 2026-05-14 — invented current estimates

# Addendum sections below the 7 main looms in the cut list fold into their parent loom.
# Each maps to a parent loom name (matches the >> section header used by the main looms).
ADDENDUM_TO_LOOM = {
    # Section names are captured by section_pat up to the first paren — match the SHORT form
    'ANALOG_TEMP COMPANION GROUND RETURNS': 'ENGINE LOOM',
    'ANALOG_5V COMPANION GROUND + 5V REF': 'ENGINE LOOM',
    'ECU_CRANK_CAM SHIELDED COMPANIONS': 'ENGINE LOOM',
    'PIEZOELECTRIC KNOCK COMPANIONS': 'ENGINE LOOM',
    'LOW_SIDE_DRIVE': 'ENGINE LOOM',
    'LOGIC_COIL_DRIVE': 'ENGINE LOOM',
}

# IEC 60757 color codes (WireViz standard)
COLOR_MAP = {
    'BLK': 'BK', 'BRN': 'BN', 'RED': 'RD', 'ORG': 'OG', 'ORN': 'OG', 'YEL': 'YE',
    'GRN': 'GN', 'BLU': 'BU', 'VIO': 'VT', 'PPL': 'VT', 'GRY': 'GY', 'WHT': 'WH',
    'TAN': 'BN', 'PNK': 'PK',
    'DK BLU': 'BU', 'LT BLU': 'BU', 'DK GRN': 'GN', 'LT GRN': 'GN',
}

def iec(color):
    parts = [p.strip() for p in color.split('/')]
    return ''.join(COLOR_MAP.get(p, p[:2].upper()) for p in parts) or 'WH'

def safe_id(s):
    s = re.sub(r'[^a-zA-Z0-9_]', '_', s)
    return re.sub(r'_+', '_', s).strip('_') or 'X'

# Real connector PNs and types per K5_connector_shopping_list.txt
# Format: device-name-prefix or exact: (connector_type, pincount, pinlabels, pigtail_pn)
DEVICE_CONNECTORS = {
    'M130':         ('MoTeC Superseal Cnctr A (34-pin) — MoTeC #65044', 34, None, None),
    'M130_B':       ('MoTeC Superseal Cnctr B (26-pin)', 26, None, None),
    'PDM30':        ('MoTeC Superseal A (34-pin) — MoTeC #65044', 34, None, None),
    'PDM30_B':      ('MoTeC Superseal B (26-pin)', 26, None, None),
    'Ignition_Coil': ('D510C — WPCOL40 / GM 12162000 (4-pin)', 4, ['+12V', 'GND', 'SIG', 'GND2'], 'WPCOL40'),
    'Fuel_Injector': ('EV6/USCAR — WPINJ40 / GM 13352241 (2-pin)', 2, ['+12V', 'CTRL'], 'WPINJ40'),
    'Crank_Position_Sensor': ('Metri-Pack 3-pin gray — WPCKP40 / GM 12615626', 3, ['+5V', 'SIG', 'GND'], 'WPCKP40'),
    'Cam_Position_Sensor':   ('Metri-Pack 3-pin — WPCMP30 / GM 12591720', 3, ['+5V', 'SIG', 'GND'], 'WPCMP30'),
    'Knock_Sensor':          ('2-pin sealed metric — WPKNO40 / GM 12623730', 2, ['SIG', 'GND'], 'WPKNO40'),
    'Coolant_Temp_Sensor':   ('Metri-Pack 150.2 2-pin sealed — WPCTS30 / GM 19236568', 2, ['SIG', 'GND'], 'WPCTS30'),
    'Oil_Pressure_Sensor':   ('3-pin oval sealed — WP0IL40 / GM 12673134', 3, ['+5V', 'SIG', 'GND'], 'WP0IL40'),
    'ETB':                   ('6-pin sealed — GM 13580085 mates GM 12605109', 6, ['MotorA', 'MotorB', 'TPS1', 'TPS2', '+5V', 'GND'], None),
    'MAP_Sensor':            ('Bosch 3-pin sealed — GM 55573248 / ACDelco PT2293', 3, ['+5V', 'SIG', 'GND'], None),
    'Intake_Air_Temp_Sensor': ('2-pin (LS3 IAT — GM PN TBD)', 2, ['SIG', 'GND'], None),
    'Oil_Temperature_Sensor': ('2-pin (PN TBD)', 2, ['SIG', 'GND'], None),
    'Fuel_Pressure_Sensor':   ('3-pin (PN TBD)', 3, ['+5V', 'SIG', 'GND'], None),
    'Rear_Backup_Camera':     ('Camera connector (PN TBD)', 4, ['+12V', 'GND', 'VID+', 'VID-'], None),
}

def lookup_connector(device_name):
    """Return (type, pincount, pinlabels, pigtail_pn) or None.
    Match by device-name prefix to handle "Ignition Coil 1" → Ignition_Coil entry."""
    sid = safe_id(device_name)
    if sid in DEVICE_CONNECTORS:
        return DEVICE_CONNECTORS[sid]
    # Try stripping trailing digit(s) for grouped devices
    for k in DEVICE_CONNECTORS:
        if sid.startswith(k + '_'):
            return DEVICE_CONNECTORS[k]
        if sid == k:
            return DEVICE_CONNECTORS[k]
    return None

# Parse cut list (reusing v2 format)
gap_pat = re.compile(r'\s{2,}')
len_pat = re.compile(r'^([\d.]+)ft$')
section_pat = re.compile(r'>>\s+(.+?)\s+\(')

def parse_cut_list():
    wires = []
    current_section = None
    # Source-pin patterns: M130:A01..B26, PDM30:OUT01..OUT30, plus addendum sources like
    # "ENGINE BLOCK", "FACTORY GM CTS", "FLOOR DIMMER LO-OUT", "tap #80 at dash", etc.
    source_pat = re.compile(
        r'\b('
        r'M130:[AB]\d+|'
        r'M130_B:[AB]?\d+|'
        r'PDM30:OUT\d+|'
        r'PDM30:OUT\?|'                # TBD PDM channel placeholder
        r'PDM30:[A-Z0-9_]+|'
        r'ENGINE BLOCK|'
        r'STAR GND DASH|'
        r'DASH BUTTON|'
        r'FACTORY GM [A-Z]+|'
        r'FLOOR DIMMER [A-Z\-]+|'
        r'tap #\S+ at \w+|'
        r'splice on #\S+ trunk|'
        r'PDM30:OUT29 splice'
        r')'
    )
    for line in CUT_LIST.read_text().splitlines():
        sec = section_pat.search(line)
        if sec:
            current_section = sec.group(1).strip()
            continue
        if not line.startswith('#') or line.startswith('# ') or line.startswith('#    LABEL'):
            continue
        body = line[1:].rstrip()
        # ensure length token always has 2+ space pad before it
        body = re.sub(r'(\S)\s(\d+\.\d+ft)', r'\1  \2', body)
        # try to find source pin by regex first — handles single-space label/source split
        src_m = source_pat.search(body)
        if not src_m:
            continue
        head_pre_source = body[:src_m.start()].rstrip()
        source_token = src_m.group(1)
        tail = body[src_m.end():].lstrip()
        # head_pre_source = "wid label..." ; split first whitespace
        sp = head_pre_source.find(' ')
        if sp <= 0:
            continue
        wid = head_pre_source[:sp].strip()
        label = head_pre_source[sp+1:].strip()
        # tail = "SPEC...  COLOR  LENGTHft  NOTES" — split on 2+ space
        tail_parts = gap_pat.split(tail)
        length_idx = None
        for i, p in enumerate(tail_parts):
            m = len_pat.match(p.strip())
            if m:
                length_idx = i
                length = float(m.group(1))
                break
        if length_idx is None or length_idx < 2:
            continue
        spec = tail_parts[length_idx-2].strip()
        color = tail_parts[length_idx-1].strip()
        notes = ' '.join(tail_parts[length_idx+1:]).strip() if length_idx+1 < len(tail_parts) else ''
        m = re.match(r'(\d+)\s+AWG', spec)
        gauge = int(m.group(1)) if m else 0
        wires.append({
            'id': wid, 'section': current_section, 'label': label, 'from': source_token,
            'spec': spec, 'gauge': gauge, 'color': color, 'length_ft': length, 'notes': notes,
        })
    return wires

# Build WireViz YAML for a single loom (default: ENGINE LOOM)
def build_yaml(loom='ENGINE LOOM'):
    addendum_sections = {sec for sec, parent in ADDENDUM_TO_LOOM.items() if parent == loom}
    wires = [w for w in parse_cut_list() if w['section'] == loom or w['section'] in addendum_sections]
    # Determine connectors:
    #   Source connectors come from the "from" field (M130:A01, PDM30:OUT15, ECU, AMP CH1+, etc.)
    #   Destination connectors derive from the label (Injector 1, Crank, etc.)
    # Group source pins per connector body.
    def safe_pin(p):
        # WireViz rejects all-digit pin labels — prefix with P
        # Replace +/- with p/n to keep them distinguishable
        cleaned = p.replace('+', 'p').replace('-', 'n').replace(' ', '_')
        cleaned = re.sub(r'[^a-zA-Z0-9_]', '_', cleaned).strip('_') or 'X'
        return f'P{cleaned}' if re.fullmatch(r'\d+[a-z]?', cleaned) else cleaned

    def normalize_source(frm, wire_id):
        """Handle quirks in cut list 'from' field.
        - AMP CH1+, AMP CH1-, AMP CH2+ etc. → connector='AMP', pin='CH1p'/'CH1n'
        - AMP SUB+, AMP SUB- → connector='AMP', pin='SUBp'/'SUBn'
        - bare 'ECU' → connector='ECU', pin=wire_id (already handled below)
        - 'M130:A01', 'PDM30:OUT15' → split on colon
        """
        if frm.startswith('AMP ') and (frm.endswith('+') or frm.endswith('-')):
            sign = 'p' if frm.endswith('+') else 'n'
            channel = frm[4:-1]  # CH1, CH2, SUB, etc.
            return 'AMP', f'{channel}{sign}'
        if ':' in frm:
            return frm.split(':', 1)
        return frm, wire_id

    source_pins = defaultdict(set)  # connector_id -> set of pins (safe-prefixed)
    raw_to_safe = {}  # (conn, raw_pin) -> safe_pin
    source_pin_label_map = defaultdict(dict)
    for w in wires:
        conn, raw_pin = normalize_source(w['from'], w['id'])
        sp = safe_pin(raw_pin)
        source_pins[conn].add(sp)
        raw_to_safe[(conn, raw_pin)] = sp
        source_pin_label_map[conn][sp] = w['label']

    # Destination connectors:
    #  - Each Injector 1..8 = its own connector (8 separate)
    #  - Each Coil 1..8 = its own connector (8 separate)
    #  - ETB = 1 connector grouping 6 wires
    #  - Each sensor = its own connector
    #  - Speaker+/- pairs consolidated into one Speaker connector with 2 pins
    #  - Companion wires (#NNg, #NNr, #NNs) route to the parent #NN wire's device, NOT to their own connector
    companion_pat = re.compile(r'^(\d+)([grs])$')

    def device_root_for(w):
        """Compute the destination device name for a wire."""
        label = w['label']
        if label.startswith('ETB '):
            return 'ETB'
        if label.startswith('Speaker ') and (label.endswith('(+)') or label.endswith('(-)')):
            return label.rsplit(' (', 1)[0]
        if label.startswith('Subwoofer') and (label.endswith('(+)') or label.endswith('(-)')):
            return 'Subwoofer'
        return re.sub(r'\s*\(ECU\)\s*$', '', label).strip()

    # First pass: build wire_id → device_root for the main (non-companion) wires
    id_to_device = {}
    for w in wires:
        if not companion_pat.match(w['id']):
            id_to_device[w['id']] = device_root_for(w)

    # Second pass: route companions to their parent's device
    dest_groups = defaultdict(list)  # dest_id -> list of wires
    companion_pin_map = {'g': 'GND', 'r': '+5V', 's': 'GND'}  # shield drain → sensor GND pin
    for w in wires:
        m = companion_pat.match(w['id'])
        if m and m.group(1) in id_to_device:
            device_root = id_to_device[m.group(1)]
            w['_companion_pin_hint'] = companion_pin_map[m.group(2)]
        else:
            device_root = device_root_for(w)
        dest_groups[device_root].append(w)

    # Avoid source/dest key collisions (e.g. wire #60 has from='ECU' and label='ECU')
    dest_suffix_map = {}  # device_root -> suffix
    for device in list(dest_groups.keys()):
        if safe_id(device) in {safe_id(s) for s in source_pins.keys()}:
            dest_suffix_map[device] = '_TARGET'

    from datetime import datetime
    today = datetime.now().strftime('%Y-%m-%d')

    # Pin-conflict detection: source pins with >1 SIGNAL wire are suspect.
    # Shared returns (B15, B16, A02, A09 — sensor 0V/5V refs) are legitimate fan-outs and excluded.
    # Power outputs (PDM30:OUTxx) are legitimate fan-outs (one channel feeds multiple loads).
    SHARED_PINS = {'M130:B15', 'M130:B16', 'M130:A02', 'M130:A09'}
    pin_assignments = defaultdict(list)  # "M130:A14" -> [(wire_id, label), ...]
    for w in wires:
        conn, raw_pin = normalize_source(w['from'], w['id'])
        full = f'{conn}:{raw_pin}'
        if conn == 'PDM30' or full in SHARED_PINS:
            continue
        pin_assignments[full].append((w['id'], w['label']))
    conflicts = {p: a for p, a in pin_assignments.items() if len(a) > 1}

    yaml_lines = []
    yaml_lines.append(f'# K5 {loom} — generated from K5_cut_list_v2.txt')
    yaml_lines.append(f'# {len(wires)} wires, sources: {", ".join(sorted(source_pins.keys()))}')
    if conflicts:
        yaml_lines.append('#')
        yaml_lines.append('# !! SUBSTRATE INCONSISTENCY — pin assignment conflicts detected !!')
        for pin, entries in sorted(conflicts.items()):
            yaml_lines.append(f'#   {pin} assigned to {len(entries)} signal wires:')
            for wid, lbl in entries:
                yaml_lines.append(f'#     - #{wid} {lbl}')
        yaml_lines.append('#   See K5_diagram_quality_report.md for resolution status.')
    yaml_lines.append('')
    # WireViz metadata block — title, subtitle, page identification
    yaml_lines.append('metadata:')
    yaml_lines.append(f'  title: "K5 {loom}"')
    yaml_lines.append(f'  pn: "K5-{loom.replace(" / ", "-").replace(" ", "_")}"')
    yaml_lines.append(f'  description: "1977 Chevrolet K5 Blazer · VIN CKR187F127263 · LS3 6.2L · MoTeC M130 + PDM30. {len(wires)} wires from K5_cut_list_v2.txt. Wire spec: M22759/32 Tefzel (Pro tier). Generated {today}. Builder: NUKE LTD. Wiring: Desert Performance."')
    yaml_lines.append(f'  revision: "wireviz-{today}"')
    yaml_lines.append('')
    yaml_lines.append('options:')
    yaml_lines.append('  fontname: "Roboto"')
    yaml_lines.append('  bgcolor: "WH"')
    yaml_lines.append('  color_mode: full')
    yaml_lines.append('')

    # Connectors
    yaml_lines.append('connectors:')
    # Source connectors (M130, PDM30, etc.) — use real connector type if known
    for conn in sorted(source_pins.keys()):
        pins = sorted(source_pins[conn])
        sid = safe_id(conn)
        info = DEVICE_CONNECTORS.get(sid)
        ctype = info[0] if info else conn
        yaml_lines.append(f'  {sid}:')
        yaml_lines.append(f'    type: "{ctype}"')
        yaml_lines.append(f'    subtype: female  # mating side that plugs into the device')
        yaml_lines.append(f'    pincount: {info[1] if info else len(pins)}')
        # Quote all pinlabels as strings (WireViz rejects bare ints)
        yaml_lines.append(f'    pinlabels: [{", ".join(f"\"{p}\"" for p in pins)}]')
        yaml_lines.append('')
    # Destination connectors — use real PN where known
    for device, dwires in sorted(dest_groups.items()):
        did = safe_id(device) + dest_suffix_map.get(device, '')
        info = lookup_connector(device)
        if info:
            ctype, pincount, pinlabels, pigtail = info
            yaml_lines.append(f'  {did}:')
            yaml_lines.append(f'    type: "{ctype}"')
            yaml_lines.append(f'    pincount: {pincount}')
            if pinlabels:
                yaml_lines.append(f'    pinlabels: [{", ".join(pinlabels)}]')
            if pigtail:
                yaml_lines.append(f'    notes: Pigtail {pigtail}')
        else:
            # Generic — no PN known
            pincount = len(dwires)
            yaml_lines.append(f'  {did}:')
            yaml_lines.append(f'    type: "{device} (connector PN unknown)"')
            yaml_lines.append(f'    pincount: {pincount}')
            yaml_lines.append(f'    pinlabels: [{", ".join(f"P{i+1}" for i in range(pincount))}]')
        yaml_lines.append('')

    # Cables (one per wire — simple, will be bundled later)
    yaml_lines.append('cables:')
    for w in wires:
        cid = f"W{safe_id(w['id'])}"
        spec = w['spec']
        is_shielded_2c = 'SHIELDED 2C' in spec
        is_twisted_pair = 'TWISTED PAIR' in spec
        yaml_lines.append(f'  {cid}:')
        yaml_lines.append(f'    gauge: {w["gauge"]} AWG')
        yaml_lines.append(f'    length: {w["length_ft"]:.1f}')
        if is_shielded_2c:
            # Render as 2-conductor shielded cable
            yaml_lines.append(f'    wirecount: 2')
            yaml_lines.append(f'    shield: true')
            yaml_lines.append(f'    colors: [WH, BK]   # signal + ground (cut list color "{w["color"]}" is bundle ID)')
            yaml_lines.append(f'    notes: "#{w["id"]} {w["label"]} — 22 AWG M27500-style shielded 2C, drain to sensor ground"')
        elif is_twisted_pair:
            yaml_lines.append(f'    wirecount: 2')
            yaml_lines.append(f'    shield: false')
            yaml_lines.append(f'    colors: [WH, GN]   # CAN-H / CAN-L per ISO 11898')
            yaml_lines.append(f'    notes: "#{w["id"]} {w["label"]} — twisted pair, 120Ω terminated each end"')
        else:
            yaml_lines.append(f'    wirecount: 1')
            yaml_lines.append(f'    colors: [{iec(w["color"])}]')
            yaml_lines.append(f'    notes: "#{w["id"]} {w["label"]} ({w["color"]})"')
        yaml_lines.append('')

    # Map each wire to its destination pin label based on label keyword
    def dest_pin_for(wire, device_root):
        # Companion wires (#NNg, #NNr, #NNs) carry a pin hint from the second pass
        hint = wire.get('_companion_pin_hint')
        info = lookup_connector(device_root)
        if hint and info and info[2] and hint in info[2]:
            return hint
        if not info or not info[2]:
            dest_wires = dest_groups[device_root]
            idx = next((i+1 for i,dw in enumerate(dest_wires) if dw['id'] == wire['id']), 1)
            return f'P{idx}'
        labels = info[2]
        lbl = wire['label'].lower()
        if device_root == 'ETB':
            if 'motor 1' in lbl: return 'MotorA'
            if 'motor 2' in lbl: return 'MotorB'
            if 'tps1' in lbl: return 'TPS1'
            if 'tps2' in lbl: return 'TPS2'
            if '5v reference' in lbl or '5v ref' in lbl: return '+5V'
            if 'signal ground' in lbl or 'sig gnd' in lbl: return 'GND'
        if 'CTRL' in labels: return 'CTRL'
        if 'SIG' in labels: return 'SIG'
        return labels[0]

    # Connections — alternating connector / cable / connector
    yaml_lines.append('connections:')
    for w in wires:
        src_conn, raw_src_pin = normalize_source(w['from'], w['id'])
        src_pin = raw_to_safe.get((src_conn, raw_src_pin), raw_src_pin)
        src_id = safe_id(src_conn)
        m = companion_pat.match(w['id'])
        if m and m.group(1) in id_to_device:
            device_root = id_to_device[m.group(1)]
        else:
            device_root = device_root_for(w)
        dst_id = safe_id(device_root) + dest_suffix_map.get(device_root, '')
        dst_pin = dest_pin_for(w, device_root)
        cid = f"W{safe_id(w['id'])}"
        yaml_lines.append(f'  -')
        yaml_lines.append(f'    - {src_id}: ["{src_pin}"]')
        yaml_lines.append(f'    - {cid}: [1]')
        yaml_lines.append(f'    - {dst_id}: ["{dst_pin}"]')
    return '\n'.join(yaml_lines) + '\n'

def render_via_kroki(yaml_text, out_path):
    req = urllib.request.Request(
        'https://kroki.io/wireviz/svg',
        data=yaml_text.encode('utf-8'),
        headers={
            'Content-Type': 'text/plain',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 nuke-wiring-pipeline/1.0',
            'Accept': 'image/svg+xml',
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            svg = resp.read().decode('utf-8')
            Path(out_path).write_text(svg)
            return True, f'Rendered {len(svg)} bytes → {out_path}'
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:500]
        return False, f'HTTP {e.code}: {err}'
    except Exception as e:
        return False, f'Error: {e}'

if __name__ == '__main__':
    loom = sys.argv[1] if len(sys.argv) > 1 else 'ENGINE LOOM'
    version = sys.argv[2] if len(sys.argv) > 2 else ''
    slug = loom.lower().replace(' ', '_').replace('/', '_')
    vsuffix = f'_{version}' if version else ''
    yaml_path = ROOT / f'K5_{slug}_wireviz{vsuffix}.yaml'
    svg_path = ROOT / f'K5_{slug}_wireviz{vsuffix}.svg'

    yaml_text = build_yaml(loom)
    yaml_path.write_text(yaml_text)
    print(f'Wrote {yaml_path} ({len(yaml_text)} chars)')

    ok, msg = render_via_kroki(yaml_text, svg_path)
    print(f'{"OK" if ok else "FAIL"}: {msg}')
