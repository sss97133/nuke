/**
 * Tests for scope grammar parser.
 *
 * Run with:
 *   deno test --allow-all supabase/functions/_shared/scopeGrammar.test.ts
 */

import {
  parseScope,
  scopeMatches,
  vinFromScope,
  type ScopeRequest,
} from './scopeGrammar.ts';

const MUSTANG_VIN = '6F07C219593';
const OTHER_VIN = '1G8ZK5275XZ123456';

const writeMustang: ScopeRequest = {
  resource: 'events',
  action: 'write',
  target: 'vehicle',
  targetId: MUSTANG_VIN,
};

const writeOther: ScopeRequest = {
  resource: 'events',
  action: 'write',
  target: 'vehicle',
  targetId: OTHER_VIN,
};

const readMustang: ScopeRequest = {
  resource: 'events',
  action: 'read',
  target: 'vehicle',
  targetId: MUSTANG_VIN,
};

// --- parseScope ----------------------------------------------------------

Deno.test('parseScope: legacy write', () => {
  const p = parseScope('write');
  if (!p || p.kind !== 'legacy' || p.legacy !== 'write') {
    throw new Error(`expected legacy write, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: legacy read', () => {
  const p = parseScope('read');
  if (!p || p.kind !== 'legacy' || p.legacy !== 'read') {
    throw new Error(`expected legacy read, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: legacy admin', () => {
  const p = parseScope('admin');
  if (!p || p.kind !== 'legacy' || p.legacy !== 'admin') {
    throw new Error(`expected legacy admin, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: events:write:all', () => {
  const p = parseScope('events:write:all');
  if (!p || p.kind !== 'all' || p.action !== 'write') {
    throw new Error(`expected all/write, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: events:read:all', () => {
  const p = parseScope('events:read:all');
  if (!p || p.kind !== 'all' || p.action !== 'read') {
    throw new Error(`expected all/read, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: events:write:vehicle:{VIN} normalizes uppercase', () => {
  const p = parseScope(`events:write:vehicle:${MUSTANG_VIN.toLowerCase()}`);
  if (!p || p.kind !== 'vehicle' || p.action !== 'write' || p.vin !== MUSTANG_VIN) {
    throw new Error(`expected vehicle/write/${MUSTANG_VIN}, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: events:read:vehicle:{VIN}', () => {
  const p = parseScope(`events:read:vehicle:${MUSTANG_VIN}`);
  if (!p || p.kind !== 'vehicle' || p.action !== 'read' || p.vin !== MUSTANG_VIN) {
    throw new Error(`expected vehicle/read/${MUSTANG_VIN}, got ${JSON.stringify(p)}`);
  }
});

Deno.test('parseScope: malformed returns null', () => {
  const cases = [
    '',
    'garbage',
    'events',
    'events:write',
    'events:write:vehicle',
    'events:write:vehicle:',
    'events:delete:all',
    'events:write:wildcard',
    'events:write:vehicle:VIN:extra',
    null,
    undefined,
  ];
  for (const c of cases) {
    const p = parseScope(c as string);
    if (p !== null) {
      throw new Error(`expected null for ${JSON.stringify(c)}, got ${JSON.stringify(p)}`);
    }
  }
});

// --- vinFromScope --------------------------------------------------------

Deno.test('vinFromScope: returns VIN for vehicle scope', () => {
  if (vinFromScope(`events:write:vehicle:${MUSTANG_VIN}`) !== MUSTANG_VIN) {
    throw new Error('expected VIN extracted');
  }
});

Deno.test('vinFromScope: null for legacy/all/malformed', () => {
  if (vinFromScope('write') !== null) throw new Error('legacy should be null');
  if (vinFromScope('events:write:all') !== null) throw new Error('all should be null');
  if (vinFromScope('garbage') !== null) throw new Error('malformed should be null');
});

// --- scopeMatches --------------------------------------------------------

Deno.test('scopeMatches: write scope on right VIN allows', () => {
  const ok = scopeMatches([`events:write:vehicle:${MUSTANG_VIN}`], writeMustang);
  if (!ok) throw new Error('expected allow');
});

Deno.test('scopeMatches: write scope on wrong VIN rejects', () => {
  const ok = scopeMatches([`events:write:vehicle:${OTHER_VIN}`], writeMustang);
  if (ok) throw new Error('expected reject');
});

Deno.test('scopeMatches: events:write:all allows any VIN', () => {
  const a = scopeMatches(['events:write:all'], writeMustang);
  const b = scopeMatches(['events:write:all'], writeOther);
  if (!a || !b) throw new Error('expected allow on both');
});

Deno.test('scopeMatches: legacy write allows any VIN', () => {
  const a = scopeMatches(['write'], writeMustang);
  const b = scopeMatches(['write'], writeOther);
  if (!a || !b) throw new Error('expected allow on both');
});

Deno.test('scopeMatches: legacy read rejects writes', () => {
  const ok = scopeMatches(['read'], writeMustang);
  if (ok) throw new Error('expected reject');
});

Deno.test('scopeMatches: legacy read allows reads', () => {
  const ok = scopeMatches(['read'], readMustang);
  if (!ok) throw new Error('expected allow');
});

Deno.test('scopeMatches: admin allows everything', () => {
  if (!scopeMatches(['admin'], writeMustang)) throw new Error('expected admin write');
  if (!scopeMatches(['admin'], readMustang)) throw new Error('expected admin read');
  if (!scopeMatches(['admin'], writeOther)) throw new Error('expected admin other');
});

Deno.test('scopeMatches: events:read scope rejects write request', () => {
  const ok = scopeMatches([`events:read:vehicle:${MUSTANG_VIN}`], writeMustang);
  if (ok) throw new Error('read scope must not authorize write');
});

Deno.test('scopeMatches: events:write scope does not implicitly grant read', () => {
  const ok = scopeMatches([`events:write:vehicle:${MUSTANG_VIN}`], readMustang);
  if (ok) throw new Error('write scope must not authorize read implicitly');
});

Deno.test('scopeMatches: VIN match is case-insensitive', () => {
  const granted = [`events:write:vehicle:${MUSTANG_VIN.toLowerCase()}`];
  const ok = scopeMatches(granted, writeMustang);
  if (!ok) throw new Error('VIN compare should be case-insensitive');
});

Deno.test('scopeMatches: empty/null granted rejects', () => {
  if (scopeMatches([], writeMustang)) throw new Error('empty should reject');
  if (scopeMatches(null, writeMustang)) throw new Error('null should reject');
  if (scopeMatches(undefined, writeMustang)) throw new Error('undefined should reject');
});

Deno.test('scopeMatches: malformed scopes silently ignored, not auth bypass', () => {
  const ok = scopeMatches(['garbage', 'events:delete:all', 'events:'], writeMustang);
  if (ok) throw new Error('malformed should not authorize');
});

Deno.test('scopeMatches: mixed grants — first matching wins', () => {
  const granted = [
    'read',
    `events:write:vehicle:${OTHER_VIN}`,
    `events:write:vehicle:${MUSTANG_VIN}`,
  ];
  if (!scopeMatches(granted, writeMustang)) throw new Error('expected match');
});
