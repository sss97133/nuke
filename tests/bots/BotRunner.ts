/**
 * Bot Runner Framework
 * Executes bot personas against the application to find bugs
 */

import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
import type {
  BotPersona,
  BotTestRun,
  BotFinding,
  ExecutionLogEntry,
  BotRunnerConfig,
  Severity,
  FindingType,
} from './types';

export class BotRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private supabase: SupabaseClient;
  private config: BotRunnerConfig;
  private persona: BotPersona;
  private testRun: BotTestRun | null = null;
  private executionLog: ExecutionLogEntry[] = [];
  private findings: BotFinding[] = [];
  private consoleErrors: unknown[] = [];
  private networkErrors: unknown[] = [];

  constructor(persona: BotPersona, config: Partial<BotRunnerConfig> = {}) {
    this.persona = persona;
    this.config = {
      baseUrl: process.env.BOT_BASE_URL || 'https://n-zero.dev',
      headless: process.env.BOT_HEADLESS !== 'false',
      slowMo: persona.patience_level > 5 ? 100 : 50,
      timeout: this.calculateTimeout(),
      screenshotsEnabled: true,
      screenshotDir: './screenshots/bot-findings',
      maxActionsPerRun: 100,
      reportToAdmin: true,
      ...config,
    };

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Calculate timeout based on persona patience
   */
  private calculateTimeout(): number {
    // Impatient bots have short timeouts (3-10 seconds)
    // Patient bots wait longer (15-30 seconds)
    const baseTimeout = 5000;
    return baseTimeout + (this.persona.patience_level * 2500);
  }

  /**
   * Start a new test run
   */
  async start(): Promise<void> {
    console.log(`🤖 Starting bot: ${this.persona.name}`);
    console.log(`   Goals: ${this.persona.goals.join(', ')}`);

    // Create test run record
    const { data: run, error } = await this.supabase
      .from('bot_test_runs')
      .insert({
        persona_id: this.persona.id,
        status: 'running',
        environment: this.determineEnvironment(),
        browser: 'chromium',
        device_type: this.persona.behavior_profile.touch_gestures ? 'mobile' : 'desktop',
        metadata: {
          config: this.config,
          persona_slug: this.persona.slug,
        },
      })
      .select()
      .single();

    if (error) throw error;
    this.testRun = run;

    // Launch browser
    await this.launchBrowser();

    // Authenticate if possible
    await this.authenticate();

    // Setup event listeners
    await this.setupListeners();
  }

  /**
   * Create a HS256 JWT using Node.js crypto (no external deps).
   */
  private signJwt(payload: Record<string, unknown>, secret: string): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const b64 = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const headerB64 = b64(header);
    const payloadB64 = b64(payload);
    const sig = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    return `${headerB64}.${payloadB64}.${sig}`;
  }

  /**
   * Authenticate the bot by injecting a JWT into the browser's localStorage.
   * Uses the pre-created bot-tester user (created via direct SQL) and signs
   * a JWT with the project's JWT secret to bypass GoTrue API issues.
   */
  private async authenticate(): Promise<void> {
    if (!this.page) return;

    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      this.log('auth', 'warning', 'No SUPABASE_JWT_SECRET — running unauthenticated');
      return;
    }

    // Use pre-created bot user (created via SQL migration)
    const botUserId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001';
    const botEmail = 'bot-tester@nuke-test.local';

    try {
      // Navigate to base URL first so localStorage is on the right origin
      await this.page.goto(this.config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

      const now = Math.floor(Date.now() / 1000);
      const accessToken = this.signJwt(
        {
          sub: botUserId,
          aud: 'authenticated',
          role: 'authenticated',
          email: botEmail,
          email_confirmed_at: new Date().toISOString(),
          iat: now,
          exp: now + 3600,
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { preferred_username: 'bot_tester', full_name: 'Bot Test User' },
        },
        jwtSecret,
      );

      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || '';
      const storageKey = `sb-${projectRef}-auth-token`;

      await this.page.evaluate(
        ({ key, token }) => {
          localStorage.setItem(key, JSON.stringify(token));
        },
        {
          key: storageKey,
          token: {
            access_token: accessToken,
            refresh_token: 'bot-test-refresh-token',
            expires_at: now + 3600,
            expires_in: 3600,
            token_type: 'bearer',
            user: {
              id: botUserId,
              email: botEmail,
              aud: 'authenticated',
              role: 'authenticated',
              email_confirmed_at: new Date().toISOString(),
              app_metadata: { provider: 'email', providers: ['email'] },
              user_metadata: { preferred_username: 'bot_tester', full_name: 'Bot Test User' },
              created_at: new Date().toISOString(),
            },
          },
        },
      );

      this.log('auth', 'success', `Authenticated as ${botEmail} (JWT)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'auth error';
      this.log('auth', 'warning', `Auth failed: ${msg} — running unauthenticated`);
    }
  }

  /**
   * Launch browser with persona-appropriate settings
   */
  private async launchBrowser(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    });

    const contextOptions: Parameters<Browser['newContext']>[0] = {
      viewport: this.persona.behavior_profile.touch_gestures 
        ? { width: 390, height: 844 } // iPhone 14 size
        : { width: 1280, height: 720 },
      userAgent: this.persona.behavior_profile.touch_gestures
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) BotTest/1.0'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) BotTest/1.0',
      hasTouch: this.persona.behavior_profile.touch_gestures || false,
    };

    // Slow connection simulation for mobile persona
    if (this.persona.behavior_profile.slow_connection) {
      // Note: Would need to use CDP for actual throttling
      console.log('   Simulating slow connection...');
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    
    // Set timeout based on patience
    this.page.setDefaultTimeout(this.config.timeout);
  }

  /**
   * Setup console and network error listeners
   */
  private async setupListeners(): Promise<void> {
    if (!this.page) return;

    // Capture console errors
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push({
          text: msg.text(),
          location: msg.location(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Capture page errors
    this.page.on('pageerror', (error) => {
      this.consoleErrors.push({
        text: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    });

    // Capture network failures
    this.page.on('requestfailed', (request) => {
      this.networkErrors.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText,
        timestamp: new Date().toISOString(),
      });
    });

    // Capture response errors (4xx, 5xx)
    this.page.on('response', (response) => {
      if (response.status() >= 400) {
        this.networkErrors.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  /**
   * Log an action
   */
  protected log(
    action: string,
    result: 'success' | 'failure' | 'warning',
    details?: string,
    target?: string
  ): void {
    const entry: ExecutionLogEntry = {
      timestamp: new Date().toISOString(),
      action,
      target,
      result,
      details,
    };
    this.executionLog.push(entry);
    
    const emoji = result === 'success' ? '✓' : result === 'failure' ? '✗' : '⚠';
    console.log(`   ${emoji} ${action}${target ? ` → ${target}` : ''}${details ? `: ${details}` : ''}`);
  }

  /**
   * Report a finding
   */
  protected async reportFinding(
    type: FindingType,
    severity: Severity,
    title: string,
    description?: string,
    component?: string
  ): Promise<void> {
    if (!this.testRun || !this.page) return;

    // Take screenshot if enabled
    let screenshotUrl: string | undefined;
    if (this.config.screenshotsEnabled) {
      try {
        const screenshotPath = `${this.config.screenshotDir}/${this.testRun.id}-${Date.now()}.png`;
        await this.page.screenshot({ path: screenshotPath, fullPage: false });
        screenshotUrl = screenshotPath;
      } catch (e) {
        console.warn('   Could not capture screenshot:', e);
      }
    }

    const finding: BotFinding = {
      test_run_id: this.testRun.id,
      persona_id: this.persona.id,
      finding_type: type,
      severity,
      title,
      description,
      page_url: this.page.url(),
      component,
      screenshot_url: screenshotUrl,
      console_logs: this.consoleErrors.slice(-10), // Last 10 console errors
      network_logs: this.networkErrors.slice(-10), // Last 10 network errors
      reproduction_steps: this.executionLog.slice(-10).map((log, i) => ({
        step_number: i + 1,
        action: log.action,
        expected: 'Success',
        actual: log.result,
      })),
    };

    this.findings.push(finding);

    // Save to database (will auto-escalate critical/high to admin)
    if (this.config.reportToAdmin) {
      const { error } = await this.supabase.from('bot_findings').insert(finding);
      if (error) {
        console.error('   Failed to save finding:', error);
      } else {
        console.log(`   📋 Reported ${severity} ${type}: ${title}`);
      }
    }
  }

  /**
   * Navigate to a page with error handling
   */
  protected async navigate(path: string): Promise<boolean> {
    if (!this.page) return false;
    
    const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;
    
    try {
      const startTime = Date.now();
      const response = await this.page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
      });
      const duration = Date.now() - startTime;
      
      if (!response) {
        this.log('navigate', 'failure', 'No response', url);
        await this.reportFinding('broken_link', 'high', `Navigation failed: ${path}`, 'No response received');
        return false;
      }
      
      if (response.status() >= 400) {
        this.log('navigate', 'failure', `HTTP ${response.status()}`, url);
        await this.reportFinding('network_error', 'high', `HTTP ${response.status()} on ${path}`);
        return false;
      }
      
      // Check for slow page loads
      if (duration > 5000) {
        this.log('navigate', 'warning', `Slow load: ${duration}ms`, url);
        await this.reportFinding('performance', 'medium', `Slow page load: ${path}`, `Took ${duration}ms to load`);
      } else {
        this.log('navigate', 'success', `${duration}ms`, url);
      }
      
      // Update stats
      if (this.testRun) {
        this.testRun.pages_visited++;
      }
      
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('navigate', 'failure', message, url);
      
      if (message.includes('timeout')) {
        await this.reportFinding('performance', 'high', `Page timeout: ${path}`, `Page did not load within ${this.config.timeout}ms`);
      } else {
        await this.reportFinding('bug', 'high', `Navigation error: ${path}`, message);
      }
      
      return false;
    }
  }

  /**
   * Click an element with error handling
   */
  protected async click(selector: string, description?: string): Promise<boolean> {
    if (!this.page) return false;
    
    try {
      // Check if element exists
      const element = await this.page.$(selector);
      if (!element) {
        this.log('click', 'failure', 'Element not found', selector);
        await this.reportFinding('missing_element', 'medium', `Missing element: ${selector}`, description);
        return false;
      }
      
      // Check if visible
      const isVisible = await element.isVisible();
      if (!isVisible) {
        this.log('click', 'warning', 'Element not visible', selector);
        await this.reportFinding('ux_friction', 'low', `Hidden element: ${selector}`, 'Element exists but is not visible');
        return false;
      }
      
      // Perform click
      await element.click({ timeout: this.config.timeout });
      this.log('click', 'success', description, selector);
      
      if (this.testRun) {
        this.testRun.actions_performed++;
      }
      
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('click', 'failure', message, selector);
      
      await this.reportFinding('bug', 'medium', `Click failed: ${selector}`, message);
      return false;
    }
  }

  /**
   * Type into an input with error handling
   */
  protected async type(selector: string, text: string, description?: string): Promise<boolean> {
    if (!this.page) return false;
    
    try {
      await this.page.fill(selector, text);
      this.log('type', 'success', description || `"${text.substring(0, 20)}..."`, selector);
      
      if (this.testRun) {
        this.testRun.actions_performed++;
      }
      
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('type', 'failure', message, selector);
      await this.reportFinding('bug', 'medium', `Type failed: ${selector}`, message);
      return false;
    }
  }

  /**
   * Wait for an element or condition
   */
  protected async waitFor(selector: string, timeout?: number): Promise<boolean> {
    if (!this.page) return false;
    
    try {
      await this.page.waitForSelector(selector, { 
        timeout: timeout || this.config.timeout,
        state: 'visible',
      });
      this.log('wait', 'success', 'Element appeared', selector);
      return true;
    } catch (error) {
      this.log('wait', 'failure', 'Element not found', selector);
      return false;
    }
  }

  /**
   * Check for console errors and report them
   */
  protected async checkConsoleErrors(): Promise<void> {
    if (this.consoleErrors.length > 0) {
      const recentErrors = this.consoleErrors.slice(-5);
      for (const err of recentErrors) {
        const errorObj = err as { text?: string };
        await this.reportFinding(
          'console_error',
          'medium',
          `Console error: ${(errorObj.text || 'Unknown').substring(0, 50)}`,
          errorObj.text
        );
      }
    }
  }

  /**
   * Complete the test run
   */
  async complete(): Promise<BotTestRun | null> {
    if (!this.testRun) return null;
    
    // Check for any accumulated errors
    await this.checkConsoleErrors();
    
    // Update test run record
    const { data, error } = await this.supabase
      .from('bot_test_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        pages_visited: this.testRun.pages_visited,
        actions_performed: this.testRun.actions_performed,
        errors_encountered: this.consoleErrors.length + this.networkErrors.length,
        bugs_found: this.findings.length,
        execution_log: this.executionLog,
        final_summary: this.generateSummary(),
      })
      .eq('id', this.testRun.id)
      .select()
      .single();

    if (error) {
      console.error('Failed to update test run:', error);
    }

    // Cleanup
    await this.browser?.close();
    
    console.log(`\n🏁 Bot ${this.persona.name} completed`);
    console.log(`   Pages: ${this.testRun.pages_visited}`);
    console.log(`   Actions: ${this.testRun.actions_performed}`);
    console.log(`   Findings: ${this.findings.length}`);
    
    return data || this.testRun;
  }

  /**
   * Generate a human-readable summary
   */
  private generateSummary(): string {
    const criticalFindings = this.findings.filter(f => f.severity === 'critical').length;
    const highFindings = this.findings.filter(f => f.severity === 'high').length;
    
    let summary = `${this.persona.name} completed ${this.testRun?.pages_visited || 0} pages, ${this.testRun?.actions_performed || 0} actions. `;
    
    if (this.findings.length === 0) {
      summary += 'No issues found! ✨';
    } else {
      summary += `Found ${this.findings.length} issues`;
      if (criticalFindings > 0) summary += ` (${criticalFindings} critical!)`;
      else if (highFindings > 0) summary += ` (${highFindings} high priority)`;
    }
    
    return summary;
  }

  /**
   * Determine environment from URL
   */
  private determineEnvironment(): 'production' | 'staging' | 'local' {
    if (this.config.baseUrl.includes('localhost')) return 'local';
    if (this.config.baseUrl.includes('staging') || this.config.baseUrl.includes('preview')) return 'staging';
    return 'production';
  }

  // Expose page for subclasses
  protected getPage(): Page | null {
    return this.page;
  }
}
