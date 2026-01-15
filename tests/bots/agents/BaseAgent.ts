/**
 * Base Debug Agent
 * Foundation for all AI debug team agents
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type {
  DebugAgent,
  AgentSession,
  AgentLogEntry,
  AgentMessage,
  AgentConfig,
  FindingWithContext,
} from './types';

export abstract class BaseAgent {
  protected supabase: SupabaseClient;
  protected anthropic: Anthropic;
  protected agent: DebugAgent;
  protected session: AgentSession | null = null;
  protected config: AgentConfig;
  protected executionLog: AgentLogEntry[] = [];

  constructor(agentSlug: string, config: Partial<AgentConfig> = {}) {
    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
    
    // Initialize Anthropic
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }
    
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
    
    // Default config
    this.config = {
      preferredModel: 'claude-3',
      maxTokens: 4096,
      temperature: 0.3,
      codebasePath: process.cwd(),
      gitEnabled: true,
      autoCreatePRs: false,
      requireHumanApproval: true,
      ...config,
    };
    
    // Agent will be loaded in start()
    this.agent = {} as DebugAgent;
  }

  /**
   * Load agent from database and start session
   */
  protected async loadAgent(slug: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('debug_agents')
      .select('*')
      .eq('slug', slug)
      .single();
    
    if (error || !data) {
      throw new Error(`Agent not found: ${slug}`);
    }
    
    this.agent = data;
  }

  /**
   * Start a new agent session
   */
  async startSession(): Promise<void> {
    const { data, error } = await this.supabase
      .from('debug_agent_sessions')
      .insert({
        agent_id: this.agent.id,
        status: 'running',
        metadata: { config: this.config },
      })
      .select()
      .single();
    
    if (error) throw error;
    this.session = data;
    
    console.log(`🤖 ${this.agent.name} starting session ${this.session.id}`);
  }

  /**
   * Log an action
   */
  protected log(
    action: string,
    result: 'success' | 'failure' | 'skipped',
    details?: string,
    target?: string
  ): void {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      action,
      target,
      result,
      details,
    };
    this.executionLog.push(entry);
    
    const emoji = result === 'success' ? '✓' : result === 'failure' ? '✗' : '○';
    console.log(`   ${emoji} [${this.agent.name}] ${action}${target ? ` → ${target}` : ''}${details ? `: ${details}` : ''}`);
  }

  /**
   * Send a message to another agent
   */
  protected async sendMessage(
    toAgentSlug: string,
    type: AgentMessage['message_type'],
    content: string,
    findingId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Get target agent ID
    const { data: toAgent } = await this.supabase
      .from('debug_agents')
      .select('id')
      .eq('slug', toAgentSlug)
      .single();
    
    if (!toAgent) {
      this.log('send_message', 'failure', `Agent not found: ${toAgentSlug}`);
      return;
    }

    const { error } = await this.supabase.from('debug_agent_messages').insert({
      from_agent_id: this.agent.id,
      to_agent_id: toAgent.id,
      finding_id: findingId,
      message_type: type,
      content,
      metadata,
    });

    if (error) {
      this.log('send_message', 'failure', error.message);
    } else {
      this.log('send_message', 'success', `${type} to ${toAgentSlug}`);
    }
  }

  /**
   * Get pending messages for this agent
   */
  protected async getMessages(): Promise<AgentMessage[]> {
    const { data, error } = await this.supabase
      .from('debug_agent_messages')
      .select('*')
      .eq('to_agent_id', this.agent.id)
      .is('read_at', null)
      .order('created_at', { ascending: true });
    
    if (error) {
      this.log('get_messages', 'failure', error.message);
      return [];
    }
    
    // Mark as read
    if (data && data.length > 0) {
      await this.supabase
        .from('debug_agent_messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', data.map(m => m.id));
    }
    
    return data || [];
  }

  /**
   * Get a finding with full context
   */
  protected async getFindingWithContext(findingId: string): Promise<FindingWithContext | null> {
    const { data, error } = await this.supabase
      .from('bot_findings')
      .select(`
        *,
        persona:bot_personas(name, slug),
        investigation:debug_investigations(*)
      `)
      .eq('id', findingId)
      .single();
    
    if (error || !data) {
      this.log('get_finding', 'failure', `Finding not found: ${findingId}`);
      return null;
    }
    
    return data as FindingWithContext;
  }

  /**
   * Update finding status and assignment
   */
  protected async updateFinding(
    findingId: string,
    updates: {
      status?: string;
      assigned_agent_id?: string;
      investigation_id?: string;
      fix_attempt_id?: string;
    }
  ): Promise<void> {
    const { error } = await this.supabase
      .from('bot_findings')
      .update({
        ...updates,
        last_agent_activity: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', findingId);
    
    if (error) {
      this.log('update_finding', 'failure', error.message);
    }
  }

  /**
   * Call Claude for AI reasoning
   */
  protected async think(
    systemPrompt: string,
    userPrompt: string,
    maxTokens?: number
  ): Promise<string> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || this.config.maxTokens,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt,
      });
      
      const textContent = response.content.find(c => c.type === 'text');
      return textContent ? textContent.text : '';
    } catch (error) {
      this.log('think', 'failure', error instanceof Error ? error.message : 'AI call failed');
      return '';
    }
  }

  /**
   * Read a file from the codebase
   */
  protected async readFile(relativePath: string): Promise<string | null> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const fullPath = path.join(this.config.codebasePath, relativePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      this.log('read_file', 'failure', `Could not read: ${relativePath}`);
      return null;
    }
  }

  /**
   * Search for files matching a pattern
   */
  protected async findFiles(pattern: string): Promise<string[]> {
    const { glob } = await import('glob');
    
    try {
      const files = await glob(pattern, { 
        cwd: this.config.codebasePath,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      });
      return files;
    } catch (error) {
      this.log('find_files', 'failure', `Pattern failed: ${pattern}`);
      return [];
    }
  }

  /**
   * Search for text in codebase
   */
  protected async searchCode(query: string, filePattern?: string): Promise<Array<{ file: string; line: number; content: string }>> {
    const { execSync } = await import('child_process');
    const results: Array<{ file: string; line: number; content: string }> = [];
    
    try {
      const globArg = filePattern ? `-g "${filePattern}"` : '';
      const cmd = `rg -n --json "${query}" ${globArg} 2>/dev/null || true`;
      const output = execSync(cmd, { 
        cwd: this.config.codebasePath,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
      });
      
      const lines = output.trim().split('\n').filter(Boolean);
      for (const line of lines.slice(0, 50)) { // Limit results
        try {
          const json = JSON.parse(line);
          if (json.type === 'match') {
            results.push({
              file: json.data.path.text,
              line: json.data.line_number,
              content: json.data.lines.text.trim(),
            });
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch (error) {
      this.log('search_code', 'failure', `Search failed: ${query}`);
    }
    
    return results;
  }

  /**
   * Complete the session
   */
  async completeSession(summary?: string): Promise<void> {
    if (!this.session) return;
    
    const { error } = await this.supabase
      .from('debug_agent_sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        findings_processed: this.session.findings_processed,
        actions_taken: this.session.actions_taken,
        summary: summary || this.generateSummary(),
        execution_log: this.executionLog,
      })
      .eq('id', this.session.id);
    
    if (error) {
      console.error('Failed to complete session:', error);
    }
    
    console.log(`✅ ${this.agent.name} session complete`);
  }

  /**
   * Generate session summary
   */
  protected generateSummary(): string {
    const successes = this.executionLog.filter(l => l.result === 'success').length;
    const failures = this.executionLog.filter(l => l.result === 'failure').length;
    return `${this.agent.name}: ${successes} successful actions, ${failures} failures`;
  }

  /**
   * Main execution - to be implemented by subclasses
   */
  abstract execute(): Promise<void>;
}
