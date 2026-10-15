"""The parts of the lego-book generator (output/lego-book/build_ch1.py, Chapter 1 build pages) that reconcile_v5.py
reads: the cut list v4.2 parser, the M130 pin table and the M130 rail pins. Copied verbatim on 2026-10-15 from
build_ch1.py (commit 47a11163b, never merged to main) so the registry rebuilds from main; build_ch1.py itself also
renders pages, runs wireviz and reads the twin's lengths at import, none of which the registry needs.
"""
import re
from collections import OrderedDict
from pathlib import Path

CUT = Path(__file__).resolve().parents[1] / "output/K5_cut_list_v4_2.txt"

LINE_RE = re.compile(r"^#([0-9A-Za-z_]+)\s+(.*)$")
AWG_RE = re.compile(r"(?<![\w/])(\d+)\s*AWG\b")
LEN_RE = re.compile(r"^(.*?)\s*([\d.]+)ft$")


def parse_cut_list():
    """Every row that starts with '#<id>' (174 expected). Row grammar varies: FROM can be glued to
    SPEC ('DIMMER HI-OUT 16 AWG'), LABEL to FROM ('...cable) M130:B15'), COLOR to LENGTH
    ('ORN/BLK/RED 4.6ft'). Companion labels mention parent IDs ('#99') — only line-start IDs count."""
    wires, section = [], None
    for n, raw in enumerate(CUT.read_text(encoding="utf-8").splitlines(), 1):
        if raw.startswith(">>"):
            section = raw[2:].strip()
            continue
        m = LINE_RE.match(raw)
        if not m:
            continue
        wid, rest = m.group(1), m.group(2)
        fields = re.split(r"\s{2,}", rest.strip())
        si = next(i for i, f in enumerate(fields) if AWG_RE.search(f))
        am = AWG_RE.search(fields[si])
        pre, spec = fields[si][: am.start()].strip(), fields[si][am.start():].strip()
        head = fields[:si] + ([pre] if pre else [])
        if len(head) >= 2:
            label, frm = " ".join(head[:-1]), head[-1]
        else:
            label, frm = head[0].rsplit(" ", 1)
        tail = fields[si + 1:]
        li = next(i for i, t in enumerate(tail) if LEN_RE.match(t))
        lm = LEN_RE.match(tail[li])
        color = " ".join(tail[:li] + ([lm.group(1)] if lm.group(1) else [])).strip()
        wires.append(OrderedDict(
            id=wid, line=n, section=section, label=label.strip(), frm=frm.strip(),
            awg=int(am.group(1)), spec_raw=spec, color_old=color, len_ft=float(lm.group(2)),
            notes="  ".join(tail[li + 1:]).strip(),
        ))
    return wires


# Function names: CONNECTOR_DATA_REPORT.md:231-264 (A) and :270-295 (B); Dave-style wording in col 2.
M130 = OrderedDict([
    ("A01", ("OUT_HB2", "half bridge 2")), ("A02", ("SEN_5V0_A", "sensor 5 volt A")),
    ("A03", ("IGN_LS1", "Ignition 1")), ("A04", ("IGN_LS2", "Ignition 2")), ("A05", ("IGN_LS3", "Ignition 3")),
    ("A06", ("IGN_LS4", "Ignition 4")), ("A07", ("IGN_LS5", "Ignition 5")), ("A08", ("IGN_LS6", "Ignition 6")),
    ("A09", ("SEN_5V0_B", "sensor 5 volt B")), ("A10", ("BAT_NEG1", "ECU ground")), ("A11", ("BAT_NEG2", "ECU ground")),
    ("A12", ("IGN_LS7", "Ignition 7")), ("A13", ("IGN_LS8", "Ignition 8")), ("A14", ("AV1", "AV1")),
    ("A15", ("AV2", "AV2")), ("A16", ("AV3", "AV3")), ("A17", ("AV4", "AV4")), ("A18", ("OUT_HB1", "half bridge 1")),
    ("A19", ("INJ_PH1", "fuel 1")), ("A20", ("INJ_PH2", "fuel 2")), ("A21", ("INJ_PH3", "fuel 3")),
    ("A22", ("INJ_PH4", "fuel 4")), ("A23", ("INJ_LS1", "low side 1")), ("A24", ("INJ_LS2", "low side 2")),
    ("A25", ("AV5", "AV5")), ("A26", ("BAT_POS", "ECU 12v supply")), ("A27", ("INJ_PH5", "fuel 5")),
    ("A28", ("INJ_PH6", "fuel 6")), ("A29", ("INJ_PH7", "fuel 7")), ("A30", ("INJ_PH8", "fuel 8")),
    ("A31", ("OUT_HB3", "half bridge 3")), ("A32", ("OUT_HB4", "half bridge 4")),
    ("A33", ("OUT_HB5", "half bridge 5")), ("A34", ("OUT_HB6", "half bridge 6")),
    ("B01", ("UDIG1", "Reference")), ("B02", ("UDIG2", "Sync")), ("B03", ("AT1", "AT1")), ("B04", ("AT2", "AT2")),
    ("B05", ("AT3", "AT3")), ("B06", ("AT4", "AT4")), ("B07", ("KNOCK1", "knock 1")), ("B08", ("UDIG3", "Udig 3")),
    ("B09", ("UDIG4", "Udig 4")), ("B10", ("UDIG5", "Udig 5")), ("B11", ("UDIG6", "Udig 6")),
    ("B12", ("BAT_BAK", "Battery Backup")), ("B13", ("KNOCK2", "knock 2")), ("B14", ("UDIG7", "Udig 7")),
    ("B15", ("SEN_0V_A", "0 volt engine A")), ("B16", ("SEN_0V_B", "0 volt engine B")),
    ("B17", ("CAN_HI", "CAN High")), ("B18", ("CAN_LO", "CAN Low")), ("B19", ("SEN_6V3", "6.3 volt")),
    ("B20", ("AV6", "AV6")), ("B21", ("AV7", "AV7")), ("B22", ("AV8", "AV8")),
    ("B23", ("ETH_TX+", "Enet TX+")), ("B24", ("ETH_TX-", "Enet TX-")), ("B25", ("ETH_RX+", "Enet RX+")),
    ("B26", ("ETH_RX-", "Enet RX-")),
])
RAIL_PINS = {"A02", "A09", "B15", "B16"}  # one function, many wires → splice to one cavity lead
