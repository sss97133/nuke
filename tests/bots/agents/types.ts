/**
 * Debug Agent Types
 * AI agents that investigate and fix bot findings
 */

export interface DebugAgent {
  id: string;
  slug: string;
  name: string;
  role: 'monitor' | 'triage' | 'investigator' | 'fixer';
  description: string;
  capabilities: string[];
  is_active: boolean;
}

export interface AgentSession {
  id: string;
  agent_id: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';
  findings_processed: number;
  actions_taken: number;
  summary?: string;
  execution_log: AgentLogEntry[];
  metadata: Record<string, unknown>;
}

export interface AgentLogEntry {
  timestamp: string;
  action: string;
  target?: string;
  result: 'success' | 'failure' | 'skipped';
  details?: string;
  duration_ms?: number;
}

export interface Investigation {
  id?: string;
  finding_id: string;
  agent_session_id: string;
  root_cause_analysis?: string;
  affected_files: AffectedFile[];
  related_code: CodeSnippet[];
  hypothesis?: string;
  confidence_score?: number;
  suggested_fix?: string;
  fix_complexity?: 'trivial' | 'simple' | 'moderate' | 'complex' | 'architectural';
  estimated_effort?: string;
  similar_findings?: string[];
}

export interface AffectedFile {
  path: string;
  relevance: number; // 0-1
  snippet?: string;
  line_start?: number;
  line_end?: number;
}

export interface CodeSnippet {
  file: string;
  content: string;
  line_start: number;
  line_end: number;
  context?: string;
}

export interface FixAttempt {
  id?: string;
  investigation_id: string;
  finding_id: string;
  agent_session_id: string;
  fix_type: 'code_change' | 'config_change' | 'documentation' | 'escalate_human';
  files_changed: FileChange[];
  pr_url?: string;
  pr_number?: number;
  branch_name?: string;
  verification_status: 'pending' | 'passed' | 'failed' | 'skipped';
  verification_notes?: string;
  status: 'pending' | 'applied' | 'rejected' | 'merged' | 'reverted';
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
  diff?: string;
}

export interface AgentMessage {
  id?: string;
  from_agent_id: string;
  to_agent_id: string;
  finding_id?: string;
  message_type: 'handoff' | 'question' | 'answer' | 'escalation' | 'status_update';
  content: string;
  metadata?: Record<string, unknown>;
}

// Finding with full context for agents
export interface FindingWithContext {
  id: string;
  test_run_id: string;
  persona_id: string;
  finding_type: string;
  severity: string;
  title: string;
  description?: string;
  page_url?: string;
  component?: string;
  screenshot_url?: string;
  console_logs?: unknown[];
  network_logs?: unknown[];
  reproduction_steps?: ReproStep[];
  status: string;
  created_at: string;
  // Enriched data
  persona?: { name: string; slug: string };
  investigation?: Investigation;
  related_findings?: FindingWithContext[];
}

export interface ReproStep {
  step_number: number;
  action: string;
  expected: string;
  actual?: string;
}

// Agent configuration
export interface AgentConfig {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  preferredModel: 'gpt-4' | 'claude-3' | 'gpt-3.5-turbo';
  maxTokens: number;
  temperature: number;
  codebasePath: string;
  gitEnabled: boolean;
  autoCreatePRs: boolean;
  requireHumanApproval: boolean;
}

// Pipeline state
export interface PipelineState {
  finding_id: string;
  current_stage: 'new' | 'triaging' | 'investigating' | 'fixing' | 'verifying' | 'complete';
  assigned_agents: string[];
  started_at: string;
  last_updated: string;
  messages: AgentMessage[];
}
