/**
 * RALPH WIGGUM VALIDATION LOOP
 *
 * Autonomous validation using:
 * - Vercel CLI: Deployment status
 * - Supabase CLI: Database validation
 * - GitHub CLI: Repo state
 * - Playwright: Visual verification
 */

import { chromium, Browser, Page } from 'playwright';
import { execSync, exec } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Configuration
const PRODUCTION_URL = 'https://nuke-mw2aw416v-nzero.vercel.app';
const LOCAL_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = '/Users/skylar/nuke/.ralph/screenshots';

interface ValidationResult {
  category: string;
  check: string;
  passed: boolean;
  details: string;
  timestamp: string;
}

interface LoopStatus {
  iteration: number;
  validations: ValidationResult[];
  overallPassed: boolean;
  timestamp: string;
}

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function runCommand(cmd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
    return { success: true, output };
  } catch (err: any) {
    return { success: false, output: err.message || String(err) };
  }
}

// === VERCEL CLI VALIDATION ===
async function validateVercel(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const timestamp = new Date().toISOString();

  // Check deployment status
  const deployResult = runCommand('cd /Users/skylar/nuke && vercel ls 2>&1 | head -15');
  const isDeployed = deployResult.output.includes('● Ready');
  results.push({
    category: 'Vercel',
    check: 'Latest deployment ready',
    passed: isDeployed,
    details: isDeployed ? 'Production deployment active' : deployResult.output.slice(0, 200),
    timestamp
  });

  // Check project info
  const projectResult = runCommand('cd /Users/skylar/nuke && vercel inspect --yes 2>&1 | head -10');
  const hasProject = projectResult.output.includes('nuke') || projectResult.output.includes('Vercel');
  results.push({
    category: 'Vercel',
    check: 'Project configured',
    passed: hasProject,
    details: hasProject ? 'Vercel project linked' : projectResult.output.slice(0, 200),
    timestamp
  });

  return results;
}

// === SUPABASE CLI VALIDATION ===
async function validateSupabase(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const timestamp = new Date().toISOString();

  // Check local Supabase status
  const statusResult = runCommand('cd /Users/skylar/nuke && supabase status 2>&1');
  const isRunning = statusResult.output.includes('running') || statusResult.output.includes('Studio');
  results.push({
    category: 'Supabase',
    check: 'Local Supabase running',
    passed: isRunning,
    details: isRunning ? 'Supabase services active' : statusResult.output.slice(0, 200),
    timestamp
  });

  // Check database connectivity via Supabase client
  const { count, error } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });

  results.push({
    category: 'Supabase',
    check: 'Database connectivity',
    passed: !error,
    details: error ? error.message : `Connected. Vehicle count: ${count}`,
    timestamp
  });

  // Check key tables exist
  const tables = ['vehicles', 'scrape_sources', 'external_listings', 'auction_events'];
  for (const table of tables) {
    const { error: tableErr } = await supabase.from(table).select('id').limit(1);
    results.push({
      category: 'Supabase',
      check: `Table ${table} accessible`,
      passed: !tableErr,
      details: tableErr ? tableErr.message : 'OK',
      timestamp
    });
  }

  return results;
}

// === GITHUB CLI VALIDATION ===
async function validateGitHub(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const timestamp = new Date().toISOString();

  // Check auth status
  const authResult = runCommand('gh auth status 2>&1');
  const isAuthed = authResult.output.includes('Logged in');
  results.push({
    category: 'GitHub',
    check: 'Authenticated',
    passed: isAuthed,
    details: isAuthed ? 'Logged in to GitHub' : authResult.output.slice(0, 200),
    timestamp
  });

  // Check for uncommitted changes
  const statusResult = runCommand('cd /Users/skylar/nuke && git status --porcelain 2>&1');
  const hasChanges = statusResult.output.trim().length > 0;
  results.push({
    category: 'GitHub',
    check: 'Working directory status',
    passed: true, // Just informational
    details: hasChanges ? `${statusResult.output.split('\n').length} uncommitted changes` : 'Clean working directory',
    timestamp
  });

  // Check current branch
  const branchResult = runCommand('cd /Users/skylar/nuke && git branch --show-current 2>&1');
  results.push({
    category: 'GitHub',
    check: 'Current branch',
    passed: true,
    details: `On branch: ${branchResult.output.trim()}`,
    timestamp
  });

  return results;
}

