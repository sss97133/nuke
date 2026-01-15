/**
 * Bot Testing Framework - Type Definitions
 * Simulates real user behavior to find bugs and UX issues
 */

export interface BotPersona {
  id: string;
  slug: string;
  name: string;
  description: string;
  behavior_profile: BehaviorProfile;
  goals: string[];
  patience_level: number; // 1-10
  tech_savviness: number; // 1-10
}

export interface BehaviorProfile {
  clicks_randomly?: boolean;
  uses_filters?: boolean;
  reads_descriptions?: boolean;
  places_bids?: boolean;
  watches_multiple?: boolean;
  checks_history?: boolean;
  rapid_clicks?: boolean;
  short_timeout?: boolean;
  retries_aggressively?: boolean;
  misclicks?: boolean;
  goes_back_often?: boolean;
  abandons_flows?: boolean;
  uses_keyboard?: boolean;
  bulk_operations?: boolean;
  uses_advanced_features?: boolean;
  touch_gestures?: boolean;
  portrait_mode?: boolean;
  slow_connection?: boolean;
}

export interface BotTestRun {
  id: string;
  persona_id: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  environment: 'production' | 'staging' | 'local';
  browser: string;
  device_type: 'desktop' | 'mobile' | 'tablet';
  pages_visited: number;
  actions_performed: number;
  errors_encountered: number;
  bugs_found: number;
  execution_log: ExecutionLogEntry[];
  final_summary?: string;
  metadata: Record<string, unknown>;
}

export interface ExecutionLogEntry {
  timestamp: string;
  action: string;
  target?: string;
  result: 'success' | 'failure' | 'warning';
  details?: string;
  duration_ms?: number;
  screenshot?: string;
}

export interface BotFinding {
  id?: string;
  test_run_id: string;
  persona_id: string;
  finding_type: FindingType;
  severity: Severity;
  title: string;
  description?: string;
  page_url?: string;
  component?: string;
  screenshot_url?: string;
  console_logs?: unknown[];
  network_logs?: unknown[];
  reproduction_steps?: ReproductionStep[];
  status?: 'new' | 'triaged' | 'confirmed' | 'fixed' | 'wont_fix' | 'duplicate';
}

export type FindingType = 
  | 'bug'
  | 'ux_friction'
  | 'performance'
  | 'broken_link'
  | 'missing_element'
  | 'console_error'
  | 'network_error'
  | 'accessibility'
  | 'visual_regression'
  | 'unexpected_behavior';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReproductionStep {
  step_number: number;
  action: string;
  expected: string;
  actual?: string;
}

export interface BotTestScenario {
  id: string;
  name: string;
  description: string;
  steps: ScenarioStep[];
  applicable_personas: string[];
}

export interface ScenarioStep {
  action: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'assert' | 'screenshot';
  selector?: string;
  value?: string;
  timeout?: number;
  description?: string;
}

// Bot runner configuration
export interface BotRunnerConfig {
  baseUrl: string;
  headless: boolean;
  slowMo?: number;
  timeout: number;
  screenshotsEnabled: boolean;
  screenshotDir: string;
  maxActionsPerRun: number;
  reportToAdmin: boolean;
}

// Events the bot can emit
export interface BotEvent {
  type: 'action' | 'finding' | 'error' | 'complete';
  timestamp: string;
  data: unknown;
}
