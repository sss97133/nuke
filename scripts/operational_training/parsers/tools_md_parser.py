"""Parse TOOLS.md into structured intent-to-function mappings."""

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ToolEntry:
    section: str
    intent: str
    function: str
    notes: str = ""
    writes_to: str = ""


@dataclass
class AntiPattern:
    bad_idea: str
    use_instead: str


def parse_tools_md(path: Path) -> tuple[list[ToolEntry], list[AntiPattern]]:
    text = path.read_text()
    tools = []
    antipatterns = []

    current_section = ""
    in_antipattern = False

    for line in text.split("\n"):
        # Section headers
        if line.startswith("## "):
            current_section = line.lstrip("# ").strip()
            in_antipattern = "DO NOT BUILD" in current_section
            continue

        # Skip non-table rows
        if not line.startswith("|") or line.startswith("|--") or line.startswith("| Intent") or line.startswith("| What"):
            continue

        parts = [p.strip() for p in line.split("|")[1:-1]]
        if len(parts) < 2:
            continue

        if in_antipattern and len(parts) >= 2:
            antipatterns.append(AntiPattern(
                bad_idea=parts[0].strip("`"),
                use_instead=parts[1].strip("`"),
            ))
        elif len(parts) >= 2:
            # Clean backticks from function names
            func = re.sub(r'`([^`]+)`', r'\1', parts[1])
            notes = parts[2] if len(parts) > 2 else ""
            writes_to = ""
            if current_section == "Scoring & Valuation" and len(parts) > 2:
                writes_to = parts[2]
                notes = ""

            tools.append(ToolEntry(
                section=current_section,
                intent=parts[0],
                function=func,
                notes=notes,
                writes_to=writes_to,
            ))

    return tools, antipatterns


if __name__ == "__main__":
    tools, anti = parse_tools_md(Path("/Users/skylar/nuke/TOOLS.md"))
    print(f"Parsed {len(tools)} tools, {len(anti)} antipatterns")
    for section in set(t.section for t in tools):
        count = sum(1 for t in tools if t.section == section)
        print(f"  {section}: {count}")
    print(f"\nAntipatterns:")
    for a in anti:
        print(f"  Don't build: {a.bad_idea} → Use: {a.use_instead}")
