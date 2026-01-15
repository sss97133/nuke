/**
 * Sherlock Agent - Triage
 * Analyzes findings to determine true severity, categorize, and detect duplicates
 */

import { BaseAgent } from './BaseAgent';
import type { FindingWithContext, AgentMessage } from './types';

export class SherlockAgent extends BaseAgent {
  constructor() {
    super('sherlock');
  }

  async execute(): Promise<void> {
    await this.loadAgent('sherlock');
    await this.startSession();

    console.log('🔍 Sherlock analyzing findings...\n');

    // Process messages from Sentinel
    const messages = await this.getMessages();
    
    for (const message of messages) {
      if (message.message_type === 'handoff' && message.finding_id) {
        await this.triageFinding(message.finding_id, message);
      } else if (message.message_type === 'escalation' && message.finding_id) {
        await this.handleEscalation(message.finding_id, message);
      }
    }

    // Also check for any findings stuck in triaged state
    await this.processStuckFindings();

    await this.completeSession();
  }

  /**
   * Perform triage on a finding
   */
  private async triageFinding(findingId: string, message: AgentMessage): Promise<void> {
    const finding = await this.getFindingWithContext(findingId);
    if (!finding) return;

    this.log('triage', 'success', finding.title, findingId);

    // 1. Check for duplicates
    const duplicate = await this.findDuplicate(finding);
    if (duplicate) {
      await this.markAsDuplicate(finding, duplicate);
      if (this.session) this.session.findings_processed++;
      return;
    }

    // 2. Analyze with AI
    const analysis = await this.analyzeWithAI(finding);

    // 3. Determine if severity should be adjusted
    if (analysis.suggested_severity !== finding.severity) {
      this.log('severity_adjust', 'success', 
        `${finding.severity} → ${analysis.suggested_severity}`,
        findingId
      );
    }

    // 4. Categorize
    const category = analysis.category || finding.finding_type;

    // 5. Decide next step
    const nextStep = this.determineNextStep(finding, analysis);

    if (nextStep === 'investigate') {
      // Hand off to Watson for investigation
      await this.sendMessage(
        'watson',
        'handoff',
        `Finding requires investigation:\n\nTitle: ${finding.title}\nSeverity: ${analysis.suggested_severity}\nCategory: ${category}\n\nAI Analysis:\n${analysis.summary}\n\nLikely areas:\n${analysis.likely_files.join('\n')}`,
        findingId,
        {
          analysis,
          original_severity: finding.severity,
          suggested_severity: analysis.suggested_severity,
        }
      );

      await this.updateFinding(findingId, { status: 'triaged' });
    } else if (nextStep === 'fix_directly') {
      // Simple enough to fix directly
      await this.sendMessage(
        'patch',
        'handoff',
        `Simple fix required:\n\nTitle: ${finding.title}\nSuggested fix: ${analysis.quick_fix}`,
        findingId,
        { analysis, skip_investigation: true }
      );
    } else {
      // Won't fix or needs human
      await this.updateFinding(findingId, { status: 'wont_fix' });
      this.log('close', 'success', `Closed as: ${nextStep}`, findingId);
    }

    if (this.session) {
      this.session.findings_processed++;
      this.session.actions_taken++;
    }
  }

  /**
   * Find potential duplicate findings
   */
  private async findDuplicate(finding: FindingWithContext): Promise<FindingWithContext | null> {
    // Look for similar findings by URL and type
    const { data: similar } = await this.supabase
      .from('bot_findings')
      .select('*')
      .eq('page_url', finding.page_url)
      .eq('finding_type', finding.finding_type)
      .neq('id', finding.id)
      .in('status', ['new', 'triaged', 'confirmed'])
      .limit(5);

    if (!similar || similar.length === 0) return null;

    // Use AI to determine if any are true duplicates
    const prompt = `Are any of these findings duplicates of the current finding?

Current finding:
- Title: ${finding.title}
- Description: ${finding.description}
- URL: ${finding.page_url}
- Console logs: ${JSON.stringify(finding.console_logs?.slice(0, 3))}

Potential duplicates:
${similar.map((s, i) => `${i + 1}. Title: ${s.title}, Description: ${s.description}`).join('\n')}

Respond with just the number of the duplicate (1-${similar.length}) or "none" if there are no duplicates.`;

    const response = await this.think(
      'You are a QA analyst determining if bug reports are duplicates. Be strict - only mark as duplicate if they are clearly the same issue.',
      prompt,
      100
    );

    const match = response.trim().match(/^(\d+)/);
    if (match) {
      const idx = parseInt(match[1]) - 1;
      if (idx >= 0 && idx < similar.length) {
        return similar[idx] as FindingWithContext;
      }
    }

    return null;
  }

