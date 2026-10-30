#!/usr/bin/env python3
"""Checks of pending_attachments.py on synthetic values: python3 scripts/books/pending_attachments_test.py

No database is touched: these test the read the script sends and the corrections file it builds, which the sanctioned writer must accept."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pending_attachments as p
from schedule_c_rulings import proof_links

OWNER = '11111111-1111-4111-8111-111111111111'
DOC_A, DOC_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'


def row(local_id, ref, doc=DOC_A, links=None, year='2024', at='2026-10-29T19:00:00Z'):
    return dict(year=year, local_id=local_id, decision_document_id=doc, attached_document_id='cc', attached_at=at, ref=ref, doc_kind='Invoice', proof_links=links or [])


class T(unittest.TestCase):
    def test_the_read_is_read_only_and_keyed_by_the_owner_and_the_record_each_paper_names(self):
        sql = p.pending_sql(OWNER, 2024)
        self.assertTrue(sql.startswith('begin read only;'))
        self.assertTrue(sql.rstrip().endswith('rollback;'))
        self.assertIn(f"a.owner_id = '{OWNER}'::uuid", sql)
        self.assertIn("r.source_key = a.source_key", sql)
        self.assertIn("r.year = '2024'", sql)
        self.assertNotRegex(sql, r'(?i)\b(insert|update|delete|truncate|alter|drop)\b')

    def test_the_test_that_a_paper_counts_lives_in_the_view_once_and_not_in_this_script(self):
        sql = p.pending_sql(OWNER)
        self.assertIn('from public.v_books_record_attachments a', sql)
        # the cell's key, its supersession and the check that it names the record it sits under are the view's, not repeated here
        for repeated in ('supports_record', 'is_superseded', 'field_key', 'financial_document_extractions'):
            self.assertNotIn(repeated, sql)

    def test_an_owner_that_is_not_a_uuid_and_a_year_that_is_not_a_number_never_reach_the_sql(self):
        with self.assertRaises(ValueError):
            p.pending_sql("x'; drop table y; --")
        with self.assertRaises(ValueError):
            p.pending_sql(OWNER, "2024' or '1'='1")

    def test_a_pending_attachment_becomes_one_proof_link_on_its_decision_in_the_writers_own_shape(self):
        spec, counts = p.build_corrections(OWNER, [row('L1', 'Invoice: inv-1.pdf (sha256 abcdef012345)')])
        self.assertEqual(spec['owner_id'], OWNER)
        self.assertEqual(spec['rows']['L1']['document_id'], DOC_A)
        self.assertEqual(spec['rows']['L1']['proof_links'], [{'kind': 'file', 'ref': 'Invoice: inv-1.pdf (sha256 abcdef012345)'}])
        self.assertEqual(counts, {'pending': 1, 'rows': 1, 'already_cited': 0})
        # what the sanctioned writer takes: the closed list of kinds, a bounded ref
        self.assertEqual(proof_links(spec['rows']['L1']['proof_links']), spec['rows']['L1']['proof_links'])

    def test_a_paper_the_decision_already_cites_is_left_out(self):
        cited = [{'kind': 'file', 'ref': 'Invoice: inv-1.pdf (sha256 abcdef012345)'}, {'kind': 'owner_ruling', 'ref': 'ruling'}]
        spec, counts = p.build_corrections(OWNER, [row('L1', 'Invoice: inv-1.pdf (sha256 abcdef012345)', links=cited)])
        self.assertEqual(spec['rows'], {})
        self.assertEqual(counts, {'pending': 0, 'rows': 0, 'already_cited': 1})

    def test_several_papers_for_one_decision_travel_together_and_a_repeat_is_one(self):
        rows = [row('L1', 'Invoice: a.pdf (sha256 111111111111)'), row('L1', 'Receipt: b.pdf (sha256 222222222222)'), row('L1', 'Invoice: a.pdf (sha256 111111111111)'), row('L2', 'Bill of sale: c.pdf (sha256 333333333333)', doc=DOC_B)]
        spec, counts = p.build_corrections(OWNER, rows)
        self.assertEqual([l['ref'] for l in spec['rows']['L1']['proof_links']], ['Invoice: a.pdf (sha256 111111111111)', 'Receipt: b.pdf (sha256 222222222222)'])
        self.assertEqual(spec['rows']['L2']['document_id'], DOC_B)
        self.assertEqual(counts, {'pending': 3, 'rows': 2, 'already_cited': 0})

    def test_two_decisions_that_share_a_local_id_stop_the_run_rather_than_cross_their_papers(self):
        with self.assertRaises(SystemExit):
            p.build_corrections(OWNER, [row('L1', 'Invoice: a.pdf (sha256 111111111111)', doc=DOC_A), row('L1', 'Invoice: b.pdf (sha256 222222222222)', doc=DOC_B)])

    def test_a_cell_without_citation_text_is_ignored_and_an_over_long_one_is_cut_to_the_writers_limit(self):
        spec, _ = p.build_corrections(OWNER, [row('L1', ''), row('L2', 'Invoice: ' + 'x' * 400)])
        self.assertNotIn('L1', spec['rows'])
        self.assertEqual(len(spec['rows']['L2']['proof_links'][0]['ref']), 300)


if __name__ == '__main__':
    unittest.main()