// === PLAYWRIGHT VISUAL VALIDATION ===
async function validateVisual(browser: Browser): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const timestamp = new Date().toISOString();
  const page = await browser.newPage();

  try {
    // Check production homepage loads
    console.log('  Checking production homepage...');
    await page.goto(PRODUCTION_URL, { waitUntil: 'networkidle', timeout: 30000 });
    const prodTitle = await page.title();
    const prodScreenshot = path.join(SCREENSHOT_DIR, `prod-homepage-${Date.now()}.png`);
    await page.screenshot({ path: prodScreenshot, fullPage: false });

    results.push({
      category: 'Visual',
      check: 'Production homepage loads',
      passed: prodTitle.length > 0,
      details: `Title: "${prodTitle}" | Screenshot: ${prodScreenshot}`,
      timestamp
    });

    // Check for console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Navigate to key pages and take screenshots
    const pages = [
      { path: '/', name: 'homepage' },
      { path: '/marketplace', name: 'marketplace' },
    ];

    for (const p of pages) {
      try {
        await page.goto(`${PRODUCTION_URL}${p.path}`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        const screenshot = path.join(SCREENSHOT_DIR, `${p.name}-${Date.now()}.png`);
        await page.screenshot({ path: screenshot, fullPage: false });

        // Check for visible vehicle cards
        const vehicleCards = await page.$$('[class*="vehicle"], [class*="card"], [class*="listing"]');

        results.push({
          category: 'Visual',
          check: `${p.name} page renders`,
          passed: true,
          details: `Elements found: ${vehicleCards.length} | Screenshot: ${screenshot}`,
          timestamp
        });
      } catch (err: any) {
        results.push({
          category: 'Visual',
          check: `${p.name} page renders`,
          passed: false,
          details: err.message,
          timestamp
        });
      }
    }

    // Report console errors
    if (consoleErrors.length > 0) {
      results.push({
        category: 'Visual',
        check: 'No console errors',
        passed: false,
        details: `${consoleErrors.length} errors: ${consoleErrors.slice(0, 3).join('; ')}`,
        timestamp
      });
    } else {
      results.push({
        category: 'Visual',
        check: 'No console errors',
        passed: true,
        details: 'No JavaScript errors detected',
        timestamp
      });
    }

  } catch (err: any) {
    results.push({
      category: 'Visual',
      check: 'Visual validation',
      passed: false,
      details: `Error: ${err.message}`,
      timestamp
    });
  } finally {
    await page.close();
  }

  return results;
}

