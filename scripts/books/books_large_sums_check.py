#!/usr/bin/env python3
"""Check: where the dollars are, and whether the large sums carry proof (v_books_large_sums, books_year_gate R12).

Read-only: every statement runs as the service role in a transaction that is rolled back. Three parts:
  1. unit test   the view's own SQL (from the migration file) over synthetic rows, with the views and tables it reads replaced by CTEs:
                 ranking by dollars, the 80% head (including the exact-80% edge), each basis_strength and proof_flag, NULL payment proof,
                 credits, a second owner and a second year; and the document layer: which kind of paper each category requires, which cites
                 and which Nuke documents satisfy it (and which do not: retired, revoked, unapproved, too weak), vehicles tied through the
                 books_decision documents; and the message-thread rule (owner ruling 2026-10-29): which cites of a Messages / chat.db, iMessage, SMS,
                 WhatsApp, Marketplace, Craigslist or Gmail thread count as the invoice or agreement and as the purchase agreement, which do not (a
                 search that found nothing, no date or id, a bare Gmail message id, a receipt or order, a lease), and that a real document wins over a
                 thread. No books data is read.
  2. invariants  on the live books (the deployed views, or the migration's with --migration): the view's rows tie out to their sources
                 (the audit tiers' deduction rows and the rollup the office page shows, the Revenue decisions), the ranking and the
                 cumulative share are arithmetic over those rows, the head is the smallest top set reaching 80%, the basis_strength of every row
                 follows from the ruling ids, ruling refs and document cites the row carries, and the required document kind follows from the
                 category (an independent copy of the keyword rules); a row reports doc_message_only exactly when a message thread is the only
                 document, and an independent copy of the message-thread test agrees with the view.
  3. findings    per year the head, the dollars in it, and the head rows R12 flags, by flag, with the largest, and the head rows that miss the
                 document their kind requires, by kind; the head rows that rest on a message thread alone; the flagged head rows whose only cites
                 are message threads that did not count (and why). A year with a flagged head row is a FAIL (the books, not the view). --expect
                 YEAR:RANK:FLAG states what the deduction at that dollar rank must be (FLAG = filed_return_only | no_payment_proof | no_basis |
                 missing_doc | ok).
  --with-gate    also runs books_year_gate (slow: about 12 to 45 s a year) and requires R12 to equal part 3 (n, dollars, head size, ids, missing
                 documents) and R11 to be present; with --migration the gate is the migration's copy, created as books_year_gate_pending inside
                 the rolled-back transaction.
Timings of the reads are printed; --max-seconds fails a read that takes longer.
Exit 1 on a failed unit test or invariant, or on a year with flagged head rows (--report: exit 0 on findings alone).

  dotenvx run -- python3 scripts/books/books_large_sums_check.py --owner <uuid> [--years 2022 2023 2024 2025]
      [--migration supabase/migrations/20261105190000_books_large_sums_message_threads.sql] [--expect 2024:1:ok ...] [--with-gate] [--before-after] [--report]
"""
import argparse
import re
import sys
from decimal import Decimal

from books_check_sql import money, run, uuid_ok, view_sql, with_substituted_views

DEFAULT_MIGRATION = 'supabase/migrations/20261105190000_books_large_sums_message_threads.sql'
VIEWS = ('v_books_large_sums',)
FLAGS = ('filed_return_only', 'no_payment_proof', 'no_basis', 'missing_doc')
FILED_ID = re.compile(r'RULING-(filed|Schedule C|car-basis)')
FILED_REF = re.compile(r'owner ruling on the filed [0-9]{4} schedule c', re.I)

# An independent copy of the keyword rules, first match on the category wins (PostgreSQL \m and \M become \b). The view is the policy;
# this copy only detects a change nobody meant to make.
RULES = [
    ('depreciation', r'schedule c line 13\b|\bdepreciation\b|section 179', 'register_asset'),
    ('rent', r'schedule c line 20[ab]\b|\brent\b', 'lease_or_ruling'),
    ('transport', r'\b(transport|freight|hauling|delivery)\b', 'invoice_or_agreement'),
    ('vehicle_deal', r'acquisition|\bbought\b|\bcommissions?\b|consign|\bpurchase\b', 'purchase_agreement'),
    ('parts_supplies', r'schedule c line 22\b|\b(parts?|materials?|supplies|tools?|equipment)\b', 'receipt_or_order'),
    ('contractor', r'schedule c line (11|17)\b|contract labor|\bcontractors?\b|\blabor\b|retouch|artists|professional fees|legal and professional|painting|bodywork|plating',
     'invoice_or_agreement'),
    ('cost_of_goods', r'schedule c line 4\b|cost of goods', 'invoice_or_agreement'),
]
LEVEL = {'purchase_agreement': 3, 'invoice_or_agreement': 2, 'receipt_or_order': 1}

# An independent copy of the message-thread test (PostgreSQL \m and \M become \b). A cite counts when its ref names the medium, locates the exchange by a date or
# an id, and does not record a search with no result. A Gmail cite needs the word thread: a bare Gmail message id is one message, not an exchange.
MEDIUM = re.compile(r'chat\.db|library/messages|\bmessages? handle|\bi-?messages?\b|\bsms\b|\btext messages?\b|\btext (thread|exchange|conversation)\b|\btexts (with|from|to|between)\b'
                    r'|\btexted\b|whatsapp|\b(facebook|fb) (messenger|messages?|chat)\b|\bmessenger\b'
                    r'|\b(marketplace|craigslist)\b.{0,40}\b(thread|messages?|chat|conversation|repl(y|ies)|exchange)\b'
                    r'|\b(thread|messages?|chat|conversation|exchange)\b.{0,40}\b(marketplace|craigslist)\b|\b(gmail|e-?mail) (thread|exchange|chain)\b')
NO_RESULT = re.compile(r'searched,? no |earliest message|nothing found|none found|not found|found nothing'
                       r'|\bno (relevant |matching |such |cash-use |other )?(messages?|chat|texts?|evidence|threads?|hits?|results?|matches)\b')
LOCATOR = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* [0-9]{1,2}\b'
                     r'|\b[0-9]{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|[0-9]{5,}|\b[0-9a-f]{12,}\b')


def names_medium(c):
    ref = (c.get('ref') or '').lower()
    return bool(MEDIUM.search(ref) or (c.get('kind') == 'gmail' and re.search(r'\bthread\b', ref)))


def is_message_thread(c):
    ref = (c.get('ref') or '').lower()
    return names_medium(c) and not NO_RESULT.search(ref) and bool(LOCATOR.search(ref))

problems, findings = [], []


