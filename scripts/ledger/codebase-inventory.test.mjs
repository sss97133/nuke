import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryCodebase } from './codebase-inventory.mjs';

test('indexes nested guarded routes, aliases, support modules and unresolved links without readiness claims', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'nuke-inventory-'));
  const files = {
    'nuke_frontend/package.json': '{}',
    'nuke_frontend/src/main.tsx': "import './App';",
    'nuke_frontend/src/App.tsx': `import React from 'react'; import {Route} from 'react-router-dom';
      const Domain = React.lazy(() => import('./routes/Domain'));
      export default () => <Route path="/office/*" element={<Domain/>}/>;`,
    'nuke_frontend/src/routes/Domain.tsx': `import React from 'react'; import {Route, Navigate} from 'react-router-dom';
      import {Report as ReportAlias} from '../pages/Report';
      export default () => <Routes><Route element={<ProtectedRoute/>}>
        <Route index element={<ReportAlias/>}/><Route path="records/:id" element={<ReportAlias/>}/>
      </Route><Route path="old" element={<Navigate to="/office" replace/>}/></Routes>;`,
    'nuke_frontend/src/pages/Report.tsx': `import './support'; import {load} from '../services/report';
      export const Report = () => <><Link to="/office/records/example">Record</Link><Link to="/missing">Missing</Link></>;`,
    'nuke_frontend/src/pages/ReportDetail.tsx': 'export default () => <div/>;',
    'nuke_frontend/src/pages/Dormant.tsx': 'export default () => <div/>;',
    'nuke_frontend/src/pages/Report.test.tsx': "import {Report} from './Report';",
    'nuke_frontend/src/pages/support.ts': "export * from './ReportDetail';",
    'nuke_frontend/src/services/report.ts': "export {read as load} from './reportReader';",
    'nuke_frontend/src/services/reportReader.ts': "export const read = () => supabase.rpc('read_report');",
  };
  try {
    for (const [file, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), content); }
    symlinkSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../nuke_frontend/node_modules'), path.join(repo, 'nuke_frontend/node_modules'));
    const inventory = inventoryCodebase(repo, Object.keys(files));
    assert.equal(inventory.counts.registered_routes, 4);
    const detail = inventory.routes.find(route => route.pattern === '/office/records/:id');
    assert.equal(detail.access, 'signed_in_route_guard');
    assert.equal(detail.backend_calls[0].name, 'read_report');
    assert.equal(detail.validation.runtime, 'not_assessed');
    assert.deepEqual(inventory.page_sources.map(page => [page.file.split('/').pop(), page.role]), [
      ['Report.tsx', 'route_component'], ['ReportDetail.tsx', 'imported_page_support'], ['Dormant.tsx', 'no_static_entrypoint_path_found'],
    ]);
    assert.equal(inventory.page_sources[0].tests.length, 1);
    assert.deepEqual(inventory.unmatched_literal_navigation_candidates.map(link => link.target), ['/missing']);
    assert.equal(inventory.routes.find(route => route.pattern === '/office/old').redirect, '/office');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
