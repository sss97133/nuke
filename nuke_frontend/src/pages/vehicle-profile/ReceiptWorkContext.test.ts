import { describe, expect, it } from 'vitest';
import { describeConclusion, describeJudgment, describeLineage, describePrinted, describeWithdrawal, receiptLineKey } from './ReceiptWorkContext';

describe('receipt work context words', () => {
  it('names a proposed conclusion without claiming installation, payment or ownership', () => {
    for (const c of ['install_window_photographed', 'photographed_after_window', 'no_zone_photo_after_purchase', 'part_zone_unknown', 'receipt_day_photographed',
      'receipt_day_unphotographed', 'work_day_photographed', 'work_day_unphotographed', 'undated_line', 'not_work_evidence']) {
      expect(describeConclusion(c)).not.toMatch(/installed|paid|owner|owns|did the work/i);
    }
    expect(describeConclusion('something_new')).toBe('something new');
  });
  it('keeps the page unresolved and the claims attributed to the document', () => {
    expect(describeLineage({ receipt_id: 'r', source_document_table: 'vehicle_documents', source_document_id: 'd', line_number: 4, item_id: 'i', link_id: 'l',
      link_basis: 'vehicle_hint', link_confidence: 0.7, page: null, page_reason: 'line-to-page mapping unresolved' }))
      .toBe('source vehicle documents · line 4 · linked by vehicle hint 0.70 · page: line-to-page mapping unresolved');
    expect(describePrinted({ attributed_to: 'document', line_date: null, hours: null, performer: null })).toBeNull();
    expect(describePrinted({ attributed_to: 'document', line_date: null, hours: 1, performer: 'A' })).toBe('printed on the document: 1 h · performer A');
  });
  it('describes question states and withdrawals', () => {
    expect(describeJudgment(null)).toBeNull();
    expect(describeJudgment({ question_id: 'q', status: 'pending' })).toBe('question open: is the part visible in these frames?');
    expect(describeJudgment({ question_id: 'q', status: 'answered', answer: { visible: 'no' } })).toBe("answered (a model's reading, not a sign): visible: no");
    expect(describeWithdrawal('link_retired')).toBe('the receipt is no longer linked to this vehicle');
    expect(describeWithdrawal(null)).toBe('the source was withdrawn');
    expect(receiptLineKey('r', null)).toBe('r:-');
  });
});
