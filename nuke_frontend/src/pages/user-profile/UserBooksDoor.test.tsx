// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import UserBooksDoor from './UserBooksDoor';
import { doorLine } from '../../components/finance/booksDocketWords';
import type { GateStatus, GateYear } from '../../services/accountingCloseout';

// Synthetic: every id, year and time below is invented.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const open0 = { total: 0, owner: 0, cpa: 0, agent: 0, unassigned: 0 };
const rules = (...r: [string, string, number][]) => r.map(([rule, status, of]) => ({ rule, title: `title of ${rule}`, status, n: status === 'fail' ? 2 : 0, of, amount: 0 }));
const run = (rs: ReturnType<typeof rules>, over: object = {}) => {
  const c = { total: rs.length, pass: rs.filter(r => r.status === 'pass').length, fail: rs.filter(r => r.status === 'fail').length, not_assessed: 0, empty: rs.filter(r => r.status === 'pass' && r.of === 0).length };
  return { id: 'run', started_at: '2026-10-29T17:30:30Z', finished_at: '2026-10-29T17:31:00Z', duration_ms: 30000, pass: c.fail === 0, stale: false, stale_books: false, stale_gate: false,
    trusted: c.fail === 0 && c.empty === 0, rule_counts: c, rules: rs, ...over };
};
const year = (y: number, over: Partial<GateYear> = {}): GateYear => ({ year: y, draft_document_id: null, drafts_on_file: 0, attempt: null, run: null, open_items: open0, ...over });
const gate = (years: GateYear[]): GateStatus => ({ owner_id: owner, read_at: '2026-10-29T17:40:00Z', book_signature: 's', gate_md5: 'm',
  summary: { years: years.length, with_run: years.filter(y => y.run).length, passed: 0, trusted: 0, failing: 0, not_assessed: 0, stale: 0, open_items: 0 }, years });

let node: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); fixture.rpc.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); });
const render = async (ui: React.ReactNode) => { await act(async () => root.render(<MemoryRouter>{ui}</MemoryRouter>)); await act(async () => { await vi.advanceTimersByTimeAsync(50); }); };

it('a visitor gets no heading, no row, no link and no request', async () => {
  expect(renderToStaticMarkup(<MemoryRouter><UserBooksDoor userId={owner} isOwnProfile={false} /></MemoryRouter>)).toBe('');
  await render(<UserBooksDoor userId={owner} isOwnProfile={false} />);
  expect(node.textContent).toBe('');
  expect(fixture.rpc).not.toHaveBeenCalled();
});

it('the owner sees one row per tax year with the stored gate verdict, and one link to the books docket', async () => {
  fixture.rpc.mockResolvedValue({ data: gate([
    year(2025, { run: run(rules(['R1', 'fail', 10], ['R9', 'pass', 5]), { stale: true, stale_books: true, trusted: false }) as any, open_items: { total: 2, owner: 1, cpa: 0, agent: 0, unassigned: 1 } }),
    year(2024, { run: run(rules(['R1', 'pass', 10], ['R9', 'pass', 5])) as any }),
    year(2023),
  ]), error: null });
  await render(<UserBooksDoor userId={owner} isOwnProfile />);
  expect(fixture.rpc).toHaveBeenCalledWith('books_gate_status', { p_owner_id: owner });
  const rows = Array.from(node.querySelectorAll('.k-row')).map(r => r.textContent);
  expect(rows).toEqual([
    '2025Not trusted · 1 rule failing · books changed since · 2 open',
    '2024Trusted · Oct 29, 2026, 10:31 AM',
    '2023Gate not run',
  ]);
  const links = Array.from(node.querySelectorAll('a'));
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute('href')).toBe('/accounting');
  expect(links[0].textContent).toBe('Open the books docket ›');
  expect(node.querySelector('.k-coverage')?.textContent).toBe('2 of 3 tax years with a stored gate run');
});

it('nothing is drawn while the status is being read', async () => {
  fixture.rpc.mockImplementation(() => new Promise(() => undefined));
  await render(<UserBooksDoor userId={owner} isOwnProfile />);
  expect(node.textContent).toBe('');
});

it('a failed read says so, offers a retry, and still lets the owner through to the docket', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { code: '57014' } });
  await render(<UserBooksDoor userId={owner} isOwnProfile />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(node.textContent).toContain('The books status could not load.');
  expect(node.textContent).not.toMatch(/\b0 of 0 tax years\b.*(Trusted|Passed)/);
  expect(node.querySelector('a')?.getAttribute('href')).toBe('/accounting');
  expect(node.querySelector('button')?.textContent).toBe('Try again');
});

it('words a gate that did not finish or failed outright', () => {
  const attempt = (status: 'timed_out' | 'error') => ({ status, started_at: '2026-10-29T17:30:00Z', finished_at: '2026-10-29T17:32:00Z', duration_ms: 120000 } as const);
  expect(doorLine(year(2024, { attempt: attempt('timed_out') }))).toBe('Gate did not finish (stopped at 120 s)');
  expect(doorLine(year(2024, { attempt: attempt('error') }))).toBe('Gate run failed');
});
