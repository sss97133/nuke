"""Parse DONE.md into structured operational history entries."""

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DoneEntry:
    date: str
    area: str
    title: str
    details: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    is_incident: bool = False


def parse_done_md(path: Path) -> list[DoneEntry]:
    text = path.read_text()
    entries = []
    current_date = ""

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Date header: ## 2026-03-09 or ## March 9, 2026
        date_m = re.match(r'^##\s+(\d{4}-\d{2}-\d{2}|\w+ \d+,?\s*\d{4})', line)
        if date_m:
            current_date = date_m.group(1)
            i += 1
            continue

        # Entry header: ### [area] Title or - [area] Title or **[area]** Title
        entry_m = re.match(r'^(?:###\s+|[-*]\s+)?\[([^\]]+)\]\s+(.+)', line)
        if not entry_m:
            entry_m = re.match(r'^(?:###\s+|[-*]\s+)?\*\*\[([^\]]+)\]\*\*\s+(.+)', line)

        if entry_m and current_date:
            area = entry_m.group(1).lower().strip()
            title = entry_m.group(2).strip()

            # Collect bullet points under this entry
            details = []
            i += 1
            while i < len(lines):
                dline = lines[i].strip()
                if dline.startswith("- ") or dline.startswith("* "):
                    details.append(dline.lstrip("-* ").strip())
                elif dline.startswith("  - ") or dline.startswith("  * "):
                    details.append(dline.strip().lstrip("-* ").strip())
                elif dline == "" or dline.startswith("#") or re.match(r'^\[', dline):
                    break
                else:
                    # Continuation line
                    if details:
                        details[-1] += " " + dline
                    i += 1
                    continue
                i += 1

            # Extract metrics (numbers with units)
            metrics = {}
            full_text = title + " " + " ".join(details)
            # Before/after patterns
            for m in re.finditer(r'(\d[\d,.]+)\s*(?:→|->|to)\s*(\d[\d,.]+)\s*(GB|MB|rows|functions|%|\$|entries|vehicles|images)', full_text):
                unit = m.group(3)
                metrics[f"before_{unit}"] = m.group(1)
                metrics[f"after_{unit}"] = m.group(2)

            # Is this an incident/triage/fix entry?
            incident_areas = {"triage", "data-quality", "infra", "security", "fix", "hotfix",
                              "incident", "crons", "data-purge", "cleanup", "migration", "performance"}
            incident_keywords = {"fix", "broke", "stuck", "stale", "crash", "error", "bloat",
                                 "delete", "purge", "triage", "outage", "lock", "timeout"}
            is_incident = (
                area in incident_areas or
                any(kw in full_text.lower() for kw in incident_keywords)
            )

            entries.append(DoneEntry(
                date=current_date,
                area=area,
                title=title,
                details=details,
                metrics=metrics,
                is_incident=is_incident,
            ))
            continue

        i += 1

    return entries


if __name__ == "__main__":
    entries = parse_done_md(Path("/Users/skylar/nuke/DONE.md"))
    print(f"Parsed {len(entries)} DONE.md entries")
    incidents = [e for e in entries if e.is_incident]
    print(f"  Incident entries: {len(incidents)}")
    areas = set(e.area for e in entries)
    print(f"  Areas: {sorted(areas)}")
    for e in entries[:5]:
        print(f"  [{e.date}] [{e.area}] {e.title[:60]} ({'INCIDENT' if e.is_incident else 'normal'})")
