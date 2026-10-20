import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ORGANIZATION_VEHICLE_PRIVATE_COLUMNS, OWNERSHIP_TRANSFER_PRIVATE_COLUMNS, VEHICLE_OWNER_PII_COLUMNS, VEHICLE_PRIVATE_COLUMNS } from './privateMoney';
import { VEHICLE_CARD_COLUMNS } from '../components/vehicles/vehicleCardColumns';
import { VEHICLE_POPUP_COLUMNS } from '../components/popups/vehiclePopupColumns';

// The owner's money on vehicles and organization_vehicles is not granted to anon or authenticated
// (lib/privateMoney): a read that selects '*', names one of those columns, filters or orders on one,
// or returns every column after a write fails for every visitor. This scans the web's source for
// such reads so a new one fails CI instead of the page.
const PRIVATE: Record<string, readonly string[]> = {
  vehicles: [...VEHICLE_PRIVATE_COLUMNS, ...VEHICLE_OWNER_PII_COLUMNS],
  organization_vehicles: ORGANIZATION_VEHICLE_PRIVATE_COLUMNS,
  ownership_transfers: OWNERSHIP_TRANSFER_PRIVATE_COLUMNS,
};
const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
  'not', 'order', 'filter', 'textSearch', 'match', 'rangeGt', 'rangeLt', 'overlaps']);
const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

// A select argument's text: string literals as written, template placeholders as an opaque token.
function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => '__const__' + s.literal.text).join('');
  return null;
}

// Top-level columns of a select list: nested embeds removed, aliases and casts stripped.
function topLevelColumns(list: string): string[] {
  let depth = 0;
  let flat = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) flat += ch;
  }
  return flat.split(',').map((c) => c.trim().split('::')[0].split(':').pop()!.trim()).filter(Boolean);
}

function forbidden(columns: string[], table: string): string[] {
  return columns.filter((c) => c === '*' || PRIVATE[table].includes(c));
}

// Embedded reads of the two tables inside any select list: vehicles(...), vehicle:vehicles(...), vehicles!fk(...).
function embedViolations(list: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s,(:])(vehicles|organization_vehicles|ownership_transfers)(?:!\w+)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(list))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < list.length && depth > 0; i++) {
      if (list[i] === '(') depth++;
      else if (list[i] === ')') depth--;
    }
    const bad = forbidden(topLevelColumns(list.slice(start, i - 1)), m[1]);
    if (bad.length) out.push(`${m[1]}(${bad.join(', ')})`);
  }
  return out;
}

function scan(file: string, text: string): string[] {
  const found: string[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const where = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'select') {
        const list = literalText(node.arguments[0]);
        if (list) for (const bad of embedViolations(list)) found.push(`${where(node)} embeds ${bad}`);
      }
      const table = method === 'from' ? literalText(node.arguments[0]) : null;
      if (table && PRIVATE[table]) {
        // Walk the chain built on .from(table): .select(...).eq(...).order(...)
        let call: ts.Node = node;
        while (ts.isPropertyAccessExpression(call.parent) && ts.isCallExpression(call.parent.parent)
               && call.parent.parent.expression === call.parent) {
          const step = call.parent.parent as ts.CallExpression;
          const name = (call.parent as ts.PropertyAccessExpression).name.text;
          const first = literalText(step.arguments[0]);
          if (name === 'select') {
            if (step.arguments.length === 0) found.push(`${where(step)} ${table}: select() returns every column`);
            else if (first !== null) {
              const bad = forbidden(topLevelColumns(first), table);
              if (bad.length) found.push(`${where(step)} ${table}: selects ${bad.join(', ')}`);
            }
          } else if (FILTERS.has(name) && first !== null && PRIVATE[table].includes(first.split('.')[0].trim())) {
            found.push(`${where(step)} ${table}: ${name}('${first}')`);
          } else if (name === 'or' && first !== null) {
            const bad = PRIVATE[table].filter((c) => new RegExp(`(^|[,(])\\s*${c}\\.`).test(first));
            if (bad.length) found.push(`${where(step)} ${table}: or() on ${bad.join(', ')}`);
          }
          call = step;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function violations(): string[] {
  return sourceFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return /vehicles/.test(text) ? scan(relative(SRC, file), text) : [];
  });
}

describe('private money columns', () => {
  // Parses every source file (under 1 s locally, about 6x that on loaded CI runners), so it gets more than vitest's 5 s default.
  it('no web read selects, filters or returns the owner money columns of vehicles or organization_vehicles', () => {
    expect(violations()).toEqual([]);
  }, 60_000);

  it('the shared vehicle column lists carry no private column', () => {
    for (const list of [VEHICLE_CARD_COLUMNS, VEHICLE_POPUP_COLUMNS]) {
      expect(forbidden(topLevelColumns(list), 'vehicles')).toEqual([]);
    }
  });

  it('the scan catches the reads it exists to stop', () => {
    const hits = (src: string) => scan('probe.ts', src).length;
    expect(hits("supabase.from('vehicles').select('*').eq('id', id)")).toBe(1);
    expect(hits("supabase.from('vehicles').select('id, purchase_price')")).toBe(1);
    expect(hits("supabase.from('vehicles').select('id').not('purchase_price', 'is', null)")).toBe(1);
    expect(hits("supabase.from('vehicles').insert(row).select().single()")).toBe(1);
    expect(hits("supabase.from('organization_vehicles').select('id, cost_basis, vehicles(id, asking_price)')")).toBe(1);
    expect(hits("supabase.from('auction_events').select('*, vehicle:vehicles(*)')")).toBe(1);
    expect(hits("supabase.from('vehicles').select('*', { count: 'exact', head: true })")).toBe(1);
    expect(hits("supabase.from('vehicles').select('id, year, make, model').eq('make', make)")).toBe(0);
    expect(hits("supabase.from('organization_vehicles').select('id, vehicles!inner(id, sale_price)')")).toBe(0);
  });
});
