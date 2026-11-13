// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import UserBooksDoor from './UserBooksDoor';
import { answer, freshClient, gateYear, owner, rule, run, status } from '../../components/finance/__fixtures__/books';

// Synthetic: every id, year and time below is invented (see components/finance/__fixtures__/books.tsx).
let node: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); client = freshClient(); fixture.rpc.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); client.clear(); });
const reply = (data: unknown, error: unknown = null) => fixture.rpc.mockImplementation(() => answer({ data, error }));
const render = async (ui: React.ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>));
  for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
};

it('a visitor gets no heading, no row, no link and no request', async () => {
  expect(renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><UserBooksDoor userId={owner} isOwnProfile={false} /></MemoryRouter></QueryClientProvider>)).toBe('');
  await render(<UserBooksDoor userId={owner} isOwnProfile={false} />);
  expect(node.textContent).toBe('');
  expect(fixture.rpc).not.toHaveBeenCalled();
});

it('the owner sees one row per tax year with the stored gate verdict, when it ran, and one link to the books docket', async () => {
  reply(status([
    gateYear(2025, { run: run([rule('R1', 'fail', 2, 10), rule('R9', 'pass', 0, 5)], { stale: true, stale_books: true, trusted: false }), open_items: { total: 2, owner: 1, cpa: 0, agent: 0, unassigned: 1 } }),
    gateYear(2024, { run: run([rule('R1', 'pass', 0, 10), rule('R9', 'pass', 0, 5)]) }),
    gateYear(2023),
  ]));
  await render(<UserBooksDoor userId={owner} isOwnProfile />);
  expect(fixture.rpc).toHaveBeenCalledWith('books_gate_status', { p_owner_id: owner });
  const rows = Array.from(node.querySelectorAll('.k-row')).map(r => r.textContent);
  expect(rows).toEqual([
    '2025Not trusted · 1 rule failing · books changed since · ran Oct 29, 2026, 10:31 AM · 2 open',
    '2024Trusted · Oct 29, 2026, 10:31 AM',
    '2023Gate not run',
  ]);
  const links = Array.from(node.querySelectorAll('a'));
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute('href')).toBe('/accounting');
  expect(links[0].textContent).toBe('Open the books docket ›');
  // the count of years with a stored run is dated by the database's own clock
  expect(node.querySelector('.k-coverage')?.textContent).toBe('2 of 3 tax years with a stored gate run · Oct 29, 2026');
});

it('nothing is drawn while the status is being read', async () => {
  fixture.rpc.mockImplementation(() => Object.assign(new Promise(() => undefined), { abortSignal() { return this; } }));
  await render(<UserBooksDoor userId={owner} isOwnProfile />);
  expect(node.textContent).toBe('');
});

it('a failed read says so, offers a retry that reads again, and still lets the owner through to the docket', async () => {
  reply(null, { code: '57014' });
  await render(<UserBooksDoor userId={owner} isOwnProfile />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(node.textContent).toContain('The books status could not load.');
  expect(node.textContent).not.toMatch(/\b0 of 0 tax years\b.*(Trusted|Passed)/);
  expect(node.querySelector('a')?.getAttribute('href')).toBe('/accounting');
  expect(node.querySelector('button')?.textContent).toBe('Try again');
  reply(status([gateYear(2024, { run: run([rule('R1', 'pass', 0, 10)]) })]));
  await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(Array.from(node.querySelectorAll('.k-row')).map(r => r.textContent)).toEqual(['2024Trusted · Oct 29, 2026, 10:31 AM']);
});
