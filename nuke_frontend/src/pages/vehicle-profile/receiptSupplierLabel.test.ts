import { describe, expect, it } from 'vitest';
import { receiptSupplierLabel } from './receiptSupplierLabel';

describe('receipt supplier display label', () => {
  it('removes a person annotation while retaining the seller handle', () => {
    expect(receiptSupplierLabel('eBay seller classicspares42 (Jamie Example)')).toBe('eBay seller classicspares42');
    expect(receiptSupplierLabel('eBay seller classicspares42 (JAMIE EXAMPLE)')).toBe('eBay seller classicspares42');
  });

  it('keeps the company and account alias while omitting the message signature', () => {
    expect(receiptSupplierLabel('eBay seller Example Auto Supply (examplesupplycom); message signed Jamie Example'))
      .toBe('eBay seller Example Auto Supply (examplesupplycom)');
  });

  it('keeps useful business aliases and handles with punctuation', () => {
    expect(receiptSupplierLabel('eBay seller rpmperformance (RPM Performance)')).toBe('eBay seller rpmperformance (RPM Performance)');
    expect(receiptSupplierLabel('eBay seller Example Parts (example-parts.42)')).toBe('eBay seller Example Parts (example-parts.42)');
  });

  it('does not rewrite ordinary suppliers, their locations or receipt prose', () => {
    expect(receiptSupplierLabel("O'Reilly Auto Parts (Store 1234)")).toBe("O'Reilly Auto Parts (Store 1234)");
    expect(receiptSupplierLabel('Example Tire (Alignment printout)')).toBe('Example Tire (Alignment printout)');
    expect(receiptSupplierLabel(null)).toBeNull();
    expect(receiptSupplierLabel('  ')).toBeNull();
  });
});
