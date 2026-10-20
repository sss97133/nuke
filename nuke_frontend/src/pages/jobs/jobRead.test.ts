import { describe, expect, it } from 'vitest';
import {
  gapText, isWebSign, linePrice, parseAction, parseLine, parseStages, parseViewer, paymentsVisible, personHref, personLabel,
  plainValue, readFailure, signTerms, stageFacts, stageRung, vehicleText,
} from './jobRead';

describe('stage → trust rung', () => {
  it('maps the reader states onto the ladder and never reaches proven', () => {
    expect(stageRung('recorded', false)).toBe('attributed');
    expect(stageRung('partial', false)).toBe('pending');
    expect(stageRung('status_only', false)).toBe('recorded');
    expect(stageRung('absent', false)).toBeNull();
    expect(stageRung('withheld', false)).toBeNull();
    for (const s of ['recorded', 'partial', 'status_only', 'absent', 'novel_state']) {
      expect(stageRung(s, true)).toBe('conflicting');
      expect(stageRung(s, false)).not.toBe('proven');
    }
  });

  it('reads all seven stages in order, a missing one as null', () => {
    const stages = parseStages({ stages: { intake: { state: 'recorded', gaps: [], inconsistencies: [] }, terms: { state: 'partial', gaps: ['no_approval_clock'] } } });
    expect(stages.map(s => s.key)).toEqual(['intake', 'inspection', 'plan', 'terms', 'execution', 'completion', 'accounting']);
    expect(stages[1].state).toBeNull();
    expect(stages[3].gaps.map(gapText)).toEqual(['Quote not accepted yet']);
  });

  it('explains withheld acceptances and unmapped gaps in words', () => {
    expect(gapText('acceptance_withheld_quote_superseded')).toBe('Acceptance on hold: a newer quote replaced the accepted one');
    expect(gapText('some_new_gap')).toBe('Some new gap');
  });
});

describe('privacy at the edge', () => {
  it('drops contact, payment, id and hash facts from a stage', () => {
    const [stage] = parseStages({ stages: { intake: { state: 'recorded', created_at: '2026-04-30T02:29:27Z', scope_stated: true,
      customer_email: 'person@example.test', customer_phone: '555-0100', street_address: '1 Example Way', balance_due: 4200,
      amount_paid: 100, quote_id: '7b13f87c-d84c-492e-aa3a-544408e75597', scope_hash: 'a'.repeat(64) } } });
    const facts = stageFacts(stage);
    const text = JSON.stringify(facts);
    expect(facts.map(f => f.label)).toEqual(['Requested', 'Work described']);
    for (const leak of ['example.test', '555-0100', 'Example Way', '4200', '7b13f87c', 'aaaa']) expect(text).not.toContain(leak);
  });

  it('names people by handle or organization only, never a private name', () => {
    expect(personLabel({ kind: 'user', handle: 'mechanic1', name: 'Private Person' })).toBe('@mechanic1');
    expect(personLabel({ kind: 'user', name: 'Private Person' })).toBe('Unnamed party');
    expect(personLabel({ kind: 'organization', name: 'Example Shop' })).toBe('Example Shop');
    expect(personLabel(null)).toBe('Unnamed party');
    expect(personHref({ handle: 'mechanic1' })).toBe('/providers/mechanic1');
    expect(personHref({ kind: 'user', profile_id: '7b13f87c-d84c-492e-aa3a-544408e75597' })).toBeNull();
  });

  it('opens payments only when the server says money is visible and sent them', () => {
    expect(paymentsVisible(parseViewer({ money_visible: false }), [{ amount: 1 }])).toBe(false);
    expect(paymentsVisible(parseViewer({ money_visible: 'true' }), [{ amount: 1 }])).toBe(false);
    expect(paymentsVisible(parseViewer({ money_visible: true }), null)).toBe(false);
    expect(paymentsVisible(null, [])).toBe(false);
    expect(paymentsVisible(parseViewer({ money_visible: true }), [])).toBe(true);
  });

  it('reads ids and hashes as "On record", never as text', () => {
    expect(plainValue('7b13f87c-d84c-492e-aa3a-544408e75597')).toBe('On record');
    expect(plainValue({ quote_id: 'x', role: 'customer', customer_email: 'a@b.test' })).toBe('role customer');
    expect(plainValue('not_assessed')).toBe('Not assessed yet');
  });
});

describe('actions come from the server', () => {
  it('reads action objects keyed by action or kind, and bare strings', () => {
    expect(parseAction({ action: 'start_work', rpc: 'start_work', args: { p_work_order_id: 'w' }, binds: ['x'], does_not_bind: ['payment'] }))
      .toMatchObject({ kind: 'start_work', rpc: 'start_work', binds: ['x'], doesNotBind: ['payment'] });
    expect(parseAction({ kind: 'pay_invoice' })?.kind).toBe('pay_invoice');
    expect(parseAction('accept_quote')?.kind).toBe('accept_quote');
    expect(parseAction({ rpc: 'nothing' })).toBeNull();
  });

  it('signs on the web only when the named writer matches the step', () => {
    expect(isWebSign(parseAction({ action: 'accept_quote', rpc: 'accept_work_order_quote', args: {} })!)).toBe(true);
    expect(isWebSign(parseAction({ action: 'accept_quote', rpc: 'record_work_order_payment', args: {} })!)).toBe(false);
    expect(isWebSign(parseAction({ action: 'record_payment', rpc: 'record_work_order_payment', args: {} })!)).toBe(false);
    expect(isWebSign(parseAction({ action: 'pay_invoice' })!)).toBe(false);
  });

  it('states what signing says and does not, server words first, and that no money moves', () => {
    const server = signTerms(parseAction({ action: 'start_work', rpc: 'start_work', binds: ['your statement that you started'], does_not_bind: ['completion', 'payment'] })!);
    expect(server.says).toEqual(['Your statement that you started']);
    expect(server.doesNotSay).toEqual(['That the work is done', 'Any payment', 'No money moves']);
    const fallback = signTerms(parseAction({ action: 'accept_quote', rpc: 'accept_work_order_quote' })!);
    expect(fallback.says[0]).toContain('exact quote version');
    expect(fallback.doesNotSay).toContain('That a deposit was paid');
  });
});

describe('quotes, vehicles and failures', () => {
  it('prices a line in its basis', () => {
    expect(linePrice(parseLine({ amount: 160, currency: 'USD', pricing_basis: 'hourly', quantity: 3 }))).toBe('$160.00 / hour × 3');
    expect(linePrice(parseLine({ amount: '450', currency: 'USD', pricing_basis: 'flat' }))).toBe('$450.00');
    expect(linePrice(parseLine({ description: 'x' }))).toBe('Not priced');
  });
  it('names a vehicle from its label, skipping unresolved parts', () => {
    expect(vehicleText({ text: '1983 GMC K2500 Sierra Classic' })).toBe('1983 GMC K2500 Sierra Classic');
    expect(vehicleText({ text: 'UNRESOLVED', year: 1984, make: 'Chevrolet', model: 'UNRESOLVED' })).toBe('1984 Chevrolet');
    expect(vehicleText({})).toBeNull();
  });
  it('explains a failed read', () => {
    expect(readFailure({ message: 'Work order unavailable', code: 'P0001' })).toBe("This isn't public, or it doesn't exist.");
    expect(readFailure({ message: 'canceling statement due to statement timeout', code: '57014' })).toContain('too long');
  });
});
