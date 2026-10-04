// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  user: null as { id: string } | null,
  identities: [] as any[], claims: [] as any[], identityError: null as any, claimError: null as any,
  reads: [] as { table: string; filters: [string, string][]; limit: number; columns: string }[],
  sourceResult: null as Promise<any> | null,
  rpc: vi.fn(), invoke: vi.fn(),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: fixture.user ? { user: fixture.user } : null } }) },
  functions: { invoke: fixture.invoke }, rpc: fixture.rpc,
  from: (table: string) => {
    const read = { table, filters: [] as [string, string][], limit: 0, columns: '' };
    let countOnly = false;
    const query = {
      select: (columns: string, options?: any) => { read.columns = columns; countOnly = !!options?.head; return query; },
      eq: (column: string, value: string) => { read.filters.push([column, value]); return query; },
      is: () => query, order: () => query,
      limit: (value: number) => { read.limit = value; return query; },
      then: (resolve: any, reject: any) => {
        if (countOnly) return Promise.resolve({ count: 0 }).then(resolve, reject);
        fixture.reads.push(read);
        const result = table === 'external_identities'
          ? fixture.sourceResult || Promise.resolve({ data: fixture.identities, error: fixture.identityError })
          : Promise.resolve({ data: fixture.claims, error: fixture.claimError });
        return result.then(resolve, reject);
      },
    };
    return query;
  },
} }));

import ClaimExternalIdentity from './ClaimExternalIdentity';

let root: Root, container: HTMLDivElement;
async function render() { await act(async () => root.render(<ClaimExternalIdentity />)); }
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.user = { id: 'signed-in-user' }; fixture.identities = []; fixture.claims = [];
  fixture.identityError = null; fixture.claimError = null; fixture.sourceResult = null; fixture.reads = [];
  fixture.rpc.mockReset(); fixture.invoke.mockReset();
  window.history.replaceState({}, '', '/claim-identity');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('signed-in source account visibility', () => {
  it('shows a linked non-bid account with unknown proof without fabricating verification or requesting contact fields', async () => {
    fixture.identities = [{ id: 'source-account', platform: 'bat', handle: 'SellerHandle', profile_url: 'https://bringatrailer.com/member/sellerhandle/' }];
    await render();
    const panel = container.querySelector('[aria-label="Your linked source accounts"]');
    expect(panel?.textContent).toContain('SellerHandle');
    expect(panel?.textContent).toContain('seller responses');
    expect(panel?.textContent).toContain('proof record unavailable');
    expect(fixture.reads).toEqual([
      { table: 'external_identities', filters: [['claimed_by_user_id', 'signed-in-user']], limit: 100, columns: 'id, platform, handle, profile_url' },
      { table: 'account_link_claims', filters: [['user_id', 'signed-in-user']], limit: 100, columns: 'id, platform, handle, external_identity_id, status' },
    ]);
  });

  it('joins proof status only by the canonical account UUID, preserving platform and case differences', async () => {
    fixture.identities = [{ id: 'bat-id', platform: 'bat', handle: 'SharedHandle', profile_url: null }];
    fixture.claims = [
      { id: 'other-request', platform: 'cars_and_bids', handle: 'SharedHandle', external_identity_id: 'other-id', status: 'verified' },
      { id: 'bat-request', platform: 'bat', handle: 'sharedhandle', external_identity_id: 'bat-id', status: 'pending_review' },
    ];
    await render();
    const panel = container.querySelector('[aria-label="Your linked source accounts"]');
    expect(panel?.textContent).toContain('Stored claim status: pending_review');
    expect(panel?.textContent).not.toContain('verified');
    expect(container.querySelector('[aria-label="Your source account claim requests"]')?.textContent).toContain('Cars & Bids');
  });

  it('keeps a failed claim read separate from absence of a proof record', async () => {
    fixture.identities = [{ id: 'source-account', platform: 'bat', handle: 'Handle', profile_url: 'javascript:alert(1)' }];
    fixture.claimError = { message: 'denied' };
    await render();
    expect(container.textContent).toContain('Claim status could not be loaded');
    expect(container.textContent).toContain('Claim status unavailable');
    expect(container.textContent).not.toContain('proof record unavailable');
    expect(container.querySelector('[aria-label="Your linked source accounts"] a')).toBeNull();
  });

  it('does not query own account records while signed out or render an empty account widget', async () => {
    fixture.user = null; await render(); expect(fixture.reads).toEqual([]);
    expect(container.querySelector('[aria-label="Your linked source accounts"]')).toBeNull();
    fixture.user = { id: 'signed-in-user' }; await render();
    expect(container.querySelector('[aria-label="Your linked source accounts"]')).toBeNull();
    expect(container.querySelector('[aria-label="Your source account claim requests"]')).toBeNull();
  });

  it('clears another signed-in account immediately and rejects an old in-flight account response', async () => {
    let finish!: (value: any) => void;
    fixture.sourceResult = new Promise(resolve => { finish = resolve; });
    await render();
    fixture.user = { id: 'different-user' }; fixture.sourceResult = null;
    fixture.identities = [{ id: 'new-source', platform: 'bat', handle: 'NewAccount', profile_url: null }];
    await render();
    await act(async () => finish({ data: [{ id: 'old-source', platform: 'bat', handle: 'OldAccount' }], error: null }));
    expect(container.textContent).toContain('NewAccount'); expect(container.textContent).not.toContain('OldAccount');
    fixture.user = null; await render(); expect(container.textContent).not.toContain('NewAccount');
  });

  it('does not attach a lexical-only pending claim to an existing account link', async () => {
    fixture.identities = [{ id: 'source', platform: 'bat', handle: 'Handle', profile_url: null }];
    fixture.claims = [{ id: 'request', platform: 'bat', handle: 'Handle', external_identity_id: null, status: 'approved' }];
    await render();
    expect(container.querySelector('[aria-label="Your linked source accounts"]')?.textContent).toContain('proof record unavailable');
    expect(container.querySelector('[aria-label="Your source account claim requests"]')?.textContent).toContain('approved');
  });

  it('stores the existing request without inventing an automatic verifier, SMS destination or access grant', async () => {
    fixture.invoke.mockResolvedValue({ data: { results: [{ id: 'source', platform: 'bat', handle: 'Unclaimed', profile_url: null, stats: null }] }, error: null });
    fixture.rpc.mockResolvedValue({ data: 'request-id', error: null });
    window.history.replaceState({}, '', '/claim-identity?handle=Unclaimed');
    await render(); await act(async () => vi.advanceTimersByTimeAsync(301));
    const result = [...container.querySelectorAll('div')].find(el => el.textContent === 'Unclaimed' && el.style.fontWeight === '700');
    expect(result).toBeTruthy(); await act(async () => result!.click());
    const start = [...container.querySelectorAll('button')].find(el => el.textContent === 'START CLAIM');
    expect(start).toBeTruthy(); await act(async () => start!.click());
    expect(fixture.rpc).toHaveBeenCalledWith('request_external_identity_claim', expect.objectContaining({ p_handle: 'Unclaimed', p_proof_url: null }));
    expect(container.textContent).toContain('Approval is required');
    expect(container.textContent).toContain('does not establish control');
    expect(container.textContent).not.toContain('555'); expect(container.textContent).not.toContain('verified instantly');
    expect(container.textContent).not.toContain('NUKE-'); expect(container.textContent).not.toContain('proxy bidding');
  });
});
