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

// Matches the author_personas DB table
export interface AuthorPersonaRow {
  id: string;
  username: string;
  platform: string;
  author_id?: string;
  primary_persona: string; // 'helpful_expert' | 'casual_enthusiast' | 'serious_buyer' | 'dealer' | 'critic'
  secondary_personas?: string[];
  avg_tone_helpful: number;
  avg_tone_technical: number;
  avg_tone_friendly: number;
  avg_tone_confident: number;
  avg_tone_snarky: number;
  expertise_level: string;
  expertise_areas?: string[];
  top_expertise_area?: string;
  total_comments: number;
  comments_with_questions: number;
  comments_with_answers: number;
  comments_with_advice: number;
  comments_supportive: number;
  comments_critical: number;
  avg_comment_length: number;
  active_hours?: number[];
  active_days?: number[];
  vehicles_commented_on?: number;
  unique_makes?: string[];
  trust_score?: number;
  accuracy_score?: number;
  influence_score?: number;
  known_purchases?: number;
  known_sales?: number;
  avg_purchase_price?: number;
  first_seen: string;
  last_seen: string;
  updated_at: string;
}

// Claude's decision at each step of persona-driven browsing
export interface PersonaAction {
  observation: string;   // What the persona notices on the page
  feeling: string;       // How it makes them feel (in character)
  action: string;        // What they'd do next: 'click' | 'scroll' | 'type' | 'navigate' | 'done'
  target?: string;       // CSS selector or URL
  value?: string;        // Text to type, if action is 'type'
  reason: string;        // Why they'd do this (in character)
  frustrations?: string[]; // Anything confusing/broken/missing
  satisfaction: number;  // 1-10 rating
}
