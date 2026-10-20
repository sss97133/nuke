import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A binding imported with `import type` (or `import { type X }`) is erased from the emitted module, so calling,
// constructing, reading a property of or rendering it throws at runtime. tsc reports it (TS1361), but nothing ran tsc
// on the app until 2026-10-19; this syntax-only scan keeps the class out of the source. PricingIntelligence.tsx had 17
// such calls on a service removed in 2025-11 and was deleted (it was imported nowhere).

const SRC = resolve(__dirname, '..');

function typeOnlyNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const clause = st.importClause;
    const all = clause.isTypeOnly;
    if (all && clause.name) names.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb) && all) names.add(nb.name.text);
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (all || el.isTypeOnly) names.add(el.name.text);
  }
  return names;
}

function insideType(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isHeritageClause(p) || ts.isImportDeclaration(p) || ts.isExportSpecifier(p)) return true;
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

export function typeOnlyValueUses(fileName: string, text: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const names = typeOnlyNames(sf);
  const out: string[] = [];
  if (names.size === 0) return out;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && names.has(node.text) && !insideType(node)) {
      const p = node.parent;
      const used = (ts.isCallExpression(p) && p.expression === node)
        || (ts.isNewExpression(p) && p.expression === node)
        || (ts.isPropertyAccessExpression(p) && p.expression === node)
        || (ts.isElementAccessExpression(p) && p.expression === node)
        || ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) && p.tagName === node);
      if (used) out.push(`${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}:${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '_archived') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

describe('type-only imports used as values', () => {
  it('finds a call, construction, property read and JSX use of a type-only binding, and ignores type positions', () => {
    const src = [
      "import type { svc, Shape, Widget } from './x';",
      "import { type Other, real } from './y';",
      'const a: Shape = svc.read();',
      'svc();',
      'new Other();',
      'const t: typeof svc = real;',
      'export const C = () => <Widget />;',
      'function f(x: Other): Shape { return x as Shape; }',
    ].join('\n');
    expect(typeOnlyValueUses('fixture.tsx', src)).toEqual(['fixture.tsx:3:svc', 'fixture.tsx:4:svc', 'fixture.tsx:5:Other', 'fixture.tsx:7:Widget']);
  });

  // Parses every source file (about 1 s locally, 6 s on CI runners), so it gets more than vitest's 5 s default.
  it('no source file under src calls, constructs, reads or renders a type-only import', () => {
    const found = sourceFiles(SRC).flatMap((f) => typeOnlyValueUses(relative(SRC, f), readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  }, 60_000);
});
