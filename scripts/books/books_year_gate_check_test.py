#!/usr/bin/env python3
"""Checks of the recording path of books_year_gate_check.py on synthetic values: python3 scripts/books/books_year_gate_check_test.py

No database is touched: these test the SQL the script sends and how it words a failed run."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import books_year_gate_check as g

OWNER = '11111111-1111-4111-8111-111111111111'


class T(unittest.TestCase):
    def test_the_statement_bound_is_explicit_and_finite(self):
        self.assertEqual(g.bound_seconds(120), 120)
        self.assertEqual(g.bound_seconds(300), 300)
        for bad in (0, -5, 301, 10000):
            with self.assertRaises(SystemExit):
                g.bound_seconds(bad)

    def test_one_year_is_one_repeatable_read_transaction_with_the_signature_read_first(self):
        sql = g.record_sql(OWNER, 2024, 120)
        self.assertTrue(sql.startswith('begin isolation level repeatable read;'))
        self.assertIn("set local statement_timeout = '120s';", sql)
        self.assertIn("set local lock_timeout = '5s';", sql)
        self.assertNotRegex(sql, r"statement_timeout\s*=\s*'?0")
        order = [sql.index(part) for part in ('books_book_signature', 'books_gate_md5', 'clock_timestamp() as t0', 'books_year_gate(', 'clock_timestamp() as t1', 'books_gate_context(', 'record_books_gate_run(', 'commit;')]
        self.assertEqual(order, sorted(order))
        self.assertEqual(sql.count('begin'), 1)

    def test_the_denominators_are_read_in_the_same_transaction_and_stored_with_the_run_whose_clock_stops_at_the_gate(self):
        sql = g.record_sql(OWNER, 2024, 120)
        self.assertIn(f"books_gate_context('{OWNER}'::uuid, 2024)", sql)
        # started at t0, finished at t1 (the gate's end), the context as the last argument: the stored duration is the gate's own
        self.assertIn(":'t0'::timestamptz, :'t1'::timestamptz,", sql)
        self.assertRegex(sql, r"'books_year_gate_check.py', :'ctx'::jsonb\);")

    def test_the_run_is_filed_under_the_owner_and_year_it_was_run_for(self):
        sql = g.record_sql(OWNER, '2023', 120)
        self.assertIn(f"record_books_gate_run('{OWNER}'::uuid, 2023, 'complete'", sql)
        self.assertIn(f"books_year_gate('{OWNER}'::uuid, 2023)", sql)
        with self.assertRaises(ValueError):
            g.record_sql(OWNER, 'not a year', 120)

    def test_a_timeout_and_an_error_are_told_apart(self):
        timeout = 'psql:<stdin>:11: ERROR:  canceling statement due to statement timeout\nCONTEXT:  SQL function "x"'
        self.assertEqual(g.classify_failure(timeout), 'timed_out')
        self.assertEqual(g.classify_failure('ERROR:  canceling statement due to lock timeout'), 'timed_out')
        self.assertEqual(g.classify_failure('ERROR:  function public.books_gate_md5() does not exist'), 'error')
        self.assertEqual(g.short_error(timeout, 120), 'stopped at 120 s: canceling statement due to statement timeout')
        self.assertEqual(g.short_error('psql: connection to server failed', 120), 'psql: connection to server failed')

    def test_the_recorded_reason_is_bounded_and_carries_no_context_lines(self):
        long = 'psql:<stdin>:4: ERROR:  ' + 'x' * 900 + '\nCONTEXT:  PL/pgSQL function books_year_gate line 3'
        reason = g.short_error(long, 120)
        self.assertLessEqual(len(reason), 300)
        self.assertNotIn('CONTEXT', reason)

    def test_a_failed_run_is_written_in_a_second_transaction_with_quotes_safe(self):
        sql = g.failure_sql(OWNER, 2025, 'timed_out', '2026-10-29T18:00:00.000+00:00', '2026-10-29T18:02:00.000+00:00', "it's \"quoted\"; drop table x; --")
        self.assertTrue(sql.startswith('begin;'))
        self.assertIn("'timed_out'", sql)
        self.assertIn('books_book_signature', sql)
        self.assertRegex(sql, r"NULL, \$R[0-9a-f]{8}\$it's \"quoted\"; drop table x; --\$R[0-9a-f]{8}\$")


if __name__ == '__main__':
    unittest.main()
