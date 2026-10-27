#!/usr/bin/env python3
"""Reconciler checks on synthetic numbers: python3 scripts/books/vehicle_evidence_test.py"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vehicle_evidence as ve

V = '00000000-0000-0000-0000-000000000001'


def agreement(price, date='2030-03-01'):
    return ve.cand(V, 'sale', price, date, 'Buyer', 'pdf_form', 'pdf:a.pdf', 0.8, 'claim')


def dep(amount, date, vid=V, ev='deposit', role='proof'):
    return ve.cand(vid, ev, amount, date, None, 'gl', f'gl:{amount}:{date}', 0.9, role, channel='bank')


def pool(amount, date, cls='customer'):
    return ve.cand(None, 'unattributed_deposit', amount, date, None, 'gl', f'pool:{amount}:{date}', 0.3, 'pool', cls=cls)


class T(unittest.TestCase):
    def test_receipts_beyond_the_claim_win_and_conflict_is_shown(self):
        c = [agreement(10000), dep(8000, '2030-03-02'), dep(500, '2030-03-01'), pool(900, '2030-03-10'), pool(700, '2030-03-20'), pool(300, '2030-03-11', 'cash'),
             pool(5000, '2030-03-12', 'own_transfer')]
        r = ve.reconcile(c, set(), {})[0]
        self.assertEqual((r['status'], r['value']), ('reconciled', 10100.0))
        self.assertTrue(any('differs from receipts' in x for x in r['conflicts']))
        self.assertTrue(any('not by memo' in x for x in r['conflicts']))
        self.assertLess(r['confidence'], 0.95)

    def test_memo_named_receipts_alone_are_high_confidence(self):
        r = ve.reconcile([agreement(9000), dep(9000, '2030-03-02')], set(), {})[0]
        self.assertEqual((r['status'], r['value'], r['confidence']), ('reconciled', 9000.0, 0.95))
        self.assertEqual(r['conflicts'], [])

    def test_ruled_out_deposit_is_not_inferred(self):
        c = [agreement(5000), dep(1000, '2030-03-02'), pool(4000, '2030-03-03')]
        r = ve.reconcile(c, {('2030-03-03', 4000.0)}, {})[0]
        self.assertEqual(r['status'], 'claim_partly_proven')
        self.assertFalse(any(x['basis'].startswith('inferred') for x in r['components']))

    def test_no_receipts_keeps_the_claim_at_low_confidence(self):
        r = ve.reconcile([agreement(7000)], set(), {})[0]
        self.assertEqual((r['status'], r['value'], r['confidence']), ('claim_only', 7000.0, 0.5))

    def test_books_mention_alone_is_insufficient(self):
        c = [ve.cand(V, 'sale', 3000, '2030-01-01', None, 'books_record', 'books:x', 0.5, 'claim')]
        self.assertEqual(ve.reconcile(c, set(), {})[0]['status'], 'insufficient_evidence')

    def test_profile_difference_is_a_conflict(self):
        r = ve.reconcile([agreement(9000), dep(9000, '2030-03-02')], set(), {V: {'sale_price': 8000}})[0]
        self.assertTrue(any('profile holds' in x for x in r['conflicts']))

    def test_dates(self):
        self.assertEqual(ve.parse_date('september 2 2022'), '2022-09-02')
        self.assertEqual(ve.parse_date('MAY 14 2022'), '2022-05-14')
        self.assertEqual(ve.money('(1,200.50)'), 1200.5)


if __name__ == '__main__':
    unittest.main()
