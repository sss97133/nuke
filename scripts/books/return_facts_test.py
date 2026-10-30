#!/usr/bin/env python3
"""Builder checks for return_facts.py on synthetic facts: python3 scripts/books/return_facts_test.py

Covers the structured filing state (topic filing) and the optional actor on an open item. Nothing here touches the database."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import return_facts as rf

DOC = '00000000-0000-4000-8000-000000000001'


def fact(**extra):
    base = dict(year=2024, key='k', topic='other', status='settled', decision='Synthetic.', source='synthetic', date='2026-10-29')
    base.update(extra)
    return base


def filing(state='prepared', **extra):
    body = dict(state=state, as_of='2026-10-29', form='1040')
    body.update(extra)
    return fact(key='filing', topic='filing', filing=body)


def build(*facts):
    return rf.build_revision(dict(facts=list(facts)), {})


def cell(rev, key):
    return next(f for f in rev['fields'] if f['field_key'] == key)['value_normalized']


class T(unittest.TestCase):
    def refused(self, *facts, text):
        with self.assertRaises(SystemExit) as caught:
            build(*facts)
        self.assertIn(text, str(caught.exception))

    def test_a_filing_state_lands_with_its_structured_object_and_no_local_path(self):
        rev = build(filing('mail_ready', packet_pages=14, packet_document_id=DOC, deadline='2026-12-15', packet_pdf='/private/local/packet.pdf'))
        v = cell(rev, 'fact:2024:filing')
        self.assertEqual(v['topic'], 'filing')
        self.assertEqual(v['filing'], dict(state='mail_ready', as_of='2026-10-29', form='1040', packet_pages=14, packet_document_id=DOC, deadline='2026-12-15'))
        self.assertNotIn('packet_pdf', str(rev))
        self.assertNotIn('/private', str(rev))

    def test_every_state_is_accepted_and_an_unknown_one_is_not(self):
        for state in ('draft', 'prepared', 'on_hold', 'filed'):
            self.assertEqual(cell(build(filing(state)), 'fact:2024:filing')['filing']['state'], state)
        self.assertEqual(cell(build(filing('mailed', packet_document_id=DOC)), 'fact:2024:filing')['filing']['state'], 'mailed')
        self.refused(filing('ready'), text='filing.state must be one of')

    def test_mail_ready_needs_the_page_count_and_the_stored_draft_it_is_about(self):
        self.refused(filing('mail_ready', packet_document_id=DOC), text='needs the packet page count')
        self.refused(filing('mail_ready', packet_pages=14), text='needs packet_document_id')
        self.refused(filing('mailed'), text='needs packet_document_id')

    def test_the_page_count_and_the_dates_and_the_document_id_are_checked(self):
        self.refused(filing('draft', packet_pages=0), text='positive whole number')
        self.refused(filing('draft', packet_pages=True), text='positive whole number')
        self.refused(filing('draft', packet_pages='14'), text='positive whole number')
        self.refused(filing('draft', as_of='Oct 29'), text='filing.as_of must be a YYYY-MM-DD date')
        self.refused(filing('draft', deadline='soon'), text='filing.deadline must be a YYYY-MM-DD date')
        self.refused(filing('draft', packet_document_id='not-a-uuid'), text='lowercase uuid')
        self.refused(filing('draft', form=' '), text='filing.form is required')

    def test_a_filing_fact_is_never_open_and_needs_its_object(self):
        self.refused(dict(filing('draft'), status='open', closes_with='x'), text='never open')
        self.refused(fact(key='filing', topic='filing'), text='needs a filing object')
        self.refused(fact(filing=dict(state='draft', as_of='2026-10-29', form='1040')), text='belongs to a fact with topic filing')

    def test_pages_come_from_the_pdf_when_not_given(self):
        original = rf.pdf_pages
        rf.pdf_pages = lambda path: 9
        try:
            v = cell(build(filing('mail_ready', packet_pdf='/x/packet.pdf', packet_document_id=DOC)), 'fact:2024:filing')
        finally:
            rf.pdf_pages = original
        self.assertEqual(v['filing']['packet_pages'], 9)
        self.assertEqual(rf.pages_from_pdfinfo('Title: x\nPages:          14\nEncrypted: no\n'), 14)
        self.assertIsNone(rf.pages_from_pdfinfo('no page line'))

    def test_an_open_item_may_name_who_closes_it(self):
        for actor in ('owner', 'cpa', 'agent'):
            rev = build(fact(key='open1', status='open', closes_with='a signature', actor=actor))
            self.assertEqual(cell(rev, 'fact:2024:open1')['actor'], actor)
        self.assertNotIn('actor', cell(build(fact(key='open2', status='open', closes_with='a form')), 'fact:2024:open2'))

    def test_an_actor_is_one_of_three_and_only_on_an_open_item(self):
        self.refused(fact(key='open1', status='open', closes_with='x', actor='accountant'), text='actor is owner | cpa | agent')
        self.refused(fact(key='done', status='settled', actor='owner'), text='only on an open item')

    def test_the_older_rules_still_hold(self):
        self.refused(fact(topic='nonsense'), text='bad topic or status')
        self.refused(fact(key='o', status='open'), text='must say what closes it')
        with self.assertRaises(SystemExit):
            build(fact(key='dup'), fact(key='dup'))


if __name__ == '__main__':
    unittest.main()
