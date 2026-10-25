/** Offline source inventory used by refresh-facts.mjs. Source reachability is not runtime readiness. */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const testFile = file => /(?:\.test\.|\.spec\.|\/__tests__\/)/.test(file);
const unique = values => [...new Set(values)].sort();
const counts = values => Object.fromEntries([...values.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));
const joinRoute = (prefix, child) => `/${[prefix.replace(/\/\*$/, ''), child].join('/').split('/').filter(Boolean).join('/')}`;

export function inventoryCodebase(repo, suppliedFiles) {
  // Resolve the project's installed parser; never download a package for an inventory.
  const require = createRequire(path.join(repo, 'nuke_frontend/package.json'));
  const ts = require('typescript');
  const files = suppliedFiles || execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
  const known = new Set(files);
  const frontend = files.filter(file => file.startsWith('nuke_frontend/src/') && /\.[jt]sx?$/.test(file));
  const modules = new Map();
  const resolve = (from, specifier) => {
    const base = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
      : specifier.startsWith('@/') ? `nuke_frontend/src/${specifier.slice(2)}` : null;
    if (!base) return null;
    return [base, ...['.tsx', '.ts', '.jsx', '.js', '.css', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map(suffix => base + suffix)].find(file => known.has(file)) || null;
  };
  const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
  const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  const jsxName = node => (ts.isJsxElement(node) ? node.openingElement : node).tagName?.getText();
  const jsxTags = node => { const tags = []; if (node) walk(node, child => { if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) tags.push(child.tagName.getText()); }); return unique(tags); };
  const attrs = node => {
    const result = {};
    for (const attr of (ts.isJsxElement(node) ? node.openingElement : node).attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      result[attr.name.text] = !attr.initializer ? true : ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer;
    }
    return result;
  };
  for (const file of frontend) {
    if (!existsSync(path.join(repo, file))) continue;
    const source = ts.createSourceFile(file, readFileSync(path.join(repo, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const data = { file, imports: [], bindings: new Map(), locals: new Map(), routes: [], calls: [], links: [], unresolvedImports: [], dynamicCalls: 0, parseErrors: source.parseDiagnostics.length };
    modules.set(file, data);
    const line = node => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    walk(source, node => {
      if (ts.isImportDeclaration(node)) {
        const specifier = literal(node.moduleSpecifier), target = resolve(file, specifier || '');
        if (target) data.imports.push(target);
        else if (specifier?.startsWith('.') || specifier?.startsWith('@/')) data.unresolvedImports.push({ specifier, line: line(node) });
        if (target && node.importClause) {
          if (node.importClause.name) data.bindings.set(node.importClause.name.text, target);
          const bindings = node.importClause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) data.bindings.set(element.name.text, target);
        }
      }
      // Barrels are part of the module graph, including `export *` and renamed re-exports.
      // This is conservative module reachability, not a tree-shaking/liveness verdict.
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const specifier = literal(node.moduleSpecifier), target = resolve(file, specifier || '');
        if (target) data.imports.push(target);
        else if (specifier?.startsWith('.') || specifier?.startsWith('@/')) data.unresolvedImports.push({ specifier, line: line(node) });
      }
      if (ts.isFunctionDeclaration(node) && node.name) data.locals.set(node.name.text, node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        data.locals.set(node.name.text, node.initializer);
        walk(node.initializer, child => {
          if (!ts.isCallExpression(child) || child.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
          const target = resolve(file, literal(child.arguments[0]) || '');
          if (target) data.bindings.set(node.name.text, target);
        });
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(), argument = literal(node.arguments[0]);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && argument) {
          const target = resolve(file, argument);
          if (target) data.imports.push(target);
          else if (argument.startsWith('.')) data.unresolvedImports.push({ specifier: argument, line: line(node) });
        }
        const kind = /\.functions\.invoke$/.test(callee) ? 'edge_function' : /\.rpc$/.test(callee) ? 'rpc' : /\bsupabase\.from$/.test(callee) ? 'relation' : null;
        if (kind) {
          if (argument) data.calls.push({ kind, name: argument, file, line: line(node) });
          else data.dynamicCalls++;
        }
        if (argument?.startsWith('/') && /^(?:navigate|go)$/.test(callee)) data.links.push({ target: argument, line: line(node), kind: 'navigation' });
      }
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && jsxName(node) === 'Route') {
        const props = attrs(node);
        const parents = [];
        for (let parent = node.parent; parent; parent = parent.parent) {
          if ((ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) && jsxName(parent) === 'Route') parents.unshift(attrs(parent));
        }
        const elements = jsxTags(props.element);
        const guards = unique([...parents.flatMap(parent => jsxTags(parent.element)), ...elements].filter(name => /^(?:ProtectedRoute|RequireAdmin|AdminGuard)$/.test(name)));
        let redirect = null;
        if (props.element) walk(props.element, child => {
          if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && jsxName(child) === 'Navigate') redirect = literal(attrs(child).to);
        });
        if ('path' in props || props.index) data.routes.push({ path: props.index ? '' : literal(props.path), parentPaths: parents.map(parent => literal(parent.path)).filter(Boolean), index: !!props.index, line: line(node), elements, guards, redirect });
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const props = attrs(node), target = literal(props.to) || literal(props.href);
        if (target?.startsWith('/')) data.links.push({ target, line: line(node), kind: 'link' });
      }
    });
    data.imports = unique(data.imports);
  }
  const closure = entrypoints => {
    const visited = new Set(), pending = [...entrypoints];
    while (pending.length) {
      const current = pending.pop();
      if (!current || visited.has(current) || testFile(current)) continue;
      visited.add(current);
      for (const imported of modules.get(current)?.imports || []) pending.push(imported);
    }
    return [...visited].sort();
  };
  const routes = [], visitedRoutes = new Set();
  function register(file, prefix = '', inheritedGuards = [], host = 'main') {
    const data = modules.get(file), key = `${host}:${prefix}:${file}`;
    if (!data || visitedRoutes.has(key)) return;
    visitedRoutes.add(key);
    for (const route of data.routes) {
      if (route.path === null) continue;
      const pattern = joinRoute(prefix, [...route.parentPaths, route.path].join('/'));
      const owners = new Set();
      for (const tag of route.elements) {
        if (data.bindings.has(tag)) owners.add(data.bindings.get(tag));
        else if (data.locals.has(tag)) for (const nested of jsxTags(data.locals.get(tag))) if (data.bindings.has(nested)) owners.add(data.bindings.get(nested));
      }
      const children = [...owners].filter(owner => modules.get(owner)?.routes.length);
      const components = [...owners].filter(owner => !children.includes(owner) && !/(?:auth\/|layout\/|contexts\/)/.test(owner));
      const dependencies = closure(components);
      const calls = dependencies.flatMap(owner => modules.get(owner)?.calls || []);
      const guards = unique([...inheritedGuards, ...route.guards]);
      routes.push({ pattern, host, kind: children.length ? 'router' : route.redirect ? 'redirect' : route.path === '*' ? 'fallback' : 'page', owner: file, line: route.line, components, guards,
        access: guards.includes('RequireAdmin') ? 'admin_route_guard' : guards.includes('ProtectedRoute') ? 'signed_in_route_guard' : 'no_route_guard_detected',
        redirect: route.redirect, dependencies, backend_calls: calls, dynamic_backend_calls: dependencies.reduce((sum, owner) => sum + (modules.get(owner)?.dynamicCalls || 0), 0),
        validation: { source: 'indexed', runtime: 'not_assessed', data_correctness: 'not_assessed', action_flow: 'not_assessed' } });
      for (const child of children) register(child, pattern.replace(/\/\*$/, ''), guards, host);
    }
  }
  register('nuke_frontend/src/App.tsx');
  register('nuke_frontend/src/storefront/StorefrontApp.tsx', '', [], 'subdomain');
  routes.sort((a, b) => a.host.localeCompare(b.host) || a.pattern.localeCompare(b.pattern));
  const reachable = new Set(closure(['nuke_frontend/src/main.tsx']));
  const pageSources = frontend.filter(file => file.startsWith('nuke_frontend/src/pages/') && file.endsWith('.tsx') && !testFile(file)).map(file => ({
    file, routes: routes.filter(route => route.components.includes(file)).map(route => route.pattern),
    reachable_from_entrypoint: reachable.has(file),
    role: routes.some(route => route.components.includes(file)) ? 'route_component' : reachable.has(file) ? 'imported_page_support' : 'no_static_entrypoint_path_found',
    backend_calls: modules.get(file)?.calls || [], tests: frontend.filter(test => testFile(test) && modules.get(test)?.imports.includes(file)),
    validation: { source: 'indexed', runtime: 'not_assessed', data_correctness: 'not_assessed', action_flow: 'not_assessed' },
  }));
  const matchers = routes.filter(route => route.kind !== 'router' && route.kind !== 'fallback').map(route => ({ host: route.host, pattern: new RegExp(`^${route.pattern.split('/').map(piece => piece === '*' ? '.*' : piece.startsWith(':') ? '[^/]+' : piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}/?$`) }));
  const unmatchedLinks = [...modules.values()].filter(data => reachable.has(data.file) && !testFile(data.file)).flatMap(data => data.links.map(link => ({ file: data.file, ...link })))
    .filter(link => !link.target.startsWith('//') && !matchers.some(matcher => matcher.host === (link.file.includes('/storefront/') ? 'subdomain' : 'main') && matcher.pattern.test(link.target.split(/[?#]/)[0])));
  return {
    contract: 'nuke_codebase_inventory_v1', generated_at: new Date().toISOString(), generated_by: 'scripts/ledger/refresh-facts.mjs --codebase',
    commit: suppliedFiles ? null : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    limits: ['Current working-file source at the named commit; uncommitted edits may be included and unstaged new files are omitted.', 'Literal JSX Route declarations and static relative/@ imports/re-exports only; dynamic paths remain unresolved.', 'Dependencies traverse whole barrel modules conservatively, not tree-shaken export usage; route component ownership records the directly imported module.', 'Route guards are client navigation evidence, not database authorization.', 'A missing static import path is not evidence that a feature is dead.', 'Backend calls are names in the transitive source graph, not proof of deployment, access, data quality or use at runtime.', 'Unmatched navigation targets are candidates; API routes, downloads and server handlers require separate inspection.', 'No runtime or product-readiness verdict is inferred from indexing.'],
    counts: { tracked_files: files.length, top_level: counts(files.map(file => file.split('/')[0])), languages: counts(files.map(file => path.extname(file) || '(none)')), frontend_source_modules: modules.size,
      registered_routes: routes.length, route_kinds: counts(routes.map(route => route.kind)), route_access: counts(routes.map(route => route.access)), page_sources: pageSources.length,
      page_roles: counts(pageSources.map(page => page.role)), unmatched_literal_navigation_candidates: unmatchedLinks.length, source_parse_errors: [...modules.values()].reduce((sum, data) => sum + data.parseErrors, 0),
      runtime_assessed_routes: 0 },
    routes, page_sources: pageSources, unmatched_literal_navigation_candidates: unmatchedLinks,
    unresolved_local_imports: [...modules.values()].filter(data => reachable.has(data.file)).flatMap(data => data.unresolvedImports.map(item => ({ file: data.file, ...item }))),
    source_parse_errors: [...modules.values()].filter(data => data.parseErrors).map(data => ({ file: data.file, errors: data.parseErrors })),
    files: files.map(file => ({ path: file, extension: path.extname(file), bytes: existsSync(path.join(repo, file)) ? statSync(path.join(repo, file)).size : null })),
  };
}
