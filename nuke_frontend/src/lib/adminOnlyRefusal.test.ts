import { describe, expect, it } from 'vitest';
import { ADMIN_ONLY_TEXT, explainRefusal, isAdminOnlyRefusal } from './adminOnlyRefusal';

const refusal = () => new Response(JSON.stringify({ error: 'forbidden', reason: 'admins only' }), { status: 403 });

describe('adminOnlyRefusal', () => {
  it('reads a 403 from a fetch Response and from a functions.invoke error context', () => {
    expect(isAdminOnlyRefusal(refusal())).toBe(true);
    expect(isAdminOnlyRefusal({ name: 'FunctionsHttpError', context: refusal() })).toBe(true);
  });

  it('leaves other failures alone', () => {
    expect(isAdminOnlyRefusal(new Response('', { status: 500 }))).toBe(false);
    expect(isAdminOnlyRefusal({ context: new Response('', { status: 401 }) })).toBe(false);
    expect(isAdminOnlyRefusal(new Error('network'))).toBe(false);
    expect(isAdminOnlyRefusal(null)).toBe(false);
    const other = new Error('boom');
    expect(explainRefusal(other)).toBe(other);
  });

  it('turns a refusal into the plain sentence the page shows', () => {
    const shown = explainRefusal({ context: refusal() });
    expect(shown).toBeInstanceOf(Error);
    expect((shown as Error).message).toBe(ADMIN_ONLY_TEXT);
  });
});
