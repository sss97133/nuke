"""Parse CLAUDE.md hard rules and critical principles."""

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class HardRule:
    number: int
    rule_text: str
    rationale: str = ""


@dataclass
class Principle:
    name: str
    rule_text: str
    wrong_example: str = ""
    right_example: str = ""
    rationale: str = ""


def parse_hard_rules(path: Path) -> tuple[list[HardRule], list[Principle]]:
    text = path.read_text()
    rules = []
    principles = []

    # Extract hard rules (numbered 1-15)
    rule_pattern = re.compile(
        r'(\d+)\.\s+\*\*(.+?)\*\*\s*(.*?)(?=\n\d+\.\s+\*\*|\n###|\n---|\n##|\Z)',
        re.DOTALL
    )

    # Find the HARD RULES section
    hard_rules_match = re.search(r'## HARD RULES.*?\n(.*?)(?=\n---|\n## )', text, re.DOTALL)
    if hard_rules_match:
        section = hard_rules_match.group(1)
        for m in rule_pattern.finditer(section):
            number = int(m.group(1))
            rule_text = m.group(2).strip()
            extra = m.group(3).strip()
            # Extract rationale from extra text
            rationale = ""
            if extra:
                # Look for parenthetical explanations
                paren = re.search(r'[.—]\s*(.+)', extra)
                if paren:
                    rationale = paren.group(1).strip()
                else:
                    rationale = extra.split('\n')[0].strip()
            rules.append(HardRule(number=number, rule_text=rule_text, rationale=rationale))

    # Extract principles (Schema Discovery, Archive Fetch, Batched Migration)
    principle_sections = [
        ("Schema Discovery", "SCHEMA DISCOVERY PRINCIPLE"),
        ("Archive Fetch", "ARCHIVE FETCH PRINCIPLE"),
        ("Batched Migration", "BATCHED MIGRATION PRINCIPLE"),
    ]

    for name, header in principle_sections:
        pattern = re.compile(
            rf'## {re.escape(header)}.*?\n\*\*(.+?)\*\*\n(.*?)(?=\n---|\n## )',
            re.DOTALL
        )
        m = pattern.search(text)
        if m:
            rule_text = m.group(1).strip()
            body = m.group(2).strip()

            wrong = ""
            right = ""
            wrong_m = re.search(r'❌ Wrong:?\s*(.+)', body)
            right_m = re.search(r'✅ Right:?\s*(.+)', body)
            if wrong_m:
                wrong = wrong_m.group(1).strip()
            if right_m:
                right = right_m.group(1).strip()

            # Get the quote at the end if present
            rationale = ""
            quote_m = re.search(r'>\s*"(.+?)"', body)
            if quote_m:
                rationale = quote_m.group(1)

            principles.append(Principle(
                name=name,
                rule_text=rule_text,
                wrong_example=wrong,
                right_example=right,
                rationale=rationale,
            ))

    return rules, principles


# Timeout settings table (hardcoded from CLAUDE.md)
TIMEOUT_SETTINGS = [
    {"role": "postgres", "timeout": "120s", "why": "Enforces batching rule (Hard Rule #8)"},
    {"role": "anon", "timeout": "15s", "why": "Protects public REST API from slow queries"},
    {"role": "authenticated", "timeout": "15s", "why": "Protects authenticated REST API"},
    {"role": "authenticator", "timeout": "15s", "why": "PostgREST connection role"},
]


if __name__ == "__main__":
    rules, principles = parse_hard_rules(Path("/Users/skylar/nuke/CLAUDE.md"))
    print(f"Parsed {len(rules)} hard rules, {len(principles)} principles")
    for r in rules:
        print(f"  Rule {r.number}: {r.rule_text[:80]}")
    for p in principles:
        print(f"  Principle: {p.name} — {p.rule_text[:80]}")
