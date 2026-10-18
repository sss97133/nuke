// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ read: vi.fn(), queries: [] as any[] }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const scope: any = { table };
  const query: any = {
    select: (fields: string) => { scope.fields = fields; return query; },
    eq: (key: string, value: string) => { scope[key] = value; return query; },
    order: (field: string, options: unknown) => { scope.order = [field, options]; return query; },
    limit: (limit: number) => { scope.limit = limit; fixture.queries.push(scope); return fixture.read(scope); },
  };
  return query;
} } }));
import BuyerQuestionPreview from './BuyerQuestionPreview';

const row = (extra: any = {}) => ({ make: 'Chevrolet', l1_category: 'mechanical', l2_subcategory: 'brakes',
  display_name: 'Brake history', question_count: 3, answerable_from_db: true, vehicle_count: 2, ...extra });
const ok = (rows: unknown[]) => ({ data: rows, error: null });
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(done => { resolve = done; });
  return { promise, resolve };
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.read.mockReset().mockResolvedValue(ok([row()])); fixture.queries = [];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(vehicleId = 'vehicle-a', make: string | undefined = 'Chevrolet') {
  await act(async () => root.render(<BuyerQuestionPreview vehicleId={vehicleId} make={make} />));
}

describe('make-level buyer question context', () => {
  it('keeps make/category counts and makes the selected-category denominator explicit without listing answerability', async () => {
    fixture.read.mockResolvedValue(ok([row(), row({ l1_category: 'provenance', l2_subcategory: 'ownership', display_name: 'Ownership history', question_count: 1 })]));
    await render();
    expect(container.textContent).toContain('Top 2 recorded question categories for Chevrolet');
    expect(container.textContent).toContain('Brake history'); expect(container.textContent).toContain('Ownership history');
    expect(container.textContent).toContain('3 questions'); expect(container.textContent).toContain('1 question');
    expect(container.textContent).toContain('75%'); expect(container.textContent).toContain('25%');
    expect(container.textContent).toContain('4 classified questions in the categories shown');
    expect(container.textContent).toContain('percentages use this subtotal');
    expect(container.textContent).toContain('Refresh time unknown');
    expect(container.textContent).toContain("this listing's answers are unassessed");
    expect(container.textContent).not.toContain('similar vehicles');
    expect(container.textContent).not.toContain('answerable from listing data');
    expect(fixture.queries).toEqual([{ table: 'mv_question_by_make', fields: 'make, l1_category, l2_subcategory, display_name, question_count',
      make: 'Chevrolet', order: ['question_count', { ascending: false }], limit: 8 }]);
  });

  it('retains an unresolved subcategory or taxonomy name without inventing a label', async () => {
    fixture.read.mockResolvedValue(ok([row({ l1_category: 'general', l2_subcategory: null, display_name: null })]));
    await render();
    expect(container.textContent).toContain('general'); expect(container.textContent).not.toContain('null');
    expect(container.textContent).toContain('3 questions');
  });

  it.each([
    ['null payload', null], ['wrong shape', {}], ['over limit', Array.from({ length: 9 }, (_, n) => row({ l2_subcategory: String(n) }))],
    ['foreign make', [row({ make: 'Ford' })]], ['missing make', [row({ make: undefined })]],
    ['duplicate category', [row(), row()]], ['missing category', [row({ l1_category: null })]],
    ['invalid subcategory', [row({ l2_subcategory: {} })]], ['invalid taxonomy label', [row({ display_name: [] })]],
    ['string count', [row({ question_count: '3' })]], ['zero count', [row({ question_count: 0 })]],
    ['negative count', [row({ question_count: -1 })]], ['fractional count', [row({ question_count: 0.5 })]],
    ['nonfinite count', [row({ question_count: Infinity })]], ['unsafe count', [row({ question_count: Number.MAX_SAFE_INTEGER + 1 })]],
    ['unsafe subtotal', [row({ question_count: Number.MAX_SAFE_INTEGER }), row({ l2_subcategory: 'engine', question_count: 1 })]],
  ])('withholds misleading totals and signals unavailable context for %s', async (_name, data) => {
    fixture.read.mockResolvedValue({ data, error: null });
    await render();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Buyer question context unavailable.');
    expect(container.textContent).not.toContain('Brake history'); expect(container.textContent).not.toContain('%');
  });

  it('hides a genuinely empty result while errors and rejected reads remain visible as unavailable', async () => {
    fixture.read.mockResolvedValueOnce(ok([])); await render(); expect(container.textContent).toBe('');
    fixture.read.mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE PROVIDER ERROR' } });
    await render('vehicle-b', 'Ford');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Buyer question context unavailable.');
    expect(container.textContent).not.toContain('PRIVATE PROVIDER ERROR');
    fixture.read.mockRejectedValueOnce(new Error('PRIVATE TRANSPORT ERROR'));
    await render('vehicle-c', 'BMW');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Buyer question context unavailable.');
    expect(container.textContent).not.toContain('PRIVATE TRANSPORT ERROR');
  });

  it.each(['empty', 'error'])('withholds old make counts while the next read is pending and after an %s result', async outcome => {
    await render(); expect(container.textContent).toContain('Brake history');
    const next = deferred(); fixture.read.mockReturnValueOnce(next.promise);
    await render('vehicle-b', 'Ford');
    expect(container.textContent).not.toContain('Brake history'); expect(container.textContent).not.toContain('Chevrolet');
    await act(async () => next.resolve(outcome === 'empty' ? ok([]) : { data: null, error: { message: 'Denied' } }));
    expect(container.textContent).not.toContain('Brake history');
    if (outcome === 'empty') expect(container.textContent).toBe('');
    else expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it.each([undefined, '', '   '])('hides old context without a make and never starts an unscoped read (%j)', async make => {
    await render(); expect(container.textContent).toContain('Brake history');
    // Render directly so an explicit undefined is not replaced by the helper's default.
    await act(async () => root.render(<BuyerQuestionPreview vehicleId="vehicle-b" make={make} />));
    expect(container.textContent).toBe(''); expect(fixture.queries).toHaveLength(1);
  });

  it('binds a same-make vehicle transition to its new request and ignores the late previous response', async () => {
    const old = deferred(), next = deferred(); fixture.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await render(); await render('vehicle-b');
    expect(fixture.queries).toHaveLength(2); expect(container.textContent).toBe('');
    await act(async () => next.resolve(ok([row({ display_name: 'Current read category' })])));
    expect(container.textContent).toContain('Current read category');
    await act(async () => old.resolve(ok([row({ display_name: 'Stale read category' })])));
    expect(container.textContent).toContain('Current read category'); expect(container.textContent).not.toContain('Stale read category');
  });

  it('ignores a late old-make response after a new make succeeds or make becomes missing', async () => {
    const old = deferred(); fixture.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok([row({ make: 'Ford', display_name: 'Ford category' })]));
    await render(); await render('vehicle-b', 'Ford'); expect(container.textContent).toContain('Ford category');
    await act(async () => old.resolve(ok([row({ display_name: 'Late Chevrolet category' })])));
    expect(container.textContent).toContain('Ford category'); expect(container.textContent).not.toContain('Late Chevrolet category');
    await act(async () => root.render(<BuyerQuestionPreview vehicleId="vehicle-c" />));
    expect(container.textContent).toBe('');
  });

  it('keeps context absent when a pending make becomes missing before its response arrives', async () => {
    const old = deferred(); fixture.read.mockReturnValueOnce(old.promise);
    await render();
    await act(async () => root.render(<BuyerQuestionPreview vehicleId="vehicle-a" />));
    await act(async () => old.resolve(ok([row()])));
    expect(container.textContent).toBe(''); expect(fixture.queries).toHaveLength(1);
  });
});
