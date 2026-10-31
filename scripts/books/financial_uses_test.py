"""Offline financial-use admission tests. All identities and amounts are synthetic."""
import copy
import unittest
from schedule_c_rulings import financial_use_fields, financial_use_original

OWNER='11111111-1111-4111-8111-111111111111'
DOC='22222222-2222-4222-8222-222222222222'
LINE='33333333-3333-4333-8333-333333333333'
VEHICLE='44444444-4444-4444-8444-444444444444'
KEY='a'*64


def source(amount='0.30'):
    return dict(records=[dict(source_key=KEY,amount=amount,currency='USD',record_kind='retained_ledger_decision',section='Expense')],
                record_lines={KEY:LINE},fields=[dict(field_key='unchanged')],lines=[dict(description='existing item')],run_id=LINE)


def use(allocations=None):
    return dict(source_key=KEY,document_id=DOC,phase='book_expense',
                allocations=allocations if allocations is not None else [dict(vehicle_id=VEHICLE,allocated_amount='0.10',basis='Synthetic source')],
                evidence=dict(source='Synthetic retained original'))


class FinancialUseTest(unittest.TestCase):
    def test_reference_source_amount_and_identity_without_copying_or_mutating_the_book(self):
        state=source(); before=copy.deepcopy(state)
        field=financial_use_fields(state,[use()])[0]
        self.assertEqual(state,before)
        value=field['value_normalized']
        self.assertEqual(value['record_document_id'],DOC)
        self.assertEqual(value['record_line_id'],LINE)
        self.assertEqual(value['book_amount'],'0.30')
        self.assertEqual(value['currency'],'USD')
        self.assertNotIn('accounting_records',field)

    def test_decimal_allocations_conserve_exactly_and_do_not_round_away_an_overage(self):
        rows=[dict(vehicle_id=VEHICLE,allocated_amount=amount,basis='Synthetic split') for amount in ['0.10','0.20']]
        self.assertEqual(len(financial_use_fields(source(),[use(rows)])[0]['value_normalized']['allocations']),2)
        rows[1]['allocated_amount']='0.200001'
        with self.assertRaisesRegex(ValueError,'exceed'): financial_use_fields(source(),[use(rows)])

    def test_complete_empty_vector_is_an_explicit_withdrawal(self):
        self.assertEqual(financial_use_fields(source(),[use([])])[0]['value_normalized']['allocations'],[])

    def test_missing_currency_is_not_filled_with_usd(self):
        state=source();state['records'][0]['currency']=None
        with self.assertRaisesRegex(ValueError,'currency'): financial_use_fields(state,[use()])

    def test_record_phase_and_cash_witness_are_required(self):
        claim=use();claim['phase']='customer_receipt'
        with self.assertRaisesRegex(ValueError,'phase'): financial_use_fields(source(),[claim])
        state=source();state['records'][0]['section']='Revenue'
        with self.assertRaises(KeyError): financial_use_fields(state,[claim])

    def test_register_identity_survives_source_revision_and_is_private_by_owner(self):
        body,original=financial_use_original(OWNER,DOC,KEY)
        self.assertEqual((body,original),financial_use_original(OWNER,DOC,KEY))
        self.assertTrue(original['storage_path'].startswith(OWNER+'/'))
        self.assertNotEqual(original['sha256'],financial_use_original(LINE,DOC,KEY)[1]['sha256'])
        self.assertNotEqual(original['sha256'],financial_use_original(OWNER,DOC,KEY,'customer_refund')[1]['sha256'])

    def test_witnesses_are_bounded_nonmonetary_citations_and_leave_inputs_unchanged(self):
        claim=use();claim['allocations'][0]['witnesses']=[dict(image_id=LINE,label='Synthetic work context')]
        before=copy.deepcopy(claim)
        value=financial_use_fields(source(),[claim])[0]['value_normalized']
        self.assertEqual(value['allocations'][0]['witnesses'],claim['allocations'][0]['witnesses'])
        self.assertEqual(claim,before)
        claim['allocations'][0]['witnesses'][0]['receipt_id']=DOC
        with self.assertRaisesRegex(ValueError,'one source'): financial_use_fields(source(),[claim])


if __name__=='__main__': unittest.main()
