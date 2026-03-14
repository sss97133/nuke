"""Generate pipeline ownership training examples.

Teaches the model which function owns each database field.
"""

import random
from collections import defaultdict
from ..parsers.pipeline_registry_loader import RegistryEntry
from .tool_routing import make_pair


def generate_pipeline_ownership(registry: list[RegistryEntry], limit: int = 1000) -> list[dict]:
    pairs = []

    # Group by owner for reverse lookups
    by_owner = defaultdict(list)
    for entry in registry:
        by_owner[entry.owned_by].append(entry)

    # Group by table
    by_table = defaultdict(list)
    for entry in registry:
        by_table[entry.table_name].append(entry)

    # 1. "Who owns X.Y?" — direct lookup
    for entry in registry:
        dnw = entry.do_not_write_directly
        dnw_text = " **Do NOT write this field directly** — it will be overwritten by the owning function on its next run." if dnw else " Direct writes are allowed, but the owning function is the canonical writer."

        pairs.append(make_pair(
            f"Which function owns `{entry.table_name}.{entry.column_name}`?",
            f"`{entry.table_name}.{entry.column_name}` is owned by `{entry.owned_by}`.{' ' + entry.description if entry.description else ''}{dnw_text}",
            "pipeline_ownership",
        ))

    # 2. "Can I write to X.Y?" — for do_not_write entries
    dnw_entries = [e for e in registry if e.do_not_write_directly]
    for entry in dnw_entries:
        pairs.append(make_pair(
            f"Can I directly UPDATE `{entry.table_name}` SET `{entry.column_name}` = ...?",
            f"No. `{entry.table_name}.{entry.column_name}` is a computed field owned by `{entry.owned_by}` and marked `do_not_write_directly`.\n\n"
            f"Writing it directly creates a data fork — the owning function will overwrite your value on its next run. "
            f"Instead, call `{entry.owned_by}` to recompute this field."
            + (f"\n\nWrite via: `{entry.write_via}`" if entry.write_via else ""),
            "pipeline_ownership",
        ))

    # 3. Reverse lookup: "What does function X own?"
    for owner, entries in by_owner.items():
        fields = "\n".join(f"- `{e.table_name}.{e.column_name}` — {e.description or 'no description'}" for e in entries)
        dnw_count = sum(1 for e in entries if e.do_not_write_directly)
        pairs.append(make_pair(
            f"What fields does `{owner}` write to?",
            f"`{owner}` owns {len(entries)} field(s):\n\n{fields}\n\n"
            f"{dnw_count} of these are marked do_not_write_directly.",
            "pipeline_ownership",
        ))

    # 4. Table-level: "What computed fields does vehicles have?"
    for table, entries in by_table.items():
        dnw = [e for e in entries if e.do_not_write_directly]
        if dnw:
            field_list = "\n".join(f"- `{e.column_name}` → owned by `{e.owned_by}`" for e in dnw)
            pairs.append(make_pair(
                f"What computed fields on `{table}` should I never write directly?",
                f"`{table}` has {len(dnw)} computed fields that should not be written directly:\n\n{field_list}\n\n"
                f"These are recomputed by their owning functions. Writing them directly will be overwritten.",
                "pipeline_ownership",
            ))

    # 5. Danger scenarios
    danger_scenarios = [
        ("I need to fix a vehicle's nuke_estimate — the AI valued it wrong.",
         "nuke_estimate", "vehicles", "compute-vehicle-valuation"),
        ("The signal_score is stale, I'll just update it in SQL.",
         "signal_score", "vehicles", "analyze-market-signals"),
        ("I want to set ai_processing_status to 'completed' to skip processing.",
         "ai_processing_status", "vehicle_images", "photo-pipeline-orchestrator"),
        ("Let me update the completion_percentage manually.",
         "completion_percentage", "vehicles", "calculate-profile-completeness"),
    ]
    for question, column, table, owner in danger_scenarios:
        pairs.append(make_pair(
            question,
            f"Don't write `{table}.{column}` directly — it's owned by `{owner}` and marked do_not_write_directly.\n\n"
            f"If the value is wrong, the fix is to re-run `{owner}` on this vehicle. "
            f"Manually overwriting computed fields creates data forks where the field shows one value until the pipeline reruns and overwrites it.\n\n"
            f"Check pipeline_registry for authoritative ownership:\n"
            f"```sql\nSELECT owned_by, description, do_not_write_directly\nFROM pipeline_registry\nWHERE table_name = '{table}' AND column_name = '{column}';\n```",
            "pipeline_ownership",
        ))

    # 6. General pipeline registry usage
    pairs.append(make_pair(
        "How do I check who owns a database field before writing to it?",
        "Query the `pipeline_registry` table:\n\n"
        "```sql\n-- Who owns a specific field?\n"
        "SELECT owned_by, description, do_not_write_directly, write_via\n"
        "FROM pipeline_registry\n"
        "WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';\n\n"
        "-- What does a function write?\n"
        "SELECT table_name, column_name, description\n"
        "FROM pipeline_registry\n"
        "WHERE owned_by = 'compute-vehicle-valuation';\n\n"
        "-- All fields agents should not write directly\n"
        "SELECT table_name, column_name, owned_by\n"
        "FROM pipeline_registry\n"
        "WHERE do_not_write_directly = true\n"
        "ORDER BY table_name, column_name;\n```\n\n"
        "There are 63 entries in pipeline_registry covering vehicles, vehicle_images, import_queue, and more. "
        "Always check before writing to any field on a core table.",
        "pipeline_ownership",
    ))

    random.shuffle(pairs)
    return pairs[:limit]