def ok(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        problems.append(msg)


# ---------------------------------------------------------------- 1. unit test over synthetic rows

A, B = '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
TIER_COLS = ('id uuid, owner_id uuid, document_id uuid, year text, local_id text, amount numeric, category text, description text, tier text, '
             'pay_proof boolean, doc_proof boolean, purpose_proof boolean, proof_basis text, has_owner_ruling boolean, ruling_id text, '
             'payment_cites jsonb, document_cites jsonb, ruling_cites jsonb, is_summary_row boolean, is_deduction boolean')
REC_COLS = ('id uuid, owner_id uuid, document_id uuid, year text, local_id text, record_kind text, section text, category text, description text, '
            'status text, amount_value numeric, source_key text, record jsonb')
RULE_COLS = 'owner_id uuid, section text, category text, basis text, citation text'
REGISTER_COLS = 'owner_id uuid, year text, local_id text, asset_id text, kind text'
NUKE_COLS = {
    'vehicle_documents': 'id uuid, vehicle_id uuid, document_type text, file_url text, amount numeric',
    'deal_documents': 'id uuid, vehicle_id uuid, document_type text',
    'receipt_vehicle_links': 'receipt_id uuid, vehicle_id uuid, status text, retired_at timestamptz',
    'ownership_verifications': 'id uuid, vehicle_id uuid, status text, title_document_url text',
    'vehicle_images': 'id uuid, vehicle_id uuid, is_document boolean, document_classification text, document_category text',
    'vehicle_listing_documents': 'id bigint, vehicle_id uuid, doc_type text, revoked_at timestamptz, amount numeric',
    'receipts': 'id uuid, total numeric, total_amount numeric',
    'secure_documents': 'id uuid, document_type text, upload_metadata jsonb',
}
EXTRACTION_COLS = 'owner_id uuid, document_id uuid, field_key text, value_normalized jsonb, is_superseded boolean'
DOCUMENT_COLS = 'id uuid, owner_id uuid, source_filename text'
_n = [0]


def uid():
    _n[0] += 1
    return '00000000-0000-0000-0000-%012d' % _n[0]


def ruling(rid, filed=False):
    ref = f'{rid}: owner ruling on the filed 2099 Schedule C line 10 total' if filed else f'{rid}: owner ruling 26 Oct 2026'
    return {'kind': 'owner_ruling', 'ref': ref}


DOC = {'kind': 'file', 'ref': 'receipt.pdf'}


def cite(kind, ref):
    return {'kind': kind, 'ref': ref}


def t(local_id, amount, year='2099', owner=A, tier='B', pay=True, doc=False, purpose=True, basis='bank_line', rid='', rcites=(), summary=False, ded=True,
      cat='c', dcites=None):
    dc = list(dcites) if dcites is not None else ([DOC] if doc else [])
    return dict(id=uid(), owner_id=owner, document_id=uid(), year=year, local_id=local_id, amount=amount, category=cat, description='d', tier=tier,
                pay_proof=pay, doc_proof=doc or bool(dc), purpose_proof=purpose, proof_basis=basis, has_owner_ruling=bool(rid or rcites), ruling_id=rid,
                payment_cites=['bank:x'] if pay else [], document_cites=dc, ruling_cites=list(rcites), is_summary_row=summary, is_deduction=ded)


def v(local_id, amount, bank=(), proof=(), cat='Cat A', rid='', status='Included', owner=A, year='2099', section='Revenue', rid_=None, source_key=None):
    rec = {'bank_links': list(bank), 'proof_links': list(proof), 'ruling_id': rid}
    return dict(id=rid_ or uid(), owner_id=owner, document_id=uid(), year=year, local_id=local_id, record_kind='retained_ledger_decision', section=section,
                category=cat, description='d', status=status, amount_value=amount, source_key=source_key, record=rec)


SYN_TIERS = [
    # 2099, owner A, deductions. Gross 1040; 80% = 832; ranked by absolute amount; the head is the first three (running 500, 800, 900).
    t('D-FILED', 500, rid='2099-RULING-filed-10', rcites=[ruling('2099-RULING-filed-10', True)]),
    t('D-DOC', 300, tier='A', doc=True),
    t('D-RULED', 100, rid='2099-RULING-dep-x', rcites=[ruling('2099-RULING-dep-x')]),
    t('D-RULE', 50),
    t('D-CREDIT', -40, rid='2099-FIND-credit', rcites=[ruling('2099-FIND-credit')]),
    t('D-DOC-NOPAY', 20, tier='C', pay=None, doc=True, basis=None),
    t('D-NOBASIS', 10, tier='C', purpose=False, basis=None),
    t('D-RULING-NOPAY', 10, tier='C', pay=None, basis=None, rid='2099-RULING-y', rcites=[ruling('2099-RULING-y')]),
    t('D-MIXED', 5, rid='2099-RULING-filed-9', rcites=[ruling('2099-RULING-filed-9', True), ruling('2099-RULING-other')]),
    t('D-REGISTER', 3, pay=False, basis='asset_register', rid='2099-RULING-dep-y', rcites=[ruling('2099-RULING-dep-y')]),
    t('D-SUMMARY', 2, tier='C', pay=None, purpose=False, basis=None, summary=True),
    t('D-ZERO', 0),
    t('D-EXCLUDED', 999, tier='X', ded=False),
    t('O-ONLY', 7, owner=B),                                                  # another owner: its own partition
    # 2098, owner A: gross 1000, 80% = 800: 400 + 400 reach exactly 80%, so the third row (running 800 before it) is outside the head
    t('Y-1', 400, year='2098', tier='A', doc=True), t('Y-2', 400, year='2098', tier='A', doc=True),
    t('Y-3', 100, year='2098'), t('Y-4', 100, year='2098'),
]
SYN_RECS = [
    v('V-BANKRULE', 1000, bank=['m1']),
    v('V-DOC', 800, bank=['m2'], proof=[DOC]),
    v('V-NOPAY', 600),
    v('2099-RULING-filed-1', 400, cat='Cat Z'),                              # the filed return's own summary row
    v('V-NOBASIS', 300, bank=['m5'], cat='Cat Z'),
    v('V-FILEDRULED', 200, bank=['m6'], cat='Cat Z', rid='2099-RULING-filed-1x', proof=[ruling('2099-RULING-filed-1x', True)]),
    v('V-CLOSED', 100, bank=['m9'], status='Closed: not claimed'),
    v('V-NEG', -50, bank=['m7']),
    v('V-BANKID', 25),
]
SYN_RECS[-1]['local_id'] = '2099-BANK-0001'                                    # a decision that is itself a bank line
SYN_RULES = [dict(owner_id=A, section='Revenue', category='Cat A', basis='return_facts_line_map', citation='x'),
             dict(owner_id=A, section='Expense', category='Cat Z', basis='owner_ruling', citation='y')]   # an Expense rule must not count for Revenue

# (kind, year, local_id): (dollar_rank, tier, basis_strength, proof_flag, in_head)
EXPECT = {
    ('deduction', '2099', 'D-FILED'): (1, 'B', 'filed_return_only', 'filed_return_only', True),
    ('deduction', '2099', 'D-DOC'): (2, 'A', 'documented', None, True),
    ('deduction', '2099', 'D-RULED'): (3, 'B', 'bank_and_rule', None, True),
    ('deduction', '2099', 'D-RULE'): (4, 'B', 'bank_and_rule', None, False),
    ('deduction', '2099', 'D-CREDIT'): (5, 'B', 'bank_and_rule', None, False),
    ('deduction', '2099', 'D-DOC-NOPAY'): (6, 'C', 'documented', 'no_payment_proof', False),
    ('deduction', '2099', 'D-NOBASIS'): (7, 'C', 'none', 'no_basis', False),
    ('deduction', '2099', 'D-RULING-NOPAY'): (8, 'C', 'none', 'no_payment_proof', False),
    ('deduction', '2099', 'D-MIXED'): (9, 'B', 'bank_and_rule', None, False),
    ('deduction', '2099', 'D-REGISTER'): (10, 'B', 'bank_and_rule', None, False),
    ('deduction', '2099', 'D-SUMMARY'): (11, 'C', 'filed_return_only', 'filed_return_only', False),
    ('deduction', '2099', 'D-ZERO'): (12, 'B', 'bank_and_rule', None, False),
    ('deduction', '2098', 'Y-1'): (1, 'A', 'documented', None, True),
    ('deduction', '2098', 'Y-2'): (2, 'A', 'documented', None, True),
    ('deduction', '2098', 'Y-3'): (3, 'B', 'bank_and_rule', None, False),
    ('deduction', '2098', 'Y-4'): (4, 'B', 'bank_and_rule', None, False),
    ('revenue', '2099', 'V-BANKRULE'): (1, 'B', 'bank_and_rule', None, True),
    ('revenue', '2099', 'V-DOC'): (2, 'A', 'documented', None, True),
    ('revenue', '2099', 'V-NOPAY'): (3, 'C', 'none', 'no_payment_proof', True),
    ('revenue', '2099', '2099-RULING-filed-1'): (4, 'C', 'filed_return_only', 'filed_return_only', True),
    ('revenue', '2099', 'V-NOBASIS'): (5, 'C', 'none', 'no_basis', False),
    ('revenue', '2099', 'V-FILEDRULED'): (6, 'B', 'filed_return_only', 'filed_return_only', False),
    ('revenue', '2099', 'V-NEG'): (7, 'B', 'bank_and_rule', None, False),
    ('revenue', '2099', '2099-BANK-0001'): (8, 'B', 'bank_and_rule', None, False),
}

# ---- the document layer, year 2097, owner A (amounts are 100 so none of them changes the ranking tests above)
VEH = {n: '999999%02d-0000-0000-0000-000000000000' % n for n in range(1, 12)}
CAT_DEAL, CAT_PARTS, CAT_LABOR, CAT_RENT, CAT_DEP = ('Vehicle disposition acquisition/job costs', 'Car restoration — parts & materials',
                                                     'Car restoration — labor (contractors)', 'Workshop rent', 'Schedule C line 13: Depreciation: shop machines')
FILED20 = dict(rid='2099-RULING-filed-20b', rcites=[ruling('2099-RULING-filed-20b', True)])
DOCROWS = [  # (row, expected required_doc_kind, rule, missing_doc, expected doc_found sources, expected doc_found_n)
    (t('C-COMM-MISS', 100, year='2097', cat='Schedule C line 10: Commissions and fees', rid='2099-RULING-filed-10', rcites=[ruling('2099-RULING-filed-10', True)]),
     'purchase_agreement', 'vehicle_deal', True, [], 0),
    (t('C-COMM-PA', 100, year='2097', cat='Schedule C line 10: Commissions and fees', dcites=[cite('gmail', 'FJ80 purchase agreement, price 12,500')]),
     'purchase_agreement', 'vehicle_deal', False, ['proof_links'], 1),
    (t('C-COMM-INV', 100, year='2097', cat='Schedule C line 10: Commissions and fees', dcites=[cite('gmail', 'invoice 1234 for the commission')]),
     'purchase_agreement', 'vehicle_deal', True, [], 0),
    (t('P-ORDER', 100, year='2097', cat=CAT_PARTS, dcites=[cite('file', 'Amazon order 112-3456')]), 'receipt_or_order', 'parts_supplies', False, ['proof_links'], 1),
    (t('P-MISS', 100, year='2097', cat=CAT_PARTS), 'receipt_or_order', 'parts_supplies', True, [], 0),
    (t('K-INV', 100, year='2097', cat=CAT_LABOR, dcites=[cite('gmail', 'invoice from the painter')]), 'invoice_or_agreement', 'contractor', False, ['proof_links'], 1),
    (t('K-RECEIPT', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'receipt for labor')]), 'invoice_or_agreement', 'contractor', True, [], 0),
    (t('K-SHEET', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'timesheet week ending 9/30/2024, 28 h')]), 'invoice_or_agreement', 'contractor', False, ['proof_links'], 1),
    (t('K-PAYMENTS', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'Apple-Cash-all-payment-events-reviewed.csv line 12')]), 'invoice_or_agreement', 'contractor', True, [], 0),
    (t('P-HISTORY', 100, year='2097', cat=CAT_PARTS, dcites=[cite('file', 'Snap-on-original-history.txt')]), 'receipt_or_order', 'parts_supplies', False, ['proof_links'], 1),
    (t('R-RULING', 100, year='2097', cat=CAT_RENT, rid='2099-RULING-674-rent', rcites=[ruling('2099-RULING-674-rent')]),
     'lease_or_ruling', 'rent', False, ['owner_ruling'], 1),
    (t('R-FILED', 100, year='2097', cat=CAT_RENT, **FILED20), 'lease_or_ruling', 'rent', True, [], 0),
    (t('R-LEASE', 100, year='2097', cat=CAT_RENT, dcites=[cite('file', 'lease agreement 674 Wells Rd')]), 'lease_or_ruling', 'rent', False, ['proof_links'], 1),
    (t('D-REG', 100, year='2097', cat=CAT_DEP, pay=False, basis='asset_register'), 'register_asset', 'depreciation', False, ['asset_register'], 1),
    (t('D-REG-PAID', 100, year='2097', cat=CAT_DEP), 'register_asset', 'depreciation', False, ['asset_register'], 1),     # claimed by the register, proven by its bank line
    (t('D-NOREG', 100, year='2097', cat=CAT_DEP, tier='C', pay=False, basis=None), 'register_asset', 'depreciation', True, [], 0),
    (t('U-NONE', 100, year='2097', cat='Utilities, phone & internet'), None, None, False, [], 0),
    (t('X-CREDIT', -50, year='2097', cat=CAT_PARTS), None, None, False, [], 0),
    (t('V-LINKED-OK', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', False, ['deal_documents'], 1),
    (t('V-LINKED-LOW', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', True, [], 0),
    (t('V-LINKED-TITLE', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', False, ['ownership_verifications'], 1),
    (t('V-UNLINKED', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', True, [], 0),
    (t('V-LINKED-RETIRED', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', True, [], 0),
    (t('V-IMG', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', False, ['vehicle_images'], 1),
    (t('V-MANY', 100, year='2097', cat=CAT_PARTS), 'receipt_or_order', 'parts_supplies', False, ['receipts'] * 5, 7),
    (t('V-AMT-NO', 100, year='2097', cat=CAT_PARTS), 'receipt_or_order', 'parts_supplies', True, [], 0),               # a receipt of another amount on the vehicle is not this expense's
    (t('V-AMT-YES', 100, year='2097', cat=CAT_PARTS), 'receipt_or_order', 'parts_supplies', False, ['vehicle_documents'], 1),   # a vehicle document of the same amount is
    (t('V-TITLE-NOT-INVOICE', 100, year='2097', cat=CAT_LABOR), 'invoice_or_agreement', 'contractor', True, [], 0),    # the vehicle's title is not a labor invoice
    (t('V-SECURE', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', False, ['secure_documents'], 1),   # the owner's title scan names the vehicle
    # rent: a stored R7 use group that names the decision documents it
    (t('R-USEGROUP', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', False, ['use_group'], 1),
    (t('R-USEGROUP-FILED', 100, year='2097', cat=CAT_RENT, **FILED20), 'lease_or_ruling', 'rent', False, ['use_group'], 1),   # the group, not the filed ruling, is the basis
    (t('R-SUPERSEDED', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', True, [], 0),        # a superseded group counts for nothing
    (t('R-OTHER-OWNER', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', True, [], 0),       # a group of another owner counts for nothing
    (t('R-STRING-DECISIONS', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', True, [], 0),  # a cell whose decisions are not a list is skipped, not an error
    (t('R-NOT-USE', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', True, [], 0),           # an asset cell naming it is not a use group
    (t('R-NO-CITES', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', True, [], 0),          # a use cell without cites is not one R7 reads
    (t('R-OTHER-FILE', 100, year='2097', cat=CAT_RENT), 'lease_or_ruling', 'rent', True, [], 0),        # a cell of another document is not the register inputs
    (t('K-USEGROUP', 100, year='2097', cat=CAT_LABOR), 'invoice_or_agreement', 'contractor', True, [], 0),   # contractor rows stay strict even inside a use group
    (t('P-USEGROUP', 100, year='2097', cat=CAT_PARTS), 'receipt_or_order', 'parts_supplies', True, [], 0),   # so do parts rows
]
# ---- the message-thread rule, year 2097: (row, required kind, rule, missing, doc_found sources, doc_found_n, doc_found_kind, doc_message_only)
CHAT = '~/Library/Messages/chat.db handle h-001, 2024-10-23, message ids 5521 5522: painter names the job and the price'
MSGROWS = [
    (t('M-K-CHATDB', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', CHAT)]), 'invoice_or_agreement', 'contractor', False, ['proof_links'], 1, 'message thread', True),
    (t('M-K-IMESSAGE', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'iMessage with the painter 2025-03-03: job and price agreed')]),
     'invoice_or_agreement', 'contractor', False, ['proof_links'], 1, 'message thread', True),
    (t('M-K-SMS', 100, year='2097', cat=CAT_LABOR, dcites=[cite('artifact', 'SMS thread screenshot 03/04/2025')]), 'invoice_or_agreement', 'contractor', False, ['proof_links'], 1,
     'message thread', True),
    (t('M-K-TEXTS', 100, year='2097', cat=CAT_LABOR, dcites=[cite('photo', 'texts with the welder, 14 Feb 2025 (price in the second text)')]), 'invoice_or_agreement', 'contractor', False,
     ['proof_links'], 1, 'message thread', True),
    (t('M-K-WHATSAPP', 100, year='2097', cat=CAT_LABOR, dcites=[cite('artifact', 'WhatsApp chat export 2025-02-01')]), 'invoice_or_agreement', 'contractor', False,
     ['proof_links'], 1, 'message thread', True),
    (t('M-K-FB', 100, year='2097', cat=CAT_LABOR, dcites=[cite('artifact', 'Facebook Marketplace thread 2025-06-03, seller agreed the price')]), 'invoice_or_agreement',
     'contractor', False, ['proof_links'], 1, 'message thread', True),
    (t('M-K-CL', 100, year='2097', cat=CAT_LABOR, dcites=[cite('artifact', 'Craigslist reply thread, 3 Jun 2025')]), 'invoice_or_agreement', 'contractor', False,
     ['proof_links'], 1, 'message thread', True),
    (t('M-K-GMAILTHREAD', 100, year='2097', cat=CAT_LABOR, dcites=[cite('gmail', 'Gmail thread abcdef0123456789: quote and price for the paint')]), 'invoice_or_agreement',
     'contractor', False, ['proof_links'], 1, 'message thread', True),
    (t('M-T-GMAILTHREAD', 100, year='2097', cat='Freight and delivery', dcites=[cite('gmail', 'Gmail thread abcdef0123456789: carrier quote and price')]),
     'invoice_or_agreement', 'transport', False, ['proof_links'], 1, 'message thread', True),
    # cites that name a message but do not count
    (t('M-K-GMAILMSG', 100, year='2097', cat=CAT_LABOR, dcites=[cite('gmail', 'Gmail message id 0123456789abcdef')]), 'invoice_or_agreement', 'contractor', True, [], 0, None, False),
    (t('M-K-NOLOCATOR', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'iMessage with the painter')]), 'invoice_or_agreement', 'contractor', True, [], 0, None, False),
    (t('M-K-SEARCHED', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', '~/Library/Messages/chat.db 2025-08-19..22 searched, no cash-use message')]),
     'invoice_or_agreement', 'contractor', True, [], 0, None, False),
    (t('M-K-EARLIEST', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'chat.db: earliest message 2024-07-17, so no 2022 chat evidence exists on this computer')]),
     'invoice_or_agreement', 'contractor', True, [], 0, None, False),
    (t('M-K-PLAINTEXT', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'plain text export 2025-03-03 of the price list')]), 'invoice_or_agreement', 'contractor', True, [], 0, None, False),
    (t('M-K-LISTING', 100, year='2097', cat=CAT_LABOR, dcites=[cite('artifact', 'Facebook Marketplace listing 2025-06-03')]), 'invoice_or_agreement', 'contractor', True, [], 0, None, False),
    (t('M-K-RULINGONLY', 100, year='2097', cat=CAT_LABOR, rid='2099-RULING-x', rcites=[dict(kind='owner_ruling', ref='2099-RULING-x: texts with the painter 2025-03-03')]),
     'invoice_or_agreement', 'contractor', True, [], 0, None, False),                                   # a ruling that mentions texts is a ruling, not a document
    # a real document wins over a thread, and the thread is then not listed
    (t('M-K-BOTH', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', CHAT), cite('gmail', 'invoice from the painter')]), 'invoice_or_agreement', 'contractor', False,
     ['proof_links'], 1, 'invoice or agreement', False),
    (t('M-K-BOTH-ONECITE', 100, year='2097', cat=CAT_LABOR, dcites=[cite('file', 'iMessage 2025-03-03 painter sent the invoice for the job')]), 'invoice_or_agreement', 'contractor',
     False, ['proof_links'], 1, 'message thread', True),                                                # one cite that is both is read as the thread it is
    # strict kinds
    (t('M-P-RECEIPT', 100, year='2097', cat=CAT_PARTS, dcites=[cite('file', CHAT)]), 'receipt_or_order', 'parts_supplies', True, [], 0, None, False),
    (t('M-P-RECEIPT-ORDER', 100, year='2097', cat=CAT_PARTS, dcites=[cite('file', CHAT), cite('file', 'Amazon order 112-3456')]), 'receipt_or_order', 'parts_supplies', False,
     ['proof_links'], 1, 'receipt or order', False),
    (t('M-R-RENT', 100, year='2097', cat=CAT_RENT, dcites=[cite('file', CHAT)]), 'lease_or_ruling', 'rent', True, [], 0, None, False),
    (t('M-D-DEP', 100, year='2097', cat=CAT_DEP, tier='C', pay=False, basis=None, dcites=[cite('file', CHAT)]), 'register_asset', 'depreciation', True, [], 0, None, False),
    # vehicle and equipment purchases: the thread is the purchase agreement when no bill of sale or title is found
    (t('M-V-THREAD', 100, year='2097', cat=CAT_DEAL, dcites=[cite('artifact', 'Facebook Marketplace thread 2025-06-03, seller agreed the price')]), 'purchase_agreement',
     'vehicle_deal', False, ['proof_links'], 1, 'message thread', True),
    (t('M-V-EQUIPMENT', 100, year='2097', cat='Equipment purchase', dcites=[cite('file', CHAT)]), 'purchase_agreement', 'vehicle_deal', False, ['proof_links'], 1, 'message thread', True),
    (t('M-V-BOS', 100, year='2097', cat=CAT_DEAL, dcites=[cite('file', 'bill of sale 2025-06-03'), cite('artifact', 'Facebook Marketplace thread 2025-06-03')]), 'purchase_agreement',
     'vehicle_deal', False, ['proof_links'], 1, 'purchase agreement, bill of sale or title', False),
    (t('M-V-LINKED-TITLE', 100, year='2097', cat=CAT_DEAL, dcites=[cite('artifact', 'Facebook Marketplace thread 2025-06-03')]), 'purchase_agreement', 'vehicle_deal', False,
     ['ownership_verifications'], 1, 'title', False),                                                   # the vehicle's approved title is found; the thread is not listed beside it
    (t('M-V-NOTHING', 100, year='2097', cat=CAT_DEAL), 'purchase_agreement', 'vehicle_deal', True, [], 0, None, False),
]
DOCROWS += [m[:6] for m in MSGROWS]
SYN_TIERS += [r[0] for r in DOCROWS]
LINKED = {'V-LINKED-OK': 1, 'V-LINKED-LOW': 2, 'V-LINKED-TITLE': 3, 'V-LINKED-RETIRED': 4, 'V-IMG': 5, 'V-MANY': 6, 'V-AMT-NO': 8, 'V-AMT-YES': 9, 'V-TITLE-NOT-INVOICE': 3, 'V-SECURE': 10, 'M-V-LINKED-TITLE': 11}
_by_local = {r[0]['local_id']: r[0] for r in DOCROWS}
for local, vn in LINKED.items():                                          # the decision record carries the source_key the link job wrote
    SYN_RECS.append(v(local, 100, section='Expense', year='2097', rid_=_by_local[local]['id'], source_key='sk-' + local))
SYN_REGISTER = [dict(owner_id=A, year='2097', local_id='D-REG', asset_id='asset-1', kind='claim'), dict(owner_id=A, year='2097', local_id='D-REG-PAID', asset_id='asset-2', kind='claim'),
                dict(owner_id=A, year='2097', local_id='D-NOREG', asset_id='asset-9', kind='unclaimed')]          # an unclaimed line 13 row is not a register asset
RCPT_LOW, RCPT_99, RCPT_MANY, DOC_REG_B = uid(), uid(), [uid() for _ in range(7)], uid()
DOC_REG, DOC_OTHER = uid(), uid()
def cell(owner, key, decisions, doc=DOC_REG, superseded=False, cites=True):
    value = {'key': key, 'year': '2097', 'pct': 1.0, 'base': 1, 'desc': 'd', 'decisions': decisions}
    if cites:
        value['cites'] = {'pct': 'owner standing ruling: the shop rent is 100% business', 'base': 'lease', 'decisions': 'books decisions named here'}
    return dict(owner_id=owner, document_id=doc, field_key=f'use:2097:{key}', value_normalized={'value': value}, is_superseded=superseded)


SYN_DOCUMENTS = [dict(id=DOC_REG, owner_id=A, source_filename='books-register-inputs.txt'), dict(id=DOC_OTHER, owner_id=A, source_filename='other.txt'),
                 dict(id=DOC_REG_B, owner_id=B, source_filename='books-register-inputs.txt')]
SYN_EXTRACTIONS = [
    cell(A, 'rent-x', ['R-USEGROUP', 'R-USEGROUP-FILED', 'K-USEGROUP', 'P-USEGROUP']),
    cell(A, 'rent-old', ['R-SUPERSEDED'], superseded=True),
    cell(B, 'rent-b', ['R-OTHER-OWNER'], doc=DOC_REG_B),
    cell(A, 'rent-str', 'books decisions named here'),
    dict(owner_id=A, document_id=DOC_REG, field_key='asset:x', value_normalized={'value': {'key': 'x', 'cites': {'pct': 'p'}, 'decisions': ['R-NOT-USE']}}, is_superseded=False),
    cell(A, 'rent-nocites', ['R-NO-CITES'], cites=False),
    cell(A, 'rent-otherfile', ['R-OTHER-FILE'], doc=DOC_OTHER),
]
SYN_NUKE = {
    'vehicle_documents': [dict(id=uid(), vehicle_id=VEH[vn], document_type='books_decision', file_url=f'nuke-books://{A}/sk-{local}', amount=None) for local, vn in LINKED.items()]
                         + [dict(id=uid(), vehicle_id=VEH[2], document_type='provenance_citation', file_url='x', amount=None),
                            dict(id=uid(), vehicle_id=VEH[9], document_type='receipt', file_url='y', amount=100)],
    'deal_documents': [dict(id=uid(), vehicle_id=VEH[1], document_type='bill_of_sale'), dict(id=uid(), vehicle_id=VEH[2], document_type='odometer_disclosure'),
                       dict(id=uid(), vehicle_id=VEH[7], document_type='bill_of_sale')],                      # VEH[7] is tied to no decision
    'receipt_vehicle_links': [dict(receipt_id=RCPT_LOW, vehicle_id=VEH[2], status='linked', retired_at=None),
                              dict(receipt_id=uid(), vehicle_id=VEH[4], status='linked', retired_at='2026-10-01T00:00:00Z'),
                              dict(receipt_id=uid(), vehicle_id=VEH[4], status='held', retired_at=None),
                              dict(receipt_id=RCPT_99, vehicle_id=VEH[8], status='linked', retired_at=None)]
                             + [dict(receipt_id=r, vehicle_id=VEH[6], status='linked', retired_at=None) for r in RCPT_MANY],
    'ownership_verifications': [dict(id=uid(), vehicle_id=VEH[3], status='approved', title_document_url='u'),
                                dict(id=uid(), vehicle_id=VEH[4], status='pending', title_document_url='u'),
                                dict(id=uid(), vehicle_id=VEH[11], status='approved', title_document_url='u')],
    'vehicle_images': [dict(id=uid(), vehicle_id=VEH[5], is_document=True, document_classification='title scan', document_category=None),
                       dict(id=uid(), vehicle_id=VEH[5], is_document=False, document_classification='bill of sale', document_category=None)],
    'vehicle_listing_documents': [dict(id=1, vehicle_id=VEH[4], doc_type='title', revoked_at='2026-10-01T00:00:00Z', amount=None)],
    'secure_documents': [dict(id=uid(), document_type='vehicle_title', upload_metadata={'vehicle_id': VEH[10]}),
                         dict(id=uid(), document_type='vehicle_title', upload_metadata={'vehicle_id': 'not-a-uuid'}),     # a value that is no uuid is skipped, not a cast error
                         dict(id=uid(), document_type='vehicle_title', upload_metadata=None),
                         dict(id=uid(), document_type='drivers_license', upload_metadata={'vehicle_id': VEH[10]})],         # only titles count
    'receipts': [dict(id=RCPT_LOW, total=100, total_amount=None), dict(id=RCPT_99, total=99, total_amount=None)]
                + [dict(id=r, total=None, total_amount=100) for r in RCPT_MANY],              # total_amount is read when total is empty
}


def unit_test(migration_text):
    print('-- 1. unit test: the view over synthetic rows')
    sources = {'v_books_audit_tiers': (TIER_COLS, SYN_TIERS), 'v_financial_accounting_records': (REC_COLS, SYN_RECS), 'v_books_category_rules': (RULE_COLS, SYN_RULES),
               'v_books_asset_register': (REGISTER_COLS, SYN_REGISTER)}
    sources.update({name: (NUKE_COLS[name], SYN_NUKE[name]) for name in NUKE_COLS})
    sources.update({'financial_document_extractions': (EXTRACTION_COLS, SYN_EXTRACTIONS), 'financial_documents': (DOCUMENT_COLS, SYN_DOCUMENTS)})
    select = with_substituted_views(view_sql(migration_text, 'v_books_large_sums'), sources)
    sql = ("select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'owner', x.owner_id, 'year', x.year, 'id', x.local_id, 'rank', x.dollar_rank, 'tier', x.tier, "
           "'pay', x.pay_proof, 'basis', x.basis_strength, 'flag', x.proof_flag, 'head', x.in_head, 'usd', x.year_usd, 'cum', x.cum_share, 'share', x.share, "
           "'req', x.required_doc_kind, 'rule', x.required_doc_rule, 'missing', x.missing_doc, 'found', x.doc_found, 'found_n', x.doc_found_n, 'cited', x.doc_cited_n, 'veh', x.vehicle_ids, 'fkind', x.doc_found_kind, 'msg_only', x.doc_message_only) "
           f"order by x.owner_id, x.kind, x.year, x.dollar_rank), '[]'::jsonb) from ({select}) x")
    rows = run([('unit', sql)])['unit'][0]
    got = {(r['kind'], r['year'], r['id']): r for r in rows if r['owner'] == A}
    expected_keys = set(EXPECT) | {('deduction', '2097', r[0]['local_id']) for r in DOCROWS}
    ok(set(got) == expected_keys, f'the view returns exactly the synthetic decisions of owner A (extra: {sorted(set(got) - expected_keys)}, missing: {sorted(expected_keys - set(got))})')
    for key, (rank, tier, basis, flag, head) in EXPECT.items():
        r = got.get(key)
        if r:
            ok((r['rank'], r['tier'], r['basis'], r['flag'], r['head']) == (rank, tier, basis, flag, head),
               f"{key[0]} {key[1]} {key[2]}: rank {r['rank']} tier {r['tier']} {r['basis']} flag {r['flag']} head {r['head']}"
               f" (expected {rank} {tier} {basis} {flag} {head})")
    ok(all(isinstance(r['pay'], bool) for r in rows), 'pay_proof is never NULL (the audit tiers leave it NULL with no bank line and no structural rule)')
    ok(not any(r['id'] == 'D-EXCLUDED' for r in rows), 'a row outside the deduction denominator (is_deduction false) is not ranked')
    ok(not any(r['id'] == 'V-CLOSED' for r in rows), 'a closed Revenue decision is not ranked')
    other = [r for r in rows if r['owner'] == B]
    ok(len(other) == 1 and other[0]['rank'] == 1 and other[0]['cum'] == 1 and other[0]['usd'] == 7, "another owner's row is ranked in its own partition")
    d99 = [r for r in rows if r['owner'] == A and r['kind'] == 'deduction' and r['year'] == '2099']
    ok(all(r['usd'] == 1040 for r in d99), 'year_usd is the sum of absolute amounts (credits count by size): 1040')
    ok(abs(next(r for r in d99 if r['id'] == 'D-RULED')['cum'] - Decimal('0.865385')) < Decimal('0.000001'), 'cum_share of the third row is 900 / 1040')
    d98 = [r for r in rows if r['owner'] == A and r['year'] == '2098']
    ok(sum(r['head'] for r in d98) == 2, 'two rows reach exactly 80% and are the head; the next row (800 ranked above it) is not')
    # documents
    for row, req, rule, missing, sources_, found_n in DOCROWS:
        r = got.get(('deduction', '2097', row['local_id']))
        if not r:
            continue
        srcs = sorted(f['source'] for f in r['found'])
        vehicles = r['veh']
        want_veh = [VEH[LINKED[row['local_id']]]] if row['local_id'] in LINKED else None
        ok((r['req'], r['rule'], r['missing'], srcs, r['found_n'], vehicles) == (req, rule, missing, sorted(sources_), found_n, want_veh),
           f"documents {row['local_id']}: requires {r['req']} ({r['rule']}), missing {r['missing']}, found {srcs} of {r['found_n']}, vehicles {vehicles and len(vehicles)}"
           f" (expected {req} {rule} {missing} {sorted(sources_)} {found_n})")
    for row, req, rule, missing, sources_, found_n, fkind, msg_only in MSGROWS:
        r = got.get(('deduction', '2097', row['local_id']))
        if r:
            ok((r['fkind'], r['msg_only']) == (fkind, msg_only), f"message threads {row['local_id']}: doc_found_kind {r['fkind']!r}, doc_message_only {r['msg_only']} (expected {fkind!r} {msg_only})")
            ok(all((f.get('type') == 'message thread') == r['msg_only'] for f in r['found']) or not r['found'],
               f"message threads {row['local_id']}: a thread is listed only when it is all there is")
            ok(all(f.get('level') == LEVEL[req] for f in r['found'] if f.get('type') == 'message thread'), f"message threads {row['local_id']}: a listed thread carries the required level")
            if req in ('invoice_or_agreement', 'purchase_agreement'):
                py = any(is_message_thread(c) for c in row['document_cites'])
                if fkind == 'message thread':
                    ok(py, f"message threads {row['local_id']}: the independent copy of the test sees the thread")
                elif missing:
                    ok(not py, f"message threads {row['local_id']}: the independent copy of the test sees no thread either")
    ok(all(isinstance(r['msg_only'], bool) for r in rows), 'doc_message_only is a boolean on every row')
    ok(all(r['fkind'] is None for r in rows if r['found_n'] == 0), 'doc_found_kind is null when nothing is found')
    ok(not any(r['msg_only'] for r in rows if r['kind'] == 'revenue' or r['req'] not in ('invoice_or_agreement', 'purchase_agreement')),
       'only an invoice-or-agreement or purchase-agreement row can rest on a message thread')
    cited = {row['local_id']: len(row['document_cites']) for row, *_ in DOCROWS}
    ok(all(got[('deduction', '2097', k)]['cited'] == n for k, n in cited.items() if ('deduction', '2097', k) in got), 'doc_cited_n counts the documents a row cites, whatever they are')
    ok(all(r['req'] is None and r['missing'] is False and r['found'] == [] for r in rows if r['kind'] == 'revenue'),
       'revenue rows carry no document requirement (the policy is about claimed expenses)')
    ok(all(r['req'] is None and not r['missing'] for r in rows if r['kind'] == 'deduction' and r['year'] in ('2098', '2099') and r['id'] != 'D-REGISTER'),
       'a category no rule names requires nothing: no document is missing')


# ---------------------------------------------------------------- 2. invariants on the live books

def expected_basis(r):
    """basis_strength recomputed from the columns the view exports (ruling ids and refs, document cites, tier)."""
    if r['doc_proof']:
        return 'documented'
    cites = r['ruling_cites'] or []
    refs = [(c.get('ref') or '') for c in cites]
    has_ruling = bool(r['ruling_id']) or bool(cites)
    all_filed = (not r['ruling_id'] or bool(FILED_ID.search(r['ruling_id']))) and all(FILED_ID.search(x.split(':')[0]) or FILED_REF.search(x) for x in refs)
    if has_ruling and all_filed:
        return 'filed_return_only'
    if r['tier'] in ('A', 'B'):
        return 'bank_and_rule'
    return 'none'


def expected_flag(r, basis):
    if basis == 'filed_return_only':
        return 'filed_return_only'
    if r['tier'] == 'C':
        return 'no_payment_proof' if not r['pay_proof'] else 'no_basis'
    return None


def expected_requirement(r):
    if r['kind'] != 'deduction' or r['amount'] <= 0:
        return None, None
    cat = (r['category'] or '').lower()
    for name, pat, kind in RULES:
        if re.search(pat, cat):
            return name, kind
    return None, None


def invariants(rows, tiers, rollup, revenue, years):
    print('-- 2. invariants: the view against its sources and against arithmetic')
    by = {}
    for r in rows:
        by.setdefault((r['kind'], r['year']), []).append(r)
    for y in years:
        d = sorted(by.get(('deduction', y), []), key=lambda r: r['dollar_rank'])
        # the rows are the audit tiers' deduction rows, and the rollup the office page shows
        ok(len(d) == tiers[y][0] == rollup[y][0], f"{y} deduction rows {len(d)} = audit tier deduction rows {tiers[y][0]} = tier_years.deductions {rollup[y][0]}")
        net = sum(r['amount'] for r in d)
        ok(abs(net - tiers[y][1]) < Decimal('0.01') and abs(net - rollup[y][1]) < Decimal('0.01'),
           f"{y} deduction dollars (net of credits) {money(net)} = audit tiers {money(tiers[y][1])} = tier_years.deduction_usd {money(rollup[y][1])}")
        rv = sorted(by.get(('revenue', y), []), key=lambda r: r['dollar_rank'])
        ok(len(rv) == revenue[y][0] and abs(sum(r['amount'] for r in rv) - revenue[y][1]) < Decimal('0.01'),
           f"{y} revenue rows {len(rv)} and dollars {money(sum(r['amount'] for r in rv))} = the Revenue decisions of the books ({revenue[y][0]}, {money(revenue[y][1])})")
        for kind, rs in (('deduction', d), ('revenue', rv)):
            if not rs:
                continue
            label = f'{y} {kind}'
            tot = sum(abs(r['amount']) for r in rs)
            ok([r['dollar_rank'] for r in rs] == list(range(1, len(rs) + 1)) and all(abs(a['amount']) >= abs(b['amount']) for a, b in zip(rs, rs[1:])),
               f'{label}: ranks 1..{len(rs)}, largest absolute amount first')
            ok(all(abs(r['year_usd'] - tot) < Decimal('0.01') for r in rs), f'{label}: year_usd {money(tot)} = sum of absolute amounts')
            run_sum, bad_cum, bad_share = Decimal(0), 0, 0
            for r in rs:
                run_sum += abs(r['amount'])
                bad_cum += abs(r['cum_usd'] - run_sum) >= Decimal('0.01')
                bad_share += tot > 0 and abs(r['share'] - abs(r['amount']) / tot) > Decimal('0.000001')
            ok(not bad_cum and not bad_share, f'{label}: cum_usd is the running sum, share is amount over year_usd')
            ok(tot == 0 or abs(rs[-1]['cum_share'] - 1) < Decimal('0.000001'), f'{label}: cum_share ends at 1')
            head = [r for r in rs if r['in_head']]
            prefix = all(r['in_head'] == (i < len(head)) for i, r in enumerate(rs))
            hd = sum(abs(r['amount']) for r in head)
            minimal = (not head) or (hd >= Decimal('0.8') * tot - Decimal('0.01') and hd - abs(head[-1]['amount']) < Decimal('0.8') * tot)
            ok(prefix and minimal, f'{label}: the head is the smallest top set that reaches 80%: {len(head)} of {len(rs)} rows, {money(hd)} of {money(tot)} ({100 * hd / tot:.1f}%)' if tot else f'{label}: no dollars')
            bad = []
            for r in rs:
                b = expected_basis(r)
                if b != r['basis_strength'] and not FILED_ID.search(r['local_id']):
                    bad.append((r['local_id'], r['basis_strength'], b))
                if r['basis_strength'] == 'documented' and not r['doc_proof'] or (r['basis_strength'] == 'bank_and_rule' and r['tier'] not in ('A', 'B')):
                    bad.append((r['local_id'], r['basis_strength'], 'tier/doc'))
                if r['proof_flag'] != expected_flag(r, r['basis_strength']):
                    bad.append((r['local_id'], r['proof_flag'], 'flag'))
                if r['basis_strength'] == 'filed_return_only' and r['doc_proof']:
                    bad.append((r['local_id'], 'filed_return_only with a document', ''))
            ok(not bad, f'{label}: basis_strength and proof_flag follow from the ruling ids, ruling refs, document cites and tier of each row' + (f' (first: {bad[:3]})' if bad else ''))
            ok(all(isinstance(r['pay_proof'], bool) for r in rs), f'{label}: pay_proof is a boolean on every row')
            bad = []
            for r in rs:
                rule, req = expected_requirement(r)
                if (r['required_doc_rule'], r['required_doc_kind']) != (rule, req):
                    bad.append((r['local_id'], r['required_doc_rule'], rule))
                if r['missing_doc'] != (r['required_doc_kind'] is not None and r['doc_found_n'] == 0):
                    bad.append((r['local_id'], 'missing_doc', r['missing_doc']))
                need = LEVEL.get(r['required_doc_kind'])
                if need and any((f.get('level') or 0) < need for f in r['doc_found']):
                    bad.append((r['local_id'], 'a found document below the required level', ''))
                if len(r['doc_found']) > 5 or len(r['doc_found']) > r['doc_found_n']:
                    bad.append((r['local_id'], 'doc_found size', len(r['doc_found'])))
                threads = [f for f in r['doc_found'] if f.get('type') == 'message thread']
                if r['doc_message_only'] != bool(threads) or (threads and len(threads) != len(r['doc_found'])):
                    bad.append((r['local_id'], 'doc_message_only', r['doc_message_only']))
                if threads and r['required_doc_kind'] not in ('invoice_or_agreement', 'purchase_agreement'):
                    bad.append((r['local_id'], 'a message thread on a kind that stays strict', r['required_doc_kind']))
                if r['required_doc_kind'] in ('invoice_or_agreement', 'purchase_agreement') and r['doc_found_n'] == 0 and any(is_message_thread(c) for c in r['document_cites'] or []):
                    bad.append((r['local_id'], 'a message thread cited and no document found', ''))
                if r['doc_message_only'] and not any(is_message_thread(c) for c in r['document_cites'] or []):
                    bad.append((r['local_id'], 'rests on a message thread the independent test does not see', ''))
                if (r['doc_found_kind'] is None) != (r['doc_found_n'] == 0):
                    bad.append((r['local_id'], 'doc_found_kind', r['doc_found_kind']))
            ok(not bad, f'{label}: required document kind follows from the category rules; missing_doc = required and none found; a found document meets the level'
               + (f' (first: {bad[:3]})' if bad else ''))


# ---------------------------------------------------------------- 3. findings

def is_flagged(r):
    return bool(r['proof_flag']) or bool(r['missing_doc'])


def flag_of(r):
    return r['proof_flag'] or 'missing_doc'


def findings_for(rows, years):
    print('-- 3. findings: large sums that do not carry proof (R12 reads the deduction rows)')
    out = {}
    for y in years:
        d = sorted((r for r in rows if r['kind'] == 'deduction' and r['year'] == y), key=lambda r: r['dollar_rank'])
        head = [r for r in d if r['in_head']]
        flagged = [r for r in head if is_flagged(r)]
        missing = [r for r in head if r['missing_doc']]
        tot = d[0]['year_usd'] if d else Decimal(0)
        hd, fd, md = (sum(abs(r['amount']) for r in x) for x in (head, flagged, missing))
        out[y] = (head, flagged, missing, tot)
        if not d:
            print(f'{y} R12 not assessed: no deduction decisions')
            continue
        by = {f: [r for r in flagged if flag_of(r) == f] for f in FLAGS}
        top = flagged[:3]
        t3 = sum(abs(r['amount']) for r in top)
        verdict = 'PASS' if not flagged else 'FAIL'
        print(f"{y} R12 {verdict}: head {len(head)} of {len(d)} decisions, {money(hd)} of {money(tot)} ({100 * hd / tot:.1f}%); flagged {len(flagged)} rows {money(fd)} "
              f"({100 * fd / tot:.1f}% of the year)" + ''.join(f"; {f} {len(v)} {money(sum(abs(r['amount']) for r in v))}" for f, v in by.items() if v))
        if flagged:
            print(f"     largest flagged: {', '.join(r['local_id'] + ' ' + money(abs(r['amount'])) + ' (' + flag_of(r) + ')' for r in top)}; "
                  f"they hold {100 * t3 / tot:.1f}% of the year's deduction dollars and {100 * t3 / fd:.1f}% of the flagged")
            findings.append(f'{y}: {len(flagged)} head rows {money(fd)}')
        if missing:
            kinds = {}
            for r in missing:
                kinds.setdefault(r['required_doc_kind'], []).append(r)
            nodoc = [r for r in missing if r['doc_cited_n'] == 0]
            print(f"     missing documents: {len(missing)} head rows {money(md)} ({len(nodoc)} cite no document at all, {money(sum(abs(r['amount']) for r in nodoc))}): " + ', '.join(f"{len(v)} {k} {money(sum(abs(r['amount']) for r in v))}"
                                                                                             for k, v in sorted(kinds.items(), key=lambda kv: -sum(abs(r['amount']) for r in kv[1]))))
            print(f"     largest missing: {', '.join(r['local_id'] + ' ' + money(abs(r['amount'])) + ' (' + r['required_doc_kind'] + ')' for r in missing[:3])}")
        # message threads (owner ruling 2026-10-29): what rests on texts, and what cites only texts that did not count
        resting = [r for r in head if r['doc_message_only']]
        print(f"     head rows that rest on a message thread alone: {len(resting)} {money(sum(abs(r['amount']) for r in resting))}")
        texts_only = [r for r in flagged if r['document_cites'] and all(names_medium(c) for c in r['document_cites'])]
        if texts_only:
            why = {}
            for r in texts_only:
                reason = ('kind stays strict (' + r['required_doc_kind'] + ')' if r['required_doc_kind'] not in ('invoice_or_agreement', 'purchase_agreement')
                          else 'no date or id' if not any(LOCATOR.search((c.get('ref') or '').lower()) for c in r['document_cites'])
                          else 'records a search with no result' if all(NO_RESULT.search((c.get('ref') or '').lower()) for c in r['document_cites'])
                          else 'other')
                why[reason] = why.get(reason, 0) + 1
            print(f"     flagged head rows whose only cites are message threads that did not count: {len(texts_only)} ({', '.join(f'{n} {k}' for k, n in sorted(why.items()))}): "
                  + ', '.join(r['local_id'] for r in texts_only[:10]))
    return out


def check_expect(rows, expects):
    for e in expects:
        y, rank, flag = e.split(':')
        r = next((r for r in rows if r['kind'] == 'deduction' and r['year'] == y and r['dollar_rank'] == int(rank)), None)
        if flag == 'ok':
            good = r is not None and not is_flagged(r)
        elif flag == 'missing_doc':
            good = r is not None and r['missing_doc']
        else:
            good = r is not None and r['proof_flag'] == flag
        ok(good and r['in_head'],
           f"--expect {e}: the {y} deduction at dollar rank {rank} ({r['local_id'] if r else '-'}, tier {r['tier'] if r else '-'}, {r['basis_strength'] if r else '-'}, "
           f"requires {r['required_doc_kind'] if r else '-'}, missing {r['missing_doc'] if r else '-'}) is {flag}, in the head")


def gate_agreement(owner, migration, years, found):
    print('-- books_year_gate against the views')
    has_gate = bool(migration) and 'CREATE OR REPLACE FUNCTION public.books_year_gate(' in open(migration).read()
    qs = [(f'g{y}', f"select public.books_year_gate{'_pending' if has_gate else ''}('{owner}'::uuid, {int(y)})::text") for y in years]
    res = run(qs, migration=migration, view_names=VIEWS, with_gate=has_gate, timeout='115s')
    for y in years:
        g = res[f'g{y}'][0]
        rules = {r['rule']: r for r in g['rules']}
        r12, (head, flagged, missing, tot) = rules.get('R12'), found[y]
        good = r12 is not None and ((r12['n'] == len(flagged) and r12.get('of') == len(head)) or (r12['status'] == 'not_assessed' and not head))
        ok(good, f"{y} gate R12 {r12['status'] if r12 else 'missing'}: n {r12 and r12['n']} of {r12 and r12.get('of')} = view flagged {len(flagged)} of head {len(head)}"
                 f"  ({res[f'g{y}'][1] / 1000:.1f} s)")
        if flagged:
            ids = [r['local_id'] for r in flagged][:100]
            ok(r12['ids'] == ids and abs(r12['amount'] - sum(abs(r['amount']) for r in flagged)) < Decimal('0.01') and r12['status'] == 'fail',
               f"{y} gate R12 ids (by dollars) and dollars {money(r12['amount'])} equal the view's flagged head rows")
            ok(r12['missing_doc']['n'] == len(missing) and r12['missing_doc']['ids'] == [r['local_id'] for r in missing][:100],
               f"{y} gate R12 missing_doc: {r12['missing_doc']['n']} rows, ids by dollars equal the view's")
        elif r12:
            ok(r12['status'] in ('pass', 'not_assessed'), f"{y} gate R12 passes when the view flags nothing")
        ok('R11' in rules, f"{y} gate carries R11 ({rules.get('R11', {}).get('status')}) and R12 after R10, existing rules before them: {[x['rule'] for x in g['rules']][-4:]}")


def before_after(owner, migration, years, limit=15):
    """What the rule says now against what it said: the deployed view against this migration's, per year and by dollar rank."""
    print('-- before and after: the deployed v_books_large_sums against the migration\'s')
    ylist = ','.join("'" + y + "'" for y in years)
    cols = 'year, dollar_rank, local_id, amount, tier, proof_flag, missing_doc, required_doc_kind, required_doc_rule, doc_found, in_head, year_usd'
    new_cols = cols + ', doc_found_kind, doc_message_only'
    q = ("select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (select " + cols + " from public.v_books_large_sums where owner_id = '" + owner +
         f"'::uuid and kind = 'deduction' and year in ({ylist})) r")
    old = run([('rows', q)])['rows'][0]
    new = run([('rows', q.replace(cols, new_cols, 1))], migration=migration, view_names=VIEWS)['rows'][0]
    key = lambda r: (r['year'], r['local_id'])  # noqa: E731
    oldm, newm = {key(r): r for r in old}, {key(r): r for r in new}
    flag = lambda r: r['proof_flag'] or ('missing_doc' if r['missing_doc'] else None)  # noqa: E731
    print(f"{'year':<5}{'flagged head rows before':>26}{'after':>26}   by flag before -> after")
    for y in years:
        row = []
        for m in (oldm, newm):
            head = [r for k, r in m.items() if k[0] == y and r['in_head']]
            fl = [r for r in head if flag(r)]
            by = {}
            for r in fl:
                by.setdefault(flag(r), []).append(abs(r['amount']))
            row.append((len(fl), sum(abs(r['amount']) for r in fl), {k: (len(v), sum(v)) for k, v in by.items()}, len(head)))
        fmt = lambda t: ', '.join(f"{k} {n} {money(d)}" for k, (n, d) in sorted(t.items()))  # noqa: E731
        print(f"{y:<5}{str(row[0][0]) + ' ' + money(row[0][1]):>26}{str(row[1][0]) + ' ' + money(row[1][1]):>26}   {fmt(row[0][2])}  ->  {fmt(row[1][2])}")
        miss = [sum(1 for r in m.values() if r['year'] == y and r['in_head'] and r['missing_doc']) for m in (oldm, newm)]
        kinds = [{} for _ in (0, 1)]
        for i, m in enumerate((oldm, newm)):
            for r in m.values():
                if r['year'] == y and r['in_head'] and r['missing_doc']:
                    kinds[i][r['required_doc_kind']] = kinds[i].get(r['required_doc_kind'], 0) + 1
        print(f"     head rows missing their document: {miss[0]} {dict(sorted(kinds[0].items()))} -> {miss[1]} {dict(sorted(kinds[1].items()))}")
        print(f"     by dollar rank (flagged before or after, largest first; * = changed):")
        rows = sorted((k for k in set(oldm) | set(newm) if k[0] == y and (flag(oldm.get(k, {'proof_flag': None, 'missing_doc': False})) or flag(newm.get(k, {'proof_flag': None, 'missing_doc': False})))),
                      key=lambda k: (newm.get(k) or oldm.get(k))['dollar_rank'])
        for k in rows[:limit]:
            o, n = oldm.get(k), newm.get(k)
            r = n or o
            before, after = flag(o) if o else '-', flag(n) if n else '-'
            print(f"     {r['dollar_rank']:>4} {k[1]:<42} {money(abs(r['amount'])):>11}  {r['required_doc_kind'] or '-':<21} {before or 'ok':<18} -> {after or 'ok':<18}{'  *' if before != after else ''}"
                  + (f"  [{', '.join(sorted({f.get('source') for f in n['doc_found']}))}]" if n and n['doc_found'] and before != after else ''))
        changed = [k for k in set(oldm) | set(newm) if k[0] == y and (flag(oldm.get(k)) if oldm.get(k) else None) != (flag(newm.get(k)) if newm.get(k) else None)]
        print(f"     rows whose flag changed: {len(changed)}, dollars {money(sum(abs((newm.get(k) or oldm.get(k))['amount']) for k in changed))}")
        differ = [k for k in oldm if k in newm and (oldm[k]['doc_found'], oldm[k]['missing_doc']) != (newm[k]['doc_found'], newm[k]['missing_doc'])]
        resting = [r for r in newm.values() if r['year'] == y and r['in_head'] and r['doc_message_only']]
        print(f"     rows whose doc_found changed: {len(differ)}; head rows that now rest on a message thread alone: {len(resting)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', required=True)
    ap.add_argument('--years', nargs='+', default=['2022', '2023', '2024', '2025'])
    ap.add_argument('--migration', help='try this migration file inside the rolled-back transaction (its views; with --with-gate also its gate)')
    ap.add_argument('--expect', nargs='*', default=[], metavar='YEAR:RANK:FLAG')
    ap.add_argument('--with-gate', action='store_true')
    ap.add_argument('--before-after', action='store_true', help='print what R12 says now against the deployed view (needs --migration)')
    ap.add_argument('--max-seconds', type=float)
    ap.add_argument('--report', action='store_true', help='exit 0 when only the books have findings')
    a = ap.parse_args()
    owner, years = uuid_ok(a.owner), [str(int(y)) for y in a.years]
    path = a.migration or DEFAULT_MIGRATION
    unit_test(open(path).read())
    ylist = ','.join("'" + y + "'" for y in years)
    cols = ("kind, year, dollar_rank, local_id, amount, category, tier, pay_proof, doc_proof, purpose_proof, proof_basis, basis_strength, proof_flag, ruling_id, "
            "ruling_cites, payment_cites, document_cites, required_doc_kind, required_doc_rule, doc_found, doc_found_n, doc_cited_n, missing_doc, vehicle_ids, "
            "year_usd, share, cum_usd, cum_share, in_head, doc_found_kind, doc_message_only")
    qs = [
        ('rows', f"select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (select {cols} from public.v_books_large_sums where owner_id = '{owner}'::uuid and year in ({ylist})) r"),
        ('tiers', f"select coalesce(jsonb_agg(jsonb_build_object('year', year, 'n', n, 'usd', usd)), '[]'::jsonb) from (select year, count(*) n, sum(amount) usd from public.v_books_audit_tiers "
                  f"where owner_id = '{owner}'::uuid and is_deduction and year in ({ylist}) group by year) q"),
        ('rollup', f"select coalesce(jsonb_agg(jsonb_build_object('year', year, 'n', deductions, 'usd', deduction_usd)), '[]'::jsonb) from public.v_books_audit_tier_years where owner_id = '{owner}'::uuid and year in ({ylist})"),
        ('revenue', f"select coalesce(jsonb_agg(jsonb_build_object('year', year, 'n', n, 'usd', usd)), '[]'::jsonb) from (select year, count(*) n, sum(amount_value) usd from public.v_financial_accounting_records "
                    f"where owner_id = '{owner}'::uuid and record_kind = 'retained_ledger_decision' and section = 'Revenue' and amount_value is not null and coalesce(status, '') not like 'Closed%' "
                    f"and coalesce(status, '') not like 'Open allocation%' and year in ({ylist}) group by year) q"),
        # the shape the office page reads: one year, deductions, the head only
        ('page', f"select count(*) from public.v_books_large_sums where owner_id = '{owner}'::uuid and year = '{years[-1]}' and kind = 'deduction' and in_head"),
    ]
    res = run(qs, migration=a.migration, view_names=VIEWS)
    rows = res['rows'][0]
    tot = lambda name: {r['year']: (r['n'], r['usd']) for r in res[name][0]}  # noqa: E731
    tiers, rollup, revenue = tot('tiers'), tot('rollup'), tot('revenue')
    for y in years:
        for d in (tiers, rollup, revenue):
            d.setdefault(y, (0, Decimal(0)))
    print(f"reads: all {len(rows)} rows of {len(years)} years {res['rows'][1] / 1000:.2f} s; the office-page read (one year, deductions, head) {res['page'][1] / 1000:.2f} s; "
          f"audit tiers {res['tiers'][1] / 1000:.2f} s (the view reads it: that is most of the time)")
    if a.max_seconds:
        ok(res['page'][1] / 1000 <= a.max_seconds and res['rows'][1] / 1000 <= a.max_seconds, f'reads within {a.max_seconds} s')
    invariants(rows, tiers, rollup, revenue, years)
    found = findings_for(rows, years)
    check_expect(rows, a.expect)
    if a.before_after:
        if not a.migration:
            sys.exit('--before-after needs --migration')
        before_after(owner, a.migration, years)
    if a.with_gate:
        gate_agreement(owner, a.migration, years, found)
    print('books_large_sums:', 'PASS' if not problems and not findings else
          (f'FAIL ({len(problems)} check(s) failed)' if problems else f'FAIL ({len(findings)} year(s) with flagged head rows: ' + '; '.join(findings) + ')'))
    sys.exit(1 if problems or (findings and not a.report) else 0)


if __name__ == '__main__':
    main()
