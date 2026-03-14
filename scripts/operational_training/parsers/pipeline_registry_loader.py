"""Load pipeline_registry from Supabase."""

from dataclasses import dataclass


@dataclass
class RegistryEntry:
    table_name: str
    column_name: str
    owned_by: str
    description: str = ""
    do_not_write_directly: bool = False
    write_via: str = ""


def load_pipeline_registry(sb) -> list[RegistryEntry]:
    resp = sb.table("pipeline_registry").select(
        "table_name,column_name,owned_by,description,do_not_write_directly,write_via"
    ).order("table_name").order("column_name").execute()

    entries = []
    for row in resp.data:
        entries.append(RegistryEntry(
            table_name=row["table_name"],
            column_name=row["column_name"],
            owned_by=row.get("owned_by", ""),
            description=row.get("description", "") or "",
            do_not_write_directly=bool(row.get("do_not_write_directly", False)),
            write_via=row.get("write_via", "") or "",
        ))
    return entries


if __name__ == "__main__":
    import os
    from supabase import create_client
    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    sb = create_client(url, key)
    entries = load_pipeline_registry(sb)
    print(f"Loaded {len(entries)} registry entries")
    for e in entries[:5]:
        print(f"  {e.table_name}.{e.column_name} → {e.owned_by} (dnw={e.do_not_write_directly})")
