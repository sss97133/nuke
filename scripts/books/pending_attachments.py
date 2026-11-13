#!/usr/bin/env python3
"""Pending attachments: the papers the owner added for a row of the books docket that the decision does not cite yet.

The docket's Add the paper action stores a file as an ordinary financial document with one cell, supports_record_<first 24 characters of the
record's source key>, that names the record (year, local_id, source_key, the document that holds it), what the owner said the file is (doc_kind)
and the exact citation text that would clear the flag (ref). The row stays on the list until the decision itself cites the file in its proof_links,
because the decision's source document is too large for the browser's writer. This script reads those papers from v_books_record_attachments (the
one place that says when such a cell counts; migration 20261106140000), joins each to the current record it names, leaves out the ones the decision
already cites, and prints the corrections file the sanctioned writer takes. It reads; it writes nothing.

  dotenvx run -- python3 scripts/books/pending_attachments.py --owner <uuid> [--year 2024] [--out corrections.json]
  dotenvx run -- python3 scripts/books/schedule_c_rulings.py correct --corrections corrections.json --dry      # then without --dry
  dotenvx run -- python3 scripts/books/books_year_gate_check.py --owner <uuid> --record                        # after the last landing

The corrections file is local, never committed: it names the owner's records and files.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, uuid_ok  # noqa: E402

PROOF_KIND = 'file'


def pending_sql(owner, year=None):
    """The papers the owner added (v_books_record_attachments) joined to the current record each names, with that record's proof_links. Read-only."""
    owner = uuid_ok(owner)
    where_year = f"and r.year = '{int(year)}'" if year else ''
    return ("begin read only;\n"
            "select coalesce(jsonb_agg(x order by x.year, x.local_id, x.attached_at), '[]'::jsonb)::text from (\n"
            "  select r.year, r.local_id, r.document_id as decision_document_id, a.document_id as attached_document_id, a.attached_at,\n"
            "         a.ref, a.doc_kind, coalesce(r.record->'proof_links', '[]'::jsonb) as proof_links\n"
            "  from public.v_books_record_attachments a\n"
            "  join public.v_financial_accounting_records r on r.owner_id = a.owner_id and r.source_key = a.source_key\n"
            f"  where a.owner_id = '{owner}'::uuid\n"
            f"    and r.record_kind = 'retained_ledger_decision' {where_year}\n"
            ") x;\n"
            "rollback;\n")


def build_corrections(owner, rows):
    """{"owner_id", "rows": {local_id: {"document_id", "proof_links", "note"}}} for the attachments no decision cites yet, and the counts.
    A decision that already cites a file with the same text is left out; one decision with several pending files gets them all; two different
    decisions that share a local_id stop the run (the writer keys its rows by local id)."""
    out, seen_docs, cited, pending_n = {}, {}, 0, 0
    for r in rows:
        ref = (r.get('ref') or '').strip()
        if not ref:
            continue
        have = {(p.get('kind'), p.get('ref')) for p in (r.get('proof_links') or []) if isinstance(p, dict)}
        if (PROOF_KIND, ref) in have or any(p_ref == ref for _k, p_ref in have):
            cited += 1
            continue
        lid, doc = r['local_id'], r['decision_document_id']
        if seen_docs.setdefault(lid, doc) != doc:
            raise SystemExit(f'two decisions share the local id {lid}; link one by hand')
        entry = out.setdefault(lid, {'document_id': doc, 'proof_links': [], 'note': 'owner added the paper through the books docket'})
        link = {'kind': PROOF_KIND, 'ref': ref[:300]}
        if link not in entry['proof_links']:
            entry['proof_links'].append(link)
            pending_n += 1
    return {'owner_id': owner, 'rows': dict(sorted(out.items()))}, {'pending': pending_n, 'rows': len(out), 'already_cited': cited}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--year')
    ap.add_argument('--out', help='write the corrections file here (default: stdout)')
    a = ap.parse_args()
    owner = uuid_ok(a.owner)
    out = psql(pending_sql(owner, a.year))
    line = next((l for l in out.splitlines() if l.startswith('[')), '[]')
    spec, counts = build_corrections(owner, json.loads(line))
    text = json.dumps(spec, indent=1, ensure_ascii=False)
    if a.out:
        with open(a.out, 'w') as f:
            f.write(text + '\n')
    else:
        print(text)
    print(f"pending citations {counts['pending']} on {counts['rows']} decisions; already cited {counts['already_cited']}", file=sys.stderr)


if __name__ == '__main__':
    main()