// === DATA QUALITY VALIDATION ===
async function validateDataQuality(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const timestamp = new Date().toISOString();

  // Check source visibility
  const sources = ['Craigslist', 'Bring a Trailer', 'Cars & Bids', 'SBX Cars', 'Design Auto'];
  for (const src of sources) {
    const { count } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('auction_source', src)
      .eq('status', 'active')
      .eq('is_public', true);

    results.push({
      category: 'Data',
      check: `${src} vehicles visible`,
      passed: (count || 0) > 0,
      details: `${count || 0} visible vehicles`,
      timestamp
    });
  }

  // Check total vehicle count
  const { count: totalCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('is_public', true);

  results.push({
    category: 'Data',
    check: 'Total visible vehicles',
    passed: (totalCount || 0) > 1000,
    details: `${totalCount || 0} total visible (target: 1000+)`,
    timestamp
  });

  // Check scrape_sources count
  const { count: sourceCount } = await supabase
    .from('scrape_sources')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  results.push({
    category: 'Data',
    check: 'Active sources',
    passed: (sourceCount || 0) > 100,
    details: `${sourceCount || 0} active sources`,
    timestamp
  });

  return results;
}

// === MAIN VALIDATION LOOP ===
async function runValidationLoop(): Promise<LoopStatus> {
  console.log('='.repeat(60));
  console.log('RALPH WIGGUM VALIDATION LOOP');
  console.log('='.repeat(60));
  console.log(`Started: ${new Date().toISOString()}`);

  const allResults: ValidationResult[] = [];

  // 1. Vercel validation
  console.log('\n--- Vercel CLI Validation ---');
  const vercelResults = await validateVercel();
  allResults.push(...vercelResults);
  vercelResults.forEach(r => console.log(`  [${r.passed ? '✓' : '✗'}] ${r.check}: ${r.details}`));

  // 2. Supabase validation
  console.log('\n--- Supabase CLI Validation ---');
  const supabaseResults = await validateSupabase();
  allResults.push(...supabaseResults);
  supabaseResults.forEach(r => console.log(`  [${r.passed ? '✓' : '✗'}] ${r.check}: ${r.details}`));

  // 3. GitHub validation
  console.log('\n--- GitHub CLI Validation ---');
  const githubResults = await validateGitHub();
  allResults.push(...githubResults);
  githubResults.forEach(r => console.log(`  [${r.passed ? '✓' : '✗'}] ${r.check}: ${r.details}`));

  // 4. Data quality validation
  console.log('\n--- Data Quality Validation ---');
  const dataResults = await validateDataQuality();
  allResults.push(...dataResults);
  dataResults.forEach(r => console.log(`  [${r.passed ? '✓' : '✗'}] ${r.check}: ${r.details}`));

  // 5. Visual validation with Playwright
  console.log('\n--- Visual Validation (Playwright) ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const visualResults = await validateVisual(browser);
    allResults.push(...visualResults);
    visualResults.forEach(r => console.log(`  [${r.passed ? '✓' : '✗'}] ${r.check}: ${r.details.slice(0, 100)}`));
  } finally {
    await browser.close();
  }

  // Summary
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  const overallPassed = failed === 0;

  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total checks: ${allResults.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Overall: ${overallPassed ? 'PASSED' : 'FAILED'}`);

  // Log to activity.md
  const activityLog = `
## Validation Loop - ${new Date().toISOString()}

**Results:** ${passed}/${allResults.length} passed

### Failed Checks:
${allResults.filter(r => !r.passed).map(r => `- [${r.category}] ${r.check}: ${r.details}`).join('\n') || 'None'}

### Screenshots:
${fs.readdirSync(SCREENSHOT_DIR).slice(-5).map(f => `- ${f}`).join('\n')}

---
`;

  const activityPath = '/Users/skylar/nuke/.ralph/activity.md';
  fs.appendFileSync(activityPath, activityLog);
  console.log(`\nActivity logged to: ${activityPath}`);

  return {
    iteration: 1,
    validations: allResults,
    overallPassed,
    timestamp: new Date().toISOString()
  };
}

// Run the loop
runValidationLoop()
  .then(status => {
    console.log('\n---RALPH_STATUS---');
    console.log(`STATUS: ${status.overallPassed ? 'COMPLETE' : 'IN_PROGRESS'}`);
    console.log(`TASKS_COMPLETED_THIS_LOOP: ${status.validations.filter(v => v.passed).length}`);
    console.log(`FILES_MODIFIED: 1`);
    console.log(`TESTS_STATUS: ${status.overallPassed ? 'PASSING' : 'FAILING'}`);
    console.log(`WORK_TYPE: VALIDATION`);
    console.log(`EXIT_SIGNAL: ${status.overallPassed}`);
    console.log(`RECOMMENDATION: ${status.overallPassed ? 'All validations passed' : 'Fix failed checks'}`);
    console.log('---END_RALPH_STATUS---');
  })
  .catch(err => {
    console.error('Validation loop error:', err);
    process.exit(1);
  });