  /**
   * Mark a finding as a duplicate
   */
  private async markAsDuplicate(finding: FindingWithContext, original: FindingWithContext): Promise<void> {
    await this.updateFinding(finding.id, { status: 'duplicate' });
    
    // Add note linking to original
    await this.supabase.from('bot_findings').update({
      admin_notes: `Duplicate of finding ${original.id}: ${original.title}`,
    }).eq('id', finding.id);

    this.log('duplicate', 'success', `Linked to ${original.id}`, finding.id);
  }

  /**
   * Analyze finding with AI
   */
  private async analyzeWithAI(finding: FindingWithContext): Promise<{
    summary: string;
    suggested_severity: string;
    category: string;
    likely_files: string[];
    quick_fix?: string;
    needs_investigation: boolean;
  }> {
    const systemPrompt = `You are Sherlock, an expert QA analyst and debugger. Analyze bug reports to determine:
1. The true severity (critical, high, medium, low, info)
2. The category of issue
3. Which files in the codebase are likely involved
4. Whether this needs deep investigation or has an obvious fix

The codebase is a Next.js/React application for a vehicle auction platform.
Key directories: nuke_frontend/src/components, nuke_frontend/src/pages, supabase/functions`;

    const userPrompt = `Analyze this finding:

Title: ${finding.title}
Reported Severity: ${finding.severity}
Type: ${finding.finding_type}
URL: ${finding.page_url}
Description: ${finding.description || 'No description'}

Console Errors: ${JSON.stringify(finding.console_logs?.slice(0, 5) || [])}
Network Errors: ${JSON.stringify(finding.network_logs?.slice(0, 5) || [])}

Reproduction Steps:
${finding.reproduction_steps?.map(s => `${s.step_number}. ${s.action}`).join('\n') || 'Not provided'}

Respond in this exact JSON format:
{
  "summary": "Brief analysis of the issue",
  "suggested_severity": "critical|high|medium|low|info",
  "category": "ui_bug|logic_error|performance|ux|config|external_dependency",
  "likely_files": ["path/to/file1.tsx", "path/to/file2.ts"],
  "quick_fix": "If obvious, describe the fix in one line. Otherwise null",
  "needs_investigation": true or false
}`;

    const response = await this.think(systemPrompt, userPrompt, 1000);
    
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.log('ai_analysis', 'failure', 'Could not parse AI response');
    }

    // Default response
    return {
      summary: 'Analysis failed',
      suggested_severity: finding.severity,
      category: finding.finding_type,
      likely_files: [],
      needs_investigation: true,
    };
  }

  /**
   * Determine what to do next with a finding
   */
  private determineNextStep(
    finding: FindingWithContext,
    analysis: { needs_investigation: boolean; quick_fix?: string; suggested_severity: string }
  ): 'investigate' | 'fix_directly' | 'wont_fix' | 'needs_human' {
    // Info-level issues that don't need investigation can be closed
    if (analysis.suggested_severity === 'info' && !analysis.needs_investigation) {
      return 'wont_fix';
    }

    // If there's an obvious quick fix, go straight to Patch
    if (analysis.quick_fix && !analysis.needs_investigation) {
      return 'fix_directly';
    }

    // Everything else needs investigation
    return 'investigate';
  }

  /**
   * Handle escalated findings
   */
  private async handleEscalation(findingId: string, message: AgentMessage): Promise<void> {
    this.log('escalation', 'success', 'Processing SLA breach', findingId);
    
    const finding = await this.getFindingWithContext(findingId);
    if (!finding) return;

    // Create high-priority admin notification
    await this.supabase.from('admin_notifications').insert({
      notification_type: 'system_alert',
      title: `⏰ SLA Breach: ${finding.title}`,
      message: `Finding has exceeded SLA threshold.\n\nSeverity: ${finding.severity}\nAge: ${message.metadata?.sla_hours}+ hours\n\nRequires immediate human attention.`,
      priority: 4,
      action_required: 'system_action',
      metadata: {
        finding_id: findingId,
        sla_breach: true,
        agent: 'sherlock',
      },
    });

    if (this.session) this.session.actions_taken++;
  }

  /**
   * Process findings that are stuck in triaged state
   */
  private async processStuckFindings(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: stuck } = await this.supabase
      .from('bot_findings')
      .select('id, title')
      .eq('status', 'triaged')
      .lt('last_agent_activity', oneHourAgo)
      .limit(5);

    if (stuck && stuck.length > 0) {
      this.log('stuck_check', 'success', `Found ${stuck.length} stuck findings`);
      
      for (const finding of stuck) {
        // Re-trigger investigation
        await this.sendMessage(
          'watson',
          'handoff',
          `Stuck finding needs investigation: ${finding.title}`,
          finding.id,
          { retry: true }
        );
      }
    }
  }
}
